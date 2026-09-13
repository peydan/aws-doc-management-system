---
name: on-demand-testing
description: On-demand, zero-cost testing guidelines, commands, and verification protocols for the AWS Document Management Platform. Use when running integration tests against live AWS, testing the web portal UI, auditing CloudWatch logs, or updating the Postman collection.
---

# AWS Document Management Platform - On-Demand Testing Skill

This skill defines the **On-Demand Testing Architecture**, **Execution Commands**, and **Quality Assurance Protocols** for the AWS Document Management Platform.

---

## 1. Core Architectural Invariant: Zero Recurring Cloud Cost

> [!IMPORTANT]
> **Proof of Concept (POC) Cost Guardrail:**
> Never provision billable 24/7 standing test resources in AWS.
> - **DO NOT** deploy continuous CloudWatch Synthetics Canaries (which incur monthly fees for 24/7 runs and Lambda/S3 storage).
> - **DO NOT** create paid continuous CloudWatch metric alarms or log subscription filters.
> - All tests, browser automations, and CloudWatch audits must execute strictly **on-demand** from the developer machine or CI/CD runner.

---

## 2. Master Command Cheat Sheet

| Command | Target | Description | Standing Cost |
|---|---|---|:---:|
| `npm run test:complete` | **All Layers** | Orchestrates Live AWS API + React UI + CloudWatch in one unified run. | **$0** |
| `npm run test:aws` | **Live AWS API** | Standalone runner validating 21 sequential capabilities against deployed AWS infrastructure. | **$0** |
| `npm run test:ui` | **React 18 Portal UI** | Headless 10-step verification of React 18 bundles, tabs, OCC, WebCrypto & CloudFront. | **$0** |
| `npm run review:cloudwatch` | **Observability** | On-demand scan of recent Lambda logs and API Gateway metrics via AWS SigV4. | **$0** |
| `npm run test:postman` | **API Regression** | Executes `postman_collection.json` with Newman CLI and automated `pm.test` assertions. | **$0** |
| `npm test` | **Unit Mocks** | Executes 17 local Jest test suites (155 tests) with AWS SDK mocks. | **$0** |
| `npm run build` | **Type & Schema Build**| Re-generates OpenSearch mappings and frontend templates, followed by `tsc`. | **$0** |

---

## 3. Configuration & Credential Resolution

All on-demand test scripts automatically read deployment settings from `frontend-react/public/config.json`:
- `apiUrl`: Live API Gateway endpoint (e.g., `https://k0urmbeen9.execute-api.us-east-1.amazonaws.com/v1`).
- `userPoolClientId`: Amazon Cognito Client ID.
- `region`: AWS deployment region (e.g., `us-east-1` or `il-central-1`).

### Authentication Precedence:
1. Environment Variable `AUTH_TOKEN`: If provided, the scripts immediately use this JWT ID token.
2. Cognito `USER_PASSWORD_AUTH`: Otherwise, the test runner calls `InitiateAuth` against the Cognito User Pool using:
   - `COGNITO_USERNAME` (default: `admin-user`)
   - `COGNITO_PASSWORD` (default: `DemoPass123!`)

---

## 4. Sample Document Governance

To ensure tests are repeatable, isolated, and safe:

### A. Pre-Built Static Sample Documents (`sample_pdfs/`)
Use these files for manual web portal testing or drag-and-drop verification:
- `loan_agreement-sample.pdf`: Schema-compliant mortgage agreement.
- `compliance_retention-sample.pdf`: SOX 7-year retention financial ledger.
- `security_classification-sample.pdf`: High-confidentiality governance record with PII.

### B. Dynamic On-the-Fly Test Generation (Zero Collision Rule)
When executing automated integration tests (`scripts/test-live-aws.ts`):
- **Never hardcode static loan numbers or document IDs.**
- Use `pdf-lib` to stamp a dynamic UUID/timestamp (e.g., `LN-TEST-${Date.now().toString().slice(-6)}`) into the binary text and metadata.
- This guarantees that every test execution runs against fresh, unique records and never collides with historical records in OpenSearch or DynamoDB.
- Generate temporary in-memory buffers for large files (> 4 MiB) to test direct S3 presigned PUT uploads without committing heavy binaries to Git.

---

## 5. What the Complete Test Verifies (`npm run test:complete`)

