// GOVERNED RESPONSIBILITY HANDOFF — the proofs (Owner rulings #184 · #186 · #187 · #189).
//
// ════════════════════ NO DATABASE, NO EMULATOR, AND THAT IS THE DESIGN ════════════════════
//
// Every property under test is a property of the SEQUENCE, not of Firestore or PostgreSQL: that the
// authoritative read happens before authorization, that authorization happens before the Employee
// lookup, that an unavailable authority refuses instead of proceeding, that a refusal stages NOTHING,
// that the mutation and its audit reach the atomic unit together, and that neither axis can touch the
// other's storage. A database would not make one of those more true, and requiring one would mean the
// proofs that matter most were skipped on every machine without one.
//
// So the ports are DOUBLES — and that is not a weakening, it is what makes the claims checkable. Each
// double COUNTS its calls, so "zero partial mutation" is asserted as a number rather than asserted as
// a sentence, and "the ownership axis never touched accountability storage" is asserted as a number
// too.
//
// THE ACCOUNTABILITY FIXTURE IS A DOUBLE BECAUSE THERE IS NOTHING ELSE IT COULD BE. This repository
// has no accountability storage (S6 owns that) and the governed AuditAction vocabulary has no
// accountability action, so the axis is exercised through its seam. The suite therefore also proves
// the honest default: with no accountability ports supplied, the axis refuses PORT_UNAVAILABLE rather
// than silently recording an accountability change as an ownership handoff.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GovernedResponsibilityHandoffError,
  RESPONSIBILITY_AXES,
  companyOwner,
  personOwner,
  stageGovernedResponsibilityHandoff,
} from "../lib/responsibility/governedResponsibilityHandoff.js";
import {
  ACCOUNTABILITY_FAMILIES,
  accountabilityFamilyScope,
} from "../lib/responsibility/accountabilityFamilyScope.js";
import { createUnavailableEmployeeAuthority } from "../lib/employeeIdentity/employeeAuthority.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCHESTRATOR_SRC = resolve(HERE, "..", "src", "responsibility", "governedResponsibilityHandoff.ts");
const SCOPE_SRC = resolve(HERE, "..", "src", "responsibility", "accountabilityFamilyScope.ts");

const TENANT = "tenant-a";
const ACTOR = "actor-uid-1";
const TARGET_EMP = "emp-new";

/** A governed eligibility policy, as an OPERATION states one. Named statuses, never "not ACTIVE". */
const POLICY = Object.freeze({
  policyId: "TEST-POLICY-COMMERCIAL-ACCOUNTABILITY-v1",
  eligibleStatuses: Object.freeze(["ACTIVE", "CONTRACTOR"]),
});

// ════════════════════ THE DOUBLES ════════════════════

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

const activeEmployees = () =>
  employeeAuthority({
    [TARGET_EMP]: { employmentStatus: "ACTIVE" },
    "emp-old": { employmentStatus: "ACTIVE" },
    "emp-terminated": { employmentStatus: "TERMINATED" },
    "emp-on-leave": { employmentStatus: "ON_LEAVE" },
  });

function callerAuthority(decision = { outcome: "ALLOWED" }) {
  const calls = [];
  return {
    calls,
    async authorizeResponsibilityChange(request) {
      calls.push(request);
      if (typeof decision === "function") return decision(request);
      return decision;
    },
  };
}

/** The ownership record port. Counts reads AND stages, so "zero writes" is a number. */
function ownershipRecords(read) {
  const staged = [];
  const reads = [];
  return {
    staged,
    reads,
    async readAuthoritative(target) {
      reads.push(target);
      return read;
    },
    stageOwnerFieldWrite(target, field, owner) {
      staged.push({ target, field, owner });
    },
  };
}

function ownershipAudit({ throws = false } = {}) {
  const staged = [];
  return {
    staged,
    stageOwnershipHandoffEvent(event) {
      if (throws) throw new Error("audit writer refused");
      staged.push(event);
      return `audit-${staged.length}`;
    },
  };
}

