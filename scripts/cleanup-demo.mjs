// Removes everything created by seed-demo.mjs.
// Deletes in FK-safe order: queue_entries → vehicles → drivers → auth.users.
//
// Usage:
//   node scripts/cleanup-demo.mjs

import { config as dotenv } from "dotenv";
dotenv({ path: ".env" });
dotenv({ path: ".env.local", override: true });
import { DEMO_EMAIL_PREFIX, buildAdminClient } from "./demo-data.mjs";

const admin = await buildAdminClient();

async function main() {
  const { data: list, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  const demoUsers = list.users.filter(u => u.email?.startsWith(DEMO_EMAIL_PREFIX));
  const ids = demoUsers.map(u => u.id);
  if (!ids.length) { console.log("no demo users found"); return; }
  console.log(`removing ${ids.length} demo drivers and their data...`);

  const { error: qErr, count: qCount } = await admin
    .from("queue_entries").delete({ count: "exact" }).in("driver_id", ids);
  if (qErr) console.warn("queue_entries:", qErr.message);
  else console.log(`  queue_entries:  ${qCount} removed`);

  const { error: vErr, count: vCount } = await admin
    .from("vehicles").delete({ count: "exact" }).in("driver_id", ids);
  if (vErr) console.warn("vehicles:", vErr.message);
  else console.log(`  vehicles:       ${vCount} removed`);

  const { error: dErr, count: dCount } = await admin
    .from("drivers").delete({ count: "exact" }).in("id", ids);
  if (dErr) console.warn("drivers:", dErr.message);
  else console.log(`  drivers:        ${dCount} removed`);

  let aOk = 0;
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (!error) aOk++;
    else console.warn(`  auth.users ${id}: ${error.message}`);
  }
  console.log(`  auth.users:     ${aOk} removed`);
  console.log("cleanup complete");
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
