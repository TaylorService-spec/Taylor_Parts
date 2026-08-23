// THE TECHNICIAN'S TWO CALLABLES: what can I install, and record that I did.
//
// ============================ WHY A WORK-ORDER-SCOPED READ ============================
//
// `getAvailableEquipment` already returns installable units, and reusing it would have been less
// code. It was NOT reused, for one reason: it is gated on `inventory.serializedAsset.read`, a general
// inventory-browsing capability that the installer technicians do not hold and should not be given.
// Granting it to populate a picker would hand a technician the whole serialized inventory in order to
// let them choose one machine on one job.
//
// So this read is gated on `equipment.install` and scoped by the Work Order: it answers "what may I
// install on THIS job", which is the only question a closeout screen has.
//
// `serialized_assets` remains deny-all to every client, and nothing here changes that. The technician
// never reads the collection; a trusted function reads it on their behalf, having first checked that
// the job is theirs.
//
// ============================ SCAN IS NOT INSTALL ============================
//
// Resolving a scanned serial is a READ. It returns what the serial is and whether it may be
// installed, and it writes nothing at all -- no Equipment, no state change, no completion. Only the
// record callable mutates anything, and only when the technician explicitly confirms.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import {
  recordWorkOrderEquipmentInstall,
  resolveInstallWorkOrder,
  assertWorkOrderInstallable,
  loadWholeUnitPartIds,
  WorkOrderInstallError,
  INSTALLABLE_WORK_ORDER_STATUSES,
  SERIALIZED_ASSETS_COLLECTION,
  PARTS_COLLECTION,
  type WorkOrderInstallFailureCode,
} from "./workOrderInstallCommand.js";
import {
  InstallCommandError,
  EQUIPMENT_INSTALL_CAPABILITY,
  INSTALLABLE_STATES,
} from "../equipmentInstall/installSerializedAssetCommand.js";
import { makeResolveInstallPermissionThroughTxn, stageInstallAuditEvent } from "../equipmentInstall/installCallableWiring.js";
import { projectSerializedAsset } from "../serializedAsset/serializedAssetReadService.js";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed.js";
import { getCallerContext } from "../callerContext.js";

const REGION = { region: "us-central1" } as const;

/** How many units a closeout picker may list. A technician chooses one machine, not a catalogue. */
const INSTALLABLE_LIST_CAP = 200;

const throughTxn = makeResolveInstallPermissionThroughTxn(EQUIPMENT_INSTALL_CAPABILITY);

/**
 * Capability, resolved two ways for two different moments.
 *
 * Outside a transaction (the read, and the pre-flight on the write) the trusted feed answers. Inside
 * the install transaction, the transaction-scoped resolver answers, so a revocation mid-flight
 * conflicts the commit. Both ask the same question of the same records; neither is a shortcut.
 */
async function allows(uid: string, capability: string): Promise<boolean> {
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [capability] });
    return decisions[capability] === true;
  } catch (err) {
    console.error(`[workOrderInstall] capability resolution failed for ${capability}`, err);
    return false;   // A THROWING resolver is a denial, never an allow.
  }
}

const authorize = (txn: Transaction | null, db: Firestore) =>
  (t: Transaction | null, actorId: string, capability: string) =>
    (t === null ? allows(actorId, capability) : throughTxn(t, db, actorId));

/** Actor identity from the authenticated session plus users/{uid} -- never from a payload. */
async function resolveActor(uid: string) {
  const ctx = await getCallerContext(uid);
  return { kind: "USER" as const, id: uid, technicianId: ctx.technicianId, role: ctx.role };
}

const FAILURE: Readonly<Record<WorkOrderInstallFailureCode, { status: "permission-denied" | "invalid-argument" | "failed-precondition" | "not-found"; message: string }>> = Object.freeze({
  PERMISSION_DENIED: { status: "permission-denied", message: "You are not authorized to record an equipment installation." },
  WORK_ORDER_NOT_FOUND: { status: "not-found", message: "That work order could not be found." },
  WORK_ORDER_NOT_INSTALL_TYPE: { status: "failed-precondition", message: "This work order is not an installation, so no equipment is installed on it." },
  WORK_ORDER_STATE_INVALID: { status: "failed-precondition", message: "This work order is not in progress, so an installation cannot be recorded against it." },
  NOT_ASSIGNED_TECHNICIAN: { status: "permission-denied", message: "This work order is not assigned to you." },
  WORK_ORDER_MISSING_CUSTOMER: { status: "failed-precondition", message: "This work order has no customer recorded." },
  WORK_ORDER_MISSING_LOCATION: { status: "failed-precondition", message: "This work order has no location recorded." },
  ASSET_NOT_FOUND: { status: "not-found", message: "That serial could not be found." },
  ASSET_NOT_WHOLE_UNIT: { status: "failed-precondition", message: "That serial is not a machine, so it cannot be installed as equipment." },
  ASSET_NOT_INSTALLABLE: { status: "failed-precondition", message: "That unit is not in a state that can be installed." },
  ASSET_INSTALLED_ELSEWHERE: { status: "failed-precondition", message: "That unit is already installed for another customer." },
  REQUEST_INVALID: { status: "invalid-argument", message: "That installation request is not valid." },
});

