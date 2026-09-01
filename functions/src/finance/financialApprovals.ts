// Finance — PURE approval-governance core (F8 / FIN-007). Adjustment / approval / exception governance:
// certain financial actions must not take effect on one person's say-so. This module is the ONE approval
// machinery every governed financial action composes; the POLICY VALUES (which actions require approval,
// at what thresholds, who may approve) are Owner decisions supplied as explicit inputs — never defaulted
// here. What IS fixed here, mechanically:
//   • FAIL-CLOSED: an action type with no explicit policy REQUIRES approval — absence of policy is never
//     permission.
//   • SELF-APPROVAL FORBIDDEN: the approver must not be the requester, ever.
//   • Approvals are EXPLICIT frozen records naming action, target, both people, decision, reason, and
//     time — invariant C: governance events are history.
//   • A rejection is terminal for that request; acting anyway must be impossible to do quietly
//     (assertActionApproved refuses).
// Integer minor units; pure; no I/O; capability activation and threshold values stay Owner-gated.

export const APPROVABLE_ACTION_TYPES = Object.freeze([
  "INVOICE_ADJUSTMENT", // credit memo / debit charge (adjustmentCommands)
  "WRITE_OFF", // authorized non-collection — its own gravity even though stored as an adjustment
  "REFUND", // money returned (refundCommands)
  "PLAN_APPROVAL", // approving a GOAL/BUDGET version (FIN-003)
  "ATTRIBUTION_CORRECTION", // post-commitment attribution correction (FIN-002 §17 — future events)
] as const);
export type ApprovableActionType = (typeof APPROVABLE_ACTION_TYPES)[number];

export class ApprovalError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = "ApprovalError"; this.code = code; }
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** One Owner-supplied policy line: does this action type need approval, and above what amount. */
export interface ApprovalPolicyLine {
  actionType: string;
  requiresApproval: boolean;
  /** null = always (when requiresApproval); an integer = required at/above this amount in minor units. */
  thresholdMinor: number | null;
}

export interface FinancialActionRef {
  actionType: string;
  targetRecordId: string; // the invoice/plan/record the action is against
  amountMinor: number | null; // null for non-monetary actions (e.g. plan approval)
}

// Does this action require approval under the supplied policy? Fail-closed on every edge: unknown action
// type ⇒ REQUIRED; duplicate policy lines for one type ⇒ thrown (ambiguous policy is not policy).
export function isApprovalRequired(policy: ApprovalPolicyLine[], action: FinancialActionRef): boolean {
  if (!(APPROVABLE_ACTION_TYPES as readonly string[]).includes(action?.actionType)) {
    throw new ApprovalError("ACTION_TYPE_INVALID", `unknown financial action type "${action?.actionType}"`);
  }
  const lines = (Array.isArray(policy) ? policy : []).filter((l) => l?.actionType === action.actionType);
  if (lines.length > 1) throw new ApprovalError("POLICY_AMBIGUOUS", `${lines.length} policy lines for ${action.actionType} — ambiguous policy is not policy`);
  const line = lines[0];
  if (!line) return true; // fail-closed: no explicit policy ⇒ approval required
  if (!line.requiresApproval) return false;
  if (line.thresholdMinor === null) return true;
  if (!isInt(line.thresholdMinor) || line.thresholdMinor < 0) throw new ApprovalError("POLICY_INVALID", `thresholdMinor for ${action.actionType} must be a non-negative integer or null`);
  if (action.amountMinor === null) return true; // a threshold cannot exempt an action with no stated amount
  if (!isInt(action.amountMinor) || action.amountMinor < 0) throw new ApprovalError("ACTION_INVALID", "amountMinor must be a non-negative integer or null");
  return action.amountMinor >= line.thresholdMinor;
}

