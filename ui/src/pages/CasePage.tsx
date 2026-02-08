import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.ts';
import {
  getSession,
  createSession,
  saveSession,
  computeResult,
} from '../storage/session.ts';
import { CasebookList } from '../components/CasebookList.tsx';
import { CasebookEntryView } from '../components/CasebookEntryView.tsx';
import { QuestionForm } from '../components/QuestionForm.tsx';
import { ResultsView } from '../components/ResultsView.tsx';
import type { Case, PlayerSession, PlayerAnswer, CaseResult } from '@shared/index';

type Phase = 'loading' | 'investigation' | 'questions' | 'results';

const difficultyColors: Record<string, string> = {
  easy: 'bg-green-100 text-green-800',
  medium: 'bg-amber-100 text-amber-800',
  hard: 'bg-red-100 text-red-800',
};

export function CasePage() {
  const { caseDate } = useParams<{ caseDate: string }>();

  const [gameCase, setGameCase] = useState<Case | null>(null);
  const [session, setSession] = useState<PlayerSession | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CaseResult | null>(null);

  // Track which entries are newly visited this click (for showing revealed facts)
  const [newVisitEntryId, setNewVisitEntryId] = useState<string | null>(null);

  // Load the case and restore session
  useEffect(() => {
    if (!caseDate) return;

    api.get<Case>(`/cases/${caseDate}`)
      .then((res) => {
        if (res.success) {
          setGameCase(res.data);

          // Check for existing session
          const existing = getSession(caseDate);
          if (existing) {
            setSession(existing);
            if (existing.completedAt) {
              // Already completed -- show results
              setResult(computeResult(existing, res.data));
              setPhase('results');
            } else {
              // In progress or new -- go to investigation
              setPhase('investigation');
            }
          } else {
            // No session yet -- create one and go to investigation
            setSession(createSession(caseDate));
            setPhase('investigation');
          }
        } else {
          setError(res.error.message);
          setPhase('loading');
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load case');
      });
  }, [caseDate]);

  const handleSelectEntry = useCallback(
    (entryId: string) => {
      if (!gameCase || !session) return;

      const isNew = !session.visitedEntries.includes(entryId);
      setSelectedEntryId(entryId);
      setNewVisitEntryId(isNew ? entryId : null);

      if (isNew) {
        const entry = gameCase.casebook[entryId];
        const newFacts = entry.revealsFactIds.filter(
          (fid) => !session.discoveredFacts.includes(fid),
        );

        const updated: PlayerSession = {
          ...session,
          visitedEntries: [...session.visitedEntries, entryId],
          discoveredFacts: [...session.discoveredFacts, ...newFacts],
        };
        setSession(updated);
        saveSession(updated);
      }
    },
    [gameCase, session],
  );

  const handleReadyToAnswer = useCallback(() => {
    setPhase('questions');
    setSelectedEntryId(null);
  }, []);

  const handleBackToCasebook = useCallback(() => {
    setPhase('investigation');
  }, []);

  const handleSubmitAnswers = useCallback(
    (answers: PlayerAnswer[]) => {
      if (!gameCase || !session) return;

      const completed: PlayerSession = {
        ...session,
        answers,
        completedAt: new Date().toISOString(),
      };
      setSession(completed);
      saveSession(completed);

      const caseResult = computeResult(completed, gameCase);
      setResult(caseResult);
      setPhase('results');
    },
    [gameCase, session],
  );

  // Loading / error states
  if (error) {
    return (
      <div className="space-y-4">
        <Link to="/" className="text-sm text-stone-500 hover:text-stone-700">
          &larr; Back to cases
        </Link>
        <div className="rounded-lg border border-red-200 bg-red-50 p-6">
          <p className="text-red-800">{error}</p>
        </div>
      </div>
    );
  }

  if (phase === 'loading' || !gameCase) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-stone-500">Loading case...</p>
      </div>
    );
  }

  // Investigation
  if (phase === 'investigation') {
    const selectedEntry = selectedEntryId
      ? gameCase.casebook[selectedEntryId]
      : null;

    return (
      <div className="fixed inset-x-0 top-0 bottom-6 flex flex-col overflow-hidden bg-stone-50">
        <div className="flex items-center justify-between shrink-0 px-4 py-2 max-w-6xl w-full mx-auto">
          <Link to="/" className="text-sm text-stone-500 hover:text-stone-700">
            &larr; Back to cases
          </Link>
          <h1 className="text-lg font-serif font-semibold">{gameCase.title}</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-0 px-4 max-w-6xl w-full mx-auto">
          {/* Sidebar: Casebook */}
          <div className="lg:col-span-4 flex flex-col min-h-0 gap-4">
            <div className="rounded-lg border border-stone-200 bg-white p-4 flex flex-col min-h-0 flex-1">
              <button
                onClick={() => { setSelectedEntryId(null); setNewVisitEntryId(null); }}
                className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors shrink-0 ${
                  selectedEntryId === null
                    ? 'bg-stone-800 text-white'
                    : 'bg-stone-50 text-stone-600 hover:bg-stone-100 border border-stone-200'
                }`}
              >
                Case Introduction
              </button>
              <div className="min-h-0 flex-1 overflow-y-auto mt-4">
                <CasebookList
                  entries={gameCase.casebook}
                  visitedEntryIds={session?.visitedEntries ?? []}
                  selectedEntryId={selectedEntryId}
                  onSelectEntry={handleSelectEntry}
                />
              </div>
            </div>

            <button
              onClick={handleReadyToAnswer}
              className="w-full py-2.5 rounded-lg bg-stone-800 text-white font-medium text-sm hover:bg-stone-900 transition-colors shrink-0"
            >
              Ready to Answer Questions
            </button>
          </div>

          {/* Main content: Selected entry */}
          <div className="lg:col-span-8 min-h-0 flex flex-col">
            {selectedEntry ? (
              <div className="rounded-lg border border-stone-200 bg-white flex-1 min-h-0 overflow-y-auto">
                <div className="p-6">
                  <CasebookEntryView
                    entry={selectedEntry}
                    characters={gameCase.characters}
                    facts={gameCase.facts}
                    isNewVisit={newVisitEntryId === selectedEntryId}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-stone-200 bg-white flex-1 min-h-0 overflow-y-auto">
                <div className="p-6 space-y-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h2 className="text-xl font-serif font-semibold">{gameCase.title}</h2>
                    <span className={`text-xs px-2 py-0.5 rounded ${difficultyColors[gameCase.difficulty] ?? ''}`}>
                      {gameCase.difficulty}
                    </span>
                  </div>
                  <div className="flex gap-4 text-sm text-stone-500">
                    <span>{gameCase.setting.era}</span>
                    <span>&middot;</span>
                    <span>{gameCase.setting.date}</span>
                  </div>
                  <p className="text-sm text-stone-500 italic">{gameCase.setting.atmosphere}</p>
                  <div className="border-t border-stone-200 pt-4 space-y-4">
                    {gameCase.introduction.split('\n').filter(p => p.trim()).map((paragraph, i) => (
                      <p key={i} className="text-stone-700 leading-relaxed">
                        {paragraph}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Phase 3: Questions
  if (phase === 'questions') {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <button
            onClick={handleBackToCasebook}
            className="text-sm text-stone-500 hover:text-stone-700"
          >
            &larr; Back to casebook
          </button>
          <h1 className="text-lg font-serif font-semibold">{gameCase.title}</h1>
        </div>

        <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600">
          You visited {session?.visitedEntries.length ?? 0} entries and
          discovered {session?.discoveredFacts.length ?? 0} facts.
        </div>

        <QuestionForm
          questions={gameCase.questions}
          onSubmit={handleSubmitAnswers}
        />
      </div>
    );
  }

  // Phase 4: Results
  if (phase === 'results' && result && session) {
    return (
      <div className="space-y-6">
        <Link to="/" className="text-sm text-stone-500 hover:text-stone-700">
          &larr; Back to cases
        </Link>

        <ResultsView
          gameCase={gameCase}
          result={result}
          playerAnswers={session.answers}
          visitedEntryIds={session.visitedEntries}
        />
      </div>
    );
  }

  return null;
}
