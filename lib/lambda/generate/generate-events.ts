import { callModel } from '../shared/bedrock';
import {
  EventsSchema,
  type CaseGenerationState,
} from '../shared/generation-state';

/**
 * Pipeline Step 2: Generate Causal Event Chain
 *
 * Fills the template's event slots with specific details:
 * agents, locations, timestamps, involvement maps, and causality edges.
 */
export const handler = async (state: CaseGenerationState): Promise<CaseGenerationState> => {
  const { input, template } = state;

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
  "reveals": string[]             // factId placeholders this event would reveal to witnesses (e.g. "fact_suspect_left_handed", "fact_cloth_scrap")
}

Involvement types: "agent", "participant", "witness_direct", "witness_visual", "witness_auditory", "informed_after", "discovered_evidence"
- "witness_direct" is a generic witness who was present and observed the event.
- "witness_visual" is a witness who saw the event happen from another location.
- "witness_auditory" is a witness who heard the event happen from another location.
- "informed_after" is a witness who learned about the event secondhand, after the fact.
- "discovered_evidence" is a witness who found physical evidence of the event later.

Guidelines:
- Create one event per template slot, using the slotId as the basis for eventId.
- The agent in each event must reference a roleId from the template's characterRoles.
- Every event must have at least the agent in its involvement map (with type "agent").
- Timestamps should be sequential integers starting at 0.
- Each event should reveal 1-3 facts (as placeholder factIds like "fact_suspect_left_handed", "fact_cloth_scrap").
- The causes array should reference other eventIds that this event leads to (forward edges in the DAG).
- Ensure the causal DAG is acyclic and connected.
- Location references should be descriptive placeholders (e.g. "loc_pub", "loc_victim_home") — they'll be fully defined in a later step.
- Remember: the "reveals" array means "a witness to this event would learn these facts" — NOT "a detective investigating would find these clues".
- INVOLVEMENT DENSITY: Most events should involve 3+ characters (the agent plus at least 2 others as participants, witnesses, or bystanders). This is critical — multiple sources of information per fact make the mystery investigable from different angles.
- Only 1-2 key events (e.g. a secret act of sabotage, a solitary theft) should have just the agent or agent + one other. If an event happens in a public or semi-public place, think about who else was nearby.`;

  const eventValidationResult = state.eventValidationResult;
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
    eventValidationResult && !eventValidationResult.valid
      ? `

## IMPORTANT — PREVIOUS ATTEMPT FAILED VALIDATION

Your previous output failed validation. You MUST fix these errors:

${eventValidationResult.errors.map((e) => `- ${e}`).join('\n')}`
      : ''
  }`;

  const { data: events } = await callModel(
    {
      stepName: 'generateEvents',
      systemPrompt,
      userPrompt,
      modelConfig: input.modelConfig,
      outputTokens: 2048,
      thinkingTokens: 4096,
      temperature: 0.8,
    },
    (raw) => EventsSchema.parse(raw),
  );

  return {
    ...state,
    events,
  };
};
