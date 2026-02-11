import { getDraft, updateDraft } from '../shared/draft-db';
import type {
  CharacterDraft,
  ComputedKnowledge,
  EventDraft,
  FactGraph,
  FactSkeleton,
  LocationDraft,
  OperationalState,
} from '../shared/generation-state';

/**
 * Pipeline Step 6: Compute Facts
 *
 * Pure programmatic step — no LLM call. Runs after GenerateLocations.
 *
 * Builds the fact-subject bipartite graph that is the structural backbone
 * of the mystery. Every fact has subjects (characterIds and locationIds it
 * is about), and every subject can reveal certain facts. This graph
 * determines what the player can discover and how entries gate each other.
 *
 * Responsibilities:
 *
 * 1. Collect true fact skeletons from event reveals (remapping role IDs
 *    to character IDs via roleMapping from GenerateCharacters).
 *
 * 2. Create false fact skeletons from denials: for each character with
 *    a 'denies' knowledge state entry, create a corresponding false fact
 *    that the character 'believes'.
 *
 * 3. Build the fact-subject bipartite graph:
 *    - Fact -> subjects (from the reveal's subjects list)
 *    - Subject -> revealable facts (characters: knows/suspects/believes;
 *      locations: from computedKnowledge.locationReveals)
 *
 * 4. Verify directed reachability. The casebook is a directed graph:
 *    knowing a fact leads to its subjects (factToSubjects), visiting a
 *    subject reveals new facts (subjectToFacts). We check that every
 *    subject is reachable from every fact via this directed BFS. This
 *    guarantees that no matter which facts GenerateIntroduction later
 *    selects as seeds, all casebook entries will be reachable.
 *
 * 5. Create bridge fact skeletons to fix any directed-unreachable
 *    subjects. A bridge connects a reachable character to an unreachable
 *    subject, providing a directed path through the character's knowledge.
 *
 * 6. Create red herring / incidental fact skeletons in sparse areas.
 *
 * Introduction fact selection is NOT done here — it moves to
 * GenerateIntroduction where the AI can select facts that form a
 * coherent opening narrative. Because this step guarantees directed
 * reachability, any introduction fact selection will produce a fully
 * reachable casebook.
 */
export const handler = async (state: OperationalState): Promise<OperationalState> => {
  const { draftId, input } = state;
  const draft = await getDraft(draftId);
  const { events, characters, locations, computedKnowledge, roleMapping } = draft ?? {};

  if (!events || Object.keys(events).length === 0) {
    throw new Error('ComputeFacts requires events from GenerateEvents');
  }
  if (!characters || Object.keys(characters).length === 0) {
    throw new Error('ComputeFacts requires characters from GenerateCharacters');
  }
  if (!locations || Object.keys(locations).length === 0) {
    throw new Error('ComputeFacts requires locations from GenerateLocations');
  }
  if (!computedKnowledge) {
    throw new Error('ComputeFacts requires computedKnowledge from ComputeEventKnowledge');
  }
  if (!roleMapping) {
    throw new Error('ComputeFacts requires roleMapping from GenerateCharacters');
  }

  const { factSkeletons, factGraph } = computeFacts(
    events,
    characters,
    locations,
    computedKnowledge,
    roleMapping,
  );

  // computeFacts mutates characters in-place: bridge and red herring facts
  // are added to character knowledgeStates so the graph connects. We must
  // persist the updated characters alongside the new skeletons and graph.
  await updateDraft(draftId, { factSkeletons, factGraph, characters });
  return state;
};

/**
 * Core algorithm, exported for testability.
 */
