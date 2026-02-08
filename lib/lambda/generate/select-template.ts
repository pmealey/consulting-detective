import { callModel } from '../shared/bedrock';
import {
  CaseTemplateSchema,
  type CaseGenerationState,
} from '../shared/generation-state';

/**
 * Pipeline Step 1: Select Case Template
 *
 * Given difficulty + optional crime type, generates a template:
 * crime type, required event slots, character roles, era/setting.
 */
export const handler = async (state: CaseGenerationState): Promise<CaseGenerationState> => {
  const { input } = state;
  const difficulty = input.difficulty ?? 'medium';

  const systemPrompt = `You are a mystery case designer for a detective game set in various eras and settings. Your job is to create a case template — the structural blueprint for a mystery.

CRITICAL DISTINCTION — Story Events vs. Investigation:
Event slots describe THE STORY — things that actually happened BEFORE or DURING the crime, from the perspective of the people involved. They are NOT the investigation that follows. The player's investigation is a separate game mechanic (the casebook) built later.

Good event examples:
- "Crane discovers Hartley seduced and abandoned his daughter" (a thing that happened)
- "Blackwell secretly increases the theater's insurance policy" (a thing that happened)
- "Crane tampers with the chandelier rigging after hours" (a thing that happened)
- "The chandelier falls during the second act, injuring Hartley" (a thing that happened)

Bad event examples (these describe INVESTIGATION, not story):
- "Police are called to investigate" (investigation)
- "Detectives discover the owner's financial troubles" (investigation)
- "Ashford's alibi is confirmed" (investigation)
- "Crane confesses under interrogation" (investigation)

The events should read like a timeline a omniscient narrator would write: "First this happened, which caused that, which led to this." The player will piece this timeline together by visiting casebook entries — but the events themselves are the underlying truth of what occurred.

First, briefly think through your creative decisions (crime type, era, how the events connect, what makes this mystery interesting). Then provide the JSON.

Your response must end with valid JSON matching this schema:
{
  "crimeType": string,       // e.g. "murder", "theft", "blackmail", "forgery", "smuggling"
  "title": string,           // evocative case title, e.g. "The Affair of the Tarnished Locket"
  "era": string,             // e.g. "Victorian London, 1893", "New York City, 1921", "Aldrin Orbital Station, 2072"
  "date": string,            // in-world date, e.g. "14 March 1893", "November 10, 1921", "December 25, 2072"
  "atmosphere": string,      // atmospheric description, e.g. "A damp, fog-choked evening"
  "eventSlots": [            // 5-10 events forming the causal spine
    {
      "slotId": string,      // e.g. "E01_inciting_incident"
      "description": string, // what HAPPENED (not what was discovered)
      "necessity": "required" | undefined,
      "causedBy": string[]   // slotIds of events that cause this one (empty for root events)
    }
  ],
  "characterRoles": [        // 3-8 character roles needed
    {
      "roleId": string,      // e.g. "role_victim", "role_suspect_1"
      "role": string,        // e.g. "Victim", "Business Partner", "Landlady"
      "description": string  // what this role does in the STORY (not the investigation)
    }
  ],
  "difficulty": "${difficulty}"
}

Guidelines:
- For "easy" difficulty: 5-6 events, 5-6 characters, straightforward motive
- For "medium" difficulty: 6-8 events, 6-8 characters, one red herring thread
- For "hard" difficulty: 8-10 events, 8-12 characters, multiple misleading threads
- Event slots form a DAG via causedBy. At least one root event (empty causedBy) must exist.
- At least 3 events must be "required" (form the narrative spine).
- Include roles for: at least one victim (or wronged party), at least one genuine suspect, and at least one red herring character.
- Other roles can be things like witnesses, unreliable witnesses, bystanders, victim's husband or suspect's friend, victim's employee, etc.
- The crime type should be specific, not generic. "Theft of shipping manifests to cover embezzlement" is better than "theft".
- Every event must be something that HAPPENED in the world, not something the police/detective discovered or concluded.`;

  const crimeHint = input.crimeType
    ? `The crime should involve or relate to: ${input.crimeType}.`
    : 'Choose an interesting and original crime type.';

  const userPrompt = `Create a case template for a ${difficulty}-difficulty mystery.

${crimeHint}

Think through your creative choices first, then provide the JSON object.`;

  const { data: template } = await callModel(
    {
      stepName: 'selectTemplate',
      systemPrompt,
      userPrompt,
      modelConfig: input.modelConfig,
    },
    (raw) => CaseTemplateSchema.parse(raw),
  );

  return {
    ...state,
    template,
  };
};
