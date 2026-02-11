import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SFNClient, DescribeExecutionCommand } from '@aws-sdk/client-sfn';
import { getDraft } from '../shared/draft-db';
import { successResponse, errorResponse, ErrorCodes } from '../shared/response';
import type {
  GenerateCaseInput,
  DraftCase,
  CaseTemplate,
  PipelineStep,
  StepValidationResult,
} from '../shared/generation-state';

const sfn = new SFNClient({});

const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN!;

function executionArn(stateMachineArn: string, executionId: string): string {
  const parts = stateMachineArn.split(':');
  if (parts[5] === 'stateMachine' && parts[6]) {
    return `${parts.slice(0, 5).join(':')}:execution:${parts[6]}:${executionId}`;
  }
  return stateMachineArn.replace(/:stateMachine:[^:]+$/, `:execution:${executionId}`);
}

export interface CaseSummary {
  title?: string;
  date?: string;
  era?: string;
  difficulty?: string;
  crimeType?: string;
  narrativeTone?: string;
  mysteryStyle?: string;
  atmosphere?: string;
  modelConfig?: GenerateCaseInput['modelConfig'];
}

export interface ExecutionDetailResponse {
  executionId: string;
  status: string;
  startDate: string;
  stopDate?: string;
  input?: GenerateCaseInput;
  error?: string;
  cause?: string;
  currentStep?: PipelineStep;
  lastStepStartedAt?: string;
  lastValidationResult?: StepValidationResult;
  caseSummary: CaseSummary;
}

function buildCaseSummary(input: GenerateCaseInput | undefined, draft: DraftCase | null): CaseSummary {
  const summary: CaseSummary = {};
  if (input) {
    summary.date = input.caseDate;
    summary.difficulty = input.difficulty;
    summary.crimeType = input.crimeType;
    summary.modelConfig = input.modelConfig;
  }
  const template = draft?.template as CaseTemplate | undefined;
  if (template) {
    summary.title = draft?.title ?? template.title;
    summary.date = summary.date ?? template.date;
    summary.era = template.era;
    summary.difficulty = summary.difficulty ?? template.difficulty;
    summary.crimeType = summary.crimeType ?? template.crimeType;
    summary.narrativeTone = template.narrativeTone;
    summary.mysteryStyle = template.mysteryStyle;
    summary.atmosphere = template.atmosphere;
  }
  return summary;
}

/**
 * GET /generation/executions/:executionId — Execution detail plus draft-derived case summary and current step.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const executionId = event.pathParameters?.executionId;
    if (!executionId) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR.code,
        'executionId path parameter is required',
        ErrorCodes.VALIDATION_ERROR.status,
      );
    }
    if (!STATE_MACHINE_ARN) {
      return errorResponse(
        ErrorCodes.INTERNAL_ERROR.code,
        'STATE_MACHINE_ARN not configured',
        ErrorCodes.INTERNAL_ERROR.status,
      );
    }

    const arn = executionArn(STATE_MACHINE_ARN, executionId);
    const execResult = await sfn.send(
      new DescribeExecutionCommand({ executionArn: arn }),
    );

    if (!execResult.executionArn) {
      return errorResponse(
        ErrorCodes.NOT_FOUND.code,
        `Execution ${executionId} not found`,
        ErrorCodes.NOT_FOUND.status,
      );
    }

    let inputParsed: GenerateCaseInput | undefined;
    if (execResult.input) {
      try {
        const parsed = JSON.parse(execResult.input) as { input?: GenerateCaseInput };
        inputParsed = parsed.input;
      } catch {
        // ignore
      }
    }

    const draftId = executionId;
    const draft = await getDraft(draftId);

    const caseSummary = buildCaseSummary(inputParsed, draft);

    const response: ExecutionDetailResponse = {
      executionId,
      status: execResult.status ?? 'UNKNOWN',
      startDate: execResult.startDate ? new Date(execResult.startDate).toISOString() : '',
      stopDate: execResult.stopDate ? new Date(execResult.stopDate).toISOString() : undefined,
      input: inputParsed,
      error: execResult.error,
      cause: execResult.cause,
      currentStep: draft?.currentStep,
      lastStepStartedAt: draft?.lastStepStartedAt,
      lastValidationResult: draft?.lastValidationResult,
      caseSummary,
    };

    return successResponse(response);
  } catch (err) {
    console.error('Execution detail error:', err);
    return errorResponse(
      ErrorCodes.INTERNAL_ERROR.code,
      'Failed to get execution detail',
      ErrorCodes.INTERNAL_ERROR.status,
    );
  }
}
