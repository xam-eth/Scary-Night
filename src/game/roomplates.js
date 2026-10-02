/* Photographed floors for the new wings.
 * Drawn in world space, clipped to the room, so they are part of the house
 * and not an HTML overlay. Cover-cropped, then faded at the edges, so a
 * photo never reads as a poster pasted over the floor.
 *
 * Two passes, because the house is two things now:
 *
 *   drawRoomPlates()      under the 2D bake, as it always was — the painted
 *                         floor any room without a 3D room still stands on.
 *   drawRoomPlatesOver()  over the three-dimensional room (#55). The kit's
 *                         floor is opaque and it is drawn last, so a plate
 *                         laid underneath it is simply not on screen: eight
 *                         rooms worth of photograph, buried. Over the top it
 *                         goes, but as a TINT and not a cover — multiplied
 *                         into the lit floor, held off the standing walls,
 *                         and faded to white at the edges, where white is
 *                         the colour that leaves the room alone.
 */

const SRC = {
  dining: './assets/rooms/dining.jpg',
  library: './assets/rooms/library.jpg',
  hall: './assets/rooms/hall.jpg',
  basement: './assets/rooms/basement.jpg',
  conserv: './assets/rooms/conserv.jpg',
  chapel: './assets/rooms/chapel.jpg',
  kitchen: './assets/rooms/kitchen.jpg',
  study: './assets/rooms/study.jpg',
  gallery: './assets/rooms/gallery.jpg',
  gatehouse: './assets/rooms/gatehouse.jpg',
  oratory: './assets/rooms/oratory.jpg',
};

const imgs = Object.create(null);

export function loadRoomPlates() {
  if (typeof Image === 'undefined') return;
  for (const [key, src] of Object.entries(SRC)) {
    if (imgs[key]) continue;
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    imgs[key] = img;
  }
}

export function drawRoomPlates(ctx, mansion) {
  if (!mansion || !mansion.roomList) return;
  for (const room of mansion.roomList) {
    const img = imgs[room.plate];
    if (!img || !img.complete || !img.naturalWidth) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(room.x, room.y, room.w, room.h);
    ctx.clip();
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const scale = Math.max(room.w / iw, room.h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.globalAlpha = 0.86;
    ctx.drawImage(img, room.x + (room.w - dw) / 2, room.y + (room.h - dh) / 2, dw, dh);
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = '#10141c';
    ctx.fillRect(room.x, room.y, room.w, room.h);
    const fade = Math.min(96, room.w * 0.22, room.h * 0.2);
    const edge = (x, y, w, h, x0, y0, x1, y1) => {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(8,10,16,0.92)');
      g.addColorStop(1, 'rgba(8,10,16,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
    };
    ctx.globalAlpha = 1;
    edge(room.x, room.y, fade, room.h, room.x, room.y, room.x + fade, room.y);
    edge(room.x + room.w - fade, room.y, fade, room.h, room.x + room.w, room.y, room.x + room.w - fade, room.y);
    edge(room.x, room.y, room.w, fade, room.x, room.y, room.x, room.y + fade);
    edge(room.x, room.y + room.h - fade, room.w, fade, room.x, room.y + room.h, room.x, room.y + room.h - fade);
    ctx.restore();
  }
}

/** Cover-crop a photographed room into a screen rect. False if it has not loaded. */
export function drawPlateCover(ctx, key, x, y, w, h) {
  const img = imgs[key];
  if (!ctx || !img || !img.complete || !img.naturalWidth || w < 2 || h < 2) return false;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
  return true;
}

loadRoomPlates();

/* ---- over the three-dimensional room ------------------------------ */

export const PLATE_MODE = { mode: 'overlay', alpha: 0.85, inset: 34 };

/** Tuning hook for the QA tools. */
export function setPlateMode(mode, alpha, inset) {
  if (mode) PLATE_MODE.mode = mode;
  if (alpha != null) PLATE_MODE.alpha = alpha;
  if (inset != null) PLATE_MODE.inset = inset;
}

/* One scratch canvas, reused: the plate is faded at its own edges before it
 * touches the room, because a fade is only free when the blend is multiply.
 * White leaves a multiply alone and blows an overlay out, so the fade has to
 * be in the plate's ALPHA, which means a layer of its own. */
let scratch = null;
function plateScratch(w, h) {
  if (typeof document === 'undefined') return null;
  if (!scratch) {
    try { scratch = document.createElement('canvas'); } catch (e) { return null; }
  }
  const W = Math.max(2, Math.min(1408, Math.round(w)));
  const H = Math.max(2, Math.min(1408, Math.round(h)));
  if (scratch.width !== W || scratch.height !== H) { scratch.width = W; scratch.height = H; }
  const c = scratch.getContext('2d');
  if (!c) return null;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;
  c.clearRect(0, 0, W, H);
  return c;
}

/**
 * Impress each room's photograph into the floor the kit drew.
 *
 * World space, so the plate lies on the ground and foreshortens with the
 * camera like everything else down there. Inset from the room's own rect so
 * it never climbs the wall standing on that rect's edge, and faded out at the
 * four edges so the photograph has no border to speak of.
 *
 * It is a tint and not a cover on purpose: multiply was measured to flatten
 * the room (detail fell), and a plain cover paints over the furniture and
 * the wall bases. Overlay keeps the kit's lighting and adds the photograph's
 * own light and shadow on top of it.
 */
export function drawRoomPlatesOver(ctx, mansion, renderer) {
  if (!mansion || !mansion.roomList) return;
  const { mode, alpha, inset } = PLATE_MODE;
  if (!alpha) return;
  for (const room of mansion.roomList) {
    const img = imgs[room.plate];
    if (!img || !img.complete || !img.naturalWidth) continue;
    const x = room.x + inset, y = room.y + inset;
    const w = room.w - inset * 2, h = room.h - inset * 2;
    if (w < 8 || h < 8) continue;
    if (renderer && renderer.isVisible && !renderer.isVisible(x + w / 2, y + h / 2, Math.max(w, h))) continue;
    const sc = plateScratch(w, h);
    if (!sc) continue;
    const SW = sc.canvas.width, SH = sc.canvas.height;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const scale = Math.max(SW / iw, SH / ih);
    const dw = iw * scale, dh = ih * scale;
    sc.drawImage(img, (SW - dw) / 2, (SH - dh) / 2, dw, dh);
    const fade = Math.min(SW * 0.22, SH * 0.2, 110);
    sc.globalCompositeOperation = 'destination-out';
    const edge = (ex, ey, ew, eh, x0, y0, x1, y1) => {
      const g = sc.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      sc.fillStyle = g;
      sc.fillRect(ex, ey, ew, eh);
    };
    edge(0, 0, fade, SH, 0, 0, fade, 0);
    edge(SW - fade, 0, fade, SH, SW, 0, SW - fade, 0);
    edge(0, 0, SW, fade, 0, 0, 0, fade);
    edge(0, SH - fade, SW, fade, 0, SH, 0, SH - fade);
    sc.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.globalCompositeOperation = mode;
    ctx.globalAlpha = alpha;
    ctx.drawImage(sc.canvas, x, y, w, h);
    ctx.restore();
  }
}
