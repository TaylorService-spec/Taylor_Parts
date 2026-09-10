// Cycle Count A1 -- the SHEET / LINE command family (schema v2). Owner-approved A1 Revision 2,
// Decision #179. Replaces the single-part v1 commands for every deployed caller; the v1 modules remain
// only as frozen Certification-history tooling (see cycleCountCommand.ts header) and no callable reaches them.
//
// The integrity properties of v1 carry over, re-expressed PER LINE:
//   - one sheet per governed location; one line per Part (the line's path derives from the Part);
//   - the expected snapshot is server-computed when the line OPENS, stamped with its real instant, and
//     never recomputed; a discovered Part uses exactly the same authority (D4);
//   - BLIND: no response carries a line's expected value until THAT line is submitted;
//   - counting is observation: submit writes no ledger row;
//   - reconciliation is the only adjustment path, one line per transaction (D6): the line's disposition
//     and its ADJUSTED evidence commit together or not at all -- a partially reconciled line cannot exist;
//     a sheet is reconciled line by line and is therefore resumable, never restartable;
//   - separation of duties and materiality are evaluated per line (D1);
//   - the counted location is admitted by the ONE eligibility policy (P7: a BIN only after its Warehouse
//     passes the conversion gate), and expected quantity is the exact location through the ONE on-hand
//     authority, so RELOCATION_OUT / RELOCATION_IN are counted exactly where they happened.
//
// Every command: one transaction, all reads before any write, one staged audit event, sanitized errors.

import type { Firestore, Transaction, DocumentReference } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { CYCLE_COUNTS_COLLECTION, INVENTORY_TRANSACTIONS_COLLECTION } from "../constants/collections.js";
import { stageOperationalMovement } from "../inventoryLedger/operationalMovementRepository.js";
import {
  UnauthorizedCycleCountError,
  CycleCountSelfApprovalError,
  CycleCountNotFoundError,
  CycleCountLocationInvalidError,
  CycleCountPartInvalidError,
  CycleCountReasonRequiredError,
  CycleCountStatusInvalidError,
  CycleCountIdempotencyConflictError,
  CycleCountMalformedStoredRecordError,
  CycleCountIntegrityError,
  CycleCountSheetNotFoundError,
  CycleCountSheetStatusInvalidError,
  CYCLE_COUNT_SUPPORTED_TRACKING_MODES,
  type CycleCountActor,
  type CycleCountLocationRef,
  type CycleCountTrackingMode,
  type SerialVariance,
} from "./cycleCountTypes.js";
import { validateCycleCountLocationRef, validateSubmitCycleCountInput, validateReconcileCycleCountInput } from "./cycleCountValidation.js";
import {
  CYCLE_COUNT_LINES_SUBCOLLECTION,
  cycleCountSheetId,
  cycleCountLineId,
  fingerprintSheet,
  fingerprintLine,
  serializeNewSheet,
  deserializeSheet,
  sheetStatusFields,
  serializeNewLine,
  deserializeLine,
  lineSubmitFields,
  lineDecisionFields,
  lineCancelFields,
  isPlainObject,
  isNonEmptyString,
  type CycleCountSheet,
  type CycleCountLine,
} from "./cycleCountSheetRepository.js";
import { computeExpectedQuantityThroughTxn, computeExpectedSerialsThroughTxn } from "./cycleCountExpectedQuantity.js";
import { isMaterialCycleCountVariance, resolveCycleCountMaterialityConfig } from "./cycleCountMateriality.js";

export const CYCLE_COUNT_CAPABILITY = Object.freeze({
  create: "inventory.cycleCount.create",
  submit: "inventory.cycleCount.submit",
  reconcile: "inventory.cycleCount.reconcile",
  cancel: "inventory.cycleCount.cancel",
});

/** A sheet is cancelled in ONE transaction together with its open lines; beyond this it is refused, never partial. */
export const MAX_LINES_PER_SHEET_TRANSACTION = 400;

export interface ResolvedSheetPart {
  readonly partId: string;
  readonly trackingMode: string;
  readonly active: boolean;
}

