// Sales Order — PURE governed write core (framework-independent; unit-tested). Builds the field maps the
// callable persists; enforces the ratified invariants. No Firestore/firebase-functions imports.
//
// INVARIANTS: product-level lines only (a serialized-asset reference is FORBIDDEN — assigned at fulfillment);
// quantity model orderedQty >= allocatedQty >= fulfilledQty >= 0; canonical refs reused (accountId,
// ownerEmployeeId, salesChannel, locationId?, sourceOpportunityId?); `unitPrice` is an OPTIONAL passive
// pricing SNAPSHOT — this command invents no pricing/discount/tax authority. Created CONFIRMED.

import {
  SALES_ORDER_LINE_KINDS,
  isSalesChannel,
  isSalesOrderState,
  checkTransition,
  allLinesFulfilled,
  type SalesChannel,
  type SalesOrderLineKind,
  type SalesOrderState,
  type SalesOrderTransition,
} from "./salesOrderLifecycle";

export type SalesOrderErrorCode =
  | "INVALID"
  | "ACCOUNT_REQUIRED"
  | "OWNER_REQUIRED"
  | "CHANNEL_INVALID"
  | "NO_LINES"
  | "LINE_INVALID"
  | "SERIALIZED_LINE_FORBIDDEN"
  | "QTY_INVALID"
  | "TERMINAL"
  | "ILLEGAL_TRANSITION"
  | "NOT_FULFILLABLE";

export class SalesOrderCommandError extends Error {
  code: SalesOrderErrorCode;
  constructor(code: SalesOrderErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "SalesOrderCommandError";
  }
}

export interface SalesOrderLineInput {
  kind: SalesOrderLineKind;
  ref: string; // model number / partId / service code — PRODUCT-level, never a serial
  orderedQty: number;
  unitPrice?: number; // optional passive pricing snapshot; NOT computed here
}

