// DESCRIPTIVE BIN REGISTRY — the trusted command service.
//
// Admin-SDK only. `bins` has no firestore.rules match block, so it is DENY-ALL to every client
// including admin — the same posture `part_aliases` uses, and the reason no Rules change was needed
// to add it: a callable runs on the Admin SDK, which Rules do not govern.
//
// ============================ IT CREATES PLACES, NOT STOCK ============================
//
// DECISIONS #116. These commands write bin IDENTITY and nothing else. No ledger event, no quantity,
// no location reference a movement command would accept. Creating, retiring or reviving a bin cannot
// change a single balance — a test asserts the module never imports the ledger or a movement type.
//
// ============================ DUPLICATES CANNOT HAPPEN ============================
//
// The document id is derived from (warehouseId, normalized code). Creating the same bin twice is
// idempotent by construction rather than by a uniqueness check that could race.

import type { Firestore, Transaction } from "firebase-admin/firestore";
import { WAREHOUSES_COLLECTION } from "../constants/collections.js";
import { deriveBinDocId, resolveBin, validateBinDraft, normalizeBinCode } from "./binRegistry.js";
import type { BinResolution, BinStatus } from "./binRegistry.js";

export const BINS_COLLECTION = "bins";

export const BIN_MANAGE_CAPABILITY = "inventory.location.bin.manage";
export const BIN_READ_CAPABILITY = "inventory.location.bin.read";

export class BinInvalidError extends Error {}
export class BinUnauthorizedError extends Error {}
export class BinNotFoundError extends Error {}

export interface BinCommandDeps {
  readonly db: Firestore;
  readonly actor: { readonly kind: "USER" | "SYSTEM"; readonly id: string };
  readonly authorize: (txn: Transaction, actorId: string, capability: string) => Promise<boolean>;
  readonly now: () => Date;
}

export interface BinOutcome {
  readonly outcome: "created" | "unchanged" | "updated";
  readonly binId: string;
  readonly warehouseId: string;
  readonly code: string;
  readonly status: BinStatus;
}

/**
 * Create a bin, or return the one that already exists.
 *
 * IDEMPOTENT BY CONSTRUCTION: the id is derived, so a repeat create finds the existing document and
 * reports `unchanged` rather than failing. A warehouse worker labelling racking should not be
 * punished for scanning the same label twice.
 *
 * It does NOT revive a retired bin. Retiring is a deliberate act, and quietly undoing it because
 * someone re-created the code would erase that decision without anyone seeing it.
 */
export async function createBin(request: unknown, deps: BinCommandDeps): Promise<BinOutcome> {
  return deps.db.runTransaction(async (txn) => {
    if (!(await deps.authorize(txn, deps.actor.id, BIN_MANAGE_CAPABILITY))) throw new BinUnauthorizedError();

    // The warehouse set is read INSIDE the transaction: a bin created against a warehouse that is
    // being removed concurrently would otherwise commit into nowhere.
    const warehouseSnap = await txn.get(deps.db.collection(WAREHOUSES_COLLECTION));
    const knownWarehouseIds = new Set(warehouseSnap.docs.map((d) => d.id));

    const validated = validateBinDraft(request, knownWarehouseIds);
    if (!validated.valid) throw new BinInvalidError(validated.reason);
    const value = validated.value;

    const binId = deriveBinDocId(value.warehouseId, value.code);
    const ref = deps.db.collection(BINS_COLLECTION).doc(binId);
    const existing = await txn.get(ref);

    if (existing.exists) {
      const stored = existing.data() ?? {};
      const status = (stored.status as BinStatus) ?? "INACTIVE";
      return { outcome: "unchanged", binId, warehouseId: value.warehouseId, code: value.code, status };
    }

    const now = deps.now();
    txn.create(ref, {
      warehouseId: value.warehouseId,
      code: value.code,
      originalCode: value.originalCode,
      name: value.name,
      status: value.status,
      version: 1,
      createdAt: now,
      createdBy: deps.actor.id,
      updatedAt: now,
      updatedBy: deps.actor.id,
    });

    return { outcome: "created", binId, warehouseId: value.warehouseId, code: value.code, status: value.status };
  });
}

