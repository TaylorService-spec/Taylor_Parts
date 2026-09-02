// FIN-BLOCK-003 — the measured ABSENCE of a governed cost supply, made into a guard.
//
// Pure (no emulator, no network). Prerequisite: npm run build.
//   node --test test/costAuthorityAbsence.test.mjs
//
// ============================ WHY A TEST FOR SOMETHING THAT DOES NOT EXIST ============================
//
// The 2026-09-02 reconciliation measured every cost-like field in the repository and found that EOS
// has NO governed cost fact: the inventory ledger is quantity-only, no purchase price reaches
// receiving, no COGS concept exists, the labour domain records hours and refuses rates, and
// `deriveGrossMargin` therefore returns UNKNOWN for every real invocation because nothing constructs
// a `GovernedCostFact`.
//
// That state is correct and deliberate. It is also EXACTLY the kind of state that erodes one field at
// a time. A `unitCost` added to a ledger row "just to carry it", a `COST` added to the financial
// source types "for completeness", a rate copied onto a labour entry to make a screen work — each is
// a small, reasonable-looking commit, and together they would constitute a valuation policy that no
// Owner ever chose.
//
// So this file asserts the absence structurally. It is not here to prove the platform is empty; it is
// here so that the first commit which fills any of these holes FAILS, and the person writing it is
// told which Owner decision it depends on instead of discovering later that they made one.
//
// WHAT IT DOES NOT DUPLICATE. `costMargin.test.mjs` already proves the pure core's behaviour
// (UNKNOWN, never revenue − 0). `financialReportingRead.test.mjs` already proves the reporting read
// refuses cost/margin fact types. This file covers what neither does: that no cost fact PRODUCER
// exists anywhere, across domains that no single suite owns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { FINANCIAL_SOURCE_TYPES } from "../lib/finance/financialAttribution.js";
import { deriveGrossMargin } from "../lib/finance/costMargin.js";
import { PERFORMANCE_METRICS, findMetric } from "../lib/performance/performanceMetricRegistry.js";

const SRC = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (rel) => readFileSync(join(SRC, rel), "utf8");

/** Source with line comments and block comments stripped — so a comment ABOUT cost is not mistaken
 *  for cost. Every assertion below is about code, and the comments in these files are largely
 *  explanations of why cost is absent. */
