import { useState } from 'react';
import type { Question, PlayerAnswer } from '@shared/index';

const difficultyColors: Record<string, string> = {
  easy: 'bg-green-100 text-green-800',
  medium: 'bg-amber-100 text-amber-800',
  hard: 'bg-red-100 text-red-800',
};

interface QuestionFormProps {
  questions: Question[];
  onSubmit: (answers: PlayerAnswer[]) => void;
}

export function QuestionForm({ questions, onSubmit }: QuestionFormProps) {
  const [answers, setAnswers] = useState<Record<string, string>>(
    () => Object.fromEntries(questions.map((q) => [q.questionId, ''])),
  );

  const handleChange = (questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const playerAnswers: PlayerAnswer[] = questions.map((q) => ({
      questionId: q.questionId,
      answer: answers[q.questionId] ?? '',
    }));
    onSubmit(playerAnswers);
  };

  const allAnswered = questions.every(
    (q) => (answers[q.questionId] ?? '').trim().length > 0,
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-serif font-semibold">The Questions</h2>
        <p className="text-sm text-stone-500">
          Based on your investigation, answer the following questions.
        </p>
      </div>

      {questions.map((question, index) => (
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
          <input
            type="text"
            value={answers[question.questionId] ?? ''}
            onChange={(e) => handleChange(question.questionId, e.target.value)}
            placeholder="Your answer..."
            className="w-full px-3 py-2 rounded-md border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-stone-400 focus:border-transparent"
          />
        </div>
      ))}

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
