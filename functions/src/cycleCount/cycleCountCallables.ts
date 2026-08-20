// Enterprise Inventory -- Cycle Count operating authority: the trusted CALLABLES (createCycleCount,
// submitCycleCount, reconcileCycleCount, cancelCycleCount) and their exact, sanitized request/response/
// error contracts. firebase-functions v2 onCall. Mirrors transferCallables.ts. The actor is derived ONLY
// from request.auth.uid; authorization is the merged governed resolver for each UNGRANTED
// inventory.cycleCount.* capability (active: false), so every real user is denied until a separate grant
// + activation gate. No production caller can supply an actor, resolver, or audit seam.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest, FunctionsErrorCode } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import {
  createCycleCountProduction,
  submitCycleCountProduction,
  reconcileCycleCountProduction,
  cancelCycleCountProduction,
  type CycleCountCommandCompositionInput,
} from "./cycleCountCommandComposition.js";
import { CycleCountCommandError, type CycleCountCommandFailureCode } from "./cycleCountTypes.js";
import { makeResolveCycleCountPermissionThroughTxn, resolveCycleCountPartThroughTxn, stageCycleCountAuditEvent } from "./cycleCountCallableWiring.js";

const REGION = { region: "us-central1" } as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isNonBlankString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}
function invalidArg(msg: string): HttpsError {
  return new HttpsError("invalid-argument", msg);
}
function noUnknownKeys(obj: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(obj).every((k) => allowed.has(k));
}
function requireAuth(request: { auth?: { uid?: unknown } | null }): string {
  if (!request.auth || typeof request.auth.uid !== "string" || request.auth.uid.length === 0) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }
  return request.auth.uid;
}

// -------- CREATE request contract --------
const CREATE_KEYS: ReadonlySet<string> = new Set(["partId", "location", "idempotencyKey"]);
const LOCATION_KEYS: ReadonlySet<string> = new Set(["type", "locationId"]);
function validateLocationShape(loc: unknown, field: string): void {
  if (!isPlainObject(loc) || !noUnknownKeys(loc, LOCATION_KEYS)) throw invalidArg(`${field} is missing or has unknown fields.`);
  if (loc.type !== "WAREHOUSE" && loc.type !== "MOBILE") throw invalidArg(`${field}.type is invalid.`);
  if (!isNonBlankString(loc.locationId)) throw invalidArg(`${field}.locationId is invalid.`);
}
function validateCreateRequest(data: unknown): Record<string, unknown> {
  if (!isPlainObject(data)) throw invalidArg("Request data must be an object.");
  if (!noUnknownKeys(data, CREATE_KEYS)) throw invalidArg("The request has unknown fields.");
  if (!isNonBlankString(data.partId)) throw invalidArg("partId is invalid.");
  validateLocationShape(data.location, "location");
  if (!isNonBlankString(data.idempotencyKey)) throw invalidArg("idempotencyKey is invalid.");
  return data;
}

// -------- SUBMIT request contract --------
const SUBMIT_KEYS: ReadonlySet<string> = new Set(["cycleCountId", "countedQuantity", "countedSerialNumbers"]);
function validateSubmitRequest(data: unknown): Record<string, unknown> {
  if (!isPlainObject(data)) throw invalidArg("Request data must be an object.");
  if (!noUnknownKeys(data, SUBMIT_KEYS)) throw invalidArg("The request has unknown fields.");
  if (!isNonBlankString(data.cycleCountId)) throw invalidArg("cycleCountId is invalid.");
  if (data.countedQuantity !== undefined && (typeof data.countedQuantity !== "number" || !Number.isFinite(data.countedQuantity))) {
    throw invalidArg("countedQuantity is invalid.");
  }
  if (data.countedSerialNumbers !== undefined) {
    if (!Array.isArray(data.countedSerialNumbers) || !data.countedSerialNumbers.every((s) => isNonBlankString(s))) {
      throw invalidArg("countedSerialNumbers is invalid.");
    }
  }
  return data;
}

// -------- RECONCILE request contract --------
// `decision` is the M23 manager-review addition ("APPROVE" | "REJECT", defaults to "APPROVE" when
// omitted so this callable's pre-M23 request shape still works unchanged).
const RECONCILE_KEYS: ReadonlySet<string> = new Set(["cycleCountId", "reason", "decision"]);
function validateReconcileRequest(data: unknown): Record<string, unknown> {
  if (!isPlainObject(data)) throw invalidArg("Request data must be an object.");
  if (!noUnknownKeys(data, RECONCILE_KEYS)) throw invalidArg("The request has unknown fields.");
  if (!isNonBlankString(data.cycleCountId)) throw invalidArg("cycleCountId is invalid.");
  if (data.reason !== undefined && !isNonBlankString(data.reason)) throw invalidArg("reason is invalid.");
  if (data.decision !== undefined && data.decision !== "APPROVE" && data.decision !== "REJECT") {
    throw invalidArg("decision is invalid.");
  }
  return data;
}

