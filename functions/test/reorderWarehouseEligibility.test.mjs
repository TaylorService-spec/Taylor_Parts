// Workstream 2B / R-17 — the shared reorder warehouse eligibility, and the invariant that makes it
// worth sharing.
//
//     every warehouse listReorderWarehouseOptions returns MUST be accepted by createReorderRequest
//     for that same principal, and a caller may NOT bypass the selector by posting a warehouseId
//     their scope does not permit.
//
// The last block below is that invariant tested as a property over a matrix of principals and
// warehouses, rather than as a handful of examples — because the failure mode it guards is
// divergence, and divergence is exactly what examples miss.
//
// OFFLINE. Pure functions only; no emulator, no Firebase.
import test from "node:test";
import assert from "node:assert/strict";
import {
  REORDER_WAREHOUSE_SCOPE,
  REORDER_WAREHOUSE_SCOPE_REASON,
  isWarehouseInReorderScope,
  reorderWarehouseOptionLabel,
  resolveReorderWarehouseScope,
} from "../lib/reorderRequest/reorderWarehouseEligibility.js";
import { projectReorderWarehouseOptions as projectWithDeps } from "../lib/reorderRequest/reorderCallables.js";
import { validateGovernedWarehouse } from "../lib/warehouseGovernance/governedWarehouseValidation.js";
import { Timestamp } from "firebase-admin/firestore";
import { buildCreateReorderRequest, ReorderCommandError } from "../lib/reorderRequest/reorderCommands.js";

// ============================ WHY THE VALIDATOR IS INJECTED HERE ============================
//
// The §3A governed-warehouse validator carries a STRICT key allow-list that does not include
// `operatingCompanyId`, while the reorder command requires that exact field on the same document.
// The two authorities contradict — see the BLOCKER test at the bottom of this file, which pins the
// contradiction rather than working around it.
//
// Until that is resolved by ruling, no real document can satisfy both, so a fixture that satisfies
// both cannot exist. These tests therefore inject a validator to exercise the projection's OWN logic
// — scope filtering, the company requirement, ordering — and the blocker test below uses the REAL
// validator to state the contradiction in one place. Production always uses the real one.
const project = (scope, candidates) => projectWithDeps(scope, candidates, { validateGoverned: stubValidator });
const stubValidator = (data, id) =>
  typeof data?.name === "string" && typeof data?.status === "string"
    ? { valid: true, value: { id, name: data.name, status: data.status } }
    : { valid: false };

const governedWarehouse = (id, over = {}) => ({
  name: `Warehouse ${id}`,
  status: "ACTIVE",
  operatingCompanyId: "taylor",
  ...over,
});

const employee = (over = {}) => ({
  uid: "u1",
  userSecurityRole: "technician",
  userEmployeeId: "emp-1",
  employeeExists: true,
  employeeUserId: "u1",
  employeeEmploymentStatus: "ACTIVE",
  employeeOperationalRoles: [],
  employeeAssignedWarehouseIds: undefined,
  ...over,
});

const ADMIN = employee({ userSecurityRole: "admin" });
const DISPATCHER = employee({ userSecurityRole: "dispatcher" });
const WAREHOUSE_MANAGER = employee({
  employeeOperationalRoles: ["WAREHOUSE_MANAGER"],
  employeeAssignedWarehouseIds: ["wh-main"],
});
const PARTS_MANAGER = employee({ employeeOperationalRoles: ["PARTS_MANAGER"] });

// =========================== scope resolution ===========================

test("admin and dispatcher hold unscoped warehouse authority", () => {
  for (const facts of [ADMIN, DISPATCHER]) {
    const scope = resolveReorderWarehouseScope(facts);
    assert.equal(scope.kind, REORDER_WAREHOUSE_SCOPE.ALL_GOVERNED);
    assert.equal(scope.reason, REORDER_WAREHOUSE_SCOPE_REASON.UNSCOPED_SECURITY_ROLE);
    // ALL_GOVERNED carries no id list. A list would imply a boundary that does not exist here, and
    // some later reader would treat an empty one as "none".
    assert.equal(scope.warehouseIds, null);
  }
});

test("a WAREHOUSE_MANAGER holds exactly their assigned warehouses -- never all of them", () => {
  const scope = resolveReorderWarehouseScope(
    employee({ employeeOperationalRoles: ["WAREHOUSE_MANAGER"], employeeAssignedWarehouseIds: ["wh-main", "wh-north"] }),
  );
  assert.equal(scope.kind, REORDER_WAREHOUSE_SCOPE.ASSIGNED);
  assert.deepEqual([...scope.warehouseIds].sort(), ["wh-main", "wh-north"]);
  assert.ok(isWarehouseInReorderScope(scope, "wh-main"));
  assert.ok(!isWarehouseInReorderScope(scope, "wh-retired"), "an unassigned warehouse is not in scope");
});

