// Serialized Asset -- TRUSTED MINIMAL READ PROJECTION (repo-only, fail-closed). Spec phase M.1
// (docs/specifications/serialized-asset-equipment-installation.md §I / §M.1: "Serialized Asset identity +
// Available Equipment read", ADR-010 + DECISIONS #59). Follows the `salesOrder.read` /
// `inventory.catalog.read` pattern exactly (functions/src/salesOrder/salesOrderReadService.ts,
// functions/src/partMaster/manufacturerReadService.ts) -- the client does NOT receive direct
// `serialized_assets` read access (no firestore.rules match block exists for this collection -- default
// deny; NOT changed by this PR). A trusted backend resolves the caller's governed scope, reads the
// canonical Serialized Asset documents via the Admin SDK, and returns ONLY the minimal "Available
// Equipment" projection §I's UI composition needs: in-stock serial units with `currentEquipmentId` null.
//
// Principles enforced here (identical to the Sales Order / Manufacturer read services):
//   • fail closed; caller identity comes from request.auth.uid, never a client-supplied id;
//   • authorization is the governed capability `inventory.serializedAsset.read`, resolved through the
//     trusted effective-access feed (registered active:false ⇒ ungranted ⇒ deny for everyone; this phase
//     grants it to NO Role and adds NO per-environment activation override -- see the PR report);
//   • the projection returns ONLY facts already authoritative on the Serialized Asset document itself --
//     no fabricated availability, no location LABEL (a display fact this service does not resolve), no
//     Equipment/Part descriptive join;
//   • distinguishes the states the UI must tell apart: denied · unavailable · ready.
//
// SCOPE (Spec phase M.1 ONLY): this is identity + Available-Equipment READ. It does NOT implement §H (the
// installation handoff command -- gated on Enterprise Inventory Phase 4 / Transfer Orders, which does not
// exist in this repo), performs NO write, creates NO delivery/transfer/install path, and creates NO second
// inventory ledger, movement/custody authority, truck authority, or second Equipment record.
//
// EXPORT != DEPLOY, REGISTER != GRANT. Exported for build/test only; nothing runs in production until a
// separate deploy + capability grant + per-environment activation.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { SERIALIZED_ASSETS_COLLECTION } from "../constants/collections";
import {
  validateSerializedAssetValue,
  isAvailableForEquipmentRead,
  type SerializedAssetState,
  type SerializedAssetOwnership,
} from "./types";

export const INVENTORY_SERIALIZED_ASSET_READ_CAPABILITY = "inventory.serializedAsset.read";

// The minimal projected shape the Available Equipment UX consumes (§I). No Part descriptive join
// (internalPartNumber/category/manufacturer/model -- Part Master's own authority, resolved separately by
// the caller exactly like the Available Equipment composition in
// field-ops-app-vite/src/domain/serializedAssetIdentity.js already does), no Location LABEL (only the
// ledger-derived id -- a display label is Location authority's own read, not fabricated here).
export interface SerializedAssetProjection {
  serialNo: string;
  partId: string;
  currentLocationId: string;
  inventoryState: SerializedAssetState;
  currentEquipmentId: string | null;
  ownership: SerializedAssetOwnership;
}

// Pure projection of one canonical `serialized_assets/{id}` doc -> the minimal shape. Returns null if the
// doc cannot yield a usable, invariant-honoring projection (unknown field, unrecognized state/ownership, or
// a contradictory INSTALLED<->link pairing) -- a malformed/foreign document is never fabricated into a
// trusted read. `id` (the stored doc id) is intentionally NOT required to equal `serialNo`; both are
// carried but only `serialNo` is business identity.
export function projectSerializedAsset(id: string, data: Record<string, unknown> | undefined): SerializedAssetProjection | null {
  if (typeof id !== "string" || id.trim() === "" || !data || typeof data !== "object") return null;
  // Pluck only the governed VALUE fields before validating -- a real stored document also carries
  // provenance (schemaVersion/createdAtMillis/createdByUid/updatedAtMillis/updatedByUid, see
  // DeserializedSerializedAsset), which must be IGNORED here, never smuggled into the projection and
  // never cause an otherwise-valid document to be rejected. validateSerializedAssetValue's strict
  // allowlist governs only this plucked VALUE subset, exactly like receivingTypes.ts's
  // ReceivingOrderValue is validated separately from its DeserializedReceivingOrder provenance wrapper.
  const candidate = {
    serialNo: data.serialNo,
    partId: data.partId,
    currentLocationId: data.currentLocationId,
    inventoryState: data.inventoryState,
    currentEquipmentId: data.currentEquipmentId,
    ownership: data.ownership,
  };
  const check = validateSerializedAssetValue(candidate);
  if (!check.valid) return null;
  return {
    serialNo: check.value.serialNo,
    partId: check.value.partId,
    currentLocationId: check.value.currentLocationId,
    inventoryState: check.value.inventoryState,
    currentEquipmentId: check.value.currentEquipmentId,
    ownership: check.value.ownership,
  };
}

