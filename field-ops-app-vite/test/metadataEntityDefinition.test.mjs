// EOS metadata entity/field/relationship contracts — v1 tests.
//
// These target the governance properties, not the getters. Each block names the
// boundary rule or the real production defect it exists to prevent, because a
// contract test that only proves "the object has the keys I gave it" would pass
// while every one of those defects came back.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIELD_TYPE, FIELD_OPERATOR, CARDINALITY, READ_VIA,
  makeIdentity, makeEntityDefinition, makeFieldDefinition, makeRelationshipDefinition,
  validateEntityDefinition, validateFieldDefinition, validateRelationshipDefinition,
  validateEntityRegistry, declaredCapabilities, filterableFields, sortableFields, findEntity, findField,
} from "../src/metadata/entityDefinition.js";

const nameField = makeFieldDefinition({ id: "name", entityId: "account", label: "Name", type: "STRING", sortable: true });

const account = () => makeEntityDefinition({
  id: "account",
  label: "Customer",
  labelPlural: "Customers",
  collection: "accounts",
  readVia: "CLIENT_DIRECT",
  identity: makeIdentity({ nameField: "name" }),
  fields: [nameField],
});

test("enums are frozen — a contract that can be mutated at runtime is not a contract", () => {
  for (const e of [FIELD_TYPE, FIELD_OPERATOR, CARDINALITY, READ_VIA]) {
    assert.ok(Object.isFrozen(e));
    assert.throws(() => e.push("NOPE"));
  }
});

test("a well-formed entity validates clean", () => {
  assert.deepEqual(validateEntityDefinition(account()), []);
});

// --- §8: metadata is data, never code -------------------------------------

test("§8 — a function anywhere in a definition is rejected, at any depth", () => {
  const withFn = makeEntityDefinition({
    ...account(),
    fields: [nameField, makeFieldDefinition({ id: "x", entityId: "account", label: "X", type: "STRING", renderer: () => "nope" })],
  });
  const problems = validateEntityDefinition(withFn);
  assert.ok(problems.some((p) => /executable value at/.test(p)), "nested function must be found");
  assert.ok(problems.some((p) => /boundary §8/.test(p)), "the rejection must cite the boundary it enforces");
});

test("§8 — a renderer must be a registered id, not a function", () => {
  const f = makeFieldDefinition({ id: "a", entityId: "e", label: "A", type: "STRING", renderer: () => null });
  assert.ok(validateFieldDefinition(f).some((p) => /registered renderer id/.test(p)));
  assert.deepEqual(
    validateFieldDefinition(makeFieldDefinition({ id: "a", entityId: "e", label: "A", type: "STRING", renderer: "currency" })),
    []
  );
});

// --- machine values vs display labels (#1093) ------------------------------

test("#1093 — id and label must be distinct concepts, on entity and field alike", () => {
  const e = makeEntityDefinition({ ...account(), id: "Customer", label: "Customer" });
  assert.ok(validateEntityDefinition(e).some((p) => /distinct concepts/.test(p)));

  const f = makeFieldDefinition({ id: "Name", entityId: "account", label: "Name", type: "STRING" });
  assert.ok(validateFieldDefinition(f).some((p) => /distinct concepts/.test(p)));
});

test("#1093 — an enum label equal to its machine value has re-merged the two concepts", () => {
  const bad = makeFieldDefinition({
    id: "status", entityId: "account", label: "Status", type: "ENUM",
    enumValues: ["ACTIVE"], enumLabels: { ACTIVE: "ACTIVE" },
  });
  assert.ok(validateFieldDefinition(bad).some((p) => /equals its machine value/.test(p)));

  const good = makeFieldDefinition({
    id: "status", entityId: "account", label: "Status", type: "ENUM",
    enumValues: ["ACTIVE", "PROSPECT"], enumLabels: { ACTIVE: "Active", PROSPECT: "Prospect" },
  });
  assert.deepEqual(validateFieldDefinition(good), []);
});

test("#1093 — an enum label for a value that is not in enumValues is rejected", () => {
  const f = makeFieldDefinition({
    id: "status", entityId: "e", label: "Status", type: "ENUM",
    enumValues: ["ACTIVE"], enumLabels: { ACTIVE: "Active", GHOST: "Ghost" },
  });
  assert.ok(validateFieldDefinition(f).some((p) => /not an enumValue/.test(p)));
});

