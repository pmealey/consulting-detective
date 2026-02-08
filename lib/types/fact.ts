/**
 * Fact and KnowledgeStatus -- the knowledge model.
 *
 * Inverts the moonstone-packet's build_knowledge_state_graph.py: a bipartite
 * model where Facts are the atoms of the mystery and KnowledgeStatus tracks
 * what each character knows about each fact.
 *
 * Facts are the bridge between the narrative (events, characters) and the
 * game mechanic (casebook entries reveal facts, questions require facts).
 * A fact is a red herring if it appears in no question's requiredFacts --
 * this is derivable, not stored.
 */

export interface Fact {
  /** Unique identifier, e.g. "fact_victim_left_handed" */
  factId: string;

  /** Human-readable description, e.g. "The victim was left-handed" */
  description: string;

  /** What aspect of the mystery this fact relates to */
  category: FactCategory;
}

export type FactCategory =
  | 'motive'
  | 'means'
  | 'opportunity'
  | 'alibi'
  | 'relationship'
  | 'timeline'
  | 'physical_evidence'
  | 'background'
  | 'person'
  | 'place';

/**
 * A character's knowledge status about a specific fact.
 * Used as values in Character.knowledgeState (Record<factId, KnowledgeStatus>).
 *
 * - 'knows': Character has accurate knowledge of this fact
 * - 'suspects': Character has an inkling but isn't certain
 * - 'believes_false': Character actively believes the opposite
 * - 'unknown': Character has no awareness of this fact (implicit default)
 */
export type KnowledgeStatus = 'knows' | 'suspects' | 'believes_false' | 'unknown';
