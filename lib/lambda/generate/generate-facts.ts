import { callModel } from '../shared/bedrock';
import { getDraft, updateDraft } from '../shared/draft-db';
import {
  GenerateFactsOutputSchema,
  type DraftCase,
  type FactDraft,
  type FactSkeleton,
  type OperationalState,
} from '../shared/generation-state';

/**
 * Pipeline Step 7: Generate Facts
 *
 * Receives all fact skeletons from ComputeFacts (step 6). Each skeleton
 * already has a canonical factId, subjects, veracity, and source context
 * determined. The AI's job is narrower and well-defined: provide a rich
 * description and a category for each fact.
 *
 * After the AI responds, we merge its output with the skeleton data to
 * produce the final Record<string, FactDraft> keyed by factId. The factId
 * is the same one assigned in ComputeFacts — events, characters,
 * computedKnowledge, and factGraph all reference facts by this ID.
 */
export const handler = async (state: OperationalState): Promise<OperationalState> => {
  const { input, draftId } = state;
  const draft = await getDraft(draftId);
  const { template, events, characters, locations, factSkeletons } = draft ?? {};
  const validationResult = state.validationResult;

  if (!template) throw new Error('GenerateFacts requires template from step 1');
  if (!events) throw new Error('GenerateFacts requires events from step 2');
  if (!characters) throw new Error('GenerateFacts requires characters from step 3');
  if (!locations) throw new Error('GenerateFacts requires locations from step 4');
  if (!factSkeletons || factSkeletons.length === 0) {
    throw new Error('GenerateFacts requires factSkeletons from ComputeFacts');
  }

  const systemPrompt = `You are a mystery designer for a detective mystery game. You are given a set of facts — structural slots that have already been determined by the game engine. Each fact has:

- A fact ID (your key for the output)
- Subjects (characterIds and locationIds the fact is about)
- Veracity ("true" or "false" — false facts are misinformation)
- Source context (where the fact came from: an event reveal, a character's denial, a bridge connection, or a red herring)

Your job is to provide two things for each fact:

1. **description** — a clear, specific, concrete description of what a detective discovers
2. **category** — one of the 8 categories below

Your response must end with valid JSON: a Record<factId, { description, category }>.

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
- For **denial** facts: the false fact should be a plausible counter-narrative to the denied true fact. Look at the denied fact's context to craft a convincing lie.
- For **bridge** facts: create a natural connection between the two subjects (e.g. a relationship, a shared history, a rumor).
- For **red herring** facts: create something interesting but ultimately irrelevant — a suspicious detail, an old grudge, a coincidence.
- Category should match the nature of the fact, not just its source.
- Think about how facts form a coherent mystery narrative. Facts from the same event should tell a consistent story.`;

  const skeletonDescriptions = factSkeletons.map((s) =>
    formatSkeletonForPrompt(s, draft!),
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

## Facts to Fill (${factSkeletons.length} total)

For each fact below, provide description and category. The key in your JSON must be the factId shown.

${skeletonDescriptions.join('\n\n')}

First, briefly reason through the narrative: what story do these facts tell together? How do the false facts create confusion? How do the bridge facts connect different threads? Then provide the JSON.

Your JSON must be a Record<factId, { description, category }> with exactly ${factSkeletons.length} entries — one for each fact listed above.${
    validationResult && !validationResult.valid
      ? `

## IMPORTANT — PREVIOUS ATTEMPT FAILED VALIDATION

Your previous output failed validation. You MUST fix these errors:

${validationResult.errors.map((e) => `- ${e}`).join('\n')}`
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

  // Merge AI output with skeleton data to produce final FactDraft records.
  const facts: Record<string, FactDraft> = {};
  const skeletonMap = new Map(factSkeletons.map((s) => [s.factId, s]));

  for (const [factId, aiEntry] of Object.entries(aiOutput)) {
    const skeleton = skeletonMap.get(factId);
    if (!skeleton) {
      // AI returned an entry for a factId that doesn't exist — skip it.
      // ValidateFacts will catch missing facts.
      continue;
    }

    facts[factId] = {
      factId,
      description: aiEntry.description,
      category: aiEntry.category,
      subjects: [...skeleton.subjects],
      veracity: skeleton.veracity,
    };
  }

  await updateDraft(draftId, { facts });
  return state;
};

// ============================================
// Helpers
// ============================================

/**
 * Formats a single fact skeleton for the AI prompt, including source
 * context so the AI can write appropriate descriptions.
 */
function formatSkeletonForPrompt(
  skeleton: FactSkeleton,
  draft: DraftCase,
): string {
  const { events, characters, locations } = draft;
  const subjectNames = skeleton.subjects.map((id) => {
    if (characters?.[id]) return `${id} (${characters[id].name})`;
    if (locations?.[id]) return `${id} (${locations[id].name})`;
    return id;
  });

  let sourceContext = '';
  switch (skeleton.source.type) {
    case 'event_reveal': {
      const event = events?.[skeleton.source.eventId];
      sourceContext = event
        ? `From event "${event.eventId}": ${event.description}`
        : `From event "${skeleton.source.eventId}"`;
      break;
    }
    case 'denial': {
      const denier = characters?.[skeleton.source.characterId];
      sourceContext = `Denial by ${denier?.name ?? skeleton.source.characterId} — this is a FALSE counter-narrative to the true fact "${skeleton.source.deniedFactId}". Write what the character falsely claims.`;
      break;
    }
    case 'bridge': {
      const fromChar = characters?.[skeleton.source.fromCharacterId];
      const toSubjectName = characters?.[skeleton.source.toSubject]?.name
        ?? locations?.[skeleton.source.toSubject]?.name
        ?? skeleton.source.toSubject;
      sourceContext = `Bridge fact: connects ${fromChar?.name ?? skeleton.source.fromCharacterId} to ${toSubjectName}. Create a natural connection (relationship, shared history, rumor, etc.)`;
      break;
    }
    case 'red_herring': {
      sourceContext = 'Red herring: an interesting but ultimately irrelevant detail that adds noise to the investigation.';
      break;
    }
  }

  return `### ${skeleton.factId}
  Subjects: [${subjectNames.join(', ')}]
  Veracity: ${skeleton.veracity}
  Source: ${sourceContext}`;
}
