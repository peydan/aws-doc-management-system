# AWS Document Management Platform — Streamlit UI Guide & Use Cases

## 1. Overview

The **Streamlit Web Application** (`app.py`) is an interactive **Developer Console, Demonstration Workbench, and Management Portal** for the AWS Document Management Platform. It interfaces with the backend AWS API Gateway REST APIs via `api_client.py` and provides a visual interface for exercising, validating, and demonstrating all platform capabilities.

```text
+---------------------------------------------------------------------------------------------------------------+
|                                    AWS DOCUMENT MANAGEMENT STREAMLIT UI                                       |
+---------------------------------------------------------------------------------------------------------------+
  [Tab 0: 🔐 Auth & Roles]         [Tab 1: 🟢 Health Check]        [Tab 2: 📤 Ingestion / Upload]
  [Tab 3: 📄 Viewer & Versions]    [Tab 4: ✏️ Metadata & OCC]       [Tab 5: 🔍 OpenSearch Search]
  [Tab 6: 🛡️ Lifecycle Admin]     [Tab 7: ⚡ Request Inspector]
+---------------------------------------------------------------------------------------------------------------+
```

---

## 2. Global Controls & Sidebar Configuration

The persistent sidebar provides environment configuration and active session controls:

- **API Gateway Base URL Configuration:** Allows dynamically switching between local test endpoints and live AWS API Gateway stage URLs (`https://{api-id}.execute-api.us-east-1.amazonaws.com/v1`).
- **Security & Network Settings:** Toggle TLS CA certificate verification, enable system proxy detection, or define custom HTTP/HTTPS proxy routes.
- **Active Session State Panel:** Real-time visibility into the currently selected `Document ID`, `Upload Session ID`, and `Last Known Metadata Revision`.
- **Pre-fill Demo Sample Button:** One-click pre-population of demo document identifiers from the synthetic dataset.

---

## 3. Workspaces & Functional Use Cases

The interface is structured into **8 dedicated tabs**:

```
+------------------------------------+--------------------------------------------------------------------------+
| Tab Workspace                      | Primary Use Cases                                                        |
+------------------------------------+--------------------------------------------------------------------------+
| 🔐 0. Authentication & Roles       | AWS Cognito User Pool sign-in, JWT claims inspection, RBAC matrix        |
| 🟢 1. System Health                | API Gateway latency checks, operational health SLA verification          |
| 📤 2. Document Upload              | Small file inline upload (≤ 4 MiB) & direct presigned S3 upload (> 4 MiB)|
| 📄 3. Document Viewer & Versions   | In-browser PDF/image preview, version lineage, new version ingestion     |
| ✏️ 4. Metadata & Concurrency       | S3 annotation editing, optimistic concurrency (OCC) conflict demo        |
| 🔍 5. OpenSearch Query             | Multi-attribute structured search, sorting, direct-to-viewer navigation  |
| 🛡️ 6. Lifecycle Management         | Administrative soft-delete, OpenSearch index purging, document restore   |
| ⚡ 7. Live Request Inspector       | Live HTTP audit logging, cURL command generator, JSON payload inspector  |
+------------------------------------+--------------------------------------------------------------------------+
```

---

### Tab 0: 🔐 Authentication, Identity & RBAC Testing
- **AWS Cognito User Pool Authentication:**
  - Authenticate using standard credentials against AWS Cognito User Pool App Clients.
  - Preset test personas: `admin-user`, `writer-user`, `editor-user`, and `reader-user`.
  - Custom username/password support for newly provisioned users.
- **Real-Time JWT Claims Decoding:**
  - Decodes and displays active token attributes without external dependencies.
  - Shows Username, Email, Assigned Cognito Groups/Roles (`Document.Reader`, `Document.Writer`, `Document.MetadataEditor`, `Document.Admin`), Subject UUID (`sub`), and Token Expiry timestamp.
- **Mock Role Injection (Sandbox/Local Mode):**
  - Instant one-click mock role injection (`x-mock-role`) for testing backend handlers without active network connectivity to Cognito.
- **RBAC Reference Matrix:**
  - Interactive table detailing exact endpoint authorizations across each application role.

---

### Tab 1: 🟢 System Health & Infrastructure Monitoring
- **Health Check Execution (`GET /v1/health`):**
  - Sends unauthenticated operational probes directly to the API Gateway `/health` endpoint.
- **Performance Benchmarking:**
  - Displays round-trip execution latency in milliseconds.
  - Verifies Lambda invocation responsiveness without database read overhead.

---

### Tab 2: 📤 Multi-Path Document Ingestion

