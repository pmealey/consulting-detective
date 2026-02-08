import type { CasebookEntry } from '@shared/index';

const typeLabels: Record<string, string> = {
  location: 'Location',
  person: 'Person',
  document: 'Document',
  event: 'Event',
};

const typeColors: Record<string, string> = {
  location: 'bg-blue-100 text-blue-800',
  person: 'bg-amber-100 text-amber-800',
  document: 'bg-emerald-100 text-emerald-800',
  event: 'bg-purple-100 text-purple-800',
};

interface CasebookListProps {
  /** Filtered entries (only visible given current discovered facts). */
  entries: Record<string, CasebookEntry>;
  visitedEntryIds: string[];
  /** Entry ids that just became visible after the current visit (for "New lead!" indicator). */
  newlyVisibleEntryIds?: Set<string>;
  selectedEntryId: string | null;
  onSelectEntry: (entryId: string) => void;
}

export function CasebookList({
  entries,
  visitedEntryIds,
  newlyVisibleEntryIds,
  selectedEntryId,
  onSelectEntry,
}: CasebookListProps) {
  const visitedSet = new Set(visitedEntryIds);
  const entryList = Object.values(entries);
  const newlyVisible = newlyVisibleEntryIds ?? new Set<string>();

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-stone-500 uppercase tracking-wide">
        Casebook ({visitedSet.size}/{entryList.length} visited)
      </h3>
      <ul className="space-y-1">
        {entryList.map((entry) => {
          const visited = visitedSet.has(entry.entryId);
          const selected = entry.entryId === selectedEntryId;
          const isNewLead = newlyVisible.has(entry.entryId);

          return (
            <li
              key={entry.entryId}
              className={
                isNewLead
                  ? 'animate-[new-lead-in_0.4s_ease-out] rounded-md'
                  : undefined
              }
            >
              <button
                onClick={() => onSelectEntry(entry.entryId)}
                className={`w-full text-left px-3 py-2 rounded-md transition-colors ${
                  selected
                    ? 'bg-stone-800 text-white border-2 border-transparent'
                    : isNewLead
                      ? 'border-2 border-amber-300/80 bg-amber-50/80 shadow-sm hover:bg-amber-100/80 hover:border-amber-400/90 animate-[new-lead-glow_2s_ease-in-out_3]'
                      : visited
                        ? 'bg-stone-100 text-stone-600 hover:bg-stone-200 border border-stone-200'
                        : 'bg-white text-stone-900 hover:bg-stone-50 border border-stone-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block w-2 h-2 rounded-full flex-shrink-0 transition-colors ${
                      selected
                        ? 'bg-stone-400'
                        : isNewLead && !visited
                          ? 'bg-amber-500 ring-2 ring-amber-300/60'
                          : visited
                            ? 'bg-green-500'
                            : 'bg-stone-300'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className="font-medium text-sm break-words flex items-center gap-1.5 flex-wrap leading-snug"
                      title={entry.label}
                    >
                      {entry.label}
                      {isNewLead && !selected && (
                        <span className="inline-flex items-center gap-1.5 shrink-0 px-2 py-0.5 rounded-md text-xs font-semibold bg-gradient-to-r from-amber-400 to-amber-500 text-amber-950 shadow-sm ring-1 ring-amber-400/50">
                          <span className="inline-block size-1.5 rounded-full bg-amber-950/50 animate-pulse" />
                          New lead!
                        </span>
                      )}
                    </div>
                    <div
                      className={`text-xs break-words line-clamp-2 ${
                        selected ? 'text-stone-300' : 'text-stone-500'
                      }`}
                      title={entry.address}
                    >
                      {entry.address}
                    </div>
                  </div>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                      selected
                        ? 'bg-stone-700 text-stone-300'
                        : typeColors[entry.type] ??
                          'bg-stone-100 text-stone-600'
                    }`}
                  >
                    {typeLabels[entry.type] ?? entry.type}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
