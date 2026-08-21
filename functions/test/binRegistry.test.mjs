// DESCRIPTIVE BIN REGISTRY — the pure identity contract. No emulator, no Firestore.
// Run: node --test test/binRegistry.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  normalizeBinCode, deriveBinDocId, validateBinDraft, resolveBin, isSafeIdSegment, BIN_STATUSES,
} from "../lib/inventoryLocation/binRegistry.js";

const warehouses = new Set(["WH-1", "WH-2"]);
const draft = (over = {}) => ({ warehouseId: "WH-1", code: "A-14", ...over });

// ─────────────────────────────────────────── a bin describes; the warehouse owns

test("the module NEVER produces a BIN location reference", () => {
  // This is the shape that would let a bin leak into custody math. Every governed authority counts
  // a movement only at type === "WAREHOUSE"; a BIN ref reaching one would make put-away stock vanish
  // from sellable on-hand.
  const src = readFileSync(new URL("../src/inventoryLocation/binRegistry.ts", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /type:\s*["']BIN["']/, "a bin must never be emitted as a location type");
  assert.doesNotMatch(code, /locationId/, "a bin is not a location reference");
});

test("a bin carries NO quantity, balance or reservation", () => {
  const src = readFileSync(new URL("../src/inventoryLocation/binRegistry.ts", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const forbidden of [/quantity/i, /onHand/i, /reserved/i, /balance/i, /ledger/i]) {
    assert.doesNotMatch(code, forbidden, `a descriptive bin must not carry ${forbidden}`);
  }
});

test("a valid bin is exactly identity — warehouse, code, name, status", () => {
  const r = validateBinDraft(draft({ name: "Bulk rack, north wall" }), warehouses);
  assert.equal(r.valid, true);
  assert.deepEqual(Object.keys(r.value).sort(), ["code", "name", "originalCode", "status", "warehouseId"]);
});

// ─────────────────────────────────────────── duplicates are structurally impossible

test("the same code in the same warehouse is the SAME document", () => {
  // A uniqueness check could race; a derived id cannot.
  assert.equal(deriveBinDocId("WH-1", "A-14"), deriveBinDocId("WH-1", "A-14"));
});

test("the same code in a DIFFERENT warehouse is a different bin — that is how racking is labelled", () => {
  assert.notEqual(deriveBinDocId("WH-1", "A-14"), deriveBinDocId("WH-2", "A-14"));
});

test("codes differing only by case or spacing normalize to ONE bin", () => {
  // Treating "a-14" and "A-14" as two bins would split a shelf in half in the data.
  const a = normalizeBinCode(" a-14 ");
  const b = normalizeBinCode("A- 14");
  assert.equal(a.value.code, "A-14");
  assert.equal(b.value.code, "A-14");
  assert.equal(deriveBinDocId("WH-1", a.value.code), deriveBinDocId("WH-1", b.value.code));
});

test("what was TYPED is preserved, so a label can be reprinted as it reads", () => {
  const r = validateBinDraft(draft({ code: " a-14 " }), warehouses);
  assert.equal(r.value.code, "A-14");
  assert.equal(r.value.originalCode, "a-14");
});

// ─────────────────────────────────────────── validation fails closed

test("a bin in an UNKNOWN warehouse is refused — it would be a place nobody can go", () => {
  const r = validateBinDraft(draft({ warehouseId: "WH-NOWHERE" }), warehouses);
  assert.equal(r.valid, false);
  assert.equal(r.reason, "warehouse_unknown");
});

test("an unsafe warehouse id is refused before it can become part of a document id", () => {
  for (const bad of ["../escape", "WH 1", "", "WH/1", null, 42]) {
    assert.equal(isSafeIdSegment(bad), false, `${String(bad)} must not be an id segment`);
    assert.equal(validateBinDraft(draft({ warehouseId: bad }), warehouses).valid, false);
  }
});

test("an unsupported character is REFUSED, never stripped", () => {
  // Silently deleting a character produces a code that will never match the label on the wall.
  for (const bad of ["A/14", "A#14", "A@14", "-A14"]) {
    assert.equal(normalizeBinCode(bad).valid, false, `${bad} must be refused`);
  }
});

test("an empty or missing code is refused", () => {
  for (const bad of ["", "   ", null, undefined, 7]) {
    assert.equal(normalizeBinCode(bad).valid, false);
  }
});

test("an over-long code is refused rather than truncated", () => {
  assert.equal(normalizeBinCode("A".repeat(33)).valid, false);
  assert.equal(normalizeBinCode("A".repeat(32)).valid, true);
});

test("a name is optional, trimmed, bounded, and never used for matching", () => {
  assert.equal(validateBinDraft(draft(), warehouses).value.name, null);
  assert.equal(validateBinDraft(draft({ name: "  Rack 4  " }), warehouses).value.name, "Rack 4");
  assert.equal(validateBinDraft(draft({ name: "" }), warehouses).value.name, null);
  assert.equal(validateBinDraft(draft({ name: "x".repeat(121) }), warehouses).valid, false);
  assert.equal(validateBinDraft(draft({ name: 42 }), warehouses).valid, false);
});

test("a new bin is always created ACTIVE", () => {
  assert.equal(validateBinDraft(draft({ status: "INACTIVE" }), warehouses).value.status, "ACTIVE");
});

test("a non-object draft is refused", () => {
  for (const bad of [null, undefined, [], "bin", 3]) {
    assert.equal(validateBinDraft(bad, warehouses).valid, false);
  }
});

// ─────────────────────────────────────────── resolving a scanned bin

const stored = (over = {}) => ({ warehouseId: "WH-1", code: "A-14", status: "ACTIVE", ...over });

test("a real, active bin at this warehouse resolves", () => {
  const r = resolveBin("A-14", "WH-1", stored());
  assert.equal(r.result, "FOUND");
  assert.equal(r.code, "A-14");
});

test("a scanned code resolves regardless of case and spacing", () => {
  assert.equal(resolveBin(" a-14 ", "WH-1", stored()).result, "FOUND");
});

test("WRONG WAREHOUSE is its own answer — the operator is in the wrong building", () => {
  // Different problem from a code nobody registered, and the one an operator most needs told plainly.
  const r = resolveBin("A-14", "WH-2", stored({ warehouseId: "WH-1" }));
  assert.equal(r.result, "WRONG_WAREHOUSE");
  assert.equal(r.warehouseId, "WH-1");
});

test("a RETIRED bin is INACTIVE, never NOT_FOUND", () => {
  // "Registered but retired" and "never registered" call for opposite fixes.
  const r = resolveBin("A-14", "WH-1", stored({ status: "INACTIVE" }));
  assert.equal(r.result, "INACTIVE");
});

test("an UNRECOGNIZED status fails closed as inactive, never as usable", () => {
  for (const status of ["SOMETHING", undefined, null, 5]) {
    assert.equal(resolveBin("A-14", "WH-1", stored({ status })).result, "INACTIVE");
  }
});

test("an unregistered code is NOT_FOUND", () => {
  assert.equal(resolveBin("Z-99", "WH-1", null).result, "NOT_FOUND");
});

test("an unreadable stored record is MALFORMED, never treated as a usable bin", () => {
  for (const bad of [stored({ warehouseId: 5 }), stored({ code: null })]) {
    assert.equal(resolveBin("A-14", "WH-1", bad).result, "MALFORMED");
  }
});

test("a malformed scanned code is MALFORMED before the store is even consulted", () => {
  const r = resolveBin("A/14", "WH-1", stored());
  assert.equal(r.result, "MALFORMED");
});

test("the status vocabulary is exactly two, and nothing is ever deleted", () => {
  assert.deepEqual([...BIN_STATUSES], ["ACTIVE", "INACTIVE"]);
});
