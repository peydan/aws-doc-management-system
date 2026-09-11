import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  NotFoundError,
  IdempotencyConflictError,
  MetadataConflictError,
  VersionConflictError,
} from './errors';

const rawClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
export const dynamoDocClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'doc-platform-mvp-control';

const inMemoryTable = new Map<string, any>();

export interface DocumentItem {
  pk: string;
  sk: string;
  document_id: string;
  document_class: string;
  status: 'ACTIVE' | 'SOFT_DELETED';
  current_application_version: number;
  current_s3_key: string;
  current_s3_version_id: string;
  current_metadata_revision: number;
  current_annotation_etag: string;
  created_at: string;
  updated_at: string;
}

export interface VersionItem {
  pk: string;
  sk: string;
  application_version: number;
  s3_key: string;
  s3_version_id: string;
  metadata_revision: number;
  annotation_etag: string;
  content_checksum: string;
  state: 'ACTIVE' | 'SOFT_DELETED';
}

export interface IdempotencyItem {
  pk: string;
  sk: string;
  client_id: string;
  idempotency_key: string;
  request_hash: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  response_summary?: any;
  created_at: string;
  ttl_expiry?: number;
}

export interface UploadSessionItem {
  pk: string;
  sk: string;
  upload_id: string;
  document_id: string;
  document_class: string;
  filename: string;
  content_type: string;
  content_length: number;
  checksum: string;
  metadata: Record<string, any>;
  state: 'INITIATED' | 'UPLOADED' | 'ANNOTATED' | 'ACTIVE' | 'EXPIRED' | 'ABORTED';
  expires_at: string;
  created_at: string;
}

export class DynamoManager {
  static padVersion(v: number): string {
    return String(v).padStart(10, '0');
  }

