// INV-CONVERGENCE-D -- pure, read-only Inventory -> Parts compatibility adapter.
//
// Composes a PartWorkspace-compatible read model from three explicitly-injected
// layers (canonical `parts`, static catalog, ledger/workflow overlay) WITHOUT any
// network, Firebase SDK, Firebase config, or Firestore query-service import. It adds
// NO new inventory mathematics: availability and the reserved/released/consumed
// overlay are INJECTED (computed upstream by the existing behavior) and passed
// through verbatim. Every output field carries an explicit provenance classification.
//
// This module wires into NO UI or runtime consumer. It authorizes no source switch.
// Offline parity proven against it (partsCompatibilityAdapter.test.mjs) is NOT the
// live pre-cutover shadow-parity required before any future switch.
//
// Governance: docs/architecture/inventory-parts-authority-contract.md;
// DECISIONS.md #43-#45. Approved static-only exclusions are the INV-CONVERGENCE-B ten.

/** Allowed primary provenance classifications (authority contract §4). */
export const PROVENANCE = Object.freeze([
  "CANONICAL",
  "STATIC_FALLBACK",
  "LEDGER_DERIVED",
  "WORKFLOW_DERIVED",
  "HISTORICAL_SNAPSHOT",
]);

/** Deterministic per-row identity states. */
export const IDENTITY_STATES = Object.freeze(["CANONICAL_MATCH", "STATIC_ONLY_EXCLUDED"]);

/** The exact approved static-only exclusions (INV-CONVERGENCE-B; Decision #44).
 * These ten may remain represented via static compatibility to preserve current
 * PartsList/PartDetail behavior, but must NEVER be represented as canonical. */
export const APPROVED_STATIC_ONLY_EXCLUSIONS = Object.freeze([
  "TST-1047", "TST-1070", "TST-1074", "TST-1080", "TST-1112",
  "TST-1136", "TST-1143", "TST-1175", "TST-1189", "TST-1193",
]);

const EXCLUSION_SET = new Set(APPROVED_STATIC_ONLY_EXCLUSIONS);

/** Static unit token -> canonical stocking unit. Mirrors the INV-CONVERGENCE-B
 * normalization; does not change any stored value. */
const UNIT_NORMALIZATION = Object.freeze({
  ea: "EACH", kit: "KIT", bottle: "BOTTLE", tube: "TUBE", box: "BOX",
  case: "CASE", foot: "FOOT", roll: "ROLL", gallon: "GALLON",
  ounce: "OUNCE", pound: "POUND", pair: "PAIR", set: "SET",
});

/** Normalize a static unit token to its canonical code (pure; upper-cases unknowns). */
export function normalizeUnit(unit) {
  if (typeof unit !== "string" || unit.length === 0) return null;
  return UNIT_NORMALIZATION[unit] ?? unit.toUpperCase();
}

const isStr = (v) => typeof v === "string" && v.length > 0;
const field = (value, source, derivedFrom) =>
  derivedFrom ? { value, source, derivedFrom } : { value, source };

/** Validate a single row's provenance: every field.source and every derivedFrom
 * entry must be a known classification. Returns an array of issue objects. */
export function validateRowProvenance(row) {
  const issues = [];
  const fields = row && row.fields ? row.fields : {};
  for (const [name, meta] of Object.entries(fields)) {
    if (!meta || !PROVENANCE.includes(meta.source)) {
      issues.push({ code: "UNKNOWN_PROVENANCE", key: row?.key, field: name, source: meta?.source });
    }
    if (Array.isArray(meta?.derivedFrom)) {
      for (const dep of meta.derivedFrom) {
        if (!PROVENANCE.includes(dep)) {
          issues.push({ code: "UNKNOWN_PROVENANCE", key: row?.key, field: name, source: dep });
        }
      }
    }
  }
  return issues;
}

