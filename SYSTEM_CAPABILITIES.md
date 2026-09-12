# 🧭 AWS Cloud-Native Document Management Platform - System Capabilities Catalog

**Document Version:** 1.0.0  
**Target Environment:** AWS Cloud-Native / Serverless  
**API Version:** `v1` (`0.1.1`)  
**Core Authority Specification:** Tri-Partite Source of Truth (S3 WORM, S3 Annotations, DynamoDB Control Plane)

---

## 1. Executive Overview & Architectural Scope

The **AWS Document Management Platform** is an enterprise-grade, cloud-native content and records management system designed for regulated environments (banking, financial services, legal, and compliance). The platform eliminates single-point-of-failure monolithic content servers by leveraging managed, auto-scaling AWS serverless primitives while enforcing a strict **Tri-Partite Authority Model**.

### 1.1 Tri-Partite Authority & Storage Model

The platform strictly delineates state and authority across three discrete AWS datastores:

```
+--------------------------------------------------------------------------------------------------+
| 1. CONTENT AUTHORITY: Amazon S3 Object Versions (WORM, Immutable Binary Store)                   |
|    - Authoritative store for raw binary content (PDF, TIFF, JPEG, PNG, Office).                  |
|    - Every binary modification produces an immutable S3 VersionId.                               |
|    - Application IAM roles are explicitly denied `s3:DeleteObjectVersion` (Write-Once-Read-Many).|
+--------------------------------------------------------------------------------------------------+
| 2. METADATA AUTHORITY: Amazon S3 Object Annotations (`document-metadata`)                        |
|    - Authoritative structured JSON metadata attached directly to the versioned S3 object.        |
|    - Strictly conforms to precompiled Ajv JSON schemas (`bank.document-metadata/<class>/<ver>`).|
|    - Managed via native S3 Annotation APIs (`s3:PutObjectAnnotation`, `s3:GetObjectAnnotation`).|
+--------------------------------------------------------------------------------------------------+
| 3. CONTROL PLANE & CONCURRENCY: Amazon DynamoDB (`doc-platform-mvp-control`)                     |
|    - O(1) active pointer resolution: maps `DOC#{document_id}` to current active S3 version ID.  |
|    - Concurrency coordinator: enforces Optimistic Concurrency Control (`current_metadata_rev`). |
|    - Historical version lineage (`VER#{vNum}`), upload sessions (`UPLOAD#{id}`), and idempotency. |
+--------------------------------------------------------------------------------------------------+
| 4. SEARCH PROJECTION: Amazon OpenSearch Serverless (`documents-v1`)                              |
|    - Asynchronous, derived search read-model populated via DynamoDB Streams + SQS.               |
|    - Never treated as an authoritative datastore. Can be completely rebuilt from DynamoDB & S3. |
+--------------------------------------------------------------------------------------------------+
| 5. DERIVED READ PROJECTIONS: S3 Cached Derivatives (`derivatives/{class}/{id}/{versionId}.pdf`)   |
|    - On-demand, transient format conversions (JPEG/PNG/DOCX to PDF) cached for fast access.      |
|    - Never alters canonical WORM versions or DynamoDB pointers. Origin tracked via S3 user meta. |
+--------------------------------------------------------------------------------------------------+
| 6. TRANSIENT EXPORT PROJECTIONS: S3 Export Archives (`exports/{batch_id}.zip`)                    |
|    - Multi-document ZIP archives created on-demand with audit `manifest.json`.                   |
|    - Delivered via short-lived (15-minute) presigned URLs or direct binary streaming.            |
+--------------------------------------------------------------------------------------------------+
```

---

## 2. Master System Capabilities Matrix

The table below catalogs all capabilities exposed across the platform's API Gateway, Web Management Portal, and Background Workers:

| # | Capability Name | Delivery Channel | Endpoint / Trigger | Minimum Role | Key Mechanics |
|---|---|---|---|---|---|
| **1** | **Operational Health Check** | REST API | `GET /health` | Public (Unauthenticated) | Reports API Gateway and Lambda operational health. |
| **2** | **Inline Document Ingestion** | REST API | `POST /documents` | `Document.Writer` | Ingests binaries up to 4 MiB with SHA-256 validation, Ajv schema verification, S3 WORM storage, and S3 annotation attachment. |
| **3** | **Direct Upload Initiation** | REST API | `POST /documents/uploads` | `Document.Writer` | Initiates two-phase upload for large binaries (up to 5 GiB); creates DynamoDB session with TTL and returns S3 presigned PUT URL. |
| **4** | **Direct Upload Completion** | REST API | `POST /uploads/{upload_id}/complete` | `Document.Writer` | Finalizes upload; verifies S3 object integrity and SHA-256; creates DynamoDB pointer and version record; writes S3 annotation. |
| **5** | **Direct Upload Cancellation** | REST API | `DELETE /uploads/{upload_id}` | `Document.Writer` | Aborts pending upload; deletes staging S3 object; removes DynamoDB upload session record. |
| **6** | **Document Control & Pointer Resolution** | REST API | `GET /documents/{document_id}` | `Document.Reader` | Resolves active document state via DynamoDB O(1) lookup and retrieves authoritative metadata from latest S3 annotation. |
| **7** | **Version Lineage Listing** | REST API | `GET /documents/{document_id}/versions` | `Document.Reader` | Lists complete, chronological, immutable version history (`VER#{application_version}`) from DynamoDB. |
| **8** | **New Binary Version Creation** | REST API | `POST /documents/{document_id}/versions` | `Document.Writer` | Ingests modified binary; writes new immutable S3 version; atomically increments `application_version` via DynamoDB OCC. |
| **9** | **PDF Page Splicing & Insertion** | REST API | `POST /documents/{document_id}/pages` | `Document.Writer` | Appends, prepends, or inserts donor PDF pages; updates page count; produces new authoritative S3 WORM version. |
| **10** | **Specific Version Metadata Retrieval** | REST API | `GET /documents/{document_id}/versions/{version}` | `Document.Reader` | Fetches historical metadata and binary characteristics bound to a specific historical S3 version. |
| **11** | **Authoritative Metadata Inspection** | REST API | `GET /documents/{document_id}/metadata` | `Document.Reader` | Fetches authoritative JSON metadata directly from the native S3 Object Annotation (`document-metadata`). |
| **12** | **Metadata Update with Optimistic Concurrency** | REST API | `PATCH /documents/{document_id}/metadata` | `Document.MetadataEditor` | Applies partial/full metadata updates; validates with Ajv; enforces DynamoDB OCC revision lock; updates S3 annotation. |
| **13** | **Presigned Binary Download & On-Demand Conversion** | REST API | `GET /documents/{document_id}/download` | `Document.Reader` | Generates 15-min presigned S3 download URL; on-demand converts non-PDF formats to PDF and caches under `derivatives/`. |
| **14** | **Batch Multi-Document ZIP Export** | REST API | `POST /documents/batch-download` | `Document.Reader` | Bundles multiple documents into a ZIP archive with audit `manifest.json` and optional metadata; serves via presigned URL or direct stream. |
| **15** | **Logical Document Soft Delete** | REST API | `POST /documents/{document_id}/soft-delete` | `Document.Admin` | Marks document pointer as `SOFT_DELETED`; preserves all immutable S3 WORM binaries; removes from search index. |
| **16** | **Document Restoration** | REST API | `POST /documents/{document_id}/restore` | `Document.Admin` | Restores soft-deleted document back to `ACTIVE` state; re-indexes into OpenSearch Serverless. |
| **17** | **Multi-Attribute & Full-Text Search** | REST API | `POST /search` & `GET /search` | `Document.Reader` | Executes high-performance search across OpenSearch Serverless with field filtering, ranges, pagination, and text matching. |
| **18** | **Real-Time Asynchronous Search Indexing** | Background Event Pipeline | DynamoDB Streams | System / Lambda | Captures DynamoDB mutations; buffers via Amazon SQS; indexes documents asynchronously into OpenSearch Serverless. |
| **19** | **Automated Fault Tolerance & DLQ** | Background Pipeline | SQS Dead Letter Queue | System / CloudWatch | Isolates failing index events after 3 retries; triggers CloudWatch Alarms for immediate operator intervention. |
| **20** | **Regulatory Audit Trail Ingestion** | Background Event Pipeline | DynamoDB Streams | System / S3 | Streams all document mutations and control plane changes to a dedicated S3 Audit Trail Bucket for long-term compliance. |
| **21** | **Automated Consistency Reconciliation** | Scheduled Background Worker | EventBridge Rule (Hourly) | System / Lambda | Scans DynamoDB control pointers and heals any eventual consistency discrepancies in OpenSearch Serverless. |
| **22** | **Interactive Web Management Portal** | Frontend UI | CloudFront CDN + S3 SPA | All Personas | Single-page application for document searching, direct uploading, metadata editing, version viewing, and batch downloading. |
| **23** | **Cognito Persona Role Simulation** | Frontend UI | In-Browser Header Injection | Developer / Tester | 1-click persona switcher simulating `Reader`, `Writer`, `MetadataEditor`, and `Admin` JWT claims. |
| **24** | **In-Browser Client-Side SHA-256 Calculation** | Frontend UI | Web Crypto API | All Personas | Generates client-side SHA-256 hashes prior to upload for end-to-end cryptographic integrity verification. |
| **25** | **Dynamic Multi-Tenant Schema Validation** | Core Engine | Precompiled Ajv Schemas | Internal / API | Validates structured metadata against domain schemas (`loan_agreement`, `compliance_retention`, `security_classification`). |
| **26** | **Automated LLM Metadata & PII Enrichment** | Background Event Pipeline | SQS Enrichment Queue | System / Bedrock | Asynchronously extracts domain metadata and discovers PII via Amazon Bedrock (Amazon Nova 2 Lite - `us.amazon.nova-2-lite-v1:0`); applies non-downgrade safety ratchet; commits revision bump via DynamoDB OCC; persists compliance audit trail in S3. |
| **27** | **AI Conversational Document Assistant** | REST API & Function URL | `POST /agent/chat` & SSE URL | `Document.Reader` | Managed conversational reasoning via Amazon Bedrock AgentCore Harness and Amazon Nova 2 Lite (`us.amazon.nova-2-lite-v1:0`); invokes MCP tools (`search_documents`, `fetch_document`); ephemeral 1-hour session memory; real-time progress and token streaming. |
| **28** | **Document Audit Trail & LLM Inspection** | REST API & Frontend UI | `GET /documents/{document_id}/audit` | `Document.Reader` | Unified document-specific audit trail combining Amazon Bedrock LLM enrichment metrics (model, prompt/completion tokens, latency, PII safety ratchets, S3 compliance URI) and server-side lifecycle mutations from DynamoDB & S3 WORM audit bucket. |
| **29** | **AI-Assisted Metadata Pre-Fill for UI** | REST API & Frontend UI | `POST /metadata/suggest` | `Document.Reader` | Stateless pre-upload AI metadata extraction from document excerpt or file bytes via Amazon Bedrock (Amazon Nova 2 Lite - `us.amazon.nova-2-lite-v1:0`); partitions extracted attributes into shared banking and class-specific traits; auto-populates web console inputs prior to immutable persistence. |
| **30** | **On-Demand End-to-End Test Suite & CloudWatch Audit** | Developer CLI & CI/CD | `npm run test:complete` | Developer / Admin | Zero-cost, on-demand automated verification executing live AWS API validation across all 29 capabilities, headless Web Portal UI testing, and on-demand CloudWatch log/error review without standing cloud charges. |

