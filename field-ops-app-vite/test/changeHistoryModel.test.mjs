// THE SHARED CHANGE HISTORY MODEL -- filtering, sorting, and the things it refuses to invent.
//
// domain/changeHistory.js is record-agnostic on purpose: Users is the first surface to mount it,
// and Customers, Equipment, Parts, Work Orders and Purchase Orders mount the same component over
// the same row shape. So the tests below never mention an employee either -- a property that only
// holds for one record type is a property this module should not have.
//
// Run: node --test test/changeHistoryModel.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_FIELDS,
  DEFAULT_SORT,
  HISTORY_SORT_KEY,
  SORT_DIRECTION,
  ariaSortFor,
  filterHistory,
  historyActorOptions,
  historyFieldOptions,
  nextSort,
  normalizeHistoryRow,
  normalizeHistoryRows,
  presentHistory,
  sortHistory,
} from "../src/domain/changeHistory.js";

const FIELD_LABELS = { jobTitle: "Job Title", managerEmployeeId: "Manager" };
const EVENT_LABELS = { setUserStatus: "EOS Access Status", initiateAdminPasswordReset: "Password reset requested" };
const OPTS = { fieldLabels: FIELD_LABELS, eventLabels: EVENT_LABELS };

const day = (iso) => Date.parse(`${iso}T12:00:00`);

const RAW = [
  {
    id: "a",
    occurredAt: day("2026-09-04"),
    eventType: "updateEmployeeProfile",
    outcome: "applied",
    fieldKey: "jobTitle",
    previousValue: "Service Technician",
    newValue: "Senior Service Technician",
    changedById: "u1",
    changedByLabel: "Admin User",
    summary: "x",
  },
  {
    id: "b",
    occurredAt: day("2026-08-20"),
    eventType: "updateEmployeeProfile",
    outcome: "applied",
    fieldKey: "managerEmployeeId",
    previousValue: "Jane Smith",
    newValue: "Mike Jones",
    changedById: "u1",
    changedByLabel: "Admin User",
    summary: "x",
  },
  {
    id: "c",
    occurredAt: day("2026-07-12"),
    eventType: "setUserStatus",
    outcome: "applied",
    fieldKey: null,
    previousValue: null,
    newValue: null,
    changedById: "u2",
    changedByLabel: "Dana Ops",
    summary: "Set account status.",
  },
];

const rows = normalizeHistoryRows(RAW, OPTS);

// ════════════════════ normalization ════════════════════

test("a field change reads as its FIELD; anything else reads as its EVENT", () => {
  assert.equal(rows.find((r) => r.id === "a").fieldLabel, "Job Title");
  assert.equal(rows.find((r) => r.id === "c").fieldLabel, "EOS Access Status");
});

test("an unmapped field key passes through verbatim rather than becoming a placeholder", () => {
  // A field added tomorrow renders as its own token today, and somebody can name it properly later
  // without the screen having lied in the meantime.
  const [row] = normalizeHistoryRows([{ ...RAW[0], fieldKey: "brandNewThing" }], OPTS);
  assert.equal(row.fieldLabel, "brandNewThing");
});

test("an unresolved actor is never shown as a uid", () => {
  const [row] = normalizeHistoryRows([{ ...RAW[0], changedByLabel: null }], OPTS);
  assert.equal(row.changedByLabel, null);
  assert.equal(row.changedById, "u1", "the id is kept for filtering, and is not a display value");
});

test("no credential material can reach a row, because no field carries it", () => {
  // The row model has a fixed shape: id, time, field, values, actor, summary. A reset link, token
  // or password has nowhere to go even if a caller passed one.
  const [row] = normalizeHistoryRows(
    [{ ...RAW[0], oobCode: "SECRET", resetLink: "https://example/x", password: "hunter2" }],
    OPTS,
  );
  assert.deepEqual(Object.keys(row).sort(), [
    "changedById",
    "changedByLabel",
    "eventType",
    "fieldKey",
    "fieldLabel",
    "filterKey",
    "id",
    "newValue",
    "occurredAt",
    "outcome",
    "previousValue",
    "summary",
  ]);
  assert.ok(!JSON.stringify(row).includes("hunter2"));
  assert.ok(!JSON.stringify(row).includes("SECRET"));
});

