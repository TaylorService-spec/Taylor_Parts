// Employee ↔ Principal linkage — the PURE proofs, and the technician-fallback ratchet.
//
// No database, no emulator, no network. Everything asserted here is a property of the planner's
// arithmetic over evidence, plus two static fences over the source tree.
//
// Run: npm run build && node --test test/employeePrincipalLinkPlan.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  LINK_REFUSAL,
  LINK_REFUSAL_REASONS,
  LINK_SOURCES,
  assertValidLinkInput,
  isEmployeeIdShape,
  isOperatingCompanyIdShape,
  EmployeePrincipalLinkInvalid,
  EmployeePrincipalLinkRefused,
} from "../lib/employeeIdentity/employeePrincipalLink.js";
import { buildEmployeePrincipalLinkPlan } from "../lib/employeeIdentity/employeePrincipalLinkPlan.js";
import { isOperatingCompanyIdShape as authorityShape } from "../lib/ownership/operatingCompanyAuthority.js";

const TENANT = "tenant-a";
const PROVIDER = "firebase";

const employee = (id, data) => ({ id, data });
const principal = (id, subject, provider = PROVIDER) => ({
  id,
  external_subject: subject,
  identity_provider: provider,
  status: "active",
});

/** The smallest well-formed world: one Employee, one reciprocal user, one principal, one company. */
function cleanWorld(overrides = {}) {
  return buildEmployeePrincipalLinkPlan({
    tenantId: TENANT,
    identityProvider: PROVIDER,
    employees: [employee("emp-1", { userId: "uid-1", displayName: "A" })],
    users: [employee("uid-1", { employeeId: "emp-1" })],
    technicians: [],
    principals: [principal("prn-1", "uid-1")],
    operatingCompanyIdByEmployeeId: { "emp-1": "taylor" },
    ...overrides,
  });
}

test("a reciprocal uid link with a principal and a stated company is the ONLY thing that produces a link", () => {
  const plan = cleanWorld();
  assert.equal(plan.linkageReadiness, "PROCEED");
  assert.deepEqual(plan.links, [
    {
      employeeId: "emp-1",
      principalId: "prn-1",
      externalSubject: "uid-1",
      identityProvider: PROVIDER,
      operatingCompanyId: "taylor",
      linkSource: "RECIPROCAL_FIREBASE_UID_LINK",
      technicianIdCoincides: false,
    },
  ]);
  assert.deepEqual(plan.refusals, []);
});

test("a one-way link is not a link -- both directions must agree", () => {
  // users/{uid} points somewhere else.
  const wrongWay = cleanWorld({ users: [employee("uid-1", { employeeId: "emp-OTHER" })] });
  assert.deepEqual(wrongWay.links, []);
  assert.equal(wrongWay.refusals[0].reason, LINK_REFUSAL.NON_RECIPROCAL_USER_LINK);

  // users/{uid} does not exist at all.
  const missing = cleanWorld({ users: [] });
  assert.deepEqual(missing.links, []);
  assert.equal(missing.refusals[0].reason, LINK_REFUSAL.NON_RECIPROCAL_USER_LINK);

  // An alias field is NOT accepted -- same posture as firestore.rules and resolveEmployeeLinkFacts.
  const alias = cleanWorld({
    employees: [employee("emp-1", { authUid: "uid-1" })],
  });
  assert.deepEqual(alias.links, []);
  assert.equal(alias.refusals[0].reason, LINK_REFUSAL.EMPLOYEE_WITHOUT_EXTERNAL_SUBJECT);
});

test("two Employees claiming one Firebase UID refuses BOTH and refuses the whole plan", () => {
  const plan = cleanWorld({
    employees: [employee("emp-1", { userId: "uid-1" }), employee("emp-2", { userId: "uid-1" })],
    operatingCompanyIdByEmployeeId: { "emp-1": "taylor", "emp-2": "taylor" },
  });
  assert.deepEqual(plan.links, [], "never first-wins");
  assert.deepEqual(
    plan.refusals.map((r) => [r.subject, r.reason]),
    [
      ["employee:emp-1", LINK_REFUSAL.AMBIGUOUS_EXTERNAL_SUBJECT],
      ["employee:emp-2", LINK_REFUSAL.AMBIGUOUS_EXTERNAL_SUBJECT],
    ],
  );
  assert.equal(plan.linkageReadiness, "REFUSE");
});