#### Use Case A: Inline Binary Ingestion ($\le$ 4 MiB)
- **Path:** `POST /v1/documents`
- **Workflow:**
  1. Uploads binary files (PDF, TIFF, JPEG, PNG, TXT).
  2. Automatically computes client-side SHA-256 binary checksums.
  3. Generates unique `Idempotency-Key` UUIDs to ensure single-execution mutation safety.
  4. Formats structured business metadata (Customer ID, Loan Number, Loan Amount, Loan Type, Branch Code, Document Type) into the `X-Document-Metadata` header.
  5. Uploads raw bytes directly through API Gateway into Lambda, S3, and DynamoDB.

#### Use Case B: Direct S3 Presigned Ingestion (> 4 MiB)
- **Path:** `POST /v1/documents/uploads` $\to$ S3 Direct PUT $\to$ `POST /v1/uploads/{id}/complete`
- **Workflow:**
  1. **Initiate Session:** Submits file size, checksum, and business metadata to acquire an upload session ID and a 15-minute S3 presigned PUT URL.
  2. **Direct Binary Transfer:** Streams large binary files directly to Amazon S3, bypassing API Gateway payload constraints.
  3. **Complete & Activate:** Triggers backend verification of S3 bytes, generates authoritative S3 metadata annotations, and commits the document pointer into DynamoDB.
  4. **Abort / Cancel:** Cancels pending sessions (`DELETE /v1/uploads/{id}`).

---

### Tab 3: 📄 Document Viewer & Application Version History

#### Use Case A: In-Browser Document Preview
- Automatically retrieves short-lived presigned download URLs and renders content natively:
  - **PDF Documents:** Full-featured embedded PDF reader with pagination, scrolling, and download options.
  - **Images:** High-resolution image preview for JPEGs, PNGs, and TIFFs.
  - **Structured Files:** Formatted, syntax-highlighted code blocks for JSON, XML, CSV, and text files.
  - **Office Documents:** Dedicated download cards for DOCX and XLSX files.

#### Use Case B: Application Version Lineage
- **List All Versions (`GET /v1/documents/{id}/versions`):** Displays a tabular version history sorted newest-first, showing `application_version`, `s3_version_id`, `metadata_revision`, and checksums.
- **Historical Version Inspection:** Fetch and preview any past version of a document directly in the embedded viewer without rolling back or altering current pointers.
- **New Version Creation (`POST /v1/documents/{id}/versions`):** Uploads a new binary version for an existing document ID, incrementing `application_version` while preserving historical S3 versions.

---

### Tab 4: ✏️ Optimistic Concurrency Control (OCC) Metadata Editor
- **Authoritative S3 Annotation Retrieval (`GET /v1/documents/{id}/metadata`):** Fetches the latest JSON annotation directly from storage.
- **Optimistic Concurrency Control (OCC):**
  - **Standard Update:** Submits business metadata changes (e.g., updating branch code or loan amount) alongside `expected_metadata_revision`. Validates against the JSON schema and increments the revision.
  - **Conflict Simulation:** Includes a dedicated **"💥 Simulate Stale Update Conflict"** button that intentionally submits a stale revision number, demonstrating the system's `409 METADATA_CONFLICT` protection against lost updates.

---

### Tab 5: 🔍 OpenSearch Structured Document Search
- **Multi-Attribute Filter Builder (`POST /v1/search`):**
  - Search by Document Class (`loan_agreement`), Filename, Customer ID, Document Type, Loan Type, and Branch Code.
- **Sorting & Pagination:**
  - Sort by `created_at` or `updated_at` (ascending or descending).
  - Page size customization (1 to 100 results per page).
- **Interactive Results Grid:**
  - Tabular display of matching documents with formatted financial values and timestamps.
- **Direct Navigation:**
  - **"📥 Load into Document Viewer"** quick-action button automatically transfers selected search results into the viewer tab for immediate inspection.

---

### Tab 6: 🛡️ Document Lifecycle Management
- **Administrative Soft Delete (`POST /v1/documents/{id}/soft-delete`):**
  - Updates document status to `SOFT_DELETED` in DynamoDB.
  - Immediately purges document projection from OpenSearch Serverless.
  - Preserves immutable S3 binary versions and historical annotations intact.
- **Administrative Restore (`POST /v1/documents/{id}/restore`):**
  - Restores status back to `ACTIVE` in DynamoDB.
  - Re-indexes authoritative metadata into OpenSearch Serverless.

---

### Tab 7: ⚡ Live HTTP Request Inspector & Audit Log
- **Session Request History:** Live chronological log of all API calls made through the UI.
- **cURL Command Generation:** Automatically generates exact, reproducible `curl` commands for every request, including headers and auth tokens.
- **Payload Inspection:** Side-by-side view of JSON request payloads and backend API responses.

---

## 4. How to Run the Streamlit Application

### Prerequisites
- Python 3.9+ installed.
- Backend CDK stacks deployed (or running against local mock mode).

### Installation & Execution
```bash
# 1. Install UI dependencies
pip install -r requirements-gui.txt

# 2. Launch the Streamlit server
npm run gui
# or directly:
streamlit run app.py
```

The application will open automatically in your browser at `http://localhost:8501`.
