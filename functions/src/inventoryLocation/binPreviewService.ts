// BIN PREVIEW — what createBin WOULD do, without doing any of it.
//
// ============================ WHY THIS EXISTS ============================
//
// BIN-P3's Administration racking generator must show an operator every proposed bin, with a
// truthful verdict, BEFORE anything is written. The client cannot produce that verdict:
//
//   * `listBinsForWarehouse` reads `bins` ONLY. It deliberately does not read `bin_code_claims`,
//     because the claim index is a uniqueness-and-history mechanism, not a Location catalog --
//     listing from it would surface superseded codes as if they were places.
//   * Its rows carry no `idempotencyKey`, so a client cannot tell "a bin holds this structured
//     identity" from "a bin holds this identity AND would replay under this exact key".
//   * `bin_code_claims` has no firestore.rules match block, and must keep none.
//
// A client guessing from structured attributes alone would produce the one failure this programme
// keeps removing: a screen telling an operator that applying is safe when the registry says
// otherwise.
//
// ============================ WHAT IT IS, AND IS NOT ============================
//
// It is a THIN TRUSTED READ under the EXISTING `inventory.location.bin.read` capability -- the same
// authority `resolveBinCode` and `listBinsForWarehouse` already use. Resolving what the registry
// says about a proposed bin is the same audience as resolving a scanned one.
//
// It is NOT a second writer, NOT a new capability, and NOT a second Location authority. It is a
// composition over the SAME validation, the SAME server-owned formatter and the SAME deriveBinId
// that createBin uses, so preview and apply cannot drift.
//
// IT WRITES NOTHING. No document, no claim, no transaction. There is deliberately no
// create-and-roll-back: a transaction whose only purpose is pretending to preview is a write path
// in disguise, and a rolled-back write still consumes ids and still races.
//
// ============================ ALREADY_EXISTS MEANS REPLAY, NOT RESEMBLANCE ============================
//
// The verdict must answer a question about the ACTUAL command: would `createBin` with THIS request
// return `unchanged`? A bin sitting at the same structured location under a DIFFERENT historical
// idempotency key has a different binId, and createBin would be refused by the code claim -- so the
// truthful answer there is CODE_RESERVED, not ALREADY_EXISTS. Reporting "already exists" for a bin
// the operator's request cannot actually reach would send them away believing the rack is
// configured when their apply would have failed.

import type { Firestore } from "firebase-admin/firestore";
import { WAREHOUSES_COLLECTION } from "../constants/collections.js";
import { BINS_COLLECTION, BIN_CODE_CLAIMS_COLLECTION } from "./binCommands.js";
import {
  deriveBinId,
  deriveBinClaimId,
  fingerprintBinCreate,
  toBinCreateIdentity,
  validateBinDraft,
  DEFAULT_BIN_CODE_FORMAT,
  BIN_SCHEMA_VERSION,
} from "./binRegistry.js";
import type { BinCodeFormatPolicy } from "./binRegistry.js";

/**
 * The most proposals one call will classify.
 *
 * Bounded on purpose. A real Phoenix layout runs to thousands of positions, and one round trip per
 * physical shelf would be absurd -- but an unbounded batch is a payload and runtime hazard, and a
 * silent truncation would under-report conflicts on exactly the rows nobody looked at. Beyond this
 * the caller chunks; the service refuses rather than trims.
 */
export const BIN_PREVIEW_MAX_PROPOSALS = 250;

export class BinPreviewInvalidError extends Error {}

export type BinPreviewClassification =
  | "NEW"
  | "ALREADY_EXISTS"
  | "CODE_RESERVED"
  | "INVALID"
  | "INTEGRITY_ERROR";

export interface BinPreviewRow {
  /** Echoed so a caller can align rows with its own proposals without relying on order alone. */
  readonly idempotencyKey: string;
  readonly warehouseId: string;
  readonly area: string | null;
  readonly aisle: string | null;
  readonly bay: number | null;
  readonly position: number | null;
  /** The SERVER-authoritative canonical code -- exactly what createBin would author. */
  readonly code: string | null;
  readonly classification: BinPreviewClassification;
  /** A bounded governed token, never a raw stored value. */
  readonly reason: string | null;
}

