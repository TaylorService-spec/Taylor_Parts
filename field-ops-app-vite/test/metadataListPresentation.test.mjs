// List presentation model — contract tests.
//
// What a user is shown is the part worth asserting exhaustively, and it is only
// assertable offline while the model stays pure. Several of these encode defects this
// codebase has already shipped.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../src/metadata/entityDefinition.js";
import { makeListViewDefinition, makeColumn } from "../src/metadata/listViewDefinition.js";
import { componentRegistry } from "../src/metadata/registry.js";
import { buildListPresentation, resolveColumns, cellValue, emptyMessageFor, LIST_STATE } from "../src/metadata/listPresentation.js";
import { formatTimestamp } from "../src/domain/displayTimestamp.js";

const entity = () => makeEntityDefinition({
  id: "account", label: "Customer", collection: "accounts", readVia: "CLIENT_DIRECT",
  identity: makeIdentity({ nameField: "name" }),
  fields: [
    makeFieldDefinition({ id: "name", entityId: "account", label: "Name", type: "STRING", sortable: true }),
    makeFieldDefinition({
      id: "status", entityId: "account", label: "Status", type: "ENUM",
      enumValues: ["ACTIVE", "PROSPECT"], enumLabels: { ACTIVE: "Active", PROSPECT: "Prospect" },
      filterable: true, operators: ["EQUALS"], sortable: true,
    }),
    makeFieldDefinition({ id: "balance", entityId: "account", label: "Balance", type: "CURRENCY_MINOR" }),
  ],
});

const def = (over = {}) => makeListViewDefinition({
  id: "account.index", entityId: "account", label: "Customers", surface: "INDEX",
  columns: [makeColumn({ fieldId: "name" }), makeColumn({ fieldId: "status" })],
  pageSize: 25, ...over,
});

const page = (rows, hasMore = false) => ({ rows, hasMore, nextCursor: null });

beforeEach(() => {
  componentRegistry.__resetForTest();
  componentRegistry.register({ id: "currency", kind: "CELL_RENDERER", component: () => null });
});

test("LIST_STATE is frozen and distinguishes every way a list can show nothing", () => {
  assert.ok(Object.isFrozen(LIST_STATE));
  for (const s of ["EMPTY", "FILTERED", "DENIED", "UNAVAILABLE"]) assert.ok(LIST_STATE.includes(s));
});

// --- the four empties are four different facts ------------------------------

test("EMPTY and FILTERED are different facts, and only one has an action", () => {
  const empty = buildListPresentation({ def: def(), entity: entity(), page: page([]), filtersActive: false });
  const filtered = buildListPresentation({ def: def(), entity: entity(), page: page([]), filtersActive: true });
  assert.equal(empty.state, "EMPTY");
  assert.equal(filtered.state, "FILTERED");
  assert.notEqual(empty.emptyMessage, filtered.emptyMessage);
  assert.match(filtered.emptyMessage, /filters/, "the filtered case must point at the filter, which is the thing to clear");
});

test("DENIED never says 'no records' — that is the lie that sends people hunting for data", () => {
  const denied = buildListPresentation({ def: def(), entity: entity(), errorStatus: "denied" });
  assert.equal(denied.state, "DENIED");
  assert.match(denied.emptyMessage, /access/);
  assert.ok(!/No customers/i.test(denied.emptyMessage), "a capability gap must not read as absent data");
});

test("UNAVAILABLE never says 'none' — a failed read is not an empty result", () => {
  const failed = buildListPresentation({ def: def(), entity: entity(), errorStatus: "unavailable" });
  assert.equal(failed.state, "UNAVAILABLE");
  assert.match(failed.emptyMessage, /could not be loaded/);
  assert.ok(!/^No /.test(failed.emptyMessage));
});

test("an absent page is UNAVAILABLE, not EMPTY — nothing fetched is not nothing there", () => {
  const p = buildListPresentation({ def: def(), entity: entity(), page: null });
  assert.equal(p.state, "UNAVAILABLE");
});

test("loading outranks every other state", () => {
  const p = buildListPresentation({ def: def(), entity: entity(), loading: true, errorStatus: "denied" });
  assert.equal(p.state, "LOADING");
});

test("rows are only produced in READY, so no state can render half a table", () => {
  for (const args of [{ loading: true }, { errorStatus: "denied" }, { errorStatus: "x" }, { page: page([]) }]) {
    const p = buildListPresentation({ def: def(), entity: entity(), ...args });
    assert.deepEqual(p.rows, [], `${p.state} must render no rows`);
  }
});

// --- machine values must not reach a user (#1093) ---------------------------

