import { callModel } from '../shared/bedrock';
import { updateDraft } from '../shared/draft-db';
import {
  CaseTemplateSchema,
  type OperationalState,
} from '../shared/generation-state';

/**
 * Setting flavors used to nudge the LLM toward diverse eras, genres, and worlds.
 * One is randomly selected per generation to suggest (not mandate) a direction.
 * When a crimeType is provided in the input, the setting flavor is skipped so
 * the caller's intent takes priority.
 */
const SETTING_FLAVORS = [
  // Historical
  'Ancient world (Egypt, Rome, Greece, Persia, Han China)',
  'Medieval Europe or feudal Japan',
  'Renaissance Italy or Elizabethan England',
  'Golden Age of Piracy, Caribbean or Indian Ocean',
  'Colonial-era mystery in South America, Africa, or Southeast Asia',
  'Victorian or Edwardian era (London, Paris, Vienna, St. Petersburg)',
  'American Wild West or frontier town',
  'Roaring Twenties (New York, Berlin, Shanghai, Buenos Aires)',
  'Prohibition-era speakeasy underworld',
  'Interwar period in a European capital',
  'World War II — occupied territory, espionage, or homefront',
  'Post-war 1940s-50s (Cold War intrigue, film noir Los Angeles, post-war Tokyo)',
  'Swinging 1960s (London, San Francisco, or a newly independent nation)',
  'Cold War spy thriller (Berlin, Moscow, Havana, Washington)',
  '1970s-80s (disco-era crime, Troubles-era Belfast, apartheid-era South Africa)',
  // Modern & near-future
  'Present-day major city (Tokyo, Lagos, São Paulo, Mumbai, New York)',
  'Present-day small town or rural setting',
  'Near-future (2040s-2060s) with plausible technology',
  // Sci-fi
  'Space station, orbital habitat, or generation ship',
  'Cyberpunk megacity (neon-lit, corporate-dominated, street-level crime)',
  'Solarpunk or utopian community hiding dark secrets',
  'Frontier colony on Mars, the Moon, or an exoplanet',
  // Fantasy & speculative
  'High fantasy kingdom or empire (courts, guilds, magic)',
  'Low fantasy or sword-and-sorcery (gritty, grounded, limited magic)',
  'Urban fantasy (modern city with hidden supernatural elements)',
  'Steampunk metropolis (clockwork, airships, industrial intrigue)',
  'Mythic or legendary setting (Norse, Arthurian, Mesopotamian, Yoruba)',
  // Horror & weird
  'Lovecraftian or cosmic horror (isolated coastal town, forbidden knowledge)',
  'Southern Gothic (decaying plantation, swamp, family secrets)',
  'Folk horror (remote village, ancient rituals, creeping dread)',
  // Unconventional
  'Dieselpunk wartime or alt-history setting',
  'Wuxia or martial-arts world (jianghu, sects, honor codes)',
  'Underwater habitat or deep-sea research station',
  'Noir in an unexpected setting (fantasy noir, space noir, fairy-tale noir)',
  'A traveling circus, carnival, or theatrical troupe',
  'An isolated research station (Antarctic, deep jungle, volcanic island)',
] as const;

/**
 * Pipeline Step 1: Generate Template
 *
 * Given difficulty + optional crime type, generates a template:
 * crime type, required event slots, character roles, era/setting.
 */
