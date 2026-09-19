// Authorization v2 parity, steps 1-3: the live ConditionKind inventory, PINNED.
//
// The inventory's value is that it fails when the catalog changes. So this suite pins the live facts exactly: a new
// conditioned grant, a new ConditionKind, or a Condition quietly removed all land here first.
//
// It also pins the two invariants the dispositions exist to protect:
//
//   a conditioned grant stays conditioned   nothing may migrate a Condition away without an evaluator
//   R-32 stays closed                        the six manager capabilities must not regain operationalRoleActive
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const inventory = require("../lib/adminPolicy/migration/conditionKindInventory.js");
const census = require("../lib/adminPolicy/migration/roleAssignmentCensus.js");
const { COMPATIBILITY_ROLES } = require("../lib/access/compatibilityRoles.js");
const { GOVERNED_BUSINESS_ROLES } = require("../lib/access/governedBusinessRoles.js");

const built = inventory.buildConditionKindInventory();
const entry = (kind) => built.entries.find((e) => e.kind === kind);

test("every declared ConditionKind is ruled, and every live Condition names a declared Kind", () => {
  // The union is the source of Kinds; a Kind added to it with no ruling is a gap, not a default.
  const declared = [...inventory.DECLARED_CONDITION_KINDS];
  const types = readFileSync(join(FUNCTIONS_DIR, "src/types/access.ts"), "utf8");
  const union = types.slice(types.indexOf("export type ConditionKind ="), types.indexOf(";", types.indexOf("export type ConditionKind =")));
  assert.deepEqual([...union.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]), declared, "the union and the inventory disagree");
  for (const kind of declared) {
    const ruling = inventory.CONDITION_KIND_RULINGS[kind];
    assert.ok(ruling, `${kind} has no ruling`);
    assert.ok(inventory.CONDITION_DISPOSITIONS.includes(ruling.disposition), `${kind} has an unknown disposition`);
    assert.ok(ruling.rationale.length > 40, `${kind}'s rationale does not say why`);
  }
  assert.deepEqual(built.entries.map((e) => e.kind), declared);
  for (const use of inventory.listLiveConditionUses()) assert.ok(declared.includes(use.kind), `${use.kind} is used but not declared`);
});

test("the LIVE inventory, exactly: two Kinds are carried and three are carried by nothing", () => {
  // isOwnAssignment double-gates Void on the admin/dispatcher base; owner holds it by composition.
  assert.deepEqual(entry("isOwnAssignment").uses.map((u) => [u.roleKey, u.permissionId, u.params]), [
    ["admin", "reorder.purchaseOrder.void", "{}"],
    ["dispatcher", "reorder.purchaseOrder.void", "{}"],
    ["owner", "reorder.purchaseOrder.void", "{}"],
  ]);
  // operationalRoleActive survives ONLY as PARTS_ASSOCIATE eligibility on the technician compatibility Role.
  assert.deepEqual(entry("operationalRoleActive").roleKeys, ["technician"]);
  assert.deepEqual(entry("operationalRoleActive").permissionIds, [
    "reorder.purchaseOrder.create", "reorder.purchaseOrder.read", "reorder.request.markReceived",
    "reorder.request.postPurchasingUpdate", "reorder.request.read.own", "reorder.request.recordPurchaseOrder",
    "reorder.request.startPurchasing",
  ]);
  assert.ok(entry("operationalRoleActive").uses.every((u) => u.params === JSON.stringify({ role: "PARTS_ASSOCIATE" })),
    "an operationalRoleActive condition names something other than PARTS_ASSOCIATE");
  for (const kind of ["statusEquals", "statusIn", "employmentActive"]) {
    assert.deepEqual(entry(kind).uses, [], `${kind} is no longer unused -- classify the new grant`);
  }
  assert.deepEqual([...built.conditionedRoleKeys], ["admin", "dispatcher", "owner", "technician"]);
});

