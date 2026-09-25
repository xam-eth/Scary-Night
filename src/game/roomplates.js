/* Photographed floors for the new wings.
 * Drawn in world space, clipped to the room, so they are part of the house
 * and not an HTML overlay. Cover-cropped, then faded at the edges, so a
 * photo never reads as a poster pasted over the floor.
 */

const SRC = {
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

loadRoomPlates();