export const handler = async (state: OperationalState): Promise<OperationalState> => {
  const { input, draftId } = state;
  const difficulty = input.difficulty ?? 'medium';

  // Pick a random setting flavor to suggest variety
  const settingFlavor = SETTING_FLAVORS[Math.floor(Math.random() * SETTING_FLAVORS.length)];

  const systemPrompt = `You are a mystery case designer for a detective game. Your job is to create a case template — the structural blueprint for a mystery. Cases can be set in ANY era, genre, or world: historical, modern, futuristic, fantastical, horrific, or speculative. Embrace creative range.

CRITICAL DISTINCTION — Story Events vs. Investigation:
Event slots describe THE STORY — things that actually happened BEFORE or DURING the crime, from the perspective of the people involved. They are NOT the investigation that follows. The player's investigation is a separate game mechanic (the casebook) built later.

Good event examples (across different settings):
- "Kael discovers the guild master has been siphoning enchantments from the ward-stones" (fantasy)
- "Dr. Vasquez reroutes the station's oxygen recycler to mask the atmospheric poison" (sci-fi)
- "Mama Okafor hides the forged export permits inside the church's donation ledger" (modern Lagos)
- "The chandelier falls during the second act, injuring Hartley" (Victorian theater)
- "Renko photographs the dead drop at Gorky Park before the handler arrives" (Cold War Moscow)
- "The AI companion deletes its own memory logs to protect its owner" (cyberpunk)

Bad event examples (these describe INVESTIGATION, not story):
- "Police are called to investigate" (investigation)
- "Detectives discover the owner's financial troubles" (investigation)
- "Ashford's alibi is confirmed" (investigation)
- "The forensic scan reveals tampered data" (investigation)

The events should read like a timeline an omniscient narrator would write: "First this happened, which caused that, which led to this." The player will piece this timeline together by visiting casebook entries — but the events themselves are the underlying truth of what occurred.

First, briefly think through your creative decisions (crime type, setting/era, how the events connect, what makes this mystery interesting). Then provide the JSON.

Your response must end with valid JSON matching this schema:
{
  "crimeType": string,       // e.g. "murder", "theft", "blackmail", "forgery", "smuggling", "sabotage", "soul-theft", "data exfiltration"
  "title": string,           // evocative case title fitting the setting
  "era": string,             // setting and time period — can be any genre, world, or era
                             // Examples: "Victorian London, 1893", "Cyberpunk Neo-Seoul, 2087",
                             //   "The Free City of Ashenmoor (low fantasy)", "Cold War Berlin, 1962",
                             //   "Lagos, Nigeria, present day", "Kepler Station, Jupiter orbit, 2301",
                             //   "Heian-era Kyoto, 1002", "Post-apocalyptic American Southwest, 2145"
  "date": string,            // in-world date fitting the setting
                             // Examples: "14 March 1893", "Cycle 47, Day 12", "3rd of Frostmoon, Year of the Waning",
                             //   "June 5, 2087", "November 10, 1962"
  "atmosphere": string,      // atmospheric description fitting the setting
                             // Examples: "A damp, fog-choked evening", "Neon reflections shimmer on rain-slicked chrome",
                             //   "The dry season heat presses down on the city like a hand",
                             //   "Torchlight flickers through the castle's crumbling halls"
  "mysteryStyle": string,    // structural shape of the mystery (see below)
  "narrativeTone": string,   // narrative voice and mood (see below)
  "eventSlots": [            // 5-10 events forming the causal spine
    {
      "slotId": string,      // e.g. "E01_inciting_incident"
      "description": string, // what HAPPENED (not what was discovered)
      "necessity": "required" | undefined,
      "causedBy": string[]   // slotIds of events that cause this one (empty for root events)
    }
  ],
  "characterRoles": [        // 3-8 character roles needed
    {
      "roleId": string,      // e.g. "role_victim", "role_suspect_1"
      "role": string,        // e.g. "Victim", "Business Partner", "Guild Enforcer", "Station Medic"
      "description": string  // what this role does in the STORY (not the investigation)
    }
  ],
  "difficulty": "${difficulty}"
}

## Mystery Style

The "mysteryStyle" describes the structural shape of the mystery — how the investigation unfolds. Choose one that fits the crime and difficulty:

- "isolated": A closed circle of suspects in a contained setting (country house, starship, locked tower, underwater habitat). Few locations, tight relationships.
- "sprawling": A wide investigation across many locations and social circles. The detective must traverse the city/world, connecting disparate threads.
- "time-limited": Urgency drives the investigation — a deadline, a ticking clock, or a suspect about to flee. Events cluster tightly in time.
- "layered": The surface crime conceals a deeper one. The initial investigation reveals that the real mystery is something else entirely.
- "parallel": Two seemingly unrelated threads that converge. The detective must realize the connection.

The mystery style guides how events are structured, how characters relate, and how the casebook will be laid out.

## Narrative Tone

The "narrativeTone" sets the voice and mood for all prose in the case. Choose one that complements the setting and atmosphere:

- "gothic": Brooding, atmospheric, with a sense of dread. Shadows, secrets, decaying grandeur. Works for: Victorian horror, dark fantasy, Southern Gothic, haunted space stations.
- "noir": Cynical, world-weary, morally ambiguous. Rain-slicked streets, betrayal, everyone has an angle. Works for: 1940s LA, cyberpunk cities, fantasy underworlds, Cold War espionage.
- "cozy": Warm, witty, with a puzzle-box quality. The crime is serious but the world is fundamentally decent. Works for: English villages, small-town present day, whimsical fantasy, solarpunk communities.
- "procedural": Clinical, methodical, focused on evidence and deduction. The detective is a professional doing a job. Works for: modern police work, military investigations, space station security, guild inquiries.
- "literary": Rich, character-driven prose. The mystery is a lens for exploring human nature. Works for: any era where psychological depth matters.
- "pulp": Fast-paced, vivid, with colorful characters and dramatic reveals. Entertainment over realism. Works for: adventure serials, space opera, wuxia, swashbuckling piracy.
- "cosmic": Creeping unease, unreliable reality, forbidden knowledge. The mystery brushes against something vast and incomprehensible. Works for: Lovecraftian, folk horror, deep space anomalies, mythic settings.
- "mythic": Elevated, archetypal, with the weight of legend. Characters feel larger than life. Works for: Arthurian, Norse, classical antiquity, high fantasy, far-future post-human.
- "satirical": Sharp, observant, darkly funny. The mystery exposes absurdity in institutions or society. Works for: modern corporate settings, bureaucratic sci-fi, decadent empires, academic intrigue.

Guidelines:
- For "easy" difficulty: 5-6 events, 5-6 characters, straightforward motive
- For "medium" difficulty: 6-8 events, 6-8 characters, one red herring thread
- For "hard" difficulty: 8-10 events, 8-12 characters, multiple misleading threads
- Event slots form a DAG via causedBy. At least one root event (empty causedBy) must exist.
- At least 3 events must be "required" (form the narrative spine).
- Include roles for: at least one victim (or wronged party), at least one genuine suspect, and at least one red herring character.
- Other roles can be things like witnesses, unreliable witnesses, bystanders, accomplices, informants, etc. — use roles that fit the setting naturally.
- The crime type should be specific, not generic. "Theft of shipping manifests to cover embezzlement" is better than "theft". "Sabotage of the ward-stones to frame a rival mage" is better than "sabotage".
- Every event must be something that HAPPENED in the world, not something the police/detective discovered or concluded.
- The mysteryStyle and narrativeTone should complement each other and the setting. A cyberpunk data heist might be "sprawling" + "noir"; a fantasy court intrigue might be "isolated" + "literary"; a Lovecraftian coastal town mystery might be "layered" + "cosmic"; a Cold War spy thriller might be "parallel" + "procedural"; a post-apocalyptic murder might be "isolated" + "gothic".`;

  const crimeHint = input.crimeType
    ? `The crime should involve or relate to: ${input.crimeType}.`
    : 'Choose an interesting and original crime type.';

  // Only suggest a setting flavor when no crimeType is provided (which would
  // already constrain the creative direction). The flavor is a suggestion, not
  // a mandate — the LLM can deviate if it has a better idea.
  const settingNudge = input.crimeType
    ? ''
    : `\nSetting suggestion (use this as inspiration, not a strict requirement): ${settingFlavor}.\n`;

  const userPrompt = `Create a case template for a ${difficulty}-difficulty mystery.

${crimeHint}
${settingNudge}
Think through your creative choices first, then provide the JSON object.`;

  const { data: template } = await callModel(
    {
      stepName: 'generateTemplate',
      systemPrompt,
      userPrompt,
      modelConfig: input.modelConfig,
    },
    (raw) => CaseTemplateSchema.parse(raw),
  );

  await updateDraft(draftId, { template });
  return state;
};
