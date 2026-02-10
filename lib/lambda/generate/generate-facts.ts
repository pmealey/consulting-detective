import { callModel } from '../shared/bedrock';
import {
  GenerateFactsOutputSchema,
  type CaseGenerationState,
  type FactDraft,
  type FactPlaceholder,
} from '../shared/generation-state';

/**
 * Pipeline Step 7: Generate Facts
 *
 * Receives all fact placeholders from ComputeFacts (step 6). Each placeholder
 * already has subjects, veracity, and source context determined. The AI's job
 * is narrower and well-defined: provide a factId, a rich description, and a
 * category for each placeholder.
 *
 * After the AI responds, we merge its output with the placeholder data to
 * produce the final Record<string, FactDraft> that downstream steps consume.
 */
export const handler = async (state: CaseGenerationState): Promise<CaseGenerationState> => {
  const { input, template, events, characters, locations, factPlaceholders, factValidationResult } = state;

  if (!template) throw new Error('GenerateFacts requires template from step 1');
  if (!events) throw new Error('GenerateFacts requires events from step 2');
  if (!characters) throw new Error('GenerateFacts requires characters from step 3');
  if (!locations) throw new Error('GenerateFacts requires locations from step 4');
  if (!factPlaceholders || factPlaceholders.length === 0) {
    throw new Error('GenerateFacts requires factPlaceholders from ComputeFacts');
  }

  const systemPrompt = `You are a mystery designer for a detective mystery game. You are given a set of fact placeholders — structural slots that have already been determined by the game engine. Each placeholder has:

- A placeholder ID (your key for the output)
- Subjects (characterIds and locationIds the fact is about)
- Veracity ("true" or "false" — false facts are misinformation)
- Source context (where the placeholder came from: an event reveal, a character's denial, a bridge connection, or a red herring)

Your job is to provide three things for each placeholder:

1. **factId** — a descriptive snake_case identifier (e.g. "fact_victim_left_handed")
2. **description** — a clear, specific, concrete description of what a detective discovers
3. **category** — one of the 8 categories below

Your response must end with valid JSON: a Record<placeholderId, { factId, description, category }>.

## Fact Categories

- **motive**: Why someone did something (grudge, desire, debt, jealousy)
- **means**: How the crime was committed (method, weapon, technique, access)
- **opportunity**: When/whether someone had the chance to act
- **alibi**: Evidence of someone's whereabouts at a key time
- **relationship**: A connection between people or entities
- **timeline**: When something happened or sequence of events
- **physical_evidence**: An object, trace, or document found at a scene
- **background**: Context that helps understand the case

## Guidelines

- Descriptions should be what a detective discovers, not authorial commentary.
- Be specific and concrete: "The victim owed Blackwood £400" not "The victim had debts."
- For **false facts** (veracity: "false"): write the description as the misinformation itself — what the lying/mistaken character would claim. It should sound plausible.
- For **denial** placeholders: the false fact should be a plausible counter-narrative to the denied true fact. Look at the denied fact's context to craft a convincing lie.
- For **bridge** placeholders: create a natural connection between the two subjects (e.g. a relationship, a shared history, a rumor).
- For **red herring** placeholders: create something interesting but ultimately irrelevant — a suspicious detail, an old grudge, a coincidence.
- Every factId must be unique across all placeholders.
- Category should match the nature of the fact, not just its source.
- Think about how facts form a coherent mystery narrative. Facts from the same event should tell a consistent story.`;

  const placeholderDescriptions = factPlaceholders.map((p) =>
    formatPlaceholderForPrompt(p, state),
  );

  const userPrompt = `Here is the case context:

Title: ${template.title}
Crime Type: ${template.crimeType}
Setting: ${template.era}

Events (chronological):
${Object.values(events).sort((a, b) => a.timestamp - b.timestamp).map((e) => `  - ${e.eventId}: ${e.description}`).join('\n')}

Characters:
${Object.values(characters).map((c) => `  - ${c.characterId}: ${c.name} (${c.mysteryRole}, ${c.societalRole}): motivations=[${c.motivations.join('; ')}]`).join('\n')}

Locations:
${Object.values(locations).map((l) => `  - ${l.locationId}: ${l.name} (${l.type})`).join('\n')}

## Fact Placeholders to Fill (${factPlaceholders.length} total)

For each placeholder below, provide a factId, description, and category.

${placeholderDescriptions.join('\n\n')}

First, briefly reason through the narrative: what story do these facts tell together? How do the false facts create confusion? How do the bridge facts connect different threads? Then provide the JSON.

Your JSON must be a Record<placeholderId, { factId, description, category }> with exactly ${factPlaceholders.length} entries — one for each placeholder listed above.${
    factValidationResult && !factValidationResult.valid
      ? `

## IMPORTANT — PREVIOUS ATTEMPT FAILED VALIDATION

Your previous output failed validation. You MUST fix these errors:

${factValidationResult.errors.map((e) => `- ${e}`).join('\n')}`
      : ''
  }`;

  const { data: aiOutput } = await callModel(
    {
      stepName: 'generateFacts',
      systemPrompt,
      userPrompt,
      modelConfig: input.modelConfig,
    },
    (raw) => GenerateFactsOutputSchema.parse(raw),
  );

  // Merge AI output with placeholder data to produce final FactDraft records
  const facts: Record<string, FactDraft> = {};
  const placeholderMap = new Map(factPlaceholders.map((p) => [p.placeholderId, p]));

  for (const [placeholderId, aiEntry] of Object.entries(aiOutput)) {
    const placeholder = placeholderMap.get(placeholderId);
    if (!placeholder) {
      // AI returned an entry for a placeholder that doesn't exist — skip it.
      // ValidateFacts will catch missing placeholders.
      continue;
    }

    facts[aiEntry.factId] = {
      factId: aiEntry.factId,
      description: aiEntry.description,
      category: aiEntry.category,
      subjects: [...placeholder.subjects],
      veracity: placeholder.veracity,
    };
  }

  return {
    ...state,
    facts,
  };
};

