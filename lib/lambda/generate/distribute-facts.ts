import { callModel } from '../shared/bedrock';
import {
  GenerateFactsResultSchema,
  type CaseGenerationState,
} from '../shared/generation-state';

/**
 * Pipeline Step 5: Distribute Facts
 *
 * Extracts facts from the event chain and character knowledge,
 * tags each with a category. Creates person and place identity atoms
 * alongside relational/evidentiary facts. Selects 2-4 introduction
 * facts that seed the player's investigation.
 */
export const handler = async (state: CaseGenerationState): Promise<CaseGenerationState> => {
  const { input, template, events, characters, locations } = state;

  if (!template) throw new Error('Step 5 requires template from step 1');
  if (!events) throw new Error('Step 5 requires events from step 2');
  if (!characters) throw new Error('Step 5 requires characters from step 3');
  if (!locations) throw new Error('Step 5 requires locations from step 4');

  // Gather all fact placeholders from events
  const factPlaceholders = [...new Set(Object.values(events).flatMap((e) => e.reveals))];

  const systemPrompt = `You are a mystery designer for a mystery game. Given the case structure so far — events, characters, and locations — you define the discoverable facts that form the knowledge atoms of the mystery.

First, briefly reason through what facts the mystery needs: what evidence points to the truth, what red herrings exist, and how facts distribute across categories. Then provide the JSON.

Your response must end with valid JSON matching this structure:
{
  "facts": Record<string, Fact>,
  "introductionFactIds": string[]   // 2-4 factIds revealed in the opening briefing
}

Each Fact must match this schema:
{
  "factId": string,             // e.g. "fact_victim_left_handed"
  "description": string,        // clear, specific description
  "category": "motive" | "means" | "opportunity" | "alibi" | "relationship" | "timeline" | "physical_evidence" | "background" | "person" | "place"
}

## Fact categories

The "person" and "place" categories are **identity atoms** — they establish that an entity exists and what it is. They are NOT relational claims.

**Person facts** — one per character relevant to the mystery. The description should be a short noun-phrase identifier: a name and role/title.
  Examples:
  - factId: "fact_harold_marsh", category: "person", description: "Harold Marsh, co-owner of Marsh & Foller Import/Export Company"
  - factId: "fact_inspector_lestrade", category: "person", description: "Inspector Lestrade of Scotland Yard"

**Place facts** — one per location that will become a casebook entry. The description should be a short noun-phrase: a name and brief descriptor.
  Examples:
  - factId: "fact_warehouse_limehouse", category: "place", description: "Warehouse on Limehouse Street"
  - factId: "fact_lord_pemberton_study", category: "place", description: "Lord Pemberton's study at Pemberton Hall"

Person/place facts do NOT embed relational meaning. Relational and evidentiary meaning about persons/places belongs in separate facts with existing categories:
  - "fact_harold_marsh" (person): "Harold Marsh, co-owner of Marsh & Foller"
  - "fact_harold_marsh_partner" (relationship): "Harold Marsh was the victim's business partner"
  - "fact_harold_marsh_debt" (motive): "Marsh owed the victim 400 pounds"
  - "fact_warehouse_limehouse" (place): "Warehouse on Limehouse Street"

The remaining categories — motive, means, opportunity, alibi, relationship, timeline, physical_evidence, background — are relational or evidentiary claims: specific, concrete things a detective discovers about the case.

## Introduction facts

Choose 2-4 facts as "introductionFactIds" — these are the facts the player learns from the opening briefing (e.g. the crime that was committed, the victim's identity, the investigator in charge). Introduction facts should:
- Be enough to make several casebook entries reachable (they seed the investigation)
- NOT give away so much that nothing remains gated
- Typically include the victim (person fact), the crime scene (place fact), and 1-2 key setting facts

## Guidelines

- Create a fact for each placeholder referenced in the events' "reveals" arrays.
- Create a fact for each fact ID placeholder in the "hides" arrays of the characters.
- Create one **person** fact for each character relevant to the mystery.
- Create one **place** fact for each location.
- Add additional relational/evidentiary facts:
  * At least 4 motive facts
  * At least 2 means fact
  * At least 2 opportunity fact
  * At least 4 relationship facts
  * At least 2 background facts
  * A mix of timeline and physical_evidence facts
- Facts should be specific and concrete: "The victim owed Blackwood £400" not "The victim had debts."
- Fact descriptions should be what a detective discovers, not authorial commentary.`;

  const userPrompt = `Here is the case context:

Title: ${template.title}
Crime Type: ${template.crimeType}
Setting: ${template.era}

Fact placeholders referenced in events:
${factPlaceholders.map((f) => `  - ${f}`).join('\n')}

Events (chronological):
${Object.values(events).sort((a, b) => a.timestamp - b.timestamp).map((e) => `  - ${e.eventId}: ${e.description} (reveals: [${e.reveals.join(', ')}])`).join('\n')}

Characters:
${Object.values(characters).map((c) => `  - ${c.name} (${c.mysteryRole}, ${c.societalRole}): wants=[${c.wants.join('; ')}], hides=[${c.hides.join('; ')}]`).join('\n')}

Key locations:
${Object.values(locations).map((l) => `  - ${l.locationId}: ${l.name} (${l.type})`).join('\n')}

Define all facts. Each placeholder must become a concrete fact. Create person facts for each character and place facts for each key location. Add relational/evidentiary facts to flesh out the mystery. Choose 2-4 introduction facts that seed the investigation. Think through what evidence the mystery needs first, then provide the JSON.`;

  const { data: result } = await callModel(
    {
      stepName: 'distributeFacts',
      systemPrompt,
      userPrompt,
      modelConfig: input.modelConfig,
      outputTokens: 2048,
      thinkingTokens: 2048,
      temperature: 0.7,
    },
    (raw) => GenerateFactsResultSchema.parse(raw),
  );

  return {
    ...state,
    facts: result.facts,
    introductionFactIds: result.introductionFactIds,
  };
};
