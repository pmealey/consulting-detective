import type {
  CaseGenerationState,
  ValidationResult,
} from '../shared/generation-state';

/**
 * Pipeline Step 3b: Validate Characters (after PopulateCharacters)
 *
 * Pure logic — no LLM call. Validates that event character references
 * are valid after roleIds have been remapped to characterIds:
 *
 * - Every event.agent references a valid characterId
 * - Every key in event.involvement references a valid characterId
 */
export const handler = async (state: CaseGenerationState): Promise<CaseGenerationState> => {
  const { events, characters } = state;

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!events || Object.keys(events).length === 0) {
    errors.push('No events in state');
    return {
      ...state,
      characterValidationResult: { valid: false, errors, warnings },
    };
  }

  if (!characters || Object.keys(characters).length === 0) {
    errors.push('No characters in state');
    return {
      ...state,
      characterValidationResult: { valid: false, errors, warnings },
    };
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

  return {
    ...state,
    characterValidationResult: {
      valid: errors.length === 0,
      errors,
      warnings,
    },
  };
};
