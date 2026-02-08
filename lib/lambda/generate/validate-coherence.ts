import type {
  CaseGenerationState,
  ValidationResult,
} from '../shared/generation-state';

/**
 * Pipeline Step 10: Validate Coherence (final step)
 *
 * Lightweight sanity check on the optimal path only. All other referential
 * integrity is validated at earlier steps (events, characters, locations,
 * casebook, questions). This step checks:
 * - Optimal path entries exist in casebook
 * - Optimal path is gate-feasible (accumulated facts satisfy gates)
 * - Optimal path covers all question answer facts
 *
 * Pure logic — no LLM call.
 */
export const handler = async (state: CaseGenerationState): Promise<CaseGenerationState> => {
  const { casebook, questions, optimalPath, introductionFactIds } = state;

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!casebook || !questions || !optimalPath) {
    errors.push('Incomplete state: casebook, questions, or optimalPath missing');
    return { ...state, validationResult: { valid: false, errors, warnings } };
  }

  const entryIds = new Set(Object.keys(casebook));

  // ---- Optimal path: entries exist, gate-feasible, covers answer facts ----
  const optimalCoveredFacts = new Set<string>(introductionFactIds ?? []);
  for (const entryId of optimalPath) {
    if (!entryIds.has(entryId)) {
      errors.push(`Optimal path references unknown entry "${entryId}"`);
      continue;
    }
    const entry = casebook[entryId];
    const gateFacts = entry.requiresAnyFact ?? [];
    const isAlwaysVisible = gateFacts.length === 0;
    if (!isAlwaysVisible && !gateFacts.some((f) => optimalCoveredFacts.has(f))) {
      errors.push(`Optimal path: entry "${entryId}" is gated by [${gateFacts.join(', ')}] but none are covered before this visit`);
    }
    for (const factId of entry.revealsFactIds) {
      optimalCoveredFacts.add(factId);
    }
  }
  for (const question of questions) {
    const hasAnswerCovered = question.answerFactIds.some((fid) => optimalCoveredFacts.has(fid));
    if (!hasAnswerCovered) {
      errors.push(`Optimal path does not cover any answer fact for question "${question.questionId}"`);
    }
  }

  const valid = errors.length === 0;
  const validationResult: ValidationResult = { valid, errors, warnings };

  return {
    ...state,
    validationResult,
  };
};
