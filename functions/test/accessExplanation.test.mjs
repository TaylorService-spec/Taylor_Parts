// WHY access exists -- and the guard that stops the explanation becoming a conflation.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  explainAccess, simulateAccess, businessAxisCitations,
  SECURITY_AXIS_REASONS, REFUSAL_REASONS, BUSINESS_AXIS_TERMS,
} from "../lib/adminPolicy/accessExplanation.js";

const KNOWN = new Set(["inventory.cycleCount.create", "customer.record.read", "workOrder.lifecycle.dispatch"]);
const base = (over = {}) => ({
  question: "may this Principal create a cycle count?",
  hasTenantMembership: true,
  qualifyingAssignments: [{
    assignmentId: "asg-1", roleId: "role-wm", roleKey: "warehouseManager",
    scopeType: "global", scopeValue: null,
  }],
  capabilitiesByRoleId: new Map([["role-wm", ["inventory.cycleCount.create"]]]),
  capabilityKey: "inventory.cycleCount.create",
  knownCapabilityKeys: KNOWN,
  hadStaleAssignment: false,
  ...over,
});

test("a grant is explained as the authority chain, in order", () => {
  const e = explainAccess(base());
  assert.equal(e.granted, true);
  assert.deepEqual(e.refusals, []);
  // Membership first, because every other reason presupposes it. A reader following the steps is
  // following the model.
  assert.deepEqual(e.steps.map((s) => s.reason),
    ["TENANT_MEMBERSHIP", "ROLE_ASSIGNMENT", "ROLE_CAPABILITY", "ASSIGNMENT_SCOPE"]);
  for (const s of e.steps) {
    assert.ok(SECURITY_AXIS_REASONS.includes(s.reason));
    assert.ok(s.detail.trim().length > 0, "a step with no detail explains nothing");
    assert.ok(s.evidenceId.trim().length > 0, "a step must name the record it rests on");
  }
});

test("a refusal says WHICH link of the chain failed, not merely 'denied'", () => {
  assert.deepEqual(explainAccess(base({ hasTenantMembership: false })).refusals, ["NO_TENANT_MEMBERSHIP"]);
  assert.deepEqual(explainAccess(base({ qualifyingAssignments: [] })).refusals, ["NO_QUALIFYING_ROLE_ASSIGNMENT"]);
  // A Role held that grants nothing here is a DIFFERENT answer from holding no Role at all, and an
  // administrator fixes them differently.
  assert.deepEqual(
    explainAccess(base({ capabilitiesByRoleId: new Map([["role-wm", ["customer.record.read"]]]) })).refusals,
    ["ROLE_GRANTS_NOTHING_HERE"]);
  // A stale assignment is not "no assignment": something WAS granted and the access version moved.
  assert.deepEqual(
    explainAccess(base({ qualifyingAssignments: [], hadStaleAssignment: true })).refusals,
    ["ASSIGNMENT_STALE"]);
  for (const r of REFUSAL_REASONS) assert.equal(typeof r, "string");
});

test("FAIL CLOSED: an unknown capability is not 'no Role grants it'", () => {
  // Nobody could grant it. Saying "denied" would send an administrator to edit Roles forever.
  const e = explainAccess(base({ capabilityKey: "not.a.capability" }));
  assert.equal(e.granted, false);
  assert.equal(e.failedClosed, true);
  assert.deepEqual(e.refusals, ["UNKNOWN_TO_THE_GOVERNED_VOCABULARY"]);
  assert.deepEqual(e.steps, [], "a fail-closed answer explains no chain, because there is none");
});

