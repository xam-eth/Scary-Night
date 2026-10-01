/* LAST NIGHT — the informant
 *
 * P3 of the spine (docs/PURPOSE.md): one character who remembers and reacts.
 * Between nights there is a room with someone in it who has watched every
 * night you have survived, and who is still in the house when you leave it.
 * She is why the hunt is not a spreadsheet: you come back for the hunt, and
 * you stay for whether she makes it out.
 *
 * MARTHE was the housekeeper. The house kept her too. She speaks at dawn,
 * when the house sleeps, and she keeps the board — the facts you have won,
 * the trophies you have taken, the light you have hung in a house that was
 * never yours.
 *
 * The rule for every line here: she REACTS. The same night told to a hunter
 * on her second night and to one on her twelfth is a different sentence,
 * because Marthe has watched both, and she says what she knows now.
 */

import { INTEL, huntProgress, FORTRESS_STATES } from './hunt.js';

export const INFORMANT = Object.freeze({
  name: 'MARTHE',
  title: 'THE HOUSEKEEPER',
  /** who she is, in one line, under her name on the board */
  line: 'KEPT BY THE HOUSE. NOT ONE OF THEM. NOT YET.',
});

/**
 * The five stages of what she is willing to say. Each stage of the house is
 * a stage of the relationship: she starts by counting your hours and ends by
 * telling you which way to walk into the last room.
 */
const STAGES = [
  {
    at: 0,
    hub: [
      'YOU ARE STILL HERE. MOST ARE NOT, BY THE SECOND NIGHT.',
      'IT DOES NOT KNOW YOU YET. THAT IS YOUR ONLY ADVANTAGE, AND IT IS RUNNING OUT.',
      'I HAVE COUNTED NINE HUNTERS BEFORE YOU. I REMEMBER WHERE EACH OF THEM STOPPED.',
    ],
    dawn: [
      'YOU SAW THE SUN. THEN YOU KNOW THE HOUSE CANNOT HOLD THE DAWN OUT FOREVER.',
      'ONE NIGHT HELD. I HAVE MARKED IT ON THE WALL BEHIND ME. THERE IS ROOM FOR MORE.',
    ],
    death: [
      'YOU DIED. I COUNTED THE HOURS YOU LASTED, AND I WROTE THEM DOWN.',
      'IT TOOK YOU IN THE DARK AGAIN. THE DARK IS THE ONLY THING IN THIS HOUSE THAT IS HONEST.',
    ],
  },
  {
    at: 15,
    hub: [
      'YOU HAVE STARTED NAILING THE DOORS. GOOD. IT NOTICED.',
      'I WAS HERE BEFORE IT WAS. I KNOW WHICH FLOORBOARDS IT CANNOT CROSS. ASK ME AGAIN LATER.',
      'THE CANDLES HELP. NOT BECAUSE OF THE LIGHT — BECAUSE IT HAS TO LOOK AT THEM.',
    ],
    dawn: [
      'ANOTHER NIGHT, ANOTHER LIST. I KEEP THEM ALL. IT DOES NOT KNOW I CAN READ.',
      'YOU HELD, AND YOU CAME BACK. THAT IS TWO THINGS NO ONE ELSE HERE HAS DONE.',
    ],
    death: [
      'IT TOOK YOU AGAIN. IT ALWAYS TAKES THE ONES WHO LEARN FASTEST.',
      'YOU LASTED LONGER THAN THE LAST ONE. I DO NOT SAY THAT TO BE KIND.',
    ],
  },
  {
    at: 35,
    hub: [
      'YOU HAVE BEEN IN ITS CELLAR. THEN YOU KNOW WHAT IT KEEPS DOWN THERE. I AM WHAT IT KEPT.',
      'THE HOUNDS ARE ITS, NOT THEIR OWN. EVERY ONE YOU KILL, IT FEELS. HURT IT.',
      'YOU NAILED EVERY DOOR LAST NIGHT AND IT STILL GOT IN. THEN IT CAME THROUGH A WALL, AND THAT IS ANSWER ENOUGH.',
    ],
    dawn: [
      'YOU HELD THE HOUSE, AND THE HOUSE KNOWS YOUR NAME NOW. SO DO I. — MARTHE.',
      'THE WARDS ARE HOLDING. I CAN SLEEP IN HERE AGAIN, AND I HAD FORGOTTEN HOW.',
    ],
    death: [
      'YOU DIED WITH THE SILVER ON YOU. IT WILL REMEMBER THAT LONGER THAN IT REMEMBERS ME.',
      'DO NOT SPEND TONIGHT BEING SORRY FOR YOURSELF. SPEND IT LEARNING WHERE IT WALKS.',
    ],
  },
  {
    at: 60,
    hub: [
      'THE WARDS HOLD. THEY HOLD BECAUSE I TAUGHT YOU WHERE TO PUT THEM.',
      'IT HAS STARTED ASKING ABOUT YOU, IN THE DARK, IN MY ROOM. IT ASKS ABOUT YOU BY NAME.',
      'YOU HAVE BLED ON EVERY FLOOR IN THIS HOUSE. IT CANNOT PRETEND YOU ARE A GUEST ANY MORE.',
    ],
    dawn: [
      'YOU ARE HUNTING IT NOW, NOT THE OTHER WAY ROUND. DO NOT FORGET WHICH OF US IS STILL IN HERE WITH IT.',
      'ONE MORE STAGE AND YOU WILL BE CLOSE ENOUGH TO HEAR IT BREATHE. I HAVE HEARD IT FOR YEARS.',
    ],
    death: [
      'DO NOT COME DOWN FOR ME. YOU ARE NO USE TO EITHER OF US DEAD.',
      'IT KEPT YOU OUT OF THE EAST WING AGAIN. IT IS AFRAID OF WHAT IS IN THERE WITH THE SUN.',
    ],
  },
  {
    at: 85,
    hub: [
      'IT WALKS THE HALL ITSELF NOW. IT IS LOOKING FOR ME AS WELL AS FOR YOU.',
      'WHEN YOU GO FOR IT, GO AT DAWN, NOT AT DUSK. AND IF YOU HEAR ME SCREAMING, DO NOT STOP.',
      'YOU HAVE EVERYTHING NOW. THE ONLY THING LEFT IS WHETHER YOU WALK DOWN THE HALL.',
    ],
    dawn: [
      'TOMORROW, THEN. I WILL BE LISTENING FOR THE HOUSE TO GO QUIET.',
      'YOU CAN KILL IT. I WOULD NOT HAVE TOLD YOU THAT A MONTH AGO, AND I DO NOT SAY IT TWICE.',
    ],
    death: [
      'IT IS AFRAID OF YOU NOW. I CAN HEAR IT. DIE ONE MORE TIME IF YOU MUST — BUT DIE CLOSE TO IT.',
      'IT WILL COME FOR ME TONIGHT, BECAUSE OF WHAT YOU DID. I DO NOT MIND. GO AND FINISH IT.',
    ],
  },
];

