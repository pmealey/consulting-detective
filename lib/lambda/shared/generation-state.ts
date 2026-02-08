import { z } from 'zod';

// ============================================
// Generation Step Names
// ============================================

export const GENERATION_STEPS = [
  'selectTemplate',
  'generateEvents',
  'populateCharacters',
  'buildLocations',
  'distributeFacts',
  'designCasebook',
  'generateProse',
  'createQuestions',
] as const;

export type GenerationStep = typeof GENERATION_STEPS[number];

// ============================================
// Model Configuration
// ============================================

export interface GenerationModelConfig {
  /**
   * Fallback model for any step not listed in `steps`.
   * Use full inference profile ID (e.g. us.anthropic.claude-haiku-4-5-20251001-v1:0)
   * or a shortcut: haiku, sonnet, sonnet4, opus, opus45, opus41.
   */
  default: string;
  /** Per-step overrides; same format (full ID or shortcut). */
  steps?: Partial<Record<GenerationStep, string>>;
}

// ============================================
// Generation Input
// ============================================

export interface GenerateCaseInput {
  caseDate: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  crimeType?: string;
  modelConfig?: GenerationModelConfig;
}

export const GenerateCaseInputSchema = z.object({
  caseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional().default('medium'),
  crimeType: z.string().optional(),
  modelConfig: z
    .object({
      default: z.string(),
      steps: z.record(z.enum(GENERATION_STEPS as unknown as [string, ...string[]]), z.string()).optional(),
    })
    .optional(),
});

// ============================================
// Case Generation State (progressive accumulator)
//
// Each pipeline step adds fields to this state object.
// All fields are optional because the state is built up
// incrementally — only fields written by completed steps exist.
// ============================================

export interface CaseGenerationState {
  // -- Input (always present after trigger) --
  input: GenerateCaseInput;

  // -- Step 1: Select Template --
  template?: CaseTemplate;

  // -- Step 2: Generate Events --
  events?: Record<string, EventDraft>;

  // -- Step 3: Populate Characters --
  characters?: Record<string, CharacterDraft>;

  // -- Step 4: Build Locations --
  locations?: Record<string, LocationDraft>;

  // -- Step 5: Distribute Facts --
  facts?: Record<string, FactDraft>;
  introductionFactIds?: string[];

  // -- Step 6: Design Casebook --
  casebook?: Record<string, CasebookEntryDraft>;

  // -- Step 6b: Validate Discovery Graph --
  discoveryGraphResult?: DiscoveryGraphResult;
  /** Number of times DesignCasebook has been retried after graph validation failure */
  designCasebookRetries?: number;

  // -- Step 7: Generate Prose --
  prose?: Record<string, string>;
  introduction?: string;
  title?: string;

  // -- Step 8: Create Questions --
  questions?: QuestionDraft[];

  // -- Step 9: Compute Optimal Path --
  optimalPath?: string[];

  // -- Step 10: Validate Coherence --
  validationResult?: ValidationResult;
}

// ============================================
// Draft Types
//
// These mirror lib/types/ but are used during generation.
// They allow the LLM to produce slightly looser structures
// that get tightened into final types during assembly.
// ============================================

