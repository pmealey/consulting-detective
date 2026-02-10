# Retrying Case Generation from a Step

When the case generation Step Function fails (e.g. validation or an LLM error), you can retry from a specific step using **partial state**: the state from the failed run (optionally edited) plus a `startFromStep` field. The state machine will skip earlier steps and run from that step to the end.

## When to use this

- A step failed after several retries and you’ve fixed data (e.g. in the template, events, or facts) and want to re-run from that step.
- You have a saved state file and want to resume from a given step (e.g. after fixing something in `events` or `locations`).

## Valid `startFromStep` values

Use the **first step you want to run** in the segment you’re resuming. All steps after it will run as normal.

| Step | You must have in state |
|------|------------------------|
| `generateEvents` | `input`, `template` |
| `computeEventKnowledge` | `input`, `template`, `events`, and events must already be valid (or you’ll re-validate) |
| `generateCharacters` | `input`, `template`, `events`, `computedKnowledge` |
| `generateLocations` | … plus `characters`, `roleMapping` (and characters valid) |
| `computeFacts` | … plus `locations` (and locations valid) |
| `generateFacts` | … plus `factSkeletons`, `factGraph` |
| `generateIntroduction` | … plus `facts` (and facts valid) |
| `generateCasebook` | … plus `introductionFactIds`, `introduction`, `title` |
| `generateProse` | … plus `casebook` (and casebook valid) |
| `generateQuestions` | … plus `prose`, `introduction`, `title` |

You **cannot** resume from `generateTemplate`; omit `startFromStep` to run the full pipeline from the beginning.

## How to retry

### 1. Get the state from the failed run

**Option A – AWS Console**

1. Open Step Functions → State machines → `ConsultingDetective-CaseGeneration`.
2. Open the failed execution.
3. Open the **last successful** step (or the step you want to re-run) and copy its **Output** (that’s the full `CaseGenerationState` at that point).

**Option B – AWS CLI**

```bash
aws stepfunctions get-execution-history --execution-arn "arn:aws:states:REGION:ACCOUNT:execution:..." --output json
```

Find the event for the last successful state (e.g. `LambdaFunctionSucceeded`), and use that event’s `output` as your state JSON.

### 2. (Optional) Edit the state

- Fix any fields that caused the failure (e.g. add a missing location, fix a fact subject).
- If you’re re-running a step that had validation failures, you can remove that step’s validation result and retry counter so the pipeline doesn’t think retries are exhausted, e.g. remove `factValidationResult` and set `generateFactsRetries` to `0` when resuming from `generateFacts`.

### 3. Add `startFromStep`

Add a top-level field to the state JSON:

```json
{
  "input": { "caseDate": "2025-02-10", ... },
  "template": { ... },
  "events": { ... },
  "startFromStep": "generateLocations"
}
```

Use one of the step names from the table above.

### 4. Start a new execution with that input

**AWS Console**

1. Open the state machine → **Start execution**.
2. Paste your JSON (the state + `startFromStep`) as the input.
3. Start the execution.

**AWS CLI**

```bash
aws stepfunctions start-execution \
  --state-machine-arn "arn:aws:states:REGION:ACCOUNT:stateMachine:ConsultingDetective-CaseGeneration" \
  --input file://resume-state.json
```
