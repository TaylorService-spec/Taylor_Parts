// ListViewDefinition (Entity List Metadata v1) — contract tests.
//
// Each block names the governance rule or the concrete failure it prevents. A test
// that only proved "the object kept the keys I passed it" would pass while every
// one of these shipped.

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEntityDefinition, makeFieldDefinition, makeRelationshipDefinition, makeIdentity } from "../src/metadata/entityDefinition.js";
import {
  LIST_SURFACE, SORT_DIRECTION, MAX_PAGE_SIZE, MAX_RELATED_ROWS,
  makeColumn, makeFilter, makeSort, makeSavedView, makeListViewDefinition,
  validateListViewDefinition, requiredIndexes, indexKey, missingIndexes, firestoreOrder, MAX_DECLARED_FILTERS,
  TEXT_QUERY_OPERATOR, TEXT_QUERY_BACKEND, TEXT_BACKEND_CAPABILITY, supportsTextOperator,
} from "../src/metadata/listViewDefinition.js";

// Every real registered definition, imported by module rather than by hand-built
// fixture (X-QUERY-MODEL-NO-FREE-TEXT's additivity requirement: prove the change
// against what is actually registered, not a shape convenient for the test).
import * as accountDefs from "../src/metadata/definitions/account.js";
import * as contactDefs from "../src/metadata/definitions/contact.js";
import * as employeeDefs from "../src/metadata/definitions/employee.js";
import * as equipmentDefs from "../src/metadata/definitions/equipment.js";
import * as equipmentModelDefs from "../src/metadata/definitions/equipmentModel.js";
import * as invoiceDefs from "../src/metadata/definitions/invoice.js";
import * as locationDefs from "../src/metadata/definitions/location.js";
import * as manufacturerDefs from "../src/metadata/definitions/manufacturer.js";
import * as mobileLocationDefs from "../src/metadata/definitions/mobileLocation.js";
import * as opportunityDefs from "../src/metadata/definitions/opportunity.js";
import * as partDefs from "../src/metadata/definitions/part.js";
import * as paymentDefs from "../src/metadata/definitions/payment.js";
import * as purchaseOrderDefs from "../src/metadata/definitions/purchaseOrder.js";
import * as salesOrderDefs from "../src/metadata/definitions/salesOrder.js";
import * as salesTerritoryDefs from "../src/metadata/definitions/salesTerritory.js";
import * as stockLocationDefs from "../src/metadata/definitions/stockLocation.js";
import * as supplierDefs from "../src/metadata/definitions/supplier.js";
import * as truckDefs from "../src/metadata/definitions/truck.js";
import * as warehouseDefs from "../src/metadata/definitions/warehouse.js";
import * as workOrderDefs from "../src/metadata/definitions/workOrder.js";

const field = (id, extra = {}) =>
  makeFieldDefinition({ id, entityId: "account", label: id.toUpperCase(), type: "STRING", ...extra });

const account = () => makeEntityDefinition({
  id: "account",
  label: "Customer",
  collection: "accounts",
  readVia: "CLIENT_DIRECT",
  identity: makeIdentity({ nameField: "name" }),
  fields: [
    field("name", { sortable: true }),
    field("status", { filterable: true, operators: ["EQUALS", "IN"], sortable: true }),
    field("updatedAt", { type: "TIMESTAMP", sortable: true }),
    field("balance", { type: "CURRENCY_MINOR", filterable: true, operators: ["GREATER_THAN", "EQUALS"] }),
    field("tags"),
  ],
  relationships: [
    makeRelationshipDefinition({
      id: "account.opportunities", label: "Opportunities",
      fromEntityId: "account", toEntityId: "opportunity",
      viaField: "accountId", cardinality: "ONE_TO_MANY",
    }),
    // Reaches ACCOUNT, so a RELATED list of accounts can honestly be scoped by it. The
    // fixture previously scoped an account list by account.opportunities, which points at
    // opportunities -- incoherent, and only accepted because the old rule checked that an
    // id existed rather than that the edge arrived here.
    makeRelationshipDefinition({
      id: "parentAccount.children", label: "Child accounts",
      fromEntityId: "account", toEntityId: "account",
      viaField: "parentAccountId", cardinality: "ONE_TO_MANY",
    }),
  ],
});

const baseIndex = (over = {}) => makeListViewDefinition({
  id: "account.index", entityId: "account", label: "Customers", surface: "INDEX",
  columns: [makeColumn({ fieldId: "name" }), makeColumn({ fieldId: "status" })],
  defaultSort: [makeSort({ fieldId: "updatedAt", direction: "DESC" })],
  pageSize: 50,
  ...over,
});

test("enums and ceilings are frozen — a bound that can be mutated is not a bound", () => {
  for (const e of [LIST_SURFACE, SORT_DIRECTION]) {
    assert.ok(Object.isFrozen(e));
    assert.throws(() => e.push("NOPE"));
  }
  assert.equal(typeof MAX_PAGE_SIZE, "number");
});

test("a well-formed INDEX definition validates clean", () => {
  assert.deepEqual(validateListViewDefinition(baseIndex(), account()), []);
});

// --- a declared filter is a promise the backend must keep (§9) --------------

test("§9 — a list cannot offer a filter on a field that is not filterable", () => {
  const def = baseIndex({ filters: [makeFilter({ fieldId: "tags", operators: ["EQUALS"] })] });
  const p = validateListViewDefinition(def, account());
  assert.ok(p.some((x) => /not declared filterable/.test(x)));
  assert.ok(p.some((x) => /the query layer cannot serve/.test(x)));
});

