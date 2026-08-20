// Account portfolio summary — the aggregate contract.
//
// What is under test is not "does it add up". It is that the summary cannot report a
// partial number under a name that means complete, and cannot silently drop a record
// whose status nobody predicted.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assembleSummary,
  readPortfolioSummary,
  ACCOUNT_STATUS_VALUES,
  ACCOUNT_PORTFOLIO_READ_CAPABILITY,
} from "../lib/account/accountPortfolioSummary.js";

/** A Firestore double that records the queries it was asked for. */
function fakeDb(counts, { onQuery } = {}) {
  const make = (status) => ({
    count: () => ({ get: async () => ({ data: () => ({ count: status === null ? counts.total : counts[status] ?? 0 }) }) }),
    where: (field, op, value) => {
      onQuery?.({ field, op, value });
      return make(value);
    },
    // Present so a test can prove they are never called: reading documents to count them
    // is the failure this module exists to avoid.
    get: async () => { throw new Error("readPortfolioSummary must not read documents"); },
    limit: () => { throw new Error("an aggregate must not bound its input"); },
    startAfter: () => { throw new Error("an aggregate must not paginate"); },
  });
  return { collection: () => make(null) };
}

test("canonical statuses are uppercase machine values", () => {
  // A title-cased value here would make every count silently miss the real records.
  for (const s of ACCOUNT_STATUS_VALUES) assert.equal(s, s.toUpperCase());
  assert.deepEqual([...ACCOUNT_STATUS_VALUES], ["ACTIVE", "PROSPECT", "INACTIVE", "ARCHIVED"]);
});

test("it authorizes with the canonical Account read authority, not a new one", () => {
  // A separate capability would create a second audience for the same data, and the two
  // would drift the first time somebody granted one without the other.
  assert.equal(ACCOUNT_PORTFOLIO_READ_CAPABILITY, "account.record.read");
});

test("total is not the sum of the statuses — that is the whole point", () => {
  // Deriving total by summing would make the two agree by construction and destroy the
  // only signal that says a record is unaccounted for.
  const summary = assembleSummary(10, { ACTIVE: 4, PROSPECT: 2, INACTIVE: 1, ARCHIVED: 0 });
  assert.equal(summary.total, 10);
  assert.equal(summary.unclassified, 3);
});

test("a legacy title-cased status is REPORTED, not absorbed", () => {
  // The production status audit is still open. A record stored as "Active" matches no
  // canonical count; it must surface as a number a reader can see rather than vanish
  // from a total that still calls itself complete.
  const summary = assembleSummary(5, { ACTIVE: 4 });
  assert.equal(summary.unclassified, 1);
});

test("a clean book of business reports nothing unclassified", () => {
  const summary = assembleSummary(7, { ACTIVE: 4, PROSPECT: 2, INACTIVE: 1, ARCHIVED: 0 });
  assert.equal(summary.unclassified, 0);
});

test("every canonical status is present even at zero", () => {
  // An absent key would let a surface render "—" where the true answer is "0".
  const summary = assembleSummary(0, {});
  assert.deepEqual(Object.keys(summary.byStatus).sort(), [...ACCOUNT_STATUS_VALUES].sort());
  for (const s of ACCOUNT_STATUS_VALUES) assert.equal(summary.byStatus[s], 0);
});

test("a shrinking collection between counts cannot produce a negative", () => {
  // Independent counts are read at slightly different instants. "-2 unclassified" would
  // be nonsense presented as a finding.
  assert.equal(assembleSummary(3, { ACTIVE: 4 }).unclassified, 0);
});

test("it counts server-side and never reads documents or bounds the input", async () => {
  const summary = await readPortfolioSummary(fakeDb({ total: 9, ACTIVE: 5, PROSPECT: 2, INACTIVE: 1, ARCHIVED: 0 }));
  assert.equal(summary.total, 9);
  assert.equal(summary.byStatus.ACTIVE, 5);
  assert.equal(summary.unclassified, 1);
});

test("it filters on the canonical status field with equality, once per status", async () => {
  const queries = [];
  await readPortfolioSummary(fakeDb({ total: 0 }, { onQuery: (q) => queries.push(q) }));
  assert.equal(queries.length, ACCOUNT_STATUS_VALUES.length);
  for (const q of queries) {
    assert.equal(q.field, "status");
    assert.equal(q.op, "==");
  }
  assert.deepEqual(queries.map((q) => q.value).sort(), [...ACCOUNT_STATUS_VALUES].sort());
});