export interface BinPreviewResult {
  readonly rows: readonly BinPreviewRow[];
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Classify what `createBin` would do with each proposal. READ-ONLY.
 *
 * The caller supplies the same request shape createBin takes -- structured attributes plus the
 * deterministic Administration idempotency key -- so there is exactly one request vocabulary
 * between preview and apply.
 */
export async function previewBinCreates(
  db: Firestore,
  request: unknown,
  codeFormat: BinCodeFormatPolicy = DEFAULT_BIN_CODE_FORMAT,
): Promise<BinPreviewResult> {
  const data = asRecord(request);
  const proposals = data.proposals;
  if (!Array.isArray(proposals)) throw new BinPreviewInvalidError("proposals_required");
  if (proposals.length === 0) return { rows: [] };
  if (proposals.length > BIN_PREVIEW_MAX_PROPOSALS) {
    // Refused, never truncated: a silently trimmed batch hides conflicts on the rows nobody saw.
    throw new BinPreviewInvalidError("too_many_proposals");
  }

  // One warehouse read for the whole batch -- the same eligibility set createBin validates against.
  const warehouseSnap = await db.collection(WAREHOUSES_COLLECTION).get();
  const knownWarehouseIds = new Set(warehouseSnap.docs.map((d) => d.id));

  const rows: BinPreviewRow[] = [];
  for (const raw of proposals) {
    const p = asRecord(raw);
    const key = typeof p.idempotencyKey === "string" ? p.idempotencyKey : "";

    // SAME validation createBin runs, including its refusal of a caller-authored binId or code.
    const validated = validateBinDraft(p, knownWarehouseIds, codeFormat);
    if (!validated.valid) {
      rows.push({
        idempotencyKey: key,
        warehouseId: typeof p.warehouseId === "string" ? p.warehouseId : "",
        area: null, aisle: null, bay: null, position: null, code: null,
        classification: "INVALID",
        reason: validated.reason,
      });
      continue;
    }
    const value = validated.value;
    const base = {
      idempotencyKey: value.idempotencyKey,
      warehouseId: value.warehouseId,
      area: value.area,
      aisle: value.aisle,
      bay: value.bay,
      position: value.position,
      // Server-authoritative: the client renders THIS, not a locally guessed code.
      code: value.code,
    };

    const expectedBinId = deriveBinId(value.idempotencyKey);
    const [binSnap, claimSnap] = await Promise.all([
      db.collection(BINS_COLLECTION).doc(expectedBinId).get(),
      db.collection(BIN_CODE_CLAIMS_COLLECTION).doc(deriveBinClaimId(value.warehouseId, value.code)).get(),
    ]);

    const claim = claimSnap.exists ? asRecord(claimSnap.data()) : null;
    const claimBinId = claim && typeof claim.binId === "string" ? claim.binId : null;
    if (claim !== null && claimBinId === null) {
      rows.push({ ...base, classification: "INTEGRITY_ERROR", reason: "claim_unreadable" });
      continue;
    }

    if (binSnap.exists) {
      const stored = asRecord(binSnap.data());
      // Fail closed on anything incoherent. An operator must never be told an inconsistent registry
      // is safe to apply.
      if (stored.schemaVersion !== BIN_SCHEMA_VERSION) {
        rows.push({ ...base, classification: "INTEGRITY_ERROR", reason: "bin_schema_version" });
        continue;
      }
      const coherent =
        stored.warehouseId === value.warehouseId
        && stored.area === value.area
        && stored.aisle === value.aisle
        && stored.bay === value.bay
        && stored.position === value.position
        && stored.code === value.code
        && stored.idempotencyKey === value.idempotencyKey;
      if (!coherent) {
        rows.push({ ...base, classification: "INTEGRITY_ERROR", reason: "bin_disagrees_with_request" });
        continue;
      }
      // The stored record must also agree with ITSELF, exactly as createBin checks before trusting a
      // replay -- a record whose fingerprint disagrees with its own identity is a data fault.
      const recomputed = fingerprintBinCreate(
        toBinCreateIdentity(stored as unknown as Parameters<typeof toBinCreateIdentity>[0]),
      );
      if (recomputed !== stored.fingerprint) {
        rows.push({ ...base, classification: "INTEGRITY_ERROR", reason: "bin_fingerprint_mismatch" });
        continue;
      }
      // The claim must point back at this same bin, or the pair is inconsistent.
      if (claimBinId !== null && claimBinId !== expectedBinId) {
        rows.push({ ...base, classification: "INTEGRITY_ERROR", reason: "claim_points_elsewhere" });
        continue;
      }
      // createBin with THIS request would return `unchanged`. That -- and only that -- is
      // ALREADY_EXISTS.
      rows.push({ ...base, classification: "ALREADY_EXISTS", reason: null });
      continue;
    }

    if (claimBinId !== null) {
      // A code spoken for by a DIFFERENT bin, HELD or SUPERSEDED. createBin would refuse.
      rows.push({ ...base, classification: "CODE_RESERVED", reason: "code_reserved_by_another_bin" });
      continue;
    }

    rows.push({ ...base, classification: "NEW", reason: null });
  }

  return { rows };
}
