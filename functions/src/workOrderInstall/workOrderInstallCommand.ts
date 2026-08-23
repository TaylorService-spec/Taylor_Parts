// INSTALLING A MACHINE AS PART OF FINISHING THE JOB.
//
// ============================ WHAT THIS IS, AND WHAT IT REFUSES TO BE ============================
//
// A technician standing at a customer site with a machine has already been told, by the Work Order,
// who the customer is and which of their locations they are at. The only thing they know that the
// platform does not is WHICH MACHINE.
//
// So this asks for exactly that, and derives everything else from the Work Order -- read here,
// server-side, never accepted from the client. A technician gets no customer picker and no location
// picker, because offering one would be asking them to re-enter a fact the system already holds and
// giving them the opportunity to get it wrong.
//
// IT IS NOT A SECOND INSTALL COMMAND. installSerializedAsset stays the single authority for what
// installing means -- the installable states, the account/location consistency rule, the derived
// Equipment id, the single transaction. This decides WHETHER this technician, on this Work Order, may
// ask for it, and with which arguments.
//
// ============================ ORDERING IS THE CONSISTENCY MODEL ============================
//
// Two callables cannot share a Firestore transaction. Rather than pretend otherwise, the order does
// the work: INSTALL FIRST, then complete the Work Order.
//
//   install fails                -> nothing happened; the Work Order is untouched and still open
//   install ok, completion fails -> the machine is installed and the job is still open, which is
//                                   recoverable and visible
//
// The forbidden state -- a CLOSED Work Order whose installation silently failed -- is unreachable,
// because completion is never attempted until the installation has already succeeded.
//
// This command performs step one and reports what step two still needs. It deliberately does NOT
// complete the Work Order itself: `transitionWorkOrder` owns the lifecycle, its Complete carries a
// same-technician concurrency lock and a Sales Order write-back, and reimplementing any of that here
// would be a second lifecycle engine.
//
// ============================ RECOVERY WITHOUT BROWSER MEMORY ============================
//
// If the response to step one is lost, the technician retries. The retry must not install a second
// machine, and must not depend on the browser remembering that the first attempt worked.
//
// So the authoritative state is re-read: an asset already installed, whose Equipment belongs to THIS
// Work Order's customer and location, is reported as already done -- with the Equipment id -- and the
// install is not attempted again. That is a fact about the database, not about the tab.
import type { Firestore, Transaction } from "firebase-admin/firestore";
import {
  installSerializedAsset,
  InstallCommandError,
  EQUIPMENT_INSTALL_CAPABILITY,
  INSTALLABLE_STATES,
  type InstallOutcome,
} from "../equipmentInstall/installSerializedAssetCommand.js";
import { projectSerializedAsset } from "../serializedAsset/serializedAssetReadService.js";
import type { InstallAuditInput } from "../equipmentInstall/installSerializedAssetCommand.js";

export const WORK_ORDERS_COLLECTION = "fieldops_wos";
export const SERIALIZED_ASSETS_COLLECTION = "serialized_assets";
export const EQUIPMENT_COLLECTION = "equipment";
export const PARTS_COLLECTION = "parts";

/**
 * The ONE Work Order type that carries an installation.
 *
 * `INSTALL` is already canonical in WorkOrderType. A second indicator -- requiresEquipmentInstallation
 * or similar -- would be a second way to say what the model already says, and the two would disagree
 * the first time somebody set one without the other.
 */
export const INSTALL_WORK_ORDER_TYPE = "INSTALL";

/**
 * Work Order statuses from which an installation may be recorded.
 *
 * WORK_IN_PROGRESS only: it is the single state Complete may follow, so recording an installation
 * from anywhere else would produce a machine installed against a job that cannot then be completed.
 * A terminal Work Order is refused outright -- installing against a closed job is a correction, and
 * corrections are not what a closeout screen is for.
 */
export const INSTALLABLE_WORK_ORDER_STATUSES: readonly string[] = Object.freeze(["WORK_IN_PROGRESS"]);

export type WorkOrderInstallFailureCode =
  | "PERMISSION_DENIED"
  | "WORK_ORDER_NOT_FOUND"
  | "WORK_ORDER_NOT_INSTALL_TYPE"
  | "WORK_ORDER_STATE_INVALID"
  | "NOT_ASSIGNED_TECHNICIAN"
  | "WORK_ORDER_MISSING_CUSTOMER"
  | "WORK_ORDER_MISSING_LOCATION"
  | "ASSET_NOT_FOUND"
  | "ASSET_NOT_WHOLE_UNIT"
  | "ASSET_NOT_INSTALLABLE"
  | "ASSET_INSTALLED_ELSEWHERE"
  | "REQUEST_INVALID";

