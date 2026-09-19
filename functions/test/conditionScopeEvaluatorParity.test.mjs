// Authorization v2 evaluator parity: the `isOwnAssignment` condition and Security Role assignment SCOPE.
//
// Two authorities that the PostgreSQL evaluator previously could not express, which is why
// roleAssignmentCensus.ts refuses to migrate a conditioned or scoped assignment. Both are proved here to NARROW and
// never to widen: every new rule below is a refusal, and the admitting cases are the behaviour that already existed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const scope = require("../lib/adminPolicy/assignmentScope.js");
const conditioned = require("../lib/adminPolicy/conditionedCapability.js");
const access = require("../lib/adminPolicy/effectiveObjectAccess.js");

const VOID = "reorder.purchaseOrder.void";
const ACTOR = "p-eos-actor";
const OTHER = "p-eos-other";

const input = (over = {}) => ({
  actorPrincipalId: ACTOR,
  heldRoleKeys: ["admin"],
  heldCapabilities: new Set([VOID]),
  capabilityKey: VOID,
  target: { assignedToPrincipalId: ACTOR },
  ...over,
});

// ════════════════════ A. isOwnAssignment ════════════════════

test("A: capability + the actor's OWN assignment is allowed, on every Role that carries the Condition", () => {
  for (const roleKey of ["admin", "dispatcher", "owner"]) {
    const d = conditioned.decideConditionedCapability(input({ heldRoleKeys: [roleKey] }));
    assert.deepEqual([d.outcome, d.allowed, d.conditioned, d.viaRoleKey], ["ALLOWED", true, true, roleKey], roleKey);
  }
});

test("A: capability + a DIFFERENT assignment is refused -- holding the capability is not enough", () => {
  const d = conditioned.decideConditionedCapability(input({ target: { assignedToPrincipalId: OTHER } }));
  assert.deepEqual([d.outcome, d.allowed], ["NOT_OWN_ASSIGNMENT", false]);
  // The refusal names the gate, and discloses nothing about the record.
  assert.doesNotMatch(JSON.stringify(d), new RegExp(OTHER));
});

test("A: an UNASSIGNED record refuses -- 'no assignee' is not 'anyone'", () => {
  for (const target of [{ assignedToPrincipalId: null }, { assignedToPrincipalId: "" }, { assignedToPrincipalId: " " }, {}]) {
    const d = conditioned.decideConditionedCapability(input({ target }));
    assert.equal(d.allowed, false, JSON.stringify(target));
    assert.equal(d.outcome, "NOT_OWN_ASSIGNMENT");
  }
  // No target resolved at all is its own refusal, so a caller that forgot to load the record cannot pass by omission.
  const none = conditioned.decideConditionedCapability(input({ target: null }));
  assert.deepEqual([none.outcome, none.allowed], ["TARGET_REQUIRED", false]);
});

test("A: the assignment WITHOUT the capability is refused, and the target is never consulted", () => {
  // Being the assignee confers nothing: security capability remains the FIRST boundary.
  const d = conditioned.decideConditionedCapability(input({ heldCapabilities: new Set() }));
  assert.deepEqual([d.outcome, d.allowed, d.conditioned], ["CAPABILITY_REQUIRED", false, false]);
  // A capability PostgreSQL reports but no held catalog Role grants proves nothing either.
  const disagreement = conditioned.decideConditionedCapability(input({ heldRoleKeys: ["technician"] }));
  assert.deepEqual([disagreement.outcome, disagreement.allowed], ["CAPABILITY_REQUIRED", false]);
  const noRoles = conditioned.decideConditionedCapability(input({ heldRoleKeys: [] }));
  assert.equal(noRoles.outcome, "CAPABILITY_REQUIRED");
});

test("A: a SPOOFED actor or assignee cannot widen access -- the comparison is Principal id to Principal id", () => {
  // The only inputs are governed ids the caller resolved server-side. There is no field shaped like a claim, a uid,
  // a tenant selector or a precomputed verdict, so naming one changes nothing.
  for (const spoof of [
    { uid: ACTOR }, { claims: { uid: ACTOR } }, { isOwnAssignment: true }, { allowed: true },
    { tenantId: "t-other" }, { assignedToUserId: ACTOR }, { conditionResult: true },
  ]) {
    const d = conditioned.decideConditionedCapability(input({ target: { assignedToPrincipalId: OTHER, ...spoof } }));
    assert.equal(d.allowed, false, `spoof widened access: ${JSON.stringify(spoof)}`);
  }
  // A Firebase uid is not a Principal id, and cannot satisfy the predicate by resembling one.
  const uid = conditioned.decideConditionedCapability(input({ actorPrincipalId: "firebase-uid-actor" }));
  assert.equal(uid.allowed, false);
});

