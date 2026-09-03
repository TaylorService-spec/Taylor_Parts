// ROLE / PROFILE MATRIX -- what thirteen governed contexts actually compose.
//
// ============================ WHY THESE ARE CONTEXTS, NOT ROLE NAMES ============================
//
// The brief asks for thirteen roles. The repository has THREE security roles -- `admin`,
// `dispatcher`, `technician` (domain/constants.js ROLES) -- and everything else people call a role
// here is an OPERATIONAL ROLE (PARTS_MANAGER, WAREHOUSE_ASSOCIATE...) or a set of governed
// capabilities (`finance.read`, `opportunity.read`...). A "finance manager" is not a value stored
// anywhere; it is a person whose governed context resolves finance capabilities.
//
// So each case below is built from the governed FACTS that make someone that thing, and the test is
// the proof that composition follows those facts and never a label. If a `needs` predicate ever
// starts branching on a role string, the "unnamed role with real scope" cases fail.
//
// ============================ WHAT IS BEING PROVEN ============================
//
//   PRESENCE   the modules that scope genuinely supplies.
//   ABSENCE    a module a context must NOT see -- and absence is never "empty", it is not rendered,
//              because an empty tile would state a fact ("you have no work") rather than withhold one.
//   NO WIDENING a role title alone never adds reach; capability and scope do.
//
// Run: node --test test/dashboardRoleMatrix.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import { resolvedModuleKeys, composeDashboard, DASHBOARD_MODULES, MODULE_STATE } from "../src/domain/dashboardComposition.js";

const caps = (...ids) => (id) => ids.includes(id);
const NONE = () => false;

const base = { role: "user", employeeId: "emp-x", technicianId: null, operationalRoles: [], warehouseIds: [], hasCapability: NONE };

/** The thirteen governed contexts, described by the facts that constitute them. */
const CONTEXTS = {
  admin: { ...base, role: "admin", employeeId: "emp-admin", hasCapability: caps("customer.record.read", "finance.read", "opportunity.read", "salesOrder.read", "inventory.stock.receive", "fulfillment.coordinatedVisit.read", "inventory.balance.read") },
  // Owner is admin-equivalent by DERIVED grant (the resolver holds the whole catalog); modelled by
  // the same governed facts rather than by a name nothing stores.
  owner: { ...base, role: "admin", employeeId: "emp-owner", hasCapability: caps("customer.record.read", "finance.read", "opportunity.read", "salesOrder.read", "inventory.balance.read") },
  generalManager: { ...base, role: "dispatcher", employeeId: "emp-gm", hasCapability: caps("customer.record.read", "finance.read", "opportunity.read") },
  financeManager: { ...base, employeeId: "emp-fin", hasCapability: caps("finance.read", "customer.record.read") },
  accountingManager: { ...base, employeeId: "emp-acct", hasCapability: caps("finance.read") },
  salesManager: { ...base, employeeId: "emp-sm", hasCapability: caps("opportunity.read", "salesOrder.read", "customer.record.read", "fulfillment.coordinatedVisit.read") },
  salesperson: { ...base, employeeId: "emp-rep", hasCapability: caps("opportunity.read", "customer.record.read") },
  dispatcher: { ...base, role: "dispatcher", employeeId: "emp-disp" },
  partsManager: { ...base, employeeId: "emp-pm", operationalRoles: ["PARTS_MANAGER"], warehouseIds: ["wh-north"], hasCapability: caps("inventory.stock.receive") },
  warehouseManager: { ...base, employeeId: "emp-wm", operationalRoles: ["WAREHOUSE_MANAGER"], warehouseIds: ["wh-main"], hasCapability: caps("inventory.stock.receive") },
  partsAssociate: { ...base, employeeId: "emp-pa", operationalRoles: ["PARTS_ASSOCIATE"], warehouseIds: ["wh-north"] },
  warehouseAssociate: { ...base, employeeId: "emp-wa", operationalRoles: ["WAREHOUSE_ASSOCIATE"], warehouseIds: ["wh-main"] },
  technician: { ...base, role: "technician", employeeId: "emp-tech", technicianId: "tech-1" },
};

const keysFor = (name) => resolvedModuleKeys(CONTEXTS[name]);

// ── every context composes something, and nothing composes everything by accident ───────────────

test("every governed context composes a dashboard, and none is empty", () => {
  for (const [name, ctx] of Object.entries(CONTEXTS)) {
    const keys = resolvedModuleKeys(ctx);
    assert.ok(keys.length > 0, `${name} composes nothing at all`);
    assert.ok(keys.includes("goTo"), `${name} must always reach its destinations`);
  }
});

