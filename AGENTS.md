# 🧭 AWS Document Management Platform - Domain Ontology & Agent Guidelines

This document defines the formal **Domain Ontology**, **Architectural Invariants**, and **Code Generation Rules** for AI coding agents operating within this repository. All agents must adhere strictly to these models when writing code, defining schemas, refactoring, or generating tests.

---

## 1. Architectural Authority Model (Tri-Partite Source of Truth)

Agents must never violate the core authority boundaries:

```
+--------------------------------------------------------------------------------------------------+
| 1. CONTENT AUTHORITY: Amazon S3 Object Versions (WORM, Immutable Binary Store)                   |
|    - Raw binary source of truth (PDF, TIFF, JPEG, Office).                                       |
|    - Every binary mutation produces a new S3 VersionId. S3 version deletion is denied.           |
+--------------------------------------------------------------------------------------------------+
| 2. METADATA AUTHORITY: Amazon S3 Object Annotations (`document-metadata`)                        |
|    - Complete structured JSON payload attached directly to versioned S3 objects.                 |
|    - Strictly conforms to the document class schema (`bank.document-metadata/<class>/<ver>`).   |
+--------------------------------------------------------------------------------------------------+
| 3. CONTROL PLANE & CONCURRENCY: Amazon DynamoDB (`doc-platform-mvp-control`)                     |
|    - Fast O(1) active pointer resolution: maps DOC#{id} to current_s3_version_id.                |
|    - Concurrency coordinator: enforces optimistic locking (metadata_revision = :expected).       |
|    - Version lineage history (VER#{vNum}), idempotency locks (IDEMP#), and upload sessions.      |
+--------------------------------------------------------------------------------------------------+
| 4. SEARCH PROJECTION: Amazon OpenSearch Serverless (`documents-v1`)                              |
|    - Derived, asynchronous read-model. Never treated as an authoritative datastore.              |
+--------------------------------------------------------------------------------------------------+
```

---

## 2. Domain Concept Hierarchy & Taxonomies

```
Entity (Root)
│
├── Document (Logical container, identified by UUIDv4)
│   ├── FinancialDocument
│   │   ├── LoanAgreement (class: "loan_agreement")
│   │   │   └── Types: SIGNED_AGREEMENT | APPLICATION | DISCLOSURE | PROMISSORY_NOTE
│   │   └── ComplianceRecord (class: "compliance_retention")
│   │       └── Types: FINANCIAL_LEDGER | TAX_RECORD | AUDIT_TRAIL
│   └── GovernanceDocument
│       └── SecurityClassification (class: "security_classification")
│           └── Types: BOARD_RESOLUTION | PII_EXTRACT | SYSTEM_CREDENTIAL
│
├── DocumentVersion (Immutable snapshot of binary content + schema version)
│   └── Tracks: application_version, s3_version_id, content_checksum, content_length
│
├── MetadataRevision (Sequential edit count of metadata attached to a specific version)
│   └── Tracks: metadata_revision, metadata_updated_at, metadata_updated_by
│
└── UploadSession (Two-phase direct upload state machine)
    └── States: INITIATED -> COMPLETED | ABORTED (with TTL)
```

---

## 3. Standard Entity Traits & Schema Properties

When extending schemas or writing validators, agents must use these standard property names and types:

### A. Base System Traits (Required on All Documents)
* `annotation_schema` (`string`): e.g., `"bank.document-metadata/1"` or `"bank.document-metadata/<class>/<version>"`
* `document_id` (`string`, UUIDv4): Immutable unique logical document identifier.
* `document_class` (`string`): Top-level schema discriminator (`loan_agreement`, `compliance_retention`, `security_classification`).
* `document_type` (`string`, Enum): Specific sub-type under the document class.
* `application_version` (`integer`, >= 1): Monotonically increasing content version number.
* `metadata_revision` (`integer`, >= 1): Monotonically increasing metadata edit sequence.
* `schema_version` (`integer`, >= 1): Major version of the JSON schema contract.
* `content_type` (`string`): MIME type (e.g. `application/pdf`, `image/tiff`).
* `content_length` (`integer`, bytes): Exact binary size.
* `content_checksum` (`string`): SHA-256 hash formatted strictly as `sha256:<hex>`.
* `filename` (`string`): Original uploaded filename.
* `created_at` / `metadata_updated_at` (`string`, ISO 8601 UTC).
* `created_by` / `metadata_updated_by` (`string`): User/Subject identity.

### B. Shared Banking & DCTM Domain Traits (Inherited by All Document Classes)
* `customer_id` (`integer`, >= 0): Core Banking Customer Number (`CUSTOMER_ID NUMBER(10)`).
* `complete_customer_id_code` (`object`): Compound customer ID (`COMPLEATE_CUSTOMER_ID_CODE`).
  * `id_number` (`string`, max 16): National ID / Passport (`ID_Number VARCHAR2(16)`).
  * `id_type` (`integer`): ID Type Code (`ID_Type NUMBER(10)`).
* `account_id` (`object`): Compound bank account key (`ACCOUNT_ID`).
  * `bank_id` (`integer`): Bank code (`ACCOUNT_BANK_ID NUMBER(10)`).
  * `branch_id` (`integer`): Branch code (`BRANCH_ID NUMBER(10)`).
  * `account_number` (`integer`): Account number (`ACCOUNT_NBR NUMBER(10)`).
