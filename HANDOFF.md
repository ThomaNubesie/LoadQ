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
