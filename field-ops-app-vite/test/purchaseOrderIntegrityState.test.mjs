import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { PURCHASE_ORDER_VIEW_STATUS } from "../src/domain/purchaseOrdersView.js";

const src = fs.readFileSync(new URL("../src/modules/purchasing/PurchaseOrders.jsx", import.meta.url), "utf8");

test("ORPHAN remains a first-class view status, not folded into a workflow state", () => {
  assert.ok(PURCHASE_ORDER_VIEW_STATUS.ORPHAN, "ORPHAN must exist");
  for (const s of ["OPEN", "RECEIVED", "VOIDED"]) {
    assert.notEqual(PURCHASE_ORDER_VIEW_STATUS.ORPHAN, PURCHASE_ORDER_VIEW_STATUS[s]);
  }
});

test("an ORPHAN row states why its fields are blank", () => {
  assert.match(src, /row\.viewStatus === PURCHASE_ORDER_VIEW_STATUS\.ORPHAN &&/, "the note must be ORPHAN-only");
  assert.match(src, /could not be read/i, "must say the PO record could not be read");
  assert.match(src, /unknown, not empty/i, "must distinguish unknown from empty");
});

test("the note is scoped to the exception — ordinary rows are untouched", () => {
  const noteCount = (src.match(/fo-po-integrity/g) ?? []).length;
  assert.equal(noteCount, 1, "exactly one integrity note, rendered only for ORPHAN");
});

test("the missing record is not invented and the request is not hidden", () => {
  // Guards the boundary this correction must not cross: no fabricated supplier/PO/qty/dates,
  // and no filtering that would drop the exception out of view.
  assert.doesNotMatch(src, /supplierName\s*[?]{2}\s*["'][A-Za-z]/, "must not substitute a fake supplier");
  assert.doesNotMatch(src, /externalPoNumber\s*[?]{2}\s*["'][A-Za-z]/, "must not substitute a fake PO number");
  assert.match(src, /viewStatus: PURCHASE_ORDER_VIEW_STATUS\.ORPHAN/, "ORPHAN must keep its own filter");
});

test("the exception's MEANING is not redefined here", () => {
  // What an orphan means for purchasing is a routed Product question. This surface may
  // describe the data condition; it must not assert a remedy or a next action.
  assert.doesNotMatch(src, /fo-po-integrity[\s\S]{0,400}?(Re-?order|Resubmit|Escalate|Contact supplier)/i);
});
