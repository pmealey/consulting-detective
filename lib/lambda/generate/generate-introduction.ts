import { callModel } from '../shared/bedrock';
import {
  GenerateIntroductionOutputSchema,
  type CaseGenerationState,
} from '../shared/generation-state';

/**
 * Pipeline Step 7: Generate Introduction
 *
 * AI step that runs after GenerateFacts (so all facts have descriptions).
 * Produces three outputs:
 *
 * 1. **introductionFactIds** (2-4) — the facts that form the opening hook.
 *    These seed the investigation: their subjects unlock the first wave
 *    of casebook entries.
 *
 * 2. **introduction** — the opening prose scene the player reads before
 *    they begin investigating.
 *
 * 3. **title** — the finalized case title (may refine the template title).
 *
 * The AI receives the full fact graph so it can choose facts that:
 * - Tell a compelling opening story ("You're summoned because X happened to Y at Z")
 * - Seed the investigation with enough subjects to unlock 2-3 casebook entries
 * - Don't give away too much
 *
 * The template's mysteryStyle and narrativeTone guide the voice and structure.
 */
export const handler = async (state: CaseGenerationState): Promise<CaseGenerationState> => {
  const { input, template, events, characters, locations, facts, factGraph } = state;

  if (!template) throw new Error('GenerateIntroduction requires template from step 1');
  if (!events) throw new Error('GenerateIntroduction requires events from step 2');
  if (!characters) throw new Error('GenerateIntroduction requires characters from step 3');
  if (!locations) throw new Error('GenerateIntroduction requires locations from step 4');
  if (!facts) throw new Error('GenerateIntroduction requires facts from step 6');
  if (!factGraph) throw new Error('GenerateIntroduction requires factGraph from ComputeFacts');

  const allFacts = Object.values(facts);
  const trueFacts = allFacts.filter((f) => f.veracity === 'true');

  const storyTimeline = Object.values(events)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((e) => `  ${e.timestamp}. ${e.description}`)
    .join('\n');

  // Build a subject connectivity summary so the AI can see which facts
  // unlock which subjects (and therefore which casebook entries)
  const subjectConnectivity = buildSubjectConnectivity(factGraph, characters, locations);

  const systemPrompt = `You are a mystery writer crafting the opening scene for a detective game. Your job has three parts:

1. **Select introduction facts** — choose 2-4 facts that form the opening hook. These are the ONLY facts the player knows before they start investigating. They seed the entire investigation by revealing subjects (characters and locations) that unlock casebook entries.

2. **Write the introduction** — the opening scene the player reads. 200-400 words, 2-4 paragraphs.

3. **Finalize the title** — you may refine the template title to better fit the tone.

First, reason through your choices: which facts make a compelling hook, which subjects they reveal, and how many casebook entries they'll unlock. Then provide the JSON.

Your response must end with valid JSON matching this schema:
{
  "introductionFactIds": string[],  // 2-4 factIds (MUST be true facts)
  "title": string,                   // Finalized case title
  "introduction": string             // Opening scene prose (200-400 words)
}

## Fact Selection Rules

The introduction facts are the seeds of the entire investigation. Choose carefully:

1. **Only true facts** — never select false facts (veracity: "false") as introduction facts.
2. **Subject coverage** — the selected facts' subjects should include at least 2-3 different characters or locations. Each subject unlocks casebook entries about that subject, so more subjects = more places the player can go from the start.
3. **Compelling hook** — the facts should tell a coherent opening story. "A body was found at the docks" + "The victim owed money to a shipping magnate" is better than two unrelated facts.
4. **Don't give away too much** — avoid facts that directly answer quiz questions (means, motive for the culprit). Prefer facts that raise questions rather than answer them.
5. **Prefer facts with many subjects** — facts that connect multiple characters/locations give the player more threads to pull.
6. **Consider the fact graph** — look at which subjects each fact connects to, and which other facts those subjects can reveal. The introduction should open up at least 2-3 distinct investigation paths.

## Introduction Writing Guidelines

- Set the scene: where the player is summoned, who called them in, what the initial situation appears to be.
- Establish the atmosphere, era, and narrative tone.
- Weave the introduction facts naturally into the prose — the player should learn these facts by reading the introduction, not from a bullet list.
- Give the player just enough to start investigating, but don't give away the solution.
- Write in second person ("You receive a telegram...") for scene-setting, third person for dialogue.
- Maintain the narrative tone: ${template.narrativeTone}.
- Maintain the atmospheric mood: ${template.atmosphere}.
- Keep each character's current status in mind. Don't have deceased characters speak.
- Avoid common AI writing tells like em-dashes, asterisks, or excessive line breaks.

## Mystery Style Prose Constraints (CRITICAL)

The mystery style is "${template.mysteryStyle}". ALL prose — introduction and scenes — must be consistent with this structural shape. The introduction sets the player's expectations for the investigation, so it must not promise a scope or pacing that contradicts the casebook.

${getMysteryStyleProseConstraints(template.mysteryStyle)}`;

  const userPrompt = `Here is the case context:

Title: ${template.title}
Setting: ${template.era}, ${template.date}
Atmosphere: ${template.atmosphere}
Mystery Style: ${template.mysteryStyle}
Narrative Tone: ${template.narrativeTone}
Crime Type: ${template.crimeType}

## The Story (chronological events)
${storyTimeline}

## Characters
${Object.values(characters).map((c) => `  - ${c.characterId} (${c.name}): ${c.mysteryRole}, ${c.societalRole}${c.currentStatus ? ` [current status: ${c.currentStatus}]` : ''}`).join('\n')}

## Locations
${Object.values(locations).map((l) => `  - ${l.locationId} (${l.name}): ${l.type} — ${l.description}`).join('\n')}

## Available Facts (TRUE facts only — you must select from these)
${trueFacts.map((f) => `  - ${f.factId}: "${f.description}" [${f.category}] subjects: [${f.subjects.join(', ')}]`).join('\n')}

## Subject Connectivity (which subjects each fact connects to)
${subjectConnectivity}

Select 2-4 introduction facts, write the opening scene, and finalize the title. Think through your choices carefully first, then provide the JSON.`;

  const { data: result } = await callModel(
    {
      stepName: 'generateIntroduction',
      systemPrompt,
      userPrompt,
      modelConfig: input.modelConfig,
    },
    (raw) => {
      const parsed = GenerateIntroductionOutputSchema.parse(raw);

      // Post-validation: ensure all selected facts exist and are true
      const factIds = new Set(Object.keys(facts));
      for (const fid of parsed.introductionFactIds) {
        if (!factIds.has(fid)) {
          throw new Error(`Introduction factId "${fid}" does not exist in the facts record`);
        }
        if (facts[fid].veracity !== 'true') {
          throw new Error(`Introduction factId "${fid}" has veracity "${facts[fid].veracity}" — only true facts allowed`);
        }
      }

      return parsed;
    },
  );

  return {
    ...state,
    introductionFactIds: result.introductionFactIds,
    introduction: result.introduction,
    title: result.title,
  };
};

