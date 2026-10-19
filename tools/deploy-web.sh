#!/usr/bin/env bash
# DUSKHOLD — the web lane of updates: ship the game to the origin so every
# player's service worker picks it up on their next launch. No Play review,
# no reinstall, no repack (see play-listing/UPDATE-FLOW.md for why).
#
#   DUSKHOLD_DEPLOY_TARGET=user@host:/var/www/duskhold bash tools/deploy-web.sh --live
#   bash tools/deploy-web.sh                # dry run: shows what would move
#
# Preflight refuses the two classic mistakes: deploying with secrets sitting
# in the web files, and deploying changed bytes under an old service-worker
# VERSION (same cache name = players keep the old shell forever).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE="${1:-}"
TARGET="${DUSKHOLD_DEPLOY_TARGET:-}"

say() { printf '\n== %s\n' "$*"; }
die() { printf '\n  FAIL  %s\n' "$*" >&2; exit 1; }

WEB_ITEMS=(index.html styles.css sw.js manifest.webmanifest offline.html privacy.html delete.html .well-known src assets)

say "preflight"
cd "$ROOT"
node tools/bundlecheck.mjs > /tmp/deploy-web-check.txt 2>&1 || { tail -20 /tmp/deploy-web-check.txt; die "bundlecheck failed — the web files are not deployable"; }
echo "  bundlecheck: all PASS"
LOCAL_VER="$(grep -o "duskhold-v[0-9]*" sw.js | head -1)"
echo "  local sw VERSION: $LOCAL_VER"
HOST="$(node -p 'require("./bundle.config.json").host.replace(/\/$/,"")')"
LIVE_VER="$(curl -s --max-time 10 "$HOST/sw.js" 2>/dev/null | grep -o 'duskhold-v[0-9]*' | head -1 || true)"
if [ -z "$LIVE_VER" ]; then
  echo "  WARN  cannot read $HOST/sw.js from here — skipping the live-version gate (the verify step after sync will catch it)"
elif [ "$LIVE_VER" = "$LOCAL_VER" ]; then
  die "the origin already serves $LIVE_VER and so does this tree. Changed bytes under an unchanged VERSION leave every player on the OLD cache (activate only deletes caches with other names). Bump sw.js VERSION (+ the BUILD stamp in index.html) first, or pass --same-version if you truly only touched something uncached."
else
  echo "  origin serves $LIVE_VER -> this deploy moves players to $LOCAL_VER"
fi
if [ "$LIVE" = "--live" ]; then
  [ -n "$TARGET" ] || die "set DUSKHOLD_DEPLOY_TARGET=user@host:/path for a live deploy (dry run needs nothing)"
  command -v rsync >/dev/null 2>&1 || die "rsync is required for the sync"
else
  echo "  DRY RUN — pass --live (with DUSKHOLD_DEPLOY_TARGET) to actually ship"
fi

say "sync"
FLAGS=(-az --human-readable)
[ "$LIVE" = "--live" ] || FLAGS+=(--dry-run --itemize-changes)
for item in "${WEB_ITEMS[@]}"; do
  [ -e "$ROOT/$item" ] || { echo "  ?? missing $item — skipped"; continue; }
  if [ "$LIVE" = "--live" ]; then
    rsync "${FLAGS[@]}" --delete "$ROOT/$item" "$TARGET/"
    echo "  sent $item"
  elif [ -n "$TARGET" ]; then
    echo "  -- $item"
    rsync "${FLAGS[@]}" --delete "$ROOT/$item" "$TARGET/" 2>/dev/null | head -8 || true
  else
    printf '  %-22s %s\n' "$item" "$(du -sh "$ROOT/$item" 2>/dev/null | cut -f1)"
  fi
done

say "verify"
if [ "$LIVE" = "--live" ]; then
  sleep 2
  NOW="$(curl -s --max-time 10 "$HOST/sw.js" | grep -o 'duskhold-v[0-9]*' | head -1 || true)"
  [ "$NOW" = "$LOCAL_VER" ] || die "origin still serves '$NOW' after the sync — CDN/cache in front? purge it, players compare this string"
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HOST/index.html")"
  [ "$CODE" = "200" ] || die "origin answers $CODE for index.html"
  CC="$(curl -sI --max-time 10 "$HOST/index.html" | tr -d '\r' | grep -i '^cache-control:' || true)"
  echo "  origin sw: $NOW, index.html $CODE ${CC:+($CC)}"
  cat <<'PLAYERS'

  What players see now:
   - next launch (or next navigation) the browser compares sw.js bytes,
     installs duskhold-vNN, skipWaiting() promotes it, activate deletes the
     old cache names — the new build is live for them in one cold start;
   - anyone mid-session finishes on the old build and flips on their next
     launch (that is the intended, non-breaking behaviour);
   - nothing to reinstall, nothing on Play Console, no review clock.
PLAYERS
else
  echo "  dry run done — nothing left this machine"
fi
printf '\n  DONE\n\n'
