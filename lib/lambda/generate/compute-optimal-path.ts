import type { CaseGenerationState } from '../shared/generation-state';

/**
 * Pipeline Step 9: Compute Optimal Path
 *
 * Solves the set-cover problem: find the minimum ordered set of casebook
 * entries that reveals all facts required by all questions. This becomes
 * Holmes's solution path and the scoring baseline.
 *
 * This is pure computation — no LLM call needed.
 */
export const handler = async (state: CaseGenerationState): Promise<CaseGenerationState> => {
  const { casebook, questions, facts } = state;

  if (!casebook) throw new Error('Step 9 requires casebook from step 6');
  if (!questions) throw new Error('Step 9 requires questions from step 8');
  if (!facts) throw new Error('Step 9 requires facts from step 5');

  // Collect all facts required by all questions
  const requiredFactIds = new Set<string>();
  for (const question of questions) {
    for (const factId of question.requiredFacts) {
      requiredFactIds.add(factId);
    }
  }

  const entries = Object.values(casebook);

  // Greedy set-cover: at each step, pick the entry that covers the most
  // uncovered required facts. This is a well-known approximation algorithm
  // for the NP-hard set-cover problem (O(ln n) approximation ratio).
  const optimalPath: string[] = [];
  const coveredFacts = new Set<string>();

  while (coveredFacts.size < requiredFactIds.size) {
    let bestEntry: string | null = null;
    let bestNewCoverage = 0;
    let bestTotalFacts = 0;

    for (const entry of entries) {
      // Skip entries already in the path
      if (optimalPath.includes(entry.entryId)) continue;

      // Count how many uncovered required facts this entry reveals
      const newCoverage = entry.revealsFactIds.filter(
        (fid) => requiredFactIds.has(fid) && !coveredFacts.has(fid),
      ).length;

      if (
        newCoverage > bestNewCoverage ||
        (newCoverage === bestNewCoverage && entry.revealsFactIds.length > bestTotalFacts)
      ) {
        bestEntry = entry.entryId;
        bestNewCoverage = newCoverage;
        bestTotalFacts = entry.revealsFactIds.length;
      }
    }

    if (!bestEntry || bestNewCoverage === 0) {
      // No entry covers any remaining required facts — some facts may be unreachable.
      // This will be caught by the validation step.
      break;
    }

    optimalPath.push(bestEntry);
    const chosen = entries.find((e) => e.entryId === bestEntry)!;
    for (const fid of chosen.revealsFactIds) {
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