// ============================================
// Helpers
// ============================================

/**
 * Builds a human-readable summary of the fact-subject bipartite graph
 * so the AI can reason about which facts unlock which investigation paths.
 */
function buildSubjectConnectivity(
  factGraph: { factToSubjects: Record<string, string[]>; subjectToFacts: Record<string, string[]> },
  characters: Record<string, { characterId: string; name: string }>,
  locations: Record<string, { locationId: string; name: string }>,
): string {
  const lines: string[] = [];

  // Show each subject and how many facts connect to it
  for (const [subjectId, factIds] of Object.entries(factGraph.subjectToFacts)) {
    const char = characters[subjectId];
    const loc = locations[subjectId];
    const label = char
      ? `${char.name} (character)`
      : loc
        ? `${loc.name} (location)`
        : subjectId;
    lines.push(`  ${subjectId} [${label}]: can reveal ${factIds.length} facts`);
  }

  return lines.join('\n');
}

/**
 * Returns prose constraints specific to each mystery style. These tell the
 * AI what the style means for pacing, spatial scope, and tone — preventing
 * mismatches like a "time-limited" introduction that implies urgency while
 * scenes describe leisurely multi-day traversals across a city.
 */
function getMysteryStyleProseConstraints(mysteryStyle: string): string {
  switch (mysteryStyle) {
    case 'isolated':
      return `Style "isolated" — CONTAINED SETTING:
- All action takes place in a single building, estate, vessel, or small compound. The detective does not leave.
- The introduction should establish that the detective is ON SITE — summoned to the location, already present when the crime occurs, or arriving at the one place where everything happened.
- Scenes should feel claustrophobic: characters are trapped together, tensions run high, everyone is a suspect.
- Travel between entries is walking down a corridor, crossing a courtyard, or climbing stairs — never hailing a cab or crossing town.
- Time passes slowly. Hours feel long. The weather outside is mentioned but never experienced.`;

    case 'sprawling':
      return `Style "sprawling" — WIDE INVESTIGATION:
- The investigation spans a city or region. The detective travels between distinct neighborhoods, institutions, and social circles.
- The introduction should establish the detective's base of operations and the initial thread that sends them out into the wider world.
- Scenes should convey a sense of movement and distance: cab rides, train journeys, different atmospheres in different parts of the city.
- Each entry feels like a different world — the docks vs. the drawing room vs. the courthouse.
- Time passes at a natural pace. The investigation takes days. Characters may need to be revisited.`;

    case 'time-limited':
      return `Style "time-limited" — URGENCY AND DEADLINE:
- A ticking clock drives the investigation: a suspect is about to flee, evidence will be destroyed, a trial begins tomorrow, a ship departs at dawn.
- The introduction MUST establish the deadline explicitly. The player should feel the pressure from the first paragraph.
- Scenes should reinforce urgency: characters are hurried, evasive, or panicked. Clocks are mentioned. Light changes (afternoon fading to evening).
- CRITICAL: Do NOT imply the detective has unlimited time. No "you return the next morning" or "over the following days." Everything happens in a compressed window (hours, a single day at most).
- Travel is quick and purposeful — the detective moves fast, not leisurely.`;

    case 'layered':
      return `Style "layered" — HIDDEN DEPTH:
- The surface crime is not what it seems. The introduction should present a straightforward situation that will later prove to be a facade.
- Early scenes should feel routine — almost too easy. The real mystery emerges gradually as the detective digs deeper.
- The introduction should NOT hint at the deeper layer. Play it straight. Let the player discover the twist through investigation.
- Tone shifts subtly across scenes: early entries are matter-of-fact, later entries become more unsettling or surprising.
- The pacing is deliberate — the detective thinks they're wrapping up, then realizes they've barely started.`;

    case 'parallel':
      return `Style "parallel" — CONVERGING THREADS:
- Two seemingly unrelated situations are actually connected. The introduction may present one thread; the other emerges during investigation.
- Scenes should alternate between the two threads. Characters in one thread may not know about the other.
- The introduction should establish one thread clearly and perhaps hint at the second without making the connection obvious.
- The detective's journey involves a moment of realization — "wait, these are the same case." Scenes near the convergence point should carry dramatic irony.
- Pacing is moderate. The detective has time to follow both threads before they merge.`;

    default:
      return `Ensure the prose is consistent with the mystery style "${mysteryStyle}". The introduction should set expectations for scope, pacing, and spatial constraints that the casebook scenes will honor.`;
  }
}
