import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { randomUUID } from 'crypto';
import { forkDraft } from '../shared/draft-db';
import { GENERATION_STEPS, type GenerationStep, type PipelineStep } from '../shared/generation-state';

const sfn = new SFNClient({});
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN!;

/** Invoke from AWS console. Input: { sourceDraftId: string, fromStep: PipelineStep } */
export interface ForkDraftEvent {
  sourceDraftId: string;
  fromStep: PipelineStep;
}

/** Steps that can be used as startFromStep in the state machine (resume branches). */
const RESUMABLE_STEPS = new Set<string>(GENERATION_STEPS);

export const handler = async (event: ForkDraftEvent): Promise<{ executionArn: string; draftId: string }> => {
  const { sourceDraftId, fromStep } = event;
  if (!sourceDraftId || !fromStep) {
    throw new Error('Missing required fields: sourceDraftId, fromStep');
  }
  if (!STATE_MACHINE_ARN) {
    throw new Error('STATE_MACHINE_ARN environment variable is not set');
  }

  const forked = await forkDraft(sourceDraftId, randomUUID(), fromStep);
  if (!forked.input) {
    throw new Error('Source draft has no input; cannot start execution. Run the pipeline from the start at least once.');
  }

  const startFromStep: GenerationStep | undefined = RESUMABLE_STEPS.has(fromStep) ? (fromStep as GenerationStep) : undefined;
  if (startFromStep === undefined) {
    throw new Error(
      `fromStep "${fromStep}" is not a resumable step. Use one of: ${GENERATION_STEPS.join(', ')}`,
    );
  }

  const executionInput = {
    input: forked.input,
    draftId: forked.draftId,
    startFromStep,
  };

  const result = await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: STATE_MACHINE_ARN,
      input: JSON.stringify(executionInput),
    }),
  );

  if (!result.executionArn) {
    throw new Error('StartExecution did not return an execution ARN');
  }

  return {
    executionArn: result.executionArn,
    draftId: forked.draftId,
  };
};
