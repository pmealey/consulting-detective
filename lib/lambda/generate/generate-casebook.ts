import { callModel } from '../shared/bedrock';
import { getDraft, updateDraft } from '../shared/draft-db';
import {
  CasebookPolishSchema,
  type OperationalState,
  type CasebookEntryDraft,
  type CharacterDraft,
  type FactDraft,
  type FactGraph,
  type LocationDraft,
  type ComputedKnowledge,
} from '../shared/generation-state';

/**
 * Pipeline Step 8: Generate Casebook (Hybrid Programmatic + AI)
 *
 * Creates the player-facing casebook: visitable entries that each reveal
 * specific facts. Uses a two-phase approach:
 *
 * 1. **Programmatic structure** — builds entries from the fact-subject
 *    bipartite graph. Each subject (character or location) becomes a
 *    casebook entry. Entry gating uses facts about that subject. Entry
 *    reveals come from character knowledge states and location reveals.
 *
 * 2. **AI polish** — the AI refines the programmatic skeleton with
 *    creative details: labels, addresses, era-appropriate flavor, which
 *    characters are physically present at each entry, and optionally
 *    merging or splitting entries for narrative reasons.
 *
 * The programmatic phase guarantees structural correctness (all facts
 * reachable, all entries gated, graph connectivity). The AI phase adds
 * narrative quality without breaking the structure.
 */
export const handler = async (state: OperationalState): Promise<OperationalState> => {
  const { input, draftId } = state;
  const draft = await getDraft(draftId);
  const {
    template, events, characters, locations, facts,
    introductionFactIds, factGraph, computedKnowledge,
  } = draft ?? {};
  const validationResult = state.validationResult;

  if (!template) throw new Error('Step 8 requires template from step 1');
  if (!events) throw new Error('Step 8 requires events from step 2');
  if (!characters) throw new Error('Step 8 requires characters from step 3');
  if (!locations) throw new Error('Step 8 requires locations from step 4');
  if (!facts) throw new Error('Step 8 requires facts from step 6');
  if (!introductionFactIds) throw new Error('Step 8 requires introductionFactIds from step 7');
  if (!factGraph) throw new Error('Step 8 requires factGraph from ComputeFacts');
  if (!computedKnowledge) throw new Error('Step 8 requires computedKnowledge from ComputeEventKnowledge');

  // ── Phase 1: Programmatic structure ──────────────────────────────
  const skeleton = buildCasebookSkeleton(
    characters,
    locations,
    facts,
    introductionFactIds,
    factGraph,
    computedKnowledge,
  );

  // ── Phase 2: AI polish ───────────────────────────────────────────
  const skeletonSummary = formatSkeletonForPrompt(skeleton, characters, locations, facts);

  const systemPrompt = `You are a game designer polishing the casebook for a detective mystery game. The casebook structure has already been determined programmatically — every entry's reveals and gates are fixed. Your job is to add creative polish:

Your response must end with valid JSON: a Record<string, CasebookPolishEntry> keyed by entryId.

Each entry must match this schema:
{
  "entryId": string,         // MUST match the skeleton entryId exactly
  "label": string,           // Display name, e.g. "Inspector Lestrade" or "The Pemberton Residence"
  "address": string,         // Display address, e.g. "Scotland Yard, Whitehall"
  "characters": string[]     // characterIds physically present and interviewable at this entry
}

## YOUR RESPONSIBILITIES

1. **Labels**: Give each entry an evocative display name appropriate to the era and setting. Character entries should use the character's name or title. Location entries should use the location's name or a descriptive label.

2. **Addresses**: Give each entry an era-appropriate address. These appear in the player's casebook as the address they visit. Be specific and atmospheric.

3. **Characters present**: Decide which characters are physically present at each entry. Rules:
   - Characters should be present at entries where they can plausibly be found and interviewed.
   - A character's entry should include that character (unless their currentStatus prevents it — e.g. deceased, missing).
   - Location entries may have 0 or more characters present — whoever would plausibly be there.
   - Characters who are deceased, missing, or otherwise unavailable should NOT be listed as present anywhere.
   - A character can be present at multiple entries if it makes sense.

## WHAT YOU MUST NOT CHANGE

- Do NOT change entryIds, locationIds, revealsFactIds, or requiresAnyFact — these are structurally fixed.
- Do NOT add or remove entries — the set of entries is fixed.
- You are ONLY providing labels, addresses, and character presence.

## CONTEXT

Setting: ${template.era}
Atmosphere: ${template.atmosphere}
Mystery Style: ${template.mysteryStyle}
Narrative Tone: ${template.narrativeTone}

## Mystery Style Casebook Constraints (CRITICAL)

The mystery style is "${template.mysteryStyle}". Entry labels and addresses MUST reflect this structural shape. The casebook is the player's map of the investigation — names and addresses set expectations for scope, pacing, and place.

${getMysteryStyleCasebookConstraints(template.mysteryStyle)}`;

  const userPrompt = `Here is the programmatic casebook skeleton to polish:

Title: ${template.title}
Setting: ${template.era}
Crime Type: ${template.crimeType}
Mystery Style: ${template.mysteryStyle}
Narrative Tone: ${template.narrativeTone}

${skeletonSummary}

## Characters
${Object.values(characters).map((c) => `  - ${c.characterId} (${c.name}): ${c.mysteryRole}, ${c.societalRole}${c.currentStatus ? ` [current status: ${c.currentStatus}]` : ''}`).join('\n')}

## Locations
${Object.values(locations).map((l) => `  - ${l.locationId} (${l.name}): ${l.type} — ${l.description}`).join('\n')}

Provide the JSON with labels, addresses, and character assignments for each entry. Labels and addresses must match the mystery style above.${
  validationResult && !validationResult.valid
    ? `

## IMPORTANT — PREVIOUS ATTEMPT FAILED VALIDATION

Your previous casebook polish failed validation. Fix these errors:

${validationResult.errors.map((e) => `- ${e}`).join('\n')}`
    : ''
}`;

  const { data: polish } = await callModel(
    {
      stepName: 'generateCasebook',
      systemPrompt,
      userPrompt,
      modelConfig: input.modelConfig,
    },
    (raw) => CasebookPolishSchema.parse(raw),
  );

  // ── Phase 3: Merge AI polish into programmatic skeleton ──────────
  const casebook = mergeCasebook(skeleton, polish);

  await updateDraft(draftId, { casebook });
  return state;
};