test("the WAREHOUSE_MANAGER contract fails closed on every malformed input", () => {
  // Mirrors firestore.rules' isAssignedToWarehouse() exactly: absent, empty or malformed assignment
  // denies EVERY warehouse, and so does a broken link, inactive employment, or a missing role.
  const denials = {
    "no assignment field": { employeeOperationalRoles: ["WAREHOUSE_MANAGER"] },
    "empty assignment": { employeeOperationalRoles: ["WAREHOUSE_MANAGER"], employeeAssignedWarehouseIds: [] },
    "assignment is not a list": { employeeOperationalRoles: ["WAREHOUSE_MANAGER"], employeeAssignedWarehouseIds: "wh-main" },
    "assignment holds only blanks": { employeeOperationalRoles: ["WAREHOUSE_MANAGER"], employeeAssignedWarehouseIds: ["", "   ", 7] },
    "employment not ACTIVE": { ...WAREHOUSE_MANAGER, employeeEmploymentStatus: "TERMINATED" },
    "reciprocal link broken": { ...WAREHOUSE_MANAGER, employeeUserId: "someone-else" },
    "employee missing": { ...WAREHOUSE_MANAGER, employeeExists: false },
    "no employee link at all": { ...WAREHOUSE_MANAGER, userEmployeeId: null },
    "roles not a list": { ...WAREHOUSE_MANAGER, employeeOperationalRoles: "WAREHOUSE_MANAGER" },
  };
  for (const [label, over] of Object.entries(denials)) {
    const scope = resolveReorderWarehouseScope(employee(over));
    assert.equal(scope.kind, REORDER_WAREHOUSE_SCOPE.NONE, label);
    assert.ok(!isWarehouseInReorderScope(scope, "wh-main"), label);
  }
});

test("a malformed entry narrows the assignment, it never widens it", () => {
  const scope = resolveReorderWarehouseScope(
    employee({ employeeOperationalRoles: ["WAREHOUSE_MANAGER"], employeeAssignedWarehouseIds: ["wh-main", null, 3, "  "] }),
  );
  assert.deepEqual(scope.warehouseIds, ["wh-main"]);
});

test("PARTS_MANAGER scope is UNDEFINED and says so -- it is not silently zero", () => {
  // THE OPEN OWNER QUESTION. No capability, Rule, ADR or fixture defines which warehouses a Parts
  // Manager may reorder for. The two ways to make this test pass differently would both be
  // inventions: granting them everything, or reading assignedWarehouseIds for a role no authority
  // says it scopes. If this assertion is ever changed, it should be because a ruling defined the
  // scope -- not because the empty list was inconvenient.
  const scope = resolveReorderWarehouseScope(PARTS_MANAGER);
  assert.equal(scope.kind, REORDER_WAREHOUSE_SCOPE.NONE);
  assert.equal(scope.reason, REORDER_WAREHOUSE_SCOPE_REASON.PARTS_MANAGER_SCOPE_UNDEFINED);
  // And specifically NOT read from the field that scopes the other role.
  const withAssignment = resolveReorderWarehouseScope(
    employee({ employeeOperationalRoles: ["PARTS_MANAGER"], employeeAssignedWarehouseIds: ["wh-main"] }),
  );
  assert.equal(withAssignment.kind, REORDER_WAREHOUSE_SCOPE.NONE);
  assert.equal(withAssignment.reason, REORDER_WAREHOUSE_SCOPE_REASON.PARTS_MANAGER_SCOPE_UNDEFINED);
});

test("holding BOTH manager roles gets the governed scope, not the undefined one", () => {
  // Order dependence, pinned: a real person with both roles must not fall into the Parts Manager gap
  // and lose a warehouse authority they genuinely hold.
  const scope = resolveReorderWarehouseScope(
    employee({
      employeeOperationalRoles: ["PARTS_MANAGER", "WAREHOUSE_MANAGER"],
      employeeAssignedWarehouseIds: ["wh-north"],
    }),
  );
  assert.equal(scope.kind, REORDER_WAREHOUSE_SCOPE.ASSIGNED);
  assert.deepEqual(scope.warehouseIds, ["wh-north"]);
});

test("a principal with nothing gets nothing, and the resolver never throws", () => {
  for (const facts of [employee(), {}, null, undefined, "nonsense"]) {
    const scope = resolveReorderWarehouseScope(facts);
    assert.equal(scope.kind, REORDER_WAREHOUSE_SCOPE.NONE);
    assert.ok(!isWarehouseInReorderScope(scope, "wh-main"));
  }
});

// =========================== the projection ===========================

