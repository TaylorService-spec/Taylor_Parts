// ACCOUNTABLE PERSON PERSISTENCE — the storage, the governed value, the creation rule, the store.
//
// ════════════════════ WHAT IS WORTH PROVING HERE ════════════════════
//
// Not that a field can be written. Five things, each of which is a way this could be wrong in a way
// no later test would catch:
//
//   1. THE AXIS IS NOT COLLAPSED. Owner and accountable are independent in the STORAGE and in the
//      COMMANDS — no field is overloaded, no read falls back to the other, and a change to one never
//      moves the other. #180, #181, #187 §1.
//   2. THE CREATION RULE IS THE RULING'S. EXPLICIT VALID → GOVERNED DERIVATION FROM CURRENT RECORD
//      OWNER → REFUSE, with VALID meaning an authoritative Employee answer and CURRENT ELIGIBILITY
//      meaning a stated governed policy. #181, #182 §5, #189 `MI-ε`.
//   3. AUTHORITY_UNAVAILABLE IS NEVER A VERDICT ABOUT THE PERSON. Its own code, on every path, and no
//      fallback anywhere. #187 §2.
//   4. AN UNGOVERNED VALUE CANNOT BECOME PERSISTED ACCOUNTABILITY. The builders refuse an id, a plain
//      object, and a serialized copy of a real establishment. #184.
//   5. A LEGACY UNREADABLE REFERENCE IS NEITHER ABSENT NOR AN OUTAGE, and is never overwritten.
//      #189 `MI-λ`.
//
// No database and no emulator: the Employee authority is a double, and the storage is a document port.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACCOUNTABILITY_FAMILIES,
  ACCOUNTABLE_PERSON_FIELD,
  ACCOUNTABLE_PERSON_SOURCES,
  ACCOUNTABLE_PERSON_SOURCE_FIELD,
  ACCOUNTABLE_PERSON_STORAGE,
  ACCOUNTABILITY_EXCEPTION_FIELD,
  accountabilityExceptionId,
  accountabilityRecordContext,
  accountablePersonFields,
  accountablePersonStorage,
  isGovernedAccountablePerson,
  mintGovernedAccountablePerson,
  readStoredAccountablePerson,
} from "../lib/responsibility/accountablePersonStorage.js";
import { establishCreationAccountablePerson } from "../lib/responsibility/accountablePersonEstablishment.js";
import { createRecordAccountabilityStore } from "../lib/responsibility/accountablePersonRecordStore.js";
import { decideAccountabilityEligibility } from "../lib/employeeIdentity/employeeAuthority.js";
import { buildCreateOpportunity, buildUpdateOpportunity } from "../lib/opportunity/opportunityCommands.js";
import {
  buildCreateSalesAgreement,
  buildUpdateSalesAgreementDraft,
  SALES_AGREEMENT_DRAFT_EDITABLE_FIELDS,
} from "../lib/salesAgreement/salesAgreementCommands.js";
import { buildCreateSalesOrder } from "../lib/salesOrder/salesOrderCommands.js";
import { ALL_FAMILIES } from "../lib/ownership/ownershipCensus.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");
const SRC = join(FUNCTIONS_DIR, "src");

const TENANT = "tenant-a";
const CTX = { actorUid: "uid-actor", nowMillis: 1000 };

/**
 * The GOVERNED ELIGIBILITY POLICY these tests use, stated in full every time it matters.
 *
 * It accepts ACTIVE and CONTRACTOR — deliberately NOT just ACTIVE. #189 `MI-ε` forbids implementing
 * eligibility as `status !== "ACTIVE"`, and a test suite whose only policy were `["ACTIVE"]` could not
 * tell a correct implementation from that forbidden one. With CONTRACTOR eligible and ON_LEAVE not,
 * an implementation that secretly compared against ACTIVE fails.
 */
const POLICY = Object.freeze({
  policyId: "WAVE2C-TEST-COMMERCIAL-ACCOUNTABILITY",
  eligibleStatuses: Object.freeze(["ACTIVE", "CONTRACTOR"]),
});

/** An Employee authority double. `byId` maps employee id → facts; anything absent is NOT_FOUND. */
function employeeAuthority(byId) {
  const calls = [];
  return {
    calls,
    async resolveEmployeeReference(reference) {
      calls.push(reference);
      const facts = byId[reference.employeeId];
      if (facts === undefined) return { outcome: "NOT_FOUND", reference };
      return {
        outcome: "RESOLVED",
        reference,
        employee: {
          employeeId: reference.employeeId,
          tenantId: reference.tenantId,
          employmentStatus: facts.employmentStatus,
          operatingCompanyId: facts.operatingCompanyId ?? "taylor",
        },
      };
    },
  };
}

/** An authority that cannot answer. NOT an authority that answers "no". #187 §2. */
function unavailableAuthority(reason = "AUTHORITY_READ_FAILED") {
  return {
    async resolveEmployeeReference(reference) {
      return { outcome: "AUTHORITY_UNAVAILABLE", reference, reason, detail: "the server is down" };
    },
  };
}