/**
 * What she says about a fact you came home with. These are the beats that
 * make the board feel like a conversation instead of a codex: you bring her
 * a werewolf, and she tells you whose it was.
 */
const ON_INTEL = {
  'foe:werewolf': 'A HOUND. IT HAS OTHERS, AND THEY REMEMBER WHO HURT THEM.',
  'foe:stalker': 'THAT ONE NEVER KNOCKS. IF YOU HAVE SEEN IT, IT HAS ALREADY SEEN YOU ALL WEEK.',
  'foe:ghoul': 'IT EATS THE WOOD BECAUSE IT WANTS THE WOMAN, NOT THE DOOR. DO NOT LET IT WANT ANYTHING ELSE.',
  'foe:zombie': 'THE SERVANTS. THEY WERE DECENT PEOPLE. DO NOT LET IT KEEP THEM ANY LONGER THAN IT HAS.',
  'foe:hunter': 'ONE OF THEM WORE THAT COAT BEFORE YOU. HE LASTED FOUR NIGHTS. HE IS IN THE CELLAR NOW.',
  'room:chapel': 'THE CHAPEL. I WAS MARRIED IN THAT CHAPEL, BEFORE THE HOUSE WAS LIKE THIS.',
  'room:basement': 'THE CELLAR IS WHERE IT SLEEPS. YOU WENT DOWN THERE AND CAME BACK OUT. I DID NOT.',
  'room:oratory': 'SOMEONE PRAYED IN THE ORATORY TO BE LET OUT. IT WAS ME. IT DID NOT WORK.',
  'room:study': 'THE LEDGER. IF MY NAME IS STILL IN IT, THEN IT STILL OWNS ME.',
  'room:gallery': 'THOSE PORTRAITS ARE PEOPLE WHO CAME HERE HUNTING. EVERY ONE OF THEM IS DATED.',
  'room:conservatory': 'IT GROWS THINGS UNDER THE GLASS. DO NOT EAT WHAT IT GROWS.',
  'peak:duel': 'YOU LOOKED AT THE ALPHA AND LIVED. IT WAS MEASURING YOU, NOT FIGHTING YOU.',
  'peak:dawnbreak': 'SUNLIGHT BURNS THEM. THAT IS WHY IT KEEPS THEM OFF THE EAST WALL — THE ONLY MERCY IN THIS HOUSE.',
  'deed:first-night': 'YOU HELD A WHOLE NIGHT. THEN YOU KNOW IT CAN BE HELD.',
  'deed:kills-25': 'TWENTY-FIVE. THE PACK IS THINNER. IT WILL SEND WHATEVER IS LEFT ALL AT ONCE.',
  'deed:doors-held': 'NOT ONE DOOR FELL. I HEARD IT PACING. IT HATES A SHUT DOOR.',
};

