// INV-1 Phase 1 PR 1.9 -- client read-view mapper + mirror parity +
// read-only surface proofs. Plain Node (house client-test convention).
import assert from "node:assert/strict";
import fs from "node:fs";
import { toPartView, toPartListView, PART_STATUSES, CONTROL_TYPES, STOCKING_CLASSES, UNIT_CODES } from "../src/domain/partMasterView.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
const GOOD = { partId: "P-1", internalPartNumber: "P-1", name: "Widget", status: "ACTIVE", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED", version: 3, description: "d", category: "c" };

console.log("partMasterView.test.mjs");

check("valid record maps to a complete safe view model", () => {
  const v = toPartView("P-1", GOOD);
  assert.equal(v.invalid, false);
  assert.equal(v.internalPartNumber, "P-1");
  assert.equal(v.version, 3);
});
check("malformed/partial records become structured invalid entries (never raw)", () => {
  for (const bad of [
    undefined, null, {},
    { ...GOOD, partId: "OTHER" }, // id mismatch
    { ...GOOD, status: "NOPE" },
    { ...GOOD, stockingUnit: "PALLET" },
    { ...GOOD, name: 42 },
    { ...GOOD, internalPartNumber: "" },
  ]) {
    const v = toPartView("P-1", bad);
    assert.equal(v.invalid, true);
    assert.equal(v.docId, "P-1");
  }
});
check("missing optional fields render safely (empty strings, version 0)", () => {
  const { description, category, version, ...core } = GOOD;
  const v = toPartView("P-1", core);
  assert.equal(v.invalid, false);
  assert.equal(v.description, "");
  assert.equal(v.category, "");
  assert.equal(v.version, 0);
});
check("list view: stable deterministic sorting; invalid surfaced, not dropped", () => {
  const docs = [
    { id: "B-1", data: { ...GOOD, partId: "B-1", internalPartNumber: "BBB" } },
    { id: "A-1", data: { ...GOOD, partId: "A-1", internalPartNumber: "AAA" } },
    { id: "X-1", data: { bad: true } },
    { id: "A-2", data: { ...GOOD, partId: "A-2", internalPartNumber: "AAA" } },
  ];
  const r1 = toPartListView(docs);
  const r2 = toPartListView(docs);
  assert.deepEqual(r1, r2); // deterministic
  assert.deepEqual(r1.parts.map((p) => p.partId), ["A-1", "A-2", "B-1"]);
  assert.equal(r1.invalid.length, 1);
  assert.deepEqual(toPartListView(undefined), { parts: [], invalid: [] });
});
check("inactive/lifecycle parts remain visible per the approved read policy", () => {
  for (const status of PART_STATUSES) {
    assert.equal(toPartView("P-1", { ...GOOD, status }).invalid, false, status);
  }
});
check("mirror parity: client enums match the server partMaster contract literals", () => {
  const server = fs.readFileSync(new URL("../../functions/src/partMaster/types.ts", import.meta.url), "utf8");
  const mirror = fs.readFileSync(new URL("../src/types/partMaster.ts", import.meta.url), "utf8");
  for (const [name, values] of [
    ["PART_STATUSES", PART_STATUSES],
    ["CONTROL_TYPES", CONTROL_TYPES],
    ["STOCKING_CLASSES", STOCKING_CLASSES],
    ["UNIT_CODES", UNIT_CODES],
  ]) {
    for (const v of values) {
      assert.ok(server.includes(`"${v}"`), `server missing ${name}:${v}`);
      assert.ok(mirror.includes(`"${v}"`), `mirror missing ${name}:${v}`);
    }
  }
  // exact counts guard against additions on one side only:
  assert.equal(PART_STATUSES.length, 5);
  assert.equal(CONTROL_TYPES.length, 4);
  assert.equal(STOCKING_CLASSES.length, 4);
  assert.equal(UNIT_CODES.length, 11);
});
check("read-only surface: no write imports/calls, no write controls, no live-math consumers", () => {
  const svc = fs.readFileSync(new URL("../src/services/partMasterQueries.js", import.meta.url), "utf8");
  for (const bad of ["setDoc", "addDoc", "updateDoc", "deleteDoc", "writeBatch", "runTransaction", "httpsCallable"]) {
    assert.ok(!svc.includes(bad), `service contains ${bad}`);
  }
  const ui = fs.readFileSync(new URL("../src/modules/inventory/PartMasterList.jsx", import.meta.url), "utf8");
  for (const bad of ["setDoc", "addDoc", "updateDoc", "deleteDoc", "writeBatch", "onClick", "<button", "<form", "createPart", "updatePart"]) {
    assert.ok(!ui.includes(bad), `UI contains ${bad}`);
  }
  for (const src of [svc, ui]) {
    for (const bad of ["partReferenceCompatibility", "workOrderSnapshotCompatibility", "analyzePartMasterCsv", "PART_MASTER_REFERENCE", "inventory_transactions"]) {
      assert.ok(!src.includes(bad), `surface references ${bad}`);
    }
  }
});
check("feature flag remains OFF: no client code enables PART_MASTER_REFERENCE", () => {
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.ok(!app.includes("PART_MASTER_REFERENCE"));
});

console.log(`\npartMasterView: ${passed} passed, 0 failed`);
