# AWS Document Management Platform — Production Deployment Guide

This guide describes how to build, containerize, and deploy the **hardened, internet-facing Streamlit application** ([`app_for_deployment.py`](file:///Users/danielpeyser/dev/aws%20document%20management/app_for_deployment.py) and [`api_client_for_deployment.py`](file:///Users/danielpeyser/dev/aws%20document%20management/api_client_for_deployment.py)) to AWS.

---

## 1. Architecture Overview

```text
+---------------------------------------------------------------------------------------------------------------+
|                             INTERNET-FACING AWS DEPLOYMENT ARCHITECTURE                                       |
+---------------------------------------------------------------------------------------------------------------+
                                            │
                                            ▼
                     ┌──────────────────────────────────────────────┐
                     │          AWS WAF (Web App Firewall)          │
                     │  • Rate Limiting & Managed Core Rule Set     │
                     └──────────────────────┬───────────────────────┘
                                            │
                                            ▼
                     ┌──────────────────────────────────────────────┐
                     │      Application Load Balancer (ALB)         │
                     │  • HTTPS (Port 443) with ACM Certificate     │
                     │  • Cookie Stickiness enabled for WebSockets  │
                     └──────────────────────┬───────────────────────┘
                                            │
                                            ▼ (Private Subnet / Port 8501)
                     ┌──────────────────────────────────────────────┐
                     │    Amazon ECS Fargate (Private Subnets)      │
                     │  • Non-root container user (`appuser`)       │
                     │  • IMDSv2 Enforced (`HopLimit: 1`)           │
                     │  • Locked API_URL environment variable       │
                     └──────────────┬───────────────────────────────┘
                                    │
               ┌────────────────────┴────────────────────┐
               ▼                                         ▼
┌──────────────────────────────┐          ┌──────────────────────────────┐
│  AWS Cognito User Pool       │          │  AWS API Gateway REST APIs   │
│  • JWT Authentication        │          │  • Role-Based Access Control │
│  • RBAC Group Enforcement    │          │  • S3 & DynamoDB Operations  │
└──────────────────────────────┘          └──────────────────────────────┘
```

---

## 2. File Organization: Dev vs. Deployment

| File | Purpose | Execution Command |
| :--- | :--- | :--- |
| **`app.py`**<br>`api_client.py` | **Local Developer Workbench** (includes mock auth injection, proxy scans, debug toggles). | `npm run gui`<br>*(Runs on port 8501)* |
| **`app_for_deployment.py`**<br>`api_client_for_deployment.py` | **Hardened Internet-Facing Portal** (mandatory Cognito gate, SSRF protection, strict TLS, unprivileged container). | `npm run gui:deploy`<br>*(Runs on port 8502)* |

---

## 3. Local Container Testing with Docker

Before deploying to AWS, test the deployment container locally:

```bash
# 1. Build the deployment Docker image
docker build -f Dockerfile.for_deployment -t doc-platform-streamlit-for-deployment:latest .

# 2. Run container locally with environment variables
docker run -p 8501:8501 \
  -e API_URL="https://your-api-id.execute-api.us-east-1.amazonaws.com/v1" \
  -e COGNITO_CLIENT_ID="your-cognito-client-id" \
  -e COGNITO_USER_POOL_ID="us-east-1_xxxxxx" \
  -e COGNITO_REGION="us-east-1" \
  --name doc-platform-ui-deploy \
  doc-platform-streamlit-for-deployment:latest
```

---

## 4. Deploying to AWS via AWS CDK

The CDK stack [`lib/frontend-stack.ts`](file:///Users/danielpeyser/dev/aws%20document%20management/lib/frontend-stack.ts) provisions an Application Load Balanced ECS Fargate Service in private subnets with auto-scaling and health checks.

### Step 1: Synthesize and Deploy CDK Stacks

```bash
# Compile TypeScript
npm run build

# Deploy all stacks including FrontendStack
npx cdk deploy DocPlatformFrontendStack
```

### Step 2: Retrieve Public ALB Endpoint

```bash
aws cloudformation describe-stacks \
  --stack-name DocPlatformFrontendStack \
  --query "Stacks[0].Outputs[?OutputKey=='StreamlitServiceUrl'].OutputValue" \
  --output text
```
