// EOS Data Import -- the PORTABLE Parts pipeline: parse -> detect -> map -> drift ->
// normalize -> validate -> preview.
//
// Every case runs with NO Firestore, NO emulator and NO firebase-admin. That is the
// point of the data-plane ruling: if this suite needs infrastructure, the import logic
// is not portable. Existing identity is injected as a plain Set.
//
// SEEDED / SYNTHETIC source data throughout. It proves the process, not Taylor's data.
//
// Run: node --test test/dataImportPartsPipeline.test.mjs   (after `npm run build`)

import test from "node:test";
import assert from "node:assert/strict";

const {
  parseSourceFile,
  detectEntityType,
  suggestMapping,
  validateMapping,
  projectRows,
  headerSignature,
  detectMappingDrift,
  IntakeError,
  IMPORT_LIMITS,
} = await import("../lib/dataImport/importIntake.js");
const { buildPartsPreview, importableRows, partIdentityKey } = await import("../lib/dataImport/importPreview.js");
const { normalizePartRow, PART_CANONICAL_FIELDS, PART_REQUIRED_FIELDS } = await import(
  "../lib/dataImport/contracts/partImportContract.js"
);

// --------------------------------------------------------------- SEEDED fixtures

// A realistic Taylor-shaped export: source headers that do NOT match canonical names.
const SEEDED_PARTS_CSV = [
  "PART_NO,DESCRIPTION,LONG_DESC,U/M,CONTROL TYPE,ITEM CLASS,MFG PN,OEM,CATEGORY,STATUS",
  'PRT-1001,Evaporator Fan Motor,"1/15 HP, 115V evaporator fan motor",EA,STANDARD,STOCKED,EFM-115-15,OEM,Refrigeration,ACTIVE',
  "PRT-1002,Door Gasket,Magnetic door gasket,EA,STANDARD,STOCKED,DG-4471,AFTERMARKET,Refrigeration,ACTIVE",
  'PRT-1003,Ice Maker Control Board,"Control board, serialized",EA,SERIALIZED,STOCKED,ICB-9920,OEM,Controls,ACTIVE',
].join("\n");

// The same shape, with deliberate defects -- one of each class the brief names.
const SEEDED_PARTS_DIRTY_CSV = [
  "PART_NO,DESCRIPTION,U/M,CONTROL TYPE,ITEM CLASS,MFG PN",
  "PRT-2001,Good Row,EA,STANDARD,STOCKED,GR-1", // ready
  ",Missing Identity,EA,STANDARD,STOCKED,MI-1", // ERROR: required missing
  "PRT-2002,Bad Unit,PARSECS,STANDARD,STOCKED,BU-1", // ERROR: unknown unit
  "PRT-2003,Bad Control,EA,TELEPATHIC,STOCKED,BC-1", // ERROR: enum invalid
  "PRT-2001,Duplicate Of First,EA,STANDARD,STOCKED,DUP-1", // ERROR: duplicate in file
  "PRT-2004,Serialized No MPN,EA,SERIALIZED,STOCKED,", // WARNING: serialized without MPN
].join("\n");

const SEEDED_MAPPING = Object.freeze({
  PART_NO: "internalPartNumber",
  DESCRIPTION: "name",
  LONG_DESC: "description",
  "U/M": "stockingUnit",
  "CONTROL TYPE": "controlType",
  "ITEM CLASS": "stockingClass",
  "MFG PN": "manufacturerPartNumber",
  OEM: "oemStatus",
  CATEGORY: "category",
  STATUS: "status",
});

// --------------------------------------------------------------- portability

