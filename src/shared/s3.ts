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
import { convertDocumentToPdf, getPdfPageCount } from './pdf-converter';
import { isMockStorageEnabled, InMemoryStorageAdapter } from './adapters/in-memory-storage';

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

export interface S3PutResult {
  versionId: string;
  eTag: string;
}

export interface DerivativeMetadata {
  documentId: string;
  sourceVersionId: string;
  sourceChecksum: string;
  sourceContentType: string;
  applicationVersion: number;
}

export interface PdfDerivativeResult {
  derivativeKey: string;
  pageCount: number;
}

export class S3Manager {
  static getDerivativeKey(documentClass: string, documentId: string, versionId: string): string {
    return `derivatives/${documentClass}/${documentId}/${versionId}.pdf`;
  }

  static async getOrCreatePdfDerivative(
    documentClass: string,
    rawKey: string,
    meta: DerivativeMetadata
  ): Promise<PdfDerivativeResult> {
    const derivativeKey = this.getDerivativeKey(documentClass, meta.documentId, meta.sourceVersionId);

    if (isMockStorageEnabled()) {
      const res = await InMemoryStorageAdapter.getOrCreatePdfDerivative(derivativeKey, rawKey, meta);
      return { derivativeKey, pageCount: res.pageCount };
    }

    // 1. Check if derivative already exists in S3 (Cache Hit)
    try {
      const headCmd = new HeadObjectCommand({
        Bucket: getBucketName(),
        Key: derivativeKey,
      });
      const headRes = await s3Client.send(headCmd);
      let pageCount = headRes.Metadata?.['page-count'] ? parseInt(headRes.Metadata['page-count'], 10) : undefined;
      if (!pageCount) {
        const obj = await this.getObjectBuffer(derivativeKey);
        pageCount = await getPdfPageCount(obj.body);
      }
      return { derivativeKey, pageCount: pageCount || 1 };
    } catch {
      // 2. Cache Miss: Fetch original content from S3
      const getCmd = new GetObjectCommand({
        Bucket: getBucketName(),
        Key: rawKey,
        VersionId: meta.sourceVersionId,
      });
      const response = await s3Client.send(getCmd);
      const originalBuffer = Buffer.from(await response.Body!.transformToByteArray());

      // 3. Convert image or DOCX to PDF
      const pdfBuffer = await convertDocumentToPdf(originalBuffer, meta.sourceContentType);
      const pageCount = await getPdfPageCount(pdfBuffer);

      // 4. Save derivative to S3 with origin user metadata (x-amz-meta-*)
      await s3Client.send(
        new PutObjectCommand({
          Bucket: getBucketName(),
          Key: derivativeKey,
          Body: pdfBuffer,
          ContentType: 'application/pdf',
          Metadata: {
            'source-document-id': meta.documentId,
            'source-app-version': String(meta.applicationVersion),
            'source-s3-version-id': meta.sourceVersionId,
            'source-content-checksum': meta.sourceChecksum,
            'source-content-type': meta.sourceContentType,
            'converted-at': new Date().toISOString(),
            'format': 'pdf',
            'page-count': String(pageCount),
          },
        })
      );

      return { derivativeKey, pageCount };
    }
  }
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
    if (isMockStorageEnabled()) {
      return InMemoryStorageAdapter.putObject(key, body, contentType);
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

    if (isMockStorageEnabled()) {
      return InMemoryStorageAdapter.putAnnotation(
        key,
        documentClass,
        documentId,
        s3VersionId,
        metadata,
        annotationName
      );
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

    if (isMockStorageEnabled()) {
      return InMemoryStorageAdapter.getAnnotation(
        key,
        documentClass,
        documentId,
        versionId,
        annotationName
      );
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

    if (isMockStorageEnabled()) {
      InMemoryStorageAdapter.deleteAnnotation(
        key,
        documentClass,
        documentId,
        versionId,
        annotationName
      );
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
    if (isMockStorageEnabled()) {
      return InMemoryStorageAdapter.generatePresignedUploadUrl(key, expiresInSeconds);
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
    versionId?: string,
    expiresInSeconds = 900
  ): Promise<string> {
    if (isMockStorageEnabled()) {
      return InMemoryStorageAdapter.generatePresignedDownloadUrl(key, versionId);
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
    if (isMockStorageEnabled()) {
      return InMemoryStorageAdapter.verifyObjectExists(key, versionId);
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

  static async getObjectBuffer(
    key: string,
    versionId?: string
  ): Promise<{ body: Buffer; contentType: string }> {
    if (isMockStorageEnabled()) {
      return InMemoryStorageAdapter.getObjectBuffer(key, versionId);
    }

    try {
      const command = new GetObjectCommand({
        Bucket: getBucketName(),
        Key: key,
        VersionId: versionId,
      });

      const response = await s3Client.send(command);
      if (!response.Body) {
        throw new NotFoundError(`Empty content body for S3 object ${key}`);
      }

      const body = Buffer.from(await response.Body.transformToByteArray());
      return {
        body,
        contentType: response.ContentType || 'application/octet-stream',
      };
    } catch (err: any) {
      if (
        err.name === 'NoSuchKey' ||
        err.name === 'NotFound' ||
        err.Code === 'NoSuchKey' ||
        err.$metadata?.httpStatusCode === 404
      ) {
        throw new NotFoundError(`S3 Object key ${key} version ${versionId || 'latest'} not found`);
      }
      throw err;
    }
  }
}
