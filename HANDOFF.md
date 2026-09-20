# Kolis / Concord Express — session handoff

_Last updated: 2026-09-18._

## Latest session — 2026-09-18 (passenger DOB removed; van icon; three bug fixes shipped)

### SHIPPED — OTA to production, both runtimes, both platforms

Commit `8074c65` on `ship-loadq-1.2.6`, pushed. Published twice, as the iOS workaround below
requires:

| Runtime | Update group |
|---|---|
| 1.2.25 | `67b4a04e-a745-43be-92f2-cf36d5440579` |
| 1.2.23 | `91675b2c-8906-4480-82e9-c78d83e67a27` |

Verified by fetching the manifest as a device would — `u.expo.dev/b060bf16…` with
`expo-platform: android`, `expo-runtime-version: 1.2.23`, `expo-channel-name: production`
returns update id `01a0b45c-d1db-7fee-9697-e2c19731f98f`, i.e. ours. Channel→branch mapping
confirmed via `eas channel:list`. **Publishing "success" alone proves nothing** — check the
manifest.

**1. Passenger date of birth removed** (`app/(auth)/passenger-setup.tsx`). Field, `dob` state,
`formatDob`, `parseDobIso`, the validation branch and the `createOrUpdate` payload key all gone.
**Sex is kept** (user decision). Nothing in booking, pricing, matching or messaging ever read a
passenger's DOB; Law 25 / PIPEDA require a stated purpose per item collected, and DOB is one of
the fields that turns an ordinary breach into a reportable one.
**`profile-setup.tsx` (driver) deliberately keeps DOB** — it is on the licence we verify against,
so it has a purpose. There is a comment saying so in `passenger-setup.tsx`; do not "make the two
screens consistent".

**2. Android bottom nav** (`components/BottomNav.tsx`) — sat under the system nav bar on
gesture-nav devices. Now `useSafeAreaInsets()` + `paddingBottom: 8 + insets.bottom`.
`PassengerBottomNav` was already correct; only the driver one was wrong.

**3. Address autocomplete reopening** (`components/AddressAutocomplete.tsx`) — an in-flight
request resolving *after* a selection repopulated the list. Added a `seq` ref: each keystroke
takes a ticket, `pick()` increments it to retire anything in flight, and a skip is only claimed
when the value will actually change.

**4. `components/VanIcon.tsx` + `assets/van.svg`** — shipped but **not yet wired into any
screen**. Available, unused.

### Data — 159 passenger DOBs cleared

`update passengers set dob = null` — 159 rows, 0 remaining, verified. `sex` untouched (159),
**driver DOBs untouched (137)**. Stopping collection does not address what is stored; the Law 25
retention argument is the same as the collection argument. `fmtDate` already returned `—` for
null so `admin-user.tsx` and `admin-print-user.tsx` degrade cleanly — but both still `select`
and render a "Date of birth" row, which will now always read `—` for passengers. Worth removing.

### "The passenger screen is still the same" — it is supposed to be

`passenger-setup` is reachable from exactly three places: `otp.tsx:98` (straight after first
verification), `welcome.tsx:20` (signup), and `authRoute.ts:43` (only when
`!passenger.full_name`). **An existing passenger with a name can never navigate back to it.** To
see the change you must create a new passenger account. Nothing in `(passenger)/profile.tsx`
shows DOB, so there is no other surface where it would appear.

Second cause, if testing with a fresh account: `checkAutomatically: ON_LOAD` with
`fallbackToCacheTimeout: 10000` — if the download does not finish inside 10s the app launches the
cached bundle and applies the update on the *next* launch. Needs a full swipe-away kill, not a
background/foreground.


### Marketing — the noon flyer is now a rotation, not a file

Cron job **30** (`loadq-fb-noon-1200`) is `30 16 * * *` — **12:30 ET every day, Saturday
included**. It was `0-5` (Sun–Fri), so Saturday silently posted nothing.

It no longer names an image. It calls `loadq_flyer_claim_today()`, which picks from
`loadq_flyer_assets` (20 landmark/scenic flyers, 1600×900 JPEG in the `marketing` bucket) and
stamps `last_posted_on` in the same statement, so it cannot post without recording it.

`loadq_flyer_for(date)` scores by **season** (from what the photo shows; wrong season −6, so snow
cannot run in July) plus **mood** from the day of week — Mon–Thu `city`, Fri/Sat `escape`, Sun
`calm`. Candidates are everything within 4 points of the best, then a date index rotates.

**Two bugs already found and fixed here — do not reintroduce:**
- `where fit = max(fit)` left a ONE-ROW candidate set for `escape`, so Niagara Falls ran every
  Friday and Saturday forever. A rotation must not collapse into a ranking.
