// THE POSITIVE / NEGATIVE EXECUTION CONTRACT, as assertions rather than prose.
//
// ============================ WHY THIS IS A TEST AND NOT A DOCUMENT ============================
//
// The execution plan states, for every workstream, what an authorized worker must be able to do and
// what a nearby unauthorized worker must be refused. A plan that says so in a table is a claim; the
// same plan encoded here is a claim that fails when it stops being true.
//
// The NEGATIVE half is the stronger evidence and it is the half that decays silently. "A parts
// associate can count" says very little. "Can count AND cannot reconcile" is the segregation of
// duties actually holding, and it stops holding the moment somebody grants one more Role to make a
// coverage number look better.
//
// GOVERNED AUTHORITY ONLY. Every assertion here reads the governed Roles alone and ignores the
// legacy compatibility Role. That is deliberate and it is the point: 67% of this workforce's
// operable authority comes from compatibility Roles that R-1 exists to retire, so a proof computed
// on the union would mostly be proving the legacy model works. What must be certified is that the
// GOVERNED model gives the right people the right authority and refuses everyone else.
//
// Consequence worth stating plainly: several POSITIVE proofs below are currently blocked by
// activation, not by grants. They are written as "holds the capability" rather than "resolves
// ALLOW", because the capability being inactive is a separate, recorded fact -- and asserting ALLOW
// today would fail for a reason that has nothing to do with whether the plan is correct.
import test from "node:test";
import assert from "node:assert/strict";
import { GOVERNED_BUSINESS_ROLES } from "../lib/access/governedBusinessRoles.js";
import { buildWorkforce } from "../scripts/certificationWorld/data/workforce.mjs";

const employees = buildWorkforce();
const byId = new Map(employees.map((e) => [e.employeeId, e]));

/** Governed authority only -- compatibility Roles deliberately excluded. See header. */
function governedCaps(employeeId) {
  const e = byId.get(employeeId);
  assert.ok(e, `${employeeId} must exist in the certification workforce`);
  return new Set((e.certGovernedRoles || []).flatMap((r) => GOVERNED_BUSINESS_ROLES[r]?.permissions || []));
}

// ─────────────────────────────── NEGATIVE PROOFS ───────────────────────────────
//
// Each row is a control that a plausible, well-meaning grant would defeat.
const MUST_BE_DENIED = [
  ["cw-emp-043", "inventory.stock.receive",
   "TRANSFER IS NOT RECEIVING. inventory.transfer.receive moves custody between internal locations; "
   + "inventory.stock.receive accepts goods INTO the company from outside. The transfer operator "
   + "must not acquire the second by holding the first."],
  ["cw-emp-046", "inventory.stock.receive",
   "BUYER IS NOT RECEIVER. A buyer who also accepts the goods they ordered closes the loop on their "
   + "own purchase with nobody else in it."],
  ["cw-emp-046", "reorder.request.approve",
   "RAISER IS NOT APPROVER. Whoever raises a purchase request must not approve it -- the matrix's "
   + "own segregation-of-duties principle applied to the Role that raises them."],
  ["cw-emp-046", "reorder.purchaseOrder.void",
   "void carries an isOwnAssignment Condition everywhere it is held; unconditioned here it would "
   + "exceed admin's own authority."],
  ["cw-emp-045", "inventory.placement.record",
   "BIN ADMINISTRATION IS NOT PUT-AWAY. The person defining where stock may live must not also be "
   + "the person filling those locations unobserved."],
  ["cw-emp-025", "inventory.cycleCount.reconcile",
   "A COUNTER MAY NOT APPROVE THEIR OWN VARIANCE (DECISIONS #111)."],
  ["cw-emp-023", "inventory.cycleCount.submit",
   "THE RECONCILER MAY NOT COUNT. The other direction of the same pair, and the one that is easy to "
   + "forget because it looks like a harmless convenience."],
  ["cw-emp-001", "admin.roleAssignment.write",
   "GENERAL MANAGER IS NOT SECURITY ADMINISTRATION (Owner decision 2026-08-21, Option 2). The "
   + "load-bearing negative: a business Role able to grant itself anything is not a business Role."],
  ["cw-emp-039", "admin.roleAssignment.write",
   "FINANCE OVERSIGHT IS NOT SECURITY ADMINISTRATION. Reading the audit trail confers no ability to "
   + "change who may do what."],
  ["cw-emp-030", "inventory.stock.receive",
   "A WAREHOUSE ASSOCIATE WITHOUT THE CLERK ROLE IS DENIED. Receiving is a named station, not a "
   + "property of working in a warehouse -- this is the whole reason it was not composed."],
  ["cw-emp-025", "inventory.stock.receive",
   "Same for a parts associate, and it additionally preserves the PARTS_ASSOCIATE receiving "
   + "deferral recorded in compatibilityRoles.ts."],
];