export type SheetAuditAction =
  | "createCycleCountSheet" | "openCycleCountLine" | "submitCycleCountLine" | "reconcileCycleCountLine"
  | "rejectCycleCountLine" | "cancelCycleCountLine" | "cancelCycleCountSheet" | "closeCycleCountSheet";

export interface SheetAuditInput {
  readonly action: SheetAuditAction;
  readonly actorId: string;
  readonly sheetId: string;
  readonly location: CycleCountLocationRef;
  readonly partId?: string;
  readonly variance?: number;
  readonly serialVariance?: SerialVariance;
}

export interface SheetCommandDeps {
  readonly db: Firestore;
  readonly actor: CycleCountActor;
  readonly authorize: (txn: Transaction, actorId: string, capability: string) => Promise<boolean>;
  readonly resolvePart: (txn: Transaction, partId: string) => Promise<ResolvedSheetPart | null>;
  /** The governed Cycle Count location-eligibility policy (cycleCountLocationEligibility.ts). */
  readonly resolveLocationEligible: (txn: Transaction, location: CycleCountLocationRef) => Promise<boolean>;
  /** The counted location's owning company (Ownership Model v1), or null when it has none. */
  readonly resolveLocationCompany: (txn: Transaction, location: CycleCountLocationRef) => Promise<string | null>;
  readonly stageAudit: (txn: Transaction, audit: SheetAuditInput) => void;
  readonly now: () => Date;
}

function requireActor(actor: unknown): CycleCountActor {
  if (!isPlainObject(actor) || (actor.kind !== "USER" && actor.kind !== "SYSTEM") || !isNonEmptyString(actor.id)) {
    throw new UnauthorizedCycleCountError("trusted actor context missing");
  }
  return { kind: actor.kind as "USER" | "SYSTEM", id: actor.id as string };
}
function requireString(request: unknown, key: string, onMissing: () => Error): string {
  if (!isPlainObject(request) || !isNonEmptyString(request[key])) throw onMissing();
  return (request[key] as string).trim();
}

const sheetRef = (db: Firestore, sheetId: string) => db.collection(CYCLE_COUNTS_COLLECTION).doc(sheetId);
const lineRef = (db: Firestore, sheetId: string, partId: string) =>
  sheetRef(db, sheetId).collection(CYCLE_COUNT_LINES_SUBCOLLECTION).doc(cycleCountLineId(partId));

async function readSheet(txn: Transaction, db: Firestore, sheetId: string): Promise<CycleCountSheet> {
  const snap = await txn.get(sheetRef(db, sheetId));
  if (!snap.exists) throw new CycleCountSheetNotFoundError();
  // A v1 record (or anything else) at this id is refused, never interpreted: the strict version boundary.
  return deserializeSheet(sheetId, snap.data());
}
function requireOpen(sheet: CycleCountSheet, what: string): void {
  if (sheet.status !== "OPEN") throw new CycleCountSheetStatusInvalidError(`sheet is ${sheet.status}; cannot ${what}`);
}
async function readLine(txn: Transaction, db: Firestore, sheetId: string, partId: string): Promise<CycleCountLine | null> {
  const snap = await txn.get(lineRef(db, sheetId, partId));
  return snap.exists ? deserializeLine(sheetId, snap.id, snap.data()) : null;
}

const ledgerKey = (...parts: string[]) => "cycmv_" + createHash("sha256").update(JSON.stringify(["cycle-count-line", ...parts])).digest("hex").slice(0, 40);

