# Moonstone Lineage -- From Extraction to Generation

This project's data model descends directly from the [moonstone-packet](https://github.com/...) project, which extracts narrative structure from Wilkie Collins' *The Moonstone* (1868). The moonstone-packet takes a finished novel and decomposes it into computational structures: causal chains, knowledge states, location graphs, perspective matrices. This project inverts those same structures to *generate* new narratives.

The relationship is: **extraction is analysis; generation is synthesis. Same structures, opposite direction.**

## The Inversion Principle

The moonstone-packet pipeline:
```
Finished narrative -> Extract fragments -> Build structural graphs -> Analyze
```

The consulting-detective pipeline:
```
Structural templates -> Generate content -> Assemble into narrative -> Split into discoverable fragments
```

Where the moonstone-packet asks "given this text, what are the events, who knows what, and how does information flow?", this project asks "given these structural constraints, can we generate a coherent narrative and distribute it across discoverable locations?"

## Structure-by-Structure Lineage

### Causal Chain Graph -> `CausalEvent`

**Moonstone-packet source**: `scripts/build_causal_chain_graph.py`

The moonstone-packet defines an `EVENTS` dict (22 events with description, date, agent, necessity) and `CAUSAL_EDGES` (directed edges with types: CAUSES, ENABLES, PREVENTS). Together they form a DAG of what happened and why.

**Inverted as**: `CausalEvent` interface with `eventId`, `agent`, `location`, `timestamp`, `necessity`, `causes[]`, `reveals[]`, and `involvement` map.

**What changed**: The extraction model separates events and edges into two data structures. The generation model embeds the edges (`causes`) and adds fields needed for generation: `location` (where it happened), `reveals` (which facts this event produces), and `involvement` (who was connected to this event and how). The `involvement` map replaces the moonstone-packet's Event-Perspective Coverage Matrix for event-level character connections.

### Knowledge State Graph -> `Fact` + `Character.knowledgeState`

**Moonstone-packet source**: `scripts/build_knowledge_state_graph.py`

The moonstone-packet defines a `FACTS` dict (12 key narrative facts) and a `KNOWLEDGE_STATES` dict mapping each character to each fact with a tuple of (status, since_when, belief). This creates a bipartite graph: Characters <-> Facts, with edges typed as `knows`, `suspects`, `believes_false`, or `unknown`.

**Inverted as**: `Fact` interface (factId, description, category, critical) and `Character.knowledgeState: Record<string, KnowledgeStatus>`.

**What changed**: The extraction model tracks *when* knowledge changes (`since_when`) because it's analyzing a narrative that unfolds over time. The generation model drops temporal knowledge tracking -- in a compressed daily case, characters have a single knowledge state at "investigation time." The bipartite structure is preserved: facts exist independently, characters reference them by ID in their knowledge state map.

### Location Graph -> `Location`

**Moonstone-packet source**: `scripts/build_location_graph.py`

The moonstone-packet defines `LOCATIONS` (with description, type, parent, floor), `SPATIAL_EDGES` (CONTAINS, ADJACENT_TO, VISIBLE_FROM, AUDIBLE_FROM), and `EVENT_LOCATIONS` mapping events to where they occurred. It also computes a perception matrix: for each location, which other locations can see/hear it.

**Inverted as**: `Location` interface with `locationId`, `name`, `type`, `description`, `parent?`, `adjacentTo[]`, `visibleFrom[]`, `audibleFrom[]`.

**What changed**: The extraction model uses separate edge lists (SPATIAL_EDGES) and a computed perception matrix. The generation model embeds the spatial relationships directly on each location as adjacency lists. The perception edges (`visibleFrom`, `audibleFrom`) are the key innovation from the moonstone-packet: they constrain who could have witnessed what, which drives the `involvement` computation on events during generation.

Locations in this project are *generation scaffolding*, not player-facing. Players interact with `CasebookEntry` objects instead (see below).

### Event-Perspective Coverage Matrix -> `CasebookEntry` + `CausalEvent.involvement`

**Moonstone-packet source**: `scripts/build_event_perspective_matrix.py`

