// CRM Activity / Notes — PURE governed write core (Taylor EOS Wave 7 extension, PART 1.4). No Firestore /
// firebase-functions imports — framework-independent, unit-tested offline exactly like
// salesOrder/salesOrderCommands.ts. Builds the field map the callable persists; enforces the ratified
// invariants below. No mutation, no I/O.
//
// SCOPE: this record owns the CRM interaction ONLY. It references Account (required) / Contact /
// Opportunity / Sales Order by id — it never duplicates or contradicts their own authoritative fields (no
// customer name, no opportunity stage, no sales order total; those stay resolved from their own canonical
// authority by the reader, exactly like SalesOrderProjection's own "accountId only, no Customer name" rule).
//
// PART 1.5 SEAM (do not build here): a dated follow-up / next-action is a SEPARATE roadmap capability
// (Exception Ownership / Operational Accountability) and is NOT authorized by this PR. This record
// therefore has NO assignee, NO due date, NO completion state, NO status workflow field — full stop. If a
// future change adds one of those fields to this module, that is PART 1.5 (or later), not this one.
import {
  CRM_ACTIVITY_TYPES,
  type CrmActivityType,
} from "./crmActivityTypes";

export { CRM_ACTIVITY_TYPES, type CrmActivityType } from "./crmActivityTypes";

export type CrmActivityErrorCode =
  | "INVALID"
  | "ACCOUNT_REQUIRED"
  | "TYPE_INVALID"
  | "BODY_REQUIRED"
  | "BODY_TOO_LONG"
  | "OCCURRED_AT_INVALID"
  | "OCCURRED_AT_FUTURE";

export class CrmActivityCommandError extends Error {
  code: CrmActivityErrorCode;
  constructor(code: CrmActivityErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "CrmActivityCommandError";
  }
}

// A note body has to stay a note, not a document -- bounded well above any realistic single interaction
// summary while still refusing an unbounded blob (the exact failure mode account.notes has today).
export const MAX_BODY_LENGTH = 4000;

// Clock-skew tolerance for a caller-supplied occurredAt. occurredAt records a REAL past/present
// interaction ("when the interaction happened," possibly backdated) -- it is NOT a scheduled future
// action (that is PART 1.5's, not this record's). A small tolerance absorbs ordinary client/server clock
// drift without opening the field up to "log an activity for next Tuesday."
export const OCCURRED_AT_FUTURE_TOLERANCE_MILLIS = 5 * 60 * 1000;

export interface CreateCrmActivityInput {
  accountId: string;
  contactId?: string;
  opportunityId?: string;
  salesOrderId?: string;
  type: CrmActivityType;
  body: string;
  // Caller-supplied "when the interaction happened." Omitted => defaults to ctx.nowMillis (the common
  // "logging as it happens" case). When present, it may be in the past (a backdated log entry) but not
  // materially in the future.
  occurredAtMillis?: number;
}

// The built, ready-to-persist record. occurredAt vs createdAt are DELIBERATELY two distinct fields with
// distinct semantics, never conflated or derived from one another:
//   occurredAtMillis -- WHEN THE INTERACTION HAPPENED. Caller-supplied (business fact), possibly
//                        backdated. This is the fact a CRM timeline sorts and displays by.
//   createdAtMillis  -- WHEN THE SERVER RECORDED IT. Always ctx.nowMillis (the trusted server clock,
//                        never caller-supplied) -- this is provenance/audit fact, not a business fact.
// A same-moment log entry has occurredAtMillis === createdAtMillis; a backdated one does not, and the
// record honestly preserves both rather than collapsing to a single ambiguous timestamp.
export interface BuiltCrmActivity {
  accountId: string;
  contactId: string | null;
  opportunityId: string | null;
  salesOrderId: string | null;
  type: CrmActivityType;
  body: string;
  occurredAtMillis: number;
  createdByUid: string;
  createdAtMillis: number;
}

const nonEmptyStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

// Build a NEW CRM Activity. `actorUid`/`nowMillis` come from the callable (server-derived, never
// client-supplied) -- mirrors buildCreateSalesOrder's own ctx contract exactly.
export function buildCreateCrmActivity(
  input: CreateCrmActivityInput,
  ctx: { actorUid: string; nowMillis: number },
): BuiltCrmActivity {
  if (!input || typeof input !== "object") throw new CrmActivityCommandError("INVALID", "Missing input");
  if (!nonEmptyStr(input.accountId)) throw new CrmActivityCommandError("ACCOUNT_REQUIRED", "accountId is required");
  if (!(CRM_ACTIVITY_TYPES as readonly string[]).includes(input.type)) {
    throw new CrmActivityCommandError("TYPE_INVALID", `type must be one of ${CRM_ACTIVITY_TYPES.join("/")}`);
  }
  if (!nonEmptyStr(input.body)) throw new CrmActivityCommandError("BODY_REQUIRED", "body is required");
  const body = input.body.trim();
  if (body.length > MAX_BODY_LENGTH) {
    throw new CrmActivityCommandError("BODY_TOO_LONG", `body must not exceed ${MAX_BODY_LENGTH} characters`);
  }

  let occurredAtMillis = ctx.nowMillis;
  if (input.occurredAtMillis !== undefined) {
    if (typeof input.occurredAtMillis !== "number" || !Number.isFinite(input.occurredAtMillis)) {
      throw new CrmActivityCommandError("OCCURRED_AT_INVALID", "occurredAtMillis must be a finite number when present");
    }
    if (input.occurredAtMillis > ctx.nowMillis + OCCURRED_AT_FUTURE_TOLERANCE_MILLIS) {
      throw new CrmActivityCommandError("OCCURRED_AT_FUTURE", "occurredAtMillis cannot be materially in the future");
    }
    occurredAtMillis = input.occurredAtMillis;
  }

  return {
    accountId: input.accountId.trim(),
    contactId: nonEmptyStr(input.contactId) ? input.contactId.trim() : null,
    opportunityId: nonEmptyStr(input.opportunityId) ? input.opportunityId.trim() : null,
    salesOrderId: nonEmptyStr(input.salesOrderId) ? input.salesOrderId.trim() : null,
    type: input.type,
    body,
    occurredAtMillis,
    createdByUid: ctx.actorUid,
    createdAtMillis: ctx.nowMillis,
  };
}