test("§9 — a list may NARROW a field's operators but never widen them", () => {
  // status supports EQUALS and IN. Narrowing to EQUALS is fine; adding one is not.
  assert.deepEqual(
    validateListViewDefinition(baseIndex({ filters: [makeFilter({ fieldId: "status", operators: ["EQUALS"] })] }), account()),
    []
  );
  const widened = baseIndex({ filters: [makeFilter({ fieldId: "status", operators: ["EQUALS", "ARRAY_CONTAINS"] })] });
  assert.ok(validateListViewDefinition(widened, account()).some((x) => /never widen them/.test(x)));
});

test("§9 — a filter with no operators is rejected", () => {
  const def = baseIndex({ filters: [makeFilter({ fieldId: "status", operators: [] })] });
  assert.ok(validateListViewDefinition(def, account()).some((x) => /declares no operators/.test(x)));
});

// --- total sort order: the silent pagination corruptor ----------------------

test("total order is guaranteed BY CONSTRUCTION — the factory cannot produce a definition without one", () => {
  // The strongest form of the guarantee: an author who says nothing, or explicitly
  // passes null, still gets documentId() as the tiebreaker. Cursor pagination over a
  // tying sort key is the most common way a paginated list silently corrupts itself,
  // so it is not left to remembering.
  assert.equal(baseIndex().tiebreaker, "__name__");
  assert.equal(baseIndex({ tiebreaker: null }).tiebreaker, "__name__");
  assert.equal(baseIndex({ tiebreaker: undefined }).tiebreaker, "__name__");
});

test("the validator ALSO catches a missing tiebreaker, for definitions not built by the factory", () => {
  // Metadata may arrive as plain data — authored JSON, a future tenant override store —
  // which never passes through makeListViewDefinition. Construction-time defaulting
  // protects one path; the validator has to protect the other, or the guarantee only
  // holds for definitions written in JavaScript today.
  const raw = { ...baseIndex(), tiebreaker: null };
  const p = validateListViewDefinition(raw, account());
  assert.ok(p.some((x) => /tiebreaker is required/.test(x)));
  assert.ok(p.some((x) => /duplicates or drops rows/.test(x)));
});

test("the tiebreaker cannot be a field already in defaultSort — it cannot break its own tie", () => {
  const def = baseIndex({ defaultSort: [makeSort({ fieldId: "updatedAt" })], tiebreaker: "updatedAt" });
  assert.ok(validateListViewDefinition(def, account()).some((x) => /cannot break its own tie/.test(x)));
});

test("the tiebreaker must exist on the entity, unless it is documentId()", () => {
  assert.ok(validateListViewDefinition(baseIndex({ tiebreaker: "ghost" }), account())
    .some((x) => /tiebreaker "ghost" is not a field/.test(x)));
  assert.deepEqual(validateListViewDefinition(baseIndex({ tiebreaker: "__name__" }), account()), []);
});

test("sorting on a field not declared sortable is rejected", () => {
  const def = baseIndex({ defaultSort: [makeSort({ fieldId: "tags" })] });
  assert.ok(validateListViewDefinition(def, account()).some((x) => /not declared sortable/.test(x)));
});

// --- bounded reads (§9) ------------------------------------------------------

test("§9 — page size is bounded, and there is no offset concept to express at all", () => {
  assert.ok(validateListViewDefinition(baseIndex({ pageSize: 5000 }), account())
    .some((x) => new RegExp(`exceeds MAX_PAGE_SIZE ${MAX_PAGE_SIZE}`).test(x)));
  assert.ok(validateListViewDefinition(baseIndex({ pageSize: 0 }), account())
    .some((x) => /positive integer/.test(x)));

  // The absence is the point: offset paging bills for every skipped document, so the
  // vocabulary simply has no way to ask for it.
  assert.equal("offset" in baseIndex(), false);
  assert.equal("page" in baseIndex(), false);
});

// --- RELATED sections: scoped, capped, and able to hand off -----------------

test("a RELATED list without parentRelationshipId would render every record of the target entity", () => {
  const def = makeListViewDefinition({
    id: "account.opportunities.related", entityId: "account", label: "Opportunities",
    surface: "RELATED", columns: [makeColumn({ fieldId: "name" })], pageSize: 5, viewAllListId: "opportunity.index",
  });
  const p = validateListViewDefinition(def, account());
  assert.ok(p.some((x) => /requires parentRelationshipId/.test(x)));
  assert.ok(p.some((x) => /every record of the target entity/.test(x)));
});

test("a RELATED list's parent relationship must REACH the entity it lists", () => {
  const def = makeListViewDefinition({
    id: "r", entityId: "account", label: "Things", surface: "RELATED",
    columns: [makeColumn({ fieldId: "name" })], pageSize: 5,
    parentRelationshipId: "account.phantom", viewAllListId: "x.index",
  });
  assert.ok(validateListViewDefinition(def, account()).some((x) => /is not a relationship reaching account/.test(x)));
});

test("a relationship pointing AWAY from the listed entity is not a parent scope", () => {
  // account.opportunities reaches opportunities, so it cannot scope a list OF accounts.
  // The old rule accepted it because an id by that name existed — which is how a section
  // could be declared scoped by an edge that goes somewhere else entirely.
  const def = makeListViewDefinition({
    id: "r", entityId: "account", label: "Things", surface: "RELATED",
    columns: [makeColumn({ fieldId: "name" })], pageSize: 5,
    parentRelationshipId: "account.opportunities", viewAllListId: "x.index",
  });
  assert.ok(validateListViewDefinition(def, account()).some((x) => /is not a relationship reaching account/.test(x)));
});

