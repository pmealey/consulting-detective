import type {
  CaseGenerationState,
  ValidationResult,
  EventDraft,
  LocationDraft,
} from '../shared/generation-state';

/**
 * Pipeline Step 4b: Validate Locations (after GenerateLocations)
 *
 * Pure logic — no LLM call. Validates:
 * - Every event.location references a valid locationId
 * - Every location.accessibleFrom entry references a valid locationId
 * - (Warning) Symmetric adjacency: if A is in B's accessibleFrom, B should be in A's accessibleFrom
 *
 * On failure, the Step Function retries BuildLocations.
 */
export const handler = async (state: CaseGenerationState): Promise<CaseGenerationState> => {
  const { events, locations } = state;

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!locations || Object.keys(locations).length === 0) {
    errors.push('No locations in state');
    return {
      ...state,
      locationValidationResult: { valid: false, errors, warnings },
    };
  }

  const locationIds = new Set(Object.keys(locations));

  if (events) {
    for (const event of Object.values(events) as EventDraft[]) {
      if (!event.location || event.location === '') {
        errors.push(`Event ${event.eventId}: location is missing`);
      } else if (!locationIds.has(event.location)) {
        errors.push(
          `Event ${event.eventId}: location "${event.location}" is not a valid locationId`,
        );
      }
    }
  }

  for (const location of Object.values(locations) as LocationDraft[]) {
    for (const adjId of location.accessibleFrom) {
      if (!locationIds.has(adjId)) {
        errors.push(
          `Location ${location.locationId}: accessibleFrom references unknown location "${adjId}"`,
        );
      }
    }
  }

  // Symmetric adjacency (warning): if A is in B's accessibleFrom, B should be in A's accessibleFrom
  for (const location of Object.values(locations) as LocationDraft[]) {
    for (const adjId of location.accessibleFrom) {
      if (!locationIds.has(adjId)) continue;
      const adj = locations[adjId];
      if (adj && !adj.accessibleFrom.includes(location.locationId)) {
        warnings.push(
          `Location ${location.locationId}: accessibleFrom includes "${adjId}" but "${adjId}" does not list "${location.locationId}" in accessibleFrom (asymmetric adjacency)`,
        );
      }
    }
  }

  const valid = errors.length === 0;
  return {
    ...state,
    locationValidationResult: { valid, errors, warnings },
  };
};