test("the dispositions: only isOwnAssignment blocks evaluator parity, and three Kinds must never gain an evaluator", () => {
  assert.equal(entry("isOwnAssignment").disposition, "STILL_REQUIRED");
  assert.equal(entry("operationalRoleActive").disposition, "BUSINESS_ELIGIBILITY_SCOPE");
  assert.equal(entry("employmentActive").disposition, "MOVED");
  assert.equal(entry("statusEquals").disposition, "DEAD");
  assert.equal(entry("statusIn").disposition, "DEAD");

  // A Kind that must never be implemented carries no parity requirement -- there is nothing to reach parity WITH.
  assert.deepEqual([...built.blockingEvaluatorParity], ["isOwnAssignment"]);
  for (const e of built.entries) {
    if (e.disposition === "STILL_REQUIRED") assert.ok(e.parityRequirement, `${e.kind} blocks parity but states no requirement`);
    else assert.equal(e.parityRequirement, null, `${e.kind} must never gain an evaluator, yet states a parity requirement`);
  }
  // BUSINESS_ELIGIBILITY_SCOPE is answered by the decomposition, not by the evaluator -- and it says so.
  assert.match(entry("operationalRoleActive").rationale, /Work Eligibility and Operational Scope/);
  assert.match(entry("employmentActive").rationale, /employment_status/);
});

test("R-32 STAYS CLOSED: the six manager capabilities hold no Condition on any Role", () => {
  // Each was carried on `technician` under operationalRoleActive(PARTS_MANAGER|WAREHOUSE_MANAGER) and was moved to a
  // governed Business Role UNCONDITIONED. Regaining a Condition here would reopen a closed ruling.
  const moved = ["reorder.request.create.manual", "reorder.request.read.queue", "reorder.request.assign",
    "inventory.transaction.read", "inventory.action.read", "inventory.catalog.read"];
  const uses = inventory.listLiveConditionUses();
  for (const permissionId of moved) {
    assert.deepEqual(uses.filter((u) => u.permissionId === permissionId), [], `${permissionId} regained a Condition -- R-32 is closed`);
  }
  // And no Condition anywhere names a manager operational role again.
  for (const use of uses) assert.doesNotMatch(use.params, /MANAGER/, `${use.roleKey}/${use.permissionId} names a manager role`);
});

test("the census's conditioned-Role list is the catalog's, so a new conditioned grant is refused without being listed", () => {
  // roleAssignmentCensus refuses conditioned assignments as MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY. Its default
  // facts must therefore see exactly the Roles the catalog conditions -- no more, and crucially no fewer.
  const facts = census.defaultRoleCatalogFacts?.() ?? null;
  if (facts) {
    assert.deepEqual([...facts.conditionedRoleKeys].sort(), [...built.conditionedRoleKeys].sort(),
      "the census would let a conditioned Role through unflagged");
    assert.deepEqual([...facts.roleKeys].sort(), Object.keys({ ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES }).sort());
  } else {
    // The census derives its facts inline; prove the derivation agrees by deriving it the same way.
    const roles = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
    const conditioned = Object.entries(roles)
      .filter(([, r]) => Object.values(r.conditionsByPermission ?? {}).some((c) => (c ?? []).length > 0)).map(([k]) => k).sort();
    assert.deepEqual(conditioned, [...built.conditionedRoleKeys]);
  }
  assert.equal(census.MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY, "MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY");
});

test("the inventory decides nothing: no evaluator, no database, no Firebase, and nothing in the runtime imports it", () => {
  const src = readFileSync(join(FUNCTIONS_DIR, "src/adminPolicy/migration/conditionKindInventory.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(src, /\bpg\b|pool|client\.query|SELECT|INSERT|UPDATE|DELETE/i);
  // The fence is on LOADING Firebase, not on the noun: a rationale must be free to cite firestore.rules as the
  // source of the gate it is explaining, which is precisely the evidence that makes the ruling checkable.
  assert.doesNotMatch(src, /require\(\s*["'][^"']*fire(base|store)[^"']*["']\s*\)|from\s+["'][^"']*fire(base|store)[^"']*["']/i);
  // It reports; it never answers "may this principal do this".
  assert.doesNotMatch(src, /resolveEffectivePermission|effectiveObjectAccess|loadPrincipalPolicy|allow|deny|grant\(/);
  assert.equal(typeof inventory.buildConditionKindInventory, "function");
  // Deriving twice gives the same answer: the inventory is a function of the catalog, not of call order.
  assert.deepEqual(inventory.buildConditionKindInventory(), built);
});
