# LAST NIGHT — the Play bundle

How this web game becomes an Android App Bundle, and what has to be true
before it is allowed to. Read `docs/PLAY-STORE.md` beside this: that one is
the policy and the store listing, this one is the build.

**The shape of it:** a Trusted Web Activity. There is no second codebase and
no port. The game stays the site you already host; the app is a signed shell
that opens it full-screen with no URL bar, built by
[Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) (Chrome Labs, the
same tool PWABuilder uses). Ship a fix to the site and the app has it.

---

## 1. What Google requires in 2026

| Rule | Where it bites | What this repo does |
|---|---|---|
| **Target API 36** (Android 16) for new apps and updates, from 31 Aug 2026 | the upload is refused | Bubblewrap's template sets `compileSdkVersion 36` / `targetSdkVersion 36`. Verify after `bubblewrap init` — `android/app/build.gradle`. |
| **AAB**, not APK | new apps since 2021 | `bubblewrap build` emits `app-release-bundle.aab` (and a signed APK for local testing). |
| **Digital goods go through Play Billing** | Payments policy | A TWA cannot inject JS, so `window.LNBridge` is unreachable. The app bills through the **Digital Goods API**, which Chrome inside a TWA hands to the app's `DigitalGoodsRequestHandler`. Bubblewrap installs that when `features.playBilling.enabled` is true. |
| **Play Billing Library 8+** (31 Aug 2026) | native billing integrations | Not applicable to the TWA route: the billing code lives in `androidbrowserhelper:billing`, not in our Gradle file. |
| **Developer verification + package registration** | from 30 Sep 2026 in **Indonesia**, Brazil, Singapore, Thailand; globally in 2027 | Two tasks in Play Console: verified identity, and every package name registered. Unregistered apps are removed. |
| **12 testers × 14 continuous days** closed test | personal accounts created after 13 Nov 2023, before production access | Plan three weeks. Internal testing does not count. |
| **16 KB page size** | apps shipping `.so` files | A Bubblewrap TWA ships none. Check after the first build: `unzip -l app-release-bundle.aab | grep '\.so$'` → expect nothing. |
| Privacy policy URL, data safety, content rating | the listing | `docs/PLAY-STORE.md` has the answers. |

---

## 2. Once, before the first build

**a. The host.** The game has to live on a public HTTPS origin; a TWA is
verified against it. Set it in `bundle.config.json`:

```json
{ "host": "https://play.lastnight.game", "basePath": "/" }
```

`basePath` is where the game sits on that host (`/` for the root, `/game/` if
it is in a folder). Every path in `manifest.webmanifest` and
`android/twa-manifest.json` is derived from those two values.

**b. The package id.** `packageId` is **permanent** — Play will not let you
change it, or reuse it, after the first upload. It is set to
`com.xameth.lastnight`; change it now or never.

