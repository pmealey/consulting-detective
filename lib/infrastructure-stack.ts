import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

/**
 * Infrastructure stack -- resources with persistent data that must survive
 * application redeployments.
 *
 * This stack should rarely change. Anything stateless (Lambdas, API Gateway,
 * CloudFront, S3 for static assets, Step Functions) belongs in the application
 * stack, which can be freely torn down and recreated.
 *
 * Resources here use custom names and RETAIN removal policies so they survive
 * even if the stack is accidentally deleted.
 */
export class InfrastructureStack extends cdk.Stack {
  /** The DynamoDB table storing generated cases. */
  public readonly casesTable: dynamodb.ITable;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ============================================
    // DynamoDB Tables
    // ============================================

    this.casesTable = new dynamodb.Table(this, 'CasesTable', {
      tableName: 'ConsultingDetective-Cases',
      partitionKey: { name: 'caseDate', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ============================================
    // Outputs
    // ============================================

    new cdk.CfnOutput(this, 'CasesTableName', {
      value: this.casesTable.tableName,
      description: 'DynamoDB Cases table name',
      exportName: 'ConsultingDetective-CasesTableName',
    });

    new cdk.CfnOutput(this, 'CasesTableArn', {
      value: this.casesTable.tableArn,
      description: 'DynamoDB Cases table ARN',
      exportName: 'ConsultingDetective-CasesTableArn',
    });
  }
}
