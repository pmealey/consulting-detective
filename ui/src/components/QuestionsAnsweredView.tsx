import type { Case, CaseResult, PlayerAnswer, CasebookEntry, Fact } from '@shared/index';

interface QuestionsAnsweredViewProps {
  gameCase: Case;
  result: CaseResult;
  playerAnswers: PlayerAnswer[];
  visitedEntryIds: string[];
  facts: Record<string, Fact>;
}

export function QuestionsAnsweredView({
  gameCase,
  result,
  playerAnswers,
  visitedEntryIds,
  facts,
}: QuestionsAnsweredViewProps) {
  const entryLabel = (entryId: string): string => {
    const entry: CasebookEntry | undefined = gameCase.casebook[entryId];
    return entry ? entry.label : entryId;
  };

  return (
    <div className="space-y-8">
      {/* Score Summary */}
      <div className="rounded-lg border border-stone-200 bg-white p-6 text-center">
        <h2 className="text-xl font-serif font-semibold mb-4">Case Complete</h2>
        <div className="text-5xl font-bold text-stone-800 mb-2">
          {result.score}
        </div>
        <div className="text-sm text-stone-500 mb-6">Final Score</div>

        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="rounded-md bg-stone-50 p-3">
            <div className="text-2xl font-semibold text-stone-800">
              {result.questionsCorrect}/{result.questionsTotal}
            </div>
            <div className="text-xs text-stone-500 mt-1">Questions Correct</div>
          </div>
          <div className="rounded-md bg-stone-50 p-3">
            <div className="text-2xl font-semibold text-stone-800">
              {result.entriesVisited}
            </div>
            <div className="text-xs text-stone-500 mt-1">Entries Visited</div>
          </div>
          <div className="rounded-md bg-stone-50 p-3">
            <div className="text-2xl font-semibold text-stone-800">
              {result.optimalEntries}
            </div>
            <div className="text-xs text-stone-500 mt-1">Holmes Needed</div>
          </div>
        </div>
      </div>

      {/* Answer Comparison */}
      <div className="space-y-4">
        <h3 className="text-lg font-serif font-semibold">Your Answers</h3>
        {gameCase.questions.map((question, index) => {
          const playerAnswer = playerAnswers.find(
            (a) => a.questionId === question.questionId,
          );
          const isCorrect =
            playerAnswer &&
            question.answer.acceptedIds.includes(playerAnswer.answerId);

          /** Resolve an answer ID to a display label based on the question's answer type. */
          const resolveLabel = (id: string): string => {
            switch (question.answer.type) {
              case 'fact':
                return facts[id]?.description ?? id;
              case 'person':
                return gameCase.characters[id]?.name ?? id;
              case 'location':
                return gameCase.locations[id]?.name ?? id;
              default:
                return id;
            }
          };

          return (
            <div
              key={question.questionId}
              className={`rounded-lg border p-4 ${
                isCorrect
                  ? 'border-green-200 bg-green-50'
                  : 'border-red-200 bg-red-50'
              }`}
            >
              <div className="flex items-start gap-3 mb-2">
                <span className={`flex-shrink-0 w-6 h-6 rounded-full text-xs font-medium flex items-center justify-center ${
                  isCorrect
                    ? 'bg-green-200 text-green-800'
                    : 'bg-red-200 text-red-800'
                }`}>
                  {index + 1}
                </span>
                <p className="text-sm font-medium text-stone-800">
                  {question.text}
                </p>
              </div>
              <div className="ml-9 space-y-1">
                <div className="text-sm">
                  <span className="text-stone-500">Your answer: </span>
                  <span className={isCorrect ? 'text-green-800' : 'text-red-800'}>
                    {playerAnswer ? resolveLabel(playerAnswer.answerId) : '(no answer)'}
                  </span>
                </div>
                {!isCorrect && question.answer.acceptedIds.length > 0 && (
                  <div className="text-sm">
                    <span className="text-stone-500">Correct answer: </span>
                    <span className="text-green-800 font-medium">
                      {resolveLabel(question.answer.acceptedIds[0])}
                    </span>
                  </div>
                )}
                <div className="text-xs text-stone-400">
                  {question.points} point{question.points !== 1 ? 's' : ''} — {question.difficulty}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Path Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-lg border border-stone-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-stone-500 uppercase tracking-wide mb-3">
            Your Path ({visitedEntryIds.length} visits)
          </h3>
          <ol className="space-y-1">
            {visitedEntryIds.map((entryId, i) => (
              <li key={`${entryId}-${i}`} className="flex items-center gap-2 text-sm">
                <span className="text-stone-400 w-5 text-right">{i + 1}.</span>
                <span className="text-stone-700">{entryLabel(entryId)}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-stone-500 uppercase tracking-wide mb-3">
            Holmes's Path ({gameCase.optimalPath.length} visits)
          </h3>
          <ol className="space-y-1">
            {gameCase.optimalPath.map((entryId, i) => (
              <li key={`${entryId}-${i}`} className="flex items-center gap-2 text-sm">
                <span className="text-stone-400 w-5 text-right">{i + 1}.</span>
                <span className="text-stone-700">{entryLabel(entryId)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
