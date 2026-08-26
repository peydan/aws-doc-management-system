# AWS Document Management Platform — Cost Analysis & TCO Estimation
## AWS Israel (Tel Aviv) Region (`il-central-1`)

---

## 1. Executive Summary & Financial Architecture

The **AWS Document Management Platform** utilizes a 100% serverless, cloud-native architecture following a **pure consumption-based cost model**:

- **Zero Idle Compute Waste:** API Gateway and Lambda scale to zero when no documents are uploaded, searched, or retrieved.
- **Ultra-Low Storage Unit Cost:** Amazon S3 Standard in `il-central-1` provides 11 9s durability at **$0.025 per GB-month**, combined with native **S3 Annotations** that eliminate the operational overhead and cost of external sidecar files.
- **Pay-Per-Request Concurrency Control:** Amazon DynamoDB on-demand mode charges strictly per read/write request ($0.125 / $0.625 per million units) with zero provisioned idle capacity.
- **Decoupled Search Scaling:** Amazon OpenSearch Serverless (AOSS) scales independently via OpenSearch Compute Units (OCUs) without full-time dedicated cluster management.

### Key Financial Takeaways (USD & ILS at ₪3.70 / $1.00)

| Tier | Monthly Document Ingestion | Total Stored Documents | Monthly Ingestion & Query Ops | Estimated Monthly AWS Cost (USD) | Estimated Monthly AWS Cost (ILS) | Cost per Managed Doc / Month |
|---|---|---|---|---|---|---|
| **POC / Dev** | 10,000 docs (10 GB) | 50,000 docs (50 GB) | 100,000 calls | **$385 – $420** | **₪1,425 – ₪1,554** | ~$0.0080 |
| **Mid-Market / Dept** | 250,000 docs (250 GB) | 1,500,000 docs (1.5 TB) | 2,500,000 calls | **$460 – $520** | **₪1,702 – ₪1,924** | ~$0.0003 |
| **Enterprise Banking Scale** | 2,000,000 docs (2 TB) | 15,000,000 docs (15 TB) | 20,000,000 calls | **$1,120 – $1,350** | **₪4,144 – ₪4,995** | ~$0.00008 |
| **Massive Archive Tier** | 10,000,000 docs (10 TB) | 100,000,000 docs (100 TB) | 100,000,000 calls | **$3,850 – $4,600** | **₪14,245 – ₪17,020** | ~$0.00004 |

*(Note: Baseline costs in low-volume tiers are dominated by OpenSearch Serverless minimum OCUs. See Section 6 for dev/test zero-OCU optimization).*

---

## 2. AWS Israel Region (`il-central-1`) Pricing Catalog

All estimates in this model are based on published pricing for AWS Region **`il-central-1` (Tel Aviv)**:

| AWS Service | Billing Dimension | Israel Region Unit Price (`il-central-1`) | Notes & Baseline Assumptions |
|---|---|---|---|
| **Amazon S3 Standard** | Primary Storage | **$0.0250 per GB-month** | Versioned document binaries & S3 Annotations. |
| **Amazon S3 Standard** | PUT / POST / COPY / LIST | **$0.0055 per 1,000 requests** | Ingestion & Annotation mutations. |
| **Amazon S3 Standard** | GET / SELECT | **$0.00044 per 1,000 requests** | Document downloads & presigned URL reads. |
| **Amazon S3 Audit Bucket** | Cold / Audit Storage | **$0.0135 per GB-month** (S3 Standard-IA / Glacier Instant) | Immutable stream audit logs. |
| **Amazon DynamoDB** | Write Request Units (WRU) | **$0.625 per 1,000,000 WRU** | Single-table on-demand write operations. |
| **Amazon DynamoDB** | Read Request Units (RRU) | **$0.125 per 1,000,000 RRU** | Point lookups (`DOC#{id}` pointer resolution). |
| **Amazon DynamoDB** | Table Storage | **$0.275 per GB-month** | Document pointers, versions, session state. |
| **Amazon DynamoDB Streams**| Stream Read Requests | **$0.02 per 100,000 read units** | CDC event pipeline to SQS. |
| **Amazon OpenSearch Serverless** | Indexing OCUs | **$0.260 per OCU-hour** (~$187.20 / OCU-mo) | Scales based on ingestion throughput. |
| **Amazon OpenSearch Serverless** | Search OCUs | **$0.260 per OCU-hour** (~$187.20 / OCU-mo) | Scales based on query complexity/volume. |
| **Amazon OpenSearch Serverless** | Managed Storage | **$0.260 per GB-month** | Active document index storage. |
| **AWS Lambda** (Node.js 20) | Invocations | **$0.20 per 1,000,000 requests** | First 1M free tier per account. |
| **AWS Lambda** (ARM64 Graviton) | Compute Duration | **$0.0000133334 per GB-second** | Average execution: 150ms @ 512MB = $0.0000010/exec. |
| **Amazon API Gateway** | REST API Calls | **$3.80 per 1,000,000 requests** | First 333M calls/month tier. |
| **Amazon SQS & DLQ** | Queue Requests | **$0.40 per 1,000,000 requests** | First 1M free tier per account. |
| **AWS KMS** | Customer Managed Key (CMK) | **$1.00 per key-month** + $0.03 / 10k ops | Dedicated platform encryption key. |
| **Amazon CloudWatch** | Logs Ingestion & Metrics | **$0.55 per GB ingested** + $0.30/metric | Structured JSON logs with 30-day retention. |
| **AWS Cognito** | Active Users (MAU) | **Free up to 50,000 MAU**, then $0.0055/MAU | Identity & RBAC user pool tokens. |
| **Data Transfer Out (Egress)** | Internet Egress | **$0.090 per GB** (First 100 GB/mo free) | Presigned download binary transfers to clients. |