test("two principals carrying one external subject refuses the Employee rather than picking one", () => {
  const plan = cleanWorld({
    principals: [principal("prn-1", "uid-1"), principal("prn-2", "uid-1")],
  });
  assert.deepEqual(plan.links, []);
  assert.equal(plan.refusals[0].reason, LINK_REFUSAL.AMBIGUOUS_PRINCIPAL);
  assert.equal(plan.linkageReadiness, "REFUSE");
});

test("a principal from a DIFFERENT identity provider is not this uid's principal", () => {
  const plan = cleanWorld({ principals: [principal("prn-1", "uid-1", "some-other-idp")] });
  assert.deepEqual(plan.links, []);
  assert.equal(plan.refusals[0].reason, LINK_REFUSAL.NO_PRINCIPAL_FOR_EXTERNAL_SUBJECT);
  // Not linkable yet is not the same as undecidable: the plan may still proceed for others.
  assert.equal(plan.linkageReadiness, "PROCEED");
});

test("an unstated operating company is refused, never inferred, and refuses the plan", () => {
  const plan = cleanWorld({ operatingCompanyIdByEmployeeId: {} });
  assert.deepEqual(plan.links, []);
  assert.equal(plan.refusals[0].reason, LINK_REFUSAL.OPERATING_COMPANY_NOT_STATED);
  assert.equal(plan.linkageReadiness, "REFUSE");
});

test("a technician id that equals an employee id is EVIDENCE, never a link source", () => {
  // emp-1 has no userId at all. A technician document shares its id exactly -- the coincidence that
  // holds for 11 of 13 in the live census. There must still be no link.
  const plan = buildEmployeePrincipalLinkPlan({
    tenantId: TENANT,
    identityProvider: PROVIDER,
    employees: [employee("emp-1", { displayName: "A" })],
    users: [employee("uid-1", { employeeId: "emp-1" })],
    technicians: [employee("emp-1", { userId: "uid-1", status: "available" })],
    principals: [principal("prn-1", "uid-1")],
    operatingCompanyIdByEmployeeId: { "emp-1": "taylor" },
  });
  assert.deepEqual(plan.links, [], "the technician id must not become the mapping");
  assert.equal(
    plan.refusals.find((r) => r.subject === "employee:emp-1").reason,
    LINK_REFUSAL.EMPLOYEE_WITHOUT_EXTERNAL_SUBJECT,
  );
  assert.equal(plan.counts.technicianIdCoincidences, 1);

  // And when the Employee IS linkable, the coincidence is recorded as evidence beside the link.
  const linkable = cleanWorld({ technicians: [employee("emp-1", { status: "available" })] });
  assert.equal(linkable.links[0].technicianIdCoincides, true);
  assert.equal(linkable.links[0].linkSource, "RECIPROCAL_FIREBASE_UID_LINK");
});

test("an orphan technician is named, never minted into an Employee", () => {
  const plan = cleanWorld({
    technicians: [
      employee("tech-sbx-01", { userId: "uid-x", status: "available" }),
      employee("tech-sbx-02", { userId: null }),
    ],
  });
  const orphans = plan.refusals.filter((r) => r.reason === LINK_REFUSAL.ORPHAN_TECHNICIAN);
  assert.deepEqual(
    orphans.map((r) => r.subject),
    ["technician:tech-sbx-01", "technician:tech-sbx-02"],
  );
  // tech-sbx-02 carries no userId and exists in no other collection: the refusal says so.
  assert.match(
    orphans[1].detail,
    /carries no userId, so nothing else in the system names this person/,
  );
  assert.equal(plan.technicianRetirementReadiness, "REFUSE");
  // The linkage itself is unaffected -- the 60 clean Employees are not held hostage by 2 orphans.
  assert.equal(plan.linkageReadiness, "PROCEED");
  assert.equal(plan.links.length, 1);
});