/** The accountability seam, as a fixture. Nothing in the repository implements this interface. */
function accountabilityStore(read) {
  const staged = [];
  const reads = [];
  return {
    staged,
    reads,
    async readCurrentAccountablePerson(target) {
      reads.push(target);
      return read;
    },
    stageAccountablePersonWrite(target, accountableEmployeeId) {
      staged.push({ target, accountableEmployeeId });
    },
  };
}

function accountabilityAudit() {
  const staged = [];
  return {
    staged,
    stageAccountabilityHandoff(record) {
      staged.push(record);
      return `acct-audit-${staged.length}`;
    },
  };
}

/** Every port present, so a test can prove the OTHER axis's ports were never touched. */
function allPorts(overrides = {}) {
  return {
    callerAuthority: callerAuthority(),
    employeeAuthority: activeEmployees(),
    ownershipRecords: ownershipRecords({ outcome: "READ", fields: { ownerEmployeeId: "emp-old" } }),
    ownershipAudit: ownershipAudit(),
    accountabilityStore: accountabilityStore({ outcome: "READ", accountableEmployeeId: "emp-old" }),
    accountabilityAudit: accountabilityAudit(),
    ...overrides,
  };
}

const ownershipCommand = (over = {}) => ({
  axis: "RECORD_OWNERSHIP",
  tenantId: TENANT,
  family: "opportunity",
  recordId: "opp-1",
  actorUid: ACTOR,
  newOwner: personOwner(TARGET_EMP),
  source: "DIRECT_HANDOFF",
  ...over,
});

const accountabilityCommand = (over = {}) => ({
  axis: "ACCOUNTABILITY",
  tenantId: TENANT,
  family: "opportunity",
  recordId: "opp-1",
  actorUid: ACTOR,
  newAccountableEmployeeId: TARGET_EMP,
  eligibilityPolicy: POLICY,
  ...over,
});

/** Run and expect a refusal, returning it. Fails the test if the command SUCCEEDED. */
async function refusal(deps, command) {
  try {
    const result = await stageGovernedResponsibilityHandoff(deps, command);
    assert.fail(`expected a refusal, got a result: ${JSON.stringify(result)}`);
  } catch (err) {
    assert.ok(
      err instanceof GovernedResponsibilityHandoffError,
      `expected a GovernedResponsibilityHandoffError, got ${err?.name}: ${err?.message}`,
    );
    return err;
  }
}

/** ZERO PARTIAL MUTATION · ZERO PARTIAL AUDIT, asserted on every port at once. */
function assertNothingStaged(deps) {
  assert.equal(deps.ownershipRecords?.staged.length ?? 0, 0, "an ownership field write was staged");
  assert.equal(deps.ownershipAudit?.staged.length ?? 0, 0, "an ownership audit event was staged");
  assert.equal(deps.accountabilityStore?.staged.length ?? 0, 0, "an accountability write was staged");
  assert.equal(deps.accountabilityAudit?.staged.length ?? 0, 0, "an accountability audit was staged");
}

// ════════════════════ 1. THE AUTHORIZED PATHS ════════════════════

test("#184: an authorized RECORD OWNERSHIP handoff stages the mutation AND the audit, together", async () => {
  const deps = allPorts();
  const result = await stageGovernedResponsibilityHandoff(deps, ownershipCommand());

  assert.equal(result.axis, "RECORD_OWNERSHIP");
  assert.equal(result.previousId, "emp-old", "the previous owner came from the AUTHORITATIVE read");
  assert.equal(result.newId, TARGET_EMP);
  assert.equal(result.mutatedOwnerField, "ownerEmployeeId");

  // MUTATION: exactly one field write, on the field the governed matrix declares.
  assert.equal(deps.ownershipRecords.staged.length, 1);
  assert.deepEqual(deps.ownershipRecords.staged[0].owner, { type: "USER", id: TARGET_EMP });
  assert.equal(deps.ownershipRecords.staged[0].field, "ownerEmployeeId");

  // AUDIT: exactly one OWNERSHIP_HANDOFF event, built by the RETAINED pure builder, carrying both
  // owners as the ruling's four handoff facts rather than as free text.
  assert.equal(deps.ownershipAudit.staged.length, 1);
  const event = deps.ownershipAudit.staged[0];
  assert.equal(event.action, "OWNERSHIP_HANDOFF");
  assert.equal(event.targetType, "opportunity");
  assert.equal(event.targetId, "opp-1");
  assert.equal(event.actorUid, ACTOR);
  assert.deepEqual(event.previousOwner, { type: "USER", id: "emp-old" });
  assert.deepEqual(event.newOwner, { type: "USER", id: TARGET_EMP });
  assert.equal(event.handoffSource, "DIRECT_HANDOFF");
  assert.equal(result.auditEventId, "audit-1", "the result names the staged audit event");
});

