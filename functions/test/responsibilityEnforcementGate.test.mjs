// THE RESPONSIBILITY GATE — composed, and the composition is what is under test.
//
// ════════════════════ WHAT IS WORTH PROVING ════════════════════
//
//   1. THE TWO AXES COMPOSE WITHOUT COLLAPSING. Each verdict is carried whole, every defect is tagged
//      with its axis, and there is NO combined `blocking` number. An ownership defect can never be
//      reported as an accountability one or vice versa. #180, #187 §1.
//   2. A NOT APPLICABLE FAMILY DOES NOT FAIL THE GATE FOR LACKING STORAGE. #189 `OD-16`. Proved with a
//      real ownership census over families that carry no accountability at all.
//   3. HISTORICAL VALIDITY (#186). A person who becomes INACTIVE/TERMINATED/RETIRED remains a valid
//      historical reference and does NOT fail the gate; on a CURRENT ACTIONABLE record the same person
//      IS a responsibility defect with its own code. No auto-reassign and no auto-transfer anywhere.
//   4. FAIL CLOSED. An unobtainable answer on either axis makes the gate unenforceable regardless of
//      how few record-level defects were found. #187 §2.
//   5. IT CANNOT PASS BY NOT LOOKING. A family in scope that was never censused, and an empty
//      accountability census, are both defects.
import test from "node:test";
import assert from "node:assert/strict";

import {
  RESPONSIBILITY_GATE_AXES,
  defectsForAxis,
  responsibilityEnforcementGate,
} from "../lib/responsibility/responsibilityEnforcementGate.js";
import {
  accountabilityNotApplicable,
  censusAccountabilityFamily,
} from "../lib/responsibility/accountabilityCensus.js";
import { ACCOUNTABILITY_FAMILIES, ACCOUNTABLE_PERSON_FIELD } from "../lib/responsibility/accountablePersonStorage.js";
import { censusFamily, CENSUS_FAMILIES, ALL_FAMILIES } from "../lib/ownership/ownershipCensus.js";

const TENANT = "tenant-a";

/** ACTIVE and CONTRACTOR eligible. Not `["ACTIVE"]` — see the census suite's note on why. */
const POLICY = Object.freeze({
  policyId: "WAVE2C-GATE-POLICY",
  eligibleStatuses: Object.freeze(["ACTIVE", "CONTRACTOR"]),
});

const PEOPLE = Object.freeze({
  "emp-active": "ACTIVE",
  "emp-contractor": "CONTRACTOR",
  "emp-on-leave": "ON_LEAVE",
  "emp-inactive": "INACTIVE",
  "emp-terminated": "TERMINATED",
  "emp-retired": "RETIRED",
});

function employeeAuthority({ unavailable = [] } = {}) {
  return {
    async resolveEmployeeReference(reference) {
      if (unavailable.includes(reference.employeeId)) {
        return {
          outcome: "AUTHORITY_UNAVAILABLE",
          reference,
          reason: "AUTHORITY_READ_FAILED",
          detail: "the server is down",
        };
      }
      const status = PEOPLE[reference.employeeId];
      if (status === undefined) return { outcome: "NOT_FOUND", reference };
      return {
        outcome: "RESOLVED",
        reference,
        employee: {
          employeeId: reference.employeeId,
          tenantId: reference.tenantId,
          employmentStatus: status,
          operatingCompanyId: "taylor",
        },
      };
    },
  };
}

const deps = (options) => ({ employeeAuthority: employeeAuthority(options), eligibilityPolicy: POLICY });

/** Census all three admitted families, each with the given documents. */
async function accountabilityFor(documentsByFamily, options) {
  const entries = [];
  for (const family of ACCOUNTABILITY_FAMILIES) {
    entries.push(
      await censusAccountabilityFamily(deps(options), family, TENANT, documentsByFamily[family] ?? []),
    );
  }
  return entries;
}

/** A healthy ownership census over one PERSON-owned family. */
function healthyOwnership() {
  const family = CENSUS_FAMILIES.find((f) => f.family === "opportunity");
  return [censusFamily(family, [{ id: "o1", data: { ownerEmployeeId: "emp-active" } }])];
}

const open = (extra) => ({ stage: "DECISION", outcome: null, state: "DRAFT", ...extra });
const closed = (extra) => ({ stage: "DECISION", outcome: "WON", state: "ACCEPTED", ...extra });

