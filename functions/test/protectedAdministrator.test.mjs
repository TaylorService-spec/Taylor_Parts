// THE PROTECTED ADMINISTRATOR'S SYSTEM AUTHORITY (DECISIONS #223) -- the pure rule, no store.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pa = require("../lib/adminPolicy/protectedAdministrator.js");

const ROLES = [{ key: "admin", protected: true }, { key: "owner", protected: true }, { key: "technician", protected: false }];
const cap = (key, objectKey, actionKind) => ({ key, objectKey, actionKind });

test("standing: the designated, PROTECTED admin Role, held globally, and never alongside the protected Owner", () => {
  assert.equal(pa.hasProtectedAdministratorStanding(ROLES, ["admin"]), true);
  assert.equal(pa.hasProtectedAdministratorStanding(ROLES, ["admin", "technician"]), true);
  assert.equal(pa.hasProtectedAdministratorStanding(ROLES, ["technician"]), false);
  assert.equal(pa.hasProtectedAdministratorStanding(ROLES, ["owner"]), false, "the Owner is a distinct authority type");
  assert.equal(pa.hasProtectedAdministratorStanding(ROLES, ["admin", "owner"]), false, "dual membership confers no standing");
  assert.equal(pa.hasProtectedAdministratorStanding([{ key: "admin", protected: true }, { key: "owner", protected: false }], ["admin", "owner"]), false,
    "a damaged Owner row never opens standing (fail closed)");
  assert.equal(pa.hasProtectedAdministratorStanding([{ key: "admin", protected: false }], ["admin"]), false, "an unprotected admin Role confers nothing");
  assert.equal(pa.hasProtectedAdministratorStanding([], ["admin"]), false, "an unknown Role confers nothing (fail closed)");
  assert.equal(pa.hasProtectedAdministratorStanding([{ key: "administrator", protected: true }], ["administrator"]), false, "never by display name or another key");
});

test("implied: ADMIN_ACTION and READ everywhere, every action on a system-administration Object -- never a business act", () => {
  const implied = (c) => pa.isImpliedForProtectedAdministrator(c);
  assert.equal(implied(cap("admin.securityPolicy.write", "rolesPermissions", "ADMIN_ACTION")), true);
  assert.equal(implied(cap("warehouse.record.manage", "warehouse", "ADMIN_ACTION")), true);
  assert.equal(implied(cap("workflowDefinition.create", "workflowDefinition", "CREATE")), true, "a system Object: every action");
  assert.equal(implied(cap("workflowDefinition.edit", "workflowDefinition", "EDIT")), true);
  assert.equal(implied(cap("admin.employeeProfile.write", "employee", "EDIT")), true);
  assert.equal(implied(cap("finance.payment.read", "payment", "READ")), true, "inspect, company-wide");
  // Business approval, financial execution and operational execution keep their existing authorization (O1).
  for (const c of [cap("reorder.request.startPurchasing", "reorderRequest", "BUSINESS_ACTION"),
    cap("finance.settlement.record", "settlement", "BUSINESS_ACTION"),
    cap("inventory.stock.receive", "receivingOrder", "BUSINESS_ACTION"),
    cap("workOrder.lifecycle.complete", "workOrder", "BUSINESS_ACTION"),
    cap("workOrder.create", "workOrder", "CREATE"),
    cap("salesAgreement.edit", "salesAgreement", "EDIT")]) {
    assert.equal(implied(c), false, c.key);
  }
  // Exclusions, whatever the kind.
  assert.equal(implied(cap("reorder.request.read.queue", "reorderRequest", "READ")), false, "SUPERSEDED, never grantable");
  assert.equal(implied(cap("salesAgreement.tradeIn.approve", "salesAgreement", "BUSINESS_ACTION")), false, "Owner/GM approval");
});

test("the nine approved management actions are implied (O1 ADMIN, G2, G3; #227); no WORKER key ever is", () => {
  const implied = (key) => pa.isImpliedForProtectedAdministrator(cap(key, key.split(".")[0], "BUSINESS_ACTION"));
  const NINE = ["equipment.record.manage", "rental.fleet.manage", "reorder.request.approve", "reorder.request.reject", "reorder.request.cancel",
    "reorder.request.assign", "reorder.purchaseOrder.void", "inventory.receipt.correct", "ownership.handoff.correct"];
  assert.deepEqual([...pa.PROTECTED_ADMINISTRATOR_MANAGEMENT_CAPABILITIES].sort(), [...NINE].sort(), "exactly the nine; changing it is an Owner decision");
  for (const key of NINE) assert.equal(implied(key), true, key);
  const { ADMINISTRATOR_EXECUTION_CAPABILITIES } = require("../lib/eosOps/administrationReach.js");
  for (const key of ADMINISTRATOR_EXECUTION_CAPABILITIES) {
    assert.equal(pa.PROTECTED_ADMINISTRATOR_MANAGEMENT_CAPABILITIES.has(key), false, `${key}: WORKER, never management`);
    assert.equal(implied(key), false, `${key} is never implied`);
  }
  assert.equal(implied("salesAgreement.tradeIn.approve"), false, "G7 stays reserved");
  // O1 KEEP: business approval and financial execution keep their grants.
  for (const key of ["finance.settlement.record", "finance.settlement.apply", "salesAgreement.accept", "workOrder.lifecycle.close", "rental.charge.record"]) {
    assert.equal(implied(key), false, key);
  }
  // Without standing nothing is implied, the nine included.
  assert.deepEqual([...pa.protectedAdministratorImpliedKeys(ROLES, ["partsManager"], NINE.map((k) => cap(k, "x", "BUSINESS_ACTION")))], []);
});

test("future-proof: a newly registered system-administration capability is implied with no grant; a new business act is not", () => {
  const catalog = [cap("newSystemObject.configure", "newSystemObject", "ADMIN_ACTION"), cap("newBusiness.execute", "newBusiness", "BUSINESS_ACTION"),
    cap("newBusiness.read", "newBusiness", "READ")];
  assert.deepEqual([...pa.protectedAdministratorImpliedKeys(ROLES, ["admin"], catalog)].sort(), ["newBusiness.read", "newSystemObject.configure"]);
  assert.deepEqual([...pa.protectedAdministratorImpliedKeys(ROLES, ["technician"], catalog)], [], "no standing, nothing implied");
});

test("audit provenance: merged into `after` as authorizedBy, never overwriting a more specific one", () => {
  const authority = pa.PROTECTED_ADMINISTRATOR_AUTHORITY;
  assert.deepEqual(pa.afterWithActorAuthority({ id: "x" }, authority), { id: "x", authorizedBy: authority });
  const r1 = { id: "x", authorizedBy: { capabilityKey: "admin.administratorRole.assign" } };
  assert.equal(pa.afterWithActorAuthority(r1, authority), r1, "the R1 staffing record stays");
  assert.equal(pa.afterWithActorAuthority(null, authority), null);
  assert.deepEqual(pa.afterWithActorAuthority({ id: "x" }, undefined), { id: "x" }, "no standing, nothing added");
  assert.deepEqual(pa.actorAuthorityOf({ protectedAdministrator: true }), { actorAuthority: authority });
  assert.deepEqual(pa.actorAuthorityOf({ protectedAdministrator: false }), {});
  assert.deepEqual(pa.actorAuthorityOf(undefined), {});
});
