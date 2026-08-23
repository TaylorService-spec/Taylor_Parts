// WORK ORDER DEMAND — six business conditions, chosen from real balances.
//
// ============================ SCOPES ARE NOT INTERCHANGEABLE ============================
//
// Three different questions, three different numbers:
//
//   warehouseAvailable  can the Parts Room fulfil this job?      readPartBalance.available
//   mobileAvailable     how much is out on the trucks?           ledger, MOBILE locations
//   companyOwned        does the business own enough anywhere?    warehouse + mobile
//
// `readPartBalance` deliberately excludes truck stock -- "Physical stock at ACTIVE warehouses...
// Excludes truck/mobile stock by design". That is correct for what it answers, and it is why
// FALSE_COMFORT cannot be derived from one call: the condition is a COMPARISON between scopes.
// Code that reaches for a single "inventory" number will report those parts as ordinary REORDER,
// which is exactly the confusion the condition exists to expose.
//
// ============================ THE PARTS ARE CHOSEN FROM MEASURED STATE ============================
//
// Every part below was selected by reading the live balance, not by assuming a label. The comment
// on each line records the figures at selection time so a future reader can tell whether the
// scenario still means what it was built to mean.
//
// A scenario named FULLY_SATISFIABLE proves nothing. The class is DERIVED from the facts after the
// plan is applied, and the fixture's own name is never an input to that derivation.

/** Deterministic customer indices, so the same accounts get the same work every rebuild. */
const ACCT = (i) => `cw-acct-${String(i).padStart(4, "0")}`;

/**
 * The scenarios.
 *
 * `accountIndex` names WHICH customer; the applier resolves that customer's real location and
 * installed equipment from the seeded world. The plan names business intent, never a document id
 * the fixture could not have known -- the same separation the movement plan keeps for principals.
 */
// Pass 3 adds three scenarios that exist for different reasons from the six demand classes above:
// inbound that is real and insufficient, one machine that keeps coming back, and a customer with
// genuine depth. They live in their own module so the distinction stays visible.
import { PASS3_SCENARIOS } from "./pass3Scenarios.mjs";

