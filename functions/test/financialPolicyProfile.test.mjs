// CERT-FIN-02 -- the governed financial policy profile, the cost engine, and the proof that
// different approved accounting policies produce different CORRECT financial answers from the SAME
// physical inventory history.
//
// Run: npm run test:financialPolicy   (builds functions/ first)
//
// The test policy profiles below are FIXTURES, not production configuration. They exist so the
// platform can prove it supports several methods; which one Taylor deploys is a decision its
// accounting team makes during deployment and is not encoded anywhere in source.
import test from "node:test";
import assert from "node:assert/strict";

const {
  PLATFORM_INVARIANTS,
  UNKNOWN_COST_TREATMENT,
  INVENTORY_COST_METHODS,
  SERIALIZED_COST_METHODS,
  COGS_RECOGNITION_POINTS,
  cogsRecognitionPoint,
  FREIGHT_TREATMENTS,
  LANDED_COST_TREATMENTS,
  PROFILE_STATUSES,
  EDITABLE_STATUSES,
  isEditableStatus,
  isLegalTransition,
  validateFinancialPolicyProfile,
  assertProfileMutable,
  FinancialPolicyError,
} = await import("../lib/finance/financialPolicyProfile.js");

const { relieveInventoryCost, valueInventoryPool, CostEngineError } = await import(
  "../lib/finance/inventoryCostEngine.js"
);

// ============================ TEST POLICY FIXTURES ============================

const APPROVAL = {
  approvedBy: "A. Accountant",
  approvedOn: "2026-09-03",
  reference: "deployment packet 7",
  recordedByUid: "uid-deployer",
};

function profile(over = {}) {
  return validateFinancialPolicyProfile({
    operatingCompanyId: "taylor",
    status: "DRAFT",
    inventoryCostMethod: "WEIGHTED_AVERAGE",
    serializedInventoryCostMethod: "SPECIFIC_IDENTIFICATION",
    cogsRecognitionPointId: "SALES_ORDER_FULFILLMENT",
    freightTreatment: "EXCLUDED",
    landedCostTreatment: "EXCLUDED",
    approval: null,
    ...over,
  });
}

const TEST_POLICY_WEIGHTED_AVERAGE = profile({ inventoryCostMethod: "WEIGHTED_AVERAGE" });
const TEST_POLICY_FIFO = profile({ inventoryCostMethod: "FIFO" });
const TEST_POLICY_SPECIFIC_IDENTIFICATION = profile({
  serializedInventoryCostMethod: "SPECIFIC_IDENTIFICATION",
});

// ONE physical history, used by every policy below. Receive 10 @ $10.00, then 10 @ $14.00.
const PHYSICAL_HISTORY = Object.freeze([
  Object.freeze({
    lotId: "lot-a",
    operatingCompanyId: "taylor",
    partId: "part-1",
    quantity: 10,
    unitPriceMinor: 1000,
    currency: "USD",
    receivedAtMillis: 1_000,
  }),
  Object.freeze({
    lotId: "lot-b",
    operatingCompanyId: "taylor",
    partId: "part-1",
    quantity: 10,
    unitPriceMinor: 1400,
    currency: "USD",
    receivedAtMillis: 2_000,
  }),
]);

const RELIEVE_5 = Object.freeze([Object.freeze({ quantity: 5 })]);

// ============================ PLATFORM INVARIANTS ARE NOT CONFIGURABLE ============================

test("unknown cost treatment is a platform constant, not a profile field", () => {
  assert.equal(UNKNOWN_COST_TREATMENT, "PRESERVE_AS_UNKNOWN");
  assert.throws(
    () => profile({ unknownCostTreatment: "ZERO" }),
    (e) => e instanceof FinancialPolicyError && e.code === "PROFILE_MALFORMED",
    "an invariant must not be settable by adding a field to the document",
  );
});

test("every platform invariant is stated, and none of them is a profile field", () => {
  const ids = PLATFORM_INVARIANTS.map((i) => i.id);
  for (const required of [
    "UNKNOWN_NEVER_ZERO",
    "HISTORY_IMMUTABLE",
    "TRANSFER_CREATES_NO_COST",
    "COMPANY_PARTITION",
    "INTEGER_MINOR_UNITS",
    "FAIL_CLOSED_MARGIN",
    "NO_SILENT_RECALCULATION",
  ]) {
    assert.ok(ids.includes(required), `missing invariant ${required}`);
  }
  for (const inv of PLATFORM_INVARIANTS) {
    assert.ok(inv.statement.length > 0);
    assert.throws(() => profile({ [inv.id]: "anything" }), FinancialPolicyError);
  }
});

