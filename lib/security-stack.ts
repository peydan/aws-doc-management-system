import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export interface SecurityStackProps extends cdk.StackProps {
  environment?: string;
  isProduction?: boolean;
}

export class SecurityStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props?: SecurityStackProps) {
    super(scope, id, props);

    const userPoolName = props?.environment && props.environment !== 'mvp' && props.environment !== 'dev'
      ? `doc-platform-${props.environment}-user-pool`
      : 'doc-platform-user-pool';

    const clientName = props?.environment && props.environment !== 'mvp' && props.environment !== 'dev'
      ? `doc-platform-${props.environment}-client`
      : 'doc-platform-client';

    const removalPolicy = props?.isProduction ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    // AWS Cognito User Pool
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName,
      selfSignUpEnabled: false,
      signInAliases: { email: true, username: true },
      autoVerify: { email: true },
      removalPolicy,
    });

    // Cognito App Client
    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: clientName,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
        adminUserPassword: true,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true, implicitCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
      },
    });

    // Provision Application Groups in Cognito User Pool
    const groupRoles = ['Document.Reader', 'Document.Writer', 'Document.MetadataEditor', 'Document.Admin'];
    groupRoles.forEach((roleName) => {
      new cognito.CfnUserPoolGroup(this, `Group-${roleName}`, {
        userPoolId: this.userPool.userPoolId,
        groupName: roleName,
        description: `Application role ${roleName} for Document Management Platform`,
      });
    });

    // Provision Synthetic Test Users
    const syntheticUsers = [
      { username: 'reader-user', email: 'reader@demo.local', group: 'Document.Reader' },
      { username: 'writer-user', email: 'writer@demo.local', group: 'Document.Writer' },
      { username: 'editor-user', email: 'editor@demo.local', group: 'Document.MetadataEditor' },
      { username: 'admin-user', email: 'admin@demo.local', group: 'Document.Admin' },
    ];

    syntheticUsers.forEach((u) => {
      const user = new cognito.CfnUserPoolUser(this, `User-${u.group}`, {
        userPoolId: this.userPool.userPoolId,
        username: u.username,
        userAttributes: [
          { name: 'email', value: u.email },
          { name: 'email_verified', value: 'true' },
        ],
        messageAction: 'SUPPRESS',
      });

      new cognito.CfnUserPoolUserToGroupAttachment(this, `Attach-${u.group}`, {
        userPoolId: this.userPool.userPoolId,
        username: u.username,
        groupName: u.group,
      }).addDependency(user);
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });
  }
}
