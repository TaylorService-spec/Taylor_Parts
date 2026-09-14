// THE ACCOUNTABILITY CENSUS — dedicated, and it must not be able to lie in either direction.
//
// ════════════════════ WHAT IS WORTH PROVING ════════════════════
//
//   1. IT IS ITS OWN CENSUS (#187 §1 `MI-Y` option (ii)) — the three admitted families, measured with
//      their own buckets, and every other family reported NOT APPLICABLE with NO COUNTS AT ALL, so
//      there is no number that could be summed into a fake backlog.
//   2. THE SIX FACTS STAY SEPARATE. Present / valid / currently eligible / answer obtained /
//      actionable-or-historical / governed exception. A census that collapsed any pair would report a
//      defect as a non-defect, or the reverse.
//   3. `AUTHORITY_UNAVAILABLE` IS NEVER `INVALID` AND NEVER `MISSING` (#187 §2), and it blocks in BOTH
//      contexts — we cannot know a record is history if we could not read its person.
//   4. A HISTORICAL RECORD'S INELIGIBLE PERSON IS COUNTED AND DOES NOT BLOCK (#186 §7); the SAME
//      finding on an ACTIONABLE record DOES (#186 §8, #189 `MI-ε`).
//   5. IT SEES REAL RECORDS — the ones the real commercial builders produce through the governed
//      establishment, not hand-written fixtures shaped to match the classifier.
//   6. ZERO MEASURED FAMILIES IS NEVER ASSESSABLE. A gate that passed on an empty census would pass
//      hardest when the census was misconfigured.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ACCOUNTABILITY_BUCKETS,
  accountabilityCensusVerdict,
  accountabilityNotApplicable,
  censusAccountabilityFamily,
  classifyAccountabilityRecord,
  emptyAccountabilityCounts,
  isMeasured,
  isNotApplicable,
} from "../lib/responsibility/accountabilityCensus.js";
import {
  ACCOUNTABILITY_EXCEPTION_FIELD,
  ACCOUNTABLE_PERSON_FIELD,
  ACCOUNTABILITY_FAMILIES,
} from "../lib/responsibility/accountablePersonStorage.js";
import { establishCreationAccountablePerson } from "../lib/responsibility/accountablePersonEstablishment.js";
import { composePersonReferenceState } from "../lib/employeeIdentity/employeeAuthority.js";
import { buildCreateOpportunity } from "../lib/opportunity/opportunityCommands.js";
import { buildCreateSalesAgreement } from "../lib/salesAgreement/salesAgreementCommands.js";
import { buildCreateSalesOrder } from "../lib/salesOrder/salesOrderCommands.js";
import { ALL_FAMILIES } from "../lib/ownership/ownershipCensus.js";

const TENANT = "tenant-a";

/**
 * ACTIVE and CONTRACTOR are eligible; the other four are not.
 *
 * Deliberately not `["ACTIVE"]`. #189 `MI-ε` forbids implementing eligibility as `status !== "ACTIVE"`,
 * and a suite whose only policy were `["ACTIVE"]` could not tell a correct census from that forbidden
 * one. Every eligibility assertion below is therefore a real discriminator.
 */
const POLICY = Object.freeze({
  policyId: "WAVE2C-CENSUS-POLICY",
  eligibleStatuses: Object.freeze(["ACTIVE", "CONTRACTOR"]),
});

const PEOPLE = Object.freeze({
  "emp-active": "ACTIVE",
  "emp-contractor": "CONTRACTOR",
  "emp-on-leave": "ON_LEAVE",
  "emp-inactive": "INACTIVE",
  "emp-terminated": "TERMINATED",
  "emp-retired": "RETIRED",
  "emp-owner": "ACTIVE",
});

