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
 * The player selects from discovered facts in the answer category.
 */

import type { Difficulty } from './common';
import type { FactCategory } from './fact';

export interface Question {
  /** Unique identifier, e.g. "q_01_who" */
  questionId: string;

  /** The question text, e.g. "Who murdered Mr. Pemberton?" */
  text: string;

  /** factIds that are acceptable correct answers (player must select one) */
  answerFactIds: string[];

  /** Category the player selects from (must match the fact's category) */
  answerCategory: FactCategory;

  /** How many points this question is worth */
  points: number;

  /** How hard this question is to answer */
  difficulty: Difficulty;
}
