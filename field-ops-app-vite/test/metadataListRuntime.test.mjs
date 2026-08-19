// List runtime query core — contract tests.
//
// The point of a pure query core is that §9 becomes assertable rather than hoped for.
// These test the SHAPE of every query the runtime can produce, including the shapes it
// cannot produce, because a guarantee expressed as an absence needs a test or it quietly
// stops being absent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEntityDefinition, makeFieldDefinition, makeRelationshipDefinition, makeIdentity } from "../src/metadata/entityDefinition.js";
import { makeListViewDefinition, makeColumn, makeFilter, makeSort, MAX_PAGE_SIZE } from "../src/metadata/listViewDefinition.js";
import { buildQueryDescriptor, interpretPage, toUrlParams, fromUrlParams, REQUEST_ERROR } from "../src/metadata/listRuntime.js";

const account = () => makeEntityDefinition({
  id: "account", label: "Customer", collection: "accounts", readVia: "CLIENT_DIRECT",
  readCapability: "account.read",
  identity: makeIdentity({ nameField: "name" }),
  fields: [
    makeFieldDefinition({ id: "name", entityId: "account", label: "Name", type: "STRING", sortable: true }),
    makeFieldDefinition({ id: "status", entityId: "account", label: "Status", type: "ENUM", enumValues: ["ACTIVE"], enumLabels: { ACTIVE: "Active" }, filterable: true, operators: ["EQUALS", "IN"], sortable: true }),
    makeFieldDefinition({ id: "secret", entityId: "account", label: "Secret", type: "STRING" }),
  ],
  relationships: [
    makeRelationshipDefinition({ id: "account.opportunities", label: "Opportunities", fromEntityId: "account", toEntityId: "opportunity", viaField: "accountId", cardinality: "ONE_TO_MANY" }),
    // Reaches ACCOUNT, so an account RELATED list can honestly be scoped by it.
    makeRelationshipDefinition({ id: "parentAccount.children", label: "Child accounts", fromEntityId: "account", toEntityId: "account", viaField: "parentAccountId", cardinality: "ONE_TO_MANY" }),
  ],
});

const indexList = (over = {}) => makeListViewDefinition({
  id: "account.index", entityId: "account", label: "Customers", surface: "INDEX",
  columns: [makeColumn({ fieldId: "name" })],
  filters: [makeFilter({ fieldId: "status", operators: ["EQUALS", "IN"] })],
  defaultSort: [makeSort({ fieldId: "name", direction: "ASC" })],
  pageSize: 50, ...over,
});

const build = (req = {}, def = indexList()) => buildQueryDescriptor(def, account(), req);

test("a clean request produces a descriptor with no errors", () => {
  const { descriptor, errors } = build();
  assert.deepEqual(errors, []);
  assert.equal(descriptor.collection, "accounts");
  assert.equal(descriptor.listId, "account.index");
});

// --- §9: the guarantees are absences, so they are tested as absences ---------

test("§9 — there is no offset or page-number concept anywhere in a descriptor", () => {
  const { descriptor } = build();
  for (const forbidden of ["offset", "page", "skip", "startAt"]) {
    assert.equal(forbidden in descriptor, false, `${forbidden} must not exist — offset paging bills for skipped documents`);
  }
  assert.equal("cursor" in descriptor, true, "paging is cursor-only");
});

test("§9 — every descriptor carries a limit, and nothing can remove it", () => {
  for (const req of [{}, { pageSize: undefined }, { pageSize: null }, { pageSize: 0 }, { pageSize: -5 }]) {
    const { descriptor } = build(req);
    assert.ok(descriptor, `request ${JSON.stringify(req)} still produced a descriptor`);
    assert.ok(Number.isInteger(descriptor.limit) && descriptor.limit > 0, "a limit is always present and positive");
    assert.ok(descriptor.limit <= MAX_PAGE_SIZE + 1);
  }
});

test("§9 — an oversized page size is rejected, not silently clamped into a lie", () => {
  const { descriptor, errors } = build({ pageSize: 5000 });
  assert.equal(descriptor, null);
  assert.ok(errors.some((e) => e.kind === "PAGE_SIZE_EXCEEDED"));
});

test("the limit is pageSize + 1 — the probe row is how truncation is detected", () => {
  const { descriptor } = build({ pageSize: 25 });
  assert.equal(descriptor.pageSize, 25);
  assert.equal(descriptor.limit, 26);
});

// --- filters cannot exceed what the definition declared ---------------------

test("a filter the list never declared is rejected", () => {
  // Not merely unsupported: it was never offered, so no index was ever proven for it.
  const { descriptor, errors } = build({ filters: [{ fieldId: "name", operator: "EQUALS", value: "x" }] });
  assert.equal(descriptor, null);
  assert.ok(errors.some((e) => e.kind === "UNDECLARED_FILTER"));
});

test("an operator outside the declared set is rejected", () => {
  const { errors } = build({ filters: [{ fieldId: "status", operator: "ARRAY_CONTAINS", value: "x" }] });
  assert.ok(errors.some((e) => e.kind === "UNSUPPORTED_OPERATOR"));
});

test("a filter on a nonexistent field is rejected", () => {
  const { errors } = build({ filters: [{ fieldId: "ghost", operator: "EQUALS", value: "x" }] });
  assert.ok(errors.some((e) => e.kind === "UNKNOWN_FILTER_FIELD"));
});

test("a declared filter passes through intact", () => {
  const { descriptor, errors } = build({ filters: [{ fieldId: "status", operator: "EQUALS", value: "ACTIVE" }] });
  assert.deepEqual(errors, []);
  assert.deepEqual(descriptor.filters, [{ fieldId: "status", operator: "EQUALS", value: "ACTIVE" }]);
});

