// The five reorder-request transitions, as trusted commands.
//
// ============================ WHY THIS IS NOT ONE "UPDATE" COMMAND ============================
//
// The retired rule was not one rule. `allow update` was EIGHT self-contained branches, each with
// its own leading authorization clause, its own from/to statuses, its own field allowlist and its
// own pinned-unchanged fields. Collapsing them into a generic patch endpoint would replace a
// state machine with an arbitrary write, which is the single largest widening available here.
//
// So there is one command per transition, and each carries the capability the catalog already
// declares for it. No replacement generic write authority is minted.
//
// ============================ THE RECORD SCOPE IS THE POINT ============================
//
// Three of these five carried an ASSIGNEE restriction in Rules, and it sat OUTSIDE the role
// disjunction:
//
//   (isAdminOrDispatcher() || isActiveOperationalRole("PARTS_ASSOCIATE"))
//     && ... && request.auth.uid == resource.data.assignedToUserId
//
// So even an ADMIN had to be the assignee to start purchasing, post progress or mark received.
// Holding the capability is necessary and not sufficient. That is preserved literally: the command
// reads the authoritative record and compares `assignedToUserId` with the resolved actor.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, type Firestore, type Transaction } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";

const REORDER_REQUESTS = "reorder_requests";

export const CAP_APPROVE = "reorder.request.approve";
export const CAP_REJECT = "reorder.request.reject";
export const CAP_ASSIGN = "reorder.request.assign";
export const CAP_START_PURCHASING = "reorder.request.startPurchasing";
export const CAP_POST_UPDATE = "reorder.request.postPurchasingUpdate";
export const CAP_MARK_RECEIVED = "reorder.request.markReceived";

// Mirrors domain/constants.js. Duplicated with the same reasoning every other client/server pair in
// this repo carries: there is no shared-module tooling, and widening the Functions rootDir changes
// what `firebase deploy` packages.
export const STATUS = Object.freeze({
  PENDING_REVIEW: "PENDING_REVIEW",
  READY_FOR_PARTS_MANAGER: "READY_FOR_PARTS_MANAGER",
  ASSIGNED_TO_PARTS_ASSOCIATE: "ASSIGNED_TO_PARTS_ASSOCIATE",
  PURCHASING_IN_PROGRESS: "PURCHASING_IN_PROGRESS",
  ORDERED: "ORDERED",
  RECEIVED: "RECEIVED",
  REJECTED: "REJECTED",
  APPROVED: "APPROVED",
});

export const OWNER = Object.freeze({
  INVENTORY: "INVENTORY",
  PARTS_MANAGER: "PARTS_MANAGER",
  PARTS_ASSOCIATE: "PARTS_ASSOCIATE",
});

export class ReorderTransitionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ReorderTransitionError";
  }
}

const text = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
};

type Record_ = Record<string, unknown>;

/** Every builder receives the AUTHORITATIVE current record, never a caller's idea of it. */
function requireRecord(current: Record_ | null): Record_ {
  if (current === null) throw new ReorderTransitionError("NOT_FOUND", "No such reorder request.");
  return current;
}

function requireStatus(current: Record_, expected: string): void {
  if (current.status !== expected) {
    throw new ReorderTransitionError(
      "STATE_INVALID",
      `This reorder request is ${String(current.status)}, not ${expected}.`,
    );
  }
}

/**
 * The ASSIGNEE record scope, exactly as Rules applied it.
 *
 * Applies to EVERY caller including an administrator, because the Rules clause sat outside the role
 * disjunction. A capability holder who is not the assignee is refused.
 */
function requireAssignee(current: Record_, actorUid: string): void {
  if (current.assignedToUserId !== actorUid) {
    throw new ReorderTransitionError("NOT_ASSIGNEE", "This reorder request is not assigned to you.");
  }
}

// ════════════════════════════ REVIEW: APPROVE and REJECT ════════════════════════════
//
// TWO ACTIONS, TWO CAPABILITIES. The catalog declares `reorder.request.approve` and
// `reorder.request.reject` separately, and the Rules branch produced two different results -- one
// hands the request to the Parts Manager, the other terminates it and requires a reason. The client
// called one function with a `decision` argument; the client may still REQUEST a decision, but it
// does not decide whether that transition is legal or which authority applies.