// ════════════════════════════════════════════════════════════════════
// Phase 1: Build programmatic casebook skeleton
// ════════════════════════════════════════════════════════════════════

/**
 * Builds a casebook entry for each subject (character or location) in
 * the fact graph. Each entry:
 *
 * - Is gated on facts that mention this subject (requiresAnyFact)
 * - Reveals facts the subject can share (characters: knows/suspects/believes;
 *   locations: physical evidence from locationReveals)
 * - Is placed at the subject's location (characters: first event location
 *   or a default; locations: the location itself)
 */
export function buildCasebookSkeleton(
  characters: Record<string, CharacterDraft>,
  locations: Record<string, LocationDraft>,
  facts: Record<string, FactDraft>,
  introductionFactIds: string[],
  factGraph: FactGraph,
  computedKnowledge: ComputedKnowledge,
): Record<string, CasebookEntryDraft> {
  const entries: Record<string, CasebookEntryDraft> = {};
  const allFactIds = new Set(Object.keys(facts));
  const introFactIdSet = new Set(introductionFactIds);

  // ── Character entries ──────────────────────────────────────────
  for (const character of Object.values(characters)) {
    const charId = character.characterId;
    const entryId = `entry_${charId}`;

    // Reveals: facts this character knows, suspects, or believes
    const revealableStatuses = new Set(['knows', 'suspects', 'believes']);
    const revealsFactIds: string[] = [];
    for (const [factId, status] of Object.entries(character.knowledgeState)) {
      if (revealableStatuses.has(status) && allFactIds.has(factId)) {
        revealsFactIds.push(factId);
      }
    }

    // Gates: facts that have this character as a subject (excluding intro facts,
    // since intro facts are already known — we want facts that LEAD TO this entry)
    const factsAboutSubject = findFactsAboutSubject(charId, facts);
    const gateFactIds = factsAboutSubject.filter((fid) => !introFactIdSet.has(fid));

    // If no non-intro facts gate this entry, use intro facts about this subject
    // (the entry is accessible from the start if the intro mentions this character)
    const requiresAnyFact = gateFactIds.length > 0
      ? gateFactIds
      : factsAboutSubject.filter((fid) => introFactIdSet.has(fid));

    // If still no gates, use any fact from the intro (fallback — shouldn't
    // happen if ComputeFacts ensured connectivity, but be safe)
    const finalGates = requiresAnyFact.length > 0
      ? requiresAnyFact
      : [...introductionFactIds].slice(0, 1);

    // Location: pick the first location this character is associated with
    // via their events, or fall back to the first location
    const locationId = findCharacterLocation(charId, factGraph, locations);

    entries[entryId] = {
      entryId,
      label: character.name,
      address: '',
      locationId,
      characters: [charId],
      revealsFactIds: dedup(revealsFactIds),
      requiresAnyFact: dedup(finalGates),
    };
  }

  // ── Location entries ───────────────────────────────────────────
  for (const location of Object.values(locations)) {
    const locId = location.locationId;
    const entryId = `entry_${locId}`;

    // Reveals: physical evidence at this location
    const locationRevealIds = computedKnowledge.locationReveals[locId] ?? [];
    // Also include any facts from the factGraph's subjectToFacts for this location
    const graphFacts = factGraph.subjectToFacts[locId] ?? [];
    const revealsFactIds = dedup([
      ...locationRevealIds.filter((fid) => allFactIds.has(fid)),
      ...graphFacts.filter((fid) => allFactIds.has(fid)),
    ]);

    // Skip location entries that reveal nothing — they'd be dead ends
    if (revealsFactIds.length === 0) continue;

    // Gates: facts that have this location as a subject
    const factsAboutSubject = findFactsAboutSubject(locId, facts);
    const gateFactIds = factsAboutSubject.filter((fid) => !introFactIdSet.has(fid));
    const requiresAnyFact = gateFactIds.length > 0
      ? gateFactIds
      : factsAboutSubject.filter((fid) => introFactIdSet.has(fid));

    const finalGates = requiresAnyFact.length > 0
      ? requiresAnyFact
      : [...introductionFactIds].slice(0, 1);

    entries[entryId] = {
      entryId,
      label: location.name,
      address: '',
      locationId: locId,
      characters: [],
      revealsFactIds,
      requiresAnyFact: dedup(finalGates),
    };
  }

  // ── Ensure all non-intro facts are revealed by at least one entry ──
  const revealedFacts = new Set<string>();
  for (const entry of Object.values(entries)) {
    for (const fid of entry.revealsFactIds) {
      revealedFacts.add(fid);
    }
  }
  // Intro facts are revealed by the introduction, not entries
  for (const fid of introductionFactIds) {
    revealedFacts.add(fid);
  }

  // Find orphaned facts and assign them to the most relevant entry
  for (const factId of allFactIds) {
    if (revealedFacts.has(factId)) continue;
    const fact = facts[factId];
    // Find an entry whose subject overlaps with this fact's subjects
    const targetEntry = findBestEntryForFact(fact, entries);
    if (targetEntry) {
      targetEntry.revealsFactIds.push(factId);
      revealedFacts.add(factId);
    }
  }

  return entries;
}

