// Cycle Count A1/A4 -- the deployed callable surface of the sheet/line model. The ONLY callables that
// create or read cycle counts: the v1 single-part callables are no longer exported (Decision #179).
//
// Request contracts are exact (unknown fields refused). Authorization is the same through-transaction
// resolver the v1 family used, with per-environment activation. Errors are sanitized; the domain code rides
// in `details.code` so a screen can tell "sheet closed" from "not authorized" without parsing words.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest, FunctionsErrorCode } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { stageAuditEvent } from "../access/auditEventWriter.js";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed.js";
import { WAREHOUSES_COLLECTION } from "../constants/collections.js";
import { isOperatingCompanyIdShape } from "../ownership/operatingCompanyAuthority.js";
import { resolveTransferCustodyWarehouseId } from "../inventoryTransfer/transferLocationResolver.js";
import { CycleCountCommandError, type CycleCountCommandFailureCode, type CycleCountLocationRef } from "./cycleCountTypes.js";
import { makeResolveCycleCountPermissionThroughTxn, resolveCycleCountPartThroughTxn } from "./cycleCountCallableWiring.js";
import { makeResolveCycleCountLocationEligible } from "./cycleCountLocationEligibility.js";
import {
  CYCLE_COUNT_CAPABILITY,
  createCycleCountSheet, openCycleCountLine, submitCycleCountLine, reconcileCycleCountLine,
  cancelCycleCountLine, cancelCycleCountSheet, closeCycleCountSheet,
  type SheetCommandDeps, type SheetAuditInput,
} from "./cycleCountSheetCommand.js";
import { listCycleCountSheets, getCycleCountSheet, CycleCountReadInvalidError } from "./cycleCountSheetRead.js";
import { readAssignedMobileLocation } from "../workOrderConsumption/consumptionSourceService.js";

const REGION = { region: "us-central1" } as const;

function requireAuth(request: { auth?: { uid?: unknown } | null }): string {
  if (!request.auth || typeof request.auth.uid !== "string" || request.auth.uid.length === 0) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }
  return request.auth.uid;
}
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function exactKeys(data: unknown, allowed: string[]): Record<string, unknown> {
  if (!isPlainObject(data)) throw new HttpsError("invalid-argument", "Request data must be an object.", { code: "INVALID" });
  if (Object.keys(data).some((k) => !allowed.includes(k))) throw new HttpsError("invalid-argument", "The request has unknown fields.", { code: "INVALID" });
  return data;
}

/** The counted location's owning company (Ownership Model v1): the governed Warehouse's, or a Bin's parent's. */
export async function resolveCountLocationCompany(txn: Transaction, db: Firestore, location: CycleCountLocationRef): Promise<string | null> {
  if (location.type !== "WAREHOUSE" && location.type !== "BIN") return null; // a truck's company is not derived here
  const warehouseId = await resolveTransferCustodyWarehouseId(txn, db, location);
  if (!warehouseId) return null;
  const snap = await txn.get(db.collection(WAREHOUSES_COLLECTION).doc(warehouseId));
  const company = snap.exists ? (snap.data() ?? {}).operatingCompanyId : undefined;
  return isOperatingCompanyIdShape(company) ? company : null;
}

export function stageSheetAuditEvent(txn: Transaction, a: SheetAuditInput): void {
  const detail = a.variance !== undefined ? ` variance ${a.variance}`
    : a.serialVariance !== undefined ? ` missing ${a.serialVariance.missing.length}, unexpected ${a.serialVariance.unexpected.length}` : "";
  stageAuditEvent(txn, {
    actorUid: a.actorId,
    action: a.action,
    targetType: "cycleCountSheet",
    targetId: a.sheetId,
    outcome: "applied",
    summary: `${a.action}${a.partId ? ` part ${a.partId}` : ""} at ${a.location.type}:${a.location.locationId}${detail}`.slice(0, 500),
  });
}

export function productionSheetDeps(db: Firestore, actorUid: string): SheetCommandDeps {
  const eligible = makeResolveCycleCountLocationEligible(db);
  return {
    db,
    actor: { kind: "USER", id: actorUid },
    authorize: (txn, actorId, capability) => makeResolveCycleCountPermissionThroughTxn(capability)(txn, db, actorId),
    resolvePart: (txn, partId) => resolveCycleCountPartThroughTxn(txn, db, partId),
    resolveLocationEligible: eligible,
    resolveLocationCompany: (txn, location) => resolveCountLocationCompany(txn, db, location),
    stageAudit: stageSheetAuditEvent,
    now: () => new Date(),
  };
}

