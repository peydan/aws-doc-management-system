import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { authenticateRequest, authorizeRoles } from '../shared/auth';
import { DynamoManager } from '../shared/dynamo';
import { S3Manager } from '../shared/s3';
import { PlatformError, ValidationError } from '../shared/errors';
import { CORS_HEADERS } from '../shared/headers';
import { isConvertibleToPdf } from '../shared/pdf-converter';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const correlationId = event.requestContext.requestId;
  try {
    const user = await authenticateRequest(event);
    authorizeRoles(user, ['Document.Reader', 'Document.Writer', 'Document.MetadataEditor', 'Document.Admin']);

    const documentId = event.pathParameters?.document_id;
    if (!documentId) {
      throw new ValidationError('document_id is required');
    }

    const versionQuery = event.queryStringParameters?.version;
    const requestedFormat = event.queryStringParameters?.format?.toLowerCase();
    const doc = await DynamoManager.getDocument(documentId);

    let versionId = doc.current_s3_version_id;
    let appVersion = doc.current_application_version;
    let s3Key = doc.current_s3_key;

    if (versionQuery) {
      const vNum = parseInt(versionQuery, 10);
      if (!isNaN(vNum)) {
        const verItem = await DynamoManager.getVersion(documentId, vNum);
        versionId = verItem.s3_version_id;
        appVersion = verItem.application_version;
        s3Key = verItem.s3_key || doc.current_s3_key;
      }
    }

    let targetKey = s3Key;
    let targetVersionId: string | undefined = versionId;
    let deliveryFormat: string | undefined;
    let isDerivative = false;
    let derivativeOrigin: Record<string, any> | undefined;

    if (requestedFormat === 'pdf') {
      const anno = await S3Manager.getAnnotation(doc.document_class, documentId, versionId);
      const originalContentType = anno.metadata.content_type || 'application/octet-stream';

      if (isConvertibleToPdf(originalContentType)) {
        const derivResult = await S3Manager.getOrCreatePdfDerivative(doc.document_class, s3Key, {
          documentId,
          sourceVersionId: versionId,
          sourceChecksum: anno.metadata.content_checksum || '',
          sourceContentType: originalContentType,
          applicationVersion: appVersion,
        });
        targetKey = derivResult.derivativeKey;
        targetVersionId = undefined;
        deliveryFormat = 'application/pdf';
        isDerivative = true;
        derivativeOrigin = {
          source_content_type: originalContentType,
          source_s3_version_id: versionId,
          source_content_checksum: anno.metadata.content_checksum || '',
          converted_at: new Date().toISOString(),
          format: 'pdf',
          page_count: derivResult.pageCount,
        };
      } else if (originalContentType === 'application/pdf') {
        deliveryFormat = 'application/pdf';
        isDerivative = false;
      } else {
        throw new ValidationError(
          `Format conversion to PDF is only supported for JPEG and PNG images, and MS Word (DOCX) documents (current content_type: ${originalContentType})`
        );
      }
    }

    if (event.queryStringParameters?.direct === 'true') {
      const fileData = await S3Manager.getObjectBuffer(targetKey, targetVersionId);
      if (fileData.body.length <= 5 * 1024 * 1024) {
        const outFormat = deliveryFormat || fileData.contentType || 'application/octet-stream';
        const rawFilename = (doc as any).filename || `document_${documentId}`;
        const finalFilename = isDerivative && !rawFilename.toLowerCase().endsWith('.pdf')
          ? `${rawFilename.replace(/\.[^.]+$/, '')}.pdf`
          : rawFilename;
        return {
          statusCode: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': outFormat,
            'Content-Disposition': `inline; filename="${finalFilename}"`,
          },
          isBase64Encoded: true,
          body: fileData.body.toString('base64'),
        };
      }
    }

    const downloadUrl = await S3Manager.generatePresignedDownloadUrl(targetKey, targetVersionId, 900);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        document_id: documentId,
        s3_version_id: versionId,
        download_url: downloadUrl,
        ...(deliveryFormat ? { delivery_format: deliveryFormat } : {}),
        is_derivative: isDerivative,
        ...(derivativeOrigin ? { derivative_origin: derivativeOrigin } : {}),
        expires_at: new Date(Date.now() + 900 * 1000).toISOString(),
      }),
    };
  } catch (err: any) {
    if (err instanceof PlatformError) {
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
          message: 'An unexpected internal error occurred',
          correlation_id: correlationId,
          retryable: true,
        },
      }),
    };
  }
}
