// MANUFACTURER REFERENCE RECONCILIATION -- which existing references resolve to a governed Manufacturer,
// which do not, and WHY, with the evidence attached to every answer.
//
// ════════════════════ IT PROPOSES. IT NEVER APPLIES ════════════════════
//
// Nothing here writes. Not to eos_ops.manufacturers, not to the tables that reference it. The output is a
// classification and a candidate list an operator reviews; adopting a mapping is a separate, authorized act.
// That is the whole design constraint: dependent data is not modified because a report was convincing.
//
// ════════════════════ THE THREE IDENTITY SPACES, MEASURED NOT ASSUMED ════════════════════
//
// An information_schema sweep of the nonprod database (2026-09-23) finds exactly four columns anywhere whose
// name contains "manufacturer", and they are three different kinds of thing:
//
//   eos_ops.equipment_models.manufacturer_id      CODE           NOT NULL, CHECK '^[A-Z0-9]+(-[A-Z0-9]+)*$'
//   eos_ops.equipment_models.manufacturer_name    DISPLAY_NAME   NOT NULL, free text
//   eos_ops.parts.primary_manufacturer_id         CANONICAL_ID   NULL-able, CHECK '^[A-Za-z0-9_-]{1,64}$'
//   eos_ops.parts.primary_manufacturer_part_number               a PART number, not a manufacturer reference
//
// eos_ops.equipment has NO manufacturer column at all: migration 1758585600000 says so in as many words -- the
// live register keeps `manufacturer` and `model` as free strings in Firestore and neither was ever carried
// across. That free text is therefore OUT OF SCOPE for a PostgreSQL reconciliation, and is reported as such
// rather than silently counted as zero.
//
// Not one of these columns is a FOREIGN KEY to eos_ops.manufacturers, and that is deliberate upstream:
// migration 1759881600000 records primary_manufacturer_id as an "opaque key: `manufacturers` is still
// Firestore-only and the Firestore command never checked its existence either". So a dangling reference is a
// real, expected state -- not a corruption -- and must be REPORTED, never repaired by inference.
//
// ════════════════════ WHY A CODE IS NOT AN ID, AND WHAT MAY BE DERIVED ════════════════════
//
// equipment_models.manufacturer_id is NOT a Manufacturer id. It is the manufacturer half of the canonical
// `{manufacturerId}--{modelNumber}` model id, minted by equipmentCompatibility/domain/equipmentModel.ts
// #normalizeManufacturerId from the manufacturer's NAME: NFKC, trim, collapse whitespace, uppercase, then every
// run of non-[A-Z0-9] to a single hyphen. "Taylor Company" becomes TAYLOR-COMPANY.
//
// A Manufacturer's own normalized_name uses a DIFFERENT rule -- manufacturerMigration.ts#normalizeName: trim,
// collapse whitespace, uppercase, and nothing else. "Taylor Company" becomes "TAYLOR COMPANY".
//
// Two spaces, two derivations, both already authoritative somewhere. So a CODE resolves to a Manufacturer only
// by RE-DERIVING the code from that Manufacturer's own name with the code space's own function, and a
// DISPLAY_NAME resolves only by re-deriving the normalized name with the name space's own function. That is a
// derivation, which is evidence. It is not a resemblance.
//
// NOTHING IS MERGED ON RESEMBLANCE. "Taylor" and "TAYLOR" are the same normalized name and would be reported
// as ONE candidate for that reason and no other. "Taylor" and "Taylor Co" are two candidates or none, never
// one: they do not derive to the same value, and deciding they are the same company is a business ruling, not
// a string operation. Where more than one Manufacturer derives to the reference, the result is AMBIGUOUS with
// every candidate named -- the tooling refuses to pick, because picking would be guessing.
//
// ════════════════════ MEASURED STATE, NONPROD, 2026-09-23 ════════════════════
//
//   eos_ops.manufacturers      0 rows
//   eos_ops.equipment_models   4 rows -- 2 distinct codes (FIXTUREWORKS, SAMPLECO), 2 distinct display names,
//                                all four carrying the literal marker "SYNTHETIC ... (fixture)"
//   eos_ops.parts              0 rows
//   eos_ops.equipment          0 rows
//
// With an empty Manufacturer table every reference is unresolved BY CONSTRUCTION. That is the honest state and
// the classifier states it as such; it is not a reason to mint Manufacturer rows out of reference strings,
// which would make the references self-justifying and name companies nobody mastered.
//
// PURE CORE, INJECTED ROWS. The classifier imports no database driver and performs no I/O. The one function
// that touches PostgreSQL runs the SELECTs declared below and nothing else.
import type { Pool, PoolClient } from "pg";
import { normalizeName } from "./manufacturerMigration";
import { normalizeManufacturerId } from "../../equipmentCompatibility/domain/equipmentModel";

