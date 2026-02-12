import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, CASES_TABLE } from '../shared/db';
import { getDraft, updateDraft } from '../shared/draft-db';
import { assembleCaseFromDraft } from '../shared/assemble-case';
import type { OperationalState } from '../shared/generation-state';

/**
 * Pipeline Step 12: Store Case in DynamoDB
 *
 * Loads the draft from the draft table, assembles it into a final Case,
 * and writes to the cases table. The draft is left in place so retries
 * from any step remain possible even after a successful store.
 */
export const handler = async (state: OperationalState): Promise<OperationalState> => {
  const { input, draftId, validationResult } = state;

  if (!validationResult?.valid) {
    throw new Error(
      `Cannot store case: validation failed with ${validationResult?.errors.length ?? '?'} errors. ` +
      `Errors: ${validationResult?.errors.join('; ')}`,
    );
  }

  await updateDraft(draftId, {
    currentStep: 'storeCase',
    lastStepStartedAt: new Date().toISOString(),
  });

  const draft = await getDraft(draftId);
  if (!draft) throw new Error('Cannot store case: draft not found');

  const finalCase = assembleCaseFromDraft(draft, input.caseDate, draftId);

  await docClient.send(
    new PutCommand({
      TableName: CASES_TABLE,
      Item: finalCase,
    }),
  );

  await updateDraft(draftId, { lastValidationResult: undefined });

  return state;
};