const PEOPLE = Object.freeze({
  "emp-active": { employmentStatus: "ACTIVE" },
  "emp-contractor": { employmentStatus: "CONTRACTOR" },
  "emp-on-leave": { employmentStatus: "ON_LEAVE" },
  "emp-inactive": { employmentStatus: "INACTIVE" },
  "emp-terminated": { employmentStatus: "TERMINATED" },
  "emp-retired": { employmentStatus: "RETIRED" },
  "emp-owner": { employmentStatus: "ACTIVE" },
  "emp-owner-terminated": { employmentStatus: "TERMINATED" },
});

const establish = (request, authority = employeeAuthority(PEOPLE)) =>
  establishCreationAccountablePerson({ employeeAuthority: authority }, {
    tenantId: TENANT,
    eligibilityPolicy: POLICY,
    ...request,
  });

const governed = async (employeeId, family = "opportunity") =>
  establish({ family, explicitAccountableEmployeeId: employeeId });

const refusal = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  assert.fail("expected a refusal, got a result");
};

// ════════════════════ 1. THE STORAGE DECLARATION ════════════════════

test("#189 OD-16: accountability storage exists for EXACTLY the three admitted families", () => {
  assert.deepEqual(
    ACCOUNTABLE_PERSON_STORAGE.map((s) => s.family),
    ["opportunity", "salesAgreement", "salesOrder"],
  );
  assert.deepEqual([...ACCOUNTABILITY_FAMILIES], ["opportunity", "salesAgreement", "salesOrder"]);
  // Every OTHER family in the ownership matrix has NO accountability storage, which is what makes
  // NOT APPLICABLE a fact about it rather than a claim.
  const admitted = new Set(ACCOUNTABILITY_FAMILIES);
  for (const family of ALL_FAMILIES) {
    if (admitted.has(family.family)) continue;
    assert.equal(
      accountablePersonStorage(family.family),
      null,
      `${family.family} has accountability storage. #189 OD-16: accountability is NOT APPLICABLE to ` +
        "every family outside the three — reference and master-data objects must not acquire fake " +
        "personal accountability.",
    );
  }
});

test("the storage declaration matches the ownership matrix's collections, and migration 020's tables", () => {
  const migration = readFileSync(
    join(FUNCTIONS_DIR, "migrations", "1759276800000_commercial-accountability-authority.sql"),
    "utf8",
  );
  for (const storage of ACCOUNTABLE_PERSON_STORAGE) {
    const matrixFamily = ALL_FAMILIES.find((f) => f.family === storage.family);
    assert.ok(matrixFamily, `${storage.family} is not in the ownership matrix`);
    assert.equal(
      storage.collection,
      matrixFamily.collection,
      "the accountability storage names a different collection than the ownership matrix does for the " +
        "same family — one family must be one record, whichever axis is asking",
    );
    // The SQL side must actually exist in the migration, by name.
    assert.match(
      migration,
      new RegExp(`ALTER TABLE ${storage.table.split(".")[1]}[\\s\\S]{0,200}ADD COLUMN ${storage.column}`),
      `migration 020 does not add ${storage.column} to ${storage.table}`,
    );
  }
});

test("#187 §1: no accountability field is in ownershipMatrix.ownerFields, and vice versa", () => {
  for (const family of ALL_FAMILIES) {
    for (const field of family.ownerFields) {
      assert.ok(!/accountab/i.test(field), `${family.family} declares "${field}" as an OWNERSHIP field`);
      assert.notEqual(field, ACCOUNTABLE_PERSON_FIELD);
    }
  }
  // And the accountability field is not an ownership field name either — no overloading in either
  // direction. #181 forbids overloading `ownerEmployeeId`; this asserts the field chosen is not it.
  assert.notEqual(ACCOUNTABLE_PERSON_FIELD, "ownerEmployeeId");
  assert.notEqual(ACCOUNTABLE_PERSON_FIELD, "ownerId");
  assert.notEqual(ACCOUNTABLE_PERSON_FIELD, "assignedEmployeeId");
  assert.notEqual(ACCOUNTABLE_PERSON_FIELD, "technicianId");
  assert.notEqual(ACCOUNTABLE_PERSON_FIELD, "managerId");
  assert.notEqual(ACCOUNTABLE_PERSON_FIELD, "creditedSalespersonId");
});

// ════════════════════ 2. READING A STORED VALUE ════════════════════

test("a stored usable id reads PRESENT, and the recorded source comes back unchanged", () => {
  const read = readStoredAccountablePerson({
    [ACCOUNTABLE_PERSON_FIELD]: "emp-active",
    [ACCOUNTABLE_PERSON_SOURCE_FIELD]: "DERIVED_FROM_RECORD_OWNER",
  });
  assert.equal(read.state, "PRESENT");
  assert.equal(read.accountableEmployeeId, "emp-active");
  assert.equal(read.source, "DERIVED_FROM_RECORD_OWNER");
});

test("an absent field reads ABSENT — and NEVER falls back to ownerEmployeeId (#181)", () => {
  for (const data of [{}, { [ACCOUNTABLE_PERSON_FIELD]: null }, { [ACCOUNTABLE_PERSON_FIELD]: undefined }]) {
    const read = readStoredAccountablePerson(data);
    assert.equal(read.state, "ABSENT");
    assert.equal(read.accountableEmployeeId, null);
  }
  // The case that matters: a record with an owner and no accountable person is ABSENT, not PRESENT.
  // A read-side `?? ownerEmployeeId` would install #181's forbidden permanent identity more quietly
  // than a write-side one would, and would make the census structurally unable to count the gap.
  const owned = readStoredAccountablePerson({ ownerEmployeeId: "emp-owner" });
  assert.equal(owned.state, "ABSENT");
  assert.equal(owned.accountableEmployeeId, null);
});

