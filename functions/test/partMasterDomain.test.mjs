// INV-1 Phase 1, PR 1.1 -- tests for the Part Master pure domain foundation.
// Plain Node assert against compiled lib/ (house pure-logic convention).
// Prerequisite: npm run build. No emulator, network, credentials, or clock.
import assert from "node:assert/strict";
import {
  ALIAS_TYPES, CONTROL_TYPES, STOCKING_CLASSES, PART_STATUSES,
  parsePartId, parseInternalPartNumber, validatePart, validatePartAlias,
  validatePartRelationship, normalizeIdentifier, validateGs1CheckDigit,
  buildAliasKey, parseQuantity, convertQuantity, UNIT_DEFINITIONS,
} from "../lib/partMaster/index.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
const errCodes = (r) => r.errors.map((e) => e.code);
const errPaths = (r) => r.errors.map((e) => e.path);

const BASE_PART = {
  partId: "TST-1001", internalPartNumber: "TST-1001", name: "Compressor",
  status: "ACTIVE", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED",
};

console.log("partMasterDomain.test.mjs");

// A. Canonical identity
check("A1 valid partId (grandfathered sku shape)", () => {
  const r = parsePartId("TST-1001");
  assert.equal(r.valid, true); assert.equal(r.value, "TST-1001");
});
check("A2 empty partId rejected", () => {
  for (const bad of ["", "   ", null, undefined, 42]) assert.equal(parsePartId(bad).valid, false);
});
check("A3 overlength identifiers rejected", () => {
  assert.equal(parsePartId("X".repeat(65)).valid, false);
  assert.ok(errCodes(normalizeIdentifier("INTERNAL_PN", "X".repeat(121))).includes("OUT_OF_RANGE"));
});
check("A4 internalPartNumber is distinct from canonical partId (type + rule)", () => {
  const p = validatePart({ ...BASE_PART, internalPartNumber: "ACME 100-B" });
  assert.equal(p.valid, true);
  assert.notEqual(p.value.internalPartNumber, p.value.partId); // renumbering never touches identity
});
check("A5 legacy SKU accepted as alias without becoming canonical identity", () => {
  const a = validatePartAlias({ aliasType: "LEGACY", rawValue: "old-sku-9", partId: "P-1" });
  assert.equal(a.valid, true);
  assert.equal(a.value.partId, "P-1");
  assert.equal(a.value.normalizedValue, "OLD-SKU-9");
});

// B. Normalization
check("B6 whitespace trimmed and collapsed", () => {
  assert.equal(normalizeIdentifier("SUPPLIER_SKU", "  ab   c1  ").value, "AB C1");
});
check("B7 case normalization for text identifier types", () => {
  assert.equal(normalizeIdentifier("INTERNAL_PN", "abc-01").value, "ABC-01");
});
check("B8 punctuation preserved for MPN/SKU; separators stripped for numeric types", () => {
  assert.equal(normalizeIdentifier("SUPPLIER_SKU", "a.b/c#1-2_x").value, "A.B/C#1-2_X");
  assert.equal(normalizeIdentifier("UPC", "0 3600-029145 2").value, "036000291452");
});
check("B9 numeric identifiers preserve leading zeroes as strings", () => {
  const r = normalizeIdentifier("EAN", "0012345678905");
  assert.equal(r.valid, true); assert.equal(r.value, "0012345678905");
});
check("B10 deterministic: same input, same output", () => {
  assert.equal(normalizeIdentifier("GTIN", "00614141453242").value, normalizeIdentifier("GTIN", "00614141453242").value);
});
check("B11 invalid characters rejected", () => {
  assert.equal(normalizeIdentifier("INTERNAL_PN", "abcé!").valid, false);
  assert.equal(normalizeIdentifier("UPC", "12345678901X").valid, false);
});
check("B12 original value preserved separately on alias records", () => {
  const a = validatePartAlias({ aliasType: "SUPPLIER_SKU", rawValue: "  ws-01 ", partId: "P-1" });
  assert.equal(a.value.rawValue, "  ws-01 ");
  assert.equal(a.value.normalizedValue, "WS-01");
});
check("B+ UPC/EAN/GTIN length enforcement; never JS numbers", () => {
  assert.equal(normalizeIdentifier("UPC", "1234567").valid, false); // wrong length
  assert.equal(normalizeIdentifier("GTIN", "12345678").valid, true); // GTIN-8 ok
  assert.equal(typeof normalizeIdentifier("UPC", "036000291452").value, "string");
});
check("B+ GS1 check digit: optional validator, correct verdicts", () => {
  assert.equal(validateGs1CheckDigit("036000291452"), true);  // valid UPC-A
  assert.equal(validateGs1CheckDigit("036000291453"), false);
  assert.equal(validateGs1CheckDigit("4006381333931"), true); // valid EAN-13
  // legacy non-GS1 values are NOT rejected by normalization itself:
  assert.equal(normalizeIdentifier("LEGACY", "0000-legacy").valid, true);
});

