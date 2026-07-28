// D4 Stage C.2 — the SEPARATE Equipment command orchestrator.
//
// Reuses the partMaster/access PATTERNS (server-derived actor, capability resolution, deterministic
// idempotency, expected-version, transaction boundaries, staged audit, typed errors) WITHOUT touching
// accessVersion or Auth claims and WITHOUT reusing runAccessMutationCommand. Nothing here activates a
// permission, grants a role, or reads a client-supplied actor.
//
// TWO TRANSACTIONS, per design §3a — the ordering is the whole safety property:
//   TX1  operation absent → initiated, plus the initiation audit event, atomically. Initiation is
//        DURABLE BEFORE any business mutation, so a crash between the transactions leaves a resumable
//        `initiated` record rather than an untracked half-command.
//   TX2  the governed record mutation + operation initiated → applied|denied + the terminal audit
//        event, atomically. A terminal transition therefore cannot exist without a prior initiation.
//
// A rejection that happens BEFORE the command is accepted for execution (unknown actor, missing
// capability, malformed input) writes NO operation record at all — only a terminal `denied` audit —
// exactly as §3 requires.
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { buildCommandFingerprint } from "./commandFingerprint";
import {
  IdempotencyConflictError, InvalidInputError, NotFoundError, ReferentialIntegrityError,
  UnauthorizedActorError, VersionConflictError,
} from "./errors";
import { ACTION_TARGET_TYPES, type OperationAction, type OperationRecord, type OperationTargetType } from "./operations";
import {
  buildFirestoreCompatibilityRepository, buildFirestoreCompatibilitySourceRepository,
} from "./compatibilityRepository";
import {
  buildFirestoreEquipmentModelAliasRepository, buildFirestoreEquipmentModelRepository,
} from "./equipmentModelRepository";
import { buildFirestoreOperationRepository } from "./operationRepository";
import { MalformedStoredRecordError, type StoredMeta } from "./repository";

// The governed capability each command requires (design §5). D4 registers these INACTIVE in Stage D;
// the resolver seam below is what decides, so this module never inspects a role or a grant itself.
export const COMMAND_CAPABILITIES: Readonly<Record<OperationAction, string>> = Object.freeze({
  importEquipmentModel: "equipment.model.manage",
  importEquipmentModelAlias: "equipment.model.manage",
  importCompatibility: "equipment.compatibility.import",
  importCompatibilitySource: "equipment.compatibility.import",
  verifyCompatibility: "equipment.compatibility.verify",
  correctCompatibility: "equipment.compatibility.correct",
});

// The audit action pair for each lifecycle event (design §3). The real AuditAction registry entries
// land in Stage D, so the orchestrator stages through an injected writer and never claims an action the
// shared writer does not yet support.
export const INITIATION_AUDIT_ACTION = "initiateEquipmentCompatibilityCommand";
export const TERMINAL_AUDIT_ACTION = "equipmentCompatibilityCommand";

export interface EquipmentAuditEvent {
  actorUid: string;
  action: typeof INITIATION_AUDIT_ACTION | typeof TERMINAL_AUDIT_ACTION;
  targetType: string;
  targetId: string;
  outcome: "applied" | "denied";
  summary: string;
}

export interface EquipmentCommandDeps {
  db: Firestore;
  // The #226 effective-permission resolver, injected. D4 creates no role or grant; emulator tests supply
  // a fixture. A resolver that throws is treated as a denial, never as an approval.
  resolvePermission: (input: { actorUid: string; capabilityId: string }) => boolean | Promise<boolean>;
  // Staged with the transaction that owns the governed write, so an audit event commits or aborts WITH
  // it and never independently.
  stageAudit: (txn: Transaction, event: EquipmentAuditEvent) => void;
  now: () => Timestamp;
  serialSchemes?: Record<string, unknown>;
}

export interface EquipmentCommandInput {
  // SERVER-DERIVED. The callable layer supplies the authenticated uid; it is never read from the
  // client payload, and there is no field on this input a caller could use to impersonate another actor.
  actorUid: string;
  action: OperationAction;
  idempotencyKey: string;
  payload: unknown;
  // Optimistic concurrency on the governed record's OWN version (D2), never accessVersion.
  expectedVersion?: number | null;
}

export type CommandOutcome =
  | { status: "applied"; targetId: string; resultVersion: number; replayed: boolean }
  | { status: "denied"; targetId: string; reason: string; replayed: boolean };

