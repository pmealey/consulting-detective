import { getDraft } from '../shared/draft-db';
import type {
  OperationalState,
  ValidationResult,
} from '../shared/generation-state';

/**
 * Pipeline Step 10b: Validate Questions (after GenerateQuestions)
 *
 * Pure logic — no LLM call. Validates:
 * - Every question has a valid answer type ('person', 'location', or 'fact')
 * - For 'fact' answers: factCategory is present, acceptedIds reference valid factIds,
 *   answer facts are reachable, and their categories match factCategory
 * - For 'person' answers: acceptedIds reference valid characterIds
 * - For 'location' answers: acceptedIds reference valid locationIds
 *
 * On failure, the Step Function retries GenerateQuestions.
 */
export const handler = async (state: OperationalState): Promise<OperationalState> => {
  const { draftId } = state;
  const draft = await getDraft(draftId);
  const { questions, facts, characters, locations } = draft ?? {};
  const casebookValidationResult =
    state.validationResult && 'reachableFactIds' in state.validationResult
      ? state.validationResult
      : undefined;

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!questions || questions.length === 0) {
    errors.push('No questions in state');
    return { ...state, validationResult: { valid: false, errors, warnings } };
  }

  if (!facts || Object.keys(facts).length === 0) {
    errors.push('No facts in state; cannot validate question answers');
    return { ...state, validationResult: { valid: false, errors, warnings } };
  }

  if (!casebookValidationResult?.valid || !casebookValidationResult.reachableFactIds) {
    errors.push(
      'Casebook validation was not run or is invalid; cannot verify question-fact reachability',
    );
    return { ...state, validationResult: { valid: false, errors, warnings } };
  }

  const factIds = new Set(Object.keys(facts));
  const characterIds = new Set(characters ? Object.keys(characters) : []);
  const locationIds = new Set(locations ? Object.keys(locations) : []);
  const reachableFactIds = new Set(casebookValidationResult.reachableFactIds);

  const validAnswerTypes = new Set(['person', 'location', 'fact']);

  for (const question of questions) {
    const { answer } = question;

    if (!answer || !validAnswerTypes.has(answer.type)) {
      errors.push(
        `Question ${question.questionId}: answer.type must be 'person', 'location', or 'fact' (got "${answer?.type}")`,
      );
      continue;
    }

    if (!answer.acceptedIds || answer.acceptedIds.length === 0) {
      errors.push(
        `Question ${question.questionId}: answer.acceptedIds must have at least one entry`,
      );
      continue;
    }

    switch (answer.type) {
      case 'fact': {
        if (!answer.factCategory) {
          errors.push(
            `Question ${question.questionId}: answer.factCategory is required when type is 'fact'`,
          );
        }
        for (const id of answer.acceptedIds) {
          if (!factIds.has(id)) {
            errors.push(
              `Question ${question.questionId}: answer.acceptedIds references unknown fact "${id}"`,
            );
          } else {
            const fact = facts[id];
            if (fact?.veracity === 'false') {
              errors.push(
                `Question ${question.questionId}: answer fact "${id}" has veracity "false"; only true facts may be accepted answers`,
              );
            } else if (!reachableFactIds.has(id)) {
              errors.push(
                `Question ${question.questionId}: answer fact "${id}" is not reachable from introduction and casebook`,
              );
            } else if (answer.factCategory && fact && fact.category !== answer.factCategory) {
              errors.push(
                `Question ${question.questionId}: answer fact "${id}" category "${fact.category}" does not match factCategory "${answer.factCategory}"`,
              );
            }
          }
        }
        break;
      }
      case 'person': {
        for (const id of answer.acceptedIds) {
          if (!characterIds.has(id)) {
            errors.push(
              `Question ${question.questionId}: answer.acceptedIds references unknown character "${id}"`,
            );
          }
        }
        break;
      }
      case 'location': {
        for (const id of answer.acceptedIds) {
          if (!locationIds.has(id)) {
            errors.push(
              `Question ${question.questionId}: answer.acceptedIds references unknown location "${id}"`,
            );
          }
        }
        break;
      }
    }
  }

  const valid = errors.length === 0;
  const questionValidationResult: ValidationResult = { valid, errors, warnings };

  return { ...state, validationResult: questionValidationResult };
};
