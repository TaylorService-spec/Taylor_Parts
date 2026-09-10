// SCANNER PART LOOKUP -- the ONE governed read the scanner uses to learn what Part a scan names.
//
// Before this, Scan -> Lookup read the whole `parts` collection and Scan -> Move stock read `parts`
// documents directly from the browser. firestore.rules admits that read only for admin/dispatcher and
// the PARTS_MANAGER / WAREHOUSE_MANAGER operational roles, so a Parts Associate -- the person the
// scanner is for -- was refused. The fix is NOT a wider Rule: it is this bounded server read.
//
// WHAT IT DOES, and nothing more:
//   1. the Part whose own code the scan is (a document GET by id, exact and upper-cased -- the client's
//      resolveScannedIdentity matches a Part code case-insensitively on partId);
//   2. the registered identifier the scan is, through the canonical resolveScannedPartIdentifier --
//      reused unchanged, not re-implemented -- when the caller holds inventory.catalog.alias.read;
//   3. the Part that identifier points to, when it points to exactly one.
// At most three document reads. The client sends a scanned value; it cannot name a collection, a
// field, a filter, an order or a cursor.
//
// WHAT IT RETURNS: the catalogue fields the client's toPartView already reads, for those <=3 Parts,
// and the resolver's answer verbatim -- so the client keeps its single identity state machine
// (domain/partLookup.js buildPartLookup) instead of growing a second one here. No cost, no price, no
// supplier terms: the projection is an allow-list.
//
// AUTHORITY: inventory.catalog.read (reading the Part record) is required. Alias resolution needs
// inventory.catalog.alias.read in addition; without it the Part-code half still answers and the alias
// half says DENIED, exactly as the client already renders it.

import type { Firestore } from "firebase-admin/firestore";
import { PARTS_COLLECTION } from "./partMasterRepository.js";
import { resolveScannedPartIdentifier, type ScannedIdentifierResolution } from "./partAliasScanResolver.js";

/** Catalogue fields a scanner may see -- exactly what the client's toPartView reads. */
export const SCANNER_PART_FIELDS = Object.freeze([
  "partId", "internalPartNumber", "name", "description", "category", "status", "stockingUnit",
  "controlType", "stockingClass", "primaryManufacturerId", "primaryManufacturerPartNumber", "oemStatus", "version",
] as const);

export interface ScannerPartDoc {
  readonly id: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface ScannerPartLookupResult {
  readonly parts: readonly ScannerPartDoc[];
  /** The canonical resolver's answer, or null when the caller may not resolve identifiers. */
  readonly alias: ScannedIdentifierResolution | null;
  readonly aliasDenied: boolean;
}

export class ScannerPartLookupInvalidError extends Error {}

const MAX_RAW = 256;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function validateScannerPartLookup(data: unknown): { rawValue: string; partCode: string | null } {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ScannerPartLookupInvalidError("request must be an object");
  const d = data as Record<string, unknown>;
  if (Object.keys(d).some((k) => k !== "rawValue" && k !== "partCode")) throw new ScannerPartLookupInvalidError("unknown field");
  if (typeof d.rawValue !== "string" || d.rawValue.trim() === "" || d.rawValue.length > MAX_RAW) throw new ScannerPartLookupInvalidError("rawValue invalid");
  // The client's normalised scan token (domain/scannedIdentity.js normalizeScanToken), used as a Part
  // document id. Anything that is not a safe id segment simply is not a Part code.
  const partCode = typeof d.partCode === "string" && SAFE_ID.test(d.partCode.trim()) ? d.partCode.trim() : null;
  return { rawValue: d.rawValue, partCode };
}

function project(id: string, raw: Record<string, unknown>): ScannerPartDoc {
  const data: Record<string, unknown> = {};
  for (const k of SCANNER_PART_FIELDS) if (raw[k] !== undefined) data[k] = raw[k];
  return { id, data: Object.freeze(data) };
}

export async function lookupScannedPart(
  request: { rawValue: string; partCode: string | null },
  deps: { readonly db: Firestore; readonly aliasAllowed: boolean; readonly resolve?: typeof resolveScannedPartIdentifier },
): Promise<ScannerPartLookupResult> {
  const alias = deps.aliasAllowed
    ? await (deps.resolve ?? resolveScannedPartIdentifier)({ rawValue: request.rawValue }, { db: deps.db })
    : null;

  const ids = new Set<string>();
  if (request.partCode) { ids.add(request.partCode); ids.add(request.partCode.toUpperCase()); }
  if (alias?.result === "FOUND") ids.add(alias.partId);

  const snaps = await Promise.all([...ids].map((id) => deps.db.collection(PARTS_COLLECTION).doc(id).get()));
  const parts = snaps.filter((s) => s.exists).map((s) => project(s.id, s.data() ?? {}));
  return { parts, alias, aliasDenied: !deps.aliasAllowed };
}
