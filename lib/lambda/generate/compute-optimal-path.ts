import type { CaseGenerationState, CasebookEntryDraft } from '../shared/generation-state';

/**
 * Pipeline Step 9: Compute Optimal Path
 *
 * Solves a gate-aware set-cover problem: find the minimum ordered set of
 * casebook entries that reveals all facts required by all questions, while
 * respecting entry gate constraints (`requiresAnyFact`).
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

  // Collect all facts required by all questions
  const requiredFactIds = new Set<string>();
  for (const question of questions) {
    for (const factId of question.requiredFacts) {
      requiredFactIds.add(factId);
    }
  }

  const entries = Object.values(casebook);

  // Gate-aware greedy set-cover.
  //
  // `discoveredFacts` tracks every fact the player would have after reading
  // the introduction and visiting all entries chosen so far. This includes
  // facts that aren't required by any question — they still matter because
  // they can serve as gate keys that unlock subsequent entries.
  //
  // `coveredFacts` tracks only the *required* facts that have been covered,
  // used to determine when the algorithm is done.
  const optimalPath: string[] = [];
  const discoveredFacts = new Set<string>(introductionFactIds);
  const coveredFacts = new Set<string>();

  // Seed coveredFacts with any required facts already in the intro set
  for (const fid of introductionFactIds) {
    if (requiredFactIds.has(fid)) {
      coveredFacts.add(fid);
    }
  }

  while (coveredFacts.size < requiredFactIds.size) {
    let bestEntry: CasebookEntryDraft | null = null;
    let bestNewCoverage = 0;
    let bestTotalFacts = 0;

    for (const entry of entries) {
      // Skip entries already in the path
      if (optimalPath.includes(entry.entryId)) continue;

      // Skip entries whose gate is not yet satisfied.
      // An entry with an empty/absent requiresAnyFact is always accessible.
      if (
        entry.requiresAnyFact &&
        entry.requiresAnyFact.length > 0 &&
        !entry.requiresAnyFact.some((fid) => discoveredFacts.has(fid))
      ) {
        continue;
      }

      // Count how many uncovered required facts this entry reveals
      const newCoverage = entry.revealsFactIds.filter(
        (fid) => requiredFactIds.has(fid) && !coveredFacts.has(fid),
      ).length;

      if (
        newCoverage > bestNewCoverage ||
        (newCoverage === bestNewCoverage && entry.revealsFactIds.length > bestTotalFacts)
      ) {
        bestEntry = entry;
        bestNewCoverage = newCoverage;
        bestTotalFacts = entry.revealsFactIds.length;
      }
    }

    if (!bestEntry || bestNewCoverage === 0) {
      // No reachable entry covers any remaining required facts.
      // This will be caught by the validation step.
      break;
    }

    optimalPath.push(bestEntry.entryId);
    // Add ALL revealed facts to discovered set — any fact can be a gate key
    for (const fid of bestEntry.revealsFactIds) {
      discoveredFacts.add(fid);
      if (requiredFactIds.has(fid)) {
        coveredFacts.add(fid);
      }
    }
  }

  return {
    ...state,
    optimalPath,
  };
};
