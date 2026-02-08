import { callModel } from '../shared/bedrock';
import {
  CasebookSchema,
  type CaseGenerationState,
} from '../shared/generation-state';

/**
 * Pipeline Step 6: Design Casebook Entries
 *
 * Creates the player-facing address book: visitable entries that each
 * reveal specific facts. Ensures every critical fact is discoverable,
 * some entries are red herrings, and multiple solving paths exist.
 */
export const handler = async (state: CaseGenerationState): Promise<CaseGenerationState> => {
  const { input, template, events, characters, locations, facts } = state;

  if (!template) throw new Error('Step 6 requires template from step 1');
  if (!events) throw new Error('Step 6 requires events from step 2');
  if (!characters) throw new Error('Step 6 requires characters from step 3');
  if (!locations) throw new Error('Step 6 requires locations from step 4');
  if (!facts) throw new Error('Step 6 requires facts from step 5');

  const criticalFacts = Object.values(facts).filter((f) => f.critical);
  const nonCriticalFacts = Object.values(facts).filter((f) => !f.critical);

  const systemPrompt = `You are a game designer creating the casebook for a detective mystery game. The casebook is the player's address book — a list of places and people they can visit during their investigation. Each entry reveals specific facts.

First, briefly reason through the casebook design: how to distribute facts across entries so that multiple solving paths exist, which entries will be red herrings, and how to ensure all critical facts are reachable. Then provide the JSON.

Your response must end with valid JSON: a Record<string, CasebookEntry> keyed by entryId.

Each entry must match this schema:
{
  "entryId": string,          // e.g. "entry_lestrade"
  "label": string,            // display name, e.g. "Inspector Lestrade"
  "address": string,          // display address, e.g. "Scotland Yard, Whitehall"
  "locationId": string,       // must reference a valid location
  "type": "location" | "person" | "document" | "event",
  "characters": string[],     // characterIds present at this entry
  "revealsFactIds": string[]  // factIds the player discovers by visiting
}

CRITICAL RULES:
1. Every critical fact must be discoverable at AT LEAST ONE entry.
2. Some critical facts should be available at MULTIPLE entries (allowing different solving paths).
3. At least 2 entries should reveal NO critical facts (these are natural red herrings — interesting but not essential).
4. Each entry should reveal 1-4 facts.
5. Create 6-15 entries depending on difficulty.
6. Entry types should vary: some location visits, some person interviews, some document examinations.
7. locationId must reference an existing location. characters must reference existing characterIds.
8. Addresses should be evocative and fit the era.
9. Keep each character's current status in mind (see character list). Only include in an entry's "characters" array those who can plausibly be present and interviewed there.`;

  const userPrompt = `Here is the case context:

Title: ${template.title}
Setting: ${template.era}
Difficulty: ${template.difficulty}

Characters:
${Object.values(characters).map((c) => `  - ${c.characterId} (${c.name}): ${c.role}${c.currentStatus ? ` [current status: ${c.currentStatus}]` : ''}`).join('\n')}

Locations:
${Object.values(locations).map((l) => `  - ${l.locationId} (${l.name}): ${l.type}`).join('\n')}

Critical facts (MUST all be discoverable):
${criticalFacts.map((f) => `  - ${f.factId}: ${f.description} [${f.category}]`).join('\n')}

Non-critical facts (distribute for atmosphere):
${nonCriticalFacts.map((f) => `  - ${f.factId}: ${f.description} [${f.category}]`).join('\n')}

Character knowledge (who knows what — inform which entries reveal which facts):
${Object.values(characters).map((c) => `  - ${c.name}: ${JSON.stringify(c.knowledgeState)}`).join('\n')}

Design the casebook. Think through the fact distribution strategy first, then provide the JSON.`;

  const { data: casebook } = await callModel(
    {
      stepName: 'designCasebook',
      systemPrompt,
      userPrompt,
      modelConfig: input.modelConfig,
      maxTokens: 4096,
      temperature: 0.7,
    },
    (raw) => CasebookSchema.parse(raw),
  );

  return {
    ...state,
    casebook,
  };
};