  // Idempotency check & lock
  static async checkOrSetIdempotency(
    clientId: string,
    idempotencyKey: string,
    requestHash: string
  ): Promise<IdempotencyItem | null> {
    const pk = `IDEMP#${clientId}#${idempotencyKey}`;
    const sk = 'REQUEST';

    if (process.env.MOCK_STORAGE_BYPASS === 'true') {
      const item = inMemoryTable.get(`${pk}#${sk}`);
      if (item && item.request_hash !== requestHash) {
        throw new IdempotencyConflictError(
          `Idempotency key ${idempotencyKey} already used with a different request payload.`
        );
      }
      return item || null;
    }

    const existing = await dynamoDocClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { pk, sk },
        ConsistentRead: true,
      })
    );

    if (existing.Item) {
      const item = existing.Item as IdempotencyItem;
      if (item.request_hash !== requestHash) {
        throw new IdempotencyConflictError(
          `Idempotency key ${idempotencyKey} already used with a different request payload.`
        );
      }
      return item;
    }

    return null;
  }

  // Get current document pointer
  static async getDocument(documentId: string): Promise<DocumentItem> {
    const pk = `DOC#${documentId}`;
    const sk = 'DOC';

    if (process.env.MOCK_STORAGE_BYPASS === 'true') {
      const item = inMemoryTable.get(`${pk}#${sk}`);
      if (!item) {
        throw new NotFoundError(`Document ${documentId} not found`);
      }
      return item as DocumentItem;
    }

    const result = await dynamoDocClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { pk, sk },
        ConsistentRead: true,
      })
    );

    if (!result.Item) {
      throw new NotFoundError(`Document ${documentId} not found`);
    }

    return result.Item as DocumentItem;
  }

  // List document versions
  static async listVersions(documentId: string): Promise<VersionItem[]> {
    const pk = `DOC#${documentId}`;

    if (process.env.MOCK_STORAGE_BYPASS === 'true') {
      const items: VersionItem[] = [];
      for (const [key, val] of inMemoryTable.entries()) {
        if (key.startsWith(`${pk}#VER#`)) {
          items.push(val as VersionItem);
        }
      }
      return items.sort((a, b) => b.application_version - a.application_version);
    }

    const result = await dynamoDocClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': pk,
          ':skPrefix': 'VER#',
        },
        ScanIndexForward: false, // Newest first
      })
    );

    return (result.Items || []) as VersionItem[];
  }

  // Get specific version item
  static async getVersion(documentId: string, version: number): Promise<VersionItem> {
    const pk = `DOC#${documentId}`;
    const sk = `VER#${this.padVersion(version)}`;

    if (process.env.MOCK_STORAGE_BYPASS === 'true') {
      const item = inMemoryTable.get(`${pk}#${sk}`);
      if (!item) {
        throw new NotFoundError(`Version ${version} for document ${documentId} not found`);
      }
      return item as VersionItem;
    }

    const result = await dynamoDocClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { pk, sk },
        ConsistentRead: true,
      })
    );

    if (!result.Item) {
      throw new NotFoundError(`Version ${version} for document ${documentId} not found`);
    }

    return result.Item as VersionItem;
  }

  // Commit document creation / upload transactionally
  static async commitDocumentCreation(params: {
    documentId: string;
    documentClass: string;
    s3Key: string;
    s3VersionId: string;
    annotationEtag: string;
    checksum: string;
    idempotencyKey?: string;
    clientId?: string;
    requestHash?: string;
  }): Promise<DocumentItem> {
    const now = new Date().toISOString();
    const docPk = `DOC#${params.documentId}`;

    const docItem: DocumentItem = {
      pk: docPk,
      sk: 'DOC',
      document_id: params.documentId,
      document_class: params.documentClass,
      status: 'ACTIVE',
      current_application_version: 1,
      current_s3_key: params.s3Key,
      current_s3_version_id: params.s3VersionId,
      current_metadata_revision: 1,
      current_annotation_etag: params.annotationEtag,
      created_at: now,
      updated_at: now,
    };

    const verItem: VersionItem = {
      pk: docPk,
      sk: `VER#${this.padVersion(1)}`,
      application_version: 1,
      s3_key: params.s3Key,
      s3_version_id: params.s3VersionId,
      metadata_revision: 1,
      annotation_etag: params.annotationEtag,
      content_checksum: params.checksum,
      state: 'ACTIVE',
    };

    if (process.env.MOCK_STORAGE_BYPASS === 'true') {
      inMemoryTable.set(`${docItem.pk}#${docItem.sk}`, docItem);
      inMemoryTable.set(`${verItem.pk}#${verItem.sk}`, verItem);
      if (params.idempotencyKey && params.clientId) {
        const idempKey = `IDEMP#${params.clientId}#${params.idempotencyKey}`;
        const ttlExpiry = Math.floor(Date.now() / 1000) + 86400;
        inMemoryTable.set(`${idempKey}#REQUEST`, {
          pk: idempKey,
          sk: 'REQUEST',
          client_id: params.clientId,
          idempotency_key: params.idempotencyKey,
          request_hash: params.requestHash || '',
          status: 'COMPLETED',
          response_summary: {
            document_id: params.documentId,
            application_version: 1,
            s3_version_id: params.s3VersionId,
            metadata_revision: 1,
            status: 'ACTIVE',
            created_at: now,
          },
          created_at: now,
          ttl_expiry: ttlExpiry,
        });
      }
      return docItem;
    }

    const transactItems: any[] = [
      {
        Put: {
          TableName: TABLE_NAME,
          Item: docItem,
          ConditionExpression: 'attribute_not_exists(pk)',
        },
      },
      {
        Put: {
          TableName: TABLE_NAME,
          Item: verItem,
        },
      },
    ];

    if (params.idempotencyKey && params.clientId) {
      const ttlExpiry = Math.floor(Date.now() / 1000) + 86400;
      const idempItem: IdempotencyItem = {
        pk: `IDEMP#${params.clientId}#${params.idempotencyKey}`,
        sk: 'REQUEST',
        client_id: params.clientId,
        idempotency_key: params.idempotencyKey,
        request_hash: params.requestHash || '',
        status: 'COMPLETED',
        response_summary: {
          document_id: params.documentId,
          application_version: 1,
          s3_version_id: params.s3VersionId,
          metadata_revision: 1,
          status: 'ACTIVE',
          created_at: now,
        },
        created_at: now,
        ttl_expiry: ttlExpiry,
      };
      transactItems.push({
        Put: {
          TableName: TABLE_NAME,
          Item: idempItem,
          ConditionExpression: 'attribute_not_exists(pk)',
        },
      });
    }

    await dynamoDocClient.send(new TransactWriteCommand({ TransactItems: transactItems }));
    return docItem;
  }

  // Commit new application version transactionally with OCC
  static async commitNewVersion(params: {
    documentId: string;
    nextAppVersion: number;
    expectedAppVersion: number;
    s3Key: string;
    s3VersionId: string;
    annotationEtag: string;
    checksum: string;
  }): Promise<DocumentItem> {
    const now = new Date().toISOString();
    const docPk = `DOC#${params.documentId}`;
    const verItem: VersionItem = {
      pk: docPk,
      sk: `VER#${this.padVersion(params.nextAppVersion)}`,
      application_version: params.nextAppVersion,
      s3_key: params.s3Key,
      s3_version_id: params.s3VersionId,
      metadata_revision: 1,
      annotation_etag: params.annotationEtag,
      content_checksum: params.checksum,
      state: 'ACTIVE',
    };

    if (process.env.MOCK_STORAGE_BYPASS === 'true') {
      const currentDoc = await this.getDocument(params.documentId);
      if (currentDoc.current_application_version !== params.expectedAppVersion) {
        throw new VersionConflictError(
          `Version conflict: expected application version ${params.expectedAppVersion}, but current is ${currentDoc.current_application_version}`
        );
      }
      const updated: DocumentItem = {
        ...currentDoc,
        current_application_version: params.nextAppVersion,
        current_s3_key: params.s3Key,
        current_s3_version_id: params.s3VersionId,
        current_metadata_revision: 1,
        current_annotation_etag: params.annotationEtag,
        updated_at: now,
      };
      inMemoryTable.set(`${docPk}#DOC`, updated);
      inMemoryTable.set(`${verItem.pk}#${verItem.sk}`, verItem);
      return updated;
    }

    try {
      await dynamoDocClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: TABLE_NAME,
                Key: { pk: docPk, sk: 'DOC' },
                UpdateExpression:
                  'SET current_application_version = :nextVer, current_s3_key = :s3Key, current_s3_version_id = :s3Ver, current_metadata_revision = :metRev, current_annotation_etag = :etag, updated_at = :now',
                ConditionExpression: 'current_application_version = :currVer',
                ExpressionAttributeValues: {
                  ':nextVer': params.nextAppVersion,
                  ':s3Key': params.s3Key,
                  ':s3Ver': params.s3VersionId,
                  ':metRev': 1,
                  ':etag': params.annotationEtag,
                  ':now': now,
                  ':currVer': params.expectedAppVersion,
                },
              },
            },
            {
              Put: {
                TableName: TABLE_NAME,
                Item: verItem,
              },
            },
          ],
        })
      );
    } catch (err: any) {
      if (err.name === 'TransactionCanceledException') {
        const latest = await this.getDocument(params.documentId);
        throw new VersionConflictError(
          `Version conflict: expected application version ${params.expectedAppVersion}, but current is ${latest.current_application_version}`
        );
      }
      throw err;
    }

    return await this.getDocument(params.documentId);
  }

  // Update metadata with optimistic concurrency check
  static async updateMetadataRevision(
    documentId: string,
    expectedRevision: number,
    newRevision: number,
    newEtag: string
  ): Promise<DocumentItem> {
    const now = new Date().toISOString();
    const docPk = `DOC#${documentId}`;

    const currentDoc = await this.getDocument(documentId);

    if (currentDoc.current_metadata_revision !== expectedRevision) {
      throw new MetadataConflictError(expectedRevision, currentDoc.current_metadata_revision);
    }

    if (process.env.MOCK_STORAGE_BYPASS === 'true') {
      const updated: DocumentItem = {
        ...currentDoc,
        current_metadata_revision: newRevision,
        current_annotation_etag: newEtag,
        updated_at: now,
      };
      inMemoryTable.set(`${docPk}#DOC`, updated);
      return updated;
    }

    try {
      const result = await dynamoDocClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { pk: docPk, sk: 'DOC' },
          UpdateExpression:
            'SET current_metadata_revision = :newRev, current_annotation_etag = :etag, updated_at = :now',
          ConditionExpression: 'current_metadata_revision = :expRev',
          ExpressionAttributeValues: {
            ':newRev': newRevision,
            ':etag': newEtag,
            ':now': now,
            ':expRev': expectedRevision,
          },
          ReturnValues: 'ALL_NEW',
        })
      );

      return result.Attributes as DocumentItem;
    } catch (err: any) {
      if (err.name === 'ConditionalCheckFailedException') {
        const latest = await this.getDocument(documentId);
        throw new MetadataConflictError(expectedRevision, latest.current_metadata_revision);
      }
      throw err;
    }
  }

  // Update annotation eTag after successful S3 write (post-OCC)
  static async updateAnnotationEtag(
    documentId: string,
    revision: number,
    newEtag: string
  ): Promise<void> {
    const docPk = `DOC#${documentId}`;

    if (process.env.MOCK_STORAGE_BYPASS === 'true') {
      const item = inMemoryTable.get(`${docPk}#DOC`);
      if (item) {
        item.current_annotation_etag = newEtag;
        inMemoryTable.set(`${docPk}#DOC`, item);
      }
      return;
    }

    await dynamoDocClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: docPk, sk: 'DOC' },
        UpdateExpression: 'SET current_annotation_etag = :etag',
        ConditionExpression: 'current_metadata_revision = :rev',
        ExpressionAttributeValues: {
          ':etag': newEtag,
          ':rev': revision,
        },
      })
    );
  }

  // Soft delete / Restore
  static async setDocumentStatus(
    documentId: string,
    status: 'ACTIVE' | 'SOFT_DELETED'
  ): Promise<DocumentItem> {
    const now = new Date().toISOString();
    const docPk = `DOC#${documentId}`;

    const currentDoc = await this.getDocument(documentId);

    if (process.env.MOCK_STORAGE_BYPASS === 'true') {
      const updated: DocumentItem = {
        ...currentDoc,
        status,
        updated_at: now,
      };
      inMemoryTable.set(`${docPk}#DOC`, updated);
      return updated;
    }

    const result = await dynamoDocClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: docPk, sk: 'DOC' },
        UpdateExpression: 'SET #st = :status, updated_at = :now',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: {
          ':status': status,
          ':now': now,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as DocumentItem;
  }

  // Save Upload Session
  static async createUploadSession(session: UploadSessionItem): Promise<void> {
    if (process.env.MOCK_STORAGE_BYPASS === 'true') {
      inMemoryTable.set(`${session.pk}#${session.sk}`, session);
      return;
    }

    await dynamoDocClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: session,
      })
    );
  }

  // Get Upload Session
  static async getUploadSession(uploadId: string): Promise<UploadSessionItem> {
    const pk = `UPLOAD#${uploadId}`;
    const sk = 'SESSION';

    if (process.env.MOCK_STORAGE_BYPASS === 'true') {
      const item = inMemoryTable.get(`${pk}#${sk}`);
      if (!item) {
        throw new NotFoundError(`Upload session ${uploadId} not found`);
      }
      return item as UploadSessionItem;
    }

    const result = await dynamoDocClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { pk, sk },
        ConsistentRead: true,
      })
    );

    if (!result.Item) {
      throw new NotFoundError(`Upload session ${uploadId} not found`);
    }

    return result.Item as UploadSessionItem;
  }
}
