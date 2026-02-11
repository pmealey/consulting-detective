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
  generateTemplate: 'Generate Template',
  generateEvents: 'Generate Events',
  computeEventKnowledge: 'Compute Event Knowledge',
  generateCharacters: 'Generate Characters',
  generateLocations: 'Generate Locations',
  computeFacts: 'Compute Facts',
  generateFacts: 'Generate Facts',
  generateIntroduction: 'Generate Introduction',
  generateCasebook: 'Generate Casebook',
  generateProse: 'Generate Prose',
  generateQuestions: 'Generate Questions',
  computeOptimalPath: 'Compute Optimal Path',
  storeCase: 'Store Case',
};

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

/** One draft = one full detail card (draft-driven list from GET /generation/drafts). */
interface DraftListItem {
  draftId: string;
  status: string;
  startDate: string;
  stopDate?: string;
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
    <div className="flex flex-wrap gap-x-1 gap-y-2 items-center">
      {PIPELINE_STEPS.map((step, i) => {
        const stepStatus = getStepStatus(step);
        const label = onStepLabel?.(step) ?? STEP_LABELS[step] ?? step;
        return (
          <span key={step} className="flex items-center gap-0.5 shrink-0">
            {i > 0 && <span className="text-stone-300 text-xs shrink-0">→</span>}
            <span
              title={label}
              className={`text-xs px-2 py-1 rounded whitespace-nowrap ${
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
  const hasExecutionError = executionError || executionCause;
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
          {hasExecutionError && (
            <div>
              {/* Cause is the full message; error is the short code (e.g. QuestionsInvalid) */}
              {executionCause && (
                <div className="mb-2">
                  <p className="font-medium text-stone-800 mb-1">Details</p>
                  <p className="text-stone-700 whitespace-pre-wrap">{executionCause}</p>
                </div>
              )}
              {executionError && (
                <p className="text-stone-500 text-xs font-mono">
                  Error code: {executionError}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DraftCard({
  draft,
  onViewError,
}: {
  draft: DraftListItem;
  onViewError: () => void;
}) {
  const hasErrorDetails =
    (draft.lastValidationResult && !draft.lastValidationResult.valid) ||
    draft.error ||
    draft.cause;

  const hasTemplate = draft.caseSummary.title ?? draft.caseSummary.narrativeTone ?? draft.caseSummary.crimeType ?? draft.caseSummary.mysteryStyle;

  return (
    <div className="rounded-lg border border-stone-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-stone-200 bg-stone-50 flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-stone-600 truncate max-w-[14rem]" title={draft.draftId}>
          {draft.draftId}
        </span>
        <span className={`text-xs px-1.5 py-0.5 rounded ${statusBadge(draft.status)}`}>
          {draft.status}
        </span>
        <span className="text-xs text-stone-400">{formatDateTime(draft.startDate)}</span>
      </div>
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-stone-500">Title</span>
            <p className="font-medium text-stone-900">{draft.caseSummary.title ?? '—'}</p>
          </div>
          <div>
            <span className="text-stone-500">Date / era</span>
            <p className="font-medium text-stone-900">
              {draft.caseSummary.date ?? '—'}
              {draft.caseSummary.era ? ` · ${draft.caseSummary.era}` : ''}
            </p>
          </div>
          <div>
            <span className="text-stone-500">Difficulty</span>
            <p className="font-medium text-stone-900">{draft.caseSummary.difficulty ?? '—'}</p>
          </div>
          <div>
            <span className="text-stone-500">Crime type</span>
            <p className="font-medium text-stone-900">{draft.caseSummary.crimeType ?? '—'}</p>
          </div>
          <div>
            <span className="text-stone-500">Narrative tone</span>
            <p className="font-medium text-stone-900">{draft.caseSummary.narrativeTone ?? '—'}</p>
          </div>
          <div>
            <span className="text-stone-500">Mystery style</span>
            <p className="font-medium text-stone-900">{draft.caseSummary.mysteryStyle ?? '—'}</p>
          </div>
          {draft.caseSummary.modelConfig && (
            <div className="sm:col-span-2">
              <span className="text-stone-500">Model config</span>
              <p className="font-mono text-xs text-stone-700 mt-0.5">
                default: {draft.caseSummary.modelConfig.default}
                {draft.caseSummary.modelConfig.steps &&
                  Object.keys(draft.caseSummary.modelConfig.steps).length > 0 &&
                  ` · steps: ${JSON.stringify(draft.caseSummary.modelConfig.steps)}`}
              </p>
            </div>
          )}
        </div>

        {!hasTemplate && (
          <p className="text-xs text-stone-500">
            Title, crime type, tone and style appear after the Template step completes.
          </p>
        )}

        <div>
          <span className="text-stone-500 text-sm block mb-1">Current step</span>
          <PipelineGraph
            currentStep={draft.currentStep}
            status={draft.status}
            onStepLabel={(s) => STEP_LABELS[s] ?? s}
          />
        </div>

        {draft.lastStepStartedAt && (
          <p className="text-xs text-stone-500">
            Step started: {formatDateTime(draft.lastStepStartedAt)}
          </p>
        )}

        {hasErrorDetails && (
          <div>
            <button
              type="button"
              onClick={onViewError}
              className="text-sm text-amber-800 hover:text-amber-900 font-medium underline"
            >
              {draft.lastValidationResult && !draft.lastValidationResult.valid
                ? 'View validation details'
                : 'View error details'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function GenerationPage() {
  const [drafts, setDrafts] = useState<DraftListItem[]>([]);
  const [errorDetailDraft, setErrorDetailDraft] = useState<DraftListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const fetchDrafts = useCallback(() => {
    api
      .get<DraftListItem[]>('/generation/drafts')
      .then((res) => {
        if (res.success) setDrafts(res.data);
        else setListError(res.error.message);
      })
      .catch((err) => setListError(err instanceof Error ? err.message : 'Failed to load drafts'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  // Poll while the page is mounted so running drafts update (every 8s)
  useEffect(() => {
    const t = setInterval(fetchDrafts, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [fetchDrafts]);

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

      <p className="text-sm text-stone-600">
        Drafts that are currently generating or finished in the last 24 hours.
      </p>

      {loading && (
        <div className="rounded-lg border border-stone-200 bg-white p-6 text-stone-500">
          Loading…
        </div>
      )}
      {listError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 text-sm">
          {listError}
        </div>
      )}
      {!loading && !listError && drafts.length === 0 && (
        <div className="rounded-lg border border-stone-200 bg-white p-6 text-stone-500">
          No active or recent drafts.
        </div>
      )}
      {!loading && !listError && drafts.length > 0 && (
        <ul className="space-y-4">
          {drafts.map((draft) => (
            <li key={draft.draftId}>
              <DraftCard
                draft={draft}
                onViewError={() => setErrorDetailDraft(draft)}
              />
            </li>
          ))}
        </ul>
      )}

      {errorDetailDraft && (
        <ErrorDetailModal
          title={
            errorDetailDraft.lastValidationResult && !errorDetailDraft.lastValidationResult.valid
              ? 'Validation failed'
              : 'Execution error'
          }
          validationResult={errorDetailDraft.lastValidationResult}
          executionError={errorDetailDraft.error}
          executionCause={errorDetailDraft.cause}
          onClose={() => setErrorDetailDraft(null)}
        />
      )}
    </div>
  );
}
