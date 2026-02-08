import { callModel } from '../shared/bedrock';
import {
  QuestionsSchema,
  type CaseGenerationState,
} from '../shared/generation-state';

/**
 * Pipeline Step 8: Create Questions
 *
 * Designs 4-8 end-of-case quiz questions that require the player
 * to connect facts discovered across multiple casebook entries.
 */
export const handler = async (state: CaseGenerationState): Promise<CaseGenerationState> => {
  const { input, template, events, characters, facts, casebook } = state;

  if (!template) throw new Error('Step 8 requires template from step 1');
  if (!events) throw new Error('Step 8 requires events from step 2');
  if (!characters) throw new Error('Step 8 requires characters from step 3');
  if (!facts) throw new Error('Step 8 requires facts from step 5');
  if (!casebook) throw new Error('Step 8 requires casebook from step 6');

  const difficulty = template.difficulty;

  const factCategories = [
    'motive', 'means', 'opportunity', 'alibi',
    'relationship', 'timeline', 'physical_evidence', 'background',
    'person', 'place',
  ];

  const systemPrompt = `You are a quiz designer for a detective mystery game. You create end-of-case questions that test whether the player has found and connected the right evidence.

The player answers questions by SELECTING a fact from their discovered facts, filtered by the question's answer category. This means the answer is always a single fact the player picks from a list — not free text. However, some questions may have multiple facts that could reasonably be considered correct.

First, briefly reason through what the key deductions are and which facts could answer each question. Then provide the JSON.

Your response must end with valid JSON: an array of Question objects.

Each question must match this schema:
{
  "questionId": string,          // e.g. "q_01_who"
  "text": string,                // the question (see guidelines on vagueness below)
  "answerFactIds": string[],     // factIds that are acceptable correct answers (at least 1; all must be existing factIds from the provided facts list)
  "answerCategory": string,      // fact category the player selects from (must match the category of ALL referenced facts); one of: ${factCategories.join(', ')}
  "points": number,              // point value (5, 10, 15, or 20)
  "difficulty": "easy" | "medium" | "hard"
}

## ANSWER CATEGORY RULES

The player answers each question by selecting a fact from their discovered facts, filtered to only show facts matching the question's \`answerCategory\`. This means the category determines what list the player picks from. Choose the category that makes the answer a meaningful selection from a non-trivial list.

**Category-to-question-type mapping:**

| Question asks about... | answerCategory | answerFactIds should be... | Points |
|---|---|---|---|
| Identity of a person (culprit, accomplice, key witness) | \`person\` | Person identity fact(s) for that character | 15-20 |
| A key location (crime scene, hiding place, meeting point) | \`place\` | Place identity fact(s) for that location | 5-10 |
| Why someone did something (motive, grudge, desire) | \`motive\` | The specific motive fact(s) | 10-15 |
| How the crime was committed (method, weapon, technique) | \`means\` | The specific means fact(s) | 10-15 |
| When/whether someone had the chance to act | \`opportunity\` | The specific opportunity fact(s) | 10-15 |
| A connection between people or entities | \`relationship\` | The specific relationship fact(s) | 5-10 |
| When something happened or sequence of events | \`timeline\` | The specific timeline fact(s) | 5-10 |
| Physical evidence (object, trace, document) | \`physical_evidence\` | The specific evidence fact(s) | 5-10 |

CRITICAL: "Who" questions MUST use \`answerCategory: "person"\` with person identity facts as answers — NOT motive, relationship, or other facts that happen to name the person. The player is selecting from a list of people, not a list of motives. Similarly, "Where" questions MUST use \`answerCategory: "place"\` with place identity facts.

## OTHER GUIDELINES

- Create 4-8 questions depending on difficulty level.
- Questions should progress from easier to harder.
- Every factId in answerFactIds MUST reference an actual factId from the provided facts list.
- Every factId in answerFactIds MUST share the same category, which MUST match answerCategory.
- If multiple facts could reasonably answer the question, include all of them in answerFactIds. The first entry should be the single best answer; additional entries are acceptable alternatives.
- CRITICAL: question text must be VAGUE and NON-SPOILING. Do NOT name specific characters, locations, or details that would give away answers to other questions. For example, instead of "Who killed Lord Ashworth at the docks?" write "Who is responsible for the victim's death?" — the player already knows the case context.
- Try to cover a variety of different facts and categories across questions. Don't make every question a "Who" question.
- Point values: easy=5-10, medium=10-15, hard=15-20.`;

  const questionValidationResult = state.questionValidationResult;
  const userPrompt = `Here is the case context:

Title: ${template.title}
Crime Type: ${template.crimeType}
Difficulty: ${difficulty}

The story (what actually happened):
${Object.values(events).sort((a, b) => a.timestamp - b.timestamp).map((e) => `  ${e.timestamp}. ${e.description}`).join('\n')}

Characters:
${Object.values(characters).map((c) => `  - ${c.name} (${c.mysteryRole}, ${c.societalRole}): wants=[${c.wants.join('; ')}], hides=[${c.hides.join('; ')}]`).join('\n')}

Available facts (these are the ONLY valid values for answerFactIds entries):
${Object.values(facts).map((f) => `  - ${f.factId} [${f.category}]: ${f.description}`).join('\n')}

Where facts are found (casebook entries):
${Object.values(casebook).map((e) => `  - ${e.label}: reveals [${e.revealsFactIds.join(', ')}]`).join('\n')}

Design the quiz. Every entry in answerFactIds must be one of the factIds listed above, and answerCategory must match those facts' category. Think through the key deductions first, then provide the JSON array.${
    questionValidationResult && !questionValidationResult.valid
      ? `

## IMPORTANT — PREVIOUS ATTEMPT FAILED VALIDATION

Your previous output failed validation. You MUST fix these errors:

${questionValidationResult.errors.map((e) => `- ${e}`).join('\n')}`
      : ''
  }`;

  const { data: questions } = await callModel(
    {
      stepName: 'createQuestions',
      systemPrompt,
      userPrompt,
      modelConfig: input.modelConfig,
      outputTokens: 2048,
      thinkingTokens: 2048,
      temperature: 0.7,
    },
    (raw) => QuestionsSchema.parse(raw),
  );

  return {
    ...state,
    questions,
  };
};