const MAX_SUMMARY = 500;
const summarize = (action: string, targetId: string, note: string): string =>
  `${action} ${targetId}: ${note}`.slice(0, MAX_SUMMARY);

// ---------------------------------------------------------------------------
// Pre-acceptance gate
// ---------------------------------------------------------------------------
// Everything that must be settled BEFORE an operation record may exist. A failure here is a terminal
// `denied` audit with NO operation record, per §9.8.
async function acceptForExecution(input: EquipmentCommandInput, deps: EquipmentCommandDeps): Promise<{
  action: OperationAction; targetType: OperationTargetType; targetId: string; commandFingerprint: string; expectedVersion: number | null;
}> {
  if (input === null || typeof input !== "object") throw new InvalidInputError("command input must be an object");
  const { actorUid, action, idempotencyKey, payload } = input;
  if (typeof actorUid !== "string" || actorUid.length === 0 || actorUid.length > 128) {
    throw new InvalidInputError("actorUid is required and is server-derived");
  }
  if (!Object.prototype.hasOwnProperty.call(COMMAND_CAPABILITIES, action)) {
    throw new InvalidInputError(`unknown command action ${String(action)}`);
  }
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(idempotencyKey)) throw new InvalidInputError("idempotencyKey is malformed");
  const expectedVersion = input.expectedVersion ?? null;
  if (expectedVersion !== null && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)) {
    throw new InvalidInputError("expectedVersion must be a non-negative integer or null");
  }

  // Capability resolution BEFORE any read or write. A throwing resolver denies.
  let granted = false;
  try {
    granted = await deps.resolvePermission({ actorUid, capabilityId: COMMAND_CAPABILITIES[action] });
  } catch {
    granted = false;
  }
  if (granted !== true) {
    throw new UnauthorizedActorError(`actor is not authorized for "${COMMAND_CAPABILITIES[action]}"`);
  }

  // The fingerprint contract (C.1) also enforces payload validity and action/target/identity coherence,
  // so a malformed command cannot reach the operation ledger.
  const targetType = ACTION_TARGET_TYPES[action];
  const targetId = commandTargetId(action, payload);
  const commandFingerprint = buildCommandFingerprint({
    action, targetType, targetId, payload, serialSchemes: deps.serialSchemes,
  });
  return { action, targetType, targetId, commandFingerprint, expectedVersion };
}

