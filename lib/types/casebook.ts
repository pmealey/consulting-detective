/**
 * CasebookEntry -- a visitable address in the player's casebook.
 *
 * This is the core game mechanic. In Consulting Detective, the player picks
 * addresses to visit from a casebook. Each entry has a prose scene to read
 * and reveals certain facts.
 *
 * A casebook entry might be:
 * - A location ("Visit the crime scene")
 * - A person ("Consult Inspector Lestrade at Scotland Yard")
 * - A document ("Examine the victim's correspondence")
 * - An event ("Attend the inquest")
 *
 * A single Location can have multiple casebook entries (e.g. visiting the pub
 * in the morning vs. evening), and an entry's primary focus can be a person
 * rather than the place itself.
 */

export interface CasebookEntry {
  /** Unique identifier, e.g. "entry_lestrade" */
  entryId: string;

  /** Display label, e.g. "The Pemberton Residence", "Inspector Lestrade" */
  label: string;

  /** Display address for the casebook list, e.g. "14 Montague St." */
  address: string;

  /** locationId where this entry takes place */
  locationId: string;

  /** What kind of casebook entry this is */
  type: EntryType;

  /** The prose fragment the player reads when visiting this entry */
  scene: string;

  /** characterIds of characters present/available at this entry */
  characters: string[];

  /** factIds discoverable by visiting this entry */
  revealsFactIds: string[];
}

export type EntryType = 'location' | 'person' | 'document' | 'event';
