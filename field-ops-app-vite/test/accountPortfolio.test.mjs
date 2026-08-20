// Customer Results Dashboard -- deterministic unit tests for the pure
// summary / filter / display helpers in src/domain/accountPortfolio.js.
// Run: node test/accountPortfolio.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  summarizeAccounts,
  filterAccounts,
  collectTags,
  hasActiveFilters,
  formatLastUpdate,
  accountPassesFilters,
  clearedFiltersForAccount,
  accountSaveErrorMessage,
} from "../src/domain/accountPortfolio.js";
import { ACCOUNT_STATUS, ACCOUNT_STATUS_LABEL, accountStatusLabel, ACCOUNT_RELATIONSHIP_TYPE } from "../src/domain/constants.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const A = ACCOUNT_STATUS, R = ACCOUNT_RELATIONSHIP_TYPE;
const accounts = [
  { id: "a1", name: "Alpha", status: A.ACTIVE, relationshipTypes: [R.CUSTOMER], tags: ["VIP", "Chain"] },
  { id: "a2", name: "Bravo", status: A.ACTIVE, relationshipTypes: [R.CUSTOMER, R.VENDOR], tags: ["Chain"] },
  { id: "a3", name: "Charlie", status: A.PROSPECT, relationshipTypes: [R.VENDOR], tags: [] },
  { id: "a4", name: "Delta", status: A.INACTIVE, relationshipTypes: [], tags: ["VIP"] },
  { id: "a5", name: "Echo", status: A.ARCHIVED },
  { id: "a6", name: "Foxtrot", status: "Weird/unknown" }, // unrecognized status
  { id: "a7", name: "Golf" }, // no status at all
];

// --- summarizeAccounts ---
ok("summary: counts by status + total; unknown/absent status only in total", () => {
  const s = summarizeAccounts(accounts);
  assert.deepEqual(s, { total: 7, active: 2, prospect: 1, inactive: 1, archived: 1 });
  // a6 (unknown) and a7 (absent) are in total (7) but no status bucket.
});
ok("summary: empty input -> all zero, total 0", () => {
  assert.deepEqual(summarizeAccounts([]), { total: 0, active: 0, prospect: 0, inactive: 0, archived: 0 });
});

// --- filterAccounts ---
ok("filter: no filters -> all accounts", () => {
  assert.equal(filterAccounts(accounts, {}).length, accounts.length);
});
ok("filter: by status", () => {
  assert.deepEqual(filterAccounts(accounts, { status: A.ACTIVE }).map((a) => a.id), ["a1", "a2"]);
});
ok("filter: relationshipTypes uses AND semantics (must have ALL selected)", () => {
  assert.deepEqual(filterAccounts(accounts, { relationshipTypes: [R.CUSTOMER] }).map((a) => a.id), ["a1", "a2"]);
  assert.deepEqual(filterAccounts(accounts, { relationshipTypes: [R.CUSTOMER, R.VENDOR] }).map((a) => a.id), ["a2"]);
});
ok("filter: tags use ANY semantics (at least one selected tag)", () => {
  assert.deepEqual(filterAccounts(accounts, { tags: ["VIP"] }).map((a) => a.id), ["a1", "a4"]);
  assert.deepEqual(filterAccounts(accounts, { tags: ["VIP", "Chain"] }).map((a) => a.id).sort(), ["a1", "a2", "a4"]);
});
ok("filter: combined status + relationship + tag", () => {
  assert.deepEqual(filterAccounts(accounts, { status: A.ACTIVE, relationshipTypes: [R.CUSTOMER], tags: ["Chain"] }).map((a) => a.id), ["a1", "a2"]);
  assert.deepEqual(filterAccounts(accounts, { status: A.ACTIVE, tags: ["VIP"] }).map((a) => a.id), ["a1"]);
});
ok("filter: filtered-no-results yields an empty array (not an error)", () => {
  assert.deepEqual(filterAccounts(accounts, { status: A.ARCHIVED, tags: ["VIP"] }), []);
});

// --- collectTags ---
ok("collectTags: distinct, sorted, blanks ignored", () => {
  assert.deepEqual(collectTags(accounts), ["Chain", "VIP"]);
  assert.deepEqual(collectTags([{ tags: ["b", "a", "a", ""] }, { tags: null }, {}]), ["a", "b"]);
});

