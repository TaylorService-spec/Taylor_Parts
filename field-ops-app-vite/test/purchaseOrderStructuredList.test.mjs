// PURCHASE ORDER STRUCTURED LIST + DOLLARS — the first post-pilot migration.
// Run: node --test test/purchaseOrderStructuredList.test.mjs   (also `npm test`)
//
// The Purchase Order is the first list in this platform with real money on it, so most of what
// follows is about the ways a money column lies: sorting formatted strings, turning unknown into
// zero, and claiming a total includes things it does not.
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PURCHASE_ORDER_FIELDS, PURCHASE_ORDER_OBJECT, PO_STATUS_ORDER, PO_STATUS_LABEL,
  PO_RECEIPT_STATE_LABEL, PO_FIELD_GAPS, PO_TOTAL_UNIT_CONVENTION, PO_DEFAULT_SORT,
} from "../src/domain/purchaseOrderFields.js";
import {
  FIELD_CATEGORY, FIELD_TYPE, OPERATOR, UNSUPPORTED_REASON,
  visibleFields, filterableFields, sortableFields, groupFieldsByOwner, sortOptionsFor,
} from "../src/domain/fieldMetadata.js";
import { currencyField, quantityField, statusField, FIELD_KIND, ABSENCE } from "../src/domain/structuredFields.js";
import {
  emptyListState, makeFilter, addFilter, setSort, toQueryPlan, toSearchParams, fromSearchParams,
} from "../src/domain/listQueryState.js";
import { SALES_ORDER_DOLLARS_GAP } from "../src/domain/objectFields.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (rel) => readFileSync(path.resolve(root, rel), "utf8");
const byId = (id) => PURCHASE_ORDER_FIELDS.find((f) => f.id === id);

// =====================================================================================
// 1 — DOLLARS AUTHORITY
// =====================================================================================

