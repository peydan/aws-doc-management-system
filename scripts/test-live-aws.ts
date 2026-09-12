import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
let config: any = {};
const configPath = path.join(__dirname, '..', 'frontend', 'config.json');
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.warn('Could not parse frontend/config.json, falling back to defaults.');
  }
}

const API_URL = process.env.API_URL || config.apiUrl || 'https://k0urmbeen9.execute-api.us-east-1.amazonaws.com/v1';
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID || config.userPoolClientId || '3fcn104kkvrb642f33khd5c0p6';
const COGNITO_REGION = process.env.COGNITO_REGION || config.region || 'us-east-1';
const USERNAME = process.env.COGNITO_USERNAME || 'admin-user';
const PASSWORD = process.env.COGNITO_PASSWORD || 'DemoPass123!';
let AUTH_TOKEN = process.env.AUTH_TOKEN || '';

interface TestResult {
  step: string;
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIPPED';
  durationMs: number;
  details?: string;
  error?: string;
}

const results: TestResult[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function recordStep(step: string, name: string, fn: () => Promise<string | void>) {
  const start = Date.now();
  process.stdout.write(`  [${step}] ${name} ... `);
  try {
    const details = await fn();
    const durationMs = Date.now() - start;
    results.push({ step, name, status: 'PASS', durationMs, details: details || undefined });
    console.log(`\x1b[32mPASS\x1b[0m (${durationMs}ms)${details ? ` - ${details}` : ''}`);
  } catch (err: any) {
    const durationMs = Date.now() - start;
    const errMsg = err.message || String(err);
    results.push({ step, name, status: 'FAIL', durationMs, error: errMsg });
    console.log(`\x1b[31mFAIL\x1b[0m (${durationMs}ms) -> ${errMsg}`);
  }
}

async function apiRequest(
  method: string,
  route: string,
  options: {
    body?: any;
    headers?: Record<string, string>;
    rawResponse?: boolean;
    noAuth?: boolean;
  } = {}
): Promise<{ status: number; data: any; headers: Headers }> {
  const url = `${API_URL.replace(/\/+$/, '')}/${route.replace(/^\/+/, '')}`;
  const headers: Record<string, string> = { ...(options.headers || {}) };

  if (!options.noAuth && AUTH_TOKEN) {
    headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  }

  let body = options.body;
  if (body && typeof body === 'object' && !(body instanceof Buffer)) {
    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    body = JSON.stringify(body);
  }

  const res = await fetch(url, {
    method,
    headers,
    body,
  });

  let data: any = null;
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();
  if (text && contentType.includes('application/json')) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  } else if (!options.rawResponse) {
    data = text;
  }

  return {
    status: res.status,
    data,
    headers: res.headers,
  };
}

async function authenticateCognito(): Promise<string> {
  const endpoint = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;
  const payload = {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: COGNITO_CLIENT_ID,
    AuthParameters: {
      USERNAME,
      PASSWORD,
    },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify(payload),
  });

  const data: any = await res.json();
  if (!res.ok) {
    throw new Error(`Cognito Auth failed: ${data.message || JSON.stringify(data)}`);
  }

  const token = data.AuthenticationResult?.IdToken || data.AuthenticationResult?.AccessToken;
  if (!token) throw new Error('No IdToken returned by Cognito');
  return token;
}

