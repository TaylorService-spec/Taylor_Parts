// ROLE COMPANY-AUTHORITY CLASSIFICATION -- the governed write (DECISIONS #248), offline (no database).
//
// Whether an operatingCompany-scoped assignment of a Role names the company in general company authority (OPERATIONAL)
// or supplies Finance reach only (FINANCE_ONLY) is DATA on the Role, written only by updateRole. These proofs cover the
// governance of that write; the effect on company authority and Finance reach is financeOnlyCompanyAccessPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryPolicyRepository } from "../lib/adminPolicy/inMemoryPolicyRepository.js";
import { bootstrapTenant, bootstrapAdministrator, ensureTenantPrincipal } from "../lib/adminPolicy/tenantBootstrap.js";
import { executeAdminOperation } from "../lib/adminPolicy/adminPolicyApi.js";
import * as commands from "../lib/adminPolicy/policyCommands.js";
import {
  ROLE_COMPANY_AUTHORITY_EFFECTS, financeOnlyClassificationRefusal, isFinanceCapabilityKey, isRoleCompanyAuthorityEffect,
} from "../lib/adminPolicy/roleCompanyAuthorityEffect.js";

const OPERATOR = "operator-rcae";
const ADMIN_SUBJECT = "uid-rcae-admin";
const REASON = "FINANCE ONLY classification proof";

const CAPABILITIES = [
  { key: "admin.securityPolicy.write", description: "", objectKey: "rolesPermissions", actionKey: "editSecurityPolicy", actionKind: "ADMIN_ACTION", displayLabel: "Edit Security Policy" },
  { key: "admin.roleAssignment.write", description: "", objectKey: "rolesPermissions", actionKey: "assignRole", actionKind: "ADMIN_ACTION", displayLabel: "Assign Role" },
  { key: "finance.payment.read", description: "", objectKey: "financePayment", actionKey: "read", actionKind: "READ", displayLabel: "View Payments" },
  { key: "finance.policy.prepare", description: "", objectKey: "financePolicy", actionKey: "prepare", actionKind: "BUSINESS_ACTION", displayLabel: "Prepare Financial Policy" },
  { key: "workOrder.record.read", description: "", objectKey: "workOrder", actionKey: "read", actionKind: "READ", displayLabel: "View Work Order" },
];

async function world() {
  const repo = new InMemoryPolicyRepository();
  repo.registerCapabilities(CAPABILITIES);
  const { tenant } = await bootstrapTenant(repo, { key: "rcae-offline", name: "RCAE", actorUid: OPERATOR });
  const boot = await bootstrapAdministrator(repo, { tenantId: tenant.id, externalSubject: ADMIN_SUBJECT, performedBy: OPERATOR, reason: "initial administrator" });
  const plain = await ensureTenantPrincipal(repo, { tenantId: tenant.id, externalSubject: "uid-rcae-plain", actorUid: OPERATOR, actorRoleKeys: ["admin"] });
  const plainId = plain.principal?.id ?? plain.id ?? plain.principalId;
  const admin = { tenantId: tenant.id, uid: boot.principal.id, heldRoleKeys: ["admin"] };
  const call = (operation, input, subject = ADMIN_SUBJECT) =>
    executeAdminOperation({ repo }, { caller: { externalSubject: subject }, operation, input, requestId: "req-rcae" });
  for (const [key, label] of [["financePayment", "Payment"], ["financePolicy", "Financial Policy"]]) {
    await repo.transact({ tenantId: tenant.id, uid: OPERATOR }, (tx) => tx.createObject({
      key, label, labelPlural: `${label}s`, description: null, origin: "SYSTEM", lifecycle: "ACTIVE", supportsDelete: false }));
  }
  const tenantId = tenant.id;
  const mkRole = async (key) => (await commands.createRole(repo, admin, { key, name: key }));
  const grant = (roleKey, objectKey, actionKey) => commands.grantObjectActionToRole(repo, admin, { roleKey, objectKey, actionKey, reason: REASON });
  const audits = async () => (await repo.listAuditEvents(tenantId, 10000)).filter((e) => e.action === "updateRole");
  return { repo, tenantId, admin, plainId, call, mkRole, grant, audits };
}