test("#1093 — an enum cell renders its label, never its stored value", () => {
  const p = buildListPresentation({ def: def(), entity: entity(), page: page([{ id: "a1", name: "Harbor Grill", status: "ACTIVE" }]) });
  const status = p.rows[0].cells.find((c) => c.fieldId === "status");
  assert.equal(status.value, "Active", "ACTIVE is a machine value; a user should never see it");
});

test("#1093 — an unmapped enum value is shown verbatim rather than blanked", () => {
  // An unrecognized status is a data question. Hiding it answers nothing and makes the
  // row look complete when it is not.
  const p = buildListPresentation({ def: def(), entity: entity(), page: page([{ id: "a1", name: "X", status: "SOMETHING_NEW" }]) });
  assert.equal(p.rows[0].cells.find((c) => c.fieldId === "status").value, "SOMETHING_NEW");
});

// --- TIMESTAMP/DATE cells resolve through the shared formatter, never as raw epoch ---

test("a TIMESTAMP cell renders a formatted date, not an epoch number, for a Firestore Timestamp", () => {
  // A fake client-SDK Firestore Timestamp — the shape domain/timestampMillis.js's
  // toMillis() already coerces via .toMillis().
  const stamp = { toMillis: () => 1_700_000_000_000 };
  const column = { fieldId: "createdAt", type: "TIMESTAMP" };
  const value = cellValue(column, { createdAt: stamp });
  assert.equal(value, formatTimestamp(stamp), "must be the SAME shared formatter's output, not a hardcoded string");
  assert.notEqual(value, 1_700_000_000_000, "an epoch number is a machine value reaching a user");
});

test("a TIMESTAMP cell renders a formatted date, not an epoch number, for an epoch-millisecond NUMBER", () => {
  // equipment/employee store createdAt/updatedAt as plain numbers, not Timestamps —
  // Opportunity even mixes both shapes across its own fields (expectedCloseAt is a
  // number, createdAt is a Timestamp). The formatter must handle this shape too.
  const epochMs = 1_700_000_000_000;
  const column = { fieldId: "expectedCloseAt", type: "TIMESTAMP" };
  const value = cellValue(column, { expectedCloseAt: epochMs });
  assert.equal(value, formatTimestamp(epochMs));
  assert.notEqual(value, epochMs, "an epoch number is a machine value reaching a user");
});

test("a DATE cell resolves through the same shared formatter as TIMESTAMP", () => {
  const epochMs = 1_700_000_000_000;
  const column = { fieldId: "installedDate", type: "DATE" };
  assert.equal(cellValue(column, { installedDate: epochMs }), formatTimestamp(epochMs));
});

test("an uninterpretable TIMESTAMP renders nothing rather than a raw number or a placeholder string", () => {
  // A value toMillis() cannot coerce (an unrecognized object shape) must not fall back
  // to the raw stored value — the same class of defect enum resolution exists to
  // prevent (#1093). It also must not silently become formatTimestamp's default
  // "Unknown" placeholder text: this cell renders NOTHING, exactly like a missing value.
  const column = { fieldId: "expectedCloseAt", type: "TIMESTAMP" };
  const value = cellValue(column, { expectedCloseAt: { weird: "shape" } });
  assert.equal(value, null);
});

test("a header never falls back to the fieldId — that is a schema leaking into a UI", () => {
  const cols = resolveColumns(def({ columns: [makeColumn({ fieldId: "balance" })] }), entity());
  assert.equal(cols[0].label, "Balance");
  assert.notEqual(cols[0].label, "balance");
});

test("a column label overrides the field's, and both beat the id", () => {
  const cols = resolveColumns(def({ columns: [makeColumn({ fieldId: "name", label: "Customer name" })] }), entity());
  assert.equal(cols[0].label, "Customer name");
});

// --- the routing key is not a label -----------------------------------------

test("the document id is the row KEY and never a cell", () => {
  // It has to be usable for navigation without ever becoming visible text — the exact
  // separation missing where 95kFz8WWgiSn2nU2O3Ml became a row label.
  const p = buildListPresentation({ def: def(), entity: entity(), page: page([{ id: "95kFz8WWgi", name: "Harbor Grill", status: "ACTIVE" }]) });
  assert.equal(p.rows[0].key, "95kFz8WWgi");
  for (const cell of p.rows[0].cells) assert.notEqual(cell.value, "95kFz8WWgi");
});

test("an empty or missing value renders as null, so the component decides the placeholder", () => {
  const p = buildListPresentation({ def: def(), entity: entity(), page: page([{ id: "a1", name: "", status: undefined }]) });
  for (const cell of p.rows[0].cells) assert.equal(cell.value, null);
});

