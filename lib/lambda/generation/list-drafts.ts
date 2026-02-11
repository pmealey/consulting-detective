import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SFNClient, ListExecutionsCommand, DescribeExecutionCommand } from '@aws-sdk/client-sfn';
import { listDrafts } from '../shared/draft-db';
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

const RECENT_HOURS = 24;

/** Execution input: first run has no draftId (injected as execution id); retry has draftId. */
interface ExecutionInputShape {
  input?: GenerateCaseInput;
  draftId?: string;
  startFromStep?: string;
}

/**
 * Build a map draftId -> latest execution (by startDate). A draft can have multiple
 * executions (first run + retries); retries pass draftId in the execution input.
 * Exported for use by execution-detail.
 */
export async function latestExecutionByDraftId(
  stateMachineArn: string,
  maxExecutions: number,
): Promise<Map<string, { executionId: string; status: string; startDate: string; stopDate?: string; error?: string; cause?: string; input?: ExecutionInputShape }>> {
  const listResult = await sfn.send(
    new ListExecutionsCommand({
      stateMachineArn,
      maxResults: maxExecutions,
    }),
  );
  const executions = listResult.executions ?? [];
  // Sort newest first so we keep the latest per draft when we build the map
  const byStart = [...executions].sort(
    (a, b) => (b.startDate?.getTime() ?? 0) - (a.startDate?.getTime() ?? 0),
  );
  const map = new Map<string, { executionId: string; status: string; startDate: string; stopDate?: string; error?: string; cause?: string; input?: ExecutionInputShape }>();
  for (const exec of byStart) {
    const executionId = exec.name ?? exec.executionArn?.split(':').pop();
    if (!executionId) continue;
    let draftId: string;
    let inputParsed: ExecutionInputShape | undefined;
    try {
      const arn = executionArn(stateMachineArn, executionId);
      const desc = await sfn.send(new DescribeExecutionCommand({ executionArn: arn }));
      if (desc.input) {
        inputParsed = JSON.parse(desc.input) as ExecutionInputShape;
      }
      draftId = inputParsed?.draftId ?? executionId;
      const startDate = desc.startDate ? new Date(desc.startDate).toISOString() : '';
      const stopDate = desc.stopDate ? new Date(desc.stopDate).toISOString() : undefined;
      if (!map.has(draftId)) {
        map.set(draftId, {
          executionId,
          status: desc.status ?? 'UNKNOWN',
          startDate,
          stopDate,
          error: desc.error,
          cause: desc.cause,
          input: inputParsed,
        });
      }
    } catch {
      draftId = executionId;
      const startDate = exec.startDate ? new Date(exec.startDate).toISOString() : '';
      if (!map.has(draftId)) {
        map.set(draftId, {
          executionId,
          status: exec.status ?? 'UNKNOWN',
          startDate,
          stopDate: exec.stopDate ? new Date(exec.stopDate).toISOString() : undefined,
        });
      }
    }
  }
  return map;
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

export interface DraftListItem {
  draftId: string;
  status: string;
  startDate: string;
  stopDate?: string;
  error?: string;
  cause?: string;
  currentStep?: PipelineStep;
  lastStepStartedAt?: string;
  lastValidationResult?: StepValidationResult;
  caseSummary: CaseSummary;
}

function executionArn(stateMachineArn: string, executionId: string): string {
  const parts = stateMachineArn.split(':');
  if (parts[5] === 'stateMachine' && parts[6]) {
    return `${parts.slice(0, 5).join(':')}:execution:${parts[6]}:${executionId}`;
  }
  return stateMachineArn.replace(/:stateMachine:[^:]+$/, `:execution:${executionId}`);
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
 * GET /generation/drafts — List drafts driving the UI. Returns only RUNNING or recently
 * finished (SUCCEEDED/FAILED etc. within RECENT_HOURS). Each item is a full detail payload
 * so the UI can render a card per draft without a separate detail fetch.
 * Status/errors come from the latest execution for that draft (first run or retry).
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    if (!STATE_MACHINE_ARN) {
      return errorResponse(
        ErrorCodes.INTERNAL_ERROR.code,
        'STATE_MACHINE_ARN not configured',
        ErrorCodes.INTERNAL_ERROR.status,
      );
    }

    const limit = Math.min(Number(event.queryStringParameters?.limit) || 30, 50);
    const [drafts, latestByDraft] = await Promise.all([
      listDrafts(limit),
      latestExecutionByDraftId(STATE_MACHINE_ARN, 100),
    ]);

    const recentCutoff = Date.now() - RECENT_HOURS * 60 * 60 * 1000;
    const items: DraftListItem[] = [];

    for (const draft of drafts) {
      const draftId = draft.draftId;
      if (!draftId) continue;

      const exec = latestByDraft.get(draftId);
      const status = exec?.status ?? 'UNKNOWN';
      const startDate = exec?.startDate ?? draft.lastStepStartedAt ?? '';
      const stopDate = exec?.stopDate;
      const error = exec?.error;
      const cause = exec?.cause;
      const inputParsed = exec?.input?.input;

      const isRunning = status === 'RUNNING';
      const isFinished = ['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'ABORTED'].includes(status);
      const stopMs = stopDate ? new Date(stopDate).getTime() : 0;
      const isRecentFinished = isFinished && stopMs >= recentCutoff;

      if (!isRunning && !isRecentFinished) continue;

      const caseSummary = buildCaseSummary(inputParsed, draft);

      items.push({
        draftId,
        status,
        startDate,
        stopDate,
        error,
        cause,
        currentStep: draft.currentStep,
        lastStepStartedAt: draft.lastStepStartedAt,
        lastValidationResult: draft.lastValidationResult,
        caseSummary,
      });
    }

    items.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());

    return successResponse(items);
  } catch (err) {
    console.error('List drafts error:', err);
    return errorResponse(
      ErrorCodes.INTERNAL_ERROR.code,
      'Failed to list drafts',
      ErrorCodes.INTERNAL_ERROR.status,
    );
  }
}
