/**
 * Player session types -- client-side game state.
 *
 * These are NOT stored in DDB with the case. They represent the player's
 * local state as they play through a case: which entries they've visited,
 * what facts they've discovered, and their quiz answers.
 */

export interface PlayerSession {
  /** The caseDate being played, e.g. "2026-02-07" */
  caseDate: string;

  /** Casebook entryIds in the order the player visited them */
  visitedEntries: string[];

  /** factIds the player has revealed through their visits */
  discoveredFacts: string[];

  /** The player's submitted quiz answers */
  answers: PlayerAnswer[];

  /** ISO timestamp when the player started the case */
  startedAt: string;

  /** ISO timestamp when the player completed the case (submitted answers) */
  completedAt?: string;
}

export interface PlayerAnswer {
  /** Which question this answers */
  questionId: string;

  /** The factId the player selected as their answer */
  answerFactId: string;
}

export interface CaseResult {
  /** How many questions the player got right */
  questionsCorrect: number;

  /** Total number of questions */
  questionsTotal: number;

  /** How many casebook entries the player visited */
  entriesVisited: number;

  /** How many entries Holmes needed (optimal path length) */
  optimalEntries: number;

  /** Final score */
  score: number;
}
