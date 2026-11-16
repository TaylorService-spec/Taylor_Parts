// SAE, offline -- the protected-Owner exemption from secondary approval (DECISIONS #SAE; Owner policy override 2026-10-20; briefs SAE2 + SAE3 Rule 1). No database: the real-database
// proof is saeProtectedOwnerExemptionPostgres.test.mjs. This file proves, with recording stand-ins, what the CODE decides:
//   * ONE seam decides who is exempt (access/secondaryApprovalExemption*): the protected Owner Role (key AND stored protected flag), an enabled Principal with an active membership,
//     exactly one active access-eligible Employee link. A role merely NAMED owner, the Administrator, a General Manager, a Finance Manager, an unlinked Owner, a relinked Employee
//     and a client-supplied flag are all NOT exempt (fail closed). A resolution is an object the seam issued, re-verified by every receiver.
//   * the seam's result is shaped for Rule 2: { exempt, basis: PROTECTED_OWNER | DELEGATED_EXEMPTION, scopeKey, grantSource }, and every two-person site declares its workflow scope in ONE map;
//     a site that is not in the map throws (never silently skipped), and a site mapped to null is never delegable.
//   * F-1b (decideInvoiceCorrection), FIN-007's buildApprovalRecord, G-1, P-1, cycle count, the Financial Policy and Administration route through it; non-Owners keep every refusal.
//   * a refusal writes nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const core = require("../lib/access/secondaryApprovalExemptionCore.js");
const seam = require("../lib/access/secondaryApprovalExemption.js");
const approvals = require("../lib/finance/financialApprovals.js");
const corr = require("../lib/eosFinance/invoiceCorrection.js");
const cycleRepo = require("../lib/eosOps/cycleCountRepository.js");
const fp = require("../lib/eosFinance/financialPolicy.js");

const T = "t-sae";
const OWNER = { key: "owner", protected: true };
const facts = (over = {}) => ({ principalEnabled: true, membershipActive: true, heldRoles: [OWNER], employeeLinks: [{ employeeId: "e-own", employmentStatus: "ACTIVE" }], ...over });
const failure = async (p) => { try { await p; } catch (e) { return e; } return null; };
const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

// ════════════════════ the seam ════════════════════

test("SEAM: the governed protected Owner is exempt; the result carries basis, scope, provenance and the Employee", () => {
  const r = core.decideSecondaryApprovalExemption(T, "p-own", "finance.invoiceCorrection", facts());
  assert.equal(r.exempt, true);
  assert.deepEqual([r.basis, r.scopeKey, r.grantSource, r.employeeId, r.principalId, r.tenantId, r.site],
    ["PROTECTED_OWNER", "FINANCIALS", "PROTECTED_OWNER_MEMBERSHIP", "e-own", "p-own", T, "finance.invoiceCorrection"]);
  assert.ok(Object.isFrozen(r));
  const contractor = core.decideSecondaryApprovalExemption(T, "p-own", "inventory.cycleCount", facts({ employeeLinks: [{ employeeId: "e-own", employmentStatus: "CONTRACTOR" }] }));
  assert.equal(contractor.exempt, true, "an access-eligible Employee is ACTIVE or CONTRACTOR");
});

test("SEAM: NOBODY ELSE is exempt -- Administrator, General Manager, Finance Manager, Parts Manager, a role merely NAMED owner, no link, two links, an ineligible Employee, a disabled Principal, no membership, no facts", () => {
  const site = "finance.invoiceCorrection";
  const no = (label, f) => assert.deepEqual(core.decideSecondaryApprovalExemption(T, "p-x", site, f), { exempt: false }, label);
  for (const key of ["admin", "generalManager", "financeManager", "partsManager", "controller", "accountingManager"]) no(key, facts({ heldRoles: [{ key, protected: key === "admin" }] }));
  no("a role named owner that is NOT the protected flag", facts({ heldRoles: [{ key: "owner", protected: false }] }));
  no("a role named owner with no stored flag", facts({ heldRoles: [{ key: "owner" }] }));
  no("a protected role under another key", facts({ heldRoles: [{ key: "ownerShadow", protected: true }] }));
  no("an Owner with no Employee link", facts({ employeeLinks: [] }));
  no("an Owner with two active links (corrupted state)", facts({ employeeLinks: [{ employeeId: "e1", employmentStatus: "ACTIVE" }, { employeeId: "e2", employmentStatus: "ACTIVE" }] }));
  for (const status of ["TERMINATED", "INACTIVE", "ON_LEAVE", "RETIRED", null, "SOMETHING_NEW"]) no(`Employee ${status}`, facts({ employeeLinks: [{ employeeId: "e1", employmentStatus: status }] }));
  no("a disabled Principal", facts({ principalEnabled: false }));
  no("an ended membership", facts({ membershipActive: false }));
  no("no facts", null);
  no("no roles", facts({ heldRoles: [] }));
  assert.deepEqual(core.decideSecondaryApprovalExemption("", "p-x", site, facts()), { exempt: false });
  assert.deepEqual(core.decideSecondaryApprovalExemption(T, "", site, facts()), { exempt: false });
});

test("SEAM: a resolution is an object the seam ISSUED; a boolean, a copy, a client flag or another Principal's resolution is never accepted", () => {
  const r = core.decideSecondaryApprovalExemption(T, "p-own", "goals.performanceGoal", facts());
  assert.equal(core.isIssuedExemption(r, "p-own", T), true);
  assert.equal(core.isIssuedExemption(r, "p-other"), false, "another Principal");
  assert.equal(core.isIssuedExemption(r, "p-own", "t-other"), false, "another tenant");
  for (const forged of [true, { exempt: true }, { ...r }, JSON.parse(JSON.stringify(r)), Object.freeze({ exempt: true, basis: "PROTECTED_OWNER", tenantId: T, principalId: "p-own", employeeId: "e-own", site: "goals.performanceGoal", scopeKey: "GOALS", grantSource: "x" }), "PROTECTED_OWNER", 1, null, undefined]) {
    assert.equal(core.isIssuedExemption(forged, "p-own", T), false, JSON.stringify(forged));
    assert.equal(core.exemptionRecord(forged, "p-own", T), null);
  }
  assert.equal(core.exemptionRecord(r, "p-own", T, "goals.performanceGoal").approvalBasis, "PROTECTED_OWNER");
  assert.equal(core.exemptionRecord(r, "p-own", T, "finance.invoiceCorrection"), null, "an exemption resolved for one site never admits another");
});