// --- hasActiveFilters ---
ok("hasActiveFilters: true when any set, false when none", () => {
  assert.equal(hasActiveFilters({}), false);
  assert.equal(hasActiveFilters({ status: A.ACTIVE }), true);
  assert.equal(hasActiveFilters({ relationshipTypes: [R.VENDOR] }), true);
  assert.equal(hasActiveFilters({ tags: ["VIP"] }), true);
  assert.equal(hasActiveFilters({ status: null, relationshipTypes: [], tags: [] }), false);
});

// --- formatLastUpdate (deterministic given `now`) ---
const NOW = 1_700_000_000_000;
ok("formatLastUpdate: epoch-ms relative buckets", () => {
  assert.equal(formatLastUpdate(NOW - 5_000, NOW), "just now");
  assert.equal(formatLastUpdate(NOW - 60_000, NOW), "1 minute ago");
  assert.equal(formatLastUpdate(NOW - 5 * 60_000, NOW), "5 minutes ago");
  assert.equal(formatLastUpdate(NOW - 3 * 3_600_000, NOW), "3 hours ago");
  assert.equal(formatLastUpdate(NOW - 2 * 86_400_000, NOW), "2 days ago");
  assert.equal(formatLastUpdate(NOW - 45 * 86_400_000, NOW), "1 month ago");
  assert.equal(formatLastUpdate(NOW - 400 * 86_400_000, NOW), "1 year ago");
});
ok("formatLastUpdate: absent/unparseable -> 'Unknown'", () => {
  assert.equal(formatLastUpdate(undefined, NOW), "Unknown");
  assert.equal(formatLastUpdate(null, NOW), "Unknown");
  assert.equal(formatLastUpdate(NaN, NOW), "Unknown");
  assert.equal(formatLastUpdate("not a date", NOW), "Unknown");
});
ok("formatLastUpdate: tolerant of Firestore Timestamp + ISO string", () => {
  assert.equal(formatLastUpdate({ toMillis: () => NOW - 2 * 3_600_000 }, NOW), "2 hours ago");
  assert.equal(formatLastUpdate({ seconds: (NOW - 86_400_000) / 1000 }, NOW), "1 day ago");
  assert.equal(formatLastUpdate(new Date(NOW - 3 * 60_000).toISOString(), NOW), "3 minutes ago");
});

// ===== Customer Creation Overlay -- filter clearing + save-error mapping =====
const newProspectCustomer = { id: "new1", name: "New Co", status: A.PROSPECT, relationshipTypes: [R.CUSTOMER], tags: ["Fresh"] };

ok("accountPassesFilters: matches when filters align", () => {
  assert.equal(accountPassesFilters(newProspectCustomer, { status: A.PROSPECT }), true);
  assert.equal(accountPassesFilters(newProspectCustomer, { status: A.ARCHIVED }), false);
  assert.equal(accountPassesFilters(newProspectCustomer, { relationshipTypes: [R.VENDOR] }), false);
  assert.equal(accountPassesFilters(newProspectCustomer, { tags: ["Fresh"] }), true);
});

ok("clearedFiltersForAccount: clears a status filter that would hide the new account", () => {
  const next = clearedFiltersForAccount(newProspectCustomer, { status: A.ARCHIVED, relationshipTypes: [], tags: [] });
  assert.equal(next.status, null);
});
ok("clearedFiltersForAccount: keeps a status filter that already matches", () => {
  const next = clearedFiltersForAccount(newProspectCustomer, { status: A.PROSPECT, relationshipTypes: [], tags: [] });
  assert.equal(next.status, A.PROSPECT);
});
ok("clearedFiltersForAccount: clears a relationship filter not fully present (AND)", () => {
  const next = clearedFiltersForAccount(newProspectCustomer, { status: null, relationshipTypes: [R.CUSTOMER, R.VENDOR], tags: [] });
  assert.deepEqual(next.relationshipTypes, []);
});
ok("clearedFiltersForAccount: keeps a relationship filter fully present", () => {
  const next = clearedFiltersForAccount(newProspectCustomer, { status: null, relationshipTypes: [R.CUSTOMER], tags: [] });
  assert.deepEqual(next.relationshipTypes, [R.CUSTOMER]);
});
ok("clearedFiltersForAccount: clears a tag filter sharing none (ANY); keeps one it shares", () => {
  assert.deepEqual(clearedFiltersForAccount(newProspectCustomer, { status: null, relationshipTypes: [], tags: ["Other"] }).tags, []);
  assert.deepEqual(clearedFiltersForAccount(newProspectCustomer, { status: null, relationshipTypes: [], tags: ["Fresh"] }).tags, ["Fresh"]);
});
ok("clearedFiltersForAccount: only hiding dimensions are cleared, others intact", () => {
  // status matches (kept), relationship missing VENDOR (cleared), tag matches (kept)
  const next = clearedFiltersForAccount(newProspectCustomer, { status: A.PROSPECT, relationshipTypes: [R.VENDOR], tags: ["Fresh"] });
  assert.equal(next.status, A.PROSPECT);
  assert.deepEqual(next.relationshipTypes, []);
  assert.deepEqual(next.tags, ["Fresh"]);
  // Result: the new account now passes the reduced filter set.
  assert.equal(accountPassesFilters(newProspectCustomer, next), true);
});