test("the vocabulary is closed and the Finance family is exactly finance.*", () => {
  assert.deepEqual([...ROLE_COMPANY_AUTHORITY_EFFECTS], ["OPERATIONAL", "FINANCE_ONLY"]);
  assert.equal(isRoleCompanyAuthorityEffect("FINANCE_ONLY"), true);
  for (const bad of ["finance_only", "", null, undefined, 1, "ALL"]) assert.equal(isRoleCompanyAuthorityEffect(bad), false, String(bad));
  assert.equal(isFinanceCapabilityKey("finance.payment.read"), true);
  assert.equal(isFinanceCapabilityKey("financeX.read"), false, "a prefix, not a substring");
  assert.equal(isFinanceCapabilityKey("workOrder.record.read"), false);
  assert.match(financeOnlyClassificationRefusal([]), /holds no capability/);
  assert.match(financeOnlyClassificationRefusal(["finance.payment.read", "workOrder.record.read"]), /workOrder\.record\.read/);
  assert.equal(financeOnlyClassificationRefusal(["finance.payment.read", "finance.policy.prepare"]), null);
});

test("a new Role is OPERATIONAL; FINANCE_ONLY needs a Role that holds finance.* only", async () => {
  const { call, mkRole, grant } = await world();
  const role = await mkRole("financeAccess");
  assert.equal(role.companyAuthorityEffect, "OPERATIONAL", "the default preserves every existing assignment");

  // No capability yet: nothing to classify.
  let r = await call("updateRole", { roleId: role.id, companyAuthorityEffect: "FINANCE_ONLY", reason: REASON });
  assert.deepEqual([r.ok, r.code], [false, "CONFLICT"]);
  assert.match(r.message, /FINANCE_ONLY_CLASSIFICATION_REFUSED/);

  // A mixed Role stays OPERATIONAL.
  await grant("financeAccess", "financePayment", "read");
  await grant("financeAccess", "workOrder", "read");
  r = await call("updateRole", { roleId: role.id, companyAuthorityEffect: "FINANCE_ONLY", reason: REASON });
  assert.deepEqual([r.ok, r.code], [false, "CONFLICT"]);
  assert.match(r.message, /workOrder\.record\.read/);
});

test("classification is audited with before/after, needs a STATED reason, and a repeat is no mutation", async () => {
  const { repo, tenantId, call, mkRole, grant, audits } = await world();
  const role = await mkRole("financeAccess");
  await grant("financeAccess", "financePayment", "read");
  const before = (await audits()).length;

  // The request id alone is not a reason.
  let r = await call("updateRole", { roleId: role.id, companyAuthorityEffect: "FINANCE_ONLY" });
  assert.deepEqual([r.ok, r.code], [false, "INVALID_INPUT"]);
  assert.match(r.message, /REASON_REQUIRED/);
  assert.equal((await repo.getRoleByKey(tenantId, "financeAccess")).companyAuthorityEffect, "OPERATIONAL");
  assert.equal((await audits()).length, before, "a refused change writes no audit event");

  r = await call("updateRole", { roleId: role.id, companyAuthorityEffect: "FINANCE_ONLY", reason: REASON });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal((await repo.getRoleByKey(tenantId, "financeAccess")).companyAuthorityEffect, "FINANCE_ONLY");
  const events = await audits();
  assert.equal(events.length, before + 1, "exactly one audit event");
  const event = events.at(-1);
  assert.equal(event.targetId, role.id);
  assert.equal(event.before.companyAuthorityEffect, "OPERATIONAL");
  assert.equal(event.after.companyAuthorityEffect, "FINANCE_ONLY");
  assert.match(event.reason, /FINANCE ONLY classification proof/);

  // The same value again: no write, no audit event.
  r = await call("updateRole", { roleId: role.id, companyAuthorityEffect: "FINANCE_ONLY", reason: REASON });
  assert.equal(r.ok, true);
  assert.equal((await audits()).length, before + 1);

  // A rename does not carry the classification into its audit shape.
  r = await call("updateRole", { roleId: role.id, name: "Financials Company Access", reason: REASON });
  assert.equal(r.ok, true);
  const rename = (await audits()).at(-1);
  assert.equal("companyAuthorityEffect" in rename.before, false);
  assert.equal((await repo.getRoleByKey(tenantId, "financeAccess")).companyAuthorityEffect, "FINANCE_ONLY");
});

