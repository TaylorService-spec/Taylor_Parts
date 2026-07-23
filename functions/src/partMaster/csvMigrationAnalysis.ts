// INV-1 Phase 1, PR 1.8 -- Part Master CSV DRY-RUN migration analysis
// (ADR-008 Accepted / Decision #40). Pure core: parse a CSV (RFC-4180-style,
// same conventions as the client's contactCsvImport house pattern),
// normalize identifiers through the single PR 1.1/1.3 authorities, evaluate
// rows against injected current-state lookups (catalog/Part/alias), and
// classify deterministically. ANALYSIS ONLY -- this module has no write
// capability of any kind; a malformed row NEVER throws (it classifies
// INVALID); the run is aborted only for unusable files/configuration.

import { getCatalogItem } from "../data/partsCatalog";
import { validatePart } from "./validation";
import { normalizeIdentifier } from "./normalization";
import { deriveAliasDocId, type StoredPartAlias } from "./partAliasRepository";
import type { StoredPart } from "./partMasterRepository";
import { isUnitCode } from "./units";

// ---------------------------------------------------------------------------
// CSV parsing (RFC-4180-style: quoted fields, embedded commas/quotes/newlines)
// ---------------------------------------------------------------------------
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); if (row.length > 1 || row[0] !== "") rows.push(row); }
  return rows;
}

export const REQUIRED_COLUMNS = ["internalPartNumber", "name", "controlType", "stockingClass", "stockingUnit"] as const;
export const OPTIONAL_COLUMNS = ["partId", "description", "category", "legacySku", "qtyOnHand", "qtyInformational"] as const;

export type RowClassification = "CREATE" | "UPDATE" | "NO_CHANGE" | "CONFLICT" | "INVALID";

export type RowReasonCode =
  | "NEW_PART" // CREATE
  | "FIELDS_DIFFER" // UPDATE
  | "IDENTICAL" // NO_CHANGE
  | "DUPLICATE_PART_ID_IN_FILE"
  | "DUPLICATE_IPN_IN_FILE"
  | "ALIAS_OWNED_BY_OTHER_PART"
  | "TARGET_PART_INACTIVE"
  | "IMMUTABLE_ID_MUTATION"
  | "AMBIGUOUS_CREATE_VS_UPDATE"
  | "MULTIPLE_MATCHES"
  | "MALFORMED_IDENTIFIER"
  | "UNKNOWN_UNIT"
  | "DOMAIN_VALIDATION_FAILED"
  | "MISSING_REQUIRED_FIELD";

export interface RowResult {
  readonly rowNumber: number; // 1-based, excluding header
  readonly normalizedLegacyId: string | null;
  readonly proposedPartId: string | null;
  readonly classification: RowClassification;
  readonly reasonCode: RowReasonCode;
  readonly reason: string;
  readonly currentSummary: string | null;
  readonly proposedSummary: string | null;
  readonly aliasImplications: readonly string[];
  readonly unitCompatible: boolean;
  readonly informationalQuantities: Readonly<Record<string, string>>;
}

export interface AnalysisLookups {
  /** stored ACTIVE-or-any Part by id, or null. */
  getPart(partId: string): Promise<StoredPart | null>;
  /** stored alias by deterministic doc id, or null. */
  getAlias(aliasId: string): Promise<StoredPartAlias | null>;
}

export interface AnalysisResult {
  readonly rows: RowResult[];
  readonly counts: Readonly<Record<RowClassification, number>>;
  readonly reasonCounts: Readonly<Record<string, number>>;
  readonly duplicateCount: number;
  readonly conflictCount: number;
  readonly ignoredInformationalColumns: readonly string[];
}

export class UnusableCsvError extends Error {}

function summarizePart(p: { internalPartNumber: string; name: string; status?: string; stockingUnit: string }): string {
  return `${p.internalPartNumber} "${p.name}" unit=${p.stockingUnit}${p.status ? ` status=${p.status}` : ""}`;
}

/** Analyze parsed CSV content. Throws UnusableCsvError ONLY for unusable
 * files (missing header/required columns); individual bad rows classify
 * INVALID/CONFLICT and never abort the run. */
