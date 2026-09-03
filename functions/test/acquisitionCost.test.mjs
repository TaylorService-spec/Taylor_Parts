// FIN-BLOCK-003A — GOVERNED ACQUISITION COST SUPPLY. Pure tests: no emulator, no clock, no network.
//
// What this suite is FOR. FIN-BLOCK-003 measured CASE D — no governed cost fact existed anywhere —
// and `costAuthorityAbsence.test.mjs` guards the absences that must NOT erode. This package closes
// exactly one of them: acquisition cost for purchased physical goods. So this suite has two jobs, and
// they pull in opposite directions on purpose:
//
//   1. Prove the new supply is governed — integer minor units, explicit currency, explicit company,
//      immutable, idempotent by identity, UNKNOWN rather than zero when a price is absent.
//   2. Prove that closing cost SUPPLY closed nothing else. Valuation, COGS, margin, turns, carrying
//      cost and waste-avoided must all still be blocked, and a cost fact must not quietly become any
//      of them.
//
// The second job is the one most likely to be undone by a well-meaning future change, because a
// repository that now has real cost numbers looks like a repository that can answer cost questions.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const code = (rel) => readFileSync(join(SRC, rel), "utf8");
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

const {
  governedPurchasePrice,
  buildAcquisitionCostFact,
  acquisitionCostDocId,
  AcquisitionCostError,
  ACQUISITION_COST_BASES,
  PURCHASE_ORDER_LINE_PRICE,
} = await import("../lib/finance/acquisitionCost.js");
const { deriveGrossMargin } = await import("../lib/finance/costMargin.js");
const { buildRecordReorderPurchaseOrder } = await import("../lib/reorderRequest/reorderCommands.js");
const { normalizeLegacyPurchaseOrder, normalizeCanonicalPurchaseOrder } = await import(
  "../lib/purchasing/purchaseOrderNormalization.js"
);
const { PERFORMANCE_METRICS, metricsActiveForGoals } = await import("../lib/performance/performanceMetricRegistry.js");

const throwsCode = (fn, code) =>
  assert.throws(fn, (e) => e instanceof AcquisitionCostError && e.code === code, `expected ${code}`);

const factInput = (over = {}) => ({
  price: { unitPriceMinor: 10000, currency: "USD" },
  operatingCompanyId: "taylor",
  purchaseOrderId: "PO-1",
  purchaseOrderLineId: "L1",
  purchaseOrderSourceType: "REORDER_PURCHASE_ORDER",
  purchaseOrderVersion: null,
  supplierId: null,
  supplierName: "ACME",
  partId: "PRT-1",
  receivedQuantity: 4,
  receivingId: "rcv-1",
  receivingLineId: "L1",
  receivedAtMillis: 1_700_000_000_000,
  receivingLocationType: "WAREHOUSE",
  receivingLocationId: "WH-1",
  ...over,
});

// ══════════════════════════════ MONEY IS EXACT ══════════════════════════════

test("a governed price is integer minor units with an explicit currency", () => {
  const p = governedPurchasePrice({ unitPriceMinor: 10000, currency: "USD" });
  assert.deepEqual({ ...p }, { unitPriceMinor: 10000, currency: "USD" });
});

test("FLOAT money is REFUSED, not rounded — the Epic-5 defect cannot enter through the front door", () => {
  // 19.99 is not 1999 minor units by any rule this module gets to choose. Rounding would be inventing
  // a convention; refusing states that the caller has not supplied minor units.
  throwsCode(() => governedPurchasePrice({ unitPriceMinor: 19.99, currency: "USD" }), "PRICE_INVALID");
  throwsCode(() => governedPurchasePrice({ unitPriceMinor: 0.1 + 0.2, currency: "USD" }), "PRICE_INVALID");
  throwsCode(() => governedPurchasePrice({ unitPriceMinor: Number.MAX_SAFE_INTEGER + 2, currency: "USD" }), "PRICE_INVALID");
  throwsCode(() => governedPurchasePrice({ unitPriceMinor: "10000", currency: "USD" }), "PRICE_INVALID");
});

