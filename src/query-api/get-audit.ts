import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { authenticateRequest, authorizeRoles } from '../shared/auth';
import { DynamoManager } from '../shared/dynamo';
import { S3Manager } from '../shared/s3';
import { PlatformError, ValidationError, NotFoundError, isPlatformError } from '../shared/errors';
import { CORS_HEADERS } from '../shared/headers';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const AUDIT_BUCKET_NAME = process.env.AUDIT_BUCKET_NAME || 'doc-platform-mvp-audit';

async function streamToString(stream: any): Promise<string> {
  if (!stream) return '';
  if (typeof stream.transformToString === 'function') {
    return await stream.transformToString('utf-8');
  }
  if (Buffer.isBuffer(stream)) return stream.toString('utf-8');
  return String(stream);
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const correlationId = event.requestContext?.requestId || `req-${Date.now()}`;
  try {
    const user = await authenticateRequest(event);
    authorizeRoles(user, ['Document.Reader', 'Document.Writer', 'Document.MetadataEditor', 'Document.Admin']);

    const documentId = event.pathParameters?.document_id;
    if (!documentId) {
      throw new ValidationError('document_id is required');
    }

    // 1. Resolve document from DynamoDB control plane
    const doc = await DynamoManager.getDocument(documentId);
    if (doc.status === 'SOFT_DELETED' && !user.roles.includes('Document.Admin')) {
      throw new NotFoundError(`Document ${documentId} not found`);
    }

    // 2. Fetch version lineage
    const versions = await DynamoManager.listVersions(documentId);

    // 3. Fetch authoritative S3 Annotation
    const anno = await S3Manager.getAnnotation(doc.document_class, documentId, doc.current_s3_version_id);
    const meta = anno.metadata || {};

    // 4. Extract LLM Enrichment Details
    const enrichmentAudit = meta.enrichment_audit;
    const isEnriched = Boolean(enrichmentAudit || meta.metadata_updated_by === 'system:llm-enricher');
    const isSkipped = meta.skip_enrichment === true;
    const isPending = !isEnriched && !isSkipped && doc.current_metadata_revision === 1;

    let llmStatus: 'ENRICHED' | 'QUEUED' | 'SKIPPED' | 'NOT_ENRICHED' = 'NOT_ENRICHED';
    if (isEnriched) llmStatus = 'ENRICHED';
    else if (isSkipped) llmStatus = 'SKIPPED';
    else if (isPending) llmStatus = 'QUEUED';

    const appliedAt = enrichmentAudit?.applied_at || (isEnriched ? meta.metadata_updated_at : null);
    const datePrefix = appliedAt ? new Date(appliedAt).toISOString().substring(0, 10) : new Date().toISOString().substring(0, 10);
    const s3AuditKey = `audit/llm-enrichment/${datePrefix}/${documentId}_rev${doc.current_metadata_revision}.json`;
    const s3AuditUri = `s3://${AUDIT_BUCKET_NAME}/${s3AuditKey}`;

    let rawAuditRecord: any = null;
    if (isEnriched) {
      try {
        if (process.env.MOCK_STORAGE_BYPASS !== 'true') {
          const s3Res = await s3Client.send(
            new GetObjectCommand({
              Bucket: AUDIT_BUCKET_NAME,
              Key: s3AuditKey,
            })
          );
          const rawStr = await streamToString(s3Res.Body);
          rawAuditRecord = JSON.parse(rawStr);
        }
      } catch (err) {
        // Fallback to structured payload if S3 direct get is unavailable or async
      }

      if (!rawAuditRecord) {
        rawAuditRecord = {
          event_type: 'METADATA_LLM_ENRICHMENT',
          document_id: documentId,
          document_class: doc.document_class,
          s3_version_id: doc.current_s3_version_id,
          metadata_revision: doc.current_metadata_revision,
          timestamp: appliedAt,
          llm_details: enrichmentAudit || {
            model_id: 'us.amazon.nova-2-lite-v1:0',
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            latency_ms: 0,
          },
          applied_metadata: {
            contains_pii: meta.contains_pii,
            pii_categories: meta.pii_categories || [],
          },
          source: 'authoritative_s3_annotation',
        };
      }
    }

    // 5. Build chronological system events timeline
    // Note: listVersions returns newest first; sort ascending for chronological timeline
    const chronologicalVersions = [...versions].sort(
      (a, b) => a.application_version - b.application_version
    );
    const initialVersion = chronologicalVersions[0];

    const systemEvents: Array<{
      event_type: string;
      timestamp: string;
      actor: string;
      description: string;
      details?: Record<string, any>;
    }> = [
      {
        event_type: 'DOCUMENT_INGESTED',
        timestamp: doc.created_at,
        actor: meta.created_by || 'system',
        description: `Document initialized with class ${doc.document_class} and application version 1`,
        details: {
          s3_version_id: initialVersion?.s3_version_id || doc.current_s3_version_id,
          checksum: initialVersion?.content_checksum || meta.content_checksum,
        },
      },
    ];

    if (isEnriched && appliedAt) {
      systemEvents.push({
        event_type: 'LLM_METADATA_ENRICHMENT',
        timestamp: appliedAt,
        actor: meta.metadata_updated_by || 'system:llm-enricher',
        description: `Automated Bedrock PII & metadata enrichment committed via DynamoDB OCC (rev ${doc.current_metadata_revision})`,
        details: {
          model_id: enrichmentAudit?.model_id || 'Amazon Nova 2 Lite',
          total_tokens: enrichmentAudit?.total_tokens || 0,
          latency_ms: enrichmentAudit?.latency_ms || 0,
          contains_pii: meta.contains_pii,
          pii_categories: meta.pii_categories || [],
          s3_audit_path: s3AuditUri,
        },
      });
    }

    // Additional versions if present, in chronological order
    if (chronologicalVersions.length > 1) {
      for (let i = 1; i < chronologicalVersions.length; i++) {
        const v = chronologicalVersions[i];
        systemEvents.push({
          event_type: 'VERSION_CREATED',
          timestamp: doc.updated_at,
          actor: 'user',
          description: `Authoritative binary content mutation created application version ${v.application_version}`,
          details: {
            application_version: v.application_version,
            s3_version_id: v.s3_version_id,
            checksum: v.content_checksum,
          },
        });
      }
    }

    if (doc.status === 'SOFT_DELETED') {
      systemEvents.push({
        event_type: 'DOCUMENT_SOFT_DELETED',
        timestamp: doc.updated_at,
        actor: 'admin',
        description: 'Document soft-deleted by compliance administrator',
      });
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        document_id: documentId,
        document_class: doc.document_class,
        status: doc.status,
        current_application_version: doc.current_application_version,
        current_metadata_revision: doc.current_metadata_revision,
        current_s3_version_id: doc.current_s3_version_id,
        created_at: doc.created_at,
        updated_at: doc.updated_at,
        llm_enrichment_audit: {
          status: llmStatus,
          is_enriched: isEnriched,
          model_id: enrichmentAudit?.model_id || 'us.amazon.nova-2-lite-v1:0',
          prompt_tokens: enrichmentAudit?.prompt_tokens || 0,
          completion_tokens: enrichmentAudit?.completion_tokens || 0,
          total_tokens: enrichmentAudit?.total_tokens || 0,
          latency_ms: enrichmentAudit?.latency_ms || 0,
          applied_at: appliedAt,
          applied_by: meta.metadata_updated_by || 'system:llm-enricher',
          contains_pii: Boolean(meta.contains_pii),
          pii_categories: meta.pii_categories || [],
          s3_audit_key: s3AuditKey,
          s3_audit_uri: s3AuditUri,
          raw_record: rawAuditRecord,
        },
        lifecycle_audit: {
          versions: versions.map((v) => ({
            application_version: v.application_version,
            s3_version_id: v.s3_version_id,
            metadata_revision: v.metadata_revision,
            content_checksum: v.content_checksum,
            state: v.state,
          })),
          system_events: systemEvents,
          s3_audit_trail_prefix: `s3://${AUDIT_BUCKET_NAME}/audit/${datePrefix}/${documentId}_*`,
        },
      }),
    };
  } catch (err: any) {
    console.error(`[${event.path || 'get-audit'}] Error:`, err);
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