test("SCOPE MAP: every site declares its workflow scope once; an undeclared site throws; there is NO Administration site (D1: identity and administration guards are not exempted)", () => {
  assert.deepEqual({ ...core.SELF_APPROVAL_SITES }, {
    "finance.invoiceCorrection": "FINANCIALS", "finance.policy": "FINANCIALS", "goals.performanceGoal": "GOALS",
    "purchasing.supplierPurchaseOrder": "PURCHASING", "inventory.cycleCount": "INVENTORY",
  });
  assert.deepEqual([...core.SELF_APPROVAL_SCOPES], ["FINANCIALS", "PURCHASING", "SALES", "INVENTORY", "SERVICE", "GOALS"]);
  assert.throws(() => core.decideSecondaryApprovalExemption(T, "p", "sales.discount", facts()), /declares no workflow scope/);
  assert.throws(() => core.scopeOfSite("__proto__"), /declares no workflow scope/);
  assert.throws(() => core.scopeOfSite("admin.selfAdministration"), /declares no workflow scope/, "Administration has no exemption site");
  // Every site named in the source is in the map (so a new two-person rule cannot silently skip the seam).
  const named = new Set();
  for (const f of walk(join(ROOT, "src")).filter((p) => p.endsWith(".ts"))) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:resolveSecondaryApprovalExemption)\([^)]*?"([a-z]+\.[A-Za-z]+)"/g)) named.add(m[1]);
    for (const m of src.matchAll(/_APPROVAL_SITE = "([a-z]+\.[A-Za-z]+)" as const/g)) named.add(m[1]);
  }
  for (const s of named) assert.ok(Object.prototype.hasOwnProperty.call(core.SELF_APPROVAL_SITES, s), `${s} is declared in SELF_APPROVAL_SITES`);
  assert.ok(named.size >= 5, `the five workflow sites are named in the source (found ${[...named].join(", ")})`);
});

test("SEAM (Rule 2 shape): a delegated exemption admits only its scope; the all-workflows key admits every delegable site; a non-delegable site and the unflagged are never admitted; the Owner stays PROTECTED_OWNER", () => {
  const delegated = (scopeKey) => facts({ heldRoles: [{ key: "financeManager", protected: false }], delegated: [{ scopeKey, source: "role:financeManager" }] });
  const at = (site, f) => core.decideSecondaryApprovalExemption(T, "p-d", site, f);
  assert.deepEqual([at("finance.invoiceCorrection", delegated("FINANCIALS")).basis, at("finance.invoiceCorrection", delegated("FINANCIALS")).grantSource], ["DELEGATED_EXEMPTION", "role:financeManager"]);
  assert.equal(at("purchasing.supplierPurchaseOrder", delegated("FINANCIALS")).exempt, false, "a Finance-only grantee cannot self-approve a Purchasing action");
  assert.equal(at("goals.performanceGoal", delegated("ALL")).exempt, true);
  assert.equal(at("inventory.cycleCount", delegated("ALL")).scopeKey, "INVENTORY");
  assert.equal(at("finance.policy", facts({ heldRoles: [], delegated: undefined })).exempt, false);
  assert.equal(at("finance.policy", facts({ heldRoles: [], employeeLinks: [], delegated: [{ scopeKey: "ALL", source: "x" }] })).exempt, false, "a grant without an Employee is nothing");
  assert.equal(at("finance.invoiceCorrection", facts({ delegated: [{ scopeKey: "FINANCIALS", source: "x" }] })).basis, "PROTECTED_OWNER", "the Owner is resolved first");
});

// ════════════════════ FIN-007's record builder ════════════════════

test("buildApprovalRecord: self-approval is refused for everyone but a VERIFIED exemption; the record then carries approvalBasis and provenance; a different approver's record has none", () => {
  const input = { actionType: "PLAN_APPROVAL", targetRecordId: "g1", amountMinor: null, requestedByUid: "p-own", decidedByUid: "p-own", decision: "APPROVED", reason: "ok", decidedAtMillis: 1, tenantId: T, site: "goals.performanceGoal" };
  const refuse = (extra) => { try { approvals.buildApprovalRecord({ ...input, ...extra }); } catch (e) { return e.code; } return null; };
  assert.equal(refuse({}), "SELF_APPROVAL_FORBIDDEN");
  for (const forged of [true, "PROTECTED_OWNER", { exempt: true, basis: "PROTECTED_OWNER" }, { exempt: false }]) assert.equal(refuse({ exemption: forged }), "SELF_APPROVAL_FORBIDDEN", JSON.stringify(forged));
  const mine = core.decideSecondaryApprovalExemption(T, "p-own", "goals.performanceGoal", facts());
  const other = core.decideSecondaryApprovalExemption(T, "p-other", "goals.performanceGoal", facts());
  assert.equal(refuse({ exemption: other }), "SELF_APPROVAL_FORBIDDEN", "another Principal's resolution");
  const rec = approvals.buildApprovalRecord({ ...input, exemption: mine });
  assert.deepEqual([rec.approvalBasis, rec.approvalScope, rec.approvalGrantSource, rec.decision], ["PROTECTED_OWNER", "GOALS", "PROTECTED_OWNER_MEMBERSHIP", "APPROVED"]);
  assert.equal("exemption" in rec, false, "the resolution object itself is not stored");
  // an ordinary two-person record is exactly as before: no basis keys at all
  const two = approvals.buildApprovalRecord({ ...input, decidedByUid: "p-else", exemption: mine });
  assert.equal("approvalBasis" in two, false);
  // every other validation still applies to the exempt: the reason is mandatory
  assert.equal(refuse({ exemption: mine, reason: "  " }), "REASON_REQUIRED");
});

// ════════════════════ F-1b ════════════════════