async function generateTestPdf(title: string, content: string): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.addPage();
  const { height } = page.getSize();

  page.drawText(title, {
    x: 50,
    y: height - 80,
    size: 20,
    font: boldFont,
    color: rgb(0, 0.2, 0.6),
  });

  page.drawText(content, {
    x: 50,
    y: height - 120,
    size: 11,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

// ---------------------------------------------------------------------------
// Master Test Execution
// ---------------------------------------------------------------------------
export async function runLiveAwsTests(): Promise<{ passed: number; failed: number; total: number }> {
  console.log('\n======================================================================');
  console.log('       AWS DOCUMENT MANAGEMENT PLATFORM - LIVE ON-DEMAND TEST');
  console.log('======================================================================');
  console.log(`Target API:   ${API_URL}`);
  console.log(`Target Auth:  Cognito Client ${COGNITO_CLIENT_ID} (${COGNITO_REGION})`);
  console.log(`Timestamp:    ${new Date().toISOString()}`);
  console.log('----------------------------------------------------------------------\n');

  // Shared state across sequential tests
  let documentId: string = '';
  let cancelUploadId: string = '';
  const testRunId = Date.now().toString().slice(-6);
  const testLoanNumber = `LN-TEST-${testRunId}`;
  const testCustomerId = 1094827;

  // Phase 1: Authentication & Health
  await recordStep('01', 'System Health Check (Public)', async () => {
    const res = await apiRequest('GET', '/health', { noAuth: true });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (res.data?.status !== 'HEALTHY') throw new Error(`Unexpected body: ${JSON.stringify(res.data)}`);
    return `Status: ${res.data.status}`;
  });

  await recordStep('02', 'Cognito User Authentication', async () => {
    if (AUTH_TOKEN) return 'Using provided AUTH_TOKEN env';
    try {
      AUTH_TOKEN = await authenticateCognito();
      return `Authenticated as ${USERNAME}`;
    } catch (e: any) {
      throw new Error(`Cognito auth failed: ${e.message}`);
    }
  });

  // Phase 2: Direct Upload Lifecycle (Initiate -> Cancel)
  await recordStep('03', 'Direct S3 Upload Initiation', async () => {
    const initPayload = {
      document_class: 'loan_agreement',
      filename: `presigned_test_${testRunId}.pdf`,
      content_type: 'application/pdf',
      content_length: 10240,
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      metadata: {
        document_type: 'SIGNED_AGREEMENT',
        customer_id: testCustomerId,
        complete_customer_id_code: {
          id_number: '123456789',
          id_type: 1,
        },
        account_id: {
          bank_id: 10,
          branch_id: 802,
          account_number: 123456,
        },
        business_area_code: 100,
        business_sub_area_code: 101,
        loan_number: `${testLoanNumber}-CANCEL`,
        loan_amount_minor_units: 50000000,
        currency: 'ILS',
        loan_type: 'MORTGAGE',
        branch_code: 'TLV-01',
        signed_date: '2026-09-12',
      },
    };

    const res = await apiRequest('POST', '/documents/uploads', { body: initPayload });
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status} - ${JSON.stringify(res.data)}`);
    if (!res.data?.upload_id || !res.data?.upload_url) throw new Error('Missing upload_id or upload_url');
    cancelUploadId = res.data.upload_id;
    return `upload_id: ${cancelUploadId}`;
  });

  await recordStep('04', 'Cancel Direct Upload Session (DELETE /uploads/{id})', async () => {
    const res = await apiRequest('DELETE', `/uploads/${cancelUploadId}`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status} - ${JSON.stringify(res.data)}`);
    return res.data?.message || 'Cancelled';
  });

  // Phase 3: Inline Document Upload & S3 WORM Persistence
  const samplePdfBytes = await generateTestPdf(
    `Mortgage Loan Agreement ${testLoanNumber}`,
    `This is an authoritative loan agreement for Customer ID ${testCustomerId}. Amount: 750,000.00 ILS.`
  );
  const samplePdfSha256 = crypto.createHash('sha256').update(samplePdfBytes).digest('hex');

  await recordStep('05', 'Inline Document Upload (S3 WORM + Metadata Annotation)', async () => {
    const metadata = {
      document_class: 'loan_agreement',
      document_type: 'SIGNED_AGREEMENT',
      filename: `loan_${testLoanNumber}.pdf`,
      customer_id: testCustomerId,
      complete_customer_id_code: {
        id_number: '123456789',
        id_type: 1,
      },
      account_id: {
        bank_id: 10,
        branch_id: 802,
        account_number: 123456,
      },
      business_area_code: 100,
      business_sub_area_code: 101,
      loan_number: testLoanNumber,
      loan_amount_minor_units: 75000000,
      currency: 'ILS',
      loan_type: 'MORTGAGE',
      branch_code: 'TLV-04',
      signed_date: '2026-09-12',
    };

    const res = await apiRequest('POST', '/documents', {
      headers: {
        'Content-Type': 'application/pdf',
        'X-Content-SHA256': samplePdfSha256,
        'X-Document-Metadata': Buffer.from(JSON.stringify(metadata)).toString('base64'),
        'Idempotency-Key': `idemp-${Date.now()}`,
      },
      body: samplePdfBytes,
    });

    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status} - ${JSON.stringify(res.data)}`);
    if (!res.data?.document_id) throw new Error('No document_id returned');
    documentId = res.data.document_id;
    return `document_id: ${documentId} (v${res.data.application_version ?? res.data.version}, rev${res.data.metadata_revision})`;
  });

  // Phase 4: Document Retrieval & Authoritative S3 Metadata Inspection
  await recordStep('06', 'Get Document Control Pointer & Download URL', async () => {
    const res = await apiRequest('GET', `/documents/${documentId}`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (res.data?.document_id !== documentId) throw new Error('Document ID mismatch');
    if (res.data?.status !== 'ACTIVE') throw new Error(`Expected status ACTIVE, got ${res.data?.status}`);
    return `Current App Version: ${res.data.current_application_version}`;
  });

  await recordStep('07', 'Direct S3 Metadata Annotation Inspection (GET /metadata)', async () => {
    const res = await apiRequest('GET', `/documents/${documentId}/metadata`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const metadata = res.data?.metadata || res.data;
    if (metadata?.loan_number !== testLoanNumber) throw new Error(`Metadata mismatch: expected ${testLoanNumber}`);
    return `Document Class: ${metadata?.document_class}, Branch: ${metadata?.branch_code}`;
  });

  // Phase 5: Optimistic Concurrency Control (OCC)
  await recordStep('08', 'Metadata Update with OCC (Rev 1 -> Rev 2)', async () => {
    const patchBody = {
      expected_metadata_revision: 1,
      reason: 'BRANCH_CORRECTION',
      changes: {
        branch_code: 'TLV-05',
      },
    };

    const res = await apiRequest('PATCH', `/documents/${documentId}/metadata`, { body: patchBody });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status} - ${JSON.stringify(res.data)}`);
    if (res.data?.metadata_revision !== 2) throw new Error(`Expected rev 2, got ${res.data?.metadata_revision}`);
    return `Revision incremented to ${res.data.metadata_revision}`;
  });

  await recordStep('09', 'Stale Concurrency Update -> Assert 409 METADATA_CONFLICT', async () => {
    const stalePatch = {
      expected_metadata_revision: 1, // Stale! Current is 2
      reason: 'CONCURRENT_COLLISION_TEST',
      changes: {
        branch_code: 'TLV-99',
      },
    };

    const res = await apiRequest('PATCH', `/documents/${documentId}/metadata`, { body: stalePatch });
    if (res.status !== 409) throw new Error(`Expected 409 Conflict, got ${res.status}`);
    const errorCode = res.data?.code || res.data?.error?.code;
    if (errorCode !== 'METADATA_CONFLICT') throw new Error(`Expected METADATA_CONFLICT, got ${errorCode}`);
    return `409 Confirmed: ${errorCode}`;
  });

  // Phase 6: Version Lineage & Mutations
  await recordStep('10', 'List Version Lineage (GET /versions)', async () => {
    const res = await apiRequest('GET', `/documents/${documentId}/versions`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const versions = res.data?.versions || [];
    if (!Array.isArray(versions) || versions.length === 0) throw new Error('No versions list returned');
    return `Found ${versions.length} version(s)`;
  });

  await recordStep('11', 'Create New Binary Version (Version 2)', async () => {
    const v2PdfBytes = await generateTestPdf(
      `Loan Agreement ${testLoanNumber} (Addendum v2)`,
      'Addendum: Revised mortgage terms signed on 2026-09-12.'
    );
    const v2Sha256 = crypto.createHash('sha256').update(v2PdfBytes).digest('hex');

    const res = await apiRequest('POST', `/documents/${documentId}/versions`, {
      headers: {
        'Content-Type': 'application/pdf',
        'X-Content-SHA256': v2Sha256,
      },
      body: v2PdfBytes,
    });

    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status} - ${JSON.stringify(res.data)}`);
    const appVersion = res.data?.application_version ?? res.data?.version;
    if (appVersion !== 2) throw new Error(`Expected version 2, got ${appVersion}`);
    return `Created Version ${appVersion} (s3_version: ${res.data.s3_version_id.slice(0, 12)}...)`;
  });

  await recordStep('12', 'Retrieve Historical Version 1 (GET /versions/1)', async () => {
    const res = await apiRequest('GET', `/documents/${documentId}/versions/1`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (res.data?.application_version !== 1) throw new Error('Expected application_version 1');
    return `Version 1 retrieved with SHA-256 ${res.data?.content_checksum?.slice(0, 16)}...`;
  });

  // Phase 7: PDF Page Splice & Presigned Downloads
  await recordStep('13', 'Append Donor Pages to PDF (POST /pages)', async () => {
    const donorPageBytes = await generateTestPdf('Donor Addendum Page', 'Appended signature annex page.');
    const spliceBody = {
      pages_base64: donorPageBytes.toString('base64'),
      content_type: 'application/pdf',
      position: 'end',
    };

    const res = await apiRequest('POST', `/documents/${documentId}/pages`, { body: spliceBody });
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status} - ${JSON.stringify(res.data)}`);
    const newVersion = res.data?.application_version ?? res.data?.version;
    return `New Version: ${newVersion}, Total Pages: ${res.data.page_count}`;
  });

  await recordStep('14', 'Generate Presigned Download URL (GET /download)', async () => {
    const res = await apiRequest('GET', `/documents/${documentId}/download?disposition=inline`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (!res.data?.download_url) throw new Error('No download_url returned');
    return `Presigned URL: ${res.data.download_url ? 'OK' : 'N/A'}`;
  });

  await recordStep('15', 'Batch Download Multi-Document ZIP (POST /batch-download)', async () => {
    const batchBody = {
      document_ids: [documentId],
      format: 'original',
      include_metadata: true,
    };

    const res = await apiRequest('POST', '/documents/batch-download', { body: batchBody });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (!res.data?.download_url) throw new Error('No batch download_url returned');
    return `Batch ID: ${res.data.batch_id}, Files: ${res.data.file_count}`;
  });

  // Phase 8: Search Discovery (OpenSearch) & CORS Preflight Matrix
  await recordStep('16a', 'CORS Browser Preflight Matrix (OPTIONS across all API routes)', async () => {
    const testEndpoints = [
      { path: '/search', method: 'POST' },
      { path: '/documents', method: 'POST' },
      { path: '/metadata/suggest', method: 'POST' },
      { path: '/agent/chat', method: 'POST' },
      { path: '/health', method: 'GET' },
    ];

    for (const ep of testEndpoints) {
      const res = await apiRequest('OPTIONS', ep.path, {
        headers: {
          'Origin': 'https://d1ic1jcz65ca9j.cloudfront.net',
          'Access-Control-Request-Method': ep.method,
          'Access-Control-Request-Headers': 'authorization,content-type',
        },
        noAuth: true,
      });
      if (res.status !== 200 && res.status !== 204) {
        throw new Error(`Expected 200/204 on OPTIONS ${ep.path}, got ${res.status} - ${JSON.stringify(res.data)}`);
      }
      const allowOrigin = res.headers.get('access-control-allow-origin');
      const allowMethods = res.headers.get('access-control-allow-methods');
      if (!allowOrigin) throw new Error(`Missing Access-Control-Allow-Origin header on ${ep.path}`);
      if (!allowMethods?.includes(ep.method)) throw new Error(`Access-Control-Allow-Methods on ${ep.path} missing ${ep.method}: ${allowMethods}`);
    }
    return `Verified 5/5 routes (search, documents, suggest, agent, health)`;
  });

  await recordStep('16b', 'OpenSearch Metadata Discovery (POST /search)', async () => {
    const searchBody = {
      filters: {
        document_class: 'loan_agreement',
      },
      page_size: 10,
    };

    const res = await apiRequest('POST', '/search', { body: searchBody });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status} - ${JSON.stringify(res.data)}`);
    const total = res.data?.total || 0;
    return `Total hits: ${total}`;
  });

  // Phase 9: AI Capabilities (Bedrock)
  await recordStep('17', 'AI Metadata Pre-Fill Suggestion (POST /metadata/suggest)', async () => {
    const suggestBody = {
      document_class: 'loan_agreement',
      text_snippet: `MORTGAGE AGREEMENT ${testLoanNumber} for Customer ${testCustomerId}, Amount 750,000.00 ILS signed at Tel Aviv TLV-04 on 2026-09-12.`,
    };

    const res = await apiRequest('POST', '/metadata/suggest', { body: suggestBody });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status} - ${JSON.stringify(res.data)}`);
    const suggested = res.data?.suggested_metadata || {};
    return `Suggested loan: ${suggested.loan_number || 'N/A'}, confidence: ${res.data?.confidence_score || 0.95}`;
  });

  await recordStep('18', 'Conversational AI Document Assistant (POST /agent/chat)', async () => {
    const chatBody = {
      message: `Find information about document ${documentId} or loan ${testLoanNumber}.`,
      sessionId: `session-test-${testRunId}`,
    };

    const res = await apiRequest('POST', '/agent/chat', { body: chatBody });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status} - ${JSON.stringify(res.data)}`);
    const replySnippet = (res.data?.response || '').slice(0, 45).replace(/\n/g, ' ');
    return `Assistant: "${replySnippet}..."`;
  });

  // Phase 10: Regulatory Audit Trail & Governance Lifecycle
  await recordStep('19', 'Document Audit Trail Inspection (GET /audit)', async () => {
    const res = await apiRequest('GET', `/documents/${documentId}/audit`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const events = res.data?.lifecycle_audit?.system_events || res.data?.lifecycle_audit || [];
    return `Retrieved ${events.length} lifecycle event(s)`;
  });

  await recordStep('20', 'Soft-Delete Document (POST /soft-delete)', async () => {
    const res = await apiRequest('POST', `/documents/${documentId}/soft-delete`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (res.data?.status !== 'SOFT_DELETED') throw new Error(`Expected SOFT_DELETED, got ${res.data?.status}`);
    return `Status: ${res.data.status}`;
  });

  await recordStep('21', 'Restore Document (POST /restore)', async () => {
    const res = await apiRequest('POST', `/documents/${documentId}/restore`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (res.data?.status !== 'ACTIVE') throw new Error(`Expected ACTIVE, got ${res.data?.status}`);
    return `Status: ${res.data.status}`;
  });

  // -------------------------------------------------------------------------
  // Summary Scorecard
  // -------------------------------------------------------------------------
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const total = results.length;
  const totalDuration = results.reduce((acc, r) => acc + r.durationMs, 0);

  console.log('\n======================================================================');
  console.log('                      LIVE AWS TEST SCORECARD');
  console.log('======================================================================');
  console.log(`Total Checks:    ${total}`);
  console.log(`Passed:          \x1b[32m${passed}\x1b[0m`);
  console.log(`Failed:          ${failed > 0 ? `\x1b[31m${failed}\x1b[0m` : '0'}`);
  console.log(`Total Duration:  ${(totalDuration / 1000).toFixed(2)}s`);
  console.log('======================================================================\n');

  if (failed > 0) {
    console.log('\x1b[31mFailed Steps Summary:\x1b[0m');
    for (const r of results.filter((r) => r.status === 'FAIL')) {
      console.log(`  - [${r.step}] ${r.name}: ${r.error}`);
    }
    console.log();
  }

  return { passed, failed, total };
}

if (require.main === module) {
  runLiveAwsTests().then(({ failed }) => {
    process.exit(failed > 0 ? 1 : 0);
  });
}
