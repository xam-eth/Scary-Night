#!/usr/bin/env bash
# DUSKHOLD — one command from repo to the two Play files.
#
#   bash tools/playpack.sh
#
# Ends with exactly two artifacts in dist-play/:
#   DUSKHOLD-<versionName>-<versionCode>.aab   (upload to Play Console)
#   DUSKHOLD-<versionName>-<versionCode>.apk   (sideload / device testing)
#
# Run it on a machine with normal internet and (ideally) a JDK 17: this is
# the step the dev sandbox cannot do — Bubblewrap downloads the JDK/Android
# SDK from dl.google.com and Gradle pulls artifacts from maven.google.com.
# The script probes for that first and stops with the reason, so a wrong
# machine costs five seconds, not an hour.
#
# What it does, in order:
#   0  probes: internet to Google's repos, node, JDK 17 (or lets Bubblewrap
#      install one), Bubblewrap CLI (installs it from npm if missing)
#   1  finds the upload key (android/, or $DUSKHOLD_KEYS_DIR, or
#      ~/duskhold-keys — it never lives in git) and reads its passwords
#   2  reads host/version from bundle.config.json
#   3  scaffolds the Gradle project with `bubblewrap init` in a temp dir
#      (or reuses android/app if a previous run already scaffolded it), then
#      puts the COMMITTED android/twa-manifest.json back over the derived one
#      so the repo stays the source of truth, and `bubblewrap update`
#   4  `bubblewrap build`, feeding the two signing passwords on stdin
#   5  copies the two artifacts into dist-play/ with versioned names and
#      prints their sha256
#   6  prints the four after-steps (upload, app-signing SHA into assetlinks,
#      closed testing, origin-trial token)
#
# Guide: play-listing/PACK-GUIDE.md
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CFG="$ROOT/bundle.config.json"
ANDROID="$ROOT/android"
OUT="$ROOT/dist-play"

say() { printf '\n== %s\n' "$*"; }
die() { printf '\n  FAIL  %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 0. probes
say "0/6  this machine"
command -v node >/dev/null 2>&1 || die "node is required (the repo is node-based)"
command -v curl >/dev/null 2>&1 || die "curl is required for the network probe"
command -v npm  >/dev/null 2>&1 || die "npm is required (Bubblewrap is an npm package)"
curl -fsI --max-time 10 https://dl.google.com/android/repository/repository2-1.xml >/dev/null 2>&1 \
  || die "cannot reach dl.google.com — Bubblewrap cannot install the JDK/Android SDK here, and Gradle cannot reach maven.google.com either. Run this script on a machine with normal internet (the dev sandbox is not one)."
if command -v keytool >/dev/null 2>&1; then
  JV="$(java -version 2>&1 | head -1)"
  case "$JV" in
    *'"17'*|*"17."*) say "JDK 17 found ($JV)" ;;
    *) die "a JDK was found but it is not 17 — the Android command-line tools refuse 18+. Found: $JV. Point PATH/JAVA_HOME at a 17, or remove it and let Bubblewrap install one." ;;
  esac
else
  echo "  no JDK yet — Bubblewrap init will offer to download JDK 17 + the Android SDK (this script answers yes)"
fi
BW=""
if command -v bubblewrap >/dev/null 2>&1; then
  BW="bubblewrap"
elif npx --no-install @bubblewrap/cli version >/dev/null 2>&1; then
  BW="npx --no-install @bubblewrap/cli"
else
  echo "  installing @bubblewrap/cli from npm..."
  npm install -g @bubblewrap/cli >/dev/null 2>&1
  BW="bubblewrap"
fi
command -v "${BW%% *}" >/dev/null 2>&1 || die "Bubblewrap CLI did not install — run: npm install -g @bubblewrap/cli"
echo "  bubblewrap: $($BW version 2>/dev/null | tail -1 || echo unknown)"

# ------------------------------------------------------------------ 1. key
say "1/6  the upload key (never in git)"
KEY="$ANDROID/duskhold-upload.jks"
SECRET="$ANDROID/signing.local.json"
if [ ! -f "$KEY" ]; then
  for cand in "${DUSKHOLD_KEYS_DIR:-/nonexistent}" "$HOME/duskhold-keys" "$(dirname "$ROOT")/duskhold-keys"; do
    if [ -f "$cand/duskhold-upload.jks" ] && [ -f "$cand/signing.local.json" ]; then
      echo "  restoring the key from $cand"
      mkdir -p "$ANDROID"
      cp "$cand/duskhold-upload.jks" "$KEY"
      cp "$cand/signing.local.json" "$SECRET"
      break
    fi
  done
