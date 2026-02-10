import { callModel } from '../shared/bedrock';
import { getDraft, updateDraft } from '../shared/draft-db';
import {
  LocationsSchema,
  type OperationalState,
} from '../shared/generation-state';

/**
 * Pipeline Step 4: Generate Locations
 *
 * Creates the spatial world model: buildings, rooms, streets, and outdoor areas
 * with containment hierarchy and perception edges (visibleFrom, audibleFrom).
 */
export const handler = async (state: OperationalState): Promise<OperationalState> => {
  const { input, draftId } = state;
  const draft = await getDraft(draftId);
  const { template, events, characters, computedKnowledge, roleMapping } = draft ?? {};

  if (!template) throw new Error('Step 4 requires template from step 1');
  if (!events) throw new Error('Step 4 requires events from step 2');
  if (!characters) throw new Error('Step 4 requires characters from step 3');

  // Collect all location placeholders used in events: event locations plus any
  // location id mentioned in event reveals (subjects not in roleMapping are
  // location placeholders; roleIds are mapped to characterIds later).
  const locationPlaceholdersSet = new Set<string>(Object.values(events).map((e) => e.location));
  for (const event of Object.values(events)) {
    for (const reveal of event.reveals ?? []) {
      for (const subjectId of reveal.subjects ?? []) {
        if (!roleMapping || !(subjectId in roleMapping)) {
          locationPlaceholdersSet.add(subjectId);
        }
      }
    }
  }
  const locationPlaceholders = [...locationPlaceholdersSet];

  const systemPrompt = `You are a location designer for a mystery game. Given a case template, event chain, and characters, you create a coherent spatial world.

Involvement types in events: agent (performed the event), present (directly present and observed), witness_visual (saw from another location), witness_auditory (heard from another location), discovered_evidence (found physical evidence later). Use these when reasoning about who could have witnessed what.

First, briefly reason through the spatial layout: how buildings relate to each other, what sight lines and sound carries exist, and how this affects who witnessed what. Then provide the JSON.

Your response must end with valid JSON: a Record<string, Location> keyed by locationId.

Each location must match this schema:
{
  "locationId": string,          // e.g. "loc_pemberton_study"
  "name": string,                // e.g. "The Pemberton Study"
  "type": string                 // e.g. "building", "room", "street", "campsite", etc.
  "description": string,         // atmospheric 2-3 sentence description
  "accessibleFrom": string[],    // locationIds from which this place can be accessed
  "visibleFrom": string[],       // locationIds from which this place can be seen
  "audibleFrom": string[]        // locationIds from which events here can be heard
}

Guidelines:
- Create a location for each placeholder used in the events.
- Create additional locations for where characters can be found during the investigation. Some characters may be present at the same location.
- When a character has audibly or visually witnessed an event, create additional locations for the locations they were at when the event happened.
- Perception and accessibility edges (accessibleFrom, visibleFrom, audibleFrom) are CRITICAL for the mystery — they determine who could have witnessed what.
- A location's accessibleFrom should include all relevant locations that can be physically accessed from this location.
- A location's audibleFrom should generally include adjacent rooms in the same building.
- A location's visibleFrom should include places with direct sight lines (across a street, through a window).
- Location names and descriptions should evoke the era: ${template.era}.`;

  const validationResult = state.validationResult;
  const userPrompt = `Here is the case context:

Title: ${template.title}
Setting: ${template.era}, ${template.date}
Atmosphere: ${template.atmosphere}

Location placeholders used in events:
${locationPlaceholders.map((loc) => `  - ${loc}`).join('\n')}

Events and where they happen:
${Object.values(events).sort((a, b) => a.timestamp - b.timestamp).map((e) => `  - ${e.eventId} at ${e.location}: ${e.description}`).join('\n')}

Characters:
${Object.values(characters).map((c) => `  - ${c.characterId} (${c.name}): ${c.mysteryRole}, ${c.societalRole}`).join('\n')}

Event Involvement Details:
${Object.values(events).map((e) => `  ${e.eventId}: ${JSON.stringify(e.involvement)}`).join('\n')}
${computedKnowledge?.locationReveals && Object.keys(computedKnowledge.locationReveals).length > 0 ? `
Physical evidence by location:\n${Object.entries(computedKnowledge.locationReveals).map(([locId, factIds]) => `  ${locId}: ${factIds.join(', ')}`).join('\n')}` : ''}

Create the full location graph. Every event location placeholder must map to a concrete location. Add additional locations for atmosphere. Think through the spatial relationships first, then provide the JSON.${
    validationResult && !validationResult.valid
      ? `

## IMPORTANT — PREVIOUS ATTEMPT FAILED VALIDATION

Your previous output failed validation. You MUST fix these errors:

${validationResult.errors.map((e) => `- ${e}`).join('\n')}`
      : ''
  }`;

  const { data: locations } = await callModel(
    {
      stepName: 'generateLocations',
      systemPrompt,
      userPrompt,
      modelConfig: input.modelConfig,
    },
    (raw) => LocationsSchema.parse(raw),
  );

  await updateDraft(draftId, { locations });
  return state;
};
