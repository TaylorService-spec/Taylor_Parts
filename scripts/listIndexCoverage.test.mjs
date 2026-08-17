// List index coverage — offline tests.
//
// The rule under test is "metadata must not promise filter combinations the backend
// cannot serve". Until this script existed, that rule was enforced only for definitions
// somebody thought to check by hand. These assert the mechanism actually catches the case
// it exists for, and — just as important — that it cannot report success while idle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { findUncoveredDemands, reportCoverage, describeIndex, REGISTERED_LIST_DEMANDS } from "./listIndexCoverage.mjs";

const demand = (over = {}) => ({
  collectionGroup: "accounts",
  queryScope: "COLLECTION",
  fields: [
    { fieldPath: "status", order: "ASC" },
    { fieldPath: "updatedAt", order: "DESC" },
    { fieldPath: "__name__", order: "ASC" },
  ],
  requiredBy: "account.index",
  ...over,
});

const declaredMatching = {
  collectionGroup: "accounts",
  queryScope: "COLLECTION",
  fields: [
    { fieldPath: "status", order: "ASC" },
    { fieldPath: "updatedAt", order: "DESC" },
  ],
};

test("a demand with no declared index is reported, with the list that caused it", () => {
  const [uncovered] = findUncoveredDemands([demand()], []);
  assert.ok(uncovered, "the demand is uncovered");
  assert.equal(uncovered.requiredBy, "account.index", "an actionable failure names the list, not just the index");
});

test("a matching declared index covers the demand despite the implicit __name__", () => {
  // The subtle rule this reuses rather than re-derives: Firestore appends __name__
  // itself, so a declared index never lists it. Comparing naively would report every
  // index as missing and the whole check would be noise from day one.
  assert.deepEqual(findUncoveredDemands([demand()], [declaredMatching]), []);
});

test("field ORDER is part of identity — a same-fields index with the wrong direction does not cover", () => {
  const wrongDirection = {
    ...declaredMatching,
    fields: [
      { fieldPath: "status", order: "ASC" },
      { fieldPath: "updatedAt", order: "ASC" },
    ],
  };
  assert.equal(findUncoveredDemands([demand()], [wrongDirection]).length, 1);
});

test("field ORDERING is part of identity — the same fields transposed do not cover", () => {
  const transposed = {
    ...declaredMatching,
    fields: [
      { fieldPath: "updatedAt", order: "DESC" },
      { fieldPath: "status", order: "ASC" },
    ],
  };
  assert.equal(findUncoveredDemands([demand()], [transposed]).length, 1);
});

test("an index on another collection does not cover", () => {
  const otherCollection = { ...declaredMatching, collectionGroup: "fieldops_wos" };
  assert.equal(findUncoveredDemands([demand()], [otherCollection]).length, 1);
});

test("reportCoverage separates covered from uncovered rather than returning a boolean", () => {
  const report = reportCoverage({
    demands: [demand(), demand({ collectionGroup: "parts", requiredBy: "parts.index" })],
    declared: [declaredMatching],
  });
  assert.equal(report.demandCount, 2);
  assert.equal(report.covered, 1);
  assert.equal(report.uncovered.length, 1);
  assert.equal(report.uncovered[0].requiredBy, "parts.index");
});

test("IDLE IS NOT PASSING — no registered definitions reports zero demands, not success", () => {
  // The failure mode this guards: a check that reports green while checking nothing. The
  // registry is empty today because no ListViewDefinition has been authored for a real
  // surface yet, and the script says so explicitly rather than printing a clean result
  // that reads as coverage.
  assert.deepEqual(REGISTERED_LIST_DEMANDS, []);
  const report = reportCoverage({ demands: REGISTERED_LIST_DEMANDS, declared: [declaredMatching] });
  assert.equal(report.demandCount, 0);
  assert.equal(report.covered, 0, "zero covered, not 'all covered'");
  assert.deepEqual(report.uncovered, []);
});

test("describeIndex renders a shape a reader can act on without tooling", () => {
  assert.equal(describeIndex(demand()), "accounts: status ASC, updatedAt DESC, __name__ ASC");
});

test("an array-config index is described without crashing on the missing order", () => {
  const arrayIndex = {
    collectionGroup: "accounts",
    fields: [{ fieldPath: "tags", arrayConfig: "CONTAINS" }, { fieldPath: "name", order: "ASC" }],
  };
  assert.equal(describeIndex(arrayIndex), "accounts: tags CONTAINS, name ASC");
});
