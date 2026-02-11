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

/**
 * Application stack props -- receives persistent resources from the
 * infrastructure stack.
 */
export interface ConsultingDetectiveStackProps extends cdk.StackProps {
  /** The DynamoDB cases table from the infrastructure stack. */
  casesTable: dynamodb.ITable;
}

/**
 * Application stack -- all stateless resources that can be freely torn down
 * and recreated: Lambdas, API Gateway, CloudFront, S3 (static assets),
 * Step Functions, and the deployment pipeline.
 *
 * Persistent data resources (DynamoDB) live in the infrastructure stack.
 */
export class ConsultingDetectiveStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ConsultingDetectiveStackProps) {
    super(scope, id, props);

    const { casesTable } = props;

    // ============================================
    // Draft Cases Table (temporary generation state)
    // ============================================
    // Holds in-progress case drafts keyed by Step Function execution ID.
    // No RETAIN — safe to delete on stack destroy.

    const draftCasesTable = new dynamodb.Table(this, 'DraftCasesTable', {
      tableName: 'ConsultingDetective-DraftCases',
      partitionKey: { name: 'draftId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
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
      timeout: cdk.Duration.minutes(15),
    };

    // Health check handler
    const healthHandler = new nodejs.NodejsFunction(this, 'HealthHandler', {
      entry: join(__dirname, 'lambda/health/get.ts'),
      environment: lambdaEnvironment,
      ...bundlingConfig,
    });

    // List cases handler
    const listCasesHandler = new nodejs.NodejsFunction(this, 'ListCasesHandler', {
      entry: join(__dirname, 'lambda/cases/list.ts'),
      environment: lambdaEnvironment,
      ...bundlingConfig,
    });

    // Get case handler
    const getCaseHandler = new nodejs.NodejsFunction(this, 'GetCaseHandler', {
      entry: join(__dirname, 'lambda/cases/get.ts'),
      environment: lambdaEnvironment,
      ...bundlingConfig,
    });

    // ============================================
    // Generation Pipeline — Lambda Functions
    // ============================================

    const generationEnvironment = {
      ...lambdaEnvironment,
      DRAFT_CASES_TABLE_NAME: draftCasesTable.tableName,
      BEDROCK_DEFAULT_MODEL_ID: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    };

    // Longer timeout + more memory for LLM-calling steps
    const generationLambdaConfig = {
      ...bundlingConfig,
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
    };

    // Prose generation gets extra time and tokens
    const proseLambdaConfig = {
      ...generationLambdaConfig,
      memorySize: 2048,
    };

    const generateTemplateHandler = new nodejs.NodejsFunction(this, 'GenerateTemplateHandler', {
      entry: join(__dirname, 'lambda/generate/generate-template.ts'),
      environment: generationEnvironment,
      ...generationLambdaConfig,
    });

    const generateEventsHandler = new nodejs.NodejsFunction(this, 'GenerateEventsHandler', {
      entry: join(__dirname, 'lambda/generate/generate-events.ts'),
      environment: generationEnvironment,
      ...generationLambdaConfig,
    });

    const generateCharactersHandler = new nodejs.NodejsFunction(this, 'GenerateCharactersHandler', {
      entry: join(__dirname, 'lambda/generate/generate-characters.ts'),
      environment: generationEnvironment,
      ...generationLambdaConfig,
    });

    const generateLocationsHandler = new nodejs.NodejsFunction(this, 'GenerateLocationsHandler', {
      entry: join(__dirname, 'lambda/generate/generate-locations.ts'),
      environment: generationEnvironment,
      ...generationLambdaConfig,
    });

    const generateFactsHandler = new nodejs.NodejsFunction(this, 'GenerateFactsHandler', {
      entry: join(__dirname, 'lambda/generate/generate-facts.ts'),
      environment: generationEnvironment,
      ...generationLambdaConfig,
    });

    const generateIntroductionHandler = new nodejs.NodejsFunction(this, 'GenerateIntroductionHandler', {
      entry: join(__dirname, 'lambda/generate/generate-introduction.ts'),
      environment: generationEnvironment,
      ...generationLambdaConfig,
    });

    const generateCasebookHandler = new nodejs.NodejsFunction(this, 'GenerateCasebookHandler', {
      entry: join(__dirname, 'lambda/generate/generate-casebook.ts'),
      environment: generationEnvironment,
      ...generationLambdaConfig,
    });

    const generateProseHandler = new nodejs.NodejsFunction(this, 'GenerateProseHandler', {
      entry: join(__dirname, 'lambda/generate/generate-prose.ts'),
      environment: generationEnvironment,
      ...proseLambdaConfig,
    });

    const generateQuestionsHandler = new nodejs.NodejsFunction(this, 'GenerateQuestionsHandler', {
      entry: join(__dirname, 'lambda/generate/generate-questions.ts'),
      environment: generationEnvironment,
      ...generationLambdaConfig,
    });

    const computeEventKnowledgeHandler = new nodejs.NodejsFunction(this, 'ComputeEventKnowledgeHandler', {
      entry: join(__dirname, 'lambda/generate/compute-event-knowledge.ts'),
      environment: lambdaEnvironment,
      ...bundlingConfig,
    });

    const computeFactsHandler = new nodejs.NodejsFunction(this, 'ComputeFactsHandler', {
      entry: join(__dirname, 'lambda/generate/compute-facts.ts'),
      environment: lambdaEnvironment,
      ...bundlingConfig,
    });

    const computeOptimalPathHandler = new nodejs.NodejsFunction(this, 'ComputeOptimalPathHandler', {
      entry: join(__dirname, 'lambda/generate/compute-optimal-path.ts'),
      environment: lambdaEnvironment,
      ...bundlingConfig
    });

    const validateCasebookHandler = new nodejs.NodejsFunction(this, 'ValidateCasebookHandler', {
      entry: join(__dirname, 'lambda/generate/validate-casebook.ts'),
      environment: lambdaEnvironment,
      ...bundlingConfig,
    });

    const validateEventsHandler = new nodejs.NodejsFunction(this, 'ValidateEventsHandler', {
      entry: join(__dirname, 'lambda/generate/validate-events.ts'),
      environment: lambdaEnvironment,
      ...bundlingConfig,
    });

    const validateCharactersHandler = new nodejs.NodejsFunction(this, 'ValidateCharactersHandler', {
      entry: join(__dirname, 'lambda/generate/validate-characters.ts'),
      environment: lambdaEnvironment,
      ...bundlingConfig,
    });

    const validateLocationsHandler = new nodejs.NodejsFunction(this, 'ValidateLocationsHandler', {
      entry: join(__dirname, 'lambda/generate/validate-locations.ts'),
      environment: lambdaEnvironment,
      ...bundlingConfig,
    });

    const validateFactsHandler = new nodejs.NodejsFunction(this, 'ValidateFactsHandler', {
      entry: join(__dirname, 'lambda/generate/validate-facts.ts'),
      environment: lambdaEnvironment,
      ...bundlingConfig,
    });

    const validateQuestionsHandler = new nodejs.NodejsFunction(this, 'ValidateQuestionsHandler', {
      entry: join(__dirname, 'lambda/generate/validate-questions.ts'),
      environment: lambdaEnvironment,
      ...bundlingConfig,
    });

    const storeCaseHandler = new nodejs.NodejsFunction(this, 'StoreCaseHandler', {
      entry: join(__dirname, 'lambda/generate/store-case.ts'),
      environment: lambdaEnvironment,
      ...bundlingConfig,
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
      generateTemplateHandler,
      generateEventsHandler,
      generateCharactersHandler,
      generateLocationsHandler,
      generateFactsHandler,
      generateIntroductionHandler,
      generateCasebookHandler,
      generateProseHandler,
      generateQuestionsHandler,
    ];

    for (const handler of llmHandlers) {
      handler.addToRolePolicy(bedrockPolicy);
      handler.addToRolePolicy(marketplacePolicy);
    }

    // DynamoDB: store step writes cases; all generation steps read/write drafts
    casesTable.grantWriteData(storeCaseHandler);
    const generationHandlers = [
      generateTemplateHandler,
      generateEventsHandler,
      computeEventKnowledgeHandler,
      generateCharactersHandler,
      validateEventsHandler,
      validateCharactersHandler,
      generateLocationsHandler,
      validateLocationsHandler,
      computeFactsHandler,
      generateFactsHandler,
      validateFactsHandler,
      generateIntroductionHandler,
      generateCasebookHandler,
      validateCasebookHandler,
      generateProseHandler,
      generateQuestionsHandler,
      validateQuestionsHandler,
      computeOptimalPathHandler,
      storeCaseHandler,
    ];
    for (const h of generationHandlers) {
      draftCasesTable.grantReadWriteData(h);
    }

    // ============================================
    // Generation Pipeline — Step Functions
    // ============================================

    const generateTemplate = new tasks.LambdaInvoke(this, 'GenerateTemplate', {
      lambdaFunction: generateTemplateHandler,
      outputPath: '$.Payload',
    });

    const generateEvents = new tasks.LambdaInvoke(this, 'GenerateEvents', {
      lambdaFunction: generateEventsHandler,
      outputPath: '$.Payload',
    });

    const generateCharacters = new tasks.LambdaInvoke(this, 'GenerateCharacters', {
      lambdaFunction: generateCharactersHandler,
      outputPath: '$.Payload',
    });

    const generateLocations = new tasks.LambdaInvoke(this, 'GenerateLocations', {
      lambdaFunction: generateLocationsHandler,
      outputPath: '$.Payload',
    });

    const generateFacts = new tasks.LambdaInvoke(this, 'GenerateFacts', {
      lambdaFunction: generateFactsHandler,
      outputPath: '$.Payload',
    });

    const generateIntroduction = new tasks.LambdaInvoke(this, 'GenerateIntroduction', {
      lambdaFunction: generateIntroductionHandler,
      outputPath: '$.Payload',
    });

    const generateCasebook = new tasks.LambdaInvoke(this, 'GenerateCasebook', {
      lambdaFunction: generateCasebookHandler,
      outputPath: '$.Payload',
    });

    const validateCasebook = new tasks.LambdaInvoke(this, 'ValidateCasebook', {
      lambdaFunction: validateCasebookHandler,
      outputPath: '$.Payload',
    });

    const validateEvents = new tasks.LambdaInvoke(this, 'ValidateEvents', {
      lambdaFunction: validateEventsHandler,
      outputPath: '$.Payload',
    });

    const computeEventKnowledge = new tasks.LambdaInvoke(this, 'ComputeEventKnowledge', {
      lambdaFunction: computeEventKnowledgeHandler,
      outputPath: '$.Payload',
    });

    const validateCharacters = new tasks.LambdaInvoke(this, 'ValidateCharacters', {
      lambdaFunction: validateCharactersHandler,
      outputPath: '$.Payload',
    });

    const validateLocations = new tasks.LambdaInvoke(this, 'ValidateLocations', {
      lambdaFunction: validateLocationsHandler,
      outputPath: '$.Payload',
    });

    const computeFacts = new tasks.LambdaInvoke(this, 'ComputeFacts', {
      lambdaFunction: computeFactsHandler,
      outputPath: '$.Payload',
    });

    const validateFacts = new tasks.LambdaInvoke(this, 'ValidateFacts', {
      lambdaFunction: validateFactsHandler,
      outputPath: '$.Payload',
    });

    const validateQuestions = new tasks.LambdaInvoke(this, 'ValidateQuestions', {
      lambdaFunction: validateQuestionsHandler,
      outputPath: '$.Payload',
    });

    const generateProse = new tasks.LambdaInvoke(this, 'GenerateProse', {
      lambdaFunction: generateProseHandler,
      outputPath: '$.Payload',
    });

    const generateQuestions = new tasks.LambdaInvoke(this, 'GenerateQuestions', {
      lambdaFunction: generateQuestionsHandler,
      outputPath: '$.Payload',
    });

    const computeOptimalPath = new tasks.LambdaInvoke(this, 'ComputeOptimalPath', {
      lambdaFunction: computeOptimalPathHandler,
      outputPath: '$.Payload',
    });

    const storeCase = new tasks.LambdaInvoke(this, 'StoreCase', {
      lambdaFunction: storeCaseHandler,
      outputPath: '$.Payload',
    });

    // -- Events validation with retry loop --
    const eventsValidationFailed = new sfn.Fail(this, 'EventsValidationFailed', {
      cause: 'Event validation failed after maximum retries',
      error: 'EventsInvalid',
    });

    const initEventsRetries = new sfn.Pass(this, 'InitEventsRetries', {
      parameters: {
        'input.$': '$.input',
        'draftId.$': '$.draftId',
        'stepRetries': 0,
      },
    });

    const incrementEventsRetries = new sfn.Pass(this, 'IncrementEventsRetries', {
      parameters: {
        'input.$': '$.input',
        'draftId.$': '$.draftId',
        'validationResult.$': '$.validationResult',
        'stepRetries': sfn.JsonPath.mathAdd(sfn.JsonPath.numberAt('$.stepRetries'), 1),
      },
    });

    const initGenerateCharactersRetries = new sfn.Pass(this, 'InitGenerateCharactersRetries', {
      parameters: {
        'input.$': '$.input',
        'draftId.$': '$.draftId',
        'stepRetries': 0,
      },
    });

    const initGenerateLocationsRetries = new sfn.Pass(this, 'InitGenerateLocationsRetries', {
      parameters: {
        'input.$': '$.input',
        'draftId.$': '$.draftId',
        'stepRetries': 0,
      },
    });

    const initGenerateFactsRetries = new sfn.Pass(this, 'InitGenerateFactsRetries', {
      parameters: {
        'input.$': '$.input',
        'draftId.$': '$.draftId',
        'stepRetries': 0,
      },
    });

    const initGenerateCasebookRetries = new sfn.Pass(this, 'InitGenerateCasebookRetries', {
      parameters: {
        'input.$': '$.input',
        'draftId.$': '$.draftId',
        'stepRetries': 0,
      },
    });

    const checkEvents = new sfn.Choice(this, 'CheckEvents')
      .when(
        sfn.Condition.booleanEquals('$.validationResult.valid', true),
        computeEventKnowledge,
      )
      .when(
        sfn.Condition.numberGreaterThanEquals('$.stepRetries', 1),
        eventsValidationFailed,
      )
      .otherwise(incrementEventsRetries);

    initEventsRetries.next(generateEvents);
    incrementEventsRetries.next(generateEvents);
    generateEvents.next(validateEvents);
    validateEvents.next(checkEvents);
    computeEventKnowledge.next(initGenerateCharactersRetries);
    initGenerateCharactersRetries.next(generateCharacters);

    // -- Characters validation with retry loop --
    const charactersValidationFailed = new sfn.Fail(this, 'CharactersValidationFailed', {
      cause: 'Character validation failed after maximum retries',
      error: 'CharactersInvalid',
    });

    const incrementCharsRetries = new sfn.Pass(this, 'IncrementCharsRetries', {
      parameters: {
        'input.$': '$.input',
        'draftId.$': '$.draftId',
        'validationResult.$': '$.validationResult',
        'stepRetries': sfn.JsonPath.mathAdd(sfn.JsonPath.numberAt('$.stepRetries'), 1),
      },
    });

    const checkCharacters = new sfn.Choice(this, 'CheckCharacters')
      .when(
        sfn.Condition.booleanEquals('$.validationResult.valid', true),
        initGenerateLocationsRetries,
      )
      .when(
        sfn.Condition.numberGreaterThanEquals('$.stepRetries', 1),
        charactersValidationFailed,
      )
      .otherwise(incrementCharsRetries);

    incrementCharsRetries.next(generateCharacters);
    generateCharacters.next(validateCharacters);
    validateCharacters.next(checkCharacters);
    initGenerateLocationsRetries.next(generateLocations);

    // -- Locations validation with retry loop --
    const locationsValidationFailed = new sfn.Fail(this, 'LocationsValidationFailed', {
      cause: 'Location validation failed after maximum retries',
      error: 'LocationsInvalid',
    });

    const incrementLocsRetries = new sfn.Pass(this, 'IncrementLocsRetries', {
      parameters: {
        'input.$': '$.input',
        'draftId.$': '$.draftId',
        'validationResult.$': '$.validationResult',
        'stepRetries': sfn.JsonPath.mathAdd(sfn.JsonPath.numberAt('$.stepRetries'), 1),
      },
    });

    const checkLocations = new sfn.Choice(this, 'CheckLocations')
      .when(
        sfn.Condition.booleanEquals('$.validationResult.valid', true),
        computeFacts,
      )
      .when(
        sfn.Condition.numberGreaterThanEquals('$.stepRetries', 1),
        locationsValidationFailed,
      )
      .otherwise(incrementLocsRetries);

    incrementLocsRetries.next(generateLocations);
    generateLocations.next(validateLocations);
    validateLocations.next(checkLocations);
    computeFacts.next(initGenerateFactsRetries);

    // -- Facts validation with retry loop --
    const factsValidationFailed = new sfn.Fail(this, 'FactsValidationFailed', {
      cause: 'Fact validation failed after maximum retries',
      error: 'FactsInvalid',
    });

    const incrementFactsRetries = new sfn.Pass(this, 'IncrementFactsRetries', {
      parameters: {
        'input.$': '$.input',
        'draftId.$': '$.draftId',
        'validationResult.$': '$.validationResult',
        'stepRetries': sfn.JsonPath.mathAdd(sfn.JsonPath.numberAt('$.stepRetries'), 1),
      },
    });

    const checkFacts = new sfn.Choice(this, 'CheckFacts')
      .when(
        sfn.Condition.booleanEquals('$.validationResult.valid', true),
        generateIntroduction,
      )
      .when(
        sfn.Condition.numberGreaterThanEquals('$.stepRetries', 1),
        factsValidationFailed,
      )
      .otherwise(incrementFactsRetries);

    incrementFactsRetries.next(generateFacts);
    initGenerateFactsRetries.next(generateFacts);
    generateFacts.next(validateFacts);
    validateFacts.next(checkFacts);

    // Wire: GenerateIntroduction → InitGenerateCasebookRetries
    generateIntroduction.next(initGenerateCasebookRetries);

    // -- Casebook validation with retry loop --
    // After GenerateCasebook, validate the bipartite discovery graph.
    // If invalid and retries remain, re-run GenerateCasebook with error context.

    const casebookValidationFailed = new sfn.Fail(this, 'CasebookValidationFailed', {
      cause: 'Casebook validation failed after maximum retries',
      error: 'CasebookInvalid',
    });

    const incrementCasebookRetries = new sfn.Pass(this, 'IncrementGenerateCasebookRetries', {
      parameters: {
        'input.$': '$.input',
        'draftId.$': '$.draftId',
        'validationResult.$': '$.validationResult',
        'stepRetries': sfn.JsonPath.mathAdd(sfn.JsonPath.numberAt('$.stepRetries'), 1),
      },
    });

    const checkCasebookValidation = new sfn.Choice(this, 'CheckCasebookValidation')
      .when(
        sfn.Condition.booleanEquals('$.validationResult.valid', true),
        generateProse,
      )
      .when(
        sfn.Condition.numberGreaterThanEquals('$.stepRetries', 1),
        casebookValidationFailed,
      )
      .otherwise(incrementCasebookRetries);

    // Retry loop: increment → re-run GenerateCasebook → re-validate
    incrementCasebookRetries.next(generateCasebook);

    // Wire: GenerateCasebook → ValidateCasebook → Choice
    generateCasebook.next(validateCasebook);
    validateCasebook.next(checkCasebookValidation);

    // Wire: CheckFacts (valid) → InitGenerateCasebookRetries → GenerateCasebook
    initGenerateCasebookRetries.next(generateCasebook);

    // -- Questions validation with retry loop --
    const questionsValidationFailed = new sfn.Fail(this, 'QuestionsValidationFailed', {
      cause: 'Question validation failed after maximum retries',
      error: 'QuestionsInvalid',
    });

    const initGenerateQuestionsRetries = new sfn.Pass(this, 'InitGenerateQuestionsRetries', {
      parameters: {
        'input.$': '$.input',
        'draftId.$': '$.draftId',
        'validationResult.$': '$.validationResult',
        'stepRetries': 0,
      },
    });

    const incrementGenerateQuestionsRetries = new sfn.Pass(this, 'IncrementGenerateQuestionsRetries', {
      parameters: {
        'input.$': '$.input',
        'draftId.$': '$.draftId',
        'validationResult.$': '$.validationResult',
        'stepRetries': sfn.JsonPath.mathAdd(sfn.JsonPath.numberAt('$.stepRetries'), 1),
      },
    });

    const checkQuestions = new sfn.Choice(this, 'CheckQuestions')
      .when(
        sfn.Condition.booleanEquals('$.validationResult.valid', true),
        computeOptimalPath,
      )
      .when(
        sfn.Condition.numberGreaterThanEquals('$.stepRetries', 1),
        questionsValidationFailed,
      )
      .otherwise(incrementGenerateQuestionsRetries);

    incrementGenerateQuestionsRetries.next(generateQuestions);
    initGenerateQuestionsRetries.next(generateQuestions);
    generateQuestions.next(validateQuestions);
    validateQuestions.next(checkQuestions);
    computeOptimalPath.next(storeCase);

    // -- Resume from step: when input includes startFromStep + partial state, jump to that step --
    const invalidResumeStep = new sfn.Fail(this, 'InvalidResumeStep', {
      cause: 'startFromStep must be one of: generateEvents, computeEventKnowledge, generateCharacters, generateLocations, computeFacts, generateFacts, generateIntroduction, generateCasebook, generateProse, generateQuestions',
      error: 'InvalidResumeStep',
    });

    const resumeFromStep = new sfn.Choice(this, 'ResumeFromStep')
      .when(sfn.Condition.stringEquals('$.startFromStep', 'generateEvents'), initEventsRetries)
      .when(sfn.Condition.stringEquals('$.startFromStep', 'computeEventKnowledge'), computeEventKnowledge)
      .when(sfn.Condition.stringEquals('$.startFromStep', 'generateCharacters'), initGenerateCharactersRetries)
      .when(sfn.Condition.stringEquals('$.startFromStep', 'generateLocations'), initGenerateLocationsRetries)
      .when(sfn.Condition.stringEquals('$.startFromStep', 'computeFacts'), computeFacts)
      .when(sfn.Condition.stringEquals('$.startFromStep', 'generateFacts'), initGenerateFactsRetries)
      .when(sfn.Condition.stringEquals('$.startFromStep', 'generateIntroduction'), generateIntroduction)
      .when(sfn.Condition.stringEquals('$.startFromStep', 'generateCasebook'), initGenerateCasebookRetries)
      .when(sfn.Condition.stringEquals('$.startFromStep', 'generateProse'), generateProse)
      .when(sfn.Condition.stringEquals('$.startFromStep', 'generateQuestions'), initGenerateQuestionsRetries)
      .otherwise(invalidResumeStep);

    const routeByResume = new sfn.Choice(this, 'RouteByResume')
      .when(sfn.Condition.isPresent('$.startFromStep'), resumeFromStep)
      .otherwise(generateTemplate);

    // Entry: new runs get draftId from execution; resume runs keep draftId from state
    const injectDraftId = new sfn.Pass(this, 'InjectDraftId', {
      parameters: {
        'input.$': '$.input',
        'draftId': sfn.JsonPath.stringAt('$$.Execution.Id'),
        'startFromStep.$': '$.startFromStep',
      },
    });
    injectDraftId.next(routeByResume);

    const hasDraftId = new sfn.Choice(this, 'HasDraftId')
      .when(sfn.Condition.isPresent('$.draftId'), routeByResume)
      .otherwise(injectDraftId);

    // Pipeline entry: HasDraftId → (inject or RouteByResume) → ... → StoreCase
    const pipelineDefinition = hasDraftId;
    generateTemplate.next(initEventsRetries);

    // Continue after checkCasebookValidation (valid) → generateProse → InitQuestionsRetries → GenerateQuestions → ...
    generateProse.next(initGenerateQuestionsRetries);

    const generationStateMachine = new sfn.StateMachine(this, 'CaseGenerationPipeline', {
      stateMachineName: 'ConsultingDetective-CaseGeneration',
      definitionBody: sfn.DefinitionBody.fromChainable(pipelineDefinition)
    });

    // ============================================
    // Grant DynamoDB Permissions
    // ============================================

    casesTable.grantReadData(healthHandler);
    casesTable.grantReadData(listCasesHandler);
    casesTable.grantReadData(getCaseHandler);

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

    // Cases routes
    const cases = api.root.addResource('cases');
    cases.addMethod('GET', new apigateway.LambdaIntegration(listCasesHandler));

    const singleCase = cases.addResource('{caseDate}');
    singleCase.addMethod('GET', new apigateway.LambdaIntegration(getCaseHandler));

    // ============================================
    // S3 Bucket for Frontend Hosting
    // ============================================

    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: `consulting-detective-website-${this.account}`,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
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