The moonstone-packet builds a matrix of Narrators x Events, where each cell is a coverage type: `direct`, `hearsay`, `retrospective`, `inferred`, `not_covered`. This tracks which narrators cover which events and how they learned about them.

**Inverted as**: Two structures working together:
- `CausalEvent.involvement: Record<string, InvolvementType>` -- how each character is connected to each event (agent, participant, witness_visual, witness_auditory, informed_after, discovered_evidence)
- `CasebookEntry.revealsFactIds: string[]` -- which facts are discoverable at each visitable address

**What changed**: The extraction model maps narrators to events (who tells which part of the story). The generation model splits this into two concerns: (1) how characters are connected to events (involvement, which shapes what they know and can say), and (2) what information is available at each casebook address (revealsFactIds, which drives the game mechanic). The coverage types were adapted into `InvolvementType` to better reflect the generation context.

The concept of "narrators" (from the multi-narrator novel structure) becomes "casebook entries" -- each entry is filtered through the perspectives of the characters present, just as each narrator section in *The Moonstone* is filtered through that narrator's consciousness.

### CHARACTERS.md Template -> `Character`

**Moonstone-packet source**: `CHARACTERS.md`

The moonstone-packet documents each character with: Role/Position, What They Know and When, What They Want, What They Hide, Key Actions.

**Inverted as**: `Character` interface with `characterId`, `name`, `role`, `description`, `wants[]`, `hides[]`, `knowledgeState`, `tone`.

**What changed**: The "What They Know and When" becomes `knowledgeState` (a Record, not prose). "Key Actions" is dropped -- in the generation model, a character's actions are represented by their appearance as `agent` or `participant` in events. The `tone` field was added to support scene generation (see below).

### TONE.md -> `ToneProfile`

**Moonstone-packet source**: `TONE.md`

The moonstone-packet documents each narrator's voice: core register, vocabulary markers, rhythm and syntax, emotional coloring, tonal shift triggers.

**Inverted as**: `ToneProfile` interface with `register`, `vocabulary[]`, `quirk?`.

**What changed**: The extraction model is richly detailed (sentence length distributions, digression frequency, direct address rate). The generation model is intentionally minimal -- just enough to prompt an LLM to generate distinctive dialogue. The full stylometric analysis from the moonstone-packet informed the design, but the interface carries only what's needed for generation.

### Counterfactual DAG -> Future: Template Variants

**Moonstone-packet source**: `scripts/build_counterfactual_dag.py`, `COUNTERFACTUALS_PLAN.md`

The moonstone-packet builds a DAG where the actual event chain is the spine, and hinge points branch to counterfactual alternatives ("what if Rachel had confronted Franklin immediately?"). Each alternative has plausibility notes and lists which downstream events it would block.

**Not yet inverted**, but the planned application is case template variants: a single parameterized crime template (e.g. "theft motivated by debt") could have hinge points where alternatives produce different cases. Flip a hinge ("the alibi holds" vs. "the alibi breaks") and the same cast of characters produces a different mystery. This gives replayability without creating entirely new templates.

## Summary Table

| Moonstone-Packet Structure | Source File | Consulting-Detective Type | Key Adaptation |
|---|---|---|---|
| EVENTS + CAUSAL_EDGES | build_causal_chain_graph.py | `CausalEvent` | Embedded edges, added involvement map |
| FACTS + KNOWLEDGE_STATES | build_knowledge_state_graph.py | `Fact` + `Character.knowledgeState` | Dropped temporal tracking, kept bipartite structure |
| LOCATIONS + SPATIAL_EDGES | build_location_graph.py | `Location` | Embedded edges as adjacency lists, perception edges preserved |
| Coverage Matrix (Narrators x Events) | build_event_perspective_matrix.py | `CausalEvent.involvement` + `CasebookEntry.revealsFactIds` | Split narrator coverage into event involvement + entry fact distribution |
| Character template (know/want/hide) | CHARACTERS.md | `Character` | Added tone, dropped prose-format knowledge tracking |
| Narrator voice profiles | TONE.md | `ToneProfile` | Compressed to generation-minimal specification |
| Counterfactual DAG | build_counterfactual_dag.py | (future: template variants) | Not yet implemented |