// -------- cycleCountId-only request contract (cancel) --------
const ID_ONLY_KEYS: ReadonlySet<string> = new Set(["cycleCountId"]);
function validateIdOnlyRequest(data: unknown): Record<string, unknown> {
  if (!isPlainObject(data)) throw invalidArg("Request data must be an object.");
  if (!noUnknownKeys(data, ID_ONLY_KEYS)) throw invalidArg("The request has unknown fields.");
  if (!isNonBlankString(data.cycleCountId)) throw invalidArg("cycleCountId is invalid.");
  return data;
}

// -------- sanitized error matrix --------
function mapCycleCountError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof CycleCountCommandError) {
    const code: FunctionsErrorCode = mapCode(err.code);
    const message =
      code === "permission-denied" && err.code === "SEPARATION_OF_DUTIES"
        ? "You submitted this count and cannot approve or reject its own material variance -- a different manager must review it."
      : code === "permission-denied" ? "You are not authorized to perform this cycle count action."
      : code === "not-found" ? "The cycle count could not be found."
      : code === "failed-precondition" ? "This cycle count action is not currently permitted."
      : "The cycle count action could not be completed.";
    return new HttpsError(code, message);
  }
  return new HttpsError("internal", "The cycle count action could not be completed.");
}
function mapCode(code: CycleCountCommandFailureCode): FunctionsErrorCode {
  switch (code) {
    case "PERMISSION_DENIED":
    case "SEPARATION_OF_DUTIES":
      return "permission-denied";
    case "CYCLE_COUNT_NOT_FOUND":
      return "not-found";
    case "LOCATION_INVALID":
    case "PART_INVALID":
    case "SERIAL_INVALID":
    case "QUANTITY_INVALID":
    case "REASON_REQUIRED":
    case "STATUS_INVALID":
    case "IDEMPOTENCY_CONFLICT":
    case "MALFORMED_STORED_RECORD":
      return "failed-precondition";
    default:
      return "internal"; // CYCLE_COUNT_INTEGRITY / unknown
  }
}

// -------- testable handlers (production wiring pinned) --------
export interface CycleCountCallableWiring {
  readonly db: Firestore;
  readonly resolveCreatePermission: (txn: Transaction, actorId: string) => Promise<boolean>;
  readonly resolveSubmitPermission: (txn: Transaction, actorId: string) => Promise<boolean>;
  readonly resolveReconcilePermission: (txn: Transaction, actorId: string) => Promise<boolean>;
  readonly resolveCancelPermission: (txn: Transaction, actorId: string) => Promise<boolean>;
  readonly resolvePart: CycleCountCommandCompositionInput["resolvePart"];
  readonly stageAudit: CycleCountCommandCompositionInput["stageAudit"];
  readonly now: () => Date;
}

export async function runCreateCycleCount(request: CallableRequest<unknown>, wiring: CycleCountCallableWiring) {
  const actorUid = requireAuth(request);
  const validated = validateCreateRequest(request.data);
  try {
    const outcome = await createCycleCountProduction(validated, {
      db: wiring.db,
      actor: { kind: "USER", id: actorUid },
      authorize: (txn, actorId) => wiring.resolveCreatePermission(txn, actorId),
      resolvePart: wiring.resolvePart,
      stageAudit: wiring.stageAudit,
      now: wiring.now,
    });
    // M23 blind-count remediation: expectedQuantity/expectedSerialNumbers are DELIBERATELY OMITTED from
    // this response. The command already computed and stored them (createCycleCountProduction's own
    // outcome carries them, server-side, for the idempotency-replay path above), but they are never
    // projected onto what reaches the counting client -- if they were, a determined user could read the
    // expected value straight off this network response (in the browser devtools Network tab) before
    // ever typing a counted quantity, defeating the blind count even though the UI itself never renders
    // it. The counter first learns the expected value in submitCycleCount's OWN response (see below),
    // which only arrives after their counted value has already left their hands in that same request.
    return {
      outcome: outcome.outcome,
      cycleCountId: outcome.cycleCountId,
      partId: outcome.partId,
      trackingMode: outcome.trackingMode,
      location: outcome.location,
      status: outcome.status,
    };
  } catch (err) {
    throw mapCycleCountError(err);
  }
}