// The identity the command is filed under, read from the payload's own governed identity field. The
// fingerprint contract re-derives and re-checks this, so a disagreement cannot survive.
function commandTargetId(action: OperationAction, payload: unknown): string {
  if (payload === null || typeof payload !== "object") throw new InvalidInputError("command payload must be an object");
  const p = payload as Record<string, unknown>;
  const field = action === "importEquipmentModel" ? "equipmentModelId"
    : action === "importEquipmentModelAlias" ? "aliasKey"
      : action === "importCompatibilitySource" ? "sourceId"
        : "compatibilityId";
  const value = Object.prototype.hasOwnProperty.call(p, field) ? p[field] : undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidInputError(`command payload is missing its ${field} identity`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// The lifecycle
// ---------------------------------------------------------------------------
export async function runEquipmentCompatibilityCommand(
  input: EquipmentCommandInput,
  deps: EquipmentCommandDeps
): Promise<CommandOutcome> {
  const { db, now } = deps;
  let accepted;
  try {
    accepted = await acceptForExecution(input, deps);
  } catch (error) {
    // Pre-acceptance denial: terminal audit only, NO operation record.
    const reason = error instanceof Error ? error.message : "rejected";
    const targetType = Object.prototype.hasOwnProperty.call(ACTION_TARGET_TYPES, (input as any)?.action)
      ? ACTION_TARGET_TYPES[(input as any).action as OperationAction]
      : "unknown";
    await db.runTransaction(async (txn) => {
      deps.stageAudit(txn, {
        actorUid: typeof (input as any)?.actorUid === "string" ? (input as any).actorUid : "unknown",
        action: TERMINAL_AUDIT_ACTION, targetType, targetId: "unknown", outcome: "denied",
        summary: summarize(String((input as any)?.action ?? "unknown"), "unknown", reason),
      });
    });
    throw error;
  }

  const { action, targetType, targetId, commandFingerprint, expectedVersion } = accepted;
  const { actorUid, idempotencyKey } = input;
  const operations = buildFirestoreOperationRepository(db);

  // ---- TX1: durable initiation, or an idempotent replay decision ----
  const initiation = await db.runTransaction(async (txn) => {
    const existing = await operations.getByIdempotencyKey(txn, idempotencyKey);
    if (existing !== null) {
      // A reused key MUST carry the same governed command. Every binding field is compared.
      if (
        existing.actorUid !== actorUid || existing.action !== action || existing.targetType !== targetType ||
        existing.targetId !== targetId || existing.expectedVersion !== expectedVersion ||
        existing.commandFingerprint !== commandFingerprint
      ) {
        throw new IdempotencyConflictError(`idempotencyKey ${idempotencyKey} was used for a different command`);
      }
      // Exact replay of a TERMINAL operation: read it, never mutate it.
      if (existing.status !== "initiated") return { resume: false, replayed: true, record: existing };
      // Crash after TX1: resume this initiation rather than creating a second one.
      return { resume: true, replayed: true, record: existing };
    }
    const record: OperationRecord = {
      idempotencyKey, actorUid, action, targetType, targetId, commandFingerprint,
      expectedVersion, resultVersion: null, status: "initiated", initiatedAt: now(), terminalAt: null,
    };
    operations.stageInitiate(txn, record);
    deps.stageAudit(txn, {
      actorUid, action: INITIATION_AUDIT_ACTION, targetType, targetId, outcome: "applied",
      summary: summarize(action, targetId, "initiation recorded"),
    });
    return { resume: true, replayed: false, record };
  });

  if (!initiation.resume) {
    const terminal = initiation.record;
    return terminal.status === "applied"
      ? { status: "applied", targetId, resultVersion: terminal.resultVersion as number, replayed: true }
      : { status: "denied", targetId, reason: "previously denied", replayed: true };
  }

  // ---- TX2: mutation + terminal transition + terminal audit, atomically ----
  return db.runTransaction(async (txn) => {
    // ALL READS FIRST — Firestore requires it, and the terminal authorization needs its own read.
    let mutation;
    let denial: string | null = null;
    try {
      mutation = await planMutation(txn, { action, targetId, payload: input.payload, expectedVersion, actorUid, now }, deps);
    } catch (error) {
      if (error instanceof VersionConflictError || error instanceof ReferentialIntegrityError || error instanceof NotFoundError) {
        denial = error.message; // a governed denial: recorded as a terminal `denied`, not a crash
      } else {
        throw error;
      }
    }
    const terminalRecord: OperationRecord = {
      ...initiation.record,
      status: denial === null ? "applied" : "denied",
      resultVersion: denial === null ? mutation!.resultVersion : null,
      terminalAt: now(),
    };
    const authorization = await operations.prepareTerminal(txn, terminalRecord);

    // WRITES second.
    if (denial === null) mutation!.stage(txn);
    operations.stageTerminal(txn, authorization);
    deps.stageAudit(txn, {
      actorUid, action: TERMINAL_AUDIT_ACTION, targetType, targetId,
      outcome: denial === null ? "applied" : "denied",
      summary: summarize(action, targetId, denial ?? `applied at version ${mutation!.resultVersion}`),
    });
    return denial === null
      ? { status: "applied" as const, targetId, resultVersion: mutation!.resultVersion, replayed: initiation.replayed }
      : { status: "denied" as const, targetId, reason: denial, replayed: initiation.replayed };
  });
}

// ---------------------------------------------------------------------------
// Per-action mutation planning: referential integrity + expected version, reads only
// ---------------------------------------------------------------------------
interface PlannedMutation {
  resultVersion: number;
  stage: (txn: Transaction) => void;
}

async function planMutation(
  txn: Transaction,
  cmd: { action: OperationAction; targetId: string; payload: unknown; expectedVersion: number | null; actorUid: string; now: () => Timestamp },
  deps: EquipmentCommandDeps
): Promise<PlannedMutation> {
  const { db, serialSchemes } = deps;
  const models = buildFirestoreEquipmentModelRepository(db);
  const aliases = buildFirestoreEquipmentModelAliasRepository(db);
  const compatibility = buildFirestoreCompatibilityRepository(db, { serialSchemes });
  const sources = buildFirestoreCompatibilitySourceRepository(db);
  const payload = cmd.payload as Record<string, unknown>;
  const stamp = cmd.now();

  // Expected-version check against the record's OWN version (D2/D1), inside this transaction.
  const checkVersion = (existingVersion: number | null): void => {
    if (cmd.expectedVersion === null) {
      if (existingVersion !== null) {
        throw new VersionConflictError(`record already exists at version ${existingVersion}; expectedVersion is required`);
      }
      return;
    }
    if (existingVersion === null) throw new NotFoundError(`no existing record to update at version ${cmd.expectedVersion}`);
    if (existingVersion !== cmd.expectedVersion) {
      throw new VersionConflictError(`expected version ${cmd.expectedVersion}, found ${existingVersion}`);
    }
  };
  const meta = (existing: StoredMeta | null): StoredMeta => ({
    createdAt: existing?.createdAt ?? stamp,
    createdBy: existing?.createdBy ?? cmd.actorUid,
    updatedAt: stamp,
    updatedBy: cmd.actorUid,
  });

  switch (cmd.action) {
    case "importEquipmentModel": {
      const existing = await models.getById(txn, cmd.targetId);
      checkVersion(existing?.model.version ?? null);
      const stored = { model: payload, ...meta(existing) };
      return {
        resultVersion: payload.version as number,
        stage: (t) => (existing === null ? models.stageCreate(t, stored) : models.stageUpdate(t, stored)),
      };
    }
    case "importEquipmentModelAlias": {
      // REFERENTIAL INTEGRITY: an alias may never create or imply a model.
      const model = await models.getById(txn, String(payload.equipmentModelId));
      if (model === null) throw new ReferentialIntegrityError(`equipment model ${String(payload.equipmentModelId)} does not exist`);
      const existing = await aliases.getByAliasKey(txn, cmd.targetId);
      // Aliases carry no version; a conflicting owner fails closed for review (D1 conflict contract).
      if (existing !== null && existing.alias.equipmentModelId !== payload.equipmentModelId) {
        throw new ReferentialIntegrityError(`alias ${cmd.targetId} already resolves to ${existing.alias.equipmentModelId}`);
      }
      const stored = { alias: payload, ...meta(existing) };
      return {
        resultVersion: 1,
        stage: (t) => (existing === null ? aliases.stageCreate(t, stored) : aliases.stageUpdate(t, stored)),
      };
    }
    case "importCompatibility":
    case "correctCompatibility": {
      const model = await models.getById(txn, String(payload.equipmentModelId));
      if (model === null) throw new ReferentialIntegrityError(`equipment model ${String(payload.equipmentModelId)} does not exist`);
      const existing = await compatibility.getById(txn, cmd.targetId);
      checkVersion(existing?.compatibility.version ?? null);
      if (cmd.action === "correctCompatibility" && existing === null) {
        throw new NotFoundError(`compatibility ${cmd.targetId} does not exist to correct`);
      }
      const stored = { compatibility: payload, ...meta(existing) };
      return {
        resultVersion: payload.version as number,
        stage: (t) => (existing === null ? compatibility.stageCreate(t, stored) : compatibility.stageUpdate(t, stored)),
      };
    }
    case "importCompatibilitySource": {
      // Evidence may never create the relationship it cites.
      const relationship = await compatibility.getById(txn, String(payload.compatibilityId));
      if (relationship === null) {
        throw new ReferentialIntegrityError(`compatibility ${String(payload.compatibilityId)} does not exist`);
      }
      const existing = await sources.getById(txn, cmd.targetId);
      if (existing !== null) throw new ReferentialIntegrityError(`source ${cmd.targetId} already exists and evidence is immutable`);
      const stored = { source: payload, ...meta(null) };
      return { resultVersion: 1, stage: (t) => sources.stageCreate(t, stored) };
    }
    case "verifyCompatibility": {
      const existing = await compatibility.getById(txn, cmd.targetId);
      if (existing === null) throw new NotFoundError(`compatibility ${cmd.targetId} does not exist to verify`);
      checkVersion(existing.compatibility.version);
      const nextVersion = existing.compatibility.version + 1;
      const updated = { ...existing.compatibility, verificationStatus: payload.verificationStatus, version: nextVersion };
      const stored = { compatibility: updated, ...meta(existing) };
      return { resultVersion: nextVersion, stage: (t) => compatibility.stageUpdate(t, stored) };
    }
    default:
      throw new MalformedStoredRecordError(`no mutation plan for ${String(cmd.action)}`);
  }
}
