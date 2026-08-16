// Manufacturer -- TRUSTED MINIMAL READ PROJECTION (repo-only, fail-closed). Wave 6 Owner Decision
// (2026-08-15): "inventory.catalog.read" -- a governed catalog/reference read the Parts experience
// needs, starting with Manufacturer identity. Follows the `opportunity.read`/`salesOrder.read`
// pattern exactly (functions/src/opportunity/opportunityReadService.ts, functions/src/salesOrder/
// salesOrderReadService.ts) -- the client does NOT receive direct `manufacturers` read access
// (firestore.rules stays `allow read, write: if false`, unchanged). A trusted backend resolves the
// caller's governed scope, reads the canonical Manufacturer list via the Admin SDK, and returns ONLY
// the minimal projection the Parts UX needs.
//
// Principles enforced here (identical to the Opportunity/Sales Order read services):
//   • fail closed; caller identity comes from request.auth.uid, never a client-supplied id;
//   • authorization is the governed capability `inventory.catalog.read`, resolved through the
//     trusted effective-access feed (registered active:false ⇒ ungranted ⇒ deny for everyone until
//     a separate Owner grant AND per-environment activation);
//   • the projection returns ONLY facts already authoritative on the Manufacturer document itself --
//     no vendor/contract/financial fields (none exist on the doc today; this is a stated boundary
//     for later, not a field currently being withheld);
//   • distinguishes the states the UI must tell apart: denied · unavailable · ready.
//
// NOTE on operational-role readers (PARTS_MANAGER/WAREHOUSE_MANAGER): the governed capability model
// declares an `operationalRoleActive` condition kind (resolveEffectivePermission.ts), and this
// capability plus its two siblings (`inventory.transaction.read`, `inventory.action.read`) declare
// this exact condition in compatibilityRoles.ts. UPDATE (Wave 7 extension PART 4,
// functions/src/access/operationalRoleContext.ts): resolveEffectiveAccess's canonical feed
// (effectiveAccessFeed.ts) now resolves a real, server-read `operationalRoleActive` closure from the
// caller's linked `employees/{employeeId}` document (mirrors firestore.rules'
// isActiveOperationalRole() exactly), so a technician with an ACTIVE PARTS_MANAGER or
// WAREHOUSE_MANAGER operational role now genuinely qualifies for this capability through that feed --
// this is no longer a declared-but-unreachable grant. It still requires the SAME independent gates
// this whole capability has always required regardless of operational role: `active:false` in
// permissionCatalog.ts (per-environment activation) and, in production, a real Owner grant -- neither
// of those changed here.
//
// EXPORT != DEPLOY, REGISTER != GRANT. Exported for build/test only; nothing runs in production
// until a separate deploy + capability grant + per-environment activation.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { MANUFACTURERS_COLLECTION } from "./partMasterRepository";
import { MANUFACTURER_STATUSES, type ManufacturerStatus } from "./types";

export const INVENTORY_CATALOG_READ_CAPABILITY = "inventory.catalog.read";

export interface ManufacturerProjection {
  manufacturerId: string;
  name: string;
  status: ManufacturerStatus | null;
  // Part 11 reconciliation (2026-08-15): the optimistic-concurrency token the trusted write
  // commands (updateManufacturer/changeManufacturerStatus, manufacturerCommands.ts) require as
  // `expectedVersion`. Added so this SAME governed read can also serve the Manufacturer admin
  // workspace (field-ops-app-vite/src/modules/inventory/Manufacturers.jsx), which previously read
  // the Rules-closed `manufacturers` collection directly (always permission-denied) because this
  // projection was Parts-picker-only and didn't carry what a write-capable admin view needs.
  // Still not a vendor/contract/financial field -- purely a concurrency primitive, already
  // client-visible via the same doc's `version` field wherever a governed write already exists.
  version: number;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v : null);

// Pure projection of one canonical Manufacturer doc -> the minimal shape. Returns null if the doc
// cannot yield a usable projection (missing id/name, or a status outside the governed enum -- an
// unrecognized status is never trusted/guessed at, it is honestly reported as null rather than
// fabricated). `version` defaults to 0 when absent/non-integer -- mirrors the client mirror's own
// default (domain/manufacturersView.js's toManufacturerListView), not a fabricated value: a
// freshly-created record with no writes yet genuinely has no version stamped.
export function projectManufacturer(id: string, data: Record<string, unknown> | undefined): ManufacturerProjection | null {
  if (!id || !data || typeof data !== "object") return null;
  const name = str(data.name);
  if (!name) return null;
  const status = (MANUFACTURER_STATUSES as readonly string[]).includes(data.status as string)
    ? (data.status as ManufacturerStatus)
    : null;
  const version = Number.isInteger(data.version) ? (data.version as number) : 0;
  return { manufacturerId: id, name, status, version };
}

export type ManufacturerListReadStatus = "ready";

export interface ManufacturerListReadResult {
  status: ManufacturerListReadStatus;
  manufacturers: ManufacturerProjection[];
  // Malformed documents (missing name / unrecognized structure) are silently dropped from
  // `manufacturers` -- never fabricated -- but the count is surfaced so a caller can honestly
  // report "N malformed record(s) excluded" the same way PartMasterList.jsx already does for Parts.
  excludedCount: number;
}

// The trusted read callable -- the FULL Manufacturer catalog (small, reference-data-shaped
// collection; no per-id read needed the way Sales Order's is -- a picker/display surface wants the
// whole list). Maps failures to HttpsError so the client can distinguish denied (permission-denied)
// from unavailable (internal).
export const getManufacturerCatalog = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");

  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({
      principalUid: request.auth.uid,
      permissionIds: [INVENTORY_CATALOG_READ_CAPABILITY],
    });
    allowed = decisions[INVENTORY_CATALOG_READ_CAPABILITY] === true;
  } catch {
    allowed = false; // fail closed
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to read the Manufacturer catalog.");

  try {
    const db = getFirestore();
    const snap = await db.collection(MANUFACTURERS_COLLECTION).get();
    const manufacturers: ManufacturerProjection[] = [];
    let excludedCount = 0;
    for (const doc of snap.docs) {
      const projection = projectManufacturer(doc.id, doc.data());
      if (projection) manufacturers.push(projection);
      else excludedCount++;
    }
    const result: ManufacturerListReadResult = { status: "ready", manufacturers, excludedCount };
    return result;
  } catch {
    throw new HttpsError("internal", "The Manufacturer catalog read is temporarily unavailable.");
  }
});
