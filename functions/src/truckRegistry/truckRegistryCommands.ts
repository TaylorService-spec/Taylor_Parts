// EI Truck Registry -- trusted internal write service (ADR-010 / Decision #60). INTERNAL
// trusted service only: nothing here is exported from functions/src/index.ts, there is no
// callable/HTTP surface, and "export is not deployment" applies throughout. A future callable
// (separate gate) is the ONLY thing that derives actorUid from request.auth.uid; these
// commands receive a TRUSTED actorUid.
//
// Every mutation: trusted actorUid -> admin/dispatcher security-role check (users/{uid}.role,
// NOT an Enterprise Access capability -- no capabilities are introduced) -> pure input
// validation -> ONE db.runTransaction covering the idempotency check + all reads + version CAS
// + mutation + an atomically-staged Audit Event (the partMasterCommands pattern). Denials emit
// a standalone "denied" Audit Event. Idempotency uses the house mechanism: a DETERMINISTIC
// auditEvents doc id is the "already applied" source of truth; a request fingerprint embedded
// in its summary rejects same-key-different-request replays.
//
// Invariants honored: the business record is NOT custody authority; driver assignment writes
// ONLY the driver field (never claim/location/ledger -> inventory custody provably unchanged);
// truck.locationId is IMMUTABLE (no relink op); inventory moves only via the ledger/Transfers
// (not here); deactivation is fail-closed when governed inventory presence is UNKNOWN.
import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { stageAuditEventWithId, recordStandaloneAuditEvent } from "../access/auditEventWriter";
import type { AuditAction } from "../types/access";
import {
  buildFirestoreTruckRegistryRepository,
  INITIAL_VERSION,
  type TruckRegistryRepository,
  type StoredTruck,
  type StoredMobileLocation,
} from "./truckRegistryRepository";
import { validateCreateInput, parseTruckId, parseEmployeeId, parseWarehouseId, isTruckStatus, isReactivationStatus } from "./validation";
import {
  DEACTIVATED_STATUS,
  type InventoryPresence,
  type MutationOutcome,
  type TruckStatus,
  type ReactivationStatus,
  InvalidInputError,
  UnauthorizedActorError,
  TruckNotFoundError,
  LocationNotFoundError,
  TruckAlreadyExistsError,
  LocationClaimedError,
  EmployeeInvalidError,
  WarehouseInvalidError,
  InvalidStatusTransitionError,
  InventoryPresentError,
  InventoryStateUnknownError,
  VersionConflictError,
  IdempotencyConflictError,
  ClaimIntegrityError,
  TruckReferencedError,
  ReferenceStateUnknownError,
} from "./types";

// Injected governed-inventory-at-location predicate. It receives the SAME transaction and
// performs ALL reads through it (Owner decision). The default returns UNKNOWN because no
// governed serialized-asset/ledger-at-location source exists yet -> deactivation fails closed.
export type GovernedInventoryProbe = (locationId: string, txn: Transaction) => Promise<InventoryPresence>;
const UNKNOWN_INVENTORY: GovernedInventoryProbe = async () => "UNKNOWN";

// Injected cross-collection operational-history probe for Created-in-Error delete. It receives
// the SAME transaction and performs ALL reads through it, and reports whether ANY operational
// history (serialized assets, parts stock, transfer lines/orders, ledger events, or other
// history) references the truck or its MOBILE location:
//   CLEAR       -- conclusively no references anywhere it checks;
//   REFERENCED  -- at least one reference exists -> block the delete;
//   UNKNOWN     -- could NOT be conclusively determined -> FAIL CLOSED (block).
// The default returns UNKNOWN because the governed EI history-at-location persistence does not
// exist yet, so a delete is impossible until a real probe is injected by a later gate. (The
// truck's OWN driver assignment is checked conclusively in-transaction, separately.)
export type OperationalReferenceState = "CLEAR" | "REFERENCED" | "UNKNOWN";
export type OperationalReferenceProbe = (args: { truckId: string; locationId: string }, txn: Transaction) => Promise<OperationalReferenceState>;
const UNKNOWN_REFERENCES: OperationalReferenceProbe = async () => "UNKNOWN";