test("the portable modules import no firebase-admin", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of [
    "../src/dataImport/contracts/partImportContract.ts",
    "../src/dataImport/importIntake.ts",
    "../src/dataImport/importPreview.ts",
  ]) {
    // Strip comments first: these files DESCRIBE the boundary in prose, so a naive
    // grep matches the very sentence promising not to import Firestore.
    const src = readFileSync(new URL(f, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    assert.ok(!/from\s+["'][^"']*firebase-admin/.test(src), `${f} must not import firebase-admin`);
    assert.ok(!/\b(DocumentReference|DocumentSnapshot|FieldValue|Timestamp)\b/.test(src), `${f} must not use Firestore types`);
    assert.ok(!/\.collection\(/.test(src), `${f} must not name a Firestore collection`);
  }
});

// --------------------------------------------------------------- parsing

test("parses a seeded CSV into columns and rows, tracking source row numbers", () => {
  const p = parseSourceFile("SEEDED-parts.csv", SEEDED_PARTS_CSV);
  assert.equal(p.columns.length, 10);
  assert.equal(p.rows.length, 3);
  assert.deepEqual([...p.sourceRowNumbers], [2, 3, 4], "row numbers count the header as line 1");
  assert.equal(p.rows[0][2], "1/15 HP, 115V evaporator fan motor", "quoted comma survives the parser");
});

test("a UTF-8 BOM does not corrupt the first header name", () => {
  const p = parseSourceFile("SEEDED-bom.csv", "﻿PART_NO,DESCRIPTION\nPRT-1,Thing");
  assert.equal(p.columns[0], "PART_NO", "a BOM riding inside the first header would break exactly one mapping");
});

test("file-level refusals: empty, unsupported extension, duplicate column", () => {
  assert.throws(() => parseSourceFile("SEEDED.csv", ""), (e) => e instanceof IntakeError && e.code === "FILE_EMPTY");
  assert.throws(
    () => parseSourceFile("SEEDED-parts.xlsx", "a,b\n1,2"),
    (e) => e instanceof IntakeError && e.code === "UNSUPPORTED_EXTENSION",
  );
  assert.throws(
    () => parseSourceFile("SEEDED.csv", "PART_NO,PART_NO\n1,2"),
    (e) => e instanceof IntakeError && e.code === "DUPLICATE_COLUMN",
    "a repeated header misfiles every value beneath it",
  );
});

test("the row limit is enforced and stated", () => {
  const many = ["PART_NO", ...Array.from({ length: IMPORT_LIMITS.maxRows + 1 }, (_, i) => `PRT-${i}`)].join("\n");
  assert.throws(() => parseSourceFile("SEEDED.csv", many), (e) => e instanceof IntakeError && e.code === "TOO_MANY_ROWS");
});

// --------------------------------------------------------------- detection

test("detects PARTS from a realistic header, and refuses to guess from a foreign one", () => {
  const parts = parseSourceFile("SEEDED-parts.csv", SEEDED_PARTS_CSV);
  const hit = detectEntityType(parts.columns);
  assert.equal(hit.entityType, "PARTS");
  assert.ok(hit.confidence >= 0.75);

  const foreign = parseSourceFile("SEEDED-other.csv", "INVOICE_NO,AMOUNT,DUE_DATE\n1,2,3");
  const miss = detectEntityType(foreign.columns);
  assert.equal(miss.entityType, null, "a low-confidence guess would silently misfile the whole file");
  assert.match(miss.reason, /Choose the entity type/);
});

// --------------------------------------------------------------- mapping

test("suggests obvious mappings from synonyms and leaves unknown columns unmapped", () => {
  const p = parseSourceFile("SEEDED-parts.csv", SEEDED_PARTS_CSV);
  const s = suggestMapping("PARTS", p);
  const by = Object.fromEntries(s.map((x) => [x.sourceColumn, x.canonicalField]));

  assert.equal(by["PART_NO"], "internalPartNumber");
  assert.equal(by["U/M"], "stockingUnit");
  assert.equal(by["CONTROL TYPE"], "controlType");
  assert.equal(by["ITEM CLASS"], "stockingClass");
  assert.equal(by["MFG PN"], "manufacturerPartNumber");

  const sample = s.find((x) => x.sourceColumn === "PART_NO");
  assert.equal(sample.sampleValue, "PRT-1001", "the mapping grid shows a real sample value");
});

test("a column that only weakly resembles a field is NOT silently mapped", () => {
  const p = parseSourceFile("SEEDED.csv", "PART_NO,WIDGET_FLAVOUR\nPRT-1,Cherry");
  const s = suggestMapping("PARTS", p);
  const flavour = s.find((x) => x.sourceColumn === "WIDGET_FLAVOUR");
  assert.equal(flavour.canonicalField, null);
  assert.equal(flavour.confidence, "NONE");
});

test("mapping validation: required unmapped, unknown target, and two columns to one field", () => {
  const p = parseSourceFile("SEEDED-parts.csv", SEEDED_PARTS_CSV);

  const missingRequired = validateMapping("PARTS", p, { PART_NO: "internalPartNumber" });
  assert.equal(missingRequired.valid, false);
  assert.ok(missingRequired.findings.some((f) => f.code === "REQUIRED_FIELD_UNMAPPED" && f.field === "name"));

  const unknown = validateMapping("PARTS", p, { ...SEEDED_MAPPING, CATEGORY: "notAField" });
  assert.ok(unknown.findings.some((f) => f.code === "UNKNOWN_TARGET_FIELD"));

  const doubled = validateMapping("PARTS", p, { ...SEEDED_MAPPING, LONG_DESC: "name" });
  assert.ok(doubled.findings.some((f) => f.code === "DUPLICATE_TARGET_FIELD"));

  const good = validateMapping("PARTS", p, SEEDED_MAPPING);
  assert.equal(good.valid, true);
  assert.deepEqual([...good.ignoredColumns], [], "every column in this fixture is mapped");
});

test("an ignored source column is explicitly allowed", () => {
  const p = parseSourceFile("SEEDED.csv", "PART_NO,DESCRIPTION,U/M,CONTROL TYPE,ITEM CLASS,INTERNAL_NOTES\nPRT-1,X,EA,STANDARD,STOCKED,ignore me");
  const v = validateMapping("PARTS", p, {
    PART_NO: "internalPartNumber",
    DESCRIPTION: "name",
    "U/M": "stockingUnit",
    "CONTROL TYPE": "controlType",
    "ITEM CLASS": "stockingClass",
    INTERNAL_NOTES: null,
  });
  assert.equal(v.valid, true);
  assert.deepEqual([...v.ignoredColumns], ["INTERNAL_NOTES"]);
});

// --------------------------------------------------------------- drift

test("MAPPING DRIFT: the brief's exact scenario is detected and named", () => {
  // Saved against PART_NO; the new export ships ITEM_NUMBER instead.
  const profile = {
    profileId: "mp-1",
    entityType: "PARTS",
    headerSignature: headerSignature(["PART_NO", "DESCRIPTION"]),
    mapping: { PART_NO: "internalPartNumber", DESCRIPTION: "name" },
  };
  const changed = parseSourceFile("SEEDED-changed.csv", "ITEM_NUMBER,DESCRIPTION\nPRT-1,Thing");
  const drift = detectMappingDrift(profile, changed);

  assert.equal(drift.drifted, true);
  assert.deepEqual([...drift.missingColumns], ["PART_NO"]);
  assert.deepEqual([...drift.newColumns], ["ITEM_NUMBER"]);
  // The saved profile only ever mapped two columns, so the other required fields were
  // never satisfied by it either. What drift must name is that the IDENTITY field --
  // previously satisfied by PART_NO -- no longer is.
  assert.ok(
    drift.unsatisfiedRequiredFields.includes("internalPartNumber"),
    "the identity field is no longer mapped",
  );
  assert.match(drift.message, /MAPPING DRIFT/);
});

test("a header signature is order- and case-insensitive so reordered exports still match", () => {
  assert.equal(headerSignature(["A", "B", "C"]), headerSignature(["c", "b", "a"]));
  assert.notEqual(headerSignature(["A", "B"]), headerSignature(["A", "B", "C"]));
});

test("an unchanged file reports no drift", () => {
  const p = parseSourceFile("SEEDED.csv", "PART_NO,DESCRIPTION\nPRT-1,Thing");
  const profile = { profileId: "mp-1", entityType: "PARTS", headerSignature: headerSignature(p.columns), mapping: { PART_NO: "internalPartNumber", DESCRIPTION: "name" } };
  assert.equal(detectMappingDrift(profile, p).drifted, false);
});

// --------------------------------------------------------------- normalization

test("normalizes loose spreadsheet text into typed domain values", () => {
  const r = normalizePartRow({
    internalPartNumber: "  PRT-1001  ",
    name: "Evaporator   Fan Motor",
    stockingUnit: "ea",
    controlType: "serialized lot",
    stockingClass: "non stock",
    status: "active",
    oemStatus: "oem",
    consumable: "Yes",
    returnableCore: "0",
  });
  assert.equal(r.draft.internalPartNumber, "PRT-1001");
  assert.equal(r.draft.name, "Evaporator Fan Motor", "internal whitespace is collapsed");
  assert.equal(r.draft.stockingUnit, "EACH", "the source abbreviation EA maps into the governed code EACH");
  assert.equal(r.draft.controlType, "SERIALIZED_LOT", "separator- and case-insensitive on the source side");
  assert.equal(r.draft.stockingClass, "NON_STOCK");
  assert.equal(r.draft.flags.consumable, true);
  assert.equal(r.draft.flags.returnableCore, false);
});

test("status defaults to DRAFT rather than assuming an imported Part is live", () => {
  const r = normalizePartRow({ internalPartNumber: "P1", name: "N", stockingUnit: "EA", controlType: "STANDARD", stockingClass: "STOCKED" });
  assert.equal(r.draft.status, "DRAFT");
});

test("an unrecognised enum is an error, never a silent default", () => {
  const r = normalizePartRow({ internalPartNumber: "P1", name: "N", stockingUnit: "EA", controlType: "MAGIC", stockingClass: "STOCKED" });
  assert.equal(r.draft, null);
  assert.ok(r.findings.some((f) => f.code === "ENUM_INVALID" && f.field === "controlType"));
});

test("normalization never throws on a hostile row -- it reports", () => {
  for (const hostile of [{}, { internalPartNumber: {} }, { name: [] }, { stockingUnit: 42 }, { consumable: "maybe" }]) {
    const r = normalizePartRow(hostile);
    assert.ok(Array.isArray(r.findings));
    assert.ok(r.findings.length > 0);
  }
});

test("every required canonical field is reported when the row is empty", () => {
  const r = normalizePartRow({});
  const missing = r.findings.filter((f) => f.code === "REQUIRED_MISSING").map((f) => f.field).sort();
  assert.deepEqual(missing, [...PART_REQUIRED_FIELDS].sort(), "all required fields are reported, not just the first");
});

// --------------------------------------------------------------- preview

test("the dirty seeded file classifies every defect class correctly", () => {
  const p = parseSourceFile("SEEDED-parts-dirty.csv", SEEDED_PARTS_DIRTY_CSV);
  const mapping = {
    PART_NO: "internalPartNumber",
    DESCRIPTION: "name",
    "U/M": "stockingUnit",
    "CONTROL TYPE": "controlType",
    "ITEM CLASS": "stockingClass",
    "MFG PN": "manufacturerPartNumber",
  };
  assert.equal(validateMapping("PARTS", p, mapping).valid, true);

  const preview = buildPartsPreview(projectRows(p, mapping), new Set());
  assert.equal(preview.summary.total, 6);
  assert.equal(preview.summary.errors, 4, "missing identity, bad unit, bad enum, duplicate");
  assert.equal(preview.summary.warnings, 1, "serialized without MPN");
  assert.equal(preview.summary.ready, 1);

  const codes = preview.rows.flatMap((r) => r.findings.map((f) => f.code));
  for (const expected of ["REQUIRED_MISSING", "UNIT_UNKNOWN", "ENUM_INVALID", "DUPLICATE_IN_FILE", "SERIALIZED_WITHOUT_MPN"]) {
    assert.ok(codes.includes(expected), `expected finding ${expected}`);
  }

  // Errors are SHOWN, not hidden, and carry the source row number.
  const errorRows = preview.rows.filter((r) => r.classification === "ERROR");
  assert.equal(errorRows.length, 4);
  for (const r of errorRows) assert.ok(Number.isInteger(r.sourceRowNumber) && r.sourceRowNumber >= 2);
});

test("an identity that already exists is an ERROR, not a silent overwrite", () => {
  const p = parseSourceFile("SEEDED-parts.csv", SEEDED_PARTS_CSV);
  const existing = new Set([partIdentityKey("PRT-1002")]);
  const preview = buildPartsPreview(projectRows(p, SEEDED_MAPPING), existing);

  const clash = preview.rows.find((r) => r.identity === partIdentityKey("PRT-1002"));
  assert.equal(clash.classification, "ERROR");
  assert.ok(clash.findings.some((f) => f.code === "ALREADY_EXISTS"));
  assert.equal(clash.draft, null, "an error row carries no importable draft");
});

test("only READY and WARNING rows are importable; ERROR rows never reach execute", () => {
  const p = parseSourceFile("SEEDED-parts-dirty.csv", SEEDED_PARTS_DIRTY_CSV);
  const mapping = { PART_NO: "internalPartNumber", DESCRIPTION: "name", "U/M": "stockingUnit", "CONTROL TYPE": "controlType", "ITEM CLASS": "stockingClass", "MFG PN": "manufacturerPartNumber" };
  const preview = buildPartsPreview(projectRows(p, mapping), new Set());
  const importable = importableRows(preview);

  assert.equal(importable.length, preview.summary.ready + preview.summary.warnings);
  assert.ok(importable.every((r) => r.classification !== "ERROR"));
  assert.ok(importable.every((r) => r.draft !== null));
});

test("the clean seeded file is fully READY and produces domain-shaped drafts", () => {
  const p = parseSourceFile("SEEDED-parts.csv", SEEDED_PARTS_CSV);
  const preview = buildPartsPreview(projectRows(p, SEEDED_MAPPING), new Set());
  assert.equal(preview.summary.errors, 0);
  assert.equal(preview.summary.ready + preview.summary.warnings, 3);

  const first = preview.rows[0].draft;
  assert.equal(first.internalPartNumber, "PRT-1001");
  assert.equal(first.name, "Evaporator Fan Motor");
  assert.equal(first.stockingUnit, "EACH");
  assert.equal(first.controlType, "STANDARD");
  assert.equal(first.stockingClass, "STOCKED");
  assert.equal(first.status, "ACTIVE");
  assert.equal(first.oemStatus, "OEM");
  // Domain shape, not Firestore shape: no id, no timestamps, no refs.
  for (const forbidden of ["id", "createdAt", "updatedAt", "_ref", "path"]) {
    assert.ok(!(forbidden in first), `canonical draft must not carry storage field ${forbidden}`);
  }
});

test("the canonical contract exposes required fields and enum choices for the mapping UI", () => {
  assert.ok(PART_CANONICAL_FIELDS.length > 0);
  const control = PART_CANONICAL_FIELDS.find((f) => f.field === "controlType");
  assert.ok(control.enumValues.includes("SERIALIZED_LOT"), "the UI can offer the closed set");
  assert.ok(PART_REQUIRED_FIELDS.includes("internalPartNumber"));
  // The governed equipment-model FK is deliberately NOT importable from a spreadsheet.
  assert.ok(!PART_CANONICAL_FIELDS.some((f) => f.field === "equipmentModelId"));
  assert.ok(!PART_CANONICAL_FIELDS.some((f) => f.field === "wholeUnit"));
});
