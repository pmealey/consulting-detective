import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.ts';

/** Ordered pipeline steps for progress graph (must match backend PIPELINE_STEPS). */
const PIPELINE_STEPS = [
  'generateTemplate',
  'generateEvents',
  'computeEventKnowledge',
  'generateCharacters',
  'generateLocations',
  'computeFacts',
  'generateFacts',
  'generateIntroduction',
  'generateCasebook',
  'generateProse',
  'generateQuestions',
  'computeOptimalPath',
  'storeCase',
] as const;

const STEP_LABELS: Record<string, string> = {
  generateTemplate: 'Template',
  generateEvents: 'Events',
  computeEventKnowledge: 'Event knowledge',
  generateCharacters: 'Characters',
  generateLocations: 'Locations',
  computeFacts: 'Compute facts',
  generateFacts: 'Facts',
  generateIntroduction: 'Introduction',
  generateCasebook: 'Casebook',
  generateProse: 'Prose',
  generateQuestions: 'Questions',
  computeOptimalPath: 'Optimal path',
  storeCase: 'Store',
};

interface ExecutionListItem {
  executionId: string;
  status: string;
  startDate: string;
  stopDate?: string;
  caseDate?: string;
  difficulty?: string;
  crimeType?: string;
  modelConfig?: { default: string; steps?: Record<string, string> };
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  reachableFactIds?: string[];
  reachableEntryIds?: string[];
}

interface CaseSummary {
  title?: string;
  date?: string;
  era?: string;
  difficulty?: string;
  crimeType?: string;
  narrativeTone?: string;
  mysteryStyle?: string;
  atmosphere?: string;
  modelConfig?: { default: string; steps?: Record<string, string> };
}

interface ExecutionDetail {
  executionId: string;
  status: string;
  startDate: string;
  stopDate?: string;
  input?: { caseDate: string; difficulty?: string; crimeType?: string; modelConfig?: unknown };
  error?: string;
  cause?: string;
  currentStep?: string;
  lastStepStartedAt?: string;
  lastValidationResult?: ValidationResult;
  caseSummary: CaseSummary;
}

const POLL_INTERVAL_MS = 8000;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function statusBadge(status: string): string {
  switch (status) {
    case 'RUNNING':
      return 'bg-blue-100 text-blue-800';
    case 'SUCCEEDED':
      return 'bg-green-100 text-green-800';
    case 'FAILED':
    case 'TIMED_OUT':
      return 'bg-red-100 text-red-800';
    case 'ABORTED':
      return 'bg-stone-100 text-stone-600';
    default:
      return 'bg-stone-100 text-stone-600';
  }
}

