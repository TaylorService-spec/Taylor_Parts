// INV-EQ-P1b -- tests for the pure cross-customer installed-Equipment list view-model.
// Proves fail-closed doc validation, distinct id collection, LOADED-ONLY filters
// (account equality + delegated term/location/status via searchEquipment), name
// resolution (unresolved -> null, never the id), and the coarse render-state derivation.
//
// Run: node test/installedEquipmentListView.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  LIST_STATE,
  LOADED_ONLY_FILTER_NOTE,
  isValidEquipmentDoc,
  validEquipmentDocs,
  collectAccountIds,
  collectLocationIds,
  applyLoadedFilters,
  composeEquipmentRows,
  buildInstalledEquipmentRows,
  deriveListState,
} from "../src/domain/installedEquipmentListView.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const DOCS = [
  { id: "e1", accountId: "a1", locationId: "l1", name: "RTU 1", status: "ACTIVE", serialNumber: "SN1" },
  { id: "e2", accountId: "a1", locationId: "l2", name: "RTU 2", status: "INACTIVE" },
  { id: "e3", accountId: "a2", name: "Boiler", status: "ACTIVE" },
  { id: "", accountId: "a2" }, // malformed (no id)
  { accountId: "a3" }, // malformed (no id)
  null, // malformed
];

ok("filter note is present and non-empty", () => {
  assert.ok(typeof LOADED_ONLY_FILTER_NOTE === "string" && /loaded/i.test(LOADED_ONLY_FILTER_NOTE));
});

ok("isValidEquipmentDoc / validEquipmentDocs are fail-closed", () => {
  assert.strictEqual(isValidEquipmentDoc({ id: "x", accountId: "a" }), true);
  assert.strictEqual(isValidEquipmentDoc({ id: "x" }), false);
  assert.strictEqual(isValidEquipmentDoc({ accountId: "a" }), false);
  assert.strictEqual(isValidEquipmentDoc(null), false);
  assert.strictEqual(isValidEquipmentDoc([]), false);
  assert.deepStrictEqual(validEquipmentDocs(DOCS).map((d) => d.id), ["e1", "e2", "e3"]);
  assert.deepStrictEqual(validEquipmentDocs("nope"), []);
});

ok("collectAccountIds / collectLocationIds are distinct and skip missing", () => {
  assert.deepStrictEqual(collectAccountIds(DOCS), ["a1", "a2"]);
  assert.deepStrictEqual(collectLocationIds(DOCS), ["l1", "l2"]); // e3 has none
});

ok("applyLoadedFilters: no filters returns all valid docs", () => {
  const out = applyLoadedFilters(DOCS, {});
  assert.deepStrictEqual(out.map((d) => d.id).sort(), ["e1", "e2", "e3"]);
});
ok("applyLoadedFilters: accountId equality filter (loaded-only)", () => {
  assert.deepStrictEqual(applyLoadedFilters(DOCS, { accountId: "a1" }).map((d) => d.id).sort(), ["e1", "e2"]);
  assert.deepStrictEqual(applyLoadedFilters(DOCS, { accountId: "a2" }).map((d) => d.id), ["e3"]);
});
ok("applyLoadedFilters: location + status delegated to searchEquipment", () => {
  assert.deepStrictEqual(applyLoadedFilters(DOCS, { locationId: "l1" }).map((d) => d.id), ["e1"]);
  assert.deepStrictEqual(applyLoadedFilters(DOCS, { status: "ACTIVE" }).map((d) => d.id).sort(), ["e1", "e3"]);
});
ok("applyLoadedFilters: a malformed status returns nothing (fail closed, never broadened)", () => {
  assert.deepStrictEqual(applyLoadedFilters(DOCS, { status: "bogus" }), []);
});
ok("applyLoadedFilters: term narrows within loaded docs", () => {
  assert.deepStrictEqual(applyLoadedFilters(DOCS, { term: "Boiler" }).map((d) => d.id), ["e3"]);
});

ok("composeEquipmentRows resolves names (Map / object / id fallback) + safe fields", () => {
  const accountNames = new Map([["a1", "Acme"]]);
  const locationNames = { l1: "Roof" };
  const rows = composeEquipmentRows(DOCS, { accountNames, locationNames });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.strictEqual(byId.e1.accountName, "Acme");
  assert.strictEqual(byId.e1.locationName, "Roof");
  assert.strictEqual(byId.e1.status, "ACTIVE");
  assert.strictEqual(byId.e1.serialNumber, "SN1");
  assert.strictEqual(byId.e2.accountName, "Acme");
  // Unresolved is null, not the id. "Never blank" was the wrong goal: a blank cell says
  // "unknown", while an id says something false about the record.
  assert.strictEqual(byId.e2.locationName, null);
  // An unresolved account is null, NOT the id. DECISIONS #106 has no "unless nothing else
  // is available" clause; the caller renders an honest placeholder instead.
  assert.strictEqual(byId.e3.accountName, null);
  assert.strictEqual(byId.e3.locationName, null); // no location
  assert.ok(!rows.some((r) => r.id === "")); // malformed never composed
});

ok("buildInstalledEquipmentRows filters then composes", () => {
  const { rows } = buildInstalledEquipmentRows(DOCS, { filters: { accountId: "a1" }, accountNames: new Map([["a1", "Acme"]]) });
  assert.deepStrictEqual(rows.map((r) => r.id).sort(), ["e1", "e2"]);
  assert.ok(rows.every((r) => r.accountName === "Acme"));
});

ok("deriveListState covers every branch in fail-closed order", () => {
  assert.strictEqual(deriveListState({ denied: true, loading: true, docsCount: 5 }), LIST_STATE.DENIED);
  assert.strictEqual(deriveListState({ loading: true, docsCount: 0 }), LIST_STATE.LOADING);
  assert.strictEqual(deriveListState({ error: true, docsCount: 0 }), LIST_STATE.UNAVAILABLE);
  assert.strictEqual(deriveListState({ docsCount: 0 }), LIST_STATE.EMPTY); // loaded nothing
  assert.strictEqual(deriveListState({ docsCount: 5, filteredCount: 0 }), LIST_STATE.EMPTY); // filters exclude all
  assert.strictEqual(deriveListState({ docsCount: 5, filteredCount: 3, partialError: true }), LIST_STATE.PARTIAL);
  assert.strictEqual(deriveListState({ docsCount: 5, filteredCount: 3 }), LIST_STATE.READY);
  // loading a LATER page while rows are already shown stays READY (not LOADING)
  assert.strictEqual(deriveListState({ loading: true, docsCount: 5, filteredCount: 5 }), LIST_STATE.READY);
});

console.log(`\n${passed} passed`);