// ================================================================================ createCycleCountSheet
export async function createCycleCountSheet(request: unknown, deps: SheetCommandDeps) {
  const actor = requireActor(deps.actor);
  const location = validateCycleCountLocationRef(isPlainObject(request) ? request.location : undefined);
  if (location === null) throw new CycleCountLocationInvalidError("location is not a governed location reference");
  const idempotencyKey = requireString(request, "idempotencyKey", () => new CycleCountIdempotencyConflictError("idempotencyKey missing"));
  const sheetId = cycleCountSheetId(idempotencyKey);

  return deps.db.runTransaction(async (txn) => {
    const now = deps.now();
    if (!(await deps.authorize(txn, actor.id, CYCLE_COUNT_CAPABILITY.create))) throw new UnauthorizedCycleCountError();

    const existing = await txn.get(sheetRef(deps.db, sheetId));
    if (existing.exists) {
      const stored = deserializeSheet(sheetId, existing.data());
      if (stored.fingerprint !== fingerprintSheet(location, idempotencyKey)) throw new CycleCountIdempotencyConflictError();
      return { outcome: "replayed" as const, sheetId, location: stored.location, status: stored.status };
    }
    if (!(await deps.resolveLocationEligible(txn, location))) {
      throw new CycleCountLocationInvalidError("location is not eligible for counting (inactive, unknown, or a Bin whose Warehouse has not passed the conversion gate)");
    }
    const company = await deps.resolveLocationCompany(txn, location);

    txn.create(sheetRef(deps.db, sheetId), serializeNewSheet(sheetId, location, idempotencyKey, actor, now, company));
    deps.stageAudit(txn, { action: "createCycleCountSheet", actorId: actor.id, sheetId, location });
    return { outcome: "applied" as const, sheetId, location, status: "OPEN" as const };
  });
}

// ================================================================================ openCycleCountLine
/** OPEN a line for a Part -- or return the one that exists. The response carries NO expected value. */
export async function openCycleCountLine(request: unknown, deps: SheetCommandDeps) {
  const actor = requireActor(deps.actor);
  const sheetId = requireString(request, "sheetId", () => new CycleCountSheetNotFoundError("sheetId missing"));
  const partId = requireString(request, "partId", () => new CycleCountPartInvalidError("partId missing"));

  return deps.db.runTransaction(async (txn) => {
    const now = deps.now();
    if (!(await deps.authorize(txn, actor.id, CYCLE_COUNT_CAPABILITY.create))) throw new UnauthorizedCycleCountError();
    const sheet = await readSheet(txn, deps.db, sheetId);
    requireOpen(sheet, "open a line");

    const part = await deps.resolvePart(txn, partId);
    if (part === null) throw new CycleCountPartInvalidError("part not found");
    if (part.partId !== partId) throw new CycleCountPartInvalidError("resolved part identity incoherent");
    if (part.active !== true) throw new CycleCountPartInvalidError("part is not active");
    if (!(CYCLE_COUNT_SUPPORTED_TRACKING_MODES as readonly string[]).includes(part.trackingMode)) {
      throw new CycleCountPartInvalidError("tracking mode not supported (LOT deferred)");
    }
    const trackingMode = part.trackingMode as CycleCountTrackingMode;

    // D5: a repeat open (or a second scan of the same Part) resolves to the SAME line. No second snapshot.
    const existing = await readLine(txn, deps.db, sheetId, partId);
    if (existing) {
      if (existing.fingerprint !== fingerprintLine(partId, trackingMode)) {
        throw new CycleCountIdempotencyConflictError("the part's tracking mode changed after its line opened");
      }
      return openResponse("replayed", existing);
    }

    // Fail closed if the location stopped being countable after the sheet was created.
    if (!(await deps.resolveLocationEligible(txn, sheet.location))) {
      throw new CycleCountLocationInvalidError("the sheet's location is no longer eligible for counting");
    }
    // D3/D4: the SAME authority for a planned or a discovered Part. Zero only when the authority says zero.
    const expectedSerialNumbers = trackingMode === "SERIAL"
      ? await computeExpectedSerialsThroughTxn(txn, deps.db, partId, sheet.location)
      : undefined;
    const expectedQuantity = trackingMode === "NONE"
      ? await computeExpectedQuantityThroughTxn(txn, deps.db, partId, sheet.location)
      : (expectedSerialNumbers as string[]).length;

    const data = serializeNewLine(partId, trackingMode, expectedQuantity, expectedSerialNumbers, actor, now);
    txn.create(lineRef(deps.db, sheetId, partId), data);
    deps.stageAudit(txn, { action: "openCycleCountLine", actorId: actor.id, sheetId, location: sheet.location, partId });
    return {
      outcome: "applied" as const, sheetId, lineId: cycleCountLineId(partId), partId, trackingMode,
      status: "OPEN" as const, expectedSnapshotAt: now.getTime(),
    };
  });
}

