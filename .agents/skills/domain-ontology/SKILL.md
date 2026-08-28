---
name: domain-ontology
description: Domain ontology, schema standards, DynamoDB key patterns, and authority rules for the AWS Document Management Platform. Use when writing code, generating schemas, updating Lambdas, or designing features in this repository.
---

# AWS Document Management Platform - Domain Ontology Skill

Use this skill when you need domain definitions, entity structures, DynamoDB single-table key schemas, or architectural constraints for this platform.

## Authority Model
- **S3 Object Versions**: Content authority (Immutable binaries).
- **S3 Object Annotations**: Metadata authority (`document-metadata` conforming to `bank.document-metadata/<class>/<version>`).
- **DynamoDB Control Table**: Control plane & pointer authority (`DOC#{id}`, `VER#{vNum}`, OCC revision checks).
- **OpenSearch Serverless**: Derived search projection.

## Core Taxonomies & Schema Discriminators
- `loan_agreement`: `SIGNED_AGREEMENT`, `APPLICATION`, `DISCLOSURE`, `PROMISSORY_NOTE`
- `compliance_retention`: `FINANCIAL_LEDGER`, `TAX_RECORD`, `AUDIT_TRAIL`
- `security_classification`: `BOARD_RESOLUTION`, `PII_EXTRACT`, `SYSTEM_CREDENTIAL`

## Key Invariants
- Monetary values: Integer minor units (`loan_amount_minor_units` in cents/agorot).
- Checksums: Must be SHA-256 prefixed with `sha256:`.
- DynamoDB keys: `DOC#{uuid}`, `VER#{versionNum}`, `UPLOAD#{sessionId}`, `IDEMP#{clientId}#{key}`.