// ============================================
// Helpers
// ============================================

/**
 * Formats a single placeholder for the AI prompt, including source context
 * so the AI can write appropriate descriptions.
 */
function formatPlaceholderForPrompt(
  placeholder: FactPlaceholder,
  state: CaseGenerationState,
): string {
  const { events, characters, locations } = state;
  const subjectNames = placeholder.subjects.map((id) => {
    if (characters?.[id]) return `${id} (${characters[id].name})`;
    if (locations?.[id]) return `${id} (${locations[id].name})`;
    return id;
  });

  let sourceContext = '';
  switch (placeholder.source.type) {
    case 'event_reveal': {
      const event = events?.[placeholder.source.eventId];
      sourceContext = event
        ? `From event "${event.eventId}": ${event.description}`
        : `From event "${placeholder.source.eventId}"`;
      break;
    }
    case 'denial': {
      const denier = characters?.[placeholder.source.characterId];
      sourceContext = `Denial by ${denier?.name ?? placeholder.source.characterId} — this is a FALSE counter-narrative to the true fact "${placeholder.source.deniedFactId}". Write what the character falsely claims.`;
      break;
    }
    case 'bridge': {
      const fromChar = characters?.[placeholder.source.fromCharacterId];
      const toSubjectName = characters?.[placeholder.source.toSubject]?.name
        ?? locations?.[placeholder.source.toSubject]?.name
        ?? placeholder.source.toSubject;
      sourceContext = `Bridge fact: connects ${fromChar?.name ?? placeholder.source.fromCharacterId} to ${toSubjectName}. Create a natural connection (relationship, shared history, rumor, etc.)`;
      break;
    }
    case 'red_herring': {
      sourceContext = 'Red herring: an interesting but ultimately irrelevant detail that adds noise to the investigation.';
      break;
    }
  }

  return `### ${placeholder.placeholderId}
  Subjects: [${subjectNames.join(', ')}]
  Veracity: ${placeholder.veracity}
  Source: ${sourceContext}`;
}
