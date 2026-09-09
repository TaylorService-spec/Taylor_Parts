// Administration → Roles & Permissions — the view model's proofs.
//
// This module must NEVER be a second authorization implementation. Its job is to draw what the
// server decided, and the assertions below are mostly about that boundary: given a server decision,
// does the surface describe it honestly, and does it stay silent about decisions it was not given.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAssignmentList,
  buildFieldRow,
  buildObjectRow,
  buildRolePolicyGrid,
  CELL_STATE,
  INHERITANCE,
  summarizeRoleGrid,
  summarizeWorkflow,
  VERBS,
} from "../src/domain/adminPolicyView.js";

const CRED = (c, r, e, d) => ({ C: c, R: r, E: e, D: d });

// ============================ object rows ============================

test("an object row draws the server's CRED, verb for verb", () => {
  const row = buildObjectRow({ key: "customer", label: "Customer", cred: CRED(false, true, true, false) });
  assert.equal(row.cells.R.state, CELL_STATE.GRANTED);
  assert.equal(row.cells.E.state, CELL_STATE.GRANTED);
  assert.equal(row.cells.C.state, CELL_STATE.DENIED);
  assert.equal(row.cells.D.state, CELL_STATE.DENIED);
});

test("a verb no capability governs is UNAVAILABLE, not merely unticked", () => {
  // The failure this state exists to stop: an unticked box invites an administrator to go and
  // request access that does not exist to give.
  const row = buildObjectRow({
    key: "contacts", label: "Contacts",
    cred: CRED(false, false, false, false),
    governed: { C: false, R: false, E: false, D: false },
  });
  for (const verb of VERBS) {
    assert.equal(row.cells[verb].state, CELL_STATE.UNAVAILABLE, `${verb} is ungoverned`);
  }
});

test("UNAVAILABLE and DENIED are distinguishable on the same row", () => {
  const row = buildObjectRow({
    key: "workOrder", label: "Work Orders",
    cred: CRED(true, false, false, false),
    governed: { C: true, R: false, E: true, D: false },
  });
  assert.equal(row.cells.C.state, CELL_STATE.GRANTED);
  assert.equal(row.cells.R.state, CELL_STATE.UNAVAILABLE, "no capability reads Work Orders");
  assert.equal(row.cells.E.state, CELL_STATE.DENIED, "governed, simply not granted");
  assert.equal(row.cells.D.state, CELL_STATE.UNAVAILABLE);
});

// ============================ field rows and inheritance ============================

test("a field with no override is marked INHERITED", () => {
  const row = buildFieldRow({
    key: "name", label: "Name",
    effective: CRED(false, true, false, false),
    objectCred: CRED(false, true, false, false),
    override: null,
  });
  assert.equal(row.cells.R.state, CELL_STATE.GRANTED);
  assert.equal(row.cells.R.inheritance, INHERITANCE.INHERITED);
});

test("a field with an override is marked OVERRIDDEN, per verb", () => {
  // Per verb, not per field: a field that overrides only Read is inheriting the other three, and
  // saying otherwise would tell an administrator they had made three decisions they had not.
  const row = buildFieldRow({
    key: "creditLimit", label: "Credit Limit",
    effective: CRED(false, false, true, false),
    objectCred: CRED(false, true, true, false),
    override: { R: false },
  });
  assert.equal(row.cells.R.state, CELL_STATE.DENIED);
  assert.equal(row.cells.R.inheritance, INHERITANCE.OVERRIDDEN, "Read was decided on the field");
  assert.equal(row.cells.E.inheritance, INHERITANCE.INHERITED, "Edit still comes from the object");
});

test("an override that grants what the OBJECT denies is drawn as BLOCKED, never as granted", () => {
  // The doorway, shown honestly. The server already resolved this to a denial; drawing it as
  // granted would tell an administrator they had configured something they had not, and they would
  // keep not-fixing it because it looked correct.
  const row = buildFieldRow({
    key: "name", label: "Name",
    effective: CRED(false, false, false, false), // the server's answer: denied
    objectCred: CRED(false, false, false, false), // because the object denies Read
    override: { R: true }, // even though the field says yes
  });
  assert.equal(row.cells.R.state, CELL_STATE.BLOCKED_BY_OBJECT);
  assert.equal(row.cells.R.inheritance, INHERITANCE.OVERRIDDEN, "the override exists, it just does nothing");
  assert.notEqual(row.cells.R.state, CELL_STATE.GRANTED, "it must never read as access");
});

