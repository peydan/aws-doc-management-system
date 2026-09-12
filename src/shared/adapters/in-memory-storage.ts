/**
 * In-Memory Storage & Testing Adapter
 * 
 * Provides zero-cost, local in-memory simulation of Amazon S3 and DynamoDB
 * operations for unit testing and local demo scenarios.
 * 
 * PRODUCTION SAFETY INVARIANT:
 * Mock bypass flags (MOCK_STORAGE_BYPASS / MOCK_AUTH_BYPASS) are strictly
 * forbidden in production environments (NODE_ENV === 'production').
 */

import {
  NotFoundError,
  IdempotencyConflictError,
} from '../errors';
import { convertDocumentToPdf, getPdfPageCount } from '../pdf-converter';

// --- Production Safety Guards ---

export function isMockStorageEnabled(): boolean {
  if (process.env.MOCK_STORAGE_BYPASS === 'true') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'FATAL SECURITY VIOLATION: MOCK_STORAGE_BYPASS cannot be enabled in production environment (NODE_ENV=production).'
      );
    }
    return true;
  }
  return false;
}

export function isMockAuthEnabled(): boolean {
  if (process.env.MOCK_AUTH_BYPASS === 'true') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'FATAL SECURITY VIOLATION: MOCK_AUTH_BYPASS cannot be enabled in production environment (NODE_ENV=production).'
      );
    }
    return true;
  }
  return false;
}

// --- In-Memory Stores ---

export interface InMemoryS3Object {
  body: Buffer;
  contentType: string;
  versionId: string;
  metadata?: Record<string, any>;
}

const inMemoryS3Content = new Map<string, InMemoryS3Object>();
const inMemoryS3Annotations = new Map<string, Record<string, any>>();
const inMemoryDynamoTable = new Map<string, any>();

/**
 * Resets all in-memory mock stores.
 * Useful for test isolation in beforeEach/afterEach hooks.
 */
export function resetInMemoryStores(): void {
  inMemoryS3Content.clear();
  inMemoryS3Annotations.clear();
  inMemoryDynamoTable.clear();
}

// --- In-Memory Storage Adapter ---

export class InMemoryStorageAdapter {
  // S3: Object operations
  static putObject(key: string, body: Buffer, contentType: string): { versionId: string; eTag: string } {
    const versionId = `mock-v-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    inMemoryS3Content.set(`${key}#${versionId}`, { body, contentType, versionId });
    inMemoryS3Content.set(key, { body, contentType, versionId });
    return { versionId, eTag: `mock-etag-${Date.now()}` };
  }

  static getObjectBuffer(key: string, versionId?: string): { body: Buffer; contentType: string } {
    const mockKey = versionId ? `${key}#${versionId}` : key;
    const cached = inMemoryS3Content.get(mockKey) || inMemoryS3Content.get(key);
    if (cached) {
      return { body: cached.body, contentType: cached.contentType };
    }
    return {
      body: Buffer.from('%PDF-1.4 mock document binary content', 'utf-8'),
      contentType: 'application/pdf',
    };
  }

  static verifyObjectExists(key: string, versionId?: string): {
    contentLength: number;
    contentType: string;
    versionId: string;
    eTag: string;
  } {
    return {
      contentLength: 5242880,
      contentType: 'application/pdf',
      versionId: versionId || 'mock-v-head-1',
      eTag: 'mock-etag-head-1',
    };
  }

  static async getOrCreatePdfDerivative(
    derivativeKey: string,
    rawKey: string,
    meta: {
      documentId: string;
      sourceVersionId: string;
      sourceContentType: string;
    }
  ): Promise<{
    body: Buffer;
    contentType: string;
    versionId: string;
    pageCount: number;
    cached: boolean;
  }> {
    const mockKey = `${derivativeKey}#mock-pdf`;
    let cached = inMemoryS3Content.get(mockKey) || inMemoryS3Content.get(derivativeKey);
    let wasCached = true;

    if (!cached) {
      wasCached = false;
      const sourceData =
        inMemoryS3Content.get(`${rawKey}#${meta.sourceVersionId}`) ||
        inMemoryS3Content.get(rawKey);

      let pdfBuffer: Buffer;
      if (sourceData && sourceData.body) {
        pdfBuffer = await convertDocumentToPdf(sourceData.body, meta.sourceContentType);
      } else {
        const dummyPng = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          'base64'
        );
        pdfBuffer = await convertDocumentToPdf(dummyPng, 'image/png');
      }

      const pageCount = await getPdfPageCount(pdfBuffer);
      cached = {
        body: pdfBuffer,
        contentType: 'application/pdf',
        versionId: 'mock-derivative-v1',
        metadata: {
          format: 'pdf',
          'page-count': String(pageCount),
        },
      };
      inMemoryS3Content.set(derivativeKey, cached);
    }

