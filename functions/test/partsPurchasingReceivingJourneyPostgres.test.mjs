// PARTS / PURCHASING / RECEIVING -- the reconciliation journey (Controller BEGIN PARTS / PURCHASING / RECEIVING JOURNEY,
// 2026-10-01: "assemble one coherent local acceptance journey using existing functionality ... then prove the negative
// paths ... Do not invent behavior for unsupported cases. Classify unsupported behavior for Controller ruling.").
//
// On a BASELINE-EQUAL tenant (support/serviceBaselineTenant.mjs) with the Reorder authority exactly as nonprod holds it
// (measured 2026-10-01; applied there through Administration on 2026-09-30, not in the repository baseline -- so applied
// here the same way), the personas' Employee links, PARTS_OPERATIONS eligibility and REORDER_QUEUE scope as measured,
// over the REAL Operations transport (POST /operations/inventory):
//
//   1. THE JOURNEY: need -> Reorder Request -> Parts Manager approval -> assignment -> purchasing -> update -> Purchase
//      Order -> physical receipt -> Receiving (Parts Associate as receiving clerk) -> the authoritative inventory movement
//      and the Reorder closed RECEIVED in the same transaction, with audit.
//   2. NEGATIVE PATHS, each pinned at what the deployed code DOES today. Where that is a gap against an existing ruling or
//      an unsupported case, the assertion is labelled OBSERVED and the finding is classified in the reconciliation report;
//      nothing here invents behavior.
//
// Real PostgreSQL. Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";