export async function analyzeCsv(text: string, lookups: AnalysisLookups): Promise<AnalysisResult> {
  const parsed = parseCsv(text);
  if (parsed.length < 1) throw new UnusableCsvError("CSV has no header row");
  const header = parsed[0].map((h) => h.trim());
  for (const col of REQUIRED_COLUMNS) {
    if (!header.includes(col)) throw new UnusableCsvError(`CSV is missing required column "${col}"`);
  }
  const idx = (col: string) => header.indexOf(col);
  const informational = header.filter((h) => h.startsWith("qty"));

  // First pass: in-file duplicate detection (partId + normalized IPN).
  const seenPartIds = new Map<string, number>();
  const seenIpns = new Map<string, number>();
  const rows: RowResult[] = [];
  const counts: Record<RowClassification, number> = { CREATE: 0, UPDATE: 0, NO_CHANGE: 0, CONFLICT: 0, INVALID: 0 };
  const reasonCounts: Record<string, number> = {};
  let duplicateCount = 0;

  const push = (r: RowResult) => {
    rows.push(r);
    counts[r.classification] += 1;
    reasonCounts[r.reasonCode] = (reasonCounts[r.reasonCode] ?? 0) + 1;
  };

  for (let n = 1; n < parsed.length; n++) {
    const cells = parsed[n];
    const get = (col: string): string | undefined => {
      const i = idx(col);
      const v = i >= 0 ? cells[i]?.trim() : undefined;
      return v === "" ? undefined : v;
    };
    const rowNumber = n;
    const informationalQuantities: Record<string, string> = {};
    for (const col of informational) if (get(col) !== undefined) informationalQuantities[col] = get(col) as string;

    const rawIpn = get("internalPartNumber");
    const normalizedIpn = rawIpn !== undefined ? normalizeIdentifier("INTERNAL_PN", rawIpn) : null;
    const normalizedLegacyId = normalizedIpn?.valid ? normalizedIpn.value : null;
    const base = {
      rowNumber,
      normalizedLegacyId,
      aliasImplications: [] as string[],
      informationalQuantities,
    };
    const fail = (
      classification: RowClassification,
      reasonCode: RowReasonCode,
      reason: string,
      proposedPartId: string | null = null
    ) =>
      push({
        ...base,
        proposedPartId,
        classification,
        reasonCode,
        reason,
        currentSummary: null,
        proposedSummary: null,
        unitCompatible: false,
      });

    try {
      if (rawIpn === undefined || get("name") === undefined) {
        fail("INVALID", "MISSING_REQUIRED_FIELD", "internalPartNumber and name are required");
        continue;
      }
      if (normalizedIpn !== null && !normalizedIpn.valid) {
        fail("INVALID", "MALFORMED_IDENTIFIER", `internalPartNumber "${rawIpn}" fails normalization`);
        continue;
      }
      const unit = get("stockingUnit");
      if (!isUnitCode(unit)) {
        fail("INVALID", "UNKNOWN_UNIT", `stockingUnit "${String(unit)}" is not a governed unit`);
        continue;
      }

      // Duplicate detection (deterministic: first occurrence wins).
      const explicitPartId = get("partId");
      if (explicitPartId !== undefined) {
        if (seenPartIds.has(explicitPartId)) {
          duplicateCount++;
          fail("CONFLICT", "DUPLICATE_PART_ID_IN_FILE", `partId already appears at row ${seenPartIds.get(explicitPartId)}`, explicitPartId);
          continue;
        }
        seenPartIds.set(explicitPartId, rowNumber);
      }
      if (normalizedLegacyId !== null) {
        if (seenIpns.has(normalizedLegacyId)) {
          duplicateCount++;
          fail("CONFLICT", "DUPLICATE_IPN_IN_FILE", `normalized internalPartNumber already appears at row ${seenIpns.get(normalizedLegacyId)}`, explicitPartId ?? null);
          continue;
        }
        seenIpns.set(normalizedLegacyId, rowNumber);
      }

      // Identity resolution: explicit partId, else IPN alias, else LEGACY
      // alias, else grandfathered sku==IPN direct part, else catalog hint.
      const matches = new Map<string, string>(); // partId -> how
      if (explicitPartId !== undefined) {
        const direct = await lookups.getPart(explicitPartId);
        if (direct !== null) matches.set(direct.part.partId, "explicit partId");
      }
      for (const aliasType of ["INTERNAL_PN", "LEGACY"] as const) {
        const derived = deriveAliasDocId(aliasType, rawIpn);
        if (derived !== null) {
          const alias = await lookups.getAlias(derived.docId);
          if (alias !== null) matches.set(alias.partId, `${aliasType} alias`);
        }
      }
      const grandfathered = await lookups.getPart(rawIpn);
      if (grandfathered !== null) matches.set(grandfathered.part.partId, "grandfathered id");

      if (matches.size > 1) {
        fail("CONFLICT", "MULTIPLE_MATCHES", `identifier resolves to multiple Parts: ${[...matches.keys()].sort().join(", ")}`);
        continue;
      }
      const matchedPartId = matches.size === 1 ? [...matches.keys()][0] : null;
      if (explicitPartId !== undefined && matchedPartId !== null && explicitPartId !== matchedPartId) {
        fail("CONFLICT", "IMMUTABLE_ID_MUTATION", `row partId ${explicitPartId} conflicts with resolved canonical ${matchedPartId} -- canonical identity is immutable`, explicitPartId);
        continue;
      }
      if (explicitPartId !== undefined && matchedPartId === null && (await lookups.getAlias(deriveAliasDocId("INTERNAL_PN", rawIpn)?.docId ?? ("" as never))) !== null) {
        fail("CONFLICT", "AMBIGUOUS_CREATE_VS_UPDATE", "explicit partId is new but the internalPartNumber already belongs to an alias");
        continue;
      }

      const proposedPartId = matchedPartId ?? explicitPartId ?? rawIpn; // grandfathering: IPN becomes the id for creates
      const domainCheck = validatePart({
        partId: proposedPartId,
        internalPartNumber: rawIpn,
        name: get("name"),
        description: get("description"),
        category: get("category"),
        status: "DRAFT",
        stockingUnit: unit,
        controlType: get("controlType"),
        stockingClass: get("stockingClass"),
      });
      if (!domainCheck.valid) {
        fail("INVALID", "DOMAIN_VALIDATION_FAILED", domainCheck.errors.map((e) => `${e.path}:${e.code}`).join(","), proposedPartId);
        continue;
      }
      const proposed = domainCheck.value;
      const proposedSummary = summarizePart(proposed);
      const aliasImplications: string[] = [];
      const legacy = get("legacySku");
      if (legacy !== undefined) {
        const derived = deriveAliasDocId("LEGACY", legacy);
        if (derived === null) {
          fail("INVALID", "MALFORMED_IDENTIFIER", `legacySku "${legacy}" fails normalization`, proposedPartId);
          continue;
        }
        const owner = await lookups.getAlias(derived.docId);
        if (owner !== null && owner.partId !== proposedPartId) {
          fail("CONFLICT", "ALIAS_OWNED_BY_OTHER_PART", `legacySku alias belongs to part ${owner.partId}`, proposedPartId);
          continue;
        }
        aliasImplications.push(owner === null ? `would create LEGACY alias ${derived.docId}` : `LEGACY alias already owned by this part`);
      }

      if (matchedPartId === null) {
        push({ ...base, aliasImplications, proposedPartId, classification: "CREATE", reasonCode: "NEW_PART", reason: "no existing Part or alias matches this identifier", currentSummary: null, proposedSummary, unitCompatible: true });
        continue;
      }
      const existing = await lookups.getPart(matchedPartId);
      if (existing === null) {
        fail("CONFLICT", "ALIAS_OWNED_BY_OTHER_PART", `alias resolves to missing part ${matchedPartId}`, matchedPartId);
        continue;
      }
      if (existing.part.status !== "ACTIVE" && existing.part.status !== "DRAFT") {
        fail("CONFLICT", "TARGET_PART_INACTIVE", `target part is ${existing.part.status}`, matchedPartId);
        continue;
      }
      const differs =
        existing.part.name !== proposed.name ||
        (existing.part.description ?? null) !== (proposed.description ?? null) ||
        (existing.part.category ?? null) !== (proposed.category ?? null) ||
        existing.part.stockingUnit !== proposed.stockingUnit ||
        existing.part.controlType !== proposed.controlType ||
        existing.part.stockingClass !== proposed.stockingClass ||
        existing.part.internalPartNumber !== proposed.internalPartNumber;
      push({
        ...base,
        aliasImplications,
        proposedPartId: matchedPartId,
        classification: differs ? "UPDATE" : "NO_CHANGE",
        reasonCode: differs ? "FIELDS_DIFFER" : "IDENTICAL",
        reason: differs ? "descriptive fields differ from the current record" : "row matches the current record exactly",
        currentSummary: summarizePart({ ...existing.part, status: existing.part.status }),
        proposedSummary,
        unitCompatible: existing.part.stockingUnit === proposed.stockingUnit,
      });
    } catch (err) {
      // A row-level surprise NEVER aborts the run.
      fail("INVALID", "DOMAIN_VALIDATION_FAILED", `row evaluation error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Deterministic ordering by construction (input order); counts summed once.
  const conflictCount = counts.CONFLICT;
  void getCatalogItem; // catalog available for future column mappings; unused columns ignored deliberately
  return { rows, counts, reasonCounts, duplicateCount, conflictCount, ignoredInformationalColumns: informational };
}
