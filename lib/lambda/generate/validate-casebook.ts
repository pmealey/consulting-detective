import { getDraft } from '../shared/draft-db';
import type {
  OperationalState,
  CasebookValidationResult,
} from '../shared/generation-state';

/**
 * Pipeline Step 8b: Validate Casebook
 *
 * Pure computation — no LLM call. Performs bipartite graph reachability
 * analysis (BFS) to verify that every fact and every casebook entry is
 * reachable starting from only the introduction facts.
 *
 * The programmatic phase of GenerateCasebook should guarantee structural
 * correctness, but this step serves as a safety net — catching any issues
 * introduced by the AI polish phase (e.g. invalid character references)
 * or edge cases in the programmatic logic.
 *
 * The bipartite graph has two node types:
 *   - **Facts**: unlocked by the introduction or revealed by entries
 *   - **Entries**: unlocked when ANY fact in their `requiresAnyFact` is discovered
 *
 * Algorithm:
 *   1. Seed reachable facts with `introductionFactIds`
 *   2. Iterate until fixed point:
 *      a. Reachable facts unlock new entries (OR-gate)
 *      b. Reachable entries reveal new facts
 *   3. Report any unreachable facts or entries as errors
 *
 * If validation fails, the Step Function retries GenerateCasebook with
 * error context (up to 2 retries).
 */
export const handler = async (state: OperationalState): Promise<OperationalState> => {
  const { draftId } = state;
  const draft = await getDraft(draftId);
  const { events, characters, locations, facts, casebook, introductionFactIds } = draft ?? {};

  if (!facts) throw new Error('ValidateCasebook requires facts');
  if (!casebook) throw new Error('ValidateCasebook requires casebook');
  if (!introductionFactIds) throw new Error('ValidateCasebook requires introductionFactIds');
  if (!locations) throw new Error('ValidateCasebook requires locations');
  if (!characters) throw new Error('ValidateCasebook requires characters');
  if (!events) throw new Error('ValidateCasebook requires events');

  const allFactIds = new Set(Object.keys(facts));
  const allEntries = Object.values(casebook);
  const allEntryIds = new Set(Object.keys(casebook));
  const allLocationIds = new Set(Object.keys(locations));
  const allCharacterIds = new Set(Object.keys(characters));

  const errors: string[] = [];
  const warnings: string[] = [];

  // ── Referential integrity checks ─────────────────────────────────
  for (const entry of allEntries) {
    if (!allLocationIds.has(entry.locationId)) {
      errors.push(
        `Entry "${entry.entryId}": locationId "${entry.locationId}" is not a valid location`,
      );
    }
    for (const charId of entry.characterIds) {
      if (!allCharacterIds.has(charId)) {
        errors.push(
          `Entry "${entry.entryId}": characterIds references unknown character "${charId}"`,
        );
      }
    }
    for (const gateFactId of entry.requiresAnyFact) {
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

    // Every entry must be gated (non-empty requiresAnyFact)
    if (!entry.requiresAnyFact || entry.requiresAnyFact.length === 0) {
      errors.push(
        `Entry "${entry.entryId}": requiresAnyFact is empty — every entry must be gated`,
      );
    }
  }

  for (const introFactId of introductionFactIds) {
    if (!allFactIds.has(introFactId)) {
      errors.push(
        `introductionFactIds references unknown fact "${introFactId}"`,
      );
    }
  }

  // ── Warnings: character knowledgeState and event reveals (fact refs) ──
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
    for (const reveal of event.reveals) {
      if (!allFactIds.has(reveal.id)) {
        warnings.push(
          `Event ${event.eventId}: reveals references unknown fact "${reveal.id}"`,
        );
      }
    }
  }

  // If referential integrity is broken, bail early
  if (errors.length > 0) {
    const result: CasebookValidationResult = {
      valid: false,
      errors,
      warnings,
      reachableFactIds: [],
      reachableEntryIds: [],
    };
    return { ...state, validationResult: result };
  }

  // ── Bipartite BFS: facts ↔ entries ───────────────────────────────
  const reachableFacts = new Set<string>(introductionFactIds);
  const reachableEntries = new Set<string>();

  let changed = true;
  while (changed) {
    changed = false;

    // Facts unlock entries (OR-gate: any one fact in requiresAnyFact)
    for (const entry of allEntries) {
      if (reachableEntries.has(entry.entryId)) continue;
      if (entry.requiresAnyFact.some((factId) => reachableFacts.has(factId))) {
        reachableEntries.add(entry.entryId);
        changed = true;
      }
    }

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
  }

  // ── Check for unreachable facts ──────────────────────────────────
  for (const factId of allFactIds) {
    if (!reachableFacts.has(factId)) {
      errors.push(
        `Fact "${factId}" (${facts[factId].description}) is unreachable — not in introductionFactIds and not revealed by any reachable entry`,
      );
    }
  }

  // ── Check for unreachable entries ────────────────────────────────
  for (const entryId of allEntryIds) {
    if (!reachableEntries.has(entryId)) {
      const entry = casebook[entryId];
      const gateDisplay = entry.requiresAnyFact.join(', ');
      errors.push(
        `Entry "${entryId}" (${entry.label}) is unreachable — its gate facts [${gateDisplay}] are never discovered`,
      );
    }
  }

  // ── Check that intro facts unlock at least some entries ──────────
  const firstWaveEntries = allEntries.filter(
    (e) => e.requiresAnyFact.some((f) => introductionFactIds.includes(f)),
  );
  if (firstWaveEntries.length === 0) {
    errors.push(
      'No entries are unlocked by the introduction facts — the player has nowhere to go',
    );
  }

  const result: CasebookValidationResult = {
    valid: errors.length === 0,
    errors,
    warnings,
    reachableFactIds: [...reachableFacts],
    reachableEntryIds: [...reachableEntries],
  };

  return { ...state, validationResult: result };
};
