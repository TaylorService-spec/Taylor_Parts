// Page composition runtime — contract tests.
//
// Composition rules are worth asserting exhaustively because a section rendering when it
// should not is a governance failure rather than a cosmetic one. They are only
// assertable offline while the runtime stays pure, which is why it produces a plan
// instead of JSX.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeSection, makePageDefinition } from "../src/metadata/pageDefinition.js";
import { componentRegistry, actionRegistry } from "../src/metadata/registry.js";
import { buildCompositionPlan, applyVisibility, declaredPageCapabilities, EXCLUSION } from "../src/metadata/pageRuntime.js";

const Noop = () => null;
const resolverFor = (...ids) => (id) => (ids.includes(id) ? { id } : null);

beforeEach(() => {
  componentRegistry.__resetForTest();
  actionRegistry.__resetForTest();
  componentRegistry.register({ id: "record.lifecycle", kind: "RECORD_SECTION", component: Noop });
  componentRegistry.register({ id: "record.blockers", kind: "RECORD_SECTION", component: Noop });
  actionRegistry.register({
    id: "wo.dispatch", label: "Dispatch", kind: "GOVERNED_COMMAND",
    command: "transitionWorkOrder", capabilityRequirement: "workOrder.transition",
  });
});

const workOrderPage = (over = {}) => makePageDefinition({
  id: "workOrder.record", entityId: "workOrder", label: "Work Order", compositionMode: "OPERATIONAL",
  headerActions: ["wo.dispatch"],
  sections: [
    makeSection({ id: "lc", kind: "LIFECYCLE", region: "HEADER", order: 0, componentId: "record.lifecycle" }),
    makeSection({ id: "bl", kind: "BLOCKERS", region: "MAIN", order: 1, componentId: "record.blockers" }),
  ],
  ...over,
});

test("a plan places sections into regions in deterministic order", () => {
  const plan = buildCompositionPlan(workOrderPage());
  assert.deepEqual(plan.regions.HEADER.map((s) => s.id), ["lc"]);
  assert.deepEqual(plan.regions.MAIN.map((s) => s.id), ["bl"]);
  assert.deepEqual(plan.regions.SIDE, []);
});

test("ties are broken by id, so layout never depends on authoring sequence", () => {
  // A page whose layout shifts when someone reorders an unrelated line is a page that
  // changes for reasons no diff explains.
  const def = makePageDefinition({
    id: "p", entityId: "e", label: "P",
    sections: [
      makeSection({ id: "zebra", kind: "FIELD_GROUP", region: "MAIN", order: 0, fieldIds: ["a"] }),
      makeSection({ id: "alpha", kind: "FIELD_GROUP", region: "MAIN", order: 0, fieldIds: ["b"] }),
    ],
  });
  assert.deepEqual(buildCompositionPlan(def).regions.MAIN.map((s) => s.id), ["alpha", "zebra"]);
});

// --- §6: presentable is not permitted ---------------------------------------

test("§6 — a plan carries capability ids and never a decision", () => {
  const plan = buildCompositionPlan(workOrderPage({
    sections: [makeSection({ id: "ar", kind: "FIELD_GROUP", region: "MAIN", order: 0, fieldIds: ["x"], capabilityRequirement: "finance.read" })],
  }));
  assert.ok(plan.declaredCapabilities.includes("finance.read"));
  for (const s of plan.sections) {
    assert.equal("allowed" in s, false);
    assert.equal("visible" in s, false);
  }
});

test("§6 — action capabilities are collected from the REGISTRY, not from the definition", () => {
  // The definition names an action id; only the registry knows what that action requires.
  // Reading the requirement off the definition would let a page understate what it needs.
  const caps = declaredPageCapabilities(workOrderPage());
  assert.ok(caps.includes("workOrder.transition"));
});

