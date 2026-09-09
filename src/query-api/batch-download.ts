import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import JSZip from 'jszip';
import * as path from 'path';
import { authenticateRequest, authorizeRoles } from '../shared/auth';
import { DynamoManager } from '../shared/dynamo';
import { S3Manager } from '../shared/s3';
import { PlatformError, ValidationError, isPlatformError } from '../shared/errors';
import { CORS_HEADERS } from '../shared/headers';
import { isConvertibleToPdf, detectFileFormat, getPdfPageCount } from '../shared/pdf-converter';
import { parseJsonBody, validateBatchDownloadRequest } from '../shared/validator';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const correlationId = event.requestContext.requestId;
  try {
    const user = await authenticateRequest(event);
    authorizeRoles(user, ['Document.Reader', 'Document.Writer', 'Document.MetadataEditor', 'Document.Admin']);

    const rawBody = parseJsonBody(event);
    const { items, format, include_metadata } = validateBatchDownloadRequest(rawBody);

    const acceptHeader = event.headers?.['accept'] || event.headers?.['Accept'] || '';
    const wantsDirectBinary =
      rawBody.direct === true ||
      rawBody.direct === 'true' ||
      event.queryStringParameters?.direct === 'true' ||
      acceptHeader.toLowerCase().includes('application/zip');

    const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const zipFilename = `documents_export_${timestampStr}.zip`;

    const zip = new JSZip();
    const manifestDocs: Array<Record<string, any>> = [];
    const failedDocs: Array<{ document_id: string; reason: string }> = [];

    for (const item of items) {
      const docId = item.document_id;
      try {
        const doc = await DynamoManager.getDocument(docId);
        if (doc.status === 'SOFT_DELETED') {
          failedDocs.push({ document_id: docId, reason: 'Document is soft-deleted' });
          continue;
        }

        let versionId = doc.current_s3_version_id;
        let appVersion = doc.current_application_version;
        let s3Key = doc.current_s3_key;

        if (item.version !== undefined) {
          const verItem = await DynamoManager.getVersion(docId, item.version);
          versionId = verItem.s3_version_id;
          appVersion = verItem.application_version;
          s3Key = verItem.s3_key || doc.current_s3_key;
        }

        const anno = await S3Manager.getAnnotation(doc.document_class, docId, versionId);
        const originalContentType = anno.metadata.content_type || 'application/octet-stream';
        let originalFilename = anno.metadata.filename || `document_${docId}`;

        let targetKey = s3Key;
        let targetVersionId: string | undefined = versionId;
        let deliveryContentType = originalContentType;
        let isDerivative = false;
        let docFormat = anno.metadata.format || detectFileFormat(originalContentType, originalFilename);
        let docPageCount: number | undefined = anno.metadata.page_count;

        if (format === 'pdf') {
          if (isConvertibleToPdf(originalContentType)) {
            const derivResult = await S3Manager.getOrCreatePdfDerivative(doc.document_class, s3Key, {
              documentId: docId,
              sourceVersionId: versionId,
              sourceChecksum: anno.metadata.content_checksum || '',
              sourceContentType: originalContentType,
              applicationVersion: appVersion,
            });
            targetKey = derivResult.derivativeKey;
            targetVersionId = undefined;
            deliveryContentType = 'application/pdf';
            isDerivative = true;
            docFormat = 'pdf';
            docPageCount = derivResult.pageCount;
          } else if (originalContentType === 'application/pdf') {
            deliveryContentType = 'application/pdf';
            isDerivative = false;
            docFormat = 'pdf';
          } else {
            failedDocs.push({
              document_id: docId,
              reason: `Format conversion to PDF not supported for content-type '${originalContentType}'`,
            });
            continue;
          }
        }

        // Fetch binary content from S3
        const objectData = await S3Manager.getObjectBuffer(targetKey, targetVersionId);

        if (docFormat === 'pdf' && (docPageCount === undefined || docPageCount === null)) {
          try {
            docPageCount = await getPdfPageCount(objectData.body);
          } catch {}
        }

        // Sanitize and ensure unique filename within ZIP
        const baseName = path.basename(originalFilename);
        let finalFilename = baseName;
        if (format === 'pdf' && !finalFilename.toLowerCase().endsWith('.pdf')) {
          const ext = path.extname(finalFilename);
          finalFilename = ext ? `${finalFilename.slice(0, -ext.length)}.pdf` : `${finalFilename}.pdf`;
        }

        const zipEntryName = `${docId.substring(0, 8)}_${finalFilename}`;
        zip.file(zipEntryName, objectData.body);

        if (include_metadata) {
          const metaEntryName = `${docId.substring(0, 8)}_metadata.json`;
          const metaToExport = {
            ...anno.metadata,
            format: docFormat,
            ...(docPageCount !== undefined ? { page_count: docPageCount } : {}),
          };
          zip.file(metaEntryName, JSON.stringify(metaToExport, null, 2));
        }

        manifestDocs.push({
          document_id: docId,
          document_class: doc.document_class,
          application_version: appVersion,
          s3_version_id: versionId,
          filename_in_zip: zipEntryName,
          original_filename: originalFilename,
          content_type: deliveryContentType,
          format: docFormat,
          ...(docPageCount !== undefined ? { page_count: docPageCount } : {}),
          size_bytes: objectData.body.length,
          is_derivative: isDerivative,
        });
      } catch (err: any) {
        failedDocs.push({
          document_id: docId,
          reason: err?.message || 'Failed to retrieve document content or metadata',
        });
      }
    }

    if (manifestDocs.length === 0) {
      throw new ValidationError(
        'None of the requested documents could be retrieved or exported to ZIP',
        failedDocs.map((f) => ({ field: f.document_id, error: f.reason }))
      );
    }

    // Add manifest.json at root of ZIP
    const manifest = {
      batch_id: batchId,
      exported_at: new Date().toISOString(),
      total_requested: items.length,
      successful_count: manifestDocs.length,
      failed_count: failedDocs.length,
      format,
      include_metadata,
      documents: manifestDocs,
      failed_documents: failedDocs,
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    const exportKey = `exports/${batchId}.zip`;
    await S3Manager.putContent(exportKey, zipBuffer, 'application/zip');
    const downloadUrl = await S3Manager.generatePresignedDownloadUrl(exportKey, undefined, 900);

    // Direct binary response if requested and within API Gateway limits (<= 5 MB)
    if (wantsDirectBinary && zipBuffer.length <= 5 * 1024 * 1024) {
      return {
        statusCode: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${zipFilename}"`,
          'X-Batch-Id': batchId,
          'X-File-Count': String(manifestDocs.length),
        },
        isBase64Encoded: true,
        body: zipBuffer.toString('base64'),
      };
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        batch_id: batchId,
        zip_filename: zipFilename,
        download_url: downloadUrl,
        expires_at: new Date(Date.now() + 900 * 1000).toISOString(),
        file_count: manifestDocs.length,
        total_bytes: zipBuffer.length,
        documents: manifestDocs,
        failed_documents: failedDocs,
      }),
    };
  } catch (err: any) {
    console.error(`[${event.path || 'batch-download'}] Error:`, err);
    if (err instanceof PlatformError || isPlatformError(err)) {
      return {
        statusCode: err.statusCode,
        headers: CORS_HEADERS,
        body: JSON.stringify(err.toResponse(correlationId)),
      };
    }
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: err?.message || 'An unexpected internal error occurred',
          correlation_id: correlationId,
          retryable: true,
        },
      }),
    };
  }
}
