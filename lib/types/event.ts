/**
 * CausalEvent -- a single event in the case's causal chain.
 *
 * Inverts the moonstone-packet's EVENTS + CAUSAL_EDGES (build_causal_chain_graph.py)
 * into a generation-oriented structure. Events form a DAG: the "spine" of what
 * actually happened in the case, ordered by timestamp.
 *
 * During generation, events are created first as the backbone of the narrative.
 * Characters, locations, and facts are then populated around them.
 *
 * Each event tracks character involvement -- who performed it, who was present,
 * who witnessed it visually or auditorily. This is the authoritative record of
 * each character's connection to each event. Character positions can be derived
 * from involvement: if a character isn't involved in an event, their location
 * at that time is narratively irrelevant.
 */

export interface CausalEvent {
  /** Unique identifier, e.g. "E01_argument_at_pub" */
  eventId: string;

  /** Human-readable description of what happened */
  description: string;

  /**
   * Ordering index within the case timeline.
   * Events can be sorted by this to reconstruct chronological order.
   * Does not need to be contiguous -- gaps are fine.
   */
  timestamp: number;

  /**
   * Convenience field: characterId of who performed/caused this event.
   * This character will also appear in `involvement` with type 'agent'.
   */
  agent: string;

  /** locationId where this event took place */
  location: string;

  /**
   * How each character is connected to this event.
   * Keyed by characterId. Characters not listed have no connection.
   * The agent will appear here with type 'agent'.
   *
   * During generation, involvement is determined by:
   * - 'agent': the character who performed the event
   * - 'present': directly involved or present and observed the event
   * - 'witness_visual': saw the event from another location (visibleFrom)
   * - 'witness_auditory': heard the event from another location (audibleFrom)
   * - 'discovered_evidence': found physical evidence of the event later
   */
  involvement: Record<string, InvolvementType>;

  /** Whether this event is required for the plot to hold, or is contingent/optional */
  necessity: EventNecessity;

  /** eventIds that this event directly caused or enabled */
  causes: string[];

  /**
   * What this event reveals to witnesses. Each reveal describes a fact
   * placeholder with perception channels (audible, visible, physical)
   * that determine how different involvement types can learn it.
   */
  reveals: EventReveal[];
}

/**
 * A single fact revealed by an event, with perception channels.
 *
 * The perception flags determine which involvement types can learn this fact:
 * - agent/present always learn all reveals
 * - witness_visual learns reveals where visible is true
 * - witness_auditory learns reveals where audible is true
 * - discovered_evidence learns reveals where physical is true
 */
export interface EventReveal {
  /** factId placeholder, e.g. "fact_suspect_left_handed" */
  id: string;

  /** Learnable by hearing (auditory witnesses can learn this) */
  audible: boolean;

  /** Learnable by seeing (visual witnesses can learn this) */
  visible: boolean;

  /** Leaves physical evidence discoverable later */
  physical: boolean;

  /** roleId/locationId placeholders this fact is about */
  subjects: string[];
}

export type InvolvementType =
  | 'agent'
  | 'present'
  | 'witness_visual'
  | 'witness_auditory'
  | 'discovered_evidence';

/**
 * Whether this event is required for the plot spine or optional.
 * 'required' marks narrative-essential events; undefined means the event
 * adds texture but can be omitted without breaking the plot.
 */
export type EventNecessity = 'required' | undefined;