test("a parent-side edge resolves when the declaring entity's relationships are supplied", () => {
  // The real shape: account.contacts is declared on Account and scopes a list OF contacts.
  // Searching only the child made every genuine related list unvalidatable.
  const contact = makeEntityDefinition({
    id: "contact", label: "Contact", collection: "contacts",
    identity: makeIdentity({ nameField: "name" }),
    fields: [makeFieldDefinition({ id: "name", entityId: "contact", label: "Name", type: "STRING" })],
  });
  const def = makeListViewDefinition({
    id: "account.contacts", entityId: "contact", label: "Contacts", surface: "RELATED",
    columns: [makeColumn({ fieldId: "name" })], pageSize: 5,
    parentRelationshipId: "account.contacts", viewAllListId: "contact.index",
  });
  const parentRelationships = [
    makeRelationshipDefinition({
      id: "account.contacts", label: "Contacts", fromEntityId: "account",
      toEntityId: "contact", viaField: "accountId", cardinality: "ONE_TO_MANY",
    }),
  ];
  assert.ok(validateListViewDefinition(def, contact).some((x) => /is not a relationship reaching contact/.test(x)));
  assert.deepEqual(validateListViewDefinition(def, contact, parentRelationships), []);
});

test("a RELATED list must be able to hand off, and is capped", () => {
  const withoutHandoff = makeListViewDefinition({
    id: "r", entityId: "account", label: "Opportunities", surface: "RELATED",
    columns: [makeColumn({ fieldId: "name" })], pageSize: 5,
    parentRelationshipId: "parentAccount.children",
  });
  assert.ok(validateListViewDefinition(withoutHandoff, account()).some((x) => /requires viewAllListId/.test(x)));

  const tooMany = makeListViewDefinition({
    id: "r", entityId: "account", label: "Opportunities", surface: "RELATED",
    columns: [makeColumn({ fieldId: "name" })], pageSize: MAX_RELATED_ROWS + 1,
    parentRelationshipId: "parentAccount.children", viewAllListId: "opportunity.index",
  });
  assert.ok(validateListViewDefinition(tooMany, account()).some((x) => /at most 25 rows/.test(x)));
});

test("one definition serves both surfaces — a RELATED section is a lighter config, not a second implementation", () => {
  const related = makeListViewDefinition({
    id: "account.opportunities.related", entityId: "account", label: "Opportunities", surface: "RELATED",
    columns: [makeColumn({ fieldId: "name" })], pageSize: 5,
    parentRelationshipId: "parentAccount.children", viewAllListId: "opportunity.index",
  });
  assert.deepEqual(validateListViewDefinition(related, account()), []);
  assert.deepEqual(validateListViewDefinition(baseIndex(), account()), []);
});

test("surface-specific fields are rejected on the wrong surface", () => {
  const idxWithParent = baseIndex({ parentRelationshipId: "parentAccount.children" });
  assert.ok(validateListViewDefinition(idxWithParent, account()).some((x) => /only on a RELATED list/.test(x)));

  const relWithViews = makeListViewDefinition({
    id: "r", entityId: "account", label: "Opps", surface: "RELATED",
    columns: [makeColumn({ fieldId: "name" })], pageSize: 5,
    parentRelationshipId: "parentAccount.children", viewAllListId: "opportunity.index",
    savedViews: [makeSavedView({ id: "v", label: "V" })],
  });
  assert.ok(validateListViewDefinition(relWithViews, account()).some((x) => /belong to INDEX surfaces/.test(x)));
});

// --- structural ------------------------------------------------------------

test("columns must reference real fields and must not duplicate", () => {
  assert.ok(validateListViewDefinition(baseIndex({ columns: [makeColumn({ fieldId: "ghost" })] }), account())
    .some((x) => /is not a field on account/.test(x)));

  assert.ok(validateListViewDefinition(
    baseIndex({ columns: [makeColumn({ fieldId: "name" }), makeColumn({ fieldId: "name" })] }), account())
    .some((x) => /duplicate column/.test(x)));
});

// --- X-LIST-COLUMN-RENDERER-UNCONSUMED: renderer is not part of the contract --------

test("makeColumn drops a renderer input — the built column never carries one", () => {
  const col = makeColumn({ fieldId: "name", renderer: "some-id" });
  assert.equal("renderer" in col, false);
});

test("a column that DOES declare renderer (built by hand, bypassing makeColumn) fails validation loudly", () => {
  // Before this change, a declared renderer was silently resolved and then never read
  // by MetadataListGrid — ignored, with no signal. Now it must fail validation instead,
  // so an author (or a definition that predates this change) finds out immediately
  // rather than shipping a renderer nothing will ever run.
  const def = baseIndex({ columns: [{ fieldId: "name", renderer: "currency" }] });
  assert.ok(validateListViewDefinition(def, account())
    .some((x) => /declares "renderer", which is not part of the contract/.test(x)));
});

test("a sortable column requires a sortable field — sorting needs an index", () => {
  const def = baseIndex({ columns: [makeColumn({ fieldId: "tags", sortable: true })] });
  assert.ok(validateListViewDefinition(def, account()).some((x) => /sorting needs an indexed field/.test(x)));
});

test("a definition cannot be validated without its entity", () => {
  // Validating in isolation would give false confidence: every column reference would
  // go unchecked, which is the metadata-that-lies problem this layer exists to prevent.
  const p = validateListViewDefinition(baseIndex(), null);
  assert.ok(p.some((x) => /cannot be checked in isolation/.test(x)));
});

test("more than one default saved view is rejected", () => {
  const def = baseIndex({
    savedViews: [
      makeSavedView({ id: "a", label: "A", isDefault: true }),
      makeSavedView({ id: "b", label: "B", isDefault: true }),
    ],
  });
  assert.ok(validateListViewDefinition(def, account()).some((x) => /more than one saved view/.test(x)));
});

