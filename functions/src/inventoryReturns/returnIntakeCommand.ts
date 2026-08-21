// RETURNS INTAKE — recording that something came back, and nothing more.
//
// ============================ THE INVARIANT, FROM DECISIONS #118 ============================
//
// **A RETURN MUST NOT AUTOMATICALLY RESTORE INVENTORY TO SELLABLE STOCK.**
//
// Intake and disposition are separate authorities. Intake says "this arrived back, in this shape,
// for this reason". Disposition — return to stock, inspect/quarantine, repair, vendor RMA, scrap —
// decides what happens to it, and none of those decisions exists yet.
//
// So this command writes a RETURN RECORD and NO LEDGER EVENT. `RETURNED` is a schema-legal
// operational movement type that nothing in this platform writes, and this is why: writing one at
// intake would BE the automatic restock #118 forbids. A test asserts the module cannot name it.
//
// ============================ EVERY RETURN AWAITS DISPOSITION ============================
//
// There is exactly one state a return can be created in, and no transition out of it here. A return
// sits AWAITING_DISPOSITION until a future, separately authorized command decides. That is not a
// placeholder for something half-built: it is the honest shape of a process whose second half is a
// business decision nobody has made.
//
// ============================ CONDITION IS AN OBSERVATION, NOT A DECISION ============================
//
// "The box is crushed" is something the person receiving it can see. "Therefore scrap it" is a
// policy. This command captures the first and refuses to imply the second — condition never gates,
// routes or determines anything here, and UNKNOWN is a first-class answer because a sealed carton's
// contents genuinely are unknown at the dock.

import type { Firestore, Transaction } from "firebase-admin/firestore";

export const RETURNS_COLLECTION = "inventory_returns";

/**
 * The only capability this command needs, and its own.
 *
 * NOT `inventory.stock.receive`: receiving accepts stock INTO sellable inventory, which is precisely
 * what a return must not do. Reusing it would make every returns clerk a receiver, and would put
 * intake behind an authority whose whole meaning is the thing #118 forbids.
 */
export const RETURN_INTAKE_CAPABILITY = "inventory.returns.intake";

/**
 * The ONLY state a return is created in. There is no transition out of it in this module.
 *
 * Written as a one-member set rather than a bare string so that adding a second state is a visible,
 * deliberate act rather than a typo somewhere.
 */
export const RETURN_STATES = ["AWAITING_DISPOSITION"] as const;
export type ReturnState = (typeof RETURN_STATES)[number];

/**
 * What the person at the dock can SEE. Deliberately observational.
 *
 * None of these implies what happens next: a DAMAGED unit might be repaired, scrapped or sent back
 * to the vendor, and that is disposition's decision. UNKNOWN is first-class because a sealed carton's
 * contents genuinely are unknown until someone opens it, and forcing a guess would record a fact
 * nobody established.
 */
export const RETURN_CONDITIONS = ["UNOPENED", "OPENED", "DAMAGED", "UNKNOWN"] as const;
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number];

/** Where the return came from. */
export const RETURN_SOURCES = ["WORK_ORDER", "CUSTOMER", "TRUCK", "SUPPLIER", "UNKNOWN"] as const;
export type ReturnSource = (typeof RETURN_SOURCES)[number];

export class ReturnInvalidError extends Error {}
export class ReturnUnauthorizedError extends Error {}

export interface ReturnIntakeDeps {
  readonly db: Firestore;
  readonly actor: { readonly kind: "USER" | "SYSTEM"; readonly id: string };
  readonly authorize: (txn: Transaction, actorId: string, capability: string) => Promise<boolean>;
  readonly now: () => Date;
}

export interface ReturnIntakeOutcome {
  readonly outcome: "recorded" | "replayed";
  readonly returnId: string;
  readonly partId: string;
  readonly state: ReturnState;
  readonly quantity: number | null;
  readonly serialNumbers: readonly string[];
}

const MAX_REASON = 500;
const isNonBlank = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

interface ReturnIntakeRequest {
  readonly partId: string;
  readonly source: ReturnSource;
  readonly sourceReference: string | null;
  readonly condition: ReturnCondition;
  readonly reason: string | null;
  readonly quantity?: number;
  readonly serialNumbers?: readonly string[];
  readonly idempotencyKey: string;
}

/** Derived, so a retry on a bad connection replays rather than recording the same return twice. */
export function deriveReturnId(idempotencyKey: string): string {
  return `ret_${idempotencyKey}`;
}

