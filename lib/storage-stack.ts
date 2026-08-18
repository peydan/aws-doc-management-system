import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface StorageStackProps extends cdk.StackProps {
  kmsKey: kms.IKey;
}

export class StorageStack extends cdk.Stack {
  public readonly documentBucket: s3.Bucket;
  public readonly auditBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    // Document Content & Annotation Bucket
    this.documentBucket = new s3.Bucket(this, 'DocumentBucket', {
      bucketName: `doc-platform-mvp-docs-${this.account}-${this.region}`,
      versioned: true,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: props.kmsKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    // Audit Bucket
    this.auditBucket = new s3.Bucket(this, 'AuditBucket', {
      bucketName: `doc-platform-mvp-audit-${this.account}-${this.region}`,
      versioned: true,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: props.kmsKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    // Explicitly deny s3:DeleteObjectVersion to prevent permanent version deletion by any principal
    this.documentBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'DenyPermanentVersionDeletion',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['s3:DeleteObjectVersion'],
        resources: [`${this.documentBucket.bucketArn}/*`],
      })
    );
  }
}