---

## 3. End-to-End Cost Formula Breakdown per Transaction

To understand how cost scales with each API action, we examine the unit economics per operation:

### 3.1 Document Ingestion (Direct / Inline Upload + Annotation + Indexing)
When a document (avg. size $S_{\text{MB}} = 1\text{ MB}$) is uploaded:
1. **API Gateway:** 1 request = $\$0.0000038$
2. **Lambda (Command API):** $200\text{ms}$ @ $512\text{MB}$ = $\$0.0000015$
3. **DynamoDB Control Plane:**
   - 1 Upload Session init + 1 Pointer commit + 1 Version commit + 1 Idempotency commit = 4 WRU = $\$0.0000025$
4. **S3 Binary PUT:** 1 PUT request = $\$0.0000055$
5. **S3 Annotation (`PutObjectAnnotation`):** 1 PUT request = $\$0.0000055$
6. **DynamoDB Streams & SQS:** 1 stream event + 1 SQS SendMessage = $\$0.0000006$
7. **Lambda (Stream Processor + Indexer):** 2 executions @ $100\text{ms}$ = $\$0.0000015$
8. **KMS Encryption Operations:** 4 cryptographic calls = $\$0.0000120$
9. **CloudWatch Logging:** ~4 KB log events = $\$0.0000022$

$$\mathbf{Total\ Cost\ per\ Document\ Ingestion} \approx \mathbf{\$0.000035}\ \text{(approx. ₪0.00013)}$$
*(Excluding persistent monthly S3 storage capacity).*

### 3.2 Metadata Patch (`PATCH /documents/{id}/metadata`)
When a document's metadata is updated:
1. **API Gateway + Lambda:** $\$0.0000053$
2. **DynamoDB Optimistic Concurrency Check & Pointer Increment:** 1 WRU + 1 RRU = $\$0.00000075$
3. **S3 Annotation Update (`PutObjectAnnotation`):** 1 PUT request = $\$0.0000055$
4. **DynamoDB Streams $\rightarrow$ SQS $\rightarrow$ OpenSearch Index Update:** $\$0.0000025$
5. **Audit Bucket Log Entry:** 1 PUT request = $\$0.0000055$

$$\mathbf{Total\ Cost\ per\ Metadata\ Patch} \approx \mathbf{\$0.000020}\ \text{(approx. ₪0.000074)}$$

### 3.3 Document Search & Metadata Query
When an end user executes a filtered multi-attribute search:
1. **API Gateway + Lambda (Search API):** $\$0.0000053$
2. **OpenSearch Serverless Search Request:** Consumes compute against active Search OCUs.
3. **Audit Log:** $\$0.0000010$

$$\mathbf{Total\ Variable\ Cost\ per\ Search\ Query} \approx \mathbf{\$0.0000063}\ \text{(approx. ₪0.000023)}$$

