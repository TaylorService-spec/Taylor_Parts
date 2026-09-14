// EMPLOYEE AUTHORITY PORT — the proofs.
//
// ════════════════════ NO DATABASE, NO EMULATOR, AND THAT IS THE DESIGN ════════════════════
//
// Every property under test here is a property of the CONTRACT, not of PostgreSQL: that a resolved
// reference and a current-eligibility verdict are separate facts, that an unavailable authority is not a
// missing person, that the failure path fails closed, and that no substitute store is ever consulted.
// A database would not make any of those more true, and requiring one would mean the suite skipped on
// every machine that does not have one — which is how the proof that matters most goes unrun.
//
// The `pg`-shaped dependency is therefore a double. The adapter's job is to TURN driver outcomes into
// semantic outcomes, and a fake that returns rows or throws exercises exactly that mapping.
//
// The one thing a double could NOT prove is "the module never reaches for Firestore", because a double
// proves things about the path taken. So that claim is proved twice and neither way is a runtime happy
// path: statically over the source, and in a CHILD PROCESS whose module loader fails the test if
// `firebase-admin` is ever even RESOLVED. See the last two sections.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EMPLOYMENT_STATUS_VALUES,
  EmployeeAuthorityFailure,
  composePersonReferenceState,
  createUnavailableEmployeeAuthority,
  decideAccountabilityEligibility,
  isEmployeeReferenceShape,
  isEmploymentStatus,
  mustResolveEmployeeReference,
} from "../lib/employeeIdentity/employeeAuthority.js";
import {
  createPostgresEmployeeAuthority,
  resolveConfiguredEmployeeAuthority,
} from "../lib/employeeIdentity/postgresEmployeeAuthority.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");

const TENANT = "tenant-a";
const EMP = "emp-1";
const REF = Object.freeze({ tenantId: TENANT, employeeId: EMP });

/** A `pg`-shaped double that returns the given rows and COUNTS its calls. */
function rowsDb(rows) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows };
    },
  };
}

/** A `pg`-shaped double whose every read FAILS, the way an outage does. */
function failingDb(message = "connection terminated unexpectedly") {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      throw Object.assign(new Error(message), { code: "57P01" });
    },
  };
}

const employeeRow = (employmentStatus, over = {}) => ({
  id: EMP,
  tenant_id: TENANT,
  employment_status: employmentStatus,
  operating_company_id: "taylor",
  ...over,
});

// ════════════════════ 1. EVERY CANONICAL STATUS RESOLVES, AND THE STATUS SURVIVES ════════════════════

// Ruling #186 §4: "Do NOT collapse every non-`ACTIVE` Employee into one generic historical state. At
// minimum `INACTIVE` and `TERMINATED` must remain distinguishable." So all six are asserted, and each
// is asserted to come back as ITSELF.
//
// NOTE WHAT THIS TEST DOES NOT DO: it never derives an expected eligibility from the status. There is
// no `expectedEligible: status === "ACTIVE"` anywhere, because writing that would be this suite
// implementing the very policy #189 (`MI-e`) forbids and then proving the code agrees with it.
for (const status of EMPLOYMENT_STATUS_VALUES) {
  test(`a reference to an Employee whose status is ${status} is a VALID REFERENCE carrying that status`, async () => {
    const db = rowsDb([employeeRow(status)]);
    const authority = createPostgresEmployeeAuthority(db);

    const resolution = await authority.resolveEmployeeReference(REF);

    assert.equal(resolution.outcome, "RESOLVED", `${status} must resolve -- it is a real Employee`);
    assert.equal(resolution.employee.employmentStatus, status);
    assert.equal(resolution.employee.employeeId, EMP);
    assert.equal(resolution.employee.tenantId, TENANT);

    // The resolution carries FACTS and no eligibility verdict. #186 §2: "Do not encode `VALID
    // REFERENCE` as `CURRENTLY ELIGIBLE`." A field named like an eligibility answer would be that
    // encoding, whatever its value happened to be.
    const keys = [...Object.keys(resolution), ...Object.keys(resolution.employee)];
    for (const forbidden of ["eligible", "isEligible", "eligibility", "isActive", "active", "canBeAccountable", "isHistorical"]) {
      assert.ok(!keys.includes(forbidden), `the resolution must not carry "${forbidden}": validity and eligibility are separate facts`);
    }
  });
}