test("A: ONLY isOwnAssignment is implemented -- every other ConditionKind fails closed", () => {
  assert.deepEqual([...conditioned.SUPPORTED_CONDITION_KINDS], ["isOwnAssignment"]);
  const roles = {
    custom: { permissions: [VOID], conditionsByPermission: { [VOID]: [{ kind: "operationalRoleActive", params: { role: "PARTS_ASSOCIATE" } }] } },
  };
  for (const kind of ["operationalRoleActive", "employmentActive", "statusEquals", "statusIn", "somethingNew"]) {
    roles.custom.conditionsByPermission[VOID] = [{ kind, params: {} }];
    const d = conditioned.decideConditionedCapability(input({ heldRoleKeys: ["custom"] }), roles);
    assert.deepEqual([d.outcome, d.allowed], ["UNSUPPORTED_CONDITION", false], kind);
  }
});

test("A: multi-role UNION, and an unconditioned grant on a held Role allows -- which is why Void conditions all three", () => {
  const roles = {
    conditionedRole: { permissions: [VOID], conditionsByPermission: { [VOID]: [{ kind: "isOwnAssignment", params: {} }] } },
    plainRole: { permissions: [VOID], conditionsByPermission: {} },
  };
  const both = conditioned.decideConditionedCapability(
    input({ heldRoleKeys: ["conditionedRole", "plainRole"], target: { assignedToPrincipalId: OTHER } }), roles);
  assert.equal(both.allowed, true, "an unconditioned grant on a held Role must allow");
  // Exactly why the catalog attaches the Condition to admin, dispatcher AND owner: one bare grant would defeat it.
  //
  // The conditioned set is WIDER than the one Kind this evaluator implements: seven Reorder capabilities carry
  // operationalRoleActive on `technician`. They are conditioned and therefore not migratable either -- but their
  // disposition is BUSINESS_ELIGIBILITY_SCOPE, so they are answered by Work Eligibility and Operational Scope, never
  // by an evaluator Condition. Listing them here keeps that distinction visible rather than implied.
  assert.deepEqual(conditioned.conditionedCapabilityKeys(), [
    "reorder.purchaseOrder.create", "reorder.purchaseOrder.read", VOID, "reorder.request.markReceived",
    "reorder.request.postPurchasingUpdate", "reorder.request.read.own", "reorder.request.recordPurchaseOrder",
    "reorder.request.startPurchasing",
  ]);
  // And every one of those seven refuses here, because this evaluator implements only isOwnAssignment.
  const eligibility = conditioned.decideConditionedCapability(input({
    heldRoleKeys: ["technician"], capabilityKey: "reorder.request.read.own",
    heldCapabilities: new Set(["reorder.request.read.own"]),
  }));
  assert.deepEqual([eligibility.outcome, eligibility.allowed], ["UNSUPPORTED_CONDITION", false]);
});

// ════════════════════ B. assignment scope ════════════════════

const globalA = { roleId: "r-global", scopeType: "global", scopeValue: null };
const phoenix = { roleId: "r-phoenix", scopeType: "location", scopeValue: "loc-phoenix" };
const tucson = { roleId: "r-tucson", scopeType: "location", scopeValue: "loc-tucson" };

test("B: a GLOBAL grant behaves globally; a scoped grant never escapes its scope", () => {
  assert.equal(scope.assignmentAdmitsDecision(globalA, null), true);
  assert.equal(scope.assignmentAdmitsDecision(globalA, { scopeType: "location", scopeValue: "loc-phoenix" }), true);

  // In its own scope: admitted. Anywhere else, including with NO scope stated: refused.
  assert.equal(scope.assignmentAdmitsDecision(phoenix, { scopeType: "location", scopeValue: "loc-phoenix" }), true);
  assert.equal(scope.assignmentAdmitsDecision(phoenix, { scopeType: "location", scopeValue: "loc-tucson" }), false);
  assert.equal(scope.assignmentAdmitsDecision(phoenix, null), false, "a scoped grant escaped into an unscoped decision");
  // Same value, different scope TYPE is a mismatch, not a match.
  assert.equal(scope.assignmentAdmitsDecision(phoenix, { scopeType: "domain", scopeValue: "loc-phoenix" }), false);
});