export function buildApprove(current: Record_ | null, ctx: { actorUid: string; nowMillis: number; notes?: unknown }): Record_ {
  const record = requireRecord(current);
  requireStatus(record, STATUS.PENDING_REVIEW);
  return {
    status: STATUS.READY_FOR_PARTS_MANAGER,
    reviewDecision: STATUS.APPROVED,
    reviewedBy: ctx.actorUid,
    reviewedAt: ctx.nowMillis,
    reviewNotes: text(ctx.notes),
    currentOwner: OWNER.PARTS_MANAGER,
  };
}

export function buildReject(current: Record_ | null, ctx: { actorUid: string; nowMillis: number; notes?: unknown }): Record_ {
  const record = requireRecord(current);
  requireStatus(record, STATUS.PENDING_REVIEW);
  // REQUIRED ON REJECT ONLY, matching both the client guard and the Rules branch: a rejection with
  // no reason leaves the requester nothing to act on.
  const notes = text(ctx.notes);
  if (!notes) {
    throw new ReorderTransitionError("NOTES_REQUIRED", "Review notes are required when rejecting a reorder request.");
  }
  return {
    status: STATUS.REJECTED,
    reviewDecision: STATUS.REJECTED,
    reviewedBy: ctx.actorUid,
    reviewedAt: ctx.nowMillis,
    reviewNotes: notes,
    // UNCHANGED on reject, exactly as the rule required -- a rejected request does not change hands.
    currentOwner: record.currentOwner ?? OWNER.INVENTORY,
  };
}

// ════════════════════════════ ASSIGN ════════════════════════════

export function buildAssign(
  current: Record_ | null,
  ctx: { actorUid: string; nowMillis: number; assignedToUserId?: unknown },
): Record_ {
  const record = requireRecord(current);
  requireStatus(record, STATUS.READY_FOR_PARTS_MANAGER);
  const assignee = text(ctx.assignedToUserId);
  if (!assignee) {
    throw new ReorderTransitionError("ASSIGNEE_REQUIRED", "A Parts Associate user id is required.");
  }
  return {
    status: STATUS.ASSIGNED_TO_PARTS_ASSOCIATE,
    currentOwner: OWNER.PARTS_ASSOCIATE,
    assignedToUserId: assignee,
    // THE ACTOR, never a caller-supplied assignedBy. The rule pinned this to request.auth.uid.
    assignedBy: ctx.actorUid,
    assignedAt: ctx.nowMillis,
  };
}

// ════════════════════════════ START PURCHASING ════════════════════════════

export function buildStartPurchasing(current: Record_ | null, ctx: { actorUid: string; nowMillis: number }): Record_ {
  const record = requireRecord(current);
  requireStatus(record, STATUS.ASSIGNED_TO_PARTS_ASSOCIATE);
  requireAssignee(record, ctx.actorUid);
  return {
    status: STATUS.PURCHASING_IN_PROGRESS,
    purchasingStartedAt: ctx.nowMillis,
    purchasingStartedBy: ctx.actorUid,
  };
}

// ════════════════════════════ POST PURCHASING PROGRESS ════════════════════════════

export function buildPurchasingProgress(
  current: Record_ | null,
  ctx: {
    actorUid: string;
    nowMillis: number;
    purchasingNotes?: unknown;
    vendorContacted?: unknown;
    expectedAvailabilityDate?: unknown;
  },
): Record_ {
  const record = requireRecord(current);
  // Status is unchanged by this transition -- it stays PURCHASING_IN_PROGRESS -- so the check is
  // that it is ALREADY that, which is what the rule's `resource.data.status ==` clause said.
  requireStatus(record, STATUS.PURCHASING_IN_PROGRESS);
  requireAssignee(record, ctx.actorUid);
  // A CLOSED SET OF EDITABLE FIELDS, not an arbitrary patch. The rule's hasOnly() allowlist is what
  // kept this from being a general-purpose write on a record in flight.
  return {
    purchasingNotes: text(ctx.purchasingNotes),
    vendorContacted: Boolean(ctx.vendorContacted),
    expectedAvailabilityDate: ctx.expectedAvailabilityDate || null,
    lastPurchasingUpdateAt: ctx.nowMillis,
    lastPurchasingUpdateBy: ctx.actorUid,
  };
}