// ════════════════════ 1. THE HEALTHY CASE, AND IT IS NOT VACUOUS ════════════════════

test("both axes healthy over REAL populated censuses is ENFORCEABLE", async () => {
  const accountability = await accountabilityFor({
    opportunity: [{ id: "o1", data: open({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) }],
    salesAgreement: [{ id: "a1", data: open({ [ACCOUNTABLE_PERSON_FIELD]: "emp-contractor" }) }],
    salesOrder: [{ id: "s1", data: open({ state: "CONFIRMED", [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) }],
  });
  const verdict = responsibilityEnforcementGate({ ownership: healthyOwnership(), accountability });
  assert.deepEqual(verdict.defects, []);
  assert.equal(verdict.failClosed, false);
  assert.equal(verdict.enforceable, true);
  // NON-VACUOUS: the gate saw real records on both axes.
  assert.equal(verdict.ownership.totals.resolved, 1);
  assert.equal(verdict.accountability.totals.presentValidEligible, 3);
  assert.equal(verdict.accountability.measuredFamilies, 3);
});

test("THE GATE SEES REAL POPULATED RECORDS — an empty accountability census is NOT enforceable", () => {
  const verdict = responsibilityEnforcementGate({ ownership: healthyOwnership(), accountability: [] });
  assert.equal(verdict.enforceable, false);
  const codes = defectsForAxis(verdict, "ACCOUNTABILITY").map((d) => d.code);
  assert.ok(codes.includes("ACCOUNTABILITY_CENSUS_EMPTY"));
  assert.ok(codes.includes("ACCOUNTABILITY_FAMILY_NOT_CENSUSED"));
  // And the ownership axis is untouched by that: it was healthy and is reported healthy.
  assert.deepEqual(defectsForAxis(verdict, "RECORD_OWNERSHIP"), []);
});

test("a family IN scope that was never censused is a defect, naming it", async () => {
  const entries = [
    await censusAccountabilityFamily(deps(), "opportunity", TENANT, [
      { id: "o1", data: open({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) },
    ]),
  ];
  const verdict = responsibilityEnforcementGate({ ownership: healthyOwnership(), accountability: entries });
  const gap = defectsForAxis(verdict, "ACCOUNTABILITY").find(
    (d) => d.code === "ACCOUNTABILITY_FAMILY_NOT_CENSUSED",
  );
  assert.ok(gap, "the gate passed over two uncensused in-scope families");
  assert.deepEqual([...gap.families].sort(), ["salesAgreement", "salesOrder"]);
  assert.equal(verdict.enforceable, false);
});

// ════════════════════ 2. COMPOSED, NOT COLLAPSED ════════════════════

test("#187 §1: there is NO combined blocking number, and every defect names its axis", async () => {
  const ownership = [
    censusFamily(
      CENSUS_FAMILIES.find((f) => f.family === "opportunity"),
      [{ id: "o1", data: {} }, { id: "o2", data: { ownerEmployeeId: 7 } }],
    ),
  ];
  const accountability = await accountabilityFor({
    opportunity: [{ id: "o1", data: open({}) }],
    salesAgreement: [{ id: "a1", data: open({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) }],
    salesOrder: [{ id: "s1", data: open({ state: "CONFIRMED", [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) }],
  });
  const verdict = responsibilityEnforcementGate({ ownership, accountability });

  // The two verdicts are carried WHOLE and remain separately readable.
  assert.equal(verdict.ownership.blocking, 2);
  assert.equal(verdict.accountability.blocking, 1);
  // And there is NO top-level number that adds them. A summed count would tell an operator that three
  // things are wrong and nothing about whether to transfer a relationship or hand off a deal.
  assert.ok(!("blocking" in verdict), "the gate exposes a combined blocking count");
  assert.equal(typeof verdict.enforceable, "boolean", "the only combined value is the boolean");

  for (const d of verdict.defects) {
    assert.ok(RESPONSIBILITY_GATE_AXES.includes(d.axis), `${d.code} carries no governed axis`);
    // The codes are disjoint by prefix, so a reader can tell the axis from the code alone.
    assert.equal(d.axis === "RECORD_OWNERSHIP", d.code.startsWith("OWNERSHIP_"));
    assert.equal(d.axis === "ACCOUNTABILITY", d.code.startsWith("ACCOUNTABILITY_"));
  }
  assert.equal(defectsForAxis(verdict, "RECORD_OWNERSHIP").length, 1);
  assert.equal(defectsForAxis(verdict, "ACCOUNTABILITY").length, 1);
});

test("an OWNERSHIP defect alone never produces an accountability code, and vice versa", async () => {
  const healthyAccountability = await accountabilityFor({
    opportunity: [{ id: "o1", data: open({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) }],
    salesAgreement: [{ id: "a1", data: open({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) }],
    salesOrder: [{ id: "s1", data: open({ state: "CONFIRMED", [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) }],
  });
  const brokenOwnership = [
    censusFamily(CENSUS_FAMILIES.find((f) => f.family === "opportunity"), [{ id: "o1", data: {} }]),
  ];
  const ownerOnly = responsibilityEnforcementGate({
    ownership: brokenOwnership,
    accountability: healthyAccountability,
  });
  assert.deepEqual(defectsForAxis(ownerOnly, "ACCOUNTABILITY"), []);
  assert.equal(ownerOnly.enforceable, false);

  const accountabilityOnly = responsibilityEnforcementGate({
    ownership: healthyOwnership(),
    accountability: await accountabilityFor({
      opportunity: [{ id: "o1", data: open({}) }],
      salesAgreement: [{ id: "a1", data: open({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) }],
      salesOrder: [{ id: "s1", data: open({ state: "CONFIRMED", [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) }],
    }),
  });
  assert.deepEqual(defectsForAxis(accountabilityOnly, "RECORD_OWNERSHIP"), []);
  assert.equal(accountabilityOnly.enforceable, false);
});

// ════════════════════ 3. NOT APPLICABLE MUST NOT FAIL THE GATE ════════════════════

test("#189 OD-16: families with NO accountability storage do not fail the gate for lacking it", async () => {
  // A REAL ownership census over the families that are NOT in accountability scope, every one of them
  // ownership-healthy. If the gate required coverage parity between the two censuses, this would fail.
  const admitted = new Set(ACCOUNTABILITY_FAMILIES);
  const outside = CENSUS_FAMILIES.filter((f) => !admitted.has(f.family));
  assert.ok(outside.length > 15, "the ownership census should cover many non-accountability families");

  const ownership = outside.map((family) =>
    censusFamily(family, [
      {
        id: `${family.family}-1`,
        data:
          family.ownerClass === "PERSON"
            ? family.ownerFields.includes("accountOwner")
              ? { accountOwner: { type: "USER", id: "emp-active" } }
              : family.ownerFields.includes("owner")
                ? { owner: { type: "USER", id: "emp-active" } }
                : { ownerEmployeeId: "emp-active" }
            : { operatingCompanyId: "taylor" },
      },
    ]),
  );

  // The accountability census reports each of them NOT APPLICABLE, plus the three in scope, healthy.
  const accountability = [
    ...outside.map((f) => accountabilityNotApplicable(f.family)),
    ...(await accountabilityFor({
      opportunity: [{ id: "o1", data: open({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) }],
      salesAgreement: [{ id: "a1", data: open({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) }],
      salesOrder: [{ id: "s1", data: open({ state: "CONFIRMED", [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) }],
    })),
  ];

  const verdict = responsibilityEnforcementGate({ ownership, accountability });
  // NOT APPLICABLE families are NAMED and contribute NOTHING.
  assert.equal(verdict.accountabilityNotApplicable.length, outside.length);
  for (const d of verdict.defects) {
    for (const family of outside) {
      assert.ok(
        !d.families.includes(family.family),
        `${family.family} appears in defect ${d.code} merely for having no accountability storage. ` +
          "#189 OD-16: that is NOT APPLICABLE -- not MISSING, not OWNERLESS, not DEFECTIVE.",
      );
    }
  }
  assert.deepEqual(defectsForAxis(verdict, "ACCOUNTABILITY"), []);
});

test("a NOT APPLICABLE family contributes nothing even when its records are ownership-broken", async () => {
  // The ownership axis reports the defect; the accountability axis says nothing at all about it.
  const supplier = CENSUS_FAMILIES.find((f) => f.family === "equipment");
  const ownership = [censusFamily(supplier, [{ id: "e1", data: {} }])];
  const accountability = [
    accountabilityNotApplicable("equipment"),
    ...(await accountabilityFor({
      opportunity: [{ id: "o1", data: open({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) }],
      salesAgreement: [{ id: "a1", data: open({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) }],
      salesOrder: [{ id: "s1", data: open({ state: "CONFIRMED", [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) }],
    })),
  ];
  const verdict = responsibilityEnforcementGate({ ownership, accountability });
  assert.ok(verdict.ownership.blocking > 0, "the ownership axis should have found the ownerless record");
  assert.deepEqual(defectsForAxis(verdict, "ACCOUNTABILITY"), []);
  assert.ok(verdict.accountabilityNotApplicable.includes("equipment"));
});

test("every family the accountability scope excludes is reported NOT APPLICABLE, never as a finding", () => {
  const admitted = new Set(ACCOUNTABILITY_FAMILIES);
  for (const family of ALL_FAMILIES) {
    if (admitted.has(family.family)) continue;
    const report = accountabilityNotApplicable(family.family);
    assert.equal(report.scope, "NOT_APPLICABLE");
    assert.ok(!("counts" in report), `${family.family}'s NOT APPLICABLE report carries a count`);
  }
});

// ════════════════════ 4. HISTORICAL VALIDITY (#186) ════════════════════

test("#186 §7: a person who later becomes INACTIVE/TERMINATED/RETIRED does NOT fail the gate on history", async () => {
  for (const former of ["emp-inactive", "emp-terminated", "emp-retired"]) {
    const accountability = await accountabilityFor({
      opportunity: [{ id: "won", data: closed({ [ACCOUNTABLE_PERSON_FIELD]: former }) }],
      salesAgreement: [{ id: "accepted", data: closed({ [ACCOUNTABLE_PERSON_FIELD]: former }) }],
      salesOrder: [{ id: "closed", data: { state: "CLOSED", [ACCOUNTABLE_PERSON_FIELD]: former } }],
    });
    const verdict = responsibilityEnforcementGate({ ownership: healthyOwnership(), accountability });
    assert.deepEqual(
      defectsForAxis(verdict, "ACCOUNTABILITY"),
      [],
      `${former} on HISTORICAL records produced a defect. #186 §7: historical accountability remains ` +
        "valid when the Employee later becomes inactive, terminated or former. Do not rewrite history.",
    );
    assert.equal(verdict.enforceable, true);
    // MEASURED, though — the census can see it, which is what #186 §9 requires.
    assert.equal(verdict.accountability.historicalFindings, 3);
    assert.equal(verdict.accountability.totals.presentValidNotCurrentlyEligible, 3);
    // And the reference is NOT counted as invalid: it still resolves.
    assert.equal(verdict.accountability.totals.presentInvalid, 0);
  }
});

test("#186 §8 / #189 MI-ε: the SAME person on a CURRENT ACTIONABLE record IS a responsibility defect", async () => {
  for (const former of ["emp-inactive", "emp-terminated", "emp-retired", "emp-on-leave"]) {
    const accountability = await accountabilityFor({
      opportunity: [{ id: "open", data: open({ [ACCOUNTABLE_PERSON_FIELD]: former }) }],
      salesAgreement: [{ id: "draft", data: open({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) }],
      salesOrder: [{ id: "confirmed", data: { state: "CONFIRMED", [ACCOUNTABLE_PERSON_FIELD]: "emp-active" } }],
    });
    const verdict = responsibilityEnforcementGate({ ownership: healthyOwnership(), accountability });
    const codes = defectsForAxis(verdict, "ACCOUNTABILITY").map((d) => d.code);
    assert.deepEqual(
      codes,
      ["ACCOUNTABILITY_NOT_CURRENTLY_ELIGIBLE"],
      `${former} on an ACTIONABLE record did not surface as a responsibility defect`,
    );
    assert.equal(verdict.enforceable, false);
    // ITS OWN CODE, not folded into "invalid reference": the reference is valid and the defect is about
    // current responsibility.
    assert.ok(!codes.includes("ACCOUNTABILITY_REFERENCE_INVALID"));
    // And the detail says so, and says what must NOT happen.
    const d = defectsForAxis(verdict, "ACCOUNTABILITY")[0];
    assert.match(d.detail, /REMAIN VALID/);
    assert.match(d.detail, /no automatic reassignment and no automatic transfer/);
  }
});

test("NO AUTO-REASSIGN, NO AUTO-TRANSFER: the gate has no mutation of any kind", async () => {
  // A gate that could repair a defect would be the automatic reassignment #189 MI-epsilon forbids. The
  // structural proof: it returns a verdict and touches nothing. The same censuses in, twice, give the
  // same verdict out, and the inputs are unchanged.
  const documents = { opportunity: [{ id: "open", data: open({ [ACCOUNTABLE_PERSON_FIELD]: "emp-terminated" }) }] };
  const accountability = await accountabilityFor(documents);
  const before = JSON.stringify(documents);
  const first = responsibilityEnforcementGate({ ownership: healthyOwnership(), accountability });
  const second = responsibilityEnforcementGate({ ownership: healthyOwnership(), accountability });
  assert.equal(JSON.stringify(documents), before, "the gate mutated the records it was measuring");
  assert.deepEqual(first.defects, second.defects, "the gate is not idempotent — it changed something");
  assert.equal(documents.opportunity[0].data[ACCOUNTABLE_PERSON_FIELD], "emp-terminated");
});

// ════════════════════ 5. EVERY ACCOUNTABILITY FAILURE MODE HAS ITS OWN CODE ════════════════════

test("missing · invalid · unreadable · ineligible each produce their OWN code", async () => {
  const cases = [
    [{}, "ACCOUNTABILITY_MISSING"],
    [{ [ACCOUNTABLE_PERSON_FIELD]: "emp-ghost" }, "ACCOUNTABILITY_REFERENCE_INVALID"],
    [{ [ACCOUNTABLE_PERSON_FIELD]: "  " }, "ACCOUNTABILITY_REFERENCE_UNREADABLE"],
    [{ [ACCOUNTABLE_PERSON_FIELD]: "emp-terminated" }, "ACCOUNTABILITY_NOT_CURRENTLY_ELIGIBLE"],
  ];
  for (const [fields, expected] of cases) {
    const accountability = await accountabilityFor({
      opportunity: [{ id: "open", data: open(fields) }],
      salesAgreement: [{ id: "draft", data: open({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) }],
      salesOrder: [{ id: "confirmed", data: { state: "CONFIRMED", [ACCOUNTABLE_PERSON_FIELD]: "emp-active" } }],
    });
    const verdict = responsibilityEnforcementGate({ ownership: healthyOwnership(), accountability });
    assert.deepEqual(
      defectsForAxis(verdict, "ACCOUNTABILITY").map((d) => d.code),
      [expected],
      `${JSON.stringify(fields)} produced the wrong code`,
    );
    assert.equal(verdict.enforceable, false);
  }
});

// ════════════════════ 6. FAIL CLOSED ════════════════════

test("#187 §2: AUTHORITY_UNAVAILABLE fails the gate CLOSED, with its own code", async () => {
  const accountability = await accountabilityFor(
    {
      opportunity: [{ id: "open", data: open({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) }],
      salesAgreement: [{ id: "draft", data: open({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) }],
      salesOrder: [{ id: "confirmed", data: { state: "CONFIRMED", [ACCOUNTABLE_PERSON_FIELD]: "emp-active" } }],
    },
    { unavailable: ["emp-active"] },
  );
  const verdict = responsibilityEnforcementGate({ ownership: healthyOwnership(), accountability });
  const codes = defectsForAxis(verdict, "ACCOUNTABILITY").map((d) => d.code);
  assert.deepEqual(codes, ["ACCOUNTABILITY_AUTHORITY_UNAVAILABLE"]);
  assert.equal(verdict.failClosed, true);
  assert.equal(verdict.enforceable, false);
  // NEVER converted: the invalid and missing counts stay at zero.
  assert.equal(verdict.accountability.totals.presentInvalid, 0);
  assert.equal(verdict.accountability.totals.missing, 0);
  const d = defectsForAxis(verdict, "ACCOUNTABILITY")[0];
  assert.match(d.detail, /NOT a finding that those people are missing or invalid/);
  assert.match(d.detail, /no other store may be consulted instead/);
});

test("#187 §2: an unobtainable answer on a HISTORICAL record ALSO fails closed", async () => {
  const accountability = await accountabilityFor(
    {
      opportunity: [{ id: "won", data: closed({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) }],
      salesAgreement: [{ id: "draft", data: open({ [ACCOUNTABLE_PERSON_FIELD]: "emp-contractor" }) }],
      salesOrder: [{ id: "confirmed", data: { state: "CONFIRMED", [ACCOUNTABLE_PERSON_FIELD]: "emp-contractor" } }],
    },
    { unavailable: ["emp-active"] },
  );
  const verdict = responsibilityEnforcementGate({ ownership: healthyOwnership(), accountability });
  assert.equal(
    verdict.failClosed,
    true,
    "an unobtainable answer on a WON record was exempted as history. We cannot know a record is history " +
      "if we could not read its person.",
  );
  assert.equal(verdict.enforceable, false);
});

test("an UNREADABLE or TRUNCATED family on EITHER axis fails the gate closed", async () => {
  const healthyAccountability = await accountabilityFor({
    opportunity: [{ id: "o1", data: open({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) }],
    salesAgreement: [{ id: "a1", data: open({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) }],
    salesOrder: [{ id: "s1", data: open({ state: "CONFIRMED", [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) }],
  });

  const ownershipUnreadable = responsibilityEnforcementGate({
    ownership: [
      ...healthyOwnership(),
      { family: "account", collection: "accounts", ownerClass: "PERSON", ownerType: "USER", error: "permission denied" },
    ],
    accountability: healthyAccountability,
  });
  assert.equal(ownershipUnreadable.failClosed, true);
  assert.equal(ownershipUnreadable.enforceable, false);
  assert.deepEqual(
    defectsForAxis(ownershipUnreadable, "RECORD_OWNERSHIP").map((d) => d.code),
    ["OWNERSHIP_CENSUS_UNREADABLE"],
  );

  const accountabilityUnreadable = responsibilityEnforcementGate({
    ownership: healthyOwnership(),
    accountability: [
      ...healthyAccountability,
      { family: "salesOrder", collection: "sales_orders", error: "index missing" },
    ],
  });
  assert.equal(accountabilityUnreadable.failClosed, true);
  assert.ok(
    defectsForAxis(accountabilityUnreadable, "ACCOUNTABILITY")
      .map((d) => d.code)
      .includes("ACCOUNTABILITY_CENSUS_UNREADABLE"),
  );

  const truncated = responsibilityEnforcementGate({
    ownership: healthyOwnership(),
    accountability: [
      await censusAccountabilityFamily(
        deps(),
        "opportunity",
        TENANT,
        [{ id: "o1", data: open({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) }],
        true,
      ),
      ...healthyAccountability.slice(1),
    ],
  });
  assert.equal(truncated.failClosed, true);
  assert.ok(
    defectsForAxis(truncated, "ACCOUNTABILITY")
      .map((d) => d.code)
      .includes("ACCOUNTABILITY_CENSUS_TRUNCATED"),
  );
});

test("a gate over NOTHING AT ALL is never enforceable", () => {
  const verdict = responsibilityEnforcementGate({ ownership: [], accountability: [] });
  assert.equal(
    verdict.enforceable,
    false,
    "the gate passed over two empty censuses. Every claim it makes would be vacuously true.",
  );
  assert.ok(defectsForAxis(verdict, "ACCOUNTABILITY").length > 0);
  // The ownership census's own gate already refuses an empty run this way; this asserts the composition
  // inherits it rather than overriding it.
  assert.equal(verdict.ownership.assessable, true, "censusGate's own empty-run behaviour is unchanged");
  assert.equal(verdict.accountability.assessable, false);
});

test("the gate itself computes no census — it reads two verdicts and returns a third", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, join, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(
    join(
      resolve(dirname(fileURLToPath(import.meta.url)), ".."),
      "src",
      "responsibility",
      "responsibilityEnforcementGate.ts",
    ),
    "utf8",
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // It must not classify a record, read a stored field, or resolve a person: a gate that measured could
  // disagree with the census it was composing.
  for (const forbidden of [
    "classifyDocument",
    "classifyAccountabilityRecord",
    "readStoredAccountablePerson",
    "resolveEmployeeReference",
    "censusAccountabilityFamily",
    "accountableEmployeeId",
  ]) {
    assert.ok(
      !code.includes(forbidden),
      `the gate calls ${forbidden}. It must COMPOSE two census results, not produce a third opinion.`,
    );
  }
  // And it has no write of any kind -- plain substring checks, so the needles stay readable.
  for (const forbidden of ["firebase", "firestore", "stage", "commit", ".set(", ".update(", "pg"]) {
    assert.ok(!code.toLowerCase().includes(forbidden), `the gate names ${forbidden}`);
  }
});