test("#189 MI-λ: an unusable stored value is UNREADABLE — neither absent nor valid", () => {
  for (const raw of ["", "  ", " emp-active", "employees/emp-active", 7, {}, [], true]) {
    const read = readStoredAccountablePerson({ [ACCOUNTABLE_PERSON_FIELD]: raw });
    assert.equal(read.state, "UNREADABLE", `${JSON.stringify(raw)} was not classified UNREADABLE`);
    assert.equal(read.accountableEmployeeId, null, "an unusable value is not an id");
    assert.ok(read.detail, "UNREADABLE must say why — it is a quarantine finding, not a shrug");
  }
});

test("an unrecognised stored source is dropped rather than trusted, and never invented", () => {
  const read = readStoredAccountablePerson({
    [ACCOUNTABLE_PERSON_FIELD]: "emp-active",
    [ACCOUNTABLE_PERSON_SOURCE_FIELD]: "MAGIC",
  });
  assert.equal(read.state, "PRESENT");
  assert.equal(read.source, null, "an ungoverned source value must not be reported as a governed one");
  assert.deepEqual([...ACCOUNTABLE_PERSON_SOURCES], ["EXPLICIT", "DERIVED_FROM_RECORD_OWNER"]);
});

// ════════════════════ 3. ACTIONABLE vs HISTORICAL ════════════════════

test("each family's ACTIONABLE/HISTORICAL split is its OWN terminal vocabulary", () => {
  assert.equal(accountabilityRecordContext("opportunity", { stage: "DECISION", outcome: null }), "ACTIONABLE");
  assert.equal(accountabilityRecordContext("opportunity", { outcome: "WON" }), "HISTORICAL");
  assert.equal(accountabilityRecordContext("opportunity", { outcome: "LOST" }), "HISTORICAL");

  assert.equal(accountabilityRecordContext("salesAgreement", { state: "DRAFT" }), "ACTIONABLE");
  assert.equal(accountabilityRecordContext("salesAgreement", { state: "ACCEPTED" }), "HISTORICAL");
  assert.equal(accountabilityRecordContext("salesAgreement", { state: "DECLINED" }), "HISTORICAL");

  for (const state of ["CONFIRMED", "IN_FULFILLMENT", "FULFILLED"]) {
    assert.equal(accountabilityRecordContext("salesOrder", { state }), "ACTIONABLE");
  }
  assert.equal(accountabilityRecordContext("salesOrder", { state: "CLOSED" }), "HISTORICAL");
  assert.equal(accountabilityRecordContext("salesOrder", { state: "CANCELLED" }), "HISTORICAL");

  // A Sales Order state is NOT read as an Opportunity outcome and vice versa: each family reads its
  // own field, so a cross-family value does not accidentally mean "closed".
  assert.equal(accountabilityRecordContext("opportunity", { state: "CLOSED" }), "ACTIONABLE");
});

test("an unreadable lifecycle FAILS TOWARD ACTIONABLE, because HISTORICAL is the lenient answer", () => {
  for (const data of [{}, { outcome: 7 }, { outcome: null }, { outcome: "MYSTERY" }]) {
    assert.equal(accountabilityRecordContext("opportunity", data), "ACTIONABLE");
  }
  // #186 §7 exempts history from current-eligibility enforcement, so a record called HISTORICAL by
  // accident would be silently exempted from the gate. That is the expensive direction.
});

// ════════════════════ 4. THE GOVERNED VALUE — MINT AND BRAND ════════════════════

const facts = (employeeId, employmentStatus) => ({
  employeeId,
  tenantId: TENANT,
  employmentStatus,
  operatingCompanyId: "taylor",
});

test("the mint produces a governed value carrying all three separate facts (#186 §2)", () => {
  const f = facts("emp-contractor", "CONTRACTOR");
  const minted = mintGovernedAccountablePerson(f, decideAccountabilityEligibility(f, POLICY), "EXPLICIT");
  assert.equal(minted.accountableEmployeeId, "emp-contractor");
  assert.equal(minted.source, "EXPLICIT");
  assert.equal(minted.eligibilityPolicyId, POLICY.policyId);
  assert.equal(minted.employmentStatus, "CONTRACTOR", "the lifecycle status stays independently visible");
  assert.ok(isGovernedAccountablePerson(minted));
});

test("#189 MI-ε: the mint REFUSES a negative eligibility verdict, whatever the status is", () => {
  for (const [id, status] of [
    ["emp-on-leave", "ON_LEAVE"],
    ["emp-inactive", "INACTIVE"],
    ["emp-terminated", "TERMINATED"],
    ["emp-retired", "RETIRED"],
  ]) {
    const f = facts(id, status);
    assert.throws(
      () => mintGovernedAccountablePerson(f, decideAccountabilityEligibility(f, POLICY), "EXPLICIT"),
      (e) => e.code === "NOT_CURRENTLY_ELIGIBLE",
      `${status} was minted`,
    );
  }
  // And CONTRACTOR — which is NOT ACTIVE — is minted, because the stated policy accepts it. An
  // implementation of `status !== "ACTIVE" → refuse` fails exactly here.
  const c = facts("emp-contractor", "CONTRACTOR");
  assert.ok(mintGovernedAccountablePerson(c, decideAccountabilityEligibility(c, POLICY), "EXPLICIT"));
});

