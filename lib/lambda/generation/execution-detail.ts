import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getDraft } from '../shared/draft-db';
import { latestExecutionByDraftId } from './list-drafts';
import { successResponse, errorResponse, ErrorCodes } from '../shared/response';
import type {
  GenerateCaseInput,
  DraftCase,
  CaseTemplate,
  PipelineStep,
  StepValidationResult,
} from '../shared/generation-state';

const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN!;

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
 * Path param is the draftId. Status/errors come from the latest execution for that draft (first run or retry).
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const draftId = event.pathParameters?.executionId;
    if (!draftId) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR.code,
        'executionId (draftId) path parameter is required',
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

    const [draft, latestByDraft] = await Promise.all([
      getDraft(draftId),
      latestExecutionByDraftId(STATE_MACHINE_ARN, 100),
    ]);

    const exec = latestByDraft.get(draftId);
    const status = exec?.status ?? 'UNKNOWN';
    const startDate = exec?.startDate ?? draft?.lastStepStartedAt ?? '';
    const stopDate = exec?.stopDate;
    const error = exec?.error;
    const cause = exec?.cause;
    const inputParsed = exec?.input?.input;

    const caseSummary = buildCaseSummary(inputParsed, draft);

    const response: ExecutionDetailResponse = {
      executionId: draftId,
      status,
      startDate,
      stopDate,
      input: inputParsed,
      error,
      cause,
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
