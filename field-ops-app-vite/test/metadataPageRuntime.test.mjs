// Page composition runtime — contract tests.
//
// Composition rules are worth asserting exhaustively because a section rendering when it
// should not is a governance failure rather than a cosmetic one. They are only
// assertable offline while the runtime stays pure, which is why it produces a plan
// instead of JSX.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../src/metadata/entityDefinition.js";
import { makeSection, makePageDefinition, validatePageDefinition } from "../src/metadata/pageDefinition.js";
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

// --- X-SECTION-CAPABILITY-GRANULARITY -----------------------------------------
//
// A section capability cannot express a partially-gated composition today: the recorded
// case is Account "Attention", which composes an AR read (finance.read) with an ungated
// Work-Order-past-due read under one capabilityRequirement, forcing the coarsest single
// answer for the whole section. `capabilityParts` lets a section declare per-part
// authority instead; these tests cover the additive contract makeSection/pageDefinition.js
// and applyVisibility/pageRuntime.js implement for it.

const accountEntity = () =>
  makeEntityDefinition({
    id: "account", label: "Customer", collection: "accounts", readVia: "CLIENT_DIRECT",
    identity: makeIdentity({ nameField: "name" }),
    fields: ["name", "ar", "workOrders"].map((f) =>
      makeFieldDefinition({ id: f, entityId: "account", label: f.toUpperCase(), type: "STRING" })
    ),
  });

const composedSection = (over = {}) => makeSection({
  id: "attention", kind: "FIELD_GROUP", region: "SIDE", order: 0, fieldIds: ["ar", "workOrders"],
  capabilityParts: [
    { id: "ar", capabilityRequirement: "finance.read", fieldIds: ["ar"] },
    { id: "workOrders", capabilityRequirement: null, fieldIds: ["workOrders"] },
  ],
  ...over,
});

// --- additivity: every existing single-capabilityRequirement definition is untouched ---

test("ADDITIVITY — a plain single-capabilityRequirement section produces the exact same plan shape as before capabilityParts existed", () => {
  const def = makePageDefinition({
    id: "p", entityId: "e", label: "P",
    sections: [
      makeSection({ id: "open", kind: "FIELD_GROUP", region: "MAIN", order: 0, fieldIds: ["a"] }),
      makeSection({ id: "gated", kind: "FIELD_GROUP", region: "MAIN", order: 1, fieldIds: ["b"], capabilityRequirement: "finance.read" }),
    ],
  });
  const plan = buildCompositionPlan(def);

  // capabilityParts is always present (null) on a plan section — additive, never absent —
  // but the section carries none of the new composed-section fields.
  for (const s of plan.sections) {
    assert.equal(s.capabilityParts, null);
    assert.equal("visiblePartIds" in s, false);
    assert.equal("withheldPartIds" in s, false);
    assert.equal("partiallyWithheld" in s, false);
  }

  for (const decisions of [{}, { "finance.read": false }, { "finance.read": true }]) {
    const v = applyVisibility(plan, decisions);
    const expectVisible = decisions["finance.read"] === true;
    assert.deepEqual(v.sections.map((s) => s.id), expectVisible ? ["open", "gated"] : ["open"]);
    assert.deepEqual(v.hidden, expectVisible ? [] : ["gated"]);
    // The visible "gated" section, when present, is untouched — same object shape as
    // pre-capabilityParts, no new composed-section keys leaking onto a single-gate section.
    const gated = v.sections.find((s) => s.id === "gated");
    if (gated) {
      assert.equal("visiblePartIds" in gated, false);
      assert.equal("withheldPartIds" in gated, false);
      assert.equal("partiallyWithheld" in gated, false);
    }
  }
});

test("ADDITIVITY — the already-accepted precedent stands: a section whose OWN single capability is denied is removed from the plan entirely", () => {
  const def = makePageDefinition({
    id: "p", entityId: "e", label: "P",
    sections: [makeSection({ id: "financials", kind: "FIELD_GROUP", region: "MAIN", order: 0, fieldIds: ["a"], capabilityRequirement: "finance.read" })],
  });
  const v = applyVisibility(buildCompositionPlan(def), {});
  assert.deepEqual(v.sections, []);
  assert.deepEqual(v.hidden, ["financials"]);
});

// --- capabilityParts: grant/deny combinations -----------------------------------

test("capabilityParts — every part granted: the section is visible, not partially withheld", () => {
  const def = makePageDefinition({ id: "p", entityId: "account", label: "Attention", sections: [composedSection()] });
  const plan = buildCompositionPlan(def);
  const v = applyVisibility(plan, { "finance.read": true });

  assert.deepEqual(v.sections.map((s) => s.id), ["attention"]);
  const s = v.sections[0];
  assert.deepEqual(s.visiblePartIds, ["ar", "workOrders"]);
  assert.deepEqual(s.withheldPartIds, []);
  assert.equal(s.partiallyWithheld, false);
  assert.deepEqual(v.hidden, []);
});

