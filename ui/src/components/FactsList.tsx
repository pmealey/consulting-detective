import type { Fact, FactCategory } from '@shared/index';

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
}

export function FactsList({ facts, discoveredFactIds }: FactsListProps) {
  const discoveredFacts = discoveredFactIds
    .map((id) => facts[id])
    .filter(Boolean);

  if (discoveredFacts.length === 0) {
    return (
      <div className="text-sm text-stone-400 italic">
        No facts discovered yet. Visit casebook entries to uncover clues.
      </div>
    );
  }

  // Group by category
  const grouped: Partial<Record<FactCategory, Fact[]>> = {};
  for (const fact of discoveredFacts) {
    if (!grouped[fact.category]) {
      grouped[fact.category] = [];
    }
    grouped[fact.category]!.push(fact);
  }

  return (
    <div className="space-y-4">
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
    </div>
  );
}
