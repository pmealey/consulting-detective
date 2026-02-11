import { callModel } from '../shared/bedrock';
import { getDraft, updateDraft } from '../shared/draft-db';
import {
  SceneBatchSchema,
  type OperationalState,
  type CasebookEntryDraft,
  type CharacterDraft,
  type FactDraft,
  type LocationDraft,
} from '../shared/generation-state';

/**
 * Pipeline Step 9: Generate Prose Scenes
 *
 * Generates prose scenes for ALL casebook entries in a single LLM call
 * to ensure cross-scene coherence.
 *
 * The introduction and title are already written by GenerateIntroduction
 * (step 7) — this step only produces casebook scenes.
 *
 * Each scene uses present characters' knowledge states (knows, suspects,
 * hides, denies, believes) and fact veracity so false facts are presented
 * as believed by characters who hold them.
 */
export const handler = async (state: OperationalState): Promise<OperationalState> => {
  const { input, draftId } = state;
  const draft = await getDraft(draftId);
  const { template, events, characters, locations, facts, casebook, introduction, title } = draft ?? {};

  if (!template) throw new Error('GenerateProse requires template from step 1');
  if (!events) throw new Error('GenerateProse requires events from step 2');
  if (!characters) throw new Error('GenerateProse requires characters from step 3');
  if (!locations) throw new Error('GenerateProse requires locations from step 4');
  if (!facts) throw new Error('GenerateProse requires facts from step 6');
  if (!casebook) throw new Error('GenerateProse requires casebook from step 8');
  if (!introduction) throw new Error('GenerateProse requires introduction from step 7');
  if (!title) throw new Error('GenerateProse requires title from step 7');

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
- Characters who DENY something should actively contradict the truth — they have a false version they believe.
- Characters who BELIEVE a false fact should state it confidently as truth.
- Physical evidence facts should be woven into environmental descriptions.
- Include fact veracity awareness: false facts (veracity: "false") should be presented as if true by characters who believe them.
- Never tell the player the significance of what they've found — let them connect the dots.
- The prose should reward careful reading without being obtuse.
- Maintain the narrative tone: ${template.narrativeTone}.
- Maintain the atmospheric mood: ${template.atmosphere}.
- Keep each character's current status in mind. Characters who cannot be met or interviewed (e.g. deceased, missing) must NOT appear as speaking or interactable.
- Avoid common AI writing tells like em-dashes, asterisks, or excessive line breaks.
- Locations that are accessible, visible, or audible from this one should be mentioned in the scene.

Mystery Style Prose Constraints (CRITICAL — the mystery style is "${template.mysteryStyle}"):
${getMysteryStyleProseConstraints(template.mysteryStyle)}`;

  const entryContexts = entries.map((entry) =>
    buildEntryContext(entry, locations, characters, facts),
  );

  const scenesSystemPrompt = `You are a mystery writer crafting prose scenes for a detective game. Each scene is what the player reads when they visit a casebook entry.

You are writing ALL scenes for this case in a single pass. Ensure consistency across scenes: if two characters describe the same event, their accounts should align (or deliberately conflict if one is lying/denying). Recurring details (weather, time of day, physical descriptions) must be consistent.

Your response must end with valid JSON: a Record<string, string> mapping entryId to prose scene text.

${sceneGuidelines}`;

  const scenesUserPrompt = `Here is the case context:

Title: ${title}
Setting: ${template.era}, ${template.date}
Crime Type: ${template.crimeType}
Mystery Style: ${template.mysteryStyle}
Narrative Tone: ${template.narrativeTone}

Introduction (already written — maintain consistency with it):
${introduction}

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
    },
    (raw) => SceneBatchSchema.parse(raw),
  );

  await updateDraft(draftId, { prose: scenes });
  return state;
};

// ============================================
// Helpers
// ============================================

/**
 * Returns prose constraints specific to each mystery style. Ensures scenes
 * are consistent with the structural shape established by the introduction.
 */
