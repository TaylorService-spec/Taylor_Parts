// PASS 2 FIXTURE CONTRACT — which purchase order status the Certification World must use, and why.
//
// ============================ THE TRAP THIS RECORDS ============================
//
// Two independent allowlists govern a purchase order, and they are NOT the same list:
//
//   RECEIVABLE      APPROVED, SENT                                (receivingSourceResolver.ts)
//   COUNTS INBOUND  DRAFT, SENT, ORDERED, PARTIALLY_RECEIVED      (partBalanceReadService.ts)
//
// Their intersection is exactly one value: SENT.
//
// APPROVED is the obvious choice -- it is first in the receivable list and reads like "a real,
// authorized order". A fixture built on APPROVED would receive perfectly and NEVER produce ON_ORDER,
// because nothing would count it as incoming. The investigation that followed would look for a
// classification bug that does not exist.
//
// That is the same shape as the index collision in Pass 1: every component correct in isolation,
// the whole silently wrong, and no error anywhere.
//
// ============================ WHY SENT SURVIVES THE WHOLE LIFECYCLE ============================
//
// The receipt command moves the stored status to RECEIVED only when every line has zero remaining;
// a partial receipt deliberately leaves it SENT, and there is NO persisted PARTIALLY_RECEIVED
// status -- partial progress is derived from the receipts so it cannot drift from them.
//
// So one status carries the entire Golden lifecycle:
//
//   SENT      -> receivable, and counted as inbound     (part reads ON_ORDER)
//   partial   -> still SENT, still both                 (part still ON_ORDER, outstanding reduced)
//   complete  -> RECEIVED: neither receivable nor inbound (part leaves ON_ORDER)
//
// THE FIXTURE CONTRACT: canonical Certification World purchase orders use status "SENT".
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;
const { OPEN_PURCHASE_ORDER_STATUSES, sumOpenOrderedQuantity } =
  await import(L("functions/lib/inventory/partBalanceReadService.js"));
const { RECEIVABLE_CANONICAL_STATUSES } =
  await import(L("functions/lib/inventoryReceiving/receivingSourceResolver.js"));

test("the two allowlists intersect in exactly one status, and it is SENT", () => {
  // The whole preflight, as one assertion. If either list changes, the fixture contract must be
  // re-derived rather than assumed -- and this is where that gets noticed.
  const both = RECEIVABLE_CANONICAL_STATUSES.filter((s) => OPEN_PURCHASE_ORDER_STATUSES.includes(s));
  assert.deepEqual(both, ["SENT"],
    `receivable=${RECEIVABLE_CANONICAL_STATUSES.join("/")} inbound=${OPEN_PURCHASE_ORDER_STATUSES.join("/")}`);
});

test("APPROVED is receivable but does NOT count as inbound", () => {
  // The specific misstep this file exists to prevent. Not covered by the existing
  // partBalanceReadService suite, which asserts RECEIVED/CANCELLED/CLOSED are excluded and SENT is
  // included -- but says nothing about the status a fixture author would most naturally reach for.
  assert.ok(RECEIVABLE_CANONICAL_STATUSES.includes("APPROVED"), "APPROVED should still be receivable");
  assert.equal(OPEN_PURCHASE_ORDER_STATUSES.includes("APPROVED"), false,
    "APPROVED now counts as inbound -- the Pass 2 fixture contract must be re-derived");
});