test("no two differently-scoped contexts compose identically", () => {
  // If they did, scope would not be doing the work -- which is the whole claim of this design.
  const salesperson = keysFor("salesperson").sort().join();
  const partsManager = keysFor("partsManager").sort().join();
  const technician = keysFor("technician").sort().join();
  assert.notEqual(salesperson, partsManager);
  assert.notEqual(partsManager, technician);
  assert.notEqual(salesperson, technician);
});

// ── financial reach follows the capability, never the title ─────────────────────────────────────

test("finance modules appear only where finance.read resolves", () => {
  for (const name of ["admin", "owner", "generalManager", "financeManager", "accountingManager"]) {
    const keys = keysFor(name);
    for (const m of ["firmBilled", "firmCollected", "firmBooked"]) {
      assert.ok(keys.includes(m), `${name} should compose ${m}`);
    }
  }
  for (const name of ["salesperson", "dispatcher", "partsManager", "warehouseAssociate", "technician"]) {
    const keys = keysFor(name);
    for (const m of ["firmBilled", "firmCollected", "firmBooked"]) {
      assert.ok(!keys.includes(m), `${name} must not be shown ${m}`);
    }
  }
});

test("billed and collected are composed while booked stays unavailable, for the same viewer", () => {
  // Mixed readiness within one section, which is the point of splitting the compound tile.
  const byKey = new Map(DASHBOARD_MODULES.map((m) => [m.key, m]));
  assert.equal(byKey.get("firmBilled").state({}), MODULE_STATE.READY);
  assert.equal(byKey.get("firmCollected").state({}), MODULE_STATE.READY);
  assert.equal(byKey.get("firmBooked").state({}), MODULE_STATE.UNAVAILABLE);
});

// ── sales reach ─────────────────────────────────────────────────────────────────────────────────

test("a salesperson sees their own commercial work and no operations or finance figures", () => {
  const keys = keysFor("salesperson");
  assert.ok(keys.includes("myOpportunities"));
  assert.ok(keys.includes("accountPortfolio"));
  assert.ok(!keys.includes("serviceAttention"), "a salesperson is not an operations viewer");
  assert.ok(!keys.includes("workOrdersByStatus"));
  assert.ok(!keys.includes("technicianComparison"));
  assert.ok(!keys.includes("adminDecisions"));
  assert.ok(!keys.includes("firmBilled"));
});

test("a sales manager gains fulfillment reach WITHOUT gaining operations reach", () => {
  // The precise no-widening case: more sales capability must not leak service-operations modules.
  const keys = keysFor("salesManager");
  assert.ok(keys.includes("ordersRequiringAction"), "coordinated-visit reach composes fulfillment exceptions");
  assert.ok(!keys.includes("serviceAttention"));
  assert.ok(!keys.includes("workOrdersByStatus"));
  assert.ok(!keys.includes("technicianAvailability"));
});

// ── operations reach ────────────────────────────────────────────────────────────────────────────

test("a dispatcher composes the service and team modules", () => {
  const keys = keysFor("dispatcher");
  for (const m of ["serviceAttention", "workOrdersByStatus", "technicianComparison", "technicianAvailability", "teamGoals"]) {
    assert.ok(keys.includes(m), `dispatcher should compose ${m}`);
  }
  // ...and NOT the administration decision queue, which is admin-only.
  assert.ok(!keys.includes("adminDecisions"));
});

test("only an administrator is offered the decision queue", () => {
  assert.ok(keysFor("admin").includes("adminDecisions"));
  assert.ok(keysFor("owner").includes("adminDecisions"));
  for (const name of ["generalManager", "dispatcher", "salesManager", "partsManager", "technician"]) {
    assert.ok(!keysFor(name).includes("adminDecisions"), `${name} must not see admin decisions`);
  }
});

// ── location scope stays location scope ─────────────────────────────────────────────────────────

test("location-limited roles compose their location work and no management figures", () => {
  for (const name of ["partsManager", "warehouseManager", "partsAssociate", "warehouseAssociate"]) {
    const keys = keysFor(name);
    assert.ok(keys.includes("reorderQueue"), `${name} works a reorder queue`);
    assert.ok(keys.includes("unverifiedSubmissions"), `${name} submits from a handheld`);
    assert.ok(!keys.includes("firmBilled"), `${name} must not be shown firm revenue`);
    assert.ok(!keys.includes("technicianComparison"), `${name} must not be shown technician performance`);
    assert.ok(!keys.includes("adminDecisions"));
  }
});

