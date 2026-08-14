// Sales Opportunity — PURE governed write core (framework-independent; unit-tested). Builds the field maps
// the callable persists; enforces the ratified business rules. No Firestore/firebase-functions imports, so
// the rules are testable in isolation and the callable layer only supplies I/O + auth.
//
// INVARIANTS (fail-closed): Opportunity is PRE-COMMITMENT. Solution lines are PRODUCT-level (EQUIPMENT_MODEL/
// PART/SERVICE) — a serialized Equipment asset is NEVER a line (assigned downstream of WON -> Sales Order ->
// fulfillment). owner is a canonical Employee ref (ownerEmployeeId), not free text or a UID. Creation always
// starts at IDENTIFIED, open (no outcome). Transitions are validated by checkTransition().

import {
  OPPORTUNITY_LINE_KINDS,
  isChannel,
  isStage,
  checkTransition,
  type OpportunityLineKind,
  type OpportunityStage,
  type OpportunityOutcome,
  type SalesChannel,
  type TransitionIntent,
} from "./opportunityLifecycle";

export type OpportunityCommandErrorCode =
  | "INVALID"
  | "ACCOUNT_REQUIRED"
  | "OWNER_REQUIRED"
  | "CHANNEL_INVALID"
  | "NO_LINES"
  | "LINE_INVALID"
  | "SERIALIZED_LINE_FORBIDDEN"
  | "ALREADY_CLOSED"
  | "ILLEGAL_TRANSITION"
  | "OUTCOME_REQUIRES_DECISION"
  | "LINE_QTY_REQUIRED_FOR_WON";

export class OpportunityCommandError extends Error {
  code: OpportunityCommandErrorCode;
  constructor(code: OpportunityCommandErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "OpportunityCommandError";
  }
}

export interface OpportunityLineInput {
  kind: OpportunityLineKind;
  ref: string; // model number / partId / service code — a PRODUCT-level reference, never a serial
  qty: number;
}