export class WorkOrderInstallError extends Error {
  readonly code: WorkOrderInstallFailureCode;
  constructor(code: WorkOrderInstallFailureCode, message: string) {
    super(message);
    this.code = code;
    this.name = "WorkOrderInstallError";
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** The keys a caller may send. Notably ABSENT: accountId and locationId -- both come from the Work Order. */
const ALLOWED_KEYS = new Set(["workOrderId", "serializedAssetId", "notes", "idempotencyKey"]);

export interface ValidatedWorkOrderInstallRequest {
  readonly workOrderId: string;
  readonly serializedAssetId: string;
  readonly idempotencyKey: string;
  readonly notes?: string;
}

export function validateWorkOrderInstallRequest(input: unknown): ValidatedWorkOrderInstallRequest {
  if (!isPlainObject(input)) throw new WorkOrderInstallError("REQUEST_INVALID", "request is not an object");
  for (const k of Object.keys(input)) {
    // An accountId or locationId in the payload is not ignored -- it is REFUSED. Silently dropping it
    // would let a caller believe they had chosen a customer, and the mismatch would surface later as
    // an installation somewhere they did not intend.
    if (!ALLOWED_KEYS.has(k)) {
      throw new WorkOrderInstallError("REQUEST_INVALID",
        `unknown field ${k}` + (k === "accountId" || k === "locationId"
          ? " -- customer and location are derived from the work order, never supplied" : ""));
    }
  }
  const workOrderId = str(input.workOrderId);
  const serializedAssetId = str(input.serializedAssetId);
  const idempotencyKey = str(input.idempotencyKey);
  if (!workOrderId) throw new WorkOrderInstallError("REQUEST_INVALID", "workOrderId required");
  if (!serializedAssetId) throw new WorkOrderInstallError("REQUEST_INVALID", "serializedAssetId required");
  if (!idempotencyKey) throw new WorkOrderInstallError("REQUEST_INVALID", "idempotencyKey required");
  const notes = input.notes === undefined ? undefined : str(input.notes);
  if (input.notes !== undefined && !notes) {
    throw new WorkOrderInstallError("REQUEST_INVALID", "notes must be a non-empty string when present");
  }
  return { workOrderId, serializedAssetId, idempotencyKey, ...(notes ? { notes } : {}) };
}

export interface WorkOrderInstallActor {
  readonly kind: "USER";
  readonly id: string;
  /** The technician identity the Work Order's assignment is expressed in. Resolved by the caller from users/{uid}. */
  readonly technicianId: string | null;
  readonly role: string | null;
}

export interface ResolvedInstallWorkOrder {
  readonly workOrderId: string;
  readonly status: string;
  readonly type: string | null;
  readonly customerId: string | null;
  readonly locationId: string | null;
  readonly assignedTechId: string | null;
  readonly woNumber: string | null;
}

export interface WorkOrderInstallDeps {
  readonly db: Firestore;
  readonly actor: WorkOrderInstallActor;
  readonly authorize: (txn: Transaction | null, actorId: string, capability: string) => Promise<boolean>;
  readonly stageAudit: (txn: Transaction, audit: InstallAuditInput) => void;
  readonly now: () => Date;
}

export interface WorkOrderInstallOutcome {
  readonly outcome: "installed" | "replayed" | "already_installed_for_this_work_order";
  readonly workOrderId: string;
  readonly equipmentId: string;
  readonly serializedAssetId: string;
  readonly serialNo: string;
  readonly accountId: string;
  readonly locationId: string;
  /** The Work Order's status AFTER the install -- unchanged by this command. */
  readonly workOrderStatus: string;
  /** True while the job still has to be completed. The caller's next step, stated rather than assumed. */
  readonly completionRequired: boolean;
}

/** Read the Work Order and say plainly what is wrong with it, if anything. */
export async function resolveInstallWorkOrder(
  db: Firestore, workOrderId: string,
): Promise<ResolvedInstallWorkOrder> {
  const snap = await db.collection(WORK_ORDERS_COLLECTION).doc(workOrderId).get();
  if (!snap.exists) throw new WorkOrderInstallError("WORK_ORDER_NOT_FOUND", `work order ${workOrderId} not found`);
  const d = snap.data() ?? {};
  return {
    workOrderId,
    status: str(d.status) ?? "",
    type: str(d.type),
    customerId: str(d.customerId),
    locationId: str(d.locationId),
    assignedTechId: str(d.assignedTechId),
    woNumber: str(d.woNumber),
  };
}

/**
 * May this caller record an installation against this Work Order?
 *
 * Deliberately the SAME boundary the Complete action already enforces -- technician, and the one
 * assigned to this specific Work Order. Inventing a separate rule for installation would mean a
 * technician could install on a job they are not allowed to finish, which is a state nobody wants to
 * have to explain.
 */
export function assertWorkOrderInstallable(
  wo: ResolvedInstallWorkOrder,
  actor: WorkOrderInstallActor,
  { requireInProgressState = true }: { requireInProgressState?: boolean } = {},
): void {
  // TYPE FIRST, and never inferred. A Work Order carrying no type, or a type outside the canonical
  // set, is NOT treated as an installation -- live data contains both, and reading a missing value as
  // INSTALL would silently install machines against jobs nobody classified.
  if (wo.type !== INSTALL_WORK_ORDER_TYPE) {
    throw new WorkOrderInstallError("WORK_ORDER_NOT_INSTALL_TYPE",
      `work order ${wo.workOrderId} is ${wo.type === null ? "untyped" : `type ${wo.type}`}, not ${INSTALL_WORK_ORDER_TYPE}`);
  }
  // THE STATE CHECK IS SKIPPABLE, AND ONLY FOR RECOVERY.
  //
  // A NEW installation may only be recorded from WORK_IN_PROGRESS. But a technician whose install
  // succeeded and whose completion ALSO succeeded -- and who never saw either response -- is asking
  // about a machine that is genuinely installed on a job that is genuinely done. Refusing that query
  // with "this work order is COMPLETED" would be technically true and practically a lie: it reads as
  // "your installation did not happen".
  //
  // So the caller relaxes this check ONLY on the path that has already established the asset is
  // installed for this exact customer and location. Everything else -- capability, type, ownership --
  // is checked first and is never relaxed.
  if (requireInProgressState && !INSTALLABLE_WORK_ORDER_STATUSES.includes(wo.status)) {
    throw new WorkOrderInstallError("WORK_ORDER_STATE_INVALID",
      `work order ${wo.workOrderId} is ${wo.status}; an installation may only be recorded from ${INSTALLABLE_WORK_ORDER_STATUSES.join(", ")}`);
  }
  // OWN ASSIGNMENT. Holding equipment.install is not permission to finish somebody else's job.
  if (actor.role !== "technician") {
    throw new WorkOrderInstallError("NOT_ASSIGNED_TECHNICIAN",
      "work order closeout installation is the assigned technician's path; managers install from the Equipment surface");
  }
  if (!actor.technicianId || wo.assignedTechId !== actor.technicianId) {
    throw new WorkOrderInstallError("NOT_ASSIGNED_TECHNICIAN",
      `work order ${wo.workOrderId} is not assigned to this technician`);
  }
  if (!wo.customerId) {
    throw new WorkOrderInstallError("WORK_ORDER_MISSING_CUSTOMER",
      `work order ${wo.workOrderId} has no customer, so there is nobody to install for`);
  }
  if (!wo.locationId) {
    throw new WorkOrderInstallError("WORK_ORDER_MISSING_LOCATION",
      `work order ${wo.workOrderId} has no location, so there is nowhere to install`);
  }
}

/** Whole-unit Part ids, for deciding whether an asset is a machine at all. */
export async function loadWholeUnitPartIds(db: Firestore): Promise<Set<string>> {
  const snap = await db.collection(PARTS_COLLECTION).where("wholeUnit", "==", true).get();
  return new Set(snap.docs.map((d) => d.id));
}

/**
 * Record an installation as part of a Work Order.
 *
 * Returns WITHOUT completing the Work Order -- see the header on why ordering, not atomicity, is the
 * consistency model, and why the lifecycle stays where it lives.
 */
export async function recordWorkOrderEquipmentInstall(
  request: unknown, deps: WorkOrderInstallDeps,
): Promise<WorkOrderInstallOutcome> {
  const actor = deps.actor;
  if (!isPlainObject(actor) || actor.kind !== "USER" || !str(actor.id)) {
    throw new WorkOrderInstallError("PERMISSION_DENIED", "trusted actor context missing");
  }
  const req = validateWorkOrderInstallRequest(request);

  // CAPABILITY BEFORE ANYTHING IS READ ABOUT THE JOB. A caller who may not install has no business
  // learning which customer a Work Order belongs to.
  if (!(await deps.authorize(null, actor.id, EQUIPMENT_INSTALL_CAPABILITY))) {
    throw new WorkOrderInstallError("PERMISSION_DENIED", "actor is not authorized to install equipment");
  }

  const wo = await resolveInstallWorkOrder(deps.db, req.workOrderId);
  // Type, ownership, customer and location FIRST -- none of them is ever relaxed. The work order's
  // STATE is checked later, after the asset is known, so a recovery query about an already-installed
  // machine can be answered truthfully even on a job that has since been completed.
  assertWorkOrderInstallable(wo, actor, { requireInProgressState: false });
  const accountId = wo.customerId as string;
  const locationId = wo.locationId as string;

  // ---- THE ASSET, and whether this is a retry of something that already worked.
  const assetSnap = await deps.db.collection(SERIALIZED_ASSETS_COLLECTION).doc(req.serializedAssetId).get();
  if (!assetSnap.exists) {
    throw new WorkOrderInstallError("ASSET_NOT_FOUND", `serialized asset ${req.serializedAssetId} not found`);
  }
  // The GOVERNED projection, not the raw document -- provenance fields are stripped before
  // validation, exactly as the install command itself reads an asset.
  const asset = projectSerializedAsset(req.serializedAssetId, assetSnap.data());
  if (asset === null) {
    throw new WorkOrderInstallError("ASSET_NOT_FOUND", `serialized asset ${req.serializedAssetId} cannot be read`);
  }

  // A MACHINE, not a component. A serialized service part has a serial too, and installing one as
  // customer Equipment would put a control board in the installed base as if it were a unit.
  const wholeUnitPartIds = await loadWholeUnitPartIds(deps.db);
  if (!wholeUnitPartIds.has(asset.partId)) {
    throw new WorkOrderInstallError("ASSET_NOT_WHOLE_UNIT",
      `part ${asset.partId} is not a whole-unit machine`);
  }

  if (asset.currentEquipmentId) {
    // ALREADY INSTALLED. Two very different situations, and conflating them would either lose a
    // machine or duplicate one.
    const eqSnap = await deps.db.collection(EQUIPMENT_COLLECTION).doc(asset.currentEquipmentId).get();
    const eq = eqSnap.exists ? (eqSnap.data() ?? {}) : {};
    const sameJob = str(eq.accountId) === accountId && str(eq.locationId) === locationId;
    if (!sameJob) {
      throw new WorkOrderInstallError("ASSET_INSTALLED_ELSEWHERE",
        `serialized asset ${req.serializedAssetId} is already installed for another customer or location`);
    }
    // The retry case, answered from the DATABASE rather than from whatever the browser remembers.
    return {
      outcome: "already_installed_for_this_work_order",
      workOrderId: wo.workOrderId,
      equipmentId: asset.currentEquipmentId,
      serializedAssetId: req.serializedAssetId,
      serialNo: asset.serialNo,
      accountId, locationId,
      workOrderStatus: wo.status,
      completionRequired: wo.status !== "COMPLETED" && wo.status !== "CLOSED",
    };
  }

  // NOT a recovery -- this is a genuinely new installation, so the work order's state applies.
  assertWorkOrderInstallable(wo, actor, { requireInProgressState: true });

  if (!INSTALLABLE_STATES.includes(asset.inventoryState)) {
    throw new WorkOrderInstallError("ASSET_NOT_INSTALLABLE",
      `serialized asset ${req.serializedAssetId} is ${asset.inventoryState}`);
  }

  // ---- THE ONE AUTHORITY. Everything above decided whether to ask; this is the asking.
  let outcome: InstallOutcome;
  try {
    outcome = await installSerializedAsset({
      serializedAssetId: req.serializedAssetId,
      accountId, locationId,
      name: `${asset.serialNo}`,
      idempotencyKey: req.idempotencyKey,
      ...(req.notes ? { notes: req.notes } : {}),
    }, {
      db: deps.db,
      actor: { kind: "USER", id: actor.id },
      authorize: (txn, actorId, capability) => deps.authorize(txn, actorId, capability),
      stageAudit: deps.stageAudit,
      now: deps.now,
      // The origin, established here by reading the Work Order -- never taken from the request.
      sourceContext: { kind: "WORK_ORDER", workOrderId: wo.workOrderId },
    });
  } catch (err) {
    // The install authority's refusals are its own and are not re-translated into this command's
    // vocabulary -- an ALREADY_INSTALLED from the transaction means something raced us, and saying so
    // in its own words is more useful than renaming it.
    if (err instanceof InstallCommandError) throw err;
    throw err;
  }

  return {
    outcome: outcome.outcome,
    workOrderId: wo.workOrderId,
    equipmentId: outcome.equipmentId,
    serializedAssetId: outcome.serializedAssetId,
    serialNo: outcome.serialNo,
    accountId, locationId,
    // Re-read from the Work Order as it was BEFORE this command -- this command does not complete it,
    // and reporting a status it did not cause would be a claim it has no right to make.
    workOrderStatus: wo.status,
    completionRequired: true,
  };
}
