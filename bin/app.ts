#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SecurityStack } from '../lib/security-stack';
import { StorageStack } from '../lib/storage-stack';
import { ControlPlaneStack } from '../lib/control-plane-stack';
import { MessagingStack } from '../lib/messaging-stack';
import { SearchStack } from '../lib/search-stack';
import { ComputeStack } from '../lib/compute-stack';
import { ApiStack } from '../lib/api-stack';
import { ObservabilityStack } from '../lib/observability-stack';
import { ServerlessFrontendStack } from '../lib/serverless-frontend-stack';

const app = new cdk.App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1',
};

// 1. Security Stack
const securityStack = new SecurityStack(app, 'DocPlatformSecurityStack', { env });

// 2. Storage Stack
const storageStack = new StorageStack(app, 'DocPlatformStorageStack', {
  env,
  kmsKey: securityStack.kmsKey,
});

// 3. Control Plane Stack
const controlPlaneStack = new ControlPlaneStack(app, 'DocPlatformControlPlaneStack', {
  env,
  kmsKey: securityStack.kmsKey,
});

// 4. Messaging Stack
const messagingStack = new MessagingStack(app, 'DocPlatformMessagingStack', {
  env,
  kmsKey: securityStack.kmsKey,
});

// 5. Search Stack
const searchStack = new SearchStack(app, 'DocPlatformSearchStack', {
  env,
  kmsKey: securityStack.kmsKey,
});

// 6. Compute Stack
const computeStack = new ComputeStack(app, 'DocPlatformComputeStack', {
  env,
  documentBucket: storageStack.documentBucket,
  auditBucket: storageStack.auditBucket,
  controlTable: controlPlaneStack.table,
  indexQueue: messagingStack.indexQueue,
  userPool: securityStack.userPool,
  userPoolClient: securityStack.userPoolClient,
  openSearchEndpoint: searchStack.collection.attrCollectionEndpoint,
});

// 7. API Stack
const apiStack = new ApiStack(app, 'DocPlatformApiStack', {
  env,
  documentBucket: storageStack.documentBucket,
  auditBucket: storageStack.auditBucket,
  controlTable: controlPlaneStack.table,
  indexQueue: messagingStack.indexQueue,
  userPool: securityStack.userPool,
  userPoolClient: securityStack.userPoolClient,
  openSearchEndpoint: searchStack.collection.attrCollectionEndpoint,
});

// 8. Observability Stack
new ObservabilityStack(app, 'DocPlatformObservabilityStack', {
  env,
  indexDlq: messagingStack.indexDlq,
  api: apiStack.api,
});

// 9. 100% Serverless Frontend Stack (CloudFront + S3 SPA - Zero Idle Cost)
new ServerlessFrontendStack(app, 'DocPlatformServerlessFrontendStack', {
  env,
  api: apiStack.api,
  userPool: securityStack.userPool,
  userPoolClient: securityStack.userPoolClient,
});

app.synth();

