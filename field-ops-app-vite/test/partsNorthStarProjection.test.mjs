// Parts North Star P1 — the projection widening, made falsifiable.
//
// The Owner's rulings of 2026-08-30 authorised presentation/projection corrections and nothing more:
//
//   ND-25  TRUTHFUL ABSENCE > FALSE COMFORT. warehouseQty is not a stock authority and no surface
//          may present it as one. No client-side N-part balance derivation, no second inventory
//          authority, no relabelling of a derived figure as "On hand".
//   ND-26  internalPartNumber is the human-facing Part Number; partId stays the immutable document
//          and routing key. Never label partId "Part Number".
//   ND-27  unitCost stays refused for display, report and export.
//
// These are rules about what the projection may and may not carry, so they are testable here rather
// than only at the render. Each test below fails if the corresponding correction is reverted.
import { test } from "node:test";
import assert from "node:assert/strict";

import { toPartView, toPartListView, OEM_STATUSES, PART_STATUSES } from "../src/domain/partMasterView.js";
import {
  OEM_STATUSES as VOCAB_OEM_STATUSES,
  OEM_STATUS_LABEL,
  PART_STATUS_LABEL,
  CONTROL_TYPE_LABEL,
  STOCKING_CLASS_LABEL,
} from "../src/domain/partVocabulary.js";
import { buildPartDetailView } from "../src/domain/partDetailView.js";
import { buildPartsCatalogRows } from "../src/domain/partsCatalogView.js";

// A valid canonical Part document, as Firestore stores it. Note primaryManufacturerId — the STORED
// key — rather than the domain type's manufacturerId.
function partDoc(over = {}) {
  return {
    partId: "P-1",
    internalPartNumber: "X49463-3",
    name: "Scraper Blade Kit",
    description: "Scraper Blade Kit, C7xx series",
    category: "Kits",
    status: "ACTIVE",
    stockingUnit: "EACH",
    controlType: "STANDARD",
    stockingClass: "STOCKED",
    primaryManufacturerId: "MFR-TAYLOR",
    primaryManufacturerPartNumber: "047-712-88",
    oemStatus: "OEM",
    ...over,
  };
}

// The static compatibility catalogue's row for the same sku. Its warehouseQty is the baseline that
// ND-25 forbids any surface from presenting as stock.
const staticRow = { sku: "P-1", name: "Scraper Blade Kit", category: "Kits", unit: "ea", cost: 12.5, price: 30, reorderThreshold: 2, warehouseQty: 38 };

function canonicalRead(docs) {
  return { status: "OK", rows: toPartListView(docs.map((d) => ({ id: d.partId, data: d }))).parts, invalid: [] };
}

// ── toPartView reads the key the document actually has ──────────────────────────────────────────

test("manufacturer is read from primaryManufacturerId, the STORED key", () => {
  const v = toPartView("P-1", partDoc());
  assert.equal(v.manufacturerId, "MFR-TAYLOR");
  assert.equal(v.manufacturerPartNumber, "047-712-88");
});

test("a document carrying only the DOMAIN TYPE's manufacturerId yields null — the exact defect", () => {
  // functions/src/partMaster/partMasterRepository.ts writes primaryManufacturerId. A reader that
  // looks for manufacturerId finds nothing, which is why PartDetail's Manufacturer row could never
  // render. If this ever passes, the reader has started guessing at key names.
  const doc = partDoc();
  delete doc.primaryManufacturerId;
  const v = toPartView("P-1", { ...doc, manufacturerId: "MFR-TAYLOR" });
  assert.equal(v.manufacturerId, null);
});

test("an unrecognised oemStatus is null, NEVER coerced to UNKNOWN", () => {
  // "UNKNOWN" is a RECORDED answer meaning the OEM status was assessed and is unknown. Absent means
  // nobody recorded one. Collapsing the second into the first invents a fact.
  assert.equal(toPartView("P-1", partDoc({ oemStatus: "GENUINE" })).oemStatus, null);
  assert.equal(toPartView("P-1", partDoc({ oemStatus: undefined })).oemStatus, null);
  assert.equal(toPartView("P-1", partDoc({ oemStatus: "UNKNOWN" })).oemStatus, "UNKNOWN");
});

test("a Part with no manufacturer and no OEM status is still VALID", () => {
  // The widening must not tighten the validity gate: these fields are optional in the domain type.
  const doc = partDoc();
  delete doc.primaryManufacturerId;
  delete doc.primaryManufacturerPartNumber;
  delete doc.oemStatus;
  const v = toPartView("P-1", doc);
  assert.equal(v.invalid, false);
  assert.equal(v.manufacturerId, null);
  assert.equal(v.oemStatus, null);
});

// ── one set of values, one set of labels ────────────────────────────────────────────────────────

test("partVocabulary re-exports the OEM values rather than declaring a second copy", () => {
  assert.deepEqual([...VOCAB_OEM_STATUSES], [...OEM_STATUSES]);
});