export interface TruckRegistryDeps {
  db?: Firestore;
  repo?: TruckRegistryRepository;
  hasGovernedInventoryAtLocation?: GovernedInventoryProbe;
  hasOperationalReferences?: OperationalReferenceProbe;
  now?: () => Date;
  /** TEST-ONLY atomicity seam: thrown inside the transaction AFTER all writes are staged. */
  __simulateFailureAfterStage?: Error;
}
function resolveDeps(deps: TruckRegistryDeps | undefined) {
  const db = deps?.db ?? getFirestore();
  return {
    db,
    repo: deps?.repo ?? buildFirestoreTruckRegistryRepository(db),
    probe: deps?.hasGovernedInventoryAtLocation ?? UNKNOWN_INVENTORY,
    referenceProbe: deps?.hasOperationalReferences ?? UNKNOWN_REFERENCES,
    now: deps?.now ?? (() => new Date()),
    failAfterStage: deps?.__simulateFailureAfterStage,
  };
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,200}$/;
function assertActorUid(actorUid: unknown): asserts actorUid is string {
  if (typeof actorUid !== "string" || actorUid.length === 0) throw new InvalidInputError("actorUid is required");
}
function assertIdempotencyKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(key)) throw new InvalidInputError("idempotencyKey must match [A-Za-z0-9_-]{8,200}");
}
function assertExpectedVersion(v: unknown): asserts v is number {
  if (!Number.isInteger(v) || (v as number) < INITIAL_VERSION) throw new InvalidInputError("expectedVersion must be a positive integer");
}

function fingerprint(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}
function auditDocId(operation: string, actorUid: string, targetId: string, key: string): string {
  return "tr_" + createHash("sha256").update(`${operation}|${actorUid}|${targetId}|${key}`).digest("hex").slice(0, 40);
}
const FP_TAG = /fp=([0-9a-f]{16})/;

async function checkIdempotency(db: Firestore, txn: Transaction, auditId: string, fp: string): Promise<MutationOutcome | null> {
  const snap = await txn.get(db.collection("auditEvents").doc(auditId));
  if (!snap.exists) return null;
  const summary = String((snap.data() ?? {}).summary ?? "");
  const stored = FP_TAG.exec(summary)?.[1];
  if (stored !== fp) throw new IdempotencyConflictError("idempotencyKey was already used for a different request");
  const v = /v=(\d+)/.exec(summary);
  return { outcome: "replayed", version: v ? Number(v[1]) : INITIAL_VERSION };
}

// admin/dispatcher security-role authorization (mirrors firestore.rules isAdminOrDispatcher();
// NOT an Enterprise Access capability). Denials emit a standalone "denied" audit event.
async function requireAdminOrDispatcherOrAudit(db: Firestore, actorUid: string, action: AuditAction, targetType: string, targetId: string): Promise<void> {
  const snap = await db.collection("users").doc(actorUid).get();
  const role = snap.exists ? snap.data()?.role : undefined;
  if (role === "admin" || role === "dispatcher") return;
  await recordStandaloneAuditEvent({ actorUid, action, targetType, targetId, outcome: "denied", summary: `denied: actor is not admin/dispatcher for ${action}` });
  throw new UnauthorizedActorError(`actor is not authorized for ${action}`);
}

// ADMIN-ONLY authorization (stricter than admin/dispatcher) for the Created-in-Error hard
// delete -- a dispatcher may operate trucks but may NOT destroy the record. Denials emit a
// standalone "denied" audit event.
async function requireAdminOrAudit(db: Firestore, actorUid: string, action: AuditAction, targetType: string, targetId: string): Promise<void> {
  const snap = await db.collection("users").doc(actorUid).get();
  const role = snap.exists ? snap.data()?.role : undefined;
  if (role === "admin") return;
  await recordStandaloneAuditEvent({ actorUid, action, targetType, targetId, outcome: "denied", summary: `denied: actor is not admin for ${action}` });
  throw new UnauthorizedActorError(`actor is not authorized for ${action}`);
}

