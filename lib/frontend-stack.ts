import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export interface FrontendStackProps extends cdk.StackProps {
  api: apigateway.RestApi;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
}

export class FrontendStack extends cdk.Stack {
  public readonly fargateService: ecs_patterns.ApplicationLoadBalancedFargateService;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    // 1. Lightweight VPC (2 AZs, 0 NAT Gateways to minimize costs, Public Subnets only)
    const vpc = new ec2.Vpc(this, 'FrontendVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    });

    // 2. ECS Cluster
    const cluster = new ecs.Cluster(this, 'FrontendCluster', {
      vpc,
      clusterName: 'doc-platform-frontend-cluster',
    });

    // 3. Reference existing ECR repository with the pre-built amd64 image
    const repository = ecr.Repository.fromRepositoryName(this, 'StreamlitRepo', 'streamlit-app');

    // 4. Application Load Balanced Fargate Service (Native WebSocket support)
    this.fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      'StreamlitFargateService',
      {
        cluster,
        serviceName: 'doc-platform-streamlit-portal',
        cpu: 256, // 0.25 vCPU (Lightest footprint)
        memoryLimitMiB: 512, // 512 MiB (Lightest footprint)
        desiredCount: 1,
        assignPublicIp: true,
        taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
        publicLoadBalancer: true,
        taskImageOptions: {
          image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
          containerPort: 8501,
          containerName: 'streamlit-portal',
          environment: {
            API_URL: props.api.url,
            COGNITO_CLIENT_ID: props.userPoolClient.userPoolClientId,
            COGNITO_USER_POOL_ID: props.userPool.userPoolId,
            COGNITO_REGION: this.region,
            PORT: '8501',
            STREAMLIT_SERVER_PORT: '8501',
            STREAMLIT_SERVER_ADDRESS: '0.0.0.0',
            STREAMLIT_SERVER_HEADLESS: 'true',
            STREAMLIT_SERVER_ENABLE_CORS: 'false',
            STREAMLIT_SERVER_ENABLE_XSRF_PROTECTION: 'false',
            STREAMLIT_BROWSER_GATHER_USAGE_STATS: 'false',
          },
          enableLogging: true,
        },
      }
    );

    // 5. Health Check on ALB Target Group for Streamlit
    this.fargateService.targetGroup.configureHealthCheck({
      path: '/_stcore/health',
      port: '8501',
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(5),
    });

    // 6. Sticky Sessions for Streamlit WebSocket connections
    this.fargateService.targetGroup.enableCookieStickiness(cdk.Duration.hours(1));

    // 7. Output public URL
    new cdk.CfnOutput(this, 'StreamlitServiceUrl', {
      value: `http://${this.fargateService.loadBalancer.loadBalancerDnsName}`,
      description: 'Public URL for Streamlit Portal (Application Load Balancer with WebSocket support)',
    });
  }
}
