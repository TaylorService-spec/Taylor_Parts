"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OUT_OF_SCOPE_REFERENCE_SITES = exports.MANUFACTURER_REFERENCE_SITES = exports.PART_CANONICAL_REFERENCE_SELECT = exports.EQUIPMENT_MODEL_NAME_REFERENCE_SELECT = exports.EQUIPMENT_MODEL_CODE_REFERENCE_SELECT = exports.MANUFACTURER_IDENTITY_SELECT = exports.MATCH_RULES = exports.REFERENCE_DISPOSITIONS = exports.REFERENCE_SPACES = void 0;
exports.classifyReference = classifyReference;
exports.reconcileManufacturerReferences = reconcileManufacturerReferences;
exports.collectAndReconcileManufacturerReferences = collectAndReconcileManufacturerReferences;
const manufacturerMigration_1 = require("./manufacturerMigration");
const equipmentModel_1 = require("../../equipmentCompatibility/domain/equipmentModel");
/** Which identity space a reference is written in. The space decides which rules may be applied to it. */
exports.REFERENCE_SPACES = Object.freeze(["CANONICAL_ID", "CODE", "DISPLAY_NAME"]);
exports.REFERENCE_DISPOSITIONS = Object.freeze([
    "EXACT_CANONICAL", "DETERMINISTIC_MAPPING", "AMBIGUOUS", "ORPHAN", "FREE_TEXT_ONLY",
]);
/** The derivation that produced a candidate. Named on every result, so a reviewer sees the reason, not a verdict. */
exports.MATCH_RULES = Object.freeze([
    /** The reference string IS a Manufacturer id. */
    "ID_EQUALITY",
    /** normalizeManufacturerId(manufacturer.name) === the reference code. */
    "CODE_DERIVED_FROM_NAME",
    /** normalizeName(manufacturer.name) === normalizeName(the reference display string). */
    "NORMALIZED_NAME_EQUALITY",
    /** No derivation produced a candidate. */
    "NONE",
]);
const sorted = (xs) => Object.freeze([...new Set(xs)].sort());
/**
 * Classify ONE reference against the governed Manufacturer set.
 *
 * The space decides the rules, and no rule is ever borrowed across spaces:
 *
 *   CANONICAL_ID   id equality, and nothing else. An id that names no Manufacturer is ORPHAN -- a broken
 *                  pointer. It is NOT then matched by name: an identity that resolves to nothing is a defect
 *                  to report, and re-pointing it at a similarly-named row would invent a relationship the
 *                  data never asserted.
 *   CODE           id equality FIRST (a code that is literally a Manufacturer id is the strongest evidence
 *                  available), then the code derivation. Unresolved is ORPHAN: a code is identity-shaped and
 *                  the model it belongs to claims a manufacturer that is not mastered.
 *   DISPLAY_NAME   the name derivation only. Unresolved is FREE_TEXT_ONLY, never ORPHAN -- a display string
 *                  never pointed at a Manufacturer, so it cannot be dangling. It is text that has not been
 *                  mastered, which is a different fact and gets a different word.
 */
