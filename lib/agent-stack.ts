import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import { Construct } from 'constructs';

export interface AgentStackProps extends cdk.StackProps {
  documentBucket: s3.IBucket;
  auditBucket: s3.IBucket;
  controlTable: dynamodb.ITable;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  openSearchEndpoint?: string;
}

export class AgentStack extends cdk.Stack {
  public readonly searchToolFunction: nodejs.NodejsFunction;
  public readonly fetchToolFunction: nodejs.NodejsFunction;
  public readonly chatFunction: nodejs.NodejsFunction;
  public readonly chatFunctionUrl: lambda.FunctionUrl;

  constructor(scope: Construct, id: string, props: AgentStackProps) {
    super(scope, id, props);

    const commonEnv = {
      DOCUMENT_BUCKET_NAME: props.documentBucket.bucketName,
      AUDIT_BUCKET_NAME: props.auditBucket.bucketName,
      DYNAMODB_TABLE_NAME: props.controlTable.tableName,
      COGNITO_USER_POOL_ID: props.userPool.userPoolId,
      COGNITO_CLIENT_ID: props.userPoolClient.userPoolClientId,
      OPENSEARCH_ENDPOINT: props.openSearchEndpoint || '',
      BEDROCK_MODEL_ID: process.env.BEDROCK_MODEL_ID || 'us.amazon.nova-2-lite-v1:0',
    };

    const denyDeleteVersionPolicy = new iam.PolicyStatement({
      effect: iam.Effect.DENY,
      actions: ['s3:DeleteObjectVersion'],
      resources: ['*'],
    });

    const s3AnnotationReadPolicy = new iam.PolicyStatement({
      actions: [
        's3:GetObjectAnnotation',
        's3:GetObjectVersionAnnotation',
        's3:ListObjectAnnotations',
        's3:ListObjectVersionAnnotations',
      ],
      resources: [`${props.documentBucket.bucketArn}/*`],
    });

    // 1. Agent Tool: Search Documents (OpenSearch Serverless target)
    this.searchToolFunction = new nodejs.NodejsFunction(this, 'AgentSearchToolFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(__dirname, '../src/agent/tools/search-tool.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      bundling: {
        externalModules: [],
      },
      environment: commonEnv,
    });

    this.searchToolFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['aoss:APIAccessAll'],
        resources: ['*'],
      })
    );
    this.searchToolFunction.addToRolePolicy(denyDeleteVersionPolicy);

    // 2. Agent Tool: Fetch Document (DynamoDB pointer + S3 Authoritative Annotation target)
    this.fetchToolFunction = new nodejs.NodejsFunction(this, 'AgentFetchToolFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(__dirname, '../src/agent/tools/fetch-tool.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      bundling: {
        externalModules: [],
      },
      environment: commonEnv,
    });

    props.documentBucket.grantRead(this.fetchToolFunction);
    props.controlTable.grantReadData(this.fetchToolFunction);
    this.fetchToolFunction.addToRolePolicy(s3AnnotationReadPolicy);
    this.fetchToolFunction.addToRolePolicy(denyDeleteVersionPolicy);

    // 3. Agent Chat Function (AgentCore Harness + Amazon Nova 2 Lite reasoning & SSE streaming)
    this.chatFunction = new nodejs.NodejsFunction(this, 'AgentChatFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(__dirname, '../src/agent/chat-handler.ts'),
      handler: 'streamingHandler',
      timeout: cdk.Duration.seconds(90),
      memorySize: 1024,
      bundling: {
        externalModules: [],
      },
      environment: commonEnv,
    });

    // Grant Bedrock model invocation permissions for Amazon Nova 2 Lite
    this.chatFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
          'bedrock:GetFoundationModel',
        ],
        resources: ['*'],
      })
    );

    // Grant access to tools datastores
    props.documentBucket.grantRead(this.chatFunction);
    props.controlTable.grantReadData(this.chatFunction);
    this.chatFunction.addToRolePolicy(s3AnnotationReadPolicy);
    this.chatFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['aoss:APIAccessAll'],
        resources: ['*'],
      })
    );
    this.chatFunction.addToRolePolicy(denyDeleteVersionPolicy);

    // 4. Lambda Function URL for native SSE streaming
    this.chatFunctionUrl = this.chatFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE, // Validates Bearer JWT inside handler
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.POST],
        allowedHeaders: ['*'],
        maxAge: cdk.Duration.days(1),
      },
    });

    // Stack Outputs
    new cdk.CfnOutput(this, 'AgentChatStreamingUrl', {
      value: this.chatFunctionUrl.url,
      description: 'Lambda Function URL for real-time SSE streaming with AgentCore Harness & Amazon Nova 2 Lite',
    });

    new cdk.CfnOutput(this, 'AgentSearchToolArn', {
      value: this.searchToolFunction.functionArn,
      description: 'ARN for AgentCore Gateway MCP Search Tool',
    });

    new cdk.CfnOutput(this, 'AgentFetchToolArn', {
      value: this.fetchToolFunction.functionArn,
      description: 'ARN for AgentCore Gateway MCP Fetch Tool',
    });
  }
}
