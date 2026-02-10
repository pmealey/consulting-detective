import { callModel } from '../shared/bedrock';
import {
  PopulateCharactersResultSchema,
  type CaseGenerationState,
  type CharacterDraft,
  type ComputedKnowledge,
  type EventDraft,
} from '../shared/generation-state';

/**
 * Pipeline Step 3: Generate Characters
 *
 * Takes the template's character roles, the event chain, and the pre-computed
 * baseline knowledge from ComputeEventKnowledge, then creates fully fleshed-out
 * characters with names, personalities, knowledge states, motivations, secrets,
 * and tone profiles.
 *
 * The AI receives each role's baseline knowledge (what they would know from
 * event involvement) and can modify entries: downgrading 'knows' to 'suspects',
 * 'hides', or 'denies' based on character motivation. It can also add 'believes'
 * entries for false beliefs. It must NOT add new 'knows' entries beyond the baseline.
 *
 * Also produces a roleId -> characterId mapping that is used to rewrite
 * all role IDs in the event chain with real character IDs.
 */
export const handler = async (state: CaseGenerationState): Promise<CaseGenerationState> => {
  const { input, template, events, computedKnowledge } = state;

  if (!template) throw new Error('Step 3 requires template from step 1');
  if (!events) throw new Error('Step 3 requires events from step 2');
  if (!computedKnowledge) throw new Error('Step 3 requires computedKnowledge from step 2b (ComputeEventKnowledge)');

  const eventSummary = Object.values(events)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((e) => `  - ${e.eventId} (t=${e.timestamp}): ${e.description} [agent: ${e.agent}]`)
    .join('\n');

  const baselineKnowledgeSection = formatBaselineKnowledge(computedKnowledge, template.characterRoles);

  const systemPrompt = `You are a character designer for a mystery game. Given a case template, event chain, and pre-computed baseline knowledge, you create vivid, believable characters that inhabit the story.

First, briefly reason through each character: their personality, what makes them distinctive, how their motivations might lead them to conceal or distort what they know. Then provide the JSON.

Your response must end with valid JSON matching this schema:
{
  "characters": Record<string, Character>,  // keyed by characterId
  "roleMapping": Record<string, string>     // roleId -> characterId (e.g. "role_victim" -> "char_albert_ashford")
}

Each Character must match:
{
  "characterId": string,           // e.g. "char_arthur_pemberton"
  "name": string,                  // full name, e.g. "Arthur Pemberton"
  "mysteryRole": string,           // narrative/mystery role (e.g. victim/suspect — used in prompts only)
  "societalRole": string,          // occupation/station ONLY — e.g. "Landlady", "Business partner". This is shown to players. NEVER use Victim, Witness, Suspect here.
  "description": string,           // physical/personality sketch (2-3 sentences)
  "motivations": string[],         // desires, fears, secrets, grudges, loyalties (2-5 items)
  "knowledgeState": Record<string, string>,  // factId -> "knows" | "suspects" | "hides" | "denies" | "believes"
  "tone": {
    "register": string,            // e.g. "formal", "nervous", "brusque", etc.
    "vocabulary": string[],        // 3-5 characteristic words/phrases
    "quirk": string | undefined    // optional speech quirk
  },
  "currentStatus": string | undefined   // optional: status at investigation time, e.g. "deceased", "missing", "imprisoned", "traveling", "ill"
}

CRITICAL: The "roleMapping" must map EVERY roleId from the template to the characterId you create for it. This mapping is used to replace role IDs in the event chain with real character IDs.

## Knowledge State Rules

Each role's BASELINE knowledge has been pre-computed from event involvement. The baseline tells you what each role would logically know based on which events they participated in or witnessed. You receive this baseline below.

Your job is to START from the baseline and MODIFY entries based on character personality and motivation:

- You may KEEP an entry as "knows" (willing to share openly)
- You may DOWNGRADE an entry to "suspects" (partial awareness, will only hint)
- You may DOWNGRADE an entry to "hides" (aware but refuses to share — protecting themselves or someone else)
- You may DOWNGRADE an entry to "denies" (aware but actively claims the opposite — the corresponding false fact will be created programmatically later)
- You may ADD new "believes" entries for false beliefs the character holds (things they genuinely think are true but aren't)
- You must NOT add new "knows" entries that aren't in the baseline — if a character wasn't involved in an event, they can't know what it revealed
- Every fact from the baseline MUST appear in the character's knowledgeState (don't drop any)

## Other Guidelines
- Create one character per template role. The characterId should be name-based (e.g. role_suspect_1 -> char_charles_blackwood).
- The "motivations" array is for freeform narrative color — include both positive drives ("Wants to inherit the estate", "Loyal to the family name") and concealed information ("Secretly in debt to the victim", "Having an affair with the suspect's spouse"). These guide prose generation. Characters who hide or deny facts in their knowledgeState should have corresponding motivations explaining WHY.
- Each character should have a distinctive tone that reflects their personality and social station.
- Names should fit the era: ${template.era}.
- Names should be what the character will be known by during the investigation, not necessarily what their real name is.
- Avoid stereotypes. Make characters feel like real people with contradictions.
- Set currentStatus only when it affects whether or how the character can be met during the investigation. Omit for characters with no such constraint.
- societalRole must be their job or station in society (Landlady, Servant, Business partner, Inspector). Never put mystery labels (Victim, Witness, Suspect) in societalRole — those go in "mysteryRole" only.`;

  const characterValidationResult = state.characterValidationResult;
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
${Object.values(events).map((e) => `  ${e.eventId} reveals: [${e.reveals.map((r) => `${r.id} (subjects: ${r.subjects.join(', ')})`).join(', ')}]`).join('\n')}

## Pre-Computed Baseline Knowledge

This is what each role would logically know based on their event involvement. Use this as your starting point for each character's knowledgeState. You may modify statuses (knows -> suspects/hides/denies) or add "believes" entries, but do NOT add new "knows" entries.

${baselineKnowledgeSection}

Create the full character set with the roleMapping. Think through each character's personality, motivations, and what they might conceal or distort, then provide the JSON.${
    characterValidationResult && !characterValidationResult.valid
      ? `

## IMPORTANT — PREVIOUS ATTEMPT FAILED VALIDATION

Your previous output failed validation. You MUST fix these errors:

${characterValidationResult.errors.map((e) => `- ${e}`).join('\n')}`
      : ''
  }`;

  const { data: result } = await callModel(
    {
      stepName: 'generateCharacters',
      systemPrompt,
      userPrompt,
      modelConfig: input.modelConfig,
    },
    (raw) => PopulateCharactersResultSchema.parse(raw),
  );

  const { characters, roleMapping } = result;

  // Enforce baseline knowledge: ensure every 'knows' entry from the baseline
  // is present in the character's knowledgeState. If the AI dropped one, restore it.
  // If the AI changed it to a valid non-'knows' status, keep the AI's choice.
  enforceBaselineKnowledge(characters, roleMapping, computedKnowledge);

  // Remap role IDs in events to real character IDs
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
    roleMapping,
    events: remappedEvents,
  };
};

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Formats the pre-computed baseline knowledge for inclusion in the user prompt.
 * Shows each role and the factIds they would know from event involvement.
 */
function formatBaselineKnowledge(
  computedKnowledge: ComputedKnowledge,
  characterRoles: { roleId: string; role: string; description: string }[],
): string {
  const lines: string[] = [];

  for (const role of characterRoles) {
    const knowledge = computedKnowledge.roleKnowledge[role.roleId];
    if (knowledge && Object.keys(knowledge).length > 0) {
      const factList = Object.keys(knowledge)
        .map((factId) => `    - ${factId}: "knows"`)
        .join('\n');
      lines.push(`${role.roleId} (${role.role}):\n${factList}`);
    } else {
      lines.push(`${role.roleId} (${role.role}):\n    (no baseline knowledge — not involved in any revealing events)`);
    }
  }

  return lines.join('\n\n');
}

const VALID_KNOWLEDGE_STATUSES = new Set(['knows', 'suspects', 'hides', 'denies', 'believes']);

/**
 * Ensures every baseline 'knows' entry from ComputeEventKnowledge is present
 * in the character's knowledgeState. If the AI dropped a baseline entry entirely,
 * it's restored as 'knows'. If the AI assigned a valid non-'knows' status, that's
 * kept. Invalid statuses are replaced with 'knows'.
 *
 * Also strips any 'knows' entries the AI added that aren't in the baseline
 * (the AI shouldn't invent new knowledge).
 */
function enforceBaselineKnowledge(
  characters: Record<string, CharacterDraft>,
  roleMapping: Record<string, string>,
  computedKnowledge: ComputedKnowledge,
): void {
  // Build a reverse mapping: characterId -> roleId
  const charToRole: Record<string, string> = {};
  for (const [roleId, charId] of Object.entries(roleMapping)) {
    charToRole[charId] = roleId;
  }

  // Build the set of baseline fact IDs per character
  for (const character of Object.values(characters)) {
    const roleId = charToRole[character.characterId];
    if (!roleId) continue;

    const baselineKnowledge = computedKnowledge.roleKnowledge[roleId] ?? {};
    const baselineFactIds = new Set(Object.keys(baselineKnowledge));

    // 1. Ensure every baseline entry is present
    for (const factId of baselineFactIds) {
      const currentStatus = character.knowledgeState[factId];
      if (!currentStatus) {
        // AI dropped it — restore as 'knows'
        character.knowledgeState[factId] = 'knows';
      } else if (!VALID_KNOWLEDGE_STATUSES.has(currentStatus)) {
        // AI used an invalid status — restore as 'knows'
        character.knowledgeState[factId] = 'knows';
      }
      // Otherwise: AI set a valid status (knows/suspects/hides/denies) — keep it
    }

    // 2. Strip 'knows' entries that aren't in the baseline
    //    (AI shouldn't invent new knowledge, but 'believes' entries for
    //    false beliefs are allowed since they aren't 'knows')
    for (const [factId, status] of Object.entries(character.knowledgeState)) {
      if (status === 'knows' && !baselineFactIds.has(factId)) {
        delete character.knowledgeState[factId];
      }
    }
  }
}
