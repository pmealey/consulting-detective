import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.ts';
import { getAllSessions } from '../storage/session.ts';
import type { CaseSetting, Difficulty, PlayerSession } from '@shared/index';

interface CaseSummary {
  caseDate: string;
  title: string;
  difficulty: Difficulty;
  setting: CaseSetting;
}

const difficultyColors: Record<string, string> = {
  easy: 'bg-green-100 text-green-800',
  medium: 'bg-amber-100 text-amber-800',
  hard: 'bg-red-100 text-red-800',
};

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function getStatusBadge(session: PlayerSession | undefined) {
  if (!session) {
    return null;
  }
  if (session.completedAt) {
    return (
      <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-800">
        Completed
      </span>
    );
  }
  if (session.visitedEntries.length > 0) {
    return (
      <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800">
        In Progress
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded bg-stone-100 text-stone-600">
      Started
    </span>
  );
}

export function Home() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [sessions, setSessions] = useState<Record<string, PlayerSession>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSessions(getAllSessions());

    api.get<CaseSummary[]>('/cases')
      .then((res) => {
        if (res.success) {
          setCases(res.data);
        } else {
          setError(res.error.message);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load cases');
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-serif font-semibold mb-4">
          The Game is Afoot
        </h2>
        <p className="text-stone-600 leading-relaxed">
          Each day, a new case arrives on your desk. A crime has been committed,
          and it falls to you -- the detective's trusted irregulars -- to piece
          together what happened. Visit locations, interview witnesses, examine
          evidence, and reconstruct the narrative. Then answer the detective's
          questions and see how your deductions compare.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-serif font-semibold">Available Cases</h2>

        {loading && (
          <div className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
            <p className="text-stone-500">Loading cases...</p>
          </div>
        )}

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 p-4">
            <p className="text-red-800 text-sm">
              <span className="font-medium">Failed to load cases:</span> {error}
            </p>
          </div>
        )}

        {!loading && !error && cases.length === 0 && (
          <div className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
            <p className="text-stone-500">
              No cases available yet. Check back soon.
            </p>
          </div>
        )}

        {cases.map((c) => {
          const session = sessions[c.caseDate];
          const statusBadge = getStatusBadge(session);

          return (
            <Link
              key={c.caseDate}
              to={`/case/${c.caseDate}`}
              className="block rounded-lg border border-stone-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-stone-300 transition-all"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h3 className="text-lg font-serif font-semibold text-stone-900">
                      {c.title}
                    </h3>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${difficultyColors[c.difficulty] ?? ''}`}>
                      {c.difficulty}
                    </span>
                    {statusBadge}
                  </div>
                  <p className="text-sm text-stone-500">
                    {formatDate(c.caseDate)}
                  </p>
                  <p className="text-sm text-stone-500 mt-1">
                    {c.setting.era} &middot; {c.setting.atmosphere}
                  </p>
                </div>
                <span className="text-stone-400 text-sm flex-shrink-0 pt-1">
                  &rarr;
                </span>
              </div>
            </Link>
          );
        })}
      </section>

      {/* Temporary debug: clear all localStorage (sessions, facts ack, etc.) */}
      <section className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
        <p className="text-xs text-amber-800 font-medium mb-2">Debug</p>
        <button
          type="button"
          onClick={() => {
            localStorage.clear();
            window.location.reload();
          }}
          className="text-sm px-3 py-1.5 rounded border border-amber-300 bg-white text-amber-800 hover:bg-amber-100 transition-colors"
        >
          Clear all local storage
        </button>
      </section>
    </div>
  );
}