test("every vocabulary label map covers exactly its own value list", () => {
  // The #1093 lesson: a label map that drifts from the values it labels is how "0 Active" ends up
  // beside a table of ACTIVE rows.
  const pairs = [
    [OEM_STATUSES, OEM_STATUS_LABEL],
    [PART_STATUSES, PART_STATUS_LABEL],
  ];
  for (const [values, labels] of pairs) {
    assert.deepEqual([...values].sort(), Object.keys(labels).sort());
  }
  // The other two label maps are keyed by their own module's values; assert they are non-empty and
  // that every key resolves to a non-empty word rather than an echoed enum.
  for (const labels of [CONTROL_TYPE_LABEL, STOCKING_CLASS_LABEL]) {
    const keys = Object.keys(labels);
    assert.ok(keys.length > 0);
    for (const k of keys) assert.notEqual(labels[k], k);
  }
});

// ── ND-26: the Part Number and the document key are two different strings ───────────────────────

test("the detail projection carries internalPartNumber ALONGSIDE partId, never in place of it", () => {
  const out = buildPartDetailView({ canonicalRead: canonicalRead([partDoc()]), staticCatalog: [staticRow], partId: "P-1" });
  assert.equal(out.status, "READY");
  assert.equal(out.part.partId, "P-1");
  assert.equal(out.part.internalPartNumber, "X49463-3");
  assert.notEqual(out.part.internalPartNumber, out.part.partId);
});

test("the catalog row carries internalPartNumber, and a row with no canonical document carries null", () => {
  // An approved STATIC_ONLY_EXCLUDED sku has no canonical Part, so it has no Part Number. Falling
  // back to the key here is precisely the substitution ND-26 forbids.
  const rows = buildPartsCatalogRows({ canonicalRead: canonicalRead([partDoc()]), staticCatalog: [staticRow] }).rows;
  const row = rows.find((r) => r.sku === "P-1");
  assert.equal(row.internalPartNumber, "X49463-3");

  // TST-1047 is one of the ten APPROVED_STATIC_ONLY_EXCLUSIONS, so it DOES become a row — and
  // that row has no canonical document behind it, hence no Part Number. Asserted unconditionally:
  // a guarded assertion here would let the fallback-to-key regression through unnoticed.
  const withExcluded = buildPartsCatalogRows({
    canonicalRead: canonicalRead([partDoc()]),
    staticCatalog: [staticRow, { ...staticRow, sku: "TST-1047" }],
  });
  const excluded = withExcluded.rows.find((r) => r.sku === "TST-1047");
  assert.ok(excluded, "the approved exclusion should still produce a row");
  assert.equal(excluded.identityState, "STATIC_ONLY_EXCLUDED");
  assert.equal(excluded.internalPartNumber, null);
});

test("the detail projection carries the classification and manufacturer facts the record header needs", () => {
  const part = buildPartDetailView({ canonicalRead: canonicalRead([partDoc()]), staticCatalog: [staticRow], partId: "P-1" }).part;
  assert.equal(part.status, "ACTIVE");
  assert.equal(part.controlType, "STANDARD");
  assert.equal(part.stockingClass, "STOCKED");
  assert.equal(part.description, "Scraper Blade Kit, C7xx series");
  assert.equal(part.manufacturerId, "MFR-TAYLOR");
  assert.equal(part.oemStatus, "OEM");
  // Words are not the projection's job — it carries stored values, and partVocabulary turns them
  // into language at the point of render. A projection that carried labels would be a second
  // vocabulary, which is what partVocabulary exists to prevent.
  assert.notEqual(part.status, PART_STATUS_LABEL.ACTIVE);
});

// ── ND-25: the composers may not grow a quantity authority ──────────────────────────────────────

test("no composer emits a field named available or onHand", () => {
  // ND-25, Option (b): quantitative inventory facts may appear ONLY through getPartBalance once its
  // capability is intentionally activated. A field of either name appearing on these pure composers
  // means a second inventory authority has been created client-side.
  const part = buildPartDetailView({ canonicalRead: canonicalRead([partDoc()]), staticCatalog: [staticRow], partId: "P-1" }).part;
  const row = buildPartsCatalogRows({ canonicalRead: canonicalRead([partDoc()]), staticCatalog: [staticRow] }).rows[0];
  for (const shape of [part, row]) {
    const keys = Object.keys(shape).map((k) => k.toLowerCase());
    assert.ok(!keys.includes("available"), "a composer grew an `available` field");
    assert.ok(!keys.includes("availablestock"), "a composer grew an `availableStock` field");
    assert.ok(!keys.includes("onhand"), "a composer grew an `onHand` field");
    assert.ok(!keys.includes("onorder"), "a composer grew an `onOrder` field");
  }
});

test("warehouseQty keeps its STATIC_FALLBACK provenance, so a renderer cannot mistake it for governed stock", () => {
  const out = buildPartDetailView({ canonicalRead: canonicalRead([partDoc()]), staticCatalog: [staticRow], partId: "P-1" });
  assert.equal(out.part.warehouseQty, 38);
  assert.equal(out.part.provenance.warehouseQty, "STATIC_FALLBACK");
  // ...while the identity facts this migration widened are canonical, so the two classes of value
  // remain distinguishable at the point of render.
  assert.equal(out.part.provenance.internalPartNumber, "CANONICAL");
  assert.equal(out.part.provenance.manufacturerId, "CANONICAL");
});
