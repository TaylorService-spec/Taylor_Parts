// Component and action registries — contract tests.
//
// This is where a metadata id becomes something that runs, so it is where boundary
// §6 and §8 are either enforced or quietly lost. The tests target that, not the
// bookkeeping.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  COMPONENT_KIND, ACTION_KIND,
  componentRegistry, actionRegistry,
  referencedRegistryIds, validateRegistryReferences, declaredActionCapabilities,
} from "../src/metadata/registry.js";

// LEDGER.md X-REGISTRY-VALIDATOR-NEVER-RUN — every real ListViewDefinition in the repo,
// imported so validateRegistryReferences can be run against them below instead of only
// against hand-built objects. These are plain data modules (no React, no firebase, no JSX)
// so they import cleanly under plain `node --test`, unlike src/metadata/definitions/
// accountPageComponents.js — see the "PageDefinition" block below for why that one real
// registration module needs a different (vitest) test instead of one here.
import { accountIndexList } from "../src/metadata/definitions/account.js";
import { contactIndexList, contactRelatedList } from "../src/metadata/definitions/contact.js";
import { employeeIndexList } from "../src/metadata/definitions/employee.js";
import { equipmentIndexList } from "../src/metadata/definitions/equipment.js";
import { equipmentModelIndexList } from "../src/metadata/definitions/equipmentModel.js";
import { invoiceIndexList } from "../src/metadata/definitions/invoice.js";
import { locationIndexList, locationRelatedList } from "../src/metadata/definitions/location.js";
import { manufacturerIndexList } from "../src/metadata/definitions/manufacturer.js";
import { opportunityIndexList, opportunityRelatedList } from "../src/metadata/definitions/opportunity.js";
import { partIndexList } from "../src/metadata/definitions/part.js";
import { purchaseOrderIndexList } from "../src/metadata/definitions/purchaseOrder.js";
import { salesOrderIndexList, salesOrderRelatedList } from "../src/metadata/definitions/salesOrder.js";
import { supplierIndexList } from "../src/metadata/definitions/supplier.js";
import { truckIndexList } from "../src/metadata/definitions/truck.js";
import { warehouseIndexList } from "../src/metadata/definitions/warehouse.js";
import { workOrderIndexList } from "../src/metadata/definitions/workOrder.js";

const Noop = () => null;

// Every real ListViewDefinition currently exported anywhere under src/metadata/definitions/
// (verified by a repo-wide grep for `makeListViewDefinition(` at the time this was written —
// 20 of them). Named individually, not globbed, so an id typo above fails loudly at import
// time rather than silently narrowing what gets checked.
const REAL_LIST_DEFINITIONS = [
  accountIndexList, contactIndexList, contactRelatedList, employeeIndexList, equipmentIndexList,
  equipmentModelIndexList, invoiceIndexList, locationIndexList, locationRelatedList,
  manufacturerIndexList, opportunityIndexList, opportunityRelatedList, partIndexList,
  purchaseOrderIndexList, salesOrderIndexList, salesOrderRelatedList, supplierIndexList,
  truckIndexList, warehouseIndexList, workOrderIndexList,
];

beforeEach(() => {
  componentRegistry.__resetForTest();
  actionRegistry.__resetForTest();
});

test("enums are frozen", () => {
  for (const e of [COMPONENT_KIND, ACTION_KIND]) {
    assert.ok(Object.isFrozen(e));
    assert.throws(() => e.push("NOPE"));
  }
});

test("a well-formed component and action register", () => {
  assert.equal(componentRegistry.register({ id: "record.relatedList", kind: "RECORD_SECTION", component: Noop }), "record.relatedList");
  assert.equal(
    actionRegistry.register({
      id: "workOrder.dispatch", label: "Dispatch", kind: "GOVERNED_COMMAND",
      command: "transitionWorkOrder", capabilityRequirement: "workOrder.transition",
    }),
    "workOrder.dispatch",
  );
});

// --- §6: declaring is not deciding ------------------------------------------

test("§6 — a governed action must declare the capability its command requires", () => {
  assert.throws(
    () => actionRegistry.register({ id: "a", label: "A", kind: "GOVERNED_COMMAND", command: "doThing" }),
    /must declare its capabilityRequirement/,
    "without a capability id nothing downstream can ask the resolver the right question",
  );
});

test("§6 — a governed action must name the command it dispatches", () => {
  assert.throws(
    () => actionRegistry.register({ id: "a", label: "A", kind: "GOVERNED_COMMAND", capabilityRequirement: "x.write" }),
    /must name the command it dispatches/,
  );
});