test("a hand-assembled eligibility verdict cannot lie about which person it judged", () => {
  const terminated = facts("emp-terminated", "TERMINATED");
  const forged = { eligible: true, policyId: POLICY.policyId, employmentStatus: "ACTIVE" };
  assert.throws(
    () => mintGovernedAccountablePerson(terminated, forged, "EXPLICIT"),
    (e) => e.code === "ELIGIBILITY_DOES_NOT_MATCH_EMPLOYEE",
  );
});

test("the mint refuses an unstated policy author, an unusable id, and an ungoverned source", () => {
  const active = facts("emp-active", "ACTIVE");
  const ok = decideAccountabilityEligibility(active, POLICY);
  assert.throws(
    () => mintGovernedAccountablePerson(active, { ...ok, policyId: "  " }, "EXPLICIT"),
    (e) => e.code === "ELIGIBILITY_POLICY_UNSTATED",
  );
  for (const bad of ["", " emp", "a/b"]) {
    assert.throws(
      () => mintGovernedAccountablePerson(facts(bad, "ACTIVE"), { ...ok }, "EXPLICIT"),
      (e) => e.code === "EMPLOYEE_FACTS_UNUSABLE",
      `${JSON.stringify(bad)} was accepted as an Employee id`,
    );
  }
  assert.throws(
    () => mintGovernedAccountablePerson(active, ok, "BECAUSE_I_SAID_SO"),
    (e) => e.code === "SOURCE_UNGOVERNED",
  );
});

test("the governed mark cannot be forged, by shape or by serialization", async () => {
  const real = await governed("emp-active");
  assert.ok(isGovernedAccountablePerson(real));

  // A plain object with every visible field of a real one.
  assert.equal(isGovernedAccountablePerson({ ...real }), false, "a spread copy carried the mark");
  assert.equal(
    isGovernedAccountablePerson({
      accountableEmployeeId: "emp-active",
      source: "EXPLICIT",
      eligibilityPolicyId: POLICY.policyId,
      employmentStatus: "ACTIVE",
    }),
    false,
  );
  // A JSON round-trip — which is what a value that crossed a process or transport boundary looks like.
  assert.equal(isGovernedAccountablePerson(JSON.parse(JSON.stringify(real))), false);
  assert.equal(isGovernedAccountablePerson(structuredClone(real)), false);
  // And the obvious ones.
  for (const junk of ["emp-active", null, undefined, 7, [], {}]) {
    assert.equal(isGovernedAccountablePerson(junk), false);
  }
});

test("accountablePersonFields produces the TWO fields and refuses an ungoverned value", async () => {
  const real = await governed("emp-active");
  assert.deepEqual(accountablePersonFields(real), {
    [ACCOUNTABLE_PERSON_FIELD]: "emp-active",
    [ACCOUNTABLE_PERSON_SOURCE_FIELD]: "EXPLICIT",
  });
  // It writes NO owner field, no assignment field and no credit field.
  const keys = Object.keys(accountablePersonFields(real));
  assert.deepEqual(keys.sort(), [ACCOUNTABLE_PERSON_FIELD, ACCOUNTABLE_PERSON_SOURCE_FIELD].sort());
  assert.throws(() => accountablePersonFields({ ...real }), (e) => e instanceof Error);
});

// ════════════════════ 5. THE CREATION RULE (#181) ════════════════════

