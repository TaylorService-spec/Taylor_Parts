// PageDefinition / PageRegion — contract tests.
//
// The headline risk this layer carries is not a security lapse. It is arriving at a
// competent record page that has quietly turned an operations platform into CRUD
// screens (boundary §5). Several of these test exactly that, because it is the failure
// that would otherwise pass every other check.

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../src/metadata/entityDefinition.js";
import {
  REGION, SECTION_KIND, OPERATIONAL_SECTION_KINDS,
  makeSection, makePageDefinition, validatePageDefinition,
  assessOperationalComposition, pageRegistryReferences, referencedListIds,
} from "../src/metadata/pageDefinition.js";

const entity = (id = "account", fieldIds = ["name", "status"]) => makeEntityDefinition({
  id, label: id === "account" ? "Customer" : "Work Order",
  collection: id === "account" ? "accounts" : "fieldops_wos",
  readVia: "CLIENT_DIRECT",
  identity: makeIdentity({ nameField: fieldIds[0] }),
  fields: fieldIds.map((f) => makeFieldDefinition({ id: f, entityId: id, label: f.toUpperCase(), type: "STRING" })),
});

const page = (over = {}) => makePageDefinition({
  id: "account.record", entityId: "account", label: "Customer",
  sections: [
    makeSection({ id: "identity", kind: "FIELD_GROUP", region: "HEADER", order: 0, fieldIds: ["name", "status"] }),
  ],
  ...over,
});

test("enums are frozen", () => {
  for (const e of [REGION, SECTION_KIND, OPERATIONAL_SECTION_KINDS]) {
    assert.ok(Object.isFrozen(e));
    assert.throws(() => e.push("NOPE"));
  }
});

test("a well-formed page validates clean", () => {
  assert.deepEqual(validatePageDefinition(page(), entity()), []);
});

// --- §5: operation-centric, not record-centric ------------------------------

test("§5 — the vocabulary names operational concerns as first-class section kinds", () => {
  // If lifecycle, readiness and blockers were only "some component in a slot", a page
  // expressing none of them would be indistinguishable from one expressing all of them,
  // and the CRUD-screens failure would be invisible to every check.
  for (const k of ["LIFECYCLE", "READINESS", "BLOCKERS", "NEXT_ACTIONS", "ATTENTION", "CUSTODY"]) {
    assert.ok(SECTION_KIND.includes(k), `${k} must be expressible as a section kind`);
  }
});

test("§5 — a page of fields and related lists is NOT operation-centric, however valid it is", () => {
  // The exact failure mode: this page passes validation completely. Nothing is broken.
  // It is simply a CRUD screen, and only this assessment says so.
  const crud = makePageDefinition({
    id: "workOrder.record", entityId: "workOrder", label: "Work Order",
    sections: [
      makeSection({ id: "f", kind: "FIELD_GROUP", region: "MAIN", order: 0, fieldIds: ["woNumber"] }),
      makeSection({ id: "r", kind: "RELATED_LIST", region: "MAIN", order: 1, listId: "wo.parts" }),
    ],
  });
  assert.deepEqual(validatePageDefinition(crud, entity("workOrder", ["woNumber"])), [], "it is valid");

  const assessment = assessOperationalComposition(crud);
  assert.equal(assessment.isOperationCentric, false, "…and still not an operational record page");
  assert.deepEqual(assessment.operationalSectionKinds, []);
});

test("§5 — an operational page reports which operational concerns it expresses", () => {
  const wo = makePageDefinition({
    id: "workOrder.record", entityId: "workOrder", label: "Work Order",
    sections: [
      makeSection({ id: "lc", kind: "LIFECYCLE", region: "HEADER", order: 0 }),
      makeSection({ id: "rd", kind: "READINESS", region: "HIGHLIGHTS", order: 0 }),
      makeSection({ id: "bl", kind: "BLOCKERS", region: "MAIN", order: 0 }),
      makeSection({ id: "f", kind: "FIELD_GROUP", region: "MAIN", order: 1, fieldIds: ["woNumber"] }),
    ],
  });
  const a = assessOperationalComposition(wo);
  assert.equal(a.isOperationCentric, true);
  assert.deepEqual(a.operationalSectionKinds, ["LIFECYCLE", "READINESS", "BLOCKERS"]);
});

test("§5 — ONE operational section is not enough", () => {
  // A single metric bolted onto a form is the shape that looks operational in a
  // screenshot and is not. An operational record shows state AND what to do about it.
  const barely = makePageDefinition({
    id: "p", entityId: "workOrder", label: "WO",
    sections: [
      makeSection({ id: "lc", kind: "LIFECYCLE", region: "HEADER", order: 0 }),
      makeSection({ id: "f", kind: "FIELD_GROUP", region: "MAIN", order: 0, fieldIds: ["woNumber"] }),
    ],
  });
  assert.equal(assessOperationalComposition(barely).isOperationCentric, false);
});

test("§5 — the assessment is NOT a validation rule, because not every entity is operational", () => {
  // Forcing a LIFECYCLE section onto an Account would be cargo-culting the check. An
  // Account genuinely is a record-shaped thing; a Work Order is not.
  assert.deepEqual(validatePageDefinition(page(), entity()), [], "a record-shaped page is valid as-is");
  assert.equal(assessOperationalComposition(page()).isOperationCentric, false);
});