describe("Dollars is real, and its authority is traceable", () => {
  test("the field is DISPLAYABLE — unlike the Sales Order equivalent", () => {
    const dollars = byId("dollars");
    assert.equal(dollars.displayable, true);
    assert.equal(dollars.category, FIELD_CATEGORY.FINANCIAL);
    assert.equal(dollars.type, FIELD_TYPE.CURRENCY);
  });

  test("THE ASYMMETRY WITH SALES ORDERS IS EXPLAINABLE, not an oversight", () => {
    // PO: unitPrice REQUIRED, total computed and STORED at write, validated.
    // SO: unitPrice OPTIONAL, "NOT computed", stripped from the projection, no total anywhere.
    assert.equal(byId("dollars").displayable, true);
    assert.match(SALES_ORDER_DOLLARS_GAP.finding, /No authoritative Sales Order total/);
    // And the PO field names its source, so a reader can go and check.
    assert.match(byId("dollars").source, /totalCost/);
    assert.match(byId("dollars").source, /stored at write/);
  });

  test("its SEMANTICS are stated — what is in, and what is out", () => {
    const d = byId("dollars").description;
    assert.match(d, /Ordered commitment/i);
    assert.match(d, /Excludes freight, tax, fees and discounts/i);
    // Receiving does not change what was committed.
    assert.match(d, /Unaffected by receiving/i);
  });

  test("it is right-aligned, sortable and filterable by comparison operators", () => {
    const d = byId("dollars");
    assert.equal(d.align, "right");
    assert.equal(d.sortable, true);
    assert.deepEqual([...d.operators], [OPERATOR.IS, OPERATOR.GREATER_THAN, OPERATOR.LESS_THAN, OPERATOR.BETWEEN]);
    // No text operators on money -- "contains 500" is not a question about an amount.
    assert.ok(!d.operators.includes(OPERATOR.CONTAINS));
  });

  test("THE UNIT CONVENTION IS RECORDED AS AN INFERENCE, not asserted as settled", () => {
    // `totalCost` is a plain number and the type declares no unit. A 100x formatting error on a
    // purchasing total is severe, so the evidence and the residual risk are both written down.
    assert.equal(PO_TOTAL_UNIT_CONVENTION.assumed, "MAJOR_UNITS");
    assert.equal(PO_TOTAL_UNIT_CONVENTION.declared, false);
    assert.ok(PO_TOTAL_UNIT_CONVENTION.evidence.length >= 3);
    assert.match(PO_TOTAL_UNIT_CONVENTION.risk, /100x/i);
    assert.match(PO_TOTAL_UNIT_CONVENTION.resolution, /Financial Architecture/i);
  });

  test("NO CLIENT-SIDE TOTAL IS COMPUTED — the stored value is used", () => {
    const src = read("src/domain/purchaseOrderFields.js");
    assert.ok(!/reduce\(/.test(src), "a list must not sum lines to make its own total");
    assert.ok(!/unitPrice\s*\*/.test(src));
  });
});

// =====================================================================================
// 2 — THE WAYS A MONEY COLUMN LIES
// =====================================================================================

describe("currency rendering", () => {
  test("SORTING COMPARES NUMBERS, never formatted strings", () => {
    // "$1,000.00" sorts before "$9.00" as text. That is the classic money-column lie.
    const big = currencyField(1000);
    const small = currencyField(9);
    assert.equal(big.value, "$1,000.00");
    assert.equal(small.value, "$9.00");
    assert.equal(big.raw, 1000);
    assert.equal(small.raw, 9);
    assert.ok(big.raw > small.raw, "the raw values order correctly");
    assert.ok(big.value < small.value, "and the formatted strings would NOT have");
  });

  test("UNKNOWN IS NOT ZERO", () => {
    // On a purchasing list, "worth nothing" and "we do not know" are opposite facts.
    const unknown = currencyField(null);
    assert.equal(unknown.present, false);
    assert.equal(unknown.raw, null);
    assert.notEqual(unknown.value, "$0.00");
  });

  test("AUTHORITATIVE ZERO RENDERS AS ZERO", () => {
    const zero = currencyField(0);
    assert.equal(zero.value, "$0.00");
    assert.equal(zero.present, true);
    assert.equal(zero.raw, 0);
  });

  test("a non-finite amount is an absence, not NaN on a screen", () => {
    for (const bad of [NaN, Infinity, "18450", undefined]) {
      assert.equal(currencyField(bad).present, false, `${String(bad)} must not render as money`);
    }
  });

  test("it is CURRENCY kind, so a renderer can right-align it without guessing", () => {
    assert.equal(currencyField(1).kind, FIELD_KIND.CURRENCY);
  });
});

describe("receipt quantities follow the same rule", () => {
  test("zero received is ZERO; unknown is not", () => {
    assert.equal(quantityField(0, { label: "Received" }).value, "0");
    assert.equal(quantityField(null, { label: "Received" }).present, false);
    assert.equal(quantityField(null, { label: "Received", unknown: true }).value, ABSENCE.NOT_AUTHORIZED);
  });
});

// =====================================================================================
// 3 — STATUS vs RECEIPT STATE
// =====================================================================================

describe("what the business did, and what actually arrived", () => {
  test("STATUS IS STORED AND SORTS BY LIFECYCLE", () => {
    const status = byId("status");
    assert.equal(status.category, FIELD_CATEGORY.OWNED);
    assert.equal(status.sortable, true);
    assert.deepEqual([...status.statusOrder], ["DRAFT", "APPROVED", "SENT", "RECEIVED", "CANCELLED"]);
  });

  test("CANCELLED sits last as a terminal exit, not spliced mid-sequence", () => {
    // Placing it between SENT and RECEIVED would imply it is a step on the way.
    assert.equal(PO_STATUS_ORDER[PO_STATUS_ORDER.length - 1], "CANCELLED");
    assert.ok(PO_STATUS_ORDER.indexOf("CANCELLED") > PO_STATUS_ORDER.indexOf("RECEIVED"));
  });

  test("RECEIPT STATE IS A SEPARATE, DERIVED FIELD", () => {
    // "status: SENT" says what the business did. "receiptState: PARTIALLY_RECEIVED" says what
    // arrived. Showing one as the other would claim a persisted state the document never held.
    const receipt = byId("receiptState");
    assert.equal(receipt.category, FIELD_CATEGORY.DERIVED);
    assert.notEqual(receipt.id, byId("status").id);
    assert.match(receipt.source, /deriveReceiptState/);
  });

  test("a derived receipt state is not filtered or sorted server-side", () => {
    const plan = toQueryPlan(
      addFilter(emptyListState, makeFilter({ fieldId: "receiptState", operator: OPERATOR.IS, value: "RECEIVED" })),
      PURCHASE_ORDER_FIELDS,
    );
    assert.equal(plan.executable, false, "there is nothing stored to query");
  });

  test("stored enums read as words, and keep their raw value", () => {
    assert.equal(statusField("PARTIALLY_RECEIVED").value, "Partially Received");
    assert.equal(statusField("PARTIALLY_RECEIVED").raw, "PARTIALLY_RECEIVED");
    // And the PO's own vocabularies exist for both.
    assert.equal(PO_STATUS_LABEL.SENT, "Sent");
    assert.equal(PO_RECEIPT_STATE_LABEL.PARTIALLY_RECEIVED, "Partially received");
  });

  test("ORDERED / RECEIVED / REMAINING ARE THREE FIELDS, not a sentence", () => {
    // "18 ordered · 5 received · 13 remaining" reads fine and exposes nothing: no column can be
    // sorted by what is outstanding, and no filter can find part-received orders.
    for (const id of ["orderedQuantity", "receivedQuantity", "remainingQuantity"]) {
      const f = byId(id);
      assert.equal(f.type, FIELD_TYPE.QUANTITY);
      assert.equal(f.align, "right");
      assert.equal(f.displayable, true);
    }
  });
});

// =====================================================================================
// 4 — VENDOR, BUYER, BUSINESS LINE
// =====================================================================================

describe("Vendor is the projection the Work Order's customer is missing", () => {
  test("supplierName IS denormalised, so Vendor is filterable AND sortable", () => {
    const vendor = byId("vendor.name");
    assert.equal(vendor.category, FIELD_CATEGORY.RELATED);
    assert.equal(vendor.filterable, true);
    assert.equal(vendor.sortable, true, "unusual for a related field, and only because it is stored here");
    assert.match(vendor.source, /denormalised/);
  });

  test("ITS TYPE IS STRING, and the validator is what made that clear", () => {
    // The first declaration used OBJECT_REF and the contract refused CONTAINS on it -- correctly, a
    // reference is matched by identity. What is stored is the NAME, so the field is a string.
    const vendor = byId("vendor.name");
    assert.equal(vendor.type, FIELD_TYPE.STRING);
    assert.ok(vendor.operators.includes(OPERATOR.CONTAINS));
  });

  test("NO N+1: the list needs no per-row supplier lookup", () => {
    assert.match(byId("vendor.name").source, /supplierName/);
  });

  test("an unresolved vendor is an absence, never a supplier id", () => {
    assert.equal(byId("vendor.name").unresolvedText, "Vendor unavailable");
    assert.ok(!/id/i.test(byId("vendor.name").unresolvedText));
  });
});

describe("what the Purchase Order cannot prove", () => {
  test("BUYER IS NOT AUTHORITATIVE, and is therefore not a column", () => {
    const buyer = byId("buyer.name");
    assert.equal(buyer.displayable, false);
    assert.equal(buyer.unsupportedFilterReason, UNSUPPORTED_REASON.NO_AUTHORITY);
    const gap = PO_FIELD_GAPS.find((g) => g.gap === "PO BUYER FIELD NOT AUTHORITATIVE");
    assert.ok(gap);
    // The refusal is recorded: attributing a buyer from createdBy audit metadata would make a column
    // out of something the PO cannot prove.
    assert.match(gap.refused, /createdBy|audit/i);
  });

  test("BUSINESS LINE IS NOT DERIVABLE — a PO may legitimately mix lines", () => {
    assert.equal(byId("businessLine").displayable, false);
    const gap = PO_FIELD_GAPS.find((g) => g.gap === "PO BUSINESS LINE NOT DERIVABLE");
    assert.match(gap.detail, /mix Taylor and Ventana/i);
  });

  test("neither is offered anywhere a person could ask for it", () => {
    for (const id of ["buyer.name", "businessLine"]) {
      assert.ok(!visibleFields(PURCHASE_ORDER_FIELDS).some((f) => f.id === id));
      assert.ok(!filterableFields(PURCHASE_ORDER_FIELDS).some((f) => f.id === id));
      assert.ok(!sortableFields(PURCHASE_ORDER_FIELDS).some((f) => f.id === id));
    }
  });

  test("CREATED DATE IS NOT MISLABELLED 'Order Date'", () => {
    // The document stores a creation timestamp and no separate ordered/sent/approved date. Calling it
    // Order Date would assert a business meaning the field does not carry.
    const date = byId("createdAt");
    assert.equal(date.label, "Created Date");
    assert.match(date.description, /no separate order\/sent\/approved date/i);
  });
});

// =====================================================================================
// 5 — FILTERS, SORT, STATE
// =====================================================================================

describe("filters and sort come from the shared contract", () => {
  test("the filter menu offers exactly what is queryable", () => {
    const ids = filterableFields(PURCHASE_ORDER_FIELDS).map((f) => f.id).sort();
    assert.deepEqual(ids, ["createdAt", "dollars", "purchaseOrderNumber", "status", "vendor.name"]);
  });

  test("MULTIPLE FILTERS compose, and all survive a URL round trip", () => {
    // Status = Sent AND Vendor contains "ABC" AND Dollars > 5000.
    let s = addFilter(emptyListState, makeFilter({ fieldId: "status", operator: OPERATOR.IS, value: "SENT" }));
    s = addFilter(s, makeFilter({ fieldId: "vendor.name", operator: OPERATOR.CONTAINS, value: "ABC" }));
    s = addFilter(s, makeFilter({ fieldId: "dollars", operator: OPERATOR.GREATER_THAN, value: "5000" }));
    s = setSort(s, "dollars", "desc");

    const plan = toQueryPlan(s, PURCHASE_ORDER_FIELDS);
    assert.equal(plan.executable, true, "all three are server-executable");
    assert.equal(plan.server.length, 3);
    assert.equal(plan.sort.fieldId, "dollars");

    const restored = fromSearchParams(toSearchParams(s).toString(), PURCHASE_ORDER_FIELDS);
    assert.equal(restored.filters.length, 3);
    assert.deepEqual(restored.sort, { fieldId: "dollars", direction: "desc" });
  });

  test("Dollars sorts HIGH TO LOW in the words a person would choose", () => {
    const options = sortOptionsFor(byId("dollars"));
    assert.equal(options[0].label, "Dollars — High to low");
    assert.equal(options[1].label, "Dollars — Low to high");
  });

  test("dates sort newest/oldest, not ascending/descending", () => {
    assert.equal(sortOptionsFor(byId("createdAt"))[0].label, "Created Date — Newest first");
  });

  test("A PAGE SIZE IS ALWAYS APPLIED — the PO collection is never fetched whole", () => {
    assert.ok(toQueryPlan(emptyListState, PURCHASE_ORDER_FIELDS).pageSize > 0);
  });

  test("a criteria change resets the cursor", () => {
    const paged = { ...emptyListState, cursor: "page2" };
    assert.equal(addFilter(paged, makeFilter({ fieldId: "status", operator: OPERATOR.IS, value: "SENT" })).cursor, null);
    assert.equal(setSort(paged, "dollars", "desc").cursor, null);
  });

  test("A URL CANNOT ASK TO SORT BY A DERIVED FIELD", () => {
    assert.equal(fromSearchParams("sort=receiptState:asc", PURCHASE_ORDER_FIELDS).sort, null);
  });

  test("the default order is DECLARED, with a reason", () => {
    // Not replacing a meaningful queue with generic newest-first by accident.
    assert.equal(PO_DEFAULT_SORT.fieldId, "createdAt");
    assert.equal(PO_DEFAULT_SORT.direction, "desc");
    assert.ok(PO_DEFAULT_SORT.why.length > 40);
    assert.match(PO_DEFAULT_SORT.why, /overrides it explicitly/i);
  });

  test("filter fields group under the object that owns them", () => {
    const owners = groupFieldsByOwner(filterableFields(PURCHASE_ORDER_FIELDS), PURCHASE_ORDER_OBJECT)
      .map((g) => g.owner);
    assert.ok(owners.includes(PURCHASE_ORDER_OBJECT));
    assert.ok(owners.includes("Vendor"));
  });
});

// =====================================================================================
// 6 — SEARCH AND IDENTITY
// =====================================================================================

describe("business identity", () => {
  test("the PO's identity is its NUMBER, never the document id", () => {
    const number = byId("purchaseOrderNumber");
    assert.equal(number.type, FIELD_TYPE.IDENTIFIER);
    assert.equal(number.searchable, true);
    assert.match(number.source, /never the document id/i);
  });

  test("search covers PO number and vendor — no id is ever asked for", () => {
    const searchable = PURCHASE_ORDER_FIELDS.filter((f) => f.searchable).map((f) => f.id).sort();
    assert.deepEqual(searchable, ["purchaseOrderNumber", "vendor.name"]);
  });

  test("NO DISPLAYABLE FIELD IS A DOCUMENT ID", () => {
    for (const f of PURCHASE_ORDER_FIELDS.filter((x) => x.displayable)) {
      assert.ok(!/^id$|documentId|docId/i.test(f.id), `${f.id} looks like a document id`);
      assert.ok(!/\bid\b/i.test(f.label), `${f.label} must not be an id`);
    }
  });
});

// =====================================================================================
// 7 — REPORTING METADATA
// =====================================================================================

describe("reporting reuses these definitions", () => {
  test("the list-critical fields carry report and export metadata", () => {
    for (const id of ["purchaseOrderNumber", "status", "createdAt", "vendor.name", "dollars"]) {
      const f = byId(id);
      assert.equal(f.reportable, true, `${id} must be reportable`);
      assert.equal(f.exportable, true, `${id} must be exportable`);
    }
  });

  test("BLOCKED FIELDS ARE NOT REPORTABLE OR EXPORTABLE EITHER", () => {
    // Otherwise an export becomes the back door through which an unproven column ships.
    for (const id of ["buyer.name", "businessLine"]) {
      assert.equal(byId(id).reportable, false);
      assert.equal(byId(id).exportable, false);
    }
  });

  test("there is no separate report-only field registry", () => {
    const src = read("src/domain/purchaseOrderFields.js");
    assert.match(src, /defineObjectFields/);
    assert.ok(!/REPORT_FIELDS|reportFields\s*=/.test(src));
  });
});