test("no costing method EOS has not implemented can be configured", () => {
  for (const unsupported of ["LIFO", "STANDARD_COST", "REPLACEMENT_COST", "AVERAGE", ""]) {
    assert.equal(INVENTORY_COST_METHODS.includes(unsupported), false, unsupported);
    assert.throws(
      () => profile({ inventoryCostMethod: unsupported }),
      (e) => e instanceof FinancialPolicyError && e.code === "METHOD_UNSUPPORTED",
      unsupported,
    );
  }
});

test("freight and landed cost cannot be capitalized without an approved allocation method", () => {
  assert.deepEqual([...FREIGHT_TREATMENTS], ["EXCLUDED"]);
  assert.deepEqual([...LANDED_COST_TREATMENTS], ["EXCLUDED"]);
  assert.throws(
    () => profile({ freightTreatment: "CAPITALIZED" }),
    (e) => e instanceof FinancialPolicyError && e.code === "TREATMENT_UNSUPPORTED",
  );
  assert.throws(
    () => profile({ landedCostTreatment: "CAPITALIZED" }),
    (e) => e instanceof FinancialPolicyError && e.code === "TREATMENT_UNSUPPORTED",
  );
});

test("a profile belongs to exactly one operating company -- there is no global policy", () => {
  assert.throws(
    () => profile({ operatingCompanyId: "" }),
    (e) => e instanceof FinancialPolicyError && e.code === "COMPANY_REQUIRED",
  );
  assert.equal(profile({ operatingCompanyId: "ventana" }).operatingCompanyId, "ventana");
});

// ============================ COGS RECOGNITION ============================

test("physical movement is never a recognition point", () => {
  const ids = COGS_RECOGNITION_POINTS.map((p) => p.id);
  for (const physical of [
    "TRANSFER",
    "TRANSFER_OUT",
    "BIN_RELOCATION",
    "STAGING",
    "RECEIPT",
    "RECEIVED",
    "CYCLE_COUNT",
    "COUNTED",
    "ADJUSTED",
  ]) {
    assert.equal(ids.includes(physical), false, `${physical} must never recognize COGS`);
  }
});

test("an unavailable recognition point cannot be configured, and says why", () => {
  const blocked = cogsRecognitionPoint("WORK_ORDER_CONSUMPTION");
  assert.equal(blocked.available, false);
  assert.match(blocked.blockedReason, /CONSUMPTION_SOURCE_SELECTION_AUTHORITY_REQUIRED/);
  assert.match(blocked.blockedReason, /does not remove physical stock/);
  assert.throws(
    () => profile({ cogsRecognitionPointId: "WORK_ORDER_CONSUMPTION" }),
    (e) => e instanceof FinancialPolicyError && e.code === "RECOGNITION_UNAVAILABLE",
    "service-parts COGS must stay blocked while consumption leaves the item on the shelf",
  );
});

test("the available recognition points are real governed events", () => {
  const available = COGS_RECOGNITION_POINTS.filter((p) => p.available).map((p) => p.id);
  assert.deepEqual(available.sort(), ["EQUIPMENT_INSTALL", "INVOICE_ISSUE", "SALES_ORDER_FULFILLMENT"]);
  for (const id of available) assert.equal(profile({ cogsRecognitionPointId: id }).cogsRecognitionPointId, id);
});

test("an unknown recognition point is refused, not defaulted", () => {
  assert.throws(
    () => profile({ cogsRecognitionPointId: "WHENEVER" }),
    (e) => e instanceof FinancialPolicyError && e.code === "RECOGNITION_UNSUPPORTED",
  );
});

// ============================ LIFECYCLE + LOCK ============================

