/**
 * Fact and KnowledgeStatus -- the knowledge model.
 *
 * Inverts the moonstone-packet's build_knowledge_state_graph.py: a bipartite
 * model where Facts are the atoms of the mystery and KnowledgeStatus tracks
 * what each character knows about each fact.
 *
 * Facts are the bridge between the narrative (events, characters) and the
 * game mechanic (casebook entries reveal facts, questions require facts).
 *
 * Each fact has subjects (characterIds and locationIds it is about) and a
 * veracity flag. False facts are discoverable but never correct answers --
 * they exist to model misinformation from characters who deny or believe
 * falsehoods.
 */

export interface Fact {
  /** Unique identifier, e.g. "fact_victim_left_handed" */
  factId: string;

  /** Human-readable description, e.g. "The victim was left-handed" */
  description: string;

  /** What aspect of the mystery this fact relates to */
  category: FactCategory;

  /** characterIds and locationIds this fact is about */
  subjects: string[];

  /** Whether this fact is true or false; false facts are discoverable but never correct answers */
  veracity: 'true' | 'false';
}

export type FactCategory =
  | 'motive'
  | 'means'
  | 'opportunity'
  | 'alibi'
  | 'relationship'
  | 'timeline'
  | 'physical_evidence'
  | 'background';

/**
 * A character's knowledge status about a specific fact.
 * Used as values in Character.knowledgeState (Record<factId, KnowledgeStatus>).
 *
 * - 'knows': aware of a true fact, willing to share
 * - 'suspects': partial awareness, will hint
 * - 'hides': aware of a true fact, will not share
 * - 'denies': aware of a true fact, actively claims the opposite
 *   (has a corresponding false fact they 'believes')
 * - 'believes': holds a false fact to be true, will share it confidently
 *
 * Absent entries are implicitly unknown (no awareness).
 */
export type KnowledgeStatus = 'knows' | 'suspects' | 'hides' | 'denies' | 'believes';
