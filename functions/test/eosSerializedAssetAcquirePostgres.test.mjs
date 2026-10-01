// DQ-036(b) -- acquire-existing-unit on EOS/PostgreSQL, INACTIVE, with its authority granted ONLY through Administration.
//
// Proves, against PostgreSQL through the real transports:
//   * inventory.serializedAsset.acquire is registered (serializedAssets.acquire, BUSINESS_ACTION) and held by NO Role
//     after bootstrap -- the admin Role's whole-catalog composition included (the ADMINISTRATION_GRANT_ONLY fence);
//   * the execution packet: grantObjectActionToRole x4 (partsAssociate, partsManager, warehouseAssociate,
//     warehouseManager) through /admin/policy; then each of those four may acquire and every other persona --
//     technician, dispatcher, sales, office, finance, reporting, general employee, the Administrator -- is refused;
//   * the capability alone is NOT enough: warehouse scope, Catalog identity (eos_ops.parts ACTIVE + SERIAL), an ACTIVE
//     governed warehouse of a governed company, and a unit not already in custody are each enforced;
//   * the same behavior as the Firestore command: AVAILABLE at the WAREHOUSE, NON_PO_ACQUISITION provenance, replay by
//     intent, a unit from a receipt never overwritten, a different note under the same key refused; one audit;
//   * NOT_ACTIVATED by default.
// Writes ONLY to a database it creates under POLICY_TEST_DATABASE_URL and drops at the end.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { certifyInventoryBaselineFixture } from "./support/inventoryBaselineCertified.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
const { bootstrapTenant, bootstrapAdministrator, ensureTenantPrincipal } = require("../lib/adminPolicy/tenantBootstrap.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const { handleOperationsRequest, SERIALIZED_ASSET_ROUTE } = require("../lib/eosOps/eosOpsHttp.js");
const { ACQUIRE_WRITER_AUTHORITY } = require("../lib/serializedAsset/acquireWriterState.js");
const { ADMINISTRATION_GRANT_ONLY_CAPABILITIES } = require("../lib/adminPolicy/roleCapabilityAdministration.js");
const { serializedAssetDocId } = require("../lib/serializedAsset/serializedAssetRegistration.js");

const OP = "operator-dq036b";
const CAP = "inventory.serializedAsset.acquire";
const HOLDER_ROLES = ["partsAssociate", "partsManager", "warehouseAssociate", "warehouseManager"];
const NON_HOLDER_ROLES = ["technician", "dispatcher", "salesperson", "officeManager", "controller", "reportViewer", "generalEmployee", "admin"];
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("the fence: acquire is Administration-grant-only", () => {
  assert.equal(ADMINISTRATION_GRANT_ONLY_CAPABILITIES.has(CAP), true);
  // ACTIVATED (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01), gated per tenant by the baseline certification.
  assert.deepEqual({ ...ACQUIRE_WRITER_AUTHORITY }, { firestore: "FROZEN", postgres: "ACTIVE" });
});

test("DQ-036(b): acquire-existing-unit on EOS", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `dq036b_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  const q = (s, v = []) => pool.query(s, v);
  const repo = new PostgresPolicyRepository(pool);
  const count = async (sql, v = []) => Number((await q(sql, v)).rows[0].n);

  const { tenant } = await bootstrapTenant(repo, { key: "dq036b", name: "dq036b", actorUid: OP });
  await certifyInventoryBaselineFixture((sql, v) => pool.query(sql, v), tenant.id); // the writer gate (inventoryBaselineGate.ts)
  const T = tenant.id;
  await bootstrapAdministrator(repo, { tenantId: T, externalSubject: "admin", performedBy: OP, reason: "boot" });
  const admin = (op, input) => executeAdminOperation({ repo }, { caller: { externalSubject: "admin", identityProvider: "firebase" }, operation: op, input, requestId: `r-${op}` });
  const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };

  // World: one governed company with two warehouses, an ungoverned-company warehouse, an inactive warehouse; parts.
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by) VALUES ($1, 'co', 'ACTIVE', 't', $2, $2)`, [T, OP]);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by) VALUES ($1, 'co', 'key', 'ACTIVE', 'NATIVE', 't', $2, $2)`, [T, OP]);
  for (const [id, key, status] of [["WH-A", "key", "ACTIVE"], ["WH-B", "key", "ACTIVE"], ["WH-OFF", "key", "INACTIVE"], ["WH-UNGOV", "key-nobody", "ACTIVE"]]) {
    await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by) VALUES ($1, $2, $3, $1, 's', $4, 'NATIVE', $5, $5)`, [id, T, key, status, OP]);
  }
  for (const [id, status, control] of [["P-SER", "ACTIVE", "SERIALIZED"], ["P-QTY", "ACTIVE", "STANDARD"], ["P-SER-OFF", "INACTIVE", "SERIALIZED"]]) {
    await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
               expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
             VALUES ($2, $1, 'seed', $2, 'acq part', $3, 'EACH', $4, 'STOCKED', false, false, false, false, 1, 'seed')`, [T, id, status, control]);
  }

  // Personas: one per Role, each an ACTIVE Employee with Warehouse Operations eligibility and WH-A scope -- so the
  // ONLY thing that differs between an allowed and a refused persona is the Administration grant.
  const principals = {};
  const persona = async (subject, roleKey, warehouses = ["WH-A"], withEmployee = true) => {
    const made = await ensureTenantPrincipal(repo, { tenantId: T, externalSubject: subject, actorUid: OP, actorRoleKeys: ["admin"] });
    const principalId = made.principal?.id ?? made.id ?? made.principalId;
    if (roleKey && roleKey !== "admin") {
      const role = await repo.getRoleByKey(T, roleKey);
      assert.ok(role, `the bootstrap has a ${roleKey} Role`);
      ok(await admin("assignRole", { principalId, roleId: role.id, reason: "fixture staffing" }));
    }
    if (withEmployee) {
      const employeeId = `emp-${subject}`;
      await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES ($1, $2, 'ACTIVE', 'co')`, [employeeId, T]);
      await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, status, asserted_by, assertion_reason)
               VALUES ($1, $2, $3, $4, 'co', 'OPERATOR_ASSERTED', 'active', $5, 'fixture')`, [`epl-${subject}`, T, principalId, employeeId, OP]);
      await q(`INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by) VALUES ($1, $2, $3, 'WAREHOUSE_OPERATIONS', now(), $4)`, [`we-${subject}`, T, employeeId, OP]);
      for (const wh of warehouses) {
        await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by) VALUES ($1, $2, $3, 'WAREHOUSE', $4, now(), $5)`, [`os-${subject}-${wh}`, T, employeeId, wh, OP]);
      }
    }
    principals[subject] = principalId;
    return subject;
  };
  for (const r of [...HOLDER_ROLES, ...NON_HOLDER_ROLES.filter((k) => k !== "admin")]) await persona(`p-${r}`, r);
  // The Administrator persona IS "admin" (bootstrapped); give it the same Employee facts so only authority differs.
  await persona("admin", "admin");
  await persona("p-partsAssociate-b", "partsAssociate", ["WH-B"]);

  const call = async (subject, input, { state = "ACTIVE" } = {}) => {
    const res = await handleOperationsRequest({
      reader: repo, pool, ...(state === null ? {} : { acquirePostgresState: state }),
      verifyToken: async (token) => ({ externalSubject: token, identityProvider: "firebase" }),
    }, { method: "POST", url: SERIALIZED_ASSET_ROUTE, headers: { authorization: `Bearer ${subject}` },
      body: JSON.stringify({ operation: "acquireSerializedAsset", input }) });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  const acquired = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.result; };
  const refused = (r, status, code, message) => {
    assert.equal(r.status, status, JSON.stringify(r.body));
    if (code) assert.equal(r.body.code, code, JSON.stringify(r.body));
    if (message) assert.match(r.body.message, message);
  };
  const req = (serial, over = {}) => ({ partId: "P-SER", serialNo: serial, locationId: "WH-A", reason: "OPENING_BALANCE", idempotencyKey: `k-${serial}`, ...over });
  const holders = async () => (await q(`SELECT r.key FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id
    JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE c.key = $1 ORDER BY r.key`, [CAP])).rows.map((r) => r.key);

  await t.test("registered once, held by NOBODY after bootstrap -- admin included", async () => {
    const { rows } = await q(`SELECT object_key, action_key, action_kind FROM eos_policy.capabilities WHERE key = $1`, [CAP]);
    assert.deepEqual(rows, [{ object_key: "serializedAssets", action_key: "acquire", action_kind: "BUSINESS_ACTION" }]);
    assert.deepEqual(await holders(), []);
  });

  await t.test("an INACTIVE state refuses NOT_ACTIVATED before anything is read or written", async () => {
    refused(await call("p-partsAssociate", req("SN-0"), { state: "INACTIVE" }), 503, "NOT_ACTIVATED");
  });

  await t.test("before the packet every persona is refused", async () => {
    for (const r of [...HOLDER_ROLES, ...NON_HOLDER_ROLES]) {
      refused(await call(r === "admin" ? "admin" : `p-${r}`, req(`SN-pre-${r}`)), 403, "PERMISSION_DENIED");
    }
    assert.equal(await count(`SELECT count(*) AS n FROM eos_ops.serialized_custody`), 0);
  });

  await t.test("THE PACKET: grantObjectActionToRole serializedAssets.acquire x4 through Administration", async () => {
    for (const roleKey of HOLDER_ROLES) {
      ok(await admin("grantObjectActionToRole", { objectKey: "serializedAssets", actionKey: "acquire", roleKey, reason: "DQ-036(b): initial Taylor acquire holders" }));
    }
    assert.deepEqual(await holders(), [...HOLDER_ROLES].sort());
    const decisions = await count(`SELECT count(*) AS n FROM eos_policy.role_capability_decisions WHERE capability_key = $1 AND decision = 'ADMIN_GRANTED'`, [CAP]);
    assert.equal(decisions, 4);
  });

  await t.test("each of the four may acquire; every other Role -- the Administrator included -- is refused", async () => {
    for (const r of HOLDER_ROLES) {
      const out = acquired(await call(`p-${r}`, req(`SN-${r}`)));
      assert.deepEqual([out.outcome, out.state, out.locationId], ["acquired", "AVAILABLE", "WH-A"]);
      assert.equal(out.serializedAssetId, serializedAssetDocId("P-SER", `SN-${r}`));
    }
    for (const r of NON_HOLDER_ROLES) refused(await call(r === "admin" ? "admin" : `p-${r}`, req(`SN-no-${r}`)), 403, "PERMISSION_DENIED");
  });

  await t.test("the facts written: custody AVAILABLE at the warehouse, ONE ADJUSTED +1 serial movement, provenance, one audit", async () => {
    const c = (await q(`SELECT status::text AS s, location_type::text AS t, location_id, operating_company_key FROM eos_ops.serialized_custody WHERE serial_number = 'SN-partsAssociate'`)).rows[0];
    assert.deepEqual({ ...c }, { s: "AVAILABLE", t: "WAREHOUSE", location_id: "WH-A", operating_company_key: "key" });
    const m = (await q(`SELECT movement_type::text AS mt, quantity_delta AS d, tracking_mode::text AS tm, source_kind FROM eos_ops.inventory_movements WHERE serial_number = 'SN-partsAssociate'`)).rows;
    assert.deepEqual(m.map((x) => ({ ...x })), [{ mt: "ADJUSTED", d: 1, tm: "SERIAL", source_kind: "SERIALIZED_ASSET_ACQUISITION" }]);
    assert.equal(await count(`SELECT count(*) AS n FROM eos_ops.inventory_movements WHERE movement_type = 'RECEIVED'`), 0, "an acquisition is not a receipt");
    const a = (await q(`SELECT reason::text AS reason, provenance FROM eos_ops.serialized_asset_acquisitions WHERE serial_number = 'SN-partsAssociate'`)).rows[0];
    assert.deepEqual({ ...a }, { reason: "OPENING_BALANCE", provenance: "NON_PO_ACQUISITION" });
    assert.equal(await count(`SELECT count(*) AS n FROM eos_policy.audit_events WHERE action = 'serializedAsset.acquire'`), 4);
  });

  await t.test("the capability alone is insufficient: scope, Catalog identity, warehouse, company, unit state", async () => {
    const pa = "p-partsAssociate";
    refused(await call("p-partsAssociate-b", req("SN-s1")), 403, "OUTSIDE_OPERATIONAL_SCOPE");
    refused(await call(pa, req("SN-c1", { partId: "P-NOPE" })), 404, "PART_NOT_FOUND");
    refused(await call(pa, req("SN-c2", { partId: "P-SER-OFF" })), 404, "PART_NOT_FOUND", /not active/);
    refused(await call(pa, req("SN-c3", { partId: "P-QTY" })), 412, "PART_NOT_SERIALIZED");
    refused(await call(pa, req("SN-w1", { locationId: "WH-NOPE" })), 412, "LOCATION_INVALID");
    // WH-OFF and WH-UNGOV: give the persona scope there so the refusal is the warehouse's, not the scope's.
    const emp = "emp-p-partsAssociate";
    for (const wh of ["WH-OFF", "WH-UNGOV"]) {
      await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by) VALUES ($1, $2, $3, 'WAREHOUSE', $4, now(), $5)`, [`os-x-${wh}`, T, emp, wh, OP]);
    }
    refused(await call(pa, req("SN-w2", { locationId: "WH-OFF" })), 412, "LOCATION_INVALID");
    refused(await call(pa, req("SN-w3", { locationId: "WH-UNGOV" })), 412, "COMPANY_NOT_GOVERNED");
    // A unit that arrived by RECEIPT is never overwritten.
    await q(`INSERT INTO eos_ops.serialized_custody (id, tenant_id, operating_company_key, part_id, serial_number, status, location_type, location_id, updated_by) VALUES ('ser-rcv', $1, 'key', 'P-SER', 'SN-RCV', 'AVAILABLE', 'WAREHOUSE', 'WH-A', 'u')`, [T]);
    refused(await call(pa, req("SN-RCV")), 409, "ALREADY_EXISTS_CONFLICT", /from a receipt/);
    refused(await call(pa, { ...req("SN-bad"), reason: "PURCHASE" }), 400, "REQUEST_INVALID", /reason must be one of/);
    assert.equal(await count(`SELECT count(*) AS n FROM eos_ops.serialized_asset_acquisitions`), 4);
  });

  await t.test("replay by intent; a different reason, location or note under the key is a conflict", async () => {
    const pm = "p-partsManager";
    assert.equal(acquired(await call(pm, req("SN-partsManager"))).outcome, "replayed");
    refused(await call(pm, req("SN-partsManager", { reason: "LEGACY_MIGRATION" })), 409, "ALREADY_EXISTS_CONFLICT");
    refused(await call(pm, req("SN-partsManager", { provenanceNote: "another story" })), 409, "ALREADY_EXISTS_CONFLICT", /different note/);
    assert.equal(await count(`SELECT count(*) AS n FROM eos_policy.audit_events WHERE action = 'serializedAsset.acquire'`), 4, "a replay is not audited");
  });

  await t.test("revoking one grant takes effect; the down migration refuses while grants exist", async () => {
    ok(await admin("revokeObjectActionFromRole", { objectKey: "serializedAssets", actionKey: "acquire", roleKey: "warehouseAssociate", reason: "fixture revoke" }));
    refused(await call("p-warehouseAssociate", req("SN-after-revoke")), 403, "PERMISSION_DENIED");
    const sql = (await import("node:fs")).readFileSync(resolve(FUNCTIONS_DIR, "migrations/1764129600000_serialized-asset-acquire-authority.sql"), "utf8").split("-- Down Migration")[1];
    await assert.rejects(q(sql), /SERIALIZED_ASSET_ACQUIRE_AUTHORITY: refuses to reverse/);
  });
});
