/* Photographed floors for the new wings.
 * Drawn in world space, clipped to the room, so they are part of the house
 * and not an HTML overlay. If a plate has not arrived yet, the baked floor shows.
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
    ctx.globalAlpha = 0.9;
    ctx.drawImage(img, room.x, room.y, room.w, room.h);
    ctx.restore();
  }
}

loadRoomPlates();
