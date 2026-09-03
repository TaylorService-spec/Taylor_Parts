// CERT-FIN-02 -- the Financial Policy screen's view model, and the single-authority rule.
//
// These prove what the SCREEN says. They do not, and cannot, prove the lock: that is enforced by the
// trusted command (functions/test/financialPolicyProfileCommand.test.mjs) and the two are kept
// separate on purpose. A disabled control is a courtesy; a refused write is the protection.
//
// Run: node test/financialPolicyView.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildFinancialPolicyView,
  buildFinancialPolicySummary,
  INVENTORY_COST_METHODS,
  SERIALIZED_COST_METHODS,
  COGS_RECOGNITION_POINTS,
  PLATFORM_INVARIANTS,
  LOCKED_MESSAGE,
  VIEW_STATE,
} from "../src/domain/financialPolicyView.js";

let passed = 0;
let failed = 0;
function ok(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS -- ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL -- ${name}`);
    console.error(err);
  }
}

const PROFILE = Object.freeze({
  operatingCompanyId: "co-1",
  status: "DRAFT",
  inventoryCostMethod: "WEIGHTED_AVERAGE",
  serializedInventoryCostMethod: "SPECIFIC_IDENTIFICATION",
  cogsRecognitionPointId: "SALES_ORDER_FULFILLMENT",
  freightTreatment: "EXCLUDED",
  landedCostTreatment: "EXCLUDED",
  approval: null,
});

const APPROVAL = Object.freeze({
  approvedBy: "A. Accountant",
  approvedOn: "2026-09-03",
  reference: null,
  recordedByUid: "uid-1",
});

const ready = (over = {}) =>
  buildFinancialPolicyView({ canRead: true, canConfigure: true, profile: PROFILE, ...over });

// ============================ ONLY SUPPORTED METHODS APPEAR ============================

ok("only costing methods EOS implements are offered", () => {
  const view = ready();
  assert.deepEqual(view.inventoryCostMethods.map((m) => m.id), ["WEIGHTED_AVERAGE", "FIFO"]);
  assert.deepEqual(view.serializedCostMethods.map((m) => m.id).sort(), ["FIFO", "SPECIFIC_IDENTIFICATION", "WEIGHTED_AVERAGE"]);
});

ok("no unimplemented method is rendered as a choice", () => {
  const offered = [...INVENTORY_COST_METHODS, ...SERIALIZED_COST_METHODS].map((m) => m.id);
  for (const absent of ["LIFO", "STANDARD_COST", "REPLACEMENT_COST", "MOVING_AVERAGE", "LANDED_COST"]) {
    assert.equal(offered.includes(absent), false, `${absent} must not be selectable`);
  }
});

// ============================ INVARIANTS ARE NOT EDITABLE ============================

ok("platform invariants are statements, never options", () => {
  const view = ready();
  assert.equal(view.invariants.length, PLATFORM_INVARIANTS.length);
  for (const inv of view.invariants) {
    assert.equal(typeof inv.statement, "string");
    // An invariant must never appear as a selectable option on any of the choice lists.
    for (const list of [view.inventoryCostMethods, view.serializedCostMethods, view.cogsRecognitionPoints]) {
      assert.equal(list.some((o) => o.id === inv.id), false, `${inv.id} must not be an option`);
    }
  }
  assert.ok(view.invariants.some((i) => /never substitutes \$0/.test(i.statement)));
});

ok("unknown-cost treatment is not a configurable field of the policy", () => {
  const view = ready();
  assert.equal("unknownCostTreatment" in (view.policy ?? {}), false);
});

// ============================ RECOGNITION POINTS ============================

ok("an unavailable recognition point is SHOWN with its reason, never hidden", () => {
  // The RULE is unchanged; its example moved. WORK_ORDER_CONSUMPTION was the blocked point, and
  // Decision #171 lifted that block by making consumption actually remove physical stock -- so this
  // now asserts the rule against whatever is unavailable, and states the current fact when none is.
  //
  // Hiding an unavailable point would read as "EOS does not do that" rather than "not yet", which
  // is why every point is rendered either way.
  const view = ready();
  const unavailable = view.cogsRecognitionPoints.filter((p) => !p.available);
  for (const point of unavailable) {
    assert.ok(point.blockedReason, `${point.id} is unavailable and must say why`);
  }
  assert.deepEqual(unavailable, [], "none is blocked today -- consumption was the last");
});

ok("WORK_ORDER_CONSUMPTION is now shown as available, with no stale blocked reason", () => {
  // The mirror must not keep telling a technician the feature is off after it was turned on. The
  // backend parity test enforces the value; this one proves the SCREEN renders it.
  const view = ready();
  const point = view.cogsRecognitionPoints.find((p) => p.id === "WORK_ORDER_CONSUMPTION");
  assert.ok(point);
  assert.equal(point.available, true);
  assert.equal(point.blockedReason, null);
});

ok("physical movement never appears as a recognition point", () => {
  const ids = COGS_RECOGNITION_POINTS.map((p) => p.id);
  for (const physical of ["TRANSFER", "TRANSFER_OUT", "BIN_RELOCATION", "STAGING", "RECEIPT", "CYCLE_COUNT"]) {
    assert.equal(ids.includes(physical), false, `${physical} must never recognize COGS`);
  }
});

// ============================ LIFECYCLE RENDERING ============================

ok("an ungated viewer is told it is ungated -- not shown an empty policy", () => {
  const view = buildFinancialPolicyView({ canRead: false });
  assert.equal(view.state, VIEW_STATE.UNGATED);
  assert.equal(view.capability, "financialPolicy.profile.read");
  assert.equal(view.editable, false);
});

ok("a granted read with no profile is NOT_CONFIGURED -- distinguishable from a refused read", () => {
  const view = buildFinancialPolicyView({ canRead: true, canConfigure: true, profile: null });
  assert.equal(view.state, VIEW_STATE.READY);
  assert.equal(view.status, "NOT_CONFIGURED");
  assert.equal(view.policy, null, "no method is implied for a company that has not chosen one");
  assert.equal(view.editable, true, "a company still being configured is configurable");
});

ok("a draft profile is editable by a holder of the configure capability", () => {
  const view = ready();
  assert.equal(view.status, "DRAFT");
  assert.equal(view.locked, false);
  assert.equal(view.editable, true);
  assert.equal(view.lockedMessage, null);
});

ok("read without configure is view-only, and says why", () => {
  const view = ready({ canConfigure: false });
  assert.equal(view.editable, false);
  assert.match(view.readOnlyReason, /view this policy but not change it/);
});

// ============================ LOCKED ============================

ok("a locked policy is read-only, with the governed message and no unlock", () => {
  const view = ready({ profile: { ...PROFILE, status: "LOCKED", approval: APPROVAL } });
  assert.equal(view.locked, true);
  assert.equal(view.editable, false, "configure capability does not beat the lock");
  assert.equal(view.lockedMessage, LOCKED_MESSAGE);
  assert.match(view.lockedMessage, /requires a governed financial-policy migration/);
  // The view model exposes no affordance that could render an unlock control.
  const keys = Object.keys(view).join(" ").toLowerCase();
  for (const forbidden of ["unlock", "reopen", "override", "force"]) {
    assert.equal(keys.includes(forbidden), false, `the view must expose no "${forbidden}" affordance`);
  }
});

ok("LOCKED beats every capability, including a caller claiming both", () => {
  const view = buildFinancialPolicyView({
    canRead: true,
    canConfigure: true,
    profile: { ...PROFILE, status: "LOCKED", approval: APPROVAL },
  });
  assert.equal(view.editable, false, "admin must not silently bypass financial governance");
});

// ============================ APPROVAL ============================

ok("approval evidence is displayed when present and honestly absent when not", () => {
  assert.equal(ready().approval, null);
  const withApproval = ready({ profile: { ...PROFILE, status: "APPROVED", approval: APPROVAL } });
  assert.equal(withApproval.approval.approvedBy, "A. Accountant");
  assert.equal(withApproval.approval.reference, null, "a missing reference is null, not invented");
});

// ============================ FINANCIALS SUMMARY ============================

ok("the Financials summary is read-only rows, with no editing affordance", () => {
  const summary = buildFinancialPolicySummary(ready());
  assert.equal(summary.available, true);
  assert.deepEqual(summary.rows.map((r) => r.label), [
    "Inventory costing",
    "Serialized equipment",
    "COGS recognition",
    "Status",
  ]);
  const keys = Object.keys(summary).join(" ").toLowerCase();
  for (const forbidden of ["edit", "save", "configure", "unlock", "onchange"]) {
    assert.equal(keys.includes(forbidden), false, `the summary must expose no "${forbidden}"`);
  }
});

ok("the summary reports unavailability rather than inventing a policy", () => {
  const summary = buildFinancialPolicySummary(buildFinancialPolicyView({ canRead: false }));
  assert.equal(summary.available, false);
  assert.equal(summary.state, VIEW_STATE.UNGATED);
});

// ============================ SINGLE AUTHORITY ============================

const FINANCIALS_GOVERNANCE = readFileSync(
  new URL("../src/modules/financials/FinancialsGovernance.jsx", import.meta.url),
  "utf8",
);
const ADMIN_PAGE = readFileSync(
  new URL("../src/modules/administration/AdminFinancialPolicy.jsx", import.meta.url),
  "utf8",
);
const NAV_CONFIG = readFileSync(new URL("../src/navigation/navConfig.js", import.meta.url), "utf8");

ok("Financials links to the ONE authoritative surface and edits nothing", () => {
  assert.match(FINANCIALS_GOVERNANCE, /\/administration\/financial-policy/);
  assert.match(FINANCIALS_GOVERNANCE, /View Financial Policy/);
  // No form control in the accounting-policy section: it is rows and a link.
  const section = FINANCIALS_GOVERNANCE.slice(
    FINANCIALS_GOVERNANCE.indexOf('aria-label="Accounting policy"'),
    FINANCIALS_GOVERNANCE.indexOf('aria-label="Structure"'),
  );
  assert.ok(section.length > 0, "the accounting policy section must exist");
  for (const control of ["<select", "<input", "<button", "onSubmit", "onChange"]) {
    assert.equal(section.includes(control), false, `Financials must not carry a ${control} for policy`);
  }
});

ok("the Admin page is the only nav entry for financial policy", () => {
  const entries = [...NAV_CONFIG.matchAll(/key:\s*"financialPolicy"/g)];
  assert.equal(entries.length, 1, "exactly one nav slot may configure financial policy");
  assert.match(NAV_CONFIG, /key: "financialPolicy", label: "Financial Policy", path: "financial-policy"/);
  // And it lives under Administration, not Financials.
  const adminBlock = NAV_CONFIG.slice(NAV_CONFIG.indexOf('key: "administration"'));
  assert.match(adminBlock, /key: "financialPolicy"/);
  const financialsBlock = NAV_CONFIG.slice(
    NAV_CONFIG.indexOf('key: "financials"'),
    NAV_CONFIG.indexOf('key: "administration"'),
  );
  assert.equal(financialsBlock.includes('key: "financialPolicy"'), false, "Financials must not own this surface");
});

// Comments are stripped first: the file is REQUIRED to explain why there is no unlock, so scanning
// raw source would fail on its own documentation. What must not exist is a rendered control.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

ok("the Admin page renders no unlock control of any kind", () => {
  const code = stripComments(ADMIN_PAGE);
  for (const forbidden of [/unlock/i, /reopen/i, /\bforce\b/i, /override/i]) {
    assert.equal(forbidden.test(code), false, `the rendered page must contain no ${forbidden} affordance`);
  }
  // No interactive control at all on this screen today: it is a read surface until the configure
  // capability is granted and a write path is wired behind it.
  for (const control of ["<button", "onClick", "onSubmit"]) {
    assert.equal(code.includes(control), false, `the page must not render ${control} while it is read-only`);
  }
  // And the governed message must survive, in the rendered output rather than only in a comment.
  assert.match(code, /lockedMessage/);
});

ok("no customer is named anywhere in the policy surfaces", () => {
  for (const [name, src] of [["view model", ADMIN_PAGE], ["Financials", FINANCIALS_GOVERNANCE]]) {
    // Financials legitimately lists the operating companies elsewhere; the ACCOUNTING POLICY section
    // must not bind a method to one.
    const section =
      name === "Financials"
        ? src.slice(src.indexOf('aria-label="Accounting policy"'), src.indexOf('aria-label="Structure"'))
        : src;
    assert.equal(
      /taylor\s*(=|:|is)\s*weighted|ventana\s*(=|:|is)\s*(fifo|weighted)/i.test(section),
      false,
      `${name} must not hard-code a customer's method`,
    );
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