test("a business fact carried only by fieldops_technicians refuses the collection's retirement", () => {
  const plan = cleanWorld({
    technicians: [employee("emp-1", { skills: ["hvac"], status: "available" })],
  });
  assert.deepEqual(plan.technicianOnlyFieldKeys, ["skills", "status"]);
  const facts = plan.refusals.filter((r) => r.reason === LINK_REFUSAL.TECHNICIAN_ONLY_BUSINESS_FACT);
  assert.deepEqual(
    facts.map((r) => r.subject),
    ["technicianField:skills", "technicianField:status"],
  );
  assert.match(facts[0].detail, /retiring the collection would destroy it/);
  assert.equal(plan.technicianRetirementReadiness, "REFUSE");

  // A field the Employee record also carries is NOT a technician-only fact.
  const shared = cleanWorld({
    employees: [employee("emp-1", { userId: "uid-1", status: "ACTIVE" })],
    technicians: [employee("emp-1", { status: "available" })],
  });
  assert.deepEqual(shared.technicianOnlyFieldKeys, []);
  assert.equal(shared.technicianRetirementReadiness, "PROCEED");
});

test("the live census reproduces: 60 employees / 62 users / 13 technicians, 11 coincidences, 2 orphans", () => {
  // The shape the prior live census reported, rebuilt as a fixture so the verdicts are arithmetic
  // rather than assertion. 60 Employees, each reciprocally linked to its own uid; 2 extra uids that
  // are probe artifacts with no Employee; 13 technicians of which 11 share an employee id and 2 are
  // the sandbox orphans; `skills` on every technician and on no Employee.
  const employees = [];
  const users = [];
  const principals = [];
  const companies = {};
  for (let i = 1; i <= 60; i += 1) {
    const id = `emp-${String(i).padStart(3, "0")}`;
    const uid = `uid-${String(i).padStart(3, "0")}`;
    employees.push(employee(id, { userId: uid, employmentStatus: "ACTIVE", displayName: id }));
    users.push(employee(uid, { employeeId: id }));
    principals.push(principal(`prn-${i}`, uid));
    companies[id] = i % 2 === 0 ? "taylor" : "ventana";
  }
  users.push(employee("uid-probe-1", {}), employee("uid-probe-2", { employeeId: "emp-gone" }));

  const technicians = [];
  for (let i = 1; i <= 11; i += 1) {
    technicians.push(
      employee(`emp-${String(i).padStart(3, "0")}`, { skills: ["hvac"], status: "available" }),
    );
  }
  technicians.push(employee("tech-sbx-01", { userId: "uid-sbx-1", skills: [], status: "available" }));
  technicians.push(employee("tech-sbx-02", { userId: null, skills: [], status: "available" }));

  const plan = buildEmployeePrincipalLinkPlan({
    tenantId: TENANT,
    identityProvider: PROVIDER,
    employees,
    users,
    technicians,
    principals,
    operatingCompanyIdByEmployeeId: companies,
  });

  assert.deepEqual(plan.counts, {
    employees: 60,
    users: 62,
    technicians: 13,
    principals: 60,
    links: 60,
    refusals: 6,
    technicianIdCoincidences: 11,
  });
  assert.equal(plan.refusalCounts[LINK_REFUSAL.EXTERNAL_SUBJECT_WITHOUT_EMPLOYEE], 2, "2 probe uids");
  assert.equal(plan.refusalCounts[LINK_REFUSAL.ORPHAN_TECHNICIAN], 2, "tech-sbx-01, tech-sbx-02");
  assert.equal(plan.refusalCounts[LINK_REFUSAL.TECHNICIAN_ONLY_BUSINESS_FACT], 2, "skills + status");
  assert.deepEqual(plan.technicianOnlyFieldKeys, ["skills", "status"]);

  // THE TWO VERDICTS ARE DIFFERENT, and that is the finding: every Employee↔Principal link is
  // decidable, and `fieldops_technicians` still may not be retired.
  assert.equal(plan.linkageReadiness, "PROCEED");
  assert.equal(plan.technicianRetirementReadiness, "REFUSE");

  // No link anywhere names a technician id.
  const technicianIds = new Set(technicians.map((t) => t.id));
  for (const link of plan.links) {
    assert.equal(link.linkSource, "RECIPROCAL_FIREBASE_UID_LINK");
    assert.notEqual(link.principalId, undefined);
    assert.ok(!technicianIds.has(link.principalId), "a technician id is never a principal id");
  }
});

