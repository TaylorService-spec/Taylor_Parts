// Sales Opportunity — PURE governed write core (framework-independent; unit-tested). Builds the field maps
// the callable persists; enforces the ratified business rules. No Firestore/firebase-functions imports, so
// the rules are testable in isolation and the callable layer only supplies I/O + auth.
//
// INVARIANTS (fail-closed): Opportunity is PRE-COMMITMENT. Solution lines are PRODUCT-level (EQUIPMENT_MODEL/
// PART/SERVICE) — a serialized Equipment asset is NEVER a line (assigned downstream of WON -> Sales Order ->
// fulfillment). owner is a canonical Employee ref (ownerEmployeeId), not free text or a UID. Creation always
// starts at IDENTIFIED, open (no outcome). Transitions are validated by checkTransition().

import { resolveCreationOwner, type CreationOwnerResolution } from "../ownership/creationOwnerResolution";
import type { OwnerDerivation } from "../ownership/typedOwner";
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
  | "LINE_QTY_REQUIRED_FOR_WON"
  // Ordinary-edit codes. VERSION_CONFLICT is separate from INVALID on purpose: one means
  // "your input is wrong", the other means "your input was right when you loaded it and
  // someone else has since changed the record" -- different facts needing different UI.
  | "VERSION_CONFLICT"
  | "CLOSED"
  | "NO_CHANGES";

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
  // EOS Ownership Model v1, ruling D-4 (2026-08-30): relaxed from required to OPTIONAL, additively.
  // An existing caller that supplies a real id reaches exactly the code it always did. Omitting it
  // now inherits the Customer (Account) owner via `inheritedOwner` below instead of failing, and
  // when neither resolves the create still REFUSES -- ownership is never assigned to the caller.
  ownerEmployeeId?: string;
  // The governed upstream owner, derived by the CALLER from the Account it already read inside its
  // own transaction (ownership/typedOwner.ts deriveAccountOwner). Passed in rather than read here
  // so this builder stays pure, and read transactionally so the inherited owner cannot drift
  // between the read and the write.
  inheritedOwner?: OwnerDerivation | null;
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
  // Ruling D-4. The OWNER_REQUIRED error code is preserved on the refusal path -- a caller that
  // supplies nothing and has nothing to inherit still fails with the same code it always did, so
  // existing error handling keeps working; only the message gained the reason.
  let resolvedOwner: CreationOwnerResolution;
  try {
    resolvedOwner = resolveCreationOwner(input.ownerEmployeeId, input.inheritedOwner, "the Account");
  } catch (e) {
    throw new OpportunityCommandError("OWNER_REQUIRED", (e as Error).message);
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
    ownerEmployeeId: resolvedOwner.ownerEmployeeId,
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

// ============================ ORDINARY EDIT ============================
//
// Editing an Opportunity's ORDINARY fields -- the ones that describe the deal, not its
// position in the lifecycle. Before this existed, the workspace's Edit controls were
// disabled with "the governed save command is not wired in this build", which was accurate:
// createOpportunity and transitionOpportunity were the only write paths, so an Opportunity
// could be created and advanced but never corrected.
//
// LIFECYCLE IS NOT AN ORDINARY FIELD. `stage` and `outcome` are absent from the editable
// set by construction -- not filtered out at the end, not validated against, simply never
// read from the input. An ordinary edit cannot move an Opportunity through its lifecycle by
// any input, malformed or otherwise, because there is no code path from input to those
// fields. buildTransitionPatch remains the only way either changes.
//
// NOT A PATCH OF WHATEVER WAS SENT. Every editable field is named here and read individually.
// A caller cannot introduce a field by sending it: an unknown key is ignored rather than
// written, so the persisted shape is decided by this file and never by the request.
//
// ABSENT vs NULL are different. An absent key means "leave this alone"; an explicit null on a
// nullable field means "clear it". Collapsing them would make it impossible to clear a value
// without also being unable to leave one untouched.
export interface UpdateOpportunityInput {
  opportunityId: string;
  /** Optimistic concurrency: the updatedAtMillis the caller loaded. */
  expectedUpdatedAtMillis: number;
  accountId?: string;
  ownerEmployeeId?: string;
  salesChannel?: SalesChannel;
  need?: string | null;
  expectedValue?: number | null;
  expectedCloseAt?: number | null;
  nextAction?: string | null;
  /** Whole-array replacement. See the note on line editing below. */
  lines?: OpportunityLineInput[];
}

/** One field's before/after, for the audit event. */
export interface OpportunityFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface UpdateOpportunityPatch {
  patch: Record<string, unknown>;
  changes: OpportunityFieldChange[];
}

/** The ordinary-editable fields. Lifecycle fields are deliberately absent. */
export const EDITABLE_OPPORTUNITY_FIELDS = Object.freeze([
  "accountId",
  "ownerEmployeeId",
  "salesChannel",
  "need",
  "expectedValue",
  "expectedCloseAt",
  // nextAction was PROJECTED AND DISPLAYED but writable by nothing. The workspace's field
  // model classifies it USER_MAINTAINED and renders it as an editable section, so the surface
  // offered an edit the system could not accept -- the field could be read forever and never
  // corrected. It is an ordinary free-text field on the deal, not a lifecycle position, so it
  // belongs in exactly this set and nowhere else.
  "nextAction",
  "lines",
]);

// Build the field patch for an ordinary edit. Pure: no Firestore, no clock, no identity --
// `actorUid`/`nowMillis` are supplied by the callable, exactly as the other two cores do.
//
// LINES ARE REPLACED WHOLE, not patched element-wise. Add/edit/remove all arrive as the new
// array. That is the honest shape for an ARRAY FIELD ON THE DOCUMENT (which is where lines
// live -- there is no line subcollection): a per-line command would have to re-read, splice
// and write the same array anyway, while inviting the belief that two concurrent line edits
// merge. They do not. Whole-array replacement under the version check makes the conflict
// visible instead of silently losing one of them.
export function buildUpdateOpportunity(
  current: OpportunityDocState & { updatedAtMillis?: number | null },
  input: UpdateOpportunityInput,
  ctx: { actorUid: string; nowMillis: number }
): UpdateOpportunityPatch {
  if (!input || typeof input !== "object") throw new OpportunityCommandError("INVALID", "Missing input");
  if (!nonEmpty(input.opportunityId)) throw new OpportunityCommandError("INVALID", "opportunityId is required");
  if (!current || !isStage(current.stage)) throw new OpportunityCommandError("INVALID", "Invalid current state");

  // A closed Opportunity is a historical record. WON and LOST are terminal, and editing the
  // deal terms of a WON Opportunity would silently disagree with the Sales Order already
  // derived from them.
  if (current.outcome === "WON" || current.outcome === "LOST") {
    throw new OpportunityCommandError("CLOSED", `Opportunity is ${current.outcome} and cannot be edited`);
  }

  // OPTIMISTIC CONCURRENCY. Compared before anything is built, so a stale writer is rejected
  // rather than validated and then rejected -- and so the error a caller sees is the real one.
  if (!finiteNum(input.expectedUpdatedAtMillis)) {
    throw new OpportunityCommandError("INVALID", "expectedUpdatedAtMillis is required");
  }
  const currentVersion = finiteNum(current.updatedAtMillis) ? current.updatedAtMillis : 0;
  if (currentVersion !== input.expectedUpdatedAtMillis) {
    throw new OpportunityCommandError(
      "VERSION_CONFLICT",
      "This Opportunity changed since it was loaded. Reload and reapply your edit."
    );
  }

  const patch: Record<string, unknown> = {};
  const changes: OpportunityFieldChange[] = [];
  const record = (field: string, before: unknown, after: unknown) => {
    patch[field] = after;
    changes.push({ field, before: before ?? null, after: after ?? null });
  };
  const cur = current as unknown as Record<string, unknown>;

  if (input.accountId !== undefined) {
    if (!nonEmpty(input.accountId)) throw new OpportunityCommandError("ACCOUNT_REQUIRED", "accountId cannot be empty");
    if (input.accountId !== cur.accountId) record("accountId", cur.accountId, input.accountId);
  }
  if (input.ownerEmployeeId !== undefined) {
    if (!nonEmpty(input.ownerEmployeeId)) {
      throw new OpportunityCommandError("OWNER_REQUIRED", "ownerEmployeeId cannot be empty");
    }
    if (input.ownerEmployeeId !== cur.ownerEmployeeId) {
      record("ownerEmployeeId", cur.ownerEmployeeId, input.ownerEmployeeId);
    }
  }
  if (input.salesChannel !== undefined) {
    if (!isChannel(input.salesChannel)) {
      throw new OpportunityCommandError("CHANNEL_INVALID", "salesChannel is not a recognized channel");
    }
    if (input.salesChannel !== cur.salesChannel) record("salesChannel", cur.salesChannel, input.salesChannel);
  }
  if (input.need !== undefined) {
    const next = nonEmpty(input.need) ? input.need : null;
    if (next !== (cur.need ?? null)) record("need", cur.need ?? null, next);
  }
  if (input.expectedValue !== undefined) {
    const next = input.expectedValue === null ? null : input.expectedValue;
    if (next !== null && !finiteNum(next)) {
      throw new OpportunityCommandError("INVALID", "expectedValue must be a number or null");
    }
    if (next !== (cur.expectedValue ?? null)) record("expectedValue", cur.expectedValue ?? null, next);
  }
  if (input.expectedCloseAt !== undefined) {
    const next = input.expectedCloseAt === null ? null : input.expectedCloseAt;
    if (next !== null && !finiteNum(next)) {
      throw new OpportunityCommandError("INVALID", "expectedCloseAt must be a number or null");
    }
    if (next !== (cur.expectedCloseAt ?? null)) record("expectedCloseAt", cur.expectedCloseAt ?? null, next);
  }
  if (input.nextAction !== undefined) {
    // Same absent/null/blank handling as `need`: blank clears rather than storing "".
    const next = nonEmpty(input.nextAction) ? input.nextAction : null;
    if (next !== null && typeof next !== "string") {
      throw new OpportunityCommandError("INVALID", "nextAction must be a string or null");
    }
    if (next !== (cur.nextAction ?? null)) record("nextAction", cur.nextAction ?? null, next);
  }
  if (input.lines !== undefined) {
    if (!Array.isArray(input.lines)) throw new OpportunityCommandError("LINE_INVALID", "lines must be an array");
    // Reuses validateLine -- the SAME product-level guard creation uses. A serialized-asset
    // reference is rejected on edit exactly as it is on create; there is no second, looser
    // path into the lines array.
    const nextLines = input.lines.map((l, i) => validateLine(l, i));
    record("lines", cur.lines ?? [], nextLines);
  }

  if (changes.length === 0) {
    throw new OpportunityCommandError("NO_CHANGES", "No editable field changed");
  }

  patch.updatedByUid = ctx.actorUid;
  patch.updatedAtMillis = ctx.nowMillis;
  return { patch, changes };
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