export const DEMAND_SCENARIOS = Object.freeze([
  {
    key: "FULLY_SATISFIABLE",
    accountIndex: 0,
    complaint: "Unit not holding temperature; routine service call.",
    // wh 48 / 45, both far above the planned quantity.
    plan: [
      { partId: "CW-P-0501", qtyPlanned: 4 },
      { partId: "CW-P-0500", qtyPlanned: 3 },
    ],
  },
  {
    key: "PARTIALLY_CONSTRAINED",
    accountIndex: 7,
    complaint: "Intermittent shutdown; requires seal kit and valve replacement.",
    // CW-P-0502 wh 36 covers 5. CW-P-0002 wh 7 cannot cover 12 -- one line each way, which is the
    // whole point: a job that is neither fully blocked nor ready to run.
    plan: [
      { partId: "CW-P-0502", qtyPlanned: 5 },
      { partId: "CW-P-0002", qtyPlanned: 12 },
    ],
  },
  {
    key: "UNSATISFIED",
    accountIndex: 12,
    complaint: "Ice thickness sensor failure; machine offline.",
    // CW-P-0301: warehouse 0, trucks 0, no inbound. A genuine dead end -- nothing anywhere and
    // nothing coming. Without one of these, every shortage in the world would have a way out.
    plan: [{ partId: "CW-P-0301", qtyPlanned: 3 }],
  },
  {
    key: "FALSE_COMFORT_TRUCK_ONLY",
    accountIndex: 19,
    complaint: "Compressor will not start; relay replacement across site units.",
    // CW-P-0004: warehouse 8, trucks 36, company 44. Planned 20 sits ABOVE the warehouse figure and
    // BELOW the company figure -- so the business owns plenty and the Parts Room still cannot fill
    // the job. Company-wide stock must not answer a warehouse-fulfilment question.
    plan: [{ partId: "CW-P-0004", qtyPlanned: 20 }],
  },
  {
    key: "LOW_STOCK_WITH_INBOUND_PO",
    accountIndex: 26,
    complaint: "Refrigerant circuit service; filter drier replacement.",
    // CW-P-0003: warehouse 8, planned 15, and a canonical SENT order carrying 18 outstanding.
    // Short today, covered soon -- which is a different operational answer from a bare shortage.
    plan: [{ partId: "CW-P-0003", qtyPlanned: 15 }],
  },
  {
    key: "LOW_STOCK_WITHOUT_PO",
    accountIndex: 33,
    complaint: "Water pump replacement; unit leaking.",
    // CW-P-0303: warehouse 7, planned 12, nothing on order and nothing on a truck. The true
    // procurement-attention case, and the control that makes the inbound scenario meaningful.
    plan: [{ partId: "CW-P-0303", qtyPlanned: 12 }],
  },
  {
    key: "GOLDEN_INBOUND_RECOVERY",
    accountIndex: 41,
    complaint: "Evaporator fan motor failure; unit down pending parts.",
    // CW-P-0000: warehouse 0 against a canonical SENT order of 20.
    //
    // Planned 12 is chosen so the lifecycle actually moves through three distinct states rather
    // than two: after a partial receipt of 8 the warehouse holds 8 and the job is STILL short, and
    // only the remaining 12 makes it fulfillable. A plan the first receipt satisfied would prove
    // nothing about partial recovery.
    plan: [{ partId: "CW-P-0000", qtyPlanned: 12 }],
  },
  // ── G06 TRANSFER RECOVERY ───────────────────────────────────────────────────────────────────
  //
  // ITS OWN SCENARIO, NOT G04's. Only one work order in this world had a warehouse shortage backed
  // by truck stock, and it is G04 -- the FALSE_COMFORT case. Recovering that one through a transfer
  // would have demonstrated G06 by DESTROYING G04: the demand-class invariant requires
  // FALSE_COMFORT_TRUCK_ONLY to be non-empty, and it would have been the only member.
  //
  // So G06 uses the OTHER false-comfort part. Same shape, different job, and the two Golden
  // scenarios now say genuinely different things:
  //
  //   G04  the trap  -- the company owns plenty and the Parts Room still cannot fill the job
  //   G06  the fix   -- an authorized transfer moves it to where it can be picked
  //
  // CW-P-0305 holds warehouse 8 against 24 on trucks, so the shortage is real and the recovery is
  // available. The planned quantity is deliberately above warehouse and below company.
  {
    key: "TRANSFER_RECOVERY",
    accountIndex: 17,
    complaint: "Bin level sensor intermittent; unit over-filling.",
    plan: [{ partId: "CW-P-0305", qtyPlanned: 14 }],
  },
  ...PASS3_SCENARIOS,
]);

/** Golden lifecycle each scenario backs, where it backs one. */
export const GOLDEN_BY_SCENARIO = Object.freeze({
  FULLY_SATISFIABLE: "G01",
  LOW_STOCK_WITHOUT_PO: "G02",
  GOLDEN_INBOUND_RECOVERY: "G03",
  FALSE_COMFORT_TRUCK_ONLY: "G04",
  LOW_STOCK_WITH_INBOUND_PO: "G05",
});

/** The customer a scenario belongs to. */
export function accountIdFor(scenario) {
  return ACCT(scenario.accountIndex);
}

/**
 * Deterministic Work Order identity for a scenario.
 *
 * Used only to recognise an already-created Work Order on a re-run: createWorkOrderRecord mints its
 * own document id and WO number, so the fixture cannot name them. This is the content key, not the
 * stored id -- the same shape the purchasing applier needs for the same reason.
 */
export function scenarioTag(scenario) {
  return `cw-demand-${scenario.key.toLowerCase().replace(/_/g, "-")}`;
}