test("a malformed row is dropped rather than rendered as an empty one", () => {
  assert.deepEqual(normalizeHistoryRows(null, OPTS), []);
  assert.equal(normalizeHistoryRow(undefined, OPTS), null);
});

// ════════════════════ the filter options are DERIVED ════════════════════

test("the Field filter's options come from the rows, never from a hard-coded list", () => {
  const options = historyFieldOptions(rows);
  assert.deepEqual(options.map((o) => o.label), ["EOS Access Status", "Job Title", "Manager"]);

  // The proof that it is derived: a different record's history offers different options, and a
  // record with one kind of event offers exactly one.
  const one = historyFieldOptions(normalizeHistoryRows([RAW[2]], OPTS));
  assert.deepEqual(one.map((o) => o.label), ["EOS Access Status"]);
  assert.equal(historyFieldOptions([]).length, 0, "an empty history offers no filters to nowhere");
});

test("the Changed By options are derived the same way, and an unresolved actor is still selectable", () => {
  assert.deepEqual(historyActorOptions(rows).map((o) => o.label), ["Admin User", "Dana Ops"]);
  const anon = historyActorOptions(normalizeHistoryRows([{ ...RAW[0], changedByLabel: null }], OPTS));
  assert.deepEqual(anon, [{ value: "u1", label: "Unknown user" }]);
});

// ════════════════════ filtering ════════════════════

test("the default is everything", () => {
  assert.equal(filterHistory(rows, {}).length, 3);
  assert.equal(filterHistory(rows, { field: ALL_FIELDS, actor: ALL_FIELDS }).length, 3);
});

test("the Field filter selects one field or one event type", () => {
  assert.deepEqual(filterHistory(rows, { field: "jobTitle" }).map((r) => r.id), ["a"]);
  const statusKey = rows.find((r) => r.id === "c").filterKey;
  assert.deepEqual(filterHistory(rows, { field: statusKey }).map((r) => r.id), ["c"]);
});

test("the Changed By filter selects one actor", () => {
  assert.deepEqual(filterHistory(rows, { actor: "u2" }).map((r) => r.id), ["c"]);
});

test("a date range includes BOTH end days", () => {
  // The bug every date filter ships with once: "from the 20th to the 20th" excluding the 20th.
  assert.deepEqual(filterHistory(rows, { from: "2026-08-20", to: "2026-08-20" }).map((r) => r.id), ["b"]);
  assert.deepEqual(filterHistory(rows, { from: "2026-08-01" }).map((r) => r.id), ["a", "b"]);
  assert.deepEqual(filterHistory(rows, { to: "2026-08-01" }).map((r) => r.id), ["c"]);
});

test("a row with no timestamp survives an unset range and is excluded by a set one", () => {
  // It cannot be PROVEN inside the range, and a filtered view that quietly includes unprovable rows
  // is making a claim it cannot support.
  const withNull = normalizeHistoryRows([...RAW, { ...RAW[0], id: "z", occurredAt: null }], OPTS);
  assert.equal(filterHistory(withNull, {}).length, 4);
  assert.ok(!filterHistory(withNull, { from: "2026-01-01" }).some((r) => r.id === "z"));
});

// ════════════════════ sorting ════════════════════

test("the default is newest first", () => {
  assert.deepEqual(DEFAULT_SORT, { key: HISTORY_SORT_KEY.OCCURRED_AT, direction: SORT_DIRECTION.DESC });
  assert.deepEqual(sortHistory(rows, DEFAULT_SORT).map((r) => r.id), ["a", "b", "c"]);
});