test("#184: the first handoff of a record that genuinely had NO owner is a real event", async () => {
  const deps = allPorts({
    ownershipRecords: ownershipRecords({ outcome: "READ", fields: {} }),
  });
  const result = await stageGovernedResponsibilityHandoff(deps, ownershipCommand());

  // null is a STATED FACT here, not a fallback — the builder accepts it and the event records it.
  assert.equal(result.previousId, null);
  assert.equal(deps.ownershipAudit.staged[0].previousOwner, null);
  assert.equal(deps.ownershipRecords.staged.length, 1);
});

test("#184: a COMPANY-owned family resolves NO Employee — a company is not a person", async () => {
  const deps = allPorts({
    ownershipRecords: ownershipRecords({ outcome: "READ", fields: { operatingCompanyId: "taylor" } }),
  });
  const result = await stageGovernedResponsibilityHandoff(
    deps,
    ownershipCommand({ family: "workOrderLegacy", recordId: "job-1", newOwner: companyOwner("ventana") }),
  );

  assert.equal(result.previousId, "taylor");
  assert.equal(result.newId, "ventana");
  assert.equal(result.mutatedOwnerField, "operatingCompanyId");
  // #184: "Do NOT duplicate authoritative Employee/person lookups." Zero is the count that proves it.
  assert.equal(deps.employeeAuthority.calls.length, 0, "the Employee authority was consulted for a COMPANY target");
});

test("#189 OD-16: an authorized ACCOUNTABILITY handoff, where the fixture supports the axis", async () => {
  const deps = allPorts();
  const result = await stageGovernedResponsibilityHandoff(deps, accountabilityCommand());

  assert.equal(result.axis, "ACCOUNTABILITY");
  assert.equal(result.previousId, "emp-old");
  assert.equal(result.newId, TARGET_EMP);
  assert.equal(deps.accountabilityStore.staged.length, 1);
  assert.equal(deps.accountabilityAudit.staged.length, 1);

  const record = deps.accountabilityAudit.staged[0];
  assert.equal(record.previousAccountableEmployeeId, "emp-old");
  assert.equal(record.newAccountableEmployeeId, TARGET_EMP);
  // #189: the eligibility answer is a governed fact, so the policy that produced it is recorded.
  assert.equal(record.eligibilityPolicyId, POLICY.policyId);
  assert.equal(result.eligibility.policyId, POLICY.policyId);
  assert.equal(result.eligibility.eligible, true);
  assert.equal(result.eligibility.employmentStatus, "ACTIVE", "the lifecycle status stays independently visible");
});

// ════════════════════ 2. THE AXES ARE NEVER CONFUSED (#187 M-1) ════════════════════

test("#187 M-1: an ownership change does NOT change accountability", async () => {
  const deps = allPorts();
  await stageGovernedResponsibilityHandoff(deps, ownershipCommand());

  assert.equal(deps.accountabilityStore.staged.length, 0, "an ownership handoff wrote accountability");
  assert.equal(deps.accountabilityAudit.staged.length, 0, "an ownership handoff audited accountability");
  assert.equal(deps.accountabilityStore.reads.length, 0, "an ownership handoff even READ accountability storage");
});

test("#187 M-1: an accountability change does NOT change ownership", async () => {
  const deps = allPorts();
  await stageGovernedResponsibilityHandoff(deps, accountabilityCommand());

  assert.equal(deps.ownershipRecords.staged.length, 0, "an accountability handoff wrote an ownership field");
  assert.equal(deps.ownershipAudit.staged.length, 0, "an accountability handoff emitted OWNERSHIP_HANDOFF");
  assert.equal(deps.ownershipRecords.reads.length, 0, "an accountability handoff even READ ownership storage");
});

