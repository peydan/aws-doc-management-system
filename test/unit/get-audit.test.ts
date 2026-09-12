import { handler as getAuditHandler } from '../../src/query-api/get-audit';
import { DynamoManager } from '../../src/shared/dynamo';
import { S3Manager } from '../../src/shared/s3';

describe('Document Audit & LLM Inspection Query API', () => {
  const documentClass = 'loan_agreement';
  const enrichedDocId = 'doc-audit-enriched-001';
  const nonEnrichedDocId = 'doc-audit-plain-002';

  beforeAll(async () => {
    process.env.MOCK_STORAGE_BYPASS = 'true';
    process.env.MOCK_AUTH_BYPASS = 'true';

    // 1. Seed Enriched Document with Bedrock Audit
    await DynamoManager.commitDocumentCreation({
      documentId: enrichedDocId,
      documentClass: documentClass,
      s3Key: `documents/${documentClass}/${enrichedDocId}`,
      s3VersionId: 's3-ver-enriched-1',
      annotationEtag: 'etag-enriched-1',
      checksum: 'sha256:enriched1234',
    });

    await S3Manager.putAnnotation(documentClass, enrichedDocId, 's3-ver-enriched-1', {
      annotation_schema: 'bank.document-metadata/1',
      document_id: enrichedDocId,
      document_class: documentClass,
      content_type: 'application/pdf',
      content_checksum: 'sha256:enriched1234',
      application_version: 1,
      metadata_revision: 2,
      metadata_updated_by: 'system:llm-enricher',
      contains_pii: true,
      pii_categories: ['NATIONAL_ID', 'FINANCIAL_HISTORY'],
      enrichment_audit: {
        model_id: 'us.amazon.nova-2-lite-v1:0',
        prompt_tokens: 1450,
        completion_tokens: 280,
        total_tokens: 1730,
        latency_ms: 1120,
        applied_at: '2026-09-11T09:40:00.000Z',
      },
    });

    // 2. Seed Plain Document (Not enriched)
    await DynamoManager.commitDocumentCreation({
      documentId: nonEnrichedDocId,
      documentClass: documentClass,
      s3Key: `documents/${documentClass}/${nonEnrichedDocId}`,
      s3VersionId: 's3-ver-plain-1',
      annotationEtag: 'etag-plain-1',
      checksum: 'sha256:plain1234',
    });

    await S3Manager.putAnnotation(documentClass, nonEnrichedDocId, 's3-ver-plain-1', {
      annotation_schema: 'bank.document-metadata/1',
      document_id: nonEnrichedDocId,
      document_class: documentClass,
      content_type: 'application/pdf',
      content_checksum: 'sha256:plain1234',
      application_version: 1,
      metadata_revision: 1,
      skip_enrichment: true,
    });
  });

  const createMockEvent = (docId?: string) => ({
    headers: { Authorization: 'Bearer mock-token' },
    pathParameters: docId ? { document_id: docId } : {},
    requestContext: { requestId: 'req-mock-123' },
  } as any);

  it('should return 400 when document_id is missing', async () => {
    const res = await getAuditHandler(createMockEvent());
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 404 for non-existent document', async () => {
    const res = await getAuditHandler(createMockEvent('non-existent-doc-id'));
    expect(res.statusCode).toBe(404);
  });

  it('should return 200 with LLM enrichment and lifecycle audit for enriched document', async () => {
    const res = await getAuditHandler(createMockEvent(enrichedDocId));
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.document_id).toBe(enrichedDocId);
    expect(body.document_class).toBe(documentClass);

    // LLM Enrichment section
    expect(body.llm_enrichment_audit).toBeDefined();
    expect(body.llm_enrichment_audit.status).toBe('ENRICHED');
    expect(body.llm_enrichment_audit.is_enriched).toBe(true);
    expect(body.llm_enrichment_audit.model_id).toBe('us.amazon.nova-2-lite-v1:0');
    expect(body.llm_enrichment_audit.total_tokens).toBe(1730);
    expect(body.llm_enrichment_audit.prompt_tokens).toBe(1450);
    expect(body.llm_enrichment_audit.completion_tokens).toBe(280);
    expect(body.llm_enrichment_audit.latency_ms).toBe(1120);
    expect(body.llm_enrichment_audit.contains_pii).toBe(true);
    expect(body.llm_enrichment_audit.pii_categories).toEqual(['NATIONAL_ID', 'FINANCIAL_HISTORY']);
    expect(body.llm_enrichment_audit.s3_audit_key).toContain('audit/llm-enrichment/');
    expect(body.llm_enrichment_audit.raw_record).toBeDefined();

    // Lifecycle section
    expect(body.lifecycle_audit).toBeDefined();
    expect(body.lifecycle_audit.versions.length).toBeGreaterThanOrEqual(1);
    expect(body.lifecycle_audit.system_events.length).toBeGreaterThanOrEqual(2);
    expect(body.lifecycle_audit.system_events[0].event_type).toBe('DOCUMENT_INGESTED');
    expect(body.lifecycle_audit.system_events[1].event_type).toBe('LLM_METADATA_ENRICHMENT');
  });

  it('should handle document with skip_enrichment correctly', async () => {
    const res = await getAuditHandler(createMockEvent(nonEnrichedDocId));
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.llm_enrichment_audit.status).toBe('SKIPPED');
    expect(body.llm_enrichment_audit.is_enriched).toBe(false);
  });

  it('should maintain chronological event timeline attributing v1 to DOCUMENT_INGESTED and v2 to VERSION_CREATED', async () => {
    const multiVersionDocId = 'doc-audit-multi-003';

    // 1. Commit Version 1 creation
    await DynamoManager.commitDocumentCreation({
      documentId: multiVersionDocId,
      documentClass: documentClass,
      s3Key: `documents/${documentClass}/${multiVersionDocId}`,
      s3VersionId: 's3-ver-baseline-v1',
      annotationEtag: 'etag-multi-1',
      checksum: 'sha256:v1checksum1111',
    });

    await S3Manager.putAnnotation(documentClass, multiVersionDocId, 's3-ver-baseline-v1', {
      annotation_schema: 'bank.document-metadata/1',
      document_id: multiVersionDocId,
      document_class: documentClass,
      content_type: 'application/pdf',
      content_checksum: 'sha256:v1checksum1111',
      application_version: 1,
      metadata_revision: 1,
      skip_enrichment: true,
    });

    // 2. Commit Version 2 creation
    await DynamoManager.commitNewVersion({
      documentId: multiVersionDocId,
      nextAppVersion: 2,
      expectedAppVersion: 1,
      s3Key: `documents/${documentClass}/${multiVersionDocId}`,
      s3VersionId: 's3-ver-mutation-v2',
      annotationEtag: 'etag-multi-2',
      checksum: 'sha256:v2checksum2222',
    });

    await S3Manager.putAnnotation(documentClass, multiVersionDocId, 's3-ver-mutation-v2', {
      annotation_schema: 'bank.document-metadata/1',
      document_id: multiVersionDocId,
      document_class: documentClass,
      content_type: 'application/pdf',
      content_checksum: 'sha256:v2checksum2222',
      application_version: 2,
      metadata_revision: 1,
      skip_enrichment: true,
    });

    const res = await getAuditHandler(createMockEvent(multiVersionDocId));
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    const systemEvents = body.lifecycle_audit.system_events;

    // DOCUMENT_INGESTED must baseline to version 1, NOT version 2
    expect(systemEvents[0].event_type).toBe('DOCUMENT_INGESTED');
    expect(systemEvents[0].details.s3_version_id).toBe('s3-ver-baseline-v1');
    expect(systemEvents[0].details.checksum).toBe('sha256:v1checksum1111');

    // Subsequent event is VERSION_CREATED for version 2
    expect(systemEvents[1].event_type).toBe('VERSION_CREATED');
    expect(systemEvents[1].details.application_version).toBe(2);
    expect(systemEvents[1].details.s3_version_id).toBe('s3-ver-mutation-v2');
    expect(systemEvents[1].details.checksum).toBe('sha256:v2checksum2222');
  });
});
