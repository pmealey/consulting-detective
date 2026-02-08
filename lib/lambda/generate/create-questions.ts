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

  const criticalFacts = Object.values(facts).filter((f) => f.critical);
  const difficulty = template.difficulty;

  const systemPrompt = `You are a quiz designer for a detective mystery game. You create end-of-case questions that test whether the player has found and connected the right evidence.

First, briefly reason through what the key deductions are: what should the player figure out, which facts combine to answer each question, and how to ensure all critical facts are covered. Then provide the JSON.

Your response must end with valid JSON: an array of Question objects.

Each question must match this schema:
{
  "questionId": string,          // e.g. "q_01_who"
  "text": string,                // the question, e.g. "Who murdered Mr. Pemberton?"
  "answer": string,              // the correct answer (1-2 sentences)
  "requiredFacts": string[],     // factIds the player needs to deduce the answer
  "points": number,              // point value (5, 10, 15, or 20)
  "difficulty": "easy" | "medium" | "hard"
}

Guidelines:
- Create 4-8 questions depending on difficulty level.
- Questions should progress from easier to harder.
- Key question types:
  * "Who" questions (who did it, who was involved) — usually worth 15-20 points
  * "Why" questions (motive) — usually worth 10-15 points
  * "How" questions (method/means) — usually worth 10-15 points
  * "What" questions (what happened, what was the connection) — usually worth 5-10 points
- Each question's requiredFacts must reference actual critical fact IDs from the case.
- Each requiredFacts array should contain 2-4 facts (player must connect multiple pieces of evidence).
- The answer should be deducible from ONLY the required facts — no outside knowledge needed.
- Together, the questions' requiredFacts should cover ALL critical facts (every critical fact appears in at least one question).
- Point values: easy=5-10, medium=10-15, hard=15-20.`;

  const userPrompt = `Here is the case context:

Title: ${template.title}
Crime Type: ${template.crimeType}
Difficulty: ${difficulty}

The story (what actually happened):
${Object.values(events).sort((a, b) => a.timestamp - b.timestamp).map((e) => `  ${e.timestamp}. ${e.description}`).join('\n')}

Characters:
${Object.values(characters).map((c) => `  - ${c.name} (${c.mysteryRole}, ${c.societalRole}): wants=[${c.wants.join('; ')}], hides=[${c.hides.join('; ')}]`).join('\n')}

Critical facts (all must be covered by at least one question's requiredFacts):
${criticalFacts.map((f) => `  - ${f.factId}: ${f.description} [${f.category}]`).join('\n')}

Where facts are found (casebook entries):
${Object.values(casebook).map((e) => `  - ${e.label}: reveals [${e.revealsFactIds.join(', ')}]`).join('\n')}

Design the quiz. Think through the key deductions first, then provide the JSON array.`;

  const { data: questions } = await callModel(
    {
      stepName: 'createQuestions',
      systemPrompt,
      userPrompt,
      modelConfig: input.modelConfig,
      maxTokens: 4096,
      temperature: 0.7,
    },
    (raw) => QuestionsSchema.parse(raw),
  );

  return {
    ...state,
    questions,
  };
};
