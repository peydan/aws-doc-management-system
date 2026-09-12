import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface MessagingStackProps extends cdk.StackProps {
  environment?: string;
}

export class MessagingStack extends cdk.Stack {
  public readonly indexDlq: sqs.Queue;
  public readonly indexQueue: sqs.Queue;
  public readonly streamDlq: sqs.Queue;
  public readonly enrichmentDlq: sqs.Queue;
  public readonly enrichmentQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props?: MessagingStackProps) {
    super(scope, id, props);

    const prefix = props?.environment && props.environment !== 'mvp' && props.environment !== 'dev'
      ? `doc-platform-${props.environment}`
      : 'doc-platform-mvp';

    this.indexDlq = new sqs.Queue(this, 'IndexDLQ', {
      queueName: `${prefix}-index-dlq`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.streamDlq = new sqs.Queue(this, 'StreamDLQ', {
      queueName: `${prefix}-stream-dlq`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.indexQueue = new sqs.Queue(this, 'IndexQueue', {
      queueName: `${prefix}-index-queue`,
      visibilityTimeout: cdk.Duration.seconds(120),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: this.indexDlq,
      },
    });

    this.enrichmentDlq = new sqs.Queue(this, 'EnrichmentDLQ', {
      queueName: `${prefix}-enrichment-dlq`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.enrichmentQueue = new sqs.Queue(this, 'EnrichmentQueue', {
      queueName: `${prefix}-enrichment-queue`,
      visibilityTimeout: cdk.Duration.seconds(120),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: this.enrichmentDlq,
      },
    });
  }
}
