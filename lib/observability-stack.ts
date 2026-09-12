import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Construct } from 'constructs';

export interface ObservabilityStackProps extends cdk.StackProps {
  indexDlq: sqs.IQueue;
  streamDlq?: sqs.IQueue;
  enrichmentDlq?: sqs.IQueue;
  api: apigateway.IRestApi;
}

export class ObservabilityStack extends cdk.Stack {
  public readonly opsTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    // 0. Operations Notification Topic
    this.opsTopic = new sns.Topic(this, 'OpsAlertTopic', {
      topicName: 'doc-platform-mvp-ops-alerts',
      displayName: 'Document Platform Operations Alerts',
    });

    // 1. Alarm on Index DLQ Depth > 0
    const dlqAlarm = new cloudwatch.Alarm(this, 'IndexDLQMessagesAlarm', {
      alarmName: 'doc-platform-mvp-dlq-messages',
      alarmDescription: 'Alert when messages land in the OpenSearch Index Dead-Letter Queue',
      metric: props.indexDlq.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });
    dlqAlarm.addAlarmAction(new cw_actions.SnsAction(this.opsTopic));

    // 2. Alarm on Stream DLQ Depth > 0
    if (props.streamDlq) {
      const streamDlqAlarm = new cloudwatch.Alarm(this, 'StreamDLQMessagesAlarm', {
        alarmName: 'doc-platform-mvp-stream-dlq-messages',
        alarmDescription: 'Alert when messages land in the DynamoDB Stream Processing Dead-Letter Queue',
        metric: props.streamDlq.metricApproximateNumberOfMessagesVisible({
          period: cdk.Duration.minutes(1),
        }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      });
      streamDlqAlarm.addAlarmAction(new cw_actions.SnsAction(this.opsTopic));
    }

    // 3. Alarm on Enrichment DLQ Depth > 0
    if (props.enrichmentDlq) {
      const enrichmentDlqAlarm = new cloudwatch.Alarm(this, 'EnrichmentDLQMessagesAlarm', {
        alarmName: 'doc-platform-mvp-enrichment-dlq-messages',
        alarmDescription: 'Alert when messages land in the Bedrock Metadata Enrichment Dead-Letter Queue',
        metric: props.enrichmentDlq.metricApproximateNumberOfMessagesVisible({
          period: cdk.Duration.minutes(1),
        }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      });
      enrichmentDlqAlarm.addAlarmAction(new cw_actions.SnsAction(this.opsTopic));
    }

    // 4. Alarm on API 5xx Error Rate
    const api5xxAlarm = new cloudwatch.Alarm(this, 'ApiGateway5xxAlarm', {
      alarmName: 'doc-platform-mvp-api-5xx',
      alarmDescription: 'Alert when API Gateway 5xx server error rate increases',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: '5XXError',
        dimensionsMap: { ApiName: 'doc-platform-mvp-api' },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });
    api5xxAlarm.addAlarmAction(new cw_actions.SnsAction(this.opsTopic));

    new cdk.CfnOutput(this, 'OpsAlertTopicArn', {
      value: this.opsTopic.topicArn,
      description: 'SNS Topic ARN for operational alerts',
    });

    // 5. CloudWatch Dashboard
    const dashboard = new cloudwatch.Dashboard(this, 'PlatformDashboard', {
      dashboardName: 'doc-platform-mvp-dashboard',
    });

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'API Gateway Requests and Errors',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'Count',
            dimensionsMap: { ApiName: 'doc-platform-mvp-api' },
            statistic: 'Sum',
          }),
        ],
        right: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: '5XXError',
            dimensionsMap: { ApiName: 'doc-platform-mvp-api' },
            statistic: 'Sum',
          }),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: 'SQS Dead-Letter Queues (DLQ) Depth',
        left: [
          props.indexDlq.metricApproximateNumberOfMessagesVisible({ label: 'Index DLQ' }),
          ...(props.streamDlq ? [props.streamDlq.metricApproximateNumberOfMessagesVisible({ label: 'Stream DLQ' })] : []),
          ...(props.enrichmentDlq ? [props.enrichmentDlq.metricApproximateNumberOfMessagesVisible({ label: 'Enrichment DLQ' })] : []),
        ],
      })
    );
  }
}