* `account_subscription_num` (`integer`, >= 0): Account subscription number (`NUMBER(10)`).
* `transaction_id` (`string`, max 64): Transaction / Box identifier.
* `document_int` (`string`, max 64): Documentum (DCTM) Internal Chronicle ID.
* `document_ext` (`string`, max 40): Legacy external system identifier.
* `a_content_type` (`string`, max 32): Documentum format / content type string.
* `document_form_id` (`string`, max 10): Form template code.
* `legacy_document_entry_dttm` (`string`, ISO 8601 UTC): Legacy ingestion timestamp.
* `r_creation_date` / `r_modify_date` (`string`, ISO 8601 UTC): Documentum audit timestamps.
* `business_area_code` (`integer`, >= 0): Business Area Code (`NUMBER(10)`).
* `business_sub_area_code` (`integer`, >= 0): Business Sub-Area Code (`NUMBER(10)`).
* `document_group_id` (`string`, max 40): Envelope / Document Group ID.

### C. Financial Domain Trait
* `loan_number` (`string`): Unique loan account reference (e.g., `LN-2026-88821`).
* `loan_amount_minor_units` (`integer`, >= 0): **Always integer minor units (cents / agorot)**. Never use floating-point for currency.
* `currency` (`string`, 3-letter ISO 4217): e.g. `ILS`, `USD`, `EUR`.
* `loan_type` (`string`, Enum): `MORTGAGE` | `PERSONAL` | `COMMERCIAL` | `AUTO`.
* `branch_code` (`string`): e.g. `TLV-01`.
* `signed_date` (`string`, ISO 8601 Date: `YYYY-MM-DD`).

### D. Compliance & Retention Domain Trait
* `retention_schedule_code` (`string`): e.g. `RET-FIN-001`.
* `retention_period_years` (`integer`, >= 0): Retention lifespan.
* `regulatory_framework` (`string`, Enum): `SOX` | `GDPR` | `BASEL_III` | `HIPAA` | `LOCAL_BANKING_REG`.
* `retention_start_date` / `retention_expiry_date` (`string`, `YYYY-MM-DD`).
* `legal_hold_active` (`boolean`): If true, prevents purge/disposal regardless of expiry.
* `disposal_action` (`string`, Enum): `PERMANENT_DELETE` | `ARCHIVE_GLACIER` | `REVIEW_REQUIRED`.

### E. Security & Privacy Classification Trait
* `confidentiality_tier` (`string`, Enum): `PUBLIC` | `INTERNAL` | `RESTRICTED` | `HIGHLY_CONFIDENTIAL`.
* `contains_pii` (`boolean`): Whether Personally Identifiable Information is present.
* `pii_categories` (`array[string]`): e.g. `["NATIONAL_ID", "FINANCIAL_HISTORY", "BIOMETRIC"]`.
* `minimum_clearance_role` (`string`, Enum): `Document.Reader` | `Document.Writer` | `Document.MetadataEditor` | `Document.Admin`.
* `encryption_requirement` (`string`, Enum): `SSE_S3` | `SSE_KMS_DEFAULT` | `SSE_KMS_CUSTOMER_MANAGED`.
* `data_residency_jurisdiction` (`string`, 2-letter ISO): e.g. `IL`, `US`, `EU`.

---

## 4. DynamoDB Control Table Keying Invariants

Single Table Name: `doc-platform-mvp-control` (Primary Key: `pk` String, `sk` String)

| Entity Type | Partition Key (`pk`) | Sort Key (`sk`) | Key Invariant / Attributes |
|---|---|---|---|
| **Document Pointer** | `DOC#{document_id}` | `METADATA` | Holds `current_s3_version_id`, `current_application_version`, `current_metadata_revision`, `status` (`ACTIVE`/`SOFT_DELETED`). |
| **Version Lineage** | `DOC#{document_id}` | `VER#{application_version}` | Stores immutable version record (`s3_version_id`, `content_checksum`, `created_at`). |
| **Upload Session** | `UPLOAD#{session_id}` | `SESSION` | Tracks 2-step direct upload (`INITIATED`, `ACTIVE`, `ABORTED`). Has TTL `ttl_expiry`. |
| **Idempotency Lock**| `IDEMP#{client_id}#{idemp_key}` | `LOCK` | Atomically prevents duplicate command execution. Has TTL `ttl_expiry`. |

---

## 5. Security & RBAC Governance

Enforced via Cognito User Pools and JWT Role claims:

1. **`Document.Reader`**: Read metadata, list versions, download binaries, search documents.
2. **`Document.Writer`**: Ingest inline binaries, initiate/complete direct uploads, create new document versions.
3. **`Document.MetadataEditor`**: Modify structured metadata (`PATCH /metadata`) with optimistic concurrency.
4. **`Document.Admin`**: Soft-delete documents, restore documents, manage schema registries, bypass retention locks.

---

## 6. Rules for Coding Agents Adding Features

1. **Never bypass DynamoDB OCC**: When updating metadata, always write conditional checks: `ConditionExpression: "current_metadata_revision = :expected_revision"`.
2. **Never treat DynamoDB as metadata authority**: DynamoDB stores control pointers and revision counters. The full JSON metadata must always be written to the versioned S3 Object Annotation.
3. **Always validate with Ajv**: All metadata mutation endpoints must validate against precompiled Ajv schemas in `src/shared/validator.ts`.
4. **Maintain OpenSearch as projection**: When updating document properties, ensure the DynamoDB Stream event structure propagates to `src/background-worker/indexer.ts` and updates OpenSearch index mappings.
5. **No floating-point money**: Always store currency in minor units (`loan_amount_minor_units` as integer).
