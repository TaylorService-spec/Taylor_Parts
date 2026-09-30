#!/usr/bin/env node
// THE PINNED WORK ORDER QUARANTINE -- the activation-window step (Owner DECISION 3, 2026-09-30).
//
// PLAN (default): read the thirteen pinned Work Orders and their current pin fingerprints and print what --apply would
// write. Nothing is written.
// --apply: in ONE transaction, verify all thirteen against their pins (planProtectedWorkOrders refuses any unpinned
// row, missing row, number or provenance mismatch, or fingerprint mismatch) and insert all thirteen quarantine rows --
// or none. The database re-verifies every pin on insert (work_order_quarantine_verify_pin) and admits only the pinned
// triples (CHECK). Re-running after a successful apply is a no-op that re-verifies the recorded pins.
//
// It never touches eos_ops.work_orders or any dependent row: the thirteen are preserved exactly as they are.
//
// Usage: DATABASE_URL=... node scripts/workOrderQuarantineCli.js <tenant-key> [--apply] --actor <principal-or-operator-id>
"use strict";
const { Client } = require("pg");
const {
  PROTECTED_WORK_ORDERS, PROTECTED_CLASSIFICATION, QUARANTINE_REASON, QUARANTINE_PROVENANCE, planProtectedWorkOrders,
} = require("../lib/eosOps/migration/workOrderProtectedRows.js");

function parseArgs(argv) {
  const args = { tenantKey: null, apply: false, actor: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--actor") args.actor = argv[++i] ?? null;
    else if (!args.tenantKey) args.tenantKey = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (!args.tenantKey || !/^[A-Za-z0-9._-]{1,100}$/.test(args.tenantKey)) throw new Error("a tenant key is required");
  if (!args.actor || !/^[A-Za-z0-9._:@-]{1,200}$/.test(args.actor)) throw new Error("--actor <who applies the quarantine> is required");
  return args;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`usage: node scripts/workOrderQuarantineCli.js <tenant-key> [--apply] --actor <id> (${err.message})`);
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(2);
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(args.apply ? "BEGIN" : "BEGIN TRANSACTION READ ONLY");
    const tenant = await client.query("SELECT id FROM eos_policy.tenants WHERE key = $1", [args.tenantKey]);
    if (tenant.rows.length !== 1) throw new Error(`tenant ${args.tenantKey} not found`);
    const tenantId = tenant.rows[0].id;
    const rows = await client.query(
      `SELECT w.id, w.work_order_number, w.status::text AS status, w.provenance::text AS provenance,
              eos_ops.work_order_pin_fingerprint(w) AS fingerprint
         FROM eos_ops.work_orders w
        WHERE w.tenant_id = $1 AND (w.id = ANY($2::text[]) OR w.work_order_number = ANY($3::text[]))
        ${args.apply ? "FOR UPDATE" : ""}`,
      [tenantId, PROTECTED_WORK_ORDERS.map((w) => w.id), PROTECTED_WORK_ORDERS.map((w) => w.number)]);
    // EXACT SET, FAIL CLOSED: any unpinned, missing or changed row refuses the whole step.
    const plan = planProtectedWorkOrders(rows.rows.map((r) => ({
      id: r.id, number: r.work_order_number, status: r.status, provenance: r.provenance, fingerprint: r.fingerprint, dependents: {},
    })));
    const existing = await client.query(
      `SELECT work_order_id, fingerprint FROM eos_ops.work_order_quarantine WHERE tenant_id = $1`, [tenantId]);
    const already = new Map(existing.rows.map((r) => [r.work_order_id, r.fingerprint]));
    for (const [id, fp] of already) {
      const pin = PROTECTED_WORK_ORDERS.find((w) => w.id === id);
      if (!pin || pin.fingerprint !== fp) throw new Error(`recorded quarantine row ${id} does not match its pin`);
    }
    const toWrite = plan.rows.filter((r) => !already.has(r.id));
    if (args.apply) {
      for (const r of toWrite) {
        await client.query(
          `INSERT INTO eos_ops.work_order_quarantine
             (tenant_id, work_order_id, work_order_number, fingerprint, classification, reason, provenance, quarantined_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [tenantId, r.id, r.number, r.fingerprint, PROTECTED_CLASSIFICATION[r.id], QUARANTINE_REASON, QUARANTINE_PROVENANCE, args.actor]);
      }
      await client.query(
        `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, reason)
         SELECT 'aud_woq_' || md5(random()::text || clock_timestamp()::text), $1, 'quarantineWorkOrders', $2, 'workOrderQuarantine', $1,
                $3::jsonb, $4::jsonb, $5
          WHERE $6::int > 0`,
        [tenantId, args.actor, JSON.stringify({ quarantined: [...already.keys()].sort() }),
         JSON.stringify({ quarantined: plan.rows.map((r) => r.id).sort() }), QUARANTINE_REASON, toWrite.length]);
      await client.query("COMMIT");
    } else {
      await client.query("ROLLBACK");
    }
    console.log(`WO_QUARANTINE ${JSON.stringify({
      mode: args.apply ? "APPLY" : "PLAN", tenantId, pinned: plan.rows.length,
      alreadyQuarantined: already.size, written: args.apply ? toWrite.length : 0, wouldWrite: args.apply ? 0 : toWrite.length,
      rows: plan.rows.map((r) => ({ id: r.id, number: r.number, status: r.status, fingerprint: r.fingerprint })),
    })}`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.log(`FAILED: ${String(err.code ? `${err.code}: ` : "")}${String(err.message).replace(/postgres(ql)?:\/\/\S+/g, "<redacted>")}`);
    process.exitCode = 3;
  } finally {
    await client.end();
  }
}

main();
