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
import { AgentStack } from '../lib/agent-stack';

const app = new cdk.App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1',
};
const environment = process.env.ENVIRONMENT || 'dev';
const isProduction = environment === 'prod' || environment === 'production';

// 1. Security Stack
const securityStack = new SecurityStack(app, 'DocPlatformSecurityStack', { env, environment, isProduction });

// 2. Storage Stack
const storageStack = new StorageStack(app, 'DocPlatformStorageStack', { env });

// 3. Control Plane Stack
const controlPlaneStack = new ControlPlaneStack(app, 'DocPlatformControlPlaneStack', { env, environment });

// 4. Messaging Stack
const messagingStack = new MessagingStack(app, 'DocPlatformMessagingStack', { env, environment });

// 5. Search Stack
const searchStack = new SearchStack(app, 'DocPlatformSearchStack', {
  env,
  environment,
});

// 6. Compute Stack
const computeStack = new ComputeStack(app, 'DocPlatformComputeStack', {
  env,
  documentBucket: storageStack.documentBucket,
  auditBucket: storageStack.auditBucket,
  controlTable: controlPlaneStack.table,
  indexQueue: messagingStack.indexQueue,
  streamDlq: messagingStack.streamDlq,
  enrichmentQueue: messagingStack.enrichmentQueue,
  userPool: securityStack.userPool,
  userPoolClient: securityStack.userPoolClient,
  openSearchEndpoint: searchStack.collection.attrCollectionEndpoint,
});

// 7. API Stack
const apiStack = new ApiStack(app, 'DocPlatformApiStack', {
  env,
  environment,
  documentBucket: storageStack.documentBucket,
  auditBucket: storageStack.auditBucket,
  controlTable: controlPlaneStack.table,
  indexQueue: messagingStack.indexQueue,
  userPool: securityStack.userPool,
  userPoolClient: securityStack.userPoolClient,
  openSearchEndpoint: searchStack.collection.attrCollectionEndpoint,
});

// 8. Observability Stack
const observabilityStack = new ObservabilityStack(app, 'DocPlatformObservabilityStack', {
  env,
  indexDlq: messagingStack.indexDlq,
  streamDlq: messagingStack.streamDlq,
  enrichmentDlq: messagingStack.enrichmentDlq,
  api: apiStack.api,
});

// 9. 100% Serverless Frontend Stack (CloudFront + S3 SPA - Zero Idle Cost)
const serverlessFrontendStack = new ServerlessFrontendStack(app, 'DocPlatformServerlessFrontendStack', {
  env,
  api: apiStack.api,
  userPool: securityStack.userPool,
  userPoolClient: securityStack.userPoolClient,
});

// 10. AI Document Assistant Stack (AgentCore Harness + Amazon Nova 2 Lite + SSE Streaming)
const agentStack = new AgentStack(app, 'DocPlatformAgentStack', {
  env,
  documentBucket: storageStack.documentBucket,
  auditBucket: storageStack.auditBucket,
  controlTable: controlPlaneStack.table,
  userPool: securityStack.userPool,
  userPoolClient: securityStack.userPoolClient,
  openSearchEndpoint: searchStack.collection.attrCollectionEndpoint,
});

// Apply standard tags to all stacks (excluding SearchStack due to CloudFormation CfnCollection replacement limitation)
const taggableStacks = [
  securityStack,
  storageStack,
  controlPlaneStack,
  messagingStack,
  computeStack,
  apiStack,
  observabilityStack,
  serverlessFrontendStack,
  agentStack,
];

for (const stack of taggableStacks) {
  cdk.Tags.of(stack).add('Project', 'aws-document-management-platform');
  cdk.Tags.of(stack).add('System', 'DocPlatform');
  cdk.Tags.of(stack).add('Environment', environment);
  cdk.Tags.of(stack).add('ManagedBy', 'aws-cdk');
}

app.synth();

