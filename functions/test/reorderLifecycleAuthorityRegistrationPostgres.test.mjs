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
const { seedTenantPolicy } = require("../lib/adminPolicy/seed/policySeed.js");

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
  // The fence is SHARED: the eight reorder keys are a subset of it, and the only other members are the keys other
  // accepted rulings registered with no default grant -- DQ-011: workOrder.parts.plan (migration 1763856000000, lane L2)
  // and DQ-036(b): inventory.serializedAsset.acquire (migration 1764129600000, lane L3), both declared on legacy Roles
  // and granted only through Administration. An unexpected member fails here.
  for (const k of KEYS) assert.ok(ADMINISTRATION_GRANT_ONLY_CAPABILITIES.has(k), `${k} must be fenced`);
  assert.deepEqual([...ADMINISTRATION_GRANT_ONLY_CAPABILITIES].sort(),
    [...KEYS, "workOrder.parts.plan", "inventory.serializedAsset.acquire"].sort());
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

  // THE RULED CONFIGURATION (Controller ruling "CATALOG + REORDER ACTIVATION -- GO", 2026-09-28), applied the way the
  // window applies it: through the CURRENT Administration command, one grant at a time. Never a migration.
  const RULED = Object.freeze([
    ["partsManager", "reorderRequest", "read"], ["partsManager", "reorderRequest", "approve"],
    ["partsManager", "reorderRequest", "reject"], ["partsManager", "reorderRequest", "cancel"],
    ["partsManager", "purchaseOrder", "void"],
    ["partsAssociate", "reorderRequest", "read"], ["partsAssociate", "reorderRequest", "startPurchasing"],
    ["partsAssociate", "reorderRequest", "postPurchasingUpdate"], ["partsAssociate", "reorderRequest", "recordPurchaseOrder"],
    ["partsAssociate", "reorderRequest", "markReceived"],
  ]);
  const cells = async () => (await q(
    `SELECT r.key role, c.key cap FROM eos_policy.role_capabilities rc
       JOIN eos_policy.roles r ON r.id = rc.role_id JOIN eos_policy.capabilities c ON c.id = rc.capability_id
      WHERE rc.tenant_id = $1 AND (c.key = ANY($2) OR c.key = 'reorder.request.read') ORDER BY 1, 2`,
    [tenant.id, KEYS])).rows.map((x) => `${x.role}/${x.cap}`);

  await t.test("the RULED Administration grants apply through Administration, and yield exactly the ruled cells", async () => {
    const before = await cells();
    for (const [roleKey, objectKey, actionKey] of RULED) {
      const r = await executeAdminOperation({ repo }, {
        caller: { externalSubject: "admin-rr", identityProvider: "firebase" }, operation: "grantObjectActionToRole",
        input: { objectKey, actionKey, roleKey, reason: "Controller ruling 2026-09-28: ruled Reorder lifecycle grant" },
        requestId: `r-${roleKey}-${actionKey}`,
      });
      // An already-held read is fine (it may be a pre-existing default); every other result must be a grant.
      assert.ok(r.ok === true || (actionKey === "read" && /already/i.test(JSON.stringify(r))), `${roleKey} ${objectKey}.${actionKey}: ${JSON.stringify(r)}`);
    }
    const after = await cells();
    const newlyHeldAmongTheEight = after.filter((c) => KEYS.some((k) => c.endsWith(`/${k}`))).sort();
    assert.deepEqual(newlyHeldAmongTheEight, [
      "partsAssociate/reorder.request.markReceived", "partsAssociate/reorder.request.postPurchasingUpdate",
      "partsAssociate/reorder.request.recordPurchaseOrder", "partsAssociate/reorder.request.startPurchasing",
      "partsManager/reorder.purchaseOrder.void", "partsManager/reorder.request.approve",
      "partsManager/reorder.request.cancel", "partsManager/reorder.request.reject",
    ], "exactly the eight ruled cells of the eight lifecycle keys, and no other holder");
    for (const role of ["partsManager", "partsAssociate"]) assert.ok(after.includes(`${role}/reorder.request.read`), `${role} reads`);
    // Void is the Parts Manager's management exception: NOT the Associate's, and NOT Owner's by legacy inheritance.
    assert.equal(after.some((c) => c === "partsAssociate/reorder.purchaseOrder.void" || c.startsWith("owner/")), false);
    // Nothing else moved: every cell present before is still present.
    for (const c of before) assert.ok(after.includes(c), `${c} was removed`);
  });

  await t.test("after the ruled grants, a catalog reconcile still imports nothing and disputes nothing", async () => {
    const heldBefore = await heldCount();
    const report = await reconcileInventoryCapabilityGrants(pool, { tenantId: tenant.id, apply: true, actor: OP, capabilityKeys: KEYS });
    assert.equal(report.appliedAdditions, 0);
    assert.equal(await heldCount(), heldBefore);
    const pmApprove = report.rows.find((r) => r.roleKey === "partsManager" && r.capabilityKey === "reorder.request.approve");
    if (pmApprove) assert.equal(pmApprove.status, "ALREADY_GRANTED");
  });
});

