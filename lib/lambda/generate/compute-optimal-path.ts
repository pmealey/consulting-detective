import { getDraft, updateDraft } from '../shared/draft-db';
import type { OperationalState, CasebookEntryDraft } from '../shared/generation-state';

/**
 * Pipeline Step 11: Compute Optimal Path
 *
 * Solves a gate-aware set-cover problem: find the minimum ordered set of
 * casebook entries such that for each question, at least one of its
 * acceptable answers is discoverable (shortest path to "easiest" answers),
 * while respecting entry gate constraints (`requiresAnyFact`).
 *
 * Answer types: 'fact' — acceptedId in discovered facts; 'person'/'location'
 * — any discovered fact has a subject matching an acceptedId.
 *
 * Includes coherence checks (formerly ValidateCoherence): path entries exist,
 * path is gate-feasible, and path covers all questions. Sets validationResult
 * so StoreCase can proceed.
 *
 * This is pure computation — no LLM call needed.
 */
export const handler = async (state: OperationalState): Promise<OperationalState> => {
  const { draftId, input } = state;
  const draft = await getDraft(draftId);
  const { casebook, questions, facts, introductionFactIds } = draft ?? {};

  if (!casebook) throw new Error('ComputeOptimalPath requires casebook from step 8');
  if (!questions) throw new Error('ComputeOptimalPath requires questions from step 10');
  if (!facts) throw new Error('ComputeOptimalPath requires facts from step 6');
  if (!introductionFactIds) throw new Error('ComputeOptimalPath requires introductionFactIds from step 7');

  const entries = Object.values(casebook);

  // A question is "satisfied" when at least one of its answer.acceptedIds is discoverable.
  // For 'fact' answers: the acceptedId must be in discoveredFacts.
  // For 'person'/'location' answers: any discoveredFact must have a subject matching an acceptedId.
  // We want the shortest path that satisfies all questions.
  const optimalPath: string[] = [];
  const discoveredFacts = new Set<string>(introductionFactIds);
  const satisfiedQuestionIds = new Set<string>();

  const isQuestionSatisfied = (questionId: string, factsSet: Set<string>): boolean => {
    const q = questions.find((x) => x.questionId === questionId);
    if (!q) return false;
    switch (q.answer.type) {
      case 'fact':
        return q.answer.acceptedIds.some((id) => factsSet.has(id));
      case 'person':
      case 'location': {
        // The question is satisfied when any discovered fact has a subject matching an acceptedId
        const acceptedSet = new Set(q.answer.acceptedIds);
        for (const fid of factsSet) {
          const fact = facts[fid];
          if (fact && fact.subjects.some((s) => acceptedSet.has(s))) return true;
        }
        return false;
      }
      default:
        return false;
    }
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

    // If no entry directly satisfies a new question, fall back to the entry
    // that unlocks the most *new* gated entries — this "bridge" step expands
    // reachability so future iterations can reach answer-bearing entries.
    if (!bestEntry || bestNewlySatisfied === 0) {
      let bestBridgeEntry: CasebookEntryDraft | null = null;
      let bestNewlyUnlocked = 0;
      let bestBridgeFacts = 0;

      for (const entry of entries) {
        if (optimalPath.includes(entry.entryId)) continue;

        if (
          entry.requiresAnyFact &&
          entry.requiresAnyFact.length > 0 &&
          !entry.requiresAnyFact.some((fid) => discoveredFacts.has(fid))
        ) {
          continue;
        }

        // Count how many currently unreachable entries this would unlock
        const wouldHaveFacts = new Set([...discoveredFacts, ...entry.revealsFactIds]);
        let newlyUnlocked = 0;
        for (const other of entries) {
          if (optimalPath.includes(other.entryId) || other.entryId === entry.entryId) continue;
          if (
            other.requiresAnyFact &&
            other.requiresAnyFact.length > 0 &&
            !other.requiresAnyFact.some((fid) => discoveredFacts.has(fid)) &&
            other.requiresAnyFact.some((fid) => wouldHaveFacts.has(fid))
          ) {
            newlyUnlocked++;
          }
        }

        const newFactCount = entry.revealsFactIds.filter((fid) => !discoveredFacts.has(fid)).length;

        if (
          newlyUnlocked > bestNewlyUnlocked ||
          (newlyUnlocked === bestNewlyUnlocked && newFactCount > bestBridgeFacts)
        ) {
          bestBridgeEntry = entry;
          bestNewlyUnlocked = newlyUnlocked;
          bestBridgeFacts = newFactCount;
        }
      }

      // If no bridge entry can expand reachability either, we're truly stuck
      if (!bestBridgeEntry || (bestNewlyUnlocked === 0 && bestBridgeFacts === 0)) {
        break;
      }

      bestEntry = bestBridgeEntry;
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

  // Coherence checks (absorbed from ValidateCoherence)
  const errors: string[] = [];
  for (const entryId of optimalPath) {
    if (!casebook[entryId]) {
      errors.push(`Optimal path entry "${entryId}" is not in casebook`);
    }
  }
  let walkFacts = new Set<string>(introductionFactIds);
  for (const entryId of optimalPath) {
    const entry = casebook[entryId];
    if (!entry) continue;
    if (entry.requiresAnyFact && entry.requiresAnyFact.length > 0) {
      const gateSatisfied = entry.requiresAnyFact.some((fid) => walkFacts.has(fid));
      if (!gateSatisfied) {
        errors.push(`Entry "${entryId}" is gated on [${entry.requiresAnyFact.join(', ')}] but none are in intro or prior path`);
      }
    }
    for (const fid of entry.revealsFactIds) walkFacts.add(fid);
  }
  if (satisfiedQuestionIds.size < questions.length) {
    const missing = questions.filter((q) => !satisfiedQuestionIds.has(q.questionId)).map((q) => q.questionId);
    errors.push(`Path does not cover questions: ${missing.join(', ')}`);
  }
  if (errors.length > 0) {
    throw new Error(`Coherence check failed: ${errors.join('; ')}`);
  }

  await updateDraft(draftId, { optimalPath });
  return {
    ...state,
    validationResult: { valid: true, errors: [], warnings: [] },
  };
};
