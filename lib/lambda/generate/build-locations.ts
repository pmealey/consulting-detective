import { callModel } from '../shared/bedrock';
import {
  LocationsSchema,
  type CaseGenerationState,
} from '../shared/generation-state';

/**
 * Pipeline Step 4: Build Location Graph
 *
 * Creates the spatial world model: buildings, rooms, streets, and outdoor areas
 * with containment hierarchy and perception edges (visibleFrom, audibleFrom).
 */
export const handler = async (state: CaseGenerationState): Promise<CaseGenerationState> => {
  const { input, template, events, characters } = state;

  if (!template) throw new Error('Step 4 requires template from step 1');
  if (!events) throw new Error('Step 4 requires events from step 2');
  if (!characters) throw new Error('Step 4 requires characters from step 3');

  // Collect all location placeholders used in events
  const locationPlaceholders = [...new Set(Object.values(events).map((e) => e.location))];

  const systemPrompt = `You are a location designer for a mystery game. Given a case template, event chain, and characters, you create a coherent spatial world.

First, briefly reason through the spatial layout: how buildings relate to each other, what sight lines and sound carries exist, and how this affects who could witness what. Then provide the JSON.

Your response must end with valid JSON: a Record<string, Location> keyed by locationId.

Each location must match this schema:
{
  "locationId": string,        // e.g. "loc_pemberton_study"
  "name": string,              // e.g. "The Pemberton Study"
  "type": "building" | "room" | "outdoor" | "street" | "district",
  "description": string,       // atmospheric 2-3 sentence description
  "parent": string | undefined,  // locationId of containing location (room -> building)
  "adjacentTo": string[],      // locationIds of adjacent places
  "visibleFrom": string[],     // locationIds from which this place can be seen
  "audibleFrom": string[]      // locationIds from which events here can be heard
}

Guidelines:
- Create a location for each placeholder used in the events, plus additional locations for atmosphere and red herring entries.
- Use a containment hierarchy: rooms are inside buildings, buildings are on streets, streets are in districts.
- Perception edges (visibleFrom, audibleFrom) are CRITICAL for the mystery — they determine who could have witnessed what.
- A location's audibleFrom should generally include adjacent rooms in the same building.
- A location's visibleFrom should include places with direct sight lines (across a street, through a window).
- Create 8-15 total locations for a rich world to explore.
- Location names and descriptions should evoke the era: ${template.era}.
- Adjacency should be symmetric: if A is adjacent to B, B should be adjacent to A.`;

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

Create the full location graph. Every event location placeholder must map to a concrete location. Add additional locations for atmosphere. Think through the spatial relationships first, then provide the JSON.`;

  const { data: locations } = await callModel(
    {
      stepName: 'buildLocations',
      systemPrompt,
      userPrompt,
      modelConfig: input.modelConfig,
      maxTokens: 4096,
      temperature: 0.7,
    },
    (raw) => LocationsSchema.parse(raw),
  );

  return {
    ...state,
    locations,
  };
};
