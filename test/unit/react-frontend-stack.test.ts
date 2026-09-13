import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ServerlessReactFrontendStack } from '../../lib/serverless-react-frontend-stack';

describe('ServerlessReactFrontendStack Infrastructure & Security Assertions', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const env = { account: '123456789012', region: 'us-east-1' };

    const reactStack = new ServerlessReactFrontendStack(app, 'TestReactFrontendStack', {
      env,
    });

    template = Template.fromStack(reactStack);
  });

  test('Creates a private dedicated S3 bucket with S3-managed encryption and SSL enforcement', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'doc-platform-react-ui-123456789012-us-east-1',
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'AES256',
            },
          },
        ],
      },
    });

    // Enforce SSL bucket policy
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 's3:*',
            Condition: {
              Bool: {
                'aws:SecureTransport': 'false',
              },
            },
            Effect: 'Deny',
          }),
        ]),
      },
    });
  });

  test('Creates CloudFront ResponseHeadersPolicy with strict enterprise security headers', () => {
    template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: {
        Name: 'DocPlatformReactSecurityHeaders-us-east-1',
        SecurityHeadersConfig: {
          ContentTypeOptions: { Override: true },
          FrameOptions: {
            FrameOption: 'SAMEORIGIN',
            Override: true,
          },
          ReferrerPolicy: {
            ReferrerPolicy: 'strict-origin-when-cross-origin',
            Override: true,
          },
          StrictTransportSecurity: {
            AccessControlMaxAgeSec: 31536000,
            IncludeSubdomains: true,
            Override: true,
            Preload: true,
          },
          XSSProtection: {
            ModeBlock: true,
            Override: true,
            Protection: true,
          },
        },
      },
    });
  });

  test('Configures CloudFront Distribution with HTTPS redirect, S3 origin, and SPA error rewrites', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'redirect-to-https',
          Compress: true,
          AllowedMethods: ['GET', 'HEAD', 'OPTIONS'],
          CachedMethods: ['GET', 'HEAD', 'OPTIONS'],
        }),
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({
            ErrorCode: 403,
            ResponseCode: 200,
            ResponsePagePath: '/index.html',
          }),
          Match.objectLike({
            ErrorCode: 404,
            ResponseCode: 200,
            ResponsePagePath: '/index.html',
          }),
        ]),
      }),
    });
  });

  test('Exports React Portal URL, Bucket Name, and Distribution ID as stack outputs', () => {
    template.hasOutput('ReactPortalUrl', {
      Description: 'Serverless React CloudFront SPA Portal URL (Dual-Run Staging)',
    });
    template.hasOutput('ReactBucketName', {
      Description: 'S3 Website Bucket for React SPA',
    });
    template.hasOutput('ReactDistributionId', {
      Description: 'CloudFront Distribution ID for React SPA',
    });
  });
});