test("every column sorts, in both directions", () => {
  const ids = (key, direction) => sortHistory(rows, { key, direction }).map((r) => r.id);

  assert.deepEqual(ids(HISTORY_SORT_KEY.OCCURRED_AT, SORT_DIRECTION.ASC), ["c", "b", "a"]);
  // Field / Event: "EOS Access Status" < "Job Title" < "Manager".
  assert.deepEqual(ids(HISTORY_SORT_KEY.FIELD, SORT_DIRECTION.ASC), ["c", "a", "b"]);
  assert.deepEqual(ids(HISTORY_SORT_KEY.FIELD, SORT_DIRECTION.DESC), ["b", "a", "c"]);
  // Previous: "Jane Smith" < "Service Technician"; row c has none and sorts last.
  assert.deepEqual(ids(HISTORY_SORT_KEY.PREVIOUS, SORT_DIRECTION.ASC), ["b", "a", "c"]);
  // New: "Mike Jones" < "Senior Service Technician".
  assert.deepEqual(ids(HISTORY_SORT_KEY.NEW, SORT_DIRECTION.ASC), ["b", "a", "c"]);
  // Changed By: "Admin User" < "Dana Ops"; ties fall back to a stable id order.
  assert.deepEqual(ids(HISTORY_SORT_KEY.CHANGED_BY, SORT_DIRECTION.ASC), ["a", "b", "c"]);
});

test("an absent value sorts LAST in BOTH directions", () => {
  // Reversing the comparator would drag the absent rows to the top of a descending sort, which is
  // the opposite of what "sort by previous value" means to somebody scanning for one.
  const last = (direction) =>
    sortHistory(rows, { key: HISTORY_SORT_KEY.PREVIOUS, direction }).at(-1).id;
  assert.equal(last(SORT_DIRECTION.ASC), "c");
  assert.equal(last(SORT_DIRECTION.DESC), "c");
});

test("a first click sorts ascending, a second descending, and after that it toggles", () => {
  let sort = DEFAULT_SORT;
  sort = nextSort(sort, HISTORY_SORT_KEY.FIELD);
  assert.deepEqual(sort, { key: HISTORY_SORT_KEY.FIELD, direction: SORT_DIRECTION.ASC });
  sort = nextSort(sort, HISTORY_SORT_KEY.FIELD);
  assert.equal(sort.direction, SORT_DIRECTION.DESC);
  sort = nextSort(sort, HISTORY_SORT_KEY.FIELD);
  assert.equal(sort.direction, SORT_DIRECTION.ASC);

  // Including Date/Time: the DEFAULT is descending, but a deliberate first click on it is a first
  // click like any other.
  const firstOnDate = nextSort(DEFAULT_SORT, HISTORY_SORT_KEY.OCCURRED_AT);
  assert.equal(firstOnDate.direction, SORT_DIRECTION.ASC);
});

test("aria-sort states what the arrow states, for the column that is actually sorted", () => {
  assert.equal(ariaSortFor(DEFAULT_SORT, HISTORY_SORT_KEY.OCCURRED_AT), "descending");
  assert.equal(ariaSortFor(DEFAULT_SORT, HISTORY_SORT_KEY.FIELD), "none");
  assert.equal(
    ariaSortFor({ key: HISTORY_SORT_KEY.CHANGED_BY, direction: SORT_DIRECTION.ASC }, HISTORY_SORT_KEY.CHANGED_BY),
    "ascending",
  );
});

test("sorting is stable, so two equal rows never swap between renders", () => {
  const equal = normalizeHistoryRows(
    [
      { ...RAW[0], id: "x", changedByLabel: "Same" },
      { ...RAW[0], id: "y", changedByLabel: "Same" },
    ],
    OPTS,
  );
  const once = sortHistory(equal, { key: HISTORY_SORT_KEY.CHANGED_BY, direction: SORT_DIRECTION.ASC });
  const twice = sortHistory(once, { key: HISTORY_SORT_KEY.CHANGED_BY, direction: SORT_DIRECTION.ASC });
  assert.deepEqual(once.map((r) => r.id), twice.map((r) => r.id));
});

// ════════════════════ composition ════════════════════

test("filtering and sorting compose, in that order", () => {
  const out = presentHistory(rows, {
    filters: { actor: "u1" },
    sort: { key: HISTORY_SORT_KEY.OCCURRED_AT, direction: SORT_DIRECTION.ASC },
  });
  assert.deepEqual(out.map((r) => r.id), ["b", "a"]);

  // A filter that matches nothing produces nothing rather than falling back to everything.
  assert.deepEqual(presentHistory(rows, { filters: { field: "nothing" } }), []);
});