function employeeAuthority(people = PEOPLE, { unavailable = [], throwFor = [] } = {}) {
  const calls = [];
  return {
    calls,
    async resolveEmployeeReference(reference) {
      calls.push(reference);
      if (throwFor.includes(reference.employeeId)) throw new Error("connection reset");
      if (unavailable.includes(reference.employeeId)) {
        return {
          outcome: "AUTHORITY_UNAVAILABLE",
          reference,
          reason: "AUTHORITY_READ_FAILED",
          detail: "the server is down",
        };
      }
      const status = people[reference.employeeId];
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

const deps = (authority = employeeAuthority()) => ({ employeeAuthority: authority, eligibilityPolicy: POLICY });

/** A pre-resolved map, for the PURE classifier. Built the way the census builds it. */
function resolvedMap(entries) {
  const map = new Map();
  for (const [employeeId, resolution] of Object.entries(entries)) {
    map.set(employeeId, composePersonReferenceState(resolution, POLICY));
  }
  return map;
}

const resolvedFor = (employeeId, status) =>
  resolvedMap({
    [employeeId]: {
      outcome: "RESOLVED",
      reference: { tenantId: TENANT, employeeId },
      employee: { employeeId, tenantId: TENANT, employmentStatus: status, operatingCompanyId: "taylor" },
    },
  });

const openOpportunity = (extra) => ({ stage: "DECISION", outcome: null, ownerEmployeeId: "emp-owner", ...extra });
const wonOpportunity = (extra) => ({ stage: "DECISION", outcome: "WON", ownerEmployeeId: "emp-owner", ...extra });

// ════════════════════ 1. IT IS ITS OWN CENSUS, OVER ITS OWN SCOPE ════════════════════

test("#189 OD-16: every family outside the three is NOT APPLICABLE, with NO COUNTS", async () => {
  const admitted = new Set(ACCOUNTABILITY_FAMILIES);
  const outside = ALL_FAMILIES.filter((f) => !admitted.has(f.family));
  assert.ok(outside.length > 20, "the matrix should have many families outside the accountability scope");
  for (const family of outside) {
    const report = await censusAccountabilityFamily(deps(), family.family, TENANT, [
      { id: "r1", data: { ownerEmployeeId: "emp-owner" } },
    ]);
    assert.ok(isNotApplicable(report), `${family.family} was measured instead of reported NOT APPLICABLE`);
    assert.equal(report.scope, "NOT_APPLICABLE");
    // THE STRUCTURAL POINT: no counts object at all, so there is no zero to sum into a backlog.
    assert.ok(!("counts" in report), `${family.family}'s NOT APPLICABLE report carries counts`);
    assert.ok(!("scanned" in report));
    assert.match(report.why, /not MISSING, not OWNERLESS, not DEFECTIVE/);
  }
});

test("a NOT APPLICABLE family is not even READ — the question is about the family", async () => {
  const authority = employeeAuthority();
  await censusAccountabilityFamily(deps(authority), "supplier", TENANT, [
    { id: "s1", data: { [ACCOUNTABLE_PERSON_FIELD]: "emp-active" } },
  ]);
  assert.equal(
    authority.calls.length,
    0,
    "the census resolved a person for an out-of-scope family. Applicability is a property of the FAMILY, " +
      "and measuring the records would manufacture the fake accountability #189 OD-16 forbids.",
  );
});

test("all three admitted families ARE measured", async () => {
  for (const family of ACCOUNTABILITY_FAMILIES) {
    const report = await censusAccountabilityFamily(deps(), family, TENANT, []);
    assert.ok(isMeasured(report), `${family} was not measured`);
    assert.equal(report.scope, "IN_SCOPE");
    assert.equal(report.eligibilityPolicyId, POLICY.policyId, "the policy behind the counts must be recorded");
  }
});

test("#189 MI-ε: the census REFUSES to run without a governed eligibility policy", async () => {
  for (const eligibilityPolicy of [undefined, null, {}, { policyId: "" }]) {
    await assert.rejects(
      () =>
        censusAccountabilityFamily({ employeeAuthority: employeeAuthority(), eligibilityPolicy }, "opportunity", TENANT, []),
      (e) => e.code === "ELIGIBILITY_POLICY_REQUIRED",
      `${JSON.stringify(eligibilityPolicy)} was accepted as a governed policy`,
    );
  }
});

// ════════════════════ 2. THE SEVEN BUCKETS, ONE RECORD EACH ════════════════════

test("a present, valid, currently-eligible accountable person is the ONLY healthy bucket", () => {
  const c = classifyAccountabilityRecord(
    "opportunity",
    openOpportunity({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }),
    resolvedFor("emp-active", "ACTIVE"),
  );
  assert.equal(c.bucket, "presentValidEligible");
  assert.equal(c.context, "ACTIONABLE");
  assert.equal(c.reason, null, "the healthy bucket needs no reason");
});

test("CONTRACTOR is eligible under this policy — the census consumes the policy, not a status literal", () => {
  const c = classifyAccountabilityRecord(
    "opportunity",
    openOpportunity({ [ACCOUNTABLE_PERSON_FIELD]: "emp-contractor" }),
    resolvedFor("emp-contractor", "CONTRACTOR"),
  );
  assert.equal(
    c.bucket,
    "presentValidEligible",
    "a CONTRACTOR was reported as a defect. #189 MI-epsilon: the census consumes the governed eligibility " +
      "result and must not flatten the six-value vocabulary into `status !== ACTIVE`.",
  );
});

test("#182 state B: VALID but NOT CURRENTLY ELIGIBLE is its own bucket, for all four ineligible statuses", () => {
  for (const [id, status] of [
    ["emp-on-leave", "ON_LEAVE"],
    ["emp-inactive", "INACTIVE"],
    ["emp-terminated", "TERMINATED"],
    ["emp-retired", "RETIRED"],
  ]) {
    const c = classifyAccountabilityRecord(
      "opportunity",
      openOpportunity({ [ACCOUNTABLE_PERSON_FIELD]: id }),
      resolvedFor(id, status),
    );
    assert.equal(c.bucket, "presentValidNotCurrentlyEligible", `${status} landed in ${c.bucket}`);
    // NOT invalid, and the reason SAYS so: #186 §1 keeps the reference valid.
    assert.notEqual(c.bucket, "presentInvalid");
    assert.match(c.reason, /VALID reference/);
    assert.match(c.reason, new RegExp(status));
    assert.match(c.reason, new RegExp(POLICY.policyId));
    // #186 §4: INACTIVE and TERMINATED must remain distinguishable, so the status is in the reason.
    assert.equal(c.composed.eligibility.employmentStatus, status);
  }
});

test("#182 state C: a reference the authority ANSWERED NO for is presentInvalid", () => {
  const c = classifyAccountabilityRecord(
    "opportunity",
    openOpportunity({ [ACCOUNTABLE_PERSON_FIELD]: "emp-ghost" }),
    resolvedMap({ "emp-ghost": { outcome: "NOT_FOUND", reference: { tenantId: TENANT, employeeId: "emp-ghost" } } }),
  );
  assert.equal(c.bucket, "presentInvalid");
  // #186 case D: eligibility is NOT APPLICABLE here and "must not be represented as merely not eligible".
  assert.equal(c.composed.eligibility, undefined);
});

test("#189 MI-λ: an unusable stored value is presentUnreadable — not missing, not invalid", () => {
  for (const raw of ["", "   ", " emp-x", "employees/emp-x", 7, {}]) {
    const c = classifyAccountabilityRecord(
      "opportunity",
      openOpportunity({ [ACCOUNTABLE_PERSON_FIELD]: raw }),
      new Map(),
    );
    assert.equal(c.bucket, "presentUnreadable", `${JSON.stringify(raw)} landed in ${c.bucket}`);
    assert.notEqual(c.bucket, "missing", "a quarantined legacy value was reported as an absence");
    assert.notEqual(c.bucket, "presentInvalid");
    assert.ok(c.reason);
  }
});

test("no accountable person at all is `missing`, and the OWNER is not consulted", () => {
  const c = classifyAccountabilityRecord("opportunity", openOpportunity({}), new Map());
  assert.equal(c.bucket, "missing");
  // A census that fell back to `ownerEmployeeId` would report every un-established record as healthy,
  // which is #181's forbidden permanent identity arriving through the measurement.
  assert.match(c.reason, /no accountable person is recorded/);
});

test("#187 §2: AUTHORITY_UNAVAILABLE is its OWN bucket and never becomes invalid or missing", () => {
  const unavailable = classifyAccountabilityRecord(
    "opportunity",
    openOpportunity({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }),
    resolvedMap({
      "emp-active": {
        outcome: "AUTHORITY_UNAVAILABLE",
        reference: { tenantId: TENANT, employeeId: "emp-active" },
        reason: "AUTHORITY_READ_FAILED",
        detail: "down",
      },
    }),
  );
  assert.equal(unavailable.bucket, "authorityUnavailable");
  assert.notEqual(unavailable.bucket, "presentInvalid");
  assert.notEqual(unavailable.bucket, "missing");
  assert.match(unavailable.reason, /NOT a finding about the person/);

  // And a reference that was never resolved at all — the map-miss case — is ALSO unavailable rather
  // than invalid. An id with no authoritative answer has no verdict.
  const unasked = classifyAccountabilityRecord(
    "opportunity",
    openOpportunity({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }),
    new Map(),
  );
  assert.equal(unasked.bucket, "authorityUnavailable");
  assert.match(unasked.reason, /NOT a finding that the person is missing or invalid/);
});

test("#180: an explicit governed exception is its own bucket and is not measured against the requirement", () => {
  const c = classifyAccountabilityRecord(
    "opportunity",
    openOpportunity({ [ACCOUNTABILITY_EXCEPTION_FIELD]: "exc-owner-approved-1" }),
    new Map(),
  );
  assert.equal(c.bucket, "governedException");
  assert.match(c.reason, /exc-owner-approved-1/);
  // It takes precedence over `missing`: the exception exempts the record from the one-accountable-person
  // requirement itself, so measuring it against that requirement would be the wrong question.
});

test("the seven buckets are the whole vocabulary, and every classification uses one of them", () => {
  assert.deepEqual(
    [...ACCOUNTABILITY_BUCKETS],
    [
      "presentValidEligible",
      "presentValidNotCurrentlyEligible",
      "presentInvalid",
      "presentUnreadable",
      "missing",
      "authorityUnavailable",
      "governedException",
    ],
  );
  assert.deepEqual(Object.keys(emptyAccountabilityCounts()).sort(), [...ACCOUNTABILITY_BUCKETS].sort());
});

// ════════════════════ 3. ACTIONABLE vs HISTORICAL ════════════════════

test("#186 §7/§8: the SAME finding is split by context, per family's own terminal states", async () => {
  const documents = [
    { id: "open-ineligible", data: openOpportunity({ [ACCOUNTABLE_PERSON_FIELD]: "emp-terminated" }) },
    { id: "won-ineligible", data: wonOpportunity({ [ACCOUNTABLE_PERSON_FIELD]: "emp-terminated" }) },
  ];
  const report = await censusAccountabilityFamily(deps(), "opportunity", TENANT, documents);
  assert.equal(report.counts.presentValidNotCurrentlyEligible, 2);
  assert.equal(report.actionable.presentValidNotCurrentlyEligible, 1);
  assert.equal(report.historical.presentValidNotCurrentlyEligible, 1);
});

test("#186 §7: a HISTORICAL record's ineligible person is COUNTED and does NOT block", async () => {
  const report = await censusAccountabilityFamily(deps(), "opportunity", TENANT, [
    { id: "won", data: wonOpportunity({ [ACCOUNTABLE_PERSON_FIELD]: "emp-terminated" }) },
    { id: "lost", data: { stage: "DECISION", outcome: "LOST", [ACCOUNTABLE_PERSON_FIELD]: "emp-retired" } },
  ]);
  const verdict = accountabilityCensusVerdict([report]);
  assert.equal(verdict.blocking, 0, "history was treated as a current defect — #186 §7 forbids rewriting it");
  assert.equal(verdict.historicalFindings, 2, "history was not even COUNTED, so the census cannot see it");
  assert.equal(verdict.assessable, true);
});

test("#189 MI-ε: an ACTIONABLE record's ineligible person IS a responsibility defect", async () => {
  const report = await censusAccountabilityFamily(deps(), "opportunity", TENANT, [
    { id: "open", data: openOpportunity({ [ACCOUNTABLE_PERSON_FIELD]: "emp-on-leave" }) },
  ]);
  const verdict = accountabilityCensusVerdict([report]);
  assert.equal(verdict.blocking, 1);
  assert.equal(verdict.assessable, false);
  // It is STILL a valid reference, and the counts say so — the defect is about current responsibility.
  assert.equal(report.counts.presentInvalid, 0);
  assert.equal(report.counts.presentValidNotCurrentlyEligible, 1);
});

test("an unreadable lifecycle is treated as ACTIONABLE, the fail-closed direction", async () => {
  const report = await censusAccountabilityFamily(deps(), "opportunity", TENANT, [
    { id: "no-lifecycle", data: { [ACCOUNTABLE_PERSON_FIELD]: "emp-terminated" } },
  ]);
  assert.equal(
    report.actionable.presentValidNotCurrentlyEligible,
    1,
    "a record with no readable lifecycle was exempted as history, which is the lenient direction",
  );
  assert.equal(accountabilityCensusVerdict([report]).blocking, 1);
});

// ════════════════════ 4. THE VERDICT ════════════════════

test("#187 §2: authorityUnavailable blocks in BOTH contexts", async () => {
  const authority = employeeAuthority(PEOPLE, { unavailable: ["emp-active"] });
  const report = await censusAccountabilityFamily(deps(authority), "opportunity", TENANT, [
    { id: "open", data: openOpportunity({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) },
    { id: "won", data: wonOpportunity({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) },
  ]);
  const verdict = accountabilityCensusVerdict([report]);
  assert.equal(verdict.totals.authorityUnavailable, 2);
  assert.equal(
    verdict.blocking,
    2,
    "an unobtainable answer on a WON record was exempted as history. We cannot know a record is history " +
      "if we could not read its person — #187 §2's fail-closed means the unknown blocks.",
  );
  assert.equal(verdict.authorityUnavailable, 2, "the fail-closed count must be separately visible");
  assert.equal(verdict.assessable, false);
  // And it never appeared in the invalid or missing counts.
  assert.equal(verdict.totals.presentInvalid, 0);
  assert.equal(verdict.totals.missing, 0);
});

test("an authority that THROWS is AUTHORITY_UNAVAILABLE, with the thrown detail preserved", async () => {
  const authority = employeeAuthority(PEOPLE, { throwFor: ["emp-active"] });
  const report = await censusAccountabilityFamily(deps(authority), "opportunity", TENANT, [
    { id: "open", data: openOpportunity({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) },
  ]);
  assert.equal(report.counts.authorityUnavailable, 1);
  assert.equal(report.counts.presentInvalid, 0);
});

test("ZERO MEASURED FAMILIES IS NEVER ASSESSABLE", () => {
  const nothing = accountabilityCensusVerdict([]);
  assert.equal(nothing.blocking, 0);
  assert.equal(nothing.measuredFamilies, 0);
  assert.equal(
    nothing.assessable,
    false,
    "an EMPTY accountability census was assessable. A gate that passes on nothing passes hardest when " +
      "the census is misconfigured, which is the vacuous pass this whole wave exists to refuse.",
  );
  // And a census of nothing but NOT APPLICABLE families is also not assessable: the three admitted
  // families were not measured, so nothing was measured.
  const onlyNotApplicable = accountabilityCensusVerdict([
    accountabilityNotApplicable("supplier"),
    accountabilityNotApplicable("workOrder"),
  ]);
  assert.equal(onlyNotApplicable.measuredFamilies, 0);
  assert.equal(onlyNotApplicable.assessable, false);
  assert.deepEqual([...onlyNotApplicable.notApplicable], ["supplier", "workOrder"]);
  // NOT APPLICABLE contributed NOTHING to any count.
  for (const bucket of ACCOUNTABILITY_BUCKETS) assert.equal(onlyNotApplicable.totals[bucket], 0);
});

test("an UNREADABLE family blocks — an unread family is not a clean zero", async () => {
  const ok = await censusAccountabilityFamily(deps(), "opportunity", TENANT, [
    { id: "open", data: openOpportunity({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) },
  ]);
  const verdict = accountabilityCensusVerdict([
    ok,
    { family: "salesOrder", collection: "sales_orders", error: "permission denied" },
  ]);
  assert.deepEqual([...verdict.unreadable], ["salesOrder"]);
  assert.equal(verdict.assessable, false);
  assert.equal(verdict.blocking, 0, "an unread family must block WITHOUT inventing a record-level finding");
});

test("a TRUNCATED family blocks — a page is not a population", async () => {
  const report = await censusAccountabilityFamily(
    deps(),
    "opportunity",
    TENANT,
    [{ id: "open", data: openOpportunity({ [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }) }],
    true,
  );
  const verdict = accountabilityCensusVerdict([report]);
  assert.deepEqual([...verdict.truncated], ["opportunity"]);
  assert.equal(verdict.assessable, false);
});

test("a fully healthy, non-empty census IS assessable", async () => {
  const reports = [];
  for (const family of ACCOUNTABILITY_FAMILIES) {
    reports.push(
      await censusAccountabilityFamily(deps(), family, TENANT, [
        { id: `${family}-1`, data: { [ACCOUNTABLE_PERSON_FIELD]: "emp-active", stage: "DECISION", outcome: null, state: "DRAFT" } },
        { id: `${family}-2`, data: { [ACCOUNTABLE_PERSON_FIELD]: "emp-contractor", stage: "DECISION", outcome: null, state: "CONFIRMED" } },
      ]),
    );
  }
  const verdict = accountabilityCensusVerdict(reports);
  assert.equal(verdict.measuredFamilies, 3);
  assert.equal(verdict.totals.presentValidEligible, 6);
  assert.equal(verdict.blocking, 0);
  assert.equal(verdict.assessable, true);
});

// ════════════════════ 5. IT SEES REAL RECORDS, AND IT SEES THEM EFFICIENTLY ════════════════════

test("the census resolves each DISTINCT person ONCE, not once per record", async () => {
  const authority = employeeAuthority();
  const documents = [];
  for (let i = 0; i < 25; i += 1) {
    documents.push({ id: `r${i}`, data: openOpportunity({ [ACCOUNTABLE_PERSON_FIELD]: i % 2 ? "emp-active" : "emp-contractor" }) });
  }
  const report = await censusAccountabilityFamily(deps(authority), "opportunity", TENANT, documents);
  assert.equal(report.scanned, 25);
  assert.equal(report.counts.presentValidEligible, 25);
  assert.equal(
    authority.calls.length,
    2,
    "the census made one authority call per RECORD. A family of 40,000 records with 30 salespeople must " +
      "make 30 lookups, not 40,000.",
  );
});

test("THE CENSUS SEES REAL POPULATED RECORDS, from all three real builders", async () => {
  const authority = employeeAuthority();
  const established = (family, id) =>
    establishCreationAccountablePerson(
      { employeeAuthority: authority },
      { tenantId: TENANT, family, explicitAccountableEmployeeId: id, eligibilityPolicy: POLICY },
    );

  const opportunity = buildCreateOpportunity(
    {
      accountId: "acct-1",
      ownerEmployeeId: "emp-owner",
      operatingCompanyId: "taylor",
      salesChannel: "RETAIL",
      lines: [{ kind: "PART", ref: "PRT-1", qty: 1 }],
      accountablePerson: await established("opportunity", "emp-active"),
    },
    { actorUid: "uid", nowMillis: 1 },
  );
  const agreement = buildCreateSalesAgreement(
    {
      accountId: "acct-1",
      ownerEmployeeId: "emp-owner",
      inheritedOperatingCompanyId: "taylor",
      lines: [{ kind: "PART", ref: "PRT-1", quantity: 1, unitPrice: 1000 }],
      accountablePerson: await established("salesAgreement", "emp-contractor"),
    },
    { actorUid: "uid", nowMillis: 1 },
  );
  const order = buildCreateSalesOrder(
    {
      accountId: "acct-1",
      ownerEmployeeId: "emp-owner",
      operatingCompanyId: "taylor",
      salesChannel: "RETAIL",
      lines: [{ kind: "EQUIPMENT_MODEL", ref: "C713", orderedQty: 1, unitPrice: 12000 }],
      accountablePerson: await established("salesOrder", "emp-active"),
    },
    { actorUid: "uid", nowMillis: 1 },
  );

  const reports = [
    await censusAccountabilityFamily(deps(authority), "opportunity", TENANT, [{ id: "o1", data: opportunity }]),
    await censusAccountabilityFamily(deps(authority), "salesAgreement", TENANT, [{ id: "a1", data: agreement }]),
    await censusAccountabilityFamily(deps(authority), "salesOrder", TENANT, [{ id: "s1", data: order }]),
  ];
  for (const report of reports) {
    assert.equal(report.scanned, 1, `${report.family} was not scanned`);
    assert.equal(
      report.counts.presentValidEligible,
      1,
      `${report.family}: a record the REAL builder produced was not seen as healthy. The builder's ` +
        "persisted field and the census's read have diverged.",
    );
    assert.equal(report.counts.missing, 0, `${report.family} reported a real populated record as MISSING`);
  }
  const verdict = accountabilityCensusVerdict(reports);
  assert.equal(verdict.measuredFamilies, 3);
  assert.equal(verdict.totals.presentValidEligible, 3);
  assert.equal(verdict.assessable, true, "a census of three real, healthy records was not assessable");
});

test("the census reports WHY as a tally rather than as a list of every id", async () => {
  const documents = [];
  for (let i = 0; i < 15; i += 1) documents.push({ id: `r${i}`, data: openOpportunity({}) });
  const report = await censusAccountabilityFamily(deps(), "opportunity", TENANT, documents);
  assert.equal(report.counts.missing, 15);
  assert.deepEqual(Object.values(report.reasons), [15], "one reason line, not fifteen");
  assert.equal(report.samples.missing.length, 10, "the sample list is capped");
  assert.equal(report.samples.presentValidEligible.length, 0, "the healthy bucket needs no samples");
});