    const pageCount = cached.metadata?.['page-count']
      ? parseInt(cached.metadata['page-count'], 10)
      : 1;

    return {
      body: cached.body,
      contentType: cached.contentType,
      versionId: cached.versionId,
      pageCount,
      cached: wasCached,
    };
  }

  // S3: Annotations
  static putAnnotation(
    key: string,
    documentClass: string,
    documentId: string,
    s3VersionId: string,
    metadata: Record<string, any>,
    annotationName: string
  ): { eTag: string } {
    inMemoryS3Annotations.set(`${key}#${s3VersionId}#${annotationName}`, metadata);
    inMemoryS3Annotations.set(`${key}#${annotationName}`, metadata);
    inMemoryS3Annotations.set(`documents/${documentClass}/${documentId}.annotation.json`, metadata);
    return { eTag: `mock-anno-etag-${Date.now()}` };
  }

  static getAnnotation(
    key: string,
    documentClass: string,
    documentId: string,
    versionId?: string,
    annotationName = 'document-metadata'
  ): { metadata: Record<string, any>; eTag: string } {
    const existing =
      (versionId && inMemoryS3Annotations.get(`${key}#${versionId}#${annotationName}`)) ||
      inMemoryS3Annotations.get(`${key}#${annotationName}`) ||
      inMemoryS3Annotations.get(`documents/${documentClass}/${documentId}.annotation.json`);

    if (!existing) {
      throw new NotFoundError(`Authoritative annotation for document ${documentId} not found`);
    }
    return { metadata: existing, eTag: 'mock-anno-etag-1' };
  }

  static deleteAnnotation(
    key: string,
    documentClass: string,
    documentId: string,
    versionId?: string,
    annotationName = 'document-metadata'
  ): void {
    if (versionId) inMemoryS3Annotations.delete(`${key}#${versionId}#${annotationName}`);
    inMemoryS3Annotations.delete(`${key}#${annotationName}`);
    inMemoryS3Annotations.delete(`documents/${documentClass}/${documentId}.annotation.json`);
  }

  // S3: Presigned URLs
  static generatePresignedUploadUrl(key: string, expiresInSeconds: number): string {
    return `https://mock-s3-upload.local/${key}?expires=${expiresInSeconds}`;
  }

  static generatePresignedDownloadUrl(key: string, versionId?: string): string {
    const vParam = versionId ? `?versionId=${versionId}` : '';
    return `https://mock-s3-download.local/${key}${vParam}`;
  }

  // DynamoDB: Idempotency
  static checkOrSetIdempotency(
    pk: string,
    sk: string,
    idempotencyKey: string,
    requestHash: string
  ): any | null {
    const item = inMemoryDynamoTable.get(`${pk}#${sk}`);
    if (item && item.request_hash !== requestHash) {
      throw new IdempotencyConflictError(
        `Idempotency key ${idempotencyKey} already used with a different request payload.`
      );
    }
    return item || null;
  }

  // DynamoDB: Document and Versions
  static getDocument(documentId: string): any {
    const pk = `DOC#${documentId}`;
    const item = inMemoryDynamoTable.get(`${pk}#DOC`);
    if (!item) {
      throw new NotFoundError(`Document ${documentId} not found`);
    }
    return item;
  }

  static listVersions(documentId: string): any[] {
    const pk = `DOC#${documentId}`;
    const items: any[] = [];
    for (const [key, val] of inMemoryDynamoTable.entries()) {
      if (key.startsWith(`${pk}#VER#`)) {
        items.push(val);
      }
    }
    return items.sort((a, b) => b.application_version - a.application_version);
  }

  static getVersion(documentId: string, version: number, padVersionFn: (v: number) => string): any {
    const pk = `DOC#${documentId}`;
    const sk = `VER#${padVersionFn(version)}`;
    const item = inMemoryDynamoTable.get(`${pk}#${sk}`);
    if (!item) {
      throw new NotFoundError(`Version ${version} for document ${documentId} not found`);
    }
    return item;
  }

  static commitDocumentCreation(
    docItem: any,
    verItem: any,
    idempParams?: { clientId: string; idempotencyKey: string; requestHash?: string; now: string; s3VersionId: string; documentId: string }
  ): any {
    inMemoryDynamoTable.set(`${docItem.pk}#${docItem.sk}`, docItem);
    inMemoryDynamoTable.set(`${verItem.pk}#${verItem.sk}`, verItem);
    if (idempParams) {
      const idempKey = `IDEMP#${idempParams.clientId}#${idempParams.idempotencyKey}`;
      const ttlExpiry = Math.floor(Date.now() / 1000) + 86400;
      inMemoryDynamoTable.set(`${idempKey}#REQUEST`, {
        pk: idempKey,
        sk: 'REQUEST',
        client_id: idempParams.clientId,
        idempotency_key: idempParams.idempotencyKey,
        request_hash: idempParams.requestHash || '',
        status: 'COMPLETED',
        response_summary: {
          document_id: idempParams.documentId,
          application_version: 1,
          s3_version_id: idempParams.s3VersionId,
          metadata_revision: 1,
          status: 'ACTIVE',
          created_at: idempParams.now,
        },
        created_at: idempParams.now,
        ttl_expiry: ttlExpiry,
      });
    }
    return docItem;
  }

  static commitNewVersion(
    docPk: string,
    currentDoc: any,
    verItem: any,
    params: {
      nextAppVersion: number;
      s3Key: string;
      s3VersionId: string;
      annotationEtag: string;
      now: string;
    }
  ): any {
    const updated = {
      ...currentDoc,
      current_application_version: params.nextAppVersion,
      current_s3_key: params.s3Key,
      current_s3_version_id: params.s3VersionId,
      current_metadata_revision: 1,
      current_annotation_etag: params.annotationEtag,
      updated_at: params.now,
    };
    inMemoryDynamoTable.set(`${docPk}#DOC`, updated);
    inMemoryDynamoTable.set(`${verItem.pk}#${verItem.sk}`, verItem);
    return updated;
  }

  static updateMetadataRevision(
    docPk: string,
    currentDoc: any,
    newRevision: number,
    newEtag: string,
    now: string
  ): any {
    const updated = {
      ...currentDoc,
      current_metadata_revision: newRevision,
      current_annotation_etag: newEtag,
      updated_at: now,
    };
    inMemoryDynamoTable.set(`${docPk}#DOC`, updated);
    return updated;
  }

  static updateAnnotationEtag(docPk: string, newEtag: string): void {
    const item = inMemoryDynamoTable.get(`${docPk}#DOC`);
    if (item) {
      item.current_annotation_etag = newEtag;
      inMemoryDynamoTable.set(`${docPk}#DOC`, item);
    }
  }

  static setDocumentStatus(docPk: string, currentDoc: any, status: string, now: string): any {
    const updated = {
      ...currentDoc,
      status,
      updated_at: now,
    };
    inMemoryDynamoTable.set(`${docPk}#DOC`, updated);
    return updated;
  }

  static createUploadSession(session: any): void {
    inMemoryDynamoTable.set(`${session.pk}#${session.sk}`, session);
  }

  static getUploadSession(uploadId: string): any {
    const pk = `UPLOAD#${uploadId}`;
    const sk = 'SESSION';
    const item = inMemoryDynamoTable.get(`${pk}#${sk}`);
    if (!item) {
      throw new NotFoundError(`Upload session ${uploadId} not found`);
    }
    return item;
  }
}