---

## 3. Detailed REST API Capabilities Catalog

### 3.1 Ingestion & Upload Operations

#### Capability: Inline Document Upload
- **Method & Route:** `POST /documents`
- **Operation ID:** `uploadInlineDocument`
- **Required Role:** `Document.Writer` or `Document.Admin`
- **Payload Limit:** Up to 4 MiB (API Gateway payload constraint)
- **Headers:**
  - `Content-Type`: Binary MIME type (`application/pdf`, `image/jpeg`, `image/tiff`, `application/octet-stream`).
  - `X-Document-Metadata`: Raw or Base64-encoded JSON metadata object conforming to the target document class schema.
  - `X-Content-SHA256`: Hex-encoded SHA-256 hash of the binary payload.
  - `Idempotency-Key` *(Optional)*: UUIDv4 to guarantee mutation idempotency.
- **Execution Flow:**
  1. Validates JWT and asserts `Document.Writer` or `Document.Admin`.
  2. Evaluates idempotency lock in DynamoDB (`IDEMP#{client_id}#{idemp_key}`).
  3. Computes SHA-256 checksum over binary bytes and verifies exact match with `X-Content-SHA256`.
  4. Validates metadata against precompiled Ajv schema.
  5. Automatically extracts page count if payload is a PDF.
  6. Writes binary directly to Amazon S3 canonical key `documents/{document_class}/{document_id}.{ext}` creating `S3 VersionId`.
  7. Attaches authoritative `document-metadata` S3 Object Annotation to the versioned S3 object.
  8. Conditionally creates `DOC#{document_id}` pointer and `VER#1` lineage record in DynamoDB.