test("B: reserved, record-shaped, unknown and value-less scopes all fail closed", () => {
  for (const scopeType of ["tenant", "ownAssignment", "somethingNew", "", "GLOBAL"]) {
    const a = { roleId: "r", scopeType, scopeValue: "anything" };
    assert.equal(scope.assignmentAdmitsDecision(a, null), false, scopeType);
    assert.equal(scope.assignmentAdmitsDecision(a, { scopeType, scopeValue: "anything" }), false, scopeType);
  }
  // A scoped assignment with no usable value matches nothing rather than matching everything.
  for (const scopeValue of [null, "", " loc ", undefined]) {
    assert.equal(scope.assignmentAdmitsDecision({ roleId: "r", scopeType: "location", scopeValue }, { scopeType: "location", scopeValue: "loc" }), false);
  }
  assert.equal(scope.assignmentAdmitsDecision({ roleId: "r", scopeType: "location", scopeValue: "loc" }, { scopeType: "location", scopeValue: "" }), false);
});

test("B: the evaluator consumes scope -- global-only without a scope, and scoped grants only inside theirs", () => {
  const objects = [{ id: "o1", key: "reorderRequest", supportsDelete: false }];
  const cred = (r) => ({ C: false, R: true, E: r, D: false });
  const policy = {
    tenantId: "t1", principalId: ACTOR,
    qualifyingRoleIds: ["r-global"],
    qualifyingAssignments: [globalA, phoenix, tucson],
    objects,
    objectPermissions: [
      { objectId: "o1", roleId: "r-global", cred: cred(false) },
      { objectId: "o1", roleId: "r-phoenix", cred: cred(true) },
      { objectId: "o1", roleId: "r-tucson", cred: cred(true) },
    ],
    fieldOverrides: [], hadStaleAssignment: false,
  };
  // No scope stated: the GLOBAL grant only. The location Roles' E must not leak in.
  assert.deepEqual(access.resolveObjectAccess(policy, "reorderRequest").cred, { C: false, R: true, E: false, D: false });
  // Inside Phoenix: the global grant PLUS the Phoenix grant. Tucson's is still absent.
  assert.deepEqual(access.resolveObjectAccess(policy, "reorderRequest", { scopeType: "location", scopeValue: "loc-phoenix" }).cred,
    { C: false, R: true, E: true, D: false });
  // A scope nobody is scoped to falls back to the global grant alone -- never to "any scope".
  assert.deepEqual(access.resolveObjectAccess(policy, "reorderRequest", { scopeType: "location", scopeValue: "loc-nowhere" }).cred,
    { C: false, R: true, E: false, D: false });

  // A principal holding ONLY a scoped assignment has no access at all outside it.
  const scopedOnly = { ...policy, qualifyingRoleIds: [], qualifyingAssignments: [phoenix] };
  assert.equal(access.resolveObjectAccess(scopedOnly, "reorderRequest").basis, "noQualifyingAssignment");
  assert.equal(access.resolveObjectAccess(scopedOnly, "reorderRequest", { scopeType: "location", scopeValue: "loc-phoenix" }).cred.E, true);
  assert.equal(access.resolveObjectAccess(scopedOnly, "reorderRequest", { scopeType: "location", scopeValue: "loc-tucson" }).basis, "noQualifyingAssignment");
});