// C. Alias model
check("C13 deterministic alias-key generation", () => {
  assert.equal(buildAliasKey("UPC", "036000291452").value, "UPC__036000291452");
});
check("C14 alias type participates in uniqueness key", () => {
  assert.notEqual(buildAliasKey("UPC", "1").value, buildAliasKey("EAN", "1").value);
});
check("C15 manufacturer scope required and embedded for MANUFACTURER_PN", () => {
  assert.ok(errPaths(normalizeIdentifier("MANUFACTURER_PN", "MPN-9")).includes("manufacturerId"));
  assert.equal(normalizeIdentifier("MANUFACTURER_PN", "mpn-9", "MFR-1").value, "MFR-1|MPN-9");
  assert.ok(errCodes(normalizeIdentifier("SUPPLIER_SKU", "S1", "MFR-1")).includes("CONFLICTING_FIELDS"));
});
check("C16 inactive alias representable", () => {
  const a = validatePartAlias({ aliasType: "LEGACY", rawValue: "x1", partId: "P-1", status: "INACTIVE" });
  assert.equal(a.valid, true); assert.equal(a.value.status, "INACTIVE");
});
check("C17 unsupported alias type rejected; date range validated", () => {
  assert.equal(validatePartAlias({ aliasType: "NOPE", rawValue: "x", partId: "P-1" }).valid, false);
  const bad = validatePartAlias({ aliasType: "LEGACY", rawValue: "x", partId: "P-1", effectiveFrom: "2026-02-01", effectiveTo: "2026-01-01" });
  assert.ok(errCodes(bad).includes("INVALID_DATE_RANGE"));
});

// D. Units
check("D18 unit registry covers current catalog units + approved measured units", () => {
  for (const code of ["EACH", "KIT", "BOTTLE", "TUBE", "BOX", "CASE", "FOOT", "ROLL", "GALLON", "OUNCE", "POUND"]) {
    assert.ok(UNIT_DEFINITIONS[code], code);
  }
});
check("D19 fractional quantity allowed for measured units", () => {
  assert.equal(parseQuantity("GALLON", "1.25").valid, true);
});
check("D20 fractional rejected for integer-only units", () => {
  assert.ok(errCodes(parseQuantity("EACH", "1.5")).includes("PRECISION_EXCEEDED"));
});
check("D21 purchase→stocking conversion (CASE of 24 EACH)", () => {
  assert.equal(convertQuantity("CASE", "EACH", "3", { numerator: 24, denominator: 1 }, "HALF_UP").value, "72");
});
check("D22 reversible conversion where exact", () => {
  assert.equal(convertQuantity("EACH", "CASE", "72", { numerator: 1, denominator: 24 }, "REJECT_INEXACT").value, "3");
});
check("D23 non-reversible conversion follows rounding policy", () => {
  assert.equal(convertQuantity("EACH", "CASE", "73", { numerator: 1, denominator: 24 }, "HALF_UP").value, "3");
  assert.ok(errCodes(convertQuantity("EACH", "CASE", "73", { numerator: 1, denominator: 24 }, "REJECT_INEXACT")).includes("PRECISION_EXCEEDED"));
});
check("D24 zero/negative conversion factors rejected", () => {
  for (const f of [{ numerator: 0, denominator: 1 }, { numerator: 1, denominator: 0 }, { numerator: -2, denominator: 1 }, { numerator: 1.5, denominator: 1 }]) {
    assert.equal(convertQuantity("CASE", "EACH", "1", f, "HALF_UP").valid, false);
  }
});
check("D25 negative quantity rejected", () => {
  assert.ok(errCodes(parseQuantity("EACH", "-1")).includes("OUT_OF_RANGE"));
});
check("D26 precision overflow rejected", () => {
  assert.ok(errCodes(parseQuantity("GALLON", "1.255")).includes("PRECISION_EXCEEDED"));
});
check("D27 no floating-point drift (0.1+0.2 class case, scaled-integer math)", () => {
  // 0.30 gallons at factor 3 -> 0.90 exactly; float math would risk 0.9000000000000001-class drift
  assert.equal(convertQuantity("GALLON", "GALLON", "0.30", { numerator: 3, denominator: 1 }, "REJECT_INEXACT").value, "0.90");
  assert.equal(convertQuantity("GALLON", "OUNCE", "0.01", { numerator: 128, denominator: 1 }, "REJECT_INEXACT").value, "1.28");
});