test("a field override DENYING something the object also denies is an ordinary denial", () => {
  // Not BLOCKED: nothing was overruled, the two agree. Reserving the blocked state for genuine
  // conflict is what keeps it meaningful.
  const row = buildFieldRow({
    key: "name", label: "Name",
    effective: CRED(false, false, false, false),
    objectCred: CRED(false, false, false, false),
    override: { R: false },
  });
  assert.equal(row.cells.R.state, CELL_STATE.DENIED);
});

test("the view model does NOT re-derive effective access", () => {
  // Given a server answer that contradicts what a client-side resolver would compute, the view
  // model reports the SERVER's answer. This is the assertion that keeps it from quietly becoming a
  // second implementation of the rules.
  const row = buildFieldRow({
    key: "odd", label: "Odd",
    effective: CRED(false, true, false, false), // the server says granted
    objectCred: CRED(false, false, false, false), // and the object appears to deny
    override: null, // with nothing stated on the field
  });
  assert.equal(
    row.cells.R.state, CELL_STATE.GRANTED,
    "the surface draws what it was told, and does not overrule the server",
  );
});

// ============================ the grid ============================

test("the grid nests fields under their object and summarizes what a Role holds", () => {
  const grid = buildRolePolicyGrid({
    objects: [
      { key: "customer", label: "Customer", cred: CRED(false, true, true, false) },
      { key: "invoice", label: "Invoice", cred: CRED(false, false, false, false) },
    ],
    fieldsByObjectKey: {
      customer: [
        { key: "name", label: "Name", effective: CRED(false, true, true, false) },
        { key: "creditLimit", label: "Credit Limit", effective: CRED(false, false, true, false), override: { R: false } },
      ],
      invoice: [
        { key: "total", label: "Total", effective: CRED(false, false, false, false), override: { R: true } },
      ],
    },
  });

  assert.equal(grid.length, 2);
  assert.equal(grid[0].fields.length, 2);
  assert.equal(grid[0].fields[1].cells.R.inheritance, INHERITANCE.OVERRIDDEN);
  assert.equal(grid[1].fields[0].cells.R.state, CELL_STATE.BLOCKED_BY_OBJECT, "the doorway is applied per object");

  const summary = summarizeRoleGrid(grid);
  assert.deepEqual(summary, { objectsWithAccess: 1, overriddenFields: 2, blockedFields: 1 });
});

test("an object with no fields still renders", () => {
  const grid = buildRolePolicyGrid({ objects: [{ key: "audit", label: "Audit Log", cred: CRED(false, true, false, false) }] });
  assert.deepEqual(grid[0].fields, []);
  assert.equal(summarizeRoleGrid(grid).objectsWithAccess, 1);
});

// ============================ assignments ============================

test("assignments are listed as ADDITIVE, each separately removable", () => {
  const list = buildAssignmentList(
    [
      { id: "a1", roleId: "r1", status: "active", scopeType: "global", grantedBy: "uid-admin", grantedAt: "2026-09-08" },
      { id: "a2", roleId: "r2", status: "active", scopeType: "location", scopeValue: "wh-main", grantedBy: "uid-admin" },
      { id: "a3", roleId: "r1", status: "disabled", scopeType: "global" },
    ],
    { r1: { key: "salesperson", name: "Salesperson" }, r2: { key: "warehouseManager", name: "Warehouse Manager" } },
  );

  assert.equal(list.additive, true, "holding two Roles ADDS their access");
  assert.equal(list.count, 2);
  assert.equal(list.disabledCount, 1, "history is counted, not mixed in with live access");
  assert.deepEqual(list.items.map((i) => i.assignmentId), ["a1", "a2"]);
  assert.equal(list.items[1].scopeLabel, "location: wh-main");
  assert.ok(list.items.every((i) => i.removable), "each one by its own id, never by (principal, role)");
});

test("the SAME Role at two scopes stays two separately removable rows", () => {
  // A person may legitimately hold one Role twice. "Remove their salesperson role" would remove
  // both, which is why the list never collapses them.
  const list = buildAssignmentList(
    [
      { id: "a1", roleId: "r1", status: "active", scopeType: "location", scopeValue: "wh-north" },
      { id: "a2", roleId: "r1", status: "active", scopeType: "location", scopeValue: "wh-south" },
    ],
    { r1: { key: "warehouseManager", name: "Warehouse Manager" } },
  );
  assert.equal(list.count, 2);
  assert.deepEqual(list.items.map((i) => i.assignmentId), ["a1", "a2"]);
  assert.deepEqual(list.items.map((i) => i.scopeLabel), ["location: wh-north", "location: wh-south"]);
});

