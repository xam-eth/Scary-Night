#!/usr/bin/env bash
# DUSKHOLD — pack the game into an APK and install it on the attached Android
# device, in one command, using the SDK the owner already installed:
#
#   bash tools/android-install.sh
#
# What it does, in order:
#   0/5  probes this machine: JDK 17 (Gradle/AGP refuse anything else), adb
#        (PATH, $ANDROID_HOME, ~/Android/Sdk — the layout sdkmanager made),
#        Gradle 8 (uses one on PATH, else downloads 8.7 once into a cache)
#   1/5  waits for a device: empty `adb devices` prints the exact checklist
#        (cable, developer options, USB debugging, the RSA prompt on the
#        phone) and then waits; two phones = first serial wins
#   2/5  packs the runtime assets into android-device/app/src/main/assets
#        (index.html, styles, src/, assets/, the five rig GLBs, the shop
#        catalog) — never the 33 MB design folder, the Godot zip, qa-evidence,
#        tools or .git; then sanity-checks the copy
#   3/5  gradle assembleDebug (debug-signed: no upload key needed — the Play
#        key stays untouched for tools/playpack.sh)
#   4/5  adb install -r, then launches the activity
#   5/5  prints what is on the phone (the BUILD stamp inside the APK assets)
#
# Flags:
#   --pack-only   stop after 2/5 (inspect the asset copy)
#   --skip-build  reuse an existing app-debug.apk (reinstall only)
#   --dry         probes only, change nothing
#   --twa         Play route instead: run tools/playpack.sh, install its APK,
#                 and warn if the hosted site still serves an older BUILD
#                 (a TWA plays what is hosted, not what is in the APK)
#
# The dev sandbox cannot run this end to end (no JDK/Gradle/adb, and Gradle
# needs maven.google.com) — it is written to fail LOUD and EARLY with the
# exact fix, so a missing piece costs seconds, not an hour.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJ="$ROOT/android-device"
ASSETS="$PROJ/app/src/main/assets"
APK="$PROJ/app/build/outputs/apk/debug/app-debug.apk"
APPID="com.zyvrolabs.duskhold.device"
GRADLE_CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/duskhold-gradle"
HOST="https://duskhold.zyvrolabs.com"

PACK_ONLY=0; SKIP_BUILD=0; DRY=0; TWA=0
for a in "$@"; do
  case "$a" in
    --pack-only) PACK_ONLY=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --dry) DRY=1 ;;
    --twa) TWA=1 ;;
    -h|--help) grep '^# ' "${BASH_SOURCE[0]}" | sed 's/^# //'; exit 0 ;;
    *) echo "unknown flag: $a (see --help)" >&2; exit 1 ;;
  esac
done

say() { printf '\n== %s\n' "$*"; }
die() { printf '\n  FAIL  %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 0/5 probes
say "0/5  this machine"
HEADH="$(git -C "$ROOT" log -1 --format='%h %s' 2>/dev/null | cut -c1-60 || echo 'not a git tree')"
echo "  repo HEAD: $HEADH"
grep -q "kotlin-bom" "$ROOT/android-device/app/build.gradle" 2>/dev/null   || echo "  WARN  android-device/app/build.gradle has no kotlin-bom — this tree is OLDER than the duplicate-class fix; git pull the branch arena/d4f2fdce-scary-night first"
ADB=""
if [ "$PACK_ONLY" = 1 ]; then
  echo "  pack-only: skipping adb/JDK/Gradle probes"
else
for cand in "${ANDROID_HOME:-}/platform-tools/adb" "${ANDROID_SDK_ROOT:-}/platform-tools/adb" \
            "$HOME/Android/Sdk/platform-tools/adb" "$(command -v adb 2>/dev/null || true)"; do
  if [ -n "$cand" ] && [ -x "$cand" ]; then ADB="$cand"; break; fi
done
[ -n "$ADB" ] || die "adb not found. Looked in \$ANDROID_HOME, \$ANDROID_SDK_ROOT, ~/Android/Sdk/platform-tools and PATH. Your sdkmanager put it at ~/Android/Sdk/platform-tools/adb — if that machine is this one, export ANDROID_HOME=\$HOME/Android/Sdk and rerun."
echo "  adb: $ADB"
fi

JAVA_OK=0
if command -v java >/dev/null 2>&1; then
  JV="$(java -version 2>&1 | head -1)"
  case "$JV" in
    *'"17'*|*"17."*) JAVA_OK=1; echo "  JDK 17 found ($JV)" ;;
    *) echo "  a JDK was found but not 17: $JV" ;;
  esac