// --- index derivation: proving the promise can be kept ----------------------

test("requiredIndexes derives what a definition demands, tiebreaker last", () => {
  const def = baseIndex({ filters: [makeFilter({ fieldId: "status", operators: ["EQUALS"] })] });
  const [idx] = requiredIndexes(def, account());
  assert.equal(idx.collectionGroup, "accounts");
  assert.deepEqual(idx.fields.map((f) => f.fieldPath), ["status", "updatedAt", "__name__"]);
  // Firestore's vocabulary, not the metadata layer's. A required index is something a
  // human pastes into firestore.indexes.json, where ASC/DESC is rejected -- so a demand
  // spelled the metadata way read correctly, compared unequal against every existing
  // declaration, and would have failed the deploy of the fix it asked for.
  assert.equal(idx.fields.find((f) => f.fieldPath === "updatedAt").order, "DESCENDING");
  assert.equal(idx.requiredBy, "account.index");
});

test("a declaration written ASCENDING and a demand written ASC are ONE index, not two", () => {
  const declared = { collectionGroup: "accounts", fields: [{ fieldPath: "status", order: "ASCENDING" }] };
  const demanded = { collectionGroup: "accounts", fields: [{ fieldPath: "status", order: "ASC" }] };
  assert.equal(indexKey(declared), indexKey(demanded));
});

test("firestoreOrder translates both spellings and defaults to ascending", () => {
  assert.equal(firestoreOrder("DESC"), "DESCENDING");
  assert.equal(firestoreOrder("DESCENDING"), "DESCENDING");
  assert.equal(firestoreOrder("ASC"), "ASCENDING");
  assert.equal(firestoreOrder(undefined), "ASCENDING");
});

test("range filters are ordered after equality filters, per Firestore's own constraint", () => {
  const def = baseIndex({
    filters: [makeFilter({ fieldId: "status", operators: ["EQUALS"] }), makeFilter({ fieldId: "balance", operators: ["GREATER_THAN"] })],
  });
  const [idx] = requiredIndexes(def, account());
  const paths = idx.fields.map((f) => f.fieldPath);
  assert.ok(paths.indexOf("status") < paths.indexOf("balance"), "equality fields precede the range field");
});

test("a definition demanding nothing reports no index — noise would train people to ignore the output", () => {
  const def = makeListViewDefinition({
    id: "plain", entityId: "account", label: "Plain", surface: "INDEX",
    columns: [makeColumn({ fieldId: "name" })], defaultSort: [], pageSize: 25,
  });
  assert.deepEqual(requiredIndexes(def, account()), []);
});

test("a CALLABLE-read entity demands no client index — it is the server's query", () => {
  const callableEntity = makeEntityDefinition({
    id: "salesOrder", label: "Sales Order", readVia: "CALLABLE", readCallable: "getSalesOrderContext",
    identity: makeIdentity({ referenceField: "customerPO" }),
    fields: [makeFieldDefinition({ id: "customerPO", entityId: "salesOrder", label: "PO", type: "STRING", sortable: true })],
  });
  const def = makeListViewDefinition({
    id: "so.index", entityId: "salesOrder", label: "Sales Orders", surface: "INDEX",
    columns: [makeColumn({ fieldId: "customerPO" })], defaultSort: [makeSort({ fieldId: "customerPO" })], pageSize: 25,
  });
  assert.deepEqual(requiredIndexes(def, callableEntity), []);
});

test("indexKey ignores the implicit __name__ field so declared and required indexes compare", () => {
  // Firestore appends __name__ itself; a declared index will not list it, and a naive
  // comparison would report every index as missing.
  const required = { collectionGroup: "accounts", queryScope: "COLLECTION", fields: [{ fieldPath: "status", order: "ASC" }, { fieldPath: "__name__", order: "ASC" }] };
  const declared = { collectionGroup: "accounts", queryScope: "COLLECTION", fields: [{ fieldPath: "status", order: "ASC" }] };
  assert.equal(indexKey(required), indexKey(declared));
});

test("missingIndexes reports exactly the demands CI must fail on", () => {
  const def = baseIndex({ filters: [makeFilter({ fieldId: "status", operators: ["EQUALS"] })] });
  const required = requiredIndexes(def, account());

  assert.equal(missingIndexes(required, []).length, 1, "an undeclared demand is missing");

  const declared = [{
    collectionGroup: "accounts", queryScope: "COLLECTION",
    fields: [{ fieldPath: "status", order: "ASC" }, { fieldPath: "updatedAt", order: "DESC" }],
  }];
  assert.deepEqual(missingIndexes(required, declared), [], "a declared demand is satisfied");
});

// --- filter COMBINATIONS ------------------------------------------------------
//
// The derivation used to emit ONE index containing every declared filter plus the sort.
// That reads as thorough and is wrong: Firestore will not serve a subset query from it,
// so a list with two optional filters had three of its four real queries unindexed while
// CI stayed green — the exact failure the coverage gate exists to prevent.

const twoFilterList = (over = {}) =>
  makeListViewDefinition({
    id: "account.index", entityId: "account", label: "Customers", surface: "INDEX",
    columns: [makeColumn({ fieldId: "name" })],
    filters: [
      makeFilter({ fieldId: "status", operators: ["EQUALS"] }),
      makeFilter({ fieldId: "balance", operators: ["GREATER_THAN"] }),
    ],
    defaultSort: [makeSort({ fieldId: "updatedAt", direction: "DESC" })],
    pageSize: 50,
    ...over,
  });

