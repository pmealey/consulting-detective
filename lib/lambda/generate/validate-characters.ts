import { getDraft, updateDraft } from '../shared/draft-db';
import type {
  OperationalState,
  CharacterDraft,
  ValidationResult,
} from '../shared/generation-state';

/** Allowed knowledge state values (knows, suspects, hides, denies, believes). */
const VALID_KNOWLEDGE_STATUS = new Set<string>([
  'knows',
  'suspects',
  'hides',
  'denies',
  'believes',
]);

/**
 * Pipeline Step 3b: Validate Characters (after GenerateCharacters)
 *
 * Pure logic — no LLM call. Validates that event character references
 * are valid after roleIds have been remapped to characterIds:
 *
 * - Every event.agent references a valid characterId
 * - Every key in event.involvement references a valid characterId
 * - Every character.knowledgeState value is a valid KnowledgeStatus
 */
export const handler = async (state: OperationalState): Promise<OperationalState> => {
  const { draftId } = state;
  const draft = await getDraft(draftId);
  const { events, characters } = draft ?? {};

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!events || Object.keys(events).length === 0) {
    errors.push('No events in state');
    const result: ValidationResult = { valid: false, errors, warnings };
    await updateDraft(draftId, { lastValidationResult: result });
    return { ...state, validationResult: result };
  }

  if (!characters || Object.keys(characters).length === 0) {
    errors.push('No characters in state');
    const result: ValidationResult = { valid: false, errors, warnings };
    await updateDraft(draftId, { lastValidationResult: result });
    return { ...state, validationResult: result };
  }

  const characterIds = new Set(Object.keys(characters));

  for (const event of Object.values(events)) {
    if (!characterIds.has(event.agent)) {
      errors.push(
        `Event ${event.eventId}: agent "${event.agent}" is not a valid characterId`,
      );
    }
    for (const [charId] of Object.entries(event.involvement)) {
      if (!characterIds.has(charId)) {
        errors.push(
          `Event ${event.eventId}: involvement references non-character "${charId}"`,
        );
      }
    }
  }

  for (const char of Object.values(characters) as CharacterDraft[]) {
    if (!char.knowledgeState) continue;
    for (const [factId, status] of Object.entries(char.knowledgeState)) {
      if (!VALID_KNOWLEDGE_STATUS.has(status)) {
        errors.push(
          `Character ${char.characterId}: knowledgeState for "${factId}" has invalid value "${status}"; must be one of: ${[...VALID_KNOWLEDGE_STATUS].join(', ')}`,
        );
      }
    }
  }

  const result: ValidationResult = { valid: errors.length === 0, errors, warnings };
  if (!result.valid) {
    await updateDraft(draftId, { lastValidationResult: result });
  }
  return { ...state, validationResult: result };
};