// ════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════

/** Find all factIds that have the given subjectId in their subjects array. */
function findFactsAboutSubject(
  subjectId: string,
  facts: Record<string, FactDraft>,
): string[] {
  const result: string[] = [];
  for (const fact of Object.values(facts)) {
    if (fact.subjects.includes(subjectId)) {
      result.push(fact.factId);
    }
  }
  return result;
}

/** Find a plausible location for a character entry. */
function findCharacterLocation(
  characterId: string,
  factGraph: FactGraph,
  locations: Record<string, LocationDraft>,
): string {
  // Look at facts about this character — do any share a location subject?
  const charFacts = factGraph.subjectToFacts[characterId] ?? [];
  for (const factId of charFacts) {
    const subjects = factGraph.factToSubjects[factId] ?? [];
    for (const subjectId of subjects) {
      if (subjectId !== characterId && locations[subjectId]) {
        return subjectId;
      }
    }
  }
  // Fallback: first location
  const locationIds = Object.keys(locations);
  return locationIds[0] ?? '';
}

/** Find the best entry to assign an orphaned fact to. */
function findBestEntryForFact(
  fact: FactDraft,
  entries: Record<string, CasebookEntryDraft>,
): CasebookEntryDraft | undefined {
  // Prefer entries whose subject matches one of the fact's subjects
  for (const subjectId of fact.subjects) {
    const entryId = `entry_${subjectId}`;
    if (entries[entryId]) return entries[entryId];
  }
  // Fallback: first entry
  const allEntries = Object.values(entries);
  return allEntries[0];
}

/** Deduplicate an array preserving order. */
function dedup(arr: string[]): string[] {
  return [...new Set(arr)];
}

