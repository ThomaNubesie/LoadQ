// Seeds Supabase with fake drivers, vehicles, and queue_entries for live demos.
// Idempotent: re-running re-uses existing demo users if their email already exists.
//
// Usage:
//   node scripts/seed-demo.mjs
//
// Requires SUPABASE_SERVICE_ROLE_KEY in .env (server-only, bypasses RLS).

import { config as dotenv } from "dotenv";
dotenv({ path: ".env" });
dotenv({ path: ".env.local", override: true });
import {
  DEMO_EMAIL_PREFIX, DEMO_EMAIL_DOMAIN,
  FIRST_NAMES, LAST_NAMES, ZONE_ALLOCATION, VEHICLE_POOL,
  randomFrom, randomPlate, randomPhone, buildAdminClient,
} from "./demo-data.mjs";

const admin = await buildAdminClient();

// Build flat driver list with zone targets baked in
function plan() {
  const drivers = [];
  let i = 0;
  for (const [zoneId, count] of Object.entries(ZONE_ALLOCATION)) {
    for (let n = 0; n < count; n++) {
      const first = FIRST_NAMES[i % FIRST_NAMES.length];
      const last  = LAST_NAMES[(i * 7) % LAST_NAMES.length];
      drivers.push({
        index:     i,
        email:     `${DEMO_EMAIL_PREFIX}${String(i).padStart(3, "0")}@${DEMO_EMAIL_DOMAIN}`,
        full_name: `${first} ${last}`,
        phone:     randomPhone(i),
        zoneId,
        vehicle:   VEHICLE_POOL[i % VEHICLE_POOL.length],
      });
      i++;
    }
  }
  return drivers;
}

async function upsertAuthUser(d) {
  // listUsers is paginated — search by email via query param
  const { data: list, error: lErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (lErr) throw lErr;
  const existing = list.users.find(u => u.email === d.email);
  if (existing) return existing.id;

  const { data, error } = await admin.auth.admin.createUser({
    email: d.email,
    email_confirm: true,
    user_metadata: { demo: true, name: d.full_name },
  });
  if (error) throw new Error(`createUser ${d.email}: ${error.message}`);
  return data.user.id;
}

async function upsertDriver(authId, d) {
  const { error } = await admin.from("drivers").upsert({
    id:                  authId,
    full_name:           d.full_name,
    phone:               d.phone,
    subscription_status: "active",
    subscription_plan:   "monthly",
    trust_score:         80 + Math.floor(Math.random() * 20),
  }, { onConflict: "id" });
  if (error) throw new Error(`upsert driver ${d.email}: ${error.message}`);
}

async function upsertVehicle(authId, d) {
  // Check if this driver already has a vehicle (re-runs)
  const { data: existing } = await admin.from("vehicles").select("id").eq("driver_id", authId).limit(1);
  if (existing && existing.length) return existing[0].id;

  const v = d.vehicle;
  const { data, error } = await admin.from("vehicles").insert({
    driver_id: authId,
    type:      v.type,
    make:      v.make,
    model:     v.model,
    year:      2018 + Math.floor(Math.random() * 7),
    plate:     randomPlate(),
    seats:     v.seats,
    is_active: true,
  }).select().single();
  if (error) throw new Error(`insert vehicle ${d.email}: ${error.message}`);
  return data.id;
}

async function clearDemoQueueEntries() {
  // Wipe demo queue entries before re-seeding so positions are clean
  const { data: demoDrivers } = await admin
    .from("drivers").select("id, full_name").or(
      // we can't filter by auth.users.email here without a join; instead
      // pull all entries authored by users whose ids we'll match below
      "trust_score.gte.0"
    );
  // Just delete queue_entries belonging to our seeded drivers (we'll re-create them)
  // We fetch the demo ids from auth instead:
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const demoIds = list.users.filter(u => u.email?.startsWith(DEMO_EMAIL_PREFIX)).map(u => u.id);
  if (!demoIds.length) return;
  const { error } = await admin.from("queue_entries").delete().in("driver_id", demoIds);
  if (error) console.warn("warn clearing demo queue:", error.message);
}

async function queueDriver(zoneId, position, authId, vehicleId, status) {
  const row = {
    zone_id:       zoneId,
    driver_id:     authId,
    vehicle_id:    vehicleId,
    position,
    status,
    seats_boarded: 0,
    seats_locked:  0,
  };
  if (status === "loading") {
    row.load_start_at = new Date().toISOString();
    row.load_deadline = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    row.seats_boarded = Math.floor(Math.random() * 3); // 0–2 already on board
  }
  const { error } = await admin.from("queue_entries").insert(row);
  if (error) throw new Error(`queue insert ${zoneId} pos ${position}: ${error.message}`);
}

async function main() {
  console.log("seeding demo data...");
  const drivers = plan();
  console.log(`planning ${drivers.length} drivers across ${Object.keys(ZONE_ALLOCATION).length} zones`);

  // 1. Create auth + drivers + vehicles
  const seeded = [];
  for (const d of drivers) {
    const authId = await upsertAuthUser(d);
    await upsertDriver(authId, d);
    const vehicleId = await upsertVehicle(authId, d);
    seeded.push({ ...d, authId, vehicleId });
    process.stdout.write(".");
  }
  console.log(`\n  ${seeded.length} drivers + vehicles ready`);

  // 2. Clear old queue entries from previous runs
  await clearDemoQueueEntries();

  // 3. Insert queue_entries — first per zone is "loading", rest are "waiting"
  const byZone = {};
  for (const d of seeded) (byZone[d.zoneId] ||= []).push(d);

  let total = 0;
  for (const [zoneId, list] of Object.entries(byZone)) {
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      const status = i === 0 ? "loading" : "waiting";
      await queueDriver(zoneId, i + 1, d.authId, d.vehicleId, status);
      total++;
    }
    console.log(`  ${zoneId}: ${list.length} in queue (1 loading, ${list.length - 1} waiting)`);
  }
  console.log(`\nseed complete: ${total} queue entries`);
}

main().catch(e => { console.error("\nERROR:", e.message); process.exit(1); });