test("an unknown role id is named as unknown rather than rendered blank", () => {
  const list = buildAssignmentList([{ id: "a1", roleId: "gone", status: "active", scopeType: "global" }], {});
  assert.equal(list.items[0].roleName, "(unknown role)");
  assert.equal(list.items[0].roleKey, null);
});

// ============================ workflows ============================

test("the active version is the highest PUBLISHED one, and drafts are listed apart", () => {
  const summary = summarizeWorkflow({
    workflow: { key: "workOrder", name: "Work Order", objectKey: "workOrder" },
    versions: [
      { version: 1, status: "PUBLISHED" },
      { version: 2, status: "PUBLISHED" },
      { version: 3, status: "DRAFT" },
    ],
  });
  assert.equal(summary.activeVersion, 2);
  assert.equal(summary.activeVersionLabel, "v2");
  assert.deepEqual(summary.draftVersions, [3], "a draft changes nothing about how records move");
  assert.equal(summary.versionCount, 3);
});

test("a workflow with no published version says so, rather than implying v0 runs", () => {
  const summary = summarizeWorkflow({
    workflow: { key: "sales", name: "Sales" },
    versions: [{ version: 1, status: "DRAFT" }],
  });
  assert.equal(summary.activeVersion, null);
  assert.equal(summary.activeVersionLabel, "Not published");
});

test("a workflow with no versions at all is handled", () => {
  const summary = summarizeWorkflow({ workflow: { key: "x", name: "X" }, versions: [] });
  assert.equal(summary.activeVersion, null);
  assert.equal(summary.versionCount, 0);
});

// ============================ ungoverned inherits downward ============================

test("a verb no capability governs is UNAVAILABLE on the FIELDS too, not an empty box", () => {
  // FOUND IN THE BROWSER, not in a unit test: the object row drew Delete as a dash and its field
  // rows drew it as an empty checkbox. That reintroduces one level down the exact failure the third
  // state exists to prevent -- an administrator asking for access no capability can grant.
  const row = buildFieldRow({
    key: "name", label: "Name",
    effective: CRED(false, true, true, false),
    objectCred: CRED(false, true, true, false),
    override: null,
    governed: { C: true, R: true, E: true, D: false },
  });
  assert.equal(row.cells.D.state, CELL_STATE.UNAVAILABLE, "ungoverned at the object is ungoverned at the field");
  assert.equal(row.cells.D.inheritance, null, "and it is not an inheritance question at all");
  assert.equal(row.cells.R.state, CELL_STATE.GRANTED, "the governed verbs are unaffected");
});

test("the grid passes each object's governed map down to its fields", () => {
  const grid = buildRolePolicyGrid({
    objects: [{
      key: "customer", label: "Customer",
      cred: CRED(false, true, true, false),
      governed: { C: false, R: true, E: true, D: false },
    }],
    fieldsByObjectKey: {
      customer: [{ key: "name", label: "Name", effective: CRED(false, true, true, false) }],
    },
  });
  const field = grid[0].fields[0];
  assert.equal(grid[0].cells.D.state, CELL_STATE.UNAVAILABLE, "the object says ungoverned");
  assert.equal(field.cells.D.state, CELL_STATE.UNAVAILABLE, "and so does its field");
  assert.equal(grid[0].cells.C.state, CELL_STATE.UNAVAILABLE);
  assert.equal(field.cells.C.state, CELL_STATE.UNAVAILABLE);
});

test("with no governed map, every verb is still answerable", () => {
  // Absent means "all four are governed" -- the pre-existing behaviour, unchanged, so a caller that
  // does not know about ungoverned verbs gets the same answers it always did.
  const row = buildFieldRow({
    key: "name", label: "Name",
    effective: CRED(false, true, false, false),
    objectCred: CRED(false, true, false, false),
  });
  assert.equal(row.cells.D.state, CELL_STATE.DENIED);
  assert.equal(row.cells.D.inheritance, INHERITANCE.INHERITED);
});