test("a PARTIAL price is refused — an amount with no currency has no governed meaning", () => {
  // The tempting failure is to default the currency to USD. Every governed money path in this repo
  // refuses that, and a cost fact is the last place to start.
  throwsCode(() => governedPurchasePrice({ unitPriceMinor: 10000 }), "PRICE_INCOMPLETE");
  throwsCode(() => governedPurchasePrice({ currency: "USD" }), "PRICE_INCOMPLETE");
});

test("NEITHER field present is UNPRICED — null, which is not an error and is not zero", () => {
  assert.equal(governedPurchasePrice({}), null);
  assert.equal(governedPurchasePrice({ unitPriceMinor: undefined, currency: undefined }), null);
  assert.equal(governedPurchasePrice({ unitPriceMinor: null, currency: null }), null);
});

test("currency must be 3 uppercase letters, and is never defaulted", () => {
  throwsCode(() => governedPurchasePrice({ unitPriceMinor: 1, currency: "usd" }), "CURRENCY_INVALID");
  throwsCode(() => governedPurchasePrice({ unitPriceMinor: 1, currency: "DOLLARS" }), "CURRENCY_INVALID");
  throwsCode(() => governedPurchasePrice({ unitPriceMinor: 1, currency: "" }), "CURRENCY_INVALID");
  // A non-USD currency is accepted and KEPT AS ITSELF. No FX exists, so it is never converted.
  assert.equal(governedPurchasePrice({ unitPriceMinor: 1, currency: "CAD" }).currency, "CAD");
});

test("negative money is refused — direction is carried by TYPE everywhere in this repo, never by sign", () => {
  // CREDIT_MEMO / DEBIT_CHARGE / WRITE_OFF all validate a POSITIVE amount. A vendor rebate or a
  // return credit therefore needs its own governed type, which is an open decision.
  throwsCode(() => governedPurchasePrice({ unitPriceMinor: -1, currency: "USD" }), "PRICE_INVALID");
});

test("extended cost is exact integer arithmetic, and overflow is refused rather than approximated", () => {
  const fact = buildAcquisitionCostFact(factInput({ price: { unitPriceMinor: 10000, currency: "USD" }, receivedQuantity: 4 }));
  assert.equal(fact.extendedCostMinor, 40000);
  throwsCode(
    () => buildAcquisitionCostFact(factInput({ price: { unitPriceMinor: 2 ** 52, currency: "USD" }, receivedQuantity: 4096 })),
    "COST_OVERFLOW",
  );
});

test("no floating-point money arithmetic exists in the acquisition cost path", () => {
  const src = code("finance/acquisitionCost.ts");
  for (const forbidden of ["parseFloat", "toFixed", "Math.round", "Math.floor", "Math.ceil", "/ 100", "* 100"]) {
    assert.ok(!src.includes(forbidden), `acquisitionCost.ts must not use ${forbidden} on money`);
  }
});

// ══════════════════════════════ COMPANY ══════════════════════════════

test("operatingCompanyId is REQUIRED on every cost fact, and fails closed when absent", () => {
  throwsCode(() => buildAcquisitionCostFact(factInput({ operatingCompanyId: null })), "COMPANY_REQUIRED");
  throwsCode(() => buildAcquisitionCostFact(factInput({ operatingCompanyId: "" })), "COMPANY_REQUIRED");
  throwsCode(() => buildAcquisitionCostFact(factInput({ operatingCompanyId: "   " })), "COMPANY_REQUIRED");
});

test("Taylor and Ventana cost facts stay distinguishable", () => {
  const taylor = buildAcquisitionCostFact(factInput({ operatingCompanyId: "taylor" }));
  const ventana = buildAcquisitionCostFact(factInput({ operatingCompanyId: "ventana" }));
  assert.equal(taylor.operatingCompanyId, "taylor");
  assert.equal(ventana.operatingCompanyId, "ventana");
});

