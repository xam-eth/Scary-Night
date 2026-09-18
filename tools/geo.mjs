import { createCanvas } from '@napi-rs/canvas';
globalThis.document = { createElement: () => ({ getContext: () => createCanvas(64, 64).getContext('2d'), width: 64, height: 64, style: {} }) };
const { Mansion } = await import('/home/user/Scary-Night/src/game/mansion.js');
const m = new Mansion();
console.log('rooms:'); for (const r of m.roomList) console.log('  ', r.id, r.x, r.y, r.w, r.h);
for (const [x, y] of [[1352, 542], [1352, 615], [1714, 343], [700, 1150]]) {
  console.log(`solid(${x},${y}) =`, JSON.stringify(m.solidAt(x, y)), 'room=', m.findRoom(x, y));
}
console.log('props in library x>940:');
for (const f of m.props) if (f.x > 940 && f.y < 700) console.log(`   ${f.type} x=${f.x} y=${f.y} w=${f.w} h=${f.h}`);
console.log('props in hall y>760:', m.props.filter((f) => f.y > 760).length);
console.log('roomId of crawler at 1352,542 ->', m.findRoom(1352, 542));
const r1 = m.resolve(1352, 542, 12, false);
console.log('resolve(1352,542,12) ->', JSON.stringify(r1));
const r2 = m.resolve(1300, 542, 12, false);
console.log('resolve(1300,542,12) ->', JSON.stringify(r2));
console.log('route library->hall', JSON.stringify(m.route('library', 'hall')));
console.log('walls blocking x<1352 in library?', m.solidAt(1300, 542) && m.solidAt(1300, 542).type);
console.log('route library->hall', JSON.stringify(m.route('library', 'hall')));
console.log('entrances:', m.entrances.map((e) => `${e.id} in(${e.inside.x},${e.inside.y}) out(${e.outside.x},${e.outside.y})`).join('\n  '));
