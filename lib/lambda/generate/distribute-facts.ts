import { callModel } from '../shared/bedrock';
import {
  FactsSchema,
  type CaseGenerationState,
} from '../shared/generation-state';

/**
 * Pipeline Step 5: Distribute Facts
 *
 * Extracts facts from the event chain and character knowledge,
 * tags each with a category, and marks critical facts.
 */
export const handler = async (state: CaseGenerationState): Promise<CaseGenerationState> => {
  const { input, template, events, characters, locations } = state;

  if (!template) throw new Error('Step 5 requires template from step 1');
  if (!events) throw new Error('Step 5 requires events from step 2');
  if (!characters) throw new Error('Step 5 requires characters from step 3');
  if (!locations) throw new Error('Step 5 requires locations from step 4');

  // Gather all fact placeholders from events
  const factPlaceholders = [...new Set(Object.values(events).flatMap((e) => e.reveals))];

  const systemPrompt = `You are a mystery fact designer. Given the case structure so far — events, characters, and locations — you define the discoverable facts that form the knowledge atoms of the mystery.

First, briefly reason through what facts the mystery needs: what evidence points to the truth, what red herrings exist, and how facts distribute across categories. Then provide the JSON.

Your response must end with valid JSON: a Record<string, Fact> keyed by factId.

Each fact must match this schema:
{
  "factId": string,             // e.g. "fact_victim_left_handed"
  "description": string,        // clear, specific description
  "category": "motive" | "means" | "opportunity" | "alibi" | "relationship" | "timeline" | "physical_evidence" | "background",
  "critical": boolean           // true if this fact is needed to answer key questions
}

Guidelines:
- Create a fact for each placeholder referenced in the events' "reveals" arrays.
- Add additional facts (8-20 total) that flesh out the mystery:
  * At least 2 motive facts
  * At least 1 means fact
  * At least 1 opportunity fact
  * At least 2 relationship facts
  * A mix of timeline and physical evidence facts
  * Some background facts (interesting but not critical — these become red herring fodder)
- About 40-60% of facts should be "critical": true (needed to solve the case).
- The rest are non-critical: interesting but not required for the quiz.
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
${Object.values(locations).map((l) => `  - ${l.name} (${l.type})`).join('\n')}

Define all facts. Each placeholder must become a concrete fact. Add additional facts to reach the 8-20 range. Think through what evidence the mystery needs first, then provide the JSON.`;

  const { data: facts } = await callModel(
    {
      stepName: 'distributeFacts',
      systemPrompt,
      userPrompt,
      modelConfig: input.modelConfig,
      maxTokens: 4096,
      temperature: 0.7,
    },
    (raw) => FactsSchema.parse(raw),
  );

  return {
    ...state,
    facts,
  };
};
