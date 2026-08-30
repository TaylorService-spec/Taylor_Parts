// THE GOLDEN SCENARIOS, STATED BEFORE THE WORLD EXISTS.
//
// ============================ THE CIRCULARITY THIS ENDS ============================
//
// buildGoldenManifest.mjs opens Firestore and reads every quantity back through readPartBalance and
// readPurchaseOrderProgress. Its own header says so plainly: "Every quantity is read through
// readPartBalance and readPurchaseOrderProgress at build time. The manifest records what the world
// says." That is an honest description of a RECORDER, and a recorder cannot certify the world it
// records. If an applier regressed and left G04's stock in the warehouse instead of on the trucks,
// the manifest would faithfully record the wrong number and report success -- the scenario would
// still have a title, a question and an answer, and nothing would compare them to anything.
//
// So the expectation moves UPSTREAM of the world:
//
//   repository plan fixtures  ->  THIS MODULE (pure)  ->  expected figures
//                                                              |
//   scenario execution  ->  read-back  ->  compare  ->  PASS / FAIL
//
// The manifest becomes comparison evidence. This file becomes the source of truth, and changing an
// expected value now requires editing a plan fixture or this module -- a reviewable repository
// change -- rather than re-running a recorder against a world that has quietly drifted.
//
// ============================ ZERO I/O, AND WHY THAT IS THE POINT ============================
//
// Nothing here imports firebase-admin, opens a database, reads a clock, or calls a random source.
// Every import is a pure repository fixture, and the whole expectation is a function of them. That
// is what makes "the expected answer" a claim the repository makes rather than an observation of
// whatever Firestore happened to contain when somebody last ran a script.
//
// It is also what makes the guard testable in a process with no Firestore at all, which is asserted
// rather than assumed -- see certificationGoldenExpectation.test.mjs.
//
// ============================ THE KEY IS THE SCENARIO, NEVER THE WO NUMBER ============================
//
// buildGoldenManifest keys its scenarios on woNumber -- "WO-2026-000001" and friends. A pre-write
// expectation CANNOT do that, and the reason is recorded in demandPlan.mjs itself:
// createWorkOrderRecord "mints its own document id and WO number, so the fixture cannot name them."
//
// A hardcoded WO number is therefore an assumption about the order in which a counter happened to
// increment. It is true today and it is not derivable, so this module keys on the DEMAND SCENARIO
// KEY and its deterministic content tag, and carries the observed WO number only as a non-binding
// hint for humans. Resolving tag -> woNumber is the comparison step's job, at read-back time, when
// the minted number actually exists.
import { CERT_PARTS, reorderPointFor } from "./partsCatalog.mjs";
import { buildInventoryPlan, projectBalances } from "./inventoryPlan.mjs";
import { buildPurchasingPlan } from "./purchasingPlan.mjs";
import { DEMAND_SCENARIOS, GOLDEN_BY_SCENARIO, scenarioTag } from "./demandPlan.mjs";

/**
 * Version of the EXPECTATION, deliberately separate from the base world's dataset version.
 *
 * The base world (1092 records, fingerprint over accounts/contacts/parts/...) and the scenario
 * expectation describe different things: one is the data that is SEEDED, the other is what the
 * APPLIERS should produce on top of it. Sharing a version -- or worse, a fingerprint -- would make a
 * scenario change look like a dataset change and vice versa, and would let a green base-world
 * verification imply a scenario guarantee it never made.
 */
export const GOLDEN_EXPECTATION_VERSION = "1.0.0";

/** Part lookup by id. Built once; CERT_PARTS is frozen and index-ordered. */
const PART_BY_ID = new Map(CERT_PARTS.map((p) => [p.partId, p]));

// ============================ THE COVERAGE REGISTER ============================
//
// EVERY scenario buildGoldenManifest declares. Stated here so the gap between "scenarios that
// exist" and "scenarios with a pre-write expectation" is a NAMED, reviewable fact instead of
// something a reader has to notice by counting two lists in different files.
//
// This matters because the obvious failure of a partial guard is silence. If a twelfth scenario
// were added to the manifest and this module knew nothing about it, the expectation would still
// build, still fingerprint, and still pass -- certifying eleven scenarios while appearing to
// certify twelve. certificationGoldenExpectation.test.mjs asserts this list matches what the
// manifest actually declares, so adding a scenario forces a decision about it rather than
// inheriting a pass.
export const MANIFEST_GOLDEN_IDS = Object.freeze([
  "G01", "G02", "G03", "G04", "G05", "G06", "G07", "G08", "G09", "G10", "G11",
]);

