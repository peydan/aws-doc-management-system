import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface ControlPlaneStackProps extends cdk.StackProps {
  environment?: string;
  tableName?: string;
}

export class ControlPlaneStack extends cdk.Stack {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: ControlPlaneStackProps) {
    super(scope, id, props);

    const tableName = props?.tableName || (props?.environment && props.environment !== 'mvp' && props.environment !== 'dev'
      ? `doc-platform-${props.environment}-control`
      : 'doc-platform-mvp-control');

    this.table = new dynamodb.Table(this, 'ControlTable', {
      tableName,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      timeToLiveAttribute: 'ttl_expiry',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
  }
}
