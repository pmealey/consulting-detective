/**
 * Question -- an end-of-case quiz question.
 *
 * The Consulting Detective scoring mechanic: after investigating, the player
 * answers a series of questions. Each question requires connecting facts
 * discovered across multiple casebook entries. The questions drive the
 * narrative conclusions (e.g. "who did it?", "what was the motive?") --
 * these conclusions are emergent from the evidence, not baked into the
 * character or event models.
 *
 * Questions are ordered (presented sequentially) and carry point values.
 * The answer type determines what the player selects from:
 * - 'person': player picks from discovered character subjects
 * - 'location': player picks from discovered location subjects
 * - 'fact': player picks from discovered facts filtered by factCategory
 */

import type { Difficulty } from './common';
import type { FactCategory } from './fact';

export interface Question {
  /** Unique identifier, e.g. "q_01_who" */
  questionId: string;

  /** The question text, e.g. "Who murdered Mr. Pemberton?" */
  text: string;

  /** Structured answer definition */
  answer: QuestionAnswer;

  /** How many points this question is worth */
  points: number;

  /** How hard this question is to answer */
  difficulty: Difficulty;
}

export interface QuestionAnswer {
  /** What the player selects from */
  type: 'person' | 'location' | 'fact';

  /** Required when type is 'fact' -- which fact category to filter by */
  factCategory?: FactCategory;

  /**
   * Acceptable correct answer IDs.
   * - For 'fact': factIds
   * - For 'person': characterIds
   * - For 'location': locationIds
   */
  acceptedIds: string[];
}
