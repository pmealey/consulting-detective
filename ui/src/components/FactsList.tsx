import type { Fact, FactCategory, Character, Location } from '@shared/index';

const categoryLabels: Record<FactCategory, string> = {
  motive: 'Motive',
  means: 'Means',
  opportunity: 'Opportunity',
  alibi: 'Alibi',
  relationship: 'Relationship',
  timeline: 'Timeline',
  physical_evidence: 'Physical Evidence',
  background: 'Background',
};

const categoryOrder: FactCategory[] = [
  'motive',
  'means',
  'opportunity',
  'alibi',
  'relationship',
  'timeline',
  'physical_evidence',
  'background',
];

interface FactsListProps {
  facts: Record<string, Fact>;
  discoveredFactIds: string[];
  characters: Record<string, Character>;
  locations: Record<string, Location>;
  discoveredSubjectIds: string[];
}

export function FactsList({
  facts,
  discoveredFactIds,
  characters,
  locations,
  discoveredSubjectIds,
}: FactsListProps) {
  const discoveredFacts = discoveredFactIds
    .map((id) => facts[id])
    .filter(Boolean);

  const discoveredPeople = discoveredSubjectIds
    .filter((id) => id in characters)
    .map((id) => ({ id, name: characters[id].name }));
  const discoveredPlaces = discoveredSubjectIds
    .filter((id) => id in locations)
    .map((id) => ({ id, name: locations[id].name }));
  const hasSubjects = discoveredPeople.length > 0 || discoveredPlaces.length > 0;

  if (discoveredFacts.length === 0 && !hasSubjects) {
    return (
      <div className="text-sm text-stone-400 italic">
        No facts discovered yet. Visit casebook entries to uncover clues.
      </div>
    );
  }

  // Group facts by category (person/place removed; only the 8 fact categories)
  const grouped: Partial<Record<FactCategory, Fact[]>> = {};
  for (const fact of discoveredFacts) {
    if (!grouped[fact.category]) {
      grouped[fact.category] = [];
    }
    grouped[fact.category]!.push(fact);
  }

  return (
    <div className="space-y-4">
      {hasSubjects && (
        <div>
          <h3 className="text-sm font-semibold text-stone-500 uppercase tracking-wide mb-2">
            People &amp; Places
          </h3>
          <div className="flex flex-wrap gap-4">
            {discoveredPeople.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-1">
                  People
                </h4>
                <ul className="space-y-0.5">
                  {discoveredPeople.map(({ id, name }) => (
                    <li key={id} className="text-sm text-stone-700">
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {discoveredPlaces.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-1">
                  Places
                </h4>
                <ul className="space-y-0.5">
                  {discoveredPlaces.map(({ id, name }) => (
                    <li key={id} className="text-sm text-stone-700">
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {discoveredFacts.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-stone-500 uppercase tracking-wide">
            Discovered Facts ({discoveredFacts.length})
          </h3>
          {categoryOrder
            .filter((cat) => grouped[cat])
            .map((category) => (
              <div key={category}>
                <h4 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-1">
                  {categoryLabels[category]}
                </h4>
                <ul className="space-y-1">
                  {grouped[category]!.map((fact) => (
                    <li
                      key={fact.factId}
                      className="text-sm text-stone-700 pl-3 border-l-2 border-stone-200"
                    >
                      {fact.description}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </>
      )}
    </div>
  );
}