/** Which identity space a reference is written in. The space decides which rules may be applied to it. */
export const REFERENCE_SPACES = Object.freeze(["CANONICAL_ID", "CODE", "DISPLAY_NAME"] as const);
export type ReferenceSpace = (typeof REFERENCE_SPACES)[number];

export const REFERENCE_DISPOSITIONS = Object.freeze([
  "EXACT_CANONICAL", "DETERMINISTIC_MAPPING", "AMBIGUOUS", "ORPHAN", "FREE_TEXT_ONLY",
] as const);
export type ReferenceDisposition = (typeof REFERENCE_DISPOSITIONS)[number];

/** The derivation that produced a candidate. Named on every result, so a reviewer sees the reason, not a verdict. */
export const MATCH_RULES = Object.freeze([
  /** The reference string IS a Manufacturer id. */
  "ID_EQUALITY",
  /** normalizeManufacturerId(manufacturer.name) === the reference code. */
  "CODE_DERIVED_FROM_NAME",
  /** normalizeName(manufacturer.name) === normalizeName(the reference display string). */
  "NORMALIZED_NAME_EQUALITY",
  /** No derivation produced a candidate. */
  "NONE",
] as const);
export type MatchRule = (typeof MATCH_RULES)[number];

/** One governed Manufacturer, as eos_ops.manufacturers holds it. */
export interface ManufacturerIdentity {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

/** One distinct reference VALUE at one site, with the rows that carry it. */
export interface ManufacturerReference {
  /** Fully-qualified column, e.g. "eos_ops.equipment_models.manufacturer_id". */
  readonly site: string;
  readonly space: ReferenceSpace;
  readonly value: string;
  /** Identities of the referencing rows, so a reviewer can go and look. Sorted, de-duplicated. */
  readonly referencingRowIds: readonly string[];
}

export interface ReferenceClassification {
  readonly site: string;
  readonly space: ReferenceSpace;
  readonly value: string;
  readonly referencingRowIds: readonly string[];
  readonly referencingRowCount: number;
  readonly disposition: ReferenceDisposition;
  readonly rule: MatchRule;
  /** Every Manufacturer the rule produced, id-sorted. Exactly one for a resolved reference, >1 for AMBIGUOUS. */
  readonly candidateManufacturerIds: readonly string[];
  /** The one candidate, only when there is exactly one. Null otherwise -- including for AMBIGUOUS. */
  readonly resolvedManufacturerId: string | null;
  /** What was compared, in the space's own terms. The evidence a reviewer checks the verdict against. */
  readonly derivedKey: string;
}

const sorted = (xs: readonly string[]): readonly string[] => Object.freeze([...new Set(xs)].sort());

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
export function classifyReference(
  reference: ManufacturerReference,
  manufacturers: readonly ManufacturerIdentity[],
): ReferenceClassification {
  const value = typeof reference.value === "string" ? reference.value : "";
  const rowIds = sorted(reference.referencingRowIds ?? []);
  const base = {
    site: reference.site, space: reference.space, value,
    referencingRowIds: rowIds, referencingRowCount: rowIds.length,
  };
  const settle = (
    disposition: ReferenceDisposition, rule: MatchRule, candidates: readonly string[], derivedKey: string,
  ): ReferenceClassification => {
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
    if (exact.length > 0) return settle("EXACT_CANONICAL", "ID_EQUALITY", exact, value);
    const derived = manufacturers.filter((m) => normalizeManufacturerId(m.name) === value).map((m) => m.id);
    if (derived.length === 1) return settle("DETERMINISTIC_MAPPING", "CODE_DERIVED_FROM_NAME", derived, value);
    if (derived.length > 1) return settle("AMBIGUOUS", "CODE_DERIVED_FROM_NAME", derived, value);
    return settle("ORPHAN", "NONE", [], value);
  }

  const key = normalizeName(value);
  // An empty or whitespace-only display string derives to nothing, and nothing must not match a Manufacturer
  // whose name somehow also derives to nothing -- so the empty key never resolves.
  const derived = key === "" ? [] : manufacturers.filter((m) => normalizeName(m.name) === key).map((m) => m.id);
  if (derived.length === 1) return settle("DETERMINISTIC_MAPPING", "NORMALIZED_NAME_EQUALITY", derived, key);
  if (derived.length > 1) return settle("AMBIGUOUS", "NORMALIZED_NAME_EQUALITY", derived, key);
  return settle("FREE_TEXT_ONLY", "NONE", [], key);
}

export interface ReconciliationReport {
  readonly manufacturerCount: number;
  readonly referenceValueCount: number;
  readonly referencingRowCount: number;
  readonly rows: readonly ReferenceClassification[];
  /** Count per disposition; every disposition is present, including the zeroes. */
  readonly byDisposition: Readonly<Record<ReferenceDisposition, number>>;
  /** Count per site, so "which table is the problem" is answerable without re-reading the rows. */
  readonly bySite: Readonly<Record<string, Readonly<Record<ReferenceDisposition, number>>>>;
  /**
   * Is the reference graph fully resolved?
   *
   * TRUE only when every reference in an IDENTITY space (CANONICAL_ID, CODE) resolves to exactly one
   * Manufacturer. A FREE_TEXT_ONLY display string does NOT block it: mastering every string somebody typed is
   * a business decision, not a precondition for the identity graph being sound. AMBIGUOUS always blocks -- an
   * unresolved choice between two real companies is exactly the thing nobody may guess at.
   */
  readonly identityGraphResolved: boolean;
  /** The values a human must rule on, in one list, sorted by site then value. Empty when there is nothing to rule on. */
  readonly requiresRuling: readonly ReferenceClassification[];
}

const zeroCounts = (): Record<ReferenceDisposition, number> =>
  Object.fromEntries(REFERENCE_DISPOSITIONS.map((d) => [d, 0])) as Record<ReferenceDisposition, number>;

/** Classify every reference and summarise. Pure: it decides nothing about what to do next. */
export function reconcileManufacturerReferences(
  references: readonly ManufacturerReference[],
  manufacturers: readonly ManufacturerIdentity[],
): ReconciliationReport {
  const rows = [...references]
    .map((r) => classifyReference(r, manufacturers))
    .sort((a, b) => (a.site < b.site ? -1 : a.site > b.site ? 1 : a.value < b.value ? -1 : a.value > b.value ? 1 : 0));

  const byDisposition = zeroCounts();
  const bySite: Record<string, Record<ReferenceDisposition, number>> = {};
  for (const r of rows) {
    byDisposition[r.disposition] += 1;
    (bySite[r.site] ??= zeroCounts())[r.disposition] += 1;
  }
  const unresolvedIdentity = rows.filter(
    (r) => r.space !== "DISPLAY_NAME" && r.disposition !== "EXACT_CANONICAL" && r.disposition !== "DETERMINISTIC_MAPPING");
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

export const MANUFACTURER_IDENTITY_SELECT = `
SELECT id, name, status FROM eos_ops.manufacturers WHERE tenant_id = $1 ORDER BY id`;

export const EQUIPMENT_MODEL_CODE_REFERENCE_SELECT = `
SELECT manufacturer_id AS value, array_agg(id ORDER BY id) AS row_ids
  FROM eos_ops.equipment_models WHERE tenant_id = $1 GROUP BY manufacturer_id ORDER BY manufacturer_id`;

export const EQUIPMENT_MODEL_NAME_REFERENCE_SELECT = `
SELECT manufacturer_name AS value, array_agg(id ORDER BY id) AS row_ids
  FROM eos_ops.equipment_models WHERE tenant_id = $1 GROUP BY manufacturer_name ORDER BY manufacturer_name`;

export const PART_CANONICAL_REFERENCE_SELECT = `
SELECT primary_manufacturer_id AS value, array_agg(id ORDER BY id) AS row_ids
  FROM eos_ops.parts WHERE tenant_id = $1 AND primary_manufacturer_id IS NOT NULL
 GROUP BY primary_manufacturer_id ORDER BY primary_manufacturer_id`;

/** The declared reference sites, in one list, so adding a site is one edit and the census cannot drift from it. */
export const MANUFACTURER_REFERENCE_SITES = Object.freeze([
  Object.freeze({ site: "eos_ops.parts.primary_manufacturer_id", space: "CANONICAL_ID" as ReferenceSpace, select: PART_CANONICAL_REFERENCE_SELECT }),
  Object.freeze({ site: "eos_ops.equipment_models.manufacturer_id", space: "CODE" as ReferenceSpace, select: EQUIPMENT_MODEL_CODE_REFERENCE_SELECT }),
  Object.freeze({ site: "eos_ops.equipment_models.manufacturer_name", space: "DISPLAY_NAME" as ReferenceSpace, select: EQUIPMENT_MODEL_NAME_REFERENCE_SELECT }),
]);

/**
 * Sites that exist but are NOT in PostgreSQL, reported so a zero is never mistaken for a clean bill.
 *
 * `equipment.manufacturer` is free text on the Firestore document and was deliberately not carried into
 * eos_ops.equipment (migration 1758585600000). A PostgreSQL reconciliation cannot see it, and saying nothing
 * about it would read as "no such references exist".
 */
export const OUT_OF_SCOPE_REFERENCE_SITES = Object.freeze([
  Object.freeze({
    site: "firestore:equipment.manufacturer",
    space: "DISPLAY_NAME" as ReferenceSpace,
    reason: "free text on the Firestore equipment document; eos_ops.equipment has no manufacturer column, so PostgreSQL cannot observe it",
  }),
]);

/** Read every declared site, READ-ONLY, and classify. The only function here that touches a database. */
export async function collectAndReconcileManufacturerReferences(
  db: Pick<Pool | PoolClient, "query">,
  tenantId: string,
): Promise<ReconciliationReport> {
  const identities = await db.query(MANUFACTURER_IDENTITY_SELECT, [tenantId]);
  const manufacturers: ManufacturerIdentity[] = identities.rows.map((r: Record<string, unknown>) => ({
    id: String(r.id), name: String(r.name), status: String(r.status),
  }));
  const references: ManufacturerReference[] = [];
  for (const declared of MANUFACTURER_REFERENCE_SITES) {
    const { rows } = await db.query(declared.select, [tenantId]);
    for (const r of rows as Record<string, unknown>[]) {
      references.push({
        site: declared.site, space: declared.space, value: String(r.value),
        referencingRowIds: ((r.row_ids as unknown[]) ?? []).map(String),
      });
    }
  }
  return reconcileManufacturerReferences(references, manufacturers);
}
