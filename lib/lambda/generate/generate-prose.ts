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

/**
 * Pipeline Step 7: Generate Prose Scenes
 *
 * Generates prose in two calls:
 *   1. One call for the introduction and title
 *   2. One call for ALL casebook scenes (ensures cross-scene coherence)
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
- Each scene should be 150-400 words.
- The player is the detective visiting this location/person. Write in second person ("You arrive at...") where describing the scene, third person for dialogue.
- Characters should speak in their distinctive tone (use their register, vocabulary, and quirks).
- Characters reveal facts they KNOW about naturally through dialogue or observation.
- Characters who SUSPECT something should hint at it indirectly.
- Characters who HIDE something should deflect, change the subject, or give misleading information.
- Physical evidence facts should be woven into environmental descriptions.
- Never tell the player the significance of what they've found — let them connect the dots.
- The prose should reward careful reading without being obtuse.
- Maintain the atmospheric tone: ${template.atmosphere}.
- Keep each character's current status in mind. Characters who cannot be met or interviewed (e.g. deceased, missing) must NOT appear as speaking or interactable.
- Avoid common AI writing tells like em-dashes, asterisks, or excessive line breaks.
- Locations that are accessible, visible, or audible from this one should be mentioned in the scene.`;

  // ---- Call 1: Introduction and Title ----

  const introSystemPrompt = `You are a mystery writer crafting the opening scene for a detective game. The introduction is what the player reads before they begin investigating.

First, briefly plan the narrative arc of the introduction. Then provide the JSON.

Your response must end with valid JSON matching this schema:
{
  "title": string,          // Final case title (may refine the template title)
  "introduction": string    // 2-4 paragraph opening scene (150-300 words)
}

Introduction guidelines:
- Set the scene: where the player is summoned, who called them in, what the initial situation appears to be.
- Establish the atmosphere and era.
- Give the player just enough to start investigating, but don't give away the solution.

${sceneGuidelines}`;

  const introUserPrompt = `Here is the case context:

Title: ${template.title}
Setting: ${template.era}, ${template.date}
Atmosphere: ${template.atmosphere}
Crime Type: ${template.crimeType}

The story (chronological events):
${storyTimeline}

Characters:
${Object.values(characters).map((c) => `  - ${c.name} (${c.mysteryRole}, ${c.societalRole})${c.currentStatus ? ` [current status: ${c.currentStatus}]` : ''}`).join('\n')}

Write the introduction. Plan your approach first, then provide the JSON.`;

  const { data: intro } = await callModel(
    {
      stepName: 'generateProse',
      systemPrompt: introSystemPrompt,
      userPrompt: introUserPrompt,
      modelConfig: input.modelConfig,
      outputTokens: 1024,
      thinkingTokens: 2048,
      temperature: 0.8,
    },
    (raw) => IntroductionSchema.parse(raw),
  );

  // ---- Call 2: All Scenes ----

  const entryContexts = entries.map((entry) =>
    buildEntryContext(entry, locations, characters, facts),
  );

  const scenesSystemPrompt = `You are a mystery writer crafting prose scenes for a detective game. Each scene is what the player reads when they visit a casebook entry.

You are writing ALL scenes for this case in a single pass. Ensure consistency across scenes: if two characters describe the same event, their accounts should align (or deliberately conflict if one is lying). Recurring details (weather, time of day, physical descriptions) must be consistent.

Your response must end with valid JSON: a Record<string, string> mapping entryId to prose scene text.

${sceneGuidelines}`;

  const scenesUserPrompt = `Here is the case context:

Title: ${intro.title}
Setting: ${template.era}, ${template.date}
Crime Type: ${template.crimeType}

Introduction:
${intro.introduction}

The story (chronological events):
${storyTimeline}

Write scenes for all ${entries.length} casebook entries:

${entryContexts.join('\n\n')}

Provide the JSON mapping entryId -> scene text.`;

  const { data: scenes } = await callModel(
    {
      stepName: 'generateProse',
      systemPrompt: scenesSystemPrompt,
      userPrompt: scenesUserPrompt,
      modelConfig: input.modelConfig,
      outputTokens: 8192,
      thinkingTokens: 4096,
    },
    (raw) => SceneBatchSchema.parse(raw),
  );

  return {
    ...state,
    title: intro.title,
    introduction: intro.introduction,
    prose: scenes,
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
  Location: ${entry.locationId} — ${location.name} — ${location?.description ?? ''}
  Accessible from: ${location?.accessibleFrom.map((id) => `${id} — ${locations[id].name}`).join(', ') ?? ''}
  Visible from: ${location?.visibleFrom.map((id) => `${id} — ${locations[id].name}`).join(', ') ?? ''}
  Audible from: ${location?.audibleFrom.map((id) => `${id} — ${locations[id].name}`).join(', ') ?? ''}
  Characters present: ${presentChars.map((c) => `${c.name} (${c.mysteryRole}, ${c.societalRole}, tone: ${c.tone.register}, vocab: [${c.tone.vocabulary.join(', ')}]${c.tone.quirk ? `, quirk: ${c.tone.quirk}` : ''})`).join('; ') || 'none'}
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
