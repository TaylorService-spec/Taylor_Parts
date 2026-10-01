// SECURITY ROLE ASSIGNMENT SCOPE -- offline proofs (no database). Lane SC.
//
//   1. The scope model: which types the runtime decides, from which record fact, for which capabilities.
//   2. The ONE decision procedure (authorizeEntitledAction) with scoped holdings: in scope / outside / no context /
//      unconsumed type; a scoped holding's grant condition still narrows; GLOBAL decisions are byte-identical.
//   3. Administration: assignRole refuses every scope the runtime would ignore; values are tenant-scoped; Roles with
//      Administration authority are never scoped; the served vocabulary lists unsupported types with reasons.
// The PostgreSQL half (acceptance E-H, concurrency, explainEffectiveAccess parity) is
// assignmentScopeRuntimePostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InMemoryPolicyRepository } from "../lib/adminPolicy/inMemoryPolicyRepository.js";
import { bootstrapTenant, bootstrapAdministrator, ensureTenantPrincipal } from "../lib/adminPolicy/tenantBootstrap.js";
import { executeAdminOperation } from "../lib/adminPolicy/adminPolicyApi.js";
import * as scope from "../lib/adminPolicy/assignmentScopeRuntime.js";
import { VALUE_MATCHED_SCOPE_TYPES } from "../lib/adminPolicy/assignmentScope.js";
import { authorizeEntitledAction, ENTITLED_ACTION_OUTCOMES } from "../lib/eosOps/conditionalEntitlement.js";
import { snapshotContextualReader } from "../lib/eosOps/contextualAuthorization.js";

// ════════════════════ 1. the model ════════════════════

