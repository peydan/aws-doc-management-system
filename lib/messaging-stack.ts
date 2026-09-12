import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface MessagingStackProps extends cdk.StackProps {}

export class MessagingStack extends cdk.Stack {
  public readonly indexDlq: sqs.Queue;
  public readonly indexQueue: sqs.Queue;
  public readonly streamDlq: sqs.Queue;
  public readonly enrichmentDlq: sqs.Queue;
  public readonly enrichmentQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props?: MessagingStackProps) {
    super(scope, id, props);

    this.indexDlq = new sqs.Queue(this, 'IndexDLQ', {
      queueName: 'doc-platform-mvp-index-dlq',
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.streamDlq = new sqs.Queue(this, 'StreamDLQ', {
      queueName: 'doc-platform-mvp-stream-dlq',
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.indexQueue = new sqs.Queue(this, 'IndexQueue', {
      queueName: 'doc-platform-mvp-index-queue',
      visibilityTimeout: cdk.Duration.seconds(120),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: this.indexDlq,
      },
    });

    this.enrichmentDlq = new sqs.Queue(this, 'EnrichmentDLQ', {
      queueName: 'doc-platform-mvp-enrichment-dlq',
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.enrichmentQueue = new sqs.Queue(this, 'EnrichmentQueue', {
      queueName: 'doc-platform-mvp-enrichment-queue',
      visibilityTimeout: cdk.Duration.seconds(120),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: this.enrichmentDlq,
      },
    });
  }
}
