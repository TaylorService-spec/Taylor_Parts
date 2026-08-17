// Parts Catalog authority direction (Owner-ratified 2026-08-17).
//
// THE DEFECT THIS PINS. The catalog composition treated BOTH directional mismatches as blocking, and
// built rows by iterating the STATIC catalog only. A valid governed Part with no static counterpart
// therefore produced no row AND a blocking issue -- so the legacy compatibility mirror could veto
// canonical Part Master truth simply by not knowing an id.
//
// Live consequence: every sandbox Part is PRT-*, every static row is TST-*, zero overlap, and the
// Parts Catalog rendered nothing at all -- "could not be verified against the canonical source".
// A single source mismatch became a whole-catalog outage.
//
// THE RULE NOW ENFORCED:
//   * canonical Parts are NEVER silently dropped        -> CANONICAL_ONLY rows render
//   * static-only data is NEVER silently promoted       -> unchanged, still excluded
//   * reconciliation mismatches are surfaced explicitly -> issues + counts, not blocking
//   * identity ambiguity still fails closed             -> duplicates/missing ids still block
//
// Run: node --test field-ops-app-vite/test/partsCatalogCanonicalAuthority.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { composeGovernedPartsWorkspace } from "../src/domain/partsCatalogView.js";

const canonical = (partId, over = {}) => ({
  partId, name: `Part ${partId}`, category: "Refrigeration", status: "ACTIVE",
  stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED",
  internalPartNumber: partId, ...over,
});
const staticItem = (sku, over = {}) => ({ sku, name: `Static ${sku}`, category: "Refrigeration", unit: "EA", cost: 1, ...over });
const compose = (rows, staticCatalog, extra = {}) =>
  composeGovernedPartsWorkspace({ canonicalRead: { status: "OK", rows, ...extra }, staticCatalog });

const rowFor = (ws, key) => ws.rows.find((r) => r.key === key);

// ---- A. canonical with NO static match still renders --------------------------------------------
test("A: a canonical Part with no static counterpart RENDERS and does not block", () => {
  const out = compose([canonical("PRT-1001")], [staticItem("TST-1001")]);
  assert.equal(out.status, "READY", `expected READY, got ${out.status} (${out.meta?.reason})`);
  const row = rowFor(out.ws, "PRT-1001");
  assert.ok(row, "the canonical Part must produce a row");
  assert.equal(row.identityState, "CANONICAL_ONLY");
});

test("A: the canonical-only row carries CANONICAL authority, never invented static values", () => {
  const out = compose([canonical("PRT-1001", { name: "Evaporator Fan Motor" })], [staticItem("TST-1001")]);
  const row = rowFor(out.ws, "PRT-1001");
  assert.equal(row.fields.name.value, "Evaporator Fan Motor");
  assert.equal(row.fields.name.source, "CANONICAL");
  assert.equal(row.fields.partId.source, "CANONICAL");
  // The static catalog knows nothing about this id, so there is no compatibility cost to report.
  assert.equal(row.fields.cost, undefined, "must not fabricate static compatibility fields");
});

test("A: the mismatch is still surfaced as evidence, not hidden", () => {
  const out = compose([canonical("PRT-1001")], [staticItem("TST-1001")]);
  assert.ok(out.ws.issues.some((i) => i.code === "CANONICAL_WITHOUT_STATIC" && i.key === "PRT-1001"));
  assert.equal(out.meta.canonicalWithoutStaticCount, 1);
});

// ---- B. static-only unapproved is NEVER promoted -------------------------------------------------
test("B: an unapproved static-only record never becomes a governed Part row", () => {
  const out = compose([canonical("PRT-1001")], [staticItem("TST-9999")]);
  assert.equal(out.status, "READY");
  assert.equal(rowFor(out.ws, "TST-9999"), undefined, "static-only data must not appear as a Part");
  assert.ok(out.ws.issues.some((i) => i.code === "STATIC_WITHOUT_CANONICAL_UNAPPROVED" && i.key === "TST-9999"));
  assert.equal(out.meta.staticWithoutCanonicalCount, 1);
});

test("B: no static-only row is ever labelled canonical", () => {
  const out = compose([canonical("PRT-1001")], [staticItem("TST-9999")]);
  for (const r of out.ws.rows) {
    if (r.identityState === "CANONICAL_ONLY" || r.identityState === "CANONICAL_MATCH") {
      assert.ok(r.key.startsWith("PRT-"), `${r.key} was promoted to canonical authority`);
    }
  }
});

// ---- C. canonical + matching static keeps existing reconciliation --------------------------------
test("C: a matched pair still reconciles as CANONICAL_MATCH with canonical authority", () => {
  const out = compose([canonical("SKU-1", { name: "Canonical Name" })], [staticItem("SKU-1", { name: "Static Name" })]);
  assert.equal(out.status, "READY");
  const row = rowFor(out.ws, "SKU-1");
  assert.equal(row.identityState, "CANONICAL_MATCH");
  // Canonical wins the field, and the divergence is reported rather than silently overwritten.
  assert.equal(row.fields.name.value, "Canonical Name");
  assert.equal(row.fields.name.source, "CANONICAL");
  assert.ok(out.ws.issues.some((i) => i.code === "NAME_DIVERGENCE" && i.key === "SKU-1"));
});