function PipelineGraph({
  currentStep,
  status,
  onStepLabel,
}: {
  currentStep: string | undefined;
  status: string;
  onStepLabel?: (step: string) => string;
}) {
  const getStepStatus = (step: string) => {
    const currentIndex = currentStep ? PIPELINE_STEPS.indexOf(currentStep as (typeof PIPELINE_STEPS)[number]) : -1;
    const stepIndex = PIPELINE_STEPS.indexOf(step as (typeof PIPELINE_STEPS)[number]);
    if (status === 'SUCCEEDED') return 'completed';
    if (stepIndex < currentIndex) return 'completed';
    if (step === currentStep) return 'current';
    return 'pending';
  };

  return (
    <div className="flex flex-wrap gap-1 items-center">
      {PIPELINE_STEPS.map((step, i) => {
        const stepStatus = getStepStatus(step);
        const label = onStepLabel?.(step) ?? STEP_LABELS[step] ?? step;
        return (
          <span key={step} className="flex items-center gap-0.5">
            {i > 0 && <span className="text-stone-300 text-xs">→</span>}
            <span
              title={label}
              className={`text-xs px-1.5 py-0.5 rounded ${
                stepStatus === 'completed'
                  ? 'bg-green-100 text-green-800'
                  : stepStatus === 'current'
                    ? 'bg-amber-200 text-amber-900 ring-1 ring-amber-400'
                    : 'bg-stone-100 text-stone-400'
              }`}
            >
              {stepStatus === 'completed' && '✓ '}
              {label}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function ErrorDetailModal({
  title,
  validationResult,
  executionError,
  executionCause,
  onClose,
}: {
  title: string;
  validationResult?: ValidationResult;
  executionError?: string;
  executionCause?: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col border border-stone-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-stone-200 flex justify-between items-center">
          <h3 className="font-serif font-semibold text-stone-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-500 hover:text-stone-700 text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="p-4 overflow-y-auto text-sm space-y-4">
          {validationResult && (
            <>
              {validationResult.errors.length > 0 && (
                <div>
                  <p className="font-medium text-red-800 mb-1">Errors</p>
                  <ul className="list-disc list-inside text-stone-700 space-y-0.5">
                    {validationResult.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
              {validationResult.warnings.length > 0 && (
                <div>
                  <p className="font-medium text-amber-800 mb-1">Warnings</p>
                  <ul className="list-disc list-inside text-stone-700 space-y-0.5">
                    {validationResult.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          {(executionError || executionCause) && (
            <div>
              {executionError && (
                <p className="font-medium text-stone-800 mb-1">Error</p>
              )}
              <p className="text-stone-700 whitespace-pre-wrap">{executionError ?? executionCause ?? ''}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function GenerationPage() {
  const [list, setList] = useState<ExecutionListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [errorDetailOpen, setErrorDetailOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const fetchList = useCallback(() => {
    api
      .get<ExecutionListItem[]>('/generation/executions')
      .then((res) => {
        if (res.success) setList(res.data);
        else setListError(res.error.message);
      })
      .catch((err) => setListError(err instanceof Error ? err.message : 'Failed to load list'))
      .finally(() => setLoading(false));
  }, []);

  const fetchDetail = useCallback((id: string) => {
    setDetailError(null);
    api
      .get<ExecutionDetail>(`/generation/executions/${encodeURIComponent(id)}`)
      .then((res) => {
        if (res.success) setDetail(res.data);
        else setDetailError(res.error.message);
      })
      .catch((err) => setDetailError(err instanceof Error ? err.message : 'Failed to load detail'));
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    if (selectedId) {
      fetchDetail(selectedId);
    } else {
      setDetail(null);
      const running = list.find((e) => e.status === 'RUNNING');
      if (running) {
        setSelectedId(running.executionId);
      }
    }
  }, [selectedId, list, fetchDetail]);

  // Poll detail when RUNNING
  useEffect(() => {
    if (!detail || detail.status !== 'RUNNING') return;
    const t = setInterval(() => {
      fetchDetail(detail.executionId);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [detail?.executionId, detail?.status, fetchDetail]);

  const hasErrorDetails =
    (detail?.lastValidationResult && !detail.lastValidationResult.valid) ||
    detail?.error ||
    detail?.cause;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-serif font-bold tracking-tight text-stone-900">
          Case generation
        </h1>
        <Link
          to="/"
          className="text-sm text-stone-600 hover:text-stone-900"
        >
          ← Home
        </Link>
      </div>

      <section className="rounded-lg border border-stone-200 bg-white shadow-sm overflow-hidden">
        <h2 className="text-lg font-serif font-semibold px-4 py-3 border-b border-stone-200 bg-stone-50">
          Executions
        </h2>
        {loading && (
          <div className="p-4 text-stone-500">Loading…</div>
        )}
        {listError && (
          <div className="p-4 bg-red-50 text-red-800 text-sm">{listError}</div>
        )}
        {!loading && !listError && list.length === 0 && (
          <div className="p-4 text-stone-500">No executions found.</div>
        )}
        {!loading && !listError && list.length > 0 && (
          <ul className="divide-y divide-stone-200">
            {list.map((exec) => (
              <li key={exec.executionId}>
                <button
                  type="button"
                  onClick={() => setSelectedId(exec.executionId)}
                  className={`w-full text-left px-4 py-3 hover:bg-stone-50 transition-colors flex flex-wrap items-center gap-2 ${
                    selectedId === exec.executionId ? 'bg-amber-50/60' : ''
                  }`}
                >
                  <span className="font-mono text-sm text-stone-600 truncate max-w-[12rem]" title={exec.executionId}>
                    {exec.executionId}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${statusBadge(exec.status)}`}>
                    {exec.status}
                  </span>
                  {exec.caseDate && (
                    <span className="text-sm text-stone-500">{exec.caseDate}</span>
                  )}
                  <span className="text-xs text-stone-400">{formatDateTime(exec.startDate)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail && (
        <section className="rounded-lg border border-stone-200 bg-white shadow-sm overflow-hidden">
          <h2 className="text-lg font-serif font-semibold px-4 py-3 border-b border-stone-200 bg-stone-50">
            Detail
          </h2>
          {detailError && (
            <div className="p-4 bg-red-50 text-red-800 text-sm">{detailError}</div>
          )}
          {!detailError && (
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-stone-500">Title</span>
                  <p className="font-medium text-stone-900">{detail.caseSummary.title ?? '—'}</p>
                </div>
                <div>
                  <span className="text-stone-500">Date / era</span>
                  <p className="font-medium text-stone-900">
                    {detail.caseSummary.date ?? '—'}
                    {detail.caseSummary.era ? ` · ${detail.caseSummary.era}` : ''}
                  </p>
                </div>
                <div>
                  <span className="text-stone-500">Difficulty</span>
                  <p className="font-medium text-stone-900">{detail.caseSummary.difficulty ?? '—'}</p>
                </div>
                <div>
                  <span className="text-stone-500">Crime type</span>
                  <p className="font-medium text-stone-900">{detail.caseSummary.crimeType ?? '—'}</p>
                </div>
                <div>
                  <span className="text-stone-500">Narrative tone</span>
                  <p className="font-medium text-stone-900">{detail.caseSummary.narrativeTone ?? '—'}</p>
                </div>
                <div>
                  <span className="text-stone-500">Mystery style</span>
                  <p className="font-medium text-stone-900">{detail.caseSummary.mysteryStyle ?? '—'}</p>
                </div>
                {detail.caseSummary.modelConfig && (
                  <div className="sm:col-span-2">
                    <span className="text-stone-500">Model config</span>
                    <p className="font-mono text-xs text-stone-700 mt-0.5">
                      default: {detail.caseSummary.modelConfig.default}
                      {detail.caseSummary.modelConfig.steps &&
                        Object.keys(detail.caseSummary.modelConfig.steps).length > 0 &&
                        ` · steps: ${JSON.stringify(detail.caseSummary.modelConfig.steps)}`}
                    </p>
                  </div>
                )}
              </div>

              <div>
                <span className="text-stone-500 text-sm block mb-1">Current step</span>
                <PipelineGraph
                  currentStep={detail.currentStep}
                  status={detail.status}
                  onStepLabel={(s) => STEP_LABELS[s] ?? s}
                />
              </div>

              {detail.lastStepStartedAt && (
                <p className="text-xs text-stone-500">
                  Step started: {formatDateTime(detail.lastStepStartedAt)}
                </p>
              )}

              {hasErrorDetails && (
                <div>
                  <button
                    type="button"
                    onClick={() => setErrorDetailOpen(true)}
                    className="text-sm text-amber-800 hover:text-amber-900 font-medium underline"
                  >
                    {detail.lastValidationResult && !detail.lastValidationResult.valid
                      ? 'View validation details'
                      : 'View error details'}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {errorDetailOpen && detail && (
        <ErrorDetailModal
          title={detail.lastValidationResult && !detail.lastValidationResult.valid ? 'Validation failed' : 'Execution error'}
          validationResult={detail.lastValidationResult}
          executionError={detail.error}
          executionCause={detail.cause}
          onClose={() => setErrorDetailOpen(false)}
        />
      )}
    </div>
  );
}