const require = createRequire(import.meta.url);
const authority = require("../lib/eosOps/reorderAssignmentAuthority.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-parts";
const INV = "/operations/inventory";

// The Reorder authority nonprod holds today (census pp0, 2026-10-01), per Role.
const LIVE_REORDER_GRANTS = {
  partsManager: ["reorder.purchaseOrder.void", "reorder.request.approve", "reorder.request.assign", "reorder.request.cancel",
    "reorder.request.create.manual", "reorder.request.read", "reorder.request.reject"],
  partsAssociate: ["reorder.request.markReceived", "reorder.request.postPurchasingUpdate", "reorder.request.read",
    "reorder.request.recordPurchaseOrder", "reorder.request.startPurchasing"],
};

test("Parts / Purchasing / Receiving over the Operations transport", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, repo, call } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "ppr" });
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const inv = (who, operation, input) => call(who, INV, operation, input);
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`); return r.body.result; };
  const refused = (r, status, code, what = "") => assert.deepEqual([r.status, r.body.code], [status, code], `${what} ${JSON.stringify(r.body)}`);
  const roleCaps = async (roleKey) => (await q(`SELECT c.key FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id
      JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE rc.tenant_id = $1 AND r.key = $2 ORDER BY 1`, [TENANT, roleKey])).rows.map((r) => r.key);

  // ── the live Reorder authority, through Administration ──
  for (const [roleKey, keys] of Object.entries(LIVE_REORDER_GRANTS)) {
    for (const key of keys) {
      const cap = await one(`SELECT object_key, action_key FROM eos_policy.capabilities WHERE key = $1`, [key]);
      const r = await admin("grantObjectActionToRole", { roleKey, objectKey: cap.object_key, actionKey: cap.action_key, reason: "nonprod Reorder authority as measured 2026-10-01" });
      assert.equal(r.ok, true, `${roleKey} ${key} ${JSON.stringify(r).slice(0, 200)}`);
    }
  }
  for (const [roleKey, keys] of Object.entries(LIVE_REORDER_GRANTS)) {
    for (const key of keys) assert.ok((await roleCaps(roleKey)).includes(key), `${roleKey} holds ${key}`);
  }

  // ── the personas, with their measured Security Roles ──
  const pa = await person("uid-parts-associate", ["partsAssociate", "inventoryReceivingClerk"], { id: "e-pa", name: "Pat Parts" });
  const pm = await person("uid-parts-manager", ["partsManager", "purchasingManager"], { id: "e-pm", name: "Morgan Parts-Manager" });
  const wa = await person("uid-warehouse-associate", ["warehouseAssociate"], { id: "e-wa", name: "Wren Warehouse" });
  const wm = await person("uid-warehouse-manager", ["warehouseManager"], { id: "e-wm", name: "Wes Warehouse-Manager" });
  const tech = await person("uid-tech", ["technician"], { id: "e-tech", name: "Tess Technician", technician: true });
  const retail = await person("uid-retail", ["salesperson"], { id: "e-retail", name: "Harper Retail" });
  const nobody = await person("uid-general", [], { id: "e-general", name: "Gen Employee" });
  const owner = await person("uid-owner", [], { id: "e-owner", name: "Owen Owner" });
  await repo.transact({ tenantId: TENANT, uid: "fixture" }, async (tx) => {
    const accessVersion = await tx.bumpAccessVersion(owner.principalId);
    return tx.createAssignment({ principalId: owner.principalId, roleId: (await repo.getRoleByKey(TENANT, "owner")).id, scopeType: "global", scopeValue: null,
      status: "active", grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion });
  });
  // PARTS_OPERATIONS eligibility (Parts Associate, Parts Manager) and REORDER_QUEUE:taylor (both, as measured live).
  for (const e of ["e-pa", "e-pm"]) {
    await q(`INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by)
             VALUES ($1, $2, $3, $4, now(), 'fixture')`, [`ewe-${e}`, TENANT, e, authority.REORDER_ASSIGNMENT_QUALIFICATION]);
    await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
             VALUES ($1, $2, $3, 'REORDER_QUEUE', 'taylor', now(), 'fixture')`, [`os-q-${e}`, TENANT, e]);
  }

  // ── master data: a governed warehouse (key taylor), a second one, an inactive one, a bin; governed Parts ──
  const warehouse = (id, key, status = "ACTIVE") => q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
      VALUES ($1,$2,$3,$1,'Phoenix',$4,'NATIVE','fixture','fixture')`, [id, TENANT, key, status]);
  await warehouse("wh-phx", "taylor");
  await warehouse("wh-tuc", "taylor");
  await warehouse("wh-closed", "taylor", "INACTIVE");
  await warehouse("wh-unbound", "not-a-bound-key");
  const part = (id, controlType, status = "ACTIVE") => q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit,
      control_type, stocking_class, expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
      VALUES ($1,$2,'fixture',$1,$1,$3,'EACH',$4,'STOCKED',false,false,false,false,1,'fixture')`, [id, TENANT, status, controlType]);
  // WAREHOUSE scope for the receiving clerk over the Reorder's warehouse (DQ-017: receiving is decided by EOS warehouse scope).
  // Nonprod: the Parts Associate holds NO WAREHOUSE scope today -- an activation prerequisite (assignEmployeeOperationalScope).
  await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
           VALUES ('os-wh-pa', $1, 'e-pa', 'WAREHOUSE', 'wh-phx', now(), 'fixture')`, [TENANT]);
  await part("PRT-FAN", "STANDARD");
  await part("PRT-COMP", "SERIALIZED");
  await part("PRT-OBSOLETE", "STANDARD", "INACTIVE");

  const need = (over = {}) => ({ partId: "PRT-FAN", warehouseId: "wh-phx", requestedQuantity: 6, recommendationStatus: "BELOW_MIN", quantitySource: "MANUAL", ...over });
  const status = async (id) => (await one(`SELECT status::text s FROM eos_ops.reorder_requests WHERE tenant_id = $1 AND id = $2`, [TENANT, id])).s;
  const movements = async (partId) => (await q(`SELECT movement_type::text t, quantity_delta::int qty, location_id loc FROM eos_ops.inventory_movements WHERE tenant_id = $1 AND part_id = $2 ORDER BY occurred_at, id`, [TENANT, partId])).rows;
  const receipt = (id, over = {}) => ({ source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: id, purchaseOrderId: id },
    receivingLocation: { type: "WAREHOUSE", locationId: "wh-phx" }, lines: [{ lineId: "L1", partId: "PRT-FAN", receivedQuantity: 6 }], idempotencyKey: `rcv-${id}`, ...over });
  // Drive one request to ORDERED (the governed path), returning its id.
  const toOrdered = async (over = {}, poOver = {}) => {
    const rr = ok(await inv(pm, "createReorderRequest", need(over)), "create").reorderRequestId;
    ok(await inv(pm, "reviewReorderRequest", { reorderRequestId: rr, decision: "APPROVED", reviewNotes: "below minimum" }), "approve");
    ok(await inv(pm, "assignReorderRequest", { reorderRequestId: rr, employeeId: "e-pa" }), "assign");
    ok(await inv(pa, "startPurchasingOnReorder", { reorderRequestId: rr, purchasingNotes: "calling suppliers" }), "start");
    ok(await inv(pa, "recordReorderPurchaseOrder", { reorderRequestId: rr, supplierName: "Desert Refrigeration Supply", externalPoNumber: `PO-${rr.slice(-6)}`,
      orderedQuantity: over.requestedQuantity ?? 6, orderedDate: "2026-10-01", expectedArrivalDate: "2026-10-08", ...poOver }), "PO");
    return rr;
  };

  let rr;
  await t.test("JOURNEY: need -> request -> approval -> assignment -> purchasing -> update -> PO -> receipt -> inventory consequence, one governed path", async () => {
    // The Parts Manager raises the need (the Parts Associate holds no create capability -- see the authority finding).
    const created = ok(await inv(pm, "createReorderRequest", need()), "create");
    rr = created.reorderRequestId;
    assert.equal(await status(rr), "PENDING_REVIEW");
    const row = await one(`SELECT operating_company_key, requested_by, warehouse_id FROM eos_ops.reorder_requests WHERE id = $1`, [rr]);
    assert.deepEqual(row, { operating_company_key: "taylor", requested_by: pm.principalId, warehouse_id: "wh-phx" }, "company derived from the warehouse; actor is the Principal");
    ok(await inv(pm, "reviewReorderRequest", { reorderRequestId: rr, decision: "APPROVED", reviewNotes: "below minimum" }), "approve");
    assert.equal(await status(rr), "READY_FOR_PARTS_MANAGER");
    const queue = ok(await inv(pm, "readReorderQueue", {}), "manager queue");
    assert.ok(JSON.stringify(queue).includes(rr), "the request is in the Parts Manager's REORDER_QUEUE");
    ok(await inv(pm, "assignReorderRequest", { reorderRequestId: rr, employeeId: "e-pa" }), "assign");
    assert.equal(await status(rr), "ASSIGNED_TO_PARTS_ASSOCIATE");
    const mine = ok(await inv(pa, "readMyAssignedReorders", {}), "my purchasing");
    assert.ok(JSON.stringify(mine).includes(rr), "the assignee sees it in My Purchasing");
    ok(await inv(pa, "startPurchasingOnReorder", { reorderRequestId: rr, purchasingNotes: "calling suppliers" }), "start");
    ok(await inv(pa, "postPurchasingUpdate", { reorderRequestId: rr, purchasingNotes: "Desert Refrigeration has 6", vendorContacted: true, expectedAvailabilityDate: "2026-10-08" }), "update");
    const po = ok(await inv(pa, "recordReorderPurchaseOrder", { reorderRequestId: rr, supplierName: "Desert Refrigeration Supply", externalPoNumber: "PO-77001",
      orderedQuantity: 6, orderedDate: "2026-10-01", expectedArrivalDate: "2026-10-08", unitPriceMinor: 4100, currency: "USD" }), "record PO");
    assert.ok(po);
    assert.equal(await status(rr), "ORDERED");
    const pos = ok(await inv(pa, "readReorderPurchaseOrders", { reorderRequestIds: [rr] }), "PO read");
    assert.ok(JSON.stringify(pos).includes("PO-77001"), "supplier / expected receipt information is visible");
    // Physical receipt: the Parts Associate (receiving clerk) receives into the governed warehouse.
    const rec = ok(await inv(pa, "receiveReorderStock", receipt(rr)), "receive");
    assert.equal(rec.outcome, "applied");
    assert.equal(await status(rr), "RECEIVED", "ORDERED -> RECEIVED is the consequence of the receipt, same transaction (R2)");
    assert.deepEqual(await movements("PRT-FAN"), [{ t: "RECEIVED", qty: 6, loc: "wh-phx" }], "the authoritative PostgreSQL inventory movement");
    const cost = await one(`SELECT count(*)::int n, max(operating_company_id) co FROM eos_finance.inventory_acquisition_costs WHERE tenant_id = $1`, [TENANT]);
    assert.deepEqual(cost, { n: 1, co: "taylor" }, "acquisition cost evidence carries the operating company id (R3)");
    const ro = await one(`SELECT status::text s, source_kind::text k FROM eos_ops.receiving_orders WHERE tenant_id = $1`, [TENANT]);
    assert.deepEqual(ro, { s: "PUTAWAY_COMPLETE", k: "REORDER_PURCHASE_ORDER" });
    const audits = (await q(`SELECT action FROM eos_policy.audit_events WHERE tenant_id = $1 AND target_id = $2 ORDER BY occurred_at, id`, [TENANT, rr])).rows.map((r) => r.action);
    for (const a of ["reorderRequest.create", "reorderRequest.review", "reorderRequest.assign", "reorder.request.recordPurchaseOrder"]) {
      assert.ok(audits.some((x) => x.includes(a.split(".").pop())), `audited: ${a} in ${audits.join(",")}`);
    }
    // The retry of the same physical receipt is idempotent: replayed, nothing written twice.
    const replay = ok(await inv(pa, "receiveReorderStock", receipt(rr)), "replay");
    assert.equal(replay.outcome, "replayed");
    assert.equal((await movements("PRT-FAN")).length, 1, "no duplicate movement");
  });

  await t.test("NEGATIVE PERSONAS: no approval, purchasing or receiving authority leaks to technician, sales, general employee or Owner", async () => {
    const r2 = ok(await inv(pm, "createReorderRequest", need()), "create").reorderRequestId;
    for (const [who, what] of [[tech, "technician"], [retail, "retail sales"], [nobody, "general employee"], [owner, "Owner"], [wa, "warehouse associate"], [wm, "warehouse manager"]]) {
      refused(await inv(who, "reviewReorderRequest", { reorderRequestId: r2, decision: "APPROVED" }), 403, "FORBIDDEN", `${what} approve`);
      refused(await inv(who, "assignReorderRequest", { reorderRequestId: r2, employeeId: "e-pa" }), 403, "FORBIDDEN", `${what} assign`);
      refused(await inv(who, "recordReorderPurchaseOrder", { reorderRequestId: r2, supplierName: "x", externalPoNumber: "x", orderedQuantity: 1, orderedDate: "2026-10-01" }), 403, "FORBIDDEN", `${what} record PO`);
    }
    for (const [who, what] of [[tech, "technician"], [retail, "retail sales"], [nobody, "general employee"], [owner, "Owner"], [wa, "warehouse associate"], [wm, "warehouse manager"], [pm, "parts manager"]]) {
      refused(await inv(who, "receiveReorderStock", receipt(r2)), 403, "FORBIDDEN", `${what} receive`);
    }
    // The Parts Associate cannot approve their own work.
    refused(await inv(pa, "reviewReorderRequest", { reorderRequestId: r2, decision: "APPROVED" }), 403, "FORBIDDEN", "parts associate approve");
    // OBSERVED: the Parts Associate holds no create capability (the measured persona fixture records PARTS_ASSOCIATE_REORDER_GRANT_ABSENT).
    refused(await inv(pa, "createReorderRequest", need()), 403, "FORBIDDEN", "parts associate create");
  });

  await t.test("PURCHASING NEGATIVES: the assignee seam, PO replay 412, void as a management exception, receipt of a voided or cancelled request", async () => {
    const r3 = ok(await inv(pm, "createReorderRequest", need()), "create").reorderRequestId;
    ok(await inv(pm, "reviewReorderRequest", { reorderRequestId: r3, decision: "APPROVED" }), "approve");
    ok(await inv(pm, "assignReorderRequest", { reorderRequestId: r3, employeeId: "e-pa" }), "assign");
    // A capable non-assignee (the Parts Manager) cannot start the Parts Associate's work.
    refused(await inv(pm, "startPurchasingOnReorder", { reorderRequestId: r3 }), 403, "FORBIDDEN", "manager cannot start");
    ok(await inv(pa, "startPurchasingOnReorder", { reorderRequestId: r3 }), "start");
    const po = { reorderRequestId: r3, supplierName: "Desert Refrigeration Supply", externalPoNumber: "PO-77003", orderedQuantity: 6, orderedDate: "2026-10-01" };
    ok(await inv(pa, "recordReorderPurchaseOrder", po), "record PO");
    const before = (await one(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id = $1 AND target_id = $2`, [TENANT, r3])).n;
    refused(await inv(pa, "recordReorderPurchaseOrder", po), 412, "PRECONDITION_FAILED", "duplicate PO / replay");
    assert.equal((await one(`SELECT count(*)::int n FROM eos_ops.purchase_orders WHERE tenant_id = $1 AND id = $2`, [TENANT, r3])).n, 1, "no duplicate PO");
    assert.equal((await one(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id = $1 AND target_id = $2`, [TENANT, r3])).n, before, "no duplicate audit");
    // Void is the Parts Manager's management exception -- not the assignee's.
    refused(await inv(pa, "voidReorderPurchaseOrder", { reorderRequestId: r3, voidReason: "supplier cancelled" }), 403, "FORBIDDEN", "associate cannot void");
    ok(await inv(pm, "voidReorderPurchaseOrder", { reorderRequestId: r3, voidReason: "supplier cancelled the order" }), "manager voids");
    assert.equal(await status(r3), "VOIDED");
    refused(await inv(pa, "receiveReorderStock", receipt(r3)), 412, "PRECONDITION_FAILED", "voided PO receipt");
    // AUTO-FIX G6: a second void is a business refusal (412), never a 500; nothing more is written.
    const voids = (await one(`SELECT count(*)::int n FROM eos_ops.purchase_order_voids WHERE tenant_id = $1 AND purchase_order_id = $2`, [TENANT, r3])).n;
    refused(await inv(pm, "voidReorderPurchaseOrder", { reorderRequestId: r3, voidReason: "again" }), 412, "PRECONDITION_FAILED", "second void");
    assert.equal((await one(`SELECT count(*)::int n FROM eos_ops.purchase_order_voids WHERE tenant_id = $1 AND purchase_order_id = $2`, [TENANT, r3])).n, voids, "one void record");
    // Cancelled before ordering: no PO exists, nothing is receivable.
    const r4 = ok(await inv(pm, "createReorderRequest", need()), "create").reorderRequestId;
    ok(await inv(pm, "reviewReorderRequest", { reorderRequestId: r4, decision: "APPROVED" }), "approve");
    ok(await inv(pm, "cancelReorderRequest", { reorderRequestId: r4, cancellationReason: "need resolved by transfer" }), "cancel");
    assert.equal(await status(r4), "CANCELLED");
    const cr = await inv(pa, "receiveReorderStock", receipt(r4));
    assert.ok(cr.status >= 400 && cr.status < 500, `cancelled request receipt refused ${JSON.stringify(cr.body)}`);
    // Direct closeout is refused: Receiving is the only receipt path.
    refused(await inv(pa, "markReorderReceived", { reorderRequestId: r4 }), 412, "PRECONDITION_FAILED", "markReorderReceived");
  });

  await t.test("RECEIVING NEGATIVES: over / partial / wrong part / wrong or inactive warehouse / unknown bin / serialized / duplicate / concurrent / idempotency conflict", async () => {
    const rcv = await toOrdered();
    const pre = await movements("PRT-FAN");
    refused(await inv(pa, "receiveReorderStock", receipt(rcv, { lines: [{ lineId: "L1", partId: "PRT-FAN", receivedQuantity: 7 }] })), 412, "PRECONDITION_FAILED", "over-receipt");
    const partial = await inv(pa, "receiveReorderStock", receipt(rcv, { idempotencyKey: `p-${rcv}`, lines: [{ lineId: "L1", partId: "PRT-FAN", receivedQuantity: 3 }] }));
    assert.ok(partial.status >= 400 && partial.status < 500, `OBSERVED partial receipt of a Reorder PO is refused (full-quantity only) ${JSON.stringify(partial.body)}`);
    const wrongPart = await inv(pa, "receiveReorderStock", receipt(rcv, { idempotencyKey: `wp-${rcv}`, lines: [{ lineId: "L1", partId: "PRT-COMP", receivedQuantity: 6 }] }));
    assert.ok(wrongPart.status >= 400 && wrongPart.status < 500, `wrong item refused ${JSON.stringify(wrongPart.body)}`);
    for (const [loc, what] of [[{ type: "WAREHOUSE", locationId: "wh-closed" }, "inactive warehouse"], [{ type: "WAREHOUSE", locationId: "wh-nowhere" }, "unknown warehouse"],
      [{ type: "BIN", locationId: "bin-nowhere" }, "unknown bin"]]) {
      const r = await inv(pa, "receiveReorderStock", receipt(rcv, { idempotencyKey: `loc-${what}-${rcv}`, receivingLocation: loc }));
      assert.ok(r.status >= 400 && r.status < 500, `${what} refused ${JSON.stringify(r.body)}`);
    }
    assert.deepEqual(await movements("PRT-FAN"), pre, "no refused receipt moved stock");
    // AUTO-FIX DQ-017: the receiver must hold WAREHOUSE scope over the destination -- the clerk's scope is wh-phx only.
    refused(await inv(pa, "receiveReorderStock", receipt(rcv, { idempotencyKey: `tuc-${rcv}`, receivingLocation: { type: "WAREHOUSE", locationId: "wh-tuc" } })),
      403, "FORBIDDEN", "receipt into a warehouse outside the receiver's scope");
    assert.deepEqual(await movements("PRT-FAN"), pre, "still nothing moved");
    // Concurrent receipt on one ORDERED Reorder with two different keys: exactly one wins.
    const rc2 = await toOrdered();
    const both = await Promise.all([inv(pa, "receiveReorderStock", receipt(rc2, { idempotencyKey: `c1-${rc2}` })), inv(pa, "receiveReorderStock", receipt(rc2, { idempotencyKey: `c2-${rc2}` }))]);
    assert.equal(both.filter((r) => r.status === 200).length, 1, `one concurrent receipt wins ${JSON.stringify(both.map((r) => [r.status, r.body.code]))}`);
    assert.equal((await q(`SELECT 1 FROM eos_ops.receiving_orders WHERE tenant_id = $1 AND source_reorder_request_id = $2`, [TENANT, rc2])).rows.length, 1, "one receipt");
    // The same key with a different payload is a conflict, never a second receipt.
    const conflict = await inv(pa, "receiveReorderStock", receipt(rc2, { idempotencyKey: both.find((r) => r.status === 200) === both[0] ? `c1-${rc2}` : `c2-${rc2}`, lines: [{ lineId: "L1", partId: "PRT-FAN", receivedQuantity: 5 }] }));
    assert.ok(conflict.status === 409 || conflict.status === 400 || conflict.status === 412, `payload conflict refused ${JSON.stringify(conflict.body)}`);
    // Serialized: serials are required and recorded as custody, one movement per unit.
    const rs = await toOrdered({ partId: "PRT-COMP", requestedQuantity: 2 });
    const noSerial = await inv(pa, "receiveReorderStock", receipt(rs, { lines: [{ lineId: "L1", partId: "PRT-COMP", receivedQuantity: 2 }] }));
    assert.ok(noSerial.status >= 400 && noSerial.status < 500, `serials required ${JSON.stringify(noSerial.body)}`);
    ok(await inv(pa, "receiveReorderStock", receipt(rs, { idempotencyKey: `s-${rs}`, lines: [{ lineId: "L1", partId: "PRT-COMP", receivedQuantity: 2, serialNumbers: ["CMP-1001", "CMP-1002"] }] })), "serialized receipt");
    assert.equal((await movements("PRT-COMP")).length, 2, "one movement per serialized unit");
    assert.equal((await one(`SELECT count(*)::int n FROM eos_ops.serialized_custody WHERE tenant_id = $1 AND part_id = $2`, [TENANT, "PRT-COMP"])).n, 2, "custody per serial");
  });

  await t.test("REQUEST NEGATIVES: company / warehouse / part / duplicate -- what create enforces today", async () => {
    refused(await inv(pm, "createReorderRequest", { ...need(), operatingCompanyId: "ventana" }), 400, "INVALID_INPUT", "R-13 caller-supplied company");
    for (const [wh, what] of [["wh-closed", "inactive warehouse"], ["wh-nowhere", "unknown warehouse"], ["wh-unbound", "warehouse with no bound company"]]) {
      const r = await inv(pm, "createReorderRequest", need({ warehouseId: wh }));
      assert.ok(r.status >= 400 && r.status < 500, `${what} refused ${JSON.stringify(r.body)}`);
    }
    // AUTO-FIX G3: the Part must be a governed, ACTIVE Part of this tenant (receiving refuses both anyway).
    const before = (await one(`SELECT count(*)::int n FROM eos_ops.reorder_requests WHERE tenant_id = $1`, [TENANT])).n;
    refused(await inv(pm, "createReorderRequest", need({ partId: "PRT-DOES-NOT-EXIST" })), 404, "NOT_FOUND", "unknown part");
    refused(await inv(pm, "createReorderRequest", need({ partId: "PRT-OBSOLETE" })), 412, "PRECONDITION_FAILED", "inactive part");
    assert.equal((await one(`SELECT count(*)::int n FROM eos_ops.reorder_requests WHERE tenant_id = $1`, [TENANT])).n, before, "nothing written");
    // OBSERVED (gaps G1/G2): no duplicate guard and no create idempotency.
    const a = await inv(pm, "createReorderRequest", need({ partId: "PRT-FAN", warehouseId: "wh-tuc" }));
    const b = await inv(pm, "createReorderRequest", need({ partId: "PRT-FAN", warehouseId: "wh-tuc" }));
    t.diagnostic(`OBSERVED duplicate open request for the same part+warehouse -> ${a.status}, ${b.status}`);
  });
});