test("all six governed statuses are recognised, and nothing else is", () => {
  assert.equal(EMPLOYMENT_STATUS_VALUES.length, 6);
  for (const status of EMPLOYMENT_STATUS_VALUES) assert.ok(isEmploymentStatus(status));
  for (const notAStatus of ["active", "ACTIVE ", "FORMER", "", "PENDING", null, undefined, 7, {}]) {
    assert.ok(!isEmploymentStatus(notAStatus), `${JSON.stringify(notAStatus)} is not a governed status`);
  }
});

// ════════════════════ 2. THE VOCABULARY MIRROR CANNOT DRIFT ════════════════════

test("the port's employment vocabulary mirrors employeeProfileCommands.ts and its canonical home", () => {
  // The port mirrors by literal rather than importing, because employeeProfileCommands.ts:61 imports
  // firebase-admin/firestore and the port imports nothing. That makes this guard the only thing keeping
  // the two in step -- the same role functions/test/employeeProfileCommands.test.mjs:570 plays for the
  // TypeScript copy, and the reason ruling #186 §4 calls the drift guard "real".
  const ts = readFileSync(join(FUNCTIONS_DIR, "src/access/employeeProfileCommands.ts"), "utf8");
  const tsBlock = /export const EMPLOYMENT_STATUS_VALUES = Object\.freeze\(\[([^\]]*)\]/.exec(ts);
  assert.ok(tsBlock, "EMPLOYMENT_STATUS_VALUES must still exist in employeeProfileCommands.ts");
  const fromTs = [...tsBlock[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...EMPLOYMENT_STATUS_VALUES], fromTs);

  // And against the canonical home ruling #186 §4 names, which is NOT the provisioning script that
  // module's own header claims (that script holds only EMPLOYMENT_STATUS_ACTIVE).
  const constants = readFileSync(join(FUNCTIONS_DIR, "../field-ops-app-vite/src/domain/constants.js"), "utf8");
  const block = /export const EMPLOYMENT_STATUS = \{([^}]*)\}/.exec(constants);
  assert.ok(block, "EMPLOYMENT_STATUS must still exist in domain/constants.js");
  const fromConstants = [...block[1].matchAll(/([A-Z_]+):\s*"([A-Z_]+)"/g)].map((m) => m[2]);
  assert.deepEqual([...EMPLOYMENT_STATUS_VALUES], fromConstants);
});

// ════════════════════ 3. MISSING IS NOT UNAVAILABLE ════════════════════

test("a reference no Employee resolves is NOT_FOUND -- the authority answered", async () => {
  const authority = createPostgresEmployeeAuthority(rowsDb([]));
  const resolution = await authority.resolveEmployeeReference({ tenantId: TENANT, employeeId: "ghost" });

  assert.equal(resolution.outcome, "NOT_FOUND");
  assert.equal(resolution.reference.employeeId, "ghost");
  // Ruling #187 §2: INVALID/MISSING means the system "successfully answered". It must not be dressed
  // up as an outage, which would be the opposite misreading to the one the ruling mainly warns about.
  assert.ok(!("reason" in resolution), "a missing Employee has no AUTHORITY_UNAVAILABLE reason");
});

test("NOT_FOUND and AUTHORITY_UNAVAILABLE are different outcomes for the same reference", async () => {
  const answered = await createPostgresEmployeeAuthority(rowsDb([])).resolveEmployeeReference(REF);
  const couldNotAsk = await createPostgresEmployeeAuthority(failingDb()).resolveEmployeeReference(REF);

  assert.equal(answered.outcome, "NOT_FOUND");
  assert.equal(couldNotAsk.outcome, "AUTHORITY_UNAVAILABLE");
  assert.notEqual(answered.outcome, couldNotAsk.outcome);
});

test("an Employee that exists under a DIFFERENT tenant does not resolve for this one", async () => {
  // The tenant is in the WHERE clause, so the double returning nothing is the real behaviour. Migration
  // 003's Ruling B: proving the Employee exists is not proving this tenant may reference them.
  const db = rowsDb([]);
  const resolution = await createPostgresEmployeeAuthority(db).resolveEmployeeReference(REF);
  assert.equal(resolution.outcome, "NOT_FOUND");
  assert.deepEqual(db.calls[0].params, [EMP, TENANT], "the tenant must be a query parameter, not a filter applied afterwards");
  assert.match(db.calls[0].sql, /tenant_id = \$2/);
});

