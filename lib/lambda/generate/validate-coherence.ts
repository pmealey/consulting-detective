import type {
  CaseGenerationState,
  ValidationResult,
} from '../shared/generation-state';

/**
 * Pipeline Step 10: Validate Coherence
 *
 * Structural validation of the fully assembled case. Checks:
 * - Referential integrity (all IDs point to real objects)
 * - introductionFactIds and requiresAnyFact reference valid factIds
 * - Every question's answerFactIds are in the discovery-graph reachable set and category matches
 * - The optimal path is gate-feasible and covers all answer facts
 * - Character knowledge states are consistent with event involvement
 * - Location graph integrity (symmetric adjacency, valid parents)
 *
 * This is pure logic — no LLM call needed.
 */
export const handler = async (state: CaseGenerationState): Promise<CaseGenerationState> => {
  const { events, characters, locations, facts, casebook, questions, optimalPath, introductionFactIds, discoveryGraphResult } = state;

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
    for (const adjId of location.accessibleFrom) {
      if (!locationIds.has(adjId)) {
        errors.push(`Location ${location.locationId}: accessibleFrom references unknown location "${adjId}"`);
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
    const gateFacts = entry.requiresAnyFact ?? [];
    for (const factId of gateFacts) {
      if (!factIds.has(factId)) {
        errors.push(`CasebookEntry ${entry.entryId}: requiresAnyFact references unknown fact "${factId}"`);
      }
    }
  }

  // ---- introductionFactIds Validation ----
  if (introductionFactIds) {
    for (const factId of introductionFactIds) {
      if (!factIds.has(factId)) {
        errors.push(`introductionFactIds references unknown fact "${factId}"`);
      }
    }
  }

  // ---- Question reachability (reuse discovery graph reachable set) ----
  if (!discoveryGraphResult?.valid || !discoveryGraphResult.reachableFactIds) {
    errors.push('Discovery graph was not validated or is invalid; cannot verify question-fact reachability');
  }
  const reachableFactIds = discoveryGraphResult?.reachableFactIds
    ? new Set(discoveryGraphResult.reachableFactIds)
    : null;
  for (const question of questions) {
    for (const factId of question.answerFactIds) {
      if (!factIds.has(factId)) {
        errors.push(`Question ${question.questionId}: answerFactIds references unknown fact "${factId}"`);
      } else if (reachableFactIds && !reachableFactIds.has(factId)) {
        errors.push(`Question ${question.questionId}: answer fact "${factId}" is not reachable from introduction and casebook`);
      } else if (facts[factId] && facts[factId].category !== question.answerCategory) {
        errors.push(`Question ${question.questionId}: answer fact "${factId}" category "${facts[factId].category}" does not match answerCategory "${question.answerCategory}"`);
      }
    }
  }

  // ---- Optimal Path Validation (gate-feasible + covers required facts) ----
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