test("the plan is deterministic and emits nothing outside the refusal vocabulary", () => {
  const world = {
    tenantId: TENANT,
    identityProvider: PROVIDER,
    employees: [
      employee("emp-b", { userId: "uid-b" }),
      employee("emp-a", { userId: "uid-a" }),
      employee("emp-c", {}),
    ],
    users: [employee("uid-b", { employeeId: "emp-b" }), employee("uid-a", { employeeId: "emp-a" }), employee("uid-z", {})],
    technicians: [employee("tech-z", { skills: [] })],
    principals: [principal("prn-a", "uid-a"), principal("prn-b", "uid-b")],
    operatingCompanyIdByEmployeeId: { "emp-a": "taylor", "emp-b": "ventana" },
  };
  const first = buildEmployeePrincipalLinkPlan(world);
  const second = buildEmployeePrincipalLinkPlan({
    ...world,
    employees: [...world.employees].reverse(),
    users: [...world.users].reverse(),
  });
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
  assert.deepEqual(
    first.links.map((l) => l.employeeId),
    ["emp-a", "emp-b"],
  );
  for (const refusal of first.refusals) {
    assert.ok(LINK_REFUSAL_REASONS.includes(refusal.reason), `${refusal.reason} is in the vocabulary`);
    assert.ok(refusal.detail.length > 0, "every refusal carries a readable reason");
  }
});

test("every refusal term is reachable -- no dead vocabulary", () => {
  const seen = new Set();
  const collect = (plan) => plan.refusals.forEach((r) => seen.add(r.reason));
  collect(cleanWorld({ employees: [employee("emp-1", {})] }));
  collect(cleanWorld({ users: [employee("uid-1", { employeeId: "emp-1" }), employee("uid-2", {})] }));
  collect(cleanWorld({ users: [employee("uid-1", { employeeId: "other" })] }));
  collect(
    cleanWorld({
      employees: [employee("emp-1", { userId: "u" }), employee("emp-2", { userId: "u" })],
    }),
  );
  collect(cleanWorld({ principals: [principal("p1", "uid-1"), principal("p2", "uid-1")] }));
  collect(cleanWorld({ principals: [] }));
  collect(cleanWorld({ technicians: [employee("tech-orphan", { skills: [] })] }));
  collect(cleanWorld({ operatingCompanyIdByEmployeeId: {} }));
  assert.deepEqual([...seen].sort(), [...LINK_REFUSAL_REASONS].sort());
});

// ---------------------------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------------------------

test("assertValidLinkInput refuses what the database would also refuse", () => {
  const base = {
    tenantId: TENANT,
    principalId: "prn-1",
    employeeId: "emp-1",
    operatingCompanyId: "taylor",
    linkSource: "RECIPROCAL_FIREBASE_UID_LINK",
  };
  assert.doesNotThrow(() => assertValidLinkInput(base));

  assert.throws(() => assertValidLinkInput({ ...base, employeeId: "a/b" }), EmployeePrincipalLinkInvalid);
  assert.throws(() => assertValidLinkInput({ ...base, employeeId: " x " }), EmployeePrincipalLinkInvalid);
  assert.throws(() => assertValidLinkInput({ ...base, tenantId: "  " }), EmployeePrincipalLinkInvalid);

  // A technician-id coincidence is not a link source, and cannot be spelled as one.
  assert.throws(
    () => assertValidLinkInput({ ...base, linkSource: "TECHNICIAN_ID_COINCIDENCE" }),
    (err) => err instanceof EmployeePrincipalLinkInvalid && /coincidence is not a link source/.test(err.message),
  );

  // An unstated company is a REFUSAL with a vocabulary term, not a generic validation error.
  assert.throws(
    () => assertValidLinkInput({ ...base, operatingCompanyId: "" }),
    (err) =>
      err instanceof EmployeePrincipalLinkRefused &&
      err.reason === LINK_REFUSAL.OPERATING_COMPANY_NOT_STATED,
  );

  // An assertion with no author is a guess.
  assert.throws(
    () => assertValidLinkInput({ ...base, linkSource: "OPERATOR_ASSERTED" }),
    (err) => err instanceof EmployeePrincipalLinkInvalid && /an assertion with no author is a guess/.test(err.message),
  );
  assert.doesNotThrow(() =>
    assertValidLinkInput({
      ...base,
      linkSource: "OPERATOR_ASSERTED",
      assertedBy: "owner@example.com",
      assertionReason: "verified against HR record",
    }),
  );
});

