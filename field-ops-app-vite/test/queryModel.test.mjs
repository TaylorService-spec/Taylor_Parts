// The EOS Query Model — one AST, six consumers.
//
// The invariants here are the ones that would otherwise be decided six separate times,
// differently: what an empty IN means, whether a hidden field can be filtered on, whether
// an aggregate may be paged, and whether a promise of completeness survives a cursor.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeQuery, comparison, group, traversal,
  validateQuery, validateAgainstMetadata, validateAuthority, validateQueryability,
  COMPLETENESS,
} from "../src/metadata/query/queryModel.js";
import { makeEntityDefinition, makeFieldDefinition, makeIdentity, makeRelationshipDefinition } from "../src/metadata/entityDefinition.js";

const entity = makeEntityDefinition({
  id: "workOrder", label: "Work Order", collection: "fieldops_wos",
  identity: makeIdentity({ referenceField: "woNumber" }),
  fields: [
    makeFieldDefinition({ id: "woNumber", entityId: "workOrder", label: "Work Order", type: "STRING", sortable: true }),
    makeFieldDefinition({ id: "status", entityId: "workOrder", label: "Status", type: "ENUM", enumValues: ["OPEN"], enumLabels: { OPEN: "Open" }, filterable: true, sortable: true, operators: ["EQUALS", "IN"] }),
    makeFieldDefinition({ id: "cost", entityId: "workOrder", label: "Cost", type: "NUMBER", filterable: true, operators: ["GREATER_THAN"], readCapability: "finance.read" }),
    makeFieldDefinition({ id: "createdAt", entityId: "workOrder", label: "Created", type: "TIMESTAMP", sortable: true }),
  ],
  relationships: [
    makeRelationshipDefinition({ id: "workOrder.account", label: "Account", fromEntityId: "workOrder", toEntityId: "account", viaField: "accountId", cardinality: "MANY_TO_ONE", traversalCapability: "account.record.read" }),
  ],
});

const q = (over = {}) => makeQuery({
  entityId: "workOrder", select: ["woNumber", "status"],
  where: comparison("status", "EQUALS", "OPEN"),
  orderBy: [{ field: "createdAt", direction: "DESC" }],
  completeness: "PAGE", limit: 50, origin: "LIST",
  ...over,
});

const codes = (r) => r.problems.map((p) => p.code);

test("a well-formed query validates through every stage", () => {
  assert.equal(validateQuery(q(), entity).stage, "VALID");
});

// --- metadata ----------------------------------------------------------------

test("a declared operator is a promise — an undeclared one is refused", () => {
  // The rule the list contract enforces, applied to every consumer rather than to lists
  // alone. This is what stops EQL and automation from asking for queries no index serves.
  const r = validateQuery(q({ where: comparison("status", "GREATER_THAN", "OPEN") }), entity);
  assert.equal(r.stage, "METADATA");
  assert.ok(codes(r).includes("UNDECLARED_OPERATOR"));
});

test("an EMPTY IN is refused rather than resolved by whichever backend runs it", () => {
  // Ambiguous by convention: some engines match nothing, some everything. Six consumers
  // guessing separately is exactly what this model exists to prevent.
  const r = validateQuery(q({ where: comparison("status", "IN", []) }), entity);
  assert.ok(codes(r).includes("EMPTY_IN"));
});

test("a traversal to an unregistered relationship is the arbitrary join this forbids", () => {
  const r = validateQuery(q({ where: traversal("workOrder.vendor", comparison("status", "EQUALS", "OPEN")) }), entity);
  assert.ok(codes(r).includes("UNKNOWN_RELATIONSHIP"));
});

test("a registered traversal passes metadata validation", () => {
  const query = q({ where: traversal("workOrder.account", comparison("status", "EQUALS", "OPEN")) });
  assert.deepEqual(validateAgainstMetadata(query, entity), []);
});

test("sorting on a field that is not declared sortable is refused", () => {
  const r = validateQuery(q({ orderBy: [{ field: "cost", direction: "ASC" }] }), entity);
  assert.ok(codes(r).includes("NOT_SORTABLE"));
});

test("a group needs predicates — an empty AND is not a filter", () => {
  const r = validateQuery(q({ where: group("AND") }), entity);
  assert.ok(codes(r).includes("EMPTY_GROUP"));
});

// --- authority ---------------------------------------------------------------