export const APPROVAL_DECISIONS = Object.freeze(["APPROVED", "REJECTED"] as const);
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export interface ApprovalRecordInput {
  actionType: string;
  targetRecordId: string;
  amountMinor: number | null;
  requestedByUid: string;
  decidedByUid: string;
  decision: string;
  reason: string;
  decidedAtMillis: number; // ctx-supplied server time
}

export interface ApprovalRecord extends Omit<ApprovalRecordInput, "actionType" | "decision"> {
  actionType: ApprovableActionType;
  decision: ApprovalDecision;
}

// Validate + freeze one approval/rejection record. Self-approval is forbidden unconditionally — no policy
// input can re-enable it.
export function buildApprovalRecord(input: ApprovalRecordInput): ApprovalRecord {
  if (!(APPROVABLE_ACTION_TYPES as readonly string[]).includes(input?.actionType)) throw new ApprovalError("ACTION_TYPE_INVALID", `unknown financial action type "${input?.actionType}"`);
  if (!(APPROVAL_DECISIONS as readonly string[]).includes(input.decision)) throw new ApprovalError("DECISION_INVALID", `decision must be one of ${APPROVAL_DECISIONS.join("/")}`);
  for (const [f, v] of [["targetRecordId", input.targetRecordId], ["requestedByUid", input.requestedByUid], ["decidedByUid", input.decidedByUid]] as const) {
    if (!nonEmpty(v)) throw new ApprovalError("REQUIRED", `${f} is required`);
  }
  if (!nonEmpty(input.reason)) throw new ApprovalError("REASON_REQUIRED", "a decision without a reason is not governance");
  if (input.amountMinor !== null && (!isInt(input.amountMinor) || input.amountMinor < 0)) throw new ApprovalError("AMOUNT_INVALID", "amountMinor must be a non-negative integer or null");
  if (!isInt(input.decidedAtMillis) || input.decidedAtMillis <= 0) throw new ApprovalError("DECIDED_AT_REQUIRED", "decidedAtMillis (ms epoch) is required");
  if (input.requestedByUid.trim() === input.decidedByUid.trim()) {
    throw new ApprovalError("SELF_APPROVAL_FORBIDDEN", "the requester may not decide their own request — under any policy");
  }
  return Object.freeze({
    actionType: input.actionType as ApprovableActionType,
    targetRecordId: input.targetRecordId.trim(),
    amountMinor: input.amountMinor,
    requestedByUid: input.requestedByUid.trim(),
    decidedByUid: input.decidedByUid.trim(),
    decision: input.decision as ApprovalDecision,
    reason: input.reason.trim(),
    decidedAtMillis: input.decidedAtMillis,
  });
}

// The execution-side guard: before a governed action that required approval takes effect, the command
// path asserts a matching APPROVED record. Anything else refuses — no record, wrong target/type, a
// REJECTED decision, or an amount larger than what was approved (approving 100 is not approving 150).
export function assertActionApproved(action: FinancialActionRef, approval: ApprovalRecord | null | undefined): void {
  if (!approval) throw new ApprovalError("APPROVAL_MISSING", `${action.actionType} on ${action.targetRecordId} requires an approval record`);
  if (approval.actionType !== action.actionType || approval.targetRecordId !== action.targetRecordId) {
    throw new ApprovalError("APPROVAL_MISMATCH", "approval record is for a different action or target");
  }
  if (approval.decision !== "APPROVED") {
    throw new ApprovalError("APPROVAL_REJECTED", "the request was rejected — a rejection is terminal for this request");
  }
  if (action.amountMinor !== null && approval.amountMinor !== null && action.amountMinor > approval.amountMinor) {
    throw new ApprovalError("APPROVAL_AMOUNT_EXCEEDED", `action amount ${action.amountMinor} exceeds approved amount ${approval.amountMinor}`);
  }
  if (action.amountMinor !== null && approval.amountMinor === null) {
    throw new ApprovalError("APPROVAL_AMOUNT_EXCEEDED", "a monetary action needs an approval that states the approved amount");
  }
}
