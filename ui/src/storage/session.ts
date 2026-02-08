import type { PlayerSession, CaseResult } from '@shared/index';
import type { Case } from '@shared/index';

const SESSION_PREFIX = 'cd-session-';

/** Get a player session for a specific case date. */
export function getSession(caseDate: string): PlayerSession | null {
  try {
    const raw = localStorage.getItem(`${SESSION_PREFIX}${caseDate}`);
    return raw ? (JSON.parse(raw) as PlayerSession) : null;
  } catch {
    return null;
  }
}

/** Save a player session to localStorage. */
export function saveSession(session: PlayerSession): void {
  localStorage.setItem(
    `${SESSION_PREFIX}${session.caseDate}`,
    JSON.stringify(session),
  );
}

/** Get all saved sessions, keyed by caseDate. */
export function getAllSessions(): Record<string, PlayerSession> {
  const sessions: Record<string, PlayerSession> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(SESSION_PREFIX)) {
      try {
        const session = JSON.parse(localStorage.getItem(key)!) as PlayerSession;
        sessions[session.caseDate] = session;
      } catch {
        // skip corrupt entries
      }
    }
  }
  return sessions;
}

/** Create a new session for a case. Optionally seed with intro facts. */
export function createSession(
  caseDate: string,
  introductionFactIds?: string[],
): PlayerSession {
  const session: PlayerSession = {
    caseDate,
    visitedEntries: [],
    discoveredFacts: introductionFactIds ?? [],
    answers: [],
    startedAt: new Date().toISOString(),
  };
  saveSession(session);
  return session;
}

/** True if the player's selected factId is one of the question's acceptable answers. */
function isCorrect(playerFactId: string, correctFactIds: string[]): boolean {
  return correctFactIds.includes(playerFactId);
}

const PENALTY_PER_EXTRA_VISIT = 5;

/** Compute the case result from a completed session. */
export function computeResult(session: PlayerSession, gameCase: Case): CaseResult {
  let questionsCorrect = 0;
  for (const question of gameCase.questions) {
    const playerAnswer = session.answers.find(a => a.questionId === question.questionId);
    if (playerAnswer && isCorrect(playerAnswer.answerFactId, question.answerFactIds)) {
      questionsCorrect++;
    }
  }

  const questionsScore = gameCase.questions.reduce((sum, question) => {
    const playerAnswer = session.answers.find(a => a.questionId === question.questionId);
    if (playerAnswer && isCorrect(playerAnswer.answerFactId, question.answerFactIds)) {
      return sum + question.points;
    }
    return sum;
  }, 0);

  const entriesVisited = session.visitedEntries.length;
  const optimalEntries = gameCase.optimalPath.length;
  const visitPenalty = Math.max(0, entriesVisited - optimalEntries) * PENALTY_PER_EXTRA_VISIT;

  return {
    questionsCorrect,
    questionsTotal: gameCase.questions.length,
    entriesVisited,
    optimalEntries,
    score: questionsScore - visitPenalty,
  };
}
