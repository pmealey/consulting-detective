/**
 * Common types shared across the data model.
 */

export interface CaseSetting {
  /** The time and place, e.g. "Victorian London", "1920s New York" */
  era: string;

  /** The in-world date of the case */
  date: string;

  /** Atmospheric description, e.g. "Fog-choked evening", "Bright summer morning" */
  atmosphere: string;
}

export type Difficulty = 'easy' | 'medium' | 'hard';