// --- total order is enforced by the runtime, not trusted from the caller ----

test("the tiebreaker is appended by the runtime, so no request can produce a partial order", () => {
  const { descriptor } = build({ sort: [{ fieldId: "status", direction: "DESC" }] });
  const last = descriptor.sort[descriptor.sort.length - 1];
  assert.equal(last.fieldId, "__name__", "documentId() closes the order");
  assert.equal(last.direction, "ASC");
});

test("the tiebreaker is not duplicated when a caller already sorted by it", () => {
  const def = indexList({ tiebreaker: "name", defaultSort: [] });
  const { descriptor } = buildQueryDescriptor(def, account(), { sort: [{ fieldId: "name", direction: "ASC" }] });
  assert.equal(descriptor.sort.filter((s) => s.fieldId === "name").length, 1);
});

test("sorting on a non-sortable field is rejected", () => {
  const { errors } = build({ sort: [{ fieldId: "secret", direction: "ASC" }] });
  assert.ok(errors.some((e) => e.kind === "UNKNOWN_SORT_FIELD"));
});

// --- RELATED surfaces are scoped or they do not run -------------------------

test("a RELATED list without a parentId produces NO descriptor", () => {
  // The failure that matters: an unscoped related section renders every record of the
  // target entity, which is how an account's opportunity rows showed the whole pipeline.
  const related = makeListViewDefinition({
    id: "account.opportunities.related", entityId: "account", label: "Opportunities", surface: "RELATED",
    columns: [makeColumn({ fieldId: "name" })], pageSize: 5,
    parentRelationshipId: "parentAccount.children", viewAllListId: "opportunity.index",
  });
  const { descriptor, errors } = buildQueryDescriptor(related, account(), {});
  assert.equal(descriptor, null, "no descriptor at all — not an unscoped one");
  assert.ok(errors.some((e) => e.kind === "MISSING_PARENT_SCOPE"));
});

test("a RELATED list scopes by the relationship's viaField, first among the filters", () => {
  const related = makeListViewDefinition({
    id: "account.opportunities.related", entityId: "account", label: "Opportunities", surface: "RELATED",
    columns: [makeColumn({ fieldId: "name" })], pageSize: 5,
    parentRelationshipId: "parentAccount.children", viewAllListId: "opportunity.index",
  });
  const { descriptor } = buildQueryDescriptor(related, account(), { parentId: "acct-harbor" });
  assert.deepEqual(descriptor.filters[0], { fieldId: "parentAccountId", operator: "EQUALS", value: "acct-harbor" });
});

// --- §6: capabilities are carried, never decided ----------------------------

test("§6 — the descriptor carries capability ids and no decision", () => {
  const { descriptor } = build();
  assert.deepEqual(descriptor.requiredCapabilities, ["account.read"]);
  for (const forbidden of ["allowed", "permitted", "authorized"]) {
    assert.equal(forbidden in descriptor, false, `${forbidden} must not exist — the runtime decides nothing`);
  }
});

test("§6 — this module imports nothing from access/ and calls no resolver", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/metadata/listRuntime.js", import.meta.url), "utf8");
  assert.ok(!/from\s+["'].*\/access\//.test(src));
  assert.ok(!/resolveEffectiveAccess|hasCapability/.test(src));
});

// --- page interpretation ----------------------------------------------------

test("the probe row is removed from rows and never rendered", () => {
  const { descriptor } = build({ pageSize: 2 });
  const page = interpretPage(descriptor, [{ id: "a" }, { id: "b" }, { id: "c" }]);
  assert.equal(page.rows.length, 2, "the extra row is a probe, not content");
  assert.equal(page.hasMore, true);
});

test("the cursor is the last RETURNED row, not the probe — using the probe would skip a record", () => {
  const { descriptor } = build({ pageSize: 2 });
  const page = interpretPage(descriptor, [{ id: "a" }, { id: "b" }, { id: "c" }]);
  assert.deepEqual(page.nextCursor, { id: "b" }, "cursoring from 'c' would silently drop it from the next page");
});

test("a short page reports no more and no cursor", () => {
  const { descriptor } = build({ pageSize: 5 });
  const page = interpretPage(descriptor, [{ id: "a" }]);
  assert.equal(page.hasMore, false);
  assert.equal(page.nextCursor, null);
});

// --- URL state --------------------------------------------------------------

test("a filtered view round-trips through the URL", () => {
  const { descriptor } = build({ filters: [{ fieldId: "status", operator: "EQUALS", value: "ACTIVE" }] });
  const parsed = fromUrlParams(toUrlParams(descriptor));
  const rebuilt = build(parsed);
  assert.deepEqual(rebuilt.errors, []);
  assert.deepEqual(rebuilt.descriptor.filters, descriptor.filters);
});

test("a hand-edited URL cannot smuggle in an undeclared filter", () => {
  // fromUrlParams returns a REQUEST, not a query. It goes through the same validation as
  // any other, so the address bar is not an input to the query layer.
  const { descriptor, errors } = build(fromUrlParams("f=secret:EQUALS:x"));
  assert.equal(descriptor, null);
  assert.ok(errors.some((e) => e.kind === "UNDECLARED_FILTER"));
});

test("every error kind is a known REQUEST_ERROR", () => {
  const { errors } = build({ filters: [{ fieldId: "ghost", operator: "EQUALS", value: 1 }], sort: [{ fieldId: "secret" }] });
  assert.ok(errors.length >= 2);
  for (const e of errors) assert.ok(REQUEST_ERROR.includes(e.kind), `${e.kind} is not a known REQUEST_ERROR`);
});