// Deletion reason: required, trimmed, bounded, and restricted to a safe printable charset that
// DELIBERATELY excludes "=" so the reason can never inject an "fp=" / "v=" tag into the audit
// summary the idempotency parser reads (checkIdempotency). Also excludes the "]" delimiter used
// around it in the summary.
const DELETION_REASON_PATTERN = /^[A-Za-z0-9 .,:;()'#/_-]{1,200}$/;
function assertDeletionReason(reason: unknown): asserts reason is string {
  const r = typeof reason === "string" ? reason.trim() : "";
  if (r.length === 0 || !DELETION_REASON_PATTERN.test(r)) {
    throw new InvalidInputError("deletionReason is required (1-200 chars, letters/digits/spaces/.,:;()'#/_- only)");
  }
}

// ---------------------------------------------------------------------------
// createTruck -- atomically creates mobile_locations + trucks + location_truck_claims.
// ---------------------------------------------------------------------------
export interface CreateTruckInput {
  actorUid: string;
  idempotencyKey: string;
  truckId: string;
  locationId: string;
  homeWarehouseId: string;
  status?: TruckStatus;
  assignedDriverEmployeeId?: string | null;
  displayLabel?: string;
  vehicleNumber?: string;
}
export async function createTruck(input: CreateTruckInput, deps?: TruckRegistryDeps): Promise<MutationOutcome> {
  const { db, repo, now, failAfterStage } = resolveDeps(deps);
  assertActorUid(input.actorUid);
  assertIdempotencyKey(input.idempotencyKey);
  const validated = validateCreateInput(input);
  if (!validated.valid) throw new InvalidInputError(`invalid create input: ${validated.errors.map((e) => `${e.path}:${e.code}`).join(",")}`);
  const { location, truck } = validated.value;
  await requireAdminOrDispatcherOrAudit(db, input.actorUid, "createTruck", "truck", truck.truckId);

  const fp = fingerprint(["createTruck", truck, location]);
  const auditId = auditDocId("createTruck", input.actorUid, truck.truckId, input.idempotencyKey);

  return db.runTransaction(async (txn) => {
    const replay = await checkIdempotency(db, txn, auditId, fp);
    if (replay) return replay;
    // All reads first.
    if (await repo.getTruck(txn, truck.truckId)) throw new TruckAlreadyExistsError(`truck ${truck.truckId} already exists`);
    if (await repo.getClaim(txn, location.locationId)) throw new LocationClaimedError(`location ${location.locationId} is already claimed`);
    if (await repo.getLocation(txn, location.locationId)) throw new LocationClaimedError(`location ${location.locationId} already exists`);
    if (!(await repo.isWarehouseActive(txn, truck.homeWarehouseId))) throw new WarehouseInvalidError("home warehouse is missing or inactive");
    if (truck.assignedDriverEmployeeId !== null && !(await repo.isEmployeeActive(txn, truck.assignedDriverEmployeeId))) {
      throw new EmployeeInvalidError("assigned driver is missing or not active");
    }
    const at = now();
    const meta = { version: INITIAL_VERSION, createdAt: at, createdBy: input.actorUid, updatedAt: at, updatedBy: input.actorUid };
    repo.stageCreateLocation(txn, { location, active: true, ...meta });
    repo.stageCreateTruck(txn, { truck, active: true, ...meta });
    repo.stageCreateClaim(txn, { locationId: location.locationId, truckId: truck.truckId, version: INITIAL_VERSION, createdAt: at, createdBy: input.actorUid });
    stageAuditEventWithId(txn, auditId, {
      actorUid: input.actorUid, action: "createTruck", targetType: "truck", targetId: truck.truckId, outcome: "applied",
      summary: `created truck ${truck.truckId} at location ${location.locationId} v=${INITIAL_VERSION} fp=${fp}`,
    });
    if (failAfterStage) throw failAfterStage;
    return { outcome: "applied", version: INITIAL_VERSION };
  });
}

// ---------------------------------------------------------------------------
// Shared single-doc truck mutator: read + version CAS + validated field change + audit.
// NEVER touches claims/location/ledger unless the caller's `alsoLocationActive` is set (only
// deactivate/reactivate do, and they set it explicitly).
// ---------------------------------------------------------------------------
interface MutateArgs {
  actorUid: string;
  idempotencyKey: string;
  truckId: string;
  expectedVersion: number;
  operation: string;
  action: AuditAction;
  fpPayload: unknown;
  // Given the current stored truck, return the next truck fields + active flag, or throw.
  apply: (current: StoredTruck, txn: Transaction, repo: TruckRegistryRepository) => Promise<{ nextTruck: StoredTruck["truck"]; nextActive: boolean; alsoLocation?: { location: StoredMobileLocation; nextActive: boolean } }>;
  summary: (nextVersion: number, fp: string) => string;
}
async function mutateTruck(args: MutateArgs, deps?: TruckRegistryDeps): Promise<MutationOutcome> {
  const { db, repo, now, failAfterStage } = resolveDeps(deps);
  assertActorUid(args.actorUid);
  assertIdempotencyKey(args.idempotencyKey);
  const tid = parseTruckId(args.truckId);
  if (!tid.valid) throw new InvalidInputError("invalid truckId");
  assertExpectedVersion(args.expectedVersion);
  await requireAdminOrDispatcherOrAudit(db, args.actorUid, args.action, "truck", tid.value);

  const fp = fingerprint([args.operation, tid.value, args.expectedVersion, args.fpPayload]);
  const auditId = auditDocId(args.operation, args.actorUid, tid.value, args.idempotencyKey);

  return db.runTransaction(async (txn) => {
    const replay = await checkIdempotency(db, txn, auditId, fp);
    if (replay) return replay;
    const current = await repo.getTruck(txn, tid.value);
    if (current === null) throw new TruckNotFoundError(`truck ${tid.value} not found`);
    if (current.version !== args.expectedVersion) throw new VersionConflictError(`expectedVersion ${args.expectedVersion}, stored ${current.version}`);
    const result = await args.apply(current, txn, repo); // may perform more txn reads (before writes)
    const at = now();
    const nextVersion = current.version + 1;
    repo.stageUpdateTruck(txn, {
      truck: result.nextTruck, active: result.nextActive,
      version: nextVersion, createdAt: current.createdAt, createdBy: current.createdBy, updatedAt: at, updatedBy: args.actorUid,
    });
    if (result.alsoLocation) {
      const loc = result.alsoLocation.location;
      repo.stageUpdateLocation(txn, {
        location: loc.location, active: result.alsoLocation.nextActive,
        version: loc.version + 1, createdAt: loc.createdAt, createdBy: loc.createdBy, updatedAt: at, updatedBy: args.actorUid,
      });
    }
    stageAuditEventWithId(txn, auditId, {
      actorUid: args.actorUid, action: args.action, targetType: "truck", targetId: tid.value, outcome: "applied",
      summary: args.summary(nextVersion, fp),
    });
    if (failAfterStage) throw failAfterStage;
    return { outcome: "applied", version: nextVersion };
  });
}

// ---- driver assign / reassign (identical write; the distinction is caller intent) / unassign ----
export interface SetDriverInput { actorUid: string; idempotencyKey: string; truckId: string; employeeId: string; expectedVersion: number; }
async function setDriver(input: SetDriverInput, deps?: TruckRegistryDeps): Promise<MutationOutcome> {
  const eid = parseEmployeeId(input.employeeId);
  if (!eid.valid) throw new InvalidInputError("invalid employeeId");
  return mutateTruck({
    actorUid: input.actorUid, idempotencyKey: input.idempotencyKey, truckId: input.truckId, expectedVersion: input.expectedVersion,
    operation: "assignTruckDriver", action: "assignTruckDriver", fpPayload: { employeeId: eid.value },
    apply: async (current, txn, repo) => {
      if (!(await repo.isEmployeeActive(txn, eid.value))) throw new EmployeeInvalidError("employee is missing or not active");
      return { nextTruck: { ...current.truck, assignedDriverEmployeeId: eid.value }, nextActive: current.active };
    },
    summary: (v, fp) => `assigned driver ${eid.value} to truck ${input.truckId} v=${v} fp=${fp}`,
  }, deps);
}
export const assignDriver = (input: SetDriverInput, deps?: TruckRegistryDeps) => setDriver(input, deps);
export const reassignDriver = (input: SetDriverInput, deps?: TruckRegistryDeps) => setDriver(input, deps);

export interface UnassignDriverInput { actorUid: string; idempotencyKey: string; truckId: string; expectedVersion: number; }
export function unassignDriver(input: UnassignDriverInput, deps?: TruckRegistryDeps): Promise<MutationOutcome> {
  return mutateTruck({
    actorUid: input.actorUid, idempotencyKey: input.idempotencyKey, truckId: input.truckId, expectedVersion: input.expectedVersion,
    operation: "unassignTruckDriver", action: "unassignTruckDriver", fpPayload: null,
    apply: async (current) => ({ nextTruck: { ...current.truck, assignedDriverEmployeeId: null }, nextActive: current.active }),
    summary: (v, fp) => `unassigned driver from truck ${input.truckId} v=${v} fp=${fp}`,
  }, deps);
}

// ---- change status (descriptive; any DISTINCT enum value; does NOT touch active) ----
export interface ChangeStatusInput { actorUid: string; idempotencyKey: string; truckId: string; status: TruckStatus; expectedVersion: number; }
export async function changeStatus(input: ChangeStatusInput, deps?: TruckRegistryDeps): Promise<MutationOutcome> {
  if (!isTruckStatus(input.status)) throw new InvalidInputError("invalid status");
  return mutateTruck({
    actorUid: input.actorUid, idempotencyKey: input.idempotencyKey, truckId: input.truckId, expectedVersion: input.expectedVersion,
    operation: "changeTruckStatus", action: "changeTruckStatus", fpPayload: { status: input.status },
    apply: async (current) => {
      if (current.truck.status === input.status) throw new InvalidStatusTransitionError("status is unchanged");
      return { nextTruck: { ...current.truck, status: input.status }, nextActive: current.active };
    },
    summary: (v, fp) => `changed truck ${input.truckId} status to ${input.status} v=${v} fp=${fp}`,
  }, deps);
}

// ---- change home warehouse ----
export interface ChangeHomeWarehouseInput { actorUid: string; idempotencyKey: string; truckId: string; homeWarehouseId: string; expectedVersion: number; }
export async function changeHomeWarehouse(input: ChangeHomeWarehouseInput, deps?: TruckRegistryDeps): Promise<MutationOutcome> {
  const wid = parseWarehouseId(input.homeWarehouseId);
  if (!wid.valid) throw new InvalidInputError("invalid homeWarehouseId");
  return mutateTruck({
    actorUid: input.actorUid, idempotencyKey: input.idempotencyKey, truckId: input.truckId, expectedVersion: input.expectedVersion,
    operation: "changeTruckHomeWarehouse", action: "changeTruckHomeWarehouse", fpPayload: { homeWarehouseId: wid.value },
    apply: async (current, txn, repo) => {
      if (!(await repo.isWarehouseActive(txn, wid.value))) throw new WarehouseInvalidError("warehouse is missing or inactive");
      return { nextTruck: { ...current.truck, homeWarehouseId: wid.value }, nextActive: current.active };
    },
    summary: (v, fp) => `changed truck ${input.truckId} home warehouse to ${wid.value} v=${v} fp=${fp}`,
  }, deps);
}

// ---- deactivate (inventory-guarded; sets truck+location inactive and status OUT_OF_SERVICE) ----
export interface DeactivateTruckInput { actorUid: string; idempotencyKey: string; truckId: string; expectedVersion: number; }
export function deactivateTruck(input: DeactivateTruckInput, deps?: TruckRegistryDeps): Promise<MutationOutcome> {
  const { probe } = resolveDeps(deps);
  return mutateTruck({
    actorUid: input.actorUid, idempotencyKey: input.idempotencyKey, truckId: input.truckId, expectedVersion: input.expectedVersion,
    operation: "deactivateTruck", action: "deactivateTruck", fpPayload: null,
    apply: async (current, txn, repo) => {
      const location = await repo.getLocation(txn, current.truck.locationId);
      if (location === null) throw new LocationNotFoundError(`location ${current.truck.locationId} not found`);
      const presence = await probe(current.truck.locationId, txn); // reads through the txn
      if (presence === "PRESENT") throw new InventoryPresentError("governed inventory remains at the location");
      if (presence !== "ABSENT") throw new InventoryStateUnknownError("governed inventory presence is unknown");
      return {
        nextTruck: { ...current.truck, status: DEACTIVATED_STATUS },
        nextActive: false,
        alsoLocation: { location, nextActive: false },
      };
    },
    summary: (v, fp) => `deactivated truck ${input.truckId} (status ${DEACTIVATED_STATUS}, location inactive) v=${v} fp=${fp}`,
  }, deps);
}

// ---- reactivate (explicit ACTIVE|IDLE target; re-validates the 1:1 claim intact) ----
export interface ReactivateTruckInput { actorUid: string; idempotencyKey: string; truckId: string; targetStatus: ReactivationStatus; expectedVersion: number; }
export async function reactivateTruck(input: ReactivateTruckInput, deps?: TruckRegistryDeps): Promise<MutationOutcome> {
  if (!isReactivationStatus(input.targetStatus)) throw new InvalidInputError("targetStatus must be ACTIVE or IDLE");
  return mutateTruck({
    actorUid: input.actorUid, idempotencyKey: input.idempotencyKey, truckId: input.truckId, expectedVersion: input.expectedVersion,
    operation: "reactivateTruck", action: "reactivateTruck", fpPayload: { targetStatus: input.targetStatus },
    apply: async (current, txn, repo) => {
      const location = await repo.getLocation(txn, current.truck.locationId);
      if (location === null) throw new LocationNotFoundError(`location ${current.truck.locationId} not found`);
      const claim = await repo.getClaim(txn, current.truck.locationId);
      if (claim === null || claim.truckId !== current.truck.truckId) throw new ClaimIntegrityError("location_truck_claim is missing or mismatched");
      return {
        nextTruck: { ...current.truck, status: input.targetStatus },
        nextActive: true,
        alsoLocation: { location, nextActive: true },
      };
    },
    summary: (v, fp) => `reactivated truck ${input.truckId} (status ${input.targetStatus}, location active) v=${v} fp=${fp}`,
  }, deps);
}

// ---------------------------------------------------------------------------
// deleteTruckCreatedInError -- ADMIN-ONLY hard delete of a truck created in error.
// Atomically removes trucks/{truckId} + mobile_locations/{locationId} + the 1:1 claim ONLY
// after proving, inside ONE transaction, that the record carries NO operational footprint:
//   * the truck exists and matches expectedVersion (version CAS);
//   * its MOBILE location exists and the identity is reciprocal;
//   * the atomic location_truck_claim exists and points back to this exact truck+location;
//   * the truck has NO driver assignment (a conclusive, in-truck "no assignment" check);
//   * the injected operational-reference probe returns CLEAR (serialized assets / parts stock /
//     transfer lines+orders / ledger events / other history). REFERENCED -> blocked;
//     UNKNOWN (the default) -> FAIL CLOSED.
// It writes an immutable, sanitized deletion TOMBSTONE (the deterministic Audit Event doc) that
// survives the deleted records AND is the idempotency key: a retry with the same key finds the
// tombstone and returns "replayed" without re-deleting. Everything (three deletes + tombstone)
// is staged in the ONE transaction, so there is never a partial deletion.
// ---------------------------------------------------------------------------
export interface DeleteTruckCreatedInErrorInput {
  actorUid: string;
  idempotencyKey: string;
  truckId: string;
  expectedVersion: number;
  deletionReason: string;
}
export async function deleteTruckCreatedInError(input: DeleteTruckCreatedInErrorInput, deps?: TruckRegistryDeps): Promise<MutationOutcome> {
  const { db, repo, referenceProbe, failAfterStage } = resolveDeps(deps);
  assertActorUid(input.actorUid);
  assertIdempotencyKey(input.idempotencyKey);
  const tid = parseTruckId(input.truckId);
  if (!tid.valid) throw new InvalidInputError("invalid truckId");
  assertExpectedVersion(input.expectedVersion);
  assertDeletionReason(input.deletionReason);
  const reason = input.deletionReason.trim();
  await requireAdminOrAudit(db, input.actorUid, "deleteTruckCreatedInError", "truck", tid.value);

  // The reason is part of the request -> in the fingerprint, so a same-key/different-reason retry
  // is rejected as an idempotency conflict.
  const fp = fingerprint(["deleteTruckCreatedInError", tid.value, input.expectedVersion, reason]);
  const auditId = auditDocId("deleteTruckCreatedInError", input.actorUid, tid.value, input.idempotencyKey);

  return db.runTransaction(async (txn) => {
    const replay = await checkIdempotency(db, txn, auditId, fp);
    if (replay) return replay; // tombstone exists -> already deleted -> idempotent

    // ----- ALL reads first (Firestore transaction rule) -----
    const truck = await repo.getTruck(txn, tid.value);
    if (truck === null) throw new TruckNotFoundError(`truck ${tid.value} not found`);
    if (truck.version !== input.expectedVersion) {
      throw new VersionConflictError(`expectedVersion ${input.expectedVersion}, stored ${truck.version}`);
    }
    const locationId = truck.truck.locationId;
    const location = await repo.getLocation(txn, locationId);
    if (location === null) throw new LocationNotFoundError(`location ${locationId} not found`);
    if (location.location.locationId !== locationId) throw new ClaimIntegrityError("truck/location identity is not reciprocal");
    const claim = await repo.getClaim(txn, locationId);
    if (claim === null || claim.truckId !== tid.value || claim.locationId !== locationId) {
      throw new ClaimIntegrityError("location_truck_claim is missing or does not match the truck+location");
    }
    // Conclusive in-truck assignment check -- a truck with a driver is not an unused error record.
    if (truck.truck.assignedDriverEmployeeId !== null) {
      throw new TruckReferencedError("truck has an active driver assignment");
    }
    // Cross-collection operational history -- fail closed on UNKNOWN.
    const refs = await referenceProbe({ truckId: tid.value, locationId }, txn);
    if (refs === "REFERENCED") throw new TruckReferencedError("operational history references the truck or its MOBILE location");
    if (refs !== "CLEAR") throw new ReferenceStateUnknownError("operational reference state could not be conclusively determined");

    // ----- atomic delete + immutable tombstone (never partial) -----
    repo.stageDeleteTruck(txn, tid.value);
    repo.stageDeleteLocation(txn, locationId);
    repo.stageDeleteClaim(txn, locationId);
    stageAuditEventWithId(txn, auditId, {
      actorUid: input.actorUid, action: "deleteTruckCreatedInError", targetType: "truck", targetId: tid.value, outcome: "applied",
      // reason has no "=" or "]" (assertDeletionReason), so the v=/fp= tags stay unambiguous.
      // Concise (truckId + reason only) to stay under the 500-char audit-summary bound even with
      // max-length ids; the atomic MOBILE-location + claim removal is implied by the action.
      summary: `deleted-in-error truck ${tid.value} reason:[${reason}] v=${truck.version} fp=${fp}`,
    });
    if (failAfterStage) throw failAfterStage;
    return { outcome: "applied", version: truck.version };
  });
}