// ════════════════════ 4. AUTHORITY_UNAVAILABLE — FAIL CLOSED, AND NO FALLBACK ════════════════════

test("an unconfigured authority is AUTHORITY_UNAVAILABLE, not an empty result", async () => {
  const authority = resolveConfiguredEmployeeAuthority(null);
  const resolution = await authority.resolveEmployeeReference(REF);

  assert.equal(resolution.outcome, "AUTHORITY_UNAVAILABLE");
  assert.equal(resolution.reason, "NO_AUTHORITY_CONFIGURED");
  // Ruling #187 §2: it "must not be represented as healthy empty data".
  assert.notEqual(resolution.outcome, "NOT_FOUND");
  assert.match(resolution.detail, /no Employee authority is configured/);
});

test("a failing read is AUTHORITY_UNAVAILABLE with AUTHORITY_READ_FAILED, never NOT_FOUND", async () => {
  const authority = createPostgresEmployeeAuthority(failingDb("could not connect to server"));
  const resolution = await authority.resolveEmployeeReference(REF);

  assert.equal(resolution.outcome, "AUTHORITY_UNAVAILABLE");
  assert.equal(resolution.reason, "AUTHORITY_READ_FAILED");
  assert.match(resolution.detail, /could not connect to server/);
});

test("a status outside the governed six is AUTHORITY_UNAVAILABLE, not a coercion and not NOT_FOUND", async () => {
  const authority = createPostgresEmployeeAuthority(rowsDb([employeeRow("PROBATION")]));
  const resolution = await authority.resolveEmployeeReference(REF);

  assert.equal(resolution.outcome, "AUTHORITY_UNAVAILABLE");
  assert.equal(resolution.reason, "AUTHORITY_CONTRACT_VIOLATION");
  // Specifically NOT silently ACTIVE, which is the coercion that would make an unknown status the most
  // permissive one.
  assert.ok(!("employee" in resolution), "an unrecognised status yields no facts at all");
});

test("mustResolveEmployeeReference FAILS CLOSED, with a distinct code per cause", async () => {
  // Ruling #187 §2 requires the distinction be preserved in "audit/error semantics". Three causes,
  // three codes -- so an outage cannot arrive at the audit log as a missing person.
  const cases = [
    { authority: createPostgresEmployeeAuthority(rowsDb([])), code: "EMPLOYEE_REFERENCE_NOT_FOUND", ref: REF },
    { authority: createPostgresEmployeeAuthority(failingDb()), code: "EMPLOYEE_AUTHORITY_UNAVAILABLE", ref: REF },
    { authority: resolveConfiguredEmployeeAuthority(undefined), code: "EMPLOYEE_AUTHORITY_UNAVAILABLE", ref: REF },
    { authority: createPostgresEmployeeAuthority(rowsDb([])), code: "EMPLOYEE_REFERENCE_MALFORMED", ref: { tenantId: TENANT, employeeId: "a/b" } },
  ];
  for (const { authority, code, ref } of cases) {
    await assert.rejects(
      () => mustResolveEmployeeReference(authority, ref),
      (err) => {
        assert.ok(err instanceof EmployeeAuthorityFailure, "the refusal must be the typed failure");
        assert.equal(err.code, code);
        return true;
      },
      `expected ${code}`,
    );
  }
});

test("the unavailable failure carries WHY, and says it is not a finding about the person", async () => {
  const authority = createPostgresEmployeeAuthority(failingDb("statement timeout"));
  await assert.rejects(
    () => mustResolveEmployeeReference(authority, REF),
    (err) => {
      assert.equal(err.code, "EMPLOYEE_AUTHORITY_UNAVAILABLE");
      assert.equal(err.unavailableReason, "AUTHORITY_READ_FAILED");
      assert.match(err.message, /NOT a finding that the Employee is missing/);
      return true;
    },
  );
});

test("a resolved Employee is returned, and only then", async () => {
  const facts = await mustResolveEmployeeReference(
    createPostgresEmployeeAuthority(rowsDb([employeeRow("ON_LEAVE")])),
    REF,
  );
  assert.equal(facts.employmentStatus, "ON_LEAVE");
  assert.equal(facts.operatingCompanyId, "taylor");
});