### 3.4 Document Download via Presigned URL
When a user requests and downloads a 1 MB document:
1. **Get Presigned URL (API Gateway + Lambda + DynamoDB Read):** $\$0.0000055$
2. **Direct S3 GET:** 1 GET request = $\$0.00000044$
3. **Data Egress (if outside AWS):** $1\text{ MB} \times \$0.090/\text{GB} = \$0.000090$

$$\mathbf{Total\ Cost\ per\ Download} \approx \mathbf{\$0.000096}\ \text{(approx. ₪0.000355)}$$

---

## 4. Multi-Tier Workload Sizing & Monthly Projections

### Scenario A: Proof of Concept / Small Department
- **Monthly Ingestion:** 10,000 documents (avg. 1 MB each = 10 GB/mo)
- **Cumulative Active Storage:** 50,000 documents (50 GB)
- **Monthly Read / Search Volume:** 50,000 queries + downloads
- **OpenSearch Serverless Baseline:** 1.0 Index OCU + 1.0 Search OCU

| Component | Usage / Volume | Monthly Cost (USD) | Monthly Cost (ILS) |
|---|---|---|---|
| Amazon S3 (Standard Storage + Requests) | 50 GB storage + 30k requests | $1.42 | ₪5.25 |
| Amazon DynamoDB (On-Demand) | 100k WRU + 200k RRU + 1 GB storage | $0.36 | ₪1.33 |
| Amazon OpenSearch Serverless (AOSS) | 2.0 OCUs baseline + 1 GB index | $374.66 | ₪1,386.24 |
| AWS Lambda | 150k invocations (75k GB-s) | $1.03 | ₪3.81 |
| Amazon API Gateway | 100k requests | $0.38 | ₪1.41 |
| Amazon SQS, KMS, CloudWatch | 1 CMK + 10 GB logs + 5 alarms | $7.50 | ₪27.75 |
| Data Transfer Out | 50 GB downloads (within 100 GB free tier) | $0.00 | ₪0.00 |
| **Total Monthly Cost** | | **$385.35** | **₪1,425.80** |

---

### Scenario B: Mid-Market Enterprise (e.g. Regional Insurance / Legal)
- **Monthly Ingestion:** 250,000 documents (avg. 1 MB each = 250 GB/mo)
- **Cumulative Active Storage:** 1,500,000 documents (1.5 TB)
- **Monthly Read / Search Volume:** 1,000,000 queries + downloads
- **OpenSearch Serverless Baseline:** 1.0 Index OCU + 1.0 Search OCU

| Component | Usage / Volume | Monthly Cost (USD) | Monthly Cost (ILS) |
|---|---|---|---|
| Amazon S3 (Standard Storage + Requests) | 1,500 GB storage + 750k requests | $41.63 | ₪154.03 |
| Amazon DynamoDB (On-Demand) | 2.5M WRU + 5.0M RRU + 15 GB storage | $6.31 | ₪23.35 |
| Amazon OpenSearch Serverless (AOSS) | 2.0 OCUs baseline + 25 GB index | $380.90 | ₪1,409.33 |
| AWS Lambda | 3.5M invocations (1.75M GB-s) | $24.03 | ₪88.91 |
| Amazon API Gateway | 2.5M requests | $9.50 | ₪35.15 |
| Amazon SQS, KMS, CloudWatch | 1 CMK + 50 GB logs + 10 alarms | $32.00 | ₪118.40 |
| Data Transfer Out | 250 GB external downloads | $13.50 | ₪49.95 |
| **Total Monthly Cost** | | **$507.87** | **₪1,879.12** |

---

### Scenario C: Large Enterprise Banking & Lending
- **Monthly Ingestion:** 2,000,000 loan agreements & collateral files (2 TB/mo)
- **Cumulative Active Storage:** 15,000,000 documents (15 TB)
- **Monthly Read / Search Volume:** 10,000,000 queries + downloads
- **OpenSearch Serverless Baseline:** 2.0 Index OCUs + 2.0 Search OCUs (High Availability)

