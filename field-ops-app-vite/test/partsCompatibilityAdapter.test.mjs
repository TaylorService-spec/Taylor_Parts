// INV-CONVERGENCE-D -- deterministic OFFLINE shadow-parity tests for the read-only
// parts compatibility adapter. Plain Node (house client-test convention). No Firebase,
// no credentials, no network, no production access: fixtures are the committed
// INV-CONVERGENCE-B / production read-back evidence and the static catalog.
//
// Offline parity here is NOT the live pre-cutover shadow-parity (Decision #44).
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildPartsWorkspace,
  validateRowProvenance,
  normalizeUnit,
  PROVENANCE,
  APPROVED_STATIC_ONLY_EXCLUSIONS,
} from "../src/domain/partsCompatibilityAdapter.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const rel = (p) => new URL(p, new URL("../", import.meta.url));
const ADAPTER_SRC = fs.readFileSync(rel("src/domain/partsCompatibilityAdapter.js"), "utf8");
const CATALOG_SRC = fs.readFileSync(rel("src/data/partsCatalog.ts"), "utf8");
const POSTWRITE = JSON.parse(fs.readFileSync(
  rel("../docs/audits/inv1-phase1/create-execution-20260724/postwrite-analyzer/row-results.json"), "utf8"));

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("partsCompatibilityAdapter.test.mjs");

