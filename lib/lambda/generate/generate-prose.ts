import { callModel } from '../shared/bedrock';
import {
  IntroductionSchema,
  SceneBatchSchema,
  type CaseGenerationState,
  type CasebookEntryDraft,
  type CharacterDraft,
  type FactDraft,
  type LocationDraft,
} from '../shared/generation-state';

const BATCH_SIZE = 3;

/**
 * Pipeline Step 7: Generate Prose Scenes (Batched)
 *
 * Generates prose in multiple calls to avoid token limits:
 *   1. One call for the introduction and title
 *   2. Batched calls for scenes (BATCH_SIZE entries per call)
 *
 * Each scene is filtered through present characters' knowledge states
 * and tone profiles.
 */
export const handler = async (state: CaseGenerationState): Promise<CaseGenerationState> => {
  const { input, template, events, characters, locations, facts, casebook } = state;

  if (!template) throw new Error('Step 7 requires template from step 1');
  if (!events) throw new Error('Step 7 requires events from step 2');
  if (!characters) throw new Error('Step 7 requires characters from step 3');
  if (!locations) throw new Error('Step 7 requires locations from step 4');
  if (!facts) throw new Error('Step 7 requires facts from step 5');
  if (!casebook) throw new Error('Step 7 requires casebook from step 6');

  const entries = Object.values(casebook);

  const storyTimeline = Object.values(events)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((e) => `  ${e.timestamp}. ${e.description}`)
    .join('\n');

  const sceneGuidelines = `Scene-writing guidelines:
- Each scene should be 100-300 words.
- The player is the detective visiting this location/person. Write in second person where describing the scene, third person for dialogue.
- Characters should speak in their distinctive tone (use their register, vocabulary, and quirks).
- Characters reveal facts they KNOW about naturally through dialogue or observation.
- Characters who SUSPECT something should hint at it indirectly.
- Characters who HIDE something should deflect, change the subject, or give misleading information.
- Characters who BELIEVE FALSE things should state them confidently as fact.
- Physical evidence facts should be woven into environmental descriptions.
- Never tell the player the significance of what they've found — let them connect the dots.
- The prose should reward careful reading without being obtuse.
- Maintain the atmospheric tone: ${template.atmosphere}.`;

  // ---- Call 1: Introduction and Title ----

  const introSystemPrompt = `You are a Victorian-era mystery writer crafting the opening scene for a detective game. The introduction is what the player reads before they begin investigating.

First, briefly plan the narrative arc of the introduction. Then provide the JSON.

Your response must end with valid JSON matching this schema:
{
  "title": string,          // Final case title (may refine the template title)
  "introduction": string    // 2-4 paragraph opening scene (150-300 words)
}

Introduction guidelines:
- Set the scene: where the player is summoned, what the initial situation appears to be.
- Establish the atmosphere and era.
- Give the player just enough to start investigating, but don't give away the solution.
- Write in second person ("You arrive at...").
- 2-4 paragraphs, 150-300 words.`;

  const introUserPrompt = `Here is the case context:

Title: ${template.title}
Setting: ${template.era}, ${template.date}
Atmosphere: ${template.atmosphere}
Crime Type: ${template.crimeType}

The story (chronological events):
${storyTimeline}

Characters:
${Object.values(characters).map((c) => `  - ${c.name} (${c.role})`).join('\n')}

Write the introduction. Plan your approach first, then provide the JSON.`;

  const { data: intro } = await callModel(
    {
      stepName: 'generateProse',
      systemPrompt: introSystemPrompt,
      userPrompt: introUserPrompt,
      modelConfig: input.modelConfig,
      maxTokens: 2048,
      temperature: 0.8,
    },
    (raw) => IntroductionSchema.parse(raw),
  );

  // ---- Calls 2+: Scene Batches ----

  const allScenes: Record<string, string> = {};

  // Split entries into batches
  const batches: CasebookEntryDraft[][] = [];
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    batches.push(entries.slice(i, i + BATCH_SIZE));
  }

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];

    const entryContexts = batch.map((entry) =>
      buildEntryContext(entry, locations, characters, facts),
    );

    const batchSystemPrompt = `You are a Victorian-era mystery writer crafting prose scenes for a detective game. Each scene is what the player reads when they visit a casebook entry.

First, briefly plan each scene: what the player experiences, how characters reveal or conceal information. Then provide the JSON.

Your response must end with valid JSON: a Record<string, string> mapping entryId to prose scene text.

${sceneGuidelines}`;

    const batchUserPrompt = `Here is the case context:

Title: ${intro.title}
Setting: ${template.era}, ${template.date}
Crime Type: ${template.crimeType}

The story (chronological events):
${storyTimeline}

Write scenes for these ${batch.length} casebook entries (batch ${batchIdx + 1} of ${batches.length}):

${entryContexts.join('\n\n')}

Plan each scene's approach first, then provide the JSON mapping entryId -> scene text.`;

    const { data: sceneBatch } = await callModel(
      {
        stepName: 'generateProse',
        systemPrompt: batchSystemPrompt,
        userPrompt: batchUserPrompt,
        modelConfig: input.modelConfig,
        maxTokens: 4096,
        temperature: 0.8,
      },
      (raw) => SceneBatchSchema.parse(raw),
    );

    Object.assign(allScenes, sceneBatch);
  }

  return {
    ...state,
    title: intro.title,
    introduction: intro.introduction,
    prose: allScenes,
  };
};

// ============================================
// Helpers
// ============================================

function buildEntryContext(
  entry: CasebookEntryDraft,
  locations: Record<string, LocationDraft>,
  characters: Record<string, CharacterDraft>,
  facts: Record<string, FactDraft>,
): string {
  const location = locations[entry.locationId];
  const presentChars = entry.characters
    .map((cid) => characters[cid])
    .filter(Boolean);
  const revealedFacts = entry.revealsFactIds
    .map((fid) => facts[fid])
    .filter(Boolean);

  return `Entry "${entry.entryId}" (${entry.label}, ${entry.address}):
  Location: ${location?.name ?? entry.locationId} — ${location?.description ?? ''}
  Type: ${entry.type}
  Characters present: ${presentChars.map((c) => `${c.name} (${c.role}, tone: ${c.tone.register}, vocab: [${c.tone.vocabulary.join(', ')}]${c.tone.quirk ? `, quirk: ${c.tone.quirk}` : ''})`).join('; ') || 'none'}
  Facts to reveal: ${revealedFacts.map((f) => `${f.factId}: "${f.description}"`).join('; ')}
  Character knowledge at this entry:
${presentChars.map((c) => {
  const relevantKnowledge = entry.revealsFactIds
    .filter((fid) => c.knowledgeState[fid])
    .map((fid) => `${fid}: ${c.knowledgeState[fid]}`);
  const hides = c.hides.filter((h) => entry.revealsFactIds.includes(h));
  return `    ${c.name}: knows/suspects [${relevantKnowledge.join(', ')}], hides [${hides.join(', ')}]`;
}).join('\n')}`;
}
