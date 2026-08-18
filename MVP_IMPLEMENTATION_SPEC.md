# AWS Document Management Platform - MVP Specification

**Version:** 0.1  
**Status:** Draft for MVP implementation and demonstration  
**Date:** 29 July 2026  
**Primary Region:** AWS US East (N. Virginia) (`us-east-1`)  
**MVP Architecture:** API Gateway + AWS Lambda + Amazon S3 Annotations + DynamoDB + OpenSearch Serverless + SQS + AWS Cognito

> **MVP objective:** Demonstrate an end-to-end document-management platform that uploads, versions, retrieves, updates metadata, and searches documents using AWS-native managed services. The MVP deliberately excludes production-scale migration, disaster recovery, WORM retention, legal hold, permanent deletion, analytics, archive restoration, and dynamic administration.

## Table of Contents

1. [MVP Goals](#1-mvp-goals)
2. [Scope](#2-scope)
3. [Architecture Decisions](#3-architecture-decisions)
4. [Logical Architecture](#4-logical-architecture)
5. [Services](#5-services)
6. [Document and Metadata Model](#6-document-and-metadata-model)
7. [Upload Design](#7-upload-design)
8. [Retrieval and Versioning](#8-retrieval-and-versioning)
9. [Metadata Updates](#9-metadata-updates)
10. [Search](#10-search)
11. [DynamoDB Design](#11-dynamodb-design)
12. [API Specification](#12-api-specification)
13. [Authentication and Authorization](#13-authentication-and-authorization)
14. [Audit and Observability](#14-audit-and-observability)
15. [Failure Handling and Reconciliation](#15-failure-handling-and-reconciliation)
16. [Infrastructure as Code](#16-infrastructure-as-code)
17. [Demo Dataset and Scenario](#17-demo-dataset-and-scenario)
18. [Testing and Acceptance Criteria](#18-testing-and-acceptance-criteria)
19. [Delivery Plan](#19-delivery-plan)
20. [Deferred Capabilities](#20-deferred-capabilities)
21. [Known Limitations and Risks](#21-known-limitations-and-risks)

---

## 1. MVP Goals

The MVP must prove the following capabilities:

1. Upload a small document through an API and Lambda.
2. Upload a larger document directly to S3 using a presigned URL.
3. Attach one structured, mutable S3 Annotation containing the document metadata.
4. Retrieve the current document and a specific historical content version.
5. Create a new document content version.
6. Update metadata without creating a new content version.
7. Search current documents through OpenSearch using multiple metadata filters.
8. Enforce authentication and basic role-based authorization using AWS Cognito.
9. Preserve S3 content versions and prevent application roles from permanently deleting versions.
10. Demonstrate asynchronous, recoverable indexing through SQS and a dead-letter queue.
11. Show basic audit events, monitoring, and reconciliation.

The MVP is a technical and business demonstration. The MVP is not a production compliance certification or a complete Documentum migration solution.

---

## 2. Scope

### 2.1 Included

- One document class: `loan_agreement`
- One statically deployed metadata schema: version 1
- PDF, TIFF, JPEG, and Microsoft Office content types for demonstration
- Inline binary upload for raw files up to 4 MiB
- Presigned single-PUT upload for raw files above 4 MiB and up to the configured MVP maximum
- S3 native content versioning
- One mutable `document-metadata` S3 Annotation per S3 object version
- Metadata update with optimistic concurrency
- Current and historical content retrieval
- OpenSearch metadata search over current active documents
- Exact filters, date range, numeric range, sorting, and cursor pagination
- Soft delete and restore
- AWS Cognito authentication
- Three application roles
- DynamoDB control-plane records
- SQS indexing queue and DLQ
- Basic application audit events
- CloudWatch logs, metrics, alarms, and dashboard
- AWS CDK deployment

### 2.2 Excluded

- Disaster recovery and cross-region replication
- S3 Object Lock
- WORM retention and native legal hold
- Permanent deletion through the application
- Athena and S3 Metadata Tables
- Glacier lifecycle and restore
- Multipart upload
- Bulk upload and bulk metadata operations
- Document-class administration APIs
- Dynamic schema activation workflow
- Full-text document-content search
- OCR, AI extraction, and summarization
- Fuzzy matching and relevance tuning
- Search aggregations and dashboards
- Historical metadata revision search
- Generic report and export framework
- User interface, except an optional demo client
- Production migration tooling
- Formal compliance claims

---

## 3. Architecture Decisions

### 3.1 Authority model

- **Content authority:** The S3 object version is authoritative for document bytes.
- **Metadata authority:** The mutable `document-metadata` S3 Annotation attached to an S3 object version is authoritative for metadata belonging to that content version.
- **Current pointer:** DynamoDB identifies the current S3 VersionId and current metadata revision.
- **Search projection:** OpenSearch contains a rebuildable index of the current active logical document.
- **Audit evidence:** Application audit events are written to a dedicated encrypted S3 audit bucket by a background worker.

### 3.2 Metadata model

The MVP uses exactly one structured annotation per S3 object version. The annotation contains system and business metadata in one JSON object. This avoids consistency problems between multiple annotations.

### 3.3 Object protection

Object Lock is excluded because the MVP requires mutable annotations. The MVP uses:

- S3 Versioning
- SSE-KMS encryption
- Denial of `s3:DeleteObjectVersion` to all application roles
- Bucket policies and least-privilege IAM
- Soft delete rather than physical deletion
- CloudTrail management events and selected S3 data events
- Application audit events

### 3.4 Search model

OpenSearch indexes one record per current active logical document. Historical S3 content versions are not indexed in the MVP.

### 3.5 Regional scope

The MVP runs only in `us-east-1`. No regional failover, RPO, RTO, or cross-region replication is included.

---

## 4. Logical Architecture

```text
Demo Client / Consumer
          |
          v
API Gateway + Cognito JWT Authorizer
          |
          +--------------------------+--------------------------+
          |                          |                          |
          v                          v                          v
Document Command Lambda     Document Query Lambda        Search Lambda
          |                          |                          |
          |                          |                          v
          |                          |                 OpenSearch Serverless
          |                          |
          |                          +--> DynamoDB current pointer
          |                          +--> S3 annotation and content URL
          |
          +--> S3 versioned content
          +--> document-metadata annotation
          +--> DynamoDB control records and event records
                                  |
                                  v
                         DynamoDB Stream
                                  |
                                  v
                         Background Worker
                            |            |
                            v            v
                    SQS Index Queue   Audit S3 Bucket
                            |
                            v
                       Indexer Lambda
                            |
                            v
                  OpenSearch Serverless

CloudWatch: logs, metrics, alarms, dashboard
KMS: S3, DynamoDB, SQS, OpenSearch, audit encryption
```

### 4.1 Deployment units

The MVP uses four Lambda deployment units:

1. `document-command-api`
2. `document-query-api`
3. `search-api`
4. `background-worker`

The indexer may be implemented inside `background-worker` or deployed separately if the OpenSearch network and IAM boundary makes separation clearer.

---

## 5. Services

| Service | MVP responsibility |
|---|---|
| API Gateway | REST API, request routing, throttling, binary payload support |
| AWS Lambda | Command, query, search, indexing, audit, and reconciliation logic |
| Amazon S3 | Versioned content and authoritative metadata annotation |
| Amazon DynamoDB | Current pointers, version registry, metadata revision, idempotency, schema, and event records |
| OpenSearch Serverless | Current-document metadata search |
| Amazon SQS | Durable indexing queue and DLQ |
| AWS Cognito | Identity provider, user pools, and application groups/roles |
| AWS KMS | Encryption keys |
| Amazon CloudWatch | Logs, metrics, alarms, and dashboard |
| AWS CloudTrail | AWS API evidence and configured S3 data events |
| AWS CDK | Infrastructure as code |

---

## 6. Document and Metadata Model

### 6.1 S3 key

```text
documents/{document_class}/{document_id}
```

Example:

```text
documents/loan_agreement/550e8400-e29b-41d4-a716-446655440000
```

Each content update writes to the same key and creates a new S3 VersionId.

### 6.2 Document identifier

- UUID v4
- Generated by the platform
- Immutable
- Independent of the S3 VersionId

### 6.3 Authoritative annotation

Annotation name:

```text
document-metadata
```

Example payload:

```json
{
  "annotation_schema": "bank.document-metadata/1",
  "document_id": "550e8400-e29b-41d4-a716-446655440000",
  "document_class": "loan_agreement",
  "application_version": 3,
  "metadata_revision": 2,
  "schema_version": 1,
  "document_type": "SIGNED_AGREEMENT",
  "customer_id": "IL-4492817",
  "loan_number": "LN-2026-88821",
  "loan_amount_minor_units": 90000000,
  "currency": "ILS",
  "loan_type": "MORTGAGE",
  "branch_code": "TLV-04",
  "signed_date": "2026-07-15",
  "content_type": "application/pdf",
  "content_length": 204800,
  "content_checksum": "sha256:...",
  "filename": "loan_LN-2026-88821.pdf",
  "created_at": "2026-07-29T10:30:45.123Z",
  "created_by": "loan-processing-service",
  "metadata_updated_at": "2026-07-29T14:22:10.456Z",
  "metadata_updated_by": "loan-maintenance-service"
}
```

### 6.4 Field rules

| Field | Rule |
|---|---|
| `document_id` | Immutable |
| `document_class` | Immutable |
| `application_version` | Changes only with content version |
| `metadata_revision` | Increments on metadata update |
| `schema_version` | Fixed to 1 in MVP |
| `content_type` | Immutable for a content version |
| `content_length` | Immutable for a content version |
| `content_checksum` | Immutable for a content version |
| Business fields | Mutable only if allowed by schema |
| Money | Integer minor units plus currency |
| Dates | ISO 8601 |
| Naming | `snake_case` |

### 6.5 Static MVP schema

The schema is stored in the source repository:

```text
schemas/loan_agreement-v1.json
```

The schema is deployed with the Lambda artifact. No runtime schema-administration API is included.

---

## 7. Upload Design

### 7.1 Path selection

| Raw file size | Upload path |
|---|---|
| Up to 4 MiB | Inline binary upload through API Gateway and Lambda |
| Above 4 MiB | Presigned single-PUT upload directly to S3 |

The MVP maximum file size is configuration. Multipart upload is deferred.

### 7.2 Inline upload request

```http
POST /v1/documents
Authorization: Bearer <token>
Idempotency-Key: <uuid>
Content-Type: application/pdf
Content-Length: 204800
X-Content-SHA256: <checksum>
X-Document-Metadata: <bounded encoded metadata envelope>

<raw binary document bytes>
```

Processing:

1. Authenticate and authorize `Document.Writer`.
2. Validate `Content-Length` before decoding where possible.
3. Reject a raw file above `INLINE_UPLOAD_MAX_BYTES`.
4. Decode the API Gateway binary representation.
5. Verify actual size and checksum.
6. Validate metadata against the static schema.
7. Generate document ID and application version 1.
8. Put the object to S3 and capture VersionId.
9. Create the `document-metadata` annotation.
10. Read the annotation back and capture its ETag/checksum.
11. Write the DynamoDB document, version, idempotency, and event records transactionally.
12. Return `201 Created`.

The client must not put base64 file content inside JSON.

### 7.3 Direct upload initiation

```http
POST /v1/documents/uploads
Authorization: Bearer <token>
Idempotency-Key: <uuid>
Content-Type: application/json
```

```json
{
  "document_class": "loan_agreement",
  "filename": "loan_LN-2026-88821.pdf",
  "content_type": "application/pdf",
  "content_length": 7340032,
  "checksum_algorithm": "SHA256",
  "checksum": "...",
  "metadata": {
    "document_type": "SIGNED_AGREEMENT",
    "customer_id": "IL-4492817",
    "loan_number": "LN-2026-88821",
    "loan_amount_minor_units": 90000000,
    "currency": "ILS",
    "loan_type": "MORTGAGE",
    "branch_code": "TLV-04",
    "signed_date": "2026-07-15"
  }
}
```

Response:

```json
{
  "upload_id": "01J4XYZ...",
  "document_id": "550e8400-e29b-41d4-a716-446655440000",
  "upload_method": "SINGLE_PUT",
  "upload_url": "https://...",
  "required_headers": {
    "content-type": "application/pdf",
    "x-amz-checksum-sha256": "..."
  },
  "expires_at": "2026-07-29T15:00:00Z"
}
```

### 7.4 Direct upload completion

```http
POST /v1/uploads/{upload_id}/complete
Authorization: Bearer <token>
Idempotency-Key: <uuid>
```

Processing:

1. Validate upload ownership and state.
2. Verify the S3 object key, VersionId, content length, content type, checksum, and encryption.
3. Create and verify the authoritative annotation.
4. Write DynamoDB document, version, idempotency, and event records transactionally.
5. Mark the upload active.
6. Return `201 Created`.

### 7.5 Upload states

```text
INITIATED -> UPLOADED -> ANNOTATED -> ACTIVE
```

Failure states:

```text
EXPIRED | ABORTED | FAILED_RECONCILABLE
```

---

## 8. Retrieval and Versioning

### 8.1 Get current document

```http
GET /v1/documents/{document_id}
```

The response contains:

- Document ID
- Current application version
- S3 VersionId
- Current metadata revision
- Authoritative metadata
- Short-lived version-specific download URL
- Download URL expiration

### 8.2 List versions

```http
GET /v1/documents/{document_id}/versions
```

The response lists application versions newest first. It does not retrieve every historical annotation unless requested.

### 8.3 Get a specific version

```http
GET /v1/documents/{document_id}/versions/{version}
```

The Query Lambda resolves the application version to the exact S3 VersionId and retrieves that version's annotation.

### 8.4 Create content version

Inline:

```http
POST /v1/documents/{document_id}/versions
```

Direct:

```http
POST /v1/documents/{document_id}/versions/uploads
```

A new content version:

- Reuses the logical document ID and S3 key
- Allocates the next application version using a conditional DynamoDB transaction
- Creates a new S3 VersionId
- Creates a new annotation with `metadata_revision = 1`
- Becomes current only after annotation and catalog commit succeed

### 8.5 Soft delete and restore

```http
POST /v1/documents/{document_id}/soft-delete
POST /v1/documents/{document_id}/restore
```

Soft delete changes DynamoDB status and the OpenSearch projection. It does not delete S3 versions or create delete markers.

---

## 9. Metadata Updates

### 9.1 Request

```http
PATCH /v1/documents/{document_id}/metadata
Authorization: Bearer <token>
Idempotency-Key: <uuid>
Content-Type: application/json
```

```json
{
  "expected_metadata_revision": 1,
  "reason": "CORRECTION",
  "changes": {
    "loan_amount_minor_units": 90000000,
    "branch_code": "TLV-05"
  }
}
```

### 9.2 Processing

1. Read the strongly consistent current document record from DynamoDB.
2. Compare `expected_metadata_revision` with the current revision.
3. Retrieve the authoritative annotation using exact S3 VersionId.
4. Verify annotation revision and stored ETag/checksum.
5. Reject changes to immutable fields.
6. Merge allowed fields.
7. Validate the complete result against the static schema.
8. Increment `metadata_revision`.
9. Replace the one S3 annotation.
10. Read the annotation back and verify it.
11. Conditionally update DynamoDB revision and annotation ETag/checksum.
12. Write an audit/index event.
13. Return the new metadata revision.

### 9.3 Conflict response

```http
409 METADATA_CONFLICT
```

```json
{
  "error": {
    "code": "METADATA_CONFLICT",
    "message": "Metadata changed after the supplied revision.",
    "expected_revision": 1,
    "current_revision": 2,
    "retryable": false
  }
}
```

### 9.4 History

The S3 annotation holds current metadata only. The MVP audit event records:

- Previous and new metadata revision
- Changed field names
- Actor
- Reason
- Timestamp
- Correlation ID
- Outcome

Complete before-and-after sensitive values are not stored unless specifically approved.

---

## 10. Search

### 10.1 Purpose

OpenSearch demonstrates flexible metadata discovery while remaining a derived, replaceable projection.

### 10.2 Index scope

Index name:

```text
documents-v1
```

One OpenSearch record represents the current active logical document. Historical content versions and previous metadata values are not indexed.

### 10.3 Fixed mapping

```json
{
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "document_id": { "type": "keyword" },
      "document_class": { "type": "keyword" },
      "application_version": { "type": "integer" },
      "metadata_revision": { "type": "long" },
      "customer_id": { "type": "keyword" },
      "document_type": { "type": "keyword" },
      "loan_number": { "type": "keyword" },
      "loan_amount_minor_units": { "type": "long" },
      "currency": { "type": "keyword" },
      "loan_type": { "type": "keyword" },
      "branch_code": { "type": "keyword" },
      "signed_date": { "type": "date" },
      "created_at": { "type": "date" },
      "updated_at": { "type": "date" },
      "status": { "type": "keyword" },
      "projection_timestamp": { "type": "date" }
    }
  }
}
```

### 10.4 Search request

```http
POST /v1/search
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "filters": {
    "document_class": "loan_agreement",
    "customer_id": "IL-4492817",
    "document_type": "SIGNED_AGREEMENT",
    "loan_type": "MORTGAGE",
    "created_from": "2026-01-01T00:00:00Z",
    "created_to": "2026-12-31T23:59:59Z",
    "loan_amount_min_minor_units": 50000000,
    "loan_amount_max_minor_units": 100000000
  },
  "sort": {
    "field": "created_at",
    "direction": "desc"
  },
  "page_size": 20,
  "cursor": null
}
```

### 10.5 Supported behavior

- Exact term filters
- Date ranges
- Loan amount range
- AND combination of approved filters
- Sort by `created_at` or `updated_at`
- `search_after` cursor pagination
- Maximum page size of 100
- Mandatory `status = ACTIVE`
- Mandatory server-generated authorization filters

Not supported:

- Raw OpenSearch DSL
- Arbitrary fields
- OR/NOT expression trees
- Fuzzy or substring search
- Full-text content search
- User-defined sorting
- Aggregations
- Deep page-number pagination

### 10.6 Indexing flow

```text
DynamoDB committed event
        |
        v
DynamoDB Stream / Background Worker
        |
        v
SQS Index Queue
        |
        v
Indexer
        |
        v
OpenSearch
```

The indexer:

1. Receives document ID, S3 VersionId, and metadata revision.
2. Reads the current DynamoDB pointer.
3. Rejects stale events.
4. Retrieves the authoritative annotation from S3.
5. Selects approved index fields.
6. Upserts the OpenSearch record idempotently.
7. Records projection success or routes failure to the DLQ.

### 10.7 Search failure

If OpenSearch is unavailable, return:

```http
503 SEARCH_UNAVAILABLE
```

Direct retrieval by document ID remains available.

---

## 11. DynamoDB Design

### 11.1 Table

```text
doc-platform-mvp-control
```

### 11.2 Key patterns

```text
PK = DOC#{document_id},    SK = DOC
PK = DOC#{document_id},    SK = VER#{version_padded}
PK = UPLOAD#{upload_id},   SK = SESSION
PK = IDEMP#{client_id}#{idempotency_key}, SK = REQUEST
PK = EVENT#{shard},        SK = {timestamp}#{event_id}
```

### 11.3 Document item

```json
{
  "pk": "DOC#550e8400-e29b-41d4-a716-446655440000",
  "sk": "DOC",
  "document_id": "550e8400-e29b-41d4-a716-446655440000",
  "document_class": "loan_agreement",
  "status": "ACTIVE",
  "current_application_version": 3,
  "current_s3_key": "documents/loan_agreement/550e8400-e29b-41d4-a716-446655440000",
  "current_s3_version_id": "X2Hi...",
  "current_metadata_revision": 2,
  "current_annotation_etag": "18f61a...",
  "created_at": "2026-07-29T10:30:45.123Z",
  "updated_at": "2026-07-29T14:22:10.456Z"
}
```

### 11.4 Version item

```json
{
  "pk": "DOC#550e8400-e29b-41d4-a716-446655440000",
  "sk": "VER#0000000003",
  "application_version": 3,
  "s3_key": "documents/loan_agreement/550e8400-e29b-41d4-a716-446655440000",
  "s3_version_id": "X2Hi...",
  "metadata_revision": 2,
  "annotation_etag": "18f61a...",
  "content_checksum": "sha256:...",
  "state": "ACTIVE"
}
```

### 11.5 Capacity and recovery

- On-demand capacity for MVP
- Point-in-time recovery enabled
- KMS encryption enabled
- DynamoDB Streams enabled
- No Global Tables
- No search GSIs required because OpenSearch handles discovery

---

## 12. API Specification

### 12.1 Endpoints

```text
POST   /v1/documents
POST   /v1/documents/uploads
POST   /v1/uploads/{upload_id}/complete
DELETE /v1/uploads/{upload_id}

GET    /v1/documents/{document_id}
GET    /v1/documents/{document_id}/versions
GET    /v1/documents/{document_id}/versions/{version}
GET    /v1/documents/{document_id}/metadata
GET    /v1/documents/{document_id}/download

POST   /v1/documents/{document_id}/versions
POST   /v1/documents/{document_id}/versions/uploads
PATCH  /v1/documents/{document_id}/metadata
POST   /v1/documents/{document_id}/soft-delete
POST   /v1/documents/{document_id}/restore

POST   /v1/search
GET    /v1/health
```

### 12.2 Standard error envelope

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Required field customer_id is missing.",
    "correlation_id": "req-123e4567-e89b-12d3-a456-426614174000",
    "retryable": false,
    "details": [
      {
        "field": "metadata.customer_id",
        "error": "required"
      }
    ]
  }
}
```

### 12.3 Error codes

- `VALIDATION_ERROR`
- `AUTHENTICATION_ERROR`
- `AUTHORIZATION_ERROR`
- `NOT_FOUND`
- `IDEMPOTENCY_CONFLICT`
- `VERSION_CONFLICT`
- `METADATA_CONFLICT`
- `INLINE_UPLOAD_LIMIT_EXCEEDED`
- `UPLOAD_EXPIRED`
- `CHECKSUM_MISMATCH`
- `SEARCH_UNAVAILABLE`
- `RATE_LIMIT_EXCEEDED`
- `INTERNAL_ERROR`

---

## 13. Authentication and Authorization

### 13.1 Identity provider

- AWS Cognito User Pool
- OAuth 2.0 and OpenID Connect
- JWT bearer tokens (Cognito idToken or accessToken)
- API Gateway Cognito User Pools Authorizer / JWT Authorizer

Validate:

- Signature
- Issuer
- Audience
- Tenant
- Expiration and not-before
- Client ID
- Required application roles

### 13.2 MVP roles

| Role | Permissions |
|---|---|
| `Document.Reader` | Retrieve, download, list versions, and search |
| `Document.Writer` | Reader permissions plus upload and create content version |
| `Document.MetadataEditor` | Reader permissions plus metadata update |
| `Document.Admin` | All MVP operations including soft delete and restore |

### 13.3 Search authorization

The Search Lambda adds mandatory authorization filters. Client-supplied fields cannot override authorization or document status.

For the demo, access is limited to approved internal application identities. End-customer access and fine-grained customer entitlements are deferred.

---

## 14. Audit and Observability

### 14.1 Audit events

Capture:

- `DOCUMENT_CREATED`
- `DOCUMENT_VERSION_CREATED`
- `DOCUMENT_RETRIEVED`
- `DOCUMENT_DOWNLOADED`
- `METADATA_UPDATED`
- `SEARCH_EXECUTED`
- `DOCUMENT_SOFT_DELETED`
- `DOCUMENT_RESTORED`
- `ACCESS_DENIED`
- `INDEXING_FAILED`

Audit event fields:

- Event ID
- Event type
- Timestamp
- Actor subject and client ID
- Document ID and application version
- Metadata revision where applicable
- Correlation ID
- Idempotency key where applicable
- Reason code
- Outcome

### 14.2 Logs

Use structured JSON logs. Do not log:

- Document bytes
- Access tokens
- Presigned URLs
- Full sensitive metadata
- Encryption material

### 14.3 Metrics

- API requests, latency, 4xx, and 5xx
- Lambda invocations, errors, duration, and timeout
- Uploads by path and status
- Metadata conflicts
- DynamoDB throttles and transaction conflicts
- SQS age and DLQ messages
- OpenSearch indexing failures and search latency
- Projection lag
- Reconciliation failures

### 14.4 Critical alarms

- API 5xx above threshold
- Lambda errors or timeouts
- DynamoDB throttling
- Any index DLQ message
- Projection lag above five minutes
- Annotation or pointer mismatch
- KMS access failure
- Unauthorized permanent-version deletion attempt

---

## 15. Failure Handling and Reconciliation

### 15.1 Idempotency

All mutation operations require `Idempotency-Key`.

The idempotency record stores:

- Client ID
- Route
- Request hash
- Status
- Stable document/upload identifiers
- Response summary
- Expiry

A reused key with a different request returns `409 IDEMPOTENCY_CONFLICT`.

### 15.2 Cross-service consistency

S3 and DynamoDB are not transactionally atomic. The MVP uses explicit states and reconciliation.

Primary cases:

- S3 object exists without annotation
- S3 object and annotation exist without DynamoDB commit
- Annotation update succeeds but DynamoDB revision update fails
- DynamoDB event exists but OpenSearch indexing fails
- Soft-deleted DynamoDB record remains visible in OpenSearch

### 15.3 Reconciliation worker

A scheduled reconciliation mode in the Background Worker checks a bounded demo dataset and repairs or alerts on:

- Missing required annotation
- Annotation document ID mismatch
- DynamoDB pointer to missing S3 VersionId
- DynamoDB metadata revision mismatch
- Stale or missing OpenSearch record
- Orphan upload session
- Audit-delivery failure

For production scale, reconciliation requires a separate design based on inventory and partitioned jobs.

---

## 16. Infrastructure as Code

### 16.1 CDK structure

```text
doc-platform-mvp/
  bin/
    app.ts
  lib/
    storage-stack.ts
    control-plane-stack.ts
    api-stack.ts
    compute-stack.ts
    messaging-stack.ts
    search-stack.ts
    security-stack.ts
    observability-stack.ts
  src/
    command-api/
    query-api/
    search-api/
    background-worker/
    shared/
    schemas/
  test/
    unit/
    integration/
  cdk.json
```

### 16.2 Required controls

- S3 Versioning enabled
- S3 Block Public Access enabled
- Object Lock disabled
- SSE-KMS enabled
- DynamoDB PITR enabled
- OpenSearch public access disabled
- Least-privilege role per Lambda unit
- Runtime roles denied `s3:DeleteObjectVersion`
- Production-style CORS restricted to approved origins
- SQS DLQ configured
- CloudWatch log retention configured
- Resource removal policies prevent accidental deletion of S3 and DynamoDB data
- Policy-as-code checks included in CI

---

## 17. Demo Dataset and Scenario

### 17.1 Dataset

Prepare approximately 100 to 500 synthetic loan-agreement documents. Do not use customer production data.

Vary:

- Customer IDs
- Loan numbers
- Loan amounts
- Loan types
- Branch codes
- Signed dates
- Document types
- File sizes below and above 4 MiB

### 17.2 Demo script

1. Authenticate using an approved AWS Cognito application identity / test user.
2. Upload a 300 KB PDF through the inline Lambda path.
3. Show the new S3 VersionId and metadata revision 1.
4. Search by customer ID and loan type in OpenSearch.
5. Retrieve the document and open the short-lived download URL.
6. Update the branch code using metadata revision 1.
7. Show metadata revision 2 without a new S3 content VersionId.
8. Search again and show the updated branch code.
9. Attempt a concurrent stale update and show `409 METADATA_CONFLICT`.
10. Upload a new content version and show a new S3 VersionId and application version.
11. Retrieve the historical content version.
12. Upload a file above 4 MiB through the presigned path.
13. Soft-delete a document and show that search no longer returns it.
14. Restore the document and show that search returns it again.
15. Show CloudWatch metrics, audit events, and an empty DLQ.

---

## 18. Testing and Acceptance Criteria

### 18.1 Functional acceptance

- Inline upload succeeds for supported files up to configured limit.
- Oversized inline upload returns `413` with direct-upload guidance.
- Presigned upload and completion succeed.
- S3 object version and required annotation exist after activation.
- Current and historical content versions are retrievable.
- Metadata update increments revision without creating a new S3 content version.
- Stale metadata update returns `409`.
- Search returns expected current documents using approved filters.
- Search excludes soft-deleted documents.
- Restore returns a document to search.
- Unauthorized role receives `403`.
- Application roles cannot permanently delete an S3 object version.

### 18.2 Reliability acceptance

- Repeated mutation with the same idempotency key does not create duplicates.
- Indexing failure retries and reaches DLQ after configured attempts.
- A replayed stale indexing event does not overwrite a newer OpenSearch revision.
- Reconciliation detects a simulated pointer or projection mismatch.
- Direct retrieval remains functional when OpenSearch is unavailable.

### 18.3 Performance targets

For the demo dataset and agreed concurrency:

- Metadata retrieval P95 under 500 ms, excluding client download
- Search P95 under 3 seconds
- Metadata update P95 under 1 second
- Upload initiation P95 under 500 ms
- Projection visible in search within 60 seconds at P95

These are MVP targets and must be measured in the deployed environment.

### 18.4 Security acceptance

- JWT validation rejects wrong issuer, audience, tenant, and expired token.
- Role checks protect every endpoint.
- S3 and OpenSearch are not publicly accessible.
- KMS encryption is active.
- Logs contain no tokens, presigned URLs, or document bytes.
- Permanent version deletion is denied to application roles.

---

## 19. Delivery Plan

### Week 1: Foundation

- CDK application and environments
- S3, KMS, DynamoDB, API Gateway, Cognito User Pool & authorizer
- Shared request, error, logging, and schema libraries

### Week 2: Core document operations

- Inline upload
- Direct-upload initiation and completion
- Retrieval and download URL
- Content version registry
- Idempotency

### Week 3: Metadata and search

- Mutable annotation update
- Concurrency handling
- SQS index queue and DLQ
- OpenSearch collection, mapping, indexer, and search API

### Week 4: Audit, reconciliation, and demo hardening

- Audit events and audit bucket
- Soft delete and restore
- CloudWatch dashboard and alarms
- Reconciliation checks
- Integration, security, and performance tests
- Synthetic demo dataset and scripted demonstration

The four-week plan assumes one document class, no user interface, synthetic data, and an experienced delivery team with AWS prerequisites already available.

---

## 20. Deferred Capabilities

### Phase 2 candidates

- Additional document classes
- Runtime schema management
- Multipart upload
- Athena and S3 Metadata Tables
- Bulk operations
- Search aggregations and exports
- Archive lifecycle
- Application-managed hold and governed deletion
- User interface
- Migration tooling

### Later candidates

- OCR and content extraction
- Full-text document search
- AI summarization and classification
- Object Lock and immutable retained-record repository
- Disaster recovery
- Advanced entitlement integration
- Format conversion and document merge

---

## 21. Known Limitations and Risks

| Limitation or risk | MVP treatment |
|---|---|
| Metadata annotation is mutable | Immutable audit event records every update |
| Metadata history is not queryable from the current annotation | Audit records provide change evidence; revision history UI is deferred |
| No WORM retention | Explicitly outside MVP; no compliance claim |
| No native legal hold | Permanent deletion is not exposed to application users |
| S3 and DynamoDB updates are not atomic | States, idempotency, retries, and reconciliation |
| OpenSearch is eventually consistent | Response communicates projection timestamp; direct retrieval uses S3/DynamoDB |
| One fixed document class | Appropriate for MVP; extensibility deferred |
| Fixed search mapping | Prevents mapping complexity; additional classes require design work |
| No multipart upload | MVP file maximum enforced; large production files deferred |
| Single region | Regional disaster recovery is outside scope |
| Capacity inputs remain inconsistent | Demo uses bounded synthetic dataset; production sizing is separate |
| No production migration | Demo data only; Documentum migration requires separate workstream |

---

## Appendix A: Source-of-Truth Statement

> **S3 object versions are the authoritative store for document content. The mutable `document-metadata` S3 Annotation attached to each object version is the authoritative store for its metadata. DynamoDB provides current pointers, metadata revision, idempotency, and workflow state. OpenSearch is a derived read model for current-document search.**

## Appendix B: MVP Service Inventory

```text
Required:
- API Gateway
- Lambda
- S3
- S3 Annotations
- DynamoDB
- DynamoDB Streams
- SQS + DLQ
- OpenSearch Serverless
- KMS
- CloudWatch
- CloudTrail
- AWS Cognito
- CDK

Not required:
- Athena
- S3 Metadata Tables
- Step Functions
- Object Lock
- Glacier
- Cross-Region Replication
- DynamoDB Global Tables
- Textract
- Bedrock
```

## Appendix C: Definition of Done

The MVP is complete when an authorized demonstrator can upload, version, retrieve, update metadata, search, soft-delete, and restore synthetic loan-agreement documents; demonstrate both upload paths; show concurrency protection and asynchronous index recovery; and present passing functional, security, and performance evidence from the deployed single-region environment.