test("§6 — declaredActionCapabilities returns ids to hand to a resolver, never a decision", () => {
  actionRegistry.register({
    id: "wo.dispatch", label: "Dispatch", kind: "GOVERNED_COMMAND",
    command: "transitionWorkOrder", capabilityRequirement: "workOrder.transition",
  });
  actionRegistry.register({
    id: "so.allocate", label: "Allocate", kind: "GOVERNED_COMMAND",
    command: "allocateSalesOrder", capabilityRequirement: "salesOrder.fulfill",
  });
  actionRegistry.register({ id: "open", label: "Open", kind: "NAVIGATION" });

  const caps = declaredActionCapabilities({ rowActions: ["wo.dispatch", "so.allocate", "open"] });
  assert.deepEqual(caps, ["salesOrder.fulfill", "workOrder.transition"]);
  for (const c of caps) assert.equal(typeof c, "string", "capabilities are ids, never booleans");
});

test("§6 — resolving an action never yields an authorization answer", () => {
  actionRegistry.register({
    id: "wo.dispatch", label: "Dispatch", kind: "GOVERNED_COMMAND",
    command: "transitionWorkOrder", capabilityRequirement: "workOrder.transition",
  });
  const entry = actionRegistry.resolve("wo.dispatch");
  assert.equal(entry.capabilityRequirement, "workOrder.transition");
  assert.equal("allowed" in entry, false);
  assert.equal("permitted" in entry, false);
});

test("§6 — only a GOVERNED_COMMAND may name a command", () => {
  // Navigation and disclosure exist so harmless affordances need not masquerade as
  // commands. If they could carry a command path, the dangerous ones would stop
  // standing out.
  assert.throws(
    () => actionRegistry.register({ id: "open", label: "Open", kind: "NAVIGATION", command: "transitionWorkOrder" }),
    /must not name a command/,
  );
});

// --- §8: configuration selects from a fixed menu ----------------------------

test("§8 — a definition can only ever reference an id, so no configuration path reaches a function", () => {
  // The asymmetry that makes the whole model safe: application code registers
  // behavior; definitions select from what was registered. Widening what a tenant may
  // configure therefore can never widen what code may run.
  // Uses regions[].componentId, not a column renderer: `renderer` was REMOVED from the
  // list-view contract (validateListViewDefinition now rejects it), so a test built on it
  // would be asserting against a shape no valid definition can have. The §8 property this
  // test exists for -- a definition references ids and never a function -- is unchanged.
  const def = { id: "l", regions: [{ componentId: "currency" }], rowActions: ["wo.dispatch"] };
  const { components, actions } = referencedRegistryIds(def);
  assert.deepEqual(components, ["currency"]);
  assert.deepEqual(actions, ["wo.dispatch"]);
  for (const v of [...components, ...actions]) assert.equal(typeof v, "string");
});

test("§8 — a component entry must be a real component, and a non-function handler is rejected", () => {
  assert.throws(() => componentRegistry.register({ id: "x", kind: "CELL_RENDERER", component: "not-a-function" }),
    /component must be a function/);
  assert.throws(
    () => actionRegistry.register({ id: "a", label: "A", kind: "NAVIGATION", handler: "alert('hi')" }),
    /handler, if present, must be a function/,
    "a string handler is a script; it must never be accepted",
  );
});

// --- unregistered references fail before paint, not in front of a user ------

test("a definition referencing an unregistered component or action is caught by validation", () => {
  componentRegistry.register({ id: "currency", kind: "CELL_RENDERER", component: Noop });
  const problems = validateRegistryReferences({
    id: "account.index",
    regions: [{ componentId: "currency" }, { componentId: "ghost" }],
    rowActions: ["phantom"],
  });
  assert.ok(problems.some((p) => /unregistered component "ghost"/.test(p)));
  assert.ok(problems.some((p) => /unregistered action "phantom"/.test(p)));
  assert.ok(!problems.some((p) => /currency/.test(p)), "a registered reference is not reported");
});

test("resolve returns null for an unknown id rather than guessing a fallback", () => {
  // A fallback renderer would turn a typo into a silently wrong cell.
  assert.equal(componentRegistry.resolve("nope"), null);
  assert.equal(actionRegistry.resolve("nope"), null);
});

// --- id stability ------------------------------------------------------------

