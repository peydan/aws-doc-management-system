import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommandOutput,
  PutObjectAnnotationCommand,
  GetObjectAnnotationCommand,
  DeleteObjectAnnotationCommand,
  ListObjectAnnotationsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NotFoundError } from './errors';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

function getBucketName(): string {
  return process.env.DOCUMENT_BUCKET_NAME || 'doc-platform-mvp-documents';
}

async function payloadToString(payload: any): Promise<string> {
  if (!payload) return '';
  if (typeof payload.transformToString === 'function') {
    return await payload.transformToString('utf-8');
  }
  if (Buffer.isBuffer(payload)) {
    return payload.toString('utf-8');
  }
  if (payload instanceof Uint8Array) {
    return Buffer.from(payload).toString('utf-8');
  }
  if (typeof payload === 'string') {
    return payload;
  }
  if (typeof payload[Symbol.asyncIterator] === 'function') {
    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf-8');
  }
  return String(payload);
}

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
      Bucket: getBucketName(),
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
    metadata: Record<string, any>,
    annotationName = 'document-metadata'
  ): Promise<{ eTag: string }> {
    const key = this.getDocumentKey(documentClass, documentId);

    if (process.env.MOCK_STORAGE_BYPASS === 'true') {
      inMemoryS3Annotations.set(`${key}#${s3VersionId}#${annotationName}`, metadata);
      inMemoryS3Annotations.set(`${key}#${annotationName}`, metadata);
      inMemoryS3Annotations.set(`documents/${documentClass}/${documentId}.annotation.json`, metadata);
      return { eTag: `mock-anno-etag-${Date.now()}` };
    }

    const payload = Buffer.from(JSON.stringify(metadata, null, 2), 'utf-8');

    const command = new PutObjectAnnotationCommand({
      Bucket: getBucketName(),
      Key: key,
      VersionId: s3VersionId,
      AnnotationName: annotationName,
      AnnotationPayload: payload,
    });

    const response = await s3Client.send(command);
    return { eTag: response.ETag || response.ChecksumSHA256 || `anno-etag-${Date.now()}` };
  }

  static async getAnnotation(
    documentClass: string,
    documentId: string,
    versionId?: string,
    annotationName = 'document-metadata'
  ): Promise<{ metadata: Record<string, any>; eTag: string }> {
    const key = this.getDocumentKey(documentClass, documentId);

    if (process.env.MOCK_STORAGE_BYPASS === 'true') {
      const existing =
        (versionId && inMemoryS3Annotations.get(`${key}#${versionId}#${annotationName}`)) ||
        inMemoryS3Annotations.get(`${key}#${annotationName}`) ||
        inMemoryS3Annotations.get(`documents/${documentClass}/${documentId}.annotation.json`);
      if (!existing) {
        throw new NotFoundError(`Authoritative annotation for document ${documentId} not found`);
      }
      return { metadata: existing, eTag: 'mock-anno-etag-1' };
    }

    try {
      const command = new GetObjectAnnotationCommand({
        Bucket: getBucketName(),
        Key: key,
        VersionId: versionId,
        AnnotationName: annotationName,
      });

      const response = await s3Client.send(command);
      if (!response.AnnotationPayload) {
        throw new NotFoundError(`Annotation for document ${documentId} not found`);
      }

      const bodyStr = await payloadToString(response.AnnotationPayload);
      const metadata = JSON.parse(bodyStr);
      return { metadata, eTag: response.ETag || response.ChecksumSHA256 || '' };
    } catch (err: any) {
      if (err instanceof NotFoundError || (err && err.statusCode === 404)) {
        throw err;
      }
      if (
        err.name === 'NoSuchAnnotation' ||
        err.name === 'NoSuchKey' ||
        err.name === 'NotFound' ||
        err.Code === 'NoSuchKey' ||
        err.Code === 'NoSuchAnnotation' ||
        err.$metadata?.httpStatusCode === 404
      ) {
        throw new NotFoundError(`Authoritative annotation for document ${documentId} not found`);
      }
      console.error(`[S3Manager.getAnnotation Error for ${key}]:`, err);
      throw err;
    }
  }

  static async deleteAnnotation(
    documentClass: string,
    documentId: string,
    versionId?: string,
    annotationName = 'document-metadata'
  ): Promise<void> {
    const key = this.getDocumentKey(documentClass, documentId);

    if (process.env.MOCK_STORAGE_BYPASS === 'true') {
      if (versionId) inMemoryS3Annotations.delete(`${key}#${versionId}#${annotationName}`);
      inMemoryS3Annotations.delete(`${key}#${annotationName}`);
      inMemoryS3Annotations.delete(`documents/${documentClass}/${documentId}.annotation.json`);
      return;
    }

    try {
      const command = new DeleteObjectAnnotationCommand({
        Bucket: getBucketName(),
        Key: key,
        VersionId: versionId,
        AnnotationName: annotationName,
      });
      await s3Client.send(command);
    } catch (err: any) {
      if (err.name !== 'NoSuchAnnotation' && err.name !== 'NoSuchKey' && err.name !== 'NotFound') {
        throw err;
      }
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
      Bucket: getBucketName(),
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
      Bucket: getBucketName(),
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
        Bucket: getBucketName(),
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