/**
 * Scenarios NOT yet under pre-write expectation, each with the reason it is not.
 *
 * RECORDED RATHER THAN QUIETLY OMITTED. Every one of these is a scenario whose truth is produced by
 * a runner rather than by the demand plan, so deriving it purely means first giving that runner a
 * declarative plan input -- real work, and separate work. Writing them down as a known limitation is
 * honest; leaving them out of both lists would have made the guard look complete.
 */
export const UNCOVERED_GOLDEN_IDS = Object.freeze({
  G06: "transfer recovery -- produced by runG06TransferRecovery; truth lives in its evidence file",
  G07: "cycle variance -- no work order at all; truth lives in g07-cycle-variance.json",
  G08: "return lifecycle -- no work order; truth lives in return-scenarios.json",
  G09: "inbound insufficient -- work order created outside DEMAND_SCENARIOS' golden mapping",
  G10: "repeat equipment failure -- a question about work-order history, not about part balances",
  G11: "dense customer -- a question about equipment spread, not about part balances",
});

/** The scenarios this module DOES state before the world exists, derived from GOLDEN_BY_SCENARIO. */
export const COVERED_GOLDEN_IDS = Object.freeze(
  [...new Set(Object.values(GOLDEN_BY_SCENARIO))].sort(),
);

/**
 * Inbound quantity per part, from the PURCHASING PLAN rather than from a purchase-order read.
 *
 * This is the plan's INTENT: what the world is supposed to have on order before any receiving has
 * happened. It is deliberately not "what is still outstanding" -- that is a function of receipts,
 * which are scenario execution, and belongs on the read-back side of the comparison. G03 and G05
 * are the same shape at two different moments precisely because receipts move one of them.
 */
function plannedInboundByPart() {
  const inbound = new Map();
  for (const order of buildPurchasingPlan()) {
    for (const item of order.items ?? []) {
      inbound.set(item.partId, (inbound.get(item.partId) ?? 0) + (item.quantity ?? 0));
    }
  }
  return inbound;
}

/**
 * The expected position of one planned part line, derived end to end from the plan fixtures.
 *
 * warehouse / truck / company come from projectBalances over buildInventoryPlan -- the SAME pure
 * functions the applier stages its movements from, so this is the plan's own arithmetic rather than
 * a second opinion about it. A part the plan never stocks is a genuine zero here, not a gap.
 */
function expectedLine(planLine, balances, inbound) {
  const part = PART_BY_ID.get(planLine.partId) ?? null;
  const planned = planLine.qtyPlanned ?? 0;
  const warehouse = balances.warehouse.get(planLine.partId) ?? 0;
  const mobile = balances.truck.get(planLine.partId) ?? 0;
  const company = balances.company.get(planLine.partId) ?? 0;
  const plannedInbound = inbound.get(planLine.partId) ?? 0;

  return Object.freeze({
    partId: planLine.partId,
    planned,
    warehouse,
    mobile,
    company,
    // NULL IS NOT ZERO, and the distinction is load-bearing. G02's whole lesson is that "nothing is
    // on order" must not be reported as a measured inbound of zero: one is a fact, the other is a
    // fact nobody established. The read-back expresses the same thing as inboundState UNKNOWN.
    plannedInbound: plannedInbound > 0 ? plannedInbound : null,
    warehouseShortage: Math.max(0, planned - warehouse),
    companyShortage: Math.max(0, planned - company),
    // Whether the reorder threshold is even relevant to this line, so a scenario that depends on a
    // part sitting just under its own threshold fails loudly if the catalog moves the threshold.
    reorderPoint: part ? reorderPointFor(part) : null,
  });
}

/**
 * The complete pre-write expectation for every golden demand scenario.
 *
 * PURE and DETERMINISTIC: called twice in the same process, or in two processes with no Firestore
 * anywhere, it returns the same structure and the same fingerprint.
 *
 * Only the demand scenarios that BACK a golden lifecycle appear. GOLDEN_BY_SCENARIO is the existing
 * repository mapping and is used as-is rather than restated here -- a second list would be a second
 * opinion about which scenarios are golden, and the two would drift.
 */