/** Format the skeleton for the AI prompt. */
function formatSkeletonForPrompt(
  skeleton: Record<string, CasebookEntryDraft>,
  characters: Record<string, CharacterDraft>,
  locations: Record<string, LocationDraft>,
  facts: Record<string, FactDraft>,
): string {
  return Object.values(skeleton)
    .map((entry) => {
      const loc = locations[entry.locationId];
      const reveals = entry.revealsFactIds
        .map((fid) => facts[fid])
        .filter(Boolean)
        .map((f) => `${f.factId}: "${f.description}" [${f.category}]`)
        .join('; ');
      const gates = entry.requiresAnyFact
        .map((fid) => facts[fid])
        .filter(Boolean)
        .map((f) => `${f.factId}: "${f.description}"`)
        .join('; ');

      // Determine if this is a character or location entry
      const isCharEntry = entry.entryId.startsWith('entry_char_') ||
        entry.characters.some((cid) => characters[cid]);
      const subjectType = isCharEntry ? 'CHARACTER' : 'LOCATION';

      return `### ${entry.entryId} [${subjectType}]
  Location: ${entry.locationId} (${loc?.name ?? 'unknown'})
  Reveals: ${reveals || 'none'}
  Gated on: ${gates || 'none'}`;
    })
    .join('\n\n');
}

/**
 * Returns casebook constraints specific to each mystery style. Labels and
 * addresses must match the structural shape: isolated = one building,
 * sprawling = city-wide, time-limited = urgent places, etc.
 */
function getMysteryStyleCasebookConstraints(mysteryStyle: string): string {
  switch (mysteryStyle) {
    case 'isolated':
      return `Style "isolated" — CONTAINED SETTING:
- All entries are within a single building, estate, vessel, or compound. No street addresses across town.
- Labels: use room names, wing names, or on-site descriptors ("The Study", "East Wing", "Deck B", "The Servants' Hall", "Hydroponics Bay", "The Inner Sanctum").
- Addresses: a single location line with sub-locations as the "address" for each entry. The player never leaves the main site. Adapt to the setting (e.g. a manor house, a starship, a castle, an underwater habitat, a sealed arcane tower).`;

    case 'sprawling':
      return `Style "sprawling" — WIDE INVESTIGATION:
- Entries span the city or region. Labels and addresses should feel like a real address book: different streets, neighborhoods, institutions.
- Labels: full names or titles appropriate to the setting and era.
- Addresses: setting-appropriate full addresses. Each entry is a distinct place the detective travels to. Adapt the address format to the era and world (street addresses for modern cities, district names for ancient cities, sector/level designators for space stations, quarter names for fantasy cities, etc.).`;

    case 'time-limited':
      return `Style "time-limited" — URGENCY AND DEADLINE:
- Labels and addresses should suggest urgency and purpose: places that matter to the deadline (departure point, courthouse, evidence room, suspect's lodgings).
- Labels: concise, purposeful ("Harbour Master's Office", "Last train to Dover", "The Defendant's Cell").
- Addresses: specific and functional — where the detective must go now, not a leisurely tour. Time pressure should be implicit in how places are named.`;

    case 'layered':
      return `Style "layered" — HIDDEN DEPTH:
- Early entries can have mundane, routine labels and addresses (surface world); later entries may hint at something deeper.
- Labels: a mix of ordinary places and people at first; no need to telegraph the twist in the casebook itself.
- Addresses: plausible and era-appropriate. The casebook looks like a normal investigation map; the depth emerges in play.`;

    case 'parallel':
      return `Style "parallel" — CONVERGING THREADS:
- Two distinct threads may be visible in the casebook: different social worlds, neighborhoods, or circles.
- Labels: clearly distinguish who or where belongs to which thread (e.g. names and places from one storyline vs. the other).
- Addresses: reflect the two spheres — e.g. one set of addresses in the financial district, another in the docks — so the player can sense two worlds before they converge.`;

    default:
      return `Ensure labels and addresses are consistent with the mystery style "${mysteryStyle}" in scope and tone. The casebook should feel like the right kind of map for this type of investigation.`;
  }
}

/** Merge AI polish into the programmatic skeleton. */
function mergeCasebook(
  skeleton: Record<string, CasebookEntryDraft>,
  polish: Record<string, { entryId: string; label: string; address: string; characters: string[] }>,
): Record<string, CasebookEntryDraft> {
  const result: Record<string, CasebookEntryDraft> = {};

  for (const [entryId, entry] of Object.entries(skeleton)) {
    const polished = polish[entryId];
    result[entryId] = {
      ...entry,
      // Apply AI polish if available, keep skeleton defaults otherwise
      label: polished?.label ?? entry.label,
      address: polished?.address ?? entry.address,
      characters: polished?.characters ?? entry.characters,
    };
  }

  return result;
}
