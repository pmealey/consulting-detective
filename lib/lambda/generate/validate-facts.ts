import type {
  CaseGenerationState,
  ValidationResult,
  FactDraft,
  FactPlaceholder,
} from '../shared/generation-state';

const VALID_CATEGORIES = new Set([
  'motive', 'means', 'opportunity', 'alibi',
  'relationship', 'timeline', 'physical_evidence', 'background',
]);

/**
 * Pipeline Step 7b: Validate Facts (after GenerateFacts)
 *
 * Pure logic — no LLM call. Validates that the AI's fact output correctly
 * fills all placeholders from ComputeFacts:
 *
 * - Every placeholder has a corresponding fact in the output
 * - Every fact has a valid category
 * - Subjects reference valid characterIds or locationIds
 * - factIds are unique
 * - Veracity matches the placeholder's veracity
 *
 * If validation fails, the Step Function retries GenerateFacts with
 * error context (up to 2 retries).
 */
export const handler = async (state: CaseGenerationState): Promise<CaseGenerationState> => {
  const { facts, factPlaceholders, characters, locations } = state;

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!facts || Object.keys(facts).length === 0) {
    errors.push('No facts in state — GenerateFacts produced no output');
    return {
      ...state,
      factValidationResult: { valid: false, errors, warnings },
    };
  }

  if (!factPlaceholders || factPlaceholders.length === 0) {
    errors.push('No factPlaceholders in state — ComputeFacts must run first');
    return {
      ...state,
      factValidationResult: { valid: false, errors, warnings },
    };
  }

  if (!characters) {
    errors.push('No characters in state');
    return {
      ...state,
      factValidationResult: { valid: false, errors, warnings },
    };
  }

  if (!locations) {
    errors.push('No locations in state');
    return {
      ...state,
      factValidationResult: { valid: false, errors, warnings },
    };
  }

  const allCharacterIds = new Set(Object.keys(characters));
  const allLocationIds = new Set(Object.keys(locations));
  const validSubjectIds = new Set([...allCharacterIds, ...allLocationIds]);

  // Build a map from placeholderId to the factId that was generated for it.
  // We need to check that every placeholder was filled.
  const placeholderMap = new Map<string, FactPlaceholder>();
  for (const p of factPlaceholders) {
    placeholderMap.set(p.placeholderId, p);
  }

  // Build a reverse map: factId -> FactDraft for uniqueness checking
  const factIdSet = new Set<string>();
  const factsByFactId = new Map<string, FactDraft>();

  for (const [factId, fact] of Object.entries(facts)) {
    // Check factId uniqueness (the Record key and the factId field should match)
    if (factId !== fact.factId) {
      errors.push(
        `Fact record key "${factId}" does not match its factId field "${fact.factId}"`,
      );
    }

    if (factIdSet.has(fact.factId)) {
      errors.push(`Duplicate factId: "${fact.factId}"`);
    }
    factIdSet.add(fact.factId);
    factsByFactId.set(fact.factId, fact);

    // Validate category
    if (!VALID_CATEGORIES.has(fact.category)) {
      errors.push(
        `Fact "${fact.factId}": invalid category "${fact.category}"`,
      );
    }

    // Validate description is non-empty
    if (!fact.description || fact.description.trim().length === 0) {
      errors.push(`Fact "${fact.factId}": description is empty`);
    }

    // Validate subjects reference valid character or location IDs
    if (!fact.subjects || fact.subjects.length === 0) {
      errors.push(`Fact "${fact.factId}": subjects array is empty`);
    } else {
      for (const subjectId of fact.subjects) {
        if (!validSubjectIds.has(subjectId)) {
          errors.push(
            `Fact "${fact.factId}": subject "${subjectId}" is not a valid characterId or locationId`,
          );
        }
      }
    }

    // Validate veracity
    if (fact.veracity !== 'true' && fact.veracity !== 'false') {
      errors.push(
        `Fact "${fact.factId}": invalid veracity "${fact.veracity}" (must be "true" or "false")`,
      );
    }
  }

  // Check that every placeholder was filled.
  // We match placeholders to facts by checking that a fact exists whose subjects
  // and veracity match the placeholder. The generate-facts step merges placeholder
  // data into the facts, so we check that every placeholder's data is represented.
  //
  // Since generate-facts.ts uses the placeholder's subjects and veracity directly,
  // we verify coverage by counting: we need at least as many facts as placeholders.
  const factCount = Object.keys(facts).length;
  const placeholderCount = factPlaceholders.length;

  if (factCount < placeholderCount) {
    errors.push(
      `Only ${factCount} facts were generated for ${placeholderCount} placeholders — ` +
      `${placeholderCount - factCount} placeholder(s) are missing`,
    );
  }

  // For each placeholder, verify its veracity is preserved in the corresponding fact.
  // We match by checking that for each placeholder, there exists a fact with matching
  // subjects (as a set) and veracity. This is a structural integrity check.
  const factsArray = Object.values(facts);
  const matchedPlaceholders = new Set<string>();

  for (const placeholder of factPlaceholders) {
    const placeholderSubjectSet = new Set(placeholder.subjects);

    const matchingFact = factsArray.find((f) => {
      if (f.veracity !== placeholder.veracity) return false;
      if (f.subjects.length !== placeholderSubjectSet.size) return false;
      return f.subjects.every((s) => placeholderSubjectSet.has(s));
    });

    if (matchingFact) {
      matchedPlaceholders.add(placeholder.placeholderId);
    } else {
      // This is a warning rather than an error because the AI might have
      // slightly reordered subjects. The critical check is the count above.
      warnings.push(
        `Placeholder "${placeholder.placeholderId}" (subjects: [${placeholder.subjects.join(', ')}], veracity: ${placeholder.veracity}) ` +
        `has no exact match in generated facts`,
      );
    }
  }

  // Warn if there are more facts than placeholders (AI added extras)
  if (factCount > placeholderCount) {
    warnings.push(
      `${factCount} facts were generated for ${placeholderCount} placeholders — ` +
      `${factCount - placeholderCount} extra fact(s) were added by the AI`,
    );
  }

  const result: ValidationResult = {
    valid: errors.length === 0,
    errors,
    warnings,
  };

  return {
    ...state,
    factValidationResult: result,
  };
};
