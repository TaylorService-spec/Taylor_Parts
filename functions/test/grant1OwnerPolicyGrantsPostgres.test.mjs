// GRANT-1 OWNER POLICY GRANTS -- against a real postgres:16 (Owner policy decisions A1, A2, A3, A4, A7, 2026-10-19; migration 1764670000000). Set POLICY_TEST_DATABASE_URL to run.
//
// The tenant is the baseline-equal service tenant (serviceBaselineTenant: the authority baseline's own rebuild, every migration, the recorded Service authority), so what is proved is
// what the rebuilt authority holds.
//   GRANTS   exactly the 30 new pairs are stamped 'migration:1764670000000'; the capability is registered once as a BUSINESS_ACTION on the part Object; no direct (Principal) grant; Owner gets nothing.
//   SETS     the capability sets of the Roles are READ FROM THE GRANTS (not stated by hand): Parts Manager holds the status key and NOT the Supplier status key; admin holds both; the
//            associates receive; the intake reviewer holds exactly its six; the managers hold equipment.model.manage; the A7 purchasing holders; technicians hold none of the A7 keys.
//   A1       a Parts Manager activates a Part and a Manufacturer but is refused Supplier status; the existing activator (admin) keeps all three; a holder of ONLY the old key (the Supplier
//            status key) is refused Part and Manufacturer status.
//   FENCE    a catalog reconcile reports the technician's declarations as ADMINISTRATION_ONLY and the granted holders ALREADY_GRANTED.
//   RERUN    re-running the migration's UP honours an Administration ADMIN_REVOKED (never re-granted), is otherwise idempotent, and carries the new key to any OTHER current holder of
//            inventory.catalog.activate ("nobody loses part or manufacturer activation").
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");
const require = createRequire(import.meta.url);
const { capabilitiesForRoleKeys } = require("../lib/eosOps/capabilityAuthority.js");
const partWriter = require("../lib/catalogMaster/postgresPartMasterWriter.js");
const mfrWriter = require("../lib/catalogMaster/postgresManufacturerWriter.js");
const { setSupplierStatus } = require("../lib/eosOps/supplierAdministration.js");
const { reconcileInventoryCapabilityGrants } = require("../lib/eosOps/migration/inventoryCapabilityGrantMigration.js");

const TENANT = "t-grant1";
const STAMP = "migration:1764670000000";
const NEW_KEY = "inventory.catalog.part.activate";
const OLD_KEY = "inventory.catalog.activate";
const EVIDENCE = JSON.parse(readFileSync(join(FUNCTIONS_DIR, "..", "docs", "architecture", "grant1-owner-policy-grants.json"), "utf8"));
const NEW_PAIRS = Object.values(EVIDENCE.items).flatMap((i) => i.new).sort();
const A7_KEYS = ["reorder.request.startPurchasing", "reorder.request.postPurchasingUpdate", "reorder.request.recordPurchaseOrder"];
const code = (c) => (e) => { assert.equal(e.code, c, `expected ${c}, got ${e.code}: ${e.message}`); return true; };

