import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';

export interface MessagingStackProps extends cdk.StackProps {
  kmsKey: kms.IKey;
}

export class MessagingStack extends cdk.Stack {
  public readonly indexDlq: sqs.Queue;
  public readonly indexQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props: MessagingStackProps) {
    super(scope, id, props);

    this.indexDlq = new sqs.Queue(this, 'IndexDLQ', {
      queueName: 'doc-platform-mvp-index-dlq',
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: props.kmsKey,
    });

    this.indexQueue = new sqs.Queue(this, 'IndexQueue', {
      queueName: 'doc-platform-mvp-index-queue',
      visibilityTimeout: cdk.Duration.seconds(120),
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: props.kmsKey,
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: this.indexDlq,
      },
    });
  }
}
