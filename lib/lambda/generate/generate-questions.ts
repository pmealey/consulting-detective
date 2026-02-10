import { callModel } from '../shared/bedrock';
import {
  QuestionsSchema,
  type CaseGenerationState,
} from '../shared/generation-state';

/**
 * Pipeline Step 10: Generate Questions
 *
 * Designs 4-8 end-of-case quiz questions that require the player
 * to connect facts discovered across multiple casebook entries.
 * Answer types: person (characterIds), location (locationIds), fact (factIds + factCategory).
 * False facts (veracity: "false") are excluded from acceptable answers.
 */
export const handler = async (state: CaseGenerationState): Promise<CaseGenerationState> => {
  const { input, template, events, characters, facts, casebook } = state;

  if (!template) throw new Error('GenerateQuestions requires template from step 1');
  if (!events) throw new Error('GenerateQuestions requires events from step 2');
  if (!characters) throw new Error('GenerateQuestions requires characters from step 3');
  if (!facts) throw new Error('GenerateQuestions requires facts from step 6');
  if (!casebook) throw new Error('GenerateQuestions requires casebook from step 8');

  const difficulty = template.difficulty;

  const factCategories = [
    'motive', 'means', 'opportunity', 'alibi',
    'relationship', 'timeline', 'physical_evidence', 'background',
  ];

  const systemPrompt = `You are a quiz designer for a detective mystery game. You create end-of-case questions that test whether the player has found and connected the right evidence.

Questions have three answer types:
- **"person"**: The player selects from discovered characters. Use for "Who did X?" questions.
- **"location"**: The player selects from discovered locations. Use for "Where did X happen?" questions.
- **"fact"**: The player selects from discovered facts filtered by factCategory. Use for motive, means, evidence questions.

First, briefly reason through what the key deductions are and which answers could satisfy each question. Then provide the JSON.

Your response must end with valid JSON: an array of Question objects.

Each question must match this schema:
{
  "questionId": string,          // e.g. "q_01_who"
  "text": string,                // the question (see guidelines on vagueness below)
  "answer": {
    "type": "person" | "location" | "fact",
    "factCategory": string,      // REQUIRED when type is "fact"; one of: ${factCategories.join(', ')}
    "acceptedIds": string[]      // at least 1; characterIds for "person", locationIds for "location", factIds for "fact"
  },
  "points": number,              // point value (5, 10, 15, or 20)
  "difficulty": "easy" | "medium" | "hard"
}

## ANSWER TYPE RULES

| Question asks about... | answer.type | acceptedIds should be... | Points |
|---|---|---|---|
| Identity of a person (culprit, accomplice, key witness) | \`person\` | characterId(s) for that person | 15-20 |
| A key location (crime scene, hiding place, meeting point) | \`location\` | locationId(s) for that place | 5-10 |
| Why someone did something (motive, grudge, desire) | \`fact\` (factCategory: "motive") | The specific motive factId(s) | 10-15 |
| How the crime was committed (method, weapon, technique) | \`fact\` (factCategory: "means") | The specific means factId(s) | 10-15 |
| When/whether someone had the chance to act | \`fact\` (factCategory: "opportunity") | The specific opportunity factId(s) | 10-15 |
| A connection between people or entities | \`fact\` (factCategory: "relationship") | The specific relationship factId(s) | 5-10 |
| When something happened or sequence of events | \`fact\` (factCategory: "timeline") | The specific timeline factId(s) | 5-10 |
| Physical evidence (object, trace, document) | \`fact\` (factCategory: "physical_evidence") | The specific evidence factId(s) | 5-10 |

CRITICAL: "Who" questions MUST use \`answer.type: "person"\` with characterIds — NOT fact type with motive or relationship facts. The player is selecting from a list of people. Similarly, "Where" questions MUST use \`answer.type: "location"\` with locationIds.

## OTHER GUIDELINES

- Create 4-8 questions depending on difficulty level.
- Questions should progress from easier to harder.
- For "person" answers: every ID in acceptedIds MUST be a valid characterId from the provided characters list.
- For "location" answers: every ID in acceptedIds MUST be a valid locationId from the provided locations list.
- For "fact" answers: every ID in acceptedIds MUST be a valid factId from the provided facts list, and all must share the specified factCategory. Do NOT include false facts (veracity: "false") as accepted answers.
- If multiple answers could reasonably be correct, include all of them in acceptedIds.
- CRITICAL: question text must be VAGUE and NON-SPOILING. Do NOT name specific characters, locations, or details that would give away answers to other questions.
- Try to cover a variety of answer types. Don't make every question a "Who" question.
- Point values: easy=5-10, medium=10-15, hard=15-20.`;

  const questionValidationResult = state.questionValidationResult;
  const userPrompt = `Here is the case context:

Title: ${template.title}
Crime Type: ${template.crimeType}
Difficulty: ${difficulty}

The story (what actually happened):
${Object.values(events).sort((a, b) => a.timestamp - b.timestamp).map((e) => `  ${e.timestamp}. ${e.description}`).join('\n')}

Characters (valid characterIds for "person" answer type):
${Object.values(characters).map((c) => `  - ${c.characterId}: ${c.name} (${c.mysteryRole}, ${c.societalRole})`).join('\n')}

Locations (valid locationIds for "location" answer type):
${Object.values(state.locations!).map((l) => `  - ${l.locationId}: ${l.name} (${l.type})`).join('\n')}

Available facts (valid factIds for "fact" answer type — do NOT use false facts as answers):
${Object.values(facts).filter((f) => f.veracity !== 'false').map((f) => `  - ${f.factId} [${f.category}]: ${f.description}`).join('\n')}

Where facts are found (casebook entries):
${Object.values(casebook).map((e) => `  - ${e.label}: reveals [${e.revealsFactIds.join(', ')}]`).join('\n')}

Design the quiz. For "person" answers, use characterIds. For "location" answers, use locationIds. For "fact" answers, use factIds and set factCategory. Think through the key deductions first, then provide the JSON array.${
    questionValidationResult && !questionValidationResult.valid
      ? `

## IMPORTANT — PREVIOUS ATTEMPT FAILED VALIDATION

Your previous output failed validation. You MUST fix these errors:

${questionValidationResult.errors.map((e) => `- ${e}`).join('\n')}`
      : ''
  }`;

  const { data: questions } = await callModel(
    {
      stepName: 'generateQuestions',
      systemPrompt,
      userPrompt,
      modelConfig: input.modelConfig,
    },
    (raw) => QuestionsSchema.parse(raw),
  );

  return {
    ...state,
    questions,
  };
};