- **Status Responses:** `201 Created`, `400 Validation Error`, `401 Unauthorized`, `403 Forbidden`, `409 Conflict`, `413 Payload Too Large`.

#### Capability: Two-Phase Direct S3 Upload (Large Files up to 5 GiB)
Consists of three coordinated operations designed to bypass API Gateway payload limits:

##### Step 1: Direct Upload Initiation (`POST /documents/uploads`)
- **Operation ID:** `initiateDirectUpload`
- **Required Role:** `Document.Writer` or `Document.Admin`
- **Request Body:**
  ```json
  {
    "document_class": "loan_agreement",
    "filename": "mortgage_contract_large.pdf",
    "content_type": "application/pdf",
    "content_length": 52428800,
    "content_checksum": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "metadata": { ... }
  }
  ```
- **Execution Flow:**
  1. Pre-validates metadata schema using Ajv.
  2. Creates staging S3 key: `uploads/{upload_id}/{filename}`.
  3. Generates S3 Presigned PUT URL with 15-minute expiration and required SHA-256 header.
  4. Records `UPLOAD#{upload_id}` session in DynamoDB with `INITIATED` status and 24-hour TTL (`ttl_expiry`).
- **Response:** Returns `upload_id`, `document_id`, `upload_url`, `expires_at`, and `required_headers`.

##### Step 2: Direct Binary Upload to S3 (Client-to-S3)
- The client streams binary bytes directly to Amazon S3 via `PUT {upload_url}` with progress tracking.

##### Step 3: Direct Upload Completion (`POST /uploads/{upload_id}/complete`)
- **Operation ID:** `completeDirectUpload`
- **Required Role:** `Document.Writer` or `Document.Admin`
- **Execution Flow:**
  1. Reads `UPLOAD#{upload_id}` session from DynamoDB; verifies state is `INITIATED`.
  2. Issues `s3:HeadObject` on staging key to verify upload completion and byte size.
  3. Verifies S3 SHA-256 checksum against initiated session checksum.
  4. Copies/promotes staging object to canonical location `documents/{document_class}/{document_id}.{ext}` producing canonical `S3 VersionId`.
  5. Attaches authoritative `document-metadata` S3 Object Annotation.
  6. Atomically creates `DOC#{document_id}` pointer and `VER#1` lineage record in DynamoDB.
  7. Cleans up staging S3 object and marks upload session `COMPLETED`.
- **Status Responses:** `201 Created`, `400 Checksum Mismatch`, `404 Upload Session Not Found`.

##### Step 4: Upload Cancellation (`DELETE /uploads/{upload_id}`)
- **Operation ID:** `cancelDirectUpload`
- **Required Role:** `Document.Writer` or `Document.Admin`
- **Execution Flow:** Aborts the session, deletes staging S3 object, and marks DynamoDB session `ABORTED`.

---

### 3.2 Document Query & Retrieval Operations

#### Capability: Get Document Pointer & Active State
- **Method & Route:** `GET /documents/{document_id}`
- **Operation ID:** `getDocument`
- **Required Role:** `Document.Reader`
- **Execution Flow:**
  1. Performs O(1) read from DynamoDB table for `pk = DOC#{document_id}`, `sk = METADATA`.
  2. If status is `SOFT_DELETED`, returns 404 (unless queried by Admin with specific flags).
  3. Fetches authoritative metadata from versioned S3 Object Annotation (`document-metadata`) using `current_s3_version_id`.
  4. Returns consolidated response including logical document pointers, current versions, and full metadata payload.

#### Capability: List Version Lineage
- **Method & Route:** `GET /documents/{document_id}/versions`
- **Operation ID:** `listDocumentVersions`
- **Required Role:** `Document.Reader`
- **Execution Flow:**
  1. Queries DynamoDB for partition `pk = DOC#{document_id}` with `sk begins_with VER#`.
  2. Returns an array of immutable version snapshots sorted by `application_version` descending, detailing `s3_version_id`, `checksum`, `created_at`, `created_by`, `content_length`, and `format`.

#### Capability: Get Specific Version Details
- **Method & Route:** `GET /documents/{document_id}/versions/{version}`
- **Operation ID:** `getDocumentVersion`
- **Required Role:** `Document.Reader`
- **Parameters:** `version` (Integer, >= 1).
- **Execution Flow:**
  1. Queries DynamoDB for `pk = DOC#{document_id}`, `sk = VER#{version}` to retrieve the immutable `s3_version_id`.
  2. Fetches historical metadata from S3 Object Version Annotation (`s3:GetObjectVersionAnnotation`).
  3. Returns version metadata snapshot exactly as it existed at the time of creation.

#### Capability: Authoritative Metadata Retrieval
- **Method & Route:** `GET /documents/{document_id}/metadata`
- **Operation ID:** `getDocumentMetadata`
- **Required Role:** `Document.Reader`
- **Execution Flow:** Direct retrieval of the authoritative `document-metadata` JSON annotation from S3.

#### Capability: Presigned Binary Download & On-Demand Conversion
- **Method & Route:** `GET /documents/{document_id}/download`
- **Operation ID:** `getDocumentDownloadUrl`
- **Required Role:** `Document.Reader`
- **Query Parameters:**
  - `version` *(Optional)*: Specific integer version to download (defaults to current version).
  - `format` *(Optional)*: Delivery format request (`pdf` or `original`).
  - `disposition` *(Optional)*: `inline` (browser preview) or `attachment` (download prompt).