export interface CaseTemplate {
  crimeType: string;
  title: string;
  era: string;
  date: string;
  atmosphere: string;
  eventSlots: EventSlot[];
  characterRoles: CharacterRole[];
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface EventSlot {
  slotId: string;
  description: string;
  necessity: 'required' | 'contingent';
  causedBy: string[];
}

export interface CharacterRole {
  roleId: string;
  role: string;
  description: string;
}

export interface EventDraft {
  eventId: string;
  description: string;
  timestamp: number;
  agent: string;
  location: string;
  involvement: Record<string, string>;
  necessity: 'required' | 'contingent';
  causes: string[];
  reveals: string[];
}

export interface CharacterDraft {
  characterId: string;
  name: string;
  mysteryRole: string;
  societalRole: string;
  description: string;
  wants: string[];
  hides: string[];
  knowledgeState: Record<string, string>;
  tone: {
    register: string;
    vocabulary: string[];
    quirk?: string;
  };
  /** Freeform status at investigation time (e.g. "deceased", "missing", "imprisoned"); guides casebook/prose. */
  currentStatus?: string;
}

export interface LocationDraft {
  locationId: string;
  name: string;
  type: string;
  description: string;
  parent?: string;
  adjacentTo: string[];
  visibleFrom: string[];
  audibleFrom: string[];
}

export interface FactDraft {
  factId: string;
  description: string;
  category: string;
}

export interface CasebookEntryDraft {
  entryId: string;
  label: string;
  address: string;
  locationId: string;
  type: string;
  characters: string[];
  revealsFactIds: string[];
  requiresAnyFact: string[];
}

export interface QuestionDraft {
  questionId: string;
  text: string;
  answerFactIds: string[];
  answerCategory: string;
  points: number;
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface DiscoveryGraphResult {
  valid: boolean;
  errors: string[];
  reachableFactIds: string[];
  reachableEntryIds: string[];
}

// ============================================
// Zod Schemas for LLM Output Validation
//
// Each schema validates what the LLM returns for that step.
// These are intentionally somewhat permissive — the coherence
// validation step does the deep structural checks.
// ============================================

export const CaseTemplateSchema = z.object({
  crimeType: z.string().min(1),
  title: z.string().min(1),
  era: z.string().min(1),
  date: z.string().min(1),
  atmosphere: z.string().min(1),
  eventSlots: z
    .array(
      z.object({
        slotId: z.string().min(1),
        description: z.string().min(1),
        necessity: z.enum(['required', 'contingent']),
        causedBy: z.array(z.string()),
      }),
    )
    .min(3),
  characterRoles: z
    .array(
      z.object({
        roleId: z.string().min(1),
        role: z.string().min(1),
        description: z.string().min(1),
      }),
    )
    .min(3),
  difficulty: z.enum(['easy', 'medium', 'hard']),
});

export const EventsSchema = z.record(
  z.string(),
  z.object({
    eventId: z.string().min(1),
    description: z.string().min(1),
    timestamp: z.number(),
    agent: z.string().min(1),
    location: z.string().min(1),
    involvement: z.record(z.string(), z.string()),
    necessity: z.enum(['required', 'contingent']),
    causes: z.array(z.string()),
    reveals: z.array(z.string()),
  }),
);

export const CharacterSchema = z.object({
  characterId: z.string().min(1),
  name: z.string().min(1),
  mysteryRole: z.string().min(1),
  societalRole: z.string().min(1),
  description: z.string().min(1),
  wants: z.array(z.string()).min(1),
  hides: z.array(z.string()),
  knowledgeState: z.record(z.string(), z.string()),
  tone: z.object({
    register: z.string().min(1),
    vocabulary: z.array(z.string()).min(1),
    quirk: z.string().optional(),
  }),
  currentStatus: z.string().optional(),
});

export const CharactersSchema = z.record(z.string(), CharacterSchema);

/** Schema for step 3 output: characters + a mapping from roleId -> characterId */
export const PopulateCharactersResultSchema = z.object({
  characters: CharactersSchema,
  roleMapping: z.record(z.string(), z.string()),
});

export const LocationsSchema = z.record(
  z.string(),
  z.object({
    locationId: z.string().min(1),
    name: z.string().min(1),
    type: z.enum(['building', 'room', 'outdoor', 'street', 'district']),
    description: z.string().min(1),
    parent: z.string().optional(),
    adjacentTo: z.array(z.string()),
    visibleFrom: z.array(z.string()),
    audibleFrom: z.array(z.string()),
  }),
);

export const FactsSchema = z.record(
  z.string(),
  z.object({
    factId: z.string().min(1),
    description: z.string().min(1),
    category: z.enum([
      'motive', 'means', 'opportunity', 'alibi',
      'relationship', 'timeline', 'physical_evidence', 'background',
      'person', 'place',
    ]),
  }),
);

/** Schema for step 5 output: facts + introductionFactIds */
export const DistributeFactsResultSchema = z.object({
  facts: FactsSchema,
  introductionFactIds: z.array(z.string().min(1)).min(2).max(4),
});

export const CasebookSchema = z.record(
  z.string(),
  z.object({
    entryId: z.string().min(1),
    label: z.string().min(1),
    address: z.string().min(1),
    locationId: z.string().min(1),
    type: z.enum(['location', 'person', 'document', 'event']),
    characters: z.array(z.string()),
    revealsFactIds: z.array(z.string()),
    requiresAnyFact: z.array(z.string().min(1)).min(1),
  }),
);

export const ProseSchema = z.object({
  title: z.string().min(1),
  introduction: z.string().min(10),
  scenes: z.record(z.string(), z.string().min(10)),
});

export const IntroductionSchema = z.object({
  title: z.string().min(1),
  introduction: z.string().min(10),
});

export const SceneBatchSchema = z.record(z.string(), z.string().min(10));

const FactCategorySchema = z.enum([
  'motive', 'means', 'opportunity', 'alibi',
  'relationship', 'timeline', 'physical_evidence', 'background',
  'person', 'place',
]);

export const QuestionsSchema = z
  .array(
    z.object({
      questionId: z.string().min(1),
      text: z.string().min(1),
      answerFactIds: z.array(z.string().min(1)).min(1),
      answerCategory: FactCategorySchema,
      points: z.number().int().min(1),
      difficulty: z.enum(['easy', 'medium', 'hard']),
    }),
  )
  .min(4)
  .max(8);
