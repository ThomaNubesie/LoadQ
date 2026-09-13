# Kolis / Concord Express — session handoff

_Last updated: 2026-09-13._

## Latest session — 2026-09-13 (brand mark across the app; keyboard; onboarding fee)

### Done and SHIPPED (OTA, production)

**The LoadQ wordmark now appears on every screen.** It was on the 8 auth screens and nowhere
else — of the 52 screens past sign-in only `zone-select`, `pickup-receipt` and
`admin-print-user` carried it. `components/Wordmark.tsx` is now the ONLY place the letters
exist; `components/BrandHeader.tsx` renders it once per group `_layout` above the `<Stack>`.

**Brand rule (user directive):** the **Q is always `#FF8A1A`** — never the theme accent. It
had been `Colors.accent`, so the mark was ALL CAPS and *blue* `#2F6FE0` on the default light
theme. "Load" takes only the colour the background allows: `#15171C` on light, white on dark.
**No plate, no box** (tried, rejected).

**Safe-area — two failed attempts before the right one, worth not repeating:**
1. Zeroing the top inset via `SafeAreaInsetsContext` does NOTHING. `SafeAreaView` is a NATIVE
   view and ignores React context.
2. Pulling the stack up by `insets.top` hides the header — the header is `inset + 26` tall, so
   content lands on top of the wordmark row.
3. **The fix:** every `SafeAreaView` in `(app)` and `(passenger)` is `edges={["left","right","bottom"]}`
   — 52 of 52. The header owns the top edge; nothing else claims it. `zone-select` imported
   `SafeAreaView` from **react-native** (no `edges` prop) — moved to the context library.

**Keyboard on the document-rejection sheet** (`app/(app)/admin-docs.tsx`) — three faults:
`behavior={undefined}` on Android so nothing moved; the sheet sits inside a full-screen
`Pressable` dim, so with the keyboard open the first tap was swallowed dismissing it and the
Reject button appeared dead (`keyboardShouldPersistTaps="handled"` fixes that); and nothing
scrolled. Now KAV `padding`/`height`, an inner `ScrollView`, `maxHeight: "82%"` on the sheet.

### iOS IS ON A WORKAROUND — READ THIS FIRST

`runtimeVersion` is `appVersion`. The App Store is still serving **1.2.23 (build 33, 18 Aug)** —
Apple's lookup API confirms it. Builds **34 (1.2.24)** and **35 (1.2.25)** were built and
**never released**. So every OTA published against 1.2.25 reached **zero iOS devices** — silently,
because the publish reports success regardless.

To reach iPhones tonight, updates were published to the **1.2.23 runtime** by temporarily
setting `expo.version` in `app.json`, publishing, and reverting. Safe here *because there are
zero dependency differences between 1.2.23 and 1.2.25* (verified with
`git diff 5bc96a6 0082128 -- package.json` → empty). The only native-config change is the
`updates` block gaining `checkAutomatically` / `fallbackToCacheTimeout`.

**But that ships two releases of features Apple never reviewed.** The proper fix is to release
build 35. `eas submit -p ios --id 82a6e72d-2ca6-4330-baa1-7922ebdf756c` FAILED twice; the error
is only readable at
`expo.dev/accounts/thomasderick/projects/loadq/submissions/4bcfbcbb-843f-476f-a034-2f9b15b48225`.
Most likely a duplicate — build 35 may already be in App Store Connect needing only submission
for review. **Check App Store Connect → TestFlight/Builds first.**

Note: 1.2.23 builds predate `fallbackToCacheTimeout`, so on iPhone an update needs **two** cold
starts (one downloads, the next applies). Android's 1.2.25 build waits 10s and often applies on
the first.

### NOT BUILT — designed only: $100 onboarding fee

Mockups: **`~/Downloads/loadq-onboarding-fee.html`** — 2 screens × 3 real palettes
(light/dark/azure). Final onboarding step (pay 100 $, card or Interac) and the annual renewal
prompt tied to document expiry.

**⚠ This contradicts a document already drafted for signature.** Article 3 of the Concord
Express engagement form (`docs/concord/concord-loadq-engagement.html` in the **Kolis** repo)
says the 100 $ is *"exigible avant la première entrée dans la file"* — one-time, with 7 days
for existing drivers. The new rule is **annual, at document renewal**. 162 drivers are due to
sign the one-time wording. Article 3 needs amending before the form circulates.

The database matches the document, not the new plan: `loadq_memberships` (Kolis project
`kzjptcpjpwlxfofzhyku`) has `paid_at` + a 7-day grace and **no expiry or renewal cycle**.
An annual fee needs `valid_until`, and `loadq_membership_ok()` needs to check it.

### Still open

- **Release build 35** (above) — the single highest-value item for iOS.
- `/ride` driver navigation screen is on branch `loadq-incident-register` in the **Kolis** repo,
  unmerged and undeployed; `/board` lives only on `ship-kolis-1.1.0`, so deploying either branch
  alone wipes half of admin.loadq.ca. Merge first (0 conflicts), then deploy from the iMac.
- Roll the exposed `sk_live_` Stripe key; revoke the exposed Facebook user token.


