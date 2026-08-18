import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NotFoundError } from './errors';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const BUCKET_NAME = process.env.DOCUMENT_BUCKET_NAME || 'doc-platform-mvp-documents';

const inMemoryS3Content = new Map<string, { body: Buffer; contentType: string; versionId: string }>();
const inMemoryS3Annotations = new Map<string, Record<string, any>>();

export interface S3PutResult {
  versionId: string;
  eTag: string;
}

export class S3Manager {
  static getDocumentKey(documentClass: string, documentId: string): string {
    return `documents/${documentClass}/${documentId}`;
  }

  static getAnnotationKey(documentClass: string, documentId: string): string {
    return `documents/${documentClass}/${documentId}.annotation.json`;
  }

  static async putContent(
    key: string,
    body: Buffer,
    contentType: string,
    checksumSha256?: string
  ): Promise<S3PutResult> {
    if (process.env.MOCK_STORAGE_BYPASS === 'true') {
      const versionId = `mock-v-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      inMemoryS3Content.set(`${key}#${versionId}`, { body, contentType, versionId });
      inMemoryS3Content.set(key, { body, contentType, versionId });
      return { versionId, eTag: `mock-etag-${Date.now()}` };
    }

    const base64Checksum = checksumSha256
      ? (checksumSha256.length === 64 ? Buffer.from(checksumSha256, 'hex').toString('base64') : checksumSha256)
      : undefined;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
      ChecksumSHA256: base64Checksum,
    });

    const response = await s3Client.send(command);
    if (!response.VersionId) {
      throw new Error('S3 versioning is required but VersionId was not returned');
    }

    return {
      versionId: response.VersionId,
      eTag: response.ETag || '',
    };
  }

  static async putAnnotation(
    documentClass: string,
    documentId: string,
    s3VersionId: string,
    metadata: Record<string, any>
  ): Promise<{ eTag: string }> {
    const key = this.getAnnotationKey(documentClass, documentId);

    if (process.env.MOCK_STORAGE_BYPASS === 'true') {
      inMemoryS3Annotations.set(key, metadata);
      return { eTag: `mock-anno-etag-${Date.now()}` };
    }

    const body = Buffer.from(JSON.stringify(metadata, null, 2), 'utf-8');

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: 'application/json',
      Metadata: {
        'x-amz-meta-target-version-id': s3VersionId,
        'x-amz-meta-annotation-name': 'document-metadata',
      },
    });

    const response = await s3Client.send(command);
    return { eTag: response.ETag || '' };
  }

  static async getAnnotation(
    documentClass: string,
    documentId: string,
    versionId?: string
  ): Promise<{ metadata: Record<string, any>; eTag: string }> {
    const key = this.getAnnotationKey(documentClass, documentId);

    if (process.env.MOCK_STORAGE_BYPASS === 'true') {
      const existing = inMemoryS3Annotations.get(key);
      if (!existing) {
        throw new NotFoundError(`Authoritative annotation for document ${documentId} not found`);
      }
      return { metadata: existing, eTag: 'mock-anno-etag-1' };
    }

    try {
      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        VersionId: versionId,
      });

      const response = await s3Client.send(command);
      if (!response.Body) {
        throw new NotFoundError(`Annotation for document ${documentId} not found`);
      }

      const bodyStr = await response.Body.transformToString('utf-8');
      const metadata = JSON.parse(bodyStr);
      return { metadata, eTag: response.ETag || '' };
    } catch (err: any) {
      if (err.name === 'NoSuchKey' || err.name === 'NotFound') {
        throw new NotFoundError(`Authoritative annotation for document ${documentId} not found`);
      }
      throw err;
    }
  }

  static async generatePresignedUploadUrl(
    key: string,
    contentType: string,
    expiresInSeconds = 900
  ): Promise<string> {
    if (process.env.MOCK_STORAGE_BYPASS === 'true') {
      return `https://mock-s3-upload.local/${key}?expires=${expiresInSeconds}`;
    }
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
  }

  static async generatePresignedDownloadUrl(
    key: string,
    versionId: string,
    expiresInSeconds = 900
  ): Promise<string> {
    if (process.env.MOCK_STORAGE_BYPASS === 'true') {
      return `https://mock-s3-download.local/${key}?versionId=${versionId}`;
    }
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      VersionId: versionId,
    });
    return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
  }

  static async verifyObjectExists(
    key: string,
    versionId?: string
  ): Promise<{ contentLength: number; contentType: string; versionId: string; eTag: string }> {
    if (process.env.MOCK_STORAGE_BYPASS === 'true') {
      return {
        contentLength: 5242880,
        contentType: 'application/pdf',
        versionId: versionId || 'mock-v-head-1',
        eTag: 'mock-etag-head-1',
      };
    }
    try {
      const command = new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        VersionId: versionId,
      });

      const response = await s3Client.send(command);
      return {
        contentLength: response.ContentLength || 0,
        contentType: response.ContentType || 'application/octet-stream',
        versionId: response.VersionId || versionId || '',
        eTag: response.ETag || '',
      };
    } catch (err: any) {
      throw new NotFoundError(`S3 Object key ${key} version ${versionId || 'latest'} not found`);
    }
  }
}
