# The Play bundle

`android/` holds the input to the Android build, not the Android project.

| File | What it is |
|---|---|
| `twa-manifest.json` | Bubblewrap's input: package id, host, orientation, colours, signing key, version. Generated from `bundle.config.json` by `node tools/bundle.mjs prepare` — edit the config, not this. |
| `lastnight-upload.jks` | The upload keystore. Made once by `node tools/bundle.mjs key`. **Never committed** (gitignored). Losing it means losing the ability to update the app. |
| `signing.local.json` | The keystore password. Gitignored. Back it up somewhere that is not this repo. |

Everything else you see here after a build (`app/`, `gradle/`, `gradlew`,
`app-release-bundle.aab`, `app-release-signed.apk`) is produced by Bubblewrap
and is not committed.

## First time (needs network — it downloads a JDK 17 and the Android SDK)

```bash
npm install -g @bubblewrap/cli
node tools/bundle.mjs prepare                 # writes twa-manifest.json
node tools/bundle.mjs key                     # makes the upload keystore
cd android
npx @bubblewrap/cli init --manifest https://YOUR-HOST/manifest.webmanifest
npx @bubblewrap/cli build                     # -> app-release-bundle.aab
```

## Every time after

```bash
node tools/bundle.mjs build                   # check -> prepare -> update -> build
```

The JDK has to be **17**. The Android command line tools refuse 18+, and
Bubblewrap will install the right one for you if you let it.