test("re-registering an id throws — a silent overwrite could shadow a governed action", () => {
  actionRegistry.register({
    id: "wo.dispatch", label: "Dispatch", kind: "GOVERNED_COMMAND",
    command: "transitionWorkOrder", capabilityRequirement: "workOrder.transition",
  });
  assert.throws(
    () => actionRegistry.register({
      id: "wo.dispatch", label: "Dispatch", kind: "GOVERNED_COMMAND",
      command: "somethingElse", capabilityRequirement: "unrelated.capability",
    }),
    /already registered/,
    "a late import replacing a governed action under the same id is how an authorization gap appears with no diff looking wrong",
  );
});

test("registered entries are frozen — a consumer cannot mutate a command or capability at runtime", () => {
  actionRegistry.register({
    id: "wo.dispatch", label: "Dispatch", kind: "GOVERNED_COMMAND",
    command: "transitionWorkOrder", capabilityRequirement: "workOrder.transition",
  });
  const entry = actionRegistry.resolve("wo.dispatch");
  assert.ok(Object.isFrozen(entry));
  assert.throws(() => { entry.capabilityRequirement = "something.weaker"; });
});

test("id and label must be distinct concepts", () => {
  assert.throws(
    () => actionRegistry.register({ id: "Dispatch", label: "Dispatch", kind: "NAVIGATION" }),
    /distinct concepts/,
  );
});

test("unknown kinds are rejected on both registries", () => {
  assert.throws(() => componentRegistry.register({ id: "x", kind: "WIDGET", component: Noop }), /not a known COMPONENT_KIND/);
  assert.throws(() => actionRegistry.register({ id: "x", label: "X", kind: "MUTATE" }), /not a known ACTION_KIND/);
});

// --- X-REGISTRY-VALIDATOR-NEVER-RUN — run the validator over REAL definitions -----------
//
// Until now validateRegistryReferences' only caller anywhere in the repo was its own test
// above, feeding it a hand-built object ("account.index" with a "currency"/"ghost" column).
// No real definition had ever been passed through it. These tests are that missing run: the
// same 20 real ListViewDefinition exports the app actually ships (imported above, not
// reconstructed), checked with the SAME registries this file's beforeEach resets before every
// test — i.e. this is not a permissive hand-built registry standing in for the real one,
// it is the real (currently empty, for CELL_RENDERER/GOVERNED_COMMAND) registry state.
//
// HONEST SCOPE NOTE: no real list definition declares a non-empty `rowActions` (verified by a
// repo-wide grep), and nothing in application code registers a GOVERNED_COMMAND/NAVIGATION/
// DISCLOSURE action. So today these tests pass vacuously — there is nothing referenced to be
// unregistered. Their value is forward-looking: the moment ANY definition adds a row/section
// action id, this fails unless something registers it.
//
// Column `renderer` USED to be the other half of this note. It was removed from the contract
// entirely rather than implemented, because nothing declared one and nothing registered a
// CELL_RENDERER — so referencedRegistryIds no longer looks for it. A lookup for a property no
// valid definition can carry is the same dead-declaration shape the removal was meant to end.
test("every real ListViewDefinition passes validateRegistryReferences", () => {
  assert.equal(REAL_LIST_DEFINITIONS.length, 20, "the named import list drifted from definitions/*.js — update both");
  for (const def of REAL_LIST_DEFINITIONS) {
    const problems = validateRegistryReferences(def);
    assert.deepEqual(problems, [], `${def.id}: ${problems.join("; ")}`);
  }
});

// PageDefinition (accountPage.js's accountRecordPage) is NOT included above: registry.js's
// validateRegistryReferences reads `def.regions`/`def.rowActions`/`def.actions`, but a
// PageDefinition's real shape is `def.sections[].componentId` / `def.sections[].actions` /
// `def.headerActions` (pageDefinition.js's makeSection/makePageDefinition) — calling
// validateRegistryReferences directly on a PageDefinition silently finds zero references and
// "passes" without checking anything, which would just relocate the hollow-assurance problem
// rather than fix it. pageDefinition.js already exports the correctly-shaped sibling,
// `pageRegistryReferences`, for exactly this — also never called outside its own unit test
// until now (LEDGER.md X-UNCONSUMED-DECLARATION-PATTERN). Running accountRecordPage through
// it, against the REAL registerAccountPageComponents() registration (not a hand-built
// registry), requires importing src/metadata/definitions/accountPageComponents.js — which
// pulls in React, react-router, and an extensionless `../../firebase/firebase` specifier.
// Plain `node --test` cannot resolve any of that (verified: it throws ERR_MODULE_NOT_FOUND
// before a single assertion runs), so that check lives in
// test/metadataRegistryRealPageDefinition.test.jsx instead, run under vitest's jsdom
// pipeline — see that file's header for the full account and its REGISTRATION_PENDING status.
