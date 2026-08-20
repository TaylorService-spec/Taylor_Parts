// PART IDENTIFIERS — pure contract. No emulator, no React.
// Run: node --test test/partIdentifiers.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  ALIAS_TYPES,
  ALIAS_TYPE_LABEL,
  GS1_DIGIT_LENGTHS,
  MAX_IDENTIFIER_LENGTH,
  requiresManufacturer,
  validateIdentifierDraft,
  outcomeFromErrorCode,
  describeProbe,
  IDENTIFIER_OUTCOMES,
} from "../src/domain/partIdentifiers.js";

const draft = (over = {}) => ({ aliasType: "INTERNAL_PN", rawValue: "ABC-123", manufacturerId: "", ...over });

// ------------------------------------------------- the mirror must match the authority

test("alias types mirror the server's ALIAS_TYPES exactly", () => {
  // Read from the authority's source rather than trusting a copy. A type added server-side that
  // the form cannot offer is a silently unusable identifier kind.
  const src = readFileSync(new URL("../../functions/src/partMaster/types.ts", import.meta.url), "utf8");
  const block = src.split("export const ALIAS_TYPES = [")[1]?.split("] as const;")[0];
  assert.ok(block, "could not locate ALIAS_TYPES in the authority");
  const server = [...block.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...ALIAS_TYPES].sort(), [...server].sort());
});

test("every alias type has a plain-language label", () => {
  for (const t of ALIAS_TYPES) {
    assert.ok(ALIAS_TYPE_LABEL[t], `${t} has no label — a person should never have to read the enum`);
    assert.notEqual(ALIAS_TYPE_LABEL[t], t);
  }
});

test("the GS1 digit lengths mirror the server's NUMERIC_LENGTHS", () => {
  const src = readFileSync(new URL("../../functions/src/partMaster/normalization.ts", import.meta.url), "utf8");
  assert.match(src, /UPC:\s*\[12\]/);
  assert.match(src, /EAN:\s*\[13\]/);
  assert.match(src, /GTIN:\s*\[8,\s*12,\s*13,\s*14\]/);
  assert.deepEqual(GS1_DIGIT_LENGTHS.UPC, [12]);
  assert.deepEqual(GS1_DIGIT_LENGTHS.EAN, [13]);
  assert.deepEqual(GS1_DIGIT_LENGTHS.GTIN, [8, 12, 13, 14]);
});

test("the max length mirrors the server's MAX_IDENTIFIER_LENGTH", () => {
  const src = readFileSync(new URL("../../functions/src/partMaster/normalization.ts", import.meta.url), "utf8");
  assert.match(src, new RegExp(`MAX_IDENTIFIER_LENGTH = ${MAX_IDENTIFIER_LENGTH}`));
});

// ------------------------------------------------- validation refuses only the certain

test("an empty value is refused", () => {
  const r = validateIdentifierDraft(draft({ rawValue: "   " }));
  assert.equal(r.valid, false);
  assert.equal(r.field, "rawValue");
});

test("an over-length value is refused", () => {
  const r = validateIdentifierDraft(draft({ rawValue: "x".repeat(MAX_IDENTIFIER_LENGTH + 1) }));
  assert.equal(r.valid, false);
});

test("a GS1 value with non-digits is refused, and separators are allowed", () => {
  assert.equal(validateIdentifierDraft(draft({ aliasType: "UPC", rawValue: "01234567890X" })).valid, false);
  // Leading zeroes are meaningful and must survive: this stays in the string domain.
  assert.equal(validateIdentifierDraft(draft({ aliasType: "UPC", rawValue: "0 12345-67890 5" })).valid, true);
});

test("a GS1 value of the wrong length is refused, and says which length was expected", () => {
  const r = validateIdentifierDraft(draft({ aliasType: "EAN", rawValue: "12345" }));
  assert.equal(r.valid, false);
  assert.match(r.message, /13 digits/);
  assert.match(r.message, /has 5/);
});

test("every valid GTIN length is accepted", () => {
  for (const len of GS1_DIGIT_LENGTHS.GTIN) {
    assert.equal(validateIdentifierDraft(draft({ aliasType: "GTIN", rawValue: "1".repeat(len) })).valid, true);
  }
});

