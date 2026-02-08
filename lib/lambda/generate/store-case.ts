import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, CASES_TABLE } from '../shared/db';
import type { CaseGenerationState } from '../shared/generation-state';
import type { Case } from '../../types/case';
import type { CausalEvent, InvolvementType, EventNecessity } from '../../types/event';
import type { Character } from '../../types/character';
import type { KnowledgeStatus } from '../../types/fact';
import type { Location, LocationType } from '../../types/location';
import type { CasebookEntry, EntryType } from '../../types/casebook';
import type { Fact, FactCategory } from '../../types/fact';
import type { Question } from '../../types/question';
import type { Difficulty } from '../../types/common';

/**
 * Pipeline Step 11: Store Case in DynamoDB
 *
 * Assembles the generation state into a final Case object matching
 * the canonical type definitions, then writes it to DynamoDB.
 */
export const handler = async (state: CaseGenerationState): Promise<CaseGenerationState> => {
  const {
    input, template, events, characters, locations, facts,
    casebook, prose, introduction, title, questions, optimalPath,
    validationResult,
  } = state;

  if (!validationResult?.valid) {
    throw new Error(
      `Cannot store case: validation failed with ${validationResult?.errors.length ?? '?'} errors. ` +
      `Errors: ${validationResult?.errors.join('; ')}`,
    );
  }

  if (!template || !events || !characters || !locations || !facts ||
      !casebook || !prose || !introduction || !title || !questions || !optimalPath) {
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
      reveals: draft.reveals,
    };
  }

  const finalCharacters: Record<string, Character> = {};
  for (const [id, draft] of Object.entries(characters)) {
    finalCharacters[id] = {
      characterId: draft.characterId,
      name: draft.name,
      role: draft.role,
      description: draft.description,
      wants: draft.wants,
      hides: draft.hides,
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
      parent: draft.parent,
      adjacentTo: draft.adjacentTo,
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
      critical: draft.critical,
    };
  }

  const finalCasebook: Record<string, CasebookEntry> = {};
  for (const [id, draft] of Object.entries(casebook)) {
    finalCasebook[id] = {
      entryId: draft.entryId,
      label: draft.label,
      address: draft.address,
      locationId: draft.locationId,
      type: draft.type as EntryType,
      scene: prose[id] ?? '',
      characters: draft.characters,
      revealsFactIds: draft.revealsFactIds,
    };
  }

  const finalQuestions: Question[] = questions.map((draft) => ({
    questionId: draft.questionId,
    text: draft.text,
    answer: draft.answer,
    requiredFacts: draft.requiredFacts,
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
    optimalPath,
    difficulty: template.difficulty as Difficulty,
  };

  // Write to DynamoDB
  await docClient.send(
    new PutCommand({
      TableName: CASES_TABLE,
      Item: finalCase,
    }),
  );

  return state;
};
