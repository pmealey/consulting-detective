# Game Design -- Daily Consulting Detective

## What Consulting Detective Games Are

*Sherlock Holmes, Consulting Detective* is a series of tabletop games (by Ystari/Space Cowboys and others) where players take the role of Baker Street Irregulars -- Holmes's network of assistants. Each game presents a case: a crime has occurred, and the players must investigate.

The game provides:
- An **introduction** describing the crime and initial circumstances
- A **casebook** of dozens of addresses the players can visit (locations, witnesses, experts, institutions)
- A **newspaper** with the day's headlines (some relevant, some noise)
- A **map** of London

Players choose which addresses to visit, in any order. Each address has a short prose entry: a scene describing what you find or who you talk to. Some entries reveal critical information. Others are dead ends, red herrings, or atmospheric color.

After investigating, Holmes poses a series of **questions** about the case. Players compare their answers against the solution, and their score is penalized for each address visited beyond Holmes's own optimal path.

## The Core Insight

These games appear to be logical deduction puzzles, and they do contain deduction elements. But their real nature is **narrative discovery**. You're given an outcome (someone was murdered, something was stolen) and must work backwards to reconstruct the narrative that led to it. You need to discover characters, events, relationships, motives, and timelines, then assemble them into a coherent story that explains what happened.

The game is less "solve the logic puzzle" and more "can you piece together the story from fragments?"

This makes them a natural fit for procedural generation: generating a coherent narrative and then splitting it into discoverable fragments is a well-structured problem.

## The Daily Case Concept

This project generates a small case every day -- compressed enough to be solvable in a few minutes, but with the same fundamental loop as the tabletop game.

A daily case has:
- **6-15 casebook entries** (addresses to visit)
- **3-8 characters** (NPCs with knowledge, motives, and secrets)
- **8-20 facts** (discoverable pieces of information)
- **4-8 questions** (the end-of-case quiz)
- **An optimal path of 3-6 entries** (Holmes's solution)

The scale is flexible. An "easy" daily case might have 6 entries with 3 questions. A "hard" case might have 15 entries with 8 questions and more misleading information.

## The Player Experience

### 1. Read the Introduction

The player opens the daily case and reads a short introduction setting the scene: a crime has been committed, a mystery has arisen. The introduction establishes the setting, the victim or situation, and the initial known facts. It does not reveal the solution. The 2–4 facts that the introduction is built from are treated as **discovered** from the start: they seed the player's discovered facts and discovered subjects, so a few casebook entries become available immediately.

### 2. Investigate the Casebook

The player sees a list of casebook entries -- addresses they can visit. Each entry has a label and address. The player picks one and reads the scene: a short prose fragment describing what they find or who they talk to.

Each scene is written from the perspective of whoever is at that address. A nervous landlady speaks differently from a brusque inspector. Characters reveal what they know, hint at what they suspect, and conceal what they're hiding. The player's job is to notice which details matter.

The player can visit entries in any order and as many or as few as they like. Every visit is a tradeoff: more information, but a worse score if they visit more than Holmes needed.

### 3. Answer the Questions

After investigating, the player faces a series of questions: "Who did it?", "What was the motive?", "How did the murderer enter the building?", "Which witness is lying?" Each question has a structured answer:

- **Person questions**: The player selects from **discovered character subjects** (people they've learned about by discovering facts that mention them). The correct answer is one of the accepted character IDs.
- **Location questions**: The player selects from **discovered location subjects** (places they've learned about the same way). The correct answer is one of the accepted location IDs.
- **Fact questions**: The player selects from their **discovered facts**, filtered by the question's fact category (e.g. motive, means, opportunity). The correct answer is one of the accepted fact IDs.

The game tracks both **discovered facts** and **discovered subjects**. Visiting an entry (or reading the introduction) reveals facts; any character or location that appears in those facts' `subjects` is added to the player's discovered subjects. So the player builds a set of "people and places I know about" as well as "facts I've learned," and the quiz may ask for either.

### 4. Get Scored

The scoring formula rewards efficiency:

```
questionsScore = sum of points for each correct answer
visitPenalty   = max(0, entriesVisited - optimalEntries) * penaltyPerExtraVisit
finalScore     = questionsScore - visitPenalty
```

A perfect score means answering every question correctly while visiting exactly the same number of entries as the optimal path. Visiting every entry guarantees access to all facts but incurs a heavy penalty. The challenge is to identify the most informative entries and skip the rest.

## What Makes a Good Case

A well-generated case has these qualities:

**Interesting narrative**: The underlying story should feel like a real (if compressed) mystery. Characters should have believable motives. The sequence of events should be causally coherent -- each thing happened because of something before it.

**Fair cluing**: Every question must be answerable from the available facts. No question should require information that isn't discoverable in the casebook. The player should feel "I could have figured that out" even when they get it wrong.

**Multiple solving paths**: Critical facts should be available at more than one entry where possible. A player who visits different entries than Holmes can still succeed if they visited entries that cover the same facts.

**Plausible red herrings**: Some entries should look promising but reveal nothing critical. A good red herring feels relevant in the moment -- it's only in retrospect that the player realizes it was a dead end. This is what makes the optimal-path challenge interesting.

**Distinct voices**: Each character should feel like a person, not an information dispenser. The nervous clerk, the evasive business partner, the matter-of-fact inspector -- tone and perspective make the scenes enjoyable to read even when they don't advance the investigation.

**Emergent conclusions**: The game never tells you who the culprit is. The questions ask, and the player must deduce the answer from evidence. The narrative conclusions (guilt, motive, method) emerge from connecting facts, not from any single revelation.

**False facts as discoverable items**: Some facts in the case are marked **false** (misinformation: alibis that aren't true, claims a character believes but that are wrong). False facts are still discoverable — the player may hear them in a scene and add them to their fact list. They are never correct answers: every question's accepted answers reference only true facts (or the real character/location IDs). Following a false lead can still unlock casebook entries (e.g. visiting someone who believes a falsehood might reveal a subject that gates another entry), so false facts add noise and red herrings without breaking fairness.