// --- identity: never fall back to a document id ----------------------------

test("an entity that can name itself only by document id is rejected, not normalized", () => {
  const e = makeEntityDefinition({ ...account(), identity: makeIdentity() });
  const problems = validateEntityDefinition(e);
  assert.ok(problems.some((p) => /nameField or a referenceField/.test(p)));
  assert.ok(
    problems.some((p) => /data-model gap to record, not a fallback to normalize/.test(p)),
    "the message must say the gap is recorded rather than papered over"
  );
});

test("a reference field alone satisfies identity — WO-2026-000008 is a real name", () => {
  const e = makeEntityDefinition({
    id: "workOrder", label: "Work Order", collection: "fieldops_wos", readVia: "CLIENT_DIRECT",
    identity: makeIdentity({ referenceField: "woNumber" }),
    fields: [makeFieldDefinition({ id: "woNumber", entityId: "workOrder", label: "WO Number", type: "STRING" })],
  });
  assert.deepEqual(validateEntityDefinition(e), []);
});

test("identity must point at a field that actually exists", () => {
  const e = makeEntityDefinition({ ...account(), identity: makeIdentity({ nameField: "missing" }) });
  assert.ok(validateEntityDefinition(e).some((p) => /identity\.nameField "missing" is not a field/.test(p)));
});

// --- §9: operators are a claim about a real query --------------------------

test("§9 — declaring operators on a non-filterable field is rejected", () => {
  const f = makeFieldDefinition({ id: "a", entityId: "e", label: "A", type: "STRING", operators: ["EQUALS"] });
  assert.ok(validateFieldDefinition(f).some((p) => /claim about a real query/.test(p)));
});

test("§9 — filterable with no operators is rejected: filterable by what?", () => {
  const f = makeFieldDefinition({ id: "a", entityId: "e", label: "A", type: "STRING", filterable: true });
  assert.ok(validateFieldDefinition(f).some((p) => /filterable by what/.test(p)));
});

test("§9 — an unknown operator is rejected", () => {
  const f = makeFieldDefinition({ id: "a", entityId: "e", label: "A", type: "STRING", filterable: true, operators: ["REGEX"] });
  assert.ok(validateFieldDefinition(f).some((p) => /not a known FIELD_OPERATOR/.test(p)));
});

// --- read shape: the runtime must know how a thing is read -----------------

test("a CALLABLE entity without its callable name is rejected", () => {
  const e = makeEntityDefinition({ ...account(), readVia: "CALLABLE", collection: null, readCallable: null });
  assert.ok(validateEntityDefinition(e).some((p) => /requires readCallable/.test(p)));
});

test("a CLIENT_DIRECT entity without a collection is rejected", () => {
  const e = makeEntityDefinition({ ...account(), collection: null });
  assert.ok(validateEntityDefinition(e).some((p) => /requires a collection/.test(p)));
});

test("CALLABLE entities are first-class — deny-all collections are read this way", () => {
  const e = makeEntityDefinition({
    id: "salesOrder", label: "Sales Order", readVia: "CALLABLE", readCallable: "getSalesOrderContext",
    readCapability: "salesOrder.read",
    identity: makeIdentity({ referenceField: "customerPO" }),
    fields: [makeFieldDefinition({ id: "customerPO", entityId: "salesOrder", label: "Customer PO", type: "STRING" })],
  });
  assert.deepEqual(validateEntityDefinition(e), []);
});

// --- relationships: viaField is what makes a related list scoped -----------

test("a relationship without viaField is rejected — that is the parent key a related list scopes by", () => {
  const r = makeRelationshipDefinition({
    id: "account.opportunities", label: "Opportunities",
    fromEntityId: "account", toEntityId: "opportunity", cardinality: "ONE_TO_MANY",
  });
  const problems = validateRelationshipDefinition(r);
  assert.ok(problems.some((p) => /viaField is required/.test(p)));
  assert.ok(problems.some((p) => /parent key a related list scopes by/.test(p)));
});

