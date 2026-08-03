// Receiving Location Authority -- I-LA2: the INERT, UNEXPORTED trusted warehouse-status writer
// (spec: docs/specifications/receiving-location-authority-i-la-c2-warehouse-status.md §5). Governs the
// §3A warehouse record: creates NATIVE records and performs ACTIVE<->INACTIVE transitions under an
// optimistic-concurrency (expectedVersion) CAS. NOT exported from functions/src/index.ts; no callable;
// production-inert (no caller). Reuses the merged §3A validator (governedWarehouseValidation.ts) so the
// writer produces and consumes exactly the governed shape.
//
// The server-derived ACTOR is TRUSTED COMMAND CONTEXT (deps.actor, derived by the caller from
// request.auth.uid) -- NEVER read from the untrusted request payload. Timestamps are server-owned
// (deps.now). Authorization and audit are INJECTED seams (E1 registers the real capability + AuditAction);
// authorization is read commit-time THROUGH the transaction so a concurrent revocation conflicts the
// commit. One Firestore transaction, reads-before-writes, all-or-nothing. It NEVER writes a legacy
// `active` field, NEVER initializes governance history (an ungoverned/legacy record fails closed -- that
// is the I-LA3 migration's job), and NEVER touches migration/resolver/Rules/deploy surfaces.

import { Timestamp } from "firebase-admin/firestore";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { WAREHOUSES_COLLECTION } from "../constants/collections.js";
import { validateGovernedWarehouse } from "./governedWarehouseValidation.js";
import { WAREHOUSE_STATUSES, type WarehouseStatus, type GovernedWarehouse } from "../types/warehouse.js";

// The capability the injected authorize seam checks. Referenced by string only -- registering it in the
// permission catalog (ungranted) and granting it are SEPARATE later gates (E1 / grant gate).
const WAREHOUSE_STATUS_SET_CAPABILITY = "inventory.warehouse.status.set";
const INITIAL_VERSION = 1;

// Exact untrusted-request key allowlists. The trusted-writer boundary fails closed: any own
// property outside these sets (an embedded actor, server-owned timestamps/metadata, status/version/
// provenance/active overrides, or arbitrary keys) is rejected rather than silently ignored.
const CREATE_ALLOWED_KEYS: ReadonlySet<string> = new Set(["warehouseId", "name", "location"]);
const SET_STATUS_ALLOWED_KEYS: ReadonlySet<string> = new Set(["warehouseId", "expectedVersion", "targetStatus"]);

// -------- sanitized error taxonomy (no raw Firestore/auth/document data in messages) --------
export type WarehouseWriterFailureCode =
  | "PERMISSION_DENIED"
  | "INVALID_REQUEST"
  | "ALREADY_EXISTS"
  | "NOT_FOUND"
  | "MALFORMED_RECORD"
  | "VERSION_CONFLICT"
  | "WRITER_INTEGRITY";