// PR #2000 CI: the down migration must account for governed DRAFT workflow actions the seed bound to these keys.
// The policy seed binds a workflow action's capability only when the key is KNOWN, so once 1763337600000 registers the
// eight, the seeded (DRAFT) Parts/Purchasing workflow references them through workflow_actions.capability_key (FK). The
// down unbinds those DRAFTS -- returning them to exactly what the seed produces when the keys are unknown -- and refuses
// while a PUBLISHED workflow action is bound, as it refuses while any grant references them.
test("down migration: DRAFT workflow bindings are unbound, a PUBLISHED binding refuses, up restores", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `rr_down_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  const migrate = (args) => execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", ...args, "--migrations-dir", "migrations"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  migrate(["up"]);
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 4 });
  const q = (s, v = []) => pool.query(s, v);
  const repo = new PostgresPolicyRepository(pool);
  const { tenant } = await bootstrapTenant(repo, { key: "rr-down", name: "RR down", actorUid: OP });
  await seedTenantPolicy(repo, tenant.id, OP);

  const bound = async (status) => Number((await q(
    `SELECT count(*)::int n FROM eos_policy.workflow_actions a JOIN eos_policy.workflow_versions v ON v.id = a.workflow_version_id
      WHERE a.capability_key = ANY($1) AND ($2::text IS NULL OR v.status::text = $2)`, [KEYS, status])).rows[0].n);
  const registered = async () => Number((await q(`SELECT count(*)::int n FROM eos_policy.capabilities WHERE key = ANY($1)`, [KEYS])).rows[0].n);
  // Peel every migration newer than this one, so a single `down` reverses exactly 1763337600000.
  const peelTo = async (prefix) => {
    for (;;) {
      const newest = (await q("SELECT name FROM pgmigrations ORDER BY id DESC LIMIT 1")).rows[0]?.name;
      if (!newest || newest.startsWith(prefix) || newest < prefix) return;
      migrate(["down"]);
    }
  };

  await t.test("precondition: the seed bound DRAFT workflow actions to the eight", async () => {
    assert.ok(await bound("DRAFT") > 0, "the seeded Parts/Purchasing workflow binds the lifecycle keys");
    assert.equal(await bound(null), await bound("DRAFT"), "and every such binding is a DRAFT");
  });

  await peelTo("1763337600000_");

  await t.test("with only DRAFT bindings, the down unbinds them and removes exactly the eight", async () => {
    const draftActionsBefore = Number((await q(`SELECT count(*)::int n FROM eos_policy.workflow_actions`)).rows[0].n);
    migrate(["down"]);
    assert.equal(await registered(), 0);
    assert.equal(await bound(null), 0);
    assert.equal(Number((await q(`SELECT count(*)::int n FROM eos_policy.workflow_actions`)).rows[0].n), draftActionsBefore,
      "no workflow action is deleted -- only its binding is cleared");
  });

  let draftActionId;
  await t.test("up restores the eight registrations", async () => {
    migrate(["up"]);
    assert.equal(await registered(), 8);
  });

  // Published versions are immutable (DRAFT -> PUBLISHED is one-way), so this runs last, on a throwaway database.
  await t.test("a PUBLISHED workflow action bound to one of the eight refuses the down; nothing is removed", async () => {
    draftActionId = (await q(
      `SELECT a.id, a.workflow_version_id FROM eos_policy.workflow_actions a JOIN eos_policy.workflow_versions v
         ON v.id = a.workflow_version_id WHERE v.status = 'DRAFT' AND a.key = 'approve' LIMIT 1`)).rows[0];
    assert.ok(draftActionId, "the seeded Parts/Purchasing DRAFT has an approve action");
    await q(`UPDATE eos_policy.workflow_actions SET capability_key = 'reorder.request.approve' WHERE id = $1`, [draftActionId.id]);
    await q(`UPDATE eos_policy.workflow_versions SET status = 'PUBLISHED', published_at = now(), published_by = $2 WHERE id = $1`,
      [draftActionId.workflow_version_id, OP]);
    await peelTo("1763337600000_");
    assert.throws(() => migrate(["down"]), /published workflow action\(s\) are bound to them/);
    assert.equal(await registered(), 8, "the capabilities are still registered");
    assert.equal(await bound("PUBLISHED"), 1, "the published binding is untouched");
  });
});