test("the lifecycle is DRAFT -> APPROVED -> LOCKED, and LOCKED has no way out", () => {
  assert.deepEqual([...PROFILE_STATUSES], ["DRAFT", "APPROVED", "LOCKED"]);
  assert.equal(isLegalTransition("DRAFT", "APPROVED"), true);
  assert.equal(isLegalTransition("APPROVED", "LOCKED"), true);
  assert.equal(isLegalTransition("APPROVED", "DRAFT"), true, "an approval may be revised before activation");
  for (const to of ["DRAFT", "APPROVED", "LOCKED"]) {
    assert.equal(isLegalTransition("LOCKED", to), false, `LOCKED -> ${to} must not exist`);
  }
  assert.equal(isLegalTransition("DRAFT", "LOCKED"), false, "activation requires accounting approval first");
});

test("LOCKED is not an editable status and there is no unlock", () => {
  assert.deepEqual([...EDITABLE_STATUSES], ["DRAFT", "APPROVED"]);
  assert.equal(isEditableStatus("LOCKED"), false);
  assert.equal(isEditableStatus("UNLOCKED"), false);
  assert.throws(
    () => assertProfileMutable({ status: "LOCKED" }),
    (e) => e instanceof FinancialPolicyError && e.code === "PROFILE_LOCKED",
  );
  // The one place the rule lives, so no caller can forget it.
  assert.doesNotThrow(() => assertProfileMutable({ status: "DRAFT" }));
  assert.doesNotThrow(() => assertProfileMutable({ status: "APPROVED" }));
  assert.doesNotThrow(() => assertProfileMutable(null));
});

test("APPROVED and LOCKED require recorded accounting approval; DRAFT does not", () => {
  assert.throws(
    () => profile({ status: "APPROVED", approval: null }),
    (e) => e instanceof FinancialPolicyError && e.code === "APPROVAL_REQUIRED",
  );
  assert.throws(
    () => profile({ status: "LOCKED", approval: null }),
    (e) => e instanceof FinancialPolicyError && e.code === "APPROVAL_REQUIRED",
  );
  assert.equal(profile({ status: "APPROVED", approval: APPROVAL }).approval.approvedBy, "A. Accountant");
});

test("approval evidence records a name, a date and the principal who entered it -- not a signature", () => {
  assert.throws(
    () => profile({ status: "APPROVED", approval: { ...APPROVAL, approvedBy: "  " } }),
    (e) => e instanceof FinancialPolicyError && e.code === "APPROVAL_MALFORMED",
  );
  assert.throws(
    () => profile({ status: "APPROVED", approval: { ...APPROVAL, approvedOn: "Sept 3" } }),
    (e) => e instanceof FinancialPolicyError && e.code === "APPROVAL_MALFORMED",
  );
  assert.throws(
    () => profile({ status: "APPROVED", approval: { ...APPROVAL, recordedByUid: "" } }),
    (e) => e instanceof FinancialPolicyError && e.code === "APPROVAL_MALFORMED",
  );
  const p = profile({ status: "APPROVED", approval: { ...APPROVAL, reference: null } });
  assert.equal(p.approval.reference, null, "a reference is optional; its absence is null, not invented");
});

// ============================ WEIGHTED AVERAGE ============================

test("WEIGHTED_AVERAGE: the Owner's worked example, to the cent", () => {
  const r = relieveInventoryCost({
    profile: TEST_POLICY_WEIGHTED_AVERAGE,
    lots: PHYSICAL_HISTORY,
    reliefs: RELIEVE_5,
  });
  // pool = 20 units, $240.00; average $12.00/unit; relieve 5 => $60.00; remaining 15 => $180.00
  assert.equal(r.method, "WEIGHTED_AVERAGE");
  assert.deepEqual(r.relievedCost, { state: "KNOWN", amountMinor: 6000, currency: "USD" });
  assert.deepEqual(r.remainingValue, { state: "KNOWN", amountMinor: 18000, currency: "USD" });
  assert.equal(r.remainingQuantity, 15);
});

test("WEIGHTED_AVERAGE: relief and remainder always sum to the pool exactly (no rounding residue)", () => {
  // 3 @ $10.00 and 1 @ $0.01 -- an average that does not divide evenly.
  const lots = [
    { lotId: "a", operatingCompanyId: "taylor", partId: "p", quantity: 3, unitPriceMinor: 1000, currency: "USD", receivedAtMillis: 1 },
    { lotId: "b", operatingCompanyId: "taylor", partId: "p", quantity: 1, unitPriceMinor: 1, currency: "USD", receivedAtMillis: 2 },
  ];
  const poolValue = 3 * 1000 + 1;
  for (const q of [1, 2, 3]) {
    const r = relieveInventoryCost({ profile: TEST_POLICY_WEIGHTED_AVERAGE, lots, reliefs: [{ quantity: q }] });
    assert.equal(
      r.relievedCost.amountMinor + r.remainingValue.amountMinor,
      poolValue,
      `relieving ${q} must not create or destroy value`,
    );
  }
});