function openResponse(outcome: "replayed", line: CycleCountLine) {
  // Blind: an existing line is described WITHOUT its expected value unless it has already been submitted
  // (in which case the counter has seen it in their own submit response).
  return {
    outcome, sheetId: line.sheetId, lineId: line.lineId, partId: line.partId, trackingMode: line.trackingMode,
    status: line.status, expectedSnapshotAt: line.expectedSnapshotAt,
  };
}

// ================================================================================ submitCycleCountLine
export async function submitCycleCountLine(request: unknown, deps: SheetCommandDeps) {
  const actor = requireActor(deps.actor);
  const sheetId = requireString(request, "sheetId", () => new CycleCountSheetNotFoundError("sheetId missing"));
  const partId = requireString(request, "partId", () => new CycleCountPartInvalidError("partId missing"));

  return deps.db.runTransaction(async (txn) => {
    const now = deps.now();
    if (!(await deps.authorize(txn, actor.id, CYCLE_COUNT_CAPABILITY.submit))) throw new UnauthorizedCycleCountError();
    const sheet = await readSheet(txn, deps.db, sheetId);
    requireOpen(sheet, "submit a count");
    const line = await readLine(txn, deps.db, sheetId, partId);
    if (!line) throw new CycleCountNotFoundError("that part has no line on this sheet -- open it first");
    if (line.status !== "OPEN" && line.status !== "COUNTED") throw new CycleCountStatusInvalidError(`line is ${line.status}; cannot submit a count`);

    const validated = validateSubmitCycleCountInput(request, line.trackingMode);
    if (!validated.valid) throw new CycleCountPartInvalidError(`submit input invalid: ${validated.reason}`);

    if (line.trackingMode === "NONE") {
      const countedQuantity = validated.value.countedQuantity as number;
      if (line.status === "COUNTED") {
        if (line.countedQuantity !== countedQuantity) throw new CycleCountIdempotencyConflictError("line was already submitted with a different count");
        return submitResponse("replayed", line, { countedQuantity, variance: line.variance as number });
      }
      const variance = countedQuantity - line.expectedQuantity;
      txn.update(lineRef(deps.db, sheetId, partId), lineSubmitFields(line, actor, now, { countedQuantity, variance }));
      deps.stageAudit(txn, { action: "submitCycleCountLine", actorId: actor.id, sheetId, location: sheet.location, partId, variance });
      return submitResponse("applied", line, { countedQuantity, variance });
    }

    const counted = [...(validated.value.countedSerialNumbers as readonly string[])].sort();
    if (line.status === "COUNTED") {
      const prior = line.countedSerialNumbers ?? [];
      if (prior.length !== counted.length || !prior.every((s) => counted.includes(s))) {
        throw new CycleCountIdempotencyConflictError("line was already submitted with different serials");
      }
      return submitResponse("replayed", line, { countedSerialNumbers: counted, serialVariance: line.serialVariance as SerialVariance });
    }
    const expected = new Set(line.expectedSerialNumbers ?? []);
    const seen = new Set(counted);
    const serialVariance: SerialVariance = {
      missing: [...expected].filter((s) => !seen.has(s)).sort(),
      unexpected: counted.filter((s) => !expected.has(s)),
    };
    txn.update(lineRef(deps.db, sheetId, partId), lineSubmitFields(line, actor, now, { countedSerialNumbers: counted, serialVariance }));
    deps.stageAudit(txn, { action: "submitCycleCountLine", actorId: actor.id, sheetId, location: sheet.location, partId, serialVariance });
    return submitResponse("applied", line, { countedSerialNumbers: counted, serialVariance });
  });
}

