import { useEffect, useState, useCallback, useMemo } from 'react';
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
import { QuestionsAnsweredView } from '../components/QuestionsAnsweredView.tsx';
import { DebugCasePanel } from '../components/DebugCasePanel.tsx';
import type { Case, CasebookEntry, PlayerSession, PlayerAnswer, CaseResult } from '@shared/index';

type Phase = 'loading' | 'investigation';

const difficultyColors: Record<string, string> = {
  easy: 'bg-green-100 text-green-800',
  medium: 'bg-amber-100 text-amber-800',
  hard: 'bg-red-100 text-red-800',
};

const FACTS_VIEW_ID = '__facts__' as const;
const QUESTIONS_VIEW_ID = '__questions__' as const;

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

  const [debugOpen, setDebugOpen] = useState(false);

  // Load the case and restore session
  useEffect(() => {
    if (!caseDate) return;

    api.get<Case>(`/cases/${caseDate}`)
      .then((res) => {
        if (res.success) {
          setGameCase(res.data);

          // Check for existing session
          const existing = getSession(caseDate);
          const introIds = res.data.introductionFactIds ?? [];
          if (existing) {
            // Ensure intro facts are in discoveredFacts (merge for old saves)
            const mergedFacts = [...new Set([...introIds, ...existing.discoveredFacts])];
            const sessionToUse =
              mergedFacts.length !== existing.discoveredFacts.length
                ? { ...existing, discoveredFacts: mergedFacts }
                : existing;
            if (sessionToUse !== existing) saveSession(sessionToUse);
            setSession(sessionToUse);
            if (existing.completedAt) {
              // Already completed -- show investigation with answers in Questions card
              setResult(computeResult(sessionToUse, res.data));
              setPhase('investigation');
              setSelectedEntryId(QUESTIONS_VIEW_ID);
            } else {
              setPhase('investigation');
            }
          } else {
            // No session yet -- create one seeded with intro facts
            setSession(createSession(caseDate, introIds));
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
      setPhase('investigation');
      setSelectedEntryId(QUESTIONS_VIEW_ID);
    },
    [gameCase, session],
  );

  // Visible casebook entries: no gate, or gate satisfied by discovered facts
  // (Must be before any early returns to satisfy Rules of Hooks.)
  const visibleEntries = useMemo((): Record<string, CasebookEntry> => {
    if (!gameCase || !session) return {};
    const discovered = new Set(session.discoveredFacts);
    return Object.fromEntries(
      Object.entries(gameCase.casebook).filter(([, e]) => {
        const gate = e.requiresAnyFact;
        return !gate?.length || gate.some((fid) => discovered.has(fid));
      }),
    );
  }, [gameCase?.casebook, session?.discoveredFacts]);

  // Entry ids that just became visible due to the current visit (for "New lead!" indicator)
  const newlyVisibleEntryIds = useMemo(() => {
    if (!newVisitEntryId || !gameCase || !session) return new Set<string>();
    const entry = gameCase.casebook[newVisitEntryId];
    if (!entry) return new Set<string>();
    const revealedByVisit = new Set(entry.revealsFactIds);
    const result = new Set<string>();
    for (const [, e] of Object.entries(visibleEntries)) {
      if (e.entryId === newVisitEntryId) continue;
      const gate = e.requiresAnyFact;
      if (gate?.length && gate.some((fid) => revealedByVisit.has(fid))) result.add(e.entryId);
    }
    return result;
  }, [newVisitEntryId, gameCase?.casebook, visibleEntries]);

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
    const isFactsView = selectedEntryId === FACTS_VIEW_ID;
    const isQuestionsView = selectedEntryId === QUESTIONS_VIEW_ID;
    const selectedEntry =
      selectedEntryId &&
      selectedEntryId !== FACTS_VIEW_ID &&
      selectedEntryId !== QUESTIONS_VIEW_ID
        ? gameCase.casebook[selectedEntryId]
        : null;

    return (
      <div className="fixed inset-x-0 top-0 bottom-6 flex flex-col overflow-hidden bg-stone-50">
        <div className="flex items-center justify-between shrink-0 px-4 py-2 max-w-6xl w-full mx-auto">
          <Link to="/" className="text-sm text-stone-500 hover:text-stone-700">
            &larr; Back to cases
          </Link>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setDebugOpen(true)}
              className="text-sm text-stone-500 hover:text-stone-700 border border-stone-300 px-2 py-1 rounded"
            >
              Debug
            </button>
            <h1 className="text-lg font-serif font-semibold">{gameCase.title}</h1>
          </div>
        </div>
        {debugOpen && (
          <DebugCasePanel gameCase={gameCase} onClose={() => setDebugOpen(false)} />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-0 px-4 max-w-6xl w-full mx-auto">
          {/* Sidebar: Casebook */}
          <div className="lg:col-span-4 flex flex-col min-h-0 gap-4">
            <div className="rounded-lg border border-stone-200 bg-white p-4 flex flex-col min-h-0 flex-1">
              <div className="space-y-1 mb-3">
                <button
                  onClick={() => { setSelectedEntryId(null); setNewVisitEntryId(null); }}
                  className={`w-full text-left px-3 py-2 rounded-md transition-colors shrink-0 ${
                    selectedEntryId === null
                      ? 'bg-stone-800 text-white'
                      : 'bg-white text-stone-900 hover:bg-stone-50 border border-stone-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full flex-shrink-0 bg-stone-300" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">Case Introduction</div>
                      <div className={`text-xs truncate ${selectedEntryId === null ? 'text-stone-300' : 'text-stone-500'}`}>
                        Overview and setting
                      </div>
                    </div>
                    <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                      selectedEntryId === null ? 'bg-stone-700 text-stone-300' : 'bg-stone-100 text-stone-600'
                    }`}>
                      Intro
                    </span>
                  </div>
                </button>
                <button
                  onClick={() => { setSelectedEntryId(FACTS_VIEW_ID); setNewVisitEntryId(null); }}
                  className={`w-full text-left px-3 py-2 rounded-md transition-colors shrink-0 ${
                    isFactsView
                      ? 'bg-stone-800 text-white'
                      : 'bg-white text-stone-900 hover:bg-stone-50 border border-stone-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                      (session?.discoveredFacts.length ?? 0) > 0 ? 'bg-green-500' : 'bg-stone-300'
                    }`} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">Facts</div>
                      <div className={`text-xs truncate ${
                        isFactsView ? 'text-stone-300' : 'text-stone-500'
                      }`}>
                        {(session?.discoveredFacts.length ?? 0) > 0
                          ? `${session?.discoveredFacts.length ?? 0} discovered`
                          : 'Discovered clues'}
                      </div>
                    </div>
                    <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                      isFactsView ? 'bg-stone-700 text-stone-300' : 'bg-emerald-100 text-emerald-800'
                    }`}>
                      Facts
                    </span>
                  </div>
                </button>
                <button
                  onClick={() => { setSelectedEntryId(QUESTIONS_VIEW_ID); setNewVisitEntryId(null); }}
                  className={`w-full text-left px-3 py-2 rounded-md transition-colors shrink-0 ${
                    isQuestionsView
                      ? 'bg-stone-800 text-white'
                      : 'bg-white text-stone-900 hover:bg-stone-50 border border-stone-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full flex-shrink-0 bg-stone-300" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">Questions</div>
                      <div className={`text-xs truncate ${
                        isQuestionsView ? 'text-stone-300' : 'text-stone-500'
                      }`}>
                        Answer when ready
                      </div>
                    </div>
                    <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                      isQuestionsView ? 'bg-stone-700 text-stone-300' : 'bg-stone-100 text-stone-600'
                    }`}>
                      Questions
                    </span>
                  </div>
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <CasebookList
                  entries={visibleEntries}
                  visitedEntryIds={session?.visitedEntries ?? []}
                  newlyVisibleEntryIds={newlyVisibleEntryIds}
                  selectedEntryId={
                    selectedEntryId === FACTS_VIEW_ID || selectedEntryId === QUESTIONS_VIEW_ID
                      ? null
                      : selectedEntryId
                  }
                  onSelectEntry={handleSelectEntry}
                />
              </div>
            </div>
          </div>

          {/* Main content: Selected entry or Facts */}
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
            ) : isFactsView ? (
              <div className="rounded-lg border border-stone-200 bg-white flex-1 min-h-0 overflow-y-auto">
                <div className="p-6">
                  <FactsList
                    facts={gameCase.facts}
                    discoveredFactIds={session?.discoveredFacts ?? []}
                  />
                </div>
              </div>
            ) : isQuestionsView ? (
              <div className="rounded-lg border border-stone-200 bg-white flex-1 min-h-0 overflow-y-auto">
                <div className="p-6">
                  {session && session.completedAt && result && session.answers?.length ? (
                    <QuestionsAnsweredView
                      gameCase={gameCase}
                      result={result}
                      playerAnswers={session.answers}
                      visitedEntryIds={session.visitedEntries}
                      facts={gameCase.facts}
                    />
                  ) : (
                    <QuestionForm
                      questions={gameCase.questions}
                      facts={gameCase.facts}
                      discoveredFactIds={session?.discoveredFacts ?? []}
                      onSubmit={handleSubmitAnswers}
                    />
                  )}
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
                  {(gameCase.introductionFactIds?.length ?? 0) > 0 && (
                    <div className="border-t border-stone-200 pt-4">
                      <h4 className="text-sm font-semibold text-emerald-700 mb-2">
                        Facts from the briefing
                      </h4>
                      <ul className="space-y-1">
                        {gameCase.introductionFactIds!
                          .map((id) => gameCase.facts[id])
                          .filter(Boolean)
                          .map((fact) => (
                            <li
                              key={fact.factId}
                              className="flex items-start gap-2 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2"
                            >
                              <span className="text-emerald-500 mt-0.5">+</span>
                              <span>{fact.description}</span>
                            </li>
                          ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