test("the company is never inferred from warehouse, vendor, SKU, user or customer", () => {
  // Structural, because the harm is a plausible-looking fallback rather than a wrong value: the
  // receiving warehouse is RIGHT THERE on every receipt and would look like a reasonable source.
  const src = code("finance/acquisitionCost.ts");
  const inferenceSources = ["receivingLocationId", "supplierName", "supplierId", "partId"];
  for (const source of inferenceSources) {
    assert.ok(
      !new RegExp(`operatingCompanyId[^\\n]*${source}|${source}[^\\n]*\\?\\?[^\\n]*operatingCompanyId`).test(src),
      `operatingCompanyId must not be derived from ${source}`,
    );
  }
  // And the receiving command must not reach for the warehouse when the PO has no company.
  const recv = code("inventoryReceiving/receiveInventoryStockCommand.ts");
  assert.ok(
    !/operatingCompanyId[^\n]*(receivingLocation|locationId|warehouse)/i.test(recv),
    "receiving must not infer the operating company from the destination",
  );
});

// ══════════════════════════════ LINEAGE AND IMMUTABILITY ══════════════════════════════

test("every cost fact carries the lineage that makes it evidence", () => {
  const fact = buildAcquisitionCostFact(factInput());
  for (const field of [
    "costBasis", "operatingCompanyId", "purchaseOrderId", "purchaseOrderLineId", "purchaseOrderSourceType",
    "partId", "receivedQuantity", "unitPriceMinor", "extendedCostMinor", "currency",
    "receivingId", "receivingLineId", "receivedAtMillis", "receivingLocationType", "receivingLocationId",
  ]) {
    assert.ok(fact[field] !== undefined && fact[field] !== null, `${field} must be present on a cost fact`);
  }
});

test("missing lineage is refused — a cost with no traceable source is not evidence", () => {
  for (const field of ["purchaseOrderId", "purchaseOrderLineId", "partId", "receivingId", "receivingLineId", "receivingLocationId"]) {
    throwsCode(() => buildAcquisitionCostFact(factInput({ [field]: null })), "LINEAGE_REQUIRED");
  }
});

test("the receipt's event time is required, and it is a governed business time — not a write clock", () => {
  throwsCode(() => buildAcquisitionCostFact(factInput({ receivedAtMillis: null })), "LINEAGE_REQUIRED");
  throwsCode(() => buildAcquisitionCostFact(factInput({ receivedAtMillis: "2026-01-01" })), "LINEAGE_REQUIRED");
  // G-05 ruling 14: never createdAt/updatedAt because they happen to exist.
  const recv = code("inventoryReceiving/receiveInventoryStockCommand.ts");
  assert.ok(/receivedAtMillis: occurredAtMillis/.test(recv), "the cost fact must take the receipt's governed occurredAt");
});

test("a cost fact is FROZEN — a caller cannot mutate one into a different number", () => {
  const fact = buildAcquisitionCostFact(factInput());
  assert.throws(() => { fact.unitPriceMinor = 1; }, TypeError);
  assert.throws(() => { fact.operatingCompanyId = "ventana"; }, TypeError);
});

test("received quantity must be a positive integer — a zero-quantity receipt has no cost to record", () => {
  for (const q of [0, -1, 1.5, "4", null]) {
    throwsCode(() => buildAcquisitionCostFact(factInput({ receivedQuantity: q })), "QUANTITY_INVALID");
  }
});

test("identity is deterministic on (receipt, line) — which is what makes duplication impossible", () => {
  // A duplicate cost event is a financial defect, so it is prevented by the document id rather than
  // by a check someone can forget to run.
  assert.equal(acquisitionCostDocId("rcv-1", "L1"), acquisitionCostDocId("rcv-1", "L1"));
  assert.notEqual(acquisitionCostDocId("rcv-1", "L1"), acquisitionCostDocId("rcv-1", "L2"));
  assert.notEqual(acquisitionCostDocId("rcv-1", "L1"), acquisitionCostDocId("rcv-2", "L1"));
});

