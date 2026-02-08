/**
 * Case -- the top-level container for a complete generated case.
 *
 * This is what gets stored in DynamoDB and served to the player.
 * It contains the full narrative structure: the causal event chain,
 * characters, world locations, the player-facing casebook, discoverable
 * facts, and the end-of-case quiz.
 *
 * The Case type is the "assembled product" of the generation pipeline:
 * 1. Generate the causal event spine
 * 2. Populate characters around the events
 * 3. Build the world location graph
 * 4. Distribute facts across casebook entries
 * 5. Generate prose scenes for each entry
 * 6. Create quiz questions that require connecting facts
 * 7. Compute the optimal path
 * 8. Validate coherence
 */

import type { CausalEvent } from './event';
import type { Character } from './character';
import type { Location } from './location';
import type { CasebookEntry } from './casebook';
import type { Fact } from './fact';
import type { Question } from './question';
import type { CaseSetting, Difficulty } from './common';

export interface Case {
  /** The daily key, e.g. "2026-02-07" -- partition key in DDB */
  caseDate: string;

  /** Display title, e.g. "The Affair of the Missing Ledger" */
  title: string;

  /** Era, in-world date, and atmosphere */
  setting: CaseSetting;

  /** The opening scene the player reads before investigating */
  introduction: string;

  /** The causal event chain -- what actually happened. Keyed by eventId. */
  events: Record<string, CausalEvent>;

  /** The cast of characters. Keyed by characterId. */
  characters: Record<string, Character>;

  /** The spatial world model. Keyed by locationId. */
  locations: Record<string, Location>;

  /** The player's visitable address book. Keyed by entryId. */
  casebook: Record<string, CasebookEntry>;

  /** Discoverable facts -- the atoms of the mystery. Keyed by factId. */
  facts: Record<string, Fact>;

  /** End-of-case quiz questions. Ordered -- presented sequentially. */
  questions: Question[];

  /** Casebook entryIds in order -- the optimal investigation path (Holmes's solution) */
  optimalPath: string[];

  /** Overall case difficulty */
  difficulty: Difficulty;
}