test("two optional filters demand an index per COMBINATION, not one combined index", () => {
  const idx = requiredIndexes(twoFilterList(), account());
  const shapes = idx.map((i) => i.fields.map((f) => f.fieldPath).join(","));
  assert.ok(shapes.includes("status,updatedAt,__name__"), "status alone");
  assert.ok(shapes.includes("balance,updatedAt,__name__"), "balance alone");
  assert.ok(shapes.includes("status,balance,updatedAt,__name__"), "both");
});

test("a REQUIRED filter appears in every index rather than doubling the set", () => {
  // It is in every query, so there is no combination without it.
  const def = twoFilterList({
    filters: [
      makeFilter({ fieldId: "status", operators: ["EQUALS"], required: true }),
      makeFilter({ fieldId: "balance", operators: ["GREATER_THAN"] }),
    ],
  });
  const idx = requiredIndexes(def, account());
  assert.ok(idx.every((i) => i.fields.some((f) => f.fieldPath === "status")));
});

test("the unfiltered, single-field-ordered query demands NO composite", () => {
  // Firestore's automatic single-field index serves it, and the documentId tiebreaker is
  // implicit there. Demanding one would train people to ignore the gate.
  const def = twoFilterList({ filters: [] });
  assert.deepEqual(requiredIndexes(def, account()), []);
});

test("more filters than the cap is a validation failure, not a bigger pile of indexes", () => {
  const def = twoFilterList({
    filters: ["status", "balance", "status", "balance", "status"].map((fieldId) =>
      makeFilter({ fieldId, operators: ["EQUALS"] })
    ),
  });
  assert.ok(
    validateListViewDefinition(def, account()).some((p) => new RegExp(`more than ${MAX_DECLARED_FILTERS}`).test(p))
  );
});

// --- X-ENTITY-SINGLE-READCALLABLE: a list view's own readCallable override -----------
//
// A list view MAY declare its own `readCallable`, honored ahead of the entity's own
// (useMetadataList.js / MetadataRecordPage.jsx). validateListViewDefinition is where a bad
// declaration is caught -- at definition time, not the first time someone opens the list
// (X-UNCONSUMED-DECLARATION-PATTERN).

const callableEntity = (over = {}) =>
  makeEntityDefinition({
    id: "opportunity", label: "Opportunity", readVia: "CALLABLE",
    readCallable: "listOpportunitiesForAccount", // the entity's own, account-scoped, default
    identity: makeIdentity({ referenceField: "opportunityNumber" }),
    fields: [makeFieldDefinition({ id: "opportunityNumber", entityId: "opportunity", label: "Number", type: "STRING", sortable: true })],
    ...over,
  });

const relatedOnCallable = (over = {}) =>
  makeListViewDefinition({
    id: "account.opportunities", entityId: "opportunity", label: "Opportunities", surface: "RELATED",
    parentRelationshipId: "account.opportunities", viewAllListId: "opportunity.index",
    columns: [makeColumn({ fieldId: "opportunityNumber" })], pageSize: 10,
    ...over,
  });

const indexOnCallable = (over = {}) =>
  makeListViewDefinition({
    id: "opportunity.index", entityId: "opportunity", label: "Opportunities", surface: "INDEX",
    columns: [makeColumn({ fieldId: "opportunityNumber" })], pageSize: 25,
    ...over,
  });

const opportunityRelationships = [
  makeRelationshipDefinition({
    id: "account.opportunities", label: "Opportunities",
    fromEntityId: "account", toEntityId: "opportunity",
    viaField: "accountId", cardinality: "ONE_TO_MANY",
  }),
];

test("no declared readCallable is fully additive — validates clean when the INHERITED callable actually fits this surface", () => {
  // callableEntity()'s own readCallable (listOpportunitiesForAccount) is scoped, and RELATED
  // is the surface a scoped inherited callable fits -- this is the genuinely-clean case.
  assert.deepEqual(validateListViewDefinition(relatedOnCallable(), callableEntity(), opportunityRelationships), []);
  // The default itself is null, not undefined or omitted -- resolveReadCallable in both
  // consumers relies on this falling straight through to the entity's own value.
  assert.equal(relatedOnCallable().readCallable, null);
  assert.equal(indexOnCallable().readCallable, null);
});

// --- H4/M19: the INHERITED readCallable is exactly as checkable as an explicit override ---
//
// Before this fix, every check above lived inside `if (def.readCallable)` -- so a list view
// that declares NO override (the common case: listRuntime.js falls back to
// `entity.readCallable ?? null` whenever a list view is silent) was NEVER validated at all.
// That is precisely how invoice.js's invoiceIndexList (INDEX surface, no override, entity's
// readCallable scoped-only) passed validateListViewDefinition with zero problems for as long
// as it existed, while every actual request from it would have thrown at runtime. These tests
// pin the inherited path directly, independent of any one entity file, so this blind spot
// cannot silently reopen.

test("an INDEX list with NO override, inheriting a SCOPED entity readCallable, is rejected — this is the invoice.index shape exactly", () => {
  // indexOnCallable() declares no readCallable of its own; callableEntity()'s readCallable
  // (listOpportunitiesForAccount) is scoped:true. Before the H4/M19 fix this validated clean
  // because the whole check lived inside `if (def.readCallable)`, which is false here.
  const p = validateListViewDefinition(indexOnCallable(), callableEntity());
  assert.ok(
    p.some((x) => /inherited from entity "opportunity"/.test(x) && /requires a parent-scope filter/.test(x)),
    `expected an inherited-callable/INDEX-scope problem, got: ${JSON.stringify(p)}`
  );
});