export type AvailableEquipmentReadStatus = "ready";

export interface AvailableEquipmentReadResult {
  status: AvailableEquipmentReadStatus;
  availableEquipment: SerializedAssetProjection[];
  // Documents that failed validation OR did not honor the Available-Equipment invariant (state !==
  // AVAILABLE or currentEquipmentId !== null) are excluded, never fabricated into the result -- the count
  // is surfaced so a caller can honestly report "N excluded", matching getManufacturerCatalog's
  // excludedCount convention.
  excludedCount: number;
  // BOUNDED-READ HONESTY. True when the registry holds more available assets than this read
  // returned. Distinct from excludedCount, which counts documents that WERE read and failed the
  // availability invariant -- this counts documents that were never read at all. Optional so the
  // account-scoped callers that never truncate need not carry it.
  truncated?: boolean;
}

// The trusted read callable -- the Available Equipment projection (§I: "Available Equipment UI reads
// SERIALIZED ASSETS (in-stock serial units + ledger location/availability; `currentEquipmentId` null)").
// Queries by the governed lifecycle state (AVAILABLE) rather than reading the whole collection, but still
// re-validates and re-asserts the invariant per document before including it -- never trusts the query
// filter alone. Maps failures to HttpsError so the client can distinguish denied (permission-denied) from
// unavailable (internal).
/** Cap for the Available Equipment registry read. See the bounded-read note at the query. */
const AVAILABLE_EQUIPMENT_LIMIT = 1000;

export const getAvailableEquipment = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");

  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({
      principalUid: request.auth.uid,
      permissionIds: [INVENTORY_SERIALIZED_ASSET_READ_CAPABILITY],
    });
    allowed = decisions[INVENTORY_SERIALIZED_ASSET_READ_CAPABILITY] === true;
  } catch {
    allowed = false; // fail closed
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to read the Available Equipment registry.");

  try {
    const db = getFirestore();
    // BOUNDED READ. The two equality filters narrow the set but do not cap it -- an available
    // serialized-asset pool has no natural ceiling, so "filtered" was being mistaken for
    // "bounded". Fetching limit+1 lets the extra row disclose truncation instead of the page
    // silently pretending to be the whole registry.
    //
    // `truncated` is kept SEPARATE from `excludedCount` deliberately: they answer different
    // questions. excludedCount means "these documents were read and failed the availability
    // invariant"; truncated means "there are more documents we did not read at all". Collapsing
    // them would make a paging boundary look like a data-quality problem.
    const snap = await db
      .collection(SERIALIZED_ASSETS_COLLECTION)
      .where("inventoryState", "==", "AVAILABLE")
      .where("currentEquipmentId", "==", null)
      .limit(AVAILABLE_EQUIPMENT_LIMIT + 1)
      .get();
    const truncated = snap.size > AVAILABLE_EQUIPMENT_LIMIT;
    const availableEquipment: SerializedAssetProjection[] = [];
    let excludedCount = 0;
    for (const doc of snap.docs.slice(0, AVAILABLE_EQUIPMENT_LIMIT)) {
      const projection = projectSerializedAsset(doc.id, doc.data());
      if (projection && isAvailableForEquipmentRead(projection)) availableEquipment.push(projection);
      else excludedCount++;
    }
    const result: AvailableEquipmentReadResult = { status: "ready", availableEquipment, excludedCount, truncated };
    return result;
  } catch {
    throw new HttpsError("internal", "The Available Equipment read is temporarily unavailable.");
  }
});