export class WarehouseWriterError extends Error {
  readonly code: WarehouseWriterFailureCode;
  constructor(code: WarehouseWriterFailureCode, message: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}
export class UnauthorizedWarehouseWriteError extends WarehouseWriterError { constructor(m = "actor is not authorized to write warehouse status") { super("PERMISSION_DENIED", m); } }
export class InvalidWarehouseRequestError extends WarehouseWriterError { constructor(m: string) { super("INVALID_REQUEST", m); } }
export class WarehouseAlreadyExistsError extends WarehouseWriterError { constructor(m = "warehouse already exists") { super("ALREADY_EXISTS", m); } }
export class WarehouseNotFoundError extends WarehouseWriterError { constructor(m = "warehouse not found") { super("NOT_FOUND", m); } }
export class MalformedWarehouseRecordError extends WarehouseWriterError { constructor(m = "stored warehouse is not a governed record") { super("MALFORMED_RECORD", m); } }
export class WarehouseVersionConflictError extends WarehouseWriterError { constructor(m = "expectedVersion does not match stored version") { super("VERSION_CONFLICT", m); } }
export class WarehouseWriterIntegrityError extends WarehouseWriterError { constructor(m: string) { super("WRITER_INTEGRITY", m); } }

// Trusted actor context (server-derived; NOT from the request).
export interface WarehouseWriterActor { readonly kind: "USER" | "SYSTEM"; readonly id: string; }

// Sanitized audit input (no raw stored values beyond the governed identity + lifecycle facts).
export interface WarehouseStatusAuditInput {
  readonly action: "createWarehouse" | "setWarehouseStatus";
  readonly actorId: string;
  readonly warehouseId: string;
  readonly fromStatus: WarehouseStatus | null;
  readonly toStatus: WarehouseStatus;
  readonly version: number;
}

// Injected dependencies + TRUSTED command context. authorize reads THROUGH the transaction.
export interface WarehouseWriterDeps {
  readonly db: Firestore;
  readonly actor: WarehouseWriterActor;
  readonly authorize: (txn: Transaction, actorId: string, capability: string) => Promise<boolean>;
  readonly stageAudit: (txn: Transaction, audit: WarehouseStatusAuditInput) => void;
  readonly now: () => Date;
  readonly __afterAuthReadHook?: () => Promise<void>;
}

export interface CreateWarehouseRequest { readonly warehouseId: string; readonly name: string; readonly location: string; }
export interface CreateWarehouseOutcome { readonly outcome: "created"; readonly warehouseId: string; readonly version: number; }

export interface SetWarehouseStatusRequest { readonly warehouseId: string; readonly expectedVersion: number; readonly targetStatus: WarehouseStatus; }
export interface SetWarehouseStatusOutcome { readonly outcome: "transitioned" | "noop"; readonly warehouseId: string; readonly version: number; }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isNonBlankString(v: unknown): v is string { return typeof v === "string" && v.trim() !== ""; }
function isPositiveInt(v: unknown): v is number { return typeof v === "number" && Number.isInteger(v) && v >= 1; }
function isWarehouseStatus(v: unknown): v is WarehouseStatus {
  return typeof v === "string" && (WAREHOUSE_STATUSES as readonly string[]).includes(v);
}

function assertTrustedActor(actor: unknown): asserts actor is WarehouseWriterActor {
  if (!isPlainObject(actor) || (actor.kind !== "USER" && actor.kind !== "SYSTEM") || !isNonBlankString(actor.id)) {
    throw new UnauthorizedWarehouseWriteError("trusted actor context missing");
  }
}

// Fail closed on any own property outside the allowlist (e.g. an embedded actor or a server-owned
// field the untrusted caller must never supply).
function rejectUnknownKeys(obj: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) throw new InvalidWarehouseRequestError("unknown request field");
  }
}

// CREATE a governed NATIVE warehouse. Fails closed if the document already exists. Stamps version 1,
// status ACTIVE, provenance NATIVE, and server-owned created/updated actor+timestamp metadata; never
// writes a legacy `active` field.
export async function createWarehouse(request: unknown, deps: WarehouseWriterDeps): Promise<CreateWarehouseOutcome> {
  assertTrustedActor(deps.actor);
  const actor = deps.actor;
  if (!isPlainObject(request)) throw new InvalidWarehouseRequestError("request is not an object");
  rejectUnknownKeys(request, CREATE_ALLOWED_KEYS);
  const warehouseId = request.warehouseId;
  const name = request.name;
  const location = request.location;
  if (!isNonBlankString(warehouseId)) throw new InvalidWarehouseRequestError("warehouseId invalid");
  if (!isNonBlankString(name)) throw new InvalidWarehouseRequestError("name invalid");
  if (!isNonBlankString(location)) throw new InvalidWarehouseRequestError("location invalid");

  return deps.db.runTransaction(async (txn) => {
    // Authorization (commit-time authoritative; read through the txn).
    const authorized = await deps.authorize(txn, actor.id, WAREHOUSE_STATUS_SET_CAPABILITY);
    if (authorized !== true) throw new UnauthorizedWarehouseWriteError();
    if (deps.__afterAuthReadHook) await deps.__afterAuthReadHook();

    const ref = deps.db.collection(WAREHOUSES_COLLECTION).doc(warehouseId);
    const snap = await txn.get(ref);
    if (snap.exists) throw new WarehouseAlreadyExistsError();

    const ts = Timestamp.fromDate(deps.now());
    const record: GovernedWarehouse = {
      id: warehouseId,
      name,
      location,
      status: "ACTIVE",
      version: INITIAL_VERSION,
      updatedAt: ts,
      updatedBy: actor.id,
      provenance: "NATIVE",
      createdAt: ts,
      createdBy: actor.id,
    };
    // Defense-in-depth: the writer must never persist an ungoverned record.
    const check = validateGovernedWarehouse(record, warehouseId);
    if (!check.valid) throw new WarehouseWriterIntegrityError(`built record is not governed: ${check.reason}`);

    deps.stageAudit(txn, { action: "createWarehouse", actorId: actor.id, warehouseId, fromStatus: null, toStatus: "ACTIVE", version: INITIAL_VERSION });
    txn.create(ref, record);
    return { outcome: "created", warehouseId, version: INITIAL_VERSION };
  });
}