- **Execution Flow:**
  1. Resolves document pointer and active `s3_version_id` from DynamoDB.
  2. If `format=pdf` is requested and the source file is an image (JPEG, PNG, TIFF) or document (DOCX):
     - Checks S3 cache under `derivatives/{document_class}/{document_id}/{s3_version_id}.pdf`.
     - If not cached, dynamically converts source binary to PDF, extracts page count, and writes to `derivatives/` partition with origin S3 metadata tags (`x-amz-meta-*`).
     - Generates 15-minute presigned GET URL pointing to the derivative PDF.
  3. Otherwise, generates 15-minute presigned GET URL pointing directly to the canonical WORM version in S3.
- **Response:** Returns JSON containing `download_url`, `expires_in: 900`, `content_type`, `filename`, `is_derivative: boolean`.

#### Capability: Document Audit Trail & LLM Inspection
- **Method & Route:** `GET /documents/{document_id}/audit`
- **Operation ID:** `getDocumentAudit`
- **Required Role:** `Document.Reader`
- **Execution Flow:**
  1. Resolves document pointer and active S3 version ID from DynamoDB (`DOC#{id}`).
  2. Fetches immutable version lineage records from DynamoDB (`sk` begins with `VER#`).
  3. Retrieves authoritative S3 Object Annotation (`document-metadata`) from S3 primary bucket.
  4. Inspects Amazon Bedrock LLM enrichment audit (`enrichment_audit`), extracting model ID, prompt/completion/total token counts, latency ms, PII detection status, and safety ratchet categories.
  5. Deterministically resolves and streams compliance records from the immutable S3 Audit Bucket (`audit/llm-enrichment/YYYY-MM-DD/{id}_rev{rev}.json`).
  6. Synthesizes a chronological lifecycle event timeline (`DOCUMENT_INGESTED`, `LLM_METADATA_ENRICHMENT`, `VERSION_CREATED`, `DOCUMENT_SOFT_DELETED`).
- **Response:** Returns dual-kind audit JSON structure separating `llm_enrichment_audit` and `lifecycle_audit`.

#### Capability: Multi-Document Batch Download (ZIP Archive)
- **Method & Route:** `POST /documents/batch-download`
- **Operation ID:** `batchDownloadDocuments`
- **Required Role:** `Document.Reader`
- **Parameters:** `?direct=true` (Query param or `Accept: application/zip` header).
- **Request Body:**
  ```json
  {
    "items": [
      { "document_id": "8f3b1a20-4c5e-4b6a-9d8e-1f2a3b4c5d6e" },
      { "document_id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d", "version": 2 }
    ],
    "format": "original",
    "include_metadata": true
  }
  ```
- **Execution Flow:**
  1. Validates document list (maximum 50 documents per batch).
  2. Iterates through requested documents, fetching binary streams from S3.
  3. Dynamically compiles a ZIP archive in memory containing:
     - All resolved document binaries with sanitized filenames.
     - Optional individual JSON metadata files (`{filename}.metadata.json`).
     - Cryptographic audit `manifest.json` detailing SHA-256 hashes, sizes, version numbers, export timestamp, and requesting user.
  4. If `direct=true` and total archive size <= 5 MiB: Returns direct binary ZIP stream (`Content-Type: application/zip`).
  5. Otherwise: Stores ZIP archive under transient S3 partition `exports/{batch_id}.zip` and returns a 15-minute presigned download URL.

---

### 3.3 Mutation, Versioning & Modification Operations

#### Capability: New Binary Version Creation
- **Method & Route:** `POST /documents/{document_id}/versions`
- **Operation ID:** `createDocumentVersion`
- **Required Role:** `Document.Writer` or `Document.Admin`
- **Headers:** `Content-Type`, `X-Content-SHA256`, `X-Document-Metadata` (Optional modified metadata).
- **Execution Flow:**
  1. Validates that existing document is not `SOFT_DELETED`.
  2. Verifies SHA-256 of new binary bytes.
  3. Uploads new binary to canonical S3 key, generating a new `S3 VersionId`.
  4. Prepares new metadata snapshot with incremented `application_version = current_version + 1`.
  5. Attaches new authoritative S3 Object Version Annotation.
  6. Atomically updates DynamoDB pointer using OCC condition `current_application_version = :expected_version`.
  7. Inserts new immutable `VER#{new_version}` record in DynamoDB.
- **Status Responses:** `201 Created`, `409 Version Conflict`.

#### Capability: PDF Page Splicing & Content Insertion
- **Method & Route:** `POST /documents/{document_id}/pages`
- **Operation ID:** `addDocumentPages`
- **Required Role:** `Document.Writer` or `Document.Admin`
- **Request Body:**
  ```json
  {
    "position": "append",
    "donor_document_id": "optional-existing-doc-id",
    "donor_binary_base64": "optional-base64-pdf-or-image-bytes",
    "target_page": 1
  }
  ```
- **Execution Flow:**
  1. Retrieves active canonical binary from S3 for `document_id`.
  2. Converts donor content to PDF if submitted as an image or Office document.
  3. Uses `pdf-lib` to execute page-level manipulation in memory:
     - `append`: Appends donor pages to the end of the document.
     - `prepend`: Inserts donor pages at the beginning of the document.
     - `insert`: Splices donor pages at specified `target_page` index.
  4. Recalculates exact PDF page count, content size, and new SHA-256 checksum.
  5. Uploads resulting PDF to canonical S3 key creating a new `S3 VersionId`.
  6. Attaches updated authoritative S3 Annotation with updated `page_count` and `content_checksum`.
  7. Atomically increments DynamoDB `current_application_version` and records `VER#{new_v}`.
- **Status Responses:** `201 Created`, `400 Invalid Page Position`, `409 OCC Conflict`.

