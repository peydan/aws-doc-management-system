import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';

export interface ObservabilityStackProps extends cdk.StackProps {
  indexDlq: sqs.IQueue;
  api: apigateway.IRestApi;
}

export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    // 1. Alarm on DLQ Depth > 0
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

    // 2. Alarm on API 5xx Error Rate
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

    // 3. CloudWatch Dashboard
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
        title: 'SQS Index Queue & DLQ Depth',
        left: [
          props.indexDlq.metricApproximateNumberOfMessagesVisible(),
        ],
      })
    );
  }
}