export async function runSubmitCycleCount(request: CallableRequest<unknown>, wiring: CycleCountCallableWiring) {
  const actorUid = requireAuth(request);
  const validated = validateSubmitRequest(request.data);
  try {
    const outcome = await submitCycleCountProduction(validated, {
      db: wiring.db,
      actor: { kind: "USER", id: actorUid },
      authorize: (txn, actorId) => wiring.resolveSubmitPermission(txn, actorId),
      resolvePart: wiring.resolvePart,
      stageAudit: wiring.stageAudit,
      now: wiring.now,
    });
    // M23 blind-count remediation: THIS is the first response that carries the expected snapshot back to
    // the counting client -- deliberately, since by the time this response arrives, the counted value in
    // this SAME request has already been recorded server-side. There is nothing left to anchor.
    return {
      outcome: outcome.outcome,
      cycleCountId: outcome.cycleCountId,
      status: outcome.status,
      countedQuantity: outcome.countedQuantity ?? null,
      countedSerialNumbers: outcome.countedSerialNumbers ?? null,
      variance: outcome.variance ?? null,
      serialVariance: outcome.serialVariance ?? null,
      expectedQuantity: outcome.expectedQuantity ?? null,
      expectedSerialNumbers: outcome.expectedSerialNumbers ?? null,
    };
  } catch (err) {
    throw mapCycleCountError(err);
  }
}

export async function runReconcileCycleCount(request: CallableRequest<unknown>, wiring: CycleCountCallableWiring) {
  const actorUid = requireAuth(request);
  const validated = validateReconcileRequest(request.data);
  try {
    const outcome = await reconcileCycleCountProduction(validated, {
      db: wiring.db,
      actor: { kind: "USER", id: actorUid },
      authorize: (txn, actorId) => wiring.resolveReconcilePermission(txn, actorId),
      resolvePart: wiring.resolvePart,
      stageAudit: wiring.stageAudit,
      now: wiring.now,
    });
    return {
      outcome: outcome.outcome,
      cycleCountId: outcome.cycleCountId,
      status: outcome.status,
      ledgerEventIds: outcome.ledgerEventIds ?? [],
      reviewDecision: outcome.reviewDecision ?? null,
      reconciliationReason: outcome.reconciliationReason ?? null,
    };
  } catch (err) {
    throw mapCycleCountError(err);
  }
}

export async function runCancelCycleCount(request: CallableRequest<unknown>, wiring: CycleCountCallableWiring) {
  const actorUid = requireAuth(request);
  const validated = validateIdOnlyRequest(request.data);
  try {
    const outcome = await cancelCycleCountProduction(validated, {
      db: wiring.db,
      actor: { kind: "USER", id: actorUid },
      authorize: (txn, actorId) => wiring.resolveCancelPermission(txn, actorId),
      resolvePart: wiring.resolvePart,
      stageAudit: wiring.stageAudit,
      now: wiring.now,
    });
    return { outcome: outcome.outcome, cycleCountId: outcome.cycleCountId, status: outcome.status };
  } catch (err) {
    throw mapCycleCountError(err);
  }
}

function productionWiring(): CycleCountCallableWiring {
  const db = getFirestore();
  return {
    db,
    resolveCreatePermission: (txn, actorId) => makeResolveCycleCountPermissionThroughTxn("inventory.cycleCount.create")(txn, db, actorId),
    resolveSubmitPermission: (txn, actorId) => makeResolveCycleCountPermissionThroughTxn("inventory.cycleCount.submit")(txn, db, actorId),
    resolveReconcilePermission: (txn, actorId) => makeResolveCycleCountPermissionThroughTxn("inventory.cycleCount.reconcile")(txn, db, actorId),
    resolveCancelPermission: (txn, actorId) => makeResolveCycleCountPermissionThroughTxn("inventory.cycleCount.cancel")(txn, db, actorId),
    resolvePart: (txn, partId) => resolveCycleCountPartThroughTxn(txn, db, partId),
    stageAudit: stageCycleCountAuditEvent,
    now: () => new Date(),
  };
}

export const createCycleCountCallable = onCall(REGION, (request) => runCreateCycleCount(request, productionWiring()));
export const submitCycleCountCallable = onCall(REGION, (request) => runSubmitCycleCount(request, productionWiring()));
export const reconcileCycleCountCallable = onCall(REGION, (request) => runReconcileCycleCount(request, productionWiring()));
export const cancelCycleCountCallable = onCall(REGION, (request) => runCancelCycleCount(request, productionWiring()));