// --- scoping, restated at the page layer ------------------------------------

test("a RELATED_LIST must name the list it renders — an unscoped section shows every record", () => {
  const def = page({
    sections: [makeSection({ id: "opps", kind: "RELATED_LIST", region: "MAIN", order: 0 })],
  });
  const p = validatePageDefinition(def, entity());
  assert.ok(p.some((x) => /must name the ListViewDefinition/.test(x)));
});

test("section kinds cannot borrow each other's fields", () => {
  const a = page({ sections: [makeSection({ id: "s", kind: "FIELD_GROUP", region: "MAIN", order: 0, fieldIds: ["name"], listId: "x" })] });
  assert.ok(validatePageDefinition(a, entity()).some((x) => /listId is meaningful only on a RELATED_LIST/.test(x)));

  const b = page({ sections: [makeSection({ id: "s", kind: "RELATED_LIST", region: "MAIN", order: 0, listId: "x", fieldIds: ["name"] })] });
  assert.ok(validatePageDefinition(b, entity()).some((x) => /fieldIds are meaningful only on a FIELD_GROUP/.test(x)));
});

test("a FIELD_GROUP's fields must exist on the entity", () => {
  const def = page({ sections: [makeSection({ id: "s", kind: "FIELD_GROUP", region: "MAIN", order: 0, fieldIds: ["ghost"] })] });
  assert.ok(validatePageDefinition(def, entity()).some((x) => /field "ghost" is not on account/.test(x)));
});

// --- ordering must be decidable ---------------------------------------------

test("two sections cannot claim the same region and order — layout must not be an authoring accident", () => {
  const def = page({
    sections: [
      makeSection({ id: "a", kind: "FIELD_GROUP", region: "MAIN", order: 0, fieldIds: ["name"] }),
      makeSection({ id: "b", kind: "FIELD_GROUP", region: "MAIN", order: 0, fieldIds: ["status"] }),
    ],
  });
  const p = validatePageDefinition(def, entity());
  assert.ok(p.some((x) => /ordering must be decidable/.test(x)));
});

test("the same order in DIFFERENT regions is fine", () => {
  const def = page({
    sections: [
      makeSection({ id: "a", kind: "FIELD_GROUP", region: "MAIN", order: 0, fieldIds: ["name"] }),
      makeSection({ id: "b", kind: "FIELD_GROUP", region: "SIDE", order: 0, fieldIds: ["status"] }),
    ],
  });
  assert.deepEqual(validatePageDefinition(def, entity()), []);
});

// --- §8 and structure -------------------------------------------------------

test("§8 — a componentId must be a registered id, never a function", () => {
  const def = page({ sections: [makeSection({ id: "s", kind: "LIFECYCLE", region: "MAIN", order: 0, componentId: () => null })] });
  assert.ok(validatePageDefinition(def, entity()).some((x) => /never a function/.test(x)));
});

test("regions are semantic, not coordinates", () => {
  // Pixel positions in metadata would make responsive behavior a configuration problem
  // and hand tenants a way to break layouts they cannot test.
  for (const r of REGION) assert.match(r, /^[A-Z_]+$/);
  assert.equal(REGION.includes("MAIN"), true);
  assert.equal("x" in makeSection({ id: "s", kind: "FIELD_GROUP" }), false);
  assert.equal("top" in makeSection({ id: "s", kind: "FIELD_GROUP" }), false);
});

test("duplicate section ids and unknown kinds/regions are rejected", () => {
  const dup = page({
    sections: [
      makeSection({ id: "s", kind: "FIELD_GROUP", region: "MAIN", order: 0, fieldIds: ["name"] }),
      makeSection({ id: "s", kind: "FIELD_GROUP", region: "SIDE", order: 0, fieldIds: ["status"] }),
    ],
  });
  assert.ok(validatePageDefinition(dup, entity()).some((x) => /duplicate section id/.test(x)));

  const bad = page({ sections: [makeSection({ id: "s", kind: "WIDGET", region: "NOWHERE", order: 0 })] });
  const p = validatePageDefinition(bad, entity());
  assert.ok(p.some((x) => /not a known SECTION_KIND/.test(x)));
  assert.ok(p.some((x) => /not a known REGION/.test(x)));
});

test("a page cannot be validated without its entity", () => {
  assert.ok(validatePageDefinition(page(), null).some((x) => /cannot be checked in isolation/.test(x)));
});

test("registry and list references are collectable for pre-render validation", () => {
  const def = page({
    headerActions: ["account.edit"],
    sections: [
      makeSection({ id: "lc", kind: "LIFECYCLE", region: "HEADER", order: 0, componentId: "record.lifecycle", actions: ["wo.dispatch"] }),
      makeSection({ id: "opps", kind: "RELATED_LIST", region: "MAIN", order: 0, listId: "account.opportunities.related" }),
      makeSection({ id: "sos", kind: "RELATED_LIST", region: "MAIN", order: 1, listId: "account.salesOrders.related" }),
    ],
  });
  const refs = pageRegistryReferences(def);
  assert.deepEqual(refs.components, ["record.lifecycle"]);
  assert.deepEqual(refs.actions, ["account.edit", "wo.dispatch"]);
  assert.deepEqual(referencedListIds(def), ["account.opportunities.related", "account.salesOrders.related"]);
});