test("a partial receipt records cost for the quantity RECEIVED, not the quantity ordered", () => {
  // PO line: 10 @ 10000. Receipt 1: 4 units.
  const first = buildAcquisitionCostFact(factInput({ receivedQuantity: 4 }));
  assert.equal(first.receivedQuantity, 4);
  assert.equal(first.extendedCostMinor, 40000, "4 × 10000 — never 10 × 10000");
  // Receipt 2 for the remaining 6, at a price governed for THAT receipt. The first fact is a separate
  // frozen value keyed by its own receipt, so nothing recomputes it.
  const second = buildAcquisitionCostFact(
    factInput({ receivedQuantity: 6, receivingId: "rcv-2", price: { unitPriceMinor: 12000, currency: "USD" } }),
  );
  assert.equal(second.extendedCostMinor, 72000);
  assert.equal(first.unitPriceMinor, 10000, "the earlier receipt is unchanged by a later price");
  assert.notEqual(acquisitionCostDocId(first.receivingId, "L1"), acquisitionCostDocId(second.receivingId, "L1"));
});

// ══════════════════════════════ THE BASIS VOCABULARY ══════════════════════════════

test("v1 has exactly ONE basis, and no speculative costing method is pre-registered", () => {
  assert.deepEqual([...ACQUISITION_COST_BASES], ["PURCHASE_ORDER_LINE_PRICE"]);
  assert.equal(buildAcquisitionCostFact(factInput()).costBasis, PURCHASE_ORDER_LINE_PRICE);
  const src = code("finance/acquisitionCost.ts");
  // Naming these in prose is how the module explains what it is NOT. Registering one would suggest a
  // costing method had been chosen; none has.
  for (const method of ["WEIGHTED_AVERAGE", "FIFO", "LIFO", "STANDARD_COST", "REPLACEMENT_COST", "LABOR_BURDEN"]) {
    assert.ok(
      !new RegExp(`["'\`]${method}["'\`]`).test(src),
      `${method} must not exist as a value — choosing a costing method is an Owner accounting ruling`,
    );
  }
});

test("freight, duty, tax and burden are excluded from v1 — no landed-cost allocation exists", () => {
  const fact = buildAcquisitionCostFact(factInput());
  for (const excluded of ["freight", "duty", "tax", "insurance", "burden", "overhead", "landedCost", "installation"]) {
    assert.equal(fact[excluded], undefined, `${excluded} requires a separate landed-cost authority`);
  }
});

// ══════════════════════════════ THE SUPPLIER QUOTE IS AN INPUT, NOT THE EVENT ══════════════════════════════

test("the supplier quote is not itself a governed acquisition cost event", () => {
  // FIN-001's finding, re-pinned: part_supplier_items.cost is a decimal STRING term. It is not, and
  // cannot become, a cost fact — a decimal string is refused by the price authority outright.
  throwsCode(() => governedPurchasePrice({ unitPriceMinor: "12.3400", currency: "USD" }), "PRICE_INVALID");
  // And nothing in the receiving or cost path IMPORTS it. Matched on the import statement rather than
  // on the words: these modules NAME the supplier quote in prose to explain why it is not a cost
  // event, and a guard that cannot tell an explanation from a dependency is a guard that gets deleted.
  for (const rel of ["finance/acquisitionCost.ts", "inventoryReceiving/receiveInventoryStockCommand.ts", "purchasing/purchaseOrderNormalization.ts"]) {
    assert.ok(!/^import .*partSupplierItems/m.test(code(rel)), `${rel} must not import the supplier quote authority`);
  }
});

test("a later supplier-quote change cannot mutate a committed PO price or a receipt cost", () => {
  // Structural and total: the quote may seed a DRAFT price at composition time, but once the price is
  // on the committed purchase order it is a different fact in a different document. Proven by there
  // being no path at all from the supplier item to either — a stronger statement than "we do not
  // update it", because it means no future caller can either.
  const poWriter = code("reorderRequest/reorderCommands.ts");
  assert.ok(!/^import .*partSupplierItems/m.test(poWriter), "the PO writer must not read the supplier quote");
  // The purchase order is immutable by Rules (allow update, delete: if false), so a stored committed
  // price has no update path at all.
  const rules = readFileSync(join(HERE, "..", "..", "firestore.rules"), "utf8");
  const start = rules.indexOf("match /reorder_purchase_orders/");
  // To the END of that match block, not a fixed window: the block carries a long governance comment,
  // and a short slice would silently miss the rule and pass for the wrong reason.
  const block = rules.slice(start, rules.indexOf("match /", rules.indexOf("allow create: if false;", start)));
  assert.match(block, /allow update, delete: if false;/, "the committed purchase order must stay immutable");
});

