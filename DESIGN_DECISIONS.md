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

Instead, guilt is emergent: a Question asks "Who murdered Mr. Pemberton?", its `requiredFacts` point to the evidence, and its `answer` names the character. The data model supports any narrative conclusion the questions want to probe.

---

## Location vs. CasebookEntry Split

**Decision**: The world model (`Location`) and the player-facing address book (`CasebookEntry`) are separate types.

**Alternatives considered**: A single `Location` type that serves both as world scaffolding and as the visitable address.

**Rationale**: These are different concerns:
- **Locations** are spatial/physical: they have perception edges (visibleFrom, audibleFrom), containment hierarchy (parent), and adjacency. They exist to constrain what characters could perceive during events. The player never sees them directly.
- **CasebookEntries** are the game mechanic: they have a label, address, prose scene, and list of revealed facts. They are what the player interacts with.

The split enables:
- **Multiple entries per location**: Visiting the pub in the morning (the barkeeper is alone) vs. the evening (the regulars are there) are different casebook entries at the same location.
- **Person-focused entries**: "Consult Inspector Lestrade" is a casebook entry that happens to take place at Scotland Yard, but the entry is about the person, not the place.
- **Document and event entries**: Examining a letter or attending an inquest are casebook entries that reference a location but aren't really "about" visiting that place.

---

## No `isRedHerring` Flag

**Decision**: Casebook entries have no `isRedHerring: boolean` property.

**Alternatives considered**: Explicitly marking red herring entries during generation.

**Rationale**: "Red herring" is a derived property, not an intrinsic one. A casebook entry is a red herring if the intersection of its `revealsFactIds` with the union of all `question.requiredFacts` is empty. This can be computed at validation time:

```typescript
const criticalFacts = new Set(
  case.questions.flatMap(q => q.requiredFacts)
);
const isRedHerring = (entry: CasebookEntry) =>
  entry.revealsFactIds.every(fid => !criticalFacts.has(fid));
```

Storing it would create a maintenance burden: if questions change, the flag could become stale. Computing it on demand is trivial and always correct.

---

## Records Over Arrays

**Decision**: `Case.events`, `.characters`, `.locations`, `.casebook`, and `.facts` are all `Record<string, T>` maps keyed by ID. Only `questions` and `optimalPath` are arrays.

**Alternatives considered**: Arrays for everything (the initial design), with ID lookups done via `.find()`.

**Rationale**: Most access patterns are by ID: "given this eventId, get the event", "given this characterId, get the character." Records give O(1) lookup. Arrays require O(n) scans.

Arrays are kept where they're appropriate:
- `questions`: Order matters (presented sequentially to the player).
- `optimalPath`: Order matters (it's a sequence of visits).
- Reference ID lists (`causes`, `reveals`, `revealsFactIds`, `adjacentTo`, etc.): These are sets of IDs, not keyed structures. Arrays are fine; they're small and iterated, not looked up by key.

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
- `participant`: directly involved -- knows firsthand details
- `witness_visual`: saw it happen from another location -- can describe what they saw but may have misinterpreted
- `witness_auditory`: heard it from another location -- can report sounds but not sights
- `informed_after`: learned secondhand -- has filtered/distorted information
- `discovered_evidence`: found physical traces later -- knows the aftermath but not the event itself

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