fi
[ -f "$KEY" ]    || die "no upload keystore. Put duskhold-upload.jks + signing.local.json in android/, or set DUSKHOLD_KEYS_DIR to the backup folder. Without them the app cannot be signed — and if they are lost forever, the package on Play can never be updated."
[ -f "$SECRET" ] || die "signing.local.json is missing next to the keystore (it holds the two passwords)"
STORE_PW="$(node -e 'process.stdout.write(require(process.argv[1]).storePassword)' "$SECRET")"
KEY_PW="$(node -e 'process.stdout.write(require(process.argv[1]).keyPassword)' "$SECRET")"
[ -n "$STORE_PW" ] && [ -n "$KEY_PW" ] || die "could not read the passwords out of signing.local.json"
echo "  keystore: $(basename "$KEY")  (fingerprint $(cat "$ANDROID/upload-fingerprint.txt" 2>/dev/null || echo 'see twa-manifest'))"

# -------------------------------------------------------------- 2. config
say "2/6  identity"
MANIFEST_URL="$(node -p 'const c=require(process.argv[1]);const b=c.basePath.endsWith("/")?c.basePath:c.basePath+"/";c.host.replace(/\/$/,"")+b+"manifest.webmanifest"' "$CFG")"
VER="$(node -p 'const c=require(process.argv[1]);c.versionName+"-"+c.versionCode' "$CFG")"
echo "  manifest $MANIFEST_URL"
echo "  version  $VER"

# ------------------------------------------------------------- 3. project
say "3/6  the Gradle project"
if [ -f "$ANDROID/app/build.gradle" ]; then
  PROJ="$ANDROID"
  echo "  reusing the project a previous run scaffolded in android/"
  cp "$KEY" "$PROJ/duskhold-upload.jks" 2>/dev/null || true
else
  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT
  echo "  scaffolding in $WORK (first run downloads JDK/SDK — a few hundred MB)"
  ( cd "$WORK" && yes | $BW init --manifest "$MANIFEST_URL" )
  cp "$ANDROID/twa-manifest.json" "$WORK/twa-manifest.json"
  cp "$KEY" "$WORK/duskhold-upload.jks"
  ( cd "$WORK" && $BW update )
  # keep the scaffold for the next run; the committed manifest stays the truth
  mkdir -p "$ANDROID"
  ( cd "$WORK" && tar cf - --exclude=twa-manifest.json --exclude=duskhold-upload.jks . ) \
    | ( cd "$ANDROID" && tar xf - )
  PROJ="$ANDROID"
fi

# ---------------------------------------------------------------- 4. build
say "4/6  bubblewrap build (signs with the upload key)"
( cd "$PROJ" && printf '%s\n%s\n' "$STORE_PW" "$KEY_PW" | $BW build )
[ -f "$PROJ/app-release-bundle.aab" ] || die "build finished but app-release-bundle.aab is missing"
[ -f "$PROJ/app-release-signed.apk" ] || die "build finished but app-release-signed.apk is missing"

# -------------------------------------------------------------- 5. collect
say "5/6  the two files"
mkdir -p "$OUT"
cp "$PROJ/app-release-bundle.aab" "$OUT/DUSKHOLD-$VER.aab"
cp "$PROJ/app-release-signed.apk" "$OUT/DUSKHOLD-$VER.apk"
ls -la "$OUT"
sha256sum "$OUT/DUSKHOLD-$VER.aab" "$OUT/DUSKHOLD-$VER.apk"

# ----------------------------------------------------------------- 6. next
say "6/6  after this run"
cat <<'NEXT'
  1. Play Console -> internal testing: upload the .aab (the .apk is for
     sideload/device testing only; Play accepts the AAB).
  2. Play Console -> Setup -> App signing: copy the SHA-256 of the APP SIGNING
     certificate (not this upload key) into .well-known/assetlinks.json, then
     `node tools/bundle.mjs prepare` and publish that file at the origin root.
     Until it matches, the TWA shows a URL bar.
  3. Closed testing: 12 testers x 14 continuous days (personal accounts made
     after 13 Nov 2023) before production is offered.
  4. Paste the Digital Goods origin-trial token into index.html (the WARN in
     bundlecheck) or the shop cannot take money through Play Billing.
  5. Back up android/duskhold-upload.jks + signing.local.json OUTSIDE git if
     this machine is not already the backup. Losing them locks out updates.
NEXT
printf '\n  DONE  %s/DUSKHOLD-%s.{aab,apk}\n\n' "$OUT" "$VER"
