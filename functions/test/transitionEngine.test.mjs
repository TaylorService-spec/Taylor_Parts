// Issue #15 production-readiness closeout -- unit tests for
// functions/src/transitionEngine.ts, the Work Order Engine's pure
// state-machine/permissions module. No Firestore access in the module
// under test (by its own header comment), so this is a plain Node
// assert test against the compiled module, no emulator required --
// matching this repo's existing pure-logic test convention (see
// functions/test/compactClaims.test.mjs, permissionCatalog.test.mjs).
//
// Prerequisite: `npm run build` in functions/ first (imports the
// compiled lib/ output, not the TypeScript source).
//
// Scope: this file closes the "zero automated coverage of Issue #15's
// backend" gap for the one module that can be tested without an
// emulator. createWorkOrder.ts/transitionWorkOrder.ts/
// updateWorkOrderExecutionData.ts/woNumbering.ts/callerContext.ts/
// inventoryService.ts all require live Firestore+Auth and are covered
// separately once the emulator is available (see the Issue #15
// deployment manifest's gap list).
import assert from "node:assert/strict";
import {
  TRANSITIONS,
  TERMINAL_STATUSES,
  canTransition,
  ACTION_TO_STATUS,
  ACTION_TIMESTAMP_FIELD,
  ACTION_PERMISSIONS,
  getAllowedActions,
} from "../lib/transitionEngine.js";

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL: ${name} -- ${err.message}`);
  }
}

const ALL_STATUSES = Object.keys(TRANSITIONS);
const ALL_ACTIONS = Object.keys(ACTION_TO_STATUS);

// --- canTransition() / TRANSITIONS table shape --------------------------

check("every status in TRANSITIONS has an array value (even if empty)", () => {
  for (const status of ALL_STATUSES) {
    assert.ok(Array.isArray(TRANSITIONS[status]), `${status} must map to an array`);
  }
});

check("canTransition reflects the TRANSITIONS table exactly, both directions", () => {
  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      const expected = TRANSITIONS[from].includes(to);
      assert.equal(canTransition(from, to), expected, `${from} -> ${to}`);
    }
  }
});

check("CLOSED and CANCELLED are terminal: no outgoing transitions", () => {
  assert.deepEqual(TRANSITIONS.CLOSED, []);
  assert.deepEqual(TRANSITIONS.CANCELLED, []);
});

check("COMPLETED transitions only to CLOSED, never back to an active status", () => {
  assert.deepEqual(TRANSITIONS.COMPLETED, ["CLOSED"]);
});

check("every non-terminal status can reach CANCELLED directly", () => {
  for (const status of ALL_STATUSES) {
    if (TERMINAL_STATUSES.has(status)) continue;
    assert.ok(TRANSITIONS[status].includes("CANCELLED"), `${status} must allow -> CANCELLED`);
  }
});

check("TERMINAL_STATUSES matches exactly {COMPLETED, CLOSED, CANCELLED}, no more no less", () => {
  assert.deepEqual([...TERMINAL_STATUSES].sort(), ["CANCELLED", "CLOSED", "COMPLETED"]);
});

check("the full linear happy-path chain is unbroken CREATED -> ... -> CLOSED", () => {
  const chain = [
    "CREATED", "READY_TO_DISPATCH", "SCHEDULED", "DISPATCHED", "ACCEPTED",
    "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS", "COMPLETED", "CLOSED",
  ];
  for (let i = 0; i < chain.length - 1; i += 1) {
    assert.ok(canTransition(chain[i], chain[i + 1]), `${chain[i]} -> ${chain[i + 1]} must be valid`);
  }
});

check("no status can transition to itself (no self-loops anywhere in the table)", () => {
  for (const status of ALL_STATUSES) {
    assert.ok(!TRANSITIONS[status].includes(status), `${status} must not include itself`);
  }
});

// --- ACTION_TO_STATUS / ACTION_TIMESTAMP_FIELD --------------------------

check("every action maps to exactly one status, and that status is reachable from some status", () => {
  for (const action of ALL_ACTIONS) {
    const status = ACTION_TO_STATUS[action];
    assert.ok(ALL_STATUSES.includes(status), `${action} -> unknown status ${status}`);
    const reachable = ALL_STATUSES.some((from) => TRANSITIONS[from].includes(status));
    assert.ok(reachable, `${status} (from action ${action}) must be reachable from at least one status`);
  }
});

check("Schedule is deliberately excluded from ACTION_TIMESTAMP_FIELD (planning fields, not a server timestamp)", () => {
  assert.equal(ACTION_TIMESTAMP_FIELD.Schedule, undefined);
});

check("MarkReady is also excluded from ACTION_TIMESTAMP_FIELD (no dedicated timestamp field in the spec)", () => {
  assert.equal(ACTION_TIMESTAMP_FIELD.MarkReady, undefined);
});

check("Cancel reuses closedAt (no dedicated CANCELLED timestamp field exists)", () => {
  assert.equal(ACTION_TIMESTAMP_FIELD.Cancel, "closedAt");
});

check("every action with a timestamp field maps to a distinct field name, except Cancel/Close sharing closedAt", () => {
  const fields = Object.entries(ACTION_TIMESTAMP_FIELD).filter(([a]) => a !== "Cancel");
  const names = fields.map(([, f]) => f);
  assert.equal(new Set(names).size, names.length, "no two non-Cancel actions should share a timestamp field");
});

// --- ACTION_PERMISSIONS ---------------------------------------------------

check("admin/dispatcher-only actions never require own-assignment (that concept is technician-only)", () => {
  for (const action of ["MarkReady", "Schedule", "Dispatch", "Close", "Cancel"]) {
    assert.deepEqual(ACTION_PERMISSIONS[action].roles, ["admin", "dispatcher"]);
    assert.equal(ACTION_PERMISSIONS[action].requiresOwnAssignment, false);
  }
});

check("technician-only actions all require own-assignment", () => {
  for (const action of ["Accept", "Travel", "Arrive", "WorkStart", "Complete"]) {
    assert.deepEqual(ACTION_PERMISSIONS[action].roles, ["technician"]);
    assert.equal(ACTION_PERMISSIONS[action].requiresOwnAssignment, true);
  }
});

check("no action grants both admin/dispatcher AND technician in the same permission entry", () => {
  for (const action of ALL_ACTIONS) {
    const roles = ACTION_PERMISSIONS[action].roles;
    assert.ok(!(roles.includes("technician") && (roles.includes("admin") || roles.includes("dispatcher"))),
      `${action} must not mix technician with admin/dispatcher`);
  }
});

// --- getAllowedActions() --------------------------------------------------

check("admin sees MarkReady from CREATED, nothing technician-only", () => {
  const allowed = getAllowedActions("CREATED", "admin", false);
  assert.ok(allowed.includes("MarkReady"));
  assert.ok(allowed.includes("Cancel"));
  assert.ok(!allowed.some((a) => ACTION_PERMISSIONS[a].roles.includes("technician") && !ACTION_PERMISSIONS[a].roles.includes("admin")));
});

check("technician sees nothing from CREATED (no technician action targets a reachable status yet)", () => {
  const allowed = getAllowedActions("CREATED", "technician", false);
  assert.deepEqual(allowed, []);
});

check("technician with own assignment sees Accept from DISPATCHED", () => {
  const allowed = getAllowedActions("DISPATCHED", "technician", true);
  assert.ok(allowed.includes("Accept"));
});

check("technician WITHOUT own assignment does not see Accept from DISPATCHED (ownership gate enforced)", () => {
  const allowed = getAllowedActions("DISPATCHED", "technician", false);
  assert.ok(!allowed.includes("Accept"));
});

check("dispatcher sees Cancel from DISPATCHED, but not Accept (role gate enforced)", () => {
  const allowed = getAllowedActions("DISPATCHED", "dispatcher", false);
  assert.ok(allowed.includes("Cancel"));
  assert.ok(!allowed.includes("Accept"));
});

check("null role sees no actions at all, from any non-terminal status", () => {
  for (const status of ALL_STATUSES) {
    if (TERMINAL_STATUSES.has(status)) continue;
    assert.deepEqual(getAllowedActions(status, null, false), [], `null role must see nothing from ${status}`);
  }
});

check("no role sees any action from a terminal status (CLOSED/CANCELLED have no outgoing transitions)", () => {
  for (const status of ["CLOSED", "CANCELLED"]) {
    for (const role of ["admin", "dispatcher", "technician"]) {
      assert.deepEqual(getAllowedActions(status, role, true), [], `${role} must see nothing from ${status}`);
    }
  }
});

check("COMPLETED only allows Close (admin/dispatcher), never Cancel (spec: COMPLETED is not cancellable)", () => {
  assert.deepEqual(getAllowedActions("COMPLETED", "admin", false), ["Close"]);
  assert.deepEqual(getAllowedActions("COMPLETED", "technician", true), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
