// THE RACKING PLANNER'S CLASSIFICATION -- PURE (no pg, no Firebase, no clock, no randomness). Firebase exit B3.
//
// It answers, for ONE proposed bin, what creating it WOULD do against what already exists in the warehouse. It is the EOS
// equivalent of the Firebase `previewBinCreates` verdicts (functions/src/inventoryLocation/binPreviewService.ts) and is the SAME
// decision createBins acts on, so "what you reviewed" and "what is applied" cannot be two implementations.
//
// IDENTITY. A bin's id is derived from its idempotency key (deriveBinId); the planner's key is `binadm:v1:<warehouse>:<area>:<aisle>:
// <bay>:<position>` (field-ops-app-vite/src/domain/rackingLayoutGenerator.js binIdempotencyKey), so the SAME physical position always
// yields the SAME bin id and a retry of a batch is, per bin, an exact replay.
//
// Classifications (never a bare boolean; a refusal always carries its reason):
//   NEW               nothing at that id, position or code: createBin would insert the bin and HOLD its code.
//   ALREADY_EXISTS    that id exists, coherent with the request, its code claim HELD by it: a replay, nothing to do.
//   POSITION_TAKEN    that rack position (area/aisle/bay/position) already belongs to a DIFFERENT bin id.
//   CODE_RESERVED     that code is claimed (HELD or SUPERSEDED -- claims are permanent) by a different bin.
//   INVALID           the proposal itself is not a bin (the shared validateBinDraft's reason).
//   INTEGRITY_ERROR   stored state disagrees with itself or with the request; never repaired here.
import { deriveBinId, validateBinDraft, type BinValue } from "../inventoryLocation/binRegistry.js";

export const BIN_CLASSIFICATIONS = Object.freeze(["NEW", "ALREADY_EXISTS", "POSITION_TAKEN", "CODE_RESERVED", "INVALID", "INTEGRITY_ERROR"] as const);
export type BinClassification = (typeof BIN_CLASSIFICATIONS)[number];

/** Most proposals one preview or one create may carry (the Firebase BIN_PREVIEW_MAX_PROPOSALS). Never silently truncated. */
export const MAX_BIN_PROPOSALS = 250;

export interface StoredBinRow {
  readonly id: string;
  readonly area: string;
  readonly aisle: string;
  readonly bay: number;
  readonly position: number;
  readonly code: string;
  readonly status: string;
}
export interface StoredClaimRow {
  readonly code: string;
  readonly binId: string;
  readonly claimState: string;
}

/** What the store holds around ONE proposal. The caller loads it (bulk for a preview, targeted inside a transaction for a create). */
export interface BinLookup {
  readonly binById: StoredBinRow | null;
  readonly binByPosition: StoredBinRow | null;
  readonly claimByCode: StoredClaimRow | null;
}

export interface BinVerdict {
  readonly index: number;
  readonly idempotencyKey: string | null;
  readonly classification: BinClassification;
  /** A stable token naming why (null for NEW / ALREADY_EXISTS). */
  readonly reason: string | null;
  readonly binId: string | null;
  readonly code: string | null;
  readonly area: string | null;
  readonly aisle: string | null;
  readonly bay: number | null;
  readonly position: number | null;
  /** The validated, normalized value a create acts on; null unless the proposal is valid. */
  readonly value: BinValue | null;
}

const verdict = (index: number, c: BinClassification, reason: string | null, v: BinValue | null, binId: string | null, key: unknown): BinVerdict => ({
  index, idempotencyKey: typeof key === "string" ? key : null, classification: c, reason, binId,
  code: v?.code ?? null, area: v?.area ?? null, aisle: v?.aisle ?? null, bay: v?.bay ?? null, position: v?.position ?? null, value: v,
});