// --- degradation is honest --------------------------------------------------

test("a column whose renderer is unregistered keeps the column and loses the renderer", () => {
  // Dropping the column would silently narrow the table and the reader would never learn
  // a field was missing. The data stays true; only its formatting is gone.
  const cols = resolveColumns(def({ columns: [makeColumn({ fieldId: "balance", renderer: "ghost" })] }), entity());
  assert.equal(cols[0].fieldId, "balance");
  assert.equal(cols[0].renderer, null);
  assert.equal(cols[0].rendererMissing, true, "the degradation is reported, not hidden");
});

test("a registered renderer is kept", () => {
  const cols = resolveColumns(def({ columns: [makeColumn({ fieldId: "balance", renderer: "currency" })] }), entity());
  assert.equal(cols[0].renderer, "currency");
  assert.equal(cols[0].rendererMissing, false);
});

test("a column is only sortable when the FIELD is too — sorting needs an index", () => {
  const cols = resolveColumns(def({ columns: [makeColumn({ fieldId: "balance", sortable: true })] }), entity());
  assert.equal(cols[0].sortable, false, "a definition cannot make an unindexed field sortable by asking");
});

// --- surface differences ----------------------------------------------------

test("only an INDEX offers paging; a RELATED section hands off instead", () => {
  const related = makeListViewDefinition({
    id: "account.opportunities.related", entityId: "account", label: "Opportunities", surface: "RELATED",
    columns: [makeColumn({ fieldId: "name" })], pageSize: 5,
    parentRelationshipId: "account.opportunities", viewAllListId: "opportunity.index",
  });
  const p = buildListPresentation({ def: related, entity: entity(), page: page([{ id: "o1", name: "Deal" }], true) });
  assert.equal(p.hasMore, false, "offering load-more here would turn a capped section into a second unbounded list");
  assert.equal(p.truncated, true, "but the section still discloses that more exist");
  assert.equal(p.viewAllListId, "opportunity.index");

  const index = buildListPresentation({ def: def(), entity: entity(), page: page([{ id: "a1", name: "X" }], true) });
  assert.equal(index.hasMore, true);
  assert.equal(index.viewAllListId, null);
});

test("emptyMessageFor uses the list's own label", () => {
  assert.match(emptyMessageFor("EMPTY", def()), /customers/i);
  assert.equal(emptyMessageFor("READY", def()), null);
});

test("cellValue is pure and total — it never throws on a missing row or column", () => {
  assert.equal(cellValue({ fieldId: "x", type: "STRING" }, undefined), null);
  assert.equal(cellValue({ fieldId: "x", type: "STRING" }, {}), null);
});

test("an ENUM_SET cell resolves EVERY member through the label map", () => {
  // Rendering the array as-is would print "CUSTOMERVENDOR" — machine values,
  // concatenated, in front of a user.
  const column = { fieldId: "relationshipTypes", type: "ENUM_SET", enumLabels: { CUSTOMER: "Customer", VENDOR: "Vendor" } };
  assert.equal(cellValue(column, { relationshipTypes: ["CUSTOMER", "VENDOR"] }), "Customer, Vendor");
});

test("an unmapped ENUM_SET member is shown verbatim, not dropped", () => {
  // A value the enum does not know is a data question; hiding it answers nothing.
  const column = { fieldId: "relationshipTypes", type: "ENUM_SET", enumLabels: { CUSTOMER: "Customer" } };
  assert.equal(cellValue(column, { relationshipTypes: ["CUSTOMER", "PARTNER"] }), "Customer, PARTNER");
});

test("an empty ENUM_SET is absent, not an empty string", () => {
  const column = { fieldId: "relationshipTypes", type: "ENUM_SET", enumLabels: {} };
  assert.equal(cellValue(column, { relationshipTypes: [] }), null);
});

test("a BOOLEAN column renders text, not a blank cell", () => {
  // `false` is a real, meaningful value. React renders neither true nor false as a child,
  // so before this a declared boolean column was blank whichever way it was set --
  // "no" and "unknown" became the same cell.
  const col = { fieldId: "isPrimary", type: "BOOLEAN" };
  assert.equal(cellValue(col, { isPrimary: true }), "Yes");
  assert.equal(cellValue(col, { isPrimary: false }), "No");
  // Genuinely absent stays absent, and must not read as "No" -- "this contact is not the
  // primary" and "nobody recorded whether they are" are different claims.
  assert.equal(cellValue(col, { isPrimary: null }), null);
  assert.equal(cellValue(col, {}), null);
});
