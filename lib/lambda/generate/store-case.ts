import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, CASES_TABLE } from '../shared/db';
import { getDraft, deleteDraft } from '../shared/draft-db';
import type { OperationalState } from '../shared/generation-state';
import type { Case } from '../../types/case';
import type { CausalEvent, EventReveal, InvolvementType, EventNecessity } from '../../types/event';
import type { Character } from '../../types/character';
import type { KnowledgeStatus } from '../../types/fact';
import type { Location, LocationType } from '../../types/location';
import type { CasebookEntry } from '../../types/casebook';
import type { Fact, FactCategory } from '../../types/fact';
import type { Question, QuestionAnswer } from '../../types/question';
import type { Difficulty } from '../../types/common';

/**
 * Pipeline Step 12: Store Case in DynamoDB
 *
 * Loads the draft from the draft table, assembles it into a final Case,
 * writes to the cases table, then deletes the draft.
 */
export const handler = async (state: OperationalState): Promise<OperationalState> => {
  const { input, draftId, validationResult } = state;

  if (!validationResult?.valid) {
    throw new Error(
      `Cannot store case: validation failed with ${validationResult?.errors.length ?? '?'} errors. ` +
      `Errors: ${validationResult?.errors.join('; ')}`,
    );
  }

  const draft = await getDraft(draftId);
  if (!draft) throw new Error('Cannot store case: draft not found');

  const {
    template, events, characters, locations, facts,
    casebook, prose, introduction, title, questions, optimalPath,
    introductionFactIds,
  } = draft;

  if (!template || !events || !characters || !locations || !facts ||
      !casebook || !prose || !introduction || !title || !questions || !optimalPath ||
      introductionFactIds == null) {
    throw new Error('Cannot store case: incomplete generation state');
  }

  // Assemble final Case from drafts
  const finalEvents: Record<string, CausalEvent> = {};
  for (const [id, draft] of Object.entries(events)) {
    finalEvents[id] = {
      eventId: draft.eventId,
      description: draft.description,
      timestamp: draft.timestamp,
      agent: draft.agent,
      location: draft.location,
      involvement: draft.involvement as Record<string, InvolvementType>,
      necessity: draft.necessity as EventNecessity,
      causes: draft.causes,
      reveals: draft.reveals as EventReveal[],
    };
  }

  const finalCharacters: Record<string, Character> = {};
  for (const [id, draft] of Object.entries(characters)) {
    finalCharacters[id] = {
      characterId: draft.characterId,
      name: draft.name,
      mysteryRole: draft.mysteryRole,
      societalRole: draft.societalRole,
      description: draft.description,
      motivations: draft.motivations,
      knowledgeState: draft.knowledgeState as Record<string, KnowledgeStatus>,
      tone: draft.tone,
      currentStatus: draft.currentStatus,
    };
  }

  const finalLocations: Record<string, Location> = {};
  for (const [id, draft] of Object.entries(locations)) {
    finalLocations[id] = {
      locationId: draft.locationId,
      name: draft.name,
      type: draft.type as LocationType,
      description: draft.description,
      accessibleFrom: draft.accessibleFrom,
      visibleFrom: draft.visibleFrom,
      audibleFrom: draft.audibleFrom,
    };
  }

  const finalFacts: Record<string, Fact> = {};
  for (const [id, draft] of Object.entries(facts)) {
    finalFacts[id] = {
      factId: draft.factId,
      description: draft.description,
      category: draft.category as FactCategory,
      subjects: draft.subjects,
      veracity: draft.veracity as 'true' | 'false',
    };
  }

  const finalCasebook: Record<string, CasebookEntry> = {};
  for (const [id, draft] of Object.entries(casebook)) {
    finalCasebook[id] = {
      entryId: draft.entryId,
      label: draft.label,
      address: draft.address,
      locationId: draft.locationId,
      scene: prose[id] ?? '',
      characters: draft.characters,
      revealsFactIds: draft.revealsFactIds,
      requiresAnyFact: draft.requiresAnyFact ?? [],
    };
  }

  const finalQuestions: Question[] = questions.map((draft) => ({
    questionId: draft.questionId,
    text: draft.text,
    answer: {
      type: draft.answer.type as 'person' | 'location' | 'fact',
      factCategory: draft.answer.factCategory as FactCategory | undefined,
      acceptedIds: draft.answer.acceptedIds,
    } satisfies QuestionAnswer,
    points: draft.points,
    difficulty: draft.difficulty as Difficulty,
  }));

  const finalCase: Case = {
    caseDate: input.caseDate,
    title,
    setting: {
      era: template.era,
      date: template.date,
      atmosphere: template.atmosphere,
    },
    introduction,
    events: finalEvents,
    characters: finalCharacters,
    locations: finalLocations,
    casebook: finalCasebook,
    facts: finalFacts,
    questions: finalQuestions,
    introductionFactIds,
    optimalPath,
    difficulty: template.difficulty as Difficulty,
  };

  await docClient.send(
    new PutCommand({
      TableName: CASES_TABLE,
      Item: finalCase,
    }),
  );

  await deleteDraft(draftId);
  return state;
};
