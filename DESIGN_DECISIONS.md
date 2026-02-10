# Design Decisions

A log of specific design choices and their rationale. Each entry records the decision, the alternatives considered, and why this option was chosen.

---

## No `guilty` Flag on Character

**Decision**: Characters have no `guilty: boolean` property.

**Alternatives considered**: A `guilty` flag, or a `role: 'culprit' | 'victim' | 'witness' | ...` enum.

**Rationale**: In a Consulting Detective game, "who did it" is a *narrative conclusion* that the player deduces from evidence. It's an answer to a question, not a property of a character. Baking guilt into the character model would:
- Constrain the narrative to a single type of mystery (whodunit)
- Leak the answer into the data structure
- Prevent cases where the "culprit" is ambiguous or where the questions aren't about guilt at all (e.g. "What was hidden in the safe?")

Instead, guilt is emergent: a Question asks "Who is responsible for the victim's death?", its `answer` has `type: 'person'` and `acceptedIds: [characterId of the culprit]`, and the player selects that character from their discovered subjects. The data model supports any narrative conclusion the questions want to probe.

---

## Character `currentStatus` (freeform)

**Decision**: Characters have an optional freeform `currentStatus?: string` (e.g. "deceased", "missing", "imprisoned", "traveling") filled in during character/event generation and used by casebook and prose to decide who can be visited or interviewed.

**Alternatives considered**: A binary `status: 'alive' | 'deceased'`; no tracking.

**Rationale**: Many states affect availability: deceased (cannot be interviewed), missing, imprisoned (only at prison), traveling (might be elsewhere), ill (might be at home only). A single freeform field lets the event/character generation describe whatever fits the story; the casebook generator is instructed to "keep each character's currentStatus in mind" when deciding who appears at each entry, and the prose generator is instructed to respect status (e.g. not write dialogue for someone deceased or missing). Stored cases can omit `currentStatus` for backward compatibility.

---

## Location vs. CasebookEntry Split

**Decision**: The world model (`Location`) and the player-facing address book (`CasebookEntry`) are separate types.

**Alternatives considered**: A single `Location` type that serves both as world scaffolding and as the visitable address.

**Rationale**: These are different concerns:
- **Locations** are spatial/physical: they have perception edges (visibleFrom, audibleFrom) and accessibility edges (accessibleFrom). They exist to constrain what characters could perceive during events. The player never sees them directly.
- **CasebookEntries** are the game mechanic: they have a label, address, prose scene, and list of revealed facts. They are what the player interacts with. All entries are gated behind fact discovery via `requiresAnyFact` (OR-logic).

The split enables:
- **Multiple entries per location**: Visiting the pub in the morning (the barkeeper is alone) vs. the evening (the regulars are there) are different casebook entries at the same location.
- **Person-focused entries**: "Inspector Lestrade at Scotland Yard" is a casebook entry that happens to take place at Scotland Yard, but the entry is about the person, not the place.
- **Flexible gating**: Person-type identity facts gate person entries, place-type identity facts gate location entries, allowing progressive discovery through the bipartite facts ↔ entries graph.

---

## No `isRedHerring` Flag

**Decision**: Casebook entries have no `isRedHerring: boolean` property.

**Alternatives considered**: Explicitly marking red herring entries during generation.

**Rationale**: "Red herring" is a derived property, not an intrinsic one. A casebook entry is a red herring if it doesn't help answer any question: for fact-type answers, none of its revealed fact IDs are in that question's `answer.acceptedIds`; for person/location-type answers, none of its revealed facts have a subject in `answer.acceptedIds`. So the set of "critical" IDs (factIds, characterIds, locationIds that are correct answers) can be computed from all questions' `answer.acceptedIds`, and an entry is a red herring if it reveals no fact that is in that set and no fact whose subjects intersect that set (for person/location). Computing it on demand keeps it correct regardless of answer structure.

Storing it would create a maintenance burden: if questions change, the flag could become stale. Computing it on demand is trivial and always correct.

---

## Records Over Arrays

**Decision**: `Case.events`, `.characters`, `.locations`, `.casebook`, and `.facts` are all `Record<string, T>` maps keyed by ID. Only `questions` and `optimalPath` are arrays.

**Alternatives considered**: Arrays for everything (the initial design), with ID lookups done via `.find()`.

**Rationale**: Most access patterns are by ID: "given this eventId, get the event", "given this characterId, get the character." Records give O(1) lookup. Arrays require O(n) scans.