// ---- fixtures (offline) ----------------------------------------------------
// Static catalog (200) parsed from the repo source.
const catRe = /\{\s*sku:\s*"([^"]+)",\s*name:\s*"((?:[^"\\]|\\.)*)",\s*category:\s*"([^"]+)",\s*unit:\s*"([^"]+)",\s*cost:\s*([\d.]+),\s*price:\s*([\d.]+),\s*reorderThreshold:\s*(\d+),\s*warehouseQty:\s*(\d+)\s*\}/g;
const STATIC = [];
for (let m; (m = catRe.exec(CATALOG_SRC)); ) {
  STATIC.push({ sku: m[1], name: m[2].replace(/\\"/g, '"'), category: m[3], unit: m[4],
    cost: Number(m[5]), price: Number(m[6]), reorderThreshold: Number(m[7]), warehouseQty: Number(m[8]) });
}
// Canonical parts (190) parsed from the committed production zero-write read-back.
const reSummary = /^(TST-\d{4})\s+"(.*)"\s+unit=(\S+)\s+status=(\S+)$/;
const CANONICAL = POSTWRITE.map((r) => {
  const mm = reSummary.exec(r.currentSummary || "");
  return { partId: r.proposedPartId, name: mm ? mm[2] : null, stockingUnit: mm ? mm[3] : null, status: mm ? mm[4] : null };
});

// ---- A. Population and join ------------------------------------------------
check("A. population/join totals: 200 static, 190 canonical-match, 10 static-only", () => {
  const { rows, totals, issues } = buildPartsWorkspace({ canonicalParts: CANONICAL, staticCatalogParts: STATIC });
  assert.equal(totals.staticCount, 200);
  assert.equal(totals.canonicalMatch, 190);
  assert.equal(totals.staticOnlyExcluded, 10);
  assert.equal(rows.length, 200);
  // no unexpected unmatched records on either side
  assert.equal(issues.filter((i) => i.code === "STATIC_WITHOUT_CANONICAL_UNAPPROVED").length, 0);
  assert.equal(issues.filter((i) => i.code === "CANONICAL_WITHOUT_STATIC").length, 0);
});
check("A. exact approved excluded-ten set, all classified STATIC_ONLY_EXCLUDED", () => {
  const { rows } = buildPartsWorkspace({ canonicalParts: CANONICAL, staticCatalogParts: STATIC });
  const excluded = rows.filter((r) => r.identityState === "STATIC_ONLY_EXCLUDED").map((r) => r.key).sort();
  assert.deepEqual(excluded, [...APPROVED_STATIC_ONLY_EXCLUSIONS].sort());
  // and none of the ten is ever represented as canonical
  for (const r of rows.filter((r) => APPROVED_STATIC_ONLY_EXCLUSIONS.includes(r.key))) {
    assert.equal(r.identityState, "STATIC_ONLY_EXCLUDED");
    assert.equal(r.fields.partId.source, "STATIC_FALLBACK");
    assert.equal(r.fields.status, undefined); // no canonical governance fields inferred
  }
});

// ---- B. Descriptive parity -------------------------------------------------
check("B. all 190 canonical matches: 0 name divergence, 0 normalized-unit divergence, partId==sku", () => {
  const { rows, issues } = buildPartsWorkspace({ canonicalParts: CANONICAL, staticCatalogParts: STATIC });
  assert.equal(issues.filter((i) => i.code === "NAME_DIVERGENCE").length, 0);
  assert.equal(issues.filter((i) => i.code === "UNIT_DIVERGENCE").length, 0);
  const matches = rows.filter((r) => r.identityState === "CANONICAL_MATCH");
  assert.equal(matches.length, 190);
  for (const r of matches) {
    assert.equal(r.fields.partId.value, r.key);        // canonical partId == operational sku
    assert.equal(r.fields.partId.source, "CANONICAL");
    assert.equal(r.fields.name.source, "CANONICAL");
    assert.equal(r.fields.stockingUnit.source, "CANONICAL");
  }
});

// ---- C. Static fallback preservation --------------------------------------
check("C. cost/price/reorderThreshold/warehouseQty preserved and classified STATIC_FALLBACK", () => {
  const { rows } = buildPartsWorkspace({ canonicalParts: CANONICAL, staticCatalogParts: STATIC });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const s of STATIC) {
    const f = byKey.get(s.sku).fields;
    for (const k of ["cost", "price", "reorderThreshold", "warehouseQty"]) {
      assert.equal(f[k].value, s[k]);
      assert.equal(f[k].source, "STATIC_FALLBACK");
    }
  }
});

// ---- D. Overlay parity (no new math; injected availability passes through) --
check("D. availability is the injected value verbatim with mixed provenance disclosed", () => {
  const s = STATIC[0]; // TST-1001
  const reserved = 3, released = 1, consumed = 2;
  // existing behavior: available = warehouseQty - (reserved - released); CONSUMED not re-subtracted
  const availability = s.warehouseQty - (reserved - released);
  const { rows } = buildPartsWorkspace({
    canonicalParts: CANONICAL, staticCatalogParts: STATIC,
    overlayBySku: { [s.sku]: { reserved, released, consumed, availability } },
  });
  const f = rows.find((r) => r.key === s.sku).fields;
  assert.equal(f.availability.value, availability);
  assert.equal(f.availability.source, "STATIC_FALLBACK");
  assert.deepEqual(f.availability.derivedFrom, ["STATIC_FALLBACK", "LEDGER_DERIVED"]);
  assert.equal(f.reserved.value, reserved); assert.equal(f.reserved.source, "LEDGER_DERIVED");
  assert.equal(f.released.value, released);
  assert.equal(f.consumed.value, consumed);
});
check("D. adapter performs NO recomputation (sentinel availability returned verbatim)", () => {
  const s = STATIC[0];
  const SENTINEL = -999999; // not equal to any real formula result
  const { rows } = buildPartsWorkspace({
    canonicalParts: CANONICAL, staticCatalogParts: STATIC,
    overlayBySku: { [s.sku]: { reserved: 3, released: 1, availability: SENTINEL } },
  });
  assert.equal(rows.find((r) => r.key === s.sku).fields.availability.value, SENTINEL);
});

// ---- E. Workflow preservation ---------------------------------------------
check("E. reorder/purchasing inputs pass through unmutated and classified WORKFLOW_DERIVED", () => {
  const s = STATIC[0];
  const reorderState = { status: "PENDING_REVIEW", requestedQty: 5 };
  const purchasingState = { status: "ORDERED", poNumber: "PO-1" };
  const { rows } = buildPartsWorkspace({
    canonicalParts: CANONICAL, staticCatalogParts: STATIC,
    workflowBySku: { [s.sku]: { reorderState, purchasingState } },
  });
  const f = rows.find((r) => r.key === s.sku).fields;
  assert.deepEqual(f.reorderState.value, reorderState);
  assert.equal(f.reorderState.source, "WORKFLOW_DERIVED");
  assert.deepEqual(f.purchasingState.value, purchasingState);
  assert.equal(f.purchasingState.source, "WORKFLOW_DERIVED");
});
check("E. historical snapshot stays distinguishable as HISTORICAL_SNAPSHOT", () => {
  const s = STATIC[0];
  const snap = { sku: s.sku, name: "as-recorded", qtyPlanned: 4 };
  const { rows } = buildPartsWorkspace({
    canonicalParts: CANONICAL, staticCatalogParts: STATIC, snapshotBySku: { [s.sku]: snap },
  });
  const f = rows.find((r) => r.key === s.sku).fields;
  assert.equal(f.historicalSnapshot.source, "HISTORICAL_SNAPSHOT");
  assert.deepEqual(f.historicalSnapshot.value, snap);
});

// ---- F. Validation failures (detected, never hidden) ----------------------
check("F. duplicate canonical partId is reported", () => {
  const { issues } = buildPartsWorkspace({
    canonicalParts: [{ partId: "TST-1001", name: "A", stockingUnit: "EACH" }, { partId: "TST-1001", name: "B", stockingUnit: "EACH" }],
    staticCatalogParts: STATIC,
  });
  assert.ok(issues.some((i) => i.code === "DUPLICATE_CANONICAL_PARTID" && i.key === "TST-1001"));
});
check("F. duplicate static sku is reported", () => {
  const dup = STATIC[0];
  const { issues } = buildPartsWorkspace({ canonicalParts: CANONICAL, staticCatalogParts: [...STATIC, { ...dup }] });
  assert.ok(issues.some((i) => i.code === "DUPLICATE_STATIC_SKU" && i.key === dup.sku));
});
check("F. unexpected eleventh static-only record (not in approved ten) is reported", () => {
  const extra = { sku: "TST-9999", name: "Rogue", category: "X", unit: "ea", cost: 1, price: 2, reorderThreshold: 1, warehouseQty: 1 };
  const { rows, issues } = buildPartsWorkspace({ canonicalParts: CANONICAL, staticCatalogParts: [...STATIC, extra] });
  assert.ok(issues.some((i) => i.code === "STATIC_WITHOUT_CANONICAL_UNAPPROVED" && i.key === "TST-9999"));
  assert.equal(rows.find((r) => r.key === "TST-9999"), undefined); // not silently accepted
});
check("F. canonical/static descriptive mismatch (name + unit) is reported", () => {
  const s = STATIC[0];
  const { issues } = buildPartsWorkspace({
    canonicalParts: [{ partId: s.sku, name: "DIFFERENT NAME", stockingUnit: "BOTTLE", status: "DRAFT" }],
    staticCatalogParts: [s],
  });
  assert.ok(issues.some((i) => i.code === "NAME_DIVERGENCE" && i.key === s.sku));
  assert.ok(issues.some((i) => i.code === "UNIT_DIVERGENCE" && i.key === s.sku));
});
check("F. missing identifier (canonical + static) is reported", () => {
  const { issues } = buildPartsWorkspace({
    canonicalParts: [{ name: "no id" }],
    staticCatalogParts: [{ name: "no sku", category: "c", unit: "ea", cost: 1, price: 2, reorderThreshold: 1, warehouseQty: 1 }],
  });
  assert.equal(issues.filter((i) => i.code === "MISSING_IDENTIFIER" && i.layer === "canonical").length, 1);
  assert.equal(issues.filter((i) => i.code === "MISSING_IDENTIFIER" && i.layer === "static").length, 1);
});
check("F. unknown provenance classification is reported by validateRowProvenance", () => {
  const badRow = { key: "TST-1001", fields: { name: { value: "x", source: "MADE_UP" }, price: { value: 1, source: "STATIC_FALLBACK", derivedFrom: ["ALSO_BOGUS"] } } };
  const found = validateRowProvenance(badRow).map((i) => i.code);
  assert.ok(found.includes("UNKNOWN_PROVENANCE"));
  assert.equal(validateRowProvenance(badRow).length, 2);
  // a clean adapter row validates with zero provenance issues
  const { rows } = buildPartsWorkspace({ canonicalParts: CANONICAL, staticCatalogParts: STATIC });
  assert.equal(validateRowProvenance(rows[0]).length, 0);
});

// ---- G. Purity -------------------------------------------------------------
check("G. same frozen inputs produce deep-equal output; inputs not mutated", () => {
  const inputs = Object.freeze({ canonicalParts: Object.freeze(CANONICAL.map((c) => Object.freeze({ ...c }))),
    staticCatalogParts: Object.freeze(STATIC.map((s) => Object.freeze({ ...s }))) });
  const before = JSON.stringify(inputs);
  const a = buildPartsWorkspace(inputs);
  const b = buildPartsWorkspace(inputs);
  assert.equal(JSON.stringify(a), JSON.stringify(b));  // deterministic
  assert.equal(JSON.stringify(inputs), before);        // inputs not mutated
});
check("G. module imports no Firebase SDK, no Firebase config, and no query service", () => {
  assert.ok(!/from\s+["'][^"']*firebase/i.test(ADAPTER_SRC), "no firebase import");
  assert.ok(!/partMasterQueries/.test(ADAPTER_SRC), "no partMasterQueries import");
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|import\s+.*firebaseConfig/i.test(ADAPTER_SRC), "no network/config");
});
check("G. normalizeUnit is a pure token map (ea->EACH, unknown->UPPER)", () => {
  assert.equal(normalizeUnit("ea"), "EACH");
  assert.equal(normalizeUnit("kit"), "KIT");
  assert.equal(normalizeUnit("widget"), "WIDGET");
  assert.equal(normalizeUnit(""), null);
});

console.log(`\n${passed} passed`);
void here; void PROVENANCE;
