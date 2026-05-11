// Long-running simulation: every ~6 seconds, picks a random action that
// mutates the live queue so a demo watcher sees realistic activity.
//
// Actions:
//   - board_seat:      a loading driver picks up another passenger (seats_boarded++)
//   - complete_load:   a loading driver finishes, leaves, next waiting promoted to loading
//   - new_join:        a stand-by demo driver joins their assigned zone at the back
//   - call_to_load:    a waiting driver in position 1 is promoted to loading (if no one loading)
//
// Usage:
//   node scripts/simulate-demo.mjs            # 6s tick
//   TICK_MS=2000 node scripts/simulate-demo.mjs
//
// Stops on Ctrl+C. Safe to run alongside the app.

import { config as dotenv } from "dotenv";
dotenv({ path: ".env" });
dotenv({ path: ".env.local", override: true });
import { DEMO_EMAIL_PREFIX, buildAdminClient } from "./demo-data.mjs";

const TICK_MS = Number(process.env.TICK_MS || 6000);
const admin = await buildAdminClient();

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

async function getDemoDriverIds() {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  return list.users.filter(u => u.email?.startsWith(DEMO_EMAIL_PREFIX)).map(u => u.id);
}

async function getQueue(demoIds) {
  const { data, error } = await admin
    .from("queue_entries")
    .select("id, zone_id, driver_id, vehicle_id, position, status, seats_boarded, vehicle:vehicles(seats)")
    .in("driver_id", demoIds);
  if (error) throw error;
  return data || [];
}

// Pick a random action that has eligible candidates
async function tick() {
  const demoIds = await getDemoDriverIds();
  if (!demoIds.length) {
    log("no demo drivers found — run scripts/seed-demo.mjs first");
    return;
  }
  const queue = await getQueue(demoIds);
  const byZone = {};
  for (const e of queue) (byZone[e.zone_id] ||= []).push(e);

  const actions = [];

  // board_seat candidates
  for (const e of queue) {
    if (e.status !== "loading") continue;
    const maxBoard = Math.max((e.vehicle?.seats || 4) - 1, 1); // exclude driver
    if (e.seats_boarded < maxBoard) actions.push({ type: "board_seat", entry: e });
  }

  // complete_load candidates (fully loaded)
  for (const e of queue) {
    if (e.status !== "loading") continue;
    const maxBoard = Math.max((e.vehicle?.seats || 4) - 1, 1);
    if (e.seats_boarded >= Math.max(maxBoard - 1, 1)) actions.push({ type: "complete_load", entry: e });
  }

  // call_to_load candidates (waiting with no one loading in their zone)
  for (const [zid, list] of Object.entries(byZone)) {
    const anyLoading = list.some(e => e.status === "loading");
    if (anyLoading) continue;
    const first = [...list].sort((a, b) => a.position - b.position).find(e => e.status === "waiting");
    if (first) actions.push({ type: "call_to_load", entry: first });
  }

  // new_join candidates: demo drivers not currently in queue
  const inQueue = new Set(queue.map(e => e.driver_id));
  const offDuty = demoIds.filter(id => !inQueue.has(id));
  if (offDuty.length) actions.push({ type: "new_join", driverId: offDuty[Math.floor(Math.random() * offDuty.length)] });

  if (!actions.length) return log("idle (no eligible actions)");

  const weights = { board_seat: 5, complete_load: 1, call_to_load: 2, new_join: 1 };
  const pool = actions.flatMap(a => Array(weights[a.type] || 1).fill(a));
  const action = pool[Math.floor(Math.random() * pool.length)];

  switch (action.type) {
    case "board_seat":   return boardSeat(action.entry);
    case "complete_load": return completeLoad(action.entry);
    case "call_to_load": return callToLoad(action.entry);
    case "new_join":     return newJoin(action.driverId);
  }
}

async function boardSeat(entry) {
  const next = entry.seats_boarded + 1;
  const { error } = await admin
    .from("queue_entries").update({ seats_boarded: next }).eq("id", entry.id);
  if (error) return log(`boardSeat err: ${error.message}`);
  log(`+1 passenger boarded at ${entry.zone_id} (now ${next} seated)`);
}

async function completeLoad(entry) {
  const { error: delErr } = await admin.from("queue_entries").delete().eq("id", entry.id);
  if (delErr) return log(`completeLoad delete err: ${delErr.message}`);
  log(`departed: driver left ${entry.zone_id}, slot freed`);

  // Promote next waiting in this zone to loading
  const { data: next } = await admin
    .from("queue_entries")
    .select("id, position")
    .eq("zone_id", entry.zone_id)
    .eq("status", "waiting")
    .order("position", { ascending: true })
    .limit(1);
  if (next && next.length) {
    await admin.from("queue_entries").update({
      status:        "loading",
      load_start_at: new Date().toISOString(),
      load_deadline: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    }).eq("id", next[0].id);
    log(`  → next driver (pos ${next[0].position}) promoted to loading`);
  }
}

async function callToLoad(entry) {
  const { error } = await admin.from("queue_entries").update({
    status:        "loading",
    load_start_at: new Date().toISOString(),
    load_deadline: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  }).eq("id", entry.id);
  if (error) return log(`callToLoad err: ${error.message}`);
  log(`called to load: driver at pos ${entry.position} in ${entry.zone_id}`);
}

async function newJoin(driverId) {
  // Find this driver's vehicle and pick a random zone
  const { data: v } = await admin.from("vehicles").select("id").eq("driver_id", driverId).limit(1);
  if (!v?.length) return;

  // Pick a zone that already has demo activity (so the driver "comes back")
  const { data: existing } = await admin.from("queue_entries").select("zone_id").limit(50);
  const zones = [...new Set((existing || []).map(e => e.zone_id))];
  if (!zones.length) return;
  const zoneId = zones[Math.floor(Math.random() * zones.length)];

  const { data: last } = await admin
    .from("queue_entries").select("position").eq("zone_id", zoneId)
    .order("position", { ascending: false }).limit(1);
  const position = (last?.[0]?.position || 0) + 1;

  const { error } = await admin.from("queue_entries").insert({
    zone_id:       zoneId,
    driver_id:     driverId,
    vehicle_id:    v[0].id,
    position,
    status:        "waiting",
    seats_boarded: 0,
    seats_locked:  0,
  });
  if (error) return log(`newJoin err: ${error.message}`);
  log(`new driver joined ${zoneId} at position ${position}`);
}

async function loop() {
  log(`simulation started — tick ${TICK_MS}ms (Ctrl+C to stop)`);
  while (true) {
    try { await tick(); }
    catch (e) { log(`tick error: ${e.message}`); }
    await new Promise(r => setTimeout(r, TICK_MS));
  }
}

loop();
