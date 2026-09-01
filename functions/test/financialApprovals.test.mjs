// Finance — approval governance core (F8 / FIN-007). Pure tests. Proves: fail-closed (no policy ⇒
// approval required; ambiguous policy thrown), unconditional self-approval prohibition, explicit frozen
// decision records with mandatory reasons, terminal rejections, and amount-bounded approvals.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isApprovalRequired,
  buildApprovalRecord,
  assertActionApproved,
  ApprovalError,
  APPROVABLE_ACTION_TYPES,
} from "../lib/finance/financialApprovals.js";

const action = (over = {}) => ({ actionType: "WRITE_OFF", targetRecordId: "INV-1", amountMinor: 50_000, ...over });
const approvalInput = (over = {}) => ({
  actionType: "WRITE_OFF",
  targetRecordId: "INV-1",
  amountMinor: 50_000,
  requestedByUid: "uid-requester",
  decidedByUid: "uid-approver",
  decision: "APPROVED",
  reason: "customer bankruptcy, collections exhausted",
  decidedAtMillis: 1_700_000_000_000,
  ...over,
});

test("the approvable action set is closed and matches the modeled financial actions", () => {
  assert.deepEqual([...APPROVABLE_ACTION_TYPES], ["INVOICE_ADJUSTMENT", "WRITE_OFF", "REFUND", "PLAN_APPROVAL", "ATTRIBUTION_CORRECTION"]);
});

test("FAIL-CLOSED: no policy line for the action type ⇒ approval required", () => {
  assert.equal(isApprovalRequired([], action()), true);
  assert.equal(isApprovalRequired([{ actionType: "REFUND", requiresApproval: false, thresholdMinor: null }], action()), true);
});

test("explicit policy is honored: exempt below threshold, required at/above; requiresApproval:false exempts", () => {
  const policy = [{ actionType: "WRITE_OFF", requiresApproval: true, thresholdMinor: 50_000 }];
  assert.equal(isApprovalRequired(policy, action({ amountMinor: 49_999 })), false);
  assert.equal(isApprovalRequired(policy, action({ amountMinor: 50_000 })), true);
  assert.equal(isApprovalRequired([{ actionType: "WRITE_OFF", requiresApproval: false, thresholdMinor: null }], action()), false);
  // threshold null = always required
  assert.equal(isApprovalRequired([{ actionType: "WRITE_OFF", requiresApproval: true, thresholdMinor: null }], action({ amountMinor: 1 })), true);
});

test("a threshold cannot exempt an action with no stated amount; ambiguous/duplicate policy is thrown", () => {
  const policy = [{ actionType: "PLAN_APPROVAL", requiresApproval: true, thresholdMinor: 100 }];
  assert.equal(isApprovalRequired(policy, action({ actionType: "PLAN_APPROVAL", amountMinor: null })), true);
  assert.throws(
    () => isApprovalRequired([{ actionType: "WRITE_OFF", requiresApproval: true, thresholdMinor: null }, { actionType: "WRITE_OFF", requiresApproval: false, thresholdMinor: null }], action()),
    (e) => e instanceof ApprovalError && e.code === "POLICY_AMBIGUOUS",
  );
  assert.throws(() => isApprovalRequired([], action({ actionType: "PAY_BONUS" })), (e) => e.code === "ACTION_TYPE_INVALID");
});

test("SELF-APPROVAL is forbidden unconditionally — no input shape re-enables it", () => {
  assert.throws(() => buildApprovalRecord(approvalInput({ decidedByUid: "uid-requester" })), (e) => e.code === "SELF_APPROVAL_FORBIDDEN");
  assert.throws(() => buildApprovalRecord(approvalInput({ decidedByUid: " uid-requester " })), (e) => e.code === "SELF_APPROVAL_FORBIDDEN");
});

test("decision records are frozen, reasoned, and time-stamped; missing reason refuses", () => {
  const r = buildApprovalRecord(approvalInput());
  assert.ok(Object.isFrozen(r));
  assert.equal(r.decision, "APPROVED");
  assert.throws(() => buildApprovalRecord(approvalInput({ reason: "  " })), (e) => e.code === "REASON_REQUIRED");
  assert.throws(() => buildApprovalRecord(approvalInput({ decidedAtMillis: 0 })), (e) => e.code === "DECIDED_AT_REQUIRED");
  assert.throws(() => buildApprovalRecord(approvalInput({ decision: "MAYBE" })), (e) => e.code === "DECISION_INVALID");
});

test("execution guard: missing / mismatched / rejected approvals refuse the action", () => {
  const approved = buildApprovalRecord(approvalInput());
  assert.doesNotThrow(() => assertActionApproved(action(), approved));
  assert.throws(() => assertActionApproved(action(), null), (e) => e.code === "APPROVAL_MISSING");
  assert.throws(() => assertActionApproved(action({ targetRecordId: "INV-2" }), approved), (e) => e.code === "APPROVAL_MISMATCH");
  assert.throws(() => assertActionApproved(action({ actionType: "REFUND" }), buildApprovalRecord(approvalInput())), (e) => e.code === "APPROVAL_MISMATCH");
  const rejected = buildApprovalRecord(approvalInput({ decision: "REJECTED", reason: "not justified" }));
  assert.throws(() => assertActionApproved(action(), rejected), (e) => e.code === "APPROVAL_REJECTED");
});

test("approving 100 is not approving 150 — amount-bounded; monetary action needs a stated approved amount", () => {
  const approved = buildApprovalRecord(approvalInput({ amountMinor: 100 }));
  assert.doesNotThrow(() => assertActionApproved(action({ amountMinor: 100 }), approved));
  assert.throws(() => assertActionApproved(action({ amountMinor: 150 }), approved), (e) => e.code === "APPROVAL_AMOUNT_EXCEEDED");
  const amountless = buildApprovalRecord(approvalInput({ amountMinor: null }));
  assert.throws(() => assertActionApproved(action({ amountMinor: 100 }), amountless), (e) => e.code === "APPROVAL_AMOUNT_EXCEEDED");
  // a non-monetary action against a non-monetary approval is fine
  assert.doesNotThrow(() => assertActionApproved(action({ actionType: "PLAN_APPROVAL", targetRecordId: "PLAN-1", amountMinor: null }), buildApprovalRecord(approvalInput({ actionType: "PLAN_APPROVAL", targetRecordId: "PLAN-1", amountMinor: null }))));
});
