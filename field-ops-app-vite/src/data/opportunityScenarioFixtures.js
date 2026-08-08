// SYNTHETIC Sales Opportunity scenario fixtures (clearly non-production). Opportunity is greenfield, so
// production-derived data cannot supply these — they are synthetic, and reference realistic-shaped Account/
// Equipment/Part identities (they will resolve against the sandbox fixture authorities once those are
// seeded; until then a customerName snapshot renders). Covers the ratified lifecycle stages + honest
// attention conditions + both channels + a Won and a Lost. IDs are SBX-OPP-* so nothing reads as real.
// expectedCloseAt values are fixed 2026 epoch-ms so the pipeline is deterministic under a fixed now.

const d = (y, mo, day) => new Date(y, mo - 1, day, 12, 0, 0, 0).getTime();

export const OPPORTUNITY_SCENARIO_FIXTURES = [
  {
    id: "SBX-OPP-1001", accountId: "SBX-ACCT-Harbor", customerName: "Harbor Grill Downtown",
    salesChannel: "RETAIL", ownerEmployeeId: "SBX-EMP-rivera", need: "Replace failed bar ice machine",
    lines: [{ kind: "EQUIPMENT_MODEL", ref: "Taylor-C723", qty: 1 }],
    expectedValue: 18500, stage: "QUOTING", expectedCloseAt: d(2026, 8, 20), nextAction: "Send revised quote",
  },
  {
    id: "SBX-OPP-1002", accountId: "SBX-ACCT-Northgate", customerName: "Northgate Grocery",
    salesChannel: "NATIONAL_ACCOUNTS", ownerEmployeeId: "SBX-EMP-lee", need: "Add two walk-in cooler units to remodel",
    lines: [{ kind: "EQUIPMENT_MODEL", ref: "WIC-8x10", qty: 2 }, { kind: "SERVICE", ref: "install", qty: 1 }],
    expectedValue: 42000, stage: "CUSTOMER_REVIEW", expectedCloseAt: d(2026, 8, 11), nextAction: "Follow up on proposal",
  },
  {
    id: "SBX-OPP-1003", accountId: "SBX-ACCT-Elm", customerName: "Elm Street Dental",
    salesChannel: "RETAIL", ownerEmployeeId: "SBX-EMP-rivera", need: "Sterilizer maintenance parts package",
    lines: [{ kind: "PART", ref: "PRT-1001", qty: 4 }],
    expectedValue: 900, stage: "DECISION", expectedCloseAt: d(2026, 8, 9), nextAction: "Confirm PO with office manager",
  },
  {
    id: "SBX-OPP-1004", accountId: "SBX-ACCT-Summit", customerName: "Summit Fitness",
    salesChannel: "NATIONAL_ACCOUNTS", ownerEmployeeId: "SBX-EMP-lee", need: "Evaluate replacement for aging equipment",
    lines: [], expectedValue: null, stage: "QUALIFYING", expectedCloseAt: d(2026, 9, 15), nextAction: "Schedule site survey",
  },
  {
    // attention: no next action on an active quote
    id: "SBX-OPP-1005", accountId: "SBX-ACCT-Bayside", customerName: "Bayside Cafe",
    salesChannel: "RETAIL", ownerEmployeeId: "SBX-EMP-rivera", need: "New soft-serve line for summer",
    lines: [{ kind: "EQUIPMENT_MODEL", ref: "Taylor-C723", qty: 1 }],
    expectedValue: 16000, stage: "QUOTING", expectedCloseAt: d(2026, 8, 25), nextAction: "",
  },
  {
    id: "SBX-OPP-1006", accountId: "SBX-ACCT-Metro", customerName: "Metro School District",
    salesChannel: "NATIONAL_ACCOUNTS", ownerEmployeeId: "SBX-EMP-lee", need: "Cafeteria refresh — multi-site",
    lines: [{ kind: "EQUIPMENT_MODEL", ref: "WIC-8x10", qty: 5 }],
    expectedValue: 120000, stage: "IDENTIFIED", expectedCloseAt: d(2026, 10, 1), nextAction: "Qualify budget and timeline",
  },
  {
    id: "SBX-OPP-1007", accountId: "SBX-ACCT-Harbor", customerName: "Harbor Grill Downtown",
    salesChannel: "RETAIL", ownerEmployeeId: "SBX-EMP-rivera", need: "Prior ice machine deal",
    lines: [{ kind: "EQUIPMENT_MODEL", ref: "Taylor-C723", qty: 1 }],
    expectedValue: 17500, stage: "DECISION", outcome: "WON", expectedCloseAt: d(2026, 7, 15), nextAction: null,
  },
  {
    id: "SBX-OPP-1008", accountId: "SBX-ACCT-Riverside", customerName: "Riverside Diner",
    salesChannel: "RETAIL", ownerEmployeeId: "SBX-EMP-lee", need: "Fryer replacement — chose competitor",
    lines: [{ kind: "EQUIPMENT_MODEL", ref: "FRY-40", qty: 1 }],
    expectedValue: 6000, stage: "DECISION", outcome: "LOST", expectedCloseAt: d(2026, 7, 20), nextAction: null,
  },
];

// A synthetic account-name map (canonical Account authority resolves these later). Keeps the projection's
// name resolution honest without embedding raw ids as the primary label.
export const OPPORTUNITY_ACCOUNT_NAMES = Object.fromEntries(
  OPPORTUNITY_SCENARIO_FIXTURES.map((o) => [o.accountId, o.customerName])
);
