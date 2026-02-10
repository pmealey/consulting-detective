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
 * 4. Find connected components in the graph. Rather than seeding from
 *    specific introduction facts (which aren't chosen yet), we ensure
 *    the entire graph is fully connected.
 *
 * 5. Create bridge fact skeletons connecting smaller components to
 *    the largest, so the graph is one connected component.
 *
 * 6. Create red herring / incidental fact skeletons in sparse areas.
 *
 * Introduction fact selection is NOT done here — it moves to
 * GenerateIntroduction where the AI can select facts that form a
 * coherent opening narrative. Because this step guarantees full graph
 * connectivity, any introduction fact selection will be able to reach
 * all subjects and facts through BFS.
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

  await updateDraft(draftId, { factSkeletons, factGraph });
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
  // ── Step 1: Collect true fact skeletons from event reveals ───────
  const skeletons = collectEventRevealSkeletons(events, roleMapping);

  // ── Step 2: Create false fact skeletons from denials ─────────────
  const denialSkeletons = createDenialSkeletons(characters, skeletons);
  skeletons.push(...denialSkeletons);

  // ── Step 3: Build the bipartite graph ────────────────────────────
  let graph = buildFactGraph(skeletons, characters, computedKnowledge);

  // ── Step 4: Detect disconnected components ───────────────────────
  // We check full graph connectivity rather than seeding from specific
  // facts. This ensures the graph is fully connected regardless of which
  // facts GenerateIntroduction later selects as introduction facts.
  // Any introduction fact selection from a connected graph will be able
  // to reach all subjects and facts through BFS.
  const { components, largestComponent } = findConnectedComponents(
    graph,
    skeletons,
  );

  // ── Step 5: Create bridge facts for connectivity ─────────────────
  // Bridge every smaller component to the largest component so the
  // entire graph is connected. GenerateIntroduction can then pick any
  // facts as seeds and the full graph will be reachable.
  const bridgeSkeletons = createBridgeSkeletons(
    components,
    largestComponent,
    graph,
    characters,
    skeletons,
  );
  skeletons.push(...bridgeSkeletons);

  // ── Step 6: Create red herring / incidental facts ────────────────
  const redHerringSkeletons = createRedHerringSkeletons(
    graph,
    characters,
    locations,
    skeletons,
  );
  skeletons.push(...redHerringSkeletons);

  // Rebuild graph with all skeletons (bridges + red herrings added)
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
// Step 4: Find connected components
// ════════════════════════════════════════════════════════════════════

/**
 * A connected component in the bipartite graph: a set of subjects and
 * facts that are mutually reachable through fact-subject edges.
 */
interface GraphComponent {
  subjects: Set<string>;
  facts: Set<string>;
}

/**
 * Finds all connected components in the bipartite graph using BFS.
 *
 * Rather than seeding from specific "introduction" facts (which aren't
 * chosen yet), we find ALL connected components. The bridge step then
 * connects every smaller component to the largest one, ensuring the
 * entire graph is connected. This means GenerateIntroduction can later
 * pick any facts as seeds and the full graph will be reachable.
 */
function findConnectedComponents(
  graph: FactGraph,
  skeletons: FactSkeleton[],
): { components: GraphComponent[]; largestComponent: GraphComponent } {
  const allSubjects = new Set(Object.keys(graph.subjectToFacts));
  const allFacts = new Set(skeletons.map((s) => s.factId));

  // Build a reverse index: subject -> facts that reference it (via factToSubjects).
  // This is the inverse of factToSubjects — "which facts mention this subject?"
  // We need this because a subject might be referenced by a fact it doesn't
  // reveal (e.g. a fact about a location that the location has no physical
  // evidence for). Those facts still connect the subject to the component.
  const subjectToReferencingFacts: Record<string, string[]> = {};
  for (const [factId, subjects] of Object.entries(graph.factToSubjects)) {
    for (const subjectId of subjects) {
      if (!subjectToReferencingFacts[subjectId]) {
        subjectToReferencingFacts[subjectId] = [];
      }
      subjectToReferencingFacts[subjectId].push(factId);
    }
  }

  const visitedSubjects = new Set<string>();
  const visitedFacts = new Set<string>();
  const components: GraphComponent[] = [];

  // BFS from each unvisited subject to discover its component
  for (const startSubject of allSubjects) {
    if (visitedSubjects.has(startSubject)) continue;

    const component: GraphComponent = {
      subjects: new Set<string>(),
      facts: new Set<string>(),
    };
    const queue: string[] = [startSubject];
    visitedSubjects.add(startSubject);
    component.subjects.add(startSubject);

    while (queue.length > 0) {
      const subjectId = queue.shift()!;

      // Collect all facts connected to this subject:
      // 1. Facts this subject reveals (subjectToFacts)
      // 2. Facts that reference this subject (subjectToReferencingFacts)
      const connectedFacts = new Set<string>();
      for (const fid of graph.subjectToFacts[subjectId] ?? []) {
        connectedFacts.add(fid);
      }
      for (const fid of subjectToReferencingFacts[subjectId] ?? []) {
        connectedFacts.add(fid);
      }

      for (const factId of connectedFacts) {
        if (visitedFacts.has(factId)) continue;
        visitedFacts.add(factId);
        component.facts.add(factId);

        // Follow fact -> subjects edges
        const subjects = graph.factToSubjects[factId] ?? [];
        for (const nextSubjectId of subjects) {
          if (visitedSubjects.has(nextSubjectId)) continue;
          if (
            graph.subjectToFacts[nextSubjectId] !== undefined ||
            subjectToReferencingFacts[nextSubjectId] !== undefined
          ) {
            visitedSubjects.add(nextSubjectId);
            component.subjects.add(nextSubjectId);
            queue.push(nextSubjectId);
          }
        }
      }
    }

    components.push(component);
  }

  // Also pick up any orphan facts (facts with no subjects in the graph)
  for (const factId of allFacts) {
    if (!visitedFacts.has(factId)) {
      components.push({
        subjects: new Set<string>(),
        facts: new Set([factId]),
      });
    }
  }

  // Find the largest component by total node count (subjects + facts)
  let largest = components[0];
  let largestSize = 0;
  for (const comp of components) {
    const size = comp.subjects.size + comp.facts.size;
    if (size > largestSize) {
      largestSize = size;
      largest = comp;
    }
  }

  return { components, largestComponent: largest };
}

// ════════════════════════════════════════════════════════════════════
// Step 5: Create bridge facts for connectivity
// ════════════════════════════════════════════════════════════════════

/**
 * For each component that isn't the largest, creates a bridge fact
 * skeleton connecting a character in the largest component to a
 * subject in the smaller component.
 *
 * This ensures the entire graph is one connected component, so that
 * GenerateIntroduction can later pick any facts as seeds and the full
 * graph will be reachable via BFS.
 *
 * Strategy: round-robin through characters in the largest component,
 * picking one subject from each smaller component to bridge to.
 */
function createBridgeSkeletons(
  components: GraphComponent[],
  largestComponent: GraphComponent,
  graph: FactGraph,
  characters: Record<string, CharacterDraft>,
  _existingSkeletons: FactSkeleton[],
): FactSkeleton[] {
  // If there's only one component, the graph is already connected
  if (components.length <= 1) return [];

  const bridgeSkeletons: FactSkeleton[] = [];

  // Find characters in the largest component
  const largestCharacterIds: string[] = [];
  for (const subjectId of largestComponent.subjects) {
    if (characters[subjectId] !== undefined) {
      largestCharacterIds.push(subjectId);
    }
  }

  if (largestCharacterIds.length === 0) {
    // No characters in the largest component — can't bridge via character
    // knowledge. This shouldn't happen in a well-formed case.
    return [];
  }

  let charIdx = 0;
  for (const component of components) {
    // Skip the largest component — it's the one we're bridging TO
    if (component === largestComponent) continue;

    // Pick a subject from this smaller component to bridge to.
    // Prefer a character subject if one exists (more natural for narrative),
    // otherwise pick any subject.
    let targetSubject: string | undefined;
    for (const subjectId of component.subjects) {
      if (characters[subjectId] !== undefined) {
        targetSubject = subjectId;
        break;
      }
    }
    if (!targetSubject) {
      // No character in this component — pick any subject
      targetSubject = [...component.subjects][0];
    }
    if (!targetSubject) continue; // empty component (orphan facts only)

    const bridgeCharId = largestCharacterIds[charIdx % largestCharacterIds.length];
    charIdx++;

    const bridgeId = `fact_bridge_${bridgeCharId}_to_${targetSubject}`;
    bridgeSkeletons.push({
      factId: bridgeId,
      subjects: [bridgeCharId, targetSubject],
      veracity: 'true',
      source: {
        type: 'bridge',
        fromCharacterId: bridgeCharId,
        toSubject: targetSubject,
      },
    });

    // Add to the character's knowledge so the graph connects
    characters[bridgeCharId].knowledgeState[bridgeId] = 'knows';
  }

  return bridgeSkeletons;
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