const CORR = (over = {}) => ({
  id: "icr1", tenant_id: T, operating_company_id: "taylor", invoice_id: "inv1", obligation_id: "obl1", invoice_number: "INV-2026-000001", kind: "CREDIT_MEMO", amount_minor: "100",
  currency: "USD", reason: "pricing error", status: "PENDING", settlement_id: null, application_id: null, requested_by: "p-own", requested_by_employee_id: "e-own",
  requested_at: "2026-10-20T10:00:00Z", decided_by: null, decided_by_employee_id: null, decided_at: null, decision_reason: null, decision_idempotency_key: null,
  decision_fingerprint: null, fact_id: null, refund_settlement_id: null, approval_basis: null, approval_scope: null, approval_grant_source: null, ...over,
});
/** A recording stand-in with params: rules are [regex over the whitespace-normalised SQL, (params) => result]; anything else fails the test. */
function pool(rules) {
  const log = [];
  const query = async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, " ").trim();
    log.push({ s, params });
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(s)) return { rows: [], rowCount: 0 };
    for (const [re, fn] of rules) if (re.test(s)) return fn(params, s);
    throw new Error(`UNEXPECTED SQL: ${s.slice(0, 160)}`);
  };
  return { log, query, connect: async () => ({ query, release() {} }) };
}
const writes = (p) => p.log.filter((x) => /^(INSERT|UPDATE|DELETE)/i.test(x.s));
/** The rules decideInvoiceCorrection needs. `roles` = what the seam's Owner query returns; `employees` = Principal -> Employee link; `status` the Employee's employment status. */
const decideRules = ({ row = CORR(), roles = [], delegated = [], employees = { "p-own": "e-own", "p-app": "e-app" }, status = "ACTIVE", current = {} } = {}) => [
  [/FROM eos_finance\.invoice_corrections WHERE tenant_id = \$1 AND id = \$2 FOR UPDATE/, () => ({ rows: [row] })],
  [/FROM eos_finance\.invoice_corrections WHERE tenant_id = \$1 AND decided_by = \$2 AND decision_idempotency_key = \$3/, () => ({ rows: [] })],
  [/SELECT r\.key, r\.protected FROM eos_policy\.user_role_assignments/, () => ({ rows: roles })],
  // Rule 2: the delegated exemption grants in force (key + source). Asked only of a Principal who is not the protected Owner.
  [/SELECT c\.key, 'role:' \|\| r\.key \|\| ':' \|\| c\.key AS source/, () => ({ rows: delegated })],
  [/SELECT l\.employee_id, e\.employment_status::text AS employment_status FROM eos_policy\.employee_principal_links l/, (p) => (employees[p[1]] ? { rows: [{ employee_id: employees[p[1]], employment_status: status }] } : { rows: [] })],
  [/SELECT employee_id FROM eos_policy\.employee_principal_links WHERE tenant_id = \$1 AND principal_id = \$2 AND status = 'active'/, (p) => ({ rows: (current[p[1]] ?? []).map((e) => ({ employee_id: e })) })],
  [/UPDATE eos_finance\.invoice_corrections SET status = \$3/, () => ({ rows: [], rowCount: 1 })],
  [/FROM eos_finance\.invoice_corrections c JOIN eos_finance\.invoices i/, () => ({ rows: [{ ...row }] })],
  [/INSERT INTO eos_policy\.audit_events/, () => ({ rows: [], rowCount: 1 })],
];
const decide = (p, actor, input = {}) => corr.decideInvoiceCorrection(p, actor, { correctionId: "icr1", decision: "REJECT", reason: "checked", idempotencyKey: "k-1", ...input });

test("F-1b: the protected Owner decides their OWN correction -- the decision row records approval_basis + provenance and the audit row says so; every other validation still ran first", async () => {
  const p = pool(decideRules({ roles: [OWNER] }));
  const out = await decide(p, { tenantId: T, principalId: "p-own" });
  assert.equal(out.outcome, "rejected");
  const w = writes(p);
  assert.equal(w.length, 2, "the decision and ONE audit row");
  const update = w[0].params;
  assert.deepEqual([update[3], update[4], update[8], update[9], update[10]], ["p-own", "e-own", "PROTECTED_OWNER", "FINANCIALS", "PROTECTED_OWNER_MEMBERSHIP"]);
  const audit = JSON.parse(w[1].params[7]);
  assert.deepEqual([audit.approvalBasis, audit.approvalScope, audit.approvalGrantSource, audit.decidedBy, audit.requestedBy], ["PROTECTED_OWNER", "FINANCIALS", "PROTECTED_OWNER_MEMBERSHIP", "p-own", "p-own"]);
  // an ordinary two-person decision records no basis
  const two = pool(decideRules({ roles: [] }));
  await decide(two, { tenantId: T, principalId: "p-app" });
  assert.deepEqual(writes(two)[0].params.slice(8), [null, null, null]);
});

test("F-1b: an APPROVE by the Owner passes the people rule and goes on to the ordinary eligibility checks (state, balance, company): the exemption removes ONLY the second person", async () => {
  const p = pool(decideRules({ roles: [OWNER] }));
  const e = await failure(decide(p, { tenantId: T, principalId: "p-own" }, { decision: "APPROVE", amountMinor: 100 }));
  assert.match(e?.message ?? "", /UNEXPECTED SQL: SELECT i\.id/, "the next statement is the eligibility read -- the people rule passed, nothing was written");
  assert.deepEqual(writes(p), []);
  const wrong = pool(decideRules({ roles: [OWNER] }));
  assert.equal((await failure(decide(wrong, { tenantId: T, principalId: "p-own" }, { decision: "APPROVE", amountMinor: 150 })))?.code, "APPROVAL_AMOUNT_MISMATCH", "approving 150 is not approving 100, for the Owner too");
  const noReason = await failure(decide(pool(decideRules({ roles: [OWNER] })), { tenantId: T, principalId: "p-own" }, { reason: " " }));
  assert.equal(noReason?.code, "REASON_REQUIRED", "the reason stays mandatory");
});

test("F-1b: everyone else is refused with zero writes -- Administrator, Finance Manager, a role merely named owner, an Owner with no / an ineligible Employee, a relinked Employee, a second Principal on the Owner's Employee", async () => {
  const cases = [
    ["a non-Owner requester deciding their own", { roles: [] }, "p-own"],
    ["the Administrator (protected, key admin)", { roles: [{ key: "admin", protected: true }] }, "p-own"],
    ["a Finance Manager", { roles: [{ key: "financeManager", protected: false }] }, "p-own"],
    ["a role merely NAMED owner (not the protected flag)", { roles: [{ key: "owner", protected: false }] }, "p-own"],
    ["an Owner whose Employee is not access-eligible", { roles: [OWNER], status: "TERMINATED" }, "p-own"],
    ["a second Principal on the requester's Employee (relink), not an Owner", { roles: [], employees: { "p-app": "e-own" } }, "p-app"],
    ["the requester's CURRENT Employee reached by another Principal, not an Owner", { roles: [], employees: { "p-app": "e-new" }, current: { "p-own": ["e-new"] } }, "p-app"],
  ];
  for (const [label, setup, who] of cases) {
    const p = pool(decideRules(setup));
    const e = await failure(decide(p, { tenantId: T, principalId: who }));
    assert.equal(e?.code, "SELF_APPROVAL_FORBIDDEN", label);
    assert.deepEqual(writes(p), [], `${label}: zero writes`);
  }
  // an Owner with NO Employee link cannot be resolved: not exempt (same-Principal case refuses)
  const none = pool(decideRules({ roles: [OWNER], employees: { "p-app": "e-app" } }));
  assert.equal((await failure(decide(none, { tenantId: T, principalId: "p-own" })))?.code, "SELF_APPROVAL_FORBIDDEN");
  assert.deepEqual(writes(none), []);
});

