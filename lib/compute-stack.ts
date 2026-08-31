import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'path';
import { Construct } from 'constructs';

export interface ComputeStackProps extends cdk.StackProps {
  documentBucket: s3.IBucket;
  auditBucket: s3.IBucket;
  controlTable: dynamodb.ITable;
  indexQueue: sqs.IQueue;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  openSearchEndpoint?: string;
}

export class ComputeStack extends cdk.Stack {
  public readonly commandApiFunction: nodejs.NodejsFunction;
  public readonly queryApiFunction: nodejs.NodejsFunction;
  public readonly searchApiFunction: nodejs.NodejsFunction;
  public readonly backgroundWorkerFunction: nodejs.NodejsFunction;
  public readonly indexerFunction: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const commonEnv = {
      DOCUMENT_BUCKET_NAME: props.documentBucket.bucketName,
      AUDIT_BUCKET_NAME: props.auditBucket.bucketName,
      DYNAMODB_TABLE_NAME: props.controlTable.tableName,
      INDEX_QUEUE_URL: props.indexQueue.queueUrl,
      COGNITO_USER_POOL_ID: props.userPool.userPoolId,
      COGNITO_CLIENT_ID: props.userPoolClient.userPoolClientId,
      OPENSEARCH_ENDPOINT: props.openSearchEndpoint || '',
      INLINE_UPLOAD_MAX_BYTES: '4194304',
    };

    const denyDeleteVersionPolicy = new iam.PolicyStatement({
      effect: iam.Effect.DENY,
      actions: ['s3:DeleteObjectVersion'],
      resources: ['*'],
    });

    // 1. Command API Function
    this.commandApiFunction = new nodejs.NodejsFunction(this, 'CommandApiFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(__dirname, '../src/command-api/upload-inline.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 1024,
      bundling: {
        externalModules: [],
      },
      environment: commonEnv,
    });

    const s3AnnotationWritePolicy = new iam.PolicyStatement({
      actions: [
        's3:PutObjectAnnotation',
        's3:PutObjectVersionAnnotation',
        's3:GetObjectAnnotation',
        's3:GetObjectVersionAnnotation',
        's3:DeleteObjectAnnotation',
        's3:DeleteObjectVersionAnnotation',
        's3:ListObjectAnnotations',
        's3:ListObjectVersionAnnotations',
      ],
      resources: [`${props.documentBucket.bucketArn}/*`],
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

    props.documentBucket.grantReadWrite(this.commandApiFunction);
    props.controlTable.grantReadWriteData(this.commandApiFunction);
    this.commandApiFunction.addToRolePolicy(s3AnnotationWritePolicy);
    this.commandApiFunction.addToRolePolicy(denyDeleteVersionPolicy);

    // 2. Query API Function
    this.queryApiFunction = new nodejs.NodejsFunction(this, 'QueryApiFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(__dirname, '../src/query-api/get-document.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(15),
      memorySize: 512,
      bundling: {
        externalModules: [],
      },
      environment: commonEnv,
    });

    props.documentBucket.grantReadWrite(this.queryApiFunction);
    props.controlTable.grantReadData(this.queryApiFunction);
    this.queryApiFunction.addToRolePolicy(s3AnnotationReadPolicy);
    this.queryApiFunction.addToRolePolicy(denyDeleteVersionPolicy);

    // 3. Search API Function
    this.searchApiFunction = new nodejs.NodejsFunction(this, 'SearchApiFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(__dirname, '../src/search-api/search-documents.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(15),
      memorySize: 512,
      bundling: {
        externalModules: [],
      },
      environment: commonEnv,
    });

    this.searchApiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['aoss:APIAccessAll'],
        resources: ['*'],
      })
    );
    this.searchApiFunction.addToRolePolicy(denyDeleteVersionPolicy);

    // 4. Background Stream Processor Worker
    this.backgroundWorkerFunction = new nodejs.NodejsFunction(this, 'BackgroundWorkerFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(__dirname, '../src/background-worker/stream-processor.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      bundling: {
        externalModules: [],
      },
      environment: commonEnv,
    });

    props.auditBucket.grantWrite(this.backgroundWorkerFunction);
    props.indexQueue.grantSendMessages(this.backgroundWorkerFunction);
    this.backgroundWorkerFunction.addToRolePolicy(denyDeleteVersionPolicy);

    if (props.controlTable.tableStreamArn) {
      this.backgroundWorkerFunction.addEventSource(
        new lambdaEventSources.DynamoEventSource(props.controlTable as dynamodb.Table, {
          startingPosition: lambda.StartingPosition.LATEST,
          batchSize: 10,
          retryAttempts: 3,
        })
      );
    }

    // 5. Indexer Consumer Function
    this.indexerFunction = new nodejs.NodejsFunction(this, 'IndexerFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(__dirname, '../src/background-worker/indexer.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      bundling: {
        externalModules: [],
      },
      environment: commonEnv,
    });

    props.documentBucket.grantRead(this.indexerFunction);
    props.controlTable.grantReadData(this.indexerFunction);
    props.indexQueue.grantConsumeMessages(this.indexerFunction);
    this.indexerFunction.addToRolePolicy(s3AnnotationReadPolicy);
    this.indexerFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['aoss:APIAccessAll'],
        resources: ['*'],
      })
    );
    this.indexerFunction.addToRolePolicy(denyDeleteVersionPolicy);

    this.indexerFunction.addEventSource(
      new lambdaEventSources.SqsEventSource(props.indexQueue, {
        batchSize: 5,
      })
    );
  }
}