test("a failing authority is asked ONCE and consults no substitute reader", async () => {
  // "Assert the fallback does not happen, not merely that the result is right." Three assertions, each
  // about the RUN rather than the return value.
  const db = failingDb();

  // A tripwire in the place a careless fallback would reach for: any property touched is recorded.
  const touched = [];
  const tripwire = new Proxy({}, {
    get(_t, prop) {
      touched.push(String(prop));
      throw new Error("FALLBACK: a substitute person store was consulted");
    },
  });
  const priorFirestore = globalThis.getFirestore;
  const priorDb = globalThis.db;
  globalThis.getFirestore = () => tripwire;
  globalThis.db = tripwire;
  try {
    const resolution = await createPostgresEmployeeAuthority(db).resolveEmployeeReference(REF);
    assert.equal(resolution.outcome, "AUTHORITY_UNAVAILABLE");
    assert.equal(db.calls.length, 1, "the authority is asked exactly once -- no retry against another store");
    assert.deepEqual(touched, [], "no substitute person store was touched");
  } finally {
    globalThis.getFirestore = priorFirestore;
    globalThis.db = priorDb;
  }
});

test("the port offers no way to express a fallback", () => {
  // The structural half of "no silent fallback" (#185, #187 §2): an interface that CAN express a
  // fallback is one somebody eventually points at Firestore. So there is no such surface to call.
  const authority = createPostgresEmployeeAuthority(rowsDb([]));
  assert.deepEqual(Object.keys(authority), ["resolveEmployeeReference"]);
  for (const forbidden of ["resolveOrDefault", "tryResolve", "resolveWithFallback", "setFallback"]) {
    assert.equal(authority[forbidden], undefined, `the port must not offer ${forbidden}`);
  }
  assert.equal(authority.resolveEmployeeReference.length, 1, "one argument: the reference. No options bag to hide a fallback in.");
});

// ════════════════════ 5. VALIDITY AND ELIGIBILITY, SEPARATELY OBSERVABLE ════════════════════

test("ONE reference: the reference is VALID while the person is NOT currently eligible", async () => {
  // Ruling #189 (`MI-e`): "A real Employee may simultaneously be a VALID REFERENCE and NOT CURRENTLY
  // ELIGIBLE FOR NEW/CURRENT ACCOUNTABILITY." Both facts, one reference, two separate observations.
  const authority = createPostgresEmployeeAuthority(rowsDb([employeeRow("TERMINATED")]));
  const resolution = await authority.resolveEmployeeReference(REF);

  assert.equal(resolution.outcome, "RESOLVED", "a TERMINATED employee is still a valid reference (#186 §1)");
  assert.equal(resolution.employee.employmentStatus, "TERMINATED");

  const eligibility = decideAccountabilityEligibility(resolution.employee, {
    policyId: "TEST-POLICY-ACTIVE-ONLY",
    eligibleStatuses: ["ACTIVE"],
  });
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.policyId, "TEST-POLICY-ACTIVE-ONLY");
  // The lifecycle fact stays visible on the eligibility answer -- the composed view never replaces the
  // facts it came from (#186 §3).
  assert.equal(eligibility.employmentStatus, "TERMINATED");
});

test("eligibility comes from the POLICY, not from the status -- the same employee flips with the policy", () => {
  // This is the test that would fail if eligibility were implemented as `status !== "ACTIVE"`, which
  // #189 forbids. The Employee does not change; only the governed policy does.
  const employee = { employeeId: EMP, tenantId: TENANT, employmentStatus: "CONTRACTOR", operatingCompanyId: "taylor" };

  const strict = decideAccountabilityEligibility(employee, { policyId: "P-STRICT", eligibleStatuses: ["ACTIVE"] });
  const permissive = decideAccountabilityEligibility(employee, { policyId: "P-CONTRACTORS-OK", eligibleStatuses: ["ACTIVE", "CONTRACTOR"] });

  assert.equal(strict.eligible, false);
  assert.equal(permissive.eligible, true);
  assert.equal(strict.employmentStatus, permissive.employmentStatus, "the lifecycle fact is identical in both");
});

test("ACTIVE is not privileged by the port -- a policy may exclude it", () => {
  // The inverse proof. If anything in the port treated ACTIVE as inherently eligible, this would fail.
  const employee = { employeeId: EMP, tenantId: TENANT, employmentStatus: "ACTIVE", operatingCompanyId: "taylor" };
  const odd = decideAccountabilityEligibility(employee, { policyId: "P-ON-LEAVE-ONLY", eligibleStatuses: ["ON_LEAVE"] });
  assert.equal(odd.eligible, false, "the port holds no opinion that ACTIVE is eligible");
});