// ══════════════════════════════ THE LIVE PATH IS CANONICAL; EPIC-5 IS NOT ══════════════════════════════

test("the live purchase order accepts a governed price at vendor commitment", () => {
  const built = buildRecordReorderPurchaseOrder(
    { reorderRequestId: "REQ-1", supplierName: "ACME", externalPoNumber: "PO-9", orderedQuantity: 10, orderedDate: "2026-09-01", unitPriceMinor: 10000, currency: "USD" },
    { status: "PURCHASING_IN_PROGRESS", operatingCompanyId: "taylor", partId: "PRT-1" },
    { actorUid: "u1", nowMillis: 1, purchaseOrderExists: false },
  );
  assert.equal(built.purchaseOrder.unitPriceMinor, 10000);
  assert.equal(built.purchaseOrder.currency, "USD");
  assert.equal(built.purchaseOrder.status, "ORDERED", "the commitment point is the existing ORDERED transition");
});

test("an unpriced NEW commitment is now REFUSED — activation superseded the optional phase", () => {
  // SUPERSEDED AND REWRITTEN, not deleted. This assertion used to prove the opposite: that an
  // unpriced purchase order was still recordable, which was correct while the field was optional so
  // the deployed workflow could keep running. The activation ruling ended that phase, so leaving the
  // old assertion would have pinned a behaviour the Owner deliberately changed.
  //
  // What the optional phase actually protected — existing unpriced purchase orders — is now
  // protected by the LEGACY STAMP instead, which is a better mechanism: it grandfathers real history
  // without leaving a door open for new callers. See acquisitionCostActivation.test.mjs.
  assert.throws(
    () =>
      buildRecordReorderPurchaseOrder(
        { reorderRequestId: "REQ-1", supplierName: "ACME", externalPoNumber: "PO-9", orderedQuantity: 10, orderedDate: "2026-09-01" },
        { status: "PURCHASING_IN_PROGRESS", operatingCompanyId: "taylor", partId: "PRT-1" },
        { actorUid: "u1", nowMillis: 1, purchaseOrderExists: false },
      ),
    (e) => e.code === "PO_PRICE_REQUIRED",
  );
});

test("the live purchase order refuses a float or half-supplied price at commitment", () => {
  const attempt = (over) =>
    buildRecordReorderPurchaseOrder(
      { reorderRequestId: "REQ-1", supplierName: "ACME", externalPoNumber: "PO-9", orderedQuantity: 10, orderedDate: "2026-09-01", ...over },
      { status: "PURCHASING_IN_PROGRESS", operatingCompanyId: "taylor", partId: "PRT-1" },
      { actorUid: "u1", nowMillis: 1, purchaseOrderExists: false },
    );
  assert.throws(() => attempt({ unitPriceMinor: 19.99, currency: "USD" }), /PO_FIELD_INVALID|minor units/);
  assert.throws(() => attempt({ unitPriceMinor: 10000 }), /PO_FIELD_INVALID|currency/);
  assert.throws(() => attempt({ currency: "USD" }), /PO_FIELD_INVALID|currency/);
});

test("the company still cannot be supplied by a caller, now that money rides alongside it", () => {
  assert.throws(
    () =>
      buildRecordReorderPurchaseOrder(
        { reorderRequestId: "REQ-1", supplierName: "ACME", externalPoNumber: "PO-9", orderedQuantity: 10, orderedDate: "2026-09-01", unitPriceMinor: 10000, currency: "USD", operatingCompanyId: "ventana" },
        { status: "PURCHASING_IN_PROGRESS", operatingCompanyId: "taylor", partId: "PRT-1" },
        { actorUid: "u1", nowMillis: 1, purchaseOrderExists: false },
      ),
    /COMPANY_NOT_CLIENT_SUPPLIABLE|cannot be supplied/,
  );
});

