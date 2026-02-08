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
  entries: Record<string, CasebookEntry>;
  visitedEntryIds: string[];
  selectedEntryId: string | null;
  onSelectEntry: (entryId: string) => void;
}

export function CasebookList({
  entries,
  visitedEntryIds,
  selectedEntryId,
  onSelectEntry,
}: CasebookListProps) {
  const visitedSet = new Set(visitedEntryIds);
  const entryList = Object.values(entries);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-stone-500 uppercase tracking-wide">
        Casebook ({visitedSet.size}/{entryList.length} visited)
      </h3>
      <ul className="space-y-1">
        {entryList.map((entry) => {
          const visited = visitedSet.has(entry.entryId);
          const selected = entry.entryId === selectedEntryId;

          return (
            <li key={entry.entryId}>
              <button
                onClick={() => onSelectEntry(entry.entryId)}
                className={`w-full text-left px-3 py-2 rounded-md transition-colors ${
                  selected
                    ? 'bg-stone-800 text-white'
                    : visited
                      ? 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                      : 'bg-white text-stone-900 hover:bg-stone-50 border border-stone-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                    visited ? 'bg-green-500' : 'bg-stone-300'
                  }`} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate">{entry.label}</div>
                    <div className={`text-xs truncate ${
                      selected ? 'text-stone-300' : 'text-stone-500'
                    }`}>
                      {entry.address}
                    </div>
                  </div>
                  <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                    selected ? 'bg-stone-700 text-stone-300' : typeColors[entry.type] ?? 'bg-stone-100 text-stone-600'
                  }`}>
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