#### Capability: Metadata Modification with Optimistic Concurrency Control (OCC)
- **Method & Route:** `PATCH /documents/{document_id}/metadata`
- **Operation ID:** `updateDocumentMetadata`
- **Required Role:** `Document.MetadataEditor` or `Document.Admin`
- **Request Body:**
  ```json
  {
    "expected_revision": 2,
    "metadata": {
      "loan_amount_minor_units": 95000000,
      "branch_code": "TLV-02"
    }
  }
  ```
- **Execution Flow:**
  1. Validates user clearance role and document active status.
  2. Fetches existing authoritative metadata from S3 Annotation on `current_s3_version_id`.
  3. Merges patch into existing metadata while preserving immutable system traits (`document_id`, `application_version`, `created_at`).
  4. Validates merged object against precompiled Ajv schema.
  5. Executes atomic conditional update on DynamoDB pointer:
     ```
     ConditionExpression: "current_metadata_revision = :expected_revision"
     UpdateExpression: "SET current_metadata_revision = current_metadata_revision + 1"
     ```
  6. If condition fails, aborts immediately with `409 Concurrency Conflict`.
  7. If condition succeeds, writes updated authoritative JSON annotation to the versioned S3 object.
- **Status Responses:** `200 OK`, `400 Schema Validation Error`, `409 Concurrency Conflict`.

---

### 3.4 Governance, Lifecycle & Discovery Operations

#### Capability: Logical Document Soft-Delete
- **Method & Route:** `POST /documents/{document_id}/soft-delete`
- **Operation ID:** `softDeleteDocument`
- **Required Role:** `Document.Admin`
- **Execution Flow:**
  1. Atomically updates DynamoDB pointer: sets `status = 'SOFT_DELETED'`, records `tombstone_timestamp` and `deleted_by`.
  2. WORM binary versions and S3 annotations remain strictly preserved and untouched in Amazon S3.
  3. DynamoDB Stream emits `MODIFY` event, triggering asynchronous worker to remove or flag document in OpenSearch Serverless.
- **Status Responses:** `200 OK`, `404 Not Found`.

#### Capability: Document Restoration
- **Method & Route:** `POST /documents/{document_id}/restore`
- **Operation ID:** `restoreDocument`
- **Required Role:** `Document.Admin`
- **Execution Flow:**
  1. Validates document is currently `SOFT_DELETED`.
  2. Atomically updates DynamoDB pointer: sets `status = 'ACTIVE'` and clears tombstone markers.
  3. DynamoDB Stream emits `MODIFY` event, triggering background re-indexing into OpenSearch Serverless.
- **Status Responses:** `200 OK`, `400 Document Already Active`.

#### Capability: Multi-Attribute & Full-Text Search
- **Method & Route:** `POST /search` and `GET /search`
- **Operation ID:** `searchDocuments`
- **Required Role:** `Document.Reader`
- **Request Body / Query Params:**
  ```json
  {
    "document_class": "loan_agreement",
    "customer_id": 1094827,
    "status": "ACTIVE",
    "loan_amount_min": 50000000,
    "loan_amount_max": 100000000,
    "created_after": "2026-01-01T00:00:00Z",
    "query": "mortgage",
    "page": 1,
    "page_size": 25,
    "sort_by": "created_at",
    "sort_order": "desc"
  }
  ```
- **Execution Flow:**
  1. Translates request parameters into an OpenSearch Serverless compound boolean query (`bool` with `filter`, `must`, `range`).
  2. Automatically injects `status: ACTIVE` unless caller is `Document.Admin`.
  3. Executes query against `documents-v1` OpenSearch collection.
  4. Returns paginated results with total hits, score, and indexed metadata attributes.

### 3.6 AI & Conversational Assistant Operations

#### Capability: AI Conversational Document Assistant (AgentCore Harness + Amazon Nova 2 Lite)
- **Method & Route:** `POST /agent/chat` (REST API) & Lambda Function URL (`RESPONSE_STREAM` SSE)
- **Operation ID:** `chatWithDocumentAssistant`
- **Required Role:** `Document.Reader`
- **Foundation Model:** Amazon Nova 2 Lite (`us.amazon.nova-2-lite-v1:0` via Amazon Bedrock) with 1 Million token context window and adaptive thinking.
- **Request Body:**
  ```json
  {
    "message": "Find the signed loan agreements for customer 998877 in 2026 and tell me the total loan amount.",
    "sessionId": "b8f041cb-7df4-44aa-8f69-d977a4192b0c"
  }
  ```
- **Execution Flow:**
  1. **Authentication & Session Lookup**: Authenticates Cognito JWT; initializes or resumes an ephemeral session (1-hour TTL keyed by `sessionId`).
  2. **On-Behalf-Of (OBO) Identity Propagation & MCP Tool Dispatch**:
     - The user's authenticated identity (`sub`, `roles`) is propagated into downstream tool execution contexts, ensuring the agent acts strictly on behalf of the caller rather than with a shared privileged service identity.
     - **Tool 1 (`search_documents`)**: Queries OpenSearch Serverless `documents-v1` and applies defense-in-depth filtering: candidate documents exceeding the caller's role clearance (`minimum_clearance_role`) or classified as `HIGHLY_CONFIDENTIAL` / `RESTRICTED` are filtered out for unprivileged users.
     - **Tool 2 (`fetch_document`)**: Resolves DynamoDB pointer, verifies `ACTIVE` status (warns on `SOFT_DELETED`), fetches authoritative S3 metadata annotation, and asserts that caller holds the required `minimum_clearance_role` and confidentiality clearance before returning content or generating presigned download URLs. If clearance is insufficient, returns an explicit `ACCESS DENIED (OBO Clearance Policy)` denial.
  3. **Grounded Synthesis & Citation**: Ingests document context, formats currency in major units while verifying integer minor units, cites exact `document_id` and `application_version`, and outputs answer.
  4. **Streaming & Response Delivery**: Emits real-time Server-Sent Events (`notifications/progress`, `tool_call`, `tool_result`, `text_delta`, `done`) over Lambda Function URL or returns structured JSON over REST API.

---

## 4. Dynamic Multi-Tenant Schema Validation & Domain Taxonomies

The platform enforces schema validation at ingestion and mutation time using precompiled, zero-cold-start **Ajv** validators.

