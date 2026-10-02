// GOVERNED SUPPLIER ADMINISTRATION (Controller 2026-10-02; DECISIONS #196) over the Operations transport, real PostgreSQL.
// CRM organization -> supplier relationship -> governed PO supplier identity. Reused authority (DECISIONS #78):
// inventory.catalog.manage (create / update) + inventory.catalog.activate (activate / deactivate). No Firebase.
// Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";

const require = createRequire(import.meta.url);
const admin = require("../lib/eosOps/supplierAdministration.js");
const authority = require("../lib/eosOps/reorderAssignmentAuthority.js");
const partsDelta = require("../lib/adminPolicy/partsPurchasingReceivingDelta.js");
const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-supadm";
const INV = "/operations/inventory";

test("13 / parity: no Firebase; the normalized key is the Supplier Master's own definition", () => {
  const src = readFileSync(new URL("../src/eosOps/supplierAdministration.ts", import.meta.url), "utf8");
  assert.equal(/from ["'][^"']*firebase/i.test(src), false);
  const legacy = require("../lib/supplierMaster/supplierMasterValidation.js");
  for (const n of ["Arctic Parts Supply", "  ColdChain -- Components, Inc. ", "ÄCME/West", "", "a  b"]) {
    assert.equal(admin.normalizeSupplierName(n), legacy.normalizeSupplierName(n), n);
  }
});

test("supplier administration over the governed path", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin: adm, person, call } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "supadm" });
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const inv = (who, operation, input) => call(who, INV, operation, input);
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`); return r.body.result; };
  const refused = (r, status, category, message, what = "") => {
    assert.deepEqual([r.status, r.body.code], [status, category], `${what} ${JSON.stringify(r.body)}`);
    if (message) assert.match(r.body.message, message, what);
  };
  const grant = async (roleKey, key) => {
    const c = await one(`SELECT object_key, action_key FROM eos_policy.capabilities WHERE key = $1`, [key]);
    assert.equal((await adm("grantObjectActionToRole", { roleKey, objectKey: c.object_key, actionKey: c.action_key, reason: "local test tenant" })).ok, true);
  };
  for (const key of ["reorder.request.approve", "reorder.request.assign", "reorder.request.read"]) await grant("partsManager", key);
  for (const key of ["reorder.request.create.manual", "reorder.request.read", "reorder.request.recordPurchaseOrder", "reorder.request.startPurchasing"]) await grant("partsAssociate", key);
  for (const { operation, input } of partsDelta.partsPurchasingReceivingOperations().filter((o) => o.input.objectKey === "supplier")) {
    assert.equal((await adm(operation, input)).ok, true);
  }

  // The ordinary holders, as accepted governance has them: the admin Role holds catalog manage + activate (DECISIONS #78);
  // the Parts Manager holds catalog manage only; an associate / technician holds neither.
  const administrator = await person("uid-sadmin", ["admin"]);
  const pm = await person("uid-pm", ["partsManager", "purchasingManager"], { id: "e-pm", name: "Morgan PM" });
  const pa = await person("uid-pa", ["partsAssociate", "inventoryReceivingClerk"], { id: "e-pa", name: "Pat PA" });
  const tech = await person("uid-tech", ["technician"], { id: "e-tech", name: "Tara Tech", technician: true });

  // CRM organizations (the identity) -- governed as VENDOR, or not.
  for (const [id, name, vendor, status] of [["acct-arctic", "Arctic Parts Supply (SAMPLE)", true, "ACTIVE"], ["acct-cold", "ColdChain Components (SAMPLE)", true, "ACTIVE"],
    ["acct-cust", "A Customer Only", false, "ACTIVE"], ["acct-gone", "Closed Vendor", true, "INACTIVE"]]) {
    await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ($1,$2,$3,$4,'fixture','fixture')`, [id, TENANT, name, status]);
    if (vendor) await q(`INSERT INTO eos_crm.account_relationship_types (tenant_id, account_id, relationship_type) VALUES ($1,$2,'VENDOR')`, [TENANT, id]);
  }
  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
           VALUES ('wh-s',$1,'taylor','Taylor Main','Taylor Main','ACTIVE','NATIVE','fixture','fixture')`, [TENANT]);
  await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
             expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
           VALUES ('P-1',$1,'fixture','P-1','P-1','ACTIVE','EACH','STANDARD','STOCKED',false,false,false,false,1,'fixture'),
                  ('P-2',$1,'fixture','P-2','P-2','ACTIVE','EACH','STANDARD','STOCKED',false,false,false,false,1,'fixture')`, [TENANT]);
  for (const e of ["e-pa", "e-pm"]) {
    await q(`INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by) VALUES ($1,$2,$3,$4,now(),'fixture')`,
      [`ewe-${e}`, TENANT, e, authority.REORDER_ASSIGNMENT_QUALIFICATION]);
    for (const [kind, id] of [["REORDER_QUEUE", "taylor"], ["WAREHOUSE", "wh-s"]]) {
      await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
               VALUES ($1,$2,$3,$4,$5,now(),'fixture')`, [`os-${e}-${kind}`, TENANT, e, kind, id]);
    }
  }
  let n = 0;
  const toPurchasing = async (partId) => {
    const rr = ok(await inv(pa, "createReorderRequest", { partId, warehouseId: "wh-s", requestedQuantity: 1, recommendationStatus: "BELOW_MIN",
      quantitySource: "MANUAL", idempotencyKey: `rr-${++n}` }), "create").reorderRequestId;
    ok(await inv(pm, "reviewReorderRequest", { reorderRequestId: rr, decision: "APPROVED" }), "approve");
    ok(await inv(pm, "assignReorderRequest", { reorderRequestId: rr, employeeId: "e-pa" }), "assign");
    ok(await inv(pa, "startPurchasingOnReorder", { reorderRequestId: rr }), "start");
    return rr;
  };
  const po = (rr, supplierId) => inv(pa, "recordReorderPurchaseOrder", { reorderRequestId: rr, supplier: { kind: "EXTERNAL_ORGANIZATION", supplierId },
    externalPoNumber: `PO-${rr.slice(-5)}`, orderedQuantity: 1, orderedDate: "2026-10-02", unitPriceMinor: 100, currency: "USD" });

  await t.test("1 / 2 / 11 / 12. UAT-SUP-001: the administrator creates sup-arcticparts and sup-coldchain from CRM organizations, by the organization's name", async () => {
    const options = ok(await inv(administrator, "listSupplierOrganizationOptions", {}), "organizations");
    assert.deepEqual(options.items.map((o) => o.crmAccountId), ["acct-arctic", "acct-cold"], "ACTIVE VENDOR organizations without a supplier -- not a customer-only or inactive one");
    const a = ok(await inv(administrator, "createSupplier", { supplierId: "sup-arcticparts", crmAccountId: "acct-arctic", vendorNumber: "V-100",
      contactName: "Orders Desk", email: "orders@arcticparts.invalid" }), "create arctic");
    assert.deepEqual([a.outcome, a.supplier.name, a.supplier.status, a.supplier.crmAccountId, a.supplier.version], ["created", "Arctic Parts Supply (SAMPLE)", "ACTIVE", "acct-arctic", 1]);
    const c = ok(await inv(pm, "createSupplier", { supplierId: "sup-coldchain", crmAccountId: "acct-cold" }), "create coldchain (Parts Manager: catalog manage)");
    assert.equal(c.supplier.name, "ColdChain Components (SAMPLE)");
    assert.equal((await one(`SELECT normalized_key FROM eos_ops.suppliers WHERE tenant_id=$1 AND supplier_id='sup-coldchain'`, [TENANT])).normalized_key, "coldchain components sample");
    const audit = await one(`SELECT actor_uid, action FROM eos_policy.audit_events WHERE tenant_id=$1 AND target_kind='supplier' AND target_id='sup-arcticparts'`, [TENANT]);
    assert.deepEqual([audit.actor_uid, audit.action], [administrator.principalId, "supplier.create"]);
    assert.equal(ok(await inv(administrator, "createSupplier", { supplierId: "sup-arcticparts", crmAccountId: "acct-arctic", vendorNumber: "V-100",
      contactName: "Orders Desk", email: "orders@arcticparts.invalid" }), "replay").outcome, "replayed");
  });

  await t.test("3 / 4. UAT-SUP-002: duplicate relationships and invalid organizations are refused", async () => {
    refused(await inv(administrator, "createSupplier", { supplierId: "sup-arctic-2", crmAccountId: "acct-arctic" }), 409, "CONFLICT", /already has a supplier/);
    refused(await inv(administrator, "createSupplier", { supplierId: "sup-arcticparts", crmAccountId: "acct-cold" }), 409, "CONFLICT", /different supplier/);
    refused(await inv(administrator, "createSupplier", { supplierId: "sup-x", crmAccountId: "acct-nowhere" }), 404, "NOT_FOUND", /no CRM organization/);
    refused(await inv(administrator, "createSupplier", { supplierId: "sup-x", crmAccountId: "acct-cust" }), 412, "PRECONDITION_FAILED", /not governed as a VENDOR/);
    refused(await inv(administrator, "createSupplier", { supplierId: "sup-x", crmAccountId: "acct-gone" }), 412, "PRECONDITION_FAILED", /not ACTIVE/);
    refused(await inv(administrator, "createSupplier", { supplierId: "sup-x", crmAccountId: "acct-cold", name: "Typed Name" }), 400, "INVALID_INPUT", /does not accept: name/,
      "organization identity is never typed a second time");
  });

  await t.test("UAT-SUP-003: a new PO names the governed supplier; operational fields update with optimistic concurrency", async () => {
    const rr = await toPurchasing("P-1");
    ok(await po(rr, "sup-arcticparts"), "PO with the governed supplier");
    assert.equal((await one(`SELECT supplier_name FROM eos_ops.purchase_orders WHERE tenant_id=$1 AND id=$2`, [TENANT, rr])).supplier_name, "Arctic Parts Supply (SAMPLE)");
    const u = ok(await inv(pm, "updateSupplier", { supplierId: "sup-arcticparts", expectedVersion: 1, phone: "602-555-0100", notes: null }), "update");
    assert.deepEqual([u.supplier.phone, u.supplier.version], ["602-555-0100", 2]);
    refused(await inv(pm, "updateSupplier", { supplierId: "sup-arcticparts", expectedVersion: 1, phone: "x" }), 409, "CONFLICT", /changed since/);
    refused(await inv(pm, "updateSupplier", { supplierId: "sup-arcticparts", expectedVersion: 2, crmAccountId: "acct-cold" }), 400, "INVALID_INPUT", /does not accept/);
  });

  await t.test("5 / 6 / 7 / 8. UAT-SUP-004: deactivation takes the supplier off new POs; history stays readable; reactivation restores it", async () => {
    refused(await inv(pm, "setSupplierStatus", { supplierId: "sup-arcticparts", status: "INACTIVE", expectedVersion: 2, reason: "x" }), 403, "FORBIDDEN",
      /inventory\.catalog\.activate/, "status is the activate authority, not catalog manage");
    const d = ok(await inv(administrator, "setSupplierStatus", { supplierId: "sup-arcticparts", status: "INACTIVE", expectedVersion: 2, reason: "vendor paused (UAT)" }), "deactivate");
    assert.deepEqual([d.outcome, d.supplier.status], ["deactivated", "INACTIVE"]);
    const rr = await toPurchasing("P-2");
    const choices = ok(await inv(pa, "listPurchaseOrderSupplierOptions", { reorderRequestId: rr }), "options");
    assert.equal(choices.items.some((o) => o.supplierId === "sup-arcticparts"), false, "an inactive supplier is not offered");
    refused(await po(rr, "sup-arcticparts"), 412, "PRECONDITION_FAILED", /not ACTIVE/, "and cannot be named on a new PO");
    const history = ok(await inv(pa, "readReorderPurchaseOrders", { reorderRequestIds: (await q(`SELECT id FROM eos_ops.purchase_orders WHERE tenant_id=$1`, [TENANT])).rows.map((r) => r.id) }), "history");
    assert.equal(history.purchaseOrders[0].supplierName, "Arctic Parts Supply (SAMPLE)", "the historical PO is unchanged and readable");
    assert.equal((await one(`SELECT count(*)::int n FROM eos_ops.suppliers WHERE tenant_id=$1 AND supplier_id='sup-arcticparts'`, [TENANT])).n, 1, "never deleted");
    const r = ok(await inv(administrator, "setSupplierStatus", { supplierId: "sup-arcticparts", status: "ACTIVE", expectedVersion: 3, reason: "vendor resumed (UAT)" }), "reactivate");
    assert.equal(r.supplier.status, "ACTIVE");
    ok(await po(rr, "sup-arcticparts"), "selectable again");
  });

  await t.test("9 / 10. UAT-SUP-005: an ordinary employee cannot manage suppliers; holders change through Administration alone", async () => {
    for (const who of [pa, tech]) {
      refused(await inv(who, "createSupplier", { supplierId: "sup-y", crmAccountId: "acct-cold" }), 403, "FORBIDDEN", /inventory\.catalog\.manage/);
      refused(await inv(who, "setSupplierStatus", { supplierId: "sup-coldchain", status: "INACTIVE", expectedVersion: 1, reason: "x" }), 403, "FORBIDDEN");
      refused(await inv(who, "listSupplierOrganizationOptions", {}), 403, "FORBIDDEN");
    }
    // No source edit: an Administration grant of the activate authority to the Parts Manager Role lets it deactivate; a revoke removes it.
    const cap = { roleKey: "partsManager", objectKey: "part", actionKey: "activate" };
    assert.equal((await adm("grantObjectActionToRole", { ...cap, reason: "administration acceptance" })).ok, true);
    assert.equal(ok(await inv(pm, "setSupplierStatus", { supplierId: "sup-coldchain", status: "INACTIVE", expectedVersion: 1, reason: "UAT" }), "after grant").outcome, "deactivated");
    assert.equal((await adm("revokeObjectActionFromRole", { ...cap, reason: "administration acceptance" })).ok, true);
    refused(await inv(pm, "setSupplierStatus", { supplierId: "sup-coldchain", status: "ACTIVE", expectedVersion: 2, reason: "UAT" }), 403, "FORBIDDEN");
  });
});