**c. The Digital Goods origin trial.** Play Billing in a TWA needs the
Digital Goods API, and the Digital Goods API ships as an
[origin trial](https://developer.chrome.com/origintrials) (v2). Register the
origin, take the token, and put it in `index.html` (the commented
`<meta http-equiv="origin-trial">` marks the spot). **Tokens expire** — put
the date in the calendar. Without it the shop quietly falls back to the shard
lane and sells nothing.

**d. The keystore.** Once:

```bash
node tools/bundle.mjs key
```

Needs a **JDK 17** (18+ is refused by the Android command line tools; let
`bubblewrap init` install one). This writes `android/lastnight-upload.jks` and
`android/signing.local.json`, both gitignored. **Back the password up outside
this repo** — losing it means you can never update the app again.

**e. The products.** In Play Console, create exactly the four from
`server/catalog.json` and no others: `revive1` (consumable),
`coat_bloodmoon`, `coat_moonsilver`, `dawnbreaker` (non-consumables). Shard
packs and plank pouches are not products.

**f. Bubblewrap.**

```bash
npm install -g @bubblewrap/cli
cd android
npx @bubblewrap/cli init --manifest https://YOUR-HOST/manifest.webmanifest
```

---

## 3. Every build

```bash
node tools/bundlecheck.mjs      # what can be checked without a JDK — seconds
node tools/bundle.mjs prepare   # rewrite the manifest, asset links, twa-manifest
node tools/bundle.mjs build     # check -> prepare -> key -> update -> build
```

`build` needs a JDK 17, the Android SDK and network access to
`dl.google.com`; it stops and says which one is missing rather than guessing.

Output: `android/app-release-bundle.aab` (upload this) and
`android/app-release-signed.apk` (sideload this, to test the shell).

---

## 4. The URL bar is the tell

A TWA only hides its chrome when Android can prove the app owns the origin,
through `https://YOUR-HOST/.well-known/assetlinks.json`. Two traps:

1. The fingerprint in it has to be the **app signing** certificate — the one
   Play generates, not your upload key. After the first upload, copy the
   SHA-256 from Play Console → Setup → App signing, into
   `.well-known/assetlinks.json`, and re-publish that file at the origin root.
   `bubblewrap fingerprint` writes the upload key's; that one is the wrong one.
2. The file must be served from the **root** of the origin, not from a path.
   Some hosts hide dot-directories — check the URL in a browser before you
   submit.

Verify it, without waiting for a device:

```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://YOUR-HOST&relation=delegate_permission/common.handle_all_urls
```

If it comes back empty, the app will open with a URL bar and a reviewer will
read it as a website in a box.

---

## 5. Billing, end to end

```
shop button  ->  IAP.buy()
             ->  DigitalGoodsProvider.purchase(sku)
                   new PaymentRequest([{ supportedMethods:
                     'https://play.google.com/billing', data: { sku } }])
                   request.show()            the Play sheet
                   service.consume(token)    consumable     (SECOND BLOOD)
                   service.acknowledge(token, 'onetime')    (coats, Dawnbreaker)
             ->  only then does the game grant
```

The grant is gated: `IAP.buy()` refuses to hand anything over unless
`consumed` or `acknowledged` came back true. Google refunds an
unacknowledged purchase after 72 hours and an unconsumed consumable cannot be
bought twice.

`restore()` calls `listPurchases()` and acknowledges anything still
unacknowledged — the safety net for a purchase made out of app, or one whose
acknowledgement was lost.

**Midtrans is switched off inside the app.** `IAP.init()` will not touch the
web rail when `inTwa()` is true; the shop runs on shards instead of on a rail
Play would reject. On the open web, Midtrans is still the rail.

Known device bug: `request.show()` can throw `AbortError: Invalid state` on
some Samsung devices while working on others with the same account. It is
reported as a cancellation, not as a failure — nothing is granted, nothing is
charged.

---

## 6. Store listing

```bash
node tools/makeicons.mjs
```

draws everything the listing asks for out of `assets/brand/mark.svg`: the PWA
icons (192, 512), the maskable 512 Play uses for adaptive icons, and a
1024×500 feature graphic. Still needed, and not generatable: **screenshots**
(phone, at least two) and the **content rating questionnaire** (18+, horror
violence, no sexual content, no UGC, no unrestricted web).

---

## 7. Release runbook

1. `node tools/bundlecheck.mjs` — green, or the two things only you can fill in.
2. `node tools/swtest.mjs` — the service worker still refuses to touch money.
3. Bump `versionCode` (and `versionName`) in `bundle.config.json`. They must
   go up, every single upload.
4. `node tools/bundle.mjs build`.
5. Sideload the APK on a real phone: the app opens with **no URL bar**, the
   loading veil gives way to the game, portrait stays portrait, and a purchase
   goes through the Play sheet.
6. Upload the AAB → **internal testing** → check Policy status is clean.
7. Copy the app-signing SHA-256 into `.well-known/assetlinks.json`, publish it,
   and re-check the Digital Asset Links URL.
8. **Closed testing**: 12 testers, opted in continuously for 14 days (personal
   accounts created after 13 Nov 2023). Engagement counts — ask them to play.
9. Production. `docs/PLAY-STORE.md` → "Before you press Submit" for the
   listing answers.

---

## 8. Gotchas already paid for

- **`appVersion`, not `appVersionName`.** The JSON schema spells the field
  `appVersion` (the *class* has the long name). Getting it wrong ships an app
  whose version string is `undefined` and validates fine. `bundlecheck` now
  builds a real `TwaManifest` from the file when Bubblewrap is installed.
- **The service worker is https-only.** Registering it on `http://localhost`
  would cache the module graph and hide every edit during development.
- **Never cache `/api/`.** `sw.js` answers nothing that is not a plain
  same-origin GET, and nothing under `/api/` at all. `tools/swtest.mjs` proves
  it.
- **Bump the service worker `VERSION`** when the deployed site changes in a
  way players must see, or they will play yesterday's build until the cache
  ages out.
- **Headless Chromium in a sandbox renders at ~2 fps.** Any test that waits on
  wall-clock seconds there is measuring the renderer, not the game.