test("#187 M-1: an ASSIGNMENT is refused — it cannot travel through this boundary at all", async () => {
  const deps = allPorts();
  const err = await refusal(deps, {
    axis: "ASSIGNMENT",
    tenantId: TENANT,
    family: "opportunity",
    recordId: "opp-1",
    actorUid: ACTOR,
    newAccountableEmployeeId: TARGET_EMP,
  });
  assert.equal(err.code, "AXIS_UNSUPPORTED");
  // The point of the test: an assignment-only operation changed NO accountability and NO ownership.
  assertNothingStaged(deps);
  assert.equal(deps.callerAuthority.calls.length, 0, "an ungoverned axis reached the authorization layer");
});

test("#187 M-1: RESPONSIBILITY_AXES is exactly the two the ruling names", () => {
  assert.deepEqual([...RESPONSIBILITY_AXES], ["RECORD_OWNERSHIP", "ACCOUNTABILITY"]);
  assert.ok(!RESPONSIBILITY_AXES.includes("ASSIGNMENT"));
});

// ════════════════════ 3. TARGET RESOLUTION AND FAIL-CLOSED ════════════════════

test("#186 case D: an Employee target that does NOT resolve is refused, with zero writes", async () => {
  const deps = allPorts();
  const err = await refusal(deps, ownershipCommand({ newOwner: personOwner("emp-does-not-exist") }));

  assert.equal(err.code, "TARGET_EMPLOYEE_INVALID");
  assert.equal(err.builderCode, "EMPLOYEE_REFERENCE_NOT_FOUND", "the authority's own code is preserved");
  assertNothingStaged(deps);
});

test("#186: a malformed reference is INVALID, and is not confused with unavailable", async () => {
  const deps = allPorts();
  const err = await refusal(deps, ownershipCommand({ newOwner: { type: "USER", id: "a/b" } }));
  assert.equal(err.code, "TARGET_EMPLOYEE_INVALID");
  assert.equal(err.builderCode, "EMPLOYEE_REFERENCE_MALFORMED");
  assertNothingStaged(deps);
});

test("#187 §2: AUTHORITY_UNAVAILABLE refuses and FAILS CLOSED — it is NOT 'person missing'", async () => {
  const deps = allPorts({
    employeeAuthority: createUnavailableEmployeeAuthority("no Employee authority configured in this test"),
  });
  const err = await refusal(deps, ownershipCommand());

  // Its OWN code. An outage and a missing person must not arrive at the audit log as the same error.
  assert.equal(err.code, "TARGET_AUTHORITY_UNAVAILABLE");
  assert.notEqual(err.code, "TARGET_EMPLOYEE_INVALID");
  assert.equal(err.builderCode, "EMPLOYEE_AUTHORITY_UNAVAILABLE");
  assertNothingStaged(deps);
});

test("#187 §2: an authority that THROWS something ungoverned still fails closed, not open", async () => {
  const deps = allPorts({
    employeeAuthority: {
      async resolveEmployeeReference() {
        throw new TypeError("ECONNREFUSED");
      },
    },
  });
  const err = await refusal(deps, accountabilityCommand());
  assert.equal(err.code, "TARGET_AUTHORITY_UNAVAILABLE");
  assertNothingStaged(deps);
});

test("#189 MI-e: a VALID but NOT CURRENTLY ELIGIBLE Employee is refused on the accountability axis", async () => {
  const deps = allPorts();
  const err = await refusal(deps, accountabilityCommand({ newAccountableEmployeeId: "emp-terminated" }));

  assert.equal(err.code, "TARGET_NOT_CURRENTLY_ELIGIBLE");
  // #186: the reference is VALID; only the eligibility verdict refused. The message must say both.
  assert.match(err.message, /VALID reference/);
  assert.match(err.message, /TERMINATED/);
  assert.match(err.message, new RegExp(POLICY.policyId));
  assertNothingStaged(deps);
});