| Component | Usage / Volume | Monthly Cost (USD) | Monthly Cost (ILS) |
|---|---|---|---|
| Amazon S3 (Standard Storage + Requests) | 15,000 GB storage + 6M requests | $408.00 | ₪1,509.60 |
| Amazon DynamoDB (On-Demand) | 20M WRU + 40M RRU + 150 GB storage | $58.75 | ₪217.38 |
| Amazon OpenSearch Serverless (AOSS) | 4.0 OCUs + 250 GB index | $813.80 | ₪3,011.06 |
| AWS Lambda | 30M invocations (15M GB-s) | $206.00 | ₪762.20 |
| Amazon API Gateway | 20M requests | $76.00 | ₪281.20 |
| Amazon SQS, KMS, CloudWatch | 1 CMK + 250 GB logs + 20 alarms | $145.50 | ₪538.35 |
| Data Transfer Out | 1 TB external downloads | $81.00 | ₪299.70 |
| **Total Monthly Cost** | | **$1,789.05** | **₪6,619.49** |

---

## 5. Cost Optimization Levers & Architecture Best Practices

To maximize ROI and minimize ongoing AWS operational expense, implement the following architectural cost optimizations:

### 1. Amazon S3 Lifecycle & Intelligent Tiering
- **Current State:** S3 Standard at $0.025/GB-mo.
- **Optimization:** Configure S3 Lifecycle rules:
  - Transition binaries older than 90 days to **S3 Intelligent-Tiering** or **S3 Standard-IA** ($0.0135/GB-mo, **46% savings**).
  - Transition audit logs older than 365 days to **S3 Glacier Instant Retrieval** ($0.0045/GB-mo, **82% savings**).
  - For a 50 TB repository, moving 40 TB of aged records saves over **$5,000 USD / ₪18,500 ILS per year**.

### 2. OpenSearch Serverless Capacity Tuning
- In non-production environments (Dev/Test/Staging), set OpenSearch Serverless maximum capacity limits (`max_indexing_search_ocu: 0.5` or `1.0`) to avoid over-allocating standby compute units.
- In production, AOSS auto-scales compute units down during non-peak business hours (night/weekends), reducing actual monthly billable OCU-hours by 30–40%.

### 3. AWS Lambda on Graviton (ARM64 Architecture)
- Switching Lambda execution architecture from x86_64 to ARM64 (AWS Graviton) yields a **20% price reduction** ($0.0000133334 vs $0.0000166667 per GB-s) and typically runs Node.js 20 workloads 15–25% faster, compounding total compute savings to **~35%**.

### 4. DynamoDB Auto-Scaling Provisioned Capacity for Predictable Steady-State
- For high-volume steady-state enterprise production (>5,000 sustained RPS), switching the DynamoDB table from On-Demand to Provisioned Capacity with AWS Application Auto-Scaling reduces per-unit costs by **up to 65%**.

### 5. Presigned S3 Direct Downloads
- Bypassing API Gateway and Lambda for document payloads (>4 MB) and utilizing presigned S3 GET URLs saves **$3.80 per million requests** on API Gateway binary payload overhead and prevents Lambda execution duration timeout padding.

---

## 6. Multi-Year Total Cost of Ownership (TCO) Projections
 
| Operational Tier | Monthly Ingestion & Volume | 1-Year Projected TCO (USD) | 3-Year Projected TCO (USD) | 5-Year Projected TCO (USD) | Effective Monthly Unit Cost |
|---|---|---|---|---|---|
| **POC / Dev** | 10k docs/mo (50k total) | **$4,620 – $5,040** | **$13,860 – $15,120** | **$23,100 – $25,200** | ~$0.0080 / doc |
| **Mid-Market / Dept** | 250k docs/mo (1.5M total) | **$5,520 – $6,240** | **$16,560 – $18,720** | **$27,600 – $31,200** | ~$0.0003 / doc |
| **Enterprise Banking Scale** | 2M docs/mo (15M total) | **$13,440 – $16,200** | **$40,320 – $48,600** | **$67,200 – $81,000** | ~$0.00008 / doc |
| **Massive Archive Tier** | 10M docs/mo (100M total) | **$46,200 – $55,200** | **$138,600 – $165,600** | **$231,000 – $276,000** | ~$0.00004 / doc |

---

## 7. Interactive Visual Cost Calculator

An interactive, visual cost calculator with real-time currency conversion (USD/ILS), dynamic sliders, tier presets, and visual breakdowns is provided at:
- **Local / Deployment Web App:** `cost_calculator.html`
- **Serverless Web Portal:** Integrated interactive calculator accessible via `cost_calculator.html` and CloudFront portal.
