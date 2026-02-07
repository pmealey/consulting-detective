#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { ConsultingDetectiveStack } from '../lib/consulting-detective-stack';

const app = new cdk.App();
new ConsultingDetectiveStack(app, 'ConsultingDetectiveStack', {
  env: { account: '742476389068', region: 'us-east-1' },
});