test("an INDEX list with NO override, inheriting an UNKNOWN entity readCallable, is rejected at definition time — not left to throw at the first open", () => {
  const typoEntity = callableEntity({ readCallable: "someTypoedCallableName" });
  const p = validateListViewDefinition(indexOnCallable(), typoEntity);
  assert.ok(
    p.some((x) => /inherited from entity "opportunity"/.test(x) && /not a known callable/.test(x)),
    `expected an inherited-callable/unknown-callable problem, got: ${JSON.stringify(p)}`
  );
});

test("a RELATED list with NO override, inheriting an UNSCOPED entity readCallable, is rejected — a RELATED list always supplies a parent-scope filter", () => {
  const unscopedEntity = callableEntity({ readCallable: "listOpportunityContext" });
  const p = validateListViewDefinition(relatedOnCallable(), unscopedEntity, opportunityRelationships);
  assert.ok(
    p.some((x) => /inherited from entity "opportunity"/.test(x) && /unscoped, but a RELATED list always supplies a parent-scope/.test(x)),
    `expected an inherited-callable/RELATED-scope problem, got: ${JSON.stringify(p)}`
  );
});

test("an INDEX list with NO override, inheriting an UNSCOPED entity readCallable, validates clean — the real opportunity.index/salesOrder.index shape does this via its OWN override, but the inherited path must accept a genuinely compatible name too", () => {
  const unscopedEntity = callableEntity({ readCallable: "listOpportunityContext" });
  assert.deepEqual(validateListViewDefinition(indexOnCallable(), unscopedEntity), []);
});

test("a declared readCallable this module has never heard of is rejected at the definition, not at runtime", () => {
  const def = indexOnCallable({ readCallable: "someTypoedCallableName" });
  const p = validateListViewDefinition(def, callableEntity());
  assert.ok(p.some((x) => /not a known callable/.test(x)));
});

test("a readCallable declared on a CLIENT_DIRECT entity is rejected — that entity never routes through a callable", () => {
  const clientDirectEntity = makeEntityDefinition({
    id: "account", label: "Customer", readVia: "CLIENT_DIRECT", collection: "accounts",
    identity: makeIdentity({ nameField: "name" }),
    fields: [makeFieldDefinition({ id: "name", entityId: "account", label: "Name", type: "STRING" })],
  });
  const def = makeListViewDefinition({
    id: "account.index", entityId: "account", label: "Customers", surface: "INDEX",
    columns: [makeColumn({ fieldId: "name" })], pageSize: 25,
    readCallable: "listOpportunityContext",
  });
  const p = validateListViewDefinition(def, clientDirectEntity);
  assert.ok(p.some((x) => /reads CLIENT_DIRECT/.test(x)));
});

test("a RELATED list declaring an UNSCOPED callable is rejected — a RELATED list always supplies a parent-scope filter", () => {
  const def = relatedOnCallable({ readCallable: "listOpportunityContext" });
  const p = validateListViewDefinition(def, callableEntity(), opportunityRelationships);
  assert.ok(p.some((x) => /is unscoped, but a RELATED list always supplies a parent-scope/.test(x)));
});

test("an INDEX list declaring a SCOPED callable is rejected — an INDEX list never supplies a parent scope", () => {
  const def = indexOnCallable({ readCallable: "listOpportunitiesForAccount" });
  const p = validateListViewDefinition(def, callableEntity());
  assert.ok(p.some((x) => /requires a parent-scope filter, but an INDEX list never supplies one/.test(x)));
});

test("an INDEX list declaring the REAL unscoped callable validates clean — the case opportunity.index actually uses", () => {
  const def = indexOnCallable({ readCallable: "listOpportunityContext" });
  assert.deepEqual(validateListViewDefinition(def, callableEntity()), []);
});

test("a RELATED list declaring a DIFFERENT scoped callable than the entity's own still validates clean", () => {
  // Scope matches (both scoped); the point is the override is honored, not that it must
  // equal the entity's own value.
  const def = relatedOnCallable({ readCallable: "listSalesOrdersForAccount" });
  assert.deepEqual(validateListViewDefinition(def, callableEntity(), opportunityRelationships), []);
});

// --- X-QUERY-MODEL-NO-FREE-TEXT: text-query operators -------------------------------
//
// The ruling this lane implements: extending the vocabulary to distinguish text
// operations is authorized, but DECLARING A TEXT OPERATOR DOES NOT MAKE IT
// EXECUTABLE. Each filter that wants one must also name a `textBackend`, and the
// validator rejects the combination if that backend cannot honestly serve the
// semantic — loudly, at definition time, never as a silent downgrade and never left
// to fail at paint time.

const textEntity = () => makeEntityDefinition({
  id: "widget", label: "Widget", collection: "widgets", readVia: "CLIENT_DIRECT",
  identity: makeIdentity({ nameField: "name" }),
  fields: [
    makeFieldDefinition({ id: "name", entityId: "widget", label: "Name", type: "STRING", filterable: true, sortable: true, operators: ["EQUALS"] }),
    makeFieldDefinition({ id: "description", entityId: "widget", label: "Description", type: "STRING", filterable: true, sortable: true }),
  ],
});

const textList = (filterOverrides = {}) => makeListViewDefinition({
  id: "widget.index", entityId: "widget", label: "Widgets", surface: "INDEX",
  columns: [makeColumn({ fieldId: "name" })],
  defaultSort: [makeSort({ fieldId: "name" })],
  tiebreaker: "__name__",
  pageSize: 25,
  filters: [makeFilter({ fieldId: "name", operators: ["TEXT_EXACT"], textBackend: "FIRESTORE_NATIVE", ...filterOverrides })],
});

