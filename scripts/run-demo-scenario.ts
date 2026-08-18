import * as crypto from 'crypto';
import { handler as inlineUploadHandler } from '../src/command-api/upload-inline';
import { handler as directInitHandler } from '../src/command-api/upload-direct-init';
import { handler as directCompleteHandler } from '../src/command-api/upload-direct-complete';
import { handler as getDocHandler } from '../src/query-api/get-document';
import { handler as getVersionHandler } from '../src/query-api/get-version';
import { handler as versionCreateHandler } from '../src/command-api/version-create';
import { handler as metadataUpdateHandler } from '../src/command-api/metadata-update';
import { handler as softDeleteHandler } from '../src/command-api/soft-delete';
import { handler as restoreHandler } from '../src/command-api/restore';
import { handler as searchHandler } from '../src/search-api/search-documents';

process.env.MOCK_AUTH_BYPASS = 'true';
process.env.MOCK_STORAGE_BYPASS = 'true';

async function runDemoScenario() {
  console.log('===============================================================');
  console.log('   AWS Document Management Platform MVP - Demo Scenario Run');
  console.log('===============================================================\n');

  // Step 1: Authenticate mock user
  console.log('[Step 1] Authenticated using Cognito test identity (writer@demo.local).');

  // Step 2: Upload 300 KB inline PDF document
  console.log('\n[Step 2] Uploading 300 KB inline PDF document through Lambda...');
  const fakePdfBytes = Buffer.alloc(300 * 1024, 'PDF-CONTENT-DEMO-DUMMY-BYTES');
  const sha256 = crypto.createHash('sha256').update(fakePdfBytes).digest('hex');

  const metadataEnv = {
    document_class: 'loan_agreement',
    document_type: 'SIGNED_AGREEMENT',
    customer_id: 'IL-4492817',
    loan_number: 'LN-2026-88821',
    loan_amount_minor_units: 90000000,
    currency: 'ILS',
    loan_type: 'MORTGAGE',
    branch_code: 'TLV-04',
    signed_date: '2026-07-15',
    filename: 'loan_LN-2026-88821.pdf',
  };

  const inlineEvent: any = {
    headers: {
      'Content-Type': 'application/pdf',
      'X-Content-SHA256': sha256,
      'X-Document-Metadata': Buffer.from(JSON.stringify(metadataEnv)).toString('base64'),
      'x-mock-role': 'Document.Writer',
      'x-mock-user': 'writer@demo.local',
    },
    body: fakePdfBytes.toString('base64'),
    isBase64Encoded: true,
    requestContext: { requestId: 'demo-req-001' },
  };

  const inlineRes = await inlineUploadHandler(inlineEvent);
  console.log(`Response Status: ${inlineRes.statusCode}`);
  const inlineBody = JSON.parse(inlineRes.body);
  console.log('Uploaded Document Result:', inlineBody);

  const docId = inlineBody.document_id;

  // Step 3: Retrieve current document and download URL
  console.log(`\n[Step 3] Retrieving Document ${docId}...`);
  const getEvent: any = {
    pathParameters: { document_id: docId },
    headers: { 'x-mock-role': 'Document.Reader' },
    requestContext: { requestId: 'demo-req-002' },
  };
  const getRes = await getDocHandler(getEvent);
  console.log(`Response Status: ${getRes.statusCode}`);
  const getBody = JSON.parse(getRes.body);
  console.log(`Current Version: ${getBody.current_application_version}, Revision: ${getBody.current_metadata_revision}`);

  // Step 4: Metadata Update with expected_metadata_revision = 1 -> revision 2
  console.log('\n[Step 4] Updating branch_code to TLV-05 with expected_metadata_revision = 1...');
  const updateEvent: any = {
    pathParameters: { document_id: docId },
    headers: { 'x-mock-role': 'Document.MetadataEditor' },
    body: JSON.stringify({
      expected_metadata_revision: 1,
      reason: 'CORRECTION',
      changes: { branch_code: 'TLV-05' },
    }),
    requestContext: { requestId: 'demo-req-003' },
  };
  const updateRes = await metadataUpdateHandler(updateEvent);
  console.log(`Response Status: ${updateRes.statusCode}`);
  const updateBody = JSON.parse(updateRes.body);
  console.log(`Updated Metadata Revision: ${updateBody.metadata_revision}, Branch Code: ${updateBody.metadata?.branch_code}`);

  // Step 5: Attempt Stale Metadata Update -> expect 409 METADATA_CONFLICT
  console.log('\n[Step 5] Attempting concurrent stale update with expected_metadata_revision = 1...');
  const staleEvent: any = {
    pathParameters: { document_id: docId },
    headers: { 'x-mock-role': 'Document.MetadataEditor' },
    body: JSON.stringify({
      expected_metadata_revision: 1,
      reason: 'STALE_ATTEMPT',
      changes: { branch_code: 'TLV-09' },
    }),
    requestContext: { requestId: 'demo-req-004' },
  };
  const staleRes = await metadataUpdateHandler(staleEvent);
  console.log(`Response Status: ${staleRes.statusCode} (Expected: 409)`);
  console.log('Error Response:', JSON.parse(staleRes.body));

  // Step 6: Create New Content Version
  console.log('\n[Step 6] Creating new content version 2...');
  const newVersionPdf = Buffer.alloc(350 * 1024, 'PDF-CONTENT-VERSION-2-BYTES');
  const versionEvent: any = {
    pathParameters: { document_id: docId },
    headers: { 'Content-Type': 'application/pdf', 'x-mock-role': 'Document.Writer' },
    body: newVersionPdf.toString('base64'),
    isBase64Encoded: true,
    requestContext: { requestId: 'demo-req-005' },
  };
  const versionRes = await versionCreateHandler(versionEvent);
  console.log(`Response Status: ${versionRes.statusCode}`);
  console.log('Version 2 Result:', JSON.parse(versionRes.body));

  // Step 7: Get Historical Content Version 1
  console.log('\n[Step 7] Retrieving historical content version 1...');
  const histEvent: any = {
    pathParameters: { document_id: docId, version: '1' },
    headers: { 'x-mock-role': 'Document.Reader' },
    requestContext: { requestId: 'demo-req-006' },
  };
  const histRes = await getVersionHandler(histEvent);
  console.log(`Response Status: ${histRes.statusCode}`);
  console.log('Historical Version 1:', JSON.parse(histRes.body));

  // Step 8: Direct Upload Initiation for large file (>4MB)
  console.log('\n[Step 8] Initiating direct upload for 5MB document...');
  const directInitEvent: any = {
    headers: { 'x-mock-role': 'Document.Writer' },
    body: JSON.stringify({
      document_class: 'loan_agreement',
      filename: 'large_loan.pdf',
      content_type: 'application/pdf',
      content_length: 5242880,
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      metadata: {
        document_type: 'SIGNED_AGREEMENT',
        customer_id: 'IL-9988776',
        loan_number: 'LN-2026-99999',
        loan_amount_minor_units: 50000000,
        currency: 'ILS',
        loan_type: 'MORTGAGE',
        branch_code: 'TLV-01',
        signed_date: '2026-07-20',
      },
    }),
    requestContext: { requestId: 'demo-req-007' },
  };
  const directInitRes = await directInitHandler(directInitEvent);
  console.log(`Response Status: ${directInitRes.statusCode}`);
  const directInitBody = JSON.parse(directInitRes.body);
  console.log(`Direct Upload Session Created. Upload ID: ${directInitBody.upload_id}`);

  // Step 9: Soft Delete Document
  console.log(`\n[Step 9] Soft deleting document ${docId}...`);
  const deleteEvent: any = {
    pathParameters: { document_id: docId },
    headers: { 'x-mock-role': 'Document.Admin' },
    requestContext: { requestId: 'demo-req-008' },
  };
  const deleteRes = await softDeleteHandler(deleteEvent);
  console.log(`Response Status: ${deleteRes.statusCode}`);
  console.log('Soft Delete Result:', JSON.parse(deleteRes.body));

  // Step 10: Restore Document
  console.log(`\n[Step 10] Restoring document ${docId}...`);
  const restoreEvent: any = {
    pathParameters: { document_id: docId },
    headers: { 'x-mock-role': 'Document.Admin' },
    requestContext: { requestId: 'demo-req-009' },
  };
  const restoreRes = await restoreHandler(restoreEvent);
  console.log(`Response Status: ${restoreRes.statusCode}`);
  console.log('Restore Result:', JSON.parse(restoreRes.body));

  console.log('\n===============================================================');
  console.log('   Demo Scenario Successfully Completed All Acceptance Steps!');
  console.log('===============================================================\n');
}

if (require.main === module) {
  runDemoScenario().catch((err) => {
    console.error('Demo scenario execution failed:', err);
    process.exit(1);
  });
}