test("a relationship whose fromEntityId disagrees with its owner is rejected", () => {
  const e = makeEntityDefinition({
    ...account(),
    relationships: [makeRelationshipDefinition({
      id: "r1", label: "Things", fromEntityId: "somethingElse", toEntityId: "opportunity",
      viaField: "accountId", cardinality: "ONE_TO_MANY",
    })],
  });
  assert.ok(validateEntityDefinition(e).some((p) => /does not match its owning entity/.test(p)));
});

// --- registry-level: references must resolve -------------------------------

test("a relationship or reference pointing at an unknown entity is caught at registry level", () => {
  const e = makeEntityDefinition({
    ...account(),
    fields: [nameField, makeFieldDefinition({ id: "ownerId", entityId: "account", label: "Owner", type: "REFERENCE", referenceTo: "ghost" })],
    relationships: [makeRelationshipDefinition({
      id: "r1", label: "Opps", fromEntityId: "account", toEntityId: "phantom",
      viaField: "accountId", cardinality: "ONE_TO_MANY",
    })],
  });
  const problems = validateEntityRegistry([e]);
  assert.ok(problems.some((p) => /references unknown entity "ghost"/.test(p)));
  assert.ok(problems.some((p) => /targets unknown entity "phantom"/.test(p)));
});

test("duplicate entity, field and relationship ids are all caught", () => {
  assert.ok(validateEntityRegistry([account(), account()]).some((p) => /duplicate entity id/.test(p)));

  const dupField = makeEntityDefinition({ ...account(), fields: [nameField, nameField] });
  assert.ok(validateEntityDefinition(dupField).some((p) => /duplicate field id/.test(p)));
});

test("REFERENCE requires referenceTo, and referenceTo is meaningless elsewhere", () => {
  assert.ok(validateFieldDefinition(makeFieldDefinition({ id: "a", entityId: "e", label: "A", type: "REFERENCE" }))
    .some((p) => /requires referenceTo/.test(p)));
  assert.ok(validateFieldDefinition(makeFieldDefinition({ id: "a", entityId: "e", label: "A", type: "STRING", referenceTo: "x" }))
    .some((p) => /only meaningful on a REFERENCE field/.test(p)));
});

// --- §6: declaring is not deciding -----------------------------------------

test("§6 — declaredCapabilities returns ids to hand to a resolver, never a decision", () => {
  const e = makeEntityDefinition({
    ...account(),
    readCapability: "account.read",
    fields: [
      nameField,
      makeFieldDefinition({ id: "arBalance", entityId: "account", label: "AR Balance", type: "CURRENCY_MINOR", readCapability: "finance.read" }),
    ],
    relationships: [makeRelationshipDefinition({
      id: "r", label: "Opps", fromEntityId: "account", toEntityId: "opportunity",
      viaField: "accountId", cardinality: "ONE_TO_MANY", traversalCapability: "opportunity.read",
    })],
  });
  const caps = declaredCapabilities(e);
  assert.deepEqual(caps, ["account.read", "finance.read", "opportunity.read"]);
  for (const c of caps) assert.equal(typeof c, "string", "capabilities are ids, never booleans or decisions");
});

test("§6 — this module imports nothing from access/, so it cannot resolve authority", async () => {
  // Structural guard rather than a behavioral one: the boundary says metadata never
  // grants authority, and the cheapest way for that to erode is an innocuous import.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/metadata/entityDefinition.js", import.meta.url), "utf8");
  assert.ok(!/from\s+["'].*\/access\//.test(src), "metadata contracts must not import access modules");
  assert.ok(!/resolveEffectiveAccess|hasCapability/.test(src), "metadata contracts must not call a capability resolver");
});

// --- helpers ---------------------------------------------------------------

test("lookup helpers are pure and return null rather than throwing on a miss", () => {
  const entities = [account()];
  assert.equal(findEntity(entities, "account").id, "account");
  assert.equal(findEntity(entities, "nope"), null);
  assert.equal(findField(account(), "name").label, "Name");
  assert.equal(findField(account(), "nope"), null);
  assert.deepEqual(filterableFields(account()), []);
  assert.deepEqual(sortableFields(account()).map((f) => f.id), ["name"]);
});
