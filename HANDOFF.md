# LoadQ — session handoff (2026-08-05)

Snapshot for continuing on another machine. Pull latest first:
`git pull` on branch **`ship-loadq-1.2.6`** (LoadQ) and **`ship-kolis-1.1.0`** (Kolis at ~/Desktop/Kolis).
Shared Supabase project: **`kzjptcpjpwlxfofzhyku`** (LoadQ + Kolis). EAS user: **thomasderick**.

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
