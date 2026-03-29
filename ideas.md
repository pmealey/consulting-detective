# GENERATION IMPROVEMENTS

## CASEBOOK GEN
- I think the entries are being written as a sequence. We may need to instruct the AI to write each separately, or prompt each separately? But then they become inconsistent.
- some facts are still not being included in the prose.
- if there are too many facts to reveal, should the entry be split into multiple entries?
  - it's hard to fit 15 facts into a single entry, for example.

## FACT GEN
- should facts about multiple subjects have their own casebook entry? I.e. each entry is about each set of subjects, rather than each subject?

## ADDITIONAL INFO / GATED FACTS
- confront a suspect with a fact that implies their guilt
- ask a cagey witness to elaborate on something someone else told you
- gated facts may help with large casebook entries - there's the main entry, then additional info.
  - facts with another fact as a subject?

# BIGGER IDEAS

## COLLABORATIVE INVESTIGATION
- websocket to a investigation session
- the players can indicate which casebook entry they want to investigate next
- when there is consensus, the game navigates to the entry after a small 'are you sure?' chickenbox delay

## EXPERTS
- add in some 'experts' that the player can consult who may or may not help, depending on the setting/case.

## ADDRESSBOOK
- shift to SHCD list of a bunch of addresses that can all be visited, plus a lookup, and maybe even static clues like newspapers to study.
- the current fact/subject gating can help influence what you discover at each, so you don't stumble into an address and it's incomprehensibly leapt three facts ahead in the chain assuming you knew some other thing to get you to that address.

## PROSE GEN
- Markup the prose with tags? <fact>prose describing of fact</fact>, <motivation>prose indicating motivation</motivation>, <quirk>prose describing quirk</quirk>, etc.
- Use prose markers in UI as fact collections? Players must tap prose they want to track, can use tapped prose as answers, etc.
- each tappable bit of prose relates to a specific fact, character, location, etc.

# ENDING
- how to improve questions? dunno.
- The optimal path should include a case explanation from the perspective of the Great Detective, Sherlock Holmesbot.
  - arrogant and dismissive tone, obviously XYZ, clearly lying, leaps of logic, etc.
- instead of automatically tracking learned facts, the player must collect facts and apply them