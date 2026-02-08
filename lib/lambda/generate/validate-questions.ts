import type {
  CaseGenerationState,
  ValidationResult,
} from '../shared/generation-state';

/**
 * Pipeline Step 8b: Validate Questions (after CreateQuestions)
 *
 * Pure logic — no LLM call. Validates:
 * - Every question.answerFactIds references a valid factId
 * - Every answer fact is reachable (in discoveryGraphResult.reachableFactIds)
 * - Every answer fact's category matches question.answerCategory
 *
 * On failure, the Step Function retries CreateQuestions.
 */
export const handler = async (state: CaseGenerationState): Promise<CaseGenerationState> => {
  const { questions, facts, discoveryGraphResult } = state;

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!questions || questions.length === 0) {
    errors.push('No questions in state');
    return {
      ...state,
      questionValidationResult: { valid: false, errors, warnings },
    };
  }

  if (!facts || Object.keys(facts).length === 0) {
    errors.push('No facts in state; cannot validate question answerFactIds');
    return {
      ...state,
      questionValidationResult: { valid: false, errors, warnings },
    };
  }

  if (!discoveryGraphResult?.valid || !discoveryGraphResult.reachableFactIds) {
    errors.push(
      'Discovery graph was not validated or is invalid; cannot verify question-fact reachability',
    );
    return {
      ...state,
      questionValidationResult: { valid: false, errors, warnings },
    };
  }

  const factIds = new Set(Object.keys(facts));
  const reachableFactIds = new Set(discoveryGraphResult.reachableFactIds);

  for (const question of questions) {
    for (const factId of question.answerFactIds) {
      if (!factIds.has(factId)) {
        errors.push(
          `Question ${question.questionId}: answerFactIds references unknown fact "${factId}"`,
        );
      } else if (!reachableFactIds.has(factId)) {
        errors.push(
          `Question ${question.questionId}: answer fact "${factId}" is not reachable from introduction and casebook`,
        );
      } else {
        const fact = facts[factId];
        if (fact && fact.category !== question.answerCategory) {
          errors.push(
            `Question ${question.questionId}: answer fact "${factId}" category "${fact.category}" does not match answerCategory "${question.answerCategory}"`,
          );
        }
      }
    }
  }

  const valid = errors.length === 0;
  const questionValidationResult: ValidationResult = { valid, errors, warnings };

  return {
    ...state,
    questionValidationResult,
  };
};