export interface CreateSalesOrderInput {
  accountId: string;
  ownerEmployeeId: string;
  salesChannel: SalesChannel;
  locationId?: string;
  sourceOpportunityId?: string;
  customerPO?: string;
  notes?: string;
  lines?: SalesOrderLineInput[];
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const finiteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const posInt = (v: unknown): v is number => finiteNum(v) && v > 0 && Number.isInteger(v);

interface BuiltLine {
  kind: SalesOrderLineKind;
  ref: string;
  orderedQty: number;
  allocatedQty: number;
  fulfilledQty: number;
  billedQty: number;
  unitPrice?: number;
}

// Validate + normalize one line. The ONE identity mistake that corrupts commercial↔physical separation is a
// serialized-asset reference on a line — reject it. Quantities initialize allocated/fulfilled to 0.
function validateLine(line: unknown, index: number): BuiltLine {
  if (!line || typeof line !== "object") throw new SalesOrderCommandError("LINE_INVALID", `Line ${index} is not an object`);
  const l = line as Record<string, unknown>;
  if (!(SALES_ORDER_LINE_KINDS as readonly string[]).includes(l.kind as string)) {
    throw new SalesOrderCommandError("LINE_INVALID", `Line ${index} has an invalid kind`);
  }
  if ("serial" in l || "serialNumber" in l || "serializedAssetId" in l || "equipmentId" in l) {
    throw new SalesOrderCommandError(
      "SERIALIZED_LINE_FORBIDDEN",
      `Line ${index} references a serialized asset; Sales Order lines are product-level (serialized assets are assigned at fulfillment)`
    );
  }
  if (!nonEmpty(l.ref)) throw new SalesOrderCommandError("LINE_INVALID", `Line ${index} is missing a product reference`);
  if (!posInt(l.orderedQty)) throw new SalesOrderCommandError("QTY_INVALID", `Line ${index} orderedQty must be a positive integer`);
  if (l.unitPrice !== undefined && !finiteNum(l.unitPrice)) {
    throw new SalesOrderCommandError("LINE_INVALID", `Line ${index} unitPrice must be a number when present`);
  }
  const out: BuiltLine = {
    kind: l.kind as SalesOrderLineKind,
    ref: (l.ref as string).trim(),
    orderedQty: l.orderedQty as number,
    allocatedQty: 0,
    fulfilledQty: 0,
    billedQty: 0,
  };
  if (l.unitPrice !== undefined) out.unitPrice = l.unitPrice as number;
  return out;
}

export interface BuiltSalesOrder {
  accountId: string;
  ownerEmployeeId: string;
  salesChannel: SalesChannel;
  locationId: string | null;
  sourceOpportunityId: string | null;
  customerPO: string | null;
  notes: string | null;
  state: SalesOrderState;
  lines: BuiltLine[];
  createdByUid: string;
  createdAtMillis: number;
  updatedAtMillis: number;
}

// Build a NEW Sales Order (CONFIRMED = the commercial commitment following a WON Opportunity). Reuses
// canonical refs; never assigns serialized assets. `actorUid`/`nowMillis` come from the callable.
export function buildCreateSalesOrder(input: CreateSalesOrderInput, ctx: { actorUid: string; nowMillis: number }): BuiltSalesOrder {
  if (!input || typeof input !== "object") throw new SalesOrderCommandError("INVALID", "Missing input");
  if (!nonEmpty(input.accountId)) throw new SalesOrderCommandError("ACCOUNT_REQUIRED", "accountId is required");
  if (!nonEmpty(input.ownerEmployeeId)) throw new SalesOrderCommandError("OWNER_REQUIRED", "ownerEmployeeId (canonical Employee) is required");
  if (!isSalesChannel(input.salesChannel)) throw new SalesOrderCommandError("CHANNEL_INVALID", "salesChannel is invalid");
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new SalesOrderCommandError("NO_LINES", "A Sales Order requires at least one line");
  const lines = input.lines.map((l, i) => validateLine(l, i));
  return {
    accountId: input.accountId.trim(),
    ownerEmployeeId: input.ownerEmployeeId.trim(),
    salesChannel: input.salesChannel,
    locationId: nonEmpty(input.locationId) ? input.locationId.trim() : null,
    sourceOpportunityId: nonEmpty(input.sourceOpportunityId) ? input.sourceOpportunityId.trim() : null,
    customerPO: nonEmpty(input.customerPO) ? input.customerPO.trim() : null,
    notes: nonEmpty(input.notes) ? input.notes.trim() : null,
    state: "CONFIRMED",
    lines,
    createdByUid: ctx.actorUid,
    createdAtMillis: ctx.nowMillis,
    updatedAtMillis: ctx.nowMillis,
  };
}

export interface SalesOrderDocState {
  state: SalesOrderState;
  lines?: Array<{ orderedQty: number; fulfilledQty?: number }>;
}

export interface SalesOrderTransitionPatch {
  state: SalesOrderState;
  updatedByUid: string;
  updatedAtMillis: number;
}

// Build the field patch for a lifecycle transition, after validating legality (FULFILLED requires every line
// fully fulfilled). Throws fail-closed on any illegal transition; the callable maps the code to an HttpsError.
export function buildTransitionPatch(
  current: SalesOrderDocState,
  transition: SalesOrderTransition,
  ctx: { actorUid: string; nowMillis: number }
): SalesOrderTransitionPatch {
  if (!current || !isSalesOrderState(current.state)) throw new SalesOrderCommandError("INVALID", "Invalid current state");
  const fulfilledAll = allLinesFulfilled(Array.isArray(current.lines) ? current.lines : []);
  const check = checkTransition(current.state, transition, { allLinesFulfilled: fulfilledAll });
  if (!check.ok) {
    const msg =
      check.code === "TERMINAL"
        ? "Sales Order is closed or cancelled"
        : check.code === "NOT_FULFILLABLE"
          ? "Cannot mark FULFILLED while quantity remains unfulfilled"
          : check.code === "ILLEGAL_TRANSITION"
            ? "Illegal Sales Order transition"
            : "Invalid transition";
    throw new SalesOrderCommandError(check.code, msg);
  }
  return { state: check.to, updatedByUid: ctx.actorUid, updatedAtMillis: ctx.nowMillis };
}
