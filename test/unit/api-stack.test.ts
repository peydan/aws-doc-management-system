import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ApiStack } from '../../lib/api-stack';

describe('ApiStack Infrastructure & CORS Architecture Assertions', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const env = { account: '123456789012', region: 'us-east-1' };
    const setupStack = new cdk.Stack(app, 'SetupStack', { env });

    const documentBucket = new s3.Bucket(setupStack, 'DocBucket');
    const auditBucket = new s3.Bucket(setupStack, 'AuditBucket');
    const controlTable = new dynamodb.Table(setupStack, 'ControlTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
    });
    const indexQueue = new sqs.Queue(setupStack, 'IndexQueue');
    const userPool = new cognito.UserPool(setupStack, 'UserPool');
    const userPoolClient = new cognito.UserPoolClient(setupStack, 'UserPoolClient', { userPool });

    const apiStack = new ApiStack(app, 'TestApiStack', {
      env,
      documentBucket,
      auditBucket,
      controlTable,
      indexQueue,
      userPool,
      userPoolClient,
      openSearchEndpoint: 'https://test-opensearch.us-east-1.aoss.amazonaws.com',
    });

    template = Template.fromStack(apiStack);
  });

  test('REST API is configured with binaryMediaTypes */*', () => {
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
      BinaryMediaTypes: ['*/*'],
    });
  });

  test('All OPTIONS methods use MOCK integration (not Lambda integration)', () => {
    const methods = template.findResources('AWS::ApiGateway::Method', {
      Properties: {
        HttpMethod: 'OPTIONS',
      },
    });

    const methodKeys = Object.keys(methods);
    expect(methodKeys.length).toBeGreaterThan(15);

    for (const key of methodKeys) {
      const method = methods[key];
      expect(method.Properties.Integration.Type).toEqual('MOCK');
    }
  });

  test('All OPTIONS methods have ContentHandling: CONVERT_TO_TEXT on both request and 200 response', () => {
    const methods = template.findResources('AWS::ApiGateway::Method', {
      Properties: {
        HttpMethod: 'OPTIONS',
      },
    });

    for (const [key, method] of Object.entries(methods)) {
      const integration = method.Properties.Integration;

      // Integration Request must specify CONVERT_TO_TEXT to avoid 500 binary transformation failures
      expect(integration.ContentHandling).toEqual('CONVERT_TO_TEXT');

      // passthroughBehavior must NOT be NEVER
      expect(integration.PassthroughBehavior).not.toEqual('NEVER');

      // Integration Responses must have statusCode 200 with CONVERT_TO_TEXT
      const integrationResponses = integration.IntegrationResponses || [];
      const resp200 = integrationResponses.find((r: any) => r.StatusCode === '200');
      expect(resp200).toBeDefined();
      expect(resp200.ContentHandling).toEqual('CONVERT_TO_TEXT');

      // Headers must include standard CORS headers
      const responseParams = resp200.ResponseParameters || {};
      expect(responseParams['method.response.header.Access-Control-Allow-Origin']).toEqual("'*'");
      expect(responseParams['method.response.header.Access-Control-Allow-Methods']).toContain('POST');
    }
  });

  test('Default 4XX and 5XX Gateway Responses include Access-Control-Allow-Origin: *', () => {
    template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
      ResponseType: 'DEFAULT_4XX',
      ResponseParameters: {
        'gatewayresponse.header.Access-Control-Allow-Origin': "'*'",
      },
    });

    template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
      ResponseType: 'DEFAULT_5XX',
      ResponseParameters: {
        'gatewayresponse.header.Access-Control-Allow-Origin': "'*'",
      },
    });
  });

  test('No single Lambda function has excessive permissions (>10) that risk the 20KB policy limit', () => {
    const permissions = template.findResources('AWS::Lambda::Permission');
    const functionPermissionCounts: Record<string, number> = {};

    for (const [, perm] of Object.entries(permissions)) {
      const fnRef = JSON.stringify(perm.Properties.FunctionName);
      functionPermissionCounts[fnRef] = (functionPermissionCounts[fnRef] || 0) + 1;
    }

    for (const [fnRef, count] of Object.entries(functionPermissionCounts)) {
      expect(count).toBeLessThanOrEqual(10);
    }
  });

  test('All API Lambda functions have timeout <= 29 seconds to match API Gateway limit', () => {
    const lambdas = template.findResources('AWS::Lambda::Function');
    for (const [key, fn] of Object.entries(lambdas)) {
      const timeout = fn.Properties.Timeout;
      if (timeout) {
        expect(timeout).toBeLessThanOrEqual(29);
      }
    }
  });
});
