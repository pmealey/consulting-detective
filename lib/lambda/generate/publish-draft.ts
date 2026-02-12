import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, CASES_TABLE } from '../shared/db';
import { getDraft } from '../shared/draft-db';
import { assembleCaseFromDraft } from '../shared/assemble-case';

/** Invoke from AWS console. Input: { draftId: string } */
export interface PublishDraftEvent {
  draftId: string;
}

/**
 * Publishes a draft to the Cases table by draftId.
 * Uses the draft's stored input.caseDate. Skips validation — use when you
 * have explicitly chosen this draft to publish (e.g. after comparing forks).
 */
export const handler = async (event: PublishDraftEvent): Promise<{ caseDate: string }> => {
  const { draftId } = event;
  if (!draftId) {
    throw new Error('Missing required field: draftId');
  }

  const draft = await getDraft(draftId);
  if (!draft) {
    throw new Error(`Draft not found: ${draftId}`);
  }

  const caseDate = draft.input?.caseDate;
  if (!caseDate) {
    throw new Error('Draft has no input.caseDate; cannot publish.');
  }

  const finalCase = assembleCaseFromDraft(draft, caseDate, draftId);

  await docClient.send(
    new PutCommand({
      TableName: CASES_TABLE,
      Item: finalCase,
    }),
  );

  return { caseDate };
};
