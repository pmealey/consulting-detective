import type { Case, CaseResult, PlayerAnswer } from '@shared/index';

interface QuestionsAnsweredViewProps {
  gameCase: Case;
  result: CaseResult;
  playerAnswers: PlayerAnswer[];
}

export function QuestionsAnsweredView({
  gameCase,
  result,
  playerAnswers,
}: QuestionsAnsweredViewProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-serif font-semibold">Questions</h2>
        <p className="text-sm text-stone-500 mt-0.5">
          Your answers and how they compare.
        </p>
      </div>

      <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 flex items-center justify-between gap-4">
        <div>
          <span className="text-2xl font-bold text-stone-800">{result.score}</span>
          <span className="text-sm text-stone-500 ml-2">Final score</span>
        </div>
        <div className="flex gap-4 text-sm text-stone-600">
          <span>{result.questionsCorrect}/{result.questionsTotal} correct</span>
          <span>{result.entriesVisited} visits</span>
        </div>
      </div>

      <div className="space-y-4">
        {gameCase.questions.map((question, index) => {
          const playerAnswer = playerAnswers.find(
            (a) => a.questionId === question.questionId,
          );
          const isCorrect =
            playerAnswer &&
            playerAnswer.answer.trim().toLowerCase() ===
              question.answer.trim().toLowerCase();

          return (
            <div
              key={question.questionId}
              className={`rounded-lg border p-4 ${
                isCorrect
                  ? 'border-stone-200 bg-white'
                  : 'border-amber-200 bg-amber-50/50'
              }`}
            >
              <div className="flex items-start gap-3 mb-2">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-stone-100 text-stone-600 text-xs font-medium flex items-center justify-center">
                  {index + 1}
                </span>
                <p className="text-sm font-medium text-stone-800">
                  {question.text}
                </p>
              </div>
              <div className="ml-9 space-y-1">
                <div className="text-sm">
                  <span className="text-stone-500">Your answer: </span>
                  <span className={isCorrect ? 'text-stone-800' : 'text-amber-800'}>
                    {playerAnswer?.answer || '(no answer)'}
                  </span>
                </div>
                {!isCorrect && (
                  <div className="text-sm">
                    <span className="text-stone-500">Correct answer: </span>
                    <span className="text-stone-800 font-medium">
                      {question.answer}
                    </span>
                  </div>
                )}
                <div className="text-xs text-stone-400">
                  {question.points} pt{question.points !== 1 ? 's' : ''} · {question.difficulty}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
