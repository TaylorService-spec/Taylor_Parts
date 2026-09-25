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
// FOUR groups since Phase E. Scanning is its own group rather than a child of Technician
// Workspace: the shared Scan workspace serves warehouse and Parts personas too, and a Parts
// Associate who can see only that one item would otherwise be told they are inside "Technician
// Workspace" -- the group label is the only context they get, and it would be wrong.
ok("four groups defined in order", () =>
  assert.deepEqual(SERVICE_NAV_GROUPS.map((g) => g.key), ["workManagement", "dispatch", "technicianWorkspace", "scanning"]));

// ===== admin: every group + Control Tower standalone =====
ok("admin: all four groups present with their children in display order", () => {
  const m = groupsFor(ROLES.ADMIN);
  assert.deepEqual(m.groups.map((g) => g.key), ["workManagement", "dispatch", "technicianWorkspace", "scanning"]);
  // Scan reaches admin through the SAME legacyKey "fieldMode" the Technician Workspace uses -- no new
  // ROLE_NAV_ACCESS key was invented, and no business role was added to that map.
  assert.deepEqual(keys(groupByKey(m, "scanning").items), ["scan"]);
  // WAVE 16 / LANE BQ. `service/workOrders` and `service/coordinatedVisits` were two of the twenty
  // destinations whose ungoverned NAV_LEGACY_PLACEHOLDER_DESTINATIONS rows Owner ruling F removed in
  // the cutover, so under the LEGACY source they are gone from these groups for admin too. Job
  // Assignments (legacyKey "jobs"), Warranty, the Dispatcher Board and Jobs are unaffected -- they
  // answer from ROLE_NAV_ACCESS or from a row of their own. Grouping itself is untouched: this is a
  // visibility change flowing through buildServiceNavGroups, not a change to the group model.
  assert.deepEqual(keys(groupByKey(m, "workManagement").items), ["jobAssignments", "warranty"]);
  assert.deepEqual(keys(groupByKey(m, "dispatch").items), ["dispatcherBoard", "scheduling", "dispatchScheduling", "dispatch"]);
  // Coordinated Mission (legacyKey fieldMode → admin + technician) is grouped under Technician Workspace.
  assert.deepEqual(keys(groupByKey(m, "technicianWorkspace").items), ["technicianWorkspace", "coordinatedMission"]);
});
// The landing is the group's FIRST VISIBLE child, which is the property worth pinning -- not any
// particular child. Work Orders was it while a placeholder row made it visible under the legacy
// source; since Wave 16 / Lane BQ removed that row, Job Assignments is, exactly as it already was
// for a technician (asserted below). The rule did not change; its input did.
ok("admin: Work Management lands on its first visible child, Job Assignments", () => {
  const wm = groupByKey(groupsFor(ROLES.ADMIN), "workManagement");
  assert.equal(wm.landing.key, "jobAssignments");
  assert.equal(wm.landing.key, wm.items[0].key, "the landing is not the first visible child");
});
ok("admin: Dispatch lands on Dispatcher Board (the group landing)", () =>
  assert.equal(groupByKey(groupsFor(ROLES.ADMIN), "dispatch").landing.path, "dispatcher-board"));
ok("admin: no ungrouped Service items (Control Tower promoted to Service Operations)", () => {
  const m = groupsFor(ROLES.ADMIN);
  assert.deepEqual(m.ungrouped, []);
  assert.ok(!m.groups.some((g) => g.items.some((it) => it.key === "controlTower")));
});
ok("the Jobs label is applied; path unchanged", () => {
  const dq = groupByKey(groupsFor(ROLES.ADMIN), "dispatch").items.find((i) => i.key === "dispatch");
  // Renamed from "Dispatch Queue" (Owner, 2026-08-30). One screen, one name: mobilePrimaryNav
  // already labels this same route "Jobs" on the phone, and the split label is what made a live
  // surface read as a spare dispatcher board. The PATH is what this test guards, and it is unchanged.
  assert.equal(dq.label, "Jobs");
  assert.equal(dq.path, "dispatch");
  assert.equal(dq.legacyKey, "dispatch");
});

// ===== dispatcher: no Technician Workspace (never had fieldMode access) =====
ok("dispatcher: Technician Workspace group is hidden (empty -> omitted)", () => {
  const m = groupsFor(ROLES.DISPATCHER);
  assert.deepEqual(m.groups.map((g) => g.key), ["workManagement", "dispatch"]);
  assert.equal(groupByKey(m, "technicianWorkspace"), undefined);
  // A dispatcher has no fieldMode key, so Scan is hidden on the LEGACY path -- exactly as before.
  // It can still appear via capabilityAccess for a principal the trusted feed says holds
  // inventory.stock.receive; groupsFor() supplies no capability previewer, so this is the
  // legacy-only answer and it must stay closed.
  assert.equal(groupByKey(m, "scanning"), undefined);
});
ok("dispatcher: no ungrouped Service items either (Control Tower promoted)", () =>
  assert.deepEqual(groupsFor(ROLES.DISPATCHER).ungrouped, []));

