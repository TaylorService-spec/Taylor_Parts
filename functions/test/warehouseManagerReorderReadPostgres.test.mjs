// PARTS-404 / RO-02 (Owner ruling, 2026-10-21, Level 3): the Warehouse Manager reads the Reorder Requests of the warehouses it is
// scoped to -- against a real postgres:16.
//
// THE RULING. Warehouse Manager KEEPS reorder.request.create.manual and GAINS reorder.request.read (one Administration grant,
// warehouseManagerReorderReadDelta). Every holder of reorder.request.read gains a SECOND, ADDITIVE read basis: the warehouses of
// its own WAREHOUSE Operational Scopes that lie inside its operating-company authority. The company-keyed REORDER_QUEUE reach is
// unchanged. Applied identically to the queue list, the request detail, the analysis measure, site search, My Work and the
// assigned-work read. The management commands (review, cancel, void, assign) keep queueReachKeys.
//
//   POSITIVE   a Warehouse Manager scoped to warehouse A reads A's requests (list, detail, analysis, search, My Work); creates a
//              manual reorder at A and then reads it
//   NEGATIVE   warehouse B of the same company is exposed nowhere (list, detail by id, analysis, search); the other operating
//              company is isolated even when the manager holds a WAREHOUSE scope over its warehouse; a Warehouse Manager with no
//              WAREHOUSE scope is refused (fail closed); the Warehouse Associate is unchanged
//   UNCHANGED  a Technician (no queue, no warehouse scope) is refused the queue and keeps its own assigned work; a Parts Manager
//              keeps its company-wide queue reach, and create still needs the WAREHOUSE scope; a warehouse scope grants no command
//   AUDIT      the grant is recorded by the Administration command: an audit row carrying the ruling
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";

const require = createRequire(import.meta.url);
const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const T = "t-p404";
const INV = "/operations/inventory", WS = "/operations/workspace", AN = "/operations/analysis";
const delta = require("../lib/adminPolicy/warehouseManagerReorderReadDelta.js");
const life = require("../lib/eosOps/reorderLifecycleCommands.js");
const authority = require("../lib/eosOps/reorderAssignmentAuthority.js");
const { listAssignedWorkForEmployee } = require("../lib/eosWorkforce/reads/assignedWorkReads.js");

