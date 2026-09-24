# LAST NIGHT — Google Play launch notes

This is the checklist that matches the code in this repo. It is not a Play
Console approval. Fill the forms with these answers only while the build
still behaves this way.

Official rules used here:

- [Payments policy](https://support.google.com/googleplay/android-developer/answer/10281818)
- [User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311)
- [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469)

## What this build may and may not do

| Surface | Digital goods (shards, revive, coats) | Midtrans |
|---|---|---|
| Browser | Midtrans Snap, IDR | Yes. Client key is public. Server key is only in `server/.env`. |
| Google Play app | Google Play Billing, via `window.LNBridge` | No. Indonesia is not an alternative-billing region. Selling these SKUs through Midtrans on Play violates the Payments policy. |

`IAP.init()` already prefers `LNBridge` over Midtrans. The Play wrapper must
set `window.LNBridge.postMessage` and complete purchases with
`window.__LN_IAP_result`. Product ids are the catalog ids: `shards_s`,
`shards_m`, `shards_l`, `revive1`, `revive5`, `pouch`, `coat_bloodmoon`,
`coat_moonsilver`, `dawnbreaker`. Create those as Play products. Do not put
the Midtrans server key in the APK.

Physical goods are not sold. Do not add them to Play Billing.

## Store listing answers

- App name: LAST NIGHT
- Category: Game → Survival / Horror. Not in the Families program.
- Target audience: 18 and older. Content rating questionnaire: horror violence, no sexual content, no user-generated content, no unrestricted web.
- Contains ads: **No**. `src/shop/ads.js` provider is `none`. Do not flip that on without changing this answer, the privacy policy, and Data safety.
- In-app purchases: **Yes**.
- Privacy policy URL: the public URL of `privacy.html` (same origin as the game, for example `https://your.host/privacy.html`).
- Account deletion: the app does **not** let users create an account. Answer that question **No**. Still publish `delete.html` (for example `https://your.host/delete.html`) because a device id is created if someone pays on the web, and Play reviewers look for a deletion path. In the app: menu footer → Privacy → Delete data. That wipes `lastnight.save.v1`, `lastnight.playerId`, and `lastnight.iap.sandbox.v1`, then asks `POST /api/privacy/delete` to drop the server ledger. Deletion is deletion, not a freeze.
- News / COVID / health: no.
- Data safety: see the table below. If you later add analytics, ads, or accounts, the form and `privacy.html` both change first.

## Data safety (this build)

| Question | Answer |
|---|---|
| Does the app collect or share any of the required user data types? | On Play, no data is sent to our server. Purchases are handled by Google. On the web build only, a random device id plus the SKU are sent to our server and Midtrans when the player starts a payment. Declare that if the Play artifact can reach the web rail. The intended Play artifact cannot: `LNBridge` wins. |
| Location, personal info, contacts, photos, audio, files, calendar, app activity, crash logs, diagnostics | Not collected. |
| Device or other IDs | Not read (no GAID). A random id is written to local storage only when a web payment starts. The Play path does not create it. |
| Data shared with third parties | Google Play, for Play Billing, under Google's policy. Midtrans only if the web rail is actually in the Play artifact. It must not be. |
| Data encrypted in transit | Yes (HTTPS) for any payment call. |
| Users can request deletion | Yes, in the app and at `delete.html`. No account exists to delete. |
| Committed to Play's Families policy | No. 18+. |

## In the app, already done

- First launch replaces the menu buttons with the privacy notice until `save.privacyAck`.
- Menu footer has Privacy. Tall settings screens also have Privacy & delete. Short screens do not grow a new settings row, because that screen already overflows.
- `index.html` has a fixed Privacy link so a reviewer can open the policy even if the canvas fails.
- Shop copy says there are no ads in this build, and that Play billing and Midtrans are different rails.
- Purchases are refused until the notice is accepted.
- `lastnight.playerId` is not created at boot. It is created on the first web payment.

## Before you press Submit

1. Wrap the site in a Trusted Web Activity or a thin WebView that injects `LNBridge` and uses Play Billing. Do not ship the python preview, and do not ship a build whose only pay button calls Midtrans.
2. Host `privacy.html` and `delete.html` on HTTPS. Paste both URLs into Play Console.
3. Put a real support email on the store listing. The in-repo contact is the public GitHub issues page, which is a contact mechanism, not a substitute for the Console email.
4. Complete the content-rating questionnaire as 18+ horror.
5. Upload a 512 icon and a 1024×500 feature graphic. They are not generated here.
6. Set the Midtrans notification URL to `https://your.host/api/iap/callback` for the **web** deploy only. Callbacks must send `signature_key`.
7. Rotate the Midtrans server key if it has been pasted into chat, email, or a ticket. Then update `server/.env` on the server. Never commit it.
8. Declare IAP prices in Play Console. The IDR figures in `server/catalog.json` are the web prices, not the Play prices. Play prices are whatever you set in Console.
