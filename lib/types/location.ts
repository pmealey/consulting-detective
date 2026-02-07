/**
 * Location -- a place in the case's world.
 *
 * Inverts the moonstone-packet's build_location_graph.py: a spatial model with
 * containment hierarchy and perception edges. Locations constrain what characters
 * could perceive -- who could see, hear, or access what.
 *
 * Players don't interact with locations directly; they interact with CasebookEntries.
 * Locations are the generation scaffolding that ensures the narrative is physically
 * coherent: "the witness in the alley could hear the argument but not see the
 * participants."
 */

export interface Location {
  /** Unique identifier, e.g. "loc_pemberton_study" */
  locationId: string;

  /** Display name, e.g. "The Pemberton Study", "Haymarket Alley" */
  name: string;

  /** What kind of place this is */
  type: LocationType;

  /** Atmospheric/physical description */
  description: string;

  /**
   * Parent locationId for containment hierarchy.
   * e.g. a room's parent is the building it's in.
   */
  parent?: string;

  /** locationIds of places adjacent to this one */
  adjacentTo: string[];

  /** locationIds from which events at this location can be seen */
  visibleFrom: string[];

  /** locationIds from which events at this location can be heard */
  audibleFrom: string[];
}

export type LocationType = 'building' | 'room' | 'outdoor' | 'street' | 'district';