test("authority fails closed on an empty decision map", () => {
  const query = q({ select: ["woNumber", "cost"] });
  const r = validateQuery(query, entity, { decisions: {} });
  assert.equal(r.stage, "AUTHORITY");
  assert.ok(codes(r).includes("DENIED_FIELD"));
});

test("a field a viewer may not READ cannot be FILTERED on either", () => {
  // A predicate over a hidden field leaks its values by binary search: filter cost > 100,
  // see whether the row appears, repeat. The read boundary has to cover the predicate.
  const query = q({ where: comparison("cost", "GREATER_THAN", 100) });
  const r = validateQuery(query, entity, { decisions: {} });
  assert.equal(r.stage, "AUTHORITY");
  assert.ok(codes(r).includes("DENIED_FIELD"));
});

test("an explicit grant permits the same query", () => {
  const query = q({ where: comparison("cost", "GREATER_THAN", 100) });
  assert.equal(validateQuery(query, entity, { decisions: { "finance.read": true } }).stage, "VALID");
});

test("traversal authority is the RELATED entity's, not this one's", () => {
  // A viewer who may read the Work Order but not the Account cannot filter Work Orders by
  // Account fields — the disclosure a LOOKUP would launder, one level up.
  const query = q({ where: traversal("workOrder.account", comparison("status", "EQUALS", "OPEN")) });
  const denied = validateAuthority(query, entity, {});
  assert.ok(denied.some((p) => p.code === "DENIED_TRAVERSAL"));
  assert.deepEqual(validateAuthority(query, entity, { "account.record.read": true }), []);
});

// --- queryability ------------------------------------------------------------

test("an AGGREGATE may not be paged or bounded", () => {
  // A page of inputs yields a false total. Both forms are refused, because either one
  // produces a number that is smaller than the truth while still labelled complete.
  assert.ok(validateQueryability(q({ completeness: "AGGREGATE", limit: null, cursor: "x" }), entity)
    .some((p) => p.code === "AGGREGATE_PAGED"));
  assert.ok(validateQueryability(q({ completeness: "AGGREGATE", limit: 50 }), entity)
    .some((p) => p.code === "AGGREGATE_BOUNDED"));
});

test("a COMPLETE result is not paged — the board promise, preserved", () => {
  // Folding a board into list paging is the mistake boardScope.js exists to prevent, and
  // the shared model must not reintroduce it.
  assert.ok(validateQueryability(q({ completeness: "COMPLETE", cursor: "x", limit: null }), entity)
    .some((p) => p.code === "COMPLETE_PAGED"));
});

test("a PAGE without a limit is a whole-collection read wearing a page's name", () => {
  assert.ok(validateQueryability(q({ limit: null }), entity).some((p) => p.code === "UNBOUNDED_PAGE"));
});

test("the three completeness promises stay three", () => {
  assert.deepEqual([...COMPLETENESS], ["PAGE", "COMPLETE", "AGGREGATE"]);
});

// --- pipeline ordering -------------------------------------------------------

test("stages run metadata, then authority, then queryability — and stop at the first refusal", () => {
  // Ordering is not cosmetic. Reporting "you may not read that field" for a field that
  // does not exist tells the caller something false about their access, and reporting a
  // missing index for an unauthorized query leaks the shape of data they cannot see.
  const bogus = q({ select: ["nonexistent"], where: comparison("cost", "GREATER_THAN", 1) });
  const r = validateQuery(bogus, entity, { decisions: {} });
  assert.equal(r.stage, "METADATA");
  assert.ok(!codes(r).includes("DENIED_FIELD"), "authority was not reached, so it cannot have reported");
});

test("origin is carried, so an execution record can say what asked for the read", () => {
  for (const origin of ["LIST", "REPORT", "AUTOMATION", "EQL", "AI", "EXPORT"]) {
    assert.equal(makeQuery({ entityId: "workOrder", origin }).origin, origin);
  }
  // Not decorative: an EQL query and an automation condition fail differently and are
  // audited differently.
  assert.equal(makeQuery({ entityId: "workOrder" }).origin, "UNKNOWN");
});

test("the model never resolves authority itself — decisions arrive from the caller", () => {
  // §6 does not soften because a query is involved. There is no resolver here to call.
  const query = q({ where: comparison("cost", "GREATER_THAN", 1) });
  assert.notEqual(validateQuery(query, entity, { decisions: {} }).stage, "VALID");
  assert.equal(validateQuery(query, entity, { decisions: { "finance.read": true } }).stage, "VALID");
});
