import { HttpsError } from "firebase-functions/v2/https";
import {
  deriveSalesOrderLinesFromAgreement,
  SalesAgreementCommandError,
  type BuiltAgreementLine,
} from "./salesAgreementCommands.js";
import type { SalesAgreementState } from "./salesAgreementLifecycle.js";

// THE ACCEPTED COMMITMENT BECOMES AN OPERATIONAL ORDER.
//
// GOVERNANCE: Owner Slice 4 D2.
//
// ════════════════════ WHAT THIS REPLACES ════════════════════
//
// `deriveSalesOrderLines` mapped Opportunity `{ kind, ref, qty }` straight through with NO PRICE,
// because an Opportunity has none — it carries `expectedValue`, one forecast number on the header.
// That shortcut is where the seven unpriced CONFIRMED Sales Orders came from, and it is why an
// order could be confirmed and then refused by invoicing.
//
// Prices come from the Agreement now, because the Agreement is where they were committed.
//
// ════════════════════ FAIL CLOSED, WITH NAMED REASONS ════════════════════
//
// There is NO fallback to Opportunity lines, and none to `expectedValue`. An Opportunity with no
// accepted Agreement cannot produce a Sales Order at all — which is the point of putting the
// Agreement in the middle. Every refusal names which precondition failed, because "cannot create
// order" sends somebody to the wrong place.
//
// ════════════════════ PURE ════════════════════
//
// No Firestore, no clock. The caller reads the documents inside its own transaction and hands the
// facts here, so the preconditions are assertable offline and are written down once.

export interface AgreementFactsForConversion {
  exists: boolean;
  state?: SalesAgreementState;
  accountId?: string | null;
  sourceOpportunityId?: string | null;
  locationId?: string | null;
  ownerEmployeeId?: string | null;
  customerPO?: string | null;
  specialInstructions?: string | null;
  lines?: BuiltAgreementLine[];
  /** Set once, when the Sales Order is created. Its presence means one already exists. */
  salesOrderId?: string | null;
}

/**
 * Every precondition, in the order that produces the most useful refusal.
 *
 * EXISTENCE, then OWNERSHIP, then STATE. A caller pointed at the wrong agreement should be told
 * that, not told it is unaccepted — the second sends them to chase a signature on a document that
 * was never theirs.
 */
export function assertAgreementConvertible(
  agreement: AgreementFactsForConversion,
  opportunity: { id: string; accountId: string },
): void {
  if (!agreement.exists) {
    throw new HttpsError(
      "failed-precondition",
      "This opportunity has no sales agreement. A Sales Order is created from an accepted agreement, " +
        "which is where committed prices are recorded — an opportunity carries a forecast, not prices.",
    );
  }
  if (agreement.sourceOpportunityId !== opportunity.id) {
    throw new HttpsError(
      "failed-precondition",
      "That sales agreement belongs to a different opportunity.",
    );
  }
  // ACCOUNT IS STRICT, and is checked against the OPPORTUNITY's account rather than the caller's
  // claim — the same reason the Work Order equipment check reads the stored record.
  if (agreement.accountId !== opportunity.accountId) {
    throw new HttpsError(
      "failed-precondition",
      "The sales agreement belongs to a different customer than the opportunity.",
    );
  }
  if (agreement.state !== "ACCEPTED") {
    throw new HttpsError(
      "failed-precondition",
      `The sales agreement is ${agreement.state ?? "in an unknown state"} and has not been accepted. ` +
        "Only accepted commercial terms can produce a Sales Order.",
    );
  }
  if (!Array.isArray(agreement.lines) || agreement.lines.length === 0) {
    throw new HttpsError("failed-precondition", "The sales agreement has no lines.");
  }
}

/**
 * The Sales Order line inputs an accepted Agreement produces.
 *
 * Delegates to the Agreement's own derivation so there is ONE place that turns committed prices
 * into order lines — a second mapping is how a price comes to be re-decided in transit.
 */
export function salesOrderLinesFromAgreement(agreement: Pick<AgreementFactsForConversion, "state" | "lines">) {
  try {
    return deriveSalesOrderLinesFromAgreement({
      state: agreement.state as SalesAgreementState,
      lines: agreement.lines ?? [],
    });
  } catch (err) {
    if (err instanceof SalesAgreementCommandError) {
      throw new HttpsError("failed-precondition", err.message);
    }
    throw err;
  }
}

/**
 * WHICH AGREEMENT FACTS TRAVEL TO THE SALES ORDER, AND WHICH DO NOT.
 *
 * The rule is operational need, not completeness. A Sales Order that copied every agreement field
 * would become a second commercial record, and the two would drift the moment either was amended.
 *
 * COPIED — operational fulfillment genuinely needs a stable value:
 *
 *   accountId          who the order is for
 *   locationId         where it goes; fulfillment cannot ask the Agreement at pick time
 *   customerPO         appears on the pick ticket and the invoice
 *   line ref/qty/price the order IS these
 *
 * NOT COPIED — reachable through `sourceAgreementId`, and commercial rather than operational:
 *
 *   isLease              a financing arrangement; changes nothing a warehouse does
 *   shippingInstructions ) genuinely operational, and deliberately NOT snapshotted YET: there is no
 *   shipVia              ) shipment object to carry them (audit gap 5 — fulfillment has no pick or
 *   fulfillmentIntent    ) shipment authority). Copying them onto the order now would put warehouse
 *                        ) instructions on a document that cannot act on them, and would have to be
 *                        ) moved again when Slice 5 lands. Reachable via the Agreement meanwhile.
 *   warranty             a commitment to the customer, settled at sale, read from the Agreement
 *   estimatedArrival     what the customer was told; the order's own dates come from fulfillment
 *   condition            a commercial descriptor of what was sold
 *   totals               the Agreement's arithmetic. The order's money is its lines; a copied total
 *                        would be a second answer to the same question.
 *
 * `specialInstructions` maps to the order's `notes` because that field already exists and is what a
 * person reads before acting on the order — the one commercial note with an operational consumer.
 */
export function salesOrderFieldsFromAgreement(
  agreement: Pick<AgreementFactsForConversion, "locationId" | "customerPO" | "specialInstructions">,
) {
  return {
    locationId: agreement.locationId ?? undefined,
    customerPO: agreement.customerPO ?? undefined,
    notes: agreement.specialInstructions ?? undefined,
  };
}