/** THIS line's expected value crosses the wire here, for the first time -- after the count already has. */
function submitResponse(
  outcome: "applied" | "replayed", line: CycleCountLine,
  counted: { countedQuantity: number; variance: number } | { countedSerialNumbers: readonly string[]; serialVariance: SerialVariance },
) {
  return {
    outcome, sheetId: line.sheetId, lineId: line.lineId, partId: line.partId, status: "COUNTED" as const,
    ...counted,
    expectedQuantity: line.expectedQuantity,
    ...(line.expectedSerialNumbers === undefined ? {} : { expectedSerialNumbers: line.expectedSerialNumbers }),
  };
}

// ================================================================================ reconcileCycleCountLine
/**
 * The atomic unit (D6): read the line, check capability, enforce SoD, check the transition, require the
 * reason, stage that line's ADJUSTED evidence, record the disposition -- one transaction.
 */
export async function reconcileCycleCountLine(request: unknown, deps: SheetCommandDeps) {
  const actor = requireActor(deps.actor);
  const sheetId = requireString(request, "sheetId", () => new CycleCountSheetNotFoundError("sheetId missing"));
  const partId = requireString(request, "partId", () => new CycleCountPartInvalidError("partId missing"));
  const v = validateReconcileCycleCountInput(request);
  if (!v.valid) throw new CycleCountPartInvalidError(`reconcile input invalid: ${v.reason}`);
  const { reason, decision } = v.value;
  const isReject = decision === "REJECT";

  return deps.db.runTransaction(async (txn) => {
    const now = deps.now();
    const writes: { ref: DocumentReference; data: Record<string, unknown> }[] = [];
    if (!(await deps.authorize(txn, actor.id, CYCLE_COUNT_CAPABILITY.reconcile))) throw new UnauthorizedCycleCountError();
    const sheet = await readSheet(txn, deps.db, sheetId);
    requireOpen(sheet, "reconcile a line");
    const line = await readLine(txn, deps.db, sheetId, partId);
    if (!line) throw new CycleCountNotFoundError("that part has no line on this sheet");

    if (line.status === "RECONCILED" || line.status === "REJECTED") {
      // Replay: the decision cannot change, and the evidence it produced must still be there.
      if ((line.status === "REJECTED") !== isReject) throw new CycleCountStatusInvalidError(`line was already ${line.status}; the decision cannot change`);
      for (const id of line.ledgerEventIds ?? []) {
        const s = await txn.get(deps.db.collection(INVENTORY_TRANSACTIONS_COLLECTION).doc(id));
        if (!s.exists) throw new CycleCountIntegrityError("a decided line's ledger evidence is missing");
      }
      return decisionResponse("replayed", line, line.ledgerEventIds ?? [], line.status, line.reconciliationReason ?? null);
    }
    if (line.status !== "COUNTED") throw new CycleCountStatusInvalidError(`line is ${line.status}; submit a count first`);

    const isSerial = line.trackingMode === "SERIAL";
    const discrepancy = isSerial
      ? (line.serialVariance?.missing.length ?? 0) + (line.serialVariance?.unexpected.length ?? 0)
      : Math.abs(line.variance ?? 0);
    if (discrepancy > 0 && !reason) throw new CycleCountReasonRequiredError();
    if (discrepancy > 0) {
      if (!line.submittedBy) throw new CycleCountMalformedStoredRecordError("COUNTED line with a variance has no submittedBy");
      const expectedUnits = isSerial ? (line.expectedSerialNumbers?.length ?? 0) : line.expectedQuantity;
      // D1: THIS line's materiality against THIS line's expected units -- no sheet-level formula.
      if (isMaterialCycleCountVariance(discrepancy, expectedUnits, resolveCycleCountMaterialityConfig()) && actor.id === line.submittedBy) {
        throw new CycleCountSelfApprovalError();
      }
    }

    const part = await deps.resolvePart(txn, partId);
    if (part === null || part.partId !== partId) throw new CycleCountPartInvalidError("part not found");

    const store = {
      async read(docId: string) {
        const s = await txn.get(deps.db.collection(INVENTORY_TRANSACTIONS_COLLECTION).doc(docId));
        return s.exists ? (s.data() ?? {}) : null;
      },
      create(docId: string, data: Record<string, unknown>) {
        writes.push({ ref: deps.db.collection(INVENTORY_TRANSACTIONS_COLLECTION).doc(docId), data });
      },
    };
    const ledgerEventIds: string[] = [];
    const stage = async (ev: Record<string, unknown>) => {
      const outcome = await stageOperationalMovement(store, ev as never, { partId: part.partId, trackingMode: part.trackingMode }, { now });
      if (outcome.outcome !== "applied") throw new CycleCountIntegrityError("adjustment evidence already existed for an undecided line");
      ledgerEventIds.push(outcome.docId);
    };
    const base = {
      type: "ADJUSTED", partId, location: sheet.location,
      sourceObject: { type: "ADJUSTMENT", id: sheetId },
      actor: { kind: actor.kind, id: actor.id }, occurredAt: now.getTime(),
    };
    // REJECT stages nothing: rejecting says the count is not trusted, not that the books move the other way.
    if (!isReject && isSerial) {
      for (const serialNo of line.serialVariance?.missing ?? []) {
        await stage({ ...base, quantity: 1, serialNo, idempotencyKey: ledgerKey(sheetId, partId, "missing", serialNo) });
      }
    } else if (!isReject && (line.variance ?? 0) !== 0) {
      await stage({ ...base, quantity: line.variance, idempotencyKey: ledgerKey(sheetId, partId, "adjust") });
    }

    writes.push({ ref: lineRef(deps.db, sheetId, partId), data: lineDecisionFields(line, actor, now, decision, reason, ledgerEventIds) });
    deps.stageAudit(txn, {
      action: isReject ? "rejectCycleCountLine" : "reconcileCycleCountLine", actorId: actor.id, sheetId, location: sheet.location, partId,
      ...(isSerial ? { serialVariance: line.serialVariance } : { variance: line.variance }),
    });
    for (const w of writes) {
      if (w.ref.path.startsWith(INVENTORY_TRANSACTIONS_COLLECTION + "/")) txn.create(w.ref, w.data);
      else txn.update(w.ref, w.data);
    }
    return decisionResponse("applied", line, ledgerEventIds, isReject ? "REJECTED" : "RECONCILED", reason);
  });
}

