/* LAST NIGHT — narrative director.
 *
 * docs/STORY.md wins on story. This module holds structure, not new control
 * flow: a beat is a row. #37 polishes copy; #35 draws dawn-cards; #36 draws
 * the room object. The strip already exists (#31) and speaks strip lines and
 * room murmurs. Urgent guidance pre-empts a murmur, then the murmur resumes.
 *
 * Once-only beats persist on save.beats. Dawn-cards wait in save.pendingDawn
 * until the interstitial consumes them.
 */

export const BEATS = [
  {
    id: 'dawn-waking',
    trigger: { event: 'dawn', dawn: 1 },
    surface: 'dawnCard',
    once: true,
    text: 'I woke with the taste of the servant\'s blood already in my mouth. I do not remember opening the door.',
  },
  {
    id: 'dawn-past',
    trigger: { event: 'dawn', dawn: 3 },
    surface: 'dawnCard',
    once: true,
    text: 'They are not random. They are my past. The house feeds them to me.',
  },
  {
    id: 'dawn-kept',
    trigger: { event: 'dawn', dawn: 7 },
    surface: 'dawnCard',
    once: true,
    text: 'Dawn does not free me. The house is keeping me.',
  },
  {
    id: 'night-faces',
    trigger: { event: 'night', night: 2 },
    surface: 'strip',
    once: true,
    text: 'I know these faces. I made these faces.',
  },
  {
    id: 'night-stakes',
    trigger: { night: 3 },
    surface: 'strip',
    once: true,
    text: 'They came with stakes. The house kept the stakes. It kept them, too.',
  },
  {
    id: 'night-leave',
    trigger: { event: 'night', night: 8 },
    surface: 'strip',
    once: true,
    text: 'The house will never let me leave.',
  },
  {
    id: 'night-consent',
    trigger: { event: 'night', night: 10 },
    surface: 'strip',
    once: true,
    text: 'Running is consent.',
  },
  {
    id: 'knock-kept',
    trigger: { event: 'knock', knock: 'gift' },
    surface: 'strip',
    once: true,
    text: 'You asked to be kept safe. You did not ask for how long.',
  },
  {
    id: 'knock-true-dawn',
    trigger: { event: 'knock', knock: 'gift', nightMin: 8 },
    surface: 'strip',
    once: true,
    text: 'There is a dawn this house cannot raise.',
  },
  {
    id: 'state-hunger',
    trigger: { event: 'state', state: 'lowBlood' },
    surface: 'strip',
    once: true,
    text: 'I am tired. The hunger is not.',
  },
  {
    id: 'state-door',
    trigger: { event: 'state', state: 'doorLost' },
    surface: 'strip',
    once: true,
    text: 'It gave way. The house wanted the way open.',
  },
  {
    id: 'room-dining',
    trigger: { event: 'room', room: 'dining' },
    surface: 'room',
    once: true,
    text: 'I know this door. I sealed it.',
  },
  {
    id: 'room-hall',
    trigger: { event: 'room', room: 'hall' },
    surface: 'room',
    once: true,
    text: 'I know this floor. I do not know from when.',
  },
  {
    id: 'room-chapel',
    trigger: { event: 'room', room: 'chapel', nightMin: 4 },
    surface: 'room',
    once: true,
    text: 'Consecrated. Or damned. The light has not chosen.',
  },
  {
    id: 'room-glass',
    trigger: { event: 'room', room: ['conservatory', 'oratory'], nightMin: 4 },
    surface: 'room',
    once: true,
    text: 'Someone loved this light. I cannot bear it.',
  },
  {
    id: 'room-study',
    trigger: { event: 'room', room: 'study', nightMin: 4 },
    surface: 'room',
    once: true,
    text: 'Someone tried to bind me here. The ward still answers.',
  },
  {
    id: 'room-basin',
    trigger: { event: 'room', room: 'basement', nightMin: 4 },
    surface: 'room',
    once: true,
    text: 'The oldest hunger. Before the house sent them.',
  },
  {
    id: 'room-larder',
    trigger: { event: 'room', room: 'kitchen', nightMin: 4 },
    surface: 'room',
    once: true,
    text: 'A cold mercy. Feeding here is loud on purpose.',
  },
  {
    id: 'room-gate',
    trigger: { event: 'room', room: 'gatehouse', nightMin: 4 },
    surface: 'room',
    once: true,
    text: 'Their stakes. They came for me and never left.',
  },
];

const BY_ID = Object.fromEntries(BEATS.map((b) => [b.id, b]));

export function beatById(id) {
  return BY_ID[id] || null;
}

export function beatSeen(save, id) {
  return !!(save && save.beats && save.beats[id]);
}

export function ackBeat(save, id) {
  if (!save || !id) return;
  save.beats = save.beats || {};
  save.beats[id] = 1;
}

function roomsOf(trigger) {
  if (!trigger || trigger.room == null) return null;
  return Array.isArray(trigger.room) ? trigger.room : [trigger.room];
}

function matches(beat, query) {
  if (!beat || !query || beat.surface !== query.surface) return false;
  const t = beat.trigger || {};
  if (!t.event || t.event !== query.event) return false;
  if (t.dawn != null && t.dawn !== query.dawn) return false;
  if (t.night != null && t.night !== query.night) return false;
  if (t.nightMin != null && !(query.night >= t.nightMin)) return false;
  const rooms = roomsOf(t);
  if (rooms && !rooms.includes(query.room)) return false;
  if (t.knock != null && t.knock !== query.knock) return false;
  if (t.state != null && t.state !== query.state) return false;
  return true;
}

/** First unseen beat for this surface and moment. Does not mark it seen. */
export function nextBeat(save, query) {
  if (!query || !query.surface) return null;
  for (const beat of BEATS) {
    if (beat.once !== false && beatSeen(save, beat.id)) continue;
    if (matches(beat, query)) return beat;
  }
  return null;
}