test("WEIGHTED_AVERAGE: rounding is half-up on the total, never a per-unit rounding", () => {
  // 2 units, pool $0.01. Relieving 1 is exactly half a cent -> half-up gives 1, remainder 0.
  const lots = [
    { lotId: "a", operatingCompanyId: "taylor", partId: "p", quantity: 1, unitPriceMinor: 1, currency: "USD", receivedAtMillis: 1 },
    { lotId: "b", operatingCompanyId: "taylor", partId: "p", quantity: 1, unitPriceMinor: 0, currency: "USD", receivedAtMillis: 2 },
  ];
  const r = relieveInventoryCost({ profile: TEST_POLICY_WEIGHTED_AVERAGE, lots, reliefs: [{ quantity: 1 }] });
  assert.equal(r.relievedCost.amountMinor, 1);
  assert.equal(r.remainingValue.amountMinor, 0);
});

// ============================ FIFO ============================

test("FIFO: the Owner's worked example, to the cent", () => {
  const r = relieveInventoryCost({ profile: TEST_POLICY_FIFO, lots: PHYSICAL_HISTORY, reliefs: RELIEVE_5 });
  // oldest layer first: 5 @ $10.00 => $50.00. Remaining 5 @ $10.00 + 10 @ $14.00 = $190.00
  assert.equal(r.method, "FIFO");
  assert.deepEqual(r.relievedCost, { state: "KNOWN", amountMinor: 5000, currency: "USD" });
  assert.deepEqual(r.remainingValue, { state: "KNOWN", amountMinor: 19000, currency: "USD" });
  assert.equal(r.remainingQuantity, 15);
});

test("FIFO: consumes across a layer boundary at each layer's own price", () => {
  const r = relieveInventoryCost({ profile: TEST_POLICY_FIFO, lots: PHYSICAL_HISTORY, reliefs: [{ quantity: 12 }] });
  // 10 @ $10.00 + 2 @ $14.00 = $128.00; remaining 8 @ $14.00 = $112.00
  assert.equal(r.relievedCost.amountMinor, 12800);
  assert.equal(r.remainingValue.amountMinor, 11200);
  assert.equal(r.remainingQuantity, 8);
});

test("FIFO order is receipt time, not array order, and ties break deterministically", () => {
  const shuffled = [PHYSICAL_HISTORY[1], PHYSICAL_HISTORY[0]];
  const r = relieveInventoryCost({ profile: TEST_POLICY_FIFO, lots: shuffled, reliefs: RELIEVE_5 });
  assert.equal(r.relievedCost.amountMinor, 5000, "the newer lot appearing first must not change FIFO");

  const sameMillis = [
    { lotId: "b-second", operatingCompanyId: "t", partId: "p", quantity: 1, unitPriceMinor: 500, currency: "USD", receivedAtMillis: 7 },
    { lotId: "a-first", operatingCompanyId: "t", partId: "p", quantity: 1, unitPriceMinor: 100, currency: "USD", receivedAtMillis: 7 },
  ];
  const tie = relieveInventoryCost({ profile: TEST_POLICY_FIFO, lots: sameMillis, reliefs: [{ quantity: 1 }] });
  assert.equal(tie.relievedCost.amountMinor, 100, "a millisecond tie breaks on lotId, deterministically");
});

// ============================ SPECIFIC IDENTIFICATION ============================

const SERIALIZED_LOTS = Object.freeze([
  Object.freeze({ lotId: "s-1", operatingCompanyId: "taylor", partId: "machine", quantity: 1, unitPriceMinor: 250000, currency: "USD", receivedAtMillis: 1, serialNo: "SN-A" }),
  Object.freeze({ lotId: "s-2", operatingCompanyId: "taylor", partId: "machine", quantity: 1, unitPriceMinor: 310000, currency: "USD", receivedAtMillis: 2, serialNo: "SN-B" }),
]);

