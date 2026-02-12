import type { DraftCase } from './generation-state';
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
 * Assembles a complete DraftCase into a final Case for storage.
 * Shared by StoreCase (pipeline step) and publish-draft Lambda.
 * Throws if the draft is missing required fields.
 * versionId identifies this published version so the UI can detect changes and reset progress.
 */
export function assembleCaseFromDraft(
  draft: DraftCase,
  caseDate: string,
  versionId?: string,
): Case {
  const {
    template, events, characters, locations, facts,
    casebook, prose, introduction, title, questions, optimalPath,
    introductionFactIds,
  } = draft;

  if (!template || !events || !characters || !locations || !facts ||
      !casebook || !prose || !introduction || !title || !questions || !optimalPath ||
      introductionFactIds == null) {
    throw new Error('Cannot assemble case: incomplete generation state');
  }

  const finalEvents: Record<string, CausalEvent> = {};
  for (const [id, ev] of Object.entries(events)) {
    finalEvents[id] = {
      eventId: ev.eventId,
      description: ev.description,
      timestamp: ev.timestamp,
      agent: ev.agent,
      location: ev.location,
      involvement: ev.involvement as Record<string, InvolvementType>,
      necessity: ev.necessity as EventNecessity,
      causes: ev.causes,
      reveals: ev.reveals as EventReveal[],
    };
  }

  const finalCharacters: Record<string, Character> = {};
  for (const [id, ch] of Object.entries(characters)) {
    finalCharacters[id] = {
      characterId: ch.characterId,
      name: ch.name,
      mysteryRole: ch.mysteryRole,
      societalRole: ch.societalRole,
      description: ch.description,
      motivations: ch.motivations,
      knowledgeState: ch.knowledgeState as Record<string, KnowledgeStatus>,
      tone: ch.tone,
      currentStatus: ch.currentStatus,
    };
  }

  const finalLocations: Record<string, Location> = {};
  for (const [id, loc] of Object.entries(locations)) {
    finalLocations[id] = {
      locationId: loc.locationId,
      name: loc.name,
      type: loc.type as LocationType,
      description: loc.description,
      accessibleFrom: loc.accessibleFrom,
      visibleFrom: loc.visibleFrom,
      audibleFrom: loc.audibleFrom,
    };
  }

  const finalFacts: Record<string, Fact> = {};
  for (const [id, f] of Object.entries(facts)) {
    finalFacts[id] = {
      factId: f.factId,
      description: f.description,
      category: f.category as FactCategory,
      subjects: f.subjects,
      veracity: f.veracity as 'true' | 'false',
    };
  }

  const finalCasebook: Record<string, CasebookEntry> = {};
  for (const [id, entry] of Object.entries(casebook)) {
    finalCasebook[id] = {
      entryId: entry.entryId,
      label: entry.label,
      address: entry.address,
      locationId: entry.locationId,
      scene: prose[id] ?? '',
      characterIds: entry.characterIds,
      revealsFactIds: entry.revealsFactIds,
      requiresAnyFact: entry.requiresAnyFact ?? [],
    };
  }

  const finalQuestions: Question[] = questions.map((q) => ({
    questionId: q.questionId,
    text: q.text,
    answer: {
      type: q.answer.type as 'person' | 'location' | 'fact',
      factCategory: q.answer.factCategory as FactCategory | undefined,
      acceptedIds: q.answer.acceptedIds,
    } satisfies QuestionAnswer,
    points: q.points,
    difficulty: q.difficulty as Difficulty,
  }));

  return {
    caseDate,
    versionId,
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
}