test("capabilityParts — one part denied, one ungated: the section stays in the plan, partially withheld, and the withheld part is named rather than dropped", () => {
  const def = makePageDefinition({ id: "p", entityId: "account", label: "Attention", sections: [composedSection()] });
  const plan = buildCompositionPlan(def);
  const v = applyVisibility(plan, { "finance.read": false });

  assert.deepEqual(v.sections.map((s) => s.id), ["attention"], "the section still renders — it is not empty");
  const s = v.sections[0];
  assert.deepEqual(s.visiblePartIds, ["workOrders"]);
  assert.deepEqual(s.withheldPartIds, ["ar"], "the withheld part is named, not silently discarded");
  assert.equal(s.partiallyWithheld, true);
  assert.deepEqual(v.hidden, [], "a partially-visible section is not in the hidden list");
});

test("capabilityParts — every part denied: the section is removed from the plan, same as a fully-denied single-gate section", () => {
  const def = makePageDefinition({
    id: "p", entityId: "account", label: "Attention",
    sections: [composedSection({
      capabilityParts: [
        { id: "ar", capabilityRequirement: "finance.read", fieldIds: ["ar"] },
        { id: "workOrders", capabilityRequirement: "workOrder.read", fieldIds: ["workOrders"] },
      ],
    })],
  });
  const plan = buildCompositionPlan(def);
  const v = applyVisibility(plan, { "finance.read": false, "workOrder.read": false });

  assert.deepEqual(v.sections, []);
  assert.deepEqual(v.hidden, ["attention"]);
});

// --- fail-closed ------------------------------------------------------------------

test("capabilityParts — fail-closed: an unknown/unresolved/non-true decision denies that part, it never defaults to visible", () => {
  const def = makePageDefinition({ id: "p", entityId: "account", label: "Attention", sections: [composedSection()] });
  const plan = buildCompositionPlan(def);

  for (const decisions of [{}, { "finance.read": false }, { "finance.read": "yes" }, { "finance.read": 1 }, { "finance.read": undefined }]) {
    const v = applyVisibility(plan, decisions);
    const s = v.sections[0];
    assert.deepEqual(s.visiblePartIds, ["workOrders"], `decisions ${JSON.stringify(decisions)} must not reveal "ar"`);
    assert.deepEqual(s.withheldPartIds, ["ar"]);
    assert.equal(s.partiallyWithheld, true);
  }
});

// --- declaredPageCapabilities collects part-level ids too --------------------------

test("capabilityParts — declaredPageCapabilities collects each part's capabilityRequirement", () => {
  const def = makePageDefinition({ id: "p", entityId: "account", label: "Attention", sections: [composedSection()] });
  const caps = declaredPageCapabilities(def);
  assert.ok(caps.includes("finance.read"));
});

// --- validator: malformed capabilityParts declarations are rejected loudly ---------

test("VALIDATION — capabilityParts and capabilityRequirement together is rejected", () => {
  const def = makePageDefinition({
    id: "p", entityId: "account", label: "Attention",
    sections: [makeSection({
      id: "attention", kind: "FIELD_GROUP", region: "SIDE", order: 0, fieldIds: ["ar"],
      capabilityRequirement: "finance.read",
      capabilityParts: [{ id: "ar", capabilityRequirement: "finance.read", fieldIds: ["ar"] }],
    })],
  });
  const problems = validatePageDefinition(def, accountEntity());
  assert.ok(problems.some((p) => /mutually exclusive/.test(p)));
});

test("VALIDATION — an empty capabilityParts array is rejected", () => {
  const def = makePageDefinition({
    id: "p", entityId: "account", label: "Attention",
    sections: [makeSection({ id: "attention", kind: "FIELD_GROUP", region: "SIDE", order: 0, fieldIds: ["ar"], capabilityParts: [] })],
  });
  const problems = validatePageDefinition(def, accountEntity());
  assert.ok(problems.some((p) => /non-empty array/.test(p)));
});

test("VALIDATION — a capabilityParts entry missing an id is rejected", () => {
  const def = makePageDefinition({
    id: "p", entityId: "account", label: "Attention",
    sections: [makeSection({
      id: "attention", kind: "FIELD_GROUP", region: "SIDE", order: 0, fieldIds: ["ar"],
      capabilityParts: [{ capabilityRequirement: "finance.read" }],
    })],
  });
  const problems = validatePageDefinition(def, accountEntity());
  assert.ok(problems.some((p) => /missing a string id/.test(p)));
});

test("VALIDATION — duplicate capabilityParts ids on one section are rejected", () => {
  const def = makePageDefinition({
    id: "p", entityId: "account", label: "Attention",
    sections: [makeSection({
      id: "attention", kind: "FIELD_GROUP", region: "SIDE", order: 0, fieldIds: ["ar"],
      capabilityParts: [
        { id: "ar", capabilityRequirement: "finance.read" },
        { id: "ar", capabilityRequirement: "other.read" },
      ],
    })],
  });
  const problems = validatePageDefinition(def, accountEntity());
  assert.ok(problems.some((p) => /duplicate capabilityParts id/.test(p)));
});

