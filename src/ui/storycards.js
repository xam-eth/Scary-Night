/* Photographic backdrops for the story cards — the dawn card, the ending,
 * and the narration the night is told in.
 *
 * These are CARDS, not rooms. A card is a flat picture behind writing, the
 * way a title card is; a room is a place you walk, and a room is built —
 * floor slabs, wall panels, corners, windows, doors and furniture, instanced
 * from assets/env-kit/*.glb and lit by the bake.
 *
 * They were the same system once. That was the mistake: eleven rooms were
 * draped in a photograph each, over the top of the kit that had already
 * built them, and the house stopped being made of pieces and became a
 * picture of a house. The room never sees this file again. What is left
 * here is the two backdrops the writing stands on, and nothing else.
 */

const SRC = {
  gallery: './assets/cards/gallery-night.jpg',
  oratory: './assets/cards/oratory-dawn.jpg',
};

const imgs = Object.create(null);

export function loadStoryCards() {
  if (typeof Image === 'undefined') return;
  for (const [key, src] of Object.entries(SRC)) {
    if (imgs[key]) continue;
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    imgs[key] = img;
  }
}

/** Cover-crop a card into a screen rect. False if it has not loaded. */
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

loadStoryCards();