/**
 * Build the read-only PartWorkspace composition.
 *
 * Inputs (all optional arrays/maps; nothing is mutated):
 *   - canonicalParts: [{ partId, internalPartNumber?, name?, category?, stockingUnit?,
 *                        status?, controlType?, stockingClass? }]
 *   - staticCatalogParts: [{ sku, name, category, unit, cost, price, reorderThreshold, warehouseQty }]
 *   - overlayBySku: { [sku]: { reserved?, released?, consumed?, availability? } }  // PRECOMPUTED upstream
 *   - workflowBySku: { [sku]: { reorderState?, purchasingState? } }
 *   - snapshotBySku: { [sku]: { ...historical display values } }                    // optional; test-only
 *
 * Returns { rows, issues, totals } deterministically (rows sorted by key).
 * Detects and REPORTS parity problems; never silently overwrites one source with
 * another in a way that hides divergence.
 */
export function buildPartsWorkspace(inputs = {}) {
  const canonicalParts = Array.isArray(inputs.canonicalParts) ? inputs.canonicalParts : [];
  const staticCatalogParts = Array.isArray(inputs.staticCatalogParts) ? inputs.staticCatalogParts : [];
  const overlayBySku = inputs.overlayBySku && typeof inputs.overlayBySku === "object" ? inputs.overlayBySku : {};
  const workflowBySku = inputs.workflowBySku && typeof inputs.workflowBySku === "object" ? inputs.workflowBySku : {};
  const snapshotBySku = inputs.snapshotBySku && typeof inputs.snapshotBySku === "object" ? inputs.snapshotBySku : {};

  const issues = [];

  // --- index canonical by partId, detecting duplicates and missing identifiers ---
  const canonicalById = new Map();
  for (const c of canonicalParts) {
    const partId = isStr(c?.partId) ? c.partId : null;
    if (partId === null) { issues.push({ code: "MISSING_IDENTIFIER", layer: "canonical" }); continue; }
    if (canonicalById.has(partId)) { issues.push({ code: "DUPLICATE_CANONICAL_PARTID", key: partId }); continue; }
    canonicalById.set(partId, c);
  }

  // --- index static by sku, detecting duplicates and missing identifiers ---
  const staticBySku = new Map();
  for (const s of staticCatalogParts) {
    const sku = isStr(s?.sku) ? s.sku : null;
    if (sku === null) { issues.push({ code: "MISSING_IDENTIFIER", layer: "static" }); continue; }
    if (staticBySku.has(sku)) { issues.push({ code: "DUPLICATE_STATIC_SKU", key: sku }); continue; }
    staticBySku.set(sku, s);
  }

  // --- canonical records with no static compatibility record (unexpected) ---
  for (const partId of canonicalById.keys()) {
    if (!staticBySku.has(partId)) {
      issues.push({ code: "CANONICAL_WITHOUT_STATIC", key: partId });
    }
  }

  const rows = [];
  for (const [sku, s] of staticBySku) {
    const canonical = canonicalById.get(sku) || null;
    const overlay = overlayBySku[sku] || {};
    const workflow = workflowBySku[sku] || {};
    const snapshot = snapshotBySku[sku] || null;

    // static compatibility enrichment (always STATIC_FALLBACK; never copied into `parts`)
    const staticFields = {
      cost: field(s.cost, "STATIC_FALLBACK"),
      price: field(s.price, "STATIC_FALLBACK"),
      reorderThreshold: field(s.reorderThreshold, "STATIC_FALLBACK"),
      warehouseQty: field(s.warehouseQty, "STATIC_FALLBACK"),
    };

    // ledger/workflow overlay -- values are INJECTED (upstream), passed through verbatim
    const overlayFields = {
      reserved: field(overlay.reserved ?? null, "LEDGER_DERIVED"),
      released: field(overlay.released ?? null, "LEDGER_DERIVED"),
      consumed: field(overlay.consumed ?? null, "LEDGER_DERIVED"),
      // current availability = static baseline - (reserved - released); mixed provenance.
      availability: field(overlay.availability ?? null, "STATIC_FALLBACK", ["STATIC_FALLBACK", "LEDGER_DERIVED"]),
      reorderState: field(workflow.reorderState ?? null, "WORKFLOW_DERIVED"),
      purchasingState: field(workflow.purchasingState ?? null, "WORKFLOW_DERIVED"),
    };
    if (snapshot) {
      overlayFields.historicalSnapshot = field(snapshot, "HISTORICAL_SNAPSHOT");
    }

    if (canonical) {
      // CANONICAL_MATCH: identity/governance authority is canonical; report any
      // descriptive divergence (never silently overwrite to hide it).
      const cName = isStr(canonical.name) ? canonical.name : null;
      const cUnit = isStr(canonical.stockingUnit) ? canonical.stockingUnit : null;
      const sName = isStr(s.name) ? s.name : null;
      const sUnitNorm = normalizeUnit(s.unit);
      if (cName !== null && sName !== null && cName !== sName) {
        issues.push({ code: "NAME_DIVERGENCE", key: sku, canonical: cName, static: sName });
      }
      if (cUnit !== null && sUnitNorm !== null && cUnit !== sUnitNorm) {
        issues.push({ code: "UNIT_DIVERGENCE", key: sku, canonical: cUnit, static: sUnitNorm });
      }

      const fields = {
        partId: field(canonical.partId, "CANONICAL"),
        ...(isStr(canonical.internalPartNumber) ? { internalPartNumber: field(canonical.internalPartNumber, "CANONICAL") } : {}),
        // canonical-preferred, static-compatibility fallback; source reflects actual origin
        name: cName !== null ? field(cName, "CANONICAL", sName !== null && sName !== cName ? ["CANONICAL", "STATIC_FALLBACK"] : undefined) : field(sName, "STATIC_FALLBACK"),
        category: isStr(canonical.category) ? field(canonical.category, "CANONICAL") : field(s.category, "STATIC_FALLBACK"),
        stockingUnit: cUnit !== null ? field(cUnit, "CANONICAL") : field(sUnitNorm, "STATIC_FALLBACK"),
        ...(isStr(canonical.status) ? { status: field(canonical.status, "CANONICAL") } : {}),
        ...(isStr(canonical.controlType) ? { controlType: field(canonical.controlType, "CANONICAL") } : {}),
        ...(isStr(canonical.stockingClass) ? { stockingClass: field(canonical.stockingClass, "CANONICAL") } : {}),
        ...staticFields,
        ...overlayFields,
      };
      rows.push({ key: sku, identityState: "CANONICAL_MATCH", fields });
    } else if (EXCLUSION_SET.has(sku)) {
      // STATIC_ONLY_EXCLUDED: represented purely via static compatibility; NEVER
      // inferred as canonical. Exclusion reason remains Decision #42 policy attribution.
      const fields = {
        partId: field(sku, "STATIC_FALLBACK"),
        name: field(isStr(s.name) ? s.name : null, "STATIC_FALLBACK"),
        category: field(s.category, "STATIC_FALLBACK"),
        stockingUnit: field(normalizeUnit(s.unit), "STATIC_FALLBACK"),
        ...staticFields,
        ...overlayFields,
      };
      rows.push({ key: sku, identityState: "STATIC_ONLY_EXCLUDED", fields });
    } else {
      // A static record with no canonical match that is NOT an approved exclusion.
      issues.push({ code: "STATIC_WITHOUT_CANONICAL_UNAPPROVED", key: sku });
      // not emitted as a normal row -- surfaced as an issue, never silently accepted
    }
  }

  rows.sort((a, b) => a.key.localeCompare(b.key));
  issues.sort((a, b) => (a.code + (a.key || "")).localeCompare(b.code + (b.key || "")));

  const totals = {
    staticCount: staticBySku.size,
    canonicalCount: canonicalById.size,
    canonicalMatch: rows.filter((r) => r.identityState === "CANONICAL_MATCH").length,
    staticOnlyExcluded: rows.filter((r) => r.identityState === "STATIC_ONLY_EXCLUDED").length,
    issueCount: issues.length,
  };

  return { rows, issues, totals };
}
