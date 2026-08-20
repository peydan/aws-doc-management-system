# 📂 AWS Cloud-Native Document Management Platform

[![AWS CDK](https://img.shields.io/badge/IaC-AWS%20CDK%20v2-orange.svg)](https://aws.amazon.com/cdk/)
[![Serverless](https://img.shields.io/badge/Architecture-Serverless-red.svg)](https://aws.amazon.com/serverless/)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript%20%7C%20Python-blue.svg)](https://www.typescriptlang.org/)

An enterprise-grade, cloud-native document management platform built entirely on AWS managed and serverless services. Designed as a modern, decoupled, scalable replacement for legacy ECM platforms (such as EMC Documentum / OpenText).

---

## 🌟 Key Capabilities & Highlights

- **Tri-Partite Authority Model**:
  - **Content Authority (Amazon S3 Object Versions)**: Strict immutability, tamper-resistant binary store.
  - **Metadata Authority (Amazon S3 Object Annotations)**: Authoritative, schema-validated JSON annotations bound directly to versioned S3 objects.
  - **Control Plane & Concurrency (Amazon DynamoDB)**: High-speed pointer catalog, optimistic concurrency control (`ETag` / revision locks), and upload session tracking.
- **Full-Text & Multi-Attribute Search (Amazon OpenSearch Serverless)**: Real-time asynchronous indexing via DynamoDB Streams + SQS + Lambda worker.
- **Enterprise Security & RBAC**: Granular role-based access control (`Admin`, `Editor`, `Viewer`) enforced via Amazon Cognito JWT authorizers and IAM least privilege.
- **Dynamic Multi-Tenant Schema Registry**: Precompiled, zero-cold-start JSON Schema validation (`Ajv`) for dynamic document types (e.g., Loans, IDs, Contracts).
- **Interactive Management UI**: Complete Python Streamlit GUI for document upload, search, version lineage browsing, schema editor, and direct downloads.
- **Production Resilience**: SQS Dead Letter Queues (DLQ), automated background reconciliation, and CloudWatch alarms.

---

## 🏛️ System Architecture

```text
+----------------------------------------------------------------------------------------------------+
|                                    CONSUMER / CLIENT / STREAMLIT GUI                               |
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
├── lib/                             # AWS CDK infrastructure stacks (Storage, API, Search, Auth)
├── src/                             # Lambda handlers (Commands, Queries, Search, Stream Processor)
├── schemas/                         # Dynamic Document JSON Schemas
├── scripts/                         # Seeding, E2E demo scenarios, and annotation migrations
├── app.py                           # Local Streamlit Management GUI
├── app_for_deployment.py            # Containerized / Production Streamlit GUI
├── openapi.yaml                     # OpenAPI 3.0 Specification
├── postman_collection.json          # Postman E2E Test Suite
├── SOLUTION_ARCHITECTURE_SPECIFICATION.md # Deep-dive 1,300+ line technical architecture specification
├── COST_ANALYSIS_AND_ESTIMATION_ISRAEL_REGION.md # Regional TCO & Cost Modeling (AWS Tel Aviv region)
├── presentation.html                # Executive HTML slide deck
└── cost_calculator.html             # Interactive client-side cost calculator
```

---

## 🚀 Quick Start Guide

### Prerequisites
- Node.js 20+ & npm
- Python 3.10+
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

### 3. Launch the Management GUI
```bash
# Install UI dependencies
pip install -r requirements-gui.txt

# Run the Streamlit application
npm run gui
# Or: streamlit run app.py
```

---

## 📖 Key Documentation & Deliverables

- 📄 [Solution Architecture Specification](SOLUTION_ARCHITECTURE_SPECIFICATION.md): Exhaustive breakdown of authority models, API sequence diagrams, consistency patterns, and security matrices.
- 💰 [Israel Region Cost Analysis](COST_ANALYSIS_AND_ESTIMATION_ISRAEL_REGION.md): Capacity planning, TCO comparison vs legacy ECM, and monthly cost forecasts in `il-central-1`.
- 📊 [Interactive Cost Calculator](cost_calculator.html): Browser-based dynamic sizing and pricing tool.
- 📑 [OpenAPI 3.0 Specification](openapi.yaml): Full REST contract for all 15 platform operations.
