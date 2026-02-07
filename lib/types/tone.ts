/**
 * ToneProfile -- lightweight voice specification for NPC dialogue.
 *
 * Derived from the moonstone-packet's TONE.md: the "felt quality" of each
 * narrator's voice. Used during scene generation to give each character
 * a distinctive way of speaking.
 */

export interface ToneProfile {
  /** Speech register, e.g. "formal", "nervous", "brusque", "folksy", "evasive" */
  register: string;

  /** Characteristic words or phrases this character uses */
  vocabulary: string[];

  /** Optional speech quirk, e.g. "Always mentions the weather", "Speaks in questions" */
  quirk?: string;
}
