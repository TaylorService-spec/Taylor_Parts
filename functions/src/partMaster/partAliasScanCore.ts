// SCANNED IDENTIFIER RESOLUTION -- the pure fan-out, extracted.
//
// EXTRACTED, NOT REWRITTEN. This algorithm moved verbatim out of `partAliasScanResolver.ts`, which
// imports `firebase-admin/firestore`. The PostgreSQL Catalog authority needs the SAME resolution and
// must not carry a Firebase dependency to get it, and the one thing that must never happen is two
// implementations of "what did this person just scan" -- a second, subtly different fan-out would
// answer NOT_FOUND where the other answered AMBIGUOUS, and a warehouse user would create a duplicate
// Part because the new store was quieter than the old one.
//
// So the algorithm lives here, with no imports beyond the pure vocabulary, and both stores inject
// their own per-type probe. `partAliasScanResolver.ts` passes the Firestore one; the Render Catalog
// authority passes the PostgreSQL one.
//
// ════════════════════ THE FIVE OUTCOMES ARE FIVE DIFFERENT FIXES ════════════════════
//
// Two registered identifiers pointing at DIFFERENT Parts is AMBIGUOUS, never a pick. An identifier
// that is registered but switched off is INACTIVE, never NOT_FOUND -- telling the operator it was
// never registered would send them to create a duplicate of a record somebody deliberately retired.
// A value no type can even normalize is MALFORMED, never NOT_FOUND. Each calls for a different
// action, so none of them is collapsed into another.

import { ALIAS_TYPES } from "./types.js";
import type { AliasType, PartId } from "./types.js";

/**
 * FOUND carries WHICH identifier matched, not just the Part. A warehouse user who scanned a box
 * needs to know the scan resolved through a supplier SKU rather than the internal number.
 */
export type ScannedIdentifierResolution =
  | {
      readonly result: "FOUND";
      readonly partId: PartId;
      readonly aliasType: AliasType;
      readonly aliasId: string;
    }
  | {
      readonly result: "INACTIVE";
      readonly partId: PartId;
      readonly aliasType: AliasType;
      readonly aliasId: string;
    }
  | {
      readonly result: "AMBIGUOUS";
      readonly matches: readonly { readonly partId: PartId; readonly aliasType: AliasType }[];
    }
  | { readonly result: "NOT_FOUND" }
  | { readonly result: "MALFORMED"; readonly detail: string };

/** One type's answer, as either store's probe returns it. */
export type AliasProbeOutcome =
  | { readonly result: "FOUND"; readonly partId: PartId; readonly aliasType: AliasType; readonly aliasId: string }
  | { readonly result: "INACTIVE"; readonly partId: PartId; readonly aliasType: AliasType; readonly aliasId: string }
  | { readonly result: "NOT_FOUND" }
  | { readonly result: "MALFORMED"; readonly detail: string }
  | { readonly result: "CONFLICT"; readonly detail: string };

export type AliasTypeProbe = (input: {
  readonly aliasType: AliasType;
  readonly rawValue: string;
  readonly manufacturerId?: string;
}) => Promise<AliasProbeOutcome>;

/**
 * MANUFACTURER_PN is only a candidate when a manufacturer scope was supplied, because its
 * normalization embeds that scope and cannot be attempted without one.
 */
export function candidateAliasTypes(hasManufacturerScope: boolean): readonly AliasType[] {
  return ALIAS_TYPES.filter((t) => t !== "MANUFACTURER_PN" || hasManufacturerScope);
}

/** Resolve one scanned or typed identifier by asking every candidate type. */
export async function resolveScannedIdentifierWith(
  probe: AliasTypeProbe,
  input: { readonly rawValue: string; readonly manufacturerId?: string },
): Promise<ScannedIdentifierResolution> {
  const raw = typeof input?.rawValue === "string" ? input.rawValue.trim() : "";
  if (raw.length === 0) return { result: "MALFORMED", detail: "identifier value must be a non-empty string" };

  const manufacturerId = typeof input?.manufacturerId === "string" && input.manufacturerId.length > 0
    ? input.manufacturerId
    : undefined;

  const found: { partId: PartId; aliasType: AliasType; aliasId: string }[] = [];
  const inactive: { partId: PartId; aliasType: AliasType; aliasId: string }[] = [];
  let anyTypeAccepted = false;
  const malformedDetails: string[] = [];

  for (const aliasType of candidateAliasTypes(manufacturerId !== undefined)) {
    const outcome = await probe({
      aliasType, rawValue: raw, ...(manufacturerId !== undefined ? { manufacturerId } : {}),
    });
    switch (outcome.result) {
      case "FOUND":
        anyTypeAccepted = true;
        found.push({ partId: outcome.partId, aliasType: outcome.aliasType, aliasId: outcome.aliasId });
        break;
      case "INACTIVE":
        anyTypeAccepted = true;
        inactive.push({ partId: outcome.partId, aliasType: outcome.aliasType, aliasId: outcome.aliasId });
        break;
      case "NOT_FOUND":
        // The value normalizes as this type; nothing is registered under it. That still means the
        // value is WELL-FORMED for at least one type, which is what separates NOT_FOUND from
        // MALFORMED overall.
        anyTypeAccepted = true;
        break;
      case "MALFORMED":
        malformedDetails.push(`${aliasType}: ${outcome.detail}`);
        break;
      case "CONFLICT":
        // Structurally unreachable under the unique-identity contract. If it ever does occur it is a
        // stored-data conflict and must surface as one, not be swallowed.
        return { result: "MALFORMED", detail: `alias conflict: ${outcome.detail}` };
    }
  }

  // ACTIVE registrations win over inactive ones, but only where they agree on the Part.
  const distinctFound = [...new Map(found.map((f) => [f.partId, f])).values()];
  if (distinctFound.length === 1) {
    const one = distinctFound[0]!;
    return { result: "FOUND", partId: one.partId, aliasType: one.aliasType, aliasId: one.aliasId };
  }
  if (distinctFound.length > 1) {
    return { result: "AMBIGUOUS", matches: distinctFound.map((f) => ({ partId: f.partId, aliasType: f.aliasType })) };
  }

  const distinctInactive = [...new Map(inactive.map((i) => [i.partId, i])).values()];
  if (distinctInactive.length === 1) {
    const one = distinctInactive[0]!;
    return { result: "INACTIVE", partId: one.partId, aliasType: one.aliasType, aliasId: one.aliasId };
  }
  if (distinctInactive.length > 1) {
    return { result: "AMBIGUOUS", matches: distinctInactive.map((i) => ({ partId: i.partId, aliasType: i.aliasType })) };
  }

  // Well-formed for at least one type and registered under none of them.
  if (anyTypeAccepted) return { result: "NOT_FOUND" };

  return {
    result: "MALFORMED",
    detail: malformedDetails.length > 0 ? "not a recognizable identifier for any registered type" : "no candidate identifier type",
  };
}