for (const family of ACCOUNTABILITY_FAMILIES) {
  test(`#181 ${family}: RUNG 1 — an EXPLICIT VALID accountable person is accepted`, async () => {
    const authority = employeeAuthority(PEOPLE);
    const established = await establish(
      { family, explicitAccountableEmployeeId: "emp-active", currentRecordOwnerEmployeeId: "emp-owner" },
      authority,
    );
    assert.equal(established.accountableEmployeeId, "emp-active");
    assert.equal(established.source, "EXPLICIT");
    // The OWNER was never resolved: rung 1 succeeded, so rung 2 was not reached. #182 §1 — one
    // person's validation is never validation for another person fact, and here it is not even asked.
    assert.deepEqual(authority.calls.map((c) => c.employeeId), ["emp-active"]);
  });

  test(`#181 ${family}: RUNG 2 — no explicit person derives from the CURRENT RECORD OWNER`, async () => {
    const established = await establish({ family, currentRecordOwnerEmployeeId: "emp-owner" });
    assert.equal(established.accountableEmployeeId, "emp-owner");
    assert.equal(
      established.source,
      "DERIVED_FROM_RECORD_OWNER",
      "the source must record that this was INITIALIZATION, not an asserted accountability (#181)",
    );
  });

  test(`#181 ${family}: RUNG 3 — no explicit person and no derivable owner REFUSES`, async () => {
    const err = await refusal(establish({ family }));
    assert.equal(err.code, "NO_ACCOUNTABLE_PERSON_RESOLVED");
    // And it refuses for BOTH shapes of "no owner".
    for (const owner of [null, "", "   "]) {
      const e = await refusal(establish({ family, currentRecordOwnerEmployeeId: owner }));
      assert.equal(e.code, "NO_ACCOUNTABLE_PERSON_RESOLVED");
    }
  });

  test(`#182 §1 ${family}: an INVALID explicit person REFUSES and does NOT fall through to the owner`, async () => {
    const authority = employeeAuthority(PEOPLE);
    const err = await refusal(
      establish(
        { family, explicitAccountableEmployeeId: "emp-ghost", currentRecordOwnerEmployeeId: "emp-owner" },
        authority,
      ),
    );
    assert.equal(err.code, "EXPLICIT_PERSON_INVALID");
    assert.equal(err.authorityCode, "EMPLOYEE_REFERENCE_NOT_FOUND");
    // THE POINT: the owner was never consulted. Falling through would silently make somebody ELSE
    // accountable than the person the command named, and report success.
    assert.deepEqual(authority.calls.map((c) => c.employeeId), ["emp-ghost"]);
  });

  test(`#189 MI-ε ${family}: a VALID but NOT CURRENTLY ELIGIBLE explicit person REFUSES`, async () => {
    for (const id of ["emp-on-leave", "emp-inactive", "emp-terminated", "emp-retired"]) {
      const err = await refusal(establish({ family, explicitAccountableEmployeeId: id }));
      assert.equal(err.code, "EXPLICIT_PERSON_NOT_CURRENTLY_ELIGIBLE", `${id} was accepted`);
      assert.match(err.message, /remain valid/, "the refusal must say the reference stays valid (#186 §7)");
    }
  });

  test(`#182 §5 ${family}: derivation from an INELIGIBLE owner REFUSES rather than substituting`, async () => {
    const err = await refusal(establish({ family, currentRecordOwnerEmployeeId: "emp-owner-terminated" }));
    assert.equal(err.code, "DERIVED_PERSON_NOT_CURRENTLY_ELIGIBLE");
    const missing = await refusal(establish({ family, currentRecordOwnerEmployeeId: "emp-ghost-owner" }));
    assert.equal(missing.code, "DERIVED_PERSON_INVALID");
  });

  test(`#187 §2 ${family}: AUTHORITY_UNAVAILABLE fails closed with its OWN code, on both rungs`, async () => {
    for (const request of [
      { family, explicitAccountableEmployeeId: "emp-active" },
      { family, currentRecordOwnerEmployeeId: "emp-owner" },
    ]) {
      const err = await refusal(establish(request, unavailableAuthority()));
      assert.equal(err.code, "AUTHORITY_UNAVAILABLE");
      assert.notEqual(err.code, "EXPLICIT_PERSON_INVALID");
      assert.notEqual(err.code, "DERIVED_PERSON_INVALID");
      assert.notEqual(err.code, "NO_ACCOUNTABLE_PERSON_RESOLVED");
      assert.match(err.message, /NOT a finding|could not answer|authority/i);
    }
  });
}

test("#189 OD-16: establishment REFUSES for a family outside the governed three", async () => {
  for (const family of ["account", "workOrder", "supplier", "equipment", "purchaseOrder", "", null]) {
    const err = await refusal(establish({ family, explicitAccountableEmployeeId: "emp-active" }));
    assert.equal(err.code, "FAMILY_NOT_ACCOUNTABLE", `${String(family)} was admitted`);
    assert.match(err.message, /NOT APPLICABLE/);
    // The refusal is a statement about the FAMILY, and it says so in the ruling's own words: this is
    // not a finding that the record is MISSING, OWNERLESS or DEFECTIVE an accountable person.
    assert.match(err.message, /not MISSING, not OWNERLESS, not DEFECTIVE/);
  }
});

test("#189 MI-ε: establishment REFUSES with no governed eligibility policy", async () => {
  const authority = employeeAuthority(PEOPLE);
  for (const policy of [undefined, null, {}, { policyId: "" }, { policyId: "p" }]) {
    let err;
    try {
      await establishCreationAccountablePerson(
        { employeeAuthority: authority },
        { tenantId: TENANT, family: "opportunity", explicitAccountableEmployeeId: "emp-active", eligibilityPolicy: policy },
      );
    } catch (e) {
      err = e;
    }
    assert.equal(err?.code, "ELIGIBILITY_POLICY_REQUIRED", `${JSON.stringify(policy)} was accepted`);
  }
  // The authority was never consulted: no policy means no governed answer is possible, so the refusal
  // precedes the lookup rather than discarding its result.
  assert.equal(authority.calls.length, 0);
});

test("a missing Employee authority is AUTHORITY_UNAVAILABLE, never a silent success", async () => {
  let err;
  try {
    await establishCreationAccountablePerson({}, {
      tenantId: TENANT,
      family: "opportunity",
      explicitAccountableEmployeeId: "emp-active",
      eligibilityPolicy: POLICY,
    });
  } catch (e) {
    err = e;
  }
  assert.equal(err?.code, "AUTHORITY_UNAVAILABLE");
});

