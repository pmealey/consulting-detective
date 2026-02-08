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
 * Each event tracks character involvement -- who performed it, who participated,
 * who witnessed it visually or auditorily, who found out later. This is the
 * authoritative record of each character's connection to each event. Character
 * positions can be derived from involvement: if a character isn't involved in
 * an event, their location at that time is narratively irrelevant.
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
   * - 'participant': directly involved but not the primary actor
   * - 'witness_direct': was present and observed the event (generic)
   * - 'witness_visual': was at a location in the event location's visibleFrom list
   * - 'witness_auditory': was at a location in the event location's audibleFrom list
   * - 'informed_after': learned about the event secondhand, after the fact
   * - 'discovered_evidence': found physical evidence of the event later
   */
  involvement: Record<string, InvolvementType>;

  /** Whether this event is required for the plot to hold, or is contingent/optional */
  necessity: EventNecessity;

  /** eventIds that this event directly caused or enabled */
  causes: string[];

  /** factIds that this event would reveal to a witness */
  reveals: string[];
}

export type InvolvementType =
  | 'agent'
  | 'participant'
  | 'witness_direct'
  | 'witness_visual'
  | 'witness_auditory'
  | 'informed_after'
  | 'discovered_evidence';

/**
 * Whether this event is required for the plot spine or optional.
 * 'required' marks narrative-essential events; undefined means the event
 * adds texture but can be omitted without breaking the plot.
 */
export type EventNecessity = 'required' | undefined;