for (const [employeeId, capability, why] of MUST_BE_DENIED) {
  test(`NEGATIVE: ${employeeId} must not hold ${capability}`, () => {
    assert.equal(
      governedCaps(employeeId).has(capability), false,
      `${employeeId} holds ${capability} through its governed Roles.\n\n${why}`,
    );
  });
}

// ─────────────────────────────── POSITIVE PROOFS ───────────────────────────────
//
// Without these the negatives are satisfiable by granting nobody anything, which is the cheapest
// way to pass a security test and the least useful.
const MUST_HOLD = [
  ["cw-emp-044", "inventory.stock.receive", "the designated receiving clerk can receive"],
  ["cw-emp-045", "inventory.stock.receive", "the second receiving clerk provides redundancy"],
  ["cw-emp-043", "inventory.transfer.dispatch", "the transfer operator can dispatch a transfer"],
  ["cw-emp-044", "inventory.returns.intake", "the intake clerk can take a return"],
  ["cw-emp-045", "inventory.location.bin.manage", "the bin administrator can define a bin"],
  ["cw-emp-025", "inventory.cycleCount.submit", "the counter can submit a count"],
  ["cw-emp-023", "inventory.cycleCount.reconcile", "the reconciler can reconcile"],
  ["cw-emp-046", "reorder.purchaseOrder.create", "the purchasing backup can raise a PO"],
  ["cw-emp-001", "report.definition.read", "the General Manager can open a saved report"],
  ["cw-emp-041", "report.customer.field.paymentTerms.read", "finance can read commercial terms"],
  ["cw-emp-039", "audit.event.read", "accounting management can read audit history"],
];

for (const [employeeId, capability, why] of MUST_HOLD) {
  test(`POSITIVE: ${employeeId} holds ${capability} -- ${why}`, () => {
    assert.ok(
      governedCaps(employeeId).has(capability),
      `${employeeId} does NOT hold ${capability} through its governed Roles (${why}). Without this, `
      + `the matching negative proof is satisfied by an empty grant set and proves nothing.`,
    );
  });
}

// ─────────────────────────── THE TIER SEPARATION, PER PERSON ───────────────────────────

test("POSITIVE+NEGATIVE: reportViewer reads ordinary fields and is refused the finance-sensitive ones", () => {
  // The pair that justifies two read tiers instead of one. cw-emp-003 is an operationsManager
  // holding reportViewer and reportAuthor but NOT reportFinanceViewer.
  const ops = governedCaps("cw-emp-003");
  assert.ok(ops.has("report.customer.field.name.read"), "reportViewer must read ordinary fields");
  assert.equal(
    ops.has("report.customer.field.paymentTerms.read"), false,
    "an operationsManager with reportViewer must NOT read payment terms -- that is "
    + "reportFinanceViewer, and the separation is the reason the tiers exist",
  );
  assert.equal(
    ops.has("report.definition.delete"), false,
    "report.definition.delete stays Owner-only; authoring is delegable, destroying is not",
  );
});

test("POSITIVE+NEGATIVE: an unassigned employee resolves no reporting at all", () => {
  // A technician: no governed Role, and therefore no reporting. If reporting ever leaks to a
  // business title or a compatibility Role, this is where it shows up first.
  const tech = employees.find((e) => e.securityRole === "technician" && !(e.certGovernedRoles || []).length);
  assert.ok(tech, "expected an unassigned technician in the workforce");
  const caps = governedCaps(tech.employeeId);
  assert.deepEqual(
    [...caps].filter((c) => c.startsWith("report.")), [],
    `${tech.employeeId} resolves reporting capabilities from governed Roles without holding a reporting tier`,
  );
});

test("the proof corpus is not empty and covers both directions", () => {
  // A guard that passes by examining nothing is a failure mode this repository has hit before.
  assert.ok(MUST_BE_DENIED.length >= 10, "negative proofs must not be gutted to make a change pass");
  assert.ok(MUST_HOLD.length >= 10, "positive proofs must not be gutted");
  // Every employee named must actually exist, or the proof is vacuous.
  for (const [id] of [...MUST_BE_DENIED, ...MUST_HOLD]) {
    assert.ok(byId.has(id), `${id} named in the execution contract does not exist in the workforce`);
  }
});