test("C: static-owned compatibility fields still flow on a matched pair", () => {
  const out = compose([canonical("SKU-1")], [staticItem("SKU-1", { cost: 42 })]);
  const row = rowFor(out.ws, "SKU-1");
  assert.equal(row.fields.cost.value, 42);
  assert.equal(row.fields.cost.source, "STATIC_FALLBACK");
});

// ---- D. the canonical-source contract still fails closed -----------------------------------------
test("D: a denied / unavailable / unknown canonical read still blocks", () => {
  const s = [staticItem("TST-1")];
  assert.equal(composeGovernedPartsWorkspace({ canonicalRead: { status: "PERMISSION_DENIED" }, staticCatalog: s }).status, "BLOCKED_PERMISSION");
  assert.equal(composeGovernedPartsWorkspace({ canonicalRead: { status: "UNAVAILABLE" }, staticCatalog: s }).status, "BLOCKED_UNAVAILABLE");
  assert.equal(composeGovernedPartsWorkspace({ canonicalRead: { status: "LOADING" }, staticCatalog: s }).status, "BLOCKED_INCOMPLETE_INPUT");
  assert.equal(composeGovernedPartsWorkspace({ canonicalRead: {}, staticCatalog: s }).status, "BLOCKED_INCOMPLETE_INPUT");
});

test("D: malformed canonical documents still block -- a bad doc is never dropped quietly", () => {
  const out = compose([canonical("PRT-1001")], [staticItem("TST-1")], { invalid: [{ id: "broken" }] });
  assert.equal(out.status, "BLOCKED_INCOMPLETE_INPUT");
  assert.equal(out.meta.invalidCount, 1);
});

test("D: ambiguous identity still blocks -- duplicates and missing ids", () => {
  const dupCanonical = compose([canonical("PRT-1"), canonical("PRT-1")], [staticItem("TST-1")]);
  assert.equal(dupCanonical.status, "BLOCKED_INCOMPLETE_INPUT");

  const dupStatic = compose([canonical("PRT-1")], [staticItem("TST-1"), staticItem("TST-1")]);
  assert.equal(dupStatic.status, "BLOCKED_INCOMPLETE_INPUT");

  const missingId = compose([{ name: "no id" }], [staticItem("TST-1")]);
  assert.equal(missingId.status, "BLOCKED_INCOMPLETE_INPUT");
});

// ---- E. THE KEY REGRESSION: one mismatch must not suppress unrelated Parts ------------------------
test("E: a mixed catalog renders every valid canonical Part despite mismatches on both sides", () => {
  // Exactly the live sandbox shape: canonical PRT-* with no static twins, plus a large unrelated
  // static TST-* set, plus one properly matched pair.
  const canonicalRows = ["PRT-1001", "PRT-1002", "PRT-1003", "PRT-2001"].map((id) => canonical(id));
  canonicalRows.push(canonical("SKU-MATCHED"));
  const statics = ["TST-1001", "TST-1002", "TST-1003"].map((sku) => staticItem(sku));
  statics.push(staticItem("SKU-MATCHED"));

  const out = compose(canonicalRows, statics);
  assert.equal(out.status, "READY", `expected READY, got ${out.status} (${out.meta?.reason})`);

  // EVERY canonical Part is present -- none suppressed by the unrelated mismatches.
  for (const id of ["PRT-1001", "PRT-1002", "PRT-1003", "PRT-2001", "SKU-MATCHED"]) {
    assert.ok(rowFor(out.ws, id), `${id} was silently dropped`);
  }
  assert.equal(out.meta.canonicalMatch + out.meta.canonicalOnly, 5);
  assert.equal(out.meta.canonicalCount, 5);

  // ...and none of the unapproved static-only rows leaked in.
  for (const sku of ["TST-1001", "TST-1002", "TST-1003"]) {
    assert.equal(rowFor(out.ws, sku), undefined, `${sku} leaked in as a governed Part`);
  }
  assert.equal(out.meta.staticWithoutCanonicalCount, 3);
  assert.equal(out.meta.canonicalWithoutStaticCount, 4);
});

test("E: zero overlap -- the exact live sandbox case -- still renders every canonical Part", () => {
  // This is the configuration that produced a completely empty catalog in the sandbox.
  const canonicalRows = ["PRT-1001", "PRT-1006", "PRT-2001"].map((id) => canonical(id));
  const statics = Array.from({ length: 20 }, (_, i) => staticItem(`TST-${1000 + i}`));
  const out = compose(canonicalRows, statics);

  assert.equal(out.status, "READY");
  assert.equal(out.ws.rows.length, 3, "all three canonical Parts must render, and nothing else");
  assert.ok(out.meta.canonicalOnly > 0, "canonical count must not be zero");
});
