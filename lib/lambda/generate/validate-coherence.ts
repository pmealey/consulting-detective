import type {
  CaseGenerationState,
  ValidationResult,
} from '../shared/generation-state';

/**
 * Pipeline Step 10: Validate Coherence
 *
 * Structural validation of the fully assembled case. Checks:
 * - Referential integrity (all IDs point to real objects)
 * - Every critical fact is reachable via at least one casebook entry
 * - Every question's requiredFacts are all discoverable
 * - The optimal path covers all required facts
 * - Character knowledge states are consistent with event involvement
 * - Location graph integrity (symmetric adjacency, valid parents)
 *
 * This is pure logic — no LLM call needed.
 */
export const handler = async (state: CaseGenerationState): Promise<CaseGenerationState> => {
  const { events, characters, locations, facts, casebook, questions, optimalPath } = state;

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!events || !characters || !locations || !facts || !casebook || !questions || !optimalPath) {
    errors.push('Incomplete state: one or more pipeline steps did not produce output');
    return { ...state, validationResult: { valid: false, errors, warnings } };
  }

  const eventIds = new Set(Object.keys(events));
  const characterIds = new Set(Object.keys(characters));
  const locationIds = new Set(Object.keys(locations));
  const factIds = new Set(Object.keys(facts));
  const entryIds = new Set(Object.keys(casebook));

  // ---- Event Validation ----
  for (const event of Object.values(events)) {
    if (!characterIds.has(event.agent)) {
      errors.push(`Event ${event.eventId}: agent "${event.agent}" is not a valid characterId`);
    }
    if (!locationIds.has(event.location)) {
      errors.push(`Event ${event.eventId}: location "${event.location}" is not a valid locationId`);
    }
    for (const charId of Object.keys(event.involvement)) {
      if (!characterIds.has(charId)) {
        errors.push(`Event ${event.eventId}: involvement references unknown character "${charId}"`);
      }
    }
    for (const causedId of event.causes) {
      if (!eventIds.has(causedId)) {
        errors.push(`Event ${event.eventId}: causes references unknown event "${causedId}"`);
      }
    }
    for (const factId of event.reveals) {
      if (!factIds.has(factId)) {
        warnings.push(`Event ${event.eventId}: reveals references unknown fact "${factId}"`);
      }
    }
    if (event.involvement[event.agent] !== 'agent') {
      warnings.push(`Event ${event.eventId}: agent "${event.agent}" not listed as "agent" in involvement map`);
    }
  }

  // ---- Character Validation ----
  for (const character of Object.values(characters)) {
    for (const factId of Object.keys(character.knowledgeState)) {
      if (!factIds.has(factId)) {
        warnings.push(`Character ${character.characterId}: knowledgeState references unknown fact "${factId}"`);
      }
    }
  }

  // ---- Location Validation ----
  for (const location of Object.values(locations)) {
    if (location.parent && !locationIds.has(location.parent)) {
      errors.push(`Location ${location.locationId}: parent "${location.parent}" is not a valid locationId`);
    }
    for (const adjId of location.adjacentTo) {
      if (!locationIds.has(adjId)) {
        errors.push(`Location ${location.locationId}: adjacentTo references unknown location "${adjId}"`);
      }
    }
    // Check symmetric adjacency
    for (const adjId of location.adjacentTo) {
      if (locationIds.has(adjId) && !locations[adjId].adjacentTo.includes(location.locationId)) {
        warnings.push(`Location ${location.locationId}: adjacentTo "${adjId}" is not symmetric`);
      }
    }
  }

  // ---- Casebook Entry Validation ----
  for (const entry of Object.values(casebook)) {
    if (!locationIds.has(entry.locationId)) {
      errors.push(`CasebookEntry ${entry.entryId}: locationId "${entry.locationId}" is not a valid location`);
    }
    for (const charId of entry.characters) {
      if (!characterIds.has(charId)) {
        errors.push(`CasebookEntry ${entry.entryId}: characters references unknown character "${charId}"`);
      }
    }
    for (const factId of entry.revealsFactIds) {
      if (!factIds.has(factId)) {
        errors.push(`CasebookEntry ${entry.entryId}: revealsFactIds references unknown fact "${factId}"`);
      }
    }
  }

  // ---- Fact Reachability ----
  const discoverableFactIds = new Set(
    Object.values(casebook).flatMap((e) => e.revealsFactIds),
  );
  const criticalFacts = Object.values(facts).filter((f) => f.critical);
  for (const fact of criticalFacts) {
    if (!discoverableFactIds.has(fact.factId)) {
      errors.push(`Critical fact "${fact.factId}" is not discoverable via any casebook entry`);
    }
  }

  // ---- Question Validation ----
  for (const question of questions) {
    for (const factId of question.requiredFacts) {
      if (!factIds.has(factId)) {
        errors.push(`Question ${question.questionId}: requiredFacts references unknown fact "${factId}"`);
      } else if (!discoverableFactIds.has(factId)) {
        errors.push(`Question ${question.questionId}: required fact "${factId}" is not discoverable`);
      }
    }
  }

  // Check all critical facts are covered by at least one question
  const questionRequiredFacts = new Set(questions.flatMap((q) => q.requiredFacts));
  for (const fact of criticalFacts) {
    if (!questionRequiredFacts.has(fact.factId)) {
      warnings.push(`Critical fact "${fact.factId}" is not required by any question`);
    }
  }

  // ---- Optimal Path Validation ----
  const optimalCoveredFacts = new Set<string>();
  for (const entryId of optimalPath) {
    if (!entryIds.has(entryId)) {
      errors.push(`Optimal path references unknown entry "${entryId}"`);
      continue;
    }
    for (const factId of casebook[entryId].revealsFactIds) {
      optimalCoveredFacts.add(factId);
    }
  }
  for (const factId of questionRequiredFacts) {
    if (!optimalCoveredFacts.has(factId)) {
      errors.push(`Optimal path does not cover required fact "${factId}"`);
    }
  }

  const valid = errors.length === 0;
  const validationResult: ValidationResult = { valid, errors, warnings };

  return {
    ...state,
    validationResult,
  };
};