test("MANUFACTURER_PN requires a manufacturer; no other type does", () => {
  // Per-manufacturer scoping is real: the same part number from two manufacturers is two different
  // identifiers, and the normalized value embeds the manufacturer.
  assert.equal(requiresManufacturer("MANUFACTURER_PN"), true);
  assert.equal(validateIdentifierDraft(draft({ aliasType: "MANUFACTURER_PN" })).valid, false);
  assert.equal(validateIdentifierDraft(draft({ aliasType: "MANUFACTURER_PN", manufacturerId: "MFR-1" })).valid, true);
  for (const t of ALIAS_TYPES.filter((x) => x !== "MANUFACTURER_PN")) {
    assert.equal(requiresManufacturer(t), false, `${t} must not demand a manufacturer`);
  }
});

test("a non-GS1 value the server might still accept is NOT refused here", () => {
  // The mirror is deliberately conservative: it refuses only what the server certainly refuses.
  // Guessing at the punctuation allow-list would reject values the authority would have taken.
  assert.equal(validateIdentifierDraft(draft({ aliasType: "SUPPLIER_SKU", rawValue: "a/b\\c#1" })).valid, true);
});

test("an unknown alias type is refused", () => {
  assert.equal(validateIdentifierDraft(draft({ aliasType: "NOPE" })).valid, false);
});

// ------------------------------------------------- outcomes say the true thing

test("a conflict is not reported as a validation failure", () => {
  const o = outcomeFromErrorCode("already-exists", "ALIAS_CONFLICT");
  assert.equal(o.kind, "conflict");
  assert.match(o.message, /already recorded/i);
  assert.doesNotMatch(o.message, /invalid/i);
});

test("a version conflict tells the user someone else changed it", () => {
  const o = outcomeFromErrorCode("aborted", "VERSION_CONFLICT");
  assert.equal(o.kind, "conflict");
  assert.match(o.message, /someone else/i);
});

test("a denial is a denial, not a validation failure", () => {
  assert.equal(outcomeFromErrorCode("permission-denied", "DENIED").kind, "denied");
});

test("without a domain detail the HttpsError code still maps", () => {
  assert.equal(outcomeFromErrorCode("permission-denied", null), IDENTIFIER_OUTCOMES.DENIED);
  assert.equal(outcomeFromErrorCode("nonsense", null), IDENTIFIER_OUTCOMES.INTERNAL);
});

// ------------------------------------------------- scan-to-test tells the truth

test("a scan resolving to THIS part is the correct outcome", () => {
  const d = describeProbe({ result: "FOUND", partId: "P1" }, { partId: "P1" });
  assert.equal(d.tone, "ok");
});

test("a scan resolving to a DIFFERENT part is flagged, and names it", () => {
  const d = describeProbe({ result: "FOUND", partId: "P2" }, { partId: "P1" });
  assert.equal(d.tone, "attention");
  assert.match(d.message, /P2/);
});

test("INACTIVE is never collapsed into NOT_FOUND", () => {
  // Registered-but-off and never-registered call for different fixes -- reactivate one, create the
  // other -- so telling an administrator the wrong one sends them to do the wrong thing.
  const inactive = describeProbe({ result: "INACTIVE", partId: "P1" }, { partId: "P1" });
  const missing = describeProbe({ result: "NOT_FOUND" }, { partId: "P1" });
  assert.match(inactive.message, /reactivate/i);
  assert.doesNotMatch(missing.message, /reactivate/i);
  assert.notEqual(inactive.message, missing.message);
});

test("a malformed value is distinguished from an unregistered one", () => {
  const d = describeProbe({ result: "MALFORMED" }, { partId: "P1" });
  assert.match(d.message, /not a usable identifier/i);
});

test("an unrecognized probe shape does not claim anything", () => {
  assert.equal(describeProbe(null, { partId: "P1" }).tone, "error");
  assert.equal(describeProbe({ result: "???" }, { partId: "P1" }).tone, "error");
});