### Phase 1: Live AWS Backend Capabilities (`scripts/test-live-aws.ts`)
1. **Health Check**: `GET /health` returns `200` with `status: "HEALTHY"`.
2. **Cognito Auth**: `InitiateAuth` yields valid JWT ID Token.
3. **Direct Upload Lifecycle**:
   - `POST /documents/uploads`: Generates session and presigned S3 PUT URL.
   - `DELETE /uploads/{id}`: Aborts session and deletes staging S3 object.
4. **Inline WORM Ingestion**: `POST /documents` with SHA-256 validation, writing S3 WORM binary and native S3 Object Annotation (`document-metadata`).
5. **Control Pointer & S3 Annotation**:
   - `GET /documents/{id}`: Resolves DynamoDB pointer and downloads URL.
   - `GET /documents/{id}/metadata`: Direct inspection of S3 annotation.
6. **Optimistic Concurrency Control (OCC)**:
   - `PATCH /documents/{id}/metadata`: Bumps revision 1 $\rightarrow$ 2.
   - Stale update with revision 1: Asserts `409 Conflict` with `code: "METADATA_CONFLICT"`.
7. **Version Lineage**:
   - `GET /documents/{id}/versions`: Lists chronological `VER#` records.
   - `POST /documents/{id}/versions`: Creates Version 2.
   - `GET /documents/{id}/versions/1`: Retrieves historical Version 1 snapshot.
8. **PDF Page Splicing**: `POST /documents/{id}/pages` appends donor pages and produces a new versioned S3 object.
9. **Presigned Downloads**: `GET /documents/{id}/download` generates 15-minute presigned GET URL.
10. **Batch Export**: `POST /documents/batch-download` bundles documents into a ZIP archive with `manifest.json`.
11. **OpenSearch Discovery**: `POST /search` validates asynchronous indexing.
12. **Amazon Bedrock AI**:
    - `POST /metadata/suggest`: Validates metadata attribute pre-fill.
    - `POST /agent/chat`: Validates conversational assistant with MCP tool dispatch.
13. **Compliance Audit Trail**: `GET /documents/{id}/audit` retrieves lifecycle timeline and LLM telemetry.
14. **Soft-Delete & Restore**: `POST /soft-delete` (status `SOFT_DELETED`) and `POST /restore` (status `ACTIVE`).

### Phase 2: Web Portal Headless UI (`test/e2e/ui-test.ts`)
1. Core assets integrity (`index.html`, `app.js`, `generated-templates.js`, `styles.css`).
2. Authentication gate (`view-login`, credentials input, and `view-app`).
3. Navigation tabs matrix (all 10 workspace tabs verified).
4. Upload studios (direct S3 presigned dropzone, AI pre-fill banner).
5. WebCrypto SHA-256 calculation (cryptographically verified against sample PDF).
6. Dynamic schema form generator for all 3 classes.
7. OpenSearch Explorer & batch selection toolbar.
8. OCC concurrency conflict simulation (`simulateConflict()` triggering HTTP 409 toast).
9. Conversational AI Assistant drawer & SSE streaming integration.
10. Regulatory Audit Trail inspector view.

### Phase 3: CloudWatch Telemetry Review (`scripts/review-cloudwatch.ts`)
1. Scans recent log streams across platform Lambda log groups for `ERROR` or `Exception`.
2. Queries CloudWatch metrics for API Gateway `5XXError`, `4XXError`, request count, and latency.

---

## 6. Feature Evolution Checklist for AI Agents

Whenever adding a new API endpoint, schema trait, or UI feature:
1. **Update Domain Schema:** Add property to `schemas/*.json` (with default or `"x-immutable": true`).
2. **Re-Generate Artifacts:** Run `npm run generate` to sync OpenSearch mappings and UI templates.
3. **Update Live AWS Test:** Add step to `scripts/test-live-aws.ts`.
4. **Update Postman Collection:** Add request and `pm.test` assertions to `postman_collection.json`.
5. **Update UI Test:** Add selector/flow verification to `test/e2e/ui-test.ts`.
6. **Update Catalog:** Document new capability and role permissions in `SYSTEM_CAPABILITIES.md`.
7. **Verify Suite:** Execute `npm run test:complete` and `npm test` to assert zero regressions.