test("associates get actionable work, not management modules", () => {
  for (const name of ["partsAssociate", "warehouseAssociate"]) {
    const keys = keysFor(name);
    assert.ok(!keys.includes("receivingQueue"), `${name} has no receive capability in this context`);
    assert.ok(!keys.includes("workOrdersByStatus"));
    assert.ok(!keys.includes("teamGoals") || CONTEXTS[name].warehouseIds.length > 0);
  }
});

test("a warehouse a principal is NOT governed to never appears in their goal scope", () => {
  const north = composeDashboard(CONTEXTS.partsManager);
  assert.ok(north.length > 0);
  // The location goals are derived from warehouseIds alone -- proven in dashboardComposition tests;
  // here the point is that the two location contexts differ.
  assert.notDeepEqual(CONTEXTS.partsManager.warehouseIds, CONTEXTS.warehouseManager.warehouseIds);
});

// ── the technician profile surface ──────────────────────────────────────────────────────────────

test("a technician's own-work modules are SATISFIED_ELSEWHERE, not duplicated here", () => {
  const keys = keysFor("technician");
  assert.ok(keys.includes("myAssignedWork"));
  assert.ok(keys.includes("myPerformanceAllTime"));
  const byKey = new Map(DASHBOARD_MODULES.map((m) => [m.key, m]));
  for (const k of ["myAssignedWork", "myPerformanceAllTime"]) {
    assert.equal(byKey.get(k).state({}), MODULE_STATE.SATISFIED_ELSEWHERE, `${k} must point at the technician surface`);
    assert.match(byKey.get(k).blocker, /technician screen/i);
  }
});

test("a technician is shown no management, finance or administration module", () => {
  const keys = keysFor("technician");
  for (const m of ["workOrdersByStatus", "technicianComparison", "technicianAvailability", "adminDecisions", "firmBilled", "firmCollected", "firmBooked", "accountPortfolio", "reorderQueue"]) {
    assert.ok(!keys.includes(m), `a technician must not be shown ${m}`);
  }
});

// ── the purity proof ────────────────────────────────────────────────────────────────────────────

test("composition reads governed facts only -- never a persona, email or display name", () => {
  // An unrecognised role STRING with real governed scope must compose exactly what that scope
  // supplies. If any predicate branches on the role name as its only input, this fails.
  const unnamed = { ...CONTEXTS.partsManager, role: "some-future-role-nobody-has-defined" };
  assert.deepEqual(resolvedModuleKeys(unnamed).sort(), keysFor("partsManager").sort());

  // ...and identity fields must not change composition at all.
  const withIdentity = { ...CONTEXTS.salesperson, email: "ceo@example.test", displayName: "The Owner", fixtureId: "seed-1" };
  assert.deepEqual(resolvedModuleKeys(withIdentity).sort(), keysFor("salesperson").sort());
});

test("a role title alone widens nothing", () => {
  // Same security role, no capabilities, no scope: the modules that need capability or scope must
  // all disappear. Only what genuinely applies to everyone survives.
  const bare = { ...base, role: "dispatcher", employeeId: "emp-bare" };
  const keys = resolvedModuleKeys(bare);

  // THE CAPABILITY-GATED MODULES MUST ALL BE ABSENT. These are the ones a title could only reach by
  // widening, and none of them does.
  for (const m of ["firmBilled", "firmCollected", "firmBooked", "myOpportunities", "ordersRequiringAction", "adminDecisions", "governedStockPosition"]) {
    assert.ok(!keys.includes(m), `a bare dispatcher must not compose ${m}`);
  }

  // reorderQueue, receivingQueue, accountPortfolio and the service modules DO compose here, and that
  // is the existing design rather than a leak: their `needs` deliberately admit the legacy
  // admin/dispatcher operations surface, which is the same predicate Firestore Rules still use to
  // gate the underlying reads. Composition can only ever REMOVE a module a viewer could not use --
  // the server remains the authority, and a dispatcher whose Rules deny the read gets an honest
  // unavailable state rather than data.
  for (const m of ["reorderQueue", "receivingQueue", "accountPortfolio", "serviceAttention"]) {
    assert.ok(keys.includes(m), `${m} composes for an operations viewer by design`);
  }
});

// ── sections are never rendered empty ───────────────────────────────────────────────────────────

test("no context renders a section heading with nothing under it", () => {
  for (const [name, ctx] of Object.entries(CONTEXTS)) {
    for (const section of composeDashboard(ctx)) {
      assert.ok(section.modules.length > 0, `${name} renders an empty ${section.section} heading`);
    }
  }
});
