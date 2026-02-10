import { getDraft, updateDraft } from '../shared/draft-db';
import type {
  ComputedKnowledge,
  EventDraft,
  OperationalState,
} from '../shared/generation-state';

/**
 * Pipeline Step 2b: Compute Event Knowledge
 *
 * Pure programmatic step — no LLM call. Runs after ValidateEvents,
 * before GenerateCharacters. Operates on role IDs (characters don't
 * exist yet at this pipeline stage).
 *
 * Derives two things from the event chain:
 *
 * 1. **roleKnowledge** — baseline knowledge per role. Cross-references
 *    each event's `reveals` with its `involvement` to determine which
 *    roles would learn which facts based on perception channels:
 *    - agent/present: learn ALL reveals
 *    - witness_visual: learn reveals where `visible` is true
 *    - witness_auditory: learn reveals where `audible` is true
 *    - discovered_evidence: learn reveals where `physical` is true
 *
 * 2. **locationReveals** — fact IDs discoverable as physical
 *    evidence at each location. Collected from reveals with `physical: true`,
 *    with cleanup detection: if a later event at the same location has the
 *    same fact ID with `physical: false`, the evidence was cleaned up and
 *    the location does NOT reveal it.
 *
 * GenerateCharacters receives roleKnowledge as a pre-populated baseline
 * that the AI can then modify (downgrade to 'suspects', 'hides', 'denies',
 * or add 'believes' entries for false beliefs).
 */
export const handler = async (state: OperationalState): Promise<OperationalState> => {
  const { draftId, input } = state;
  const draft = await getDraft(draftId);
  const events = draft?.events;

  if (!events || Object.keys(events).length === 0) {
    throw new Error('ComputeEventKnowledge requires events from GenerateEvents');
  }

  const computedKnowledge = computeEventKnowledge(events);
  await updateDraft(draftId, { computedKnowledge });
  return state;
};

/**
 * Core algorithm, exported for testability.
 */
export function computeEventKnowledge(
  events: Record<string, EventDraft>,
): ComputedKnowledge {
  const roleKnowledge: Record<string, Record<string, 'knows'>> = {};
  const locationReveals: Record<string, string[]> = {};

  // Sort events chronologically for cleanup detection
  const sortedEvents = Object.values(events).sort(
    (a, b) => a.timestamp - b.timestamp,
  );

  // ── Step 1 & 2: Build roleKnowledge ──────────────────────────────
  //
  // For each event, determine which roles learn which facts based on
  // their involvement type and the perception channels of each reveal.

  for (const event of sortedEvents) {
    for (const [roleId, involvementType] of Object.entries(event.involvement)) {
      for (const reveal of event.reveals) {
        if (canLearn(involvementType, reveal)) {
          if (!roleKnowledge[roleId]) {
            roleKnowledge[roleId] = {};
          }
          roleKnowledge[roleId][reveal.id] = 'knows';
        }
      }
    }
  }

  // ── Step 3 & 4: Build locationReveals ────────────────────────────
  //
  // Group events by location, scan in timeline order. A reveal with
  // physical: true deposits evidence; a later reveal at the same
  // location with the same fact ID and physical: false cleans it up.

  const eventsByLocation = groupEventsByLocation(sortedEvents);

  for (const [locationId, locationEvents] of Object.entries(eventsByLocation)) {
    // Track physical evidence state per fact at this location.
    // true = evidence present, false = cleaned up.
    const physicalState = new Map<string, boolean>();

    for (const event of locationEvents) {
      for (const reveal of event.reveals) {
        if (reveal.physical) {
          // Evidence deposited (or re-deposited)
          physicalState.set(reveal.id, true);
        } else if (physicalState.has(reveal.id)) {
          // Same fact appears again at this location without physical flag —
          // the evidence was cleaned up / removed
          physicalState.set(reveal.id, false);
        }
      }
    }

    // Collect facts that still have physical evidence at this location
    const revealedFacts: string[] = [];
    for (const [factId, isPresent] of physicalState) {
      if (isPresent) {
        revealedFacts.push(factId);
      }
    }

    if (revealedFacts.length > 0) {
      locationReveals[locationId] = revealedFacts;
    }
  }

  return { roleKnowledge, locationReveals };
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Determines whether a role with the given involvement type can learn
 * a specific reveal based on its perception channels.
 */
function canLearn(
  involvementType: string,
  reveal: { audible: boolean; visible: boolean; physical: boolean },
): boolean {
  switch (involvementType) {
    case 'agent':
    case 'present':
      // Agents and present characters learn everything
      return true;
    case 'witness_visual':
      return reveal.visible;
    case 'witness_auditory':
      return reveal.audible;
    case 'discovered_evidence':
      return reveal.physical;
    default:
      return false;
  }
}

/**
 * Groups events by their location, preserving chronological order
 * (assumes input is already sorted by timestamp).
 */
function groupEventsByLocation(
  sortedEvents: EventDraft[],
): Record<string, EventDraft[]> {
  const groups: Record<string, EventDraft[]> = {};
  for (const event of sortedEvents) {
    if (!groups[event.location]) {
      groups[event.location] = [];
    }
    groups[event.location].push(event);
  }
  return groups;
}