export interface CreateOpportunityInput {
  accountId: string;
  ownerEmployeeId: string;
  salesChannel: SalesChannel;
  need?: string;
  expectedValue?: number | null;
  expectedCloseAt?: number | null;
  lines?: OpportunityLineInput[];
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const finiteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
// Mirrors salesOrderCommands.ts's posInt: both Sales Order creation paths require an INTEGER orderedQty. A
// fractional Opportunity line qty (e.g. 2.5) would pass here but can never seed a Sales Order (QTY_INVALID on
// both paths) — a permanent dead-end once WON, since WON is terminal. Require integer qty at the same points.
const posInt = (v: unknown): v is number => finiteNum(v) && v > 0 && Number.isInteger(v);

// A guard that catches the ONE identity mistake that would corrupt the pre-commitment boundary: a line that
// carries a serialized-asset reference. We reject any line that declares a serial explicitly, or whose kind
// is outside the product-level allowlist. `ref` must be a product/model/part/service reference.
function validateLine(line: unknown, index: number): OpportunityLineInput {
  if (!line || typeof line !== "object") {
    throw new OpportunityCommandError("LINE_INVALID", `Line ${index} is not an object`);
  }
  const l = line as Record<string, unknown>;
  if (!(OPPORTUNITY_LINE_KINDS as readonly string[]).includes(l.kind as string)) {
    throw new OpportunityCommandError("LINE_INVALID", `Line ${index} has an invalid kind`);
  }
  if ("serial" in l || "serialNumber" in l || "serializedAssetId" in l || "equipmentId" in l) {
    throw new OpportunityCommandError(
      "SERIALIZED_LINE_FORBIDDEN",
      `Line ${index} references a serialized asset; Opportunity lines are product-level only`
    );
  }
  if (!nonEmpty(l.ref)) {
    throw new OpportunityCommandError("LINE_INVALID", `Line ${index} is missing a product reference`);
  }
  // qty is REQUIRED on every line (not merely validated-if-present): a line without a qty is not persistable.
  // This is the enforcement point that closes the qty-less WON dead-end at its source — a line that can never
  // be created without a valid qty can never reach WON without one either. (See also the WON-outcome guard in
  // buildTransitionPatch below, which defends any opportunity persisted before this rule existed.)
  if (!posInt(l.qty)) {
    throw new OpportunityCommandError("LINE_INVALID", `Line ${index} is missing a valid qty (positive integer)`);
  }
  const out: OpportunityLineInput = { kind: l.kind as OpportunityLineKind, ref: (l.ref as string).trim(), qty: l.qty as number };
  return out;
}

export interface BuiltOpportunity {
  accountId: string;
  ownerEmployeeId: string;
  salesChannel: SalesChannel;
  stage: OpportunityStage;
  outcome: null;
  need: string | null;
  expectedValue: number | null;
  expectedCloseAt: number | null;
  lines: OpportunityLineInput[];
  createdByUid: string;
  createdAtMillis: number;
  updatedAtMillis: number;
}

// Build the persisted fields for a NEW opportunity. Always IDENTIFIED + open. `actorUid`/`nowMillis` come from
// the callable (request.auth.uid, Date.now) so this stays pure.
export function buildCreateOpportunity(
  input: CreateOpportunityInput,
  ctx: { actorUid: string; nowMillis: number }
): BuiltOpportunity {
  if (!input || typeof input !== "object") throw new OpportunityCommandError("INVALID", "Missing input");
  if (!nonEmpty(input.accountId)) throw new OpportunityCommandError("ACCOUNT_REQUIRED", "accountId is required");
  if (!nonEmpty(input.ownerEmployeeId)) {
    throw new OpportunityCommandError("OWNER_REQUIRED", "ownerEmployeeId (canonical Employee) is required");
  }
  if (!isChannel(input.salesChannel)) throw new OpportunityCommandError("CHANNEL_INVALID", "salesChannel is invalid");
  if (input.expectedValue !== undefined && input.expectedValue !== null && !finiteNum(input.expectedValue)) {
    throw new OpportunityCommandError("INVALID", "expectedValue must be a number or null");
  }
  if (input.expectedCloseAt !== undefined && input.expectedCloseAt !== null && !finiteNum(input.expectedCloseAt)) {
    throw new OpportunityCommandError("INVALID", "expectedCloseAt must be an epoch-ms number or null");
  }
  const lines = Array.isArray(input.lines) ? input.lines.map((l, i) => validateLine(l, i)) : [];
  return {
    accountId: input.accountId.trim(),
    ownerEmployeeId: input.ownerEmployeeId.trim(),
    salesChannel: input.salesChannel,
    stage: "IDENTIFIED",
    outcome: null,
    need: nonEmpty(input.need) ? input.need.trim() : null,
    expectedValue: finiteNum(input.expectedValue) ? input.expectedValue : null,
    expectedCloseAt: finiteNum(input.expectedCloseAt) ? input.expectedCloseAt : null,
    lines,
    createdByUid: ctx.actorUid,
    createdAtMillis: ctx.nowMillis,
    updatedAtMillis: ctx.nowMillis,
  };
}

export interface OpportunityDocState {
  stage: OpportunityStage;
  outcome?: OpportunityOutcome | null;
  lines?: OpportunityLineInput[];
}

export interface TransitionPatch {
  stage: OpportunityStage;
  outcome: OpportunityOutcome | null;
  closedAtMillis?: number | null;
  updatedByUid: string;
  updatedAtMillis: number;
}

// Build the field patch for a transition, after validating legality against the ratified graph. Throws an
// OpportunityCommandError (fail-closed) on any illegal transition; the callable maps the code to an HttpsError.
export function buildTransitionPatch(
  current: OpportunityDocState,
  intent: TransitionIntent,
  ctx: { actorUid: string; nowMillis: number }
): TransitionPatch {
  if (!current || !isStage(current.stage)) throw new OpportunityCommandError("INVALID", "Invalid current state");
  if (intent.kind === "OUTCOME" && intent.outcome === "WON") {
    if (!Array.isArray(current.lines) || current.lines.length === 0) {
      throw new OpportunityCommandError("NO_LINES", "Opportunity requires at least one line before it can be WON");
    }
    // Defense in depth for opportunities that were persisted before qty became required at line-creation time
    // (validateLine): WON is terminal/irreversible with no line-edit/reopen path, and downstream
    // createSalesOrderFromOpportunity fails closed forever on a qty-less line, so a qty-less line must never
    // be allowed to reach WON in the first place.
    const badIndex = current.lines.findIndex((l) => !posInt(l?.qty));
    if (badIndex !== -1) {
      throw new OpportunityCommandError(
        "LINE_QTY_REQUIRED_FOR_WON",
        `Opportunity line ${badIndex} is missing a valid qty (positive integer); WON requires every line to carry one`
      );
    }
  }
  const check = checkTransition({ stage: current.stage, outcome: current.outcome ?? null }, intent);
  if (!check.ok) {
    const msg =
      check.code === "ALREADY_CLOSED"
        ? "Opportunity is already closed (WON/LOST)"
        : check.code === "OUTCOME_REQUIRES_DECISION"
          ? "WON can only be set from the DECISION stage"
          : check.code === "ILLEGAL_TRANSITION"
            ? "Only a single forward stage advance is permitted"
            : "Invalid transition";
    throw new OpportunityCommandError(check.code, msg);
  }
  if (intent.kind === "ADVANCE") {
    return { stage: intent.toStage, outcome: null, updatedByUid: ctx.actorUid, updatedAtMillis: ctx.nowMillis };
  }
  // OUTCOME: stage stays at its current value; outcome closes the opportunity.
  return {
    stage: current.stage,
    outcome: intent.outcome,
    closedAtMillis: ctx.nowMillis,
    updatedByUid: ctx.actorUid,
    updatedAtMillis: ctx.nowMillis,
  };
}