function toHttps(err: unknown): HttpsError {
  if (err instanceof WorkOrderInstallError) {
    const m = FAILURE[err.code];
    return new HttpsError(m.status, m.message, err.code);
  }
  if (err instanceof InstallCommandError) {
    // The install authority's own refusals pass through under their own codes. Renaming them here
    // would give the same condition two names depending on which door it came through.
    return new HttpsError("failed-precondition", "That unit could not be installed.", err.code);
  }
  console.error("[workOrderInstall] failed", err);
  return new HttpsError("internal", "The request could not be completed.", "INTERNAL");
}

/**
 * What may be installed on this work order.
 *
 * Read-only. Writes nothing, ever -- including when a scanned serial is supplied.
 */
export const getInstallableEquipmentForWorkOrder = onCall(REGION, async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Must be signed in.");
  const db = getFirestore();
  const uid = request.auth.uid;
  try {
    const workOrderId = typeof (request.data ?? {}).workOrderId === "string" ? request.data.workOrderId.trim() : "";
    if (!workOrderId) throw new WorkOrderInstallError("REQUEST_INVALID", "workOrderId required");
    const scannedSerial = typeof (request.data ?? {}).serialNo === "string" ? request.data.serialNo.trim() : null;

    if (!(await allows(uid, EQUIPMENT_INSTALL_CAPABILITY))) {
      throw new WorkOrderInstallError("PERMISSION_DENIED", "not authorized to install equipment");
    }
    const actor = await resolveActor(uid);
    const wo = await resolveInstallWorkOrder(db, workOrderId);
    // The SAME eligibility the write path enforces. A read that answered for a job the caller may not
    // finish would leak which machines are available to somebody who cannot use them.
    assertWorkOrderInstallable(wo, actor);

    const wholeUnitPartIds = await loadWholeUnitPartIds(db);
    const partsSnap = await db.collection(PARTS_COLLECTION).where("wholeUnit", "==", true).get();
    const partById = new Map(partsSnap.docs.map((d) => [d.id, d.data() ?? {}]));

    // Query by STATE, then filter to whole units in memory. `serialized_assets` has no wholeUnit field
    // -- that lives on the Part -- so a single query cannot express both halves.
    const assetsSnap = await db.collection(SERIALIZED_ASSETS_COLLECTION)
      .where("inventoryState", "in", [...INSTALLABLE_STATES]).limit(INSTALLABLE_LIST_CAP * 2).get();

    const units: Record<string, unknown>[] = [];
    for (const doc of assetsSnap.docs) {
      const asset = projectSerializedAsset(doc.id, doc.data());
      if (asset === null) continue;                       // malformed: omitted, never fabricated
      if (asset.currentEquipmentId) continue;             // belongs to somebody already
      if (!wholeUnitPartIds.has(asset.partId)) continue;  // a component, not a machine
      if (scannedSerial && asset.serialNo !== scannedSerial) continue;
      const part = partById.get(asset.partId) ?? {};
      units.push({
        serializedAssetId: doc.id,
        serialNo: asset.serialNo,
        partId: asset.partId,
        // The display fields a technician needs to confirm they have the right box in front of them.
        productName: typeof part.name === "string" ? part.name : null,
        equipmentModelId: typeof part.equipmentModelId === "string" ? part.equipmentModelId : null,
        inventoryState: asset.inventoryState,
        currentLocationId: asset.currentLocationId,
      });
      if (units.length >= INSTALLABLE_LIST_CAP) break;
    }

    return {
      status: "ready",
      workOrder: {
        workOrderId: wo.workOrderId,
        woNumber: wo.woNumber,
        // Inherited, and returned so the UI can DISPLAY them read-only rather than offer them.
        customerId: wo.customerId,
        locationId: wo.locationId,
        status: wo.status,
        type: wo.type,
      },
      installableStates: [...INSTALLABLE_STATES],
      workOrderStates: [...INSTALLABLE_WORK_ORDER_STATUSES],
      units,
      truncated: units.length >= INSTALLABLE_LIST_CAP,
      // Said explicitly so no caller has to infer it: looking is not installing.
      mutated: false,
    };
  } catch (err) {
    throw toHttps(err);
  }
});

/**
 * Record the installation. Step ONE of closeout -- the Work Order is completed separately.
 *
 * See workOrderInstallCommand's header: install first, complete after, so a completed job whose
 * installation failed cannot exist.
 */
export const recordWorkOrderEquipmentInstallCallable = onCall(REGION, async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Must be signed in.");
  const db = getFirestore();
  const uid = request.auth.uid;
  try {
    const actor = await resolveActor(uid);
    return await recordWorkOrderEquipmentInstall(request.data, {
      db,
      actor,
      authorize: authorize(null, db),
      stageAudit: stageInstallAuditEvent,
      now: () => new Date(),
    });
  } catch (err) {
    throw toHttps(err);
  }
});