/** Validate one proposal against ONE warehouse, without looking anything up. `valid:false` carries the INVALID verdict. */
export function validateProposal(index: number, warehouseId: string, proposal: unknown): { valid: true; value: BinValue } | { valid: false; verdict: BinVerdict } {
  const p = proposal && typeof proposal === "object" && !Array.isArray(proposal) ? { ...(proposal as Record<string, unknown>) } : proposal;
  // The warehouse is the request's, never the row's: a row naming another warehouse is a different request, refused.
  if (p && typeof p === "object" && !Array.isArray(p)) {
    const stated = (p as Record<string, unknown>).warehouseId;
    if (stated !== undefined && stated !== warehouseId) {
      return { valid: false, verdict: verdict(index, "INVALID", "warehouse_mismatch", null, null, (p as Record<string, unknown>).idempotencyKey) };
    }
    (p as Record<string, unknown>).warehouseId = warehouseId;
  }
  const checked = validateBinDraft(p, new Set([warehouseId]));
  if (!checked.valid) {
    const key = p && typeof p === "object" ? (p as Record<string, unknown>).idempotencyKey : null;
    return { valid: false, verdict: verdict(index, "INVALID", checked.reason, null, null, key) };
  }
  // The planner's identity is `binadm:v1:<warehouseId>:...` (see deriveBinId): a key scoped to another warehouse is refused here, not trusted,
  // so one warehouse's request can never mint the bin id of another's rack position.
  if (!checked.value.idempotencyKey.startsWith(`binadm:v1:${warehouseId}:`)) {
    return { valid: false, verdict: verdict(index, "INVALID", "idempotency_key_wrong_scope", null, null, checked.value.idempotencyKey) };
  }
  return { valid: true, value: checked.value };
}

/** The decision. Pure over the proposal's validated value and what the store holds around it. */
export function classifyBin(index: number, value: BinValue, lookup: BinLookup): BinVerdict {
  const binId = deriveBinId(value.idempotencyKey);
  const existing = lookup.binById;
  if (existing !== null) {
    const coherent = existing.area === value.area && existing.aisle === value.aisle && existing.bay === value.bay
      && existing.position === value.position && existing.code === value.code;
    if (!coherent) return verdict(index, "INTEGRITY_ERROR", "bin_disagrees_with_request", value, binId, value.idempotencyKey);
    const claim = lookup.claimByCode;
    if (claim === null) return verdict(index, "INTEGRITY_ERROR", "claim_unreadable", value, binId, value.idempotencyKey);
    if (claim.binId !== binId || claim.claimState !== "HELD") return verdict(index, "INTEGRITY_ERROR", "claim_points_elsewhere", value, binId, value.idempotencyKey);
    return verdict(index, "ALREADY_EXISTS", null, value, binId, value.idempotencyKey);
  }
  if (lookup.binByPosition !== null) return verdict(index, "POSITION_TAKEN", "position_taken_by_another_bin", value, binId, value.idempotencyKey);
  if (lookup.claimByCode !== null) return verdict(index, "CODE_RESERVED", "code_reserved_by_another_bin", value, binId, value.idempotencyKey);
  return verdict(index, "NEW", null, value, binId, value.idempotencyKey);
}

const positionKey = (b: { area: string; aisle: string; bay: number; position: number }) => `${b.area}\u0000${b.aisle}\u0000${b.bay}\u0000${b.position}`;

/**
 * Classify a whole request against bulk-loaded warehouse state (one query for bins, one for claims). Deterministic, input order
 * preserved. A duplicate WITHIN the request (same bin id, or the same position or code under another key) is INVALID for its later
 * occurrence -- the generator already marks these, and the server does not trust that.
 */
export function planBinCreates(
  warehouseId: string, proposals: readonly unknown[], bins: readonly StoredBinRow[], claims: readonly StoredClaimRow[],
): BinVerdict[] {
  const byId = new Map(bins.map((b) => [b.id, b]));
  const byPosition = new Map(bins.map((b) => [positionKey(b), b]));
  const byCode = new Map(claims.map((c) => [c.code, c]));
  const seenIds = new Set<string>();
  const seenPositions = new Set<string>();
  const seenCodes = new Set<string>();
  return proposals.map((proposal, index) => {
    const checked = validateProposal(index, warehouseId, proposal);
    if (!checked.valid) return checked.verdict;
    const v = checked.value;
    const id = deriveBinId(v.idempotencyKey);
    const pos = positionKey(v);
    if (seenIds.has(id) || seenPositions.has(pos) || seenCodes.has(v.code)) {
      return verdict(index, "INVALID", "duplicate_in_request", v, id, v.idempotencyKey);
    }
    seenIds.add(id); seenPositions.add(pos); seenCodes.add(v.code);
    return classifyBin(index, v, { binById: byId.get(id) ?? null, binByPosition: byPosition.get(pos) ?? null, claimByCode: byCode.get(v.code) ?? null });
  });
}
