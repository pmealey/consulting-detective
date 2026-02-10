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

  /**
   * Narrative/mystery role (e.g. victim, witness) — used in generation only.
   * Not displayed in the game UI; use societalRole for that.
   */
  mysteryRole: string;

  /**
   * Role in society (occupation/station), e.g. "Landlady", "Business partner".
   * This is the only role label shown to the player. Optional for backward compatibility.
   */
  societalRole: string;

  /** Brief physical/personality sketch for generation context */
  description: string;

  /**
   * Freeform narrative motivations: desires, fears, secrets, grudges, loyalties.
   * Includes both positive drives ("wants to inherit the estate") and concealed
   * information ("secretly in debt to the victim"). Used by prose generation
   * for narrative color — not mechanical.
   */
  motivations: string[];

  /**
   * What this character knows about each fact.
   * Keyed by factId -> their knowledge status.
   * Only facts the character has *some* relationship to need be included;
   * absent entries are implicitly unknown (no awareness).
   *
   * Values: 'knows' | 'suspects' | 'hides' | 'denies' | 'believes'
   * See KnowledgeStatus in fact.ts for semantics.
   */
  knowledgeState: Record<string, KnowledgeStatus>;

  /** How this character speaks -- voice specification for scene generation */
  tone: ToneProfile;

  /**
   * Freeform status at investigation time (e.g. "deceased", "missing", "imprisoned", "traveling").
   * Used by casebook and prose generation to decide who can be visited or interviewed and how.
   * Optional; absent means no special constraint.
   */
  currentStatus?: string;
}
