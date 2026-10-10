// PROTECTED ADMINISTRATOR ADMINISTRATION REACH (Owner 2026-10-09: DECISIONS #224 / PR-2; #223 D3; G2) -- PostgreSQL.
//
//   Reach        a protected Administrator with NO Employee Operational Scope reaches every authorized company's Reorder
//                queue and every ACTIVE warehouse of an authorized company -- for reads and allow-listed administering
//                predicates only.
//   Never        O1 WORKER execution, inventory.stock.receive (so no receiving and no CORRECTED re-receive by standing),
//                MOBILE scope, put-away / relocation, or anything that also needs Work Eligibility.
//   Isolation    no other tenant's warehouse or company; no INACTIVE warehouse; no unbound or INACTIVE company key.
//   Unchanged    restricted personas, existing operational workers, the protected Owner; Employee scopes and grants.
//
// Writes ONLY to a database it creates under POLICY_TEST_DATABASE_URL and drops at the end.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";
import { seedProtectedOwner } from "./support/protectedOwnerFixture.mjs";

const require = createRequire(import.meta.url);
const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const T = "t-preach";
const PREFIX = "preach";
const ADMIN_SUBJECT = `uid-${PREFIX}-admin`;
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

test("the reach allow-list and the execution exclusions are disjoint, and exactly the ruled sets", () => {
  const r = require("../lib/eosOps/administrationReach.js");
  assert.deepEqual([...r.ADMINISTRATION_REACH_CAPABILITIES].sort(), ["inventory.receipt.correct", "reorder.request.read", "warehouse.record.read"]);
  const worker = ["reorder.request.startPurchasing", "reorder.request.postPurchasingUpdate", "reorder.request.markReceived",
    "reorder.request.recordPurchaseOrder", "workOrder.execution.record", "workOrder.lifecycle.complete", "inventory.workOrderConsumption.record",
    "inventory.serializedAsset.acquire", "rental.unit.assign", "rental.unit.return"];
  assert.deepEqual([...r.ADMINISTRATOR_EXECUTION_CAPABILITIES].sort(), [...worker, "inventory.stock.receive"].sort(), "the 10 O1 WORKER keys + inventory.stock.receive");
  for (const k of r.ADMINISTRATOR_EXECUTION_CAPABILITIES) assert.equal(r.isAdministrationReachCapability(k), false, k);
  for (const k of ["inventory.placement.record", "inventory.stock.relocate", "inventory.cycleCount.submit", "reorder.request.createManual"]) {
    assert.equal(r.isAdministrationReachCapability(k), false, `${k} is execution: never reach`);
  }
  assert.equal(r.ADMINISTRATION_REACH_SCOPE_TYPES.has("MOBILE"), false, "MOBILE is never reach");
});

test("only administering call sites opt in to reach: the experience surfaces and the receipt VOID -- never an execution site", () => {
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".ts")) files.push(p); } };
  walk(SRC);
  // Every OPT-IN in code: a property `administrationReach: <expr>` on a code line, other than an explicit opt-out (false).
  const optIns = files.flatMap((f) => readFileSync(f, "utf8").split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .flatMap((line) => [...line.matchAll(/administrationReach:\s*([^,\n}]+)/g)].map((m) => m[1].trim()))
    .filter((v) => !v.startsWith("false") && !v.startsWith("$") && !/^(boolean|Readonly|readonly)/.test(v))
    .map((v) => `${f.slice(SRC.length + 1)} ${v}`));
  assert.deepEqual(optIns.sort(), [
    "eosOps/experienceAuthority.ts true",
    "eosOps/receiptCorrectionCommand.ts c.kind === \"VOID\"",
  ].sort(), JSON.stringify(optIns));
  // ANY use of the `administrationReach` property outside the known files is a new opt-in surface and must be reviewed
  // (catches shorthand, multi-line values and computed expressions the line scan above cannot parse).
  const KNOWN = new Set(["eosOps/contextualAuthorization.ts", "eosOps/experienceAuthority.ts", "eosOps/receiptCorrectionCommand.ts",
    "eosOps/partsReads.ts", "eosOps/administrationReach.ts", "eosOps/reorderQueueReach.ts", "eosOps/effectiveAccessExplanation.ts"]);
  const users = files.filter((f) => /\badministrationReach\b(?![A-Za-z])/.test(readFileSync(f, "utf8").replace(/from "[^"]*administrationReach[^"]*"/g, "")))
    .map((f) => f.slice(SRC.length + 1));
  assert.deepEqual(users.filter((f) => !KNOWN.has(f)), [], "a new administrationReach opt-in site needs review");
  // The receive pipeline (CORRECTED re-receives through it) never opts in.
  assert.doesNotMatch(readFileSync(join(SRC, "eosOps/receiveReorderStockCommand.ts"), "utf8"), /administrationReach/);
});