test("B: an assignment record that OMITS scopeType is global, not unknown", async () => {
  // REGRESSION. user_role_assignments.scope_type is NOT NULL DEFAULT 'global', so a record without one means the
  // default -- an in-memory or legacy record, never a scoped grant. Reading absence as an unknown type fails closed
  // on every such record and silently revokes access that exists today, which is the opposite of what carrying
  // scope is for. Proved through loadPrincipalPolicy, because the normalization belongs at the read boundary.
  const { loadPrincipalPolicy } = access;
  const reader = {
    listAssignmentsForPrincipal: async () => [
      { roleId: "r-global", status: "active", accessVersionAtGrant: 1 },                       // no scopeType at all
      { roleId: "r-blank", status: "active", accessVersionAtGrant: 1, scopeType: "", scopeValue: null },
    ],
    getAccessVersion: async () => ({ accessVersion: 1 }),
    listObjects: async () => [{ id: "o1", key: "reorderRequest", supportsDelete: false }],
    listObjectPermissions: async () => [{ objectId: "o1", roleId: "r-global", cred: { C: false, R: true, E: false, D: false } }],
    listFieldOverrides: async () => [],
  };
  const policy = await loadPrincipalPolicy(reader, "t1", ACTOR);
  assert.deepEqual([...policy.qualifyingRoleIds].sort(), ["r-blank", "r-global"], "an absent scope removed the Role");
  assert.ok(policy.qualifyingAssignments.every((a) => a.scopeType === "global"));
  // And the decision is unchanged: the Role still grants what it granted before scope was carried.
  assert.deepEqual(access.resolveObjectAccess(policy, "reorderRequest").cred, { C: false, R: true, E: false, D: false });
});

test("B: a policy built before scope was carried decides exactly as it used to", () => {
  const objects = [{ id: "o1", key: "reorderRequest", supportsDelete: false }];
  const legacy = {
    tenantId: "t1", principalId: ACTOR,
    qualifyingRoleIds: ["r-global"],          // no qualifyingAssignments at all
    objects,
    objectPermissions: [{ objectId: "o1", roleId: "r-global", cred: { C: false, R: true, E: true, D: false } }],
    fieldOverrides: [], hadStaleAssignment: false,
  };
  assert.deepEqual(access.resolveObjectAccess(legacy, "reorderRequest").cred, { C: false, R: true, E: true, D: false });
});

test("B: Security Role assignment scope is NOT Employee Operational Scope, and the module cannot confuse them", () => {
  const src = readFileSync(join(FUNCTIONS_DIR, "src/adminPolicy/assignmentScope.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // It never reads the Employee scope authority, and WAREHOUSE is not one of its scope types.
  assert.doesNotMatch(code, /employee_operational_scopes|eos_workforce|operationalScopeVocabulary|WAREHOUSE/);
  assert.deepEqual([...scope.VALUE_MATCHED_SCOPE_TYPES], ["domain", "location", "operatingCompany", "businessUnit"]);
  // A warehouse-shaped scope is simply an unknown type here: it cannot be smuggled in as a security scope.
  assert.equal(scope.assignmentAdmitsDecision({ roleId: "r", scopeType: "WAREHOUSE", scopeValue: "wh-main" },
    { scopeType: "WAREHOUSE", scopeValue: "wh-main" }), false);
});

test("the parity modules decide nothing they were not asked: pure, no database, no Firebase, no caller-supplied scope", () => {
  for (const rel of ["src/adminPolicy/assignmentScope.ts", "src/adminPolicy/conditionedCapability.ts"]) {
    const code = readFileSync(join(FUNCTIONS_DIR, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /\bpg\b|pool|client\.query|SELECT |INSERT |UPDATE |DELETE /i, rel);
    assert.doesNotMatch(code, /require\(\s*["'][^"']*fire(base|store)[^"']*["']\s*\)|from\s+["'][^"']*fire(base|store)[^"']*["']/i, rel);
    // No clock, no randomness: the same inputs must always yield the same decision.
    assert.doesNotMatch(code, /Date\.now|new Date|Math\.random/, rel);
  }
});

test("the census still refuses to migrate what the evaluator cannot yet prove", () => {
  // Parity is being BUILT here, not declared complete: the refusal stays until a migration is separately proven.
  const census = require("../lib/adminPolicy/migration/roleAssignmentCensus.js");
  assert.equal(census.MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY, "MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY");
  const src = readFileSync(join(FUNCTIONS_DIR, "src/adminPolicy/migration/roleAssignmentCensus.ts"), "utf8");
  assert.match(src, /if \(a\.scopeType !== "global"\) refusalReasons\.push\("SCOPED"\)/);
});
