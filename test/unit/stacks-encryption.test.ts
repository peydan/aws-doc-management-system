import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { SecurityStack } from '../../lib/security-stack';
import { StorageStack } from '../../lib/storage-stack';
import { ControlPlaneStack } from '../../lib/control-plane-stack';
import { MessagingStack } from '../../lib/messaging-stack';
import { SearchStack } from '../../lib/search-stack';

describe('AWS-Managed & Default Encryption Infrastructure Tests', () => {
  const env = { account: '123456789012', region: 'us-east-1' };

  test('SecurityStack contains no AWS::KMS::Key resources', () => {
    const app = new cdk.App();
    const securityStack = new SecurityStack(app, 'TestSecurityStack', { env });
    const template = Template.fromStack(securityStack);

    template.resourceCountIs('AWS::KMS::Key', 0);
  });

  test('StorageStack buckets use S3_MANAGED (AES256) and have no cross-stack imports', () => {
    const app = new cdk.App();
    const storageStack = new StorageStack(app, 'TestStorageStack', { env });
    const template = Template.fromStack(storageStack);

    // Both DocumentBucket and AuditBucket must have SSEAlgorithm: AES256 (S3_MANAGED)
    template.allResourcesProperties('AWS::S3::Bucket', {
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

    const templateJson = JSON.stringify(template.toJSON());
    expect(templateJson).not.toContain('Fn::ImportValue');
  });

  test('ControlPlaneStack table uses TableEncryption.AWS_MANAGED and no cross-stack imports', () => {
    const app = new cdk.App();
    const controlPlaneStack = new ControlPlaneStack(app, 'TestControlPlaneStack', { env });
    const template = Template.fromStack(controlPlaneStack);

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'doc-platform-mvp-control',
      SSESpecification: {
        SSEEnabled: true,
      },
    });

    const templateJson = JSON.stringify(template.toJSON());
    expect(templateJson).not.toContain('Fn::ImportValue');
  });

  test('MessagingStack uses SQS_MANAGED encryption on all 5 queues with no cross-stack imports', () => {
    const app = new cdk.App();
    const messagingStack = new MessagingStack(app, 'TestMessagingStack', { env });
    const template = Template.fromStack(messagingStack);

    // All 5 queues should have SqsManagedSseEnabled: true and no custom KMS key
    template.allResourcesProperties('AWS::SQS::Queue', {
      SqsManagedSseEnabled: true,
    });

    const queues = template.findResources('AWS::SQS::Queue');
    expect(Object.keys(queues).length).toBe(5);

    for (const queue of Object.values(queues)) {
      expect((queue as any).Properties.KmsMasterKeyId).toBeUndefined();
    }

    const templateJson = JSON.stringify(template.toJSON());
    expect(templateJson).not.toContain('Fn::ImportValue');
  });

  test('SearchStack encryption policy uses AWSOwnedKey and requires no KMS prop', () => {
    const app = new cdk.App();
    const searchStack = new SearchStack(app, 'TestSearchStack', { env });
    const template = Template.fromStack(searchStack);

    template.hasResourceProperties('AWS::OpenSearchServerless::SecurityPolicy', {
      Type: 'encryption',
      Policy: Match.stringLikeRegexp('"AWSOwnedKey":true'),
    });
  });
});
