---
name: domain-ontology
description: Domain ontology, schema standards, DynamoDB key patterns, and authority rules for the AWS Document Management Platform. Use when writing code, generating schemas, updating Lambdas, or designing features in this repository.
---

# AWS Document Management Platform - Domain Ontology Skill

Use this skill when you need domain definitions, entity structures, DynamoDB single-table key schemas, or architectural constraints for this platform.

## 1. Authority Model (Tri-Partite Source of Truth)
- **S3 Object Versions**: Content authority (Immutable binaries).
- **S3 Object Annotations**: Metadata authority (`document-metadata` conforming to `bank.document-metadata/<class>/<version>` composing shared base schema).
- **DynamoDB Control Table**: Control plane & pointer authority (`DOC#{id}`, `VER#{vNum}`, OCC revision checks).
- **OpenSearch Serverless**: Derived search projection.

## 2. Shared Banking & DCTM Domain Traits (Inherited by All Classes)
All document classes compose with the shared schema (`https://bank.internal/schemas/shared-document-metadata-v1.json`):
- `customer_id` (`integer`, >= 0): Core Banking Customer Number (`CUSTOMER_ID NUMBER(10)`).
- `complete_customer_id_code` (`object`): Compound customer ID (`COMPLEATE_CUSTOMER_ID_CODE`).
  - `id_number` (`string`, max 16): National ID / Passport (`ID_Number VARCHAR2(16)`).
  - `id_type` (`integer`): ID Type Code (`ID_Type NUMBER(10)`).
- `account_id` (`object`): Compound bank account key (`ACCOUNT_ID`).
  - `bank_id` (`integer`): Bank code (`ACCOUNT_BANK_ID NUMBER(10)`).
  - `branch_id` (`integer`): Branch code (`BRANCH_ID NUMBER(10)`).
  - `account_number` (`integer`): Account number (`ACCOUNT_NBR NUMBER(10)`).
- `account_subscription_num` (`integer`, >= 0): Account subscription number (`NUMBER(10)`).
- `transaction_id` (`string`, max 64): Transaction / Box identifier.
- `document_int` (`string`, max 64): Documentum (DCTM) Internal Chronicle ID.
- `document_ext` (`string`, max 40): Legacy external system identifier.
- `a_content_type` (`string`, max 32): Documentum format / content MIME type string.
- `format` (`string`): Normalized file format identifier (e.g. `pdf`, `jpeg`, `png`, `docx`, `tiff`).
- `page_count` (`integer`, >= 1): Monotonically counted page count for PDF documents, automatically extracted upon upload or conversion.
- `document_form_id` (`string`, max 10): Form template code.
- `legacy_document_entry_dttm` (`string`, ISO 8601 UTC): Legacy ingestion timestamp.
- `r_creation_date` / `r_modify_date` (`string`, ISO 8601 UTC): Documentum audit timestamps.
- `business_area_code` (`integer`, >= 0): Business Area Code (`NUMBER(10)`).
- `business_sub_area_code` (`integer`, >= 0): Business Sub-Area Code (`NUMBER(10)`).
- `document_group_id` (`string`, max 40): Envelope / Document Group ID.

## 3. Core Taxonomies & Schema Discriminators
- `loan_agreement`: `SIGNED_AGREEMENT`, `APPLICATION`, `DISCLOSURE`, `PROMISSORY_NOTE`
  - Traits: `loan_number`, `loan_amount_minor_units`, `currency`, `loan_type`, `branch_code`, `signed_date`.
- `compliance_retention`: `STATUTORY_RECORD`, `FINANCIAL_LEDGER`, `AUDIT_EVIDENCE`, `CONTRACT_ARCHIVE`, `COMMUNICATION_LOG`
  - Traits: `retention_schedule_code`, `retention_period_years`, `regulatory_framework`, `retention_start_date`, `retention_expiry_date`, `legal_hold_active`, `disposal_action`, `compliance_officer_id`.
- `security_classification`: `CUSTOMER_RECORD`, `INTERNAL_MEMO`, `BOARD_RESOLUTION`, `FINANCIAL_FORECAST`, `SECURITY_ASSESSMENT`
  - Traits: `confidentiality_tier`, `contains_pii`, `pii_categories`, `minimum_clearance_role`, `encryption_requirement`, `export_restricted`, `classification_owner`.

## 4. Key Invariants & Rules
- **Monetary values**: Always integer minor units (`loan_amount_minor_units` in cents/agorot). Never floating-point.
- **Checksums**: Must be SHA-256 prefixed with `sha256:`.
- **DynamoDB Key Patterns**: `DOC#{uuid}`, `VER#{versionNum}`, `UPLOAD#{sessionId}`, `IDEMP#{clientId}#{key}`.
- **Secondary Index Patterns (GSI)**:
  - `GSI_Customer`: `CUST#{customer_id}` -> `DOC#{document_id}`
  - `GSI_Account`: `ACC#{bank_id}#{branch_id}#{account_number}` -> `DOC#{document_id}`
  - `GSI_LegacyDoc`: `DCTM#{document_int}` -> `DOC#{document_id}`
- **Schema Inheritance & Source of Truth**: All class schemas must use `$ref: "https://bank.internal/schemas/shared-document-metadata-v1.json"` with `allOf`. Schemas serve as the Single Source of Truth:
  - **Static Defaults**: Declared via the JSON Schema `default` keyword and automatically populated during ingestion (`Ajv useDefaults`) and frontend template generation (`npm run generate`).
  - **Field Immutability**: Any property that cannot be updated after document creation must declare `"x-immutable": true` (dynamically enforced by `getImmutableFields()` in `metadata-update.ts`).
  - **Search Overrides**: OpenSearch mappings are auto-generated via `scripts/generate-artifacts.ts`; optional custom types can be specified via `"x-opensearch-type"`.
- **Content Mutations**: Adding pages or mutating binary content produces a new S3 VersionId, updates S3 annotations, and creates an immutable `VER#{versionNum}` record via DynamoDB OCC.
- **Capabilities Maintenance**: Any modification to domain models, API routes, or storage invariants must be reflected in `SYSTEM_CAPABILITIES.md` during Layer 6 impact analysis.
- **LLM Enrichment Governance**: Automated metadata enrichment must never overwrite or downgrade uploader-defined policy fields (`confidentiality_tier`, `minimum_clearance_role`, `classification_owner`, `encryption_requirement`). PII discovery enforces the safety ratchet (union of `pii_categories`, non-downgrade of `contains_pii`). All mutations must update S3 annotations via DynamoDB OCC and persist an immutable audit trail in S3.
- **AI Conversational Assistant**: The conversational document assistant executes via Amazon Bedrock AgentCore Harness & MCP Gateway, cites authoritative `document_id` and `application_version`, converts minor currency units to major units for human display, enforces soft-delete boundaries, and uses ephemeral session memory.