test("the DEAD Epic-5 purchase_orders float price is NOT read as a governed cost", () => {
  // The single most tempting way to give EOS a cost supply for free, and the ruling forbids it. A
  // canonical line carrying a float unitPrice normalizes to UNPRICED — the number is present and is
  // deliberately not adopted.
  const po = normalizeCanonicalPurchaseOrder("PO-CANON", {
    status: "APPROVED",
    items: [{ lineId: "L1", partId: "PRT-1", quantity: 5, unitPrice: 19.99 }],
    totalCost: 99.95,
  });
  assert.equal(po.lines[0].unitPriceMinor, null, "the Epic-5 float must not become a governed price");
  assert.equal(po.lines[0].currency, null);
  assert.equal(po.operatingCompanyId, null, "and it carries no operating company either");
});

test("the DEAD Epic-5 procurement modules are unreachable from the acquisition-cost path", () => {
  // Deliberately NOT "nothing reads .unitPrice". That was the first version of this guard and it was
  // wrong: `unitPrice` is legitimate REVENUE vocabulary on invoices, sales orders and agreements, so
  // the guard fired on correct code and would have been deleted rather than heeded. An over-broad
  // guard is worse than none.
  //
  // The real claim is narrower and is the one the ruling makes: the dead Epic-5 float layer must not
  // FEED cost. So the assertion is reachability — nothing in the cost chain imports it.
  const costChain = [
    "finance/acquisitionCost.ts",
    "purchasing/purchaseOrderNormalization.ts",
    "inventoryReceiving/receiveInventoryStockCommand.ts",
    "inventoryReceiving/receivingSourceResolver.ts",
    "reorderRequest/reorderCommands.ts",
  ];
  for (const rel of costChain) {
    assert.ok(
      !/^import .*(procurementService|procurementBridge)/m.test(code(rel)),
      `${rel} must not import the dead Epic-5 procurement layer — its floats, missing currency and missing company must not reach cost`,
    );
  }
});

test("a legacy purchase order's stored price is RE-VALIDATED, not trusted because it is stored", () => {
  // A stored document is untrusted input to a reader. A corrupt price is refused rather than silently
  // read as "unpriced" — turning a corrupt purchase order into a free one is the worse failure.
  const doc = (over) => ({ reorderRequestId: "REQ-1", partId: "PRT-1", orderedQuantity: 5, status: "ORDERED", operatingCompanyId: "taylor", ...over });
  assert.equal(normalizeLegacyPurchaseOrder("REQ-1", doc({ unitPriceMinor: 10000, currency: "USD" })).lines[0].unitPriceMinor, 10000);
  assert.equal(normalizeLegacyPurchaseOrder("REQ-1", doc()).lines[0].unitPriceMinor, null);
  for (const bad of [{ unitPriceMinor: 19.99, currency: "USD" }, { unitPriceMinor: 10000 }, { unitPriceMinor: 10000, currency: "usd" }]) {
    assert.throws(() => normalizeLegacyPurchaseOrder("REQ-1", doc(bad)), (e) => e.code === "PO_PRICE_INVALID");
  }
});

test("the live purchase order carries the governed company through to normalization", () => {
  const po = normalizeLegacyPurchaseOrder("REQ-1", {
    reorderRequestId: "REQ-1", partId: "PRT-1", orderedQuantity: 5, status: "ORDERED", operatingCompanyId: "ventana",
  });
  assert.equal(po.operatingCompanyId, "ventana");
});

// ══════════════════════════════ WHAT REMAINS CLOSED ══════════════════════════════

test("COGS remains OPEN — a receipt cost does not become cost against revenue", () => {
  // The consumption event is still quantity-only. Which receipt's cost attaches to which sale is a
  // cost-flow policy, and no such policy exists.
  // The ledger stays quantity-only. This is the assertion that matters most in this suite: cost now
  // EXISTS, so the cheapest-looking way to answer a margin question is to copy a unit cost onto a
  // consumption row. That would be a cost-flow policy nobody chose.
  for (const rel of ["inventoryLedger/operationalMovementTypes.ts", "inventoryLedger/operationalMovementValidation.ts"]) {
    const ledger = code(rel);
    for (const money of ["costMinor", "unitCost", "extendedCost", "acquisitionCost", "currency"]) {
      assert.ok(!new RegExp(`\\b${money}\\b`, "i").test(ledger), `the inventory ledger must stay quantity-only (${rel}: ${money})`);
    }
  }
  for (const file of walk(SRC)) {
    const src = readFileSync(file, "utf8");
    assert.ok(!/costOfGoodsSold|COST_OF_GOODS/.test(src), `no COGS concept may exist yet: ${file}`);
  }
});