function code(rel) {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * The money-shaped identifiers this file guards against.
 *
 * DELIBERATELY SPECIFIC, and the specificity was earned: the first version of this list included the
 * bare word `value`, which fired immediately on `transferOrderTypes.ts` — where `value` is this
 * repository's validation-result idiom (`{ valid, value, reason }`), not money at all. An
 * over-broad guard is worse than no guard, because the first false positive is the commit that
 * deletes it. These are field names a cost would actually arrive under.
 */
const MONEY_FIELDS = Object.freeze([
  "costMinor",
  "unitCost",
  "extendedCost",
  "amountMinor",
  "valueMinor",
  "unitPrice",
  "priceMinor",
  "costBasis",
]);

// ===========================================================================
// THE LEDGER IS QUANTITY-ONLY
// ===========================================================================

test("an inventory transaction carries no monetary field", () => {
  // Value does not follow quantity anywhere in this platform. If it ever should, that is a valuation
  // policy decision (FIN-BLOCK-003 §4 / ND-27), not a field addition.
  const src = code("types/inventoryTransaction.ts");
  for (const money of [...MONEY_FIELDS, "currency"]) {
    assert.ok(
      !new RegExp(`\\b${money}\\b`).test(src),
      `types/inventoryTransaction.ts gained "${money}". Putting money on the quantity ledger IS choosing a valuation policy — FIN-BLOCK-003 must be ruled first.`,
    );
  }
});

test("the governed operational movement carries no monetary field either", () => {
  // The schema-2 movement family (RECEIVED / ADJUSTED / TRANSFER_OUT / TRANSFER_IN / COUNTED /
  // RETURNED / SCRAPPED) is the newer ledger shape. Same rule.
  const src = code("inventoryLedger/operationalMovementTypes.ts");
  for (const money of [...MONEY_FIELDS, "currency"]) {
    assert.ok(!new RegExp(`\\b${money}\\b`).test(src), `operationalMovementTypes.ts gained "${money}"`);
  }
});

test("a TRANSFER cannot create value, because there is no value to create", () => {
  // The strongest form of this guarantee is structural rather than behavioural: a transfer command
  // that carried a cost could recompute one, and a recomputed cost on an internal move is
  // manufactured profit. There is no field, so there is no arithmetic to get wrong.
  const src = code("inventoryTransfer/transferOrderTypes.ts");
  for (const money of MONEY_FIELDS) {
    assert.ok(
      !new RegExp(`\\b${money}\\b`).test(src),
      `transferOrderTypes.ts gained "${money}" — an internal move must not carry or restate value`,
    );
  }
});

test("a quantity-only adjustment manufactures no cost", () => {
  // Cycle-count reconciliation is the only producer of ADJUSTED. Its variance is a QUANTITY variance
  // with a required reason string; nothing converts that into money.
  const src = code("cycleCount/cycleCountTypes.ts");
  for (const money of MONEY_FIELDS) {
    assert.ok(!new RegExp(`\\b${money}\\b`).test(src), `cycleCountTypes.ts gained "${money}" — a counted variance is a quantity fact`);
  }
});

// ===========================================================================
// NO COST FACT PRODUCER EXISTS
// ===========================================================================

test("nothing in functions/src constructs a GovernedCostFact", () => {
  // THE CENTRAL FINDING. costMargin.ts defines the shape a governed cost fact must have and enforces
  // UNKNOWN without one. This asserts the other half — that no code path anywhere builds one — which
  // is what makes "every margin question is truthfully UNKNOWN today" a fact about the platform
  // rather than a fact about one module.
  const producers = [];
  for (const file of walk(SRC)) {
    const rel = file.slice(SRC.length).replace(/\\/g, "/");
    if (rel === "finance/costMargin.ts") continue; // the definition itself
    const src = code(rel);
    if (/GovernedCostFact/.test(src)) producers.push(rel);
  }
  assert.deepEqual(
    producers,
    [],
    `A GovernedCostFact producer appeared in ${producers.join(", ")}. That is the moment FIN-BLOCK-003 stops being theoretical: the costBasis vocabulary, the capture point and the valuation authority all need Owner rulings before a cost fact may be constructed.`,
  );
});

test("deriveGrossMargin still answers UNKNOWN for the repository's actual state", () => {
  // Not a duplicate of costMargin.test.mjs's unit case: this asserts the SHAPE the rest of the
  // platform would actually hand it today — revenue lines and no cost facts, because no producer
  // exists — and that the answer is UNKNOWN with null numbers rather than a margin equal to revenue.
  const r = deriveGrossMargin({
    currency: "USD",
    revenueLines: [{ ref: "L1", revenueMinor: 125_00 }],
    costFacts: [],
  });
  assert.equal(r.status, "UNKNOWN");
  assert.equal(r.costMinor, null);
  assert.equal(r.marginMinor, null);
  assert.ok(r.reasons.length > 0, "an UNKNOWN margin must say why");
});

test("COST is not a financial source type — a cost fact cannot enter FIN-002 attribution", () => {
  assert.ok(!FINANCIAL_SOURCE_TYPES.includes("COST"));
  assert.ok(!FINANCIAL_SOURCE_TYPES.includes("COGS"));
});

test("no COGS concept exists anywhere in functions/src", () => {
  const hits = [];
  for (const file of walk(SRC)) {
    const rel = file.slice(SRC.length).replace(/\\/g, "/");
    if (/\b(costOfGoodsSold|costOfSales)\b/.test(code(rel)) || /\bcogs\b/i.test(code(rel))) hits.push(rel);
  }
  assert.deepEqual(hits, [], `COGS appeared in ${hits.join(", ")}. When cost leaves inventory and becomes cost-of-revenue is a RECOGNITION decision, separate from cost supply and from valuation.`);
});

// ===========================================================================
// LABOUR RECORDS HOURS, NOT COST
// ===========================================================================

test("a labour entry carries no rate, no cost and no billable flag", () => {
  // Three facts the schema refuses to collapse: work performed, billable labour, and labour cost.
  // It records only the first. Copying an hourly rate onto an operational record would freeze a
  // valuation into it, and would do so without anyone choosing a rate authority.
  const src = code("workOrderLabor/workOrderLaborCommand.ts");
  for (const money of ["rateMinor", "hourlyRate", "costMinor", "laborCost", "burden", "billable"]) {
    assert.ok(
      !new RegExp(`\\b${money}\\b`, "i").test(src),
      `workOrderLaborCommand.ts gained "${money}" — labour COST needs a rate authority (FIN-BLOCK-003 §4.3), which does not exist`,
    );
  }
});

// ===========================================================================
// THE SUPPLIER QUOTE CANNOT BE SUBSTITUTED FOR A COST FACT
// ===========================================================================

test("part_supplier_items.cost is a decimal STRING, structurally unusable as a governed cost", () => {
  // The one real money field on the procurement path. FIN-001 rules it a quote/term, not a cost
  // event, and it is disconnected from both purchase orders and receiving.
  //
  // This asserts the mechanical reason it cannot be quietly borrowed: GovernedCostFact.costMinor is
  // an integer in minor units, and this is a decimal string with up to four places. Substituting one
  // for the other is not a small type coercion — it is adopting a supplier's quoted term as the
  // company's cost basis, which is Owner decision FIN-BLOCK-003 §4.1.
  const src = read("partMaster/partSupplierItems.ts");
  assert.match(src, /readonly cost: string/, "cost is a decimal string");
  assert.match(src, /DECIMAL_PATTERN/, "and is validated as one");

  const margin = code("finance/costMargin.ts");
  assert.match(margin, /costMinor: number/, "a governed cost fact is integer minor units");
  assert.ok(
    !/part_supplier_items|partSupplierItem/.test(margin),
    "the margin core must not reference the supplier quote",
  );
});

test("no receiving path reads the supplier quote", () => {
  // If receiving ever read part_supplier_items.cost, THAT would be the capture point decision
  // (FIN-BLOCK-003 §4.2) being made by import statement.
  for (const rel of [
    "inventoryReceiving/receiveInventoryStockCommand.ts",
    "inventoryReceiving/receivingTypes.ts",
    "reorderRequest/reorderCommands.ts",
  ]) {
    const src = code(rel);
    assert.ok(
      !/partSupplierItem|part_supplier_items/.test(src),
      `${rel} now reads the supplier quote — that is a cost CAPTURE POINT decision, not a wiring change`,
    );
  }
});

// ===========================================================================
// THE METRIC REGISTRY STAYS HONEST
// ===========================================================================

test("every cost-dependent metric is still blocked, and still names FIN-BLOCK-003", () => {
  for (const metricId of [
    "inventory.value.amount",
    "inventory.turns.ratio",
    "inventory.carryingCost.amount",
    "inventory.wasteAvoided.amount",
  ]) {
    const m = findMetric(metricId);
    assert.ok(m, `${metricId} must stay registered — a blocked metric is how the platform says what it would measure`);
    assert.equal(m.activeForGoals, false, `${metricId} must stay blocked while no cost authority exists`);
    assert.match(m.blockedBy, /FIN-BLOCK-003|cost fact|cost basis|value basis/i, `${metricId} must name the cost blocker`);
  }
});

test("no metric declaring a COST basis is active", () => {
  // planVsActual's COST measurement basis is a legal value with no producer. A metric may declare it;
  // none may be ACTIVE, because an active COST metric would be a promise to compute something from
  // facts that do not exist.
  for (const m of PERFORMANCE_METRICS) {
    if (m.financialBasis === "COST") {
      assert.equal(m.activeForGoals, false, `${m.metricId} declares a COST basis and must stay blocked`);
    }
  }
});

test("waste avoided still names all THREE missing pieces, not just cost", () => {
  // The one metric where closing FIN-BLOCK-003 alone would still not be enough, and the registry has
  // to keep saying so: a prevention event, a cost basis, and a stated counterfactual.
  const m = findMetric("inventory.wasteAvoided.amount");
  assert.match(m.blockedBy, /prevention/i);
  assert.match(m.blockedBy, /cost/i);
  assert.match(m.blockedBy, /counterfactual|would otherwise have happened/i);
});