Arrays are kept where they're appropriate:
- `questions`: Order matters (presented sequentially to the player).
- `optimalPath`: Order matters (it's a sequence of visits).
- Reference ID lists (`causes`, `reveals`, `revealsFactIds`, `accessibleFrom`, etc.): These are sets of IDs, not keyed structures. Arrays are fine; they're small and iterated, not looked up by key.

---

## Involvement Map Over Character Movements

**Decision**: Character-event connections are stored as `CausalEvent.involvement: Record<string, InvolvementType>`. Characters have no `movements` or positional tracking.

**Alternatives considered**:
1. A `movements: CharacterMovement[]` array on Character, tracking where each character was at each timestamp, then deriving involvement from position + location perception edges.
2. Flat `participants: string[]` and `witnesses: string[]` arrays on CausalEvent.
3. Deriving everything from location positions at generation time with no stored involvement.

**Rationale**: If a character isn't involved in an event, their position at that time is narratively irrelevant -- no scene will reference it, no question will ask about it. Tracking movements solely to derive involvement is backwards: define involvement directly and derive positions from it if needed.

The typed `InvolvementType` is richer than flat participant/witness arrays because it captures *how* a character is connected, which directly shapes scene generation:
- `agent`: performed the action -- can describe it from their own perspective
- `present`: directly involved or present and observed the event -- knows firsthand details
- `witness_visual`: saw it happen from another location -- can describe what they saw but may have misinterpreted
- `witness_auditory`: heard it from another location -- can report sounds but not sights
- `discovered_evidence`: found physical traces later -- knows the aftermath but not the event itself

(Secondhand knowledge is modeled as separate events, not an `informed_after` involvement type.)

The location graph's perception edges (`visibleFrom`, `audibleFrom`) inform the involvement type during generation (a character at a `visibleFrom` location gets `witness_visual`), but the computed result is stored on the event for direct access.

---

## Shared Types via Path Alias

**Decision**: Types live in `lib/types/`, shared between backend (lambdas) and frontend (React UI) via a `@shared/*` path alias in the UI's tsconfig and Vite config.

**Alternatives considered**:
1. Duplicate types in both `lib/lambda/` and `ui/src/` (the family-olympics approach).
2. A separate npm package for shared types.
3. A monorepo with workspaces.

**Rationale**: Duplicated types drift. A separate package adds publishing overhead for a single-developer project. A monorepo restructure would be disproportionate.

The path alias approach is lightweight:
- Types are pure `export interface` / `export type` declarations with no runtime code
- Backend imports via relative path: `import type { Case } from '../types/case'`
- Frontend imports via alias: `import type { Case } from '@shared/case'`
- Both resolve to the same `.ts` files
- `import type` statements are erased at compile time, so module resolution differences between `NodeNext` (backend) and `bundler` (frontend) don't matter

Setup required:
- `ui/tsconfig.app.json`: `"baseUrl": "."`, `"paths": { "@shared/*": ["../lib/types/*"] }`, `"include": ["src", "../lib/types"]`
- `ui/vite.config.ts`: `resolve.alias` mapping `@shared` to `path.resolve(__dirname, '../lib/types')`

---

## Extensionless Type Imports

**Decision**: All `import type` statements in `lib/types/` use extensionless paths (e.g. `import type { Fact } from './fact'`), not the `.js` extension that `NodeNext` normally requires.

**Alternatives considered**: Using `.js` extensions as `NodeNext` conventionally requires.

**Rationale**: The `.js` extension convention exists because `NodeNext` mirrors how Node.js resolves modules at runtime -- and at runtime, the files are `.js`. But `import type` statements are erased entirely at compile time; they never resolve at runtime. Both the root tsconfig (`NodeNext`) and the UI tsconfig (`bundler`) accept extensionless `import type` statements.

The practical trigger for this decision: Cursor's language server was flagging the `.js` imports with "Cannot find module './fact.js'" errors in the editor, even though `tsc` compiled cleanly. Extensionless imports are correct for both compilation targets and don't produce editor warnings.

---

## Infrastructure / Application Stack Separation

**Decision**: CDK resources are split into two stacks: `InfrastructureStack` (persistent data) and `ConsultingDetectiveStack` (stateless compute).

**Alternatives considered**:
1. A single stack for everything (the original design).
2. Per-service stacks (one for API, one for generation, one for frontend, etc.).

**Rationale**: CloudFormation cannot replace a custom-named resource in-place. When the DynamoDB table's key schema needed to change, the deploy failed because the table had a hardcoded `tableName` and `RETAIN` removal policy -- CloudFormation couldn't delete the old table to make room for the new one, even after the table was manually deleted, because it still existed in CloudFormation's state.

Separating persistent resources into their own stack solves this:
- The infrastructure stack changes rarely. DynamoDB table schema changes are infrequent and can be managed carefully.
- The application stack can be freely destroyed and recreated without affecting stored data. This makes it safe to rename resources, change custom names, or restructure compute.
- `npm run destroy` targets only the application stack by default, preventing accidental data loss.

The rule is simple: if a resource holds data you can't regenerate, it goes in the infrastructure stack. Everything else goes in the application stack. The infrastructure stack exports resource references (table ARN, etc.) and the application stack receives them as constructor props.

---

## Subjects Over Identity Categories

**Decision**: Facts have `subjects: string[]` (characterIds and locationIds the fact is about) instead of separate `person` and `place` fact categories.

**Alternatives considered**: Dedicated "person" and "place" fact categories as identity atoms that gate casebook entries.

**Rationale**: Person/place categories conflated "what this fact is about" with "what category of fact it is." A fact can be *about* a person (e.g. "The butler had a motive") without being an "identity" fact. The subject list is explicit: every fact declares which characters and locations it concerns. Gating and discovery use the same mechanism — discovering any fact that has subject X in its `subjects` unlocks that subject's casebook entry. Categories (motive, means, opportunity, etc.) describe the *kind* of information; subjects describe *what* it's about.

---

## Enriched Event Reveals

**Decision**: `CausalEvent.reveals` is `EventReveal[]`, where each reveal has `id`, `audible`, `visible`, `physical`, and `subjects`, instead of a plain `string[]` of fact IDs.

**Alternatives considered**: Flat list of fact IDs; deriving perception from event location and involvement only.

**Rationale**: Different involvement types learn facts through different channels. An agent or someone present learns everything; a visual witness only learns reveals with `visible: true`; an auditory witness only `audible: true`; someone who discovers evidence only `physical: true`. Storing these flags on each reveal lets ComputeEventKnowledge build role and location knowledge programmatically without re-interpreting prose. `subjects` on the reveal ties the factId to role/location IDs before characters and locations exist.

---

## Knowledge State Expansion

**Decision**: `KnowledgeStatus` includes `hides`, `denies`, and `believes` in addition to `knows` and `suspects`.

**Alternatives considered**: Only `knows` and `suspects`; freeform strings.

**Rationale**: Characters can actively conceal (`hides`), contradict the truth (`denies`, with a corresponding false fact they `believes`), or confidently state false information (`believes`). These states drive prose generation (deflection, denial, confident misinformation) and feed into ComputeFacts (denials create false fact skeletons; bridge facts and red herrings use the same knowledge-state machinery). A fixed enum keeps validation and downstream logic simple while covering the needed narrative behaviors.

---

## Programmatic Casebook Construction

**Decision**: Casebook structure is largely programmatic: each subject (character or location) becomes an entry; gating and reveals are derived from the fact–subject graph and character knowledge / location reveals. AI polishes labels, addresses, and who is present.

**Alternatives considered**: Fully AI-designed casebook; fully programmatic with no AI polish.

**Rationale**: Pure AI design risked inconsistent gating (entries unreachable from introduction facts) and extra validation retries. Pure programmatic lacked narrative flair (addresses, era-appropriate labels, which characters appear where). The hybrid: ComputeFacts and the graph guarantee connectivity; GenerateCasebook uses that structure and lets the AI fill in presentation and narrative choices. ValidateCasebook still runs a reachability check but failures should be rare.

---

## Removal of `informed_after` Involvement

**Decision**: `InvolvementType` no longer includes `informed_after`. Secondhand knowledge is modeled as separate events.

**Alternatives considered**: Keeping `informed_after` and having ComputeEventKnowledge treat it as a diluted knowledge source.

**Rationale**: "Learned secondhand" is itself a narrative event (e.g. "Character A told Character B about the argument"). Modeling it as a distinct event keeps the causal DAG accurate and lets reveals and perception be explicit for that event. The involvement set stays about *direct* connection to an event (agent, present, witness_visual, witness_auditory, discovered_evidence), simplifying both prompts and the event-knowledge computation.

---

## Compute Prefix Convention

**Decision**: Pipeline steps that are pure logic (no LLM) are named with a **Compute** prefix: ComputeEventKnowledge, ComputeFacts, ComputeOptimalPath.

**Alternatives considered**: "Build," "Derive," or no special prefix.

**Rationale**: The pipeline mixes AI steps (Generate*, Validate*) and deterministic steps. Naming the latter "Compute" makes it obvious they have no model calls, no retries for creativity, and deterministic outputs given inputs. This helps with debugging, cost attribution, and choosing which steps need validation loops.

---

## GenerateIntroduction Rationale

**Decision**: A dedicated step, GenerateIntroduction, runs after GenerateFacts and before GenerateCasebook. It selects introduction fact IDs and writes the introduction prose and title.

**Alternatives considered**: Selecting introduction facts inside ComputeFacts or GenerateFacts; writing the introduction in the same step as casebook scenes (GenerateProse).

**Rationale**: Introduction facts must form a coherent opening hook and seed enough subjects to unlock 2–3 entries — a narrative judgment. ComputeFacts is programmatic and doesn't choose "which facts tell the best story." GenerateFacts only expands placeholders. So selection belongs in an AI step that sees the full fact set, characters, and graph. Writing the introduction prose in that same step keeps tone and content aligned; GenerateProse then only does casebook scenes, with one LLM call for cross-scene coherence.

---

## Question Answer Types

**Decision**: Questions use `answer: QuestionAnswer` with `type: 'person' | 'location' | 'fact'`, optional `factCategory`, and `acceptedIds` (characterIds, locationIds, or factIds depending on type).

**Alternatives considered**: All questions answered by selecting a fact; separate question types with different UI only.

**Rationale**: Some questions ask "who" or "where" — the player should choose from discovered people or places, not from a fact description that *mentions* them. Using `type` and `acceptedIds` lets one answer structure support person, location, and fact answers. The UI shows the appropriate list (discovered subjects vs. discovered facts filtered by category). Scoring and optimal path treat all three uniformly: an entry satisfies a question if the facts it reveals (and their subjects) imply one of the accepted IDs.
