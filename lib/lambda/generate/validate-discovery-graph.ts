import type {
  CaseGenerationState,
  DiscoveryGraphResult,
  CasebookEntryDraft,
} from '../shared/generation-state';

/**
 * Pipeline Step 6b: Validate Discovery Graph
 *
 * Pure computation — no LLM call. Performs bipartite graph reachability
 * analysis (BFS) to verify that every fact and every casebook entry is
 * reachable starting from only the introduction facts.
 *
 * The bipartite graph has two node types:
 *   - **Facts**: unlocked by the introduction or revealed by entries
 *   - **Entries**: unlocked when ANY fact in their `requiresAnyFact` is discovered
 *
 * Algorithm:
 *   1. Seed reachable facts with `introductionFactIds`
 *   2. Seed reachable entries with always-visible entries (empty/absent `requiresAnyFact`)
 *   3. Iterate until fixed point:
 *      a. Reachable entries reveal new facts
 *      b. New facts unlock new entries (OR-gate)
 *   4. Report any unreachable facts or entries as errors
 *
 * If validation fails, the Step Function retries DesignCasebook with
 * error context (up to 2 retries).
 */
export const handler = async (state: CaseGenerationState): Promise<CaseGenerationState> => {
  const { events, characters, locations, facts, casebook, introductionFactIds } = state;

  if (!facts) throw new Error('Step 6b requires facts from step 5');
  if (!casebook) throw new Error('Step 6b requires casebook from step 6');
  if (!introductionFactIds) throw new Error('Step 6b requires introductionFactIds from step 5');
  if (!locations) throw new Error('Step 6b requires locations from step 4');
  if (!characters) throw new Error('Step 6b requires characters from step 3');
  if (!events) throw new Error('Step 6b requires events from step 2');

  const allFactIds = new Set(Object.keys(facts));
  const allEntries = Object.values(casebook);
  const allEntryIds = new Set(Object.keys(casebook));
  const allLocationIds = new Set(Object.keys(locations));
  const allCharacterIds = new Set(Object.keys(characters));

  const errors: string[] = [];
  const warnings: string[] = [];

  // ---- Pre-checks: casebook entry referential integrity ----
  for (const entry of allEntries) {
    if (!allLocationIds.has(entry.locationId)) {
      errors.push(
        `Entry "${entry.entryId}": locationId "${entry.locationId}" is not a valid location`,
      );
    }
    for (const charId of entry.characters) {
      if (!allCharacterIds.has(charId)) {
        errors.push(
          `Entry "${entry.entryId}": characters references unknown character "${charId}"`,
        );
      }
    }
    for (const gateFactId of entry.requiresAnyFact ?? []) {
      if (!allFactIds.has(gateFactId)) {
        errors.push(
          `Entry "${entry.entryId}": requiresAnyFact references unknown fact "${gateFactId}"`,
        );
      }
    }
    for (const revealedFactId of entry.revealsFactIds) {
      if (!allFactIds.has(revealedFactId)) {
        errors.push(
          `Entry "${entry.entryId}": revealsFactIds references unknown fact "${revealedFactId}"`,
        );
      }
    }
  }

  for (const introFactId of introductionFactIds) {
    if (!allFactIds.has(introFactId)) {
      errors.push(
        `introductionFactIds references unknown fact "${introFactId}"`,
      );
    }
  }

  // ---- Warnings: character knowledgeState and event reveals (fact refs) ----
  for (const character of Object.values(characters)) {
    for (const factId of Object.keys(character.knowledgeState)) {
      if (!allFactIds.has(factId)) {
        warnings.push(
          `Character ${character.characterId}: knowledgeState references unknown fact "${factId}"`,
        );
      }
    }
  }
  for (const event of Object.values(events)) {
    for (const factId of event.reveals) {
      if (!allFactIds.has(factId)) {
        warnings.push(
          `Event ${event.eventId}: reveals references unknown fact "${factId}"`,
        );
      }
    }
  }

  // If referential integrity is broken, bail early
  if (errors.length > 0) {
    const result: DiscoveryGraphResult = {
      valid: false,
      errors,
      warnings,
      reachableFactIds: [],
      reachableEntryIds: [],
    };
    return { ...state, discoveryGraphResult: result };
  }

  // ---- Bipartite BFS: facts ↔ entries ----
  const reachableFacts = new Set<string>(introductionFactIds);
  const reachableEntries = new Set<string>();

  // Seed with always-visible entries (empty or absent requiresAnyFact)
  for (const entry of allEntries) {
    if (isAlwaysVisible(entry)) {
      reachableEntries.add(entry.entryId);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;

    // Reachable entries reveal facts
    for (const entryId of reachableEntries) {
      const entry = casebook[entryId];
      for (const factId of entry.revealsFactIds) {
        if (!reachableFacts.has(factId)) {
          reachableFacts.add(factId);
          changed = true;
        }
      }
    }

    // Facts unlock entries (OR-gate: any one fact in requiresAnyFact)
    for (const entry of allEntries) {
      if (reachableEntries.has(entry.entryId)) continue;
      if (entry.requiresAnyFact.some((factId) => reachableFacts.has(factId))) {
        reachableEntries.add(entry.entryId);
        changed = true;
      }
    }
  }

  // ---- Check for unreachable facts ----
  for (const factId of allFactIds) {
    if (!reachableFacts.has(factId)) {
      errors.push(
        `Fact "${factId}" (${facts[factId].description}) is unreachable — not in introductionFactIds and not revealed by any reachable entry`,
      );
    }
  }

  // ---- Check for unreachable entries ----
  for (const entryId of allEntryIds) {
    if (!reachableEntries.has(entryId)) {
      const entry = casebook[entryId];
      const gateDisplay = entry.requiresAnyFact.join(', ');
      errors.push(
        `Entry "${entryId}" (${entry.label}) is unreachable — its gate facts [${gateDisplay}] are never discovered`,
      );
    }
  }

  // ---- Check that intro facts unlock at least some entries ----
  const firstWaveEntries = allEntries.filter(
    (e) => !isAlwaysVisible(e) && e.requiresAnyFact.some((f) => introductionFactIds.includes(f)),
  );
  if (firstWaveEntries.length === 0 && allEntries.every((e) => !isAlwaysVisible(e))) {
    errors.push(
      'No entries are unlocked by the introduction facts — the player has nowhere to go',
    );
  }

  const result: DiscoveryGraphResult = {
    valid: errors.length === 0,
    errors,
    warnings: warnings.length > 0 ? warnings : undefined,
    reachableFactIds: [...reachableFacts],
    reachableEntryIds: [...reachableEntries],
  };

  return {
    ...state,
    discoveryGraphResult: result,
  };
};

/** An entry is always visible if it has no gate (empty or absent requiresAnyFact). */
function isAlwaysVisible(entry: CasebookEntryDraft): boolean {
  return !entry.requiresAnyFact || entry.requiresAnyFact.length === 0;
}
