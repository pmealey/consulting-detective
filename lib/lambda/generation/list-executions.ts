import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SFNClient, ListExecutionsCommand } from '@aws-sdk/client-sfn';
import { successResponse, errorResponse, ErrorCodes } from '../shared/response';
import type { GenerateCaseInput } from '../shared/generation-state';

const sfn = new SFNClient({});

const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN!;

export interface ExecutionListItem {
  executionId: string;
  status: string;
  startDate: string;
  stopDate?: string;
  caseDate?: string;
  difficulty?: string;
  crimeType?: string;
  modelConfig?: GenerateCaseInput['modelConfig'];
}

/**
 * GET /generation/executions — List recent Step Function executions for case generation.
 * Returns execution id, status, dates, and input summary (caseDate, difficulty, crimeType, modelConfig).
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

    const maxResults = Math.min(Number(event.queryStringParameters?.maxResults) || 50, 100);
    const statusFilter = event.queryStringParameters?.statusFilter; // optional: RUNNING, SUCCEEDED, FAILED, etc.

    const result = await sfn.send(
      new ListExecutionsCommand({
        stateMachineArn: STATE_MACHINE_ARN,
        maxResults,
        ...(statusFilter ? { statusFilter: statusFilter as 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'ABORTED' } : {}),
      }),
    );

    const executions: ExecutionListItem[] = (result.executions ?? []).map((exec: { name?: string; executionArn?: string; status?: string; startDate?: Date; stopDate?: Date; input?: string }) => {
      let caseDate: string | undefined;
      let difficulty: string | undefined;
      let crimeType: string | undefined;
      let modelConfig: GenerateCaseInput['modelConfig'] | undefined;
      const execInput = (exec as { input?: string }).input;
      if (execInput) {
        try {
          const parsed = JSON.parse(execInput) as { input?: GenerateCaseInput };
          if (parsed.input) {
            caseDate = parsed.input.caseDate;
            difficulty = parsed.input.difficulty;
            crimeType = parsed.input.crimeType;
            modelConfig = parsed.input.modelConfig;
          }
        } catch {
          // ignore parse errors
        }
      }
      return {
        executionId: exec.name ?? exec.executionArn?.split(':').pop() ?? 'unknown',
        status: exec.status ?? 'UNKNOWN',
        startDate: exec.startDate ? new Date(exec.startDate).toISOString() : '',
        stopDate: exec.stopDate ? new Date(exec.stopDate).toISOString() : undefined,
        caseDate,
        difficulty,
        crimeType,
        modelConfig,
      };
    });

    return successResponse(executions);
  } catch (err) {
    console.error('List executions error:', err);
    return errorResponse(
      ErrorCodes.INTERNAL_ERROR.code,
      'Failed to list executions',
      ErrorCodes.INTERNAL_ERROR.status,
    );
  }
}
