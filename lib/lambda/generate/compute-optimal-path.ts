import type { CaseGenerationState, CasebookEntryDraft } from '../shared/generation-state';

/**
 * Pipeline Step 9: Compute Optimal Path
 *
 * Solves a gate-aware set-cover problem: find the minimum ordered set of
 * casebook entries such that for each question, at least one of its
 * acceptable answer facts is revealed (shortest path to "easiest" answers),
 * while respecting entry gate constraints (`requiresAnyFact`).
 *
 * At each step only entries whose gates are satisfied by the currently
 * discovered facts (intro facts + facts revealed by previously chosen
 * entries) are eligible. This ensures the resulting path is actually
 * walkable by a player who follows it in order.
 *
 * This is pure computation — no LLM call needed.
 */
export const handler = async (state: CaseGenerationState): Promise<CaseGenerationState> => {
  const { casebook, questions, facts, introductionFactIds } = state;

  if (!casebook) throw new Error('Step 9 requires casebook from step 6');
  if (!questions) throw new Error('Step 9 requires questions from step 8');
  if (!facts) throw new Error('Step 9 requires facts from step 5');
  if (!introductionFactIds) throw new Error('Step 9 requires introductionFactIds from step 5');

  const entries = Object.values(casebook);

  // A question is "satisfied" when at least one of its answerFactIds is in discoveredFacts.
  // We want the shortest path that satisfies all questions (one acceptable answer per question).
  const optimalPath: string[] = [];
  const discoveredFacts = new Set<string>(introductionFactIds);
  const satisfiedQuestionIds = new Set<string>();

  const isQuestionSatisfied = (questionId: string, factsSet: Set<string>): boolean => {
    const q = questions.find((x) => x.questionId === questionId);
    return q ? q.answerFactIds.some((fid) => factsSet.has(fid)) : false;
  };

  // Seed satisfied questions from intro
  for (const q of questions) {
    if (isQuestionSatisfied(q.questionId, discoveredFacts)) {
      satisfiedQuestionIds.add(q.questionId);
    }
  }

  while (satisfiedQuestionIds.size < questions.length) {
    let bestEntry: CasebookEntryDraft | null = null;
    let bestNewlySatisfied = 0;
    let bestTotalFacts = 0;

    for (const entry of entries) {
      if (optimalPath.includes(entry.entryId)) continue;

      if (
        entry.requiresAnyFact &&
        entry.requiresAnyFact.length > 0 &&
        !entry.requiresAnyFact.some((fid) => discoveredFacts.has(fid))
      ) {
        continue;
      }

      // How many currently unsatisfied questions would this entry satisfy?
      const wouldHaveFacts = new Set([...discoveredFacts, ...entry.revealsFactIds]);
      let newlySatisfied = 0;
      for (const q of questions) {
        if (satisfiedQuestionIds.has(q.questionId)) continue;
        if (isQuestionSatisfied(q.questionId, wouldHaveFacts)) newlySatisfied++;
      }

      if (
        newlySatisfied > bestNewlySatisfied ||
        (newlySatisfied === bestNewlySatisfied && entry.revealsFactIds.length > bestTotalFacts)
      ) {
        bestEntry = entry;
        bestNewlySatisfied = newlySatisfied;
        bestTotalFacts = entry.revealsFactIds.length;
      }
    }

    if (!bestEntry || bestNewlySatisfied === 0) {
      break;
    }

    optimalPath.push(bestEntry.entryId);
    for (const fid of bestEntry.revealsFactIds) {
      discoveredFacts.add(fid);
    }
    for (const q of questions) {
      if (!satisfiedQuestionIds.has(q.questionId) && isQuestionSatisfied(q.questionId, discoveredFacts)) {
        satisfiedQuestionIds.add(q.questionId);
      }
    }
  }

  return {
    ...state,
    optimalPath,
  };
};
