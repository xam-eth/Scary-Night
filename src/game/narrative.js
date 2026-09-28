/* LAST NIGHT — narrative director.
 *
 * docs/STORY.md wins on story. A beat is a row. The strip speaks strip lines
 * and room murmurs. Dawn-cards and the Act III choice consume what this table
 * queues. Urgent guidance pre-empts a murmur, then the murmur resumes.
 *
 * Once-only beats persist on save.beats. Dawn-cards wait in save.pendingDawn
 * until the interstitial consumes them.
 */

import { playLean } from './economy.js';

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
    trigger: { event: 'night', night: 3 },
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

const FRAG_NAMES = {
  'dawn-waking': 'WAKING',
  'dawn-past': 'HER PAST',
  'dawn-kept': 'KEPT',
  'room-dining': 'THE SERVANT DOOR',
  'room-hall': 'THE FLOOR',
  'room-chapel': 'THE ALTAR',
  'room-glass': 'THE GLASS',
  'room-study': 'THE WARD',
  'room-basin': 'THE BASIN',
  'room-larder': 'THE LARDER',
  'room-gate': 'THE STAKES',
  'knock-kept': 'KEPT SAFE',
  'knock-true-dawn': 'THE TRUE DAWN',
};

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
  const beat = BY_ID[id];
  if (!beat) return;
  const keep = beat.surface === 'room' || beat.surface === 'dawnCard' || (beat.trigger && beat.trigger.event === 'knock');
  if (!keep) return;
  save.seen = save.seen || {};
  save.seen['frag:' + id] = true;
}

/** Codex rows for lines the house has already handed over. Canon CODEX stays untouched. */
export function fragmentsKnown(save) {
  const seen = (save && save.seen) || {};
  const rows = BEATS.filter((b) => seen['frag:' + b.id]).map((b) => ({
    id: b.id,
    name: b.name || FRAG_NAMES[b.id] || b.id.replace(/-/g, ' ').toUpperCase(),
    text: b.text,
  }));
  if (save && save.ending === 'dawnbreaker') {
    rows.push({ id: 'ending-dawnbreaker', name: 'DAWNBREAKER', text: 'She walked into the dawn the house could not raise. It burned. She was free.' });
  }
  if (save && save.ending === 'monster') {
    rows.push({ id: 'ending-monster', name: "THE HOUSE'S MONSTER", text: 'She turned back. The hunger won. The siege answers to her now.' });
  }
  return rows;
}

/** Fed-and-daring versus hoarded-and-hid. Frames the choice. Never picks it. */
export function endingFrame(save) {
  return playLean(save) === 'daring'
    ? 'You fed in the open. The house knows your mouth.'
    : 'You hid, and the walls kept you. They are used to that.';
}

export function endingReady(save) {
  return !!(save && !save.ending && beatSeen(save, 'knock-true-dawn') && (save.nightsSurvived || 0) >= 8);
}

/** Small floor objects. Interior of the room, never on a door. */
export const ROOM_MARKS = [
  { room: 'dining', ox: 0.58, oy: 0.68, kind: 'latch' },
  { room: 'hall', ox: 0.38, oy: 0.42, kind: 'threshold' },
  { room: 'chapel', ox: 0.55, oy: 0.32, kind: 'cloth' },
  { room: 'conservatory', ox: 0.46, oy: 0.48, kind: 'glass' },
  { room: 'oratory', ox: 0.5, oy: 0.55, kind: 'glass' },
  { room: 'study', ox: 0.36, oy: 0.62, kind: 'ward' },
  { room: 'basement', ox: 0.52, oy: 0.46, kind: 'basin' },
  { room: 'kitchen', ox: 0.42, oy: 0.58, kind: 'dish' },
  { room: 'gatehouse', ox: 0.48, oy: 0.36, kind: 'stake' },
];

function paintFragment(ctx, kind) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (kind === 'stake') {
    ctx.strokeStyle = '#6b4b28';
    ctx.lineWidth = 3.2;
    ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(0, 14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-9, -16); ctx.lineTo(9, -16); ctx.stroke();
    ctx.fillStyle = '#8a1820';
    ctx.beginPath(); ctx.arc(0, 14, 3.2, 0, Math.PI * 2); ctx.fill();
  } else if (kind === 'cloth') {
    ctx.fillStyle = 'rgba(110, 22, 32, 0.9)';
    ctx.strokeStyle = 'rgba(212, 176, 96, 0.75)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-18, -6); ctx.quadraticCurveTo(0, 10, 18, -4);
    ctx.lineTo(15, 10); ctx.quadraticCurveTo(0, 2, -16, 10);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  } else if (kind === 'glass') {
    ctx.fillStyle = 'rgba(226, 236, 248, 0.78)';
    ctx.strokeStyle = 'rgba(255, 246, 220, 0.95)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -18); ctx.lineTo(13, 2); ctx.lineTo(2, 16); ctx.lineTo(-11, 3);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.moveTo(-2, -10); ctx.lineTo(5, -2); ctx.stroke();
  } else if (kind === 'ward') {
    ctx.strokeStyle = 'rgba(206, 168, 92, 0.92)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-9, -9); ctx.lineTo(9, 9);
    ctx.moveTo(9, -9); ctx.lineTo(-9, 9);
    ctx.stroke();
  } else if (kind === 'basin') {
    ctx.fillStyle = 'rgba(36, 8, 14, 0.82)';
    ctx.strokeStyle = 'rgba(86, 92, 102, 0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, 0, 18, 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else if (kind === 'dish') {
    ctx.fillStyle = 'rgba(18, 14, 12, 0.88)';
    ctx.strokeStyle = 'rgba(186, 174, 150, 0.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.stroke();
  } else if (kind === 'latch') {
    ctx.fillStyle = '#241c14';
    ctx.strokeStyle = '#b08a48';
    ctx.lineWidth = 1.5;
    ctx.fillRect(-16, -4, 32, 8);
    ctx.strokeRect(-16, -4, 32, 8);
    ctx.beginPath(); ctx.arc(11, 0, 3.5, 0, Math.PI * 2); ctx.stroke();
  } else {
    ctx.fillStyle = 'rgba(92, 70, 46, 0.62)';
    ctx.strokeStyle = 'rgba(168, 136, 84, 0.45)';
    ctx.lineWidth = 1.2;
    ctx.fillRect(-24, -5, 48, 10);
    ctx.strokeRect(-24, -5, 48, 10);
  }
}

export function drawRoomMarks(ctx, mansion) {
  if (!ctx || !mansion || !mansion.room) return;
  for (const mark of ROOM_MARKS) {
    const room = mansion.room(mark.room);
    if (!room) continue;
    const x = room.x + room.w * mark.ox;
    const y = room.y + room.h * mark.oy;
    ctx.save();
    ctx.translate(x, y);
    paintFragment(ctx, mark.kind);
    ctx.restore();
  }
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
