import { useState } from 'react';
import type { Question, PlayerAnswer, Fact } from '@shared/index';

const difficultyColors: Record<string, string> = {
  easy: 'bg-green-100 text-green-800',
  medium: 'bg-amber-100 text-amber-800',
  hard: 'bg-red-100 text-red-800',
};

interface QuestionFormProps {
  questions: Question[];
  facts: Record<string, Fact>;
  discoveredFactIds: string[];
  onSubmit: (answers: PlayerAnswer[]) => void;
}

export function QuestionForm({
  questions,
  facts,
  discoveredFactIds,
  onSubmit,
}: QuestionFormProps) {
  const [answers, setAnswers] = useState<Record<string, string>>(
    () => Object.fromEntries(questions.map((q) => [q.questionId, ''])),
  );

  const handleChange = (questionId: string, factId: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: factId }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const playerAnswers: PlayerAnswer[] = questions.map((q) => ({
      questionId: q.questionId,
      answerFactId: answers[q.questionId] ?? '',
    }));
    onSubmit(playerAnswers);
  };

  const allAnswered = questions.every((q) => (answers[q.questionId] ?? '').length > 0);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-serif font-semibold">The Questions</h2>
        <p className="text-sm text-stone-500">
          Based on your investigation, answer the following questions.
        </p>
      </div>

      {questions.map((question, index) => {
        const options = discoveredFactIds
          .map((id) => facts[id])
          .filter((f): f is Fact => Boolean(f) && f.category === question.answerCategory);
        const selected = answers[question.questionId] ?? '';

        return (
          <div
            key={question.questionId}
            className="rounded-lg border border-stone-200 bg-white p-5 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-stone-100 text-stone-600 text-sm font-medium flex items-center justify-center">
                  {index + 1}
                </span>
                <p className="text-stone-800 font-medium pt-0.5">{question.text}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-xs px-1.5 py-0.5 rounded ${difficultyColors[question.difficulty] ?? ''}`}>
                  {question.difficulty}
                </span>
                <span className="text-xs text-stone-400">
                  {question.points} pt{question.points !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
            {options.length === 0 ? (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                No {question.answerCategory} facts discovered yet. Visit more entries to uncover clues.
              </p>
            ) : (
              <div className="space-y-2">
                <span className="text-xs text-stone-500 block">Select one:</span>
                <ul className="space-y-1.5">
                  {options.map((fact) => (
                    <li key={fact.factId}>
                      <label className="flex items-start gap-2 cursor-pointer group">
                        <input
                          type="radio"
                          name={question.questionId}
                          value={fact.factId}
                          checked={selected === fact.factId}
                          onChange={() => handleChange(question.questionId, fact.factId)}
                          className="mt-1.5 rounded-full border-stone-300 text-stone-700 focus:ring-stone-400"
                        />
                        <span className="text-sm text-stone-700 group-hover:text-stone-900">
                          {fact.description}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}

      <button
        type="submit"
        disabled={!allAnswered}
        className={`w-full py-3 rounded-lg font-medium text-sm transition-colors ${
          allAnswered
            ? 'bg-stone-800 text-white hover:bg-stone-900'
            : 'bg-stone-200 text-stone-400 cursor-not-allowed'
        }`}
      >
        Submit Answers
      </button>
    </form>
  );
}
