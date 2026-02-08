#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { InfrastructureStack } from '../lib/infrastructure-stack';
import { ConsultingDetectiveStack } from '../lib/consulting-detective-stack';

const app = new cdk.App();

const env = { account: '742476389068', region: 'us-east-1' };

// Infrastructure stack — persistent data resources (DynamoDB).
// Rarely changes. Safe to deploy independently.
const infra = new InfrastructureStack(app, 'ConsultingDetectiveInfraStack', { env });

// Application stack — stateless resources (Lambdas, API Gateway, CloudFront,
// S3 static assets, Step Functions). Can be freely torn down and recreated.
// Depends on the infrastructure stack for the DynamoDB table.
new ConsultingDetectiveStack(app, 'ConsultingDetectiveStack', {
  env,
  casesTable: infra.casesTable,
});