test("#189 MI-e: eligibility is the POLICY's answer, not a status test — ON_LEAVE is refused, CONTRACTOR is not", async () => {
  const refused = allPorts();
  const err = await refusal(refused, accountabilityCommand({ newAccountableEmployeeId: "emp-on-leave" }));
  assert.equal(err.code, "TARGET_NOT_CURRENTLY_ELIGIBLE");

  // The SAME policy accepts CONTRACTOR, which no `status !== "ACTIVE"` implementation could do. That
  // asymmetry is the proof the six-value vocabulary was not flattened into a hidden boolean.
  const allowed = allPorts({
    employeeAuthority: employeeAuthority({ "emp-contractor": { employmentStatus: "CONTRACTOR" } }),
  });
  const result = await stageGovernedResponsibilityHandoff(
    allowed,
    accountabilityCommand({ newAccountableEmployeeId: "emp-contractor" }),
  );
  assert.equal(result.eligibility.employmentStatus, "CONTRACTOR");
  assert.equal(result.eligibility.eligible, true);
});

test("#189 MI-e: the ACCOUNTABILITY axis refuses without a governed eligibility policy", async () => {
  const deps = allPorts();
  const err = await refusal(deps, accountabilityCommand({ eligibilityPolicy: undefined }));
  assert.equal(err.code, "ELIGIBILITY_POLICY_REQUIRED");
  assertNothingStaged(deps);
});

test("#189 MI-e: ownership eligibility is enforced ONLY when the operation states a policy", async () => {
  // No policy: no eligibility verdict is invented, and the handoff proceeds. No ruling establishes an
  // ownership eligibility rule, and inventing one here would be this boundary ruling on it.
  const without = allPorts();
  const result = await stageGovernedResponsibilityHandoff(
    without,
    ownershipCommand({ newOwner: personOwner("emp-terminated") }),
  );
  assert.equal(result.eligibility, undefined, "an eligibility fact was synthesised with no policy");
  assert.equal(without.ownershipRecords.staged.length, 1);

  // With a policy: consumed, and enforced.
  const withPolicy = allPorts();
  const err = await refusal(
    withPolicy,
    ownershipCommand({ newOwner: personOwner("emp-terminated"), eligibilityPolicy: POLICY }),
  );
  assert.equal(err.code, "TARGET_NOT_CURRENTLY_ELIGIBLE");
  assertNothingStaged(withPolicy);
});

// ════════════════════ 4. CALLER AUTHORIZATION ════════════════════

test("#184: a DENIED caller is refused, and the Employee authority is never consulted", async () => {
  const deps = allPorts({ callerAuthority: callerAuthority({ outcome: "DENIED", reason: "no grant" }) });
  const err = await refusal(deps, ownershipCommand());

  assert.equal(err.code, "CALLER_NOT_AUTHORIZED");
  assertNothingStaged(deps);
  // ORDERING, proved by a count: authorization precedes target resolution, so an unauthorized caller
  // cannot use this boundary to probe whether an Employee id exists.
  assert.equal(deps.employeeAuthority.calls.length, 0);
});

test("#187 §2 shape: an authorization decision that could not be obtained FAILS CLOSED", async () => {
  for (const authority of [
    callerAuthority({ outcome: "AUTHORIZATION_UNAVAILABLE", detail: "policy store unreachable" }),
    callerAuthority(() => {
      throw new Error("timeout");
    }),
    // An unrecognised decision is not an approval. There is no default-allow branch.
    callerAuthority({ outcome: "PROBABLY_FINE" }),
  ]) {
    const deps = allPorts({ callerAuthority: authority });
    const err = await refusal(deps, ownershipCommand());
    assert.equal(err.code, "CALLER_AUTHORIZATION_UNAVAILABLE");
    assertNothingStaged(deps);
  }
});

// ════════════════════ 5. THE AUTHORITATIVE READ ════════════════════

