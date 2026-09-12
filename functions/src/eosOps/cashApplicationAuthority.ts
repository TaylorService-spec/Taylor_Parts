// eos_ops domain vocabulary — the AR CASH-APPLICATION authority (migration 008).
//
// ════════════════════ WHAT THIS MODULE IS FOR ════════════════════
//
// Migration 008 makes a receipt's applied and unapplied balances DERIVED rather than stored, and
// enforces `SUM(applications) <= receipt amount` in the database. A caller that has to wait for a
// constraint violation to learn it is over-applying gets a correct answer badly; this module is the
// same arithmetic and the same refusals, stated once, in TypeScript, so a command can fail closed
// before it opens a transaction.
//
// It is the SAME rule, not a second one. The database remains the enforcement of record --
// everything here is checkable ahead of it, and nothing here is trusted in its place. That
// direction matters: `functions/src/finance/paymentCommands.ts` is the equivalent layer for the
// Firestore representation, and it is the ONLY enforcement there, because Firestore has no way to
// express a cross-document sum.
//
// ════════════════════ NOTHING HERE IS A STORED AGGREGATE ════════════════════
//
// `deriveAppliedMinor` / `deriveUnappliedMinor` take the application facts and return a number.
// There is no setter, no cache, no record type with an `appliedMinor` field. A caller that wants to
// persist the result has misunderstood the migration it belongs to -- the whole point of 008 is
// that the number has nowhere to be stored and therefore nowhere to go stale.
//
// ════════════════════ WHAT IT REFUSES TO DECIDE ════════════════════
//
// It does not decide which operating companies exist (see operatingCompanyCustody.ts), which
// currencies are transactable, or whether an invoice id names a real invoice -- the Invoice
// authority is not in this schema. It validates SHAPE, never MEMBERSHIP, and it never derives an
// operating company from a warehouse, a truck, an employee or a homeWarehouseId.
//
// Pure: no pg, no Firestore, no clock, no identity. Integer minor units only, never a float.

import { type OperatingCompanyKey, requireOperatingCompanyKey } from "./operatingCompanyCustody.js";

export type { OperatingCompanyKey };
export { requireOperatingCompanyKey };

/**
 * An opaque, tenant-scoped key for a record whose authority lives outside this schema -- an
 * `invoice_id` or an `account_id`. A non-empty string is all this layer asserts, for the same
 * reason `OperatingCompanyKey` is opaque: a union type here would be a second declaration of a set
 * somebody else owns.
 */
export type GovernedKey = string;

export class CashApplicationAuthorityError extends Error {
  readonly code: CashApplicationErrorCode;
  constructor(code: CashApplicationErrorCode, message: string) {
    super(message);
    this.name = "CashApplicationAuthorityError";
    this.code = code;
  }
}

export type CashApplicationErrorCode =
  /** A governed key (invoice/account/company) was absent. Never defaulted, never inferred. */
  | "KEY_REQUIRED"
  /** An amount was not a positive integer count of minor units. */
  | "AMOUNT_INVALID"
  /** An application claimed a currency its receipt does not hold. */
  | "CURRENCY_MISMATCH"
  /** An application was offered against a different receipt than the one being reasoned about. */
  | "FOREIGN_APPLICATION"
  /** The applications of one receipt would exceed the cash that receipt actually received. */
  | "OVER_APPLICATION";

const isMinorUnits = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);

/** A governed key from another authority. Shape only: a non-empty string, or a refusal. */
export function requireGovernedKey(value: unknown, field: string): GovernedKey {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CashApplicationAuthorityError(
      "KEY_REQUIRED",
      `${field} is required and is never defaulted, inferred or manufactured`,
    );
  }
  return value;
}

/**
 * A positive integer count of minor units.
 *
 * Zero is refused as well as negative: a zero-amount receipt records no cash and a zero-amount
 * application allocates none, so both are rows that assert an event which did not happen. Matches
 * `payment_amount_positive` / `payment_application_amount_positive` in migration 008.
 */
export function requirePositiveMinorUnits(value: unknown, field: string): number {
  if (!isMinorUnits(value) || value <= 0) {
    throw new CashApplicationAuthorityError(
      "AMOUNT_INVALID",
      `${field} must be a positive integer number of minor units (never a float, never zero)`,
    );
  }
  return value;
}

