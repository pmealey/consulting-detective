import { getDraft } from '../shared/draft-db';
import type {
  OperationalState,
  EventDraft,
  LocationDraft,
} from '../shared/generation-state';

/**
 * Pipeline Step 4b: Validate Locations (after GenerateLocations)
 *
 * Pure logic — no LLM call. Validates:
 * - Every event.location references a valid locationId
 * - Every event reveal subject is either a roleId (mapped to a character) or a valid locationId
 * - Every location.accessibleFrom entry references a valid locationId
 * - (Warning) Symmetric adjacency: if A is in B's accessibleFrom, B should be in A's accessibleFrom
 *
 * Catching invalid reveal subjects here ensures we fail before ComputeFacts/GenerateFacts.
 * On retry, GenerateLocations receives these errors and can add the missing location(s).
 *
 * On failure, the Step Function retries GenerateLocations.
 */
export const handler = async (state: OperationalState): Promise<OperationalState> => {
  const { draftId } = state;
  const draft = await getDraft(draftId);
  const { events, locations, roleMapping } = draft ?? {};

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!locations || Object.keys(locations).length === 0) {
    errors.push('No locations in state');
    return { ...state, validationResult: { valid: false, errors, warnings } };
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
      // Every reveal subject must be either a roleId (→ character) or a locationId.
      // This catches cases where GenerateEvents used a location placeholder
      // that GenerateLocations did not define, so we fail here and retry locations.
      for (const reveal of event.reveals ?? []) {
        for (const subjectId of reveal.subjects ?? []) {
          const isRole = roleMapping && subjectId in roleMapping;
          if (!isRole && !locationIds.has(subjectId)) {
            errors.push(
              `Event ${event.eventId} reveal "${reveal.id}": subject "${subjectId}" is not a valid characterId or locationId — create a location with locationId "${subjectId}"`,
            );
          }
        }
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
  return { ...state, validationResult: { valid, errors, warnings } };
};
