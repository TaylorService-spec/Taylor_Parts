// EMPLOYEE-LEVEL EFFECTIVE AUTHORITY. A correct Role is not proof of a correct person.
//
// ============================ WHY THIS IS A SEPARATE FILE ============================
//
// Every other authority guard in this repository asserts something about a ROLE. All of them can be
// green while a person holds authority a decision forbids, because what the server actually resolves
// is the UNION of everything an employee carries:
//
//   business Role(s) ∪ functional Role(s) ∪ compatibility Role ∪ any direct grant
//
// That is not theoretical. On 2026-08-21 the capacity report found both General Manager employees
// holding all four `admin.*` capabilities. `generalManagerNoAdmin.test.mjs` was green throughout and
// entirely correct -- the governed `generalManager` Role holds zero `admin.*`. The roster gave those
// employees the legacy `admin` compatibility role, and the union handed everything back.
//
// A decision enforced on the Role and defeated on the person is not enforced.
//
// So governance certification produces TWO results, and this file is the second one:
//
//   ROLE_CONTRACT_RESULT              -- is the Role definition correct?
//   EMPLOYEE_EFFECTIVE_AUTHORITY_RESULT -- is the PERSON's resolved authority correct?
//
// SCOPE. Nothing here modifies or reduces a compatibility Role. `admin`, `dispatcher` and
// `technician` keep every capability they have, by Owner ruling. What is constrained is which
// combination a synthetic EMPLOYEE is given.
import test from "node:test";
import assert from "node:assert/strict";
import { GOVERNED_BUSINESS_ROLES } from "../lib/access/governedBusinessRoles.js";
import { COMPATIBILITY_ROLES } from "../lib/access/compatibilityRoles.js";
import { buildWorkforce } from "../scripts/certificationWorld/data/workforce.mjs";

const employees = buildWorkforce();

/** The union the server actually resolves for one employee. */
function effectiveAuthority(e) {
  const caps = new Set();
  for (const c of COMPATIBILITY_ROLES[e.securityRole]?.permissions || []) caps.add(c);
  for (const roleId of e.certGovernedRoles || []) {
    for (const c of GOVERNED_BUSINESS_ROLES[roleId]?.permissions || []) caps.add(c);
  }
  return caps;
}

test("the workforce is populated, so every check below examines something", () => {
  // A guard that passes by examining nothing is a failure mode this repository has hit more than
  // once. Assert the corpus before asserting anything about it.
  assert.ok(employees.length >= 30, `expected a staffed workforce, got ${employees.length}`);
  assert.ok(
    employees.filter((e) => (e.certGovernedRoles || []).length > 0).length >= 15,
    "expected employees carrying governed roles",
  );
});

// ─────────────────────────── 1. DECIDED DENIALS SURVIVE THE UNION ───────────────────────────
//
// Only `admin.*` is listed, deliberately. Legacy roles carry plenty of operational capability a
// governed role lacks; calling all of that a reversal would flag hundreds of holdings and mean
// nothing. What is different about `admin.*` is that a RECORDED DECISION names a business Role and
// says it must not have it.
const DECIDED_DENIALS = [
  {
    prefix: "admin.",
    roles: ["generalManager"],
    decision:
      "Owner decision 2026-08-21 (General Manager, Option 2): General Manager is the highest "
      + "BUSINESS-OPERATIONS role and is NOT security administration. No admin.roleAssignment.write, "
      + "no admin.* capability administration, no self-escalation. Owner/Admin two-person control "
      + "over privilege is preserved.",
  },
];

for (const rule of DECIDED_DENIALS) {
  for (const roleId of rule.roles) {
    test(`EMPLOYEE-LEVEL: no ${roleId} resolves "${rule.prefix}*" through any combination they carry`, () => {
      // Precondition: the governed Role really is denied this family. If it ever legitimately gains
      // it, this entry should be re-decided rather than continuing to assert a denial that ended.
      assert.deepEqual(
        (GOVERNED_BUSINESS_ROLES[roleId]?.permissions || []).filter((c) => c.startsWith(rule.prefix)),
        [],
        `${roleId} now holds ${rule.prefix}* directly -- that is a governance change, not a fixture question`,
      );

      const offenders = [];
      for (const e of employees) {
        if (!(e.certGovernedRoles || []).includes(roleId)) continue;
        const regained = [...effectiveAuthority(e)].filter((c) => c.startsWith(rule.prefix)).sort();
        if (regained.length) {
          offenders.push(`${e.employeeId} (securityRole=${e.securityRole}) resolves ${regained.join(", ")}`);
        }
      }
      assert.deepEqual(
        offenders, [],
        `A recorded governance decision is reversed at the employee level.\n\n`
        + `DECISION: ${rule.decision}\n\n${offenders.join("\n")}\n\n`
        + `The server resolves the UNION of the legacy compatibility role and the governed grants. `
        + `Give the employee a legacy role that does not carry ${rule.prefix}* -- do NOT reduce the `
        + `compatibility Role, which the Owner ruled must stay unchanged.`,
      );
    });
  }
}