test("establishment requires a tenant, because an Employee is tenant-scoped", async () => {
  for (const tenantId of [undefined, "", "  "]) {
    let err;
    try {
      await establishCreationAccountablePerson(
        { employeeAuthority: employeeAuthority(PEOPLE) },
        { tenantId, family: "opportunity", explicitAccountableEmployeeId: "emp-active", eligibilityPolicy: POLICY },
      );
    } catch (e) {
      err = e;
    }
    assert.equal(err?.code, "REQUEST_INVALID");
  }
});

test("establishment is INITIALIZATION ONLY — its contract cannot describe a change (#181)", () => {
  const src = readFileSync(join(SRC, "responsibility", "accountablePersonEstablishment.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  // No record id, no previous value, no current accountable person: there is nothing in the input by
  // which a change could be expressed, so the function cannot be repurposed into one.
  for (const forbidden of ["recordId", "previousAccountable", "currentAccountable", "expectedCurrent"]) {
    assert.ok(
      !code.includes(forbidden),
      `the establishment request names "${forbidden}" — it would then be able to describe a CHANGE, ` +
        "which belongs to the governed responsibility handoff boundary (#184), not to initialization",
    );
  }
  // And it never permanently computes accountable = owner: the owner is a rung, and the source it
  // records says DERIVED_FROM_RECORD_OWNER rather than pretending the fact was asserted.
  assert.ok(code.includes("DERIVED_FROM_RECORD_OWNER"));
});

test("#189 MI-ε: no module in the accountability axis compares an employment status literal", () => {
  for (const file of [
    "responsibility/accountablePersonStorage.ts",
    "responsibility/accountablePersonEstablishment.ts",
    "responsibility/accountablePersonRecordStore.ts",
  ]) {
    const src = readFileSync(join(SRC, file), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const status of ["ACTIVE", "ON_LEAVE", "INACTIVE", "TERMINATED", "RETIRED", "CONTRACTOR"]) {
      // The one legitimate appearance is the mirrored vocabulary LIST, which no module in this axis
      // holds — the vocabulary lives in employeeAuthority.ts. So any occurrence here is a comparison.
      assert.ok(
        !new RegExp(`["']${status}["']`).test(code),
        `${file} names the employment status "${status}" in code. #189 MI-epsilon: the gate consumes ` +
          "the governed eligibility result and must not flatten the six-value vocabulary into a " +
          "hidden boolean policy.",
      );
    }
  }
});

// ════════════════════ 6. THE BUILDERS PERSIST IT, AND REFUSE AN UNGOVERNED VALUE ════════════════════

const OPP_INPUT = Object.freeze({
  accountId: "acct-1",
  ownerEmployeeId: "emp-owner",
  operatingCompanyId: "taylor",
  salesChannel: "RETAIL",
  lines: [{ kind: "PART", ref: "p-1", qty: 1 }],
});
const AGREEMENT_INPUT = Object.freeze({
  accountId: "acct-1",
  ownerEmployeeId: "emp-owner",
  inheritedOperatingCompanyId: "taylor",
  lines: [{ kind: "PART", ref: "PRT-1", quantity: 1, unitPrice: 1000 }],
});
const ORDER_INPUT = Object.freeze({
  accountId: "acct-1",
  ownerEmployeeId: "emp-owner",
  operatingCompanyId: "taylor",
  salesChannel: "RETAIL",
  lines: [{ kind: "EQUIPMENT_MODEL", ref: "C713", orderedQty: 1, unitPrice: 12000 }],
});

const BUILDERS = Object.freeze([
  { family: "opportunity", build: (extra) => buildCreateOpportunity({ ...OPP_INPUT, ...extra }, CTX) },
  { family: "salesAgreement", build: (extra) => buildCreateSalesAgreement({ ...AGREEMENT_INPUT, ...extra }, CTX) },
  { family: "salesOrder", build: (extra) => buildCreateSalesOrder({ ...ORDER_INPUT, ...extra }, CTX) },
]);

for (const { family, build } of BUILDERS) {
  test(`${family}: a governed establishment is PERSISTED as two fields`, async () => {
    const established = await governed("emp-active", family);
    const built = build({ accountablePerson: established });
    assert.equal(built[ACCOUNTABLE_PERSON_FIELD], "emp-active");
    assert.equal(built[ACCOUNTABLE_PERSON_SOURCE_FIELD], "EXPLICIT");
    // AND THE OWNER IS UNTOUCHED AND DIFFERENT. #181: "EOS must nevertheless be able to represent
    // them as different people."
    assert.equal(built.ownerEmployeeId, "emp-owner");
    assert.notEqual(built.ownerEmployeeId, built[ACCOUNTABLE_PERSON_FIELD]);
  });

  test(`${family}: owner and accountable may legitimately be the SAME person`, async () => {
    const established = await establish({ family, currentRecordOwnerEmployeeId: "emp-owner" });
    const built = build({ accountablePerson: established });
    assert.equal(built.ownerEmployeeId, "emp-owner");
    assert.equal(built[ACCOUNTABLE_PERSON_FIELD], "emp-owner");
    // …and the SOURCE is what keeps that from being a permanent identity: it records that this was
    // derived at initialization, so nothing downstream re-derives it (#181).
    assert.equal(built[ACCOUNTABLE_PERSON_SOURCE_FIELD], "DERIVED_FROM_RECORD_OWNER");
  });

  test(`${family}: NO accountability is persisted when none was established`, () => {
    const built = build({});
    assert.ok(
      !(ACCOUNTABLE_PERSON_FIELD in built),
      "the field must be ABSENT rather than null or fabricated — MEASURE FIRST (#189 MI-lambda), and " +
        "the migration's column is NULLABLE for the same reason",
    );
    assert.ok(!(ACCOUNTABLE_PERSON_SOURCE_FIELD in built));
    // And the owner is still resolved exactly as it always was: this change is additive.
    assert.equal(built.ownerEmployeeId, "emp-owner");
  });

  test(`#184 ${family}: an UNGOVERNED accountable person is REFUSED, not coerced`, async () => {
    const real = await governed("emp-active", family);
    const forgeries = [
      "emp-active",
      { accountableEmployeeId: "emp-active", source: "EXPLICIT", eligibilityPolicyId: "p", employmentStatus: "ACTIVE" },
      { ...real },
      JSON.parse(JSON.stringify(real)),
      7,
      null,
    ];
    for (const forgery of forgeries) {
      assert.throws(
        () => build({ accountablePerson: forgery }),
        (e) => e.code === "ACCOUNTABLE_PERSON_NOT_GOVERNED",
        `${JSON.stringify(forgery)} was accepted as a governed accountable person`,
      );
    }
  });
}

// ════════════════════ 7. ACCOUNTABILITY IS NOT AN ORDINARY EDITABLE FIELD ════════════════════

test("#184: buildUpdateOpportunity REFUSES an accountability change, rather than ignoring it", () => {
  const current = { stage: "DECISION", outcome: null, updatedAtMillis: 1, ownerEmployeeId: "emp-owner" };
  for (const key of [ACCOUNTABLE_PERSON_FIELD, ACCOUNTABLE_PERSON_SOURCE_FIELD]) {
    assert.throws(
      () =>
        buildUpdateOpportunity(
          current,
          { opportunityId: "o1", expectedUpdatedAtMillis: 1, [key]: "emp-active" },
          CTX,
        ),
      (e) => e.code === "ACCOUNTABLE_PERSON_NOT_EDITABLE",
      `${key} was silently ignored instead of refused`,
    );
  }
  // The ordinary edit still works for the fields it owns, and moving the OWNER through it does NOT
  // move accountability — it cannot, because the patch never names an accountability field.
  const { patch, changes } = buildUpdateOpportunity(
    current,
    { opportunityId: "o1", expectedUpdatedAtMillis: 1, ownerEmployeeId: "emp-new-owner" },
    CTX,
  );
  assert.equal(patch.ownerEmployeeId, "emp-new-owner");
  assert.ok(!(ACCOUNTABLE_PERSON_FIELD in patch), "an ownership edit patched accountability");
  assert.deepEqual(changes.map((c) => c.field), ["ownerEmployeeId"]);
});

test("the Sales Agreement draft edit cannot reach accountability, and says so", () => {
  assert.ok(
    !SALES_AGREEMENT_DRAFT_EDITABLE_FIELDS.includes(ACCOUNTABLE_PERSON_FIELD),
    "the draft-editable allow-list gained the accountability field",
  );
  const current = { state: "DRAFT", lines: [], totals: {} };
  assert.throws(
    () => buildUpdateSalesAgreementDraft(current, { [ACCOUNTABLE_PERSON_FIELD]: "emp-active" }, CTX),
    (e) => e.code === "FIELD_NOT_EDITABLE",
  );
});

test("no Sales Order field-edit command exists at all, so there is no edit path to close", async () => {
  const mod = await import("../lib/salesOrder/salesOrderCommands.js");
  const editors = Object.keys(mod).filter((k) => /^build(Update|Edit|Patch)/.test(k));
  assert.deepEqual(
    editors,
    [],
    "a Sales Order field-edit command now exists. It must be checked against #184 before it ships: " +
      "the census's §5.2 records that this family has no edit path, and that is why it has no " +
      "accountability exposure.",
  );
});

// ════════════════════ 8. THE STORE ════════════════════

/** A document port double. Counts reads AND stages, so "zero writes" is a number. */
function documentPort(read) {
  const staged = [];
  const reads = [];
  return {
    staged,
    reads,
    async readFields(target) {
      reads.push(target);
      return read;
    },
    stageFieldWrite(target, fields) {
      staged.push({ target, fields });
    },
  };
}

const TARGET = Object.freeze({ tenantId: TENANT, family: "opportunity", recordId: "opp-1" });

test("the store reads PRESENT, ABSENT and UNREADABLE as three different answers", async () => {
  const present = createRecordAccountabilityStore(
    documentPort({ outcome: "READ", fields: { [ACCOUNTABLE_PERSON_FIELD]: "emp-active" } }),
  );
  assert.deepEqual(await present.readCurrentAccountablePerson(TARGET), {
    outcome: "READ",
    accountableEmployeeId: "emp-active",
  });

  const absent = createRecordAccountabilityStore(
    documentPort({ outcome: "READ", fields: { ownerEmployeeId: "emp-owner" } }),
  );
  assert.deepEqual(await absent.readCurrentAccountablePerson(TARGET), {
    outcome: "READ",
    accountableEmployeeId: null,
  });

  const unreadable = createRecordAccountabilityStore(
    documentPort({ outcome: "READ", fields: { [ACCOUNTABLE_PERSON_FIELD]: "  " } }),
  );
  const u = await unreadable.readCurrentAccountablePerson(TARGET);
  assert.equal(u.outcome, "CURRENT_UNREADABLE", "an unusable stored value was reported as an absence");
  assert.ok(u.detail);
});

test("#187 §2: the store passes READ_UNAVAILABLE through UNCHANGED", async () => {
  const store = createRecordAccountabilityStore(
    documentPort({ outcome: "READ_UNAVAILABLE", detail: "the database is unreachable" }),
  );
  const read = await store.readCurrentAccountablePerson(TARGET);
  assert.equal(read.outcome, "READ_UNAVAILABLE");
  assert.equal(read.detail, "the database is unreachable");
  assert.notEqual(read.outcome, "READ", "an outage was converted into an accountability answer");
});

test("RECORD_NOT_FOUND stays RECORD_NOT_FOUND", async () => {
  const store = createRecordAccountabilityStore(documentPort({ outcome: "RECORD_NOT_FOUND" }));
  assert.deepEqual(await store.readCurrentAccountablePerson(TARGET), { outcome: "RECORD_NOT_FOUND" });
});

test("the store stages the governed field map and NOTHING else", async () => {
  const port = documentPort({ outcome: "READ", fields: {} });
  const store = createRecordAccountabilityStore(port);
  const established = await governed("emp-active");
  store.stageAccountablePersonWrite(TARGET, established);
  assert.equal(port.staged.length, 1);
  assert.deepEqual(port.staged[0].fields, {
    [ACCOUNTABLE_PERSON_FIELD]: "emp-active",
    [ACCOUNTABLE_PERSON_SOURCE_FIELD]: "EXPLICIT",
  });
  // It STAGED; it did not commit. The atomic unit stays the caller's (#184 step E).
  assert.equal(typeof port.stageFieldWrite, "function");
});

test("the store refuses an ungoverned value and an out-of-scope family", async () => {
  const port = documentPort({ outcome: "READ", fields: {} });
  const store = createRecordAccountabilityStore(port);
  const established = await governed("emp-active");
  assert.throws(() => store.stageAccountablePersonWrite(TARGET, { ...established }), (e) => e instanceof Error);
  for (const family of ["account", "supplier", "workOrder"]) {
    const t = { ...TARGET, family };
    assert.throws(
      () => store.stageAccountablePersonWrite(t, established),
      (e) => e.code === "FAMILY_NOT_ACCOUNTABLE",
      `${family} accepted an accountability write`,
    );
    await assert.rejects(() => store.readCurrentAccountablePerson(t), (e) => e.code === "FAMILY_NOT_ACCOUNTABLE");
  }
  assert.equal(port.staged.length, 0, "a refused write still staged something");
});

// ════════════════════ 9. THE GOVERNED EXCEPTION IS MEASURED, NOT WRITABLE ════════════════════

test("#180: an explicit governed exception is READABLE and nothing in EOS writes one", () => {
  assert.equal(accountabilityExceptionId({ [ACCOUNTABILITY_EXCEPTION_FIELD]: "exc-1" }), "exc-1");
  assert.equal(accountabilityExceptionId({}), null);
  assert.equal(accountabilityExceptionId({ [ACCOUNTABILITY_EXCEPTION_FIELD]: "" }), null);

  // NOTHING WRITES IT. #189 leaves the exception mechanism in the deferred set, so a writer appearing
  // means somebody built an exception authority without a ruling to build it from.
  const walk = (dir) => {
    const out = [];
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "lib") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (entry.endsWith(".ts")) out.push(full);
    }
    return out;
  };
  const writers = [];
  for (const file of walk(SRC)) {
    const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    if (!code.includes(ACCOUNTABILITY_EXCEPTION_FIELD)) continue;
    // Two READERS are allowed and neither can write: the storage declaration, which names the field and
    // exposes `accountabilityExceptionId`, and the accountability census, which counts it. Anything else
    // naming the field is a candidate WRITER, which is what #189's deferred exception mechanism means
    // must not exist yet.
    if (
      file.endsWith(join("responsibility", "accountablePersonStorage.ts")) ||
      file.endsWith(join("responsibility", "accountabilityCensus.ts"))
    ) {
      // And neither of the two assigns it. An assignment is what would make one a writer.
      assert.ok(
        !new RegExp(`${ACCOUNTABILITY_EXCEPTION_FIELD}\\s*[:=]\\s*[^=]`).test(code),
        `${file.slice(SRC.length + 1)} ASSIGNS the accountability exception field. Both permitted modules ` +
          "are readers; a writer would be an exception authority built without the ruling that shapes it.",
      );
      continue;
    }
    writers.push(file.slice(SRC.length + 1));
  }
  assert.deepEqual(
    writers,
    [],
    "a module other than the storage declaration names the accountability exception field. #180 " +
      "permits an exception only where one is 'separately Owner-approved', and #189 leaves the " +
      `mechanism deferred: ${writers.join(", ")}`,
  );
});