export function validateReturnIntake(input: unknown): { valid: true; value: ReturnIntakeRequest } | { valid: false; reason: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { valid: false, reason: "not_object" };
  const d = input as Record<string, unknown>;

  if (!isNonBlank(d.partId)) return { valid: false, reason: "part_required" };
  if (!isNonBlank(d.idempotencyKey)) return { valid: false, reason: "idempotency_key_required" };

  // An UNRECOGNIZED source or condition is REFUSED, never coerced to UNKNOWN. UNKNOWN means "nobody
  // could tell"; a typo means the caller is broken, and quietly turning one into the other would
  // record a deliberate observation that was never made.
  const source = (RETURN_SOURCES as readonly string[]).includes(d.source as string)
    ? (d.source as ReturnSource)
    : null;
  if (source === null) return { valid: false, reason: "source_invalid" };

  const condition = (RETURN_CONDITIONS as readonly string[]).includes(d.condition as string)
    ? (d.condition as ReturnCondition)
    : null;
  if (condition === null) return { valid: false, reason: "condition_invalid" };

  let reason: string | null = null;
  if (d.reason !== undefined && d.reason !== null) {
    if (typeof d.reason !== "string") return { valid: false, reason: "reason_invalid" };
    const trimmed = d.reason.trim();
    if (trimmed.length > MAX_REASON) return { valid: false, reason: "reason_too_long" };
    reason = trimmed === "" ? null : trimmed;
  }

  const sourceReference = isNonBlank(d.sourceReference) ? d.sourceReference.trim() : null;

  const hasSerials = d.serialNumbers !== undefined;
  const hasQuantity = d.quantity !== undefined;
  if (hasSerials === hasQuantity) return { valid: false, reason: "quantity_or_serials_required" };

  const base = { partId: d.partId, source, sourceReference, condition, reason, idempotencyKey: d.idempotencyKey };

  if (hasSerials) {
    if (!Array.isArray(d.serialNumbers) || d.serialNumbers.length === 0) return { valid: false, reason: "serials_invalid" };
    if (!d.serialNumbers.every(isNonBlank)) return { valid: false, reason: "serials_invalid" };
    const seen = new Set(d.serialNumbers.map((s) => (s as string).trim().toLowerCase()));
    if (seen.size !== d.serialNumbers.length) return { valid: false, reason: "serials_duplicated" };
    return { valid: true, value: { ...base, serialNumbers: (d.serialNumbers as string[]).map((s) => s.trim()) } };
  }

  if (typeof d.quantity !== "number" || !Number.isInteger(d.quantity) || d.quantity <= 0) {
    return { valid: false, reason: "quantity_invalid" };
  }
  return { valid: true, value: { ...base, quantity: d.quantity } };
}

/**
 * Record that something came back.
 *
 * One transaction, idempotent by derived id. It writes ONE document to `inventory_returns` and
 * touches nothing else — no ledger, no balance, no serialized-asset state change. A returned
 * serialized unit does NOT become AVAILABLE here: whether it may be sold again is disposition's
 * decision, and changing its state at intake would answer that question by accident.
 */
export async function recordReturnIntake(request: unknown, deps: ReturnIntakeDeps): Promise<ReturnIntakeOutcome> {
  const validated = validateReturnIntake(request);
  if (!validated.valid) throw new ReturnInvalidError(validated.reason);
  const req = validated.value;

  const returnId = deriveReturnId(req.idempotencyKey);

  return deps.db.runTransaction(async (txn) => {
    if (!(await deps.authorize(txn, deps.actor.id, RETURN_INTAKE_CAPABILITY))) {
      throw new ReturnUnauthorizedError();
    }

    const ref = deps.db.collection(RETURNS_COLLECTION).doc(returnId);
    const existing = await txn.get(ref);
    const serialNumbers = req.serialNumbers ?? [];

    if (existing.exists) {
      return {
        outcome: "replayed" as const,
        returnId,
        partId: req.partId,
        state: "AWAITING_DISPOSITION" as const,
        quantity: serialNumbers.length > 0 ? null : (req.quantity ?? 0),
        serialNumbers,
      };
    }

    const now = deps.now();
    txn.create(ref, {
      partId: req.partId,
      source: req.source,
      sourceReference: req.sourceReference,
      condition: req.condition,
      reason: req.reason,
      quantity: serialNumbers.length > 0 ? null : (req.quantity ?? 0),
      serialNumbers,
      // The only state. A future disposition command will move it; nothing here can.
      state: "AWAITING_DISPOSITION",
      receivedAt: now,
      receivedBy: deps.actor.id,
      idempotencyKey: req.idempotencyKey,
      schemaVersion: 1,
    });

    return {
      outcome: "recorded" as const,
      returnId,
      partId: req.partId,
      state: "AWAITING_DISPOSITION" as const,
      quantity: serialNumbers.length > 0 ? null : (req.quantity ?? 0),
      serialNumbers,
    };
  });
}