test("§6 — visibility is applied from a caller-supplied decision map, never resolved here", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/metadata/pageRuntime.js", import.meta.url), "utf8");
  assert.ok(!/from\s+["'].*\/access\//.test(src), "must not import an access module");
  assert.ok(!/resolveEffectiveAccess|hasCapability/.test(src), "must not call a resolver");
});

test("§6 — an unresolved or missing decision hides the section, it does not expose it", () => {
  // Fail-closed at the presentation layer. A resolver that errored and returned {} must
  // not produce a visible section; Rules remain the real boundary either way.
  const def = makePageDefinition({
    id: "p", entityId: "e", label: "P",
    sections: [
      makeSection({ id: "open", kind: "FIELD_GROUP", region: "MAIN", order: 0, fieldIds: ["a"] }),
      makeSection({ id: "gated", kind: "FIELD_GROUP", region: "MAIN", order: 1, fieldIds: ["b"], capabilityRequirement: "finance.read" }),
    ],
  });
  const plan = buildCompositionPlan(def);

  for (const decisions of [{}, { "finance.read": false }, { "finance.read": "yes" }, { "finance.read": 1 }]) {
    const v = applyVisibility(plan, decisions);
    assert.deepEqual(v.sections.map((s) => s.id), ["open"], `decisions ${JSON.stringify(decisions)} must not reveal`);
    assert.deepEqual(v.hidden, ["gated"]);
  }

  const allowed = applyVisibility(plan, { "finance.read": true });
  assert.deepEqual(allowed.sections.map((s) => s.id), ["open", "gated"]);
});

test("§6 — applying visibility rebuilds the regions, so a hidden section leaves no gap", () => {
  const def = makePageDefinition({
    id: "p", entityId: "e", label: "P",
    sections: [makeSection({ id: "gated", kind: "FIELD_GROUP", region: "SIDE", order: 0, fieldIds: ["b"], capabilityRequirement: "finance.read" })],
  });
  const v = applyVisibility(buildCompositionPlan(def), {});
  assert.deepEqual(v.regions.SIDE, [], "the region is empty, not holding a stale entry");
});

// --- exclusions are causes, not one bucket ----------------------------------

test("a section whose component was never registered is EXCLUDED, not rendered blank", () => {
  // An empty region reads to a user as "nothing here", so a broken deploy would look
  // like an empty account. Excluding it makes the cause reportable.
  const def = workOrderPage({
    sections: [makeSection({ id: "ghost", kind: "LIFECYCLE", region: "MAIN", order: 0, componentId: "record.missing" })],
  });
  const plan = buildCompositionPlan(def);
  assert.deepEqual(plan.sections, []);
  assert.equal(plan.excluded[0].reason, "UNREGISTERED_COMPONENT");
  assert.equal(plan.excluded[0].detail, "record.missing");
});

test("a RELATED_LIST pointing at a list that does not resolve is EXCLUDED", () => {
  const def = makePageDefinition({
    id: "p", entityId: "account", label: "Customer",
    sections: [makeSection({ id: "opps", kind: "RELATED_LIST", region: "MAIN", order: 0, listId: "account.opportunities.related" })],
  });
  const plan = buildCompositionPlan(def, { listResolver: resolverFor() });
  assert.equal(plan.excluded[0].reason, "MISSING_LIST");

  const resolved = buildCompositionPlan(def, { listResolver: resolverFor("account.opportunities.related") });
  assert.deepEqual(resolved.sections.map((s) => s.id), ["opps"]);
  assert.deepEqual(resolved.excluded, []);
});

test("every exclusion reason is a known EXCLUSION kind", () => {
  const def = makePageDefinition({
    id: "p", entityId: "e", label: "P",
    sections: [
      makeSection({ id: "a", kind: "LIFECYCLE", region: "MAIN", order: 0, componentId: "nope" }),
      makeSection({ id: "b", kind: "RELATED_LIST", region: "MAIN", order: 1, listId: "nope" }),
    ],
  });
  const plan = buildCompositionPlan(def, { listResolver: resolverFor() });
  assert.equal(plan.excluded.length, 2);
  for (const e of plan.excluded) assert.ok(EXCLUSION.includes(e.reason));
});

// --- §5: a plan can fall below what its page declared ------------------------

test("§5 — exclusions can drop an OPERATIONAL page below its own bar, and the plan says so", () => {
  // The case worth catching: the definition validated as OPERATIONAL, but at runtime a
  // component failed to register and the page is no longer operational. Rendering a
  // diminished page silently is how an operations platform degrades into a form without
  // anyone deciding to.
  const def = workOrderPage({
    sections: [
      makeSection({ id: "lc", kind: "LIFECYCLE", region: "HEADER", order: 0, componentId: "record.lifecycle" }),
      makeSection({ id: "bl", kind: "BLOCKERS", region: "MAIN", order: 1, componentId: "record.missing" }),
    ],
  });
  const plan = buildCompositionPlan(def);
  assert.deepEqual(plan.operational.kinds, ["LIFECYCLE"]);
  assert.equal(plan.operational.satisfiesDeclaredMode, false, "one operational kind does not meet an OPERATIONAL declaration");
});

test("§5 — a complete OPERATIONAL page satisfies its declaration", () => {
  const plan = buildCompositionPlan(workOrderPage());
  assert.deepEqual(plan.operational.kinds, ["LIFECYCLE", "BLOCKERS"]);
  assert.equal(plan.operational.satisfiesDeclaredMode, true);
});

test("§5 — a RECORD page is never judged against an operational bar", () => {
  const def = makePageDefinition({
    id: "account.record", entityId: "account", label: "Customer", compositionMode: "RECORD",
    sections: [makeSection({ id: "f", kind: "FIELD_GROUP", region: "MAIN", order: 0, fieldIds: ["name"] })],
  });
  const plan = buildCompositionPlan(def);
  assert.deepEqual(plan.operational.kinds, []);
  assert.equal(plan.operational.satisfiesDeclaredMode, true, "a RECORD page is not failing by having no lifecycle");
});

// --- §8 ----------------------------------------------------------------------

test("§8 — a plan carries component and action IDS, never functions", () => {
  const plan = buildCompositionPlan(workOrderPage());
  for (const s of plan.sections) {
    assert.notEqual(typeof s.componentId, "function");
    for (const a of s.actions) assert.equal(typeof a, "string");
  }
});
