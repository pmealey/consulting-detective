import { useEffect, useState } from 'react'
import { api } from '../api/client.ts'

interface HealthData {
  status: string;
  timestamp: string;
  service: string;
}

export function Home() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<HealthData>('/health')
      .then((res) => {
        if (res.success) {
          setHealth(res.data);
        } else {
          setError(res.error.message);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to connect to API');
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

      <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-3">API Status</h3>
        {loading && (
          <p className="text-stone-500">Checking connection...</p>
        )}
        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 p-4">
            <p className="text-red-800 text-sm">
              <span className="font-medium">Connection failed:</span> {error}
            </p>
          </div>
        )}
        {health && (
          <div className="rounded-md bg-green-50 border border-green-200 p-4">
            <p className="text-green-800 text-sm">
              <span className="font-medium">API:</span>{' '}
              {health.status.toUpperCase()}
            </p>
            <p className="text-green-700 text-xs mt-1">
              Service: {health.service} | Last checked: {health.timestamp}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
