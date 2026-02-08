# CLAUDE.md

Guidance for AI agents working on this project.

## Project Identity

A **daily mystery game** inspired by *Sherlock Holmes, Consulting Detective* tabletop games. The system generates a small case each day: a crime, a casebook of visitable addresses, and a quiz. Players investigate by visiting casebook entries, gathering facts, then answering questions. Scoring rewards efficiency -- fewer visits for the same correct answers means a higher score.

## Key Files

| File | Purpose |
|------|---------|
| `GAME_DESIGN.md` | What the game is, player loop, scoring |
| `DATA_MODEL_DESIGN.md` | Data structure relationships (ER diagram), generation pipeline, scoring formula |
| `MOONSTONE_LINEAGE.md` | How the data model descends from the moonstone-packet project |
| `DESIGN_DECISIONS.md` | Rationale for specific design choices -- read before proposing structural changes |
| `lib/types/` | **Source of truth** for the case data model. Read these first. |
| `lib/infrastructure-stack.ts` | CDK infrastructure stack (DynamoDB -- persistent data) |
| `lib/consulting-detective-stack.ts` | CDK application stack (Lambda, API Gateway, S3+CloudFront, Step Functions) |
| `lib/lambda/` | Backend Lambda handlers |
| `ui/` | React + Vite + Tailwind frontend (separate npm package) |

## The Data Model Is the Source of Truth

The TypeScript interfaces in `lib/types/` are the authoritative definition of a Case and all its components. The design docs explain *why* they're shaped the way they are. Read the types before changing anything structural.

## Design Principles

These are deliberate decisions. Don't undo them without discussion.

- **Narrative conclusions are emergent.** No `guilty` flags, no baked-in answers. "Who did it" is a question the player answers from evidence, not a property of a character.
- **Location and CasebookEntry are separate.** Locations are spatial scaffolding for generation (perception edges, containment). CasebookEntries are the player-facing game mechanic. Don't merge them.
- **Derived properties are computed, not stored.** Whether an entry is a red herring, whether a fact is critical -- these are derivable from the data. Don't add flags for them.
- **Involvement over movements.** Character positions come from event involvement, not independent tracking. If a character isn't involved in an event, where they are doesn't matter.
- **Records for keyed collections, arrays for ordered data.** Events, characters, locations, casebook entries, and facts are `Record<string, T>`. Questions and optimalPath are arrays.

## Sibling Project

The `the-moonstone-packet` project (sibling directory) extracts narrative structure from *The Moonstone* by Wilkie Collins. This project's data model inverts those extraction structures into generation schemas. See `MOONSTONE_LINEAGE.md` for the full mapping.

## Where Code Goes

- **Shared types**: `lib/types/` -- pure type exports, no runtime code
- **Lambda handlers**: `lib/lambda/<domain>/<action>.ts` -- use shared utilities from `lib/lambda/shared/`
- **Infrastructure stack**: `lib/infrastructure-stack.ts` -- persistent data resources only (DynamoDB)
- **Application stack**: `lib/consulting-detective-stack.ts` -- stateless resources (Lambdas, API Gateway, CloudFront, S3, Step Functions)
- **UI components**: `ui/src/` -- import shared types via `@shared/*` alias

## Build and Deploy

```bash
# Install dependencies
npm install              # root (CDK + lambdas)
npm install --prefix ui  # frontend

# Local dev (frontend against deployed backend)
npm run dev              # runs Vite dev server in ui/

# Deploy everything (both stacks)
npm run deploy           # builds backend + UI, then cdk deploy --all

# Deploy individually
npm run deploy:infra     # infrastructure stack only (DynamoDB)
npm run deploy:app       # application stack only (Lambdas, API, CloudFront, etc.)

# CDK operations
npm run synth            # synthesize all CloudFormation templates
npm run diff             # show pending changes across all stacks
npm run destroy          # tear down APPLICATION stack only (safe -- preserves data)
npm run destroy:all      # tear down ALL stacks (destructive -- use with caution)
```

## Stack Separation Pattern

Resources are split across two CloudFormation stacks:

- **InfrastructureStack** (`ConsultingDetectiveInfraStack`): Resources that hold persistent data and use custom names. These have `removalPolicy: RETAIN` and must survive application redeployments. Currently: DynamoDB tables.
- **ConsultingDetectiveStack** (`ConsultingDetectiveStack`): All stateless resources -- Lambdas, API Gateway, CloudFront, S3 (static assets), Step Functions. Can be freely torn down and recreated. Receives persistent resources as constructor props from the infrastructure stack.

When adding new resources, ask: "Does this hold data I can't regenerate?" If yes, it goes in the infrastructure stack. Everything else goes in the application stack.

## Don'ts

- Don't duplicate types between `lib/types/` and `ui/src/`. Use the `@shared/*` alias.
- Don't add runtime code to `lib/types/`. It's type-only.
- Don't store derived properties on the data model.
- Don't add `.js` extensions to imports in `lib/types/`. Use extensionless imports.
- Don't put stateless resources in the infrastructure stack.
- Don't put data-bearing resources in the application stack.