export function computeFacts(
  events: Record<string, EventDraft>,
  characters: Record<string, CharacterDraft>,
  locations: Record<string, LocationDraft>,
  computedKnowledge: ComputedKnowledge,
  roleMapping: Record<string, string>,
): { factSkeletons: FactSkeleton[]; factGraph: FactGraph } {
  // ── Step 0: Clean stale bridge/red-herring entries from characters ──
  // On re-runs, characters may still carry knowledgeState entries from a
  // previous ComputeFacts invocation (bridge_* and red_herring_* facts).
  // Remove them so we start fresh — new bridges and red herrings will be
  // added below based on the current graph structure.
  for (const character of Object.values(characters)) {
    for (const factId of Object.keys(character.knowledgeState)) {
      if (factId.startsWith('fact_bridge_') || factId.startsWith('fact_red_herring_')) {
        delete character.knowledgeState[factId];
      }
    }
  }

  // ── Step 1: Collect true fact skeletons from event reveals ───────
  const skeletons = collectEventRevealSkeletons(events, roleMapping);

  // ── Step 2: Create false fact skeletons from denials ─────────────
  const denialSkeletons = createDenialSkeletons(characters, skeletons);
  skeletons.push(...denialSkeletons);

  // ── Step 3: Build the bipartite graph ────────────────────────────
  let graph = buildFactGraph(skeletons, characters, computedKnowledge);

  // ── Step 4 & 5: Directed reachability check + bridge creation ────
  // The casebook is a directed graph: knowing a fact leads to its
  // subjects (factToSubjects), visiting a subject reveals new facts
  // (subjectToFacts). We verify that every subject is reachable from
  // every fact via this directed BFS. If not, we create bridge facts
  // to fix unreachable subjects. Iterate until fully reachable.
  // ensureDirectedReachability pushes bridges directly onto skeletons
  // and rebuilds the graph internally.
  ensureDirectedReachability(
    graph,
    skeletons,
    characters,
    computedKnowledge,
  );

  // Rebuild graph after bridges were added
  graph = buildFactGraph(skeletons, characters, computedKnowledge);

  // ── Step 6: Create red herring / incidental facts ────────────────
  const redHerringSkeletons = createRedHerringSkeletons(
    graph,
    characters,
    locations,
    skeletons,
  );
  skeletons.push(...redHerringSkeletons);

  // Rebuild graph with red herrings added
  graph = buildFactGraph(skeletons, characters, computedKnowledge);

  return { factSkeletons: skeletons, factGraph: graph };
}

// ════════════════════════════════════════════════════════════════════
// Step 1: Collect true fact skeletons from event reveals
// ════════════════════════════════════════════════════════════════════

/**
 * Extracts unique fact skeletons from all event reveals, remapping
 * role IDs in subjects to character IDs using the roleMapping.
 *
 * Deduplicates by factId — the same fact can appear in multiple events
 * (e.g. the same evidence discovered at two scenes). When a fact
 * appears in multiple events, subjects are merged.
 */
function collectEventRevealSkeletons(
  events: Record<string, EventDraft>,
  roleMapping: Record<string, string>,
): FactSkeleton[] {
  // Track seen skeletons by factId for deduplication and subject merging
  const seen = new Map<string, { skeleton: FactSkeleton; subjectSet: Set<string> }>();

  for (const event of Object.values(events)) {
    for (const reveal of event.reveals) {
      // Remap subjects: role IDs become character IDs, location IDs pass through
      const remappedSubjects = reveal.subjects.map(
        (subjectId) => roleMapping[subjectId] ?? subjectId,
      );

      const existing = seen.get(reveal.id);
      if (existing) {
        // Merge subjects from this occurrence
        for (const s of remappedSubjects) {
          existing.subjectSet.add(s);
        }
      } else {
        const subjectSet = new Set(remappedSubjects);
        seen.set(reveal.id, {
          skeleton: {
            factId: reveal.id,
            subjects: [], // filled below from the set
            veracity: 'true' as const,
            source: { type: 'event_reveal', eventId: event.eventId },
          },
          subjectSet,
        });
      }
    }
  }

  // Finalize subjects from sets
  const skeletons: FactSkeleton[] = [];
  for (const { skeleton, subjectSet } of seen.values()) {
    skeleton.subjects = [...subjectSet];
    skeletons.push(skeleton);
  }

  return skeletons;
}

// ════════════════════════════════════════════════════════════════════
// Step 2: Create false fact skeletons from denials
// ════════════════════════════════════════════════════════════════════

/**
 * For each character that 'denies' a true fact, creates a corresponding
 * false fact skeleton. The false fact shares the same subjects as the
 * denied fact. The character's knowledgeState should have 'believes' for
 * the false fact (this is set up by GenerateCharacters, but we create
 * the skeleton here).
 */
