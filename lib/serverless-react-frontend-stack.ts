import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export interface ServerlessReactFrontendStackProps extends cdk.StackProps {
  api?: apigateway.RestApi;
  userPool?: cognito.IUserPool;
  userPoolClient?: cognito.IUserPoolClient;
}

export class ServerlessReactFrontendStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;
  public readonly websiteBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: ServerlessReactFrontendStackProps) {
    super(scope, id, props);

    // 1. Dedicated Private S3 Bucket for React Static Assets (Zero Contamination)
    this.websiteBucket = new s3.Bucket(this, 'ReactPortalWebsiteBucket', {
      bucketName: `doc-platform-react-ui-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // 2. CloudFront Security Headers Response Policy
    const responseHeaderPolicy = new cloudfront.ResponseHeadersPolicy(this, 'ReactSecurityHeadersPolicy', {
      responseHeadersPolicyName: `DocPlatformReactSecurityHeaders-${this.region}`,
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.SAMEORIGIN, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(365),
          includeSubdomains: true,
          preload: true,
          override: true,
        },
        xssProtection: { protection: true, modeBlock: true, override: true },
      },
    });

    // 3. Independent CloudFront Distribution with S3 Origin
    this.distribution = new cloudfront.Distribution(this, 'ReactPortalDistribution', {
      comment: 'Doc Platform Serverless React 18 SPA Portal',
      defaultBehavior: {
        origin: new origins.S3Origin(this.websiteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        responseHeadersPolicy: responseHeaderPolicy,
        compress: true,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(10),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(10),
        },
      ],
    });

    // 4. Outputs
    new cdk.CfnOutput(this, 'ReactPortalUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
      description: 'Serverless React CloudFront SPA Portal URL (Dual-Run Staging)',
    });

    new cdk.CfnOutput(this, 'ReactBucketName', {
      value: this.websiteBucket.bucketName,
      description: 'S3 Website Bucket for React SPA',
    });

    new cdk.CfnOutput(this, 'ReactDistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront Distribution ID for React SPA',
    });
  }
}