test("the operating-company shape mirror agrees with the authority module it mirrors", () => {
  for (const value of ["taylor", "ventana", "a-b_c", "", "Taylor", "1taylor", "x", "a/b", null, 7]) {
    assert.equal(
      isOperatingCompanyIdShape(value),
      authorityShape(value),
      `shape disagreement on ${JSON.stringify(value)}`,
    );
  }
});

test("employee id shape rejects paths, blanks and untrimmed ids", () => {
  assert.ok(isEmployeeIdShape("emp-1"));
  assert.ok(!isEmployeeIdShape(""));
  assert.ok(!isEmployeeIdShape(" emp-1"));
  assert.ok(!isEmployeeIdShape("employees/emp-1"));
  assert.ok(!isEmployeeIdShape(null));
});

// ---------------------------------------------------------------------------------------------
// STATIC FENCES over the source tree
// ---------------------------------------------------------------------------------------------

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
      continue;
    }
    if (entry.endsWith(".ts")) out.push(path);
  }
  return out;
}

test("no employeeIdentity module imports Firebase, Firestore, or a Firebase business runtime", () => {
  // Same fence eosOpsNoFirebase.test.mjs holds over src/eosOps, for the same reason: the linkage is
  // Postgres-authoritative, and an import that is not there cannot be called on any path -- including
  // ones nobody wrote a runtime test for. The firebase-exit guard enforces the same thing from the
  // outside; this states it as a property of THIS subsystem.
  const FORBIDDEN = [
    [/from\s+["']firebase\/firestore["']/, 'import from "firebase/firestore"'],
    [/from\s+["']firebase-admin\/firestore["']/, 'import from "firebase-admin/firestore"'],
    [/from\s+["']firebase-admin["']/, 'import from "firebase-admin"'],
    [/from\s+["']firebase-functions/, 'import from "firebase-functions"'],
    [/\bgetFirestore\s*\(/, "a getFirestore() call"],
    [/\bFieldValue\b/, "a Firestore FieldValue"],
  ];
  const offences = [];
  for (const file of sourceFiles("src/employeeIdentity")) {
    const source = readFileSync(file, "utf8");
    for (const [pattern, what] of FORBIDDEN) if (pattern.test(source)) offences.push(`${file}: ${what}`);
  }
  assert.deepEqual(offences, []);
});

test("the linkage subsystem names no Firestore collection as its persistence", () => {
  const COLLECTIONS = ['"employees"', '"users"', '"fieldops_technicians"', '"trucks"'];
  const offences = [];
  for (const file of sourceFiles("src/employeeIdentity")) {
    const source = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    for (const name of COLLECTIONS) {
      if (source.includes(name)) offences.push(`${file}: references ${name} outside a comment`);
    }
  }
  assert.deepEqual(offences, [], "the linkage reads and writes eos_policy Postgres tables only");
});

// ---------------------------------------------------------------------------------------------
// THE TECHNICIAN-ID FALLBACK RATCHET
//
// `fieldops_technicians` must not remain employee-identity or assignment authority. Two live
// fallbacks still exist in functions/src, and this lane does not rewire the deployed callables that
// hold them (the suites that cover them are Firestore-emulator suites this lane cannot run). What it
// does instead is FENCE them: the exact set is recorded below, and a NEW one fails this test.
//
// A shrink-only census, same ratchet shape as scripts/firebaseExitGuard.mjs. Removing a file from a
// fallback set is a one-line edit here; ADDING one is a conversation.
// ---------------------------------------------------------------------------------------------

/** Files that source the caller's identity from `users/{uid}.technicianId` -- a compatibility field
 *  on a collection whose Employee back-link (`users/{uid}.employeeId`) is the governed one. */
const USER_TECHNICIAN_ID_READERS = [
  "src/callerContext.ts",
  "src/cycleCount/cycleCountSheetCallables.ts",
  "src/inventoryTransfer/transferReceivableRead.ts",
];

/** Files that pass a value NAMED technicianId into readAssignedMobileLocation(), which queries
 *  `trucks.assignedDriverEmployeeId` -- i.e. that spend a technician id where an EMPLOYEE id is the
 *  declared authority (functions/src/truckRegistry/truckRegistryRepository.ts:211 queries the same
 *  field with an employeeId). In the live census 11 of 13 technician ids coincide with employee ids
 *  and 2 do not, which is exactly how this reads correctly almost always. */
const TECHNICIAN_ID_AS_DRIVER_EMPLOYEE_ID = [
  "src/cycleCount/cycleCountSheetCallables.ts",
  "src/inventoryTransfer/transferReceivableRead.ts",
  "src/workOrderConsumption/consumptionSourceService.ts",
  "src/workOrderConsumption/planPhysicalConsumption.ts",
];

function linesOf(file) {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"));
}

test("the users/{uid}.technicianId identity fallback exists in exactly the recorded files", () => {
  const found = sourceFiles("src")
    .filter((file) =>
      linesOf(file).some((line) => /(userSnap|userData|data\?)[^\n]*\.technicianId/.test(line)),
    )
    .sort();
  assert.deepEqual(
    found,
    [...USER_TECHNICIAN_ID_READERS].sort(),
    "a NEW users/{uid}.technicianId identity read appeared, or a recorded one was removed without " +
      "updating USER_TECHNICIAN_ID_READERS",
  );
});

test("a technician id is spent as trucks.assignedDriverEmployeeId in exactly the recorded files", () => {
  const found = sourceFiles("src")
    .filter((file) =>
      linesOf(file).some((line) => /readAssignedMobileLocation\([^)]*technician/i.test(line)),
    )
    .sort();
  assert.deepEqual(
    found,
    [...TECHNICIAN_ID_AS_DRIVER_EMPLOYEE_ID].sort(),
    "a NEW technician-id-as-employee-id truck lookup appeared, or a recorded one was removed " +
      "without updating TECHNICIAN_ID_AS_DRIVER_EMPLOYEE_ID",
  );
});

test("the linkage subsystem itself contains no technician fallback of any kind", () => {
  // The point of the new authority is that there IS no second source: nothing in src/employeeIdentity
  // ever READS a `technicianId` field off a document, or names the compatibility collection. The two
  // `technicianIdCoincid*` identifiers are OUTPUT evidence -- a count and a boolean the planner
  // emits so a reader can see the coincidence was noticed -- and no code path reads either back.
  for (const file of sourceFiles("src/employeeIdentity")) {
    const code = linesOf(file).join("\n");
    assert.ok(
      !/\.technicianId\b/.test(code),
      `${file} reads a .technicianId field -- the linkage has no technician fallback`,
    );
  }
  // `fieldops_technicians` DOES appear here, inside refusal messages, and that is the point: the
  // collection is named when explaining why something was refused, never dereferenced. That it is
  // not a collection reference is the separate fence above ("names no Firestore collection").
});

test("the link-source vocabulary is closed at two terms, neither of which is a technician id", () => {
  assert.deepEqual([...LINK_SOURCES], ["RECIPROCAL_FIREBASE_UID_LINK", "OPERATOR_ASSERTED"]);
  // The SQL CHECK is the enforcement; assert the migration and the module agree, because a
  // vocabulary that drifts between them is one the database will accept and the code will not.
  const migration = readFileSync("migrations/1758412800000_employee-principal-linkage.sql", "utf8");
  const check = migration.match(/link_source IN \(([^)]*)\)/);
  assert.ok(check, "the migration declares a closed link_source CHECK");
  const sqlTerms = [...check[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(sqlTerms, [...LINK_SOURCES].sort());
});
