import { z } from 'zod';

// ============================================
// Generation Step Names
// ============================================

export const GENERATION_STEPS = [
  'generateTemplate',
  'generateEvents',
  'computeEventKnowledge',
  'generateCharacters',
  'generateLocations',
  'computeFacts',
  'generateFacts',
  'generateIntroduction',
  'generateCasebook',
  'generateProse',
  'generateQuestions',
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
// Draft case (stored in DynamoDB draft table)
//
// Case content only — no input. Input (caseDate, modelConfig, etc.) lives
// in OperationalState. Each step reads the draft, merges its output, and
// writes the draft back. Keyed by draftId (execution ID).
// ============================================

export interface DraftCase {
  template?: CaseTemplate;
  events?: Record<string, EventDraft>;
  computedKnowledge?: ComputedKnowledge;
  characters?: Record<string, CharacterDraft>;
  roleMapping?: Record<string, string>;
  locations?: Record<string, LocationDraft>;
  factSkeletons?: FactSkeleton[];
  factGraph?: FactGraph;
  facts?: Record<string, FactDraft>;
  introductionFactIds?: string[];
  introduction?: string;
  title?: string;
  casebook?: Record<string, CasebookEntryDraft>;
  prose?: Record<string, string>;
  questions?: QuestionDraft[];
  optimalPath?: string[];
}

// ============================================
// Operational state (Step Function state)
//
// Only input, draftId, resume hint, validation results, and retry counts.
// Draft content lives in the draft table; steps load/save it by draftId.
// ============================================

/** Single validation slot: overwritten by each validation step. Casebook step writes CasebookValidationResult; others write ValidationResult. */
export type StepValidationResult = ValidationResult | CasebookValidationResult;

export interface OperationalState {
  input: GenerateCaseInput;
  /** Execution ID — keys the draft in the draft table. Injected at start or from resumed state. */
  draftId: string;
  startFromStep?: GenerationStep;
  /** Last validation result (set by each Validate* step, cleared when starting a new step's retry loop). */
  validationResult?: StepValidationResult;
  /** Retry count for the current step's loop; set to 0 when entering a step, incremented on retry. */
  stepRetries?: number;
}

// ============================================
// Case Generation State (legacy / combined)
//
// Full state = operational + draft. Used when a Lambda needs to work with
// both (e.g. loading draft and returning operational). Steps receive
// OperationalState and read draft from DB; they return OperationalState.
// ============================================

export type CaseGenerationState = OperationalState & Partial<DraftCase>;

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
  /** The structural shape of the mystery — guides event design and casebook layout */
  mysteryStyle: string;
  /** The narrative voice and mood — guides prose generation across all steps */
  narrativeTone: string;
  eventSlots: EventSlot[];
  characterRoles: CharacterRole[];
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface EventSlot {
  slotId: string;
  description: string;
  necessity?: 'required' | undefined;
  causedBy: string[];
}

export interface CharacterRole {
  roleId: string;
  role: string;
  description: string;
}

export interface EventRevealDraft {
  id: string;
  audible: boolean;
  visible: boolean;
  physical: boolean;
  subjects: string[];
}

export interface EventDraft {
  eventId: string;
  description: string;
  timestamp: number;
  agent: string;
  location: string;
  involvement: Record<string, string>;
  necessity?: 'required' | undefined;
  causes: string[];
  reveals: EventRevealDraft[];
}

export interface CharacterDraft {
  characterId: string;
  name: string;
  mysteryRole: string;
  societalRole: string;
  description: string;
  motivations: string[];
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
  accessibleFrom: string[];
  visibleFrom: string[];
  audibleFrom: string[];
}

export interface FactDraft {
  factId: string;
  description: string;
  category: string;
  subjects: string[];
  veracity: string;
}

export interface CasebookEntryDraft {
  entryId: string;
  label: string;
  address: string;
  locationId: string;
  characters: string[];
  revealsFactIds: string[];
  requiresAnyFact: string[];
}

export interface QuestionDraft {
  questionId: string;
  text: string;
  answer: QuestionAnswerDraft;
  points: number;
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface QuestionAnswerDraft {
  type: string;
  factCategory?: string;
  acceptedIds: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Result of Validate Casebook: same as ValidationResult plus reachability sets used by ValidateQuestions. */
export interface CasebookValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** Fact IDs reachable from introduction facts (BFS); required for question-answer reachability checks. */
  reachableFactIds: string[];
  /** Casebook entry IDs unlockable from introduction facts. */
  reachableEntryIds: string[];
}

// ============================================
// Intermediate Types for Compute Steps
// ============================================

/**
 * Output of ComputeEventKnowledge: baseline knowledge derived from
 * event involvement and perception channels. Operates on role IDs
 * (characters don't exist yet at this pipeline stage).
 */
export interface ComputedKnowledge {
  /** Baseline knowledge per role: roleId -> factId -> 'knows' */
  roleKnowledge: Record<string, Record<string, 'knows'>>;
  /** Facts discoverable as physical evidence at each location: locationId -> factIds */
  locationReveals: Record<string, string[]>;
}

/**
 * A fact skeleton produced by ComputeFacts: the structural frame of a fact
 * (ID, subjects, veracity, source) before GenerateFacts fills in description
 * and category. The factId assigned here is the canonical ID used throughout
 * the entire pipeline.
 */
export interface FactSkeleton {
  /** Canonical fact ID — persists unchanged through the entire pipeline */
  factId: string;
  /** characterIds and locationIds this fact is about */
  subjects: string[];
  /** Whether this is a true or false fact */
  veracity: 'true' | 'false';
  /** Where this fact originated */
  source: FactSkeletonSource;
}

export type FactSkeletonSource =
  | { type: 'event_reveal'; eventId: string }
  | { type: 'denial'; characterId: string; deniedFactId: string }
  | { type: 'bridge'; fromCharacterId: string; toSubject: string }
  | { type: 'red_herring' };

/**
 * The fact-subject bipartite graph produced by ComputeFacts.
 * Used by GenerateIntroduction and GenerateCasebook for connectivity analysis.
 */
export interface FactGraph {
  /** factId -> subject IDs (characterIds and locationIds) */
  factToSubjects: Record<string, string[]>;
  /** subjectId -> factIds that this subject can reveal */
  subjectToFacts: Record<string, string[]>;
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
  mysteryStyle: z.string().min(1),
  narrativeTone: z.string().min(1),
  eventSlots: z
    .array(
      z.object({
        slotId: z.string().min(1),
        description: z.string().min(1),
        necessity: z.literal('required').optional(),
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

export const EventRevealSchema = z.object({
  id: z.string().min(1),
  audible: z.boolean(),
  visible: z.boolean(),
  physical: z.boolean(),
  subjects: z.array(z.string().min(1)).min(1),
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
    necessity: z.literal('required').optional(),
    causes: z.array(z.string()),
    reveals: z.array(EventRevealSchema).min(1),
  }),
);

export const KnowledgeStatusSchema = z.enum(['knows', 'suspects', 'hides', 'denies', 'believes']);

export const CharacterSchema = z.object({
  characterId: z.string().min(1),
  name: z.string().min(1),
  mysteryRole: z.string().min(1),
  societalRole: z.string().min(1),
  description: z.string().min(1),
  motivations: z.array(z.string()).min(1),
  knowledgeState: z.record(z.string(), KnowledgeStatusSchema),
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
    type: z.string().min(1),
    description: z.string().min(1),
    accessibleFrom: z.array(z.string()),
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
    ]),
    subjects: z.array(z.string().min(1)).min(1),
    veracity: z.enum(['true', 'false']),
  }),
);

/**
 * Schema for GenerateFacts AI output: the AI provides description and category
 * for each fact skeleton. Subjects and veracity come from the skeleton and are
 * merged programmatically. Keyed by factId (from the skeleton).
 */
export const GenerateFactsOutputSchema = z.record(
  z.string(),
  z.object({
    description: z.string().min(5),
    category: z.enum([
      'motive', 'means', 'opportunity', 'alibi',
      'relationship', 'timeline', 'physical_evidence', 'background',
    ]),
  }),
);

/** Inferred type for a single entry in the GenerateFacts AI output. */
export type GenerateFactsOutputEntry = z.infer<typeof GenerateFactsOutputSchema>[string];

export const CasebookSchema = z.record(
  z.string(),
  z.object({
    entryId: z.string().min(1),
    label: z.string().min(1),
    address: z.string().min(1),
    locationId: z.string().min(1),
    characters: z.array(z.string()),
    revealsFactIds: z.array(z.string()),
    requiresAnyFact: z.array(z.string().min(1)).min(1),
  }),
);

/**
 * Schema for the AI polish output from GenerateCasebook.
 * The AI provides labels, addresses, and character presence for each
 * entry in the programmatic skeleton. Structural fields (revealsFactIds,
 * requiresAnyFact, locationId) are NOT included — they come from the
 * programmatic phase and must not be changed.
 */
export const CasebookPolishSchema = z.record(
  z.string(),
  z.object({
    entryId: z.string().min(1),
    label: z.string().min(1),
    address: z.string().min(1),
    characters: z.array(z.string()),
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

/**
 * Schema for the GenerateIntroduction step output.
 * The AI selects 2-4 introduction facts, writes the opening scene,
 * and finalizes the case title.
 */
export const GenerateIntroductionOutputSchema = z.object({
  /** 2-4 factIds that form the opening hook — seeds the investigation */
  introductionFactIds: z.array(z.string().min(1)).min(2).max(4),
  /** Finalized case title (may refine the template title) */
  title: z.string().min(1),
  /** 2-4 paragraph opening scene (200-400 words) */
  introduction: z.string().min(10),
});

export const SceneBatchSchema = z.record(z.string(), z.string().min(10));

const FactCategorySchema = z.enum([
  'motive', 'means', 'opportunity', 'alibi',
  'relationship', 'timeline', 'physical_evidence', 'background',
]);

export const QuestionAnswerSchema = z.object({
  type: z.enum(['person', 'location', 'fact']),
  factCategory: FactCategorySchema.optional(),
  acceptedIds: z.array(z.string().min(1)).min(1),
});

export const QuestionsSchema = z
  .array(
    z.object({
      questionId: z.string().min(1),
      text: z.string().min(1),
      answer: QuestionAnswerSchema,
      points: z.number().int().min(1),
      difficulty: z.enum(['easy', 'medium', 'hard']),
    }),
  )
  .min(4)
  .max(8);
