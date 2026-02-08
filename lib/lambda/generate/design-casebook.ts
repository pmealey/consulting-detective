import { callModel } from '../shared/bedrock';
import {
  CasebookSchema,
  type CaseGenerationState,
} from '../shared/generation-state';

/**
 * Pipeline Step 6: Design Casebook Entries
 *
 * Creates the player-facing address book: visitable entries that each
 * reveal specific facts. Uses person/place identity facts as gate keys
 * so that entries unlock progressively as the player investigates.
 * Ensures every fact is reachable from the introduction via the
 * bipartite discovery graph (facts ↔ entries).
 */
export const handler = async (state: CaseGenerationState): Promise<CaseGenerationState> => {
  const { input, template, events, characters, locations, facts, introductionFactIds, discoveryGraphResult } = state;

  if (!template) throw new Error('Step 6 requires template from step 1');
  if (!events) throw new Error('Step 6 requires events from step 2');
  if (!characters) throw new Error('Step 6 requires characters from step 3');
  if (!locations) throw new Error('Step 6 requires locations from step 4');
  if (!facts) throw new Error('Step 6 requires facts from step 5');
  if (!introductionFactIds) throw new Error('Step 6 requires introductionFactIds from step 5');

  const allFacts = Object.values(facts);
  const personFacts = allFacts.filter((f) => f.category === 'person');
  const placeFacts = allFacts.filter((f) => f.category === 'place');
  const otherFacts = allFacts.filter((f) => f.category !== 'person' && f.category !== 'place');
  const introFacts = allFacts.filter((f) => introductionFactIds.includes(f.factId));

  const systemPrompt = `You are a game designer creating the casebook for a detective mystery game. The casebook is the player's address book — a list of places they can visit during their investigation. Each entry reveals specific facts and may be **gated** behind facts the player must discover first.

First, briefly reason through the casebook design: how to distribute facts across entries, how the gating ensures progressive discovery, and how the discovery graph ensures all facts are reachable from the introduction. Then provide the JSON.

Your response must end with valid JSON: a Record<string, CasebookEntry> keyed by entryId.

Each entry must match this schema:
{
  "entryId": string,              // e.g. "entry_inspector_lestrade"
  "label": string,                // display name, e.g. "Inspector Lestrade"
  "address": string,              // display address, e.g. "Scotland Yard, Whitehall"
  "locationId": string,           // must reference a valid location
  "characters": string[],         // characterIds present at this entry
  "revealsFactIds": string[],     // factIds the player discovers by visiting
  "requiresAnyFact": string[]     // REQUIRED — OR-gated: entry is hidden until ANY ONE of these facts is discovered
}

## GATING RULES

The casebook uses a progressive-unlock system. ALL entries start hidden and become visible as the player discovers facts. The introduction reveals a set of seed facts (listed below) — these are the only facts the player has before visiting any entry.

1. **Every entry must be gated**: every entry MUST have a non-empty \`requiresAnyFact\` array. There are no always-visible entries. The introduction facts are the sole seeds that unlock the first wave of entries.
2. **OR-logic**: Each entry's \`requiresAnyFact\` lists 1-3 factIds. The entry unlocks when the player discovers ANY ONE of those facts.
3. **Use person/place facts as gates**: Person-type facts gate person entries (e.g. discovering "fact_harold_marsh" unlocks "Harold Marsh's Home"). Place-type facts gate location entries (e.g. discovering "fact_warehouse_limehouse" unlocks "Warehouse on Limehouse Street").
4. **First-wave entries**: Some entries must be gated on facts that are in the introduction set, so the player has somewhere to go from the start. Make sure the introduction facts unlock at least 2-3 entries directly.
5. **Multiple unlock paths**: Where possible, give gated entries 2-3 facts in their \`requiresAnyFact\` so the player can reach them via different investigation routes.

## DISCOVERY GRAPH CONSTRAINT

The discovery graph must ensure that starting from ONLY the introduction facts, all entries and facts are reachable:

- Introduction facts unlock the first wave of entries (those whose \`requiresAnyFact\` includes an intro fact).
- Those entries reveal new facts, which unlock more entries, which reveal more facts, and so on.
- **Every fact must be reachable** through this chain: intro facts → first-wave entries → revealed facts → second-wave entries → more facts → third-wave entries → more facts → ...
- **Every entry must be reachable**: there must be no entry whose gate facts are impossible to discover.

Think of it as a bipartite graph between facts and entries. Do a mental BFS: start with the intro facts, see which entries they unlock, collect the facts those entries reveal, see which new entries unlock, and so on until you've verified everything is reachable.

## CO-DISCOVERY RULE

Whenever an entry reveals a relational/evidentiary fact that **mentions** a person or place, the entry MUST ALSO include the corresponding person or place identity fact in its \`revealsFactIds\`. This ensures the player always learns about an entity's existence when they hear about it.

Example: If entry_inspector_lestrade reveals "fact_harold_marsh_debt" (Marsh owed the victim £400), it must also reveal "fact_harold_marsh" (the person identity fact for Harold Marsh). This way the player can follow up on the lead by visiting the now-unlocked "Harold Marsh's Home" entry.

## OTHER RULES

1. Every fact must be discoverable at AT LEAST ONE entry (or via the introduction).
2. Important facts (those likely to appear in quiz questions) should be available at MULTIPLE entries (allowing different solving paths).
3. At least 2 entries should reveal only background/atmospheric facts (natural red herrings — interesting but not essential).
4. Each entry should reveal 1-4 facts.
5. locationId must reference an existing location. Characters must reference existing characterIds.
6. Addresses should be evocative and fit the era.
7. Keep each character's current status in mind (see character list). Only include in an entry's "characters" array those who can plausibly be present and interviewed there.
8. Characters should be included in the same entry if they are present at the same location.
9. Facts revealed by an entry should be related to the location and characters present at the entry.
10. Characters should NOT reveal facts they are hiding. Instead, those facts should be discoverable through other entries or physical evidence.`;

  const userPrompt = `Here is the case context:

Title: ${template.title}
Setting: ${template.era}
Difficulty: ${template.difficulty}

## Introduction Facts (revealed to the player at the start — seed the investigation)
${introFacts.map((f) => `  - ${f.factId}: ${f.description} [${f.category}]`).join('\n')}

## Person Facts (identity atoms — use as gate keys for a person's location entry)
${personFacts.map((f) => `  - ${f.factId}: ${f.description}`).join('\n')}

## Place Facts (identity atoms — use as gate keys for location entries)
${placeFacts.map((f) => `  - ${f.factId}: ${f.description}`).join('\n')}

## Other Facts (relational and evidentiary — distribute across entries)
${otherFacts.map((f) => `  - ${f.factId}: ${f.description} [${f.category}]`).join('\n')}

## Characters
${Object.values(characters).map((c) => `  - ${c.characterId} (${c.name}): ${c.mysteryRole}, ${c.societalRole}${c.currentStatus ? ` [current status: ${c.currentStatus}]` : ''}`).join('\n')}

## Locations
${Object.values(locations).map((l) => `  - ${l.locationId} (${l.name}): ${l.type}`).join('\n')}

## Character Knowledge (who knows what — inform which entries reveal which facts)
${Object.values(characters).map((c) => `  - ${c.name}: knowledge ${JSON.stringify(c.knowledgeState)}, hides ${c.hides.join(', ')}`).join('\n')}

Design the casebook. Remember:
- Every entry must be gated (non-empty requiresAnyFact). The introduction facts are the only seeds.
- At least 2-3 entries must be gated on introduction facts so the player has somewhere to go immediately.
- Use person/place facts as gate keys (requiresAnyFact with OR-logic).
- Co-discovery rule: if an entry reveals a fact mentioning a person/place, it must also reveal that person/place identity fact.
- Verify the discovery graph: mentally BFS from intro facts through first-wave entries, then through subsequent entries, confirming all facts and entries are reachable.

Think through the design carefully first, then provide the JSON.${
  discoveryGraphResult && !discoveryGraphResult.valid
    ? `

## IMPORTANT — PREVIOUS ATTEMPT FAILED VALIDATION

Your previous casebook design failed the discovery graph validation. You MUST fix these errors:

${discoveryGraphResult.errors.map((e) => `- ${e}`).join('\n')}

Pay close attention to the errors above. Ensure every fact is reachable from the introduction facts via the entry graph, and every entry's gate facts are discoverable.`
    : ''
}`;

  const { data: casebook } = await callModel(
    {
      stepName: 'designCasebook',
      systemPrompt,
      userPrompt,
      modelConfig: input.modelConfig,
      outputTokens: 4096,
      thinkingTokens: 8192,
      temperature: 0.7,
    },
    (raw) => CasebookSchema.parse(raw),
  );

  return {
    ...state,
    casebook,
  };
};