test("PARTS-404: the Warehouse Manager reads the Reorder Requests of its scoped warehouses, and only those", { skip: SKIP, concurrency: false }, async (t) => {
  const { q, admin, person, call, pool } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: T, prefix: "p404" });
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body).slice(0, 600)}`); return r.body.result; };
  const refused = (r, status, code, what = "") => { assert.deepEqual([r.status, r.body.code], [status, code], `${what} ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };

  // ── the world: two Taylor warehouses, one Ventana warehouse, Parts ──
  const [A, B, V] = ["wh-p404-a", "wh-p404-b", "wh-p404-v"];
  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
           VALUES ($2,$1,'taylor','Warehouse A','Site','ACTIVE','NATIVE','f','f'), ($3,$1,'taylor','Warehouse B','Site','ACTIVE','NATIVE','f','f'),
                  ($4,$1,'ventana','Warehouse V','Site','ACTIVE','NATIVE','f','f')`, [T, A, B, V]);
  for (const partId of ["P404-A1", "P404-A2", "P404-B1", "P404-V1", "P404-A3"]) {
    await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
               expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
             VALUES ($1,$2,'fixture',$1,$1,'ACTIVE','EACH','STANDARD','STOCKED',false,false,false,false,1,'fixture')`, [partId, T]);
  }
  let scopeSeq = 0;
  const scope = (employeeId, scopeType, scopeId) => q(
    `INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
     VALUES ($1,$2,$3,$4,$5,now(),'fixture')`, [`os-p404-${++scopeSeq}`, T, employeeId, scopeType, scopeId]);

  // ── the people ──
  const seeder = await person("uid-p404-seeder", ["partsManager"], { id: "e-p404-seeder", name: "Sam Seeder" });
  for (const w of [A, B, V]) await scope("e-p404-seeder", "WAREHOUSE", w);
  const wm = await person("uid-p404-wm", ["warehouseManager"], { id: "e-p404-wm", name: "Wanda Manager" });
  await scope("e-p404-wm", "WAREHOUSE", A);
  const wmCross = await person("uid-p404-wmx", ["warehouseManager"], { id: "e-p404-wmx", name: "Wes Both" });
  await scope("e-p404-wmx", "WAREHOUSE", A); await scope("e-p404-wmx", "WAREHOUSE", V); // a Ventana warehouse, outside this Taylor employee's company authority
  const wmNone = await person("uid-p404-wmn", ["warehouseManager"], { id: "e-p404-wmn", name: "Nia NoScope" });
  const assoc = await person("uid-p404-assoc", ["warehouseAssociate"], { id: "e-p404-assoc", name: "Alex Associate" });
  await scope("e-p404-assoc", "WAREHOUSE", A);
  const tech = await person("uid-p404-tech", ["technician"], { id: "e-p404-tech", name: "Tess Tech", technician: true });
  // A REAL MOBILE-only Technician: a MOBILE scope over a governed truck location (OD-T1), no WAREHOUSE and no REORDER_QUEUE scope.
  await q(`INSERT INTO eos_ops.mobile_locations (tenant_id, location_type, location_id, operating_company_key, display_label, active, created_by, updated_by)
           VALUES ($1,'MOBILE','p404-truck-01','taylor','Truck 01',true,'f','f')`, [T]);
  await scope("e-p404-tech", "MOBILE", "p404-truck-01");
  const svcMgr = await person("uid-p404-svc", ["fieldManager", "inventoryTransferOperator"], { id: "e-p404-svc", name: "Sia ServiceMgr" });
  await scope("e-p404-svc", "WAREHOUSE", A);
  const partsAssoc = await person("uid-p404-pa", ["partsAssociate"], { id: "e-p404-pa", name: "Pax Associate" });
  await scope("e-p404-pa", "REORDER_QUEUE", "taylor"); await scope("e-p404-pa", "WAREHOUSE", A);
  await q(`INSERT INTO eos_workforce.employee_work_eligibility (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by,reason)
           VALUES ('we-p404-pa',$1,'e-p404-pa','PARTS_OPERATIONS',now(),'fixture','fixture')`, [T]);
  // Readers of the assigned-work family: employee.record.read (General Manager Role) plus the reorder read, with and without reach.
  const rdWh = await person("uid-p404-rdw", ["warehouseManager", "generalManager"], { id: "e-p404-rdw", name: "Rae Reader" });
  await scope("e-p404-rdw", "WAREHOUSE", A);
  const rdNone = await person("uid-p404-rdn", ["warehouseManager", "generalManager"], { id: "e-p404-rdn", name: "Ned Reader" });
  const rdQueue = await person("uid-p404-rdq", ["partsManager", "generalManager"], { id: "e-p404-rdq", name: "Quin Reader" });
  await scope("e-p404-rdq", "REORDER_QUEUE", "taylor"); await scope("e-p404-rdq", "WAREHOUSE", A);
  const pm = await person("uid-p404-pm", ["partsManager"], { id: "e-p404-pm", name: "Pat Parts" });
  await scope("e-p404-pm", "REORDER_QUEUE", "taylor"); await scope("e-p404-pm", "WAREHOUSE", A);
  const pmNoWh = await person("uid-p404-pmn", ["partsManager"], { id: "e-p404-pmn", name: "Pia NoWarehouse" });
  await scope("e-p404-pmn", "REORDER_QUEUE", "taylor");
  const pmWhOnly = await person("uid-p404-pmw", ["partsManager"], { id: "e-p404-pmw", name: "Wil WarehouseOnly" });
  await scope("e-p404-pmw", "WAREHOUSE", A);

  const create = (who, partId, warehouseId, n) => call(who, INV, "createReorderRequest", { partId, warehouseId, requestedQuantity: 3, recommendationStatus: "BELOW_MIN", quantitySource: "MANUAL", idempotencyKey: `p404-${partId}-${warehouseId}-${n}` });
  const queue = (who, input = {}) => call(who, INV, "readReorderQueue", input);
  const detail = (who, id) => call(who, INV, "readReorderRequest", { reorderRequestId: id });
  const idsOf = (r) => ok(r, "queue").map((x) => x.reorderRequestId).sort();
  const search = async (who) => ok(await call(who, WS, "searchEos", { query: "P404-" }), "search");
  const reqId = (r) => ok(r, "create").reorderRequestId;

  // The seeded demand: one request per warehouse (the Parts Manager holds all three WAREHOUSE scopes, so the creates are its own).
  const rA = reqId(await create(seeder, "P404-A1", A, 1));
  const rB = reqId(await create(seeder, "P404-B1", B, 1));
  const rV = reqId(await create(seeder, "P404-V1", V, 1));

  // ── BEFORE THE GRANT: the Warehouse Manager holds create.manual and not the read ──
  const grantsOf = async (roleKey) => (await q(
    `SELECT c.key FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id AND r.tenant_id = rc.tenant_id
       JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE rc.tenant_id = $1 AND r.key = $2 AND c.key LIKE 'reorder.request.%' ORDER BY 1`, [T, roleKey])).rows.map((r) => r.key);

  await t.test("BEFORE: Warehouse Manager holds create.manual and NOT the read; the queue is refused by capability", async () => {
    assert.deepEqual(await grantsOf("warehouseManager"), ["reorder.request.create.manual"]);
    const r = await queue(wm);
    refused(r, 403, "FORBIDDEN");
    assert.match(r.body.message, /reorder\.request\.read/);
  });

  await t.test("APPLY: one Administration grant, recorded (decision + audit row) with the ruling", async () => {
    const ops = delta.warehouseManagerReorderReadOperations();
    assert.equal(ops.length, 1);
    assert.deepEqual(ops[0].operation, "grantObjectActionToRole");
    const r = await admin(ops[0].operation, ops[0].input);
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 500));
    assert.deepEqual(await grantsOf("warehouseManager"), ["reorder.request.create.manual", "reorder.request.read"]);
    const audited = (await q(`SELECT action, reason, after->>'capabilityKey' AS cap, after->>'granteeKey' AS role FROM eos_policy.audit_events
                                WHERE tenant_id = $1 AND action = 'grantObjectActionToRole' AND after->>'capabilityKey' = 'reorder.request.read'`, [T])).rows;
    // Administration appends its request id to the stated reason.
    assert.equal(audited.length, 1, "one audit row");
    assert.equal(audited[0].role, "warehouseManager");
    assert.ok(audited[0].reason.startsWith(delta.WAREHOUSE_MANAGER_REORDER_READ_GRANT.reason), "the audit row carries the Owner ruling");
    const decided = (await q(`SELECT decision, reason FROM eos_policy.role_capability_decisions
                                WHERE tenant_id = $1 AND role_key = 'warehouseManager' AND capability_key = 'reorder.request.read' AND superseded_at IS NULL`, [T])).rows;
    assert.equal(decided.length, 1);
    assert.equal(decided[0].decision, "ADMIN_GRANTED");
    assert.ok(decided[0].reason.startsWith(delta.WAREHOUSE_MANAGER_REORDER_READ_GRANT.reason), "the decision carries the Owner ruling");
    assert.match(delta.WAREHOUSE_MANAGER_REORDER_READ_GRANT.reason, /PARTS-404 \/ RO-02/);
    // The grant is to ONE Role: the Warehouse Associate is unchanged.
    assert.deepEqual(await grantsOf("warehouseAssociate"), []);
  });

  await t.test("POSITIVE: a Warehouse Manager scoped to A reads A's requests -- list and detail", async () => {
    assert.deepEqual(await idsOf(await queue(wm)), [rA]);
    const d = ok(await detail(wm, rA), "detail");
    assert.deepEqual([d.reorderRequestId, d.warehouseId, d.operatingCompanyKey ?? "taylor"], [rA, A, "taylor"]);
  });

  let rA2;
  await t.test("POSITIVE: creates a manual reorder at A, then reads and inspects it", async () => {
    rA2 = reqId(await create(wm, "P404-A2", A, 1));
    assert.deepEqual(await idsOf(await queue(wm)), [rA, rA2].sort());
    assert.equal(ok(await detail(wm, rA2), "detail of own create").warehouseId, A);
    // Creating is still decided by the WAREHOUSE scope: B is outside it.
    const b = await create(wm, "P404-A3", B, 1);
    assert.equal(b.status, 403, JSON.stringify(b.body).slice(0, 300));
    assert.match(b.body.message, /outside your warehouse scope/);
  });

  await t.test("POSITIVE: analysis and search reach A's requests", async () => {
    const m = ok(await call(wm, AN, "readMeasureAnalysis", { measureId: "purchasing.reorders.open", operatingCompanyId: "taylor" }), "analysis").measure;
    assert.deepEqual(m.provenance.sources.map((s) => s.recordId).sort(), [rA, rA2].sort(), "analysis counts A's open requests only");
    const s = await search(wm);
    assert.deepEqual(s.results.filter((x) => x.kind === "reorderRequest").map((x) => x.id).sort(), [rA, rA2].sort());
    assert.ok(!s.notSearched.includes("reorderRequest"));
    // My Work's reorder section is the persona-listed readReorderQueue (the Warehouse Manager persona lists no such section), so it is covered above.
  });

  await t.test("NEGATIVE: warehouse B of the same company is exposed nowhere -- list, detail by id, analysis, search", async () => {
    const ids = await idsOf(await queue(wm));
    assert.ok(!ids.includes(rB) && !ids.includes(rV));
    const byId = refused(await detail(wm, rB), 403, "FORBIDDEN");
    assert.match(byId.message, /neither in the caller's queue reach nor assigned/);
    // Refused identically whether or not the record exists: no existence oracle.
    const none = refused(await detail(wm, "rr-p404-does-not-exist"), 403, "FORBIDDEN");
    assert.equal(none.message, byId.message);
    const m = ok(await call(wm, AN, "readMeasureAnalysis", { measureId: "purchasing.reorders.open", operatingCompanyId: "taylor" }), "analysis").measure;
    assert.ok(!m.provenance.sources.some((x) => [rB, rV].includes(x.recordId)));
    assert.ok(!(await search(wm)).results.some((x) => [rB, rV].includes(x.id)));
    // The Purchase Order measure keeps the queue reach alone.
    const w = ok(await call(wm, AN, "readAnalysisWorkspace", { area: "purchasing", operatingCompanyId: "taylor" }), "workspace");
    const po = w.measures.find((x) => x.id === "purchasing.orders.placed");
    assert.equal(po.status, "REFUSED");
    assert.match(po.reason, /REORDER_QUEUE/);
  });

  await t.test("NEGATIVE: the other operating company is isolated, even with a WAREHOUSE scope over its warehouse", async () => {
    assert.deepEqual(await idsOf(await queue(wmCross)), [rA, rA2].sort(), "the Ventana warehouse scope reaches nothing: it lies outside this Taylor employee's company authority");
    refused(await detail(wmCross, rV), 403, "FORBIDDEN");
    assert.ok(!(await search(wmCross)).results.some((x) => x.id === rV));
    const m = ok(await call(wmCross, AN, "readMeasureAnalysis", { measureId: "purchasing.reorders.open", operatingCompanyId: "taylor" }), "analysis").measure;
    assert.ok(!m.provenance.sources.some((x) => x.recordId === rV));
  });

  await t.test("NEGATIVE: a Warehouse Manager with no WAREHOUSE scope is refused everywhere (fail closed)", async () => {
    const r = refused(await queue(wmNone), 403, "FORBIDDEN");
    assert.match(r.message, /requires the REORDER_QUEUE Operational Scope/);
    refused(await detail(wmNone, rA), 403, "FORBIDDEN");
    const s = await search(wmNone);
    assert.deepEqual(s.results.filter((x) => x.kind === "reorderRequest"), []);
    assert.ok(s.notSearched.includes("reorderRequest"));
    const w = ok(await call(wmNone, AN, "readAnalysisWorkspace", { area: "purchasing", operatingCompanyId: "taylor" }), "workspace");
    const open = w.measures.find((x) => x.id === "purchasing.reorders.open");
    assert.equal(open.status, "REFUSED");
    assert.match(open.reason, /REORDER_QUEUE/);
  });

  await t.test("UNCHANGED: Warehouse Associate (no read grant) is still refused, scope or not", async () => {
    const r = await queue(assoc);
    refused(r, 403, "FORBIDDEN");
    assert.match(r.body.message, /reorder\.request\.read/);
    refused(await detail(assoc, rA), 403, "FORBIDDEN");
    assert.ok(!(await q(`SELECT 1 FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id=rc.role_id JOIN eos_policy.capabilities c ON c.id=rc.capability_id
                          WHERE rc.tenant_id=$1 AND r.key='warehouseAssociate' AND c.key='reorder.request.read'`, [T])).rows.length);
  });

  await t.test("UNCHANGED: a Technician holding ONLY a MOBILE scope (and reorder.request.read) is refused the queue and keeps its own assigned work", async () => {
    assert.ok((await grantsOf("technician")).includes("reorder.request.read"), "the Technician holds the read");
    const mobile = (await q(`SELECT scope_type, scope_id FROM eos_workforce.employee_operational_scopes WHERE tenant_id=$1 AND employee_id='e-p404-tech' ORDER BY 1`, [T])).rows;
    assert.deepEqual(mobile, [{ scope_type: "MOBILE", scope_id: "p404-truck-01" }]);
    const r = refused(await queue(tech), 403, "FORBIDDEN");
    assert.match(r.message, /requires the REORDER_QUEUE Operational Scope/);
    refused(await detail(tech, rA), 403, "FORBIDDEN");
    // Assign rA to the technician (the history-keeping table; the seeder is the assigner).
    await q(`INSERT INTO eos_ops.reorder_request_assignments (id, tenant_id, reorder_request_id, assigned_employee_id, effective_from, provenance, assigned_by_principal_id, reason)
             VALUES ('rra-p404-1', $1, $2, 'e-p404-tech', now(), 'NATIVE', $3, 'fixture')`, [T, rA, seeder.principalId]);
    const mine = ok(await call(tech, INV, "readMyAssignedReorders", {}), "assigned");
    assert.deepEqual(mine.map((x) => x.reorderRequestId), [rA]);
    assert.equal(ok(await detail(tech, rA), "own assigned detail").reorderRequestId, rA);
    refused(await detail(tech, rA2), 403, "FORBIDDEN");
  });

  await t.test("UNCHANGED: a Service Manager (fieldManager + inventoryTransferOperator, WAREHOUSE scope, no reorder.request.read) is still refused; a Parts Associate's company reach is a superset of its warehouse reach", async () => {
    assert.ok(!(await grantsOf("fieldManager")).includes("reorder.request.read"));
    const s = await queue(svcMgr);
    refused(s, 403, "FORBIDDEN");
    assert.match(s.body.message, /reorder.request.read/);
    refused(await detail(svcMgr, rA), 403, "FORBIDDEN");
    const reach = await life.queueReadReach(pool, { tenantId: T, principalId: partsAssoc.principalId });
    assert.deepEqual(reach.companyKeys, ["taylor"]);
    // Company reach covers every warehouse of the company, so the additive warehouse basis adds nothing for it.
    for (const w of reach.warehouseIds) assert.ok(["wh-p404-a", "wh-p404-b"].includes(w));
    const everyTaylorRow = (await q(`SELECT id FROM eos_ops.reorder_requests WHERE tenant_id=$1 AND operating_company_key = ANY($2::text[])`, [T, reach.companyKeys])).rows.map((r) => r.id);
    const warehouseRows = (await q(`SELECT id FROM eos_ops.reorder_requests WHERE tenant_id=$1 AND warehouse_id = ANY($2::text[])`, [T, reach.warehouseIds])).rows.map((r) => r.id);
    for (const id of warehouseRows) assert.ok(everyTaylorRow.includes(id), "warehouse reach is contained in company reach");
    if ((await grantsOf("partsAssociate")).includes("reorder.request.read")) {
      assert.deepEqual(await idsOf(await queue(partsAssoc)), [...everyTaylorRow].sort(), "same rows as company reach alone");
    }
  });

  await t.test("UNCHANGED: a Parts Manager keeps its company-wide queue reach; create still needs the WAREHOUSE scope", async () => {
    assert.deepEqual(await idsOf(await queue(pm)), [rA, rA2, rB].sort(), "REORDER_QUEUE:taylor reaches both Taylor warehouses, not Ventana");
    assert.equal(ok(await detail(pm, rB)).reorderRequestId, rB);
    refused(await detail(pm, rV), 403, "FORBIDDEN");
    const noWh = await create(pmNoWh, "P404-A3", A, 1);
    assert.equal(noWh.status, 403, JSON.stringify(noWh.body).slice(0, 300));
    assert.match(noWh.body.message, /outside your warehouse scope/);
    const outside = await create(pm, "P404-A3", B, 2);
    assert.equal(outside.status, 403);
  });

  await t.test("COMMANDS ARE UNWIDENED: a WAREHOUSE-scope reader cannot review, cancel or assign what it can read", async () => {
    // Decided by REACH, not capability: the actor below holds EVERY management capability, a WAREHOUSE scope over A, and no REORDER_QUEUE
    // scope. It READS rA yet each management command refuses it as though rA were absent -- queueReachKeys is untouched.
    const everything = new Set([life.REORDER_READ, life.REORDER_APPROVE, life.REORDER_REJECT, life.REORDER_CANCEL, authority.REORDER_REQUEST_ASSIGN]);
    const actor = { tenantId: T, principalId: pmWhOnly.principalId, capabilities: everything };
    assert.equal((await life.readReorderRequest({ pool }, actor, { reorderRequestId: rA })).reorderRequestId, rA, "it reads the request");
    await assert.rejects(life.reviewReorderRequest({ pool }, actor, { reorderRequestId: rA, decision: "APPROVED" }), (e) => e.code === "REORDER_NOT_FOUND");
    await assert.rejects(life.cancelReorderRequest({ pool }, actor, { reorderRequestId: rA, cancellationReason: "x" }), (e) => e.code === "REORDER_NOT_FOUND");
    await assert.rejects(authority.assignReorderRequestToEmployee({ pool }, actor, { reorderRequestId: rA, employeeId: "e-p404-pa" }), (e) => e.code === "REORDER_NOT_FOUND");
    // And the Warehouse Manager role itself holds none of the management capabilities.
    const w = await call(wm, INV, "reviewReorderRequest", { reorderRequestId: rA, decision: "APPROVED" });
    assert.equal(w.status, 403, JSON.stringify(w.body).slice(0, 300));
    assert.equal((await q(`SELECT status::text s FROM eos_ops.reorder_requests WHERE tenant_id=$1 AND id=$2`, [T, rA])).rows[0].s, "PENDING_REVIEW");
  });

  await t.test("ASSIGNED-WORK READ: the reorder family is reached through the same two bases", async () => {
    const { resolveOperationalContext } = require("../lib/eosOps/capabilityAuthority.js");
    const { postgresGrantConditionProvider } = require("../lib/eosOps/entitledActionAuthority.js");
    const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
    // The caller's REAL resolved context (so the Employee-read kernel is satisfied), plus the two capabilities the read needs: the REACH is what is under test.
    const actorOf = async (who, caps) => {
      const ctx = await resolveOperationalContext(new PostgresPolicyRepository(pool), pool, { identityProvider: "firebase", externalSubject: who.subject, requestedTenantId: null }, postgresGrantConditionProvider(pool));
      return { tenantId: T, principalId: ctx.principalContext.uid, capabilities: new Set([...ctx.capabilities, ...caps]), scopedHeld: ctx.scopedHeld, entitlements: ctx.entitlements };
    };
    // rA is assigned to the technician (above). A reader holding employee.record.read + reorder.request.read:
    const viaWarehouse = await listAssignedWorkForEmployee({ pool }, await actorOf(rdWh, []), { employeeId: "e-p404-tech", family: "REORDER_REQUEST" });
    assert.deepEqual(viaWarehouse.items.map((x) => x.recordId), [rA], "A is in the reader's scoped warehouse");
    const viaNone = listAssignedWorkForEmployee({ pool }, await actorOf(rdNone, []), { employeeId: "e-p404-tech", family: "REORDER_REQUEST" });
    await assert.rejects(viaNone, (e) => e.code === "OUTSIDE_OPERATIONAL_SCOPE");
    // B's assignment is out of the warehouse manager's reach.
    await q(`INSERT INTO eos_ops.reorder_request_assignments (id, tenant_id, reorder_request_id, assigned_employee_id, effective_from, provenance, assigned_by_principal_id, reason)
             VALUES ('rra-p404-2', $1, $2, 'e-p404-tech', now(), 'NATIVE', $3, 'fixture')`, [T, rB, seeder.principalId]);
    const again = await listAssignedWorkForEmployee({ pool }, await actorOf(rdWh, []), { employeeId: "e-p404-tech", family: "REORDER_REQUEST" });
    assert.deepEqual(again.items.map((x) => x.recordId), [rA]);
    const pmSees = await listAssignedWorkForEmployee({ pool }, await actorOf(rdQueue, []), { employeeId: "e-p404-tech", family: "REORDER_REQUEST" });
    assert.deepEqual(pmSees.items.map((x) => x.recordId).sort(), [rA, rB].sort(), "the company reach is unchanged");
  });

  await t.test("the shared helper is the one rule: queueReadReach reports exactly the scoped, in-authority warehouses", async () => {
    const reach = await life.queueReadReach(pool, { tenantId: T, principalId: wmCross.principalId });
    assert.deepEqual([reach.companyKeys, reach.warehouseIds, reach.warehouseCompanyKeys], [[], [A], ["taylor"]]);
    assert.deepEqual((await life.queueReachKeys(pool, { tenantId: T, principalId: wmCross.principalId })), [], "the command reach knows nothing of warehouses");
  });
});
