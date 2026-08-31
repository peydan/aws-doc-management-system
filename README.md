# 📂 AWS Cloud-Native Document Management Platform

[![AWS CDK](https://img.shields.io/badge/IaC-AWS%20CDK%20v2-orange.svg)](https://aws.amazon.com/cdk/)
[![Serverless](https://img.shields.io/badge/Architecture-Serverless-red.svg)](https://aws.amazon.com/serverless/)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript%20%7C%20Python-blue.svg)](https://www.typescriptlang.org/)

An enterprise-grade, cloud-native document management platform built entirely on AWS managed and serverless services. Designed as a modern, decoupled, scalable enterprise content management solution.

---

## 🌟 Key Capabilities & Highlights

- **Tri-Partite Authority Model**:
  - **Content Authority (Amazon S3 Object Versions)**: Strict immutability, tamper-resistant binary store.
  - **Metadata Authority (Amazon S3 Object Annotations)**: Authoritative, schema-validated JSON annotations bound directly to versioned S3 objects.
  - **Control Plane & Concurrency (Amazon DynamoDB)**: High-speed pointer catalog, optimistic concurrency control (`ETag` / revision locks), and upload session tracking.
- **Full-Text & Multi-Attribute Search (Amazon OpenSearch Serverless)**: Real-time asynchronous indexing via DynamoDB Streams + SQS + Lambda worker.
- **Enterprise Security & RBAC**: Granular role-based access control (`Admin`, `Editor`, `Viewer`) enforced via Amazon Cognito JWT authorizers and IAM least privilege.
- **Dynamic Multi-Tenant Schema Registry**: Precompiled, zero-cold-start JSON Schema validation (`Ajv`) for dynamic document types (e.g., Loans, IDs, Contracts).
- **Interactive Management Web Portal**: 100% serverless Single-Page Application (SPA) hosted on Amazon CloudFront + S3 with 1-click Cognito persona authentication, OpenSearch Explorer, direct S3 upload with client-side SHA256 checksums, and document viewer.
- **Production Resilience**: SQS Dead Letter Queues (DLQ), automated background reconciliation, and CloudWatch alarms.

---

## 🏛️ System Architecture

```text
+----------------------------------------------------------------------------------------------------+
|                      SERVERLESS SPA (AMAZON CLOUDFRONT + S3 WEB PORTAL)                            |
+----------------------------------------------------------------------------------------------------+
                                                  |
                                     HTTPS / REST | (Cognito JWT Bearer)
                                                  v
+----------------------------------------------------------------------------------------------------+
|                            AMAZON API GATEWAY (REST API + COGNITO AUTHORIZER)                      |
+----------------------------------------------------------------------------------------------------+
         |                                        |                                        |
         | (Command API)                          | (Query API)                            | (Search API)
         v                                        v                                        v
+--------------------+                  +--------------------+                  +--------------------+
| COMMAND API LAMBDA |                  |  QUERY API LAMBDA  |                  | SEARCH API LAMBDA  |
+--------------------+                  +--------------------+                  +--------------------+
   |         |         |                   |         |                                     |
   |         |         v                   v         |                                     v
   |         |   +----------------------------+      |                              +---------------+
   |         |   |      AMAZON DYNAMODB       |      |                              |   OPENSEARCH  |
   |         |   | (Control Plane & Pointers) |      |                              |  SERVERLESS   |
   |         |   +----------------------------+      |                              | (Search Index)|
   |         v                 |                     |                              +---------------+
   |   +---------------+       v (DynamoDB Streams)  |                                      ^
   |   |   AMAZON S3   |   +-----------------------+ |                                      |
   |   | (Binary Store)|   |   STREAM PROCESSOR    | |                                      |
   |   +---------------+   +-----------------------+ |                                      |
   |         ^                         |             |                                      |
   |         | (Metadata               v             |                                      |
   +---------+  Annotation)    +---------------+     |                                +-------------+
                               |  AMAZON SQS   |=====( Async Indexing Queue )========>|   INDEXER   |
                               +---------------+                                      |  (LAMBDA)   |
                                       | (DLQ on failure)                             +-------------+
                                       v
                               +---------------+
                               |  SQS DEAD-LTR |
                               +---------------+
```

---

## 🗂️ Repository Structure

```
.
├── bin/                             # CDK application entry point
├── lib/                             # AWS CDK infrastructure stacks (Storage, API, Search, Auth, Frontend)
├── src/                             # Lambda handlers (Commands, Queries, Search, Stream Processor)
├── frontend/                        # Serverless Web Portal assets (HTML5, Vanilla JS, CSS)
├── schemas/                         # Dynamic Document JSON Schemas
├── scripts/                         # Seeding, deployment, E2E scenarios, and migrations
├── openapi.yaml                     # OpenAPI 3.0 Specification
├── postman_collection.json          # Postman E2E Test Suite
├── presentations/                   # Architecture slide decks, sequence diagrams, PPTX & calculators
│   ├── diagrams/                    # System architecture & 15 API sequence diagrams
│   ├── presentation.html            # English interactive HTML slide deck (11 slides)
│   ├── presentation_hebrew.html     # Hebrew interactive HTML slide deck (11 slides)
│   ├── presentation_versions_metadata_hebrew.html # Hebrew deep-dive on metadata & versioning
│   ├── AWS_Document_Management_Platform_Architecture.pptx # Standalone PowerPoint presentation
│   ├── generate_deck.py             # Script to generate PPTX deck
│   └── cost_calculator.html         # Interactive client-side cost calculator
├── SOLUTION_ARCHITECTURE_SPECIFICATION.md # Deep-dive 1,300+ line technical architecture specification
├── COST_ANALYSIS_AND_ESTIMATION_ISRAEL_REGION.md # Regional TCO & Cost Modeling (AWS Tel Aviv region)
├── openapi.yaml                     # OpenAPI 3.0 Specification
└── postman_collection.json          # Postman E2E Test Suite
```

---

## 🚀 Quick Start Guide

### Prerequisites
- Node.js 20+ & npm
- AWS CLI configured with active credentials
- AWS CDK CLI (`npm install -g aws-cdk`)

### 1. Deploy the Backend Infrastructure (AWS CDK)
```bash
# Install dependencies
npm install

# Deploy all stacks to your AWS account
npx cdk deploy --all
```

### 2. Seed Initial Demo Data
```bash
npm run seed
```

### 3. Launch or Deploy the Web Portal
```bash
# Upload web portal assets to Amazon S3 & CloudFront
npm run deploy:frontend-assets

# Or run locally for development
npm run gui:local
```

---

## 📖 Key Documentation & Deliverables

- 📄 [Solution Architecture Specification](SOLUTION_ARCHITECTURE_SPECIFICATION.md): Exhaustive breakdown of authority models, API sequence diagrams, consistency patterns, and security matrices.
- 💰 [Israel Region Cost Analysis](COST_ANALYSIS_AND_ESTIMATION_ISRAEL_REGION.md): Capacity planning, multi-year TCO projections, and monthly cost forecasts in `il-central-1`.
- 📊 [Interactive Cost Calculator](presentations/cost_calculator.html): Browser-based dynamic sizing and pricing tool.
- 🖥️ [Interactive Architecture Deck (English)](presentations/presentation.html): 11-slide briefing deck with embedded sequence diagrams.
- 🇮🇱 [Interactive Architecture Deck (Hebrew)](presentations/presentation_hebrew.html): Hebrew translation of the full solution architecture deck.
- 📊 [PowerPoint Architecture Presentation (English)](presentations/AWS_Document_Management_Platform_Architecture.pptx): 22-slide technical deck with high-res API sequence diagrams.
- 🇮🇱 [PowerPoint Architecture Presentation (Hebrew)](presentations/AWS_Document_Management_Platform_Architecture_Hebrew.pptx): 22-slide Hebrew technical deck with high-res API sequence diagrams.
- 📑 [OpenAPI 3.0 Specification](openapi.yaml): Full REST contract for all 15 platform operations.
