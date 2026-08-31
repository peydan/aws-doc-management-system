import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import { Construct } from 'constructs';

export interface ApiStackProps extends cdk.StackProps {
  documentBucket: s3.IBucket;
  auditBucket: s3.IBucket;
  controlTable: dynamodb.ITable;
  indexQueue: sqs.IQueue;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  openSearchEndpoint?: string;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    this.api = new apigateway.RestApi(this, 'DocumentApi', {
      restApiName: 'doc-platform-mvp-api',
      description: 'AWS Document Management Platform MVP REST API',
      binaryMediaTypes: ['*/*'],
      cloudWatchRole: true,
      deployOptions: {
        stageName: 'v1',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        metricsEnabled: true,
        throttlingRateLimit: 1000,
        throttlingBurstLimit: 2000,
      },
    });

    this.api.addGatewayResponse('Default4XXResponse', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent,X-Document-Metadata,X-Content-SHA256,x-correlation-id'",
        'Access-Control-Allow-Methods': "'GET,POST,PATCH,DELETE,OPTIONS'",
      },
    });

    this.api.addGatewayResponse('Default5XXResponse', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent,X-Document-Metadata,X-Content-SHA256,x-correlation-id'",
        'Access-Control-Allow-Methods': "'GET,POST,PATCH,DELETE,OPTIONS'",
      },
    });

    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [props.userPool],
      authorizerName: 'CognitoAuthorizer',
    });

    const authOptions: apigateway.MethodOptions = {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

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

    // Helper functions to attach individual handlers cleanly
    const createHandlerLambda = (name: string, filePath: string, extraEnv: Record<string, string> = {}): nodejs.NodejsFunction => {
      const fn = new nodejs.NodejsFunction(this, name, {
        runtime: lambda.Runtime.NODEJS_20_X,
        architecture: lambda.Architecture.ARM_64,
        entry: path.join(__dirname, filePath),
        handler: 'handler',
        timeout: cdk.Duration.seconds(30),
        memorySize: 512,
        bundling: {
          externalModules: [],
        },
        environment: {
          ...commonEnv,
          ...extraEnv,
        },
      });
      fn.addToRolePolicy(denyDeleteVersionPolicy);
      return fn;
    };

    // Integrations
    const uploadInlineLambda = createHandlerLambda('UploadInlineLambda', '../src/command-api/upload-inline.ts');
    const uploadDirectInitLambda = createHandlerLambda('UploadDirectInitLambda', '../src/command-api/upload-direct-init.ts');
    const uploadDirectCompleteLambda = createHandlerLambda('UploadDirectCompleteLambda', '../src/command-api/upload-direct-complete.ts');
    const uploadCancelLambda = createHandlerLambda('UploadCancelLambda', '../src/command-api/upload-cancel.ts');
    const versionCreateLambda = createHandlerLambda('VersionCreateLambda', '../src/command-api/version-create.ts');
    const metadataUpdateLambda = createHandlerLambda('MetadataUpdateLambda', '../src/command-api/metadata-update.ts');
    const softDeleteLambda = createHandlerLambda('SoftDeleteLambda', '../src/command-api/soft-delete.ts');
    const restoreLambda = createHandlerLambda('RestoreLambda', '../src/command-api/restore.ts');

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

    const commandLambdas = [
      uploadInlineLambda,
      uploadDirectInitLambda,
      uploadDirectCompleteLambda,
      uploadCancelLambda,
      versionCreateLambda,
      metadataUpdateLambda,
      softDeleteLambda,
      restoreLambda,
    ];
    for (const fn of commandLambdas) {
      props.documentBucket.grantReadWrite(fn);
      props.controlTable.grantReadWriteData(fn);
      fn.addToRolePolicy(s3AnnotationWritePolicy);
    }

    const getDocLambda = createHandlerLambda('GetDocLambda', '../src/query-api/get-document.ts');
    const listVersionsLambda = createHandlerLambda('ListVersionsLambda', '../src/query-api/list-versions.ts');
    const getVersionLambda = createHandlerLambda('GetVersionLambda', '../src/query-api/get-version.ts');
    const getMetadataLambda = createHandlerLambda('GetMetadataLambda', '../src/query-api/get-metadata.ts');
    const getDownloadUrlLambda = createHandlerLambda('GetDownloadUrlLambda', '../src/query-api/get-download-url.ts');
    const healthLambda = createHandlerLambda('HealthLambda', '../src/query-api/health.ts');

    const queryLambdas = [
      getDocLambda,
      listVersionsLambda,
      getVersionLambda,
      getMetadataLambda,
      getDownloadUrlLambda,
      healthLambda,
    ];
    for (const fn of queryLambdas) {
      props.documentBucket.grantReadWrite(fn);
      props.controlTable.grantReadData(fn);
      fn.addToRolePolicy(s3AnnotationReadPolicy);
    }

    const searchLambda = createHandlerLambda('SearchLambdaHandler', '../src/search-api/search-documents.ts');
    searchLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['aoss:APIAccessAll'],
        resources: ['*'],
      })
    );

    const corsLambda = createHandlerLambda('CorsLambdaHandler', '../src/shared/cors-handler.ts');
    const corsIntegration = new apigateway.LambdaIntegration(corsLambda);

    const addCors = (resource: apigateway.IResource) => {
      resource.addMethod('OPTIONS', corsIntegration);
    };

    // API Routes (attached to root since stageName is already 'v1')
    addCors(this.api.root);

    const documents = this.api.root.addResource('documents');
    addCors(documents);

    const uploads = this.api.root.addResource('uploads');
    addCors(uploads);

    const search = this.api.root.addResource('search');
    addCors(search);

    const health = this.api.root.addResource('health');
    addCors(health);

    // Health
    health.addMethod('GET', new apigateway.LambdaIntegration(healthLambda));

    // Search
    search.addMethod('POST', new apigateway.LambdaIntegration(searchLambda), authOptions);

    // /v1/documents
    documents.addMethod('POST', new apigateway.LambdaIntegration(uploadInlineLambda), authOptions);

    // /v1/documents/uploads
    const docUploads = documents.addResource('uploads');
    addCors(docUploads);
    docUploads.addMethod('POST', new apigateway.LambdaIntegration(uploadDirectInitLambda), authOptions);

    // /v1/uploads/{upload_id}/complete & /v1/uploads/{upload_id}
    const uploadIdRes = uploads.addResource('{upload_id}');
    addCors(uploadIdRes);
    uploadIdRes.addMethod('DELETE', new apigateway.LambdaIntegration(uploadCancelLambda), authOptions);
    const uploadCompleteRes = uploadIdRes.addResource('complete');
    addCors(uploadCompleteRes);
    uploadCompleteRes.addMethod('POST', new apigateway.LambdaIntegration(uploadDirectCompleteLambda), authOptions);

    // /v1/documents/{document_id}
    const docIdRes = documents.addResource('{document_id}');
    addCors(docIdRes);
    docIdRes.addMethod('GET', new apigateway.LambdaIntegration(getDocLambda), authOptions);

    // /v1/documents/{document_id}/versions
    const docVersions = docIdRes.addResource('versions');
    addCors(docVersions);
    docVersions.addMethod('GET', new apigateway.LambdaIntegration(listVersionsLambda), authOptions);
    docVersions.addMethod('POST', new apigateway.LambdaIntegration(versionCreateLambda), authOptions);

    // /v1/documents/{document_id}/versions/{version}
    const docVersionIdRes = docVersions.addResource('{version}');
    addCors(docVersionIdRes);
    docVersionIdRes.addMethod('GET', new apigateway.LambdaIntegration(getVersionLambda), authOptions);

    // /v1/documents/{document_id}/metadata
    const docMetadataRes = docIdRes.addResource('metadata');
    addCors(docMetadataRes);
    docMetadataRes.addMethod('GET', new apigateway.LambdaIntegration(getMetadataLambda), authOptions);
    docMetadataRes.addMethod('PATCH', new apigateway.LambdaIntegration(metadataUpdateLambda), authOptions);

    // /v1/documents/{document_id}/download
    const docDownloadRes = docIdRes.addResource('download');
    addCors(docDownloadRes);
    docDownloadRes.addMethod('GET', new apigateway.LambdaIntegration(getDownloadUrlLambda), authOptions);

    // /v1/documents/{document_id}/soft-delete & /v1/documents/{document_id}/restore
    const softDeleteRes = docIdRes.addResource('soft-delete');
    addCors(softDeleteRes);
    softDeleteRes.addMethod('POST', new apigateway.LambdaIntegration(softDeleteLambda), authOptions);

    const restoreRes = docIdRes.addResource('restore');
    addCors(restoreRes);
    restoreRes.addMethod('POST', new apigateway.LambdaIntegration(restoreLambda), authOptions);
  }
}