test("the projection returns TWO fields, and none of the ones it was told not to", () => {
  const scope = resolveReorderWarehouseScope(ADMIN);
  const [option] = project(scope, [
    { id: "wh-main", data: governedWarehouse("wh-main", { name: "Main Distribution Center", headcount: 12, onHandValue: 91234 }) },
  ]);
  assert.deepEqual(Object.keys(option).sort(), ["label", "warehouseId"]);
  assert.equal(option.warehouseId, "wh-main");
  assert.equal(option.label, "Main Distribution Center");
  // The company is DERIVED server-side. Shipping it would invite a caller to send it back, which
  // the create refuses outright -- so it must not be in the projection at all.
  assert.equal(option.operatingCompanyId, undefined);
  assert.equal(option.status, undefined);
});

test("an unnamed warehouse falls back to its id rather than rendering blank", () => {
  assert.equal(reorderWarehouseOptionLabel("  ", "wh-main"), "wh-main");
  assert.equal(reorderWarehouseOptionLabel(null, "wh-main"), "wh-main");
  assert.equal(reorderWarehouseOptionLabel(" North Depot ", "wh-north"), "North Depot");
});

test("the projection excludes what the create would refuse", () => {
  const scope = resolveReorderWarehouseScope(ADMIN);
  const options = project(scope, [
    { id: "wh-ok", data: governedWarehouse("wh-ok") },
    { id: "wh-inactive", data: governedWarehouse("wh-inactive", { status: "INACTIVE" }) },
    { id: "wh-nocompany", data: governedWarehouse("wh-nocompany", { operatingCompanyId: undefined }) },
    { id: "wh-badcompany", data: governedWarehouse("wh-badcompany", { operatingCompanyId: "acme" }) },
    { id: "wh-ungoverned", data: { notAWarehouse: true } },
  ]);
  assert.deepEqual(options.map((o) => o.warehouseId), ["wh-ok"]);
});

test("a scoped principal is offered only their own warehouses", () => {
  const scope = resolveReorderWarehouseScope(WAREHOUSE_MANAGER);
  const options = project(scope, [
    { id: "wh-main", data: governedWarehouse("wh-main") },
    { id: "wh-north", data: governedWarehouse("wh-north") },
  ]);
  assert.deepEqual(options.map((o) => o.warehouseId), ["wh-main"]);
});

test("a principal with no scope is offered nothing, even from a full candidate set", () => {
  for (const facts of [PARTS_MANAGER, employee()]) {
    const scope = resolveReorderWarehouseScope(facts);
    assert.deepEqual(project(scope, [{ id: "wh-main", data: governedWarehouse("wh-main") }]), []);
  }
});

// =========================== THE INVARIANT ===========================

const create = (warehouseId, scope, { governed = true, company = "taylor" } = {}) =>
  buildCreateReorderRequest(
    { partId: "PRT-1", warehouseId, recommendationStatus: "READY", requestedQty: 3, quantitySource: "ANALYTICS" },
    {
      actorUid: "u1",
      nowMillis: 1_756_000_000_000,
      warehouseGoverned: governed,
      warehouseCompanyId: company,
      warehouseInScope: isWarehouseInReorderScope(scope, warehouseId),
    },
  );

test("INVARIANT: everything the picker offers, the create accepts -- across every principal", () => {
  const world = [
    { id: "wh-main", data: governedWarehouse("wh-main") },
    { id: "wh-north", data: governedWarehouse("wh-north") },
    { id: "wh-retired", data: governedWarehouse("wh-retired", { status: "INACTIVE" }) },
    { id: "wh-nocompany", data: governedWarehouse("wh-nocompany", { operatingCompanyId: undefined }) },
  ];
  const principals = { ADMIN, DISPATCHER, WAREHOUSE_MANAGER, PARTS_MANAGER, ANONYMOUS: employee() };

  for (const [name, facts] of Object.entries(principals)) {
    const scope = resolveReorderWarehouseScope(facts);
    for (const option of project(scope, world)) {
      const built = create(option.warehouseId, scope);
      assert.equal(built.warehouseId, option.warehouseId, `${name} was offered ${option.warehouseId} but the create changed it`);
      assert.equal(built.operatingCompanyId, "taylor");
    }
  }
});

