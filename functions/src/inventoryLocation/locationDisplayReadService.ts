// Sandbox-fidelity package PART 11A -- trusted MINIMAL location-DISPLAY resolver (repo-only, fail-
// closed). PR #1029 wired Available Equipment to the governed Serialized Asset read
// (serializedAssetReadService.ts), which returns only the ledger-derived SCALAR `currentLocationId`
// (deliberately, per that service's header: "no Location LABEL -- a display fact this service does
// not resolve"). The Available Equipment UI has therefore been rendering the raw location id. This
// module is the missing governed resolver: id -> { type, label }, for exactly the categories that
// already have a governed identity authority to check against --
//   * WAREHOUSE -- warehouses/{locationId}, display field `name` (governedWarehouseValidation.ts);
//   * MOBILE     -- mobile_locations/{locationId} (the EI Truck Registry, ADR-010), display field
//                   `displayLabel`.
// CUSTOMER and any other category have NO governed id->display-name authority in this repository
// today (`locations` as a customer-site directory is not modeled here) -- this resolver NEVER
// fabricates a label or a `type` for them. A requested id that matches neither WAREHOUSE nor MOBILE
// resolves to `{ type: "UNRESOLVED", label: null }`, which the UI renders as "Unavailable" -- not a
// guess, not a fallback to a made-up type.
//
// Follows the salesOrder.read / inventory.catalog.read / inventory.serializedAsset.read pattern
// exactly: a NEW governed capability (`inventory.location.display.read`), registered `active:false`
// and granted to NO Role, so resolveEffectivePermission() denies every principal until a later,
// separately authorized grant + activation gate. No client-direct `warehouses` widening (the existing
// warehouses Rules are unchanged) and this service introduces no client-direct `mobile_locations`
// widening. NOTE, corrected 2026-08-17: this comment previously asserted that `mobile_locations` has
// no Rules match block and is default-deny. That is no longer true -- firestore.rules:1235-1238
// (the Truck Registry block) grants `allow read: if isAdminOrDispatcher()` and denies all client
// writes, and services/truckRegistryQueries.js reads it client-direct on that basis. The claim was
// presumably accurate when written and was not revisited when the Truck Registry block landed. What
// remains true, and is the point of the original sentence, is that THIS service adds no widening.
//
// BOUNDED BY DESIGN: this is a targeted point-read (`getAll` on the exact ids requested), never a
// collection scan/query -- so it needs no new Firestore index and cannot be used to enumerate
// warehouses or trucks. The request is capped at MAX_LOCATION_IDS ids per call.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { WAREHOUSES_COLLECTION } from "../constants/collections";
import { MOBILE_LOCATIONS_COLLECTION } from "../truckRegistry/truckRegistryRepository";

export const INVENTORY_LOCATION_DISPLAY_READ_CAPABILITY = "inventory.location.display.read";

export const MAX_LOCATION_IDS = 50;

export type LocationDisplayType = "WAREHOUSE" | "MOBILE" | "UNRESOLVED";

export interface LocationDisplayEntry {
  locationId: string;
  type: LocationDisplayType;
  label: string | null;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

// Validate + dedupe the requested id list. Fails closed (returns null) on anything malformed --
// not a plain array of non-empty strings, empty, or over MAX_LOCATION_IDS.
export function validateLocationIdsRequest(input: unknown): string[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_LOCATION_IDS) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of input) {
    if (!isNonEmptyString(id)) return null;
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

// Resolve ONE already-fetched warehouse doc into a display entry, or null if it does not carry a
// governed, non-empty `name` -- never fabricated.
function resolveWarehouseEntry(locationId: string, data: Record<string, unknown> | undefined): LocationDisplayEntry | null {
  if (!data || !isNonEmptyString(data.name)) return null;
  return { locationId, type: "WAREHOUSE", label: data.name };
}

// Resolve ONE already-fetched mobile_locations doc into a display entry, or null if it does not
// carry the governed MOBILE identity (`type === "MOBILE"` + non-empty `displayLabel`).
function resolveMobileEntry(locationId: string, data: Record<string, unknown> | undefined): LocationDisplayEntry | null {
  if (!data || data.type !== "MOBILE" || !isNonEmptyString(data.displayLabel)) return null;
  return { locationId, type: "MOBILE", label: data.displayLabel };
}

// Bounded, point-read-only resolution over the two governed authorities. WAREHOUSE is checked
// first (Available Equipment's canonical stock location); a miss there falls through to MOBILE; a
// miss in both resolves to UNRESOLVED, label null -- never guessed.
export async function resolveLocationDisplays(db: Firestore, locationIds: readonly string[]): Promise<LocationDisplayEntry[]> {
  const whRefs = locationIds.map((id) => db.collection(WAREHOUSES_COLLECTION).doc(id));
  const mlRefs = locationIds.map((id) => db.collection(MOBILE_LOCATIONS_COLLECTION).doc(id));
  const [whSnaps, mlSnaps] = await Promise.all([db.getAll(...whRefs), db.getAll(...mlRefs)]);

  return locationIds.map((id, i) => {
    const wh = whSnaps[i].exists ? resolveWarehouseEntry(id, whSnaps[i].data()) : null;
    if (wh) return wh;
    const ml = mlSnaps[i].exists ? resolveMobileEntry(id, mlSnaps[i].data()) : null;
    if (ml) return ml;
    return { locationId: id, type: "UNRESOLVED", label: null };
  });
}

export type LocationDisplayReadStatus = "ready";
export interface LocationDisplayReadResult {
  status: LocationDisplayReadStatus;
  locations: LocationDisplayEntry[];
}

// The trusted read callable. Denied (permission-denied) rather than internal on an authorization
// failure, so the caller can distinguish "not authorized" from "temporarily unavailable" -- same
// posture as getAvailableEquipment / getManufacturerCatalog.
export const getLocationDisplay = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");

  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({
      principalUid: request.auth.uid,
      permissionIds: [INVENTORY_LOCATION_DISPLAY_READ_CAPABILITY],
    });
    allowed = decisions[INVENTORY_LOCATION_DISPLAY_READ_CAPABILITY] === true;
  } catch (err) {
    console.error(`[getLocationDisplay] capability resolution failed for ${INVENTORY_LOCATION_DISPLAY_READ_CAPABILITY}`, err);
    allowed = false; // fail closed
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to read the location display registry.");

  const locationIds = validateLocationIdsRequest((request.data as { locationIds?: unknown } | undefined)?.locationIds);
  if (locationIds === null) {
    throw new HttpsError("invalid-argument", `locationIds must be a non-empty array of up to ${MAX_LOCATION_IDS} distinct non-empty strings.`);
  }

  try {
    const locations = await resolveLocationDisplays(getFirestore(), locationIds);
    const result: LocationDisplayReadResult = { status: "ready", locations };
    return result;
  } catch {
    throw new HttpsError("internal", "The location display read is temporarily unavailable.");
  }
});
