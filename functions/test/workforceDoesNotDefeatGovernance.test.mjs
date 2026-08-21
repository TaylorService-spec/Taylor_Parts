// THE FIXTURE MUST NOT REVERSE A GOVERNANCE DECISION.
//
// ============================ WHY THIS TEST EXISTS ============================
//
// Every authority guard in this repository asserts things about ROLES. None of them could see the
// defect this file was written for, because the defect was not in a role -- it was in a PERSON.
//
// The Owner decided on 2026-08-21 (General Manager, Option 2) that the highest BUSINESS role is not
// security administration: `generalManager` holds zero `admin.*` capabilities, and
// generalManagerNoAdmin.test.mjs enforces exactly that, correctly, and passed the whole time.
//
// The certification roster then gave both General Manager employees the legacy `admin` compatibility
// role. The server resolves the UNION of the legacy role and the governed grants, so each of them
// got all four `admin.*` ids straight back -- userStatus.write, roleAssignment.write,
// accessRequest.decide, credentialReset.initiate. The governed model said no, the fixture said yes,
// and the fixture won.
//
// A decision enforced on the Role and defeated on the person is not enforced. That is the whole
// claim of this file, and it is a DIFFERENT claim from any role-level guard -- which is why it could
// not be folded into one.
//
// SCOPE. This does not touch the compatibility roles. `admin`, `dispatcher` and `technician` keep
// every capability they have; the Owner ruled they are not to be reduced and they are not reduced
// here. What is constrained is which legacy role a synthetic EMPLOYEE is given.
import test from "node:test";
import assert from "node:assert/strict";
import { GOVERNED_BUSINESS_ROLES } from "../lib/access/governedBusinessRoles.js";
import { COMPATIBILITY_ROLES } from "../lib/access/compatibilityRoles.js";
import { buildWorkforce } from "../scripts/certificationWorld/data/workforce.mjs";

// Capability families a governed business Role may be DELIBERATELY denied, where a legacy role
// handing them back is a reversal rather than ordinary legacy breadth.
//
// Only `admin.*` for now, and deliberately so. Legacy roles carry plenty of operational capability a
// governed role lacks, and calling all of that a reversal would flag 976 holdings and mean nothing.
// What is different about `admin.*` is that a RECORDED DECISION says a named business role must not
// have it, so restoring it through the back door contradicts something specific.
const DECIDED_DENIALS = [
  {
    prefix: "admin.",
    roles: ["generalManager"],
    decision:
      "Owner decision 2026-08-21 (General Manager, Option 2): General Manager is the highest "
      + "BUSINESS-OPERATIONS role and is NOT security administration. No admin.roleAssignment.write, "
      + "no admin.* capability administration, no self-escalation, and Owner/Admin two-person "
      + "control over privilege is preserved.",
  },
];

const employees = buildWorkforce();

test("the workforce fixture is not empty, so these checks are not vacuous", () => {
  // A guard that passes because it examined nothing is the failure mode this repository has already
  // hit more than once. Assert the corpus before asserting anything about it.
  assert.ok(employees.length >= 30, `expected a staffed workforce, got ${employees.length}`);
  const withGoverned = employees.filter((e) => (e.certGovernedRoles || []).length > 0);
  assert.ok(withGoverned.length >= 15, "expected employees carrying governed roles");
});

for (const rule of DECIDED_DENIALS) {
  for (const roleId of rule.roles) {
    test(`no ${roleId} employee regains "${rule.prefix}*" through a legacy compatibility role`, () => {
      const governed = GOVERNED_BUSINESS_ROLES[roleId];
      assert.ok(governed, `${roleId} must exist`);

      // Precondition: the governed Role really is denied this family. If it ever legitimately gains
      // it, this test should be re-decided rather than silently continuing to pass.
      const governedHas = (governed.permissions || []).filter((c) => c.startsWith(rule.prefix));
      assert.deepEqual(
        governedHas, [],
        `${roleId} now holds ${rule.prefix}* directly. That is a governance change, not a fixture `
        + `question -- re-decide this entry rather than leaving it asserting a denial that ended.`,
      );

      const offenders = [];
      for (const e of employees) {
        if (!(e.certGovernedRoles || []).includes(roleId)) continue;
        const compat = COMPATIBILITY_ROLES[e.securityRole];
        const regained = (compat?.permissions || []).filter((c) => c.startsWith(rule.prefix));
        if (regained.length) {
          offenders.push(`${e.employeeId} (securityRole=${e.securityRole}) regains ${regained.join(", ")}`);
        }
      }
      assert.deepEqual(
        offenders, [],
        `A recorded governance decision is reversed at the employee level.\n\n`
        + `DECISION: ${rule.decision}\n\n`
        + `${offenders.join("\n")}\n\n`
        + `The server resolves the UNION of the legacy compatibility role and the governed grants, so `
        + `a person holding both has whatever either grants. Give the employee a legacy role that does `
        + `not carry ${rule.prefix}* -- do NOT reduce the compatibility role, which the Owner ruled `
        + `must stay unchanged.`,
      );
    });
  }
}

test("the decided-denial list cannot be quietly emptied", () => {
  // A guard whose data can be deleted is a guard that can be disabled without touching its logic.
  assert.ok(DECIDED_DENIALS.length >= 1, "recorded denials must not be removed to make a change pass");
  for (const r of DECIDED_DENIALS) {
    assert.ok(r.decision.length > 80, `${r.prefix} must carry the decision it rests on`);
    assert.ok(r.roles.length > 0, `${r.prefix} must name the roles it constrains`);
  }
});
