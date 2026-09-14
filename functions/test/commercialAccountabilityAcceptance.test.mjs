// WAVE 2C ACCEPTANCE — the whole contract, end to end, for all three admitted families.
//
// ════════════════════ WHAT THIS SUITE IS FOR ════════════════════
//
// The other four suites each prove one module. This one proves the CONTRACT, over the real modules
// wired together: the governed creation rule, the pure builders, the governed handoff boundary, the
// real accountability store, and the two censuses composed into the gate.
//
// The cases it exists for are the ones no single module can prove, because they are properties of the
// COMPOSITION:
//
//   * OWNER CHANGE PRESERVES ACCOUNTABLE, ACCOUNTABLE CHANGE PRESERVES OWNER, and ASSIGNMENT CHANGE
//     PRESERVES BOTH. #181's transfer rules and #187 `M-1`'s axis scope, asserted as NUMBERS on the
//     record after a real governed handoff.
//   * ATOMIC MUTATION + AUDIT, and on failure ZERO MUTATION and ZERO PARTIAL AUDIT. #184's step E.
//     Proved with a real atomic unit that only applies on commit, so "nothing was written" is a count.
//   * NO FIRESTORE FALLBACK, proved in a CHILD PROCESS whose module loader reports any attempt to
//     RESOLVE a Firebase module while the whole accountability path runs. #187 §2.
//
// No emulator and no database: the Employee authority and the document store are doubles. The
// PostgreSQL half of the proof is `functions/test/commercialAccountabilityPostgres.test.mjs`.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { establishCreationAccountablePerson } from "../lib/responsibility/accountablePersonEstablishment.js";
import {
  ACCOUNTABILITY_FAMILIES,
  ACCOUNTABLE_PERSON_FIELD,
  ACCOUNTABLE_PERSON_SOURCE_FIELD,
} from "../lib/responsibility/accountablePersonStorage.js";
import { createRecordAccountabilityStore } from "../lib/responsibility/accountablePersonRecordStore.js";
import {
  personOwner,
  stageGovernedResponsibilityHandoff,
} from "../lib/responsibility/governedResponsibilityHandoff.js";
import { censusAccountabilityFamily } from "../lib/responsibility/accountabilityCensus.js";
import { responsibilityEnforcementGate, defectsForAxis } from "../lib/responsibility/responsibilityEnforcementGate.js";
import { buildCreateOpportunity } from "../lib/opportunity/opportunityCommands.js";
import { buildCreateSalesAgreement } from "../lib/salesAgreement/salesAgreementCommands.js";
import { buildCreateSalesOrder } from "../lib/salesOrder/salesOrderCommands.js";
import { censusFamily, CENSUS_FAMILIES } from "../lib/ownership/ownershipCensus.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");
const SRC = join(FUNCTIONS_DIR, "src");

const TENANT = "tenant-a";
const CTX = { actorUid: "uid-actor", nowMillis: 1000 };

/**
 * ACTIVE and CONTRACTOR are eligible. ON_LEAVE, INACTIVE, TERMINATED and RETIRED are not.
 *
 * #189 `MI-ε` forbids `status !== "ACTIVE" → refuse`, so a policy of exactly `["ACTIVE"]` would make
 * every eligibility assertion in this suite pass against the forbidden implementation too. With
 * CONTRACTOR eligible, it does not.
 */
const POLICY = Object.freeze({
  policyId: "WAVE2C-ACCEPTANCE",
  eligibleStatuses: Object.freeze(["ACTIVE", "CONTRACTOR"]),
});

const PEOPLE = Object.freeze({
  "emp-owner": "ACTIVE",
  "emp-new-owner": "ACTIVE",
  "emp-accountable": "ACTIVE",
  "emp-next-accountable": "CONTRACTOR",
  "emp-on-leave": "ON_LEAVE",
  "emp-inactive": "INACTIVE",
  "emp-terminated": "TERMINATED",
  "emp-retired": "RETIRED",
  "emp-owner-terminated": "TERMINATED",
  "emp-technician": "ACTIVE",
});

