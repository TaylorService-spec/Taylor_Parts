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
import {
  buildListPresentation,
  resolveColumns,
  cellValue,
  emptyMessageFor,
  LIST_STATE,
  UNRESOLVED_REFERENCE_LABEL,
} from "../src/metadata/listPresentation.js";
import { formatTimestamp } from "../src/domain/displayTimestamp.js";
import { formatMinor } from "../src/domain/accountArView.js";

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

test("invoice.dueDate, retyped to DATE, renders through the timestamp path, not as a raw epoch number", () => {
  // dueDate is stored as ms epoch (invoiceCommands.ts's isInt guard) but is a DATE by kind --
  // formatTimestamp's own toMillis coercion already handles a plain epoch-millisecond NUMBER,
  // so no storage-shape change is implied by the retype.
  const epochMs = 1_700_000_000_000;
  const column = { fieldId: "dueDate", type: "DATE" };
  const value = cellValue(column, { dueDate: epochMs });
  assert.equal(value, formatTimestamp(epochMs));
  assert.notEqual(value, epochMs, "a due date reaching a user must never be a raw epoch number");
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

// --- CURRENCY_MINOR resolves through the shared minor-unit formatter, never raw cents ---

test("a CURRENCY_MINOR cell renders major units through the SAME formatter already used for outstandingMinor elsewhere, not raw minor units", () => {
  // A $125.00 invoice stores totalMinor: 12500. Rendering it raw would print "12500" in
  // front of a user -- the same class of defect enum resolution exists to prevent.
  const column = { fieldId: "totalMinor", type: "CURRENCY_MINOR" };
  const value = cellValue(column, { totalMinor: 12500, currency: "USD" });
  assert.equal(value, formatMinor(12500, "USD"), "must be the SAME shared formatter's output, not a hand-rolled string");
  assert.notEqual(value, 12500, "raw minor units are a machine value, not a display amount");
  assert.match(value, /125\.00/);
});

test("a CURRENCY_MINOR cell reads its currency from the row's own currency field, per the CURRENCY_MINOR contract -- never a hardcoded symbol", () => {
  const column = { fieldId: "totalMinor", type: "CURRENCY_MINOR" };
  assert.equal(cellValue(column, { totalMinor: 500, currency: "EUR" }), formatMinor(500, "EUR"));
  assert.notEqual(
    cellValue(column, { totalMinor: 500, currency: "EUR" }),
    cellValue(column, { totalMinor: 500, currency: "USD" }),
    "the same minor-unit amount in a different currency must not render identically"
  );
});

test("a zero CURRENCY_MINOR amount renders as zero, not blank -- zero is a real value, not an absence", () => {
  const column = { fieldId: "outstandingMinor", type: "CURRENCY_MINOR" };
  const value = cellValue(column, { outstandingMinor: 0, currency: "USD" });
  assert.notEqual(value, null);
  assert.match(value, /0\.00/);
});

test("a genuinely absent CURRENCY_MINOR amount renders nothing -- absent and zero are different claims", () => {
  const column = { fieldId: "outstandingMinor", type: "CURRENCY_MINOR" };
  assert.equal(cellValue(column, { currency: "USD" }), null);
  assert.equal(cellValue(column, { outstandingMinor: null, currency: "USD" }), null);
});

// --- REFERENCE never renders the raw stored id (DECISIONS #106, X-LIST-REFERENCE-RENDERS-ID) ---

test("a REFERENCE cell with no resolver supplied never renders the raw stored document id", () => {
  const column = { fieldId: "accountId", type: "REFERENCE" };
  const value = cellValue(column, { accountId: "95kFz8WWgiSn2nU2O3Ml" });
  assert.notEqual(value, "95kFz8WWgiSn2nU2O3Ml", "the id must never reach a cell as content");
  assert.equal(value, UNRESOLVED_REFERENCE_LABEL, "the unresolved state must be explicit, not a silent id fallthrough");
});

test("a REFERENCE cell resolves through an injected resolver to the real display value", () => {
  const column = { fieldId: "accountId", type: "REFERENCE" };
  const row = { accountId: "acc-1" };
  const resolveReference = (fieldId, id, r) => {
    assert.equal(fieldId, "accountId");
    assert.equal(id, "acc-1");
    assert.equal(r, row);
    return "Harbor Grill";
  };
  const value = cellValue(column, row, { resolveReference });
  assert.equal(value, "Harbor Grill");
  assert.notEqual(value, "acc-1");
});

test("a REFERENCE cell whose resolver does not recognize the id renders the SAME explicit unresolved state as no resolver at all", () => {
  const column = { fieldId: "accountId", type: "REFERENCE" };
  const resolveReference = () => null; // resolver ran, found nothing for this id
  const value = cellValue(column, { accountId: "deleted-account" }, { resolveReference });
  assert.equal(value, UNRESOLVED_REFERENCE_LABEL);
  assert.notEqual(value, "deleted-account");
});

test("a REFERENCE cell with no stored id is absent, not unresolved -- unset and unresolvable are different claims", () => {
  const column = { fieldId: "accountId", type: "REFERENCE" };
  assert.equal(cellValue(column, {}), null);
  assert.equal(cellValue(column, { accountId: null }), null);
  assert.equal(cellValue(column, { accountId: "" }), null);
});

test("buildListPresentation threads resolveReference through to every REFERENCE cell in a row", () => {
  const acctEntity = makeEntityDefinition({
    id: "invoice", label: "Invoice", collection: "invoices", readVia: "CLIENT_DIRECT",
    identity: makeIdentity({ nameField: "invoiceNumber" }),
    fields: [
      makeFieldDefinition({ id: "invoiceNumber", entityId: "invoice", label: "Invoice #", type: "STRING" }),
      makeFieldDefinition({ id: "accountId", entityId: "invoice", label: "Account", type: "REFERENCE", referenceTo: "account" }),
    ],
  });
  const listDef = makeListViewDefinition({
    id: "invoice.index", entityId: "invoice", label: "Invoices", surface: "INDEX",
    columns: [makeColumn({ fieldId: "invoiceNumber" }), makeColumn({ fieldId: "accountId" })],
    pageSize: 25,
  });
  const names = { "acc-1": "Harbor Grill" };
  const p = buildListPresentation({
    def: listDef,
    entity: acctEntity,
    page: page([{ id: "inv-1", invoiceNumber: "INV-000001", accountId: "acc-1" }]),
    resolveReference: (fieldId, id) => names[id] ?? null,
  });
  const cell = p.rows[0].cells.find((c) => c.fieldId === "accountId");
  assert.equal(cell.value, "Harbor Grill");
});

test("buildListPresentation with no resolveReference renders every REFERENCE cell as the explicit unresolved state, never the id", () => {
  const acctEntity = makeEntityDefinition({
    id: "invoice", label: "Invoice", collection: "invoices", readVia: "CLIENT_DIRECT",
    identity: makeIdentity({ nameField: "invoiceNumber" }),
    fields: [
      makeFieldDefinition({ id: "invoiceNumber", entityId: "invoice", label: "Invoice #", type: "STRING" }),
      makeFieldDefinition({ id: "accountId", entityId: "invoice", label: "Account", type: "REFERENCE", referenceTo: "account" }),
    ],
  });
  const listDef = makeListViewDefinition({
    id: "invoice.index", entityId: "invoice", label: "Invoices", surface: "INDEX",
    columns: [makeColumn({ fieldId: "invoiceNumber" }), makeColumn({ fieldId: "accountId" })],
    pageSize: 25,
  });
  const p = buildListPresentation({
    def: listDef,
    entity: acctEntity,
    page: page([{ id: "inv-1", invoiceNumber: "INV-000001", accountId: "acc-1" }]),
  });
  const cell = p.rows[0].cells.find((c) => c.fieldId === "accountId");
  assert.equal(cell.value, UNRESOLVED_REFERENCE_LABEL);
  assert.notEqual(cell.value, "acc-1");
});

// --- additivity: every other column type still renders exactly as before REFERENCE existed ---

test("additivity — STRING, ENUM, ENUM_SET, TIMESTAMP/DATE, BOOLEAN and CURRENCY_MINOR are all unaffected by cellValue's new REFERENCE branch and third parameter", () => {
  assert.equal(cellValue({ fieldId: "name", type: "STRING" }, { name: "Harbor Grill" }), "Harbor Grill");
  assert.equal(
    cellValue({ fieldId: "status", type: "ENUM", enumLabels: { ACTIVE: "Active" } }, { status: "ACTIVE" }),
    "Active"
  );
  assert.equal(
    cellValue(
      { fieldId: "relationshipTypes", type: "ENUM_SET", enumLabels: { CUSTOMER: "Customer" } },
      { relationshipTypes: ["CUSTOMER"] }
    ),
    "Customer"
  );
  const epochMs = 1_700_000_000_000;
  assert.equal(cellValue({ fieldId: "createdAt", type: "TIMESTAMP" }, { createdAt: epochMs }), formatTimestamp(epochMs));
  assert.equal(cellValue({ fieldId: "isPrimary", type: "BOOLEAN" }, { isPrimary: true }), "Yes");
  assert.equal(
    cellValue({ fieldId: "totalMinor", type: "CURRENCY_MINOR" }, { totalMinor: 12500, currency: "USD" }),
    formatMinor(12500, "USD")
  );
  // Passing an (unused, since none of these are REFERENCE) resolveReference must not change
  // any of the above — the third parameter is additive, not a behavior switch for other types.
  assert.equal(
    cellValue({ fieldId: "name", type: "STRING" }, { name: "Harbor Grill" }, { resolveReference: () => "ignored" }),
    "Harbor Grill"
  );
});

// --- the document id stays a legitimate ROUTING key even for a REFERENCE column's own row ---

test("a REFERENCE column never puts the id in a cell, but the row's own routing key (buildRowHref's input) is untouched", () => {
  const acctEntity = makeEntityDefinition({
    id: "invoice", label: "Invoice", collection: "invoices", readVia: "CLIENT_DIRECT",
    identity: makeIdentity({ nameField: "invoiceNumber" }),
    fields: [
      makeFieldDefinition({ id: "invoiceNumber", entityId: "invoice", label: "Invoice #", type: "STRING" }),
      makeFieldDefinition({ id: "accountId", entityId: "invoice", label: "Account", type: "REFERENCE", referenceTo: "account" }),
    ],
  });
  const listDef = makeListViewDefinition({
    id: "invoice.index", entityId: "invoice", label: "Invoices", surface: "INDEX",
    columns: [makeColumn({ fieldId: "accountId" })],
    pageSize: 25,
    rowNavigationTo: "/invoices/:invoiceId",
  });
  const p = buildListPresentation({
    def: listDef,
    entity: acctEntity,
    page: page([{ id: "inv-1", accountId: "acc-1" }]),
  });
  // The ROW's own document id (inv-1) remains the routing key, usable via buildRowHref,
  // completely independent of the REFERENCE column's cell content (acc-1's unresolved state).
  assert.equal(p.rows[0].key, "inv-1");
  for (const cell of p.rows[0].cells) {
    assert.notEqual(cell.value, "inv-1");
    assert.notEqual(cell.value, "acc-1");
  }
});