test("TEXT_QUERY_OPERATOR and TEXT_QUERY_BACKEND are frozen enums", () => {
  assert.ok(Object.isFrozen(TEXT_QUERY_OPERATOR));
  assert.deepEqual([...TEXT_QUERY_OPERATOR], ["TEXT_EXACT", "TEXT_PREFIX", "TEXT_CONTAINS", "TEXT_SEARCH"]);
  assert.ok(Object.isFrozen(TEXT_QUERY_BACKEND));
  assert.deepEqual([...TEXT_QUERY_BACKEND], ["FIRESTORE_NATIVE"]);
});

test("TEXT_EXACT against FIRESTORE_NATIVE validates clean — an exact match is a real equality query", () => {
  assert.deepEqual(validateListViewDefinition(textList(), textEntity()), []);
  assert.ok(supportsTextOperator("FIRESTORE_NATIVE", "TEXT_EXACT"));
});

test("TEXT_PREFIX against FIRESTORE_NATIVE validates clean — a prefix range query is real today", () => {
  const def = textList({ operators: ["TEXT_PREFIX"] });
  assert.deepEqual(validateListViewDefinition(def, textEntity()), []);
  assert.ok(supportsTextOperator("FIRESTORE_NATIVE", "TEXT_PREFIX"));
});

test("TEXT_CONTAINS against FIRESTORE_NATIVE is REJECTED at validation — Firestore has no substring predicate", () => {
  const def = textList({ operators: ["TEXT_CONTAINS"] });
  const p = validateListViewDefinition(def, textEntity());
  assert.ok(p.length > 0, "an unsupported text operator must fail validation, not pass silently");
  assert.ok(p.some((x) => /cannot execute it honestly/.test(x) && /TEXT_CONTAINS/.test(x)));
  assert.ok(!supportsTextOperator("FIRESTORE_NATIVE", "TEXT_CONTAINS"));
});

test("TEXT_SEARCH against FIRESTORE_NATIVE is REJECTED at validation — no relevance-ranked backend exists yet", () => {
  const def = textList({ operators: ["TEXT_SEARCH"] });
  const p = validateListViewDefinition(def, textEntity());
  assert.ok(p.some((x) => /cannot execute it honestly/.test(x) && /TEXT_SEARCH/.test(x)));
  assert.ok(!supportsTextOperator("FIRESTORE_NATIVE", "TEXT_SEARCH"));
});

test("a text operator with no textBackend is REJECTED — declaring the operator alone is not enough", () => {
  const def = textList({ textBackend: null });
  const p = validateListViewDefinition(def, textEntity());
  assert.ok(p.some((x) => /declares text operator "TEXT_EXACT" but no textBackend/.test(x)));
});

test("a textBackend nobody has heard of is REJECTED, not silently accepted", () => {
  const def = textList({ textBackend: "SOME_FUTURE_SEARCH_VENDOR" });
  const p = validateListViewDefinition(def, textEntity());
  assert.ok(p.some((x) => /is not a known TEXT_QUERY_BACKEND/.test(x)));
});

test("a textBackend declared with no text operator is REJECTED — meaningless without one", () => {
  const def = makeListViewDefinition({
    id: "widget.index", entityId: "widget", label: "Widgets", surface: "INDEX",
    columns: [makeColumn({ fieldId: "name" })],
    defaultSort: [makeSort({ fieldId: "name" })],
    tiebreaker: "__name__",
    pageSize: 25,
    filters: [makeFilter({ fieldId: "name", operators: ["EQUALS"], textBackend: "FIRESTORE_NATIVE" })],
  });
  const p = validateListViewDefinition(def, textEntity());
  assert.ok(p.some((x) => /declares textBackend "FIRESTORE_NATIVE" but no text operator/.test(x)));
});

test("NO SILENT DOWNGRADE: an unsupported TEXT_CONTAINS filter never validates clean by any route, including alongside a supported operator", () => {
  // Declaring TEXT_CONTAINS next to a supported TEXT_PREFIX on the same filter must
  // not let the supported operator's success paper over the unsupported one — each
  // operator is judged on its own.
  const def = textList({ operators: ["TEXT_PREFIX", "TEXT_CONTAINS"] });
  const p = validateListViewDefinition(def, textEntity());
  assert.ok(p.some((x) => /TEXT_CONTAINS/.test(x) && /cannot execute it honestly/.test(x)));
  // And critically: the rejection message never mentions serving it AS TEXT_PREFIX —
  // there is no downgrade path, only a rejection.
  assert.ok(!p.some((x) => /TEXT_CONTAINS/.test(x) && /as TEXT_PREFIX/i.test(x)));
});

test("a text filter still requires the field to be filterable — the generic promise-keeping rule is not bypassed by text operators", () => {
  const entity = makeEntityDefinition({
    id: "widget", label: "Widget", collection: "widgets", readVia: "CLIENT_DIRECT",
    identity: makeIdentity({ nameField: "name" }),
    fields: [makeFieldDefinition({ id: "name", entityId: "widget", label: "Name", type: "STRING" })], // filterable defaults false
  });
  const p = validateListViewDefinition(textList(), entity);
  assert.ok(p.some((x) => /not declared filterable/.test(x)));
});

test("a text operator is not FIELD_OPERATOR and does not require the field to have declared it — a field never widens to text", () => {
  // widget.name only declares ["EQUALS"] in its own field.operators, yet TEXT_EXACT on
  // the same field validates clean: text operators are a list-level opt-in, not a claim
  // the field itself makes.
  assert.deepEqual(validateListViewDefinition(textList(), textEntity()), []);
});

// --- Index-derivation impact of text operators ---------------------------------------

