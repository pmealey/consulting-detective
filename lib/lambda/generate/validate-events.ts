import { getDraft } from '../shared/draft-db';
import type {
  OperationalState,
  ValidationResult,
  EventDraft,
  EventRevealDraft,
} from '../shared/generation-state';

/** Allowed involvement types; 'present' replaces legacy participant/witness_direct. */
const VALID_INVOLVEMENT_TYPES = new Set<string>([
  'agent',
  'present',
  'witness_visual',
  'witness_auditory',
  'discovered_evidence',
]);

/**
 * Pipeline Step 2b: Validate Events (after GenerateEvents)
 *
 * Pure logic — no LLM call. Validates event self-consistency only:
 * - Every event.causes references an existing eventId
 * - Every event's involvement map includes the agent with type "agent"
 * - Every involvement type value is allowed (agent, present, witness_visual, witness_auditory, discovered_evidence)
 * - Every event has enriched reveals (id, audible, visible, physical, subjects)
 * - The causal graph (eventId -> causes) is acyclic
 *
 * Does not validate agent/location against characters/locations (those are
 * still role/location placeholders at this stage).
 */
export const handler = async (state: OperationalState): Promise<OperationalState> => {
  const { draftId } = state;
  const draft = await getDraft(draftId);
  const events = draft?.events;

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!events || Object.keys(events).length === 0) {
    errors.push('No events in state');
    return { ...state, validationResult: { valid: false, errors, warnings } };
  }

  const eventIds = new Set(Object.keys(events));

  for (const event of Object.values(events)) {
    for (const causedId of event.causes) {
      if (!eventIds.has(causedId)) {
        errors.push(
          `Event ${event.eventId}: causes references unknown event "${causedId}"`,
        );
      }
    }
    if (event.agent === undefined || event.agent === '') {
      errors.push(`Event ${event.eventId}: agent is missing`);
    } else if (event.involvement[event.agent] !== 'agent') {
      errors.push(
        `Event ${event.eventId}: agent "${event.agent}" must be listed in involvement with type "agent"`,
      );
    }
    for (const [roleId, invType] of Object.entries(event.involvement)) {
      if (!VALID_INVOLVEMENT_TYPES.has(invType)) {
        errors.push(
          `Event ${event.eventId}: involvement type "${invType}" for "${roleId}" is invalid; must be one of: ${[...VALID_INVOLVEMENT_TYPES].join(', ')}`,
        );
      }
    }
    if (!event.reveals || event.reveals.length === 0) {
      errors.push(`Event ${event.eventId}: reveals must be a non-empty array`);
    } else {
      for (let i = 0; i < event.reveals.length; i++) {
        const errs = validateEventReveal(event.eventId, event.reveals[i], i);
        errors.push(...errs);
      }
    }
  }

  if (errors.length > 0) {
    return { ...state, validationResult: { valid: false, errors, warnings } };
  }

  const dagValid = isCausalDagAcyclic(events, eventIds);
  if (!dagValid.acyclic) {
    errors.push(...dagValid.cycleErrors);
    return { ...state, validationResult: { valid: false, errors, warnings } };
  }

  return { ...state, validationResult: { valid: true, errors: [], warnings } };
};

/**
 * Validates a single event reveal (enriched structure: id, audible, visible, physical, subjects).
 */
function validateEventReveal(
  eventId: string,
  reveal: EventRevealDraft,
  index: number,
): string[] {
  const errs: string[] = [];
  const prefix = `Event ${eventId}: reveals[${index}]`;
  if (typeof reveal.id !== 'string' || reveal.id.trim() === '') {
    errs.push(`${prefix}: id is required and must be non-empty`);
  }
  if (typeof reveal.audible !== 'boolean') {
    errs.push(`${prefix}: audible must be a boolean`);
  }
  if (typeof reveal.visible !== 'boolean') {
    errs.push(`${prefix}: visible must be a boolean`);
  }
  if (typeof reveal.physical !== 'boolean') {
    errs.push(`${prefix}: physical must be a boolean`);
  }
  if (!Array.isArray(reveal.subjects) || reveal.subjects.length === 0) {
    errs.push(`${prefix}: subjects must be a non-empty array of strings`);
  } else {
    for (let i = 0; i < reveal.subjects.length; i++) {
      if (typeof reveal.subjects[i] !== 'string' || reveal.subjects[i].trim() === '') {
        errs.push(`${prefix}: subjects[${i}] must be a non-empty string`);
      }
    }
  }
  return errs;
}

/**
 * Builds the causal graph (from eventId -> caused eventIds) and checks acyclicity
 * using Kahn's algorithm (topological sort). Returns errors describing any cycle.
 */
function isCausalDagAcyclic(
  events: Record<string, EventDraft>,
  eventIds: Set<string>,
): { acyclic: boolean; cycleErrors: string[] } {
  const outEdges = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const id of eventIds) {
    inDegree.set(id, 0);
    outEdges.set(id, []);
  }

  for (const event of Object.values(events)) {
    const from = event.eventId;
    for (const to of event.causes) {
      if (!eventIds.has(to)) continue;
      outEdges.get(from)!.push(to);
      inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, d] of inDegree) {
    if (d === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const n = queue.shift()!;
    order.push(n);
    for (const m of outEdges.get(n) ?? []) {
      const newDeg = (inDegree.get(m) ?? 0) - 1;
      inDegree.set(m, newDeg);
      if (newDeg === 0) queue.push(m);
    }
  }

  if (order.length === eventIds.size) {
    return { acyclic: true, cycleErrors: [] };
  }

  const inCycle = new Set(eventIds);
  for (const id of order) inCycle.delete(id);
  const cycleErrors = [
    `Causal graph has a cycle involving: ${[...inCycle].join(', ')}`,
  ];
  return { acyclic: false, cycleErrors };
}