function classifyReference(reference, manufacturers) {
    const value = typeof reference.value === "string" ? reference.value : "";
    const rowIds = sorted(reference.referencingRowIds ?? []);
    const base = {
        site: reference.site, space: reference.space, value,
        referencingRowIds: rowIds, referencingRowCount: rowIds.length,
    };
    const settle = (disposition, rule, candidates, derivedKey) => {
        const ids = sorted(candidates);
        return Object.freeze({
            ...base, disposition, rule, candidateManufacturerIds: ids,
            resolvedManufacturerId: ids.length === 1 ? ids[0] : null, derivedKey,
        });
    };
    if (reference.space === "CANONICAL_ID") {
        const exact = manufacturers.filter((m) => m.id === value).map((m) => m.id);
        return exact.length > 0
            ? settle("EXACT_CANONICAL", "ID_EQUALITY", exact, value)
            : settle("ORPHAN", "NONE", [], value);
    }
    if (reference.space === "CODE") {
        const exact = manufacturers.filter((m) => m.id === value).map((m) => m.id);
        if (exact.length > 0)
            return settle("EXACT_CANONICAL", "ID_EQUALITY", exact, value);
        const derived = manufacturers.filter((m) => (0, equipmentModel_1.normalizeManufacturerId)(m.name) === value).map((m) => m.id);
        if (derived.length === 1)
            return settle("DETERMINISTIC_MAPPING", "CODE_DERIVED_FROM_NAME", derived, value);
        if (derived.length > 1)
            return settle("AMBIGUOUS", "CODE_DERIVED_FROM_NAME", derived, value);
        return settle("ORPHAN", "NONE", [], value);
    }
    const key = (0, manufacturerMigration_1.normalizeName)(value);
    // An empty or whitespace-only display string derives to nothing, and nothing must not match a Manufacturer
    // whose name somehow also derives to nothing -- so the empty key never resolves.
    const derived = key === "" ? [] : manufacturers.filter((m) => (0, manufacturerMigration_1.normalizeName)(m.name) === key).map((m) => m.id);
    if (derived.length === 1)
        return settle("DETERMINISTIC_MAPPING", "NORMALIZED_NAME_EQUALITY", derived, key);
    if (derived.length > 1)
        return settle("AMBIGUOUS", "NORMALIZED_NAME_EQUALITY", derived, key);
    return settle("FREE_TEXT_ONLY", "NONE", [], key);
}
const zeroCounts = () => Object.fromEntries(exports.REFERENCE_DISPOSITIONS.map((d) => [d, 0]));
/** Classify every reference and summarise. Pure: it decides nothing about what to do next. */
function reconcileManufacturerReferences(references, manufacturers) {
    const rows = [...references]
        .map((r) => classifyReference(r, manufacturers))
        .sort((a, b) => (a.site < b.site ? -1 : a.site > b.site ? 1 : a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
    const byDisposition = zeroCounts();
    const bySite = {};
    for (const r of rows) {
        byDisposition[r.disposition] += 1;
        (bySite[r.site] ??= zeroCounts())[r.disposition] += 1;
    }
    const unresolvedIdentity = rows.filter((r) => r.space !== "DISPLAY_NAME" && r.disposition !== "EXACT_CANONICAL" && r.disposition !== "DETERMINISTIC_MAPPING");
    const requiresRuling = rows.filter((r) => r.disposition === "AMBIGUOUS" || r.disposition === "ORPHAN");
    return Object.freeze({
        manufacturerCount: manufacturers.length,
        referenceValueCount: rows.length,
        referencingRowCount: rows.reduce((n, r) => n + r.referencingRowCount, 0),
        rows: Object.freeze(rows),
        byDisposition: Object.freeze(byDisposition),
        bySite: Object.freeze(Object.fromEntries(Object.entries(bySite).map(([k, v]) => [k, Object.freeze(v)]))),
        identityGraphResolved: unresolvedIdentity.length === 0,
        requiresRuling: Object.freeze(requiresRuling),
    });
}
// ════════════════════ THE READS ════════════════════
//
// SELECT ONLY. These four statements are the whole of this module's database contact. Each groups a site's
// distinct values with the rows carrying them, so the classifier sees one row per VALUE and a reviewer still
// sees which records are affected.
exports.MANUFACTURER_IDENTITY_SELECT = `
SELECT id, name, status FROM eos_ops.manufacturers WHERE tenant_id = $1 ORDER BY id`;
exports.EQUIPMENT_MODEL_CODE_REFERENCE_SELECT = `
SELECT manufacturer_id AS value, array_agg(id ORDER BY id) AS row_ids
  FROM eos_ops.equipment_models WHERE tenant_id = $1 GROUP BY manufacturer_id ORDER BY manufacturer_id`;
exports.EQUIPMENT_MODEL_NAME_REFERENCE_SELECT = `
SELECT manufacturer_name AS value, array_agg(id ORDER BY id) AS row_ids
  FROM eos_ops.equipment_models WHERE tenant_id = $1 GROUP BY manufacturer_name ORDER BY manufacturer_name`;
exports.PART_CANONICAL_REFERENCE_SELECT = `
SELECT primary_manufacturer_id AS value, array_agg(id ORDER BY id) AS row_ids
  FROM eos_ops.parts WHERE tenant_id = $1 AND primary_manufacturer_id IS NOT NULL
 GROUP BY primary_manufacturer_id ORDER BY primary_manufacturer_id`;
/** The declared reference sites, in one list, so adding a site is one edit and the census cannot drift from it. */
exports.MANUFACTURER_REFERENCE_SITES = Object.freeze([
    Object.freeze({ site: "eos_ops.parts.primary_manufacturer_id", space: "CANONICAL_ID", select: exports.PART_CANONICAL_REFERENCE_SELECT }),
    Object.freeze({ site: "eos_ops.equipment_models.manufacturer_id", space: "CODE", select: exports.EQUIPMENT_MODEL_CODE_REFERENCE_SELECT }),
    Object.freeze({ site: "eos_ops.equipment_models.manufacturer_name", space: "DISPLAY_NAME", select: exports.EQUIPMENT_MODEL_NAME_REFERENCE_SELECT }),
]);
/**
 * Sites that exist but are NOT in PostgreSQL, reported so a zero is never mistaken for a clean bill.
 *
 * `equipment.manufacturer` is free text on the Firestore document and was deliberately not carried into
 * eos_ops.equipment (migration 1758585600000). A PostgreSQL reconciliation cannot see it, and saying nothing
 * about it would read as "no such references exist".
 */
exports.OUT_OF_SCOPE_REFERENCE_SITES = Object.freeze([
    Object.freeze({
        site: "firestore:equipment.manufacturer",
        space: "DISPLAY_NAME",
        reason: "free text on the Firestore equipment document; eos_ops.equipment has no manufacturer column, so PostgreSQL cannot observe it",
    }),
]);
/** Read every declared site, READ-ONLY, and classify. The only function here that touches a database. */
async function collectAndReconcileManufacturerReferences(db, tenantId) {
    const identities = await db.query(exports.MANUFACTURER_IDENTITY_SELECT, [tenantId]);
    const manufacturers = identities.rows.map((r) => ({
        id: String(r.id), name: String(r.name), status: String(r.status),
    }));
    const references = [];
    for (const declared of exports.MANUFACTURER_REFERENCE_SITES) {
        const { rows } = await db.query(declared.select, [tenantId]);
        for (const r of rows) {
            references.push({
                site: declared.site, space: declared.space, value: String(r.value),
                referencingRowIds: (r.row_ids ?? []).map(String),
            });
        }
    }
    return reconcileManufacturerReferences(references, manufacturers);
}
//# sourceMappingURL=manufacturerReferenceReconciliation.js.map