test("GRANT-1 Owner policy grants on PostgreSQL: stamped grants, the capability sets they yield, and what real actors can and cannot do", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { pool, q, person } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "grant1" });
  const capsOf = async (...roles) => capabilitiesForRoleKeys(pool, TENANT, roles);

  await t.test("GRANTS: the capability is registered once; exactly the 30 new pairs are stamped by the migration; no direct grant; Owner gains nothing", async () => {
    const reg = (await q(`SELECT key, object_key, action_key, action_kind FROM eos_policy.capabilities WHERE key = $1`, [NEW_KEY])).rows;
    assert.deepEqual(reg, [{ key: NEW_KEY, object_key: "part", action_key: "changeStatus", action_kind: "BUSINESS_ACTION" }]);
    const stamped = (await q(
      `SELECT r.key AS role, c.key AS cap FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id AND r.tenant_id = rc.tenant_id
         JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE rc.tenant_id = $1 AND rc.granted_by = $2`, [TENANT, STAMP])).rows;
    assert.equal(stamped.length, 30);
    assert.deepEqual(stamped.map((r) => `${r.role}|${r.cap}`).sort(), NEW_PAIRS);
    assert.equal(stamped.some((r) => r.role === "owner"), false, "Owner is granted nothing");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id
                            WHERE c.key = $1`, [NEW_KEY])).rows[0].n, 0, "no direct (Principal) grant");
    // The four catalog reads were already held (migration 1761523200000): ON CONFLICT left their stamp alone.
    for (const role of ["warehouseManager", "generalManager", "fieldManager", "partsManager"]) {
      const row = (await q(`SELECT rc.granted_by FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id JOIN eos_policy.capabilities c ON c.id = rc.capability_id
                             WHERE rc.tenant_id = $1 AND r.key = $2 AND c.key = 'inventory.catalog.read'`, [TENANT, role])).rows;
      assert.equal(row.length, 1, role);
      assert.notEqual(row[0].granted_by, STAMP, `${role} inventory.catalog.read keeps its earlier stamp`);
    }
  });

  await t.test("SETS: the Roles hold exactly what the Owner listed -- read from the grants", async () => {
    const pm = await capsOf("partsManager");
    assert.equal(pm.has(NEW_KEY), true);
    assert.equal(pm.has(OLD_KEY), false, "a Parts Manager does NOT gain Supplier status");
    const admin = await capsOf("admin");
    assert.equal(admin.has(NEW_KEY) && admin.has(OLD_KEY), true, "the existing activator keeps both");
    assert.equal((await capsOf("owner")).has(NEW_KEY), false);
    for (const role of ["partsAssociate", "warehouseAssociate"]) {
      const c = await capsOf(role);
      assert.equal(c.has("inventory.stock.receive") && c.has("receivingOrder.record.read"), true, role);
    }
    assert.deepEqual([...(await capsOf("serviceInboundWorkReviewer"))].sort(), [
      "inboundWork.request.accept", "inboundWork.request.attach", "inboundWork.request.decline", "inboundWork.request.read", "workOrder.create", "workOrder.record.read",
    ]);
    for (const role of ["salesManager", "generalManager"]) assert.equal((await capsOf(role)).has("ownership.handoff.correct"), true, role);
    for (const role of ["warehouseManager", "generalManager", "fieldManager", "partsManager"]) {
      const c = await capsOf(role);
      assert.equal(c.has("equipment.model.manage") && c.has("inventory.catalog.read"), true, role);
    }
    for (const role of ["admin", "dispatcher", "purchasingManager"]) {
      const c = await capsOf(role);
      for (const k of A7_KEYS) assert.equal(c.has(k), true, `${role} ${k}`);
    }
    assert.equal((await capsOf("generalManager")).has("reorder.request.postPurchasingUpdate"), true);
    assert.equal((await capsOf("admin")).has("inventory.catalog.alias.read") && (await capsOf("inventoryStockRelocationOperator")).has("inventory.catalog.alias.read"), true);
    const technician = await capsOf("technician");
    for (const k of A7_KEYS) assert.equal(technician.has(k), false, `technician ${k} (Owner: technicians are excluded)`);
  });

  await t.test("A1: a Parts Manager activates a Part and a Manufacturer but is refused Supplier status; the existing activator keeps all three; the old key alone opens neither", async () => {
    const pmPerson = await person("uid-grant1-pm", ["partsManager"]);
    const adminPerson = await person("uid-grant1-admin", ["admin"]);
    const actor = async (who, roles) => ({ tenantId: TENANT, principalId: who.principalId, capabilities: await capsOf(...roles) });
    const pm = await actor(pmPerson, ["partsManager"]);
    const admin = await actor(adminPerson, ["admin"]);
    const oldKeyOnly = { tenantId: TENANT, principalId: pmPerson.principalId, capabilities: new Set([OLD_KEY]) };
    const deps = { pool };

    // The fixtures are created with the manage holder (admin), then moved by the status holders.
    const part = { partId: "G1-PART", internalPartNumber: "G1-PART", name: "Grant-1 part", status: "DRAFT", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED",
      flags: { expiryTracked: false, consumable: false, returnableCore: false }, wholeUnit: false };
    assert.equal((await partWriter.createPart(deps, admin, { part })).version, 1);
    const mfr = await mfrWriter.createManufacturer(deps, admin, { manufacturer: { manufacturerId: "g1-mfr", name: "Grant One Manufacturing" } });

    // The old key alone (what a Supplier-status holder has) opens neither status change.
    await assert.rejects(partWriter.changePartStatus(deps, oldKeyOnly, { partId: "G1-PART", expectedVersion: 1, newStatus: "ACTIVE" }), code("CAPABILITY_REQUIRED"));
    await assert.rejects(mfrWriter.changeManufacturerStatus(deps, oldKeyOnly, { manufacturerId: "g1-mfr", expectedUpdatedAt: mfr.updatedAt, newStatus: "INACTIVE" }), code("CAPABILITY_REQUIRED"));

    // The Parts Manager activates the Part and deactivates the Manufacturer ...
    assert.deepEqual(await partWriter.changePartStatus(deps, pm, { partId: "G1-PART", expectedVersion: 1, newStatus: "ACTIVE" }), { partId: "G1-PART", version: 2, replayed: false });
    const off = await mfrWriter.changeManufacturerStatus(deps, pm, { manufacturerId: "g1-mfr", expectedUpdatedAt: mfr.updatedAt, newStatus: "INACTIVE" });
    assert.equal(off.replayed, false);
    // ... but is refused Supplier status (nothing is read or written first).
    await assert.rejects(setSupplierStatus(deps, pm, { supplierId: "g1-sup", status: "INACTIVE", expectedVersion: 1, reason: "grant-1 proof" }), code("CAPABILITY_MISSING"));

    // The existing activator keeps all three: Part, Manufacturer, and (it passes the capability gate, then finds no such supplier) Supplier.
    assert.deepEqual(await partWriter.changePartStatus(deps, admin, { partId: "G1-PART", expectedVersion: 2, newStatus: "DISCONTINUED" }), { partId: "G1-PART", version: 3, replayed: false });
    assert.equal((await mfrWriter.changeManufacturerStatus(deps, admin, { manufacturerId: "g1-mfr", expectedUpdatedAt: off.updatedAt, newStatus: "ACTIVE" })).replayed, false);
    await assert.rejects(setSupplierStatus(deps, admin, { supplierId: "g1-sup", status: "INACTIVE", expectedVersion: 1, reason: "grant-1 proof" }), code("SUPPLIER_NOT_FOUND"));
  });

  await t.test("FENCE: a catalog reconcile reports the technician's A7 declarations as ADMINISTRATION_ONLY and never proposes them; every granted holder is ALREADY_GRANTED", async () => {
    const report = await reconcileInventoryCapabilityGrants(pool, { tenantId: TENANT, apply: false, actor: "operator-grant1", capabilityKeys: A7_KEYS });
    const technician = report.rows.filter((r) => r.roleKey === "technician");
    assert.equal(technician.length, 3);
    for (const r of technician) assert.equal(r.status, "ADMINISTRATION_ONLY", `${r.roleKey}/${r.capabilityKey}`);
    for (const r of report.rows.filter((x) => x.roleKey !== "technician")) assert.equal(r.status, "ALREADY_GRANTED", `${r.roleKey}/${r.capabilityKey}`);
  });

  await t.test("RERUN: re-running the migration honours an Administration ADMIN_REVOKED, adds nothing else, and carries the new key to any other holder of the old key", async () => {
    const sql = readFileSync(join(FUNCTIONS_DIR, "migrations", "1764670000000_owner-policy-grants.sql"), "utf8");
    const up = sql.slice(0, sql.indexOf("-- Down Migration"));
    const run = async () => { const c = await pool.connect(); try { await c.query(up); } finally { await c.query("RESET search_path").catch(() => undefined); c.release(); } };
    const stamped = async () => (await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities WHERE tenant_id = $1 AND granted_by = $2`, [TENANT, STAMP])).rows[0].n;
    const before = await stamped();

    await run();
    assert.equal(await stamped(), before, "idempotent: a second run writes nothing");

    // An Administration revoke of (partsAssociate, inventory.stock.receive): the row is removed and a current ADMIN_REVOKED decision stands -- the migration must not re-grant it.
    await q(`DELETE FROM eos_policy.role_capabilities rc USING eos_policy.roles r, eos_policy.capabilities c
              WHERE rc.role_id = r.id AND rc.capability_id = c.id AND rc.tenant_id = $1 AND r.key = 'partsAssociate' AND c.key = 'inventory.stock.receive'`, [TENANT]);
    await q(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, occurred_at, reason)
             VALUES ('ae-grant1-revoke', $1, 'revokeCapabilityFromRole', 'fixture', 'decision', 'd', now(), 'fixture revoke')`, [TENANT]);
    await q(`INSERT INTO eos_policy.role_capability_decisions (id, tenant_id, role_key, capability_key, decision, requires_condition, reason, actor_principal_id, audit_event_id)
             VALUES ('dec-grant1-0', $1, 'partsAssociate', 'inventory.stock.receive', 'ADMIN_REVOKED', false, 'fixture: an Administration revoke the migration must honour', 'fixture', 'ae-grant1-revoke')`, [TENANT]);
    // Another current holder of the OLD key (an Administration grant the repository does not know): warehouseManager.
    await q(`INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
             SELECT 'rc_grant1_holder', $1, r.id, c.id, 'fixture', 'fixture', 'fixture' FROM eos_policy.roles r, eos_policy.capabilities c
              WHERE r.tenant_id = $1 AND r.key = 'warehouseManager' AND c.key = $2`, [TENANT, OLD_KEY]);

    await run();
    const after = (await q(`SELECT r.key AS role, c.key AS cap FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id AND r.tenant_id = rc.tenant_id
                              JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE rc.tenant_id = $1 AND rc.granted_by = $2`, [TENANT, STAMP])).rows.map((r) => `${r.role}|${r.cap}`);
    assert.equal(after.includes("partsAssociate|inventory.stock.receive"), false, "an Administration ADMIN_REVOKED is honoured -- never re-granted");
    assert.equal(after.includes("warehouseManager|" + NEW_KEY), true, "another current holder of the old key keeps Part and Manufacturer activation");
    assert.equal(after.length, before - 1 + 1, "one pair withheld (revoked), one carried (the other holder), nothing else");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.role_capability_decisions WHERE tenant_id = $1 AND decision = 'ADMIN_REVOKED' AND superseded_at IS NULL`, [TENANT])).rows[0].n, 1, "the decision stands");
  });
});