test("F-1b: no client-supplied flag, role string or exemption object is accepted; the exemption is never an input", async () => {
  for (const extra of [{ isOwner: true }, { owner: true }, { role: "owner" }, { exempt: true }, { approvalBasis: "PROTECTED_OWNER" }, { exemption: { exempt: true } }, { skipApproval: true }]) {
    const p = pool(decideRules({ roles: [] }));
    const e = await failure(decide(p, { tenantId: T, principalId: "p-own" }, extra));
    assert.equal(e?.code, "FIELD_NOT_ACCEPTED", JSON.stringify(extra));
    assert.deepEqual(p.log.filter((x) => !/^(BEGIN|COMMIT|ROLLBACK)/.test(x.s)), [], "refused before any statement");
  }
  const src = readFileSync(join(ROOT, "src/eosFinance/invoiceCorrection.ts"), "utf8");
  assert.doesNotMatch(src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, ""), /isOwner|"owner"|'owner'|roleKey|heldRoleKeys/, "no ad hoc Owner check in the command: only the seam decides");
  assert.match(src, /resolveSecondaryApprovalExemption\(c, actor\.tenantId, actor\.principalId, CORRECTION_APPROVAL_SITE\)/);
});

test("F-1b: WITHDRAW and the non-Owner two-person rule are unchanged (a separate Employee still passes, the requester withdraws, others reject)", async () => {
  const p = pool(decideRules({ roles: [] }));
  await decide(p, { tenantId: T, principalId: "p-app" });
  assert.equal(writes(p).length, 2);
  const w = pool(decideRules({ roles: [] }));
  const e = await failure(decide(w, { tenantId: T, principalId: "p-app" }, { decision: "WITHDRAW" }));
  assert.equal(e?.code, "WITHDRAW_BY_REQUESTER_ONLY");
  const own = pool(decideRules({ roles: [] }));
  await decide(own, { tenantId: T, principalId: "p-own" }, { decision: "WITHDRAW" });
  assert.equal(writes(own)[0].params[8], null, "a withdrawal carries no approval basis");
});

// ════════════════════ the other enforcement sites ════════════════════

test("CYCLE COUNT: the repository refuses a counter reconciling their own variance unless handed the seam's verified resolution for THAT actor", async () => {
  const src = readFileSync(join(ROOT, "src/eosOps/cycleCountRepository.ts"), "utf8");
  assert.match(src, /exemptionRecord\(exemption, actorId, tenantId, "inventory\.cycleCount"\) === null/);
  const ops = readFileSync(join(ROOT, "src/eosOps/cycleCountOperations.ts"), "utf8");
  assert.match(ops, /resolveSecondaryApprovalExemption\(db, actor\.tenantId, actor\.principalId, CYCLE_COUNT_APPROVAL_SITE\)/);
  assert.match(ops, /approvalBasis: exemption\.approvalBasis/, "the reconcile audit row records the basis");
  assert.equal(typeof cycleRepo.reconcileLineInTransaction, "function");
  // BEHAVIOUR: a line the actor counted, with a variance. No resolution: the self-approval error. The seam's verified resolution for THAT actor: past the check (the stand-in stops at the next read).
  const lineRow = { id: "l1", sheet_id: "s1", part_id: "pt1", tracking_mode: "NONE", status: "COUNTED", expected_quantity: 5, expected_serial_numbers: [], counted_quantity: 7, counted_serial_numbers: [], variance: 2, submitted_by: "p-own", review_decision: null, ledger_movement_id: null };
  const db = { query: async (sql) => { if (/FROM eos_ops.cycle_count_lines/.test(String(sql))) return { rows: [lineRow] }; throw new Error("STOP_AFTER_SELF_CHECK"); } };
  const refused = await failure(cycleRepo.reconcileLineInTransaction(db, T, "p-own", "l1", "APPROVE", "r"));
  assert.equal(refused?.constructor?.name, "CycleCountSelfApprovalError");
  const mine = core.decideSecondaryApprovalExemption(T, "p-own", "inventory.cycleCount", facts());
  assert.equal((await failure(cycleRepo.reconcileLineInTransaction(db, T, "p-own", "l1", "APPROVE", "r", mine)))?.message, "STOP_AFTER_SELF_CHECK");
  for (const forged of [true, { exempt: true }, core.decideSecondaryApprovalExemption(T, "p-other", "inventory.cycleCount", facts()), core.decideSecondaryApprovalExemption(T, "p-own", "goals.performanceGoal", facts())]) {
    assert.equal((await failure(cycleRepo.reconcileLineInTransaction(db, T, "p-own", "l1", "APPROVE", "r", forged)))?.constructor?.name, "CycleCountSelfApprovalError", JSON.stringify(forged));
  }
  // another person reconciling is unaffected
  assert.equal((await failure(cycleRepo.reconcileLineInTransaction(db, T, "p-else", "l1", "APPROVE", "r")))?.message, "STOP_AFTER_SELF_CHECK");
});

test("P-1, G-1 and FINANCIAL POLICY call the seam with their declared site; none keeps its own Owner test", () => {
  const read = (f) => readFileSync(join(ROOT, "src", f), "utf8");
  assert.match(read("eosOps/supplierPurchaseOrderAuthoring.ts"), /resolveSecondaryApprovalExemption\(c, actor\.tenantId, actor\.principalId, PO_APPROVAL_SITE\)/);
  assert.match(read("eosOps/performanceGoalAuthoring.ts"), /resolveSecondaryApprovalExemption\(ctx\.db, ctx\.actor\.tenantId, ctx\.actor\.principalId, GOAL_APPROVAL_SITE\)/);
  assert.match(read("eosOps/performanceGoalAuthoring.ts"), /exemption: exemptionOut\.resolution/, "FIN-007's record builder receives the verified resolution");
  assert.match(read("eosFinance/financialPolicy.ts"), /resolveSecondaryApprovalExemption\(db, actor\.tenantId, actor\.principalId, FINANCIAL_POLICY_APPROVAL_SITE\)/);
  for (const f of ["eosOps/supplierPurchaseOrderAuthoring.ts", "eosOps/performanceGoalAuthoring.ts", "eosOps/cycleCountOperations.ts", "eosFinance/financialPolicy.ts"]) {
    const code = read(f).replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(code, /isProtectedOwnerRole|=== ?"owner"|includes\("owner"\)|PROTECTED_OWNER_ROLE_KEY/, `${f}: no Owner test of its own`);
  }
  assert.equal(fp.FINANCIAL_POLICY_APPROVAL_SITE, "finance.policy");
  assert.deepEqual(fp.independentDeciderRefusal("p-1", { submittedBy: "p-1", contentAuthors: ["p-1"] }), "SEPARATION_OF_DUTIES", "the pure rule is unchanged: only the seam admits the Owner");
  assert.equal(fp.independentDeciderRefusal("p-2", { submittedBy: "p-1", contentAuthors: ["p-1"] }), null);
});