function decisionResponse(outcome: "applied" | "replayed", line: CycleCountLine, ledgerEventIds: readonly string[], status: string, reason: string | null) {
  return {
    outcome, sheetId: line.sheetId, lineId: line.lineId, partId: line.partId, status, ledgerEventIds: [...ledgerEventIds],
    ...(reason ? { reconciliationReason: reason } : {}),
  };
}

// ================================================================================ cancel / close
export async function cancelCycleCountLine(request: unknown, deps: SheetCommandDeps) {
  const actor = requireActor(deps.actor);
  const sheetId = requireString(request, "sheetId", () => new CycleCountSheetNotFoundError("sheetId missing"));
  const partId = requireString(request, "partId", () => new CycleCountPartInvalidError("partId missing"));
  return deps.db.runTransaction(async (txn) => {
    const now = deps.now();
    if (!(await deps.authorize(txn, actor.id, CYCLE_COUNT_CAPABILITY.cancel))) throw new UnauthorizedCycleCountError();
    const sheet = await readSheet(txn, deps.db, sheetId);
    requireOpen(sheet, "cancel a line");
    const line = await readLine(txn, deps.db, sheetId, partId);
    if (!line) throw new CycleCountNotFoundError();
    if (line.status === "CANCELLED") return { outcome: "replayed" as const, sheetId, partId, status: "CANCELLED" as const };
    if (line.status !== "OPEN") throw new CycleCountStatusInvalidError(`line is ${line.status}; only a line not yet counted can be cancelled`);
    txn.update(lineRef(deps.db, sheetId, partId), lineCancelFields(line, actor, now));
    deps.stageAudit(txn, { action: "cancelCycleCountLine", actorId: actor.id, sheetId, location: sheet.location, partId });
    return { outcome: "applied" as const, sheetId, partId, status: "CANCELLED" as const };
  });
}