test("SPECIFIC_IDENTIFICATION: the unit that left carries its own cost, not an average", () => {
  const r = relieveInventoryCost({
    profile: TEST_POLICY_SPECIFIC_IDENTIFICATION,
    lots: SERIALIZED_LOTS,
    reliefs: [{ quantity: 1, serialNo: "SN-B" }],
    serialized: true,
  });
  assert.equal(r.method, "SPECIFIC_IDENTIFICATION");
  assert.equal(r.relievedCost.amountMinor, 310000, "the expensive unit left, so the expensive cost left");
  assert.equal(r.remainingValue.amountMinor, 250000);
  assert.equal(r.remainingQuantity, 1);
});

test("SPECIFIC_IDENTIFICATION refuses a bare quantity -- a number does not identify a unit", () => {
  assert.throws(
    () =>
      relieveInventoryCost({
        profile: TEST_POLICY_SPECIFIC_IDENTIFICATION,
        lots: SERIALIZED_LOTS,
        reliefs: [{ quantity: 1 }],
        serialized: true,
      }),
    (e) => e instanceof CostEngineError && e.code === "SERIAL_REQUIRED",
  );
});

test("SPECIFIC_IDENTIFICATION refuses an ambiguous serial rather than guessing the line", () => {
  // The known lineage gap: one receipt, same part, two lines, different prices.
  const ambiguous = [
    { lotId: "line-1", operatingCompanyId: "t", partId: "machine", quantity: 1, unitPriceMinor: 100000, currency: "USD", receivedAtMillis: 1, serialNo: "SN-DUP" },
    { lotId: "line-2", operatingCompanyId: "t", partId: "machine", quantity: 1, unitPriceMinor: 900000, currency: "USD", receivedAtMillis: 1, serialNo: "SN-DUP" },
  ];
  assert.throws(
    () =>
      relieveInventoryCost({
        profile: TEST_POLICY_SPECIFIC_IDENTIFICATION,
        lots: ambiguous,
        reliefs: [{ quantity: 1, serialNo: "SN-DUP" }],
        serialized: true,
      }),
    (e) => e instanceof CostEngineError && e.code === "SERIAL_AMBIGUOUS",
    "picking the cheaper or the older line would be inventing financial lineage",
  );
});

test("SPECIFIC_IDENTIFICATION refuses an unknown serial", () => {
  assert.throws(
    () =>
      relieveInventoryCost({
        profile: TEST_POLICY_SPECIFIC_IDENTIFICATION,
        lots: SERIALIZED_LOTS,
        reliefs: [{ quantity: 1, serialNo: "SN-NOPE" }],
        serialized: true,
      }),
    (e) => e instanceof CostEngineError && e.code === "SERIAL_NOT_FOUND",
  );
});

// ============================ THE CENTRAL PROOF ============================

test("SAME physical history, DIFFERENT policy, DIFFERENT financial answer -- intentionally", () => {
  const wa = relieveInventoryCost({ profile: TEST_POLICY_WEIGHTED_AVERAGE, lots: PHYSICAL_HISTORY, reliefs: RELIEVE_5 });
  const ff = relieveInventoryCost({ profile: TEST_POLICY_FIFO, lots: PHYSICAL_HISTORY, reliefs: RELIEVE_5 });

  assert.notEqual(wa.relievedCost.amountMinor, ff.relievedCost.amountMinor, "the two methods must not coincidentally agree");
  assert.equal(wa.relievedCost.amountMinor, 6000);
  assert.equal(ff.relievedCost.amountMinor, 5000);
  assert.equal(wa.remainingValue.amountMinor, 18000);
  assert.equal(ff.remainingValue.amountMinor, 19000);

  // Each method conserves value on its own terms: relieved + remaining == the pool it started with.
  assert.equal(wa.relievedCost.amountMinor + wa.remainingValue.amountMinor, 24000);
  assert.equal(ff.relievedCost.amountMinor + ff.remainingValue.amountMinor, 24000);
});

test("PHYSICAL TRUTH IS IDENTICAL under every policy -- accounting never moves a unit", () => {
  const reliefs = [{ quantity: 7 }];
  const results = [TEST_POLICY_WEIGHTED_AVERAGE, TEST_POLICY_FIFO].map((p) =>
    relieveInventoryCost({ profile: p, lots: PHYSICAL_HISTORY, reliefs }),
  );
  const quantities = new Set(results.map((r) => r.remainingQuantity));
  assert.equal(quantities.size, 1, "policy must not change how many units exist");
  assert.equal([...quantities][0], 13);

  // And the physical history the policies read is byte-identical -- the engine never mutates inputs.
  assert.deepEqual(PHYSICAL_HISTORY[0].quantity, 10);
  assert.deepEqual(PHYSICAL_HISTORY[1].unitPriceMinor, 1400);
});