test("the runtime decides operatingCompany and salesChannel; businessUnit and location are known but unconsumed", () => {
  assert.deepEqual([...scope.ASSIGNMENT_SCOPE_RUNTIME_TYPES], ["operatingCompany", "businessUnit", "location", "salesChannel"]);
  assert.ok(scope.ASSIGNMENT_SCOPE_RUNTIME_TYPES.every((t) => VALUE_MATCHED_SCOPE_TYPES.includes(t)), "a subset of the value-matched vocabulary");
  assert.deepEqual([...scope.runtimeSupportedScopeTypes()], ["operatingCompany", "salesChannel"]);
  // Lane GA: sales channel scopes the three Commercial READ keys only -- no write key is evaluable at a channel.
  assert.deepEqual(scope.SCOPE_EVALUABLE_GRANTS.map((g) => [g.scopeType, g.capabilityKey]), [
    ["operatingCompany", "employee.record.read"],
    ["salesChannel", "opportunity.read"], ["salesChannel", "salesAgreement.read"], ["salesChannel", "salesOrder.read"],
    // DQ-020: the Commercial writes, decided against the governing channel of the record each command writes.
    ["salesChannel", "opportunity.write"], ["salesChannel", "opportunity.createSalesOrder"], ["salesChannel", "salesAgreement.create"],
    ["salesChannel", "salesAgreement.updateDraft"], ["salesChannel", "salesAgreement.accept"], ["salesChannel", "salesOrder.write"],
    // EQUIPMENT ACTIVATION (OD-3): a seller reads customer Equipment only through its channel's commercial relationship.
    ["salesChannel", "equipment.record.read"]]);
  for (const g of scope.SCOPE_EVALUABLE_GRANTS.filter((x) => x.scopeType === "salesChannel")) {
    const domain = g.capabilityKey.startsWith("equipment.") ? "equipment." : "commercial.";
    assert.ok(g.consumers.length > 0 && g.consumers.every((c) => c.startsWith(domain)), g.capabilityKey);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(scope.ASSIGNMENT_SCOPE_DIMENSIONS).map(([k, d]) => [k, [d.label, d.contextKey]])),
    { operatingCompany: ["Company", "operatingCompanyId"], businessUnit: ["Business Unit", "businessUnit"], location: ["Warehouse", "warehouseId"],
      salesChannel: ["Sales Channel", "salesChannel"] });
  for (const t of ["businessUnit", "location", "domain", "tenant", "ownAssignment", "global"]) {
    assert.equal(scope.isRuntimeSupportedScopeType(t), false, t);
    assert.ok(scope.UNSUPPORTED_SCOPE_REASONS[t], `${t} has a stated reason`);
  }
  const src = readFileSync(new URL("../src/adminPolicy/assignmentScopeRuntime.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  // A channel is a governed VALUE, never code: no channel literal and no per-channel Role anywhere in the model.
  assert.doesNotMatch(src, /NATIONAL_ACCOUNTS|RETAIL|STRATEGIC_ACCOUNTS|RetailSalesManager|NationalAccountsSalesManager/);
  assert.doesNotMatch(src, /\.query\s*\(|from "pg"|firebase/i, "the scope model is pure");
});

test("holdingAdmits: a sales-channel holding admits only the record's exact stored channel", () => {
  const h = { capabilityKey: "opportunity.read", scopeType: "salesChannel", scopeValue: "RETAIL" };
  assert.equal(scope.holdingAdmits(h, { salesChannel: "RETAIL" }), "ADMITTED");
  assert.equal(scope.holdingAdmits(h, { salesChannel: "NATIONAL_ACCOUNTS" }), "OUTSIDE_ASSIGNMENT_SCOPE");
  for (const ctx of [undefined, {}, { salesChannel: "" }, { operatingCompanyId: "RETAIL" }]) {
    assert.equal(scope.holdingAdmits(h, ctx), "SCOPE_CONTEXT_REQUIRED", JSON.stringify(ctx));
  }
  assert.equal(scope.holdingAdmits({ ...h, capabilityKey: "opportunity.create" }, { salesChannel: "RETAIL" }), "SCOPE_NOT_EVALUABLE");
  assert.deepEqual([...scope.admittedScopeValues([h, { ...h, scopeValue: "NATIONAL_ACCOUNTS" }, { ...h, scopeValue: "STRATEGIC_ACCOUNTS", condition: {} }]
    .map((x) => ({ condition: null, sourceRole: "salesManager", assignmentId: null, ...x })), "opportunity.read", "salesChannel")],
    ["NATIONAL_ACCOUNTS", "RETAIL"], "both channels of one manager; a conditioned holding never widens a list");
});

test("holdingAdmits: exact same-type value only; everything else fails closed", () => {
  const h = { capabilityKey: "employee.record.read", scopeType: "operatingCompany", scopeValue: "taylor" };
  assert.equal(scope.holdingAdmits(h, { operatingCompanyId: "taylor" }), "ADMITTED");
  assert.equal(scope.holdingAdmits(h, { operatingCompanyId: "ventana" }), "OUTSIDE_ASSIGNMENT_SCOPE");
  assert.equal(scope.holdingAdmits(h, { operatingCompanyId: "Taylor" }), "OUTSIDE_ASSIGNMENT_SCOPE");
  for (const ctx of [undefined, null, {}, { businessUnit: "taylor" }, { operatingCompanyId: "" }, { operatingCompanyId: " taylor" }, { operatingCompanyId: 7 }]) {
    assert.equal(scope.holdingAdmits(h, ctx), "SCOPE_CONTEXT_REQUIRED", JSON.stringify(ctx));
  }
  assert.equal(scope.holdingAdmits({ ...h, capabilityKey: "customer.record.read" }, { operatingCompanyId: "taylor" }), "SCOPE_NOT_EVALUABLE");
  assert.equal(scope.holdingAdmits({ ...h, scopeType: "businessUnit", scopeValue: "SERVICE" }, { businessUnit: "SERVICE" }), "SCOPE_NOT_EVALUABLE");
  assert.equal(scope.holdingAdmits({ ...h, scopeType: "location", scopeValue: "WH" }, { warehouseId: "WH" }), "SCOPE_NOT_EVALUABLE");
  assert.equal(scope.holdingAdmits({ ...h, scopeValue: "" }, { operatingCompanyId: "" }), "SCOPE_NOT_EVALUABLE");
});

test("scopedHoldingsFrom: only evaluable capabilities become holdings; the rest is reported inert", () => {
  const { held, inert } = scope.scopedHoldingsFrom(
    [{ assignmentId: "a1", roleKey: "reader", scopeType: "operatingCompany", scopeValue: "taylor" },
      { assignmentId: "a2", roleKey: "reader", scopeType: "domain", scopeValue: "inventory" },
      { assignmentId: "a3", roleKey: "reader", scopeType: "operatingCompany", scopeValue: null }],
    [{ roleKey: "reader", capabilityKey: "employee.record.read" }, { roleKey: "reader", capabilityKey: "customer.record.read" },
      { roleKey: "other", capabilityKey: "employee.record.read" }],
    (roleKey, key) => (key === "employee.record.read" ? null : { paths: [] }),
  );
  assert.deepEqual(held.map((h) => [h.capabilityKey, h.scopeType, h.scopeValue, h.sourceRole, h.assignmentId, h.condition]),
    [["employee.record.read", "operatingCompany", "taylor", "reader", "a1", null]]);
  assert.deepEqual(inert.map((i) => [i.capabilityKey, i.scopeType, i.reason]).sort(), [
    ["customer.record.read", "domain", "SCOPE_TYPE_UNSUPPORTED"],
    ["customer.record.read", "operatingCompany", "SCOPE_NOT_EVALUABLE_FOR_CAPABILITY"],
    ["customer.record.read", "operatingCompany", "SCOPE_TYPE_UNSUPPORTED"],
    ["employee.record.read", "domain", "SCOPE_TYPE_UNSUPPORTED"],
    ["employee.record.read", "operatingCompany", "SCOPE_TYPE_UNSUPPORTED"],
  ].sort());
  assert.deepEqual([...scope.admittedScopeValues([...held, { ...held[0], scopeValue: "ventana", condition: { paths: [] } }],
    "employee.record.read", "operatingCompany")], ["taylor"], "a conditioned scoped holding never widens a list");
});

// ════════════════════ 2. the one decision procedure ════════════════════

const KEY = "employee.record.read";
const reader = (dims = { employeeId: "emp-1", workEligibility: ["SERVICE_TECHNICIAN"], operationalScopes: [] }) => snapshotContextualReader(dims);
const holding = (over = {}) => ({ capabilityKey: KEY, scopeType: "operatingCompany", scopeValue: "taylor", sourceRole: "companyReader",
  assignmentId: "a1", condition: null, ...over });
const actor = (over = {}) => ({ tenantId: "t", principalId: "p", capabilities: new Set(), entitlements: () => [], ...over });

test("A scoped holding: admitted only in its scope; no context / other value / unconsumed type refuse", async () => {
  const a = actor({ scopedHeld: [holding()] });
  const inScope = await authorizeEntitledAction(reader(), { actor: a, capabilityKey: KEY, businessContext: { operatingCompanyId: "taylor" } });
  assert.deepEqual([inScope.allowed, inScope.outcome, inScope.viaGrantor, inScope.viaScope, inScope.viaCondition],
    [true, "ALLOWED", { kind: "ROLE", roleKey: "companyReader" }, { scopeType: "operatingCompany", scopeValue: "taylor" }, false]);
  const outside = await authorizeEntitledAction(reader(), { actor: a, capabilityKey: KEY, businessContext: { operatingCompanyId: "ventana" } });
  assert.deepEqual([outside.allowed, outside.outcome, outside.viaGrantor], [false, "OUTSIDE_ASSIGNMENT_SCOPE", null]);
  const none = await authorizeEntitledAction(reader(), { actor: a, capabilityKey: KEY });
  assert.deepEqual([none.allowed, none.outcome], [false, "SCOPE_CONTEXT_REQUIRED"]);
  const bu = await authorizeEntitledAction(reader(), { actor: actor({ scopedHeld: [holding({ scopeType: "businessUnit", scopeValue: "SERVICE" })] }),
    capabilityKey: KEY, businessContext: { businessUnit: "PARTS" } });
  assert.deepEqual([bu.allowed, bu.outcome], [false, "SCOPE_NOT_EVALUABLE"], "(F) outside -- and inside -- a business unit: no consumer");
  const other = await authorizeEntitledAction(reader(), { actor: a, capabilityKey: "customer.record.read", businessContext: { operatingCompanyId: "taylor" } });
  assert.equal(other.outcome, "CAPABILITY_MISSING", "a holding is for ITS capability only");
  // The obligation still applies to a scoped-only actor.
  const noResolver = await authorizeEntitledAction(reader(), { actor: { ...a, entitlements: [] }, capabilityKey: KEY, businessContext: { operatingCompanyId: "taylor" } });
  assert.equal(noResolver.outcome, "CONTEXT_AUTHORITY_UNAVAILABLE");
  for (const o of ["OUTSIDE_ASSIGNMENT_SCOPE", "SCOPE_CONTEXT_REQUIRED", "SCOPE_NOT_EVALUABLE"]) assert.ok(ENTITLED_ACTION_OUTCOMES.includes(o));
});

test("a scoped holding's grant CONDITION still narrows inside the scope", async () => {
  const conditioned = holding({ condition: { paths: [[{ kind: "WORK_ELIGIBILITY", qualificationCode: "SERVICE_TECHNICIAN" }]] } });
  const a = actor({ scopedHeld: [conditioned] });
  const eligible = await authorizeEntitledAction(reader(), { actor: a, capabilityKey: KEY, businessContext: { operatingCompanyId: "taylor" } });
  assert.deepEqual([eligible.allowed, eligible.viaCondition, eligible.contextEvaluated], [true, true, true]);
  const notEligible = await authorizeEntitledAction(reader({ employeeId: "emp-1", workEligibility: [], operationalScopes: [] }),
    { actor: a, capabilityKey: KEY, businessContext: { operatingCompanyId: "taylor" } });
  assert.deepEqual([notEligible.allowed, notEligible.outcome], [false, "WORK_ELIGIBILITY_MISSING"]);
  const outside = await authorizeEntitledAction(reader(), { actor: a, capabilityKey: KEY, businessContext: { operatingCompanyId: "ventana" } });
  assert.deepEqual([outside.allowed, outside.outcome, outside.contextEvaluated], [false, "OUTSIDE_ASSIGNMENT_SCOPE", false], "scope first, no context read");
});

test("GLOBAL decisions are byte-identical with or without scoped holdings and business context", async () => {
  const unconditional = [{ grantor: { kind: "ROLE", roleKey: "reader" }, capabilityKey: KEY, condition: null }];
  const base = actor({ capabilities: new Set([KEY]), entitlements: () => unconditional });
  const before = await authorizeEntitledAction(reader(), { actor: base, capabilityKey: KEY });
  for (const variant of [
    { actor: { ...base, scopedHeld: [holding({ scopeValue: "ventana" })] }, businessContext: { operatingCompanyId: "taylor" } },
    { actor: { ...base, scopedHeld: [] }, businessContext: { operatingCompanyId: "nowhere" } },
    { actor: base, businessContext: { businessUnit: "SERVICE" } },
  ]) {
    assert.deepEqual(await authorizeEntitledAction(reader(), { capabilityKey: KEY, ...variant }), before);
  }
  assert.equal("viaScope" in before, false);
  // A key held by nobody: unchanged refusal.
  const missing = await authorizeEntitledAction(reader(), { actor: actor(), capabilityKey: KEY });
  assert.deepEqual([missing.outcome, missing.contextEvaluated], ["CAPABILITY_MISSING", false]);
  // Held globally through a CONDITION that refuses, and scoped in taylor: the scope admits a taylor record only.
  const conditionedGlobal = actor({ conditionallyHeld: new Set([KEY]), scopedHeld: [holding()],
    entitlements: () => [{ grantor: { kind: "ROLE", roleKey: "g" }, capabilityKey: KEY,
      condition: { paths: [[{ kind: "WORK_ELIGIBILITY", qualificationCode: "WAREHOUSE_OPERATIONS" }]] } }] });
  const inTaylor = await authorizeEntitledAction(reader(), { actor: conditionedGlobal, capabilityKey: KEY, businessContext: { operatingCompanyId: "taylor" } });
  assert.deepEqual([inTaylor.allowed, inTaylor.viaScope?.scopeValue], [true, "taylor"]);
  const inVentana = await authorizeEntitledAction(reader(), { actor: conditionedGlobal, capabilityKey: KEY, businessContext: { operatingCompanyId: "ventana" } });
  assert.deepEqual([inVentana.allowed, inVentana.outcome], [false, "OUTSIDE_ASSIGNMENT_SCOPE"]);
  assert.ok(inVentana.denials.some((d) => d.outcome === "WORK_ELIGIBILITY_MISSING"), "the global denial is kept");
  // A global path that could not be consulted is never rescued by a scope.
  const outage = actor({ capabilities: new Set([KEY]), scopedHeld: [holding()], entitlements: () => { throw new Error("down"); } });
  const d = await authorizeEntitledAction(reader(), { actor: outage, capabilityKey: KEY, businessContext: { operatingCompanyId: "taylor" } });
  assert.deepEqual([d.allowed, d.outcome], [false, "CONTEXT_AUTHORITY_UNAVAILABLE"]);
});

// ════════════════════ 3. Administration ════════════════════

const CAPABILITIES = [
  { key: "admin.securityPolicy.write", description: "", objectKey: "rolesPermissions", actionKey: "editSecurityPolicy", actionKind: "ADMIN_ACTION", displayLabel: "Edit" },
  { key: "admin.roleAssignment.write", description: "", objectKey: "rolesPermissions", actionKey: "assignRole", actionKind: "ADMIN_ACTION", displayLabel: "Assign" },
  { key: "admin.principalAccess.read", description: "", objectKey: "users", actionKey: "read", actionKind: "READ", displayLabel: "View" },
  { key: "employee.record.read", description: "", objectKey: "employee", actionKey: "read", actionKind: "READ", displayLabel: "View Employees" },
  { key: "customer.record.read", description: "", objectKey: "account", actionKey: "read", actionKind: "READ", displayLabel: "View Customers" },
  { key: "opportunity.read", description: "", objectKey: "opportunity", actionKey: "read", actionKind: "READ", displayLabel: "View Opportunities" },
];

let CAP_IDS;
async function world() {
  const repo = new InMemoryPolicyRepository();
  CAP_IDS = new Map(repo.registerCapabilities(CAPABILITIES).map((c) => [c.key, c.id]));
  const { tenant } = await bootstrapTenant(repo, { key: "scope-offline", name: "S", actorUid: "op" });
  const other = (await bootstrapTenant(repo, { key: "scope-other", name: "O", actorUid: "op" })).tenant;
  await bootstrapAdministrator(repo, { tenantId: tenant.id, externalSubject: "uid-admin", performedBy: "op", reason: "boot" });
  repo.setAssignmentScopeValues(tenant.id, "operatingCompany", [{ value: "taylor", label: "Taylor" }, { value: "ventana", label: "Ventana" }]);
  repo.setAssignmentScopeValues(other.id, "operatingCompany", [{ value: "northco", label: "North" }]);
  repo.setAssignmentScopeValues(tenant.id, "salesChannel", [{ value: "NATIONAL_ACCOUNTS", label: "National Accounts" }, { value: "RETAIL", label: "Retail" }]);
  const call = (operation, input) => executeAdminOperation({ repo }, { caller: { externalSubject: "uid-admin" }, operation, input, requestId: "r" });
  const target = await ensureTenantPrincipal(repo, { tenantId: tenant.id, externalSubject: "uid-target", actorUid: "op", actorRoleKeys: ["admin"] });
  const targetId = target.principal?.id ?? target.id ?? target.principalId;
  // Role grants as fixture rows (the in-memory tenant carries no governed Objects to grant through).
  const capId = (key) => CAP_IDS.get(key);
  const grant = async (roleKey, capabilityKey) => {
    const role = await repo.getRoleByKey(tenant.id, roleKey);
    await repo.transact({ tenantId: tenant.id, uid: "op" }, (tx) => tx.grantRoleCapability({
      roleId: role.id, capabilityId: capId(capabilityKey), grantedBy: "fixture", grantedAt: new Date().toISOString() }));
  };
  await grant("admin", "admin.principalAccess.read");
  for (const [key, caps] of [["companyReader", ["employee.record.read", "customer.record.read"]], ["customerOnly", ["customer.record.read"]],
    ["channelLead", ["opportunity.read", "customer.record.read"]]]) {
    const made = await call("createRole", { key, name: key, reason: "fixture" });
    assert.equal(made.ok, true, JSON.stringify(made));
    for (const c of caps) await grant(key, c);
  }
  const roleId = async (key) => (await repo.getRoleByKey(tenant.id, key)).id;
  return { repo, tenantId: tenant.id, call, targetId, roleId };
}

test("assignRole: only a consumed scope, a governed value of THIS tenant, an evaluable non-administration Role", async () => {
  const w = await world();
  const reader = await w.roleId("companyReader");
  const assign = (input) => w.call("assignRole", { principalId: w.targetId, reason: "scope", ...input });
  const good = await assign({ roleId: reader, scopeType: "operatingCompany", scopeValue: "taylor" });
  assert.equal(good.ok, true, JSON.stringify(good));
  const refused = async (input, code) => {
    const r = await assign(input);
    assert.deepEqual([r.ok, r.code], [false, "INVALID_INPUT"], JSON.stringify(r));
    assert.match(r.message, new RegExp(`^${code}`));
  };
  await refused({ roleId: reader, scopeType: "businessUnit", scopeValue: "SERVICE" }, "SCOPE_TYPE_UNSUPPORTED");
  await refused({ roleId: reader, scopeType: "location", scopeValue: "WH-1" }, "SCOPE_TYPE_UNSUPPORTED");
  // Lane GA: salesChannel is decided, against THIS tenant's activated channels, for a Role carrying a Commercial read.
  await refused({ roleId: reader, scopeType: "salesChannel", scopeValue: "RETAIL" }, "SCOPE_NOT_EVALUABLE_FOR_ROLE");
  await refused({ roleId: await w.roleId("channelLead"), scopeType: "salesChannel", scopeValue: "STRATEGIC_ACCOUNTS" }, "SCOPE_VALUE_INVALID");
  await refused({ roleId: await w.roleId("channelLead"), scopeType: "salesChannel", scopeValue: "retail" }, "SCOPE_VALUE_INVALID");
  for (const channel of ["RETAIL", "NATIONAL_ACCOUNTS"]) {
    const both = await assign({ roleId: await w.roleId("channelLead"), scopeType: "salesChannel", scopeValue: channel });
    assert.equal(both.ok, true, JSON.stringify(both));
  }
  // businessUnit has no tenant-governed value source, and is not decided: refused before any value is consulted.
  await refused({ roleId: reader, scopeType: "operatingCompany", scopeValue: "northco" }, "SCOPE_VALUE_INVALID");
  await refused({ roleId: reader, scopeType: "operatingCompany" }, "SCOPE_VALUE_INVALID");
  await refused({ roleId: reader, scopeType: "global", scopeValue: "taylor" }, "SCOPE_VALUE_INVALID");
  await refused({ roleId: await w.roleId("customerOnly"), scopeType: "operatingCompany", scopeValue: "taylor" }, "SCOPE_NOT_EVALUABLE_FOR_ROLE");
  await refused({ roleId: await w.roleId("admin"), scopeType: "operatingCompany", scopeValue: "taylor" }, "SCOPE_AMBIGUOUS_ADMINISTRATION");
  // A store with no governed source for the type refuses rather than accepting an unvalidated value.
  const bare = new InMemoryPolicyRepository();
  const { refuseUnsupportedAssignmentScope } = await import("../lib/adminPolicy/policyCommands.js");
  await assert.rejects(refuseUnsupportedAssignmentScope(bare, "t", { id: "r", key: "r", protected: false }, "operatingCompany", "taylor"),
    /SCOPE_VALUE_INVALID/);
  // Global stays exactly as before.
  const globalOk = await assign({ roleId: reader });
  assert.equal(globalOk.ok, true);
  assert.deepEqual([globalOk.data.scopeType, globalOk.data.scopeValue], ["global", null]);
});

test("listSupportedAssignmentScopes: every type listed, unsupported with its reason; per-Role scoped vs inert capabilities", async () => {
  const w = await world();
  const r = await w.call("listSupportedAssignmentScopes", {});
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.scopeTypes.map((s) => [s.scopeType, s.supported]), [
    ["global", true], ["operatingCompany", true], ["businessUnit", false], ["location", false], ["salesChannel", true],
    ["domain", false], ["tenant", false], ["ownAssignment", false]]);
  assert.deepEqual(r.data.scopeTypes[1].values.map((v) => v.value), ["taylor", "ventana"]);
  assert.deepEqual(r.data.scopeTypes[4].values.map((v) => v.value), ["NATIONAL_ACCOUNTS", "RETAIL"]);
  assert.deepEqual(r.data.scopeTypes[2].values, [], "businessUnit offers no value: no tenant-governed source");
  const sm = r.data.roles.find((x) => x.roleKey === "channelLead").assignableScopes.find((a) => a.scopeType === "salesChannel");
  assert.deepEqual([sm.assignable, sm.scopedCapabilities, sm.inertCapabilities], [true, ["opportunity.read"], ["customer.record.read"]]);
  const reader = r.data.roles.find((x) => x.roleKey === "companyReader").assignableScopes[0];
  assert.deepEqual([reader.scopeType, reader.assignable, reader.scopedCapabilities, reader.inertCapabilities],
    ["operatingCompany", true, ["employee.record.read"], ["customer.record.read"]]);
  assert.equal(r.data.roles.find((x) => x.roleKey === "admin").assignableScopes[0].refusal, "SCOPE_AMBIGUOUS_ADMINISTRATION");
  assert.equal((await w.call("listSupportedAssignmentScopes", { roleKey: "nope" })).code, "INVALID_INPUT");
});