const HTTP: Record<CycleCountCommandFailureCode, FunctionsErrorCode> = {
  PERMISSION_DENIED: "permission-denied",
  SEPARATION_OF_DUTIES: "permission-denied",
  CYCLE_COUNT_NOT_FOUND: "not-found",
  SHEET_NOT_FOUND: "not-found",
  LOCATION_INVALID: "failed-precondition",
  PART_INVALID: "failed-precondition",
  SERIAL_INVALID: "failed-precondition",
  QUANTITY_INVALID: "failed-precondition",
  REASON_REQUIRED: "failed-precondition",
  STATUS_INVALID: "failed-precondition",
  SHEET_STATUS_INVALID: "failed-precondition",
  IDEMPOTENCY_CONFLICT: "already-exists",
  MALFORMED_STORED_RECORD: "failed-precondition",
  CYCLE_COUNT_INTEGRITY: "internal",
};
const MESSAGE: Partial<Record<CycleCountCommandFailureCode, string>> = {
  SEPARATION_OF_DUTIES: "You submitted this count and cannot approve or reject its own material variance -- a different manager must review it.",
  PERMISSION_DENIED: "You are not authorized to perform this cycle count action.",
  SHEET_NOT_FOUND: "That count sheet could not be found.",
  CYCLE_COUNT_NOT_FOUND: "That part has no line on this sheet.",
  LOCATION_INVALID: "That location cannot be counted.",
  REASON_REQUIRED: "A reason is required when the count differs from what was expected.",
  SHEET_STATUS_INVALID: "This sheet no longer allows that action.",
  STATUS_INVALID: "That line no longer allows that action.",
  IDEMPOTENCY_CONFLICT: "This was already submitted with different details.",
};
function mapError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof CycleCountCommandError) {
    return new HttpsError(HTTP[err.code] ?? "internal", MESSAGE[err.code] ?? "The cycle count action could not be completed.", { code: err.code });
  }
  if (err instanceof CycleCountReadInvalidError) return new HttpsError("invalid-argument", "That request could not be accepted.", { code: "INVALID" });
  console.error("[cycleCountSheet] unexpected failure", err);
  return new HttpsError("internal", "The cycle count action could not be completed.", { code: "CYCLE_COUNT_INTEGRITY" });
}

type Command = (request: unknown, deps: SheetCommandDeps) => Promise<unknown>;
function commandCallable(command: Command, keys: string[]) {
  return async (request: CallableRequest<unknown>, db: Firestore = getFirestore()) => {
    const actorUid = requireAuth(request);
    const data = exactKeys(request.data, keys);
    try {
      return await command(data, productionSheetDeps(db, actorUid));
    } catch (err) {
      throw mapError(err);
    }
  };
}

export const runCreateCycleCountSheet = commandCallable(createCycleCountSheet, ["location", "idempotencyKey"]);
export const runOpenCycleCountLine = commandCallable(openCycleCountLine, ["sheetId", "partId"]);
export const runSubmitCycleCountLine = commandCallable(submitCycleCountLine, ["sheetId", "partId", "countedQuantity", "countedSerialNumbers"]);
export const runReconcileCycleCountLine = commandCallable(reconcileCycleCountLine, ["sheetId", "partId", "decision", "reason"]);
export const runCancelCycleCountLine = commandCallable(cancelCycleCountLine, ["sheetId", "partId"]);
export const runCancelCycleCountSheet = commandCallable(cancelCycleCountSheet, ["sheetId"]);
export const runCloseCycleCountSheet = commandCallable(closeCycleCountSheet, ["sheetId"]);

/** A4 authority: any Cycle Count capability. Counting, reviewing and reconciling all need to see sheets. */
async function requireCycleCountRead(uid: string): Promise<void> {
  const ids = Object.values(CYCLE_COUNT_CAPABILITY);
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: ids });
    allowed = ids.some((id) => decisions[id] === true);
  } catch (err) {
    console.error("[cycleCountSheet] read authorization failed", err);
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to view cycle counts.", { code: "PERMISSION_DENIED" });
}
function readCallable(read: (request: unknown, db: Firestore) => Promise<unknown>) {
  return async (request: CallableRequest<unknown>, db: Firestore = getFirestore()) => {
    const uid = requireAuth(request);
    await requireCycleCountRead(uid);
    try {
      return await read(request.data, db);
    } catch (err) {
      throw mapError(err);
    }
  };
}
export const runListCycleCountSheets = readCallable(listCycleCountSheets);
export const runGetCycleCountSheet = readCallable(getCycleCountSheet);

export const createCycleCountSheetCallable = onCall(REGION, (r) => runCreateCycleCountSheet(r));
export const openCycleCountLineCallable = onCall(REGION, (r) => runOpenCycleCountLine(r));
export const submitCycleCountLineCallable = onCall(REGION, (r) => runSubmitCycleCountLine(r));
export const reconcileCycleCountLineCallable = onCall(REGION, (r) => runReconcileCycleCountLine(r));
export const cancelCycleCountLineCallable = onCall(REGION, (r) => runCancelCycleCountLine(r));
export const cancelCycleCountSheetCallable = onCall(REGION, (r) => runCancelCycleCountSheet(r));
export const closeCycleCountSheetCallable = onCall(REGION, (r) => runCloseCycleCountSheet(r));
export const listCycleCountSheetsCallable = onCall(REGION, (r) => runListCycleCountSheets(r));
export const getCycleCountSheetCallable = onCall(REGION, (r) => runGetCycleCountSheet(r));

