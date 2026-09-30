#!/usr/bin/env node
// READ-ONLY: plan the thirteen protected PostgreSQL Work Orders (WORK ORDER DOMAIN CUTOVER AUTHORIZATION, 2026-09-30).
//
// Reads the pinned rows, their fingerprints and their dependent-row counts inside a READ ONLY transaction and prints
// the plan from src/eosOps/migration/workOrderProtectedRows.ts. It mutates nothing, and it has no apply mode: any
// destructive step is a separate, Owner-authorized change that must present the fingerprints this prints.
//
// Usage: DATABASE_URL=... node scripts/workOrderProtectedRowsPlanCli.js <tenant-key>
"use strict";
const { Client } = require("pg");
const { PROTECTED_WORK_ORDERS, DEPENDENT_RELATIONS, planProtectedWorkOrders } = require("../lib/eosOps/migration/workOrderProtectedRows.js");

const IDENT = /^[a-z_]+$/;

async function main() {
  const tenantKey = process.argv[2];
  if (!tenantKey || !/^[A-Za-z0-9._-]{1,100}$/.test(tenantKey)) {
    console.error("usage: node scripts/workOrderProtectedRowsPlanCli.js <tenant-key>");
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(2);
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query("SET LOCAL TimeZone = 'UTC'");
    const tenant = await client.query("SELECT id FROM eos_policy.tenants WHERE key = $1", [tenantKey]);
    if (tenant.rows.length !== 1) throw new Error(`tenant ${tenantKey} not found`);
    const tenantId = tenant.rows[0].id;
    const ids = PROTECTED_WORK_ORDERS.map((w) => w.id);
    const rows = await client.query(
      `SELECT id, work_order_number, status::text AS status, provenance::text AS provenance,
              encode(sha256(convert_to(to_jsonb(w)::text, 'UTF8')), 'hex') AS fingerprint
         FROM eos_ops.work_orders w WHERE tenant_id = $1 AND (id = ANY($2::text[]) OR work_order_number = ANY($3::text[]))`,
      [tenantId, ids, PROTECTED_WORK_ORDERS.map((w) => w.number)]);
    const observed = [];
    for (const r of rows.rows) {
      const dependents = {};
      for (const { table } of DEPENDENT_RELATIONS) {
        if (!IDENT.test(table)) throw new Error(`unexpected relation name ${table}`);
        const exists = await client.query("SELECT to_regclass($1) AS t", [`eos_ops.${table}`]);
        dependents[table] = exists.rows[0].t === null ? 0 : Number((await client.query(
          `SELECT count(*)::int AS n FROM eos_ops.${table} WHERE tenant_id = $1 AND work_order_id = $2`, [tenantId, r.id])).rows[0].n);
      }
      observed.push({ id: r.id, number: r.work_order_number, status: r.status, provenance: r.provenance, fingerprint: r.fingerprint, dependents });
    }
    await client.query("ROLLBACK");
    console.log(`WO_PROTECTED_PLAN ${JSON.stringify(planProtectedWorkOrders(observed))}`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.log(`FAILED: ${String(err.message).replace(/postgres(ql)?:\/\/\S+/g, "<redacted>")}`);
    process.exitCode = 3;
  } finally {
    await client.end();
  }
}

main();
