import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as iam from 'aws-cdk-lib/aws-iam';
import { join } from 'path';

export class ConsultingDetectiveStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ============================================
    // DynamoDB Tables
    // ============================================

    const casesTable = new dynamodb.Table(this, 'CasesTable', {
      tableName: 'ConsultingDetective-Cases',
      partitionKey: { name: 'caseDate', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'caseId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ============================================
    // Lambda Environment Variables
    // ============================================

    const lambdaEnvironment = {
      CASES_TABLE_NAME: casesTable.tableName,
    };

    // ============================================
    // Lambda Functions
    // ============================================

    // Common bundling configuration - use esbuild locally (no Docker required)
    const bundlingConfig = {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      bundling: {
        minify: false,
        sourceMap: true,
        externalModules: ['@aws-sdk'],
        forceDockerBundling: false,
        format: nodejs.OutputFormat.CJS,
      },
    };

    // Health check handler
    const healthHandler = new nodejs.NodejsFunction(this, 'HealthHandler', {
      entry: join(__dirname, 'lambda/health/get.ts'),
      environment: lambdaEnvironment,
      ...bundlingConfig,
    });

    // ============================================
    // Generation Pipeline — Lambda Functions
    // ============================================

    const generationEnvironment = {
      ...lambdaEnvironment,
      BEDROCK_DEFAULT_MODEL_ID: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    };

    // Longer timeout + more memory for LLM-calling steps
    const generationLambdaConfig = {
      ...bundlingConfig,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
    };

    // Prose generation gets extra time and tokens
    const proseLambdaConfig = {
      ...generationLambdaConfig,
      timeout: cdk.Duration.minutes(10),
      memorySize: 1024,
    };

    const selectTemplateHandler = new nodejs.NodejsFunction(this, 'SelectTemplateHandler', {
      entry: join(__dirname, 'lambda/generate/select-template.ts'),
      environment: generationEnvironment,
      ...generationLambdaConfig,
    });

    const generateEventsHandler = new nodejs.NodejsFunction(this, 'GenerateEventsHandler', {
      entry: join(__dirname, 'lambda/generate/generate-events.ts'),
      environment: generationEnvironment,
      ...generationLambdaConfig,
    });

    const populateCharactersHandler = new nodejs.NodejsFunction(this, 'PopulateCharactersHandler', {
      entry: join(__dirname, 'lambda/generate/populate-characters.ts'),
      environment: generationEnvironment,
      ...generationLambdaConfig,
    });

    const buildLocationsHandler = new nodejs.NodejsFunction(this, 'BuildLocationsHandler', {
      entry: join(__dirname, 'lambda/generate/build-locations.ts'),
      environment: generationEnvironment,
      ...generationLambdaConfig,
    });

    const distributeFactsHandler = new nodejs.NodejsFunction(this, 'DistributeFactsHandler', {
      entry: join(__dirname, 'lambda/generate/distribute-facts.ts'),
      environment: generationEnvironment,
      ...generationLambdaConfig,
    });

    const designCasebookHandler = new nodejs.NodejsFunction(this, 'DesignCasebookHandler', {
      entry: join(__dirname, 'lambda/generate/design-casebook.ts'),
      environment: generationEnvironment,
      ...generationLambdaConfig,
    });

    const generateProseHandler = new nodejs.NodejsFunction(this, 'GenerateProseHandler', {
      entry: join(__dirname, 'lambda/generate/generate-prose.ts'),
      environment: generationEnvironment,
      ...proseLambdaConfig,
    });

    const createQuestionsHandler = new nodejs.NodejsFunction(this, 'CreateQuestionsHandler', {
      entry: join(__dirname, 'lambda/generate/create-questions.ts'),
      environment: generationEnvironment,
      ...generationLambdaConfig,
    });

    const computeOptimalPathHandler = new nodejs.NodejsFunction(this, 'ComputeOptimalPathHandler', {
      entry: join(__dirname, 'lambda/generate/compute-optimal-path.ts'),
      environment: lambdaEnvironment,
      ...bundlingConfig,
      timeout: cdk.Duration.seconds(30),
    });

    const validateCoherenceHandler = new nodejs.NodejsFunction(this, 'ValidateCoherenceHandler', {
      entry: join(__dirname, 'lambda/generate/validate-coherence.ts'),
      environment: lambdaEnvironment,
      ...bundlingConfig,
      timeout: cdk.Duration.seconds(30),
    });

    const storeCaseHandler = new nodejs.NodejsFunction(this, 'StoreCaseHandler', {
      entry: join(__dirname, 'lambda/generate/store-case.ts'),
      environment: lambdaEnvironment,
      ...bundlingConfig,
      timeout: cdk.Duration.seconds(30),
    });

    // ============================================
    // Generation Pipeline — IAM Permissions
    // ============================================

    // Bedrock InvokeModel for all LLM-calling lambdas (includes inference profiles)
    const bedrockPolicy = new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: [
        'arn:aws:bedrock:*::foundation-model/*',
        `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
        'arn:aws:bedrock:*:*:inference-profile/*',
      ],
    });

    // Marketplace permissions required for auto-enabling model access on first invocation
    const marketplacePolicy = new iam.PolicyStatement({
      actions: ['aws-marketplace:ViewSubscriptions', 'aws-marketplace:Subscribe'],
      resources: ['*'],
    });

    const llmHandlers = [
      selectTemplateHandler,
      generateEventsHandler,
      populateCharactersHandler,
      buildLocationsHandler,
      distributeFactsHandler,
      designCasebookHandler,
      generateProseHandler,
      createQuestionsHandler,
    ];

    for (const handler of llmHandlers) {
      handler.addToRolePolicy(bedrockPolicy);
      handler.addToRolePolicy(marketplacePolicy);
    }

    // DynamoDB write for store step
    casesTable.grantWriteData(storeCaseHandler);

    // ============================================
    // Generation Pipeline — Step Functions
    // ============================================

    const selectTemplate = new tasks.LambdaInvoke(this, 'SelectTemplate', {
      lambdaFunction: selectTemplateHandler,
      outputPath: '$.Payload',
    });

    const generateEvents = new tasks.LambdaInvoke(this, 'GenerateEvents', {
      lambdaFunction: generateEventsHandler,
      outputPath: '$.Payload',
    });

    const populateCharacters = new tasks.LambdaInvoke(this, 'PopulateCharacters', {
      lambdaFunction: populateCharactersHandler,
      outputPath: '$.Payload',
    });

    const buildLocations = new tasks.LambdaInvoke(this, 'BuildLocations', {
      lambdaFunction: buildLocationsHandler,
      outputPath: '$.Payload',
    });

    const distributeFacts = new tasks.LambdaInvoke(this, 'DistributeFacts', {
      lambdaFunction: distributeFactsHandler,
      outputPath: '$.Payload',
    });

    const designCasebook = new tasks.LambdaInvoke(this, 'DesignCasebook', {
      lambdaFunction: designCasebookHandler,
      outputPath: '$.Payload',
    });

    const generateProse = new tasks.LambdaInvoke(this, 'GenerateProse', {
      lambdaFunction: generateProseHandler,
      outputPath: '$.Payload',
    });

    const createQuestions = new tasks.LambdaInvoke(this, 'CreateQuestions', {
      lambdaFunction: createQuestionsHandler,
      outputPath: '$.Payload',
    });

    const computeOptimalPath = new tasks.LambdaInvoke(this, 'ComputeOptimalPath', {
      lambdaFunction: computeOptimalPathHandler,
      outputPath: '$.Payload',
    });

    const validateCoherence = new tasks.LambdaInvoke(this, 'ValidateCoherence', {
      lambdaFunction: validateCoherenceHandler,
      outputPath: '$.Payload',
    });

    const storeCase = new tasks.LambdaInvoke(this, 'StoreCase', {
      lambdaFunction: storeCaseHandler,
      outputPath: '$.Payload',
    });

    // Chain the steps into a sequential pipeline
    const pipelineDefinition = selectTemplate
      .next(generateEvents)
      .next(populateCharacters)
      .next(buildLocations)
      .next(distributeFacts)
      .next(designCasebook)
      .next(generateProse)
      .next(createQuestions)
      .next(computeOptimalPath)
      .next(validateCoherence)
      .next(storeCase);

    const generationStateMachine = new sfn.StateMachine(this, 'CaseGenerationPipeline', {
      stateMachineName: 'ConsultingDetective-CaseGeneration',
      definitionBody: sfn.DefinitionBody.fromChainable(pipelineDefinition),
      timeout: cdk.Duration.minutes(30),
    });

    // ============================================
    // Grant DynamoDB Permissions
    // ============================================

    casesTable.grantReadData(healthHandler);

    // ============================================
    // API Gateway
    // ============================================

    const api = new apigateway.RestApi(this, 'ConsultingDetectiveApi', {
      restApiName: 'Consulting Detective API',
      description: 'API for the Consulting Detective daily mystery game',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type'],
      },
    });

    // Health route
    const health = api.root.addResource('health');
    health.addMethod('GET', new apigateway.LambdaIntegration(healthHandler));

    // ============================================
    // S3 Bucket for Frontend Hosting
    // ============================================

    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: `consulting-detective-website-${this.account}`,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    // ============================================
    // CloudFront Distribution
    // ============================================

    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OAI', {
      comment: 'OAI for Consulting Detective website',
    });

    websiteBucket.grantRead(originAccessIdentity);

    const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeadersPolicy', {
      responseHeadersPolicyName: 'ConsultingDetectiveSecurityHeaders',
      comment: 'Security headers for Consulting Detective',
      customHeadersBehavior: {
        customHeaders: [
          {
            header: 'X-Robots-Tag',
            value: 'noindex, nofollow, noarchive, nosnippet',
            override: true,
          },
        ],
      },
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.seconds(31536000),
          includeSubdomains: true,
          override: true,
        },
        xssProtection: { protection: true, modeBlock: true, override: true },
      },
    });

    // API Gateway origin for /api/* requests
    const apiDomain = `${api.restApiId}.execute-api.${this.region}.amazonaws.com`;
    const apiOrigin = new origins.HttpOrigin(apiDomain, {
      originPath: `/${api.deploymentStage.stageName}`,
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });

    // Origin request policy — forward query strings and Content-Type to API Gateway
    const apiOriginRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'ApiOriginRequestPolicy', {
      originRequestPolicyName: 'ConsultingDetective-ApiOriginRequest',
      comment: 'Forward query strings to API Gateway',
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList('Content-Type'),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
    });

    // CloudFront Function to strip /api prefix so API Gateway sees the real path
    const apiRewriteFunction = new cloudfront.Function(this, 'ApiRewriteFunction', {
      functionName: 'ConsultingDetective-ApiRewrite',
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  request.uri = request.uri.replace(/^\\/api/, '');
  if (!request.uri.startsWith('/')) {
    request.uri = '/' + request.uri;
  }
  return request;
}
      `),
    });

    const distribution = new cloudfront.Distribution(this, 'WebsiteDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessIdentity(websiteBucket, {
          originAccessIdentity,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: true,
        responseHeadersPolicy,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: apiOriginRequestPolicy,
          functionAssociations: [{
            function: apiRewriteFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          }],
        },
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      comment: 'Consulting Detective Website Distribution',
    });

    // Deploy website files to S3
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset(join(__dirname, '../ui/dist'))],
      destinationBucket: websiteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // ============================================
    // Outputs
    // ============================================

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway URL',
    });

    new cdk.CfnOutput(this, 'WebsiteUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'CloudFront Website URL',
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront Distribution ID',
    });

    new cdk.CfnOutput(this, 'WebsiteBucketName', {
      value: websiteBucket.bucketName,
      description: 'S3 Website Bucket Name',
    });

    new cdk.CfnOutput(this, 'GenerationStateMachineArn', {
      value: generationStateMachine.stateMachineArn,
      description: 'Case Generation Step Functions State Machine ARN',
    });
  }
}