test("THE CONFLATION GUARD: no explanation may cite a business-axis fact", () => {
  // The two axes meet at exactly one point -- the Principal <-> Employee link -- and a reason is
  // never that point. A Job Role, a qualification or an operational scope appearing as a REASON is
  // the shape a conflation arrives in.
  const granted = explainAccess(base({
    businessContext: {
      employeeId: "e-1", employmentStatus: "ACTIVE", jobRoleKey: "SERVICE_TECHNICIAN_III",
      workEligibilityCodes: ["SERVICE_TECHNICIAN"],
      operationalScopes: [{ scopeType: "WAREHOUSE", scopeId: "wh-1" }],
    },
  }));
  assert.deepEqual(businessAxisCitations(granted), [],
    "a business-axis fact appeared as a REASON for access");
  // The context is still SHOWN -- an administrator needs it to understand the person.
  assert.equal(granted.businessContext.jobRoleKey, "SERVICE_TECHNICIAN_III");
  assert.deepEqual(granted.businessContext.workEligibilityCodes, ["SERVICE_TECHNICIAN"]);
});

test("the guard actually fires -- otherwise the assertion above proves nothing", () => {
  // Without this, "no citations" would pass even if the matcher were broken, because a correct
  // explanation has none by construction.
  const conflated = Object.freeze({
    question: "q", granted: true, refusals: [], businessContext: null, failedClosed: false,
    steps: [
      { reason: "ROLE_ASSIGNMENT", evidenceId: "asg-1", detail: "the Security Role admin is assigned" },
      { reason: "ROLE_CAPABILITY", evidenceId: "r:c", detail: "the Employee holds the SERVICE_TECHNICIAN work eligibility" },
      { reason: "ASSIGNMENT_SCOPE", evidenceId: "asg-1", detail: "their operational scope covers wh-1" },
    ],
  });
  const cited = businessAxisCitations(conflated);
  assert.equal(cited.length, 2, "the guard must catch both the qualification and the operational scope");
  assert.ok(BUSINESS_AXIS_TERMS.includes("work eligibility"));
  assert.ok(BUSINESS_AXIS_TERMS.includes("operational scope"));
  // And the legacy authorities that must never reappear as reasons.
  for (const term of ["users.role", "operationalroles", "firebase claim", "job role"]) {
    assert.ok(BUSINESS_AXIS_TERMS.includes(term), `${term} must be guarded against`);
  }
});

test("a Principal that is not a person is an ordinary state, not a missing Employee", () => {
  const e = explainAccess(base({ businessContext: null }));
  assert.equal(e.granted, true);
  assert.equal(e.businessContext, null, "a service Principal has no Employee, and that is not an error");
});

test("the simulator is the SAME function, so it cannot drift from the resolver", () => {
  const input = base({ question: "what if this Principal held partsManager?" });
  assert.deepEqual(simulateAccess(input), explainAccess(input));
  // A simulator that modelled access separately would eventually disagree, and the disagreement
  // would surface as an administrator confidently granting the wrong thing.
  const src = readFileSync(new URL("../src/adminPolicy/accessExplanation.js".replace(".js", ".ts"), import.meta.url), "utf8");
  assert.match(src, /export function simulateAccess[\s\S]{0,200}return explainAccess\(input\);/,
    "the simulator must delegate, never reimplement");
});

test("scope is explained, and a scoped grant says what it is scoped to", () => {
  const scoped = explainAccess(base({
    qualifyingAssignments: [{
      assignmentId: "asg-2", roleId: "role-wm", roleKey: "warehouseManager",
      scopeType: "location", scopeValue: "wh-main",
    }],
  }));
  const scopeStep = scoped.steps.find((s) => s.reason === "ASSIGNMENT_SCOPE");
  assert.match(scopeStep.detail, /scoped to location wh-main/);
  // An ASSIGNMENT scope is a Security-axis scope. It is NOT an Operational Scope, and the guard
  // confirms the wording never blurs the two.
  assert.deepEqual(businessAxisCitations(scoped), []);
});

test("the module decides nothing and reaches for nothing", () => {
  const src = readFileSync(new URL("../src/adminPolicy/accessExplanation.ts", import.meta.url), "utf8");
  for (const forbidden of ["firebase-admin", "pg", "process.env", "Date.now", "readFileSync"]) {
    assert.ok(!src.includes(`from "${forbidden}"`) && !src.includes(`require("${forbidden}")`),
      `the explanation must not reach for ${forbidden}`);
  }
});