ok("accountSaveErrorMessage: permission-denied -> authorization message", () => {
  assert.match(accountSaveErrorMessage({ code: "permission-denied" }), /permission/i);
  assert.match(accountSaveErrorMessage({ code: "firestore/permission-denied" }), /permission/i);
});
ok("accountSaveErrorMessage: blocked write -> disabled-mode message", () => {
  assert.match(accountSaveErrorMessage({ blocked: true }), /disabled/i);
});
ok("accountSaveErrorMessage: generic error -> retry message, no raw detail", () => {
  const msg = accountSaveErrorMessage({ code: "unavailable", message: "RAW-DETAIL-xyz" });
  assert.match(msg, /try again/i);
  assert.ok(!msg.includes("RAW-DETAIL-xyz"));
});
ok("accountSaveErrorMessage: null error -> generic retry message", () => {
  assert.match(accountSaveErrorMessage(null), /try again/i);
});

// #1093 regression. The portfolio cards reported "0 Active" beside a table of rows each
// showing an ACTIVE pill, and clicking Active filtered the list to nothing, because the enum
// held presentation casing ("Active") while persisted documents hold "ACTIVE". These assert
// against the canonical enum rather than any literal, so the two can never drift apart again.
ok("#1093 -- canonical machine values are uppercase, matching persisted documents", () => {
  assert.equal(ACCOUNT_STATUS.ACTIVE, "ACTIVE");
  assert.equal(ACCOUNT_STATUS.PROSPECT, "PROSPECT");
  assert.equal(ACCOUNT_STATUS.INACTIVE, "INACTIVE");
  assert.equal(ACCOUNT_STATUS.ARCHIVED, "ARCHIVED");
  for (const v of Object.values(ACCOUNT_STATUS)) {
    assert.equal(v, v.toUpperCase(), `${v} must be a machine value, not a label`);
  }
});

ok("#1093 -- display labels are a separate concept and are never the stored value", () => {
  assert.equal(accountStatusLabel(ACCOUNT_STATUS.ACTIVE), "Active");
  for (const [value, label] of Object.entries(ACCOUNT_STATUS_LABEL)) {
    assert.notEqual(value, label, "a label that equals its machine value has re-merged the two concepts");
  }
});

ok("#1093 -- an unknown status is returned verbatim, never relabelled to a default", () => {
  // Silently mapping an unrecognized value to a friendly default would hide precisely the
  // data mismatch this issue was.
  assert.equal(accountStatusLabel("SOMETHING_ELSE"), "SOMETHING_ELSE");
  assert.equal(accountStatusLabel(undefined), "");
});

ok("#1093 -- counts and filters agree with documents as they are actually stored", () => {
  const stored = [
    { id: "a", status: "ACTIVE" },
    { id: "b", status: "ACTIVE" },
    { id: "c", status: "PROSPECT" },
  ];
  const summary = summarizeAccounts(stored);
  assert.equal(summary.total, 3);
  assert.equal(summary.active, 2, "the count must match what the rows visibly say");
  assert.equal(summary.prospect, 1);

  const filtered = filterAccounts(stored, { status: ACCOUNT_STATUS.ACTIVE });
  assert.equal(filtered.length, 2, "clicking the Active card must not empty the table");
});

console.log(`\n${passed} passed, 0 failed`);