function getMysteryStyleProseConstraints(mysteryStyle: string): string {
  switch (mysteryStyle) {
    case 'isolated':
      return `Style "isolated" — CONTAINED SETTING:
- All action takes place in a single building, estate, vessel, or small compound.
- Scenes should feel claustrophobic: characters are trapped together, tensions run high.
- Travel between entries is walking down a corridor, crossing a courtyard, or climbing stairs — never hailing a cab or crossing town.
- Time passes slowly. Hours feel long. The weather outside is mentioned but never experienced.`;

    case 'sprawling':
      return `Style "sprawling" — WIDE INVESTIGATION:
- The investigation spans a city or region. Convey a sense of movement and distance between entries.
- Each entry feels like a different world — different social strata, neighborhoods, or spheres of influence.
- Time passes at a natural pace. The investigation takes days. Transitions between entries can mention travel.`;

    case 'time-limited':
      return `Style "time-limited" — URGENCY AND DEADLINE:
- A ticking clock drives the investigation. Scenes should reinforce urgency: characters are hurried, evasive, or panicked.
- CRITICAL: Do NOT imply the detective has unlimited time. No "you return the next morning" or "over the following days." Everything happens in a compressed window.
- Clocks, fading light, and deadline references should appear naturally in scenes.
- Travel is quick and purposeful — the detective moves fast, not leisurely.`;

    case 'layered':
      return `Style "layered" — HIDDEN DEPTH:
- Early scenes should feel routine — almost too easy. The real mystery emerges gradually.
- Tone shifts subtly across scenes: early entries are matter-of-fact, later entries become more unsettling or surprising.
- The pacing is deliberate — the detective thinks they're wrapping up, then realizes they've barely started.`;

    case 'parallel':
      return `Style "parallel" — CONVERGING THREADS:
- Scenes alternate between two threads. Characters in one thread may not know about the other.
- Scenes near the convergence point should carry dramatic irony.
- Pacing is moderate. The detective has time to follow both threads before they merge.`;

    default:
      return `Ensure scenes are consistent with the mystery style "${mysteryStyle}" in scope, pacing, and spatial constraints.`;
  }
}

function buildEntryContext(
  entry: CasebookEntryDraft,
  locations: Record<string, LocationDraft>,
  characters: Record<string, CharacterDraft>,
  facts: Record<string, FactDraft>,
): string {
  const location = locations[entry.locationId];
  const presentChars = entry.characterIds
    .map((cid) => characters[cid])
    .filter(Boolean);
  const revealedFacts = entry.revealsFactIds
    .map((fid) => facts[fid])
    .filter(Boolean);

  return `Entry "${entry.entryId}" (${entry.label}, ${entry.address}):
  Location: ${entry.locationId} — ${location.name} — ${location?.description ?? ''}
  Accessible from: ${location?.accessibleFrom.map((id) => `${id} — ${locations[id]?.name ?? id}`).join(', ') ?? ''}
  Visible from: ${location?.visibleFrom.map((id) => `${id} — ${locations[id]?.name ?? id}`).join(', ') ?? ''}
  Audible from: ${location?.audibleFrom.map((id) => `${id} — ${locations[id]?.name ?? id}`).join(', ') ?? ''}
  Characters present: ${presentChars.map((c) => `${c.name} (${c.mysteryRole}, ${c.societalRole}, tone: ${c.tone.register}, vocab: [${c.tone.vocabulary.join(', ')}]${c.tone.quirk ? `, quirk: ${c.tone.quirk}` : ''})`).join('; ') || 'none'}
  Facts to reveal: ${revealedFacts.map((f) => `${f.factId}: "${f.description}" (veracity: ${f.veracity})`).join('; ')}
  Character knowledge at this entry:
${presentChars.map((c) => {
  const relevantKnowledge = entry.revealsFactIds
    .filter((fid) => c.knowledgeState[fid])
    .map((fid) => `${fid}: ${c.knowledgeState[fid]}`);
  return `    ${c.name}: knowledge [${relevantKnowledge.join(', ')}], motivations [${c.motivations.join('; ')}]`;
}).join('\n')}`;
}