test("#184: the AUTHORITATIVE READ is first — an unavailable read refuses before authorization", async () => {
  const deps = allPorts({
    ownershipRecords: ownershipRecords({ outcome: "READ_UNAVAILABLE", detail: "transaction read failed" }),
  });
  const err = await refusal(deps, ownershipCommand());

  assert.equal(err.code, "AUTHORITATIVE_READ_UNAVAILABLE");
  assert.match(err.message, /transaction read failed/);
  assertNothingStaged(deps);
  assert.equal(deps.callerAuthority.calls.length, 0, "the read is not the first step");
});

test("a record that does not exist is RECORD_NOT_FOUND, distinct from an unavailable read", async () => {
  const deps = allPorts({ ownershipRecords: ownershipRecords({ outcome: "RECORD_NOT_FOUND" }) });
  const err = await refusal(deps, ownershipCommand());
  assert.equal(err.code, "RECORD_NOT_FOUND");
  assertNothingStaged(deps);
});

test("#189 MI-l: an unreadable STORED owner refuses — it is never silently treated as ownerless", async () => {
  const deps = allPorts({
    ownershipRecords: ownershipRecords({ outcome: "READ", fields: { ownerEmployeeId: 12345 } }),
  });
  const err = await refusal(deps, ownershipCommand());

  assert.equal(err.code, "CURRENT_RESPONSIBILITY_UNRESOLVED");
  assert.match(err.message, /UNRESOLVED/);
  // The whole point: the legacy unresolved reference is PRESERVED, not overwritten.
  assertNothingStaged(deps);
});

test("a stale caller expectation refuses rather than overwriting a change made since", async () => {
  const deps = allPorts();
  const err = await refusal(deps, ownershipCommand({ expectedCurrentId: "emp-someone-else" }));
  assert.equal(err.code, "PRECONDITION_STALE");
  assertNothingStaged(deps);

  // And the authoritative value passes the same check.
  const ok = allPorts();
  const result = await stageGovernedResponsibilityHandoff(ok, ownershipCommand({ expectedCurrentId: "emp-old" }));
  assert.equal(result.previousId, "emp-old");
});

// ════════════════════ 6. THE PURE FAMILY / AXIS VALIDATION, COMPOSED NOT DUPLICATED ════════════════════

test("#184: a NO-OP handoff is refused, and the pure builder's own code is carried through", async () => {
  const deps = allPorts();
  const err = await refusal(deps, ownershipCommand({ newOwner: personOwner("emp-old") }));

  assert.equal(err.builderCode, "NO_OP", "the builder's refusal code was flattened away");
  assert.match(err.message, /moves nothing/);
  assertNothingStaged(deps);
});

test("#184: an IMMUTABLE family is refused by the RETAINED builder, not by a copy of its rules", async () => {
  const deps = allPorts({
    ownershipRecords: ownershipRecords({ outcome: "READ", fields: { operatingCompanyId: "taylor" } }),
  });
  const err = await refusal(
    deps,
    ownershipCommand({ family: "stockLocation", recordId: "sl-1", newOwner: companyOwner("ventana") }),
  );
  assert.equal(err.builderCode, "FAMILY_IMMUTABLE");
  assertNothingStaged(deps);
});

test("an owner whose type contradicts the family is refused by the builder", async () => {
  const deps = allPorts();
  const err = await refusal(deps, ownershipCommand({ newOwner: companyOwner("ventana") }));
  assert.equal(err.builderCode, "OWNER_TYPE_MISMATCH");
  assertNothingStaged(deps);
});

test("an ungoverned family is refused — the matrix is the allow-list", async () => {
  const deps = allPorts();
  const err = await refusal(deps, ownershipCommand({ family: "unicorns" }));
  assert.equal(err.code, "FAMILY_UNGOVERNED");
  assertNothingStaged(deps);
  assert.equal(deps.ownershipRecords.reads.length, 0, "an ungoverned family reached the read");
});

test("a governed family with NO ownership storage cannot be MUTATED, and fails closed", async () => {
  // `workOrder` is governed and HANDOFF-able, and its ownerFields is measured-empty. The pure builder
  // can still produce the event; this boundary also mutates, and refuses to guess where.
  const deps = allPorts();
  const err = await refusal(deps, ownershipCommand({ family: "workOrder", recordId: "wo-1", newOwner: companyOwner("taylor") }));
  assert.equal(err.code, "OWNERSHIP_STORAGE_UNRESOLVED");
  assert.match(err.message, /exactly one/);
  assertNothingStaged(deps);
});