### 4.1 Shared Banking Traits (Inherited by All Document Classes)
Every document in the system inherits and validates against the shared enterprise banking schema (`shared_document_metadata-v1.json`):

| Property Name | Type | Rules & Constraints | Description |
|---|---|---|---|
| `customer_id` | Integer | `>= 0` | Core Banking Customer Number (`CUSTOMER_ID NUMBER(10)`). |
| `complete_customer_id_code` | Object | Required properties: `id_number`, `id_type` | Compound Customer ID Code (`COMPLEATE_CUSTOMER_ID_CODE`). |
| `complete_customer_id_code.id_number` | String | Max 16 characters | National ID / Passport Number (`ID_Number VARCHAR2(16)`). |
| `complete_customer_id_code.id_type` | Integer | ID Type code | National identity classification code (`ID_Type NUMBER(10)`). |
| `account_id` | Object | Required: `bank_id`, `branch_id`, `account_number` | Compound Bank Account identifier (`ACCOUNT_ID`). |
| `account_id.bank_id` | Integer | Positive integer | Bank Institution Code (`ACCOUNT_BANK_ID NUMBER(10)`). |
| `account_id.branch_id` | Integer | Positive integer | Bank Branch Code (`BRANCH_ID NUMBER(10)`). |
| `account_id.account_number` | Integer | Positive integer | Customer Account Number (`ACCOUNT_NBR NUMBER(10)`). |
| `account_subscription_num` | Integer | `>= 0` | Account Subscription Number (`NUMBER(10)`). |
| `transaction_id` | String | Max 64 characters | Transaction / Box Identifier. |
| `document_int` | String | Max 64 characters | Documentum (DCTM) Internal Chronicle Identifier. |
| `document_ext` | String | Max 40 characters | Legacy External System Chronicle Identifier. |
| `a_content_type` | String | Max 32 characters | Legacy Documentum MIME / content type format. |
| `format` | String | `pdf`, `jpeg`, `png`, `docx`, `tiff` | Normalized binary format identifier. |
| `page_count` | Integer | `>= 1` | Verified page count for PDF documents. |
| `document_form_id` | String | Max 10 characters | Standard bank form template identifier. |
| `legacy_document_entry_dttm`| String | ISO 8601 UTC | Original legacy DCTM ingestion timestamp. |
| `business_area_code` | Integer | `>= 0` | Business Area Code (`NUMBER(10)`). |
| `business_sub_area_code` | Integer | `>= 0` | Business Sub-Area Code (`NUMBER(10)`). |
| `document_group_id` | String | Max 40 characters | Envelope / Document Package Group ID. |

---

### 4.2 Document Class Taxonomies

#### 1. Loan Agreement (`loan_agreement`)
- **Document Types:** `SIGNED_AGREEMENT`, `APPLICATION`, `DISCLOSURE`, `PROMISSORY_NOTE`.
- **Specialized Traits:**
  - `loan_number` (`string`): Unique loan account reference (e.g. `LN-2026-88821`).
  - `loan_amount_minor_units` (`integer`, `>= 0`): **Monetary value strictly in minor units (cents / agorot)**. Floating-point numbers are rejected.
  - `currency` (`string`): 3-letter ISO 4217 currency code (`ILS`, `USD`, `EUR`).
  - `loan_type` (`string`): Enum: `MORTGAGE`, `PERSONAL`, `COMMERCIAL`, `AUTO`.
  - `branch_code` (`string`): Originating branch code (e.g. `TLV-04`).
  - `signed_date` (`string`): Date formatted as `YYYY-MM-DD`.

#### 2. Compliance & Retention (`compliance_retention`)
- **Document Types:** `STATUTORY_RECORD`, `FINANCIAL_LEDGER`, `AUDIT_EVIDENCE`, `CONTRACT_ARCHIVE`, `COMMUNICATION_LOG`.
- **Specialized Traits:**
  - `retention_schedule_code` (`string`): Regulatory retention schedule identifier (e.g. `RET-FIN-001`).
  - `retention_period_years` (`integer`, `>= 0`): Mandatory retention duration.
  - `regulatory_framework` (`string`): Enum: `SOX`, `GDPR`, `BASEL_III`, `HIPAA`, `LOCAL_BANKING_REG`.
  - `retention_start_date` / `retention_expiry_date` (`string`): Dates formatted as `YYYY-MM-DD`.
  - `legal_hold_active` (`boolean`): If true, blocks deletion/purging regardless of expiry.
  - `disposal_action` (`string`): Enum: `PERMANENT_DELETE`, `ARCHIVE_GLACIER`, `REVIEW_REQUIRED`.
  - `compliance_officer_id` (`string`): Identifier of overseeing compliance officer.

#### 3. Security Classification (`security_classification`)
- **Document Types:** `CUSTOMER_RECORD`, `INTERNAL_MEMO`, `BOARD_RESOLUTION`, `FINANCIAL_FORECAST`, `SECURITY_ASSESSMENT`.
- **Specialized Traits:**
  - `confidentiality_tier` (`string`): Enum: `PUBLIC`, `INTERNAL`, `RESTRICTED`, `HIGHLY_CONFIDENTIAL`.
  - `contains_pii` (`boolean`): Flags presence of Personally Identifiable Information.
  - `pii_categories` (`array[string]`): Categories present (`NATIONAL_ID`, `FINANCIAL_ACCOUNT`, `BIOMETRIC`).
  - `minimum_clearance_role` (`string`): Minimum RBAC role required to view (`Document.Reader`, `Document.Admin`).
  - `encryption_requirement` (`string`): Enum: `SSE_S3`, `SSE_KMS_CUSTOMER_MANAGED`.
  - `export_restricted` (`boolean`): Enforces boundary export restrictions.
  - `classification_owner` (`string`): Authorizing department or officer.

---

## 5. Web Management Portal Capabilities (`frontend/`)

The platform delivers an enterprise Single-Page Application (SPA) hosted serverlessly on **Amazon CloudFront + Amazon S3**:

```
+----------------------------------------------------------------------------------------------------+
|                         ENTERPRISE WEB MANAGEMENT PORTAL (SPA)                                     |
+----------------------------------------------------------------------------------------------------+
| [Persona Selector] (Reader | Writer | MetadataEditor | Admin)  [Live API Gateway Status: HEALTHY]   |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  +-------------------------------------+  +-----------------------------------------------------+  |
|  |       DIRECT S3 UPLOAD STUDIO       |  |             OPENSEARCH DISCOVERY EXPLORER           |  |
|  | - Drag-and-Drop / File Picker       |  | - Full-Text Query Box                               |  |
|  | - Client-side WebCrypto SHA-256     |  | - Filters: Class, Status, Customer ID, Date Range   |  |
|  | - Two-Phase Direct-to-S3 Progress   |  | - Faceted Results Table & Sorting                   |  |
|  | - Dynamic JSON Schema Field Inputs  |  | - Multi-Document Selection for Batch ZIP Export     |  |
|  +-------------------------------------+  +-----------------------------------------------------+  |
|                                                                                                    |
|  +----------------------------------------------------------------------------------------------+  |
|  |                               DOCUMENT DETAILS & VERSION WORKSPACE                           |  |
|  | - Active Pointer Info (S3 VersionId, Current App Version, Concurrency Revision)              |  |
|  | - Authoritative Metadata Viewer & Live Inline JSON Editor (with OCC Concurrency Checks)      |  |
|  | - Interactive Version Lineage Timeline (Download historical snapshots)                       |  |
|  | - Embedded In-Browser Document Preview (PDF rendering, Images)                              |  |
|  | - Page Manipulation Tool (Append / Prepend / Insert PDF pages)                               |  |
|  | - Administrative Actions (Soft Delete, Restore with Confirmation Guardrails)                  |  |
|  +----------------------------------------------------------------------------------------------+  |
+----------------------------------------------------------------------------------------------------+
```

### Specific Portal Capabilities:
1. **Interactive Persona Switcher**: Instantly toggles between `Document.Reader`, `Document.Writer`, `Document.MetadataEditor`, and `Document.Admin` personas to test RBAC authorization rules in real time.
2. **Client-Side Cryptographic Hash Computation**: Leverages the browser's native `window.crypto.subtle` API to compute SHA-256 checksums on client machines before binary transfer begins.
3. **Direct-to-S3 High-Speed Upload Studio**: Employs AWS S3 presigned PUT URLs with real-time XMLHttpRequest progress bars, enabling rapid file uploads without bottlenecking API servers.
4. **Dynamic Metadata Form Generation**: Dynamically constructs schema-compliant input forms based on the chosen `document_class` (`loan_agreement`, `compliance_retention`, or `security_classification`).
5. **OpenSearch Explorer & Facet Filtering**: Provides a search dashboard with keyword querying, customer/account filtering, date/amount range sliders, and active status toggles.
6. **In-Browser Document Viewer**: Renders PDF documents inline using browser PDF plugins, and displays image formats directly without local downloads.
7. **Version History Timeline**: Visualizes the complete version tree of any document, permitting one-click inspection and download of any historical version.
8. **Live Metadata Editor with OCC Shielding**: Enables editing structured metadata with client-side JSON syntax checking and automatic submission of the current `metadata_revision` to prevent lost updates.
9. **Page Splice & Append Studio**: Allows users to upload a donor PDF or image and splice it into an existing document at any position (append, prepend, or specific page index).
10. **Multi-Document Batch ZIP Exporter**: Allows operators to select checkboxes across multiple search results and trigger an on-demand ZIP export with an embedded manifest.
11. **Conversational AI Assistant UI**: Dedicated '🤖 AI Assistant' interface powered by Amazon Bedrock AgentCore and Amazon Nova 2 Lite, featuring real-time Server-Sent Events (SSE) streaming via Lambda Function URL / REST API Gateway, live MCP tool call badges (`search_documents`, `fetch_document`) with expandable JSON payload inspection, interactive document citation cards with one-click navigation into the Document Viewer, prompt starter chips, and ephemeral session management.
12. **AI Auto-Enrichment Advisor & Pipeline Stepper UI**: Dynamic pre-flight trigger evaluation embedded directly into upload studios, reactive `Auto-Enrich Document` cost guardrails (dynamically injecting `skip_enrichment: true`), 4-step asynchronous lifecycle pipeline visualizer (`Ingestion ➔ SQS Queue ➔ Bedrock Scan ➔ Rev 2 OCC`), explicit trigger diagnosis explaining why a document was enriched, skipped, or ineligible, and an in-app Bedrock Trigger Rules reference matrix.

---

## 6. Asynchronous Event Pipeline, Resiliency & Auditing Capabilities

```text
+-----------------------+
|  AMAZON DYNAMODB      | (Pointer & Metadata Mutations)
| (Control Table Stream)|
+-----------------------+
           |
           v
+-----------------------+
|   STREAM PROCESSOR    | (De-duplicates, formats index messages, writes audit records)
|       (LAMBDA)        |
+-----------------------+
      |           |
      |           v
      |     +---------------+
      |     |  S3 AUDIT     | (Immutable JSON Audit Trail Bucket)
      |     |    BUCKET     |
      |     +---------------+
      v
+---------------+
|  AMAZON SQS   | (Indexing Buffer Queue - Retries = 3)
+---------------+
      |
      v
+---------------+
|    INDEXER    | (Consumes SQS, executes bulk upsert / delete)
|   (LAMBDA)    |
+---------------+
      |           \ (On 3 consecutive failures)
      v            v
+---------------+  +---------------+
|  OPENSEARCH   |  |  SQS DEAD-LTR | (DLQ)
|  SERVERLESS   |  +---------------+
+---------------+          |
                           v
                   +---------------+
                   |  CLOUDWATCH   | (Critical Alarm Notification)
                   |    ALARMS     |
                   +---------------+
```

### 6.1 Event-Driven Capabilities:
- **Decoupled Search Indexing**: Zero performance impact on mutation APIs. Search projections update asynchronously in sub-second timeframes.
- **Dead Letter Queue (DLQ) Isolation**: Failing index payloads are isolated in an SQS DLQ after 3 failed attempts, preventing poison-pill message stalls.
- **Regulatory Audit Logging**: Every DynamoDB Stream event is serialized into the dedicated S3 Audit Bucket (`audit/YYYY/MM/DD/{eventId}.json`), creating an immutable chronological audit trail.
- **Automated Data Reconciler**: A scheduled EventBridge rule executes the `reconciler.ts` Lambda hourly, identifying any drift between DynamoDB pointers and OpenSearch records and healing discrepancies automatically.

