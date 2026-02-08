/**
 * Barrel export for all shared types.
 *
 * Usage:
 *   Backend: import type { Case, Character } from '../types/index';
 *   Frontend: import type { Case, Character } from '@shared/index';
 */

export type { Case } from './case';
export type { CausalEvent, InvolvementType, EventNecessity } from './event';
export type { Character } from './character';
export type { ToneProfile } from './tone';
export type { Location, LocationType } from './location';
export type { CasebookEntry } from './casebook';
export type { Fact, FactCategory, KnowledgeStatus } from './fact';
export type { Question } from './question';
export type { CaseSetting, Difficulty } from './common';
export type { PlayerSession, PlayerAnswer, CaseResult } from './player';
