/**
 * Character -- an NPC in the case.
 *
 * Inverts the moonstone-packet's CHARACTERS.md template: the know/want/hide triple
 * that defines each character's narrative role.
 *
 * Whether a character is "the culprit" is a narrative conclusion driven by the
 * questions and facts, not a property of the character itself. The player deduces
 * guilt from evidence; we don't label it here.
 */

import type { KnowledgeStatus } from './fact';
import type { ToneProfile } from './tone';

export interface Character {
  /** Unique identifier, e.g. "char_pemberton" */
  characterId: string;

  /** Display name, e.g. "Arthur Pemberton" */
  name: string;

  /** Narrative role, e.g. "Victim's business partner", "Landlady" */
  role: string;

  /** Brief physical/personality sketch for generation context */
  description: string;

  /** What this character wants -- motivations driving their behavior */
  wants: string[];

  /** What this character conceals -- factIds or free-text secrets */
  hides: string[];

  /**
   * What this character knows about each fact.
   * Keyed by factId -> their knowledge status.
   * Only facts the character has *some* relationship to need be included;
   * absent entries are implicitly 'unknown'.
   */
  knowledgeState: Record<string, KnowledgeStatus>;

  /** How this character speaks -- voice specification for scene generation */
  tone: ToneProfile;
}
