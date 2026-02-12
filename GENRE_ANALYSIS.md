# Genre Analysis

How this project relates to *Sherlock Holmes, Consulting Detective* and the broader narrative detective game genre.

## Sherlock Holmes, Consulting Detective — The Tabletop Games

**Sherlock Holmes, Consulting Detective** (SHCD) was first published in 1981 by Raymond Edwards, Suzanne Goldberg, and Gary Grady. It's one of the earliest and most influential narrative deduction games.

**Core loop:** Read an introduction describing a crime, then freely choose addresses to visit from a casebook — a booklet of ~100 numbered entries representing people and places across London. Each entry is a short prose scene: a conversation with a witness, a visit to a crime scene, a stop at the newspaper archives. After investigating, answer a set of questions and compare your score to Sherlock Holmes, who solved it in fewer visits.

**Key characteristics:**

- **Open-world investigation.** No turns, no dice, no board in the traditional sense. You pick where to go and read what happens. The map of London and a newspaper are your tools.
- **Efficiency scoring.** Holmes always solves it in some small number of visits. Every visit beyond his count costs points. This creates tension between thoroughness and parsimony.
- **Handcrafted cases.** Each case takes months or years to write. A box contains ~10 cases. Writing quality and narrative coherence are high, but production is slow — decades between expansions.
- **One-shot play.** Once you know the answers, a case has no replay value.
- **Occasional unfairness.** A common criticism: some cases require leaps of logic that feel arbitrary, or contain information that's hard to connect without already knowing the answer. The Holmes comparison can feel punishing.

**Editions and expansions:**

- The original 1981 set (10 cases), reprinted and revised multiple times by Ystari and Space Cowboys.
- *The Thames Murders & Other Cases*, *Jack the Ripper & West End Adventures*, *Carlton House & Queen's Park* — each adding ~10 cases.
- *Baker Street Irregulars* (2020) — a standalone set with a more modern design sensibility.
- The franchise has been translated into many languages and has sold steadily for 40+ years.

## The Broader Genre: Narrative Detective Games

SHCD spawned a whole genre. Notable entries:

**Detective: A Modern Crime Board Game** (Portal Games, 2018) — Modernizes the formula with a database website (Antares), time management (each lead costs time from a shared pool), and interconnected cases forming a campaign. More structured than SHCD but similarly text-heavy.

**Chronicles of Crime** (Lucky Duck Games, 2018) — Uses an app with QR codes. Scan locations and characters to trigger scenes. Lighter and more accessible than SHCD, with a time mechanic and 3D crime scene VR viewing.

**Mythos Tales** (2016) — Essentially SHCD reskinned into a Lovecraftian setting. Same casebook-and-questions structure.

**Suspects** (Studio H, 2021) — Streamlined card-based version. Each card is a lead; select which to read. Smaller scope, faster play, same core tension of efficiency vs. thoroughness.

**MicroMacro: Crime City** (2020) — A different take: a giant illustrated city map where you visually trace events. No text-heavy casebook, but the same "reconstruct what happened" goal.

**Shadows of Doubt** (ColePowered Games, 2023) — A procedurally generated detective game in a 3D voxel city. Real-time investigation with generated suspects, motives, and evidence. Closest existing example of procedural mystery generation, though it's a very different format (immersive sim vs. text-based casebook).

## Comparison to This Project

### What we share with SHCD

| Aspect | SHCD | This Project |
|--------|------|-------------|
| Core loop | Read intro → visit casebook entries → answer questions | Identical |
| Efficiency scoring | Visits beyond Holmes's count penalized | Visits beyond optimal path penalized |
| Open investigation | Visit entries in any order | Same, with subject-gating for discovery |
| Prose scenes | Each entry is a narrative vignette | Same — AI-generated prose per entry |
| Question-based resolution | Answer specific questions at the end | Same, with typed answers (person/location/fact) |

### Where we diverge

**1. Procedural generation vs. hand-authoring.**

SHCD cases take months or years to write. This project generates them weekly. The tradeoff is clear: handcrafted cases have richer prose, more surprising twists, and deeper red herrings. But they're finite and expensive to produce. Generated cases are renewable, though they need to earn the same sense of investigative satisfaction through structural means.

**2. Structural guarantees.**

SHCD cases are sometimes criticized for unfair leaps — information that's technically available but practically impossible to connect. This project addresses that structurally: the fact-subject graph ensures reachability, the optimal path computation guarantees solvability, and the gating system prevents players from hitting dead ends. In principle, this should produce more consistently fair cases than hand-authoring, where fairness depends entirely on the author's discipline.

**3. Subject-based gating vs. fully open casebook.**

In SHCD, all ~100 entries are available from the start. You might visit entry 42 on a whim and stumble into something useful (or waste your time). This project gates entries behind discovered subjects — you need to learn about a character or location before you can visit their entry. This creates a discovery tree rather than a flat list, giving the investigation more structure but less serendipity.

**4. Emergent conclusions vs. explicit solutions.**

SHCD has a "solution" section you read at the end that tells you exactly what happened. This project has no `guilty` flag — guilt is a conclusion the player draws from evidence, validated only through questions. This avoids the "oh, I was supposed to guess *that*?" frustration of some SHCD solutions, but it also means there's no dramatic reveal moment.

**5. Typed answers vs. free-form questions.**

SHCD asks open-ended questions ("Who murdered Lord Harrington?") and you write answers. This project constrains answers to discovered characters, locations, or facts. More mechanically clean and automatically scorable, but less open-ended.

**6. Knowledge modeling.**

Characters have explicit knowledge states (`knows`, `suspects`, `hides`, `denies`, `believes`). Events have perception constraints (who could see/hear what from where). False facts exist as discoverable misinformation. Tabletop SHCD handles all of this implicitly through authored prose. Making it structural is what enables generation — but it also means the system has to get the modeling right or the prose will feel incoherent.

**7. Scale.**

SHCD cases are large — 100+ entries, complex multi-threaded plots, recurring characters across cases. This project's cases are deliberately smaller (6–15 entries, 3–8 characters). Appropriate for weekly play and for what generation can reliably produce, but it means cases are more like self-contained puzzles than the sprawling investigations SHCD is known for.

### The fundamental tension

The core challenge is the same one that faces any procedural narrative generation: **authored content has intentionality that generated content struggles to match.** A human author can plant a clue in entry 7 that recontextualizes everything you read in entry 3, creating an "aha!" moment. A generation system can ensure the *information* is there, but the *feeling* of a carefully planted revelation is harder to produce.

The data model is a serious attempt to address this — the causal DAG, knowledge states, and perception constraints create *structural conditions* for those moments to emerge. Separating scaffolding (events, locations) from presentation (casebook entries, prose) means the narrative logic can be sound even when the prose needs work.

### Closest comparisons

- **Shadows of Doubt** is the closest existing game in terms of procedural mystery generation, but it's a real-time 3D immersive sim — a completely different format and player experience.
- **AI Dungeon and similar narrative AI games** are freeform, not structured mystery games with scoring and solvability guarantees.
- **Murder mystery party generators** produce social scenarios, not investigative casebooks with evidence chains.

The combination of structured generation (causal DAGs, knowledge modeling, fact-subject graphs) with the specific SHCD-style casebook format is, as far as I can tell, a novel approach.
