# LoadQ — session handoff (2026-08-05)

Snapshot for continuing on another machine. Pull latest first:
`git pull` on branch **`ship-loadq-1.2.6`** (LoadQ) and **`ship-kolis-1.1.0`** (Kolis at ~/Desktop/Kolis).
Shared Supabase project: **`kzjptcpjpwlxfofzhyku`** (LoadQ + Kolis). EAS user: **thomasderick**.

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

## Addendum — Kolis HUB drop-off scheduling (backend LIVE — ✅ both app tasks DONE, Kolis `dd60bac`)

> **UPDATE 2026-08-06:** Both app tasks are implemented + pushed to `ship-kolis-1.1.0` (`dd60bac`). Not yet in a Kolis store build — cut one when ready (bump `expo.version` past 1.1.7).
> - Task 1 done: parcels **list** has a "Drop-off / Delivery" column; parcel **detail** has a "HUB scheduling" card. `kolis_admin_parcel` RPC extended to return the two slots (migration `20260806090000`).
> - Task 2 done: consumer `app/(app)/details.tsx` now requires **recipient email** (+phone) AND **sender email** (editable, saved to `kolis_profiles` via `ProfileAPI.save`) + validates sender phone. Business `/shipper/create` already required recipient email+phone (sender = org).


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