/** The weapon names the game already knows (src/game/weapons.js). */
const WEAPON_NAMES = Object.freeze({ claw: "THE HUNTER'S CLAW", sword: 'THE STOLEN BLADE', shot: 'THE HUNTERS’ CROSSBOW' });
/** Trophies, drawn from what you have actually put down. */
const TROPHY_FOR = Object.freeze({
  crawler: { glyph: 'crawl', name: 'CRAWLERS' },
  zombie: { glyph: 'bone', name: 'THE KEPT' },
  werewolf: { glyph: 'fang', name: 'HOUNDS' },
  ghoul: { glyph: 'jaw', name: 'GHOULS' },
  hunter: { glyph: 'bolt', name: 'HUNTERS' },
  stalker: { glyph: 'eye', name: 'THE STALKER' },
});

/**
 * Every line she can say, and how many there are — so the QA harness can hold
 * her to a standard instead of trusting that the table above stays honest.
 */
export function informantLines() {
  const out = [INFORMANT.line];
  for (const st of STAGES) for (const k of ['hub', 'dawn', 'death']) for (const l of st[k]) out.push(l);
  for (const l of Object.values(ON_INTEL)) out.push(l);
  return out;
}
export const informantCounts = () => ({
  stages: STAGES.length,
  stageLines: STAGES.reduce((n, st) => n + st.hub.length + st.dawn.length + st.death.length, 0),
  reactions: Object.keys(ON_INTEL).length,
});

const stageFor = (pct) => {
  let i = 0;
  for (let k = 0; k < STAGES.length; k++) if (pct >= STAGES[k].at) i = k;
  return i;
};

/** Which stage of the relationship the hunt has reached, 0..4. */
export function informantStage(save) {
  return stageFor(huntProgress(save));
}

/**
 * Her reaction to a fact you came home with tonight — the freshest one she
 * has something to say about. Null when tonight taught her nothing new.
 */
export function informantIntelLine(gain) {
  const ids = (gain && gain.intel) || [];
  for (let i = ids.length - 1; i >= 0; i--) {
    const line = ON_INTEL[ids[i]];
    if (line) return { id: ids[i], text: line, fact: INTEL[ids[i]] ? INTEL[ids[i]].line : null };
  }
  return null;
}

/**
 * What she says now. `when` is 'hub' (you came to the room), 'dawn' (you
 * held the night) or 'death' (you did not). A fact you just learned outranks
 * the stage line — she is a person, not a cutscene, and a person talks about
 * what you walked in with.
 */
export function informantLine(save, when = 'hub', gain = null) {
  const fresh = gain ? informantIntelLine(gain) : null;
  if (fresh) return { ...fresh, kind: 'intel' };
  const st = STAGES[stageFor(huntProgress(save))];
  const pool = st[when] || st.hub;
  const n = (save && save.hunt && save.hunt.nights) || 0;
  return { id: `stage${st.at}:${when}`, text: pool[n % pool.length], kind: when };
}

/**
 * The board she keeps: the facts you have won, in the order you won them,
 * the trophies you have taken off its hounds, and the weapon you carry.
 * Nothing on this board is invented — all of it is what the save records.
 */
export function boardEntries(save) {
  const h = (save && save.hunt) || { intel: [], materials: 0, nights: 0 };
  const intel = (h.intel || []).filter((id) => INTEL[id]).map((id) => ({ id, line: INTEL[id].line }));
  const killsBy = (save && save.killsBy) || {};
  const trophies = Object.keys(TROPHY_FOR)
    .filter((k) => (killsBy[k] || 0) > 0)
    .map((k) => ({ key: k, name: TROPHY_FOR[k].name, glyph: TROPHY_FOR[k].glyph, count: killsBy[k] }));
  const weapon = { key: (save && save.weapon) || 'claw', name: WEAPON_NAMES[(save && save.weapon) || 'claw'] };
  return {
    intel,
    trophies,
    weapon,
    materials: h.materials || 0,
    nights: h.nights || 0,
    fortress: FORTRESS_STATES[stageFor(huntProgress(save))].name,
  };
}

export { TROPHY_FOR, WEAPON_NAMES };
