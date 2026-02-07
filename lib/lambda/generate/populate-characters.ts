import { callModel } from '../shared/bedrock';
import {
  PopulateCharactersResultSchema,
  type CaseGenerationState,
  type EventDraft,
} from '../shared/generation-state';

/**
 * Pipeline Step 3: Populate Characters
 *
 * Takes the template's character roles and the event chain, then creates
 * fully fleshed-out characters with names, personalities, knowledge states,
 * motivations, secrets, and tone profiles.
 *
 * Also produces a roleId -> characterId mapping that is used to rewrite
 * all role ID placeholders in the event chain with real character IDs.
 */
export const handler = async (state: CaseGenerationState): Promise<CaseGenerationState> => {
  const { input, template, events } = state;

  if (!template) throw new Error('Step 3 requires template from step 1');
  if (!events) throw new Error('Step 3 requires events from step 2');

  const eventSummary = Object.values(events)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((e) => `  - ${e.eventId} (t=${e.timestamp}): ${e.description} [agent: ${e.agent}]`)
    .join('\n');

  const systemPrompt = `You are a character designer for a mystery game. Given a case template and event chain, you create vivid, believable characters that inhabit the story.

First, briefly reason through each character: their personality, what makes them distinctive, how their knowledge and secrets connect to the events. Then provide the JSON.

Your response must end with valid JSON matching this schema:
{
  "characters": Record<string, Character>,  // keyed by characterId
  "roleMapping": Record<string, string>     // roleId -> characterId (e.g. "role_victim" -> "char_ashford")
}

Each Character must match:
{
  "characterId": string,           // e.g. "char_pemberton"
  "name": string,                  // full name, e.g. "Arthur Pemberton"
  "role": string,                  // narrative role, e.g. "Victim's business partner"
  "description": string,           // physical/personality sketch (2-3 sentences)
  "wants": string[],               // motivations (1-3 items)
  "hides": string[],               // factIds or free-text secrets they conceal
  "knowledgeState": Record<string, string>,  // factId -> "knows" | "suspects" | "believes_false"
  "tone": {
    "register": string,            // e.g. "formal", "nervous", "brusque"
    "vocabulary": string[],        // 3-5 characteristic words/phrases
    "quirk": string | undefined    // optional speech quirk
  }
}

CRITICAL: The "roleMapping" must map EVERY roleId from the template to the characterId you create for it. This mapping is used to replace role placeholders in the event chain with real character IDs.

Guidelines:
- Create one character per template role. The characterId should be name-based (e.g. role_suspect_1 -> char_blackwood).
- Each character's knowledgeState should reference the fact placeholders from the event chain (e.g. "fact_01": "knows").
- Knowledge must be consistent with event involvement: a character can only "know" a fact if they were involved in an event that reveals it (agent, participant, witness_visual, witness_auditory) or were informed_after.
- Characters who hide something should have that reflected in both their "hides" array and their motivations.
- Each character should have a distinctive tone that reflects their personality and social station.
- Names should fit the era: ${template.era}.
- Avoid stereotypes. Make characters feel like real people with contradictions.`;

  const userPrompt = `Here is the case context:

Crime Type: ${template.crimeType}
Title: ${template.title}
Setting: ${template.era}, ${template.date}

Character Roles:
${template.characterRoles.map((r) => `  - ${r.roleId}: ${r.role} — ${r.description}`).join('\n')}

Event Chain (chronological):
${eventSummary}

Event Involvement Details:
${Object.values(events).map((e) => `  ${e.eventId}: ${JSON.stringify(e.involvement)}`).join('\n')}

Facts revealed by events:
${Object.values(events).map((e) => `  ${e.eventId} reveals: [${e.reveals.join(', ')}]`).join('\n')}

Create the full character set with the roleMapping. Think through each character's personality and voice first, then provide the JSON.`;

  const { data: result } = await callModel(
    {
      stepName: 'populateCharacters',
      systemPrompt,
      userPrompt,
      modelConfig: input.modelConfig,
      maxTokens: 4096,
      temperature: 0.8,
    },
    (raw) => PopulateCharactersResultSchema.parse(raw),
  );

  // Remap role ID placeholders in events to real character IDs
  const { characters, roleMapping } = result;
  const remappedEvents: Record<string, EventDraft> = {};

  for (const [eventId, event] of Object.entries(events)) {
    const newAgent = roleMapping[event.agent] ?? event.agent;
    const newInvolvement: Record<string, string> = {};
    for (const [roleOrCharId, invType] of Object.entries(event.involvement)) {
      const charId = roleMapping[roleOrCharId] ?? roleOrCharId;
      newInvolvement[charId] = invType;
    }

    remappedEvents[eventId] = {
      ...event,
      agent: newAgent,
      involvement: newInvolvement,
    };
  }

  return {
    ...state,
    characters,
    events: remappedEvents,
  };
};
