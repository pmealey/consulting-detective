import { GetCommand, PutCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, DRAFT_CASES_TABLE } from './db';
import {
  PIPELINE_STEPS,
  STEP_DRAFT_FIELDS,
  type DraftCase,
  type PipelineStep,
} from './generation-state';

/**
 * Load the draft case for a generation run. Returns null if no draft exists yet
 * (e.g. before the first step has run).
 */
export async function getDraft(draftId: string): Promise<DraftCase | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: DRAFT_CASES_TABLE,
      Key: { draftId },
    }),
  );
  if (!result.Item) return null;
  return { ...result.Item, draftId: result.Item.draftId ?? draftId } as DraftCase;
}

/**
 * Save the draft case. Overwrites any existing draft for this draftId.
 * Only include fields that are set; DynamoDB marshalling will omit undefined.
 */
export async function putDraft(draftId: string, draft: DraftCase): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: DRAFT_CASES_TABLE,
      Item: { ...draft, draftId },
    }),
  );
}

/**
 * Merge partial draft updates into the existing draft and save.
 * Loads the current draft (or starts empty if none), merges updates, writes back.
 */
export async function updateDraft(
  draftId: string,
  updates: Partial<DraftCase>,
): Promise<DraftCase> {
  const current = await getDraft(draftId);
  const merged: DraftCase = { ...current, ...updates, draftId };
  await putDraft(draftId, merged);
  return merged;
}

/**
 * List drafts from the draft table (scan). Use for generation tracking UI.
 * Returns at most `limit` items; order is not guaranteed (table has no sort key).
 * Each item includes draftId (the partition key) and all draft fields.
 */
export async function listDrafts(limit: number = 50): Promise<DraftCase[]> {
  const result = await docClient.send(
    new ScanCommand({
      TableName: DRAFT_CASES_TABLE,
      Limit: limit,
    }),
  );
  return (result.Items ?? []) as DraftCase[];
}

/**
 * Remove a draft from the draft table. Not called by StoreCase (drafts are
 * kept so retries from any step are possible); available for manual cleanup.
 */
export async function deleteDraft(draftId: string): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: DRAFT_CASES_TABLE,
      Key: { draftId },
    }),
  );
}

/**
 * Fork a draft: copy content from steps before fromStep into a new draft,
 * set lineage (forkedFrom, forkedAtStep), and copy input from the source.
 * Used to re-run the pipeline from fromStep onward on a new draftId while
 * leaving the original draft unchanged.
 */
export async function forkDraft(
  sourceDraftId: string,
  newDraftId: string,
  fromStep: PipelineStep,
): Promise<DraftCase> {
  const source = await getDraft(sourceDraftId);
  if (!source) throw new Error(`Source draft not found: ${sourceDraftId}`);

  const fromIndex = PIPELINE_STEPS.indexOf(fromStep);
  if (fromIndex < 0) throw new Error(`Unknown pipeline step: ${fromStep}`);

  const fieldsToStrip = new Set<keyof DraftCase>();
  for (let i = fromIndex; i < PIPELINE_STEPS.length; i++) {
    const step = PIPELINE_STEPS[i];
    for (const field of STEP_DRAFT_FIELDS[step]) {
      fieldsToStrip.add(field);
    }
  }

  const forked: DraftCase = {
    draftId: newDraftId,
    input: source.input,
    forkedFrom: sourceDraftId,
    forkedAtStep: fromStep,
    currentStep: fromStep,
    lastStepStartedAt: new Date().toISOString(),
    lastValidationResult: undefined,
  };

  const skipKeys = new Set([
    'draftId', 'input', 'forkedFrom', 'forkedAtStep',
    'currentStep', 'lastStepStartedAt', 'lastValidationResult',
  ]);
  for (const [key, value] of Object.entries(source)) {
    if (skipKeys.has(key)) continue;
    if (fieldsToStrip.has(key as keyof DraftCase)) continue;
    if (value !== undefined) {
      (forked as unknown as Record<string, unknown>)[key] = value;
    }
  }

  await putDraft(newDraftId, forked);
  return forked;
}