### 6.2 Automated LLM Metadata & PII Enrichment Pipeline:
- **Event-Driven Bedrock Invocation**: On initial document creation (`metadata_revision = 1`), `stream-processor.ts` enqueues an event to `doc-platform-mvp-enrichment-queue`.
- **Bedrock Worker (`metadata-enricher.ts`)**: Consumes the SQS message, evaluates pre-flight skip rules (`skip_enrichment` or existing key fields), reads document text, and invokes Amazon Bedrock (Amazon Nova 2 Lite - `us.amazon.nova-2-lite-v1:0`).
- **PII Discovery with Safety Ratchet**: Automatically scans text for PII entities, populates `contains_pii`, and unions discovered types into `pii_categories` (`NATIONAL_ID`, `FINANCIAL_ACCOUNT`, `CONTACT_INFO`, etc.). Strictly preserves uploader `contains_pii: true` without allowing downgrades.
- **Governance Invariant Preservation**: Uploader-defined policy fields (`confidentiality_tier`, `minimum_clearance_role`, `classification_owner`, `encryption_requirement`) are strictly immutable and cannot be modified by the LLM.
- **DynamoDB OCC & OpenSearch Re-Index**: Bumps `metadata_revision` from 1 to 2 via conditional check (`expected_metadata_revision = 1`), updates the native S3 annotation (`document-metadata`), which automatically triggers the DynamoDB Stream to update the OpenSearch search projection.
- **Immutable S3 Compliance Audit**: Persists an immutable execution audit record to `audit/llm-enrichment/YYYY-MM-DD/${document_id}_rev2.json` in the S3 audit bucket, capturing model ID, prompt/completion tokens, latency, raw extractions, applied diffs, and confidentiality preservation proofs.

---

## 7. Enterprise Security, Governance & RBAC Matrix

The system enforces granular Role-Based Access Control (RBAC) via Amazon Cognito User Pool JWT claims:

| API Operation / Resource | `Document.Reader` | `Document.Writer` | `Document.MetadataEditor` | `Document.Admin` |
|---|:---:|:---:|:---:|:---:|
| `GET /health` | ✅ | ✅ | ✅ | ✅ |
| `POST /documents` (Inline Upload) | ❌ | ✅ | ❌ | ✅ |
| `POST /documents/uploads` (Direct Init) | ❌ | ✅ | ❌ | ✅ |
| `POST /uploads/{id}/complete` | ❌ | ✅ | ❌ | ✅ |
| `DELETE /uploads/{id}` (Cancel) | ❌ | ✅ | ❌ | ✅ |
| `GET /documents/{id}` (Get Doc) | ✅ | ✅ | ✅ | ✅ |
| `GET /documents/{id}/versions` | ✅ | ✅ | ✅ | ✅ |
| `POST /documents/{id}/versions` (New Version) | ❌ | ✅ | ❌ | ✅ |
| `POST /documents/{id}/pages` (Add Pages) | ❌ | ✅ | ❌ | ✅ |
| `GET /documents/{id}/versions/{version}` | ✅ | ✅ | ✅ | ✅ |
| `GET /documents/{id}/metadata` | ✅ | ✅ | ✅ | ✅ |
| `PATCH /documents/{id}/metadata` (Update Meta) | ❌ | ❌ | ✅ | ✅ |
| `GET /documents/{id}/download` | ✅ | ✅ | ✅ | ✅ |
| `POST /documents/batch-download` | ✅ | ✅ | ✅ | ✅ |
| `POST /documents/{id}/soft-delete` | ❌ | ❌ | ❌ | ✅ |
| `POST /documents/{id}/restore` | ❌ | ❌ | ❌ | ✅ |
| `POST /search` | ✅ | ✅ | ✅ | ✅ |
| `POST /agent/chat` (Conversational AI Assistant) | ✅ | ✅ | ✅ | ✅ |
| `GET /documents/{id}/audit` (Audit Trail & LLM Inspection) | ✅ | ✅ | ✅ | ✅ |
| `POST /metadata/suggest` (AI Metadata Pre-Fill) | ✅ | ✅ | ✅ | ✅ |

### Governance & Compliance Invariants:
1. **WORM Enforced via IAM**: Application execution roles have explicit `Deny` policies for `s3:DeleteObjectVersion` and `s3:DeleteBucket`. Once an S3 VersionId is created, it cannot be deleted by the application.
2. **Optimistic Concurrency Control (OCC)**: DynamoDB conditional expressions prevent race conditions and lost updates on concurrent metadata edits.
3. **Data Encryption**:
   - **At Rest**: Amazon S3 SSE-KMS / SSE-S3 with automated key rotation. DynamoDB single-table encrypted via AWS KMS. OpenSearch Serverless collection encrypted with AWS KMS.
   - **In Transit**: Enforced TLS 1.3 across API Gateway, CloudFront CDN, and internal AWS service-to-service calls.
4. **Data Sovereignty**: Regional compliance and data sovereignty are strictly enforced at the infrastructure topology layer via deployment in the designated AWS Region (e.g. AWS Israel `il-central-1`) with customer-managed KMS keys rather than arbitrary client metadata.

---

## 8. Summary of Exposable Interfaces

| Interface Type | Technology / Protocol | Consumer Type |
|---|---|---|
| **Public REST API** | HTTPS / JSON / Binary / OpenAPI 3.0 | External Applications, Core Banking, Legacy DCTM Ingestion |
| **Web Management Portal** | HTTPS / HTML5 / Vanilla JS / CloudFront | Document Managers, Compliance Officers, Operations Staff |
| **Event Stream** | DynamoDB Streams / SQS / JSON | Downstream Analytics, Audit Collectors, Search Indexers |
| **Audit Storage** | Amazon S3 (JSON Objects) | Compliance Auditors, Long-term Cold Storage |
| **Observability** | Amazon CloudWatch / AWS X-Ray | Cloud Operations, SREs, Security Operations Center (SOC) |
