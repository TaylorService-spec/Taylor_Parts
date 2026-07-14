// Platform Task 3 -- Service Operations top-level area. Deterministic unit tests
// against the REAL NAV_DOMAINS + role access: the promoted top-level domain's
// per-role visibility (admin/dispatcher only; technician + unauthorized roles
// fail closed), the stable "controlTower" legacyKey wiring, Control Tower's
// removal from the Service sub-nav, and the Dashboard label rename.
//
// Run: node test/serviceOperationsNav.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { NAV_DOMAINS, isDomainVisible, isNavItemVisible } from "../src/navigation/navConfig.js";
import { ROLES, ROLE_NAV_ACCESS } from "../src/domain/constants.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const domain = (key) => NAV_DOMAINS.find((d) => d.key === key);
const serviceOps = domain("serviceOperations");
const service = domain("service");
const visD = (d, role) => isDomainVisible(d, role, ROLE_NAV_ACCESS[role], undefined);

// ===== Service Operations is a top-level area at /service-operations =====
ok("serviceOperations is a top-level NAV_DOMAIN at /service-operations", () => {
  assert.ok(serviceOps, "serviceOperations domain exists");
  assert.equal(serviceOps.path, "service-operations");
  assert.notEqual(serviceOps.future, true);
});
ok("serviceOperations renders via the stable 'controlTower' legacyKey", () => {
  assert.equal(serviceOps.subnav.length, 1);
  const item = serviceOps.subnav[0];
  assert.equal(item.path, ""); // index screen
  assert.equal(item.legacyKey, "controlTower");
});

// ===== Visibility: admin/dispatcher only; everyone else fails closed =====
ok("Service Operations visible to admin", () => assert.equal(visD(serviceOps, ROLES.ADMIN), true));
ok("Service Operations visible to dispatcher", () => assert.equal(visD(serviceOps, ROLES.DISPATCHER), true));
ok("Service Operations HIDDEN for technician (fails closed)", () => assert.equal(visD(serviceOps, ROLES.TECHNICIAN), false));
ok("Service Operations HIDDEN for an unknown/unauthorized role (fails closed)", () =>
  assert.equal(isDomainVisible(serviceOps, "no_such_role", ROLE_NAV_ACCESS["no_such_role"], undefined), false));
ok("Service Operations index item visibility mirrors the domain (admin/dispatcher only)", () => {
  const item = serviceOps.subnav[0];
  assert.equal(isNavItemVisible(item, ROLES.ADMIN, ROLE_NAV_ACCESS[ROLES.ADMIN], undefined), true);
  assert.equal(isNavItemVisible(item, ROLES.DISPATCHER, ROLE_NAV_ACCESS[ROLES.DISPATCHER], undefined), true);
  assert.equal(isNavItemVisible(item, ROLES.TECHNICIAN, ROLE_NAV_ACCESS[ROLES.TECHNICIAN], undefined), false);
});

// ===== Control Tower removed from the Service sub-nav =====
ok("Service sub-nav no longer contains a control-tower item", () => {
  assert.ok(!service.subnav.some((it) => it.key === "controlTower"));
  assert.ok(!service.subnav.some((it) => it.path === "control-tower"));
});

// ===== Dashboard label rename (path/legacyKey unchanged) =====
ok("Dashboard 'operations' relabeled 'Inventory & Supply Overview'; path/legacyKey unchanged", () => {
  const opsItem = domain("dashboard").subnav.find((it) => it.key === "operationsDashboard");
  assert.equal(opsItem.label, "Inventory & Supply Overview");
  assert.equal(opsItem.path, "operations");
  assert.equal(opsItem.legacyKey, "operations");
});

// ===== Grouped Service nav (PR #203) preserved: three groups still present =====
ok("Service still exposes exactly Work Management / Dispatch / Technician Workspace children", () => {
  const keys = service.subnav.map((it) => it.key);
  for (const k of ["workOrders", "jobAssignments", "warranty", "dispatcherBoard", "scheduling", "dispatch", "technicianWorkspace"]) {
    assert.ok(keys.includes(k), `service subnav retains ${k}`);
  }
});

console.log(`\n${passed} passed, 0 failed`);
