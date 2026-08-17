// List index coverage — offline tests.
//
// The rule under test is "metadata must not promise filter combinations the backend
// cannot serve". Until this script existed, that rule was enforced only for definitions
// somebody thought to check by hand. These assert the mechanism actually catches the case
// it exists for, and — just as important — that it cannot report success while idle.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  findUncoveredDemands,
  reportCoverage,
  describeIndex,
  REGISTERED_LIST_DEMANDS,
  findAuthoredDefinitions,
  findUnregisteredDefinitions,
} from "./listIndexCoverage.mjs";

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

// --- registration completeness -------------------------------------------------
//
// A definition nobody registered is invisible to the coverage check, and an invisible
// definition is indistinguishable from a covered one. These assert the gate notices.

const withTree = (files, fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "listcov-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, "utf8");
  }
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test("a file that authors a list definition is found", () => {
  const found = withTree(
    { "crm/accountList.js": "const def = makeListViewDefinition({ id: 'account.index' });\n" },
    (root) => findAuthoredDefinitions(root)
  );
  assert.equal(found.length, 1);
  assert.ok(found[0].endsWith("crm/accountList.js"), found[0]);
});

test("a file that merely mentions lists is not mistaken for a definition", () => {
  const found = withTree(
    { "crm/notes.js": "// see makeListViewDefinition docs; this file declares nothing\n" },
    (root) => findAuthoredDefinitions(root)
  );
  // The scan matches the CALL, not the name: a doc comment is not a definition.
  assert.deepEqual(found, []);
});

test("non-source files are not scanned", () => {
  const found = withTree(
    { "crm/list.md": "makeListViewDefinition(\n" },
    (root) => findAuthoredDefinitions(root)
  );
  assert.deepEqual(found, []);
});

test("an authored definition that nobody registered is reported", () => {
  const unregistered = findUnregisteredDefinitions(["src/crm/accountList.js"], []);
  assert.deepEqual(unregistered, ["src/crm/accountList.js"]);
});

test("a registered definition is not reported", () => {
  const unregistered = findUnregisteredDefinitions(["src/crm/accountList.js"], ["src/crm/accountList.js"]);
  assert.deepEqual(unregistered, []);
});

test("the repository currently authors no unregistered definitions", () => {
  // Guards the real tree, not a fixture: this is the assertion that fails when someone
  // adds the first definition and forgets to register it.
  assert.deepEqual(findUnregisteredDefinitions(findAuthoredDefinitions()), []);
});