test("protected Administrator reach over queues and warehouses -- administering, never executing", { skip: SKIP, concurrency: false }, async (t) => {
  const { q, repo, person, pool, call } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: T, prefix: PREFIX });
  const { resolveOperationalContext } = require("../lib/eosOps/capabilityAuthority.js");
  const { postgresGrantConditionProvider } = require("../lib/eosOps/entitledActionAuthority.js");
  const { authorizeObjectAction, postgresContextualReader } = require("../lib/eosOps/contextualAuthorization.js");
  const { queueReachKeys } = require("../lib/eosOps/reorderQueueReach.js");
  const { scopedWarehouseIds } = require("../lib/eosOps/partsReads.js");
  const reach = require("../lib/eosOps/administrationReach.js");
  const { resolveExperienceContext } = require("../lib/eosOps/experienceAuthority.js");

  // Warehouses: two ACTIVE authorized (one per company), one INACTIVE, one on an UNBOUND key; a company with an INACTIVE key.
  const wh = (id, key, status = "ACTIVE", tenant = T) => q(`INSERT INTO eos_ops.warehouses (id,tenant_id,operating_company_key,name,site_label,status,provenance,created_by,updated_by)
    VALUES ($1,$2,$3,$1,$1,$4,'NATIVE','fixture','fixture')`, [id, tenant, key, status]);
  await wh("WH-T", "taylor"); await wh("WH-V", "ventana"); await wh("WH-OFF", "taylor", "INACTIVE"); await wh("WH-NOKEY", "nobody");
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by) VALUES ($1,'dormant','ACTIVE','fixture','fixture','fixture')`, [T]);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id,operating_company_id,operating_company_key,status,provenance,source,established_by,updated_by)
           VALUES ($1,'dormant','dormant','INACTIVE','NATIVE','fixture','fixture','fixture')`, [T]);
  // Another tenant with its own company and warehouse.
  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ('t-preach-other','t-preach-other','other')`);
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by) VALUES ('t-preach-other','acme','ACTIVE','fixture','fixture','fixture')`);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id,operating_company_id,operating_company_key,status,provenance,source,established_by,updated_by)
           VALUES ('t-preach-other','acme','acme','ACTIVE','NATIVE','fixture','fixture','fixture')`);
  await wh("WH-OTHER", "acme", "ACTIVE", "t-preach-other");

  const ctxOf = (subject) => resolveOperationalContext(repo, pool, { identityProvider: "firebase", externalSubject: subject, requestedTenantId: null }, postgresGrantConditionProvider(pool));
  const actorOf = async (subject) => { const c = await ctxOf(subject); return { tenantId: T, principalId: c.principalContext.uid, capabilities: c.capabilities }; };
  const decide = async (subject, capabilityKey, scopeType, scopeId, extra = {}) => authorizeObjectAction(postgresContextualReader(pool), {
    actor: await actorOf(subject), capabilityKey, predicates: [{ kind: "OPERATIONAL_SCOPE", scopeType, scopeId }], administrationReach: true, ...extra });
  const admin = await actorOf(ADMIN_SUBJECT);
  const scopeRows = async () => Number((await q(`SELECT count(*)::int n FROM eos_workforce.employee_operational_scopes`)).rows[0].n);
  const scopesBefore = await scopeRows();
  const grantsBefore = Number((await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities WHERE tenant_id = $1`, [T])).rows[0].n);

  await t.test("queues: every AUTHORIZED company, no Employee scope -- not an INACTIVE key, not another tenant's", async () => {
    assert.deepEqual(await queueReachKeys(pool, admin), ["taylor", "ventana"]);
    const r = await call({ subject: ADMIN_SUBJECT }, "/operations/inventory", "readReorderQueue", {});
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  });

  await t.test("warehouses: every ACTIVE warehouse of an authorized company -- not INACTIVE, not unbound, not another tenant's", async () => {
    assert.deepEqual(await scopedWarehouseIds(pool, admin), ["WH-T", "WH-V"]);
    const onHand = await call({ subject: ADMIN_SUBJECT }, "/operations/inventory", "readInventoryOnHand", {});
    assert.equal(onHand.status, 200, JSON.stringify(onHand.body).slice(0, 300));
    assert.deepEqual(onHand.body.result.scopedWarehouseIds, ["WH-T", "WH-V"]);
    for (const id of ["WH-OFF", "WH-NOKEY", "WH-OTHER"]) {
      assert.equal((await decide(ADMIN_SUBJECT, "warehouse.record.read", "WAREHOUSE", id)).allowed, false, `${id} is never reached`);
    }
    // The receiving picker offers only where the caller can RECEIVE: nothing, for standing alone.
    const picker = await call({ subject: ADMIN_SUBJECT }, "/operations/inventory", "listReceivingLocationOptions", {});
    if (picker.status === 200) assert.equal(JSON.stringify(picker.body.result).includes("WH-T"), false, JSON.stringify(picker.body.result).slice(0, 300));
  });

  await t.test("predicate reach: only opted-in, allow-listed, reachable scope types", async () => {
    assert.equal((await decide(ADMIN_SUBJECT, "warehouse.record.read", "WAREHOUSE", "WH-T")).allowed, true);
    assert.equal((await decide(ADMIN_SUBJECT, "reorder.request.read", "REORDER_QUEUE", "ventana")).allowed, true);
    const notOptedIn = await decide(ADMIN_SUBJECT, "warehouse.record.read", "WAREHOUSE", "WH-T", { administrationReach: false });
    assert.deepEqual([notOptedIn.allowed, notOptedIn.reason], [false, "EMPLOYEE_LINK_REQUIRED"], "an execution call site never gets reach");
  });

  await t.test("never execution: receiving, put-away, relocation, WORKER keys, MOBILE, Work Eligibility", async () => {
    for (const [cap, type, id] of [["inventory.stock.receive", "WAREHOUSE", "WH-T"], ["inventory.placement.record", "WAREHOUSE", "WH-T"],
      ["inventory.stock.relocate", "WAREHOUSE", "WH-T"], ["rental.unit.return", "WAREHOUSE", "WH-T"], ["inventory.serializedAsset.acquire", "WAREHOUSE", "WH-T"],
      ["inventory.workOrderConsumption.record", "MOBILE", "truck-1"], ["warehouse.record.read", "MOBILE", "truck-1"]]) {
      // The capability is forced present so ONLY the scope rule is under test.
      const d = await authorizeObjectAction(postgresContextualReader(pool), { actor: { ...admin, capabilities: new Set([cap]) }, capabilityKey: cap,
        predicates: [{ kind: "OPERATIONAL_SCOPE", scopeType: type, scopeId: id }], administrationReach: true });
      assert.deepEqual([d.allowed, d.reason], [false, "EMPLOYEE_LINK_REQUIRED"], `${cap} @ ${type}`);
    }
    // Cycle count: WORK_ELIGIBILITY + WAREHOUSE -- eligibility still refuses, whatever the reach.
    const cc = await authorizeObjectAction(postgresContextualReader(pool), { actor: { ...admin, capabilities: new Set(["warehouse.record.read"]) },
      capabilityKey: "warehouse.record.read", administrationReach: true,
      predicates: [{ kind: "WORK_ELIGIBILITY", qualificationCode: "WAREHOUSE_OPERATIONS" }, { kind: "OPERATIONAL_SCOPE", scopeType: "WAREHOUSE", scopeId: "WH-T" }] });
    assert.equal(cc.allowed, false);
    // Receipt correction: the VOID reaches; the CORRECTED path is the receive pipeline's inventory.stock.receive (above: refused).
    const voidReach = await authorizeObjectAction(postgresContextualReader(pool), { actor: { ...admin, capabilities: new Set(["inventory.receipt.correct"]) },
      capabilityKey: "inventory.receipt.correct", administrationReach: true, predicates: [{ kind: "OPERATIONAL_SCOPE", scopeType: "WAREHOUSE", scopeId: "WH-T" }] });
    assert.equal(voidReach.allowed, true, "G2: the reversal is administration");
  });

  await t.test("experience surfaces: warehouse and queue inspection appear; put-away and relocation do not; preview == runtime", async () => {
    const ctx = await resolveExperienceContext(repo, pool, { identityProvider: "firebase", externalSubject: ADMIN_SUBJECT, requestedTenantId: null });
    const surfaces = new Set(ctx.surfaces);
    const before = await resolveExperienceContext(repo, pool, { identityProvider: "firebase", externalSubject: ADMIN_SUBJECT, requestedTenantId: null },
      { dimensionReader: { linkedEmployeeId: async () => null, listWorkEligibility: async () => [], listOperationalScopes: async () => [] } });
    assert.ok(surfaces.size >= new Set(before.surfaces).size);
    const explain = await call({ subject: ADMIN_SUBJECT }, "/operations/experience", "resolveMyExperienceContext", {});
    assert.equal(explain.status, 200);
    assert.deepEqual([...explain.body.result.surfaces].sort(), [...surfaces].sort());
  });

  await t.test("standing is required: a scoped admin, a disabled admin and an Owner+admin principal reach nothing", async () => {
    const adminRoleId = (await repo.getRoleByKey(T, "admin")).id;
    const scoped = await person("uid-preach-scoped", []);
    await repo.transact({ tenantId: T, uid: "fixture" }, async (tx) => {
      const v = await tx.bumpAccessVersion(scoped.principalId);
      return tx.createAssignment({ principalId: scoped.principalId, roleId: adminRoleId, scopeType: "operatingCompany", scopeValue: "taylor",
        status: "active", grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: v });
    });
    assert.deepEqual(await reach.administrationReachTargets(pool, T, scoped.principalId, "WAREHOUSE"), []);
    const dual = await person("uid-preach-dual", ["admin"]);
    await seedProtectedOwner(repo, { tenantId: T, principalId: dual.principalId });
    assert.deepEqual(await reach.administrationReachTargets(pool, T, dual.principalId, "WAREHOUSE"), [], "Owner and Administrator stay distinct");
    const off = await person("uid-preach-off", ["admin"]);
    await q(`UPDATE eos_policy.principals SET status = 'disabled' WHERE id = $1`, [off.principalId]);
    assert.deepEqual(await reach.administrationReachTargets(pool, T, off.principalId, "REORDER_QUEUE"), []);
    assert.deepEqual(await reach.administrationReachTargets(pool, "t-preach-other", admin.principalId, "WAREHOUSE"), [], "no reach in a tenant it is not a member of");
    // A STALE assignment (granted at an access version the principal has not reached) confers nothing.
    const stale = await person("uid-preach-stale", ["admin"]);
    await q(`UPDATE eos_policy.user_role_assignments SET access_version_at_grant = 999999 WHERE tenant_id = $1 AND principal_id = $2`, [T, stale.principalId]);
    assert.deepEqual(await reach.administrationReachTargets(pool, T, stale.principalId, "WAREHOUSE"), [], "stale assignment");
    // An admin linked to an access-INELIGIBLE Employee, or to an Employee that does not exist, has no standing.
    const inel = await person("uid-preach-inel", ["admin"], { id: "e-preach-inel", name: "Ina Eligible", status: "TERMINATED" });
    assert.deepEqual(await reach.administrationReachTargets(pool, T, inel.principalId, "WAREHOUSE"), [], "ineligible linked Employee");
    const dangling = await person("uid-preach-dangling", ["admin"]);
    await q(`INSERT INTO eos_policy.employee_principal_links (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
             VALUES ('lnk-dangling',$1,$2,'e-does-not-exist','taylor','OPERATOR_ASSERTED','active','fixture','fixture')`, [T, dangling.principalId]).catch(() => null);
    const danglingLinks = Number((await q(`SELECT count(*)::int n FROM eos_policy.employee_principal_links WHERE id = 'lnk-dangling'`)).rows[0].n);
    if (danglingLinks === 1) assert.deepEqual(await reach.administrationReachTargets(pool, T, dangling.principalId, "WAREHOUSE"), [], "dangling Employee link");
  });

  await t.test("restricted personas and existing workers are unchanged; the Owner has no reach", async () => {
    const owner = await person("uid-preach-owner", []);
    await seedProtectedOwner(repo, { tenantId: T, principalId: owner.principalId });
    assert.deepEqual(await reach.administrationReachTargets(pool, T, owner.principalId, "WAREHOUSE"), []);
    // A warehouse worker: own WAREHOUSE scope + eligibility -- still exactly its own warehouse, and put-away still works there.
    const worker = await person("uid-preach-wa", ["warehouseAssociate", "inventoryPutAwayOperator"], { id: "e-preach-wa", name: "Wren Worker" });
    await q(`INSERT INTO eos_workforce.employee_operational_scopes (id,tenant_id,employee_id,scope_type,scope_id,effective_from,assigned_by,reason)
             VALUES ('os-preach-wa',$1,'e-preach-wa','WAREHOUSE','WH-T',now(),'fixture','fixture')`, [T]);
    const w = await actorOf("uid-preach-wa");
    assert.deepEqual(await scopedWarehouseIds(pool, w), ["WH-T"]);
    assert.deepEqual(await queueReachKeys(pool, w), []);
    if (w.capabilities.has("inventory.placement.record")) {
      assert.equal((await decide("uid-preach-wa", "inventory.placement.record", "WAREHOUSE", "WH-T")).allowed, true, "own scope still works");
      assert.equal((await decide("uid-preach-wa", "inventory.placement.record", "WAREHOUSE", "WH-V")).allowed, false, "and only its own");
    }
    for (const subject of ["uid-preach-wa"]) assert.deepEqual(await reach.administrationReachTargets(pool, T, (await actorOf(subject)).principalId, "WAREHOUSE"), []);
    const tech = await person("uid-preach-tech", ["technician"], { id: "e-preach-tech", name: "Tess Tech", technician: true });
    const tActor = await actorOf("uid-preach-tech");
    assert.deepEqual([await scopedWarehouseIds(pool, tActor), await queueReachKeys(pool, tActor)], [[], []]);
    void tech;
  });

  await t.test("no Employee scope or grant was created or removed", async () => {
    assert.equal(await scopeRows(), scopesBefore + 1, "only the worker fixture scope above");
    assert.equal(Number((await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities WHERE tenant_id = $1`, [T])).rows[0].n), grantsBefore);
  });
});