test("INVARIANT: what the picker withholds, the create refuses -- even posted by hand", () => {
  // The bypass attempt. A caller skips the selector entirely and puts a warehouseId in the payload.
  const world = [
    { id: "wh-main", data: governedWarehouse("wh-main") },
    { id: "wh-north", data: governedWarehouse("wh-north") },
  ];
  const principals = { WAREHOUSE_MANAGER, PARTS_MANAGER, ANONYMOUS: employee() };

  for (const [name, facts] of Object.entries(principals)) {
    const scope = resolveReorderWarehouseScope(facts);
    const offered = new Set(project(scope, world).map((o) => o.warehouseId));
    for (const candidate of world) {
      if (offered.has(candidate.id)) continue;
      let err = null;
      try {
        create(candidate.id, scope);
      } catch (e) {
        err = e;
      }
      assert.ok(err instanceof ReorderCommandError, `${name} posting ${candidate.id} must be refused`);
      assert.equal(err.code, "WAREHOUSE_NOT_IN_SCOPE", `${name} posting ${candidate.id}`);
    }
  }
});

test("the scope check comes FIRST -- an out-of-scope warehouse is not told why else it might fail", () => {
  // A principal who may not ask about a warehouse should not learn from the error whether it is
  // ungoverned or has no company. Those are facts about a warehouse they are not entitled to.
  const scope = resolveReorderWarehouseScope(PARTS_MANAGER);
  let err = null;
  try {
    create("wh-nocompany", scope, { governed: false, company: null });
  } catch (e) {
    err = e;
  }
  assert.equal(err.code, "WAREHOUSE_NOT_IN_SCOPE");
});

test("in scope is necessary, not sufficient -- the governed and company checks still run", () => {
  const scope = resolveReorderWarehouseScope(ADMIN);
  const ungoverned = (() => { try { create("wh-x", scope, { governed: false }); } catch (e) { return e; } })();
  assert.equal(ungoverned.code, "WAREHOUSE_NOT_GOVERNED");
  const noCompany = (() => { try { create("wh-x", scope, { company: null }); } catch (e) { return e; } })();
  assert.equal(noCompany.code, "WAREHOUSE_NO_COMPANY");
});

test("a client-supplied company is still refused before anything else, scope included", () => {
  const scope = resolveReorderWarehouseScope(ADMIN);
  const err = (() => {
    try {
      buildCreateReorderRequest(
        { partId: "PRT-1", warehouseId: "wh-main", recommendationStatus: "READY", requestedQty: 3, quantitySource: "ANALYTICS", operatingCompanyId: "ventana" },
        { actorUid: "u1", nowMillis: 1, warehouseGoverned: true, warehouseCompanyId: "taylor", warehouseInScope: isWarehouseInReorderScope(scope, "wh-main") },
      );
    } catch (e) { return e; }
  })();
  assert.equal(err.code, "COMPANY_NOT_CLIENT_SUPPLIABLE");
});

// =========================== THE FORMER BLOCKER, NOW REAL COVERAGE ===========================

test("a company-bearing warehouse is offered by the REAL validator, not just the injected one", () => {
  // WHAT THIS REPLACED. Until Workstream 2A.1A this test asserted a CONTRADICTION: the §3A governed
  // shape carried a closed twelve-key allow-list that did not include `operatingCompanyId`, while
  // createReorderRequest required exactly that field on the same document. The command refused in
  // both directions -- WAREHOUSE_NO_COMPANY without it, WAREHOUSE_NOT_GOVERNED with it -- so the
  // reorder path was unreachable in every state, and the test was written to FAIL the moment a
  // ruling resolved it. R-18 resolved it, this failed, and it is now what it was always meant to
  // become: proof that the picker works against the real authority rather than a stub.
  //
  // Every other projection case in this file injects a validator to isolate the projection's own
  // logic. This one deliberately does not.
  const complete = {
    id: "wh-main",
    name: "Main Distribution Center",
    location: "Phoenix, AZ",
    status: "ACTIVE",
    version: 1,
    updatedAt: Timestamp.fromMillis(1_756_000_000_000),
    updatedBy: "seed",
    provenance: "MIGRATED",
    governanceInitializedAt: Timestamp.fromMillis(1_756_000_000_000),
    governanceInitializedBy: "seed",
  };
  const withCompany = { ...complete, operatingCompanyId: "taylor" };

  assert.equal(validateGovernedWarehouse(withCompany, "wh-main").valid, true, "a company-bearing warehouse is governed");
  assert.equal(validateGovernedWarehouse(complete, "wh-main").valid, true, "and a legacy one still is too");

  const scope = resolveReorderWarehouseScope(ADMIN);
  assert.deepEqual(
    projectWithDeps(scope, [{ id: "wh-main", data: withCompany }]).map((o) => o.warehouseId),
    ["wh-main"],
  );
  // A warehouse with no company stays excluded HERE and only here: the reorder request derives its
  // company from the warehouse, so a root without one cannot answer the question the command asks.
  // It remains a perfectly valid warehouse for Receiving and Transfers -- which is the difference
  // between a command's requirement and a second opinion about the shape.
  assert.deepEqual(projectWithDeps(scope, [{ id: "wh-main", data: complete }]), []);
});