function createDenialSkeletons(
  characters: Record<string, CharacterDraft>,
  existingSkeletons: FactSkeleton[],
): FactSkeleton[] {
  const skeletonsByFactId = new Map<string, FactSkeleton>();
  for (const s of existingSkeletons) {
    skeletonsByFactId.set(s.factId, s);
  }

  const denialSkeletons: FactSkeleton[] = [];
  const seenDenials = new Set<string>(); // avoid duplicates if two characters deny the same fact

  for (const character of Object.values(characters)) {
    for (const [factId, status] of Object.entries(character.knowledgeState)) {
      if (status !== 'denies') continue;

      // Find the denied true fact's subjects
      const deniedFact = skeletonsByFactId.get(factId);
      if (!deniedFact) continue; // can't create a false counterpart without the original

      const falseFactId = `${factId}_false`;
      if (seenDenials.has(falseFactId)) continue;
      seenDenials.add(falseFactId);

      denialSkeletons.push({
        factId: falseFactId,
        subjects: [...deniedFact.subjects],
        veracity: 'false',
        source: {
          type: 'denial',
          characterId: character.characterId,
          deniedFactId: factId,
        },
      });
    }
  }

  return denialSkeletons;
}

// ════════════════════════════════════════════════════════════════════
// Step 3: Build the fact-subject bipartite graph
// ════════════════════════════════════════════════════════════════════

/**
 * Builds the bipartite graph connecting facts to subjects and subjects
 * to the facts they can reveal.
 *
 * - factToSubjects: each fact's subjects (from the skeleton)
 * - subjectToFacts: which facts each subject can reveal:
 *   - Characters: facts where knowledgeState is 'knows', 'suspects', or 'believes'
 *   - Locations: facts from computedKnowledge.locationReveals
 */
function buildFactGraph(
  skeletons: FactSkeleton[],
  characters: Record<string, CharacterDraft>,
  computedKnowledge: ComputedKnowledge,
): FactGraph {
  const factToSubjects: Record<string, string[]> = {};
  const subjectToFacts: Record<string, string[]> = {};

  // Initialize subjectToFacts for all characters and locations in computedKnowledge
  for (const charId of Object.keys(characters)) {
    if (!subjectToFacts[charId]) subjectToFacts[charId] = [];
  }
  for (const locId of Object.keys(computedKnowledge.locationReveals)) {
    if (!subjectToFacts[locId]) subjectToFacts[locId] = [];
  }

  // Fact -> subjects edges
  for (const skeleton of skeletons) {
    factToSubjects[skeleton.factId] = [...skeleton.subjects];
    // Ensure all subjects have an entry
    for (const subjectId of skeleton.subjects) {
      if (!subjectToFacts[subjectId]) subjectToFacts[subjectId] = [];
    }
  }

  // Character -> facts they can reveal (knows, suspects, believes)
  const revealableStatuses = new Set(['knows', 'suspects', 'believes']);
  for (const character of Object.values(characters)) {
    if (!subjectToFacts[character.characterId]) {
      subjectToFacts[character.characterId] = [];
    }
    for (const [factId, status] of Object.entries(character.knowledgeState)) {
      if (revealableStatuses.has(status)) {
        // Check that this fact exists in our skeletons — for 'believes'
        // entries, GenerateCharacters already uses the false fact's ID
        // (e.g. "fact_xxx_false").
        if (factToSubjects[factId] !== undefined) {
          if (!subjectToFacts[character.characterId].includes(factId)) {
            subjectToFacts[character.characterId].push(factId);
          }
        }
      }
    }
  }

  // Location -> facts discoverable as physical evidence
  for (const [locationId, factIds] of Object.entries(computedKnowledge.locationReveals)) {
    if (!subjectToFacts[locationId]) subjectToFacts[locationId] = [];
    for (const factId of factIds) {
      if (!subjectToFacts[locationId].includes(factId)) {
        subjectToFacts[locationId].push(factId);
      }
    }
  }

  return { factToSubjects, subjectToFacts };
}

// ════════════════════════════════════════════════════════════════════
// Steps 4 & 5: Directed reachability check + bridge creation
// ════════════════════════════════════════════════════════════════════

/**
 * Performs a directed BFS from a seed fact through the bipartite graph,
 * following the same directed flow the casebook uses:
 *
 *   know fact F → F is about subjects S (factToSubjects)
 *                → visit S → S reveals facts G (subjectToFacts)
 *                → know G → ...
 *
 * Returns the set of all subjects reachable from the seed fact.
 */
function directedBfsFromFact(
  seedFactId: string,
  graph: FactGraph,
): { reachableSubjects: Set<string>; reachableFacts: Set<string> } {
  const reachableFacts = new Set<string>([seedFactId]);
  const reachableSubjects = new Set<string>();

  // BFS queue contains fact IDs to process
  const queue: string[] = [seedFactId];

  while (queue.length > 0) {
    const factId = queue.shift()!;

    // Fact → subjects (factToSubjects): knowing this fact leads to these subjects
    for (const subjectId of graph.factToSubjects[factId] ?? []) {
      if (reachableSubjects.has(subjectId)) continue;
      reachableSubjects.add(subjectId);

      // Subject → facts (subjectToFacts): visiting this subject reveals these facts
      for (const revealedFactId of graph.subjectToFacts[subjectId] ?? []) {
        if (!reachableFacts.has(revealedFactId)) {
          reachableFacts.add(revealedFactId);
          queue.push(revealedFactId);
        }
      }
    }
  }

  return { reachableSubjects, reachableFacts };
}

/**
 * Ensures directed reachability: from every fact, a directed BFS must
 * reach every subject. This guarantees that no matter which facts
 * GenerateIntroduction later picks as seeds, all casebook entries will
 * be reachable via the unlock→reveal→unlock chain.
 *
 * When unreachable subjects are found, creates bridge fact skeletons
 * to fix them. A bridge connects a reachable character (who can reveal
 * the bridge fact) to an unreachable subject (who the bridge fact is
 * about), providing a directed path through the character's knowledge.
 *
 * Iterates until the graph is fully directed-reachable, since adding
 * bridges can change the reachability landscape.
 */
function ensureDirectedReachability(
  graph: FactGraph,
  skeletons: FactSkeleton[],
  characters: Record<string, CharacterDraft>,
  computedKnowledge: ComputedKnowledge,
): FactSkeleton[] {
  const allBridges: FactSkeleton[] = [];
  const allCharacterIds = Object.keys(characters);

  // Iterate: check reachability, create bridges, rebuild graph, repeat.
  // Each iteration fixes at least one unreachable subject, so this
  // converges in at most O(subjects) iterations.
  for (let iteration = 0; iteration < 100; iteration++) {
    // Find subjects unreachable from ANY fact. We check from every fact
    // because introduction facts haven't been chosen yet — we need the
    // property to hold regardless of which facts are selected.
    //
    // Optimization: if the graph is directed-reachable from one arbitrary
    // fact, it's reachable from all facts (because any fact reachable from
    // the seed can itself reach everything the seed can). So we only need
    // to check from one fact, UNLESS there are facts unreachable from the
    // seed — those live in disconnected components.
    //
    // Strategy: pick an arbitrary fact, do directed BFS, find unreachable
    // subjects. Also find facts not reached (disconnected components).
    // Bridge both.
    const allSubjects = new Set(Object.keys(graph.subjectToFacts));
    const seedFact = skeletons[0]?.factId;
    if (!seedFact) break;

    const { reachableSubjects, reachableFacts } = directedBfsFromFact(seedFact, graph);

    // Find unreachable subjects
    const unreachableSubjects: string[] = [];
    for (const subjectId of allSubjects) {
      if (!reachableSubjects.has(subjectId)) {
        unreachableSubjects.push(subjectId);
      }
    }

    // Also find facts in disconnected components (not reachable from seed)
    const unreachableFacts: string[] = [];
    for (const skeleton of skeletons) {
      if (!reachableFacts.has(skeleton.factId)) {
        unreachableFacts.push(skeleton.factId);
      }
    }

    if (unreachableSubjects.length === 0 && unreachableFacts.length === 0) {
      break; // Fully reachable — done
    }

    // Find characters in the reachable set to use as bridge sources.
    // These characters can reveal bridge facts, providing directed paths
    // to unreachable subjects.
    const reachableCharIds = allCharacterIds.filter(
      (cid) => reachableSubjects.has(cid),
    );

    if (reachableCharIds.length === 0) {
      // No reachable characters — can't create bridges. This shouldn't
      // happen in a well-formed case (at least one character should be
      // reachable from the first fact).
      break;
    }

    let charIdx = 0;
    const bridgedSubjects = new Set<string>();

    // Bridge unreachable subjects
    for (const targetSubject of unreachableSubjects) {
      if (bridgedSubjects.has(targetSubject)) continue;

      const bridgeCharId = reachableCharIds[charIdx % reachableCharIds.length];
      charIdx++;

      const bridgeId = `fact_bridge_${bridgeCharId}_to_${targetSubject}`;
      const bridge: FactSkeleton = {
        factId: bridgeId,
        subjects: [bridgeCharId, targetSubject],
        veracity: 'true',
        source: {
          type: 'bridge',
          fromCharacterId: bridgeCharId,
          toSubject: targetSubject,
        },
      };
      skeletons.push(bridge);
      allBridges.push(bridge);

      // Add to the character's knowledge so they reveal it
      characters[bridgeCharId].knowledgeState[bridgeId] = 'knows';
      bridgedSubjects.add(targetSubject);
    }

    // Bridge disconnected facts: for facts not reachable from the seed,
    // their subjects may also be unreachable. Create a bridge from a
    // reachable character to one of the fact's subjects.
    for (const factId of unreachableFacts) {
      const subjects = graph.factToSubjects[factId] ?? [];
      // If any subject was already bridged or is reachable, skip
      if (subjects.some((s) => reachableSubjects.has(s) || bridgedSubjects.has(s))) {
        continue;
      }
      // Bridge to the first subject of this fact
      const targetSubject = subjects[0];
      if (!targetSubject || bridgedSubjects.has(targetSubject)) continue;

      const bridgeCharId = reachableCharIds[charIdx % reachableCharIds.length];
      charIdx++;

      const bridgeId = `fact_bridge_${bridgeCharId}_to_${targetSubject}`;
      const bridge: FactSkeleton = {
        factId: bridgeId,
        subjects: [bridgeCharId, targetSubject],
        veracity: 'true',
        source: {
          type: 'bridge',
          fromCharacterId: bridgeCharId,
          toSubject: targetSubject,
        },
      };
      skeletons.push(bridge);
      allBridges.push(bridge);

      characters[bridgeCharId].knowledgeState[bridgeId] = 'knows';
      bridgedSubjects.add(targetSubject);
    }

    // Rebuild graph with new bridges and re-check
    graph = buildFactGraph(skeletons, characters, computedKnowledge);
  }

  return allBridges;
}