test("D1 (Owner ruling, PR #2190 integrity guards): Administration is untouched -- no waiver of SELF_ADMINISTRATION or PRIVILEGE_ESCALATION and no use of the seam in the commands or the API", () => {
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  for (const f of ["adminPolicy/policyCommands.ts", "adminPolicy/adminPolicyApi.ts", "eosAuth/eosLoginService.ts"]) {
    assert.doesNotMatch(strip(readFileSync(join(ROOT, "src", f), "utf8")), /secondaryApprovalExemption|ownerAdministration|waiver|Waiver|exemptionRecord/, f);
  }
  const code = readFileSync(join(ROOT, "src/adminPolicy/policyCommands.ts"), "utf8");
  assert.match(code, /throw new AdministrationRefusal\("SELF_ADMINISTRATION", "a principal may not assign a Role to itself"\)/, "the self-assignment refusal is unconditional");
  assert.match(code, /throw new AdministrationRefusal\("PRIVILEGE_ESCALATION",/, "PRIVILEGE_ESCALATION applies to the Owner exactly as before");
  assert.throws(() => readFileSync(join(ROOT, "src/adminPolicy/ownerAdministrationExemption.ts")), /ENOENT/, "the Administration adapter is gone");
});

test("M1: buildApprovalRecord honours an exemption only for the SAME tenant and SITE it was issued for", () => {
  const input = { actionType: "PLAN_APPROVAL", targetRecordId: "g1", amountMinor: null, requestedByUid: "p-own", decidedByUid: "p-own", decision: "APPROVED", reason: "ok", decidedAtMillis: 1 };
  const code = (extra) => { try { approvals.buildApprovalRecord({ ...input, ...extra }); return null; } catch (e) { return e.code; } };
  const goals = core.decideSecondaryApprovalExemption(T, "p-own", "goals.performanceGoal", facts());
  assert.equal(code({ exemption: goals, tenantId: T, site: "goals.performanceGoal" }), null);
  assert.equal(code({ exemption: goals, tenantId: "t-other", site: "goals.performanceGoal" }), "SELF_APPROVAL_FORBIDDEN", "a resolution issued for another tenant");
  assert.equal(code({ exemption: goals, tenantId: T, site: "finance.invoiceCorrection" }), "SELF_APPROVAL_FORBIDDEN", "a resolution issued for another site");
  assert.equal(code({ exemption: goals }), "SELF_APPROVAL_FORBIDDEN", "an exemption without the tenant and site it is claimed for is never honoured");
  const rec = approvals.buildApprovalRecord({ ...input, exemption: goals, tenantId: T, site: "goals.performanceGoal" });
  assert.equal(rec.approvalBasis, "PROTECTED_OWNER");
  assert.equal("tenantId" in rec || "site" in rec, false);
});

test("the DB adapter asks the governed tables only: no client input; the Owner Role by KEY, then (only for a non-Owner) the family keys", async () => {
  const seen = [];
  const db = { query: async (sql, params) => { seen.push({ sql: String(sql), params }); return { rows: [] }; } };
  const r = await seam.resolveSecondaryApprovalExemption(db, T, "p-x", "finance.invoiceCorrection");
  assert.deepEqual(r, { exempt: false });
  assert.deepEqual(seen[0].params.slice(0, 3), [T, "p-x", ["owner"]]);
  assert.equal(seen.length, 2, "no Owner role -> the delegated grants are asked, and nothing further");
  assert.deepEqual(seen[1].params, [T, "p-x", [...core.SELF_APPROVAL_EXEMPT_KEY_LIST]], "only the seven family keys are asked for, never a client value");
  assert.match(seen[1].sql, /user_role_assignments[\s\S]*role_capabilities[\s\S]*UNION ALL[\s\S]*principal_capabilities/, "role grants through assignments UNION direct grants");
  assert.match(seen[1].sql, /a\.scope_type = 'global'/, "a GLOBAL assignment only: nothing scoped is a delegated exemption");
  assert.match(seen[1].sql, /pc\.expires_at IS NULL OR pc\.expires_at > now\(\)/, "an expired direct grant confers nothing");
});

// ════════════════════ Rule 2: the delegated exemption ════════════════════

test("RULE 2 FAMILY: seven keys on ONE Object, one per workflow scope plus the all-workflows key; the catalog shape and the scope of each key are fixed", () => {
  assert.deepEqual({ ...core.SELF_APPROVAL_EXEMPT_KEYS }, {
    FINANCIALS: "approval.selfApproval.exemptFinancials", PURCHASING: "approval.selfApproval.exemptPurchasing", SALES: "approval.selfApproval.exemptSales",
    INVENTORY: "approval.selfApproval.exemptInventory", SERVICE: "approval.selfApproval.exemptService", GOALS: "approval.selfApproval.exemptGoals",
    ALL: "approval.selfApproval.exemptAll",
  });
  assert.equal(core.SELF_APPROVAL_EXEMPT_OBJECT, "selfApprovalExemption");
  for (const [scope, key] of Object.entries(core.SELF_APPROVAL_EXEMPT_KEYS)) {
    assert.equal(core.scopeOfExemptKey(key), scope);
    assert.equal(core.isSelfApprovalExemptKey(key), true);
    assert.equal(key, `approval.selfApproval.${core.SELF_APPROVAL_EXEMPT_ACTIONS[scope]}`, "key = family prefix + the Object action");
  }
  for (const other of ["finance.adjustment.approve", "approval.selfApproval.exempt", "approval.selfApproval.exemptFinancials ", "approval.selfApproval.exemptfinancials", undefined, null, 7]) {
    assert.equal(core.isSelfApprovalExemptKey(other), false, String(other));
    assert.equal(core.scopeOfExemptKey(other), null);
  }
  assert.equal(core.SELF_APPROVAL_EXEMPT_KEY_LIST.length, 7);
  // every key a workflow scope can name has a key, and every scope on the site map is a scope with a key
  for (const scope of Object.values(core.SELF_APPROVAL_SITES)) assert.ok(scope === null || core.SELF_APPROVAL_EXEMPT_KEYS[scope], String(scope));
});

test("RULE 2 SEAM: a delegated grant is resolved for a non-Owner with an Employee, within its scope only; role and direct sources are recorded; the Owner is resolved first", async () => {
  const run = async (delegated, { site = "finance.invoiceCorrection", roles = [], link = "ACTIVE" } = {}) => {
    const db = { query: async (sql) => {
      if (/SELECT c\.key, 'role:'/.test(sql)) return { rows: delegated };
      if (/qualifying|user_role_assignments/.test(sql) && /r\.protected/.test(sql)) return { rows: roles };
      return { rows: link ? [{ employee_id: "e-d", employment_status: link }] : [] };
    } };
    return seam.resolveSecondaryApprovalExemption(db, T, "p-d", site);
  };
  const fin = await run([{ key: "approval.selfApproval.exemptFinancials", source: "role:financeLead" }]);
  assert.deepEqual([fin.exempt, fin.basis, fin.scopeKey, fin.grantSource, fin.employeeId], [true, "DELEGATED_EXEMPTION", "FINANCIALS", "role:financeLead", "e-d"]);
  assert.equal(core.exemptionRecord(fin, "p-d", T, "finance.invoiceCorrection").approvalBasis, "DELEGATED_EXEMPTION");
  assert.equal((await run([{ key: "approval.selfApproval.exemptFinancials", source: "direct:pc-1" }], { site: "finance.policy" })).grantSource, "direct:pc-1", "a direct grant records its source");
  assert.equal((await run([{ key: "approval.selfApproval.exemptFinancials", source: "role:x" }], { site: "purchasing.supplierPurchaseOrder" })).exempt, false, "a Finance-only grantee cannot self-approve a Purchasing action");
  assert.equal((await run([{ key: "approval.selfApproval.exemptPurchasing", source: "role:x" }], { site: "goals.performanceGoal" })).exempt, false, "nor a Goals action");
  const all = await run([{ key: "approval.selfApproval.exemptAll", source: "role:ceo" }], { site: "inventory.cycleCount" });
  assert.deepEqual([all.exempt, all.scopeKey, all.basis], [true, "INVENTORY", "DELEGATED_EXEMPTION"], "the all-workflows key admits every declared site");
  assert.equal((await run([{ key: "approval.selfApproval.exemptAll", source: "role:ceo" }], { link: null })).exempt, false, "a grant without an access-eligible Employee is nothing");
  assert.equal((await run([{ key: "approval.selfApproval.exemptAll", source: "role:ceo" }], { link: "TERMINATED" })).exempt, false);
  assert.equal((await run([{ key: "finance.adjustment.approve", source: "role:x" }])).exempt, false, "a key outside the family is never read as an exemption");
  assert.equal((await run([])).exempt, false);
  // the Owner is resolved FIRST and is never asked for a grant
  const owner = await run([{ key: "approval.selfApproval.exemptAll", source: "role:ceo" }], { roles: [OWNER] });
  assert.equal(owner.basis, "PROTECTED_OWNER");
});

test("RULE 2 / F-1b: a delegated Financials grantee decides their OWN correction (basis + provenance on the row and audit); a Purchasing grantee, an unflagged person and a forged flag are refused; the exemption never reaches the capability, the amount or the state", async () => {
  const delegated = [{ key: "approval.selfApproval.exemptFinancials", source: "role:financeLead" }];
  const p = pool(decideRules({ roles: [], delegated }));
  const out = await decide(p, { tenantId: T, principalId: "p-own" });
  assert.equal(out.outcome, "rejected");
  const w = writes(p);
  assert.deepEqual(w[0].params.slice(8), ["DELEGATED_EXEMPTION", "FINANCIALS", "role:financeLead"]);
  const audit = JSON.parse(w[1].params[7]);
  assert.deepEqual([audit.approvalBasis, audit.approvalScope, audit.approvalGrantSource], ["DELEGATED_EXEMPTION", "FINANCIALS", "role:financeLead"]);
  // the all-workflows key counts for Financials; a Purchasing key does not; neither does an unlisted key
  const allP = pool(decideRules({ roles: [], delegated: [{ key: "approval.selfApproval.exemptAll", source: "direct:pc-9" }] }));
  await decide(allP, { tenantId: T, principalId: "p-own" });
  assert.equal(writes(allP)[0].params[8], "DELEGATED_EXEMPTION");
  for (const wrongScope of [[{ key: "approval.selfApproval.exemptPurchasing", source: "role:x" }], [{ key: "approval.selfApproval.exemptGoals", source: "role:x" }], []]) {
    const q = pool(decideRules({ roles: [], delegated: wrongScope }));
    const e = await failure(decide(q, { tenantId: T, principalId: "p-own" }));
    assert.equal(e?.code, "SELF_APPROVAL_FORBIDDEN");
    assert.deepEqual(writes(q), [], "a refusal writes nothing");
  }
  // the delegated grantee still goes on to the ordinary eligibility checks on APPROVE
  const ap = pool(decideRules({ roles: [], delegated }));
  const e = await failure(decide(ap, { tenantId: T, principalId: "p-own" }, { decision: "APPROVE", amountMinor: 100 }));
  assert.match(e?.message ?? "", /UNEXPECTED SQL: SELECT i\.id/, "the people rule passed; state, balance and company are decided next");
  assert.deepEqual(writes(ap), []);
});

// ════════════════════ Rule 2: who may grant or revoke the family (Owner-only gate) ════════════════════

const adminGate = require("../lib/adminPolicy/exemptionAdministration.js");
const commands = require("../lib/adminPolicy/policyCommands.js");
const CAPS = [...core.SELF_APPROVAL_EXEMPT_KEY_LIST].map((key, i) => ({ id: `cap-${i}`, key, objectKey: "selfApprovalExemption", actionKey: key.split(".").pop(), actionKind: "BUSINESS_ACTION" }))
  .concat([{ id: "cap-x", key: "workOrder.read", objectKey: "workOrder", actionKey: "read", actionKind: "READ" }]);
/** A policy store stand-in that records every call, so "zero trace" is checkable. ownerUid is the verified protected Owner; adminUid holds admin.securityPolicy.write by Administrator standing. */
function adminRepo({ ownerUid = "p-owner", employee = { employeeId: "e-1", employmentStatus: "ACTIVE" }, roleCarries = [] } = {}) {
  const calls = [];
  const note = (name, v) => async (...a) => { calls.push(name); return typeof v === "function" ? v(...a) : v; };
  const roles = [{ id: "r-owner", key: "owner", protected: true }, { id: "r-admin", key: "admin", protected: true }, { id: "r-fin", key: "financeLead", protected: false }];
  return {
    calls,
    listCapabilities: async () => CAPS,
    getMembership: async () => ({ status: "active" }), getPrincipal: async (id) => ({ id, status: "active" }), getAccessVersion: async () => ({ accessVersion: 1 }),
    listRoles: async () => roles,
    listAssignmentsForPrincipal: async (_t, uid) => (uid === ownerUid ? [{ id: "a1", roleId: "r-owner", status: "active", scopeType: "global", accessVersionAtGrant: 1 }]
      : [{ id: "a2", roleId: "r-admin", status: "active", scopeType: "global", accessVersionAtGrant: 1 }]),
    getLinkedEmployeeAccessFact: async () => employee,
    listRoleCapabilities: async () => roleCarries.map((id) => ({ roleId: "r-fin", capabilityId: id })),
    getObjectByKey: note("getObjectByKey", { key: "selfApprovalExemption" }),
    getRoleByKey: note("getRoleByKey", roles[2]),
    transact: async () => { calls.push("transact"); throw new Error("the stub never opens a transaction"); },
  };
}
const ownerActor = Object.freeze({ tenantId: T, uid: "p-owner", heldRoleKeys: ["owner"], capabilities: new Set(["admin.roleAssignment.write"]) });
const adminActor = Object.freeze({ tenantId: T, uid: "p-admin", heldRoleKeys: ["admin"], protectedAdministrator: true, capabilities: new Set(["admin.securityPolicy.write", "admin.roleAssignment.write"]) });
const FIN_GRANT = { roleKey: "financeLead", objectKey: "selfApprovalExemption", actionKey: "exemptFinancials", reason: "Owner decision" };

test("RULE 2 ADMIN GATE: for the family ONLY the verified protected Owner grants or revokes (Role and direct); the Administrator and everyone else are refused before anything else is read; other keys keep today's gate", async () => {
  // the Owner passes the gate (and goes on: the stub then stops at the transaction)
  for (const [fn, input] of [["grantObjectActionToRole", FIN_GRANT], ["revokeObjectActionFromRole", FIN_GRANT],
    ["grantObjectActionToPrincipal", { principalId: "p-x", objectKey: FIN_GRANT.objectKey, actionKey: FIN_GRANT.actionKey, reason: "r" }],
    ["revokeObjectActionFromPrincipal", { principalId: "p-x", objectKey: FIN_GRANT.objectKey, actionKey: FIN_GRANT.actionKey, reason: "r" }]]) {
    const repo = adminRepo();
    const e = await failure(commands[fn](repo, ownerActor, input));
    assert.doesNotMatch(String(e?.message), /not authorized/, `${fn}: the Owner is not refused by the gate (${e?.message})`);
    // the Administrator, who holds admin.securityPolicy.write, IS refused -- and nothing was read about the request
    const denied = adminRepo();
    const d = await failure(commands[fn](denied, adminActor, input));
    assert.equal(d?.constructor?.name, "ExemptionAdministrationDeniedError", fn);
    assert.match(d.message, /only the governed protected Owner/);
    assert.ok(!denied.calls.includes("getObjectByKey") && !denied.calls.includes("getRoleByKey") && !denied.calls.includes("transact"), `${fn}: zero trace (${denied.calls})`);
  }
  // an Owner whose Employee link is unusable is not the verified Owner
  const noLink = adminRepo({ employee: null });
  assert.equal((await failure(commands.grantObjectActionToRole(noLink, ownerActor, FIN_GRANT)))?.constructor?.name, "ExemptionAdministrationDeniedError");
  const ended = adminRepo({ employee: { employeeId: "e-1", employmentStatus: "TERMINATED" } });
  assert.equal((await failure(commands.grantObjectActionToRole(ended, ownerActor, FIN_GRANT)))?.constructor?.name, "ExemptionAdministrationDeniedError");
  // an ordinary key keeps today's gate: the Administrator passes it, the Owner (no admin.securityPolicy.write) does not
  const ordinary = { roleKey: "financeLead", objectKey: "workOrder", actionKey: "read", reason: "r" };
  const a = await failure(commands.grantObjectActionToRole(adminRepo(), adminActor, ordinary));
  assert.doesNotMatch(String(a?.message), /not authorized/);
  const o = await failure(commands.grantObjectActionToRole(adminRepo(), ownerActor, ordinary));
  assert.equal(o?.constructor?.name, "AdministrationCapabilityDeniedError", "today's gate, unchanged: the Owner holds no admin.securityPolicy.write");
  // FAIL CLOSED (F3): the family is recognised on the OBJECT alone, so a name that does not resolve to a key (or no action name at all) is still the family's -- the Administrator is refused, the Owner is not
  const unknown = { ...ordinary, objectKey: "selfApprovalExemption", actionKey: "exemptEverything" };
  assert.equal((await failure(commands.grantObjectActionToRole(adminRepo(), adminActor, unknown)))?.constructor?.name, "ExemptionAdministrationDeniedError");
  assert.doesNotMatch(String((await failure(commands.grantObjectActionToRole(adminRepo(), ownerActor, unknown)))?.message), /not authorized/);
  // ... and an unreadable catalog can never turn a family request into an ordinary one: the gate reads no catalog at all
  const broken = { ...adminRepo(), listCapabilities: async () => { throw new Error("catalog unreadable"); } };
  assert.equal((await failure(commands.grantObjectActionToRole(broken, adminActor, FIN_GRANT)))?.constructor?.name, "ExemptionAdministrationDeniedError");
  assert.deepEqual([" selfApprovalExemption ", "selfApprovalExemption"].map(adminGate.namesExemptionFamily), [true, true]);
  assert.deepEqual([undefined, null, "", "workOrder", "SelfApprovalExemption", 7, {}].map(adminGate.namesExemptionFamily), [false, false, false, false, false, false, false]);
});

test("RULE 2 OBJECT-WIDE AND CONDITIONS (F2): the Administrator is refused, with zero trace, on an object-wide GRANT / REVOKE of the exemption Object and on any condition command naming it; the Owner is not refused by the gate; another Object keeps today's gate", async () => {
  const wide = (mode) => ({ objectKey: "selfApprovalExemption", roleKey: "financeLead", mode, reason: "r" });
  const cond = { roleKey: "financeLead", objectKey: "selfApprovalExemption", actionKey: "exemptFinancials", reason: "r", condition: { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" } };
  const calls = [
    ["applyObjectWideRoleAuthority GRANT", (r, a) => commands.applyObjectWideRoleAuthority(r, a, wide("GRANT"))],
    ["applyObjectWideRoleAuthority REVOKE", (r, a) => commands.applyObjectWideRoleAuthority(r, a, wide("REVOKE"))],
    ["setGrantCondition (Role)", (r, a) => commands.setGrantCondition(r, a, cond)],
    ["retireGrantCondition (Role)", (r, a) => commands.retireGrantCondition(r, a, cond)],
    ["setGrantCondition (direct)", (r, a) => commands.setGrantCondition(r, a, { principalId: "p-x", objectKey: "selfApprovalExemption", actionKey: "exemptFinancials", reason: "r", condition: cond.condition })],
    ["retireGrantCondition (direct)", (r, a) => commands.retireGrantCondition(r, a, { principalId: "p-x", objectKey: "selfApprovalExemption", actionKey: "exemptFinancials", reason: "r" })],
  ];
  for (const [label, run] of calls) {
    const denied = adminRepo();
    const d = await failure(run(denied, adminActor));
    assert.equal(d?.constructor?.name, "ExemptionAdministrationDeniedError", label);
    assert.deepEqual(denied.calls, [], `${label}: zero trace (${denied.calls})`);
    const owner = await failure(run(adminRepo(), ownerActor));
    assert.doesNotMatch(String(owner?.message), /not authorized: only the governed protected Owner/, `${label}: the Owner is not refused by the gate`);
  }
  // another Object keeps today's gate (the Owner holds no admin.securityPolicy.write)
  const other = await failure(commands.applyObjectWideRoleAuthority(adminRepo(), ownerActor, { ...wide("GRANT"), objectKey: "workOrder" }));
  assert.equal(other?.constructor?.name, "AdministrationCapabilityDeniedError");
  // the API's preview and commit gates route through the same family-aware gate on the OBJECT, so an object-wide change with no actionKey is gated too
  const api = readFileSync(join(ROOT, "src/adminPolicy/adminPolicyApi.ts"), "utf8");
  assert.equal((api.match(/requireGrantAuthority\(deps\.repo, actor, AUTHORITY_CHANGE_GATE\[operation\], (?:changeInput|input)\.objectKey/g) ?? []).length, 2);
});

test("RULE 2 GRANT SOURCE (F4): the delegated grants are read in a DETERMINISTIC order and record the capability key, so the grant a decision cites is the same on every call", async () => {
  const sqls = [];
  const db = { query: async (sql) => { sqls.push(sql); return { rows: [] }; } };
  await seam.delegatedExemptionGrants(db, T, "p-d");
  assert.equal(sqls.length, 1);
  assert.match(sqls[0], /'role:' \|\| r\.key \|\| ':' \|\| c\.key AS source/);
  assert.match(sqls[0], /'direct:' \|\| pc\.id \|\| ':' \|\| c\.key AS source/);
  assert.match(sqls[0], /ORDER BY 1, 2\s*$/);
  // the core prefers the site's SCOPED key over exemptAll whatever order they arrive in, and takes the first of equals
  for (const order of [[["exemptAll", "role:b:exemptAll"], ["exemptFinancials", "role:a:exemptFinancials"]], [["exemptFinancials", "role:a:exemptFinancials"], ["exemptAll", "role:b:exemptAll"]]]) {
    const delegated = order.map(([k, source]) => ({ scopeKey: core.scopeOfExemptKey(`approval.selfApproval.${k}`), source }));
    const r = core.decideSecondaryApprovalExemption(T, "p-d", "finance.invoiceCorrection", { principalEnabled: true, membershipActive: true, heldRoles: [],
      employeeLinks: [{ employeeId: "e-d", employmentStatus: "ACTIVE" }], delegated });
    assert.equal(r.grantSource, "role:a:exemptFinancials");
  }
});

test("RULE 2 STAFFING: assigning a Role that CARRIES a family key is the Owner's act; revoking an assignment stays as it was", async () => {
  const carries = [CAPS[0].id];
  const refuse = await failure(commands.assignRole(adminRepo({ roleCarries: carries }), adminActor, { principalId: "p-t", roleId: "r-fin", reason: "staffing" }));
  assert.equal(refuse?.constructor?.name, "ExemptionAdministrationDeniedError", "the Administrator cannot hand the exemption out through staffing");
  const ok = await failure(commands.assignRole(adminRepo({ roleCarries: carries }), ownerActor, { principalId: "p-t", roleId: "r-fin", reason: "staffing" }));
  assert.doesNotMatch(String(ok?.message), /not authorized/, "the Owner is not refused");
  const plain = await failure(commands.assignRole(adminRepo({ roleCarries: [] }), adminActor, { principalId: "p-t", roleId: "r-fin", reason: "staffing" }));
  assert.doesNotMatch(String(plain?.message), /not authorized/, "an ordinary Role is staffed exactly as before");
});

test("RULE 2 / D3 / D1: the Owner is STILL refused granting the exemption to a Role they hold or to themselves (SELF_ADMINISTRATION is not waived); the family is not conditionable; the API gates the preview and the commit on the Owner too", () => {
  const code = (f) => readFileSync(join(ROOT, "src", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const cmds = code("adminPolicy/policyCommands.ts");
  assert.match(cmds, /a principal may not grant a capability to a Role it holds/, "unconditional");
  assert.match(cmds, /requireDirectGrantee/, "the direct-grant self rule stays");
  const api = code("adminPolicy/adminPolicyApi.ts");
  assert.equal((api.match(/requireGrantAuthority\(/g) ?? []).length, 3, "the preview gate, the commit gate and the authorityCommand early gate (API-01) all route through the family-aware gate");
  assert.doesNotMatch(api, /requireSecurityAdministrationCapability\(deps\.repo, actor, AUTHORITY_CHANGE_GATE/, "no front gate bypasses it");
  const ex = code("adminPolicy/exemptionAdministration.ts");
  assert.doesNotMatch(ex, /exemptionRecord|decideSecondaryApprovalExemption\([^)]*delegated/, "the Owner check reads Rule 1 only");
  assert.deepEqual(typeof adminGate.requireGrantAuthority, "function");
});