async function readAllLines(txn: Transaction, db: Firestore, sheetId: string): Promise<CycleCountLine[]> {
  const snap = await txn.get(sheetRef(db, sheetId).collection(CYCLE_COUNT_LINES_SUBCOLLECTION).limit(MAX_LINES_PER_SHEET_TRANSACTION + 1));
  if (snap.size > MAX_LINES_PER_SHEET_TRANSACTION) {
    throw new CycleCountSheetStatusInvalidError(`sheet has more than ${MAX_LINES_PER_SHEET_TRANSACTION} lines; it cannot change state in one transaction`);
  }
  return snap.docs.map((d) => deserializeLine(sheetId, d.id, d.data()));
}

/** OPEN -> CANCELLED, only while no line has been counted. Its open lines are cancelled with it. */
export async function cancelCycleCountSheet(request: unknown, deps: SheetCommandDeps) {
  const actor = requireActor(deps.actor);
  const sheetId = requireString(request, "sheetId", () => new CycleCountSheetNotFoundError("sheetId missing"));
  return deps.db.runTransaction(async (txn) => {
    const now = deps.now();
    if (!(await deps.authorize(txn, actor.id, CYCLE_COUNT_CAPABILITY.cancel))) throw new UnauthorizedCycleCountError();
    const sheet = await readSheet(txn, deps.db, sheetId);
    if (sheet.status === "CANCELLED") return { outcome: "replayed" as const, sheetId, status: "CANCELLED" as const };
    requireOpen(sheet, "cancel it");
    const lines = await readAllLines(txn, deps.db, sheetId);
    if (lines.some((l) => l.status === "COUNTED" || l.status === "RECONCILED" || l.status === "REJECTED")) {
      throw new CycleCountSheetStatusInvalidError("a counted sheet cannot be cancelled -- dispose of its lines and close it");
    }
    for (const l of lines.filter((x) => x.status === "OPEN")) txn.update(lineRef(deps.db, sheetId, l.partId), lineCancelFields(l, actor, now));
    txn.update(sheetRef(deps.db, sheetId), sheetStatusFields("CANCELLED", sheet.version + 1, actor, now));
    deps.stageAudit(txn, { action: "cancelCycleCountSheet", actorId: actor.id, sheetId, location: sheet.location });
    return { outcome: "applied" as const, sheetId, status: "CANCELLED" as const };
  });
}

/** OPEN -> CLOSED, only when every non-cancelled line is RECONCILED or REJECTED (verified here, inside the transaction). */
export async function closeCycleCountSheet(request: unknown, deps: SheetCommandDeps) {
  const actor = requireActor(deps.actor);
  const sheetId = requireString(request, "sheetId", () => new CycleCountSheetNotFoundError("sheetId missing"));
  return deps.db.runTransaction(async (txn) => {
    const now = deps.now();
    if (!(await deps.authorize(txn, actor.id, CYCLE_COUNT_CAPABILITY.reconcile))) throw new UnauthorizedCycleCountError();
    const sheet = await readSheet(txn, deps.db, sheetId);
    if (sheet.status === "CLOSED") return { outcome: "replayed" as const, sheetId, status: "CLOSED" as const };
    requireOpen(sheet, "close it");
    const lines = await readAllLines(txn, deps.db, sheetId);
    const live = lines.filter((l) => l.status !== "CANCELLED");
    if (live.length === 0) throw new CycleCountSheetStatusInvalidError("a sheet with no counted line is cancelled, not closed");
    if (live.some((l) => l.status !== "RECONCILED" && l.status !== "REJECTED")) {
      throw new CycleCountSheetStatusInvalidError("every line must be reconciled or rejected before the sheet closes");
    }
    txn.update(sheetRef(deps.db, sheetId), sheetStatusFields("CLOSED", sheet.version + 1, actor, now));
    deps.stageAudit(txn, { action: "closeCycleCountSheet", actorId: actor.id, sheetId, location: sheet.location });
    return { outcome: "applied" as const, sheetId, status: "CLOSED" as const };
  });
}

export { CycleCountMalformedStoredRecordError };