test("the module exports no default eligibility policy", async () => {
  // #189: the gate "must not flatten the six-value vocabulary into a hidden boolean policy". A default
  // exported here would BE that hidden policy, inherited by every caller who did not think about it.
  const mod = await import("../lib/employeeIdentity/employeeAuthority.js");
  const suspicious = Object.keys(mod).filter((k) => /ELIGIBLE|ELIGIBILITY_POLICY|DEFAULT_POLICY/.test(k));
  assert.deepEqual(suspicious, [], "no eligibility policy value may be exported from the contract");
  assert.equal(decideAccountabilityEligibility.length, 2, "the policy is a required argument, not a default");
});

// ════════════════════ 6. THE COMPOSED STATE, WITH THE FACTS STILL UNDERNEATH ════════════════════

test("the composed consumer state distinguishes all four cases", async () => {
  const policy = { policyId: "P-ACTIVE", eligibleStatuses: ["ACTIVE"] };
  const composed = async (authority) =>
    composePersonReferenceState(await authority.resolveEmployeeReference(REF), policy);

  assert.equal((await composed(createPostgresEmployeeAuthority(rowsDb([employeeRow("ACTIVE")])))).state, "VALID_CURRENT");
  assert.equal((await composed(createPostgresEmployeeAuthority(rowsDb([employeeRow("INACTIVE")])))).state, "VALID_NOT_CURRENTLY_ELIGIBLE");
  assert.equal((await composed(createPostgresEmployeeAuthority(rowsDb([])))).state, "MISSING_OR_INVALID_REFERENCE");
  assert.equal((await composed(createPostgresEmployeeAuthority(failingDb()))).state, "AUTHORITY_UNAVAILABLE");
  assert.equal((await composed(resolveConfiguredEmployeeAuthority(null))).state, "AUTHORITY_UNAVAILABLE");
});

test("INACTIVE and TERMINATED stay distinguishable through the composed state", async () => {
  // #186 §4 requires it, and #186 §6 says the UI must tell "Former employee" from "Inactive". A composed
  // label that erased the underlying status would make that impossible.
  const policy = { policyId: "P-ACTIVE", eligibleStatuses: ["ACTIVE"] };
  const of = async (status) =>
    composePersonReferenceState(
      await createPostgresEmployeeAuthority(rowsDb([employeeRow(status)])).resolveEmployeeReference(REF),
      policy,
    );

  const inactive = await of("INACTIVE");
  const terminated = await of("TERMINATED");

  assert.equal(inactive.state, terminated.state, "both compose to the same presentable state");
  assert.notEqual(
    inactive.resolution.employee.employmentStatus,
    terminated.resolution.employee.employmentStatus,
    "and the underlying lifecycle facts remain independently available and different",
  );
});

test("a missing reference carries NO eligibility verdict at all", async () => {
  // #186 case D: for an unresolvable id, "eligibility NOT APPLICABLE -- must not be represented as
  // merely 'not eligible'". So the absence of the field is the assertion, not `eligible: false`.
  const composed = composePersonReferenceState(
    await createPostgresEmployeeAuthority(rowsDb([])).resolveEmployeeReference(REF),
    { policyId: "P-ACTIVE", eligibleStatuses: ["ACTIVE"] },
  );
  assert.equal(composed.state, "MISSING_OR_INVALID_REFERENCE");
  assert.equal(composed.eligibility, undefined, "NOT APPLICABLE is not 'not eligible'");
});

test("an unavailable authority carries no eligibility verdict either", async () => {
  const composed = composePersonReferenceState(
    await resolveConfiguredEmployeeAuthority(null).resolveEmployeeReference(REF),
    { policyId: "P-ACTIVE", eligibleStatuses: ["ACTIVE"] },
  );
  assert.equal(composed.eligibility, undefined);
});

test("reference shape is checked without asking the authority", () => {
  assert.ok(isEmployeeReferenceShape({ tenantId: "t", employeeId: "e" }));
  for (const bad of [
    { tenantId: "t", employeeId: "" },
    { tenantId: "t", employeeId: " e" },
    { tenantId: "t", employeeId: "a/b" },
    { tenantId: "", employeeId: "e" },
    { tenantId: "t/x", employeeId: "e" },
  ]) {
    assert.ok(!isEmployeeReferenceShape(bad), `${JSON.stringify(bad)} is not a well-shaped reference`);
  }
});

