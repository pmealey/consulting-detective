import { getDraft } from '../shared/draft-db';
import type {
  OperationalState,
  ValidationResult,
  FactDraft,
  FactSkeleton,
} from '../shared/generation-state';

const VALID_CATEGORIES = new Set([
  'motive', 'means', 'opportunity', 'alibi',
  'relationship', 'timeline', 'physical_evidence', 'background',
]);

/**
 * Pipeline Step 7b: Validate Facts (after GenerateFacts)
 *
 * Pure logic — no LLM call. Validates that the AI's fact output correctly
 * fills all fact skeletons from ComputeFacts:
 *
 * - Every skeleton has a corresponding fact in the output
 * - Every fact has a valid category
 * - Subjects reference valid characterIds or locationIds
 * - Veracity matches the skeleton's veracity
 *
 * If validation fails, the Step Function retries GenerateFacts with
 * error context (up to 2 retries).
 */
export const handler = async (state: OperationalState): Promise<OperationalState> => {
  const { draftId } = state;
  const draft = await getDraft(draftId);
  const { facts, factSkeletons, characters, locations } = draft ?? {};

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!facts || Object.keys(facts).length === 0) {
    errors.push('No facts in state — GenerateFacts produced no output');
    return { ...state, validationResult: { valid: false, errors, warnings } };
  }

  if (!factSkeletons || factSkeletons.length === 0) {
    errors.push('No factSkeletons in state — ComputeFacts must run first');
    return { ...state, validationResult: { valid: false, errors, warnings } };
  }

  if (!characters) {
    errors.push('No characters in state');
    return { ...state, validationResult: { valid: false, errors, warnings } };
  }

  if (!locations) {
    errors.push('No locations in state');
    return { ...state, validationResult: { valid: false, errors, warnings } };
  }

  const allCharacterIds = new Set(Object.keys(characters));
  const allLocationIds = new Set(Object.keys(locations));
  const validSubjectIds = new Set([...allCharacterIds, ...allLocationIds]);

  for (const [recordKey, fact] of Object.entries(facts)) {
    // Facts must be keyed by factId
    if (recordKey !== fact.factId) {
      errors.push(
        `Fact record key "${recordKey}" does not match its factId field "${fact.factId}"`,
      );
    }

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

  // Check that every skeleton was filled. Facts are keyed by factId.
  const factCount = Object.keys(facts).length;
  const skeletonCount = factSkeletons.length;

  if (factCount < skeletonCount) {
    errors.push(
      `Only ${factCount} facts were generated for ${skeletonCount} fact skeletons — ` +
      `${skeletonCount - factCount} fact(s) are missing`,
    );
  }

  for (const skeleton of factSkeletons) {
    const fact = facts[skeleton.factId];
    if (!fact) {
      errors.push(
        `Fact "${skeleton.factId}" has no generated fact (missing from AI output)`,
      );
      continue;
    }
    if (fact.factId !== skeleton.factId) {
      errors.push(
        `Fact "${skeleton.factId}" has mismatched factId "${fact.factId}"`,
      );
    }
    if (fact.veracity !== skeleton.veracity) {
      errors.push(
        `Fact "${skeleton.factId}": veracity is "${fact.veracity}" but skeleton has "${skeleton.veracity}"`,
      );
    }
    const skeletonSubjectSet = new Set(skeleton.subjects);
    if (fact.subjects.length !== skeletonSubjectSet.size || !fact.subjects.every((s) => skeletonSubjectSet.has(s))) {
      errors.push(
        `Fact "${skeleton.factId}": subjects must match skeleton [${skeleton.subjects.join(', ')}]`,
      );
    }
  }

  // Warn if there are more facts than skeletons (should not happen)
  if (factCount > skeletonCount) {
    warnings.push(
      `${factCount} facts were generated for ${skeletonCount} fact skeletons — ` +
      `${factCount - skeletonCount} extra fact(s)`,
    );
  }

  const result: ValidationResult = {
    valid: errors.length === 0,
    errors,
    warnings,
  };

  return { ...state, validationResult: result };
};
