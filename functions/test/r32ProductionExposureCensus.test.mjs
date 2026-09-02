// Fixtures only -- the census module is INERT on import, so this touches no project.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const C = require("../scripts/r32ProductionExposureCensus.js");

const asn = (roleId, scope, status = "active", id = `a-${roleId}`) => ({ id, roleId, scope, status });
const LOC = { type: "location", value: "wh-main" };

test("no write API is reachable from the census module", () => {
  const src = fs.readFileSync(new URL("../scripts/r32ProductionExposureCensus.js", import.meta.url), "utf8");
  // Firestore WRITE verbs specifically. A bare /\.set\(/ would match Map.set and prove nothing --
  // the guard has to name what it is actually guarding against.
  const forbidden = [
    /\.doc\([^)]*\)\s*\.\s*(set|update|delete)\(/,
    /\.collection\([^)]*\)\s*\.\s*add\(/,
    /writeBatch|\.batch\(\)|runTransaction|FieldValue|bulkWriter/,
    /require\([^)]*(trustedWriterCommands|[Mm]igration|[Ss]eed|[Bb]ackfill)[^)]*\)/,
  ];
  for (const f of forbidden) {
    assert.equal(f.test(src), false, `census must not reach ${f}`);
  }
  assert.equal(/\.get\(\)/.test(src), true, "a census must actually read");
  // and it must refuse to run without the explicit read-only + project pin
  assert.equal(src.includes("--read-only"), true);
  assert.equal(src.includes("--projectId"), true);
});

test("exposure requires BOTH the carrier Role and an active manager operational role", () => {
  const employee = { employmentStatus: "ACTIVE", operationalRoles: ["PARTS_MANAGER"] };
  assert.equal(C.classifyPrincipal({ assignments: [asn("technician", { type: "global" })], employee }).exposed, true);
  // carrier only
  assert.equal(
    C.classifyPrincipal({ assignments: [asn("technician", { type: "global" })], employee: { employmentStatus: "ACTIVE", operationalRoles: [] } }).exposed,
    false,
  );
  // manager operational role only
  assert.equal(C.classifyPrincipal({ assignments: [asn("partsManager", LOC)], employee }).exposed, false);
  // a DISABLED carrier assignment is not live authority
  assert.equal(C.classifyPrincipal({ assignments: [asn("technician", { type: "global" }, "disabled")], employee }).exposed, false);
  // a terminated employee's operational role is not live authority
  assert.equal(
    C.classifyPrincipal({ assignments: [asn("technician", { type: "global" })], employee: { employmentStatus: "TERMINATED", operationalRoles: ["PARTS_MANAGER"] } }).exposed,
    false,
  );
});

test("an unresolvable join is named, never guessed into a match", () => {
  const r = C.classifyPrincipal({ assignments: [asn("technician", { type: "global" })], employee: null, joinUnresolved: true });
  assert.equal(r.classification, "PRINCIPAL_JOIN_UNRESOLVED");
  assert.equal(r.exposed, false);
});

test("an exposed principal's existing governed manager Roles and scopes are reported", () => {
  const r = C.classifyPrincipal({
    assignments: [asn("technician", { type: "global" }), asn("partsManager", LOC)],
    employee: { employmentStatus: "ACTIVE", operationalRoles: ["PARTS_MANAGER"] },
  });
  assert.equal(r.exposed, true);
  assert.deepEqual(r.governed, [{ operational: "PARTS_MANAGER", governedRoleId: "partsManager", held: true, scopes: ["location:wh-main"] }]);
});

test("capability effect: lost without the governed Role, target-dependent when the binding is scoped", () => {
  assert.equal(C.capabilityEffect({ fromCarrier: true, fromGoverned: false }), "LOST");
  assert.equal(C.capabilityEffect({ fromCarrier: true, fromGoverned: true }), "RETAINED");
  assert.equal(C.capabilityEffect({ fromCarrier: true, fromGoverned: true, governedBindingScopes: ["location"] }), "TARGET_DEPENDENT");
  assert.equal(C.capabilityEffect({ fromCarrier: false, fromGoverned: false }), "NONE");
});

test("malformed assignment state and scope are reported, not coerced", () => {
  assert.equal(C.assignmentState(null), "MALFORMED");
  assert.equal(C.assignmentState({ status: "" }), "MALFORMED");
  assert.equal(C.assignmentState({ status: "weird" }), "UNKNOWN_STATUS");
  assert.equal(C.assignmentState({ status: "disabled" }), "DISABLED");
  assert.equal(C.scopeLabel(undefined), "MALFORMED");
  assert.equal(C.scopeLabel({ type: "" }), "MALFORMED");
  assert.equal(C.scopeLabel(LOC), "location:wh-main");
  assert.equal(C.scopeLabel({ type: "global" }), "global");
});

test("assignedWarehouseIds comparison is diagnostic and covers the sandbox contradiction shape", () => {
  assert.equal(C.compareAssignedWarehouseIds(["wh-main"], ["wh-north"]), "CONTRADICTORY");
  assert.equal(C.compareAssignedWarehouseIds(["wh-main"], ["wh-main"]), "MATCH");
  assert.equal(C.compareAssignedWarehouseIds([], ["wh-main"]), "GOVERNED_ONLY");
  assert.equal(C.compareAssignedWarehouseIds(["wh-main"], []), "ASSIGNEDWAREHOUSE_ONLY");
  assert.equal(C.compareAssignedWarehouseIds([], []), "BOTH_EMPTY");
});

test("the six capabilities are exactly the ones R-32 moved", () => {
  assert.deepEqual([...C.SIX_CAPABILITIES].sort(), [
    "inventory.action.read",
    "inventory.catalog.read",
    "inventory.transaction.read",
    "reorder.request.assign",
    "reorder.request.create.manual",
    "reorder.request.read.queue",
  ]);
});