test("a qualifying status contributes inbound quantity; a non-qualifying one contributes nothing", () => {
  // Behavioural, not just membership: proves the filter actually changes the number.
  const po = (status) => ({ status, lines: [{ partId: "CW-P-0001", quantity: 10, receivedQuantity: 0 }] });
  const qualifying = [po("SENT")].filter((p) => OPEN_PURCHASE_ORDER_STATUSES.includes(p.status));
  const nonQualifying = [po("APPROVED"), po("RECEIVED"), po("CANCELLED")]
    .filter((p) => OPEN_PURCHASE_ORDER_STATUSES.includes(p.status));

  assert.equal(sumOpenOrderedQuantity(qualifying, "CW-P-0001"), 10, "a SENT order must contribute its outstanding quantity");
  assert.equal(nonQualifying.length, 0, "APPROVED/RECEIVED/CANCELLED must not survive the open-status filter");
  // Filtered to nothing, the answer is UNKNOWN rather than 0: no order mentions the part at all,
  // which is a different fact from "ordered and fully received".
  assert.equal(sumOpenOrderedQuantity(nonQualifying, "CW-P-0001"), null);
});

test("outstanding is ordered MINUS received, and never negative", () => {
  const partial = [{ status: "SENT", lines: [{ partId: "CW-P-0001", quantity: 10, receivedQuantity: 4 }] }];
  assert.equal(sumOpenOrderedQuantity(partial, "CW-P-0001"), 6, "a partial receipt reduces outstanding, it does not clear it");
  const over = [{ status: "SENT", lines: [{ partId: "CW-P-0001", quantity: 5, receivedQuantity: 8 }] }];
  assert.equal(sumOpenOrderedQuantity(over, "CW-P-0001"), 0, "over-receipt must not produce negative inbound");
});

test("fully received is a known ZERO, and unmentioned is UNKNOWN", () => {
  // The distinction that keeps "we have none on order" separate from "we have no idea".
  const received = [{ status: "SENT", lines: [{ partId: "CW-P-0001", quantity: 5, receivedQuantity: 5 }] }];
  assert.equal(sumOpenOrderedQuantity(received, "CW-P-0001"), 0);
  assert.equal(sumOpenOrderedQuantity(received, "CW-P-9999"), null);
});

test("a partial receipt leaves the PO SENT -- there is no persisted PARTIALLY_RECEIVED", () => {
  // Load-bearing for the Golden inbound-recovery lifecycle. If a partial receipt moved the stored
  // status to PARTIALLY_RECEIVED, the PO would fall OUT of RECEIVABLE_CANONICAL_STATUSES and the
  // completion receipt would be refused -- making shortage -> PO -> partial -> complete unreachable
  // on the canonical path.
  const src = readFileSync(path.resolve(REPO, "functions/src/inventoryReceiving/receiveInventoryStockCommand.ts"), "utf8");
  assert.match(src, /if \(fullyReceived\) \{[\s\S]{0,120}poUpdate\.status = RECEIVED/,
    "the stored PO status is no longer gated on full receipt");
  // And PARTIALLY_RECEIVED is never written to a purchase order.
  assert.equal(/poUpdate\.status\s*=\s*["']?PARTIALLY_RECEIVED/.test(src), false,
    "a partial receipt now persists PARTIALLY_RECEIVED -- the completion receipt would be refused");
});

test("PARTIALLY_RECEIVED in the inbound list is defensive, not reachable on a stored PO", () => {
  // Recorded rather than removed: the entry is harmless, but a reader would reasonably assume a PO
  // can carry that status. It cannot -- the value is DERIVED from receipts and never persisted, so
  // this allowlist entry can never match a stored document.
  assert.ok(OPEN_PURCHASE_ORDER_STATUSES.includes("PARTIALLY_RECEIVED"));
  assert.equal(RECEIVABLE_CANONICAL_STATUSES.includes("PARTIALLY_RECEIVED"), false,
    "if a PO could BE PARTIALLY_RECEIVED it would also have to be receivable, or completion would be impossible");
});

test("the Certification World fixture contract names SENT explicitly", () => {
  // The contract has to live somewhere a fixture author will read. A conclusion reached once in an
  // investigation and not written down is a conclusion the next author re-derives, or does not.
  const src = readFileSync(new URL(import.meta.url), "utf8");
  assert.match(src, /canonical Certification World purchase orders use status "SENT"/i,
    "the fixture contract statement has been removed from this file");
});