/** One row of `eos_ops.payments` — a cash receipt. It carries NO applied or unapplied balance. */
export interface CashReceipt {
  readonly id: string;
  readonly tenantId: string;
  readonly operatingCompanyKey: OperatingCompanyKey;
  readonly accountId: GovernedKey;
  readonly currency: string;
  readonly amountMinor: number;
}

/** One row of `eos_ops.payment_applications` — how some of one receipt was allocated. */
export interface PaymentApplication {
  readonly id: string;
  readonly tenantId: string;
  readonly paymentId: string;
  readonly invoiceId: GovernedKey;
  readonly currency: string;
  readonly appliedAmountMinor: number;
}

/**
 * A receipt's position, computed from facts.
 *
 * The shape of `eos_ops.payment_balances`, and the reason that view is a view. Nothing produces
 * this object and stores it.
 */
export interface ReceiptBalance {
  readonly paymentId: string;
  readonly amountMinor: number;
  readonly appliedMinor: number;
  readonly unappliedMinor: number;
  readonly applicationCount: number;
}

function assertOwnApplications(receipt: CashReceipt, applications: readonly PaymentApplication[]): void {
  for (const a of applications) {
    if (a?.paymentId !== receipt.id || a?.tenantId !== receipt.tenantId) {
      throw new CashApplicationAuthorityError(
        "FOREIGN_APPLICATION",
        `application ${a?.id ?? "(unidentified)"} belongs to payment ${a?.paymentId} and cannot describe payment ${receipt.id}`,
      );
    }
    requirePositiveMinorUnits(a.appliedAmountMinor, "appliedAmountMinor");
  }
}

/** The sum of application facts. The ONLY definition of "how much of this receipt is applied". */
export function deriveAppliedMinor(applications: readonly PaymentApplication[]): number {
  let total = 0;
  for (const a of applications ?? []) {
    total += requirePositiveMinorUnits(a?.appliedAmountMinor, "appliedAmountMinor");
  }
  return total;
}

/**
 * The receipt's full position.
 *
 * `unappliedMinor` may legitimately be positive -- that is cash on account, not an error. It can
 * never be negative here, because `assertApplicationFits` refuses the write that would make it so
 * and the database refuses it again.
 */
export function deriveReceiptBalance(
  receipt: CashReceipt,
  applications: readonly PaymentApplication[],
): ReceiptBalance {
  requirePositiveMinorUnits(receipt?.amountMinor, "amountMinor");
  assertOwnApplications(receipt, applications ?? []);
  const appliedMinor = deriveAppliedMinor(applications ?? []);
  return Object.freeze({
    paymentId: receipt.id,
    amountMinor: receipt.amountMinor,
    appliedMinor,
    unappliedMinor: receipt.amountMinor - appliedMinor,
    applicationCount: (applications ?? []).length,
  });
}

/** Convenience over `deriveReceiptBalance` for the one number most callers want. */
export function deriveUnappliedMinor(
  receipt: CashReceipt,
  applications: readonly PaymentApplication[],
): number {
  return deriveReceiptBalance(receipt, applications).unappliedMinor;
}

/**
 * Refuse an application that a receipt cannot fund, or that claims a currency the receipt does not
 * hold — the fail-closed mirror of migration 008's `assert_application_within_receipt` trigger and
 * `payment_application_matches_receipt` foreign key.
 *
 * The currency check is first on purpose: an amount comparison between two currencies is not a
 * smaller error than an over-application, it is a meaningless one.
 */
export function assertApplicationFits(
  receipt: CashReceipt,
  existingApplications: readonly PaymentApplication[],
  candidate: { readonly currency: string; readonly appliedAmountMinor: number; readonly invoiceId: unknown },
): void {
  requireGovernedKey(candidate?.invoiceId, "invoiceId");
  const amount = requirePositiveMinorUnits(candidate?.appliedAmountMinor, "appliedAmountMinor");
  if (candidate.currency !== receipt.currency) {
    throw new CashApplicationAuthorityError(
      "CURRENCY_MISMATCH",
      `application currency ${candidate.currency} does not match receipt currency ${receipt.currency}`,
    );
  }
  const unapplied = deriveUnappliedMinor(receipt, existingApplications ?? []);
  if (amount > unapplied) {
    throw new CashApplicationAuthorityError(
      "OVER_APPLICATION",
      `applying ${amount} exceeds the ${unapplied} still unapplied on payment ${receipt.id}`,
    );
  }
}