test("an unavailable authority is still an authority object, not a thrown startup error", async () => {
  // The design point: the absence of a configured authority is a first-class ANSWER. A constructor that
  // threw would push the decision to startup, where the only options are crash or ignore -- and
  // "ignore" is how a process ends up consulting something else.
  const authority = createUnavailableEmployeeAuthority("none configured in this test");
  const resolution = await authority.resolveEmployeeReference(REF);
  assert.equal(resolution.outcome, "AUTHORITY_UNAVAILABLE");
  assert.equal(resolution.reason, "NO_AUTHORITY_CONFIGURED");
});

// ════════════════════ 7. NO FIREBASE, NO FIRESTORE — STATICALLY ════════════════════

const PORT_FILES = Object.freeze([
  "src/employeeIdentity/employeeAuthority.ts",
  "src/employeeIdentity/postgresEmployeeAuthority.ts",
]);

/** Source with comments removed. Every check below is about CODE: a header explaining why a layer must
 *  never touch Firestore is exactly the comment that should survive. The same reasoning
 *  functions/test/adminPolicyNoFirebase.test.mjs gives for the same transformation. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

test("no Employee authority module imports Firebase or Firestore", () => {
  const FORBIDDEN = [
    { pattern: /from\s+["']firebase\/firestore["']/, what: 'import from "firebase/firestore"' },
    { pattern: /from\s+["']firebase-admin\/firestore["']/, what: 'import from "firebase-admin/firestore"' },
    { pattern: /from\s+["']firebase-admin/, what: 'import from "firebase-admin"' },
    { pattern: /from\s+["']firebase-functions/, what: 'import from "firebase-functions"' },
    { pattern: /from\s+["']firebase["']/, what: 'import from "firebase"' },
    { pattern: /\bgetFirestore\s*\(/, what: "a getFirestore() call" },
    { pattern: /\bgetAuth\s*\(/, what: "a getAuth() call" },
    { pattern: /\bFieldValue\b/, what: "a Firestore FieldValue" },
    { pattern: /\bFieldPath\b/, what: "a Firestore FieldPath" },
    { pattern: /\.\s*collection\s*\(/, what: "a Firestore collection() call" },
    { pattern: /\.\s*doc\s*\(/, what: "a Firestore doc() call" },
  ];
  const offences = [];
  for (const file of PORT_FILES) {
    const source = stripComments(readFileSync(join(FUNCTIONS_DIR, file), "utf8"));
    for (const { pattern, what } of FORBIDDEN) {
      if (pattern.test(source)) offences.push(`${file}: ${what}`);
    }
  }
  assert.deepEqual(offences, [], "the Employee authority must not be coupled to Firebase (#185, #187 §2)");
});

test("the transitional person stores are never named in code", () => {
  // Ruling #187 §2 names them individually as the things AUTHORITY_UNAVAILABLE must not fall back to:
  // Firestore, `users`, `fieldops_technicians`, Firebase UID coincidence. A string literal naming one
  // is the first half of consulting it.
  //
  // `employeeId` is deliberately NOT in this list. It is this contract's OWN field name -- the canonical
  // business Employee id is exactly what the port is for. What is forbidden is the LEGACY CROSSWALK KEY
  // `users/{uid}.employeeId`, which #185 names as non-canonical and #187 §4 retires as an authority; the
  // way that would appear here is a `users` collection name or a `userId` / uid field, all of which ARE
  // in the list. Banning the word `employeeId` outright would ban the thing this module authoritatively
  // owns, which is the opposite of the boundary being guarded.
  const FORBIDDEN_COLLECTIONS = ["fieldops_technicians", '"users"', "'users'", '"employees"', "userId", "firebaseUid", "uid", "external_subject"];
  const offences = [];
  for (const file of PORT_FILES) {
    const source = stripComments(readFileSync(join(FUNCTIONS_DIR, file), "utf8"));
    for (const name of FORBIDDEN_COLLECTIONS) {
      if (source.includes(name)) offences.push(`${file}: names ${name}`);
    }
  }
  assert.deepEqual(offences, [], "the Employee authority must not name a transitional person store or a credential key");
});

test("the permanent contract exposes no Firestore concept", () => {
  // Not about imports -- about the VOCABULARY of the interface. A contract phrased in snapshots makes
  // the transitional store's shape the permanent interface, which is what the port exists to prevent.
  const source = stripComments(readFileSync(join(FUNCTIONS_DIR, "src/employeeIdentity/employeeAuthority.ts"), "utf8"));
  for (const concept of ["DocumentSnapshot", "QuerySnapshot", "DocumentReference", "QueryDocumentSnapshot", "Timestamp", "exists", "snapshot"]) {
    assert.ok(!source.includes(concept), `the permanent contract must not expose the Firestore concept "${concept}"`);
  }
});

test("the contract module imports nothing at all", () => {
  // Its header claims it. A claim about imports is cheap to check and expensive to discover broken.
  const source = stripComments(readFileSync(join(FUNCTIONS_DIR, "src/employeeIdentity/employeeAuthority.ts"), "utf8"));
  const imports = [...source.matchAll(/^\s*import\s/gm)];
  assert.equal(imports.length, 0, "employeeAuthority.ts must import nothing -- not pg, not node:, not Firebase");
  assert.ok(!/process\.env/.test(source), "and must read no environment");
  assert.ok(!/new\s+(Pool|Client)\s*\(/.test(source), "and must construct no database client");
});

test("the adapter constructs no connection and reads no environment", () => {
  const source = stripComments(readFileSync(join(FUNCTIONS_DIR, "src/employeeIdentity/postgresEmployeeAuthority.ts"), "utf8"));
  assert.ok(!/new\s+(Pool|Client)\s*\(/.test(source), "the connection is the caller's (the eosOps house rule)");
  assert.ok(!/process\.env/.test(source), "src/adminPolicy/policyDatabase.ts is the only module that reads DATABASE_URL");
  assert.ok(/import type \{ Pool, PoolClient \} from "pg"/.test(source), "it takes pg types only, never a runtime pg import");
});

// ════════════════════ 8. NO FIREBASE — PROVED BY SUBPROCESS, AT RESOLUTION TIME ════════════════════

// The static checks above prove the import is not WRITTEN. This proves it is never RESOLVED, on the
// actual failure path, in a real process -- the mechanism
// functions/test/operatorScriptEnvironmentFence.test.mjs uses, for the same reason it gives: hooking
// Module._load fires on RESOLUTION, so it catches the attempt even when the package is present and
// cannot be defeated by code that loads the SDK and simply never calls it.
//
// This is the strongest available form of "assert the fallback does not happen": the fallback is not
// merely unused, the module graph is incapable of it.
const SENTINEL = "EMPLOYEE_AUTHORITY_LOADED_A_FORBIDDEN_MODULE";

test("exercising the AUTHORITY_UNAVAILABLE path never resolves firebase-admin", () => {
  const dir = mkdtempSync(join(tmpdir(), "eos-employee-authority-"));
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

  // Drive BOTH unavailable paths and the missing path, because each is a place a fallback would be
  // tempting: no authority configured, the read failed, and the answer was "no such Employee".
  const driver = join(dir, "drive.mjs");
  writeFileSync(
    driver,
    `import { mustResolveEmployeeReference } from "${resolve(FUNCTIONS_DIR, "lib/employeeIdentity/employeeAuthority.js")}";
import { createPostgresEmployeeAuthority, resolveConfiguredEmployeeAuthority } from "${resolve(FUNCTIONS_DIR, "lib/employeeIdentity/postgresEmployeeAuthority.js")}";
const ref = { tenantId: "t", employeeId: "e" };
const codes = [];
for (const authority of [
  resolveConfiguredEmployeeAuthority(null),
  createPostgresEmployeeAuthority({ query: async () => { throw new Error("outage"); } }),
  createPostgresEmployeeAuthority({ query: async () => ({ rows: [] }) }),
]) {
  try { await mustResolveEmployeeReference(authority, ref); codes.push("RESOLVED_UNEXPECTEDLY"); }
  catch (err) { codes.push(err.code); }
}
process.stdout.write(codes.join(","));
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
    `a forbidden module was resolved while resolving an Employee reference: ${res.stderr}`,
  );
  // And the outcomes really were the fail-closed ones, so the clean stderr is not clean because
  // nothing happened.
  assert.equal(
    res.stdout,
    "EMPLOYEE_AUTHORITY_UNAVAILABLE,EMPLOYEE_AUTHORITY_UNAVAILABLE,EMPLOYEE_REFERENCE_NOT_FOUND",
  );
});