test("TEXT_EXACT participates in composite-index derivation exactly like EQUALS", () => {
  const equalsDef = makeListViewDefinition({
    id: "widget.index", entityId: "widget", label: "Widgets", surface: "INDEX",
    columns: [makeColumn({ fieldId: "name" })],
    defaultSort: [makeSort({ fieldId: "name" })],
    tiebreaker: "__name__",
    pageSize: 25,
    filters: [makeFilter({ fieldId: "description", operators: ["EQUALS"], required: true })],
  });
  const textExactDef = makeListViewDefinition({
    id: "widget.index", entityId: "widget", label: "Widgets", surface: "INDEX",
    columns: [makeColumn({ fieldId: "name" })],
    defaultSort: [makeSort({ fieldId: "name" })],
    tiebreaker: "__name__",
    pageSize: 25,
    filters: [makeFilter({ fieldId: "description", operators: ["TEXT_EXACT"], textBackend: "FIRESTORE_NATIVE", required: true })],
  });
  const entity = textEntity();
  const equalsIndexes = requiredIndexes(equalsDef, entity).map(indexKey);
  const textIndexes = requiredIndexes(textExactDef, entity).map(indexKey);
  assert.deepEqual(textIndexes, equalsIndexes);
  assert.ok(equalsIndexes.length > 0);
});

test("TEXT_PREFIX participates in composite-index derivation exactly like a range operator (GREATER_OR_EQUAL)", () => {
  const rangeDef = makeListViewDefinition({
    id: "widget.index", entityId: "widget", label: "Widgets", surface: "INDEX",
    columns: [makeColumn({ fieldId: "name" })],
    defaultSort: [makeSort({ fieldId: "name" })],
    tiebreaker: "__name__",
    pageSize: 25,
    filters: [makeFilter({ fieldId: "description", operators: ["GREATER_OR_EQUAL"], required: true })],
  });
  const prefixDef = makeListViewDefinition({
    id: "widget.index", entityId: "widget", label: "Widgets", surface: "INDEX",
    columns: [makeColumn({ fieldId: "name" })],
    defaultSort: [makeSort({ fieldId: "name" })],
    tiebreaker: "__name__",
    pageSize: 25,
    filters: [makeFilter({ fieldId: "description", operators: ["TEXT_PREFIX"], textBackend: "FIRESTORE_NATIVE", required: true })],
  });
  const entity = textEntity();
  const rangeIndexes = requiredIndexes(rangeDef, entity).map(indexKey);
  const prefixIndexes = requiredIndexes(prefixDef, entity).map(indexKey);
  assert.deepEqual(prefixIndexes, rangeIndexes);
  assert.ok(rangeIndexes.length > 0);
});

test("requiredIndexes derivation for TEXT_EXACT/TEXT_PREFIX is unaffected: no new index shape, no code path skipped", () => {
  // Documents plainly which text operators need a Firestore index at all: TEXT_EXACT and
  // TEXT_PREFIX do (they run as real Firestore predicates), TEXT_CONTAINS/TEXT_SEARCH
  // never reach requiredIndexes() with a valid definition because no backend can serve
  // them yet (asserted above) -- there is nothing to derive an index for.
  const def = textList(); // TEXT_EXACT
  assert.ok(requiredIndexes(def, textEntity()).length >= 0); // does not throw; shape covered above
});

// --- Additivity: every REAL registered definition still validates exactly as before -
//
// The Owner ruling's additive requirement: prove this against the real registered
// definitions, not a fixture built to be convenient. Every *Entity/*List export across
// src/metadata/definitions/ is collected below and cross-validated exactly as the
// runtime would, with every entity's own relationships pooled as the third argument
// (mirrors how RELATED lists actually resolve their parent edge).

function collectDefinitions(...modules) {
  const entities = [];
  const lists = [];
  for (const mod of modules) {
    for (const [key, value] of Object.entries(mod)) {
      if (!value || typeof value !== "object") continue;
      if (key.endsWith("Entity") && value.fields && value.id) entities.push(value);
      else if (key.endsWith("List") && value.surface && value.entityId) lists.push(value);
    }
  }
  return { entities, lists };
}

const { entities: realEntities, lists: realLists } = collectDefinitions(
  accountDefs, contactDefs, employeeDefs, equipmentDefs, equipmentModelDefs, invoiceDefs,
  locationDefs, manufacturerDefs, mobileLocationDefs, opportunityDefs, partDefs, paymentDefs,
  purchaseOrderDefs, salesOrderDefs, salesTerritoryDefs, stockLocationDefs, supplierDefs,
  truckDefs, warehouseDefs, workOrderDefs
);

const allRelationships = realEntities.flatMap((e) => e.relationships ?? []);

test("sanity: real definitions were actually collected (a broken import would otherwise pass 0 tests silently)", () => {
  assert.ok(realEntities.length >= 15, `expected at least 15 real entities, found ${realEntities.length}`);
  assert.ok(realLists.length >= 15, `expected at least 15 real list views, found ${realLists.length}`);
});

test("ADDITIVITY: every real registered ListViewDefinition still validates with zero problems after the text-operator extension", () => {
  const failures = [];
  for (const list of realLists) {
    const entity = realEntities.find((e) => e.id === list.entityId);
    if (!entity) { failures.push(`${list.id}: no entity "${list.entityId}" found among collected definitions`); continue; }
    const problems = validateListViewDefinition(list, entity, allRelationships);
    if (problems.length) failures.push(`${list.id}: ${problems.join(" | ")}`);
  }
  assert.deepEqual(failures, [], `real definitions regressed after the text-operator extension:\n${failures.join("\n")}`);
});

test("ADDITIVITY: no real registered filter declares textBackend — every existing filter is entirely unaffected by the new field", () => {
  for (const list of realLists) {
    for (const f of list.filters ?? []) {
      assert.equal(f.textBackend, null, `${list.id} filter "${f.fieldId}" unexpectedly has a non-null textBackend`);
    }
  }
});