// ════════════════════════════ MARK RECEIVED ════════════════════════════

export function buildMarkReceived(current: Record_ | null, ctx: { actorUid: string; nowMillis: number }): Record_ {
  const record = requireRecord(current);
  // ORDERED -> RECEIVED. Note this is NOT PURCHASING_IN_PROGRESS: a request becomes ORDERED only
  // when a purchase order is recorded against it, so receiving something never ordered is refused
  // by this check rather than by anything downstream.
  requireStatus(record, STATUS.ORDERED);
  requireAssignee(record, ctx.actorUid);
  return {
    status: STATUS.RECEIVED,
    receivedBy: ctx.actorUid,
    receivedAt: ctx.nowMillis,
  };
}

// ════════════════════════════ THE CALLABLES ════════════════════════════

async function requireCapability(uid: string, capabilityId: string): Promise<void> {
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [capabilityId] });
    allowed = decisions[capabilityId] === true;
  } catch (err) {
    // FAIL-CLOSED: a throwing resolver is a denial.
    console.error(`[reorder] capability resolution failed for ${capabilityId}`, err);
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", `You are not authorized: ${capabilityId}`);
}

function mapError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof ReorderTransitionError) {
    // NOT_ASSIGNEE is an AUTHORIZATION answer -- the caller holds the capability and still may not
    // act on THIS record. Reported as permission-denied so a surface does not invite a retry.
    if (err.code === "NOT_ASSIGNEE") return new HttpsError("permission-denied", err.message, { code: err.code });
    if (err.code === "NOT_FOUND" || err.code === "STATE_INVALID") {
      return new HttpsError("failed-precondition", err.message, { code: err.code });
    }
    return new HttpsError("invalid-argument", err.message, { code: err.code });
  }
  return new HttpsError("internal", "The reorder transition could not be completed.");
}

const asRecord = (v: unknown): Record_ => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record_) : {});

/**
 * Apply one transition inside a TRANSACTION.
 *
 * The read and the write are one unit so the status the builder validated is the status the write
 * lands on -- two concurrent Parts Associates cannot both start purchasing on the same request.
 */
async function applyTransition(
  db: Firestore,
  requestId: string,
  build: (current: Record_ | null, tx: Transaction) => Record_,
): Promise<{ success: true; reorderRequestId: string }> {
  const id = text(requestId);
  if (!id) throw new ReorderTransitionError("INVALID", "reorderRequestId is required.");
  const ref = db.collection(REORDER_REQUESTS).doc(id);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const patch = build(snap.exists ? (snap.data() as Record_) : null, tx);
    tx.update(ref, patch);
  });
  return { success: true, reorderRequestId: id };
}

function makeCallable(
  capability: string,
  build: (current: Record_ | null, ctx: { actorUid: string; nowMillis: number } & Record_) => Record_,
) {
  return onCall({ region: "us-central1" }, async (request) => {
    const uid = request.auth?.uid;
    if (typeof uid !== "string" || !uid) throw new HttpsError("unauthenticated", "Must be signed in.");
    await requireCapability(uid, capability);
    const data = asRecord(request.data);
    try {
      return await applyTransition(getFirestore(), String(data.reorderRequestId ?? ""), (current) =>
        build(current, { ...data, actorUid: uid, nowMillis: Date.now() }),
      );
    } catch (err) {
      throw mapError(err);
    }
  });
}

export const approveReorderRequest = makeCallable(CAP_APPROVE, buildApprove);
export const rejectReorderRequest = makeCallable(CAP_REJECT, buildReject);
export const assignReorderRequest = makeCallable(CAP_ASSIGN, buildAssign);
export const startReorderPurchasing = makeCallable(CAP_START_PURCHASING, buildStartPurchasing);
export const postReorderPurchasingUpdate = makeCallable(CAP_POST_UPDATE, buildPurchasingProgress);
export const markReorderRequestReceived = makeCallable(CAP_MARK_RECEIVED, buildMarkReceived);
