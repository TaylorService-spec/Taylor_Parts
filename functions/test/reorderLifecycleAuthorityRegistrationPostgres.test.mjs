// THE REORDER LIFECYCLE AUTHORITY REGISTRATION (Controller ruling "REORDER LIFECYCLE AUTHORITY -- GO", 2026-09-28),
// against a real postgres:16.
//
// What is proven here:
//   1. Migration 1763337600000 registers EXACTLY the eight lifecycle capabilities in the current Administration model
//      (object_key / action_key / action_kind / display_label), and grants none of them to anyone.
//   2. NO LEGACY HOLDER IS IMPORTED. The compiled Role catalog still declares these keys on legacy Roles (admin,
//      dispatcher, technician, ...). A catalog reconcile across EVERY Role -- the path the Sample Company seed and the
//      operator CLI take -- writes zero rows for them and reports each pair ADMINISTRATION_ONLY.
//   3. Administration is the only way in: an Administration grant confers the capability, and the reconcile then
//      reports it ALREADY_GRANTED rather than disputing it.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
const { bootstrapTenant, bootstrapAdministrator } = require("../lib/adminPolicy/tenantBootstrap.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const { ADMINISTRATION_GRANT_ONLY_CAPABILITIES } = require("../lib/adminPolicy/roleCapabilityAdministration.js");
const { reconcileInventoryCapabilityGrants, deriveLegacyRoleGrants } = require("../lib/eosOps/migration/inventoryCapabilityGrantMigration.js");
const life = require("../lib/eosOps/reorderLifecycleCommands.js");

const OP = "operator-reorder-authority";
const REGISTERED = Object.freeze([
  ["reorder.request.approve", "reorderRequest", "approve"],
  ["reorder.request.reject", "reorderRequest", "reject"],
  ["reorder.request.startPurchasing", "reorderRequest", "startPurchasing"],
  ["reorder.request.postPurchasingUpdate", "reorderRequest", "postPurchasingUpdate"],
  ["reorder.request.markReceived", "reorderRequest", "markReceived"],
  ["reorder.request.cancel", "reorderRequest", "cancel"],
  ["reorder.request.recordPurchaseOrder", "reorderRequest", "recordPurchaseOrder"],
  ["reorder.purchaseOrder.void", "purchaseOrder", "void"],
]);
const KEYS = REGISTERED.map(([k]) => k);

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("the eight fence constants are the eight the runtime requires and the migration registers", () => {
  assert.deepEqual([...ADMINISTRATION_GRANT_ONLY_CAPABILITIES].sort(), [...KEYS].sort());
  assert.deepEqual([
    life.REORDER_APPROVE, life.REORDER_REJECT, life.REORDER_START_PURCHASING, life.REORDER_POST_UPDATE,
    life.REORDER_MARK_RECEIVED, life.REORDER_CANCEL, life.REORDER_RECORD_PO,
  ].sort(), KEYS.filter((k) => k !== "reorder.purchaseOrder.void").sort());
  // Approve, reject, cancel and void stay DISTINCT capabilities (ruling 5).
  assert.equal(new Set([life.REORDER_APPROVE, life.REORDER_REJECT, life.REORDER_CANCEL, "reorder.purchaseOrder.void"]).size, 4);
  // recordPurchaseOrder is not the purchase-order create key (ruling 3).
  assert.notEqual(life.REORDER_RECORD_PO, "reorder.purchaseOrder.create");
  // The superseded read keys are not required by the runtime (ruling 6).
  assert.equal(life.REORDER_READ, "reorder.request.read");
});

test("registration without grants; no legacy holder is imported", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `rr_auth_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  const q = (s, v = []) => pool.query(s, v);
  const repo = new PostgresPolicyRepository(pool);

  await t.test("the migration registers exactly the eight, in the current Administration model", async () => {
    const { rows } = await q(`SELECT key, object_key, action_key, action_kind, display_label FROM eos_policy.capabilities WHERE key = ANY($1) ORDER BY key`, [KEYS]);
    assert.deepEqual(rows.map((r) => [r.key, r.object_key, r.action_key]), [...REGISTERED].sort((a, b) => a[0].localeCompare(b[0])));
    for (const r of rows) {
      assert.equal(r.action_kind, "BUSINESS_ACTION", r.key);
      assert.ok(r.display_label && r.display_label.trim() !== "", `${r.key} carries a display label`);
    }
    // The superseded #1961 read keys are NOT recreated by it.
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.capabilities WHERE key = 'reorder.request.read.own'`)).rows[0].n, 0);
  });

  const { tenant } = await bootstrapTenant(repo, { key: "rr-auth", name: "RR", actorUid: OP });
  await bootstrapAdministrator(repo, { tenantId: tenant.id, externalSubject: "admin-rr", performedBy: OP, reason: "boot" });
  const heldCount = async () => Number((await q(
    `SELECT count(*)::int n FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id
      WHERE rc.tenant_id = $1 AND c.key = ANY($2)`, [tenant.id, KEYS])).rows[0].n)
    + Number((await q(
    `SELECT count(*)::int n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id
      WHERE pc.tenant_id = $1 AND c.key = ANY($2)`, [tenant.id, KEYS])).rows[0].n);

  await t.test("a bootstrapped tenant holds none of them", async () => {
    assert.equal(await heldCount(), 0);
  });

  await t.test("a catalog reconcile over EVERY Role imports ZERO legacy holders", async () => {
    // Precondition that makes the proof mean something: the legacy catalog DOES declare these keys.
    const declared = deriveLegacyRoleGrants(KEYS);
    assert.ok(declared.length >= 8, `the legacy catalog declares ${declared.length} pairs -- the fence has something to stop`);
    const report = await reconcileInventoryCapabilityGrants(pool, { tenantId: tenant.id, apply: true, actor: OP, capabilityKeys: KEYS });
    assert.equal(report.appliedAdditions, 0);
    assert.equal(report.proposedAdditions, 0);
    const resolvedRoles = report.rows.filter((r) => r.status !== "UNRESOLVED_ROLE");
    assert.ok(resolvedRoles.length > 0, "at least one declaring Role exists in the tenant");
    for (const r of resolvedRoles) assert.equal(r.status, "ADMINISTRATION_ONLY", `${r.roleKey}/${r.capabilityKey}`);
    assert.equal(await heldCount(), 0);
  });

  await t.test("Administration is the way in, and the reconcile then agrees rather than disputes", async () => {
    const granted = await executeAdminOperation({ repo }, {
      caller: { externalSubject: "admin-rr", identityProvider: "firebase" }, operation: "grantObjectActionToRole",
      input: { objectKey: "reorderRequest", actionKey: "approve", roleKey: "dispatcher", reason: "Administration grant" },
      requestId: "r-grant",
    });
    assert.equal(granted.ok, true, JSON.stringify(granted));
    assert.equal(await heldCount(), 1);
    const report = await reconcileInventoryCapabilityGrants(pool, { tenantId: tenant.id, apply: false, actor: OP, capabilityKeys: KEYS, roleKeys: ["dispatcher"] });
    const cell = report.rows.find((r) => r.capabilityKey === "reorder.request.approve");
    assert.equal(cell.status, "ALREADY_GRANTED");
    assert.equal(report.proposedAdditions, 0, "the other seven stay Administration-only");
  });
});