- Adjacent repeats cannot be prevented by date arithmetic when two moods' bands overlap; that is
  what `last_posted_on` (−40 at one day, fading over three) is for. Verified by simulating 21
  days with stamping inside a rolled-back DO block: zero adjacent repeats.

**Captions are assembled in SQL** (`loadq_flyer_caption`) from stored parts — never store 20
rendered captions, or changing one line is 20 UPDATEs with 20 chances to miss one.

**`board` decides the wording.** `true` = on the live seat board, may say "reserve a seat".
`false` = door-to-door only (Niagara, Tadoussac, Rivière-du-Loup, Georgian Bay, Sandbanks,
Peterborough, Île d'Orléans) and says *"porte-à-porte, sur réservation"*. Saying "reserve a seat"
for a city that is not on the board advertises a service that does not exist.

**Every photo is share-alike-free** (CC0 / public domain / CC BY), credit burned into the
bottom-right of the JPEG. CC BY-SA and GFDL were excluded on purpose: as a flyer background they
arguably make the flyer a derivative, which would oblige releasing the flyer under the same
licence. The filter cost real subjects — Habitat 67, the Biosphère, Charlevoix, Tadoussac, Lévis
and the Ottawa Valley had nothing usable on Commons. Those are the ones to shoot in person.

Kolis rides along: the artwork carries "Colis aussi · kolis.ca" and every caption has a parcel
paragraph. Rendered set + browsable index: `~/Downloads/LoadQ-Daily-Flyers/`.

### The van icon

Orange `#FF8A1A` (= `accentWarm` in `constants/colors.ts`, identical in light and azure themes),
strokes only so it stays transparent, wheel arches **cut out of the body path** rather than masked
with a background-coloured disc (a masked disc becomes a solid blob the moment the background
changes). `heading: "east" | "west"` points the nose the way the passenger travels; route strips
run origin-left → destination-right so `east` is the default.
Two copies, keep in step: `assets/van.svg` (canonical, for flyers/HTML) and
`components/VanIcon.tsx` (RN port). **Never the 🚐 emoji** — cannot be recoloured, cannot be
turned round, renders as a different vehicle on every platform.

### Marketing — the flyer upload, and a near-miss worth recording

The Facebook noon job reads **`marketing/loadq-ott-mtl-shuttle.png`**, NOT
`loadq-intercity-flyer.png`. I had this wrong in conversation. `loadq-intercity-flyer.png` holds
the **dark-blue board flyer the user chose**; overwriting it would have destroyed that choice.
Always confirm the cron's actual target before replacing a marketing asset:

```sql
select jobname, schedule, substring(command from 'marketing/[a-z0-9.-]+')
from cron.job where command ilike '%fb-post%';
-- loadq-fb-noon-1200 | 30 16 * * 0-5 | marketing/loadq-ott-mtl-shuttle.png
```

Uploaded via `loadq-asset-put` (141,918 bytes), previous version kept at
`~/Downloads/loadq-ott-mtl-shuttle-PREVIOUS.png`. Storage CDN caches `max-age=3600`; the first
re-fetch was a stale `cf-cache-status: HIT` — append `?bust=…` to read the origin, and compare
with `cmp` rather than trusting a 200.

### Mockups — 27 of 63 screens drawn (`~/Downloads`)

- `loadq-passenger-all-screens.html` — all 18 passenger screens
- `loadq-auth-screens.html` — all 9 auth screens
- Remaining: **35 driver/admin screens**, the biggest slice, and the one carrying the 16 Oct
  document deadline.

### Found while drawing, NOT yet fixed

- **`sign-in.tsx:27`** — `const canSend = emailValid && confirmEmail.length > 0 && emailsMatch;`
  No `isSignIn` guard, and the confirm field at line 83 renders unconditionally, so **returning
  users must type their email twice to log in**. Correct on signup (a typo sends the code to a
  stranger); wrong on sign-in. Two-line fix: gate both on `!isSignIn`.
- **`engagement.tsx`** — hard-coded "Step 4 / 5"; it is the third of four, and no other setup
  screen shows position at all.
- **`profile-setup.tsx` vs `passenger-setup.tsx`** — were 368 lines duplicated to differ by a
  heading. Now genuinely divergent (DOB), so both should stay.
- **`zones.tsx`** — lists loading points with no car counts, so riders pick blind and arrive at
  an empty board. Same query the board already runs.
- **`history.tsx`** — lists past trips but offers no receipt.
- **`pickup-receipt.tsx`** — should carry the HST number, but **777954975 RT0001 is not live**;
  only RC0001 (corporate income tax) exists today. Do not print it until the GST/HST account is open.
- **`welcome.tsx`** — offers "you can add the other role later"; there is no such path in the app.


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

---

## Earlier history — LoadQ session handoff (from 2026-08-05)

Snapshot for continuing on another machine. Pull latest first:
`git pull` on branch **`ship-loadq-1.2.6`** (LoadQ) and **`ship-kolis-1.1.0`** (Kolis at ~/Desktop/Kolis).
Shared Supabase project: **`kzjptcpjpwlxfofzhyku`** (LoadQ + Kolis). EAS user: **thomasderick**.

## LoadQ 1.2.19 — bug fixes, single-session, Relocate (2026-08-08)

Shipped: mobile **1.2.19** (iOS build 28 / Android vc 59) built + auto-submitted to both stores; web admin deployed to **admin.loadq.ca**.

**Bug fixes (mobile):**
- **Bottom-nav "jump" (Android):** passenger `app/(passenger)/profile.tsx` used a bare `<SafeAreaView>` — added `edges={["top"]}` to match Board/My trip/Alerts. Root cause: `PassengerBottomNav` self-adds `insets.bottom`, so a screen that also applies the bottom inset double-pads → gap. Driver `BottomNav` does NOT self-inset, so driver screens intentionally use no-`edges`; fixed the inverse mismatch on `app/(app)/deliveries.tsx` (removed its stray `edges={["top"]}`).
- **Per-seat price only:** `app/(passenger)/board.tsx` fare row dropped the "· $Y full van" total → shows just `$X per seat` (new i18n `perSeat`).
- **"Message driver":** was routing to the LoadQ Support thread. New `app/(passenger)/thread.tsx` (passenger↔driver DM, mirrors driver `thread.tsx`); My trip button now pushes it with `trip.driver_id`. Board + Profile message boxes still go to Support via `(passenger)/messages.tsx` (unchanged).

**Single-active-session enforcement (built, DORMANT):**
- Table `active_sessions(user_id→session_id)` (migration `loadq_active_sessions_single_device`); realtime-enabled; RLS own-row only.
- `services/session.ts` — `claim()` on OTP verify (`app/(auth)/otp.tsx`) records the active device (both driver & passenger). Watcher in `app/_layout.tsx` subscribes + re-checks on foreground and force-signs-out the previous device.
- **Runtime switch (no rebuild to toggle):** DB flag `app_flags.single_session_enforce` (table migration `app_flags_runtime_switches`, seeded **false**, public-read/user-write-blocked, realtime). App reads it at launch + realtime + foreground. Turn ON: `update public.app_flags set enabled=true where key='single_session_enforce';` (OFF = false). Only affects devices on **1.2.19+**.

**Relocate — move people between locations (BOTH admin surfaces):**
- RPCs (migration `loadq_admin_relocate_people`, admin-gated SECURITY DEFINER, reuse `loadq_admin_renumber`):
  - `loadq_admin_relocate_driver(p_entry_id, p_new_zone, p_new_dest, p_new_pos, p_release_passengers)` — moves a driver's active `queue_entries` row in place (same id → kept riders stay bound). Passenger handling: `p_release_passengers` null = **auto** (keep on zone-only move, release when destination changes); true=release, false=keep.
  - `loadq_admin_relocate_passenger(p_passenger_id, p_target_entry_id, p_seats)` — frees old seat + drops old trip (`admin_cancel_passenger_claims`), then books a confirmed seat on the target entry, carrying fare/seats forward; full-van guard.
- **Web:** `admin-web/app/admin/relocate/page.tsx` + nav item (`navRelocate`) + `api.relocateDriver/relocatePassenger/searchPassengers/passengerReservation` in `lib/supabase.ts`. Driver & Passenger modes.
- **Native:** `app/(app)/admin-relocate.tsx` (reached from Profile → admin section, `is_admin` only) + `QueueAPI.adminRelocateDriver/adminRelocatePassenger/adminZoneActiveDrivers/adminSearchPassengers/adminPassengerReservation` + `ar*` i18n (EN/FR).

**Deploy notes:** web admin deploy MUST run `./deploy-admin-web.sh` from repo root (netlify.toml `base=admin-web`); running `netlify deploy --build` from inside `admin-web/` doubles the publish path (`admin-web/admin-web/.next`) and fails.

## Concord Express — official email & letter branding (2026-08-08)

**This is the canonical Concord Express brand for all outbound email and PDF letters.** Green identity (NOT the KOLIS magenta).

- **Logo:** dark-green square `#0E4632`, `CX` in mint `#33D69F` (Georgia serif), `CONCORD` under a mint rule.
- **Wordmark:** **Concord Express Co Inc.** + taglines: *Intercity carpooling · Canada · France · West Africa* (green `#22A874`) / *Transport des personnes · Expédition · Gestion de file d'attente* (grey) / *Là-bas aujourd'hui !* (green italic).
- **Footer band:** light `#F1F4F2` row — `www.concordexpress.ca` · mint divider `#2ECC8F` · `Ottawa, ca · (+1) 613 868 2982 · info@concordexpress.ca`; then a dark-green bar `#0E4632` reading **ConcordXpress · LoadQ · Kolis** (all three platforms).
- **Signature block:** `Thomas Derick Shalo` / `Concord Express Co Inc. · ConcordXpress · LoadQ · Kolis` / `613-862-2639 · shaloderick@concordexpress.ca`.

**How the branding is PERSISTED on every email:** the **`concord-mail`** edge function (Supabase, `verify_jwt=false`, guarded by `x-kolis-secret`) **auto-wraps every send in the letterhead above** — the `letterhead()` HTML inside that function is the single source of truth. Any system that emails as Concord Express must send through it:

```
POST https://kzjptcpjpwlxfofzhyku.supabase.co/functions/v1/concord-mail
Header: x-kolis-secret: <secret>
Body:   { "from":"Thomas Derick Shalo <shaloderick@concordexpress.ca>",
          "to":"…", "subject":"…",
          "body":"<inner HTML only — letterhead is added automatically>",
          "reply_to":"shaloderick@concordexpress.ca",
          "attachments":[{"filename":"….pdf","content":"<base64>"}] }
```
- Pass **`body`** (inner content only) — the function adds the header/footer. Pass `wrap:false` to opt out (raw HTML). `{ "action":"domains" }` returns Resend domain status.
- **`concordexpress.ca` is verified in Resend** (DKIM/SPF/return-path live) → mail from `@concordexpress.ca` passes DMARC. Default From = `Concord Express <noreply@concordexpress.ca>`.
- **To change branding globally, edit `letterhead()` in `concord-mail` once** — every future email updates.

**PDF letters** use the same letterhead (Letter size, footer band pinned to page bottom). Generator: `letter_*.html` → Chrome `--print-to-pdf`; latest saved to `~/Downloads/Concord-Express-*-Inquiry.pdf`.

**A5 automated verification — procurement + consent (2026-08-08):**
- **Inquiries SENT** (bilingual EN/FR, letterhead PDFs + overview attached): MTO Authorized Requester Program → `ARIS@ontario.ca`; Certn → `partnerships@certn.co`. Sterling Backcheck has no public sales email (First Advantage; web-form/phone only) — skipped.
- **Consent capture BUILT** (the legal bridge the MTO/Certn letters require). Migration `20260808170000_loadq_driver_screening_consent.sql`: append-only `loadq_driver_consents` table (driver-own RLS + `loadq_is_admin()` read) + `loadq_record_screening_consent(version,scopes,ua)` / `loadq_screening_consent_status()`. Scopes: drivers_license · registration · driving_record · criminal_record; version `v1-2026-08` (bump to force re-consent). App: the A1 **Verification** screen shows a consent card and **blocks uploads until the driver agrees** (`DriverDocsAPI.getConsent/recordConsent`). When a vendor is selected, store check results against the same A1 doc rows / `drivers.verified`.

## Kolis Business — this session (2026-08-08, branch `ship-kolis-1.1.0`, deployed business.kolis.ca)

**Prospects board (`admin-web/app/admin/prospects/page.tsx`)**
- Colour-coded by **urgency level** from `concord_level(status,stage,clicked)` → each row gets a left-stripe + level pill; colours: suggested `#64748B`, new `#2563EB`, contacted `#F59E0B`, engaged `#14B8A6`, replied `#7C3AED`, met `#16A34A`, closed `#334155`, bounced `#EA580C`, stopped `#9CA3AF`, rejected `#DC2626`. `kolis_prospects_list` returns `level/level_label/level_color/level_order`.
- **Colour key is clickable** → filters the board to that state.
- **Reopen** a closed/stopped/rejected/bounced prospect → `kolis_prospect_reopen(id)` (migration `20260808...`): status→active, stage→to_prospect, clears terminal markers.

**Click → AI draft → approve → send (sales follow-ups)**
- When a prospect clicks an outreach link, `concord-outreach-webhook` (on `clicked`) fires **`kolis-followup-ai`** `{action:'draft', id}` (x-kolis-secret, deduped 3-day). Claude writes next-steps + a **Kolis-branded** follow-up; a branded **approval email** goes to `shaloderick@concordexpress.ca` with a one-click **Approve & send** link (`?action=approve&id=&token=`) → sends to the prospect. Cols on `concord_outreach`: `followup_draft_*`, `followup_approve_token`, `followup_ai_sent_at`. Sales copy: **pay per shipment, price depends on the package, no subscription/monthly/minimum, serves Ontario & Québec, NEVER mention the 20%/any percentage**.

**Plans & per-plan feature gating**
- Prices: **Basic $0 · Business $124.99 · Pro $199.99** (renamed "Pay-as-you-go"→**Basic**). `kolis-plans` `PLANS.price_cad` + Stripe `lookup_key` bumped to `_v2` (rounded cents); stored `kolis_plan_prices` cleared + re-materialised via **`POST kolis-plans` with header `x-kolis-secret`** (server-to-server hook). Existing subscribers grandfathered.
- **Feature gating** in `admin-web/app/shipper/layout.tsx`: `FEATURE_MIN` maps import/bulk/products/promotions/campaigns/analytics/invoices/branding/team/freight → **Business**, developer → **Pro**. Locked nav opens an **upgrade modal** (feature explainer + Subscribe CTA); direct-URL access to a gated `/shipper/*` route redirects to Plans. Plan read via `kolis_org_plan`.

**AI Assistant (`/shipper/assistant` + floating "Ask AI")**
- **`kolis-assistant`** edge fn = Claude (`claude-sonnet-4-6`) **tool-use agent** scoped to the caller's org. Needs `ANTHROPIC_API_KEY`. READ tools auto-run (overview, shipments, clients, invoices+detail, analytics, quote, label, campaigns+stats, dispatch_board, drivers, payouts, prospects[staff]); WRITE tools are **proposed → user confirms** (create/edit/charge shipment, email_label, send_email, create/send campaign, assign_parcel, advance_parcel_status, prospect stage/reopen/draft). Body: `{org_id, messages}` → `{reply, proposals[]}`; confirm: `{org_id, confirm:{name,input}}`.
- **Security:** every tool runs under the user's own JWT (org-membership-gated RPCs) → can't cross orgs / can't exceed the user's own perms; explicit `kolis_org_role` check; strict system prompt (tool data = untrusted content, no bulk export/exfiltration, no secrets); writes never auto-execute. Verified live (reads real data, refuses exfiltration probe, proposes writes without executing).
- UI: `components/AssistantChat.tsx` (shared by the page + the Business+ floating panel). Tab is a **teaser** for Basic (upsell), full chat + FAB for Business/Pro.

**Form validation (`admin-web/lib/validate.ts` + `lib/emailVerify.ts`)**
- `emailOk`, `phoneOk` (NA 10-digit), `nameOk`, `cityOk` (served-city set), `addressOk` (civic number + street name), `contentsOk` (anti-gibberish). Cities **alphabetical** (`lib/cities.ts`, fr-aware). Applied to create shipment (single+batch), clients (CA gets served-city datalist + auto-province), bulk import (per-row, blocks until fixed).
- **Real email verification:** `kolis-verify-email` edge fn → format → placeholder (`dd@`) → disposable → **paid mailbox check IF a key is set** (`ZEROBOUNCE_API_KEY` | `KICKBOX_API_KEY` | `ABSTRACT_EMAIL_API_KEY`) → else DNS MX/A. Fail-open on outage. Wired into create + clients via `verifyEmail()`.

**New edge functions this session** (deployed on the shared project; not mirrored in repo — `supabase functions download <name>` to retrieve): `kolis-assistant`, `kolis-verify-email`, `kolis-followup-ai`, `concord-mail`. All `verify_jwt=false`; server-to-server ones gated by `x-kolis-secret` (`kolis_notify_9f3a2c7b1e6d4084`).

**Optional secrets to set (Supabase → Edge Functions → Secrets):** `ZEROBOUNCE_API_KEY`/`KICKBOX_API_KEY`/`ABSTRACT_EMAIL_API_KEY` (turns on mailbox-level email verification — no code change).

## Kolis pricing — canonical reference (2026-08-08)

**Org per-shipment price** — `kolis_org_price_cents(org, size, drop_type, from, to)`:
1. **Price-group override** — if the org is in a price group with a rule for the destination, it pays a **flat negotiated per-city price** (ignores distance). Set in /admin/pricing (group → rules → materialized into `kolis_org_price_overrides`). e.g. group "Montreal 25 / Ottawa 15".
2. **Else distance-based** (`kolis_estimate_price_cents`): `price = (base + $/km × road_km) × size × surcharge`
   - Hub/Zone `$10 + $0.10/km` · Door `$5 + $0.20/km`
   - size: envelope ×0.75 · small ×1.0 · large ×1.6
   - Halifax route ×1.30
   - road_km from `kolis_route_km` (our distance table)
   - e.g. Ottawa→Montréal ~200 km, small, hub = **$30**.

**On top:** insurance +5% of declared value (optional); provincial **tax at invoice** (`kolis_tax_config`). **Volume discount** (admin-set %) applies **at invoice** (`kolis_org_invoice` / `kolis_close_billing_period`), NOT the quote.

**Billing:** Pay-as-you-go (card per shipment) or net-terms invoice (monthly). **No credit limits** (removed 2026-08-08).

**Driver payout (INTERNAL — never shown):** non-group orgs → driver **20%** (Kolis 80%); group-member orgs → initial rate (2/3 hub/zone, 45% door); consumer parcels unchanged. `kolis_org_create_shipment` (migration `20260808150000`).

**Consumer (app) price** = same distance engine in `constants/pricing.ts` (`estimatePrice`), driver share 2/3 hub/zone · 45% door.

**Plans (web):** Pay-as-you-go / Business $79 / Pro $199 — differentiated by features only; fee % **removed** from the UI (internal). New/invited orgs must pick a plan before the portal activates (`kolis_org_needs_plan` gate).
Migrations this batch: `20260806120000` (Halifax +30%), `20260808140000` (plan gate), `20260808150000` (org 20% payout), `20260808160000` (remove credit limits). Kolis commits `fff3866`, `1ae7da4`, `8debfd7`, `01a6381` (all pushed + admin-web deployed to business.kolis.ca).


## Shipped this session

### LoadQ passenger board overhaul → v1.2.17 (built + submitted, iOS build 26 / Android vc 57)
All 9 requested items. Commits on `ship-loadq-1.2.6` (pushed): `f9ac6a4`, `c49b01f`, `0fda3b6`, `8117dc0`.
Backend migration **`supabase/migrations/20260804210000_loadq_passenger_board_upgrades.sql`** (applied to prod via MCP; verified end-to-end in a rollback txn).
1. City/zone selector — busiest zone default; in-city zones reservable; other cities view-only. Header matches driver app (zone name · city ▾ · Live·N in queue · date · msg icon).
2. Reservation hold 10 → **15 min** (`loadq_reserve_seat`).
3. Android bottom-nav safe-area inset fix; seats use `components/SeatSvg`.
4. My Trip: call driver, directions to pickup zone, add/decrease seats (`loadq_update_reservation_seats`), held-seat glyphs.
5. Alerts feed (was stub): `reservation_sent` / `driver_accepted` (trips trigger) + local 7-min & 3-min hold reminders (`PushAPI.scheduleLocal`).
6. Tap driver → profile modal; car-card ▾ expander.
7. Zone map (`components/ZoneMap`) on the board.
8. Module cache (cache-first paint, no reload on tab switch); driver **Interac** (email/phone) shown on My Trip once boarded + driver enters it in Profile.
9. Driver-style header (see #1).
Key files: `app/(passenger)/board.tsx`, `my-trip.tsx`, `alerts.tsx`; `services/passengerBoard.ts`, `services/push.ts`, `services/alerts.ts`; `app/(app)/profile.tsx` (driver Interac); `components/PassengerBottomNav.tsx`; `constants/i18n.ts` (+ FR/EN), `constants/types.ts`.
New RPCs: `loadq_city_zones(region)`, `loadq_update_reservation_seats(trip,seats)`; extended `loadq_my_trip`; `drivers.interac_email/interac_phone`.

### Kolis → v1.1.7 (built + submitted both platforms earlier this session)
Branch `ship-kolis-1.1.0`, latest `6778638` (sender/driver-only label access). No new Kolis changes since.

### LoadQ admin web console → live at admin.loadq.ca
`admin-web/` (Next.js, Netlify site **loadq-admin**, id `74c65dc0-8ee8-4884-a688-eb42d5eb3ea5`). Deploy: `./deploy-admin-web.sh`.
Zones + queue management, admin OTP login. **DNS TODO:** CNAME `admin` currently points to `kolis-business.netlify.app` — repoint to `loadq-admin.netlify.app` (works today via Host routing, but should be corrected).

### Supabase security — all advisors clear
RLS enabled on 11 server-only tables; 7 functions' search_path pinned; leaked-password protection ON; anonymous sign-ins OFF; orphan anon user deleted.

### Passenger announcement — SENT to all 111 passengers (email)
Edge fn `loadq-broadcast` (guarded x-kolis-secret, Resend batch, localized FR/EN, CASL unsubscribe). Delivery verified (`loadq.ca` verified sender; test showed delivered+opened → check **Promotions/Spam** tab).
Flyer: `~/Desktop/loadq-update-flyer.png`. Diagnostic fn `loadq-resend-check` also deployed.
**Per-recipient status was NOT stored** (no tags/IDs; webhook only logs tagged campaigns). View in the **Resend dashboard → Emails**. To fix for next time: tag + store Resend IDs in the broadcast fn.

## Open items / next
- **Store review:** iOS 1.2.17 (build 26) is processing in App Store Connect → submit the version for review there. Android 1.2.17 in Play production review. (Kolis 1.1.7 same stage.) Authoritative "live" signal = Apple/Google email; scheduled checker will ping.
- **admin.loadq.ca DNS:** repoint CNAME to `loadq-admin.netlify.app`.
- **Gmail drafts:** send/keep the Gilad Parking letter to **`inquiries@giladparking.com`** (Attn: Kate Tilon) — the correct verified address; DELETE the 3 stale drafts (`ktilona@gillardparking.com`, `ktilon@gillardparking.com`, `ktilon@giladparking.com`).
- Optional: instrument `loadq-broadcast` for per-recipient tracking; SMS follow-up to passengers (not sent — email-only was chosen).
- Optional cleanup: remove diagnostic edge fns (`loadq-resend-check`).

## Gotchas
- Notify/internal edge fns must deploy `verify_jwt=false`.
- Mobile `tsconfig.json` excludes `admin-web` (Next.js `@/*` paths break RN tsc). Pre-existing tsc errors: Deno edge fns + `constants/vehicles.ts` (not from this work).
- EAS `production` auto-increments build numbers; bump `expo.version` when App Store rejects a re-submit of an already-submitted version.

## Consolidated dev handoff — status (2026-08-08)
All 6 items from the consolidated handoff are now DONE:
1. ✅ LoadQ passenger Board wired — v1.2.17 (15-min hold, city picker, alerts, map).
2. ✅ LoadQ driver **Deliveries tab** — `app/(app)/deliveries.tsx` + BottomNav tab, surfacing `KolisParcels` (available/accept/decline/carrying). LoadQ `4803736`.
3. ✅ Admin board slots — `pickup_slot`/`dropoff_slot` columns + detail card, deployed to business.kolis.ca. Kolis `dd60bac`.
4. ✅ Shipment creation require contacts — sender + recipient email & phone. Kolis `dd60bac`.
5. ✅ Checkout **Interac option** — `confirm.tsx` Card/Interac selector; Interac creates parcel `payment_method='interac'`/`payment_status='pending'`, calls `kolis-interac-request` (SMS+email invoice), gated until `kolis_admin_mark_paid`. Kolis `83cc26b`.
6. ✅ Car UI **colour + year** — board/my-trip RPCs emit `v.color`/`v.year` (migration `20260808100000`); `vehicleLabel()` renders "year make model · colour" on passenger board, my-trip, driver queue chips. LoadQ `4ff8f90`.

**Not yet in a store build:** #2/#6 (LoadQ) and #5 (Kolis) are pushed but need new builds — bump `expo.version` and cut when ready. admin-web (#3) already deployed.

## Release notes — "What's New" (paste into App Store Connect / Play Console)

### Kolis 1.1.8
**English**
> • New destination: Halifax
> • Smoother shipping — sender & recipient email and phone are now required so we can send your drop-off scheduling link by text and email
> • Edit your pickup address right on the shipping page, with address autocomplete
> • Choosing a hub now shows its drop-off hours alongside the nearby meeting points

**Français (FR-CA)**
> • Nouvelle destination : Halifax
> • Expédition simplifiée — le courriel et le téléphone de l'expéditeur et du destinataire sont maintenant requis pour vous envoyer votre lien de planification du dépôt par texto et courriel
> • Modifiez votre adresse de ramassage directement sur la page d'expédition, avec saisie automatique
> • Le choix d'un point relais affiche maintenant ses heures de dépôt à côté des points de rencontre à proximité

### LoadQ 1.2.17
**English**
> • Pick your pickup zone by city — see the busiest one first and reserve from any zone in your city
> • Seats are now held for 15 minutes
> • My Trip: call your driver, get directions to the pickup point, and add or remove seats after booking
> • New alerts when your reservation is sent, when the driver confirms you, and before your hold expires
> • Live map of your pickup zone, tap a driver to view their profile, and pay by Interac once confirmed
> • Faster, smoother board with a cleaner layout

**Français (FR-CA)**
> • Choisissez votre point de départ par ville — le plus achalandé s'affiche en premier et vous pouvez réserver dans n'importe quel point de votre ville
> • Les places sont maintenant retenues 15 minutes
> • Mon trajet : appelez votre conducteur, obtenez l'itinéraire vers le point de départ et ajoutez ou retirez des places après la réservation
> • Nouvelles alertes lorsque votre réservation est envoyée, lorsque le conducteur vous confirme et avant l'expiration de votre réservation
> • Carte en direct de votre point de départ, appuyez sur un conducteur pour voir son profil, et payez par virement Interac une fois confirmé
> • File plus rapide et plus fluide, avec une mise en page épurée

## Addendum — Kolis HUB drop-off scheduling (backend LIVE — ✅ both app tasks DONE, Kolis `dd60bac`)

> **UPDATE 2026-08-06:** Both app tasks are implemented + pushed to `ship-kolis-1.1.0` (`dd60bac`). Not yet in a Kolis store build — cut one when ready (bump `expo.version` past 1.1.7).
> - Task 1 done: parcels **list** has a "Drop-off / Delivery" column; parcel **detail** has a "HUB scheduling" card. `kolis_admin_parcel` RPC extended to return the two slots (migration `20260806090000`).
> - Task 2 done: consumer `app/(app)/details.tsx` now requires **recipient email** (+phone) AND **sender email** (editable, saved to `kolis_profiles` via `ProfileAPI.save`) + validates sender phone. Business `/shipper/create` already required recipient email+phone (sender = org).
> - Extra (`5940a84`): sender **pickup address** now shown + editable on the expedition page (door mode) with country-aware Google Places autocomplete (`AddressFields`); required for door shipments.
> - Extra (`8668e4e`): HUB select shows **drop-off hours** (`kolis_hubs.hours`, populated) alongside the meeting-point list in `NearbyPicker` + the selected-hub card. Admin persistence: hub name + `pickup_slot`/`dropoff_slot` already surface on the admin parcels list/detail.
> - Extra (`ebbca8b`): **Halifax** added as a destination with a **+30% price premium**. App: `constants/cities.ts` (picker) + `constants/pricing.ts` (Maritimes distances + `isHalifax()` 30% surcharge in `estimatePrice`). DB (migration `20260806120000`): `kolis_route_km` Halifax distances + `kolis_estimate_price_cents` 30% surcharge (`kolis_org_price_cents` inherits via fallback). Region/province already map `halifax`→NS; admin-web already had Halifax→NS. Verified: Halifax–Ottawa \$202 (+30%), Ottawa–Montréal \$30 unchanged.
>
> **SHIPPED 2026-08-06:** Kolis **v1.1.8** built + submitted both platforms (iOS build 24 / Android vc 24) — builds + submissions all FINISHED. (Earlier Halifax-less 1.1.8 builds were cancelled before submitting.) **admin-web deployed live** to business.kolis.ca (parcel-board scheduling columns). Store review pending (iOS: submit version in ASC once processed; Android: in Play review).
> Kolis commits on `ship-kolis-1.1.0`: `dd60bac`, `5940a84`, `8668e4e`, `7fadd61` (1.1.8 bump), `ebbca8b` (Halifax). All pushed.


Repo for both tasks: **~/Desktop/Kolis** (branch `ship-kolis-1.1.0`). Project `kzjptcpjpwlxfofzhyku`.

### Live on the backend (no app work needed)
- Trigger **`kolis_hub_invite_ai`** on `kolis_parcels`: when a HUB parcel's `payment_status` enters `authorized`/`paid` (escrowed), fires edge fn **`kolis-hub-invite`** (exception-safe — can't block writes).
- **`kolis-hub-invite`**: creates two personalized `kolis_schedule_links` (sender + receiver) and sends each the link by **BOTH SMS and email** (bilingual EN/FR), + copies dispatch (613-862-2639). Idempotent.
- Picker: edge fn **`kolis-schedule`** (token-gated) + page `https://kolis-schedule-board.netlify.app/?t=<token>`. Sender = drop-off window + hub spot (4-hour same-day lead); Receiver = delivery window (no lead).
- Writeback on selection: sender → `kolis_parcels.pickup_slot` (`"hub - spot - date - time"`); receiver → `kolis_parcels.dropoff_slot` (`"date - time"`).

### TASK 1 — Admin parcels screen: show the two new fields
`kolis_admin_parcels(p_filter, p_search)` now RETURNS **`pickup_slot`** and **`dropoff_slot`**. Display them on the parcel row/detail:
- `pickup_slot` = sender's hub + drop-off time · `dropoff_slot` = receiver's delivery time.
- Files: `admin-web/app/admin/parcels/page.tsx` (list) + `admin-web/app/admin/parcels/[id]/page.tsx` (detail). (These are the Kolis admin-web files edited earlier for the payout-card button.)

### TASK 2 — Shipment-creation forms: require sender AND recipient EMAIL + PHONE
Both channels are used by the scheduling invites (SMS + email), so both must be collected + validated as required:
- **Business:** `admin-web/app/shipper/create/page.tsx`.
- **Consumer app:** the Kolis send flow — `app/(app)/send.tsx` / `app/(app)/details.tsx` (recipient email/phone already exist as fields; make them required; ensure sender contact captured too).

Backend contracts are frozen; the app just needs to render the 2 fields and enforce the 4 required contact fields.