/**
 * Retire or revive a bin.
 *
 * NOTHING IS EVER DELETED. A retired bin stays readable so a put-away recorded against it last year
 * still resolves to a place with a name, rather than to a dangling code.
 */
export async function setBinStatus(
  request: unknown,
  status: BinStatus,
  deps: BinCommandDeps,
): Promise<BinOutcome> {
  const draft = (request ?? {}) as Record<string, unknown>;
  const warehouseId = typeof draft.warehouseId === "string" ? draft.warehouseId : "";
  const normalized = normalizeBinCode(draft.code);
  if (warehouseId === "" || !normalized.valid) throw new BinInvalidError("bin_reference_invalid");

  const binId = deriveBinDocId(warehouseId, normalized.value.code);

  return deps.db.runTransaction(async (txn) => {
    if (!(await deps.authorize(txn, deps.actor.id, BIN_MANAGE_CAPABILITY))) throw new BinUnauthorizedError();

    const ref = deps.db.collection(BINS_COLLECTION).doc(binId);
    const snap = await txn.get(ref);
    if (!snap.exists) throw new BinNotFoundError();
    const stored = snap.data() ?? {};

    if (stored.status === status) {
      // Already there. Reporting `unchanged` rather than failing keeps a retry harmless.
      return { outcome: "unchanged", binId, warehouseId, code: normalized.value.code, status };
    }

    const now = deps.now();
    txn.update(ref, {
      status,
      version: (typeof stored.version === "number" ? stored.version : 0) + 1,
      updatedAt: now,
      updatedBy: deps.actor.id,
    });
    return { outcome: "updated", binId, warehouseId, code: normalized.value.code, status };
  });
}

/**
 * Resolve one scanned bin code within a warehouse. READ-ONLY.
 *
 * Gated on the READ capability, not the manage one: an operator putting stock away needs to check
 * that a bin is real, and giving them that check should not also let them create and retire racking.
 */
export async function resolveBinCode(
  db: Firestore,
  rawCode: unknown,
  warehouseId: string,
): Promise<BinResolution> {
  const normalized = normalizeBinCode(rawCode);
  if (!normalized.valid) return { result: "MALFORMED", detail: normalized.reason };

  const binId = deriveBinDocId(warehouseId, normalized.value.code);
  const snap = await db.collection(BINS_COLLECTION).doc(binId).get();
  return resolveBin(rawCode, warehouseId, snap.exists ? (snap.data() ?? null) : null);
}

/** Every bin in one warehouse, for a picker. Bounded: racking is finite, but not unbounded. */
export const BIN_LIST_LIMIT = 500;

export async function listBinsForWarehouse(db: Firestore, warehouseId: string): Promise<{
  readonly bins: ReadonlyArray<{ binId: string; code: string; name: string | null; status: BinStatus }>;
  readonly truncated: boolean;
}> {
  const snap = await db.collection(BINS_COLLECTION)
    .where("warehouseId", "==", warehouseId)
    .limit(BIN_LIST_LIMIT + 1)
    .get();

  const docs = snap.docs.slice(0, BIN_LIST_LIMIT);
  return {
    // A malformed stored bin is EXCLUDED rather than rendered as a blank row an operator might scan.
    bins: docs
      .map((d) => {
        const data = d.data() ?? {};
        if (typeof data.code !== "string" || data.code === "") return null;
        return {
          binId: d.id,
          code: data.code,
          name: typeof data.name === "string" ? data.name : null,
          status: (data.status === "ACTIVE" ? "ACTIVE" : "INACTIVE") as BinStatus,
        };
      })
      .filter((b): b is { binId: string; code: string; name: string | null; status: BinStatus } => b !== null),
    truncated: snap.docs.length > BIN_LIST_LIMIT,
  };
}
