import type { CasebookEntry, Character, Fact } from '@shared/index';

interface CasebookEntryViewProps {
  entry: CasebookEntry;
  characters: Record<string, Character>;
  facts: Record<string, Fact>;
  isNewVisit: boolean;
  /** When false, "New facts discovered" is hidden until user has acknowledged the facts spoiler warning. */
  showNewFactsDiscovered?: boolean;
}

export function CasebookEntryView({
  entry,
  characters,
  facts,
  isNewVisit,
  showNewFactsDiscovered = false,
}: CasebookEntryViewProps) {
  const presentCharacters = entry.characters
    .map((id) => characters[id])
    .filter(Boolean);

  const revealedFacts = entry.revealsFactIds
    .map((id) => facts[id])
    .filter(Boolean);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-serif font-semibold">{entry.label}</h2>
        <p className="text-sm text-stone-500">{entry.address}</p>
      </div>

      <div className="space-y-4">
        {entry.scene.split('\n').filter(p => p.trim()).map((paragraph, i) => (
          <p key={i} className="text-stone-700 leading-relaxed">
            {paragraph}
          </p>
        ))}
      </div>

      {presentCharacters.length > 0 && (
        <div className="border-t border-stone-200 pt-4">
          <h4 className="text-sm font-semibold text-stone-500 mb-2">
            Present at this location
          </h4>
          <div className="flex flex-wrap gap-2">
            {presentCharacters.map((char) => (
              <span
                key={char.characterId}
                className="inline-flex items-center px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 text-sm text-amber-800"
              >
                {char.name}
                <span className="ml-1.5 text-xs text-amber-600">
                  ({char.societalRole})
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {showNewFactsDiscovered && isNewVisit && revealedFacts.length > 0 && (
        <div className="border-t border-stone-200 pt-4">
          <h4 className="text-sm font-semibold text-emerald-700 mb-2">
            New facts discovered
          </h4>
          <ul className="space-y-1">
            {revealedFacts.map((fact) => (
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
  );
}
