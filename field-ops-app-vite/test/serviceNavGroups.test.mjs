// Platform Task 2 -- Group Service navigation. Deterministic unit tests for
// navConfig.js's buildServiceNavGroups() / findActiveServiceGroupKey(), driven
// by the REAL Service subnav + the REAL role access rules (isNavItemVisible +
// ROLE_NAV_ACCESS), so this proves the two-level grouping preserves and never
// broadens per-role visibility.
//
// Run: node test/serviceNavGroups.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  NAV_DOMAINS,
  isNavItemVisible,
  buildServiceNavGroups,
  findActiveServiceGroupKey,
  SERVICE_NAV_GROUPS,
} from "../src/navigation/navConfig.js";
import { ROLES, ROLE_NAV_ACCESS } from "../src/domain/constants.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const serviceDomain = NAV_DOMAINS.find((d) => d.key === "service");
const visibleFor = (role) =>
  serviceDomain.subnav.filter((it) => isNavItemVisible(it, role, ROLE_NAV_ACCESS[role], undefined));
const groupsFor = (role) => buildServiceNavGroups(visibleFor(role));
const keys = (items) => items.map((i) => i.key);
const groupByKey = (model, key) => model.groups.find((g) => g.key === key);

// ===== Group model shape (from the config) =====
ok("three groups defined in order", () =>
  assert.deepEqual(SERVICE_NAV_GROUPS.map((g) => g.key), ["workManagement", "dispatch", "technicianWorkspace"]));

// ===== admin: every group + Control Tower standalone =====
ok("admin: all three groups present with their children in display order", () => {
  const m = groupsFor(ROLES.ADMIN);
  assert.deepEqual(m.groups.map((g) => g.key), ["workManagement", "dispatch", "technicianWorkspace"]);
  assert.deepEqual(keys(groupByKey(m, "workManagement").items), ["workOrders", "jobAssignments", "warranty"]);
  assert.deepEqual(keys(groupByKey(m, "dispatch").items), ["dispatcherBoard", "scheduling", "dispatch"]);
  assert.deepEqual(keys(groupByKey(m, "technicianWorkspace").items), ["technicianWorkspace"]);
});
ok("admin: Work Management lands on Work Orders (/service, path '')", () =>
  assert.equal(groupByKey(groupsFor(ROLES.ADMIN), "workManagement").landing.path, ""));
ok("admin: Dispatch lands on Dispatcher Board (the group landing)", () =>
  assert.equal(groupByKey(groupsFor(ROLES.ADMIN), "dispatch").landing.path, "dispatcher-board"));
ok("admin: Control Tower is ungrouped/standalone (unchanged path)", () => {
  const m = groupsFor(ROLES.ADMIN);
  assert.deepEqual(keys(m.ungrouped), ["controlTower"]);
  assert.equal(m.ungrouped[0].path, "control-tower");
});
ok("Dispatch Queue label applied; path unchanged", () => {
  const dq = groupByKey(groupsFor(ROLES.ADMIN), "dispatch").items.find((i) => i.key === "dispatch");
  assert.equal(dq.label, "Dispatch Queue");
  assert.equal(dq.path, "dispatch");
  assert.equal(dq.legacyKey, "dispatch");
});

// ===== dispatcher: no Technician Workspace (never had fieldMode access) =====
ok("dispatcher: Technician Workspace group is hidden (empty -> omitted)", () => {
  const m = groupsFor(ROLES.DISPATCHER);
  assert.deepEqual(m.groups.map((g) => g.key), ["workManagement", "dispatch"]);
  assert.equal(groupByKey(m, "technicianWorkspace"), undefined);
});
ok("dispatcher: still sees Control Tower standalone", () =>
  assert.deepEqual(keys(groupsFor(ROLES.DISPATCHER).ungrouped), ["controlTower"]));

// ===== technician: narrow scope preserved, never broadened =====
ok("technician: Work Management shows only Job Assignments; lands there (not the hidden Work Orders)", () => {
  const wm = groupByKey(groupsFor(ROLES.TECHNICIAN), "workManagement");
  assert.deepEqual(keys(wm.items), ["jobAssignments"]);
  assert.equal(wm.landing.key, "jobAssignments");
});
ok("technician: Dispatch group hidden (all its children are dispatcher/admin-only)", () =>
  assert.equal(groupByKey(groupsFor(ROLES.TECHNICIAN), "dispatch"), undefined));
ok("technician: Technician Workspace present", () =>
  assert.deepEqual(keys(groupByKey(groupsFor(ROLES.TECHNICIAN), "technicianWorkspace").items), ["technicianWorkspace"]));
ok("technician: Control Tower NOT exposed (fails closed, no broadening)", () => {
  const m = groupsFor(ROLES.TECHNICIAN);
  assert.deepEqual(m.ungrouped, []);
  const allShown = [...m.groups.flatMap((g) => keys(g.items)), ...keys(m.ungrouped)];
  for (const forbidden of ["workOrders", "dispatch", "dispatcherBoard", "scheduling", "warranty", "controlTower"]) {
    assert.ok(!allShown.includes(forbidden), `technician must not see ${forbidden}`);
  }
});

// ===== empty input =====
ok("buildServiceNavGroups([]) -> no groups, no ungrouped", () => {
  const m = buildServiceNavGroups([]);
  assert.deepEqual(m.groups, []);
  assert.deepEqual(m.ungrouped, []);
});

// ===== findActiveServiceGroupKey: direct URLs select the correct parent group =====
const adminGroups = groupsFor(ROLES.ADMIN).groups;
ok("active group: '' (/service) -> Work Management", () =>
  assert.equal(findActiveServiceGroupKey("", adminGroups), "workManagement"));
ok("active group: 'job-assignments' -> Work Management", () =>
  assert.equal(findActiveServiceGroupKey("job-assignments", adminGroups), "workManagement"));
ok("active group: 'scheduling' -> Dispatch", () =>
  assert.equal(findActiveServiceGroupKey("scheduling", adminGroups), "dispatch"));
ok("active group: 'dispatcher-board' -> Dispatch", () =>
  assert.equal(findActiveServiceGroupKey("dispatcher-board", adminGroups), "dispatch"));
ok("active group: 'dispatch' (Dispatch Queue) -> Dispatch", () =>
  assert.equal(findActiveServiceGroupKey("dispatch", adminGroups), "dispatch"));
ok("active group: 'technician-workspace' -> Technician Workspace", () =>
  assert.equal(findActiveServiceGroupKey("technician-workspace", adminGroups), "technicianWorkspace"));
ok("active group: 'control-tower' (standalone) -> null", () =>
  assert.equal(findActiveServiceGroupKey("control-tower", adminGroups), null));
ok("active group: unknown tail -> null", () =>
  assert.equal(findActiveServiceGroupKey("nope", adminGroups), null));

console.log(`\n${passed} passed, 0 failed`);
