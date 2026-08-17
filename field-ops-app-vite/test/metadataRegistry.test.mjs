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

const Noop = () => null;

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
  const def = { id: "l", columns: [{ fieldId: "balance", renderer: "currency" }], rowActions: ["wo.dispatch"] };
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
    columns: [{ fieldId: "balance", renderer: "currency" }, { fieldId: "x", renderer: "ghost" }],
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