// ════════════════════════════════════════════════════════════════════
// Step 6: Create red herring / incidental facts
// ════════════════════════════════════════════════════════════════════

/**
 * Adds a few red herring fact skeletons in sparse areas of the graph.
 * Red herrings add noise for the player — they're discoverable facts
 * that lead nowhere (no onward subjects) or fill gaps.
 *
 * Strategy:
 * - Find characters with few outgoing facts (sparse nodes)
 * - Add 1-2 red herring facts about them that reference unrelated
 *   locations or characters, adding noise without breaking connectivity
 *
 * Target: ~2-3 red herrings for a medium case.
 */
function createRedHerringSkeletons(
  graph: FactGraph,
  characters: Record<string, CharacterDraft>,
  locations: Record<string, LocationDraft>,
  existingSkeletons: FactSkeleton[],
): FactSkeleton[] {
  const redHerrings: FactSkeleton[] = [];

  // Count how many facts each character reveals
  const characterFactCounts = new Map<string, number>();
  for (const charId of Object.keys(characters)) {
    const facts = graph.subjectToFacts[charId] ?? [];
    characterFactCounts.set(charId, facts.length);
  }

  // Sort characters by fact count (ascending) to find sparse ones
  const sortedChars = [...characterFactCounts.entries()].sort(
    (a, b) => a[1] - b[1],
  );

  // Collect all location IDs for pairing
  const locationIds = Object.keys(locations);

  // We want ~2-3 red herrings total
  const targetCount = Math.min(3, Math.max(1, Math.floor(existingSkeletons.length / 5)));
  let created = 0;

  for (const [charId] of sortedChars) {
    if (created >= targetCount) break;

    // Pick a location this character isn't strongly associated with
    // (i.e., a location that doesn't already share many facts with them)
    const charFacts = new Set(graph.subjectToFacts[charId] ?? []);
    let bestLocation: string | undefined;
    let bestOverlap = Infinity;

    for (const locId of locationIds) {
      const locFacts = new Set(graph.subjectToFacts[locId] ?? []);
      let overlap = 0;
      for (const f of charFacts) {
        if (locFacts.has(f)) overlap++;
      }
      if (overlap < bestOverlap) {
        bestOverlap = overlap;
        bestLocation = locId;
      }
    }

    const subjects = bestLocation ? [charId, bestLocation] : [charId];
    const herringId = `fact_red_herring_${charId}_${created}`;

    redHerrings.push({
      factId: herringId,
      subjects,
      veracity: 'true',
      source: { type: 'red_herring' },
    });

    // Assign to the character's knowledge so it's discoverable
    characters[charId].knowledgeState[herringId] = 'knows';
    created++;
  }

  return redHerrings;
}