test("valuation and cost relief are the same code path, so they cannot disagree", () => {
  for (const p of [TEST_POLICY_WEIGHTED_AVERAGE, TEST_POLICY_FIFO]) {
    const valued = valueInventoryPool({ profile: p, lots: PHYSICAL_HISTORY });
    const relievedNothing = relieveInventoryCost({ profile: p, lots: PHYSICAL_HISTORY, reliefs: [] });
    assert.deepEqual(valued, relievedNothing.remainingValue);
    assert.equal(valued.amountMinor, 24000);
  }
});

// ============================ UNKNOWN NEVER BECOMES ZERO ============================

const UNPRICED_LOT = Object.freeze({
  lotId: "lot-unpriced",
  operatingCompanyId: "taylor",
  partId: "part-1",
  quantity: 5,
  unitPriceMinor: null,
  currency: null,
  receivedAtMillis: 3_000,
});

test("EVERY policy preserves UNKNOWN -- and the result carries no number to misread", () => {
  for (const p of [TEST_POLICY_WEIGHTED_AVERAGE, TEST_POLICY_FIFO]) {
    const r = relieveInventoryCost({ profile: p, lots: [...PHYSICAL_HISTORY, UNPRICED_LOT], reliefs: RELIEVE_5 });
    assert.equal(r.relievedCost.state, "UNKNOWN", p.inventoryCostMethod);
    assert.equal(r.remainingValue.state, "UNKNOWN", p.inventoryCostMethod);
    assert.equal("amountMinor" in r.relievedCost, false, "an UNKNOWN figure must carry no amount at all");
    assert.equal("amountMinor" in r.remainingValue, false);
    assert.deepEqual([...r.relievedCost.unpricedLotIds], ["lot-unpriced"], "the answer names what it is missing");
    // The physical quantity is still known and still correct.
    assert.equal(r.remainingQuantity, 20);
  }
});

test("a pool with no governed cost at all is UNKNOWN, not $0", () => {
  const r = relieveInventoryCost({
    profile: TEST_POLICY_WEIGHTED_AVERAGE,
    lots: [UNPRICED_LOT],
    reliefs: [{ quantity: 1 }],
  });
  assert.equal(r.relievedCost.state, "UNKNOWN");
  assert.match(r.relievedCost.reason, /no lot in this pool carries a governed cost/);
});

test("SPECIFIC_IDENTIFICATION preserves UNKNOWN for an unpriced identified unit", () => {
  const lots = [
    { lotId: "s-1", operatingCompanyId: "t", partId: "m", quantity: 1, unitPriceMinor: null, currency: null, receivedAtMillis: 1, serialNo: "SN-A" },
  ];
  const r = relieveInventoryCost({
    profile: TEST_POLICY_SPECIFIC_IDENTIFICATION,
    lots,
    reliefs: [{ quantity: 1, serialNo: "SN-A" }],
    serialized: true,
  });
  assert.equal(r.relievedCost.state, "UNKNOWN");
  assert.equal("amountMinor" in r.relievedCost, false);
});

// ============================ COMPANY PARTITION + MONEY DISCIPLINE ============================

test("a cost pool never spans operating companies", () => {
  const mixed = [
    PHYSICAL_HISTORY[0],
    { ...PHYSICAL_HISTORY[1], operatingCompanyId: "ventana" },
  ];
  assert.throws(
    () => relieveInventoryCost({ profile: TEST_POLICY_WEIGHTED_AVERAGE, lots: mixed, reliefs: RELIEVE_5 }),
    (e) => e instanceof CostEngineError && e.code === "COMPANY_MIXED",
  );
});

