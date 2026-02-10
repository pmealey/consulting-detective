import { callModel } from '../shared/bedrock';
import { getDraft, updateDraft } from '../shared/draft-db';
import {
  EventsSchema,
  type OperationalState,
} from '../shared/generation-state';

/**
 * Pipeline Step 2: Generate Causal Event Chain
 *
 * Fills the template's event slots with specific details:
 * agents, locations, timestamps, involvement maps, and causality edges.
 */
export const handler = async (state: OperationalState): Promise<OperationalState> => {
  const { input, draftId } = state;
  const draft = await getDraft(draftId);
  const template = draft?.template;
  if (!template) throw new Error('Step 2 requires template from step 1');

  const systemPrompt = `You are a mystery narrative architect. Given a case template, you flesh out the event slots into a complete causal event chain — the backbone of what actually happened in the story.

CRITICAL: Events are things that HAPPENED in the world — actions taken by characters, incidents, confrontations, discoveries made by characters in the story. They are NOT investigation steps. The detective/player does not appear in any event. No event should describe police being called, detectives discovering things, suspects being interrogated, or alibis being confirmed. Those are investigation mechanics handled separately.

Every event should answer: "What did [character] do at [location] at [time]?"

Good: "Crane sneaks into the theater after hours and cuts the chandelier rigging"
Bad: "Police discover the rigging has been tampered with"

First, briefly reason through the narrative logic: how events connect causally, who witnesses what, and what facts emerge. Then provide the JSON.

Your response must end with valid JSON: a Record<string, Event> keyed by eventId.

Each event must match this schema:
{
  "eventId": string,              // e.g. "E01_argument_at_pub"
  "description": string,          // what HAPPENED — an action by a character, not a discovery by investigators
  "timestamp": number,            // ordering index (0-based, chronological)
  "agent": string,                // roleId of who performed this action (from template characterRoles)
  "location": string,             // locationId placeholder (e.g. "loc_pub", "loc_victim_home")
  "involvement": Record<string, string>,  // roleId -> involvement type
  "necessity": "required" | undefined,
  "causes": string[],             // eventIds this event causes/enables
  "reveals": EventReveal[]        // enriched fact reveals with perception channels
}

Each EventReveal must match:
{
  "id": string,                   // factId (e.g. "fact_suspect_left_handed")
  "audible": boolean,             // learnable by hearing (auditory witnesses can learn this)
  "visible": boolean,             // learnable by seeing (visual witnesses can learn this)
  "physical": boolean,            // leaves physical evidence discoverable later
  "subjects": string[]            // roleId/locationId references this fact is about (at least 1)
}

Involvement types: "agent", "present", "witness_visual", "witness_auditory", "discovered_evidence"
- "present" means the character was directly involved or present and observed the event.
- "witness_visual" is a witness who saw the event happen from another location.
- "witness_auditory" is a witness who heard the event happen from another location.
- "discovered_evidence" is a character who found physical evidence of the event later.

How perception channels work:
- agent/present always learn ALL reveals regardless of perception flags.
- witness_visual learns reveals where "visible" is true.
- witness_auditory learns reveals where "audible" is true.
- discovered_evidence learns reveals where "physical" is true.

Guidelines:
- Create one event per template slot, using the slotId as the basis for eventId.
- The agent in each event must reference a roleId from the template's characterRoles.
- Every event must have at least the agent in its involvement map (with type "agent").
- Timestamps should be sequential integers starting at 0.
- Each event should reveal 1-3 facts as EventReveal objects. For each reveal, think about whether it's audible (could be overheard), visible (could be seen from afar), and/or physical (leaves evidence behind). Set the subjects to the roleIds and/or locationIds the fact is about.
- The causes array should reference other eventIds that this event leads to (forward edges in the DAG).
- Ensure the causal DAG is acyclic and connected.
- Location references should be descriptive placeholders (e.g. "loc_pub", "loc_victim_home") — they'll be fully defined in a later step.
- Remember: the "reveals" array means "a witness to this event would learn these facts" — NOT "a detective investigating would find these clues".
- INVOLVEMENT DENSITY: Most events should involve 3+ characters (the agent plus at least 2 others as participants, witnesses, or bystanders). This is critical — multiple sources of information per fact make the mystery investigable from different angles.
- Only 1-2 key events (e.g. a secret act of sabotage, a solitary theft) should have just the agent or agent + one other. If an event happens in a public or semi-public place, think about who else was nearby.`;

  const validationResult = state.validationResult;
  const userPrompt = `Here is the case template to work from:

Crime Type: ${template.crimeType}
Title: ${template.title}
Setting: ${template.era}, ${template.date}
Atmosphere: ${template.atmosphere}

Event Slots:
${template.eventSlots.map((s) => `  - ${s.slotId}: ${s.description} (${s.necessity ? 'required' : 'optional'}, caused by: [${s.causedBy.join(', ')}])`).join('\n')}

Character Roles:
${template.characterRoles.map((r) => `  - ${r.roleId}: ${r.role} — ${r.description}`).join('\n')}

Generate the full event chain. Think through the causal logic first, then provide the JSON object keyed by eventId.${
    validationResult && !validationResult.valid
      ? `

## IMPORTANT — PREVIOUS ATTEMPT FAILED VALIDATION

Your previous output failed validation. You MUST fix these errors:

${validationResult.errors.map((e) => `- ${e}`).join('\n')}`
      : ''
  }`;

  const { data: events } = await callModel(
    {
      stepName: 'generateEvents',
      systemPrompt,
      userPrompt,
      modelConfig: input.modelConfig,
    },
    (raw) => EventsSchema.parse(raw),
  );

  await updateDraft(draftId, { events });
  return state;
};
