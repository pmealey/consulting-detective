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
import { FactsList } from '../components/FactsList.tsx';
import { QuestionForm } from '../components/QuestionForm.tsx';
import { ResultsView } from '../components/ResultsView.tsx';
import type { Case, PlayerSession, PlayerAnswer, CaseResult } from '@shared/index';

type Phase = 'loading' | 'introduction' | 'investigation' | 'questions' | 'results';

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
            } else if (existing.visitedEntries.length > 0) {
              // In progress -- resume investigation
              setPhase('investigation');
            } else {
              // Session exists but nothing visited -- show intro
              setPhase('introduction');
            }
          } else {
            setPhase('introduction');
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

  const handleBeginInvestigation = useCallback(() => {
    if (!caseDate) return;
    const newSession = session ?? createSession(caseDate);
    setSession(newSession);
    setPhase('investigation');
  }, [caseDate, session]);

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

  // Phase 1: Introduction
  if (phase === 'introduction') {
    return (
      <div className="space-y-8">
        <Link to="/" className="text-sm text-stone-500 hover:text-stone-700">
          &larr; Back to cases
        </Link>

        <div className="rounded-lg border border-stone-200 bg-white p-6 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-serif font-bold">{gameCase.title}</h1>
            <span className={`text-xs px-2 py-0.5 rounded ${difficultyColors[gameCase.difficulty] ?? ''}`}>
              {gameCase.difficulty}
            </span>
          </div>

          <div className="flex gap-4 text-sm text-stone-500">
            <span>{gameCase.setting.era}</span>
            <span>&middot;</span>
            <span>{gameCase.setting.date}</span>
          </div>

          <p className="text-sm text-stone-500 italic">
            {gameCase.setting.atmosphere}
          </p>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-6">
          <div className="space-y-4">
            {gameCase.introduction.split('\n').filter(p => p.trim()).map((paragraph, i) => (
              <p key={i} className="text-stone-700 leading-relaxed">
                {paragraph}
              </p>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-6">
          <h3 className="text-lg font-serif font-semibold mb-4">
            Your Casebook
          </h3>
          <p className="text-sm text-stone-500 mb-4">
            {Object.keys(gameCase.casebook).length} addresses are available to
            investigate. Choose wisely -- visiting fewer locations while still
            answering correctly earns a higher score.
          </p>
          <CasebookList
            entries={gameCase.casebook}
            visitedEntryIds={[]}
            selectedEntryId={null}
            onSelectEntry={() => {}}
          />
        </div>

        <button
          onClick={handleBeginInvestigation}
          className="w-full py-3 rounded-lg bg-stone-800 text-white font-medium text-sm hover:bg-stone-900 transition-colors"
        >
          Begin Investigation
        </button>
      </div>
    );
  }

  // Phase 2: Investigation
  if (phase === 'investigation') {
    const selectedEntry = selectedEntryId
      ? gameCase.casebook[selectedEntryId]
      : null;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Link to="/" className="text-sm text-stone-500 hover:text-stone-700">
            &larr; Back to cases
          </Link>
          <h1 className="text-lg font-serif font-semibold">{gameCase.title}</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Sidebar: Casebook + Facts */}
          <div className="lg:col-span-4 space-y-6">
            <div className="rounded-lg border border-stone-200 bg-white p-4 space-y-4">
              <button
                onClick={() => { setSelectedEntryId(null); setNewVisitEntryId(null); }}
                className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  selectedEntryId === null
                    ? 'bg-stone-800 text-white'
                    : 'bg-stone-50 text-stone-600 hover:bg-stone-100 border border-stone-200'
                }`}
              >
                Case Introduction
              </button>
              <CasebookList
                entries={gameCase.casebook}
                visitedEntryIds={session?.visitedEntries ?? []}
                selectedEntryId={selectedEntryId}
                onSelectEntry={handleSelectEntry}
              />
            </div>

            <div className="rounded-lg border border-stone-200 bg-white p-4">
              <FactsList
                facts={gameCase.facts}
                discoveredFactIds={session?.discoveredFacts ?? []}
              />
            </div>

            <button
              onClick={handleReadyToAnswer}
              className="w-full py-2.5 rounded-lg bg-stone-800 text-white font-medium text-sm hover:bg-stone-900 transition-colors"
            >
              Ready to Answer Questions
            </button>
          </div>

          {/* Main content: Selected entry */}
          <div className="lg:col-span-8">
            {selectedEntry ? (
              <div className="rounded-lg border border-stone-200 bg-white p-6">
                <CasebookEntryView
                  entry={selectedEntry}
                  characters={gameCase.characters}
                  facts={gameCase.facts}
                  isNewVisit={newVisitEntryId === selectedEntryId}
                />
              </div>
            ) : (
              <div className="rounded-lg border border-stone-200 bg-white p-6 space-y-4">
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