test("an invalid value is refused; nothing is written", async () => {
  const { repo, tenantId, call, mkRole, grant } = await world();
  const role = await mkRole("financeAccess");
  await grant("financeAccess", "financePayment", "read");
  for (const bad of ["finance_only", "NONE", 7, null]) {
    const r = await call("updateRole", { roleId: role.id, companyAuthorityEffect: bad, reason: REASON });
    assert.deepEqual([r.ok, r.code], [false, "INVALID_INPUT"], String(bad));
  }
  assert.equal((await repo.getRoleByKey(tenantId, "financeAccess")).companyAuthorityEffect, "OPERATIONAL");
});

test("UNGOVERNED: only Administration changes the classification -- no authority, no change, no audit", async () => {
  const { repo, tenantId, call, mkRole, grant, audits } = await world();
  const role = await mkRole("financeAccess");
  await grant("financeAccess", "financePayment", "read");
  const before = (await audits()).length;
  const res = await call("updateRole", { roleId: role.id, companyAuthorityEffect: "FINANCE_ONLY", reason: REASON }, "uid-rcae-plain");
  assert.deepEqual([res.ok, res.code], [false, "FORBIDDEN"]);
  assert.equal((await repo.getRoleByKey(tenantId, "financeAccess")).companyAuthorityEffect, "OPERATIONAL");
  assert.equal((await audits()).length, before);
});

test("a FINANCE_ONLY Role takes no non-finance capability; reclassify first", async () => {
  const { repo, tenantId, call, mkRole, grant } = await world();
  const role = await mkRole("financeAccess");
  await grant("financeAccess", "financePayment", "read");
  assert.equal((await call("updateRole", { roleId: role.id, companyAuthorityEffect: "FINANCE_ONLY", reason: REASON })).ok, true);

  await assert.rejects(() => grant("financeAccess", "workOrder", "read"), /FINANCE_ONLY_ROLE_NON_FINANCE_CAPABILITY/);
  await grant("financeAccess", "financePolicy", "prepare"); // another finance.* key is fine
  const held = (await repo.listRoleCapabilities(tenantId, [role.id])).length;
  assert.equal(held, 2, "the refused grant wrote nothing");

  // Reclassifying to OPERATIONAL is the explicit, audited step that precedes it.
  assert.equal((await call("updateRole", { roleId: role.id, companyAuthorityEffect: "OPERATIONAL", reason: REASON })).ok, true);
  await grant("financeAccess", "workOrder", "read");
  const again = await call("updateRole", { roleId: role.id, companyAuthorityEffect: "FINANCE_ONLY", reason: REASON });
  assert.deepEqual([again.ok, again.code], [false, "CONFLICT"], "a Role that now carries operational authority cannot be FINANCE_ONLY");
});

test("a protected Role's classification is fixed, and nobody widens a Role they hold", async () => {
  const { repo, tenantId, admin, call, mkRole, grant } = await world();
  const adminRole = await repo.getRoleByKey(tenantId, "admin");
  const protectedChange = await call("updateRole", { roleId: adminRole.id, companyAuthorityEffect: "FINANCE_ONLY", reason: REASON });
  assert.equal(protectedChange.ok, false);
  assert.match(protectedChange.message, /protected|FINANCE_ONLY_CLASSIFICATION_REFUSED/);
  assert.equal((await repo.getRoleByKey(tenantId, "admin")).companyAuthorityEffect, "OPERATIONAL");

  // The administrator may classify a Role it does not hold, but may not WIDEN one it holds (the grant rule).
  const held = await mkRole("heldFinance");
  await grant("heldFinance", "financePayment", "read");
  assert.equal((await call("updateRole", { roleId: held.id, companyAuthorityEffect: "FINANCE_ONLY", reason: REASON })).ok, true);
  await repo.transact({ tenantId, uid: OPERATOR }, (tx) => tx.createAssignment({
    principalId: admin.uid, roleId: held.id, scopeType: "global", scopeValue: null, status: "active",
    grantedBy: OPERATOR, grantedAt: new Date().toISOString(), accessVersionAtGrant: 0 }));
  const widen = await call("updateRole", { roleId: held.id, companyAuthorityEffect: "OPERATIONAL", reason: REASON });
  assert.deepEqual([widen.ok, widen.code], [false, "FORBIDDEN"]);
  assert.match(widen.message, /SELF_ADMINISTRATION/);
  assert.equal((await repo.getRoleByKey(tenantId, "heldFinance")).companyAuthorityEffect, "FINANCE_ONLY");
});
