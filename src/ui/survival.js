/* DUSKHOLD — Survival HUD: SHELL + composer (Phase 3 split).
 *
 * The per-concern implementations live in src/ui/survival/ (shared kit,
 * hints, chain widget, night HUD, day builder, controls, end panels, cine).
 * This file keeps the two roles game.js/main.js/tools import: the public
 * surface (8 names, unchanged) and drawSurvivalScreen, the composer that
 * picks day / night / cine / pause / end per frame.
 */
import { drawSurvivalIcon, drawLabel, COLORS } from './survivalIcons.js';
import { drawBuildStamp } from './survival/shared.js';
import { offerSurvivalHint, updateSurvivalHints } from './survival/hints.js';
import { nightPointerBand, tonightChipBox, zoomButtonLayout } from './survival/shared.js';
import { drawSurvivalControls } from './survival/controls.js';
import { drawDayScreen } from './survival/day.js';
import { drawNightHud } from './survival/night.js';
import { drawPausePanel, drawEndPanel } from './survival/end.js';
import { drawCine } from './survival/cine.js';

export { offerSurvivalHint, updateSurvivalHints };
export { nightPointerBand, tonightChipBox, zoomButtonLayout };
export { drawSurvivalControls };
export { COLORS };

export function drawSurvivalScreen(game, ctx, w, h, worldReady = true) {
  game.ui.length = 0;
  // BUILD 17: the day layer owns game._survivalLabels — the record QA reads
  // off the screen. On a frame that does not draw it (night, the cine, the
  // pause panel, an end panel) the day's labels must go with it, or a probe
  // reads last day's TONIGHT chip while the night HUD is up.
  const mode0 = game.survival;
  if (game._survivalLabels && (!mode0 || mode0.phase !== 'day' || mode0.cine || game.screen === 'paused')) {
    game._survivalLabels.tonightChip = null;
    game._survivalLabels.tonight = [];
  }
  if (!worldReady) {
    ctx.save();
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#3a4190');
    g.addColorStop(1, '#1b1f3a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    drawSurvivalIcon(ctx, 'keep', w / 2, h / 2 - 30, 70);
    drawLabel(ctx, 'RAISING THE KEEP…', w / 2, h / 2 + 30, 15, '#ffffff');
    return;
  }
  if (game.screen === 'paused') {
    drawPausePanel(game, ctx, w, h);
    return;
  }
  if (game.survival.cine) { drawCine(game, ctx, w, h); return; }
  const phase = game.survival.phase;
  if (phase === 'day') { drawDayScreen(game, ctx, w, h); drawBuildStamp(ctx, 10, h - 8); return; }
  if (phase === 'complete') { drawEndPanel(game, ctx, w, h, false); return; }
  if (phase === 'failed') { drawEndPanel(game, ctx, w, h, true); return; }
  drawNightHud(game, ctx, w, h);
  drawBuildStamp(ctx, 10, h - 8);
}