// -------- getCycleCountAssignedMobileLocation: "which truck is mine?" for a Cycle Count technician --------
//
// TECHNICIAN MOBILE FLOW. A technician who holds Cycle Count counter authority (create + submit --
// the same pairing scanWorkflows.js's client-side gate uses) needs to know which MOBILE truck is
// theirs before they can start or resume a count there. This reuses the SAME governed
// truck-assignment resolver Transfer discovery already uses (readAssignedMobileLocation,
// trucks.assignedDriverEmployeeId -- workOrderConsumption/consumptionSourceService.ts) rather than
// inventing a second "my truck" authority. It is a narrow projection of the caller's OWN
// already-governed assignment, not a new permission: it grants no standing access, and the actual
// Cycle Count commands (createCycleCountSheet, etc.) re-derive and re-authorize location eligibility
// independently of anything this read returns.
//
// TWO INDEPENDENT FACTS, never conflated: (1) may this person count at all (the capability check
// below), (2) where may they count (the truck assignment). A truck assignment with no counter
// capability answers PERMISSION_DENIED before the truck is even looked up; counter capability with
// no assignment, or with an ambiguous one, answers a truthful failure -- never a first-of-many guess.
export type AssignedMobileFailure =
  | "PERMISSION_DENIED" | "TECHNICIAN_IDENTITY_UNAVAILABLE" | "NO_TRUCK_ASSIGNMENT" | "TRUCK_ASSIGNMENT_AMBIGUOUS";
export class AssignedMobileError extends Error {
  constructor(readonly code: AssignedMobileFailure, message: string) { super(message); this.name = "AssignedMobileError"; }
}
const ASSIGNED_MOBILE_MESSAGE: Readonly<Record<AssignedMobileFailure, string>> = {
  PERMISSION_DENIED: "You are not authorized to count inventory.",
  TECHNICIAN_IDENTITY_UNAVAILABLE: "This account is not linked to a technician.",
  NO_TRUCK_ASSIGNMENT: "No active truck is assigned to you.",
  TRUCK_ASSIGNMENT_AMBIGUOUS: "More than one truck is assigned to you, so none can be used until that is corrected.",
};
function mapAssignedMobileError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof AssignedMobileError) {
    const code: FunctionsErrorCode = err.code === "PERMISSION_DENIED" ? "permission-denied" : "failed-precondition";
    return new HttpsError(code, ASSIGNED_MOBILE_MESSAGE[err.code], { code: err.code });
  }
  console.error("[cycleCountSheet] assigned-mobile read failure", err);
  return new HttpsError("internal", "Your truck assignment could not be checked.");
}

export async function getCycleCountAssignedMobileLocation(uid: string, db: Firestore) {
  const decisions = await resolveEffectiveAccess({
    principalUid: uid,
    permissionIds: [CYCLE_COUNT_CAPABILITY.create, CYCLE_COUNT_CAPABILITY.submit],
  }).then((r) => r.decisions).catch(() => ({}) as Record<string, boolean>);
  if (!(decisions[CYCLE_COUNT_CAPABILITY.create] && decisions[CYCLE_COUNT_CAPABILITY.submit])) {
    throw new AssignedMobileError("PERMISSION_DENIED", "not authorized to count inventory");
  }
  const userSnap = await db.collection("users").doc(uid).get();
  const technicianId = userSnap.exists ? (userSnap.data() ?? {}).technicianId : undefined;
  if (typeof technicianId !== "string" || technicianId.trim() === "") {
    throw new AssignedMobileError("TECHNICIAN_IDENTITY_UNAVAILABLE", "this account has no technician mapping");
  }
  const { mobile, ambiguous } = await readAssignedMobileLocation(db, technicianId);
  if (ambiguous) throw new AssignedMobileError("TRUCK_ASSIGNMENT_AMBIGUOUS", "truck assignment is ambiguous");
  if (mobile === null) throw new AssignedMobileError("NO_TRUCK_ASSIGNMENT", "no active truck is assigned");
  return { location: { type: "MOBILE" as const, locationId: mobile.locationId }, label: mobile.label };
}

export async function runGetCycleCountAssignedMobileLocation(request: CallableRequest<unknown>, db: Firestore = getFirestore()) {
  const uid = requireAuth(request);
  try {
    return await getCycleCountAssignedMobileLocation(uid, db);
  } catch (err) {
    throw mapAssignedMobileError(err);
  }
}
export const getCycleCountAssignedMobileLocationCallable = onCall(REGION, (r) => runGetCycleCountAssignedMobileLocation(r));