export function buildGoldenExpectation() {
  const balances = projectBalances(buildInventoryPlan());
  const inbound = plannedInboundByPart();

  const scenarios = [];
  for (const scenario of DEMAND_SCENARIOS) {
    const goldenId = GOLDEN_BY_SCENARIO[scenario.key];
    if (!goldenId) continue; // a demand scenario that backs no golden lifecycle

    const lines = (scenario.plan ?? []).map((l) => expectedLine(l, balances, inbound));
    scenarios.push(Object.freeze({
      goldenId,
      scenarioKey: scenario.key,
      // THE STABLE JOIN KEY. Deterministic from the scenario key; the applier stamps it on the work
      // order it creates, so the comparison can find the minted WO without knowing its number.
      scenarioTag: scenarioTag(scenario),
      lines: Object.freeze(lines),
      // Fulfillable from the WAREHOUSE, which is the question the Parts Room actually answers.
      // Company-wide sufficiency is a different question and G04 exists to keep them apart.
      fulfillable: lines.every((l) => l.warehouseShortage === 0),
      // Company stock exists but the warehouse cannot fill the job: G04's exact shape, derived
      // rather than declared, so a plan change that dissolves the scenario is visible here.
      falseComfort: lines.some((l) => l.warehouseShortage > 0 && l.companyShortage === 0),
    }));
  }

  scenarios.sort((a, b) => a.goldenId.localeCompare(b.goldenId));
  const frozen = Object.freeze(scenarios);
  return Object.freeze({
    version: GOLDEN_EXPECTATION_VERSION,
    scenarios: frozen,
    fingerprint: goldenExpectationFingerprint(frozen),
  });
}

/**
 * A fingerprint of the SCENARIO expectation, and nothing else.
 *
 * SEPARATE FROM THE BASE-WORLD FINGERPRINT ON PURPOSE. state.mjs's worldFingerprint covers the 1092
 * seeded records; this covers what the appliers should produce on top of them. Folding scenario
 * output into that hash would produce one number that means neither thing: a base-world drift and a
 * scenario regression would be indistinguishable, and every scenario run would change the
 * "dataset" fingerprint even though the dataset never moved.
 *
 * FNV-1a, matching state.mjs. Not cryptographic and does not need to be -- it detects change, it
 * does not resist an adversary, and a dependency-free hash keeps this module importable anywhere.
 */
export function goldenExpectationFingerprint(scenarios) {
  const rows = scenarios.map((s) => [
    s.goldenId,
    s.scenarioKey,
    s.fulfillable ? "F1" : "F0",
    s.falseComfort ? "C1" : "C0",
    ...s.lines.map((l) => [
      l.partId, l.planned, l.warehouse, l.mobile, l.company,
      l.plannedInbound === null ? "NULL" : l.plannedInbound,
      l.warehouseShortage, l.companyShortage, l.reorderPoint,
    ].join(":")),
  ].join("|")).sort();

  let h = 0x811c9dc5;
  for (const row of rows) {
    for (let i = 0; i < row.length; i += 1) {
      h ^= row.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return { hash: h.toString(16).padStart(8, "0"), rowCount: rows.length };
}

/**
 * Compare a read-back scenario against its expectation. FAILS CLOSED.
 *
 * Returns a list of human-readable differences; an empty list is a pass. A MISSING scenario or a
 * missing line is a difference, never a skip -- "we could not find it, so we did not check it" is
 * the failure mode that lets a broken applier report success.
 *
 * `observed` is the shape buildGoldenManifest already produces per scenario: { lines: [{ partId,
 * planned, warehouse, mobile, company, inbound, inboundState, warehouseShortage, companyShortage }],
 * fulfillable }.
 */
export function diffScenario(expected, observed) {
  const differences = [];
  if (!observed) return [`${expected.goldenId}: no observed scenario -- expected ${expected.lines.length} line(s)`];

  const observedByPart = new Map((observed.lines ?? []).map((l) => [l.partId, l]));
  for (const e of expected.lines) {
    const o = observedByPart.get(e.partId);
    if (!o) { differences.push(`${expected.goldenId} ${e.partId}: expected a planned line, observed none`); continue; }
    for (const field of ["planned", "warehouse", "mobile", "company", "warehouseShortage", "companyShortage"]) {
      if (o[field] !== e[field]) {
        differences.push(`${expected.goldenId} ${e.partId} ${field}: expected ${e[field]}, observed ${o[field]}`);
      }
    }
    // Inbound is compared through the KNOWN/UNKNOWN distinction rather than as a bare number,
    // because an unmeasured inbound and a measured zero are different claims and G02 turns on it.
    const observedInbound = o.inboundState === "KNOWN" ? o.inbound : null;
    if (e.plannedInbound === null && observedInbound !== null && observedInbound !== 0) {
      differences.push(`${expected.goldenId} ${e.partId} inbound: expected none planned, observed ${observedInbound}`);
    }
  }
  for (const o of observed.lines ?? []) {
    if (!expected.lines.some((e) => e.partId === o.partId)) {
      differences.push(`${expected.goldenId} ${o.partId}: observed an unexpected planned line`);
    }
  }
  if (typeof observed.fulfillable === "boolean" && observed.fulfillable !== expected.fulfillable) {
    differences.push(`${expected.goldenId} fulfillable: expected ${expected.fulfillable}, observed ${observed.fulfillable}`);
  }
  return differences;
}