fi
[ "$JAVA_OK" = 1 ] || [ "$PACK_ONLY" = 1 ] || die "Gradle + AGP 8.5 need a JDK 17 and this machine has none usable. On Pop!_OS/Ubuntu: sudo apt install openjdk-17-jdk — then rerun. (sdkmanager running does not mean Gradle's JDK is right: it needs 17 exactly.)"

GRADLE=""
if command -v gradle >/dev/null 2>&1; then
  GV="$(gradle --version 2>/dev/null | awk '/^Gradle /{print $2; exit}')"
  case "$GV" in
    8.*|9.*) GRADLE="gradle"; echo "  gradle on PATH: $GV" ;;
    *) echo "  gradle on PATH is $GV (need 8+) — will use the cached one" ;;
  esac
fi
if [ -z "$GRADLE" ]; then
  if [ -x "$GRADLE_CACHE/gradle-8.7/bin/gradle" ]; then
    GRADLE="$GRADLE_CACHE/gradle-8.7/bin/gradle"; echo "  gradle: $GRADLE"
  elif [ "$PACK_ONLY" = 0 ] && [ "$DRY" = 0 ]; then
    say "0/5b downloading Gradle 8.7 (once, into $GRADLE_CACHE)"
    mkdir -p "$GRADLE_CACHE"
    curl -fL --retry 3 -o "$GRADLE_CACHE/gradle-8.7-bin.zip" https://services.gradle.org/distributions/gradle-8.7-bin.zip \
      || die "cannot download Gradle from services.gradle.org — this machine needs normal internet for the first build (Gradle also pulls AGP from maven.google.com)."
    (cd "$GRADLE_CACHE" && unzip -q gradle-8.7-bin.zip && rm gradle-8.7-bin.zip)
    GRADLE="$GRADLE_CACHE/gradle-8.7/bin/gradle"
  fi
fi
[ "$DRY" = 1 ] && { say "dry run: probes done, nothing changed"; exit 0; }

# ---------------------------------------------------------------- 1/5 device
if [ "$PACK_ONLY" = 0 ]; then
  say "1/5  the device"
  SERIAL=""
  for _ in 1 2; do
    SERIAL="$("$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="device"{print $1; exit}')"
    [ -n "$SERIAL" ] && break
    cat <<'GUIDE'
  No device attached yet. Checklist (once, then it sticks):
    1. USB cable into the phone; USB mode = File Transfer (not charge-only)
    2. Settings > About phone > tap Build number 7x  -> developer options on
    3. Settings > System > Developer options > USB debugging = ON
    4. rerun; the phone pops "Allow USB debugging?" -> tick always allow, OK
    5. still empty?  adb kill-server && adb start-server   (or another cable/port)
GUIDE
    echo "  waiting up to 180 s for a device…"
    "$ADB" wait-for-device timeout 180 2>/dev/null || true
  done
  [ -n "$SERIAL" ] || die "still no device in adb devices — the install needs one. Fix the checklist above and rerun; everything up to here is cached."
  echo "  device: $SERIAL ($("$ADB" -s "$SERIAL" shell getprop ro.product.model 2>/dev/null | tr -d '\r'))"
fi