test("VALIDATION — a non-string capabilityRequirement on a part is rejected", () => {
  const def = makePageDefinition({
    id: "p", entityId: "account", label: "Attention",
    sections: [makeSection({
      id: "attention", kind: "FIELD_GROUP", region: "SIDE", order: 0, fieldIds: ["ar"],
      capabilityParts: [{ id: "ar", capabilityRequirement: 42 }],
    })],
  });
  const problems = validatePageDefinition(def, accountEntity());
  assert.ok(problems.some((p) => /capabilityRequirement must be a string or null/.test(p)));
});

test("VALIDATION — capabilityParts fieldIds are rejected on a non-FIELD_GROUP section", () => {
  const def = makePageDefinition({
    id: "p", entityId: "account", label: "Attention",
    sections: [makeSection({
      id: "related", kind: "RELATED_LIST", region: "SIDE", order: 0, listId: "account.opportunities.related",
      capabilityParts: [{ id: "x", capabilityRequirement: "finance.read", fieldIds: ["ar"] }],
    })],
  });
  const problems = validatePageDefinition(def, accountEntity());
  assert.ok(problems.some((p) => /fieldIds are meaningful only on a FIELD_GROUP/.test(p)));
});

test("VALIDATION — a capabilityParts fieldIds entry naming a field not on the section is rejected", () => {
  const def = makePageDefinition({
    id: "p", entityId: "account", label: "Attention",
    sections: [makeSection({
      id: "attention", kind: "FIELD_GROUP", region: "SIDE", order: 0, fieldIds: ["ar"],
      capabilityParts: [{ id: "ar", capabilityRequirement: "finance.read", fieldIds: ["ghost"] }],
    })],
  });
  const problems = validatePageDefinition(def, accountEntity());
  assert.ok(problems.some((p) => /not in this section's own fieldIds/.test(p)));
});

test("VALIDATION — the same fieldId claimed by two capabilityParts entries is rejected", () => {
  const def = makePageDefinition({
    id: "p", entityId: "account", label: "Attention",
    sections: [makeSection({
      id: "attention", kind: "FIELD_GROUP", region: "SIDE", order: 0, fieldIds: ["ar"],
      capabilityParts: [
        { id: "a", capabilityRequirement: "finance.read", fieldIds: ["ar"] },
        { id: "b", capabilityRequirement: "other.read", fieldIds: ["ar"] },
      ],
    })],
  });
  const problems = validatePageDefinition(def, accountEntity());
  assert.ok(problems.some((p) => /claimed by more than one capabilityParts entry/.test(p)));
});

test("VALIDATION — a well-formed capabilityParts section validates clean", () => {
  const def = makePageDefinition({ id: "p", entityId: "account", label: "Attention", sections: [composedSection()] });
  assert.deepEqual(validatePageDefinition(def, accountEntity()), []);
});

// --- the three states stay distinct: denied, unavailable(excluded), empty ----------

test("STATES — a fully-denied composed section (hidden) and a fully-excluded section (unregistered component) are both absent from the plan, but for reported, distinguishable reasons", () => {
  const deniedDef = makePageDefinition({
    id: "p", entityId: "account", label: "Attention",
    sections: [composedSection({
      capabilityParts: [{ id: "ar", capabilityRequirement: "finance.read", fieldIds: ["ar"] }],
    })],
  });
  const deniedPlan = applyVisibility(buildCompositionPlan(deniedDef), { "finance.read": false });
  assert.deepEqual(deniedPlan.sections, []);
  assert.deepEqual(deniedPlan.hidden, ["attention"]); // ACCESS reason, reported via `hidden`

  const excludedDef = workOrderPage({
    sections: [makeSection({ id: "ghost", kind: "LIFECYCLE", region: "MAIN", order: 0, componentId: "record.missing" })],
  });
  const excludedPlan = buildCompositionPlan(excludedDef);
  assert.deepEqual(excludedPlan.sections, []);
  assert.equal(excludedPlan.excluded[0].reason, "UNREGISTERED_COMPONENT"); // CONFIGURATION reason, reported via `excluded`
});

test("STATES — a partially-withheld section is structurally distinguishable from an empty page: it renders with content, flagged, not as 'nothing here'", () => {
  const def = makePageDefinition({ id: "p", entityId: "account", label: "Attention", sections: [composedSection()] });
  const partial = applyVisibility(buildCompositionPlan(def), { "finance.read": false });

  // It is present in the plan (unlike a fully-denied or fully-excluded section)...
  assert.equal(partial.sections.length, 1);
  assert.deepEqual(partial.hidden, []);
  // ...and it says so, rather than rendering as if every part were visible.
  assert.equal(partial.sections[0].partiallyWithheld, true);
  assert.deepEqual(partial.sections[0].withheldPartIds, ["ar"]);

  // Contrast: a page with genuinely nothing configured has no sections and no hidden/
  // withheld trace at all — the two must not collapse into the same shape.
  const emptyDef = makePageDefinition({ id: "e", entityId: "account", label: "Empty", sections: [] });
  const emptyPlan = buildCompositionPlan(emptyDef);
  assert.equal(emptyPlan.sections.length, 0);
  assert.deepEqual(emptyPlan.hidden ?? [], []);
});