// ─────────────────────────── 2. SoD SURVIVES THE UNION ───────────────────────────
//
// Role-level SoD guards assert that no ROLE DEFINITION bundles both sides. They cannot see an
// employee handed both Roles separately, which is the way this control would actually be defeated in
// practice -- nobody edits a role definition to break a control, they just grant one more Role.
const SOD_EXCLUSIVE_PAIRS = [
  ["inventoryCycleCountCounter", "inventoryCycleCountReconciler",
   "a counter may not approve their own material variance (DECISIONS #111)"],
  ["inventoryBinAdministrator", "inventoryPutAwayOperator",
   "the person defining where stock may live is not the person filling those locations unobserved"],
];

test("EMPLOYEE-LEVEL: no employee holds both sides of a segregation-of-duties pair", () => {
  const violations = [];
  for (const e of employees) {
    const held = new Set(e.certGovernedRoles || []);
    for (const [a, b, why] of SOD_EXCLUSIVE_PAIRS) {
      if (held.has(a) && held.has(b)) violations.push(`${e.employeeId} holds ${a} AND ${b} -- ${why}`);
    }
  }
  assert.deepEqual(violations, [], `Segregation of duties defeated at the employee level:\n${violations.join("\n")}`);
});

test("EMPLOYEE-LEVEL: both sides of every SoD pair are actually staffed, by different people", () => {
  // A pair is also defeated by being unstaffed on one side: if nobody can reconcile, counts are
  // approved by whoever can, or not at all. Asserting only "not both" would pass on an empty roster.
  for (const [a, b, why] of SOD_EXCLUSIVE_PAIRS) {
    const A = employees.filter((e) => (e.certGovernedRoles || []).includes(a)).map((e) => e.employeeId);
    const B = employees.filter((e) => (e.certGovernedRoles || []).includes(b)).map((e) => e.employeeId);
    assert.ok(A.length > 0, `nobody holds ${a} -- ${why}`);
    assert.ok(B.length > 0, `nobody holds ${b} -- ${why}`);
    assert.deepEqual(A.filter((id) => B.includes(id)), [], `${a} and ${b} share a person`);
  }
});

// ─────────────────────────── 3. THE COMPATIBILITY ROLE IS NOT A BACK DOOR ───────────────────────────

test("EMPLOYEE-LEVEL: receiving authority is never acquired by carrying a governed Role that lacks it", () => {
  // Receiving is a NAMED STATION by Owner decision 2026-08-21: inventoryReceivingClerk, assigned per
  // employee. The point was accountability, so the check that matters is that nobody GOVERNED-ONLY
  // acquires it by another route.
  //
  // Compatibility roles legitimately confer it today and are out of scope -- that legacy breadth is
  // recorded as the standing over-privilege it is, and is R-1's problem, not this guard's.
  const governedOnly = (e) => new Set((e.certGovernedRoles || [])
    .flatMap((r) => GOVERNED_BUSINESS_ROLES[r]?.permissions || []));
  for (const e of employees) {
    // owner composes the entire catalog by the 2026-08-19 ruling and legitimately resolves this.
    if ((e.certGovernedRoles || []).includes("owner")) continue;
    if (!governedOnly(e).has("inventory.stock.receive")) continue;
    assert.ok(
      (e.certGovernedRoles || []).includes("inventoryReceivingClerk"),
      `${e.employeeId} resolves inventory.stock.receive from governed Roles without holding `
      + `inventoryReceivingClerk. Receiving is a named station, not a side effect of a job title.`,
    );
  }
});

test("EMPLOYEE-LEVEL: a compatibility Role never makes a role-level governance test meaningless", () => {
  // The general form of the General Manager defect: for every employee carrying a governed business
  // Role, report any capability their governed Roles deny that their legacy Role supplies, and
  // require that none of them is a DECIDED denial. Operational breadth is expected and allowed;
  // reversing a recorded decision is not.
  const decidedPrefixes = DECIDED_DENIALS.map((d) => d.prefix);
  const reversals = [];
  for (const e of employees) {
    const governed = new Set((e.certGovernedRoles || [])
      .flatMap((r) => GOVERNED_BUSINESS_ROLES[r]?.permissions || []));
    const compat = COMPATIBILITY_ROLES[e.securityRole]?.permissions || [];
    if (!(e.certGovernedRoles || []).length) continue;
    if ((e.certGovernedRoles || []).includes("owner")) continue; // owner legitimately composes admin
    for (const c of compat) {
      if (governed.has(c)) continue;
      if (decidedPrefixes.some((p) => c.startsWith(p))) {
        reversals.push(`${e.employeeId} [${e.certGovernedRoles.join(",")}] gains ${c} from ${e.securityRole}`);
      }
    }
  }
  assert.deepEqual(reversals, [], `Legacy authority reverses a decided denial:\n${reversals.join("\n")}`);
});
