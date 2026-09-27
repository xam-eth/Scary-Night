import { createCanvas } from '@napi-rs/canvas';
globalThis.document = { createElement: () => ({ getContext: () => createCanvas(64, 64).getContext('2d'), width: 64, height: 64, style: {} }) };
const { Mansion } = await import('/home/user/Scary-Night/src/game/mansion.js');
const m = new Mansion();
console.log(`grid ${m.navW}x${m.navH} cell=${m.navCell}`);
for (let gy = 0; gy < m.navH; gy++) {
  let row = '';
  for (let gx = 0; gx < m.navW; gx++) {
    const x = m.navX0 + (gx + 0.5) * m.navCell, y = m.navY0 + (gy + 0.5) * m.navCell;
    const p = (Math.abs(x - 700) < 20 && Math.abs(y - 1150) < 20) ? 'H'
      : (Math.abs(x - 470) < 20 && Math.abs(y - 360) < 20) ? 'D'
      : (Math.abs(x - 1330) < 20 && Math.abs(y - 360) < 20) ? 'L'
      : (Math.abs(x - 1530) < 20 && Math.abs(y - 1160) < 20) ? 'B' : null;
    row += p ? p : (m.navFree(gx, gy) ? '.' : '#');
  }
  console.log(row);
}
console.log('path hall->dining', JSON.stringify(m.navPath(700, 1150, 470, 360)));
console.log('path library->hall', JSON.stringify(m.navPath(1330, 360, 700, 1150)));
console.log('path outside->hall', JSON.stringify(m.navPath(700, -200, 700, 1150)));
console.log('--- wall probe ---');
for (const [x, y] of [[780, 40], [400, 40], [700, 40], [780, 1500], [940, 300], [700, 40]]) {
  console.log(`(${x},${y}) solidAt=${!!m.solidAt(x, y)} navBlocked=${m.navBlocked(x, y)}`);
}
console.log('path outside->hall (closed door):', JSON.stringify(m.navPath(700, -200, 700, 1150).slice(0, 8)));
console.log('entrance states:', m.entrances.map((e) => `${e.id}:${e.open ? 'open' : e.broken ? 'broken' : 'shut'}`).join(' '));
console.log('--- cell debug ---');
const c = m.navCellOf(780, 40);
console.log('cell of (780,40):', JSON.stringify(c), 'idx=', c.gy * m.navW + c.gx, 'navval=', m.nav[c.gy * m.navW + c.gx], 'navFree=', m.navFree(c.gx, c.gy));
console.log('cell center =', m.navX0 + (c.gx + 0.5) * m.navCell, m.navY0 + (c.gy + 0.5) * m.navCell);
const c2 = m.navCellOf(700, 40);
console.log('cell of (700,40):', JSON.stringify(c2), 'navval=', m.nav[c2.gy * m.navW + c2.gx]);
let blocked = 0, free = 0;
for (let i = 0; i < m.nav.length; i++) (m.nav[i] ? blocked++ : free++);
console.log(`nav: blocked=${blocked} free=${free} of ${m.nav.length}`);