# ------------------------------------------------- 2/5 assets (or the TWA apk)
if [ "$TWA" = 1 ]; then
  say "2/5  Play route: tools/playpack.sh builds the signed TWA APK"
  bash "$ROOT/tools/playpack.sh"
  APK="$(ls -t "$ROOT"/dist-play/*.apk 2>/dev/null | head -1)"
  [ -n "$APK" ] || die "playpack.sh finished but left no APK in dist-play/"
  echo "  apk: $APK ($(du -h "$APK" | cut -f1))"
  say "2/5b what the phone will actually play"
  HB="$(curl -fs --max-time 15 "$HOST/index.html" 2>/dev/null | grep -o "DUSKHOLD_BUILD = '[0-9]*'" | head -1 || true)"
  LB="$(grep -o "DUSKHOLD_BUILD = '[0-9]*'" "$ROOT/index.html" | head -1)"
  echo "  hosted: ${HB:-unreachable}   repo: $LB"
  if [ -n "$HB" ] && [ "$HB" != "$LB" ]; then
    echo "  WARN  a TWA plays the HOSTED site, not the APK's bytes: deploy the repo to"
    echo "        $HOST first, or the phone will show the old build while the APK is new."
  fi
  say "3/5  skipped (playpack already built)"
  say "4/5  install + launch on $SERIAL"
  "$ADB" -s "$SERIAL" install -r "$APK"
  PKG="$(grep -o '"packageId": *"[^"]*"' "$ROOT/bundle.config.json" | head -1 | sed 's/.*: *"//; s/"//')"
  "$ADB" -s "$SERIAL" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
  say "5/5  on the phone"
  echo "  TWA $PKG installed; it opens $HOST in a Custom Tab until Play signing is"
  echo "  verified (assetlinks), then goes fullscreen standalone."
  exit 0
fi
say "2/5  packing the game into the APK assets"
rm -rf "$ASSETS"
mkdir -p "$ASSETS/server"
cd "$ROOT"
cp index.html styles.css sw.js offline.html privacy.html manifest.webmanifest "$ASSETS/"
cp -r src assets "$ASSETS/"
cp egyptian_people.glb werewolf-3d-model.glb polyart_zombies_with_animations_free_pack.glb \
   hunter_run_walk_claw_sword_shot.glb zombie+3d+model.glb "$ASSETS/"
cp server/catalog.json "$ASSETS/server/"
for need in index.html src/main.js assets egyptian_people.glb polyart_zombies_with_animations_free_pack.glb server/catalog.json; do
  [ -e "$ASSETS/$need" ] || die "asset copy incomplete: $need missing from $ASSETS"
done
STAMP="$(grep -o "DUSKHOLD_BUILD = '[0-9]*'" "$ASSETS/index.html" | head -1)"
echo "  assets: $(du -sh "$ASSETS" | cut -f1) — $STAMP"
[ "$PACK_ONLY" = 1 ] && { say "pack-only: stopping after the asset copy"; exit 0; }

# ---------------------------------------------------------------- 3/5 build
if [ "$SKIP_BUILD" = 0 ]; then
  say "3/5  gradle assembleDebug (first run downloads AGP from maven.google.com)"
  "$GRADLE" -p "$PROJ" assembleDebug --console=plain
else
  say "3/5  skipped (--skip-build)"
fi
[ -f "$APK" ] || die "no APK at $APK — the Gradle log above has the reason"
echo "  apk: $(du -h "$APK" | cut -f1)"

# ---------------------------------------------------------------- 4/5 install
say "4/5  install + launch on $SERIAL"
"$ADB" -s "$SERIAL" install -r "$APK"
"$ADB" -s "$SERIAL" shell monkey -p "$APPID" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 \
  || "$ADB" -s "$SERIAL" shell am start -n "$APPID/.MainActivity"

# ---------------------------------------------------------------- 5/5 done
say "5/5  on the phone"
echo "  DUSKHOLD device build $STAMP is running (package $APPID)."
echo "  Reinstall after any repo change: bash tools/android-install.sh  (assets are repacked every run, so the phone always shows THIS tree)."
echo "  The Play route (signed AAB/APK for the store) is still tools/playpack.sh — this wrapper never touches the upload key."