test("an acquisition fact is NOT a GovernedCostFact — margin still returns UNKNOWN", () => {
  // The two shapes answer different questions at different times. GovernedCostFact.lineRef binds cost
  // to a REVENUE line, which at receipt time does not exist; binding one would BE the COGS decision.
  const fact = buildAcquisitionCostFact(factInput());
  assert.equal(fact.lineRef, undefined, "an acquisition fact must not carry a revenue line reference");
  const margin = deriveGrossMargin({ currency: "USD", lines: [{ ref: "INV-1-L1", revenueMinor: 50000 }], costFacts: [] });
  assert.equal(margin.status, "UNKNOWN");
  assert.equal(margin.costMinor, null, "never revenue − 0");
  assert.equal(margin.marginMinor, null);
});

test("nothing converts an acquisition fact into a GovernedCostFact", () => {
  const producers = [];
  for (const file of walk(SRC)) {
    const rel = file.slice(SRC.length + 1).replace(/\\/g, "/");
    // Both the margin core (which DEFINES it) and the acquisition module (whose header explains at
    // length why it is NOT that shape) mention the name. Neither constructs one.
    if (rel === "finance/costMargin.ts" || rel === "finance/acquisitionCost.ts") continue;
    if (/GovernedCostFact/.test(readFileSync(file, "utf8"))) producers.push(rel);
  }
  assert.deepEqual(producers, [], `a GovernedCostFact producer appeared in ${producers.join(", ")} — that is the COGS decision, and it is open`);
});

test("valuation remains OPEN — no costing method or inventory value exists", () => {
  for (const file of walk(SRC)) {
    const src = readFileSync(file, "utf8");
    const rel = file.slice(SRC.length + 1).replace(/\\/g, "/");
    if (rel === "finance/acquisitionCost.ts" || rel === "performance/performanceMetricRegistry.ts") continue;
    for (const banned of ["weightedAverageCost", "movingAverageCost", "standardCost", "replacementCost", "bookValue", "carryingCost"]) {
      assert.ok(!new RegExp(`\\b${banned}\\b`).test(src), `${banned} must not exist in ${rel} — valuation is an open Owner ruling`);
    }
  }
});

test("labor cost remains OPEN — hours are still not money", () => {
  const labor = code("workOrderLabor/workOrderLaborCommand.ts");
  for (const money of ["rate", "cost", "wage", "burden", "billable"]) {
    assert.ok(!new RegExp(`\\b${money}Minor\\b|\\bhourly${money}\\b`, "i").test(labor), `labour must not gain ${money}`);
  }
});

test("transfers, picks and adjustments still cannot create acquisition cost", () => {
  // A transfer cannot create value because it carries none. The cost producer is bound to RECEIPT, so
  // this is structural: no other movement path can reach the builder.
  const producers = [];
  for (const file of walk(SRC)) {
    const rel = file.slice(SRC.length + 1).replace(/\\/g, "/");
    if (rel === "finance/acquisitionCost.ts") continue;
    if (/buildAcquisitionCostFact/.test(readFileSync(file, "utf8"))) producers.push(rel);
  }
  assert.deepEqual(
    producers,
    ["inventoryReceiving/receiveInventoryStockCommand.ts"],
    "RECEIPT is the only producer of acquisition cost — a transfer, pick, stage, put-away or adjustment must never create one",
  );
  for (const rel of ["inventoryTransfer/inventoryTransfer.ts", "cycleCount/cycleCountVariance.ts"]) {
    let src;
    try { src = code(rel); } catch { continue; }
    assert.ok(!/acquisitionCost|costMinor|unitPriceMinor/i.test(src), `${rel} must not manufacture cost`);
  }
});