test("#189 OD-16: a family outside the governed accountability scope is NOT APPLICABLE, not defective", async () => {
  const deps = allPorts();
  const err = await refusal(deps, accountabilityCommand({ family: "account", recordId: "acct-1" }));

  assert.equal(err.code, "FAMILY_NOT_ACCOUNTABLE");
  assert.match(err.message, /NOT APPLICABLE/);
  assert.match(err.message, /not MISSING, not OWNERLESS, not DEFECTIVE/);
  assertNothingStaged(deps);
});

test("#189 OD-16: the accountability scope is exactly Opportunity, Sales Agreement, Sales Order", () => {
  assert.deepEqual([...ACCOUNTABILITY_FAMILIES], ["opportunity", "salesAgreement", "salesOrder"]);
  for (const family of ACCOUNTABILITY_FAMILIES) assert.equal(accountabilityFamilyScope(family), "IN_SCOPE");
  for (const family of ["account", "contact", "workOrder", "parts", "", null, undefined, 7]) {
    assert.equal(accountabilityFamilyScope(family), "NOT_APPLICABLE");
  }
});

test("an accountability NO-OP is refused for the same reason an ownership one is", async () => {
  const deps = allPorts();
  const err = await refusal(deps, accountabilityCommand({ newAccountableEmployeeId: "emp-old" }));
  assert.equal(err.builderCode, "NO_OP");
  assertNothingStaged(deps);
});

// ════════════════════ 7. THE HONEST DEFAULT, AND MISSING PORTS ════════════════════

test("with no accountability ports the axis refuses CLOSED — it never falls back to OWNERSHIP_HANDOFF", async () => {
  const deps = {
    callerAuthority: callerAuthority(),
    employeeAuthority: activeEmployees(),
    ownershipRecords: ownershipRecords({ outcome: "READ", fields: { ownerEmployeeId: "emp-old" } }),
    ownershipAudit: ownershipAudit(),
  };
  const err = await refusal(deps, accountabilityCommand());

  assert.equal(err.code, "PORT_UNAVAILABLE");
  assert.match(err.message, /no accountability storage exists/);
  // The failure mode that would have been worst: an accountability change filed as an ownership one.
  assert.equal(deps.ownershipAudit.staged.length, 0);
  assert.equal(deps.ownershipRecords.staged.length, 0);
});

test("a missing ownership port refuses rather than performing a partial sequence", async () => {
  const err = await refusal(
    { callerAuthority: callerAuthority(), employeeAuthority: activeEmployees() },
    ownershipCommand(),
  );
  assert.equal(err.code, "PORT_UNAVAILABLE");
});

test("a missing caller or Employee authority refuses — there is no unauthenticated path", async () => {
  for (const deps of [
    { employeeAuthority: activeEmployees() },
    { callerAuthority: callerAuthority() },
    {},
  ]) {
    const err = await refusal(deps, ownershipCommand());
    assert.equal(err.code, "PORT_UNAVAILABLE");
  }
});

test("a malformed command is refused before anything is read", async () => {
  for (const over of [{ tenantId: "" }, { recordId: "  " }, { actorUid: "" }, { family: "" }]) {
    const deps = allPorts();
    const err = await refusal(deps, ownershipCommand(over));
    assert.equal(err.code, "COMMAND_INVALID");
    assertNothingStaged(deps);
    assert.equal(deps.ownershipRecords.reads.length, 0);
  }
});

// ════════════════════ 8. ATOMICITY ════════════════════