function employeeAuthority({ unavailable = [], throwFor = [] } = {}) {
  const calls = [];
  return {
    calls,
    async resolveEmployeeReference(reference) {
      calls.push(reference);
      if (throwFor.includes(reference.employeeId)) throw new Error("connection reset by peer");
      if (unavailable.includes(reference.employeeId)) {
        return {
          outcome: "AUTHORITY_UNAVAILABLE",
          reference,
          reason: "AUTHORITY_READ_FAILED",
          detail: "the Employee authority is unreachable",
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

const establish = (request, authority = employeeAuthority()) =>
  establishCreationAccountablePerson({ employeeAuthority: authority }, {
    tenantId: TENANT,
    eligibilityPolicy: POLICY,
    ...request,
  });

const refusal = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  assert.fail("expected a refusal, got a result");
};

// ════════════════════ THE THREE FAMILIES, THROUGH THEIR REAL BUILDERS ════════════════════

const OPP = Object.freeze({
  accountId: "acct-1",
  ownerEmployeeId: "emp-owner",
  operatingCompanyId: "taylor",
  salesChannel: "RETAIL",
  lines: [{ kind: "PART", ref: "PRT-1", qty: 1 }],
});
const AGREEMENT = Object.freeze({
  accountId: "acct-1",
  ownerEmployeeId: "emp-owner",
  inheritedOperatingCompanyId: "taylor",
  lines: [{ kind: "PART", ref: "PRT-1", quantity: 1, unitPrice: 1000 }],
});
const ORDER = Object.freeze({
  accountId: "acct-1",
  ownerEmployeeId: "emp-owner",
  operatingCompanyId: "taylor",
  salesChannel: "RETAIL",
  lines: [{ kind: "EQUIPMENT_MODEL", ref: "C713", orderedQty: 1, unitPrice: 12000 }],
});

const BUILDERS = Object.freeze({
  opportunity: (extra) => buildCreateOpportunity({ ...OPP, ...extra }, CTX),
  salesAgreement: (extra) => buildCreateSalesAgreement({ ...AGREEMENT, ...extra }, CTX),
  salesOrder: (extra) => buildCreateSalesOrder({ ...ORDER, ...extra }, CTX),
});

// ════════════════════ 1. THE CREATION CONTRACT, ALL THREE FAMILIES ════════════════════

for (const family of ACCOUNTABILITY_FAMILIES) {
  const build = BUILDERS[family];

  test(`ACCEPT ${family}: an EXPLICIT VALID accountable person is accepted and persisted`, async () => {
    const established = await establish({ family, explicitAccountableEmployeeId: "emp-accountable" });
    const built = build({ accountablePerson: established });
    assert.equal(built[ACCOUNTABLE_PERSON_FIELD], "emp-accountable");
    assert.equal(built[ACCOUNTABLE_PERSON_SOURCE_FIELD], "EXPLICIT");
    // OWNER != ACCOUNTABLE, on a real built record. #181: "EOS must nevertheless be able to represent
    // them as different people."
    assert.equal(built.ownerEmployeeId, "emp-owner");
    assert.notEqual(built.ownerEmployeeId, built[ACCOUNTABLE_PERSON_FIELD]);
  });

  test(`ACCEPT ${family}: no explicit person + a VALID owner derivation is accepted`, async () => {
    const established = await establish({ family, currentRecordOwnerEmployeeId: "emp-owner" });
    const built = build({ accountablePerson: established });
    assert.equal(built[ACCOUNTABLE_PERSON_FIELD], "emp-owner");
    assert.equal(
      built[ACCOUNTABLE_PERSON_SOURCE_FIELD],
      "DERIVED_FROM_RECORD_OWNER",
      "the record must say the value was INITIALIZED, not asserted (#181)",
    );
  });

  test(`REFUSE ${family}: no explicit person and NO derivation`, async () => {
    const err = await refusal(establish({ family }));
    assert.equal(err.code, "NO_ACCOUNTABLE_PERSON_RESOLVED");
    assert.match(err.message, /never assigned to the caller, the creator, an arbitrary employee/);
  });

  test(`REFUSE ${family}: an INVALID Employee`, async () => {
    const explicit = await refusal(establish({ family, explicitAccountableEmployeeId: "emp-ghost" }));
    assert.equal(explicit.code, "EXPLICIT_PERSON_INVALID");
    const derived = await refusal(establish({ family, currentRecordOwnerEmployeeId: "emp-ghost" }));
    assert.equal(derived.code, "DERIVED_PERSON_INVALID");
  });

  test(`REFUSE ${family}: a VALID but NOT CURRENTLY ELIGIBLE Employee, all four statuses`, async () => {
    for (const id of ["emp-on-leave", "emp-inactive", "emp-terminated", "emp-retired"]) {
      const err = await refusal(establish({ family, explicitAccountableEmployeeId: id }));
      assert.equal(err.code, "EXPLICIT_PERSON_NOT_CURRENTLY_ELIGIBLE", `${id} was accepted`);
    }
    // And a CONTRACTOR -- also not ACTIVE -- IS accepted, because the stated policy accepts it.
    const ok = await establish({ family, explicitAccountableEmployeeId: "emp-next-accountable" });
    assert.equal(ok.accountableEmployeeId, "emp-next-accountable");
    assert.equal(ok.employmentStatus, "CONTRACTOR");
  });

  test(`FAIL CLOSED ${family}: AUTHORITY_UNAVAILABLE, and it never becomes a verdict`, async () => {
    const authority = employeeAuthority({ unavailable: ["emp-accountable", "emp-owner"] });
    for (const request of [
      { family, explicitAccountableEmployeeId: "emp-accountable" },
      { family, currentRecordOwnerEmployeeId: "emp-owner" },
    ]) {
      const err = await refusal(establish(request, authority));
      assert.equal(err.code, "AUTHORITY_UNAVAILABLE");
    }
    // An authority that THROWS is also unavailable, never invalid.
    const thrower = employeeAuthority({ throwFor: ["emp-accountable"] });
    const err = await refusal(establish({ family, explicitAccountableEmployeeId: "emp-accountable" }, thrower));
    assert.equal(err.code, "AUTHORITY_UNAVAILABLE");
  });

  test(`REFUSE ${family}: a raw id cannot become persisted accountability`, async () => {
    assert.throws(
      () => build({ accountablePerson: "emp-accountable" }),
      (e) => e.code === "ACCOUNTABLE_PERSON_NOT_GOVERNED",
    );
  });
}

// ════════════════════ 2. THE ATOMIC UNIT — MUTATION AND AUDIT TOGETHER, OR NEITHER ════════════════════

/**
 * A real atomic unit. `stage*` only ever appends to `pending`; NOTHING reaches `records` until
 * `commit()` runs. So "zero mutation on failure" is a COUNT rather than an inspection, which is the
 * only form in which #184's "ZERO HANDOFF MUTATION · ZERO PARTIAL AUDIT" is checkable.
 */
function atomicUnit(records, { auditThrows = false, readOutcome = null } = {}) {
  const pending = [];
  const audits = [];
  const key = (target) => `${target.family}/${target.recordId}`;

  const read = (target) => {
    if (readOutcome) return readOutcome;
    const record = records[key(target)];
    if (record === undefined) return { outcome: "RECORD_NOT_FOUND" };
    return { outcome: "READ", fields: record };
  };

  const documentPort = {
    async readFields(target) {
      return read(target);
    },
    stageFieldWrite(target, fields) {
      pending.push({ target, fields });
    },
  };

  return {
    pending,
    audits,
    records,
    accountabilityStore: createRecordAccountabilityStore(documentPort),
    ownershipRecords: {
      async readAuthoritative(target) {
        return read(target);
      },
      stageOwnerFieldWrite(target, field, owner) {
        pending.push({ target, fields: { [field]: owner.id } });
      },
    },
    ownershipAudit: {
      stageOwnershipHandoffEvent(event) {
        if (auditThrows) throw new Error("the audit writer refused the event");
        audits.push({ kind: "OWNERSHIP_HANDOFF", event });
        return `audit-${audits.length}`;
      },
    },
    accountabilityAudit: {
      stageAccountabilityHandoff(record) {
        if (auditThrows) throw new Error("the accountability audit sink refused the record");
        audits.push({ kind: "ACCOUNTABILITY_HANDOFF", record });
        return `audit-${audits.length}`;
      },
    },
    commit() {
      for (const { target, fields } of pending) Object.assign(records[key(target)], fields);
      pending.length = 0;
    },
  };
}

const callerAuthority = (decision = { outcome: "ALLOWED" }) => ({
  async authorizeResponsibilityChange() {
    return decision;
  },
});

/** A record carrying BOTH axes plus an assignment field, as the three families really do. */
const bothAxes = (extra = {}) => ({
  ownerEmployeeId: "emp-owner",
  [ACCOUNTABLE_PERSON_FIELD]: "emp-accountable",
  [ACCOUNTABLE_PERSON_SOURCE_FIELD]: "EXPLICIT",
  assignedEmployeeId: "emp-technician",
  stage: "DECISION",
  outcome: null,
  state: "DRAFT",
  ...extra,
});

function unitFor(family = "opportunity", overrides = {}, options = {}) {
  const records = { [`${family}/rec-1`]: bothAxes(overrides) };
  const unit = atomicUnit(records, options);
  return {
    unit,
    target: { tenantId: TENANT, family, recordId: "rec-1" },
    record: () => records[`${family}/rec-1`],
    deps: (authorityOptions = {}, decision) => ({
      callerAuthority: callerAuthority(decision),
      employeeAuthority: employeeAuthority(authorityOptions),
      ownershipRecords: unit.ownershipRecords,
      ownershipAudit: unit.ownershipAudit,
      accountabilityStore: unit.accountabilityStore,
      accountabilityAudit: unit.accountabilityAudit,
    }),
  };
}

for (const family of ACCOUNTABILITY_FAMILIES) {
  test(`#181 ${family}: an OWNER CHANGE PRESERVES THE ACCOUNTABLE PERSON`, async () => {
    const h = unitFor(family);
    const result = await stageGovernedResponsibilityHandoff(h.deps(), {
      axis: "RECORD_OWNERSHIP",
      tenantId: TENANT,
      family,
      recordId: "rec-1",
      actorUid: "uid-actor",
      newOwner: personOwner("emp-new-owner"),
      source: "DIRECT_HANDOFF",
    });
    h.unit.commit();
    assert.equal(result.axis, "RECORD_OWNERSHIP");
    assert.equal(h.record().ownerEmployeeId, "emp-new-owner", "the owner did not move");
    assert.equal(
      h.record()[ACCOUNTABLE_PERSON_FIELD],
      "emp-accountable",
      "#181: changing RECORD OWNER does NOT silently change ACCOUNTABLE PERSON on an existing actionable record",
    );
    assert.equal(h.record()[ACCOUNTABLE_PERSON_SOURCE_FIELD], "EXPLICIT", "the recorded source was rewritten");
    // And exactly ONE audit event, on the ownership axis only.
    assert.deepEqual(h.unit.audits.map((a) => a.kind), ["OWNERSHIP_HANDOFF"]);
  });

  test(`#181 ${family}: an ACCOUNTABILITY CHANGE PRESERVES THE OWNER`, async () => {
    const h = unitFor(family);
    const result = await stageGovernedResponsibilityHandoff(h.deps(), {
      axis: "ACCOUNTABILITY",
      tenantId: TENANT,
      family,
      recordId: "rec-1",
      actorUid: "uid-actor",
      newAccountableEmployeeId: "emp-next-accountable",
      eligibilityPolicy: POLICY,
    });
    h.unit.commit();
    assert.equal(result.axis, "ACCOUNTABILITY");
    assert.equal(result.previousId, "emp-accountable");
    assert.equal(h.record()[ACCOUNTABLE_PERSON_FIELD], "emp-next-accountable");
    assert.equal(
      h.record().ownerEmployeeId,
      "emp-owner",
      "#181: changing ACCOUNTABLE PERSON does NOT silently change RECORD OWNER",
    );
    // The result itself says no ownership field was written, so it is provable from the return value.
    assert.equal(result.mutatedOwnerField, null);
    assert.deepEqual(h.unit.audits.map((a) => a.kind), ["ACCOUNTABILITY_HANDOFF"]);
    // The eligibility verdict rides along as a governed fact, with its author. #189 MI-epsilon.
    assert.equal(h.unit.audits[0].record.eligibilityPolicyId, POLICY.policyId);
    assert.equal(result.eligibility.employmentStatus, "CONTRACTOR");
  });

  test(`#187 M-1 ${family}: an ASSIGNMENT CHANGE PRESERVES BOTH, and is not a handoff at all`, async () => {
    const h = unitFor(family);
    // The boundary REFUSES the axis: assignment is not a responsibility handoff, and there is no code
    // path by which naming it could move either axis.
    const err = await refusal(
      stageGovernedResponsibilityHandoff(h.deps(), {
        axis: "ASSIGNMENT",
        tenantId: TENANT,
        family,
        recordId: "rec-1",
        actorUid: "uid-actor",
        newAccountableEmployeeId: "emp-technician",
        eligibilityPolicy: POLICY,
      }),
    );
    assert.equal(err.code, "AXIS_UNSUPPORTED");
    assert.match(err.message, /ASSIGNMENT is a separate/);
    assert.equal(h.unit.pending.length, 0, "a refused axis staged a write");
    assert.equal(h.unit.audits.length, 0);

    // And the assignment field moving on its own leaves both axes exactly where they were.
    h.record().assignedEmployeeId = "emp-new-owner";
    assert.equal(h.record().ownerEmployeeId, "emp-owner");
    assert.equal(h.record()[ACCOUNTABLE_PERSON_FIELD], "emp-accountable");
  });
}

test("#184: mutation and audit land on ONE atomic unit, together", async () => {
  const h = unitFor();
  await stageGovernedResponsibilityHandoff(h.deps(), {
    axis: "ACCOUNTABILITY",
    tenantId: TENANT,
    family: "opportunity",
    recordId: "rec-1",
    actorUid: "uid-actor",
    newAccountableEmployeeId: "emp-next-accountable",
    eligibilityPolicy: POLICY,
  });
  // BEFORE commit: the mutation is STAGED and the audit is STAGED, and the record is untouched.
  assert.equal(h.unit.pending.length, 1, "the mutation was not staged");
  assert.equal(h.unit.audits.length, 1, "the audit was not staged");
  assert.equal(h.record()[ACCOUNTABLE_PERSON_FIELD], "emp-accountable", "the store COMMITTED by itself");
  h.unit.commit();
  assert.equal(h.record()[ACCOUNTABLE_PERSON_FIELD], "emp-next-accountable");
});

test("#184: a FAILED accountability handoff stages ZERO MUTATION and ZERO PARTIAL AUDIT", async () => {
  const failures = [
    ["an ineligible target", { newAccountableEmployeeId: "emp-terminated" }, {}, "TARGET_NOT_CURRENTLY_ELIGIBLE"],
    ["an invalid target", { newAccountableEmployeeId: "emp-ghost" }, {}, "TARGET_EMPLOYEE_INVALID"],
    ["an unavailable authority", { newAccountableEmployeeId: "emp-next-accountable" }, { unavailable: ["emp-next-accountable"] }, "TARGET_AUTHORITY_UNAVAILABLE"],
    ["a no-op", { newAccountableEmployeeId: "emp-accountable" }, {}, "COMMAND_INVALID"],
    ["a stale precondition", { newAccountableEmployeeId: "emp-next-accountable", expectedCurrentId: "emp-someone-else" }, {}, "PRECONDITION_STALE"],
  ];
  for (const [label, overrides, authorityOptions, expectedCode] of failures) {
    const h = unitFor();
    const err = await refusal(
      stageGovernedResponsibilityHandoff(h.deps(authorityOptions), {
        axis: "ACCOUNTABILITY",
        tenantId: TENANT,
        family: "opportunity",
        recordId: "rec-1",
        actorUid: "uid-actor",
        eligibilityPolicy: POLICY,
        ...overrides,
      }),
    );
    assert.equal(err.code, expectedCode, `${label} produced ${err.code}`);
    assert.equal(h.unit.pending.length, 0, `${label}: a write was staged by a failing handoff`);
    assert.equal(h.unit.audits.length, 0, `${label}: a PARTIAL AUDIT was staged by a failing handoff`);
    h.unit.commit();
    assert.equal(h.record()[ACCOUNTABLE_PERSON_FIELD], "emp-accountable", `${label}: the record moved`);
    assert.equal(h.record().ownerEmployeeId, "emp-owner", `${label}: the OTHER axis moved`);
  }
});

test("#184: a DENIED caller changes nothing, and the refusal precedes the Employee lookup", async () => {
  const h = unitFor();
  const authority = employeeAuthority();
  const err = await refusal(
    stageGovernedResponsibilityHandoff(
      {
        callerAuthority: callerAuthority({ outcome: "DENIED", reason: "no capability" }),
        employeeAuthority: authority,
        accountabilityStore: h.unit.accountabilityStore,
        accountabilityAudit: h.unit.accountabilityAudit,
      },
      {
        axis: "ACCOUNTABILITY",
        tenantId: TENANT,
        family: "opportunity",
        recordId: "rec-1",
        actorUid: "uid-actor",
        newAccountableEmployeeId: "emp-next-accountable",
        eligibilityPolicy: POLICY,
      },
    ),
  );
  assert.equal(err.code, "CALLER_NOT_AUTHORIZED");
  assert.equal(authority.calls.length, 0, "a denied caller's target was still resolved");
  assert.equal(h.unit.pending.length, 0);
  assert.equal(h.unit.audits.length, 0);
});

test("#184: when the AUDIT sink fails, the mutation is abandoned rather than committed", async () => {
  const h = unitFor("opportunity", {}, { auditThrows: true });
  const err = await refusal(
    stageGovernedResponsibilityHandoff(h.deps(), {
      axis: "ACCOUNTABILITY",
      tenantId: TENANT,
      family: "opportunity",
      recordId: "rec-1",
      actorUid: "uid-actor",
      newAccountableEmployeeId: "emp-next-accountable",
      eligibilityPolicy: POLICY,
    }),
  );
  assert.equal(err.code, "STAGING_FAILED");
  assert.match(err.message, /atomic unit MUST be abandoned/);
  assert.equal(h.unit.audits.length, 0, "a partial audit survived");
  // The store DID stage before the audit threw -- which is exactly why the refusal says the unit must be
  // abandoned. The caller must not commit, and the record is unchanged because it did not.
  assert.equal(h.record()[ACCOUNTABLE_PERSON_FIELD], "emp-accountable");
});

test("#189 MI-λ: a record whose stored accountable person is UNREADABLE is not overwritten", async () => {
  const h = unitFor("opportunity", { [ACCOUNTABLE_PERSON_FIELD]: "  " });
  const err = await refusal(
    stageGovernedResponsibilityHandoff(h.deps(), {
      axis: "ACCOUNTABILITY",
      tenantId: TENANT,
      family: "opportunity",
      recordId: "rec-1",
      actorUid: "uid-actor",
      newAccountableEmployeeId: "emp-next-accountable",
      eligibilityPolicy: POLICY,
    }),
  );
  assert.equal(err.code, "CURRENT_RESPONSIBILITY_UNRESOLVED");
  assert.equal(h.unit.pending.length, 0);
  assert.equal(h.record()[ACCOUNTABLE_PERSON_FIELD], "  ", "a quarantined legacy value was overwritten");
});

test("#187 §2: an UNAVAILABLE authoritative read fails closed, never 'no accountable person'", async () => {
  const h = unitFor("opportunity", {}, { readOutcome: { outcome: "READ_UNAVAILABLE", detail: "timeout" } });
  const err = await refusal(
    stageGovernedResponsibilityHandoff(h.deps(), {
      axis: "ACCOUNTABILITY",
      tenantId: TENANT,
      family: "opportunity",
      recordId: "rec-1",
      actorUid: "uid-actor",
      newAccountableEmployeeId: "emp-next-accountable",
      eligibilityPolicy: POLICY,
    }),
  );
  assert.equal(err.code, "AUTHORITATIVE_READ_UNAVAILABLE");
  assert.equal(h.unit.pending.length, 0);
});

test("#189 OD-16: the governed change path REFUSES an out-of-scope family, and writes nothing", async () => {
  for (const family of ["account", "workOrder", "supplier"]) {
    const h = unitFor(family);
    const err = await refusal(
      stageGovernedResponsibilityHandoff(h.deps(), {
        axis: "ACCOUNTABILITY",
        tenantId: TENANT,
        family,
        recordId: "rec-1",
        actorUid: "uid-actor",
        newAccountableEmployeeId: "emp-next-accountable",
        eligibilityPolicy: POLICY,
      }),
    );
    assert.equal(err.code, "FAMILY_NOT_ACCOUNTABLE", `${family} accepted an accountability handoff`);
    assert.match(err.message, /not MISSING, not OWNERLESS, not DEFECTIVE/);
    assert.equal(h.unit.pending.length, 0);
  }
});

// ════════════════════ 3. THE CENSUS AND THE GATE SEE THE REAL RECORDS ════════════════════

test("the CENSUS and the GATE both see records produced by the REAL creation path", async () => {
  const authority = employeeAuthority();
  const documents = {};
  for (const family of ACCOUNTABILITY_FAMILIES) {
    const established = await establish({ family, explicitAccountableEmployeeId: "emp-accountable" }, authority);
    documents[family] = [{ id: `${family}-1`, data: BUILDERS[family]({ accountablePerson: established }) }];
  }
  const accountability = [];
  for (const family of ACCOUNTABILITY_FAMILIES) {
    accountability.push(
      await censusAccountabilityFamily(
        { employeeAuthority: authority, eligibilityPolicy: POLICY },
        family,
        TENANT,
        documents[family],
      ),
    );
  }
  for (const report of accountability) {
    assert.equal(report.scanned, 1);
    assert.equal(
      report.counts.presentValidEligible,
      1,
      `${report.family}: the census did not recognise a record the real builder produced`,
    );
  }

  const ownership = [
    censusFamily(
      CENSUS_FAMILIES.find((f) => f.family === "opportunity"),
      [{ id: "opportunity-1", data: documents.opportunity[0].data }],
    ),
  ];
  const verdict = responsibilityEnforcementGate({ ownership, accountability });
  assert.equal(verdict.accountability.measuredFamilies, 3);
  assert.equal(verdict.accountability.totals.presentValidEligible, 3);
  assert.equal(verdict.ownership.totals.resolved, 1, "the gate did not see the real record's OWNER either");
  assert.deepEqual(verdict.defects, []);
  assert.equal(verdict.enforceable, true);
});

test("after a governed ACCOUNTABILITY handoff, the census sees the NEW person and the SAME owner", async () => {
  const h = unitFor();
  await stageGovernedResponsibilityHandoff(h.deps(), {
    axis: "ACCOUNTABILITY",
    tenantId: TENANT,
    family: "opportunity",
    recordId: "rec-1",
    actorUid: "uid-actor",
    newAccountableEmployeeId: "emp-next-accountable",
    eligibilityPolicy: POLICY,
  });
  h.unit.commit();

  const report = await censusAccountabilityFamily(
    { employeeAuthority: employeeAuthority(), eligibilityPolicy: POLICY },
    "opportunity",
    TENANT,
    [{ id: "rec-1", data: h.record() }],
  );
  assert.equal(report.counts.presentValidEligible, 1, "the census could not read what the handoff wrote");
  const ownership = [
    censusFamily(CENSUS_FAMILIES.find((f) => f.family === "opportunity"), [{ id: "rec-1", data: h.record() }]),
  ];
  assert.equal(
    censusFamily(CENSUS_FAMILIES.find((f) => f.family === "opportunity"), [{ id: "rec-1", data: h.record() }])
      .counts.resolved,
    1,
    "the accountability handoff disturbed the ownership census's view of the same record",
  );
  void ownership;
});

// ════════════════════ 4. NO FIRESTORE FALLBACK — PROVED BY SUBPROCESS ════════════════════

test("no responsibility module imports Firebase, a legacy identity store, or a driver", () => {
  for (const file of [
    "accountablePersonStorage.ts",
    "accountablePersonEstablishment.ts",
    "accountablePersonRecordStore.ts",
    "accountabilityCensus.ts",
    "responsibilityEnforcementGate.ts",
    "governedResponsibilityHandoff.ts",
    "accountabilityFamilyScope.ts",
  ]) {
    const src = readFileSync(join(SRC, "responsibility", file), "utf8");
    const imports = [...src.matchAll(/^\s*import[\s\S]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    for (const specifier of imports) {
      for (const forbidden of ["firebase", "pg", "node:", "@google-cloud"]) {
        assert.ok(
          !specifier.startsWith(forbidden),
          `${file} imports "${specifier}". The accountability axis must hold no storage client and no ` +
            "Firebase module — #187 §2 forbids any silent fallback, and a module graph that cannot " +
            "reach a fallback is the strongest form of that rule.",
        );
      }
    }
    // And no legacy identity store is named ANYWHERE in the code (comments stripped: the headers
    // legitimately quote the rulings that name them).
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const store of ["fieldops_technicians", "getAuth", "getFirestore", "collection("]) {
      assert.ok(!code.includes(store), `${file} names ${store} in code`);
    }
  }
});

const SENTINEL = "ACCOUNTABILITY_LOADED_A_FORBIDDEN_MODULE";

test("running the accountability path never RESOLVES a Firebase module", () => {
  // The static check above proves the import is not WRITTEN. This proves it is never RESOLVED, on the
  // real paths, in a real process. `Module._load` fires on RESOLUTION, so it catches an attempt even
  // when the package is installed and cannot be defeated by code that loads the SDK and never calls it.
  //
  // SCOPE, STATED EXACTLY, because a proof whose scope is vague is worth less than a smaller honest one:
  // this drives the ESTABLISHMENT, the BUILDER, the real accountability STORE, the CENSUS and the GATE.
  // It does NOT import `governedResponsibilityHandoff`, and the test immediately below says why and
  // measures the reason -- that module reaches `firebase-admin/firestore` transitively through the
  // OWNERSHIP axis's audit writer, which is a pre-existing ownership dependency and not an
  // accountability fallback. Hiding that inside a broader claim would have made this test a lie.
  const dir = mkdtempSync(join(tmpdir(), "eos-accountability-"));
  const preload = join(dir, "banFirebase.cjs");
  writeFileSync(
    preload,
    `const Module = require("node:module");
const BANNED = [/^firebase-admin(\\/|$)/, /^firebase(\\/|$)/, /^firebase-functions(\\/|$)/, /^@google-cloud\\//];
const original = Module._load;
Module._load = function (request) {
  if (BANNED.some((re) => re.test(request))) process.stderr.write("${SENTINEL}:" + request + "\\n");
  return original.apply(this, arguments);
};
`,
    "utf8",
  );

  const lib = (p) => resolve(FUNCTIONS_DIR, "lib", p);
  const driver = join(dir, "drive.mjs");
  writeFileSync(
    driver,
    `import { establishCreationAccountablePerson } from "${lib("responsibility/accountablePersonEstablishment.js")}";
import { createRecordAccountabilityStore } from "${lib("responsibility/accountablePersonRecordStore.js")}";
import { censusAccountabilityFamily } from "${lib("responsibility/accountabilityCensus.js")}";
import { responsibilityEnforcementGate } from "${lib("responsibility/responsibilityEnforcementGate.js")}";
import { buildCreateOpportunity } from "${lib("opportunity/opportunityCommands.js")}";

const POLICY = { policyId: "SUBPROCESS", eligibleStatuses: ["ACTIVE"] };
const outcomes = [];
const authority = (mode) => ({
  async resolveEmployeeReference(reference) {
    if (mode === "unavailable") {
      return { outcome: "AUTHORITY_UNAVAILABLE", reference, reason: "AUTHORITY_READ_FAILED", detail: "down" };
    }
    if (mode === "missing") return { outcome: "NOT_FOUND", reference };
    return {
      outcome: "RESOLVED", reference,
      employee: { employeeId: reference.employeeId, tenantId: reference.tenantId, employmentStatus: "ACTIVE", operatingCompanyId: "taylor" },
    };
  },
});

// 1. the three establishment paths, including both fail-closed ones.
for (const mode of ["ok", "unavailable", "missing"]) {
  try {
    const e = await establishCreationAccountablePerson({ employeeAuthority: authority(mode) }, {
      tenantId: "t", family: "opportunity", explicitAccountableEmployeeId: "emp-1", eligibilityPolicy: POLICY,
    });
    outcomes.push(e.source);
  } catch (err) { outcomes.push(err.code); }
}

// 2. a real build, and a real governed handoff through the real store.
const established = await establishCreationAccountablePerson({ employeeAuthority: authority("ok") }, {
  tenantId: "t", family: "opportunity", explicitAccountableEmployeeId: "emp-1", eligibilityPolicy: POLICY,
});
const built = buildCreateOpportunity({
  accountId: "a", ownerEmployeeId: "emp-owner", operatingCompanyId: "taylor", salesChannel: "RETAIL",
  lines: [{ kind: "PART", ref: "p", qty: 1 }], accountablePerson: established,
}, { actorUid: "u", nowMillis: 1 });
outcomes.push(built.accountableEmployeeId);

const fields = { ...built };
const target = { tenantId: "t", family: "opportunity", recordId: "r1" };
const store = createRecordAccountabilityStore({
  async readFields() { return { outcome: "READ", fields }; },
  stageFieldWrite(t, next) { Object.assign(fields, next); },
});
// The real store, driven directly: read the current person, then stage a governed value over it.
const current = await store.readCurrentAccountablePerson(target);
outcomes.push(current.accountableEmployeeId);
const next = await establishCreationAccountablePerson({ employeeAuthority: authority("ok") }, {
  tenantId: "t", family: "opportunity", explicitAccountableEmployeeId: "emp-2", eligibilityPolicy: POLICY,
});
store.stageAccountablePersonWrite(target, next);
outcomes.push(fields.accountableEmployeeId);

// 3. the census and the gate, over the record the handoff just changed.
const report = await censusAccountabilityFamily({ employeeAuthority: authority("ok"), eligibilityPolicy: POLICY },
  "opportunity", "t", [{ id: "r1", data: fields }]);
outcomes.push(String(report.counts.presentValidEligible));
const verdict = responsibilityEnforcementGate({ ownership: [], accountability: [report] });
outcomes.push(String(verdict.enforceable));

process.stdout.write(outcomes.join(","));
`,
    "utf8",
  );

  const res = spawnSync(process.execPath, ["--require", preload, driver], {
    cwd: FUNCTIONS_DIR,
    encoding: "utf8",
  });
  assert.equal(res.status, 0, `driver failed: ${res.stderr}`);
  assert.ok(
    !res.stderr.includes(SENTINEL),
    `a Firebase module was RESOLVED while running the accountability path: ${res.stderr}`,
  );
  // And the path really ran, so the clean stderr is not clean because nothing happened.
  assert.equal(
    res.stdout,
    [
      "EXPLICIT",
      "AUTHORITY_UNAVAILABLE",
      "EXPLICIT_PERSON_INVALID",
      "emp-1",
      "emp-1",
      "emp-2",
      "1",
      // The gate is NOT enforceable, because only one of the three in-scope families was censused --
      // which is the anti-vacuity rule holding inside the subprocess too.
      "false",
    ].join(","),
    "the subprocess did not exercise the path it was supposed to",
  );
});

test("MEASURED: the CHANGE path reaches firebase-admin through the OWNERSHIP audit writer, and only there", () => {
  // A finding, recorded rather than hidden. `governedResponsibilityHandoff.ts` DOES resolve
  // `firebase-admin/firestore` when it loads, and the chain is exactly:
  //
  //   governedResponsibilityHandoff.ts
  //     -> ownership/ownershipHandoffCommand.ts   (runtime import, for the RETAINED pure builder)
  //        -> access/auditEventWriter.ts          (`stageAuditEvent`, a runtime import)
  //           -> firebase-admin/firestore
  //
  // This is the OWNERSHIP axis's audit staging, it predates Wave 2C, and it is NOT an accountability
  // fallback: #187 §2 forbids falling back to Firestore, `users`, `fieldops_technicians` or Firebase UID
  // coincidence FOR PERSON RESOLUTION, and none of those happens. The assertions below pin the chain so
  // that it cannot quietly become something else, and pin the absence that makes it harmless.
  const handoff = readFileSync(join(SRC, "responsibility", "governedResponsibilityHandoff.ts"), "utf8");

  // The audit writer is imported TYPE-ONLY here, so this module does not reach Firebase through its own
  // import of it.
  assert.match(
    handoff,
    /import type \{[\s\S]*?\} from "\.\.\/access\/auditEventWriter"/,
    "the responsibility boundary now imports the audit writer at RUNTIME. It must stay type-only: the " +
      "audit event SHAPE is the governed writer's, and staging it is the governed writer's job.",
  );
  // The runtime chain runs through the pure ownership builder, which is what the ruling RETAINED.
  assert.match(handoff, /from "\.\.\/ownership\/ownershipHandoffCommand"/);
  const handoffCommand = readFileSync(join(SRC, "ownership", "ownershipHandoffCommand.ts"), "utf8");
  assert.match(
    handoffCommand,
    /stageAuditEvent/,
    "ownershipHandoffCommand no longer imports stageAuditEvent — the recorded dependency chain has " +
      "changed and this finding must be re-measured",
  );

  // AND THE ACCOUNTABILITY BRANCH USES NONE OF IT. The accountability path stages through its own
  // ports, and nothing in it names the ownership audit or the audit writer's runtime.
  const code = handoff.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const start = code.indexOf("async function handoffAccountability");
  assert.ok(start > 0, "handoffAccountability is gone");
  const body = code.slice(start, code.indexOf("\nexport async function stageGovernedResponsibilityHandoff"));
  for (const forbidden of ["stageAuditEvent", "ownershipAudit", "ownershipRecords", "buildOwnershipHandoff"]) {
    assert.ok(
      !body.includes(forbidden),
      `the ACCOUNTABILITY branch names ${forbidden}. #187 §1: accountability must not be redefined as ` +
        "ownership, and the two axes must not be able to reach each other's storage or audit.",
    );
  }

  // And the accountability-only modules reach NO Firebase at all -- which is what the subprocess proof
  // above establishes, and which is why the scope of that proof is what it is.
  for (const file of [
    "accountablePersonStorage.ts",
    "accountablePersonEstablishment.ts",
    "accountablePersonRecordStore.ts",
    "accountabilityCensus.ts",
    "responsibilityEnforcementGate.ts",
  ]) {
    const src = readFileSync(join(SRC, "responsibility", file), "utf8");
    assert.ok(
      !/from\s+["'][^"']*auditEventWriter["']/.test(src.replace(/import type[\s\S]*?from/g, "IMPORT_TYPE from")),
      `${file} imports the audit writer at runtime, which would pull firebase-admin into the ` +
        "accountability-only graph",
    );
  }
});

// ════════════════════ 5. THE LOAD-BEARING ABSENCES, ONE LAST TIME ════════════════════

test("no accountability module contains an employment-status comparison or a default policy", () => {
  for (const file of [
    "accountablePersonStorage.ts",
    "accountablePersonEstablishment.ts",
    "accountablePersonRecordStore.ts",
    "accountabilityCensus.ts",
    "responsibilityEnforcementGate.ts",
  ]) {
    const code = readFileSync(join(SRC, "responsibility", file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const status of ["ACTIVE", "ON_LEAVE", "INACTIVE", "TERMINATED", "RETIRED", "CONTRACTOR"]) {
      assert.ok(
        !new RegExp(`["']${status}["']`).test(code),
        `${file} names the employment status "${status}" in code. #189 MI-epsilon: the gate consumes the ` +
          "governed eligibility result and must not flatten the six-value vocabulary into a hidden " +
          "boolean policy.",
      );
    }
    assert.ok(!/eligibleStatuses\s*[:=]\s*\[/.test(code), `${file} declares a default eligibility policy`);
  }
});

test("the governed boundary is still NOT exported from index.ts — no capability was activated", () => {
  const index = readFileSync(join(SRC, "index.ts"), "utf8");
  assert.ok(
    !/responsibility\//.test(index),
    "a responsibility module is now exported as a callable. Every capability that would gate one is " +
      "registered active:false, so exporting it means one was activated — a separate, separately " +
      "authorized decision.",
  );
});

test("firestore.rules was not touched by this wave — Tier-2 stays HOLD", () => {
  const rules = readFileSync(resolve(FUNCTIONS_DIR, "..", "firestore.rules"), "utf8");
  assert.ok(!/accountab/i.test(rules), "firestore.rules now names accountability");
  // And the runtime consequence, recorded rather than acted on: the three commercial collections are
  // Admin-SDK-only, so the accountability field is unreachable from any client.
  for (const collection of ["opportunities", "sales_orders", "sales_agreements"]) {
    const at = rules.indexOf(`match /${collection}/{`);
    assert.ok(at > 0, `the ${collection} Rules block is gone`);
    assert.match(
      rules.slice(at, at + 200),
      /allow read, write: if false;/,
      `${collection} is no longer Admin-SDK-only, so a client-direct accountability write path may exist`,
    );
  }
});