test("COST is still not a financial source type — a cost fact cannot enter FIN-002 attribution", () => {
  const attribution = code("finance/financialAttribution.ts");
  const match = /FINANCIAL_SOURCE_TYPES\s*=\s*Object\.freeze\(\[([^\]]*)\]/.exec(attribution);
  assert.ok(match, "FINANCIAL_SOURCE_TYPES must be findable");
  assert.ok(!/["']COST["']/.test(match[1]), "adding COST here is the COGS/recognition decision, and it is open");
});

test("returns and rebates remain OPEN — no cost reversal or restoration exists", () => {
  for (const file of walk(SRC)) {
    const src = readFileSync(file, "utf8");
    for (const banned of ["costReversal", "reverseCost", "rebateAllocation", "costRestoration"]) {
      assert.ok(!new RegExp(banned, "i").test(src), `${banned} requires separate returns/rebate authority`);
    }
  }
});

// ══════════════════════════════ THE METRIC REGISTRY DID NOT MOVE ══════════════════════════════

test("closing cost SUPPLY activated NO metric", () => {
  // The count is the guard. Cost facts now exist, which makes this registry look answerable — it is
  // not, because valuation, COGS, a carrying rate and a counterfactual are all still missing.
  assert.equal(PERFORMANCE_METRICS.length, 37, "37 registered");
  assert.equal(metricsActiveForGoals().length, 12, "12 active — unchanged by this package");
});

test("inventory value, turns, carrying cost and waste-avoided each still name a REAL remaining blocker", () => {
  const byId = new Map(PERFORMANCE_METRICS.map((m) => [m.metricId, m]));
  const expectations = {
    "inventory.value.amount": /VALUATION_POLICY_REQUIRED/,
    "inventory.turns.ratio": /COGS_COST_FLOW_REQUIRED/,
    "inventory.carryingCost.amount": /CARRYING_RATE_REQUIRED/,
    "inventory.wasteAvoided.amount": /PREVENTION_EVENT_REQUIRED/,
  };
  for (const [metricId, pattern] of Object.entries(expectations)) {
    const metric = byId.get(metricId);
    assert.ok(metric, `${metricId} must exist`);
    assert.equal(metric.activeForGoals, false, `${metricId} must remain blocked`);
    assert.match(metric.blockedBy ?? "", pattern, `${metricId} must name its real remaining blocker`);
    assert.ok(
      !/NO GOVERNED COST FACT EXISTS ANYWHERE/.test(metric.blockedBy ?? ""),
      `${metricId} must no longer claim no cost fact exists — one does now, for purchased goods`,
    );
  }
});

// ══════════════════════════════ NOTHING WAS GRANTED, NOTHING WAS ACTIVATED ══════════════════════════════

test("no new capability was registered, and FIN-004 reach is unchanged", () => {
  const catalog = code("access/permissionCatalog.ts");
  for (const invented of ["cost.read", "cost.manage", "inventory.cost", "acquisitionCost"]) {
    assert.ok(!catalog.includes(invented), `${invented} must not appear — this package grants no visibility`);
  }
  const visibility = code("finance/financialVisibility.ts");
  assert.ok(!/acquisitionCost|ACQUISITION_COST/.test(visibility), "FIN-004 reach is unchanged by this package");
});

test("SELF/TEAM activation is untouched", () => {
  const visibility = code("finance/financialVisibility.ts");
  // Measured, not assumed: whatever the scopes' activation state was, this package did not edit it.
  assert.ok(!/acquisition/i.test(visibility), "the acquisition cost package must not appear in the visibility authority");
});

test("the cost collection has NO Rules match block — so every client read is denied by default", () => {
  // Absence of a match block IS the denial in Firestore, and it is the strongest available answer to
  // "do not create broad client-readable raw cost documents". It also means this package needs no
  // Rules change, which keeps it out of a protected boundary it has no business touching.
  const rules = readFileSync(join(HERE, "..", "..", "firestore.rules"), "utf8");
  assert.ok(!/inventory_acquisition_costs/.test(rules), "no match block: raw cost documents are unreadable by any client");
});
