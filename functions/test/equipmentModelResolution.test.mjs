// Fulfillment — ordered-model ↔ eligible-serial RESOLUTION (Option A). Pure unit tests (node:test; no
// emulator). Prerequisite: npm run build. Proves alias-aware ref resolution (never a free-text value-join),
// eligible whole-unit Part selection (wholeUnit + FK + ACTIVE; one model → many Parts), and serial candidates.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveOrderedModelRef,
  resolveEligibleWholeUnitParts,
  resolveWholeUnitSerialCandidates,
} from "../lib/fulfillment/equipmentModelResolution.js";
import { buildEquipmentModelId } from "../lib/equipmentCompatibility/domain/equipmentModel.js";

const MODEL = buildEquipmentModelId("taylor", "C713");
const OTHER = buildEquipmentModelId("taylor", "C723");

test("a canonical ref resolves directly (via CANONICAL)", () => {
  const r = resolveOrderedModelRef(MODEL);
  assert.deepEqual(r, { resolved: true, equipmentModelId: MODEL, via: "CANONICAL" });
});

test("a non-canonical ref resolves through the governed alias resolver (via ALIAS)", () => {
  const r = resolveOrderedModelRef("Taylor C-713", { resolveAlias: (raw) => (raw === "Taylor C-713" ? MODEL : null) });
  assert.deepEqual(r, { resolved: true, equipmentModelId: MODEL, via: "ALIAS" });
});

test("a non-canonical ref with NO resolver is UNRESOLVED (never a free-text value-join)", () => {
  const r = resolveOrderedModelRef("Taylor C-713");
  assert.deepEqual(r, { resolved: false, reason: "UNRESOLVED_NO_RESOLVER" });
});

test("an alias miss is UNRESOLVED_ALIAS (does not fabricate an id)", () => {
  const r = resolveOrderedModelRef("mystery", { resolveAlias: () => null });
  assert.deepEqual(r, { resolved: false, reason: "UNRESOLVED_ALIAS" });
});

test("a blank/invalid ref is INVALID_REF", () => {
  assert.equal(resolveOrderedModelRef("").reason, "INVALID_REF");
  assert.equal(resolveOrderedModelRef(null).reason, "INVALID_REF");
});

const parts = [
  { partId: "SKU-A", status: "ACTIVE", wholeUnit: true, equipmentModelId: MODEL },
  { partId: "SKU-B", status: "ACTIVE", wholeUnit: true, equipmentModelId: MODEL }, // one model → many Parts
  { partId: "SKU-INACTIVE", status: "INACTIVE", wholeUnit: true, equipmentModelId: MODEL }, // excluded: not ACTIVE
  { partId: "SKU-SERVICE", status: "ACTIVE", wholeUnit: false, equipmentModelId: MODEL }, // excluded: not whole-unit
  { partId: "SKU-OTHER", status: "ACTIVE", wholeUnit: true, equipmentModelId: OTHER }, // excluded: other model
  { partId: "SKU-UNLINKED", status: "ACTIVE", wholeUnit: true }, // excluded: no FK
];

test("eligible whole-unit Parts = wholeUnit + matching FK + ACTIVE (one model → many)", () => {
  assert.deepEqual(resolveEligibleWholeUnitParts(MODEL, parts), ["SKU-A", "SKU-B"]);
});

test("no eligible Parts ⇒ empty (never a false positive)", () => {
  assert.deepEqual(resolveEligibleWholeUnitParts(buildEquipmentModelId("acme", "ZZ9"), parts), []);
});

test("serial candidates flatten eligible partIds' serials, distinct + stable", () => {
  const serials = resolveWholeUnitSerialCandidates(MODEL, {
    parts,
    serialsByPartId: { "SKU-A": ["SN-1", "SN-2"], "SKU-B": ["SN-3"], "SKU-OTHER": ["SN-X"], "SKU-INACTIVE": ["SN-Y"] },
  });
  assert.deepEqual(serials, ["SN-1", "SN-2", "SN-3"]); // only eligible parts' serials
});

test("candidates are just candidates — resolution asserts NO availability by itself", () => {
  // (documented invariant) resolving serials does not decide company-control / location / custody / placement.
  const serials = resolveWholeUnitSerialCandidates(MODEL, { parts, serialsByPartId: { "SKU-A": ["SN-1"] } });
  assert.deepEqual(serials, ["SN-1"]);
});