// Transition an ALREADY-GOVERNED warehouse ACTIVE<->INACTIVE under an expectedVersion CAS. Same-status is
// an idempotent no-op (no version bump, no write, no audit). Operates only on records that already pass
// the §3A validator -- an ungoverned/legacy record fails closed (MALFORMED_RECORD); the writer never
// initializes governance history. On a real transition it bumps version by exactly one and refreshes the
// server-owned updated metadata; createdAt/By, provenance, and governanceInitialized* are preserved.
export async function setWarehouseStatus(request: unknown, deps: WarehouseWriterDeps): Promise<SetWarehouseStatusOutcome> {
  assertTrustedActor(deps.actor);
  const actor = deps.actor;
  if (!isPlainObject(request)) throw new InvalidWarehouseRequestError("request is not an object");
  rejectUnknownKeys(request, SET_STATUS_ALLOWED_KEYS);
  const warehouseId = request.warehouseId;
  const expectedVersion = request.expectedVersion;
  const targetStatus = request.targetStatus;
  if (!isNonBlankString(warehouseId)) throw new InvalidWarehouseRequestError("warehouseId invalid");
  if (!isPositiveInt(expectedVersion)) throw new InvalidWarehouseRequestError("expectedVersion invalid");
  if (!isWarehouseStatus(targetStatus)) throw new InvalidWarehouseRequestError("targetStatus invalid");

  return deps.db.runTransaction(async (txn) => {
    const authorized = await deps.authorize(txn, actor.id, WAREHOUSE_STATUS_SET_CAPABILITY);
    if (authorized !== true) throw new UnauthorizedWarehouseWriteError();
    if (deps.__afterAuthReadHook) await deps.__afterAuthReadHook();

    const ref = deps.db.collection(WAREHOUSES_COLLECTION).doc(warehouseId);
    const snap = await txn.get(ref);
    if (!snap.exists) throw new WarehouseNotFoundError();

    // Deserialize through the SHARED §3A validator, bound to the document id. An ungoverned/legacy record
    // is not transition-ready -- fail closed.
    const parsed = validateGovernedWarehouse(snap.data(), warehouseId);
    if (!parsed.valid) throw new MalformedWarehouseRecordError(`stored warehouse not governed: ${parsed.reason}`);
    const current = parsed.value;

    // Optimistic-concurrency guard.
    if (current.version !== expectedVersion) throw new WarehouseVersionConflictError();

    // Idempotent no-op: target already current. No write, no version bump, no audit.
    if (current.status === targetStatus) {
      return { outcome: "noop", warehouseId, version: current.version };
    }

    const nextVersion = current.version + 1;
    const ts = Timestamp.fromDate(deps.now());
    // Build the full next record for a governance self-check, then persist only the changed governed
    // fields (preserving createdAt/By, provenance, governanceInitialized*).
    const nextRecord: GovernedWarehouse = { ...current, status: targetStatus, version: nextVersion, updatedAt: ts, updatedBy: actor.id };
    const check = validateGovernedWarehouse(nextRecord, warehouseId);
    if (!check.valid) throw new WarehouseWriterIntegrityError(`built record is not governed: ${check.reason}`);

    deps.stageAudit(txn, { action: "setWarehouseStatus", actorId: actor.id, warehouseId, fromStatus: current.status, toStatus: targetStatus, version: nextVersion });
    txn.update(ref, { status: targetStatus, version: nextVersion, updatedAt: ts, updatedBy: actor.id });
    return { outcome: "transitioned", warehouseId, version: nextVersion };
  });
}