test("a cost pool never mixes currencies or parts", () => {
  assert.throws(
    () =>
      relieveInventoryCost({
        profile: TEST_POLICY_WEIGHTED_AVERAGE,
        lots: [PHYSICAL_HISTORY[0], { ...PHYSICAL_HISTORY[1], currency: "CAD" }],
        reliefs: RELIEVE_5,
      }),
    (e) => e instanceof CostEngineError && e.code === "CURRENCY_MIXED",
  );
  assert.throws(
    () =>
      relieveInventoryCost({
        profile: TEST_POLICY_WEIGHTED_AVERAGE,
        lots: [PHYSICAL_HISTORY[0], { ...PHYSICAL_HISTORY[1], partId: "other" }],
        reliefs: RELIEVE_5,
      }),
    (e) => e instanceof CostEngineError && e.code === "PART_MIXED",
  );
});

test("floating-point money is refused, not rounded", () => {
  assert.throws(
    () =>
      relieveInventoryCost({
        profile: TEST_POLICY_WEIGHTED_AVERAGE,
        lots: [{ ...PHYSICAL_HISTORY[0], unitPriceMinor: 19.99 }],
        reliefs: [{ quantity: 1 }],
      }),
    (e) => e instanceof CostEngineError && e.code === "LOT_MALFORMED",
  );
});

test("relieving more than exists is refused -- EOS does not invent cost to close the arithmetic", () => {
  assert.throws(
    () =>
      relieveInventoryCost({
        profile: TEST_POLICY_WEIGHTED_AVERAGE,
        lots: PHYSICAL_HISTORY,
        reliefs: [{ quantity: 21 }],
      }),
    (e) => e instanceof CostEngineError && e.code === "INSUFFICIENT_QUANTITY",
    "this is the negative-inventory boundary: the financial engine refuses rather than clamping",
  );
});

test("the engine is deterministic and never mutates its inputs", () => {
  const lots = PHYSICAL_HISTORY.map((l) => ({ ...l }));
  const before = JSON.stringify(lots);
  const a = relieveInventoryCost({ profile: TEST_POLICY_FIFO, lots, reliefs: RELIEVE_5 });
  const b = relieveInventoryCost({ profile: TEST_POLICY_FIFO, lots, reliefs: RELIEVE_5 });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(lots), before);
});

test("no supported method name leaks a Taylor-specific default", () => {
  // The engine must not be reachable without a configured profile, and no method is "the" method.
  assert.equal(INVENTORY_COST_METHODS.length, 2);
  assert.equal(SERIALIZED_COST_METHODS.includes("SPECIFIC_IDENTIFICATION"), true);
  const src = validateFinancialPolicyProfile.toString() + relieveInventoryCost.toString();
  assert.equal(/taylor|ventana/i.test(src), false, "no customer may be named in the engine or the validator");
});

// ============================ CLIENT MIRROR PARITY ============================
//
// No shared/monorepo tooling exists in this repo, so the screen carries its own copy of the
// vocabulary (the same "duplicate and prove parity" convention every access/ mirror pair uses). This
// diffs the two structurally, so the screen can never offer a method the engine does not implement,
// nor hide a block the backend enforces.

const clientView = await import("../../field-ops-app-vite/src/domain/financialPolicyView.js");

test("PARITY: the screen offers exactly the interchangeable methods the engine implements", () => {
  assert.deepEqual(
    clientView.INVENTORY_COST_METHODS.map((m) => m.id),
    [...INVENTORY_COST_METHODS],
  );
});

test("PARITY: the screen offers exactly the serialized methods the engine implements", () => {
  assert.deepEqual(
    clientView.SERIALIZED_COST_METHODS.map((m) => m.id),
    [...SERIALIZED_COST_METHODS],
  );
});

test("PARITY: recognition points, availability and blocked reasons match the backend exactly", () => {
  assert.deepEqual(
    clientView.COGS_RECOGNITION_POINTS.map((p) => ({
      id: p.id,
      available: p.available,
      blockedReason: p.blockedReason,
    })),
    COGS_RECOGNITION_POINTS.map((p) => ({
      id: p.id,
      available: p.available,
      blockedReason: p.blockedReason,
    })),
    "a screen that hid a block, or offered an unavailable point, would promise what the backend refuses",
  );
});

test("PARITY: the invariants the screen states are the invariants the platform holds", () => {
  assert.deepEqual(
    clientView.PLATFORM_INVARIANTS.map((i) => ({ id: i.id, statement: i.statement })),
    PLATFORM_INVARIANTS.map((i) => ({ id: i.id, statement: i.statement })),
  );
});