test("#184: a failure at AUDIT staging refuses loudly — it never returns a half-staged success", async () => {
  const deps = allPorts({ ownershipAudit: ownershipAudit({ throws: true }) });
  const err = await refusal(deps, ownershipCommand());

  assert.equal(err.code, "STAGING_FAILED");
  assert.match(err.message, /MUST be\s+abandoned/);
  // The mutation WAS staged onto the atomic unit before the audit failed — which is exactly why the
  // refusal must be loud: the caller's transaction has to be abandoned, and a thrown error is what
  // abandons a Firestore transaction. What must NOT happen is a returned success.
  assert.equal(deps.ownershipAudit.staged.length, 0, "an audit event was staged by a failing writer");
});

test("#184: the mutation and the audit are staged with NO await between them", () => {
  // A property of the SOURCE, because it is a property of the code's shape rather than of one run: an
  // `await` between the two stages would be a suspension point at which a partial state is observable.
  const src = readFileSync(ORCHESTRATOR_SRC, "utf8");
  for (const [mutation, audit] of [
    ["records.stageOwnerFieldWrite", "audit.stageOwnershipHandoffEvent"],
    ["store.stageAccountablePersonWrite", "audit.stageAccountabilityHandoff"],
  ]) {
    const start = src.indexOf(mutation);
    const end = src.indexOf(audit, start);
    assert.ok(start > 0 && end > start, `${mutation} … ${audit} not found in that order`);
    assert.ok(
      !src.slice(start, end).includes("await"),
      `an await sits between ${mutation} and ${audit} — a partial state is observable there`,
    );
  }
});

// ════════════════════ 9. THE LOAD-BEARING ABSENCES, PROVED OVER THE SOURCE ════════════════════

test("#189 MI-e: the orchestrator contains NO employment-status comparison and NO default policy", () => {
  const src = readFileSync(ORCHESTRATOR_SRC, "utf8");
  // Strip comments first: the rulings are QUOTED in the header, and a naive scan would match the
  // quotation rather than any code. Same extractor order ownershipHandoffAudit.test.mjs uses.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  for (const status of ["ACTIVE", "ON_LEAVE", "INACTIVE", "TERMINATED", "RETIRED", "CONTRACTOR"]) {
    assert.ok(
      !new RegExp(`[=!]==\\s*"${status}"`).test(code) && !new RegExp(`"${status}"\\s*[=!]==`).test(code),
      `the orchestrator compares against the employment status "${status}" — #189 forbids the flattened policy`,
    );
  }
  assert.ok(!/eligibleStatuses\s*[:=]\s*\[/.test(code), "the orchestrator declares a default eligible-status list");
  assert.ok(!/employmentStatus\s*[=!]==/.test(code), "the orchestrator branches on employmentStatus directly");
  // It must still CONSUME the governed verdict.
  assert.ok(code.includes("decideAccountabilityEligibility"), "the governed eligibility verdict is not consumed");
});

test("#187 §1: no accountability storage is invented, and accountablePerson is not added anywhere", () => {
  const matrixSrc = readFileSync(resolve(HERE, "..", "src", "ownership", "ownershipMatrix.ts"), "utf8");
  assert.ok(
    !/accountablePerson/.test(matrixSrc),
    "accountablePerson appears in the ownership matrix — #187 §1 forbids placing it in ownerFields",
  );
  // The seam names NO collection, NO table and NO field. If it did, it would be storage, not a seam.
  const code = readFileSync(ORCHESTRATOR_SRC, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  for (const token of ["collection(", "getFirestore", "firebase-admin", "runTransaction", "FieldValue"]) {
    assert.ok(!code.includes(token), `the orchestrator reaches for storage directly: ${token}`);
  }
});

test("the accountability family scope module is PURE — it imports nothing at all", () => {
  const src = readFileSync(SCOPE_SRC, "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/^\s*import\s/m.test(code), "accountabilityFamilyScope.ts imports something");
  assert.ok(!/require\(/.test(code), "accountabilityFamilyScope.ts requires something");
});

test("the boundary is NOT wired as a callable — no capability is activated by this wave", () => {
  const indexSrc = readFileSync(resolve(HERE, "..", "src", "index.ts"), "utf8");
  assert.ok(
    !/responsibility\//.test(indexSrc),
    "the orchestrator is exported from index.ts; exporting it would require activating a capability " +
      "that is registered active:false, which this wave is not authorized to do",
  );
});