// ===== technician: narrow scope preserved, never broadened =====
ok("technician: Work Management shows only Job Assignments; lands there (not the hidden Work Orders)", () => {
  const wm = groupByKey(groupsFor(ROLES.TECHNICIAN), "workManagement");
  assert.deepEqual(keys(wm.items), ["jobAssignments"]);
  assert.equal(wm.landing.key, "jobAssignments");
});
ok("technician: Dispatch group hidden (all its children are dispatcher/admin-only)", () =>
  assert.equal(groupByKey(groupsFor(ROLES.TECHNICIAN), "dispatch"), undefined));
ok("technician: Technician Workspace present, incl. Coordinated Mission (shares fieldMode access)", () =>
  assert.deepEqual(keys(groupByKey(groupsFor(ROLES.TECHNICIAN), "technicianWorkspace").items), ["technicianWorkspace", "coordinatedMission"]));
// The technician journey is NOT moved by Phase E -- the existing Technician Workspace item is
// untouched above, and Scan is an ADDITIONAL entry point reached through the same fieldMode key.
ok("technician: Scanning group present through the existing fieldMode key", () =>
  assert.deepEqual(keys(groupByKey(groupsFor(ROLES.TECHNICIAN), "scanning").items), ["scan"]));
ok("technician: Control Tower NOT exposed (fails closed, no broadening)", () => {
  const m = groupsFor(ROLES.TECHNICIAN);
  assert.deepEqual(m.ungrouped, []);
  const allShown = [...m.groups.flatMap((g) => keys(g.items)), ...keys(m.ungrouped)];
  // coordinatedVisits is admin/dispatcher-only (no legacyKey) — a technician must never see the Dispatch read.
  for (const forbidden of ["workOrders", "dispatch", "dispatcherBoard", "scheduling", "dispatchScheduling", "warranty", "controlTower", "coordinatedVisits"]) {
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
// '' IS THE WORK ORDERS PATH, and Work Orders is no longer a visible child of Work Management under
// the legacy source (Wave 16 / Lane BQ removed its ungoverned placeholder row). `findActiveServiceGroupKey`
// answers from the VISIBLE groups it is handed, so it correctly returns null: there is no group that
// URL is inside for this session. That is the function behaving, not a broken mapping -- under the
// EOS source, where `service.workOrders` is granted, the item is visible and the answer is
// workManagement again.
ok("active group: '' (/service) -> null when Work Orders is not visible to this session", () =>
  assert.equal(findActiveServiceGroupKey("", adminGroups), null));
ok("active group: 'job-assignments' -> Work Management", () =>
  assert.equal(findActiveServiceGroupKey("job-assignments", adminGroups), "workManagement"));
ok("active group: 'scheduling' -> Dispatch", () =>
  assert.equal(findActiveServiceGroupKey("scheduling", adminGroups), "dispatch"));
ok("active group: 'dispatcher-board' -> Dispatch", () =>
  assert.equal(findActiveServiceGroupKey("dispatcher-board", adminGroups), "dispatch"));
ok("active group: 'dispatch' (Jobs) -> Dispatch", () =>
  assert.equal(findActiveServiceGroupKey("dispatch", adminGroups), "dispatch"));
ok("active group: 'dispatch-scheduling' (Dispatch Board) -> Dispatch", () =>
  assert.equal(findActiveServiceGroupKey("dispatch-scheduling", adminGroups), "dispatch"));
ok("active group: 'technician-workspace' -> Technician Workspace", () =>
  assert.equal(findActiveServiceGroupKey("technician-workspace", adminGroups), "technicianWorkspace"));
// Same as '' above: Coordinated Visits lost its ungoverned placeholder row in the Wave 16 cutover,
// so it is not among the visible children this session's Dispatch group holds, and the lookup
// correctly finds no group for the URL.
ok("active group: 'coordinated-visits' -> null when it is not visible to this session", () =>
  assert.equal(findActiveServiceGroupKey("coordinated-visits", adminGroups), null));
ok("active group: 'coordinated-mission' -> Technician Workspace", () =>
  assert.equal(findActiveServiceGroupKey("coordinated-mission", adminGroups), "technicianWorkspace"));
ok("active group: 'control-tower' (standalone) -> null", () =>
  assert.equal(findActiveServiceGroupKey("control-tower", adminGroups), null));
ok("active group: unknown tail -> null", () =>
  assert.equal(findActiveServiceGroupKey("nope", adminGroups), null));

console.log(`\n${passed} passed, 0 failed`);