// E. Classifications
check("E28/E29 all control types and stocking classes accepted", () => {
  for (const controlType of CONTROL_TYPES) {
    const r = validatePart({ ...BASE_PART, controlType, stockingClass: "STOCKED" });
    assert.equal(r.valid, true, controlType);
  }
  for (const stockingClass of STOCKING_CLASSES) {
    const r = validatePart({ ...BASE_PART, stockingClass, controlType: "STANDARD" });
    assert.equal(r.valid, true, stockingClass);
  }
  assert.equal(PART_STATUSES.length, 5); assert.equal(ALIAS_TYPES.length, 10);
});
check("E30 invalid enum rejected", () => {
  assert.equal(validatePart({ ...BASE_PART, controlType: "WEIRD" }).valid, false);
  assert.equal(validatePart({ ...BASE_PART, status: "GONE" }).valid, false);
});
check("E31 incompatible combinations rejected", () => {
  assert.ok(errCodes(validatePart({ ...BASE_PART, flags: { expiryTracked: true, consumable: false, returnableCore: false } })).includes("INVALID_COMBINATION"));
  assert.ok(errCodes(validatePart({ ...BASE_PART, stockingClass: "SERVICE", controlType: "SERIALIZED" })).includes("INVALID_COMBINATION"));
  assert.ok(errCodes(validatePart({ ...BASE_PART, stockingClass: "NON_STOCK", flags: { expiryTracked: false, consumable: true, returnableCore: false } })).includes("INVALID_COMBINATION"));
});
check("E32 serial/lot values remain descriptive (no operational fields exist)", () => {
  const r = validatePart({ ...BASE_PART, controlType: "SERIALIZED_LOT", flags: { expiryTracked: true, consumable: false, returnableCore: false } });
  assert.equal(r.valid, true);
  assert.ok(!("serialNumbers" in r.value) && !("lots" in r.value));
});
check("E33 Part/Equipment boundary: no equipment fields in Part core", () => {
  const r = validatePart(BASE_PART);
  for (const k of ["serialNumber", "assetTag", "customerId", "locationId"]) assert.ok(!(k in r.value), k);
});

// F. Part validation + authority boundary
check("F34 minimal valid Part", () => {
  const r = validatePart(BASE_PART);
  assert.equal(r.valid, true);
  assert.deepEqual(r.value.flags, { expiryTracked: false, consumable: false, returnableCore: false });
});
check("F35/F36 missing name / stocking unit rejected", () => {
  assert.ok(errPaths(validatePart({ ...BASE_PART, name: " " })).includes("name"));
  assert.ok(errPaths(validatePart({ ...BASE_PART, stockingUnit: "PALLET" })).includes("stockingUnit"));
});
check("F37/F38 authority-owned fields are not part of the Part core shape", () => {
  const r = validatePart(BASE_PART);
  for (const k of ["onHand", "reserved", "available", "supplierCost", "purchasePrice", "leadTimeDays", "reorderRecommendation", "workOrderQuantityUsed", "aiRecommendation", "tenantId", "companyId"]) {
    assert.ok(!(k in r.value), `Part core must not carry ${k}`);
  }
});
check("F39 DISCONTINUED represented without deleting identity", () => {
  const r = validatePart({ ...BASE_PART, status: "DISCONTINUED" });
  assert.equal(r.valid, true); assert.equal(r.value.partId, "TST-1001");
});
check("F40 no embedded alias/supplier arrays in the model", () => {
  const r = validatePart(BASE_PART);
  assert.ok(!("aliases" in r.value) && !("supplierItems" in r.value));
});
check("F+ MPN requires manufacturer reference", () => {
  assert.ok(errCodes(validatePart({ ...BASE_PART, manufacturerPartNumber: "MPN-1" })).includes("CONFLICTING_FIELDS"));
  assert.equal(validatePart({ ...BASE_PART, manufacturerId: "MFR-1", manufacturerPartNumber: "MPN-1" }).valid, true);
});

// G. Relationships
check("G41 self-reference rejected", () => {
  assert.ok(errCodes(validatePartRelationship({ fromPartId: "P-1", toPartId: "P-1", relationshipType: "SUBSTITUTE", reasonCode: "R" })).includes("INVALID_COMBINATION"));
});
check("G42 invalid effective dates rejected", () => {
  assert.ok(errCodes(validatePartRelationship({ fromPartId: "P-1", toPartId: "P-2", relationshipType: "SUPERSEDED_BY", reasonCode: "R", effectiveFrom: "2026-03-01", effectiveTo: "2026-02-01" })).includes("INVALID_DATE_RANGE"));
});
check("G43 KIT_COMPONENT quantity validation", () => {
  assert.equal(validatePartRelationship({ fromPartId: "K-1", toPartId: "P-2", relationshipType: "KIT_COMPONENT", reasonCode: "BOM", componentQuantity: "2", componentUnit: "EACH" }).valid, true);
  assert.ok(errCodes(validatePartRelationship({ fromPartId: "K-1", toPartId: "P-2", relationshipType: "KIT_COMPONENT", reasonCode: "BOM", componentQuantity: "0", componentUnit: "EACH" })).includes("OUT_OF_RANGE"));
  assert.ok(errPaths(validatePartRelationship({ fromPartId: "K-1", toPartId: "P-2", relationshipType: "KIT_COMPONENT", reasonCode: "BOM" })).includes("componentUnit"));
});
check("G44 type-specific fields enforced (component fields only on KIT_COMPONENT)", () => {
  assert.ok(errCodes(validatePartRelationship({ fromPartId: "P-1", toPartId: "P-2", relationshipType: "SUBSTITUTE", reasonCode: "R", componentQuantity: "1", componentUnit: "EACH" })).includes("CONFLICTING_FIELDS"));
});

console.log(`\npartMasterDomain: ${passed} passed, 0 failed`);
