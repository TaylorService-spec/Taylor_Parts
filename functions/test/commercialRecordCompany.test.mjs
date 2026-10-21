// CLC (DECISIONS #CLC), the parts that need no database: the order of checks of the governed, audited, set-once correction of a COMPANY-LESS Opportunity or Sales
// Agreement, run against a scripted client; the server-decided offer; and the structural facts (one capability, registered with no grants; the transport serves one
// new operation; the result never names a record the caller may not see). The live proof -- the real predicate, lineage, concurrency, the audit row, the reach of the
// protected Administrator and Owner, a former creator losing the record -- is commercialRecordCompanyPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const FUNCTIONS = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(FUNCTIONS, "src");
const code = (rel) => readFileSync(join(SRC, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const service = require("../lib/eosCommercial/commands/commercialRecordCompanyService.js");
const kernel = require("../lib/eosCommercial/commands/commercialCommandKernel.js");
const authority = require("../lib/eosCommercial/commercialCompanyAuthority.js");
const offerModule = require("../lib/eosCommercial/recordCompanyOffer.js");
const http = require("../lib/eosCommercial/commercialHttp.js");

const KEY = "commercial.recordCompany.assign";
const NEUTRAL = "the company of a related record cannot be confirmed from here; ask someone who can see it";
const ACTION = "recordCompany.assign"; // the operation and the audit action: command_receipts.operation is exactly two segments
const KEY_OF = { taylor: "taylor-ops", ventana: "ventana-ops" };
const reach = () => authority.commercialCompanyReachOf({ unrestricted: false, protectedOwner: false, companyKeys: ["taylor-ops"], employeeIds: ["e-owner"], creatorId: "p-1" });
const ACTOR = { tenantId: "t1", principalId: "p-1", capabilities: new Set([KEY]) };

const oppRow = (over = {}) => ({
  id: "opp-1", opportunity_number: "OPP-2026-000001", account_id: "acct-1", owner_employee_id: "e-owner", operating_company_id: null, operating_company_key: null,
  sales_channel: "RETAIL", stage: "QUALIFYING", outcome: null, closed_at: null, need: null, expected_value: null, expected_close_at: null, next_action: null,
  credited_salesperson_employee_id: null, accountable_employee_id: null, edit_version: "3", ...over });
const agrRow = (over = {}) => ({
  id: "sag-1", sales_agreement_number: "SA-2026-000001", account_id: "acct-1", opportunity_id: "opp-1", owner_employee_id: "e-owner", operating_company_id: null,
  operating_company_key: null, state: "DRAFT", credited_salesperson_employee_id: null, location_id: null, customer_po: null, is_lease: null, fulfillment_intent: null,
  shipping_instructions: null, ship_via: null, special_instructions: null, shipping_minor: 0, install_charge_minor: 0, tax_minor: 0, down_payment_minor: 0,
  trade_in_minor: 0, accepted_at: null, ...over });

/** A client that answers exactly what the command asks, records every statement, and can replay a committed receipt. */
function world(cfg = {}) {
  const log = [];
  const creators = { "p-creator": { home: "taylor", grants: [] }, "p-dual": { home: "taylor", grants: ["ventana"] }, "p-unlinked": { home: "taylor", unlinked: true }, ...(cfg.creators ?? {}) };
  const creatorsFor = (id) => creators[id] ?? null;
  const client = {
    async query(sql, params) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      log.push({ s, params });
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(s) || /pg_advisory_xact_lock/.test(s)) return { rows: [] };
      if (/^SELECT result, target_family, target_id FROM eos_commercial\.command_receipts/.test(s)) return { rows: cfg.receipt ? [cfg.receipt] : [] };
      // The record CREATOR's governed company authority (resolveCompanyAuthority runs for real, never injected): a synthetic principal with standing, a LINKED active
      // Employee whose home company is a real binding, plus optional explicit grants. cfg.creators overrides/adds principals; a null entry has no standing at all.
      if (/FROM eos_policy\.principals p JOIN eos_policy\.tenant_memberships m/.test(s)) return { rows: creatorsFor(params[1]) ? [{}] : [] };
      if (/FROM eos_policy\.employee_principal_links l LEFT JOIN eos_workforce\.employees e/.test(s)) {
        const c = creatorsFor(params[1]);
        return { rows: !c || c.unlinked ? [] : [{ employee_id: `e-${params[1]}`, employment_status: "ACTIVE", operating_company_id: c.home }] };
      }
      if (/^SELECT c\.operating_company_id AS id FROM eos_policy\.tenant_operating_companies c/.test(s)) {
        const c = creatorsFor(params[1]);
        return { rows: [...new Set([c.home, ...(c.grants ?? [])])].sort().map((id) => ({ id })) };
      }
      if (/^SELECT DISTINCT operating_company_key AS key FROM eos_policy\.tenant_operating_company_keys/.test(s)) return { rows: params[1].map((id) => ({ key: KEY_OF[id] })) };
      if (/^SELECT created_by FROM eos_commercial\.(opportunities|sales_agreements) WHERE/.test(s)) return { rows: [{ created_by: cfg.createdBy === undefined ? "p-creator" : cfg.createdBy }] };
      if (/^SELECT DISTINCT created_by FROM eos_commercial\.sales_agreements/.test(s)) {
        return { rows: (cfg.heirCreators ?? ((cfg.children ?? []).length > 0 ? ["p-creator"] : [])).map((created_by) => ({ created_by })) };
      }
      if (/tenant_memberships/.test(s)) return { rows: [{}] };
      if (/FROM eos_commercial\.opportunities o WHERE .* FOR UPDATE OF o/.test(s)) return { rows: cfg.opportunity ? [cfg.opportunity] : [] };
      if (/FROM eos_commercial\.opportunity_lines/.test(s) || /FROM eos_commercial\.sales_agreement_lines/.test(s)) return { rows: [] };
      if (/FROM eos_commercial\.sales_agreements a WHERE .* FOR UPDATE OF a/.test(s)) return { rows: cfg.agreement ? [cfg.agreement] : [] };
      if (/^SELECT sales_channel::text FROM eos_commercial\.opportunities/.test(s)) return { rows: [{ sales_channel: cfg.parentChannel ?? "RETAIL" }] };
      if (/^SELECT o\.operating_company_key, .* AS visible FROM eos_commercial\.opportunities o WHERE/.test(s)) return { rows: [{ operating_company_key: cfg.parentKey ?? null, visible: cfg.parentVisible ?? true }] };
      if (/^SELECT status FROM eos_policy\.tenant_operating_companies/.test(s)) return { rows: params[1] in KEY_OF ? [{ status: "ACTIVE" }] : [] };
      if (/^SELECT b\.operating_company_key FROM eos_policy\.tenant_operating_company_keys/.test(s)) return { rows: [{ operating_company_key: KEY_OF[params[1]] }] };
      if (/^SELECT a\.operating_company_key, .* AS visible FROM eos_commercial\.sales_agreements a/.test(s)) return { rows: cfg.disagreeingChild ? [{ operating_company_key: cfg.disagreeingChild, visible: cfg.childVisible ?? true }] : [] };
      if (/^SELECT operating_company_id FROM eos_policy\.tenant_operating_company_keys/.test(s)) return { rows: Object.entries(KEY_OF).filter(([, k]) => k === params[1]).map(([id]) => ({ operating_company_id: id })) };
      if (/^UPDATE eos_commercial\.opportunities SET operating_company_key/.test(s)) return { rowCount: 1, rows: [{ edit_version: "4" }] };
      if (/^UPDATE eos_commercial\.sales_agreements SET operating_company_key = \$3, updated_by = \$4, updated_at = now\(\) WHERE tenant_id = \$1 AND opportunity_id/.test(s)) return { rowCount: (cfg.children ?? []).length, rows: cfg.children ?? [] };
      if (/^UPDATE eos_commercial\.sales_agreements SET operating_company_key/.test(s)) return { rowCount: 1, rows: [] };
      return { rows: [] };
    },
    release() { log.push({ s: "RELEASE" }); },
  };
  let connects = 0;
  const pool = { async connect() { connects += 1; return client; } };
  return {
    log, pool, connects: () => connects,
    writes: () => log.filter((l) => /^(UPDATE|INSERT|DELETE)/.test(l.s)),
    committed: () => log.some((l) => l.s === "COMMIT"),
    rolledBack: () => log.some((l) => l.s === "ROLLBACK"),
  };
}
const deps = (w, over = {}) => ({ pool: w.pool, companyReach: async () => reach(), ...over });
const run = (w, input, actor = ACTOR, over = {}) => service.assignRecordOperatingCompany(deps(w, over), actor, input).then((r) => r, (e) => e);
const good = (over = {}) => ({ idempotencyKey: "k-1", family: "OPPORTUNITY", recordId: "opp-1", operatingCompanyId: "taylor", reason: "Entered without a company by mistake; belongs to Taylor.", ...over });
const zeroTrace = (w, what) => {
  assert.deepEqual(w.writes(), [], `${what}: a refusal wrote nothing`);
  assert.ok(w.rolledBack() && !w.committed(), `${what}: rolled back, never committed`);
};

test("1. a caller without the capability is refused before any database is touched", async () => {
  const w = world({ opportunity: oppRow() });
  const err = await run(w, good(), { ...ACTOR, capabilities: new Set(["opportunity.write"]) });
  assert.deepEqual([err.code, err.category], ["CAPABILITY_REQUIRED", "FORBIDDEN"]);
  assert.equal(w.connects(), 0);
});

test("2. input is validated inside the transaction: unknown fields, family, record, company and a REQUIRED reason; nothing is written", async () => {
  const cases = [
    [good({ operatingCompanyKey: "taylor-ops" }), "FIELD_NOT_ACCEPTED"],
    [good({ tenantId: "t2" }), "FIELD_NOT_ACCEPTED"],
    [good({ family: "SALES_ORDER" }), "FAMILY_INVALID"],
    [good({ family: "constructor" }), "FAMILY_INVALID"],
    [good({ family: undefined }), "FAMILY_INVALID"],
    [good({ recordId: "  " }), "RECORD_ID_REQUIRED"],
    [good({ operatingCompanyId: "" }), "OPERATING_COMPANY_REQUIRED"],
    [good({ operatingCompanyId: null }), "OPERATING_COMPANY_REQUIRED"],
    [good({ operatingCompanyId: "Taylor Parts" }), "OPERATING_COMPANY_REQUIRED"],
    [good({ reason: undefined }), "REASON_REQUIRED"],
    [good({ reason: "   " }), "REASON_REQUIRED"],
    [good({ reason: "x".repeat(501) }), "REASON_TOO_LONG"],
  ];
  for (const [input, expected] of cases) {
    const w = world({ opportunity: oppRow() });
    const err = await run(w, input);
    assert.deepEqual([err.code, err.category], [expected, "INVALID_INPUT"], JSON.stringify(input));
    zeroTrace(w, expected);
  }
});

test("3. VISIBILITY comes first: a record the caller cannot see is NONEXISTENT, found through the Q-1a predicate, and nothing else is learned", async () => {
  const w = world({ opportunity: null });
  // An unreached target company AND an invisible record: the record answers first.
  const err = await run(w, good({ operatingCompanyId: "ventana" }));
  assert.deepEqual([err.code, err.category, err.message], ["RECORD_NOT_FOUND", "NOT_FOUND", "the Opportunity does not exist in this tenant"]);
  zeroTrace(w, "invisible");
  const lock = w.log.find((l) => /FOR UPDATE OF o/.test(l.s));
  assert.match(lock.s, /operating_company_key = ANY\(\$3::text\[\]\)/, "the predicate is inside the locking SELECT");
  assert.deepEqual(lock.params, ["t1", "opp-1", ["taylor-ops"], ["e-owner"], "p-1"]);
  assert.ok(!w.log.some((l) => /tenant_operating_companies/.test(l.s)), "no company fact was consulted before visibility");
  const agr = world({ agreement: null });
  const e2 = await run(agr, good({ family: "SALES_AGREEMENT", recordId: "sag-1" }));
  assert.deepEqual([e2.code, e2.message], ["RECORD_NOT_FOUND", "the Sales Agreement does not exist in this tenant"]);
  assert.match(agr.log.find((l) => /FOR UPDATE OF a/.test(l.s)).s, /operating_company_key = ANY\(\$3::text\[\]\)/);
  zeroTrace(agr, "invisible agreement");
});

test("4. TARGET REACH comes second: a company the caller does not reach reads as an ungoverned company, even for a record that already has one", async () => {
  const w = world({ opportunity: oppRow() });
  const err = await run(w, good({ operatingCompanyId: "ventana" }));
  assert.deepEqual([err.code, err.category, err.message], ["OPERATING_COMPANY_NOT_GOVERNED", "PRECONDITION_FAILED", "operating company 'ventana' is not governed in this tenant"]);
  zeroTrace(w, "unreached target");
  const set = world({ opportunity: oppRow({ operating_company_key: "taylor-ops" }) });
  assert.equal((await run(set, good({ operatingCompanyId: "ventana" }))).code, "OPERATING_COMPANY_NOT_GOVERNED", "target reach is decided before 'already set'");
  const unknown = await run(world({ opportunity: oppRow() }), good({ operatingCompanyId: "nowhere" }));
  assert.equal(unknown.code, "OPERATING_COMPANY_NOT_GOVERNED");
});

test("5. STILL COMPANY-LESS: a record that already has a company is never changed, and nothing is written", async () => {
  for (const [input, row] of [
    [good(), { opportunity: oppRow({ operating_company_key: "taylor-ops" }) }],
    [good({ family: "SALES_AGREEMENT", recordId: "sag-1" }), { agreement: agrRow({ operating_company_key: "taylor-ops" }) }],
    // a stored key that no longer resolves to a bound company (operating_company_id null) is still a company, not "company-less"
    [good(), { opportunity: oppRow({ operating_company_key: "legacy-key", operating_company_id: null }) }],
  ]) {
    const w = world(row);
    const err = await run(w, input);
    assert.deepEqual([err.code, err.category], ["OPERATING_COMPANY_ALREADY_SET", "PRECONDITION_FAILED"]);
    zeroTrace(w, "already set");
  }
});

test("6. LINEAGE: an Agreement's company is its Opportunity's; a company-less or different parent refuses, and so does a disagreeing child; each refusal NAMES the conflict", async () => {
  const agreement = good({ family: "SALES_AGREEMENT", recordId: "sag-1" });
  const noCompanyParent = world({ agreement: agrRow(), parentKey: null });
  const e1 = await run(noCompanyParent, agreement);
  assert.deepEqual([e1.code, e1.category], ["LINEAGE_DISAGREEMENT", "PRECONDITION_FAILED"]);
  assert.match(e1.message, /Opportunity has no operating company yet; set the Opportunity's operating company first, then set this Agreement to the same company/);
  zeroTrace(noCompanyParent, "company-less parent");
  const otherParent = world({ agreement: agrRow(), parentKey: "ventana-ops", parentVisible: false });
  const e2 = await run(otherParent, agreement);
  assert.equal(e2.code, "LINEAGE_DISAGREEMENT");
  assert.equal(e2.message, NEUTRAL, "a parent the caller cannot see: ONE neutral message, no company named");
  // the lookup went through the Q-1a predicate (its params follow the tenant and the parent id)
  const parentLookup = otherParent.log.find((l) => /^SELECT o\.operating_company_key, .* AS visible/.test(l.s));
  assert.match(parentLookup.s, /operating_company_key = ANY\(\$3::text\[\]\)/);
  assert.deepEqual(parentLookup.params, ["t1", "opp-1", ["taylor-ops"], ["e-owner"], "p-1"]);
  const hiddenNoCompany = await run(world({ agreement: agrRow(), parentKey: null, parentVisible: false }), agreement);
  assert.equal(hiddenNoCompany.message, NEUTRAL, "an invisible company-less parent is not described as company-less");
  const hiddenSame = world({ agreement: agrRow(), parentKey: "taylor-ops", parentVisible: false });
  assert.equal((await run(hiddenSame, good({ family: "SALES_AGREEMENT", recordId: "sag-1" }))).replayed, false, "a parent in the SAME company is consistent whoever can see it");
  const ownParent = world({ agreement: agrRow(), parentKey: "taylor-ops" });
  assert.equal((await run(ownParent, good({ family: "SALES_AGREEMENT", recordId: "sag-1", operatingCompanyId: "taylor" }))).replayed, false, "the Opportunity's own company is the one an Agreement may take");
  const dualReach = (w) => ({ ...deps(w), companyReach: async () => authority.commercialCompanyReachOf({ unrestricted: false, protectedOwner: false, companyKeys: ["taylor-ops", "ventana-ops"], employeeIds: ["e-owner"], creatorId: "p-1" }) });
  const e2b = await service.assignRecordOperatingCompany(dualReach(world({ agreement: agrRow(), parentKey: "ventana-ops" })), ACTOR, agreement).then((r) => r, (e) => e);
  assert.match(e2b.message, /Opportunity is in operating company 'ventana', not 'taylor'/, "a company the caller reaches is named");
  zeroTrace(otherParent, "different parent");
  const child = world({ opportunity: oppRow(), disagreeingChild: "ventana-ops", childVisible: false });
  const e3 = await run(child, good());
  assert.equal(e3.code, "LINEAGE_DISAGREEMENT");
  assert.equal(e3.message, NEUTRAL, "a hidden Agreement still blocks the Opportunity, but is not described");
  const childLookup = child.log.find((l) => /^SELECT a\.operating_company_key, .* AS visible/.test(l.s));
  assert.match(childLookup.s, /operating_company_key = ANY\(\$4::text\[\]\)/);
  assert.deepEqual(childLookup.params, ["t1", "opp-1", "taylor-ops", ["taylor-ops"], ["e-owner"], "p-1"]);
  const e3b = await service.assignRecordOperatingCompany(dualReach(world({ opportunity: oppRow(), disagreeingChild: "ventana-ops" })), ACTOR, good()).then((r) => r, (e) => e);
  assert.match(e3b.message, /^this Opportunity's Sales Agreement is already in operating company 'ventana', which differs from 'taylor'/, "a visible Agreement's company is named");
  zeroTrace(child, "disagreeing child");
});

const kindOf = (q) => (/^UPDATE eos_commercial\.opportunities/.test(q) ? "opportunity" : /^UPDATE eos_commercial\.sales_agreements/.test(q) ? "inherit" : /audit_events/.test(q) ? "audit" : /command_receipts/.test(q) ? "receipt" : q);
const auditsOf = (w) => w.log.filter((l) => /^INSERT INTO eos_policy\.audit_events/.test(l.s)).map((l) => ({
  tenant: l.params[1], action: l.params[2], actor: l.params[3], targetKind: l.params[4], targetId: l.params[5], before: JSON.parse(l.params[6]), after: JSON.parse(l.params[7]), reason: l.params[8] }));
const REASON = "Entered without a company by mistake; belongs to Taylor.";

test("7. APPLIED Opportunity WITH a company-less Agreement: the Agreement INHERITS in the same transaction; two audit rows (the child's names its basis); the result lists the child", async () => {
  const w = world({ opportunity: oppRow(), children: [{ id: "sag-child" }] });
  const out = await run(w, good());
  assert.equal(out.replayed, false, out.message);
  assert.deepEqual(out, { family: "OPPORTUNITY", recordId: "opp-1", operatingCompanyId: "taylor", editVersion: 4, inheritedSalesAgreementIds: ["sag-child"], replayed: false });
  assert.deepEqual(w.writes().map((x) => kindOf(x.s)), ["opportunity", "inherit", "audit", "audit", "receipt"], "parent, child, the child's audit, the parent's audit, the receipt");
  const [up, child] = w.writes();
  assert.match(up.s, /operating_company_key IS NULL/, "the parent UPDATE also requires the company to still be NULL (two assigns, one winner)");
  assert.deepEqual(up.params, ["t1", "opp-1", "taylor-ops", "p-1"]);
  assert.match(child.s, /WHERE tenant_id = \$1 AND opportunity_id = \$2 AND operating_company_key IS NULL RETURNING id$/, "ONLY a NULL child inherits");
  assert.doesNotMatch(child.s, /owner_employee_id|accountable|credited|state|edit_version/, "only the company column (and the stamp) changes");
  assert.deepEqual(child.params, ["t1", "opp-1", "taylor-ops", "p-1"]);
  const [childAudit, parentAudit] = auditsOf(w);
  assert.deepEqual([childAudit.action, childAudit.targetKind, childAudit.targetId, childAudit.actor, childAudit.reason], [ACTION, "salesAgreement", "sag-child", "p-1", REASON]);
  assert.deepEqual(childAudit.before, { operatingCompanyId: null, operatingCompanyKey: null });
  assert.deepEqual(childAudit.after, { operatingCompanyId: "taylor", operatingCompanyKey: "taylor-ops", basis: "inherited from Opportunity opp-1" });
  assert.deepEqual([parentAudit.action, parentAudit.targetKind, parentAudit.targetId, parentAudit.reason], [ACTION, "opportunity", "opp-1", REASON]);
  assert.deepEqual(parentAudit.before, { operatingCompanyId: null, operatingCompanyKey: null });
  assert.deepEqual(parentAudit.after, { operatingCompanyId: "taylor", operatingCompanyKey: "taylor-ops", editVersion: 4, inheritedSalesAgreementIds: ["sag-child"] });
  const order = w.log.map((l) => l.s);
  assert.ok(order.findIndex((s) => /audit_events/.test(s)) < order.findIndex((s) => /INSERT INTO eos_commercial\.command_receipts/.test(s)), "the audit precedes the receipt");
  assert.ok(w.committed() && !w.rolledBack());
  const at = (re) => order.findIndex((s) => re.test(s));
  const target = at(/^SELECT b\.operating_company_key FROM/);
  assert.ok(at(/FOR UPDATE OF o/) < target && target < at(/^UPDATE eos_commercial\.opportunities/), "visibility, target, then the writes");
});

test("7b. APPLIED Opportunity with NO Agreement, or whose Agreement already has the SAME company: the Opportunity succeeds; no child write that changes a row, no child audit row", async () => {
  for (const [what, cfg] of [["no Agreement", {}], ["an Agreement already in the same company (a NULL-only UPDATE finds nothing)", { children: [] }]]) {
    const w = world({ opportunity: oppRow(), ...cfg });
    const out = await run(w, good());
    assert.deepEqual(out, { family: "OPPORTUNITY", recordId: "opp-1", operatingCompanyId: "taylor", editVersion: 4, inheritedSalesAgreementIds: [], replayed: false }, what);
    assert.equal(auditsOf(w).length, 1, `${what}: ONE audit row`);
    assert.deepEqual(auditsOf(w)[0].after, { operatingCompanyId: "taylor", operatingCompanyKey: "taylor-ops", editVersion: 4, inheritedSalesAgreementIds: [] });
    assert.ok(w.committed(), what);
  }
});

test("7c. an Agreement in ANOTHER company refuses the WHOLE command (nothing overwritten, zero trace); a hidden one is refused in the neutral words", async () => {
  const w = world({ opportunity: oppRow(), disagreeingChild: "ventana-ops", childVisible: false, children: [{ id: "sag-child" }] });
  const err = await run(w, good());
  assert.deepEqual([err.code, err.category, err.message], ["LINEAGE_DISAGREEMENT", "PRECONDITION_FAILED", NEUTRAL]);
  zeroTrace(w, "a differing child");
  assert.ok(!w.log.some((l) => /^UPDATE/.test(l.s)), "not even the parent UPDATE ran: the conflict is found first");
});

test("8. APPLIED Agreement under an Opportunity that already carries the SAME company: one UPDATE, one audit row", async () => {
  const w = world({ agreement: agrRow(), parentKey: "taylor-ops" });
  const out = await run(w, good({ family: "SALES_AGREEMENT", recordId: "sag-1", idempotencyKey: "k-2" }));
  assert.deepEqual(out, { family: "SALES_AGREEMENT", recordId: "sag-1", operatingCompanyId: "taylor", editVersion: null, inheritedSalesAgreementIds: [], replayed: false });
  const updates = w.writes().filter((x) => /^UPDATE/.test(x.s));
  assert.equal(updates.length, 1);
  assert.match(updates[0].s, /^UPDATE eos_commercial\.sales_agreements SET operating_company_key = \$3.*WHERE tenant_id = \$1 AND id = \$2 AND operating_company_key IS NULL$/);
  const audit = w.log.find((l) => /^INSERT INTO eos_policy\.audit_events/.test(l.s)).params;
  assert.equal(audit[4], "salesAgreement");
  assert.deepEqual(JSON.parse(audit[7]), { operatingCompanyId: "taylor", operatingCompanyKey: "taylor-ops", editVersion: null, inheritedSalesAgreementIds: [] });
  // An Agreement with NO Opportunity chooses freely among the companies the caller reaches.
  const free = world({ agreement: agrRow({ opportunity_id: null }) });
  assert.equal((await run(free, good({ family: "SALES_AGREEMENT", recordId: "sag-1", idempotencyKey: "k-3" }))).replayed, false);
});

test("9a. the record id is trimmed BEFORE the replay identity is built: a padded id replays the same command, and a different record is still refused", async () => {
  const receipt = { result: { family: "OPPORTUNITY", recordId: "opp-1", operatingCompanyId: "taylor", editVersion: 4 }, target_family: "opportunity", target_id: "opp-1" };
  const padded = world({ receipt });
  const out = await run(padded, good({ recordId: "  opp-1  " }));
  assert.deepEqual(out, { ...receipt.result, replayed: true });
  assert.deepEqual(padded.writes(), []);
  const other = await run(world({ receipt }), good({ recordId: " opp-2 " }));
  assert.equal(other.code, "IDEMPOTENCY_KEY_REUSED");
  // and an APPLIED command records the trimmed id as its receipt target
  const w = world({ opportunity: oppRow() });
  await run(w, good({ recordId: " opp-1 " }));
  const stored = w.log.find((l) => /^INSERT INTO eos_commercial\.command_receipts/.test(l.s)).params;
  assert.deepEqual([stored[5], stored[6]], ["opportunity", "opp-1"]);
});

test("9. REPLAY writes nothing; a key reused on another record (or another family) is IDEMPOTENCY_KEY_REUSED", async () => {
  const receipt = { result: { family: "OPPORTUNITY", recordId: "opp-1", operatingCompanyId: "taylor", editVersion: 4 }, target_family: "opportunity", target_id: "opp-1" };
  const same = world({ receipt });
  const out = await run(same, good());
  assert.deepEqual(out, { ...receipt.result, replayed: true });
  assert.deepEqual(same.writes(), []);
  assert.ok(same.committed());
  assert.ok(!same.log.some((l) => /FOR UPDATE/.test(l.s)), "a replay never reaches the record");
  for (const other of [good({ recordId: "opp-2" }), good({ family: "SALES_AGREEMENT" }), good({ family: "SALES_ORDER" })]) {
    const w = world({ receipt });
    const err = await run(w, other);
    assert.deepEqual([err.code, err.category], ["IDEMPOTENCY_KEY_REUSED", "CONFLICT"], JSON.stringify(other));
    assert.deepEqual(w.writes(), []);
  }
});

test("10. a concurrent change that leaves the UPDATE with no row is a CONFLICT, rolled back", async () => {
  const w = world({ opportunity: oppRow() });
  const real = w.pool.connect;
  w.pool.connect = async () => {
    const c = await real();
    const q = c.query.bind(c);
    return { ...c, query: async (sql, p) => (/^\s*UPDATE eos_commercial\.opportunities/.test(String(sql)) ? { rowCount: 0, rows: [] } : q(sql, p)), release: c.release };
  };
  const err = await run(w, good());
  assert.deepEqual([err.code, err.category], ["CONCURRENT_MODIFICATION", "CONFLICT"]);
  assert.ok(!w.log.some((l) => /audit_events|command_receipts \(/.test(l.s) && /^INSERT/.test(l.s)), "no audit row, no receipt");
});

// ════════════════════ the server-decided offer ════════════════════

const offerDb = (rows, parentKey) => ({ async query(sql) {
  if (/FROM eos_commercial\.opportunities/.test(sql)) return { rows: [{ operating_company_key: parentKey ?? null }] };
  return { rows };
} });
const BOUND = [{ operating_company_id: "taylor", operating_company_key: "taylor-ops" }, { operating_company_id: "ventana", operating_company_key: "ventana-ops" }];
const held = { capabilities: new Set([KEY]) };

test("11. the offer: only a company-less record, a holder, and the companies the caller REACHES; an Agreement is offered only its Opportunity's company", async () => {
  const offer = (actor, rec, db = offerDb(BOUND)) => offerModule.readOperatingCompanyAssignmentOffer(db, "t1", actor, reach(), rec);
  assert.deepEqual(await offer(held, { operatingCompanyKey: null }), { companies: [{ operatingCompanyId: "taylor" }] }, "Ventana is not reached");
  assert.equal(await offer(held, { operatingCompanyKey: "taylor-ops" }), null, "already has a company");
  assert.equal(await offer({ capabilities: new Set(["opportunity.write"]) }, { operatingCompanyKey: null }), null, "not a holder");
  const all = authority.commercialCompanyReachOf({ unrestricted: true, protectedOwner: false, companyKeys: [], employeeIds: [], creatorId: "p-9" });
  assert.deepEqual(await offerModule.readOperatingCompanyAssignmentOffer(offerDb(BOUND), "t1", held, all, { operatingCompanyKey: null }),
    { companies: [{ operatingCompanyId: "taylor" }, { operatingCompanyId: "ventana" }] });
  const sag = { operatingCompanyKey: null, parentOpportunityId: "opp-1" };
  assert.equal(await offer(held, sag, offerDb(BOUND, null)), null, "its Opportunity has no company: correct the Opportunity first");
  assert.deepEqual(await offer(held, sag, offerDb(BOUND, "taylor-ops")), { companies: [{ operatingCompanyId: "taylor" }] });
  assert.equal(await offer(held, sag, offerDb(BOUND, "ventana-ops")), null, "its Opportunity's company is not one the caller reaches");
  assert.equal(await offer({ capabilities: new Set() }, sag, offerDb(BOUND, "taylor-ops")), null);
});

// ════════════════════ structure ════════════════════

test("STRUCTURE: ONE new capability, held globally, registered by NO grant; the transport serves exactly one new operation", () => {
  assert.equal(kernel.COMMERCIAL_RECORD_COMPANY_ASSIGN_CAPABILITY, KEY);
  assert.ok(!Object.values(kernel.COMMERCIAL_CAPABILITIES).includes(KEY), "it is not one of the migration-023 Commercial vocabulary keys");
  assert.ok(http.COMMERCIAL_MUTATION_OPERATIONS.includes("assignRecordOperatingCompany"));
  assert.equal(http.COMMERCIAL_MUTATION_OPERATIONS.length, 15);
  // No grant anywhere: not the governed baseline, not any seed, and no migration that names it also writes a grant.
  const baseline = readFileSync(join(SRC, "adminPolicy", "seed", "roleCapabilityAuthorityBaseline.json"), "utf8");
  assert.ok(!baseline.includes(KEY), "the authority baseline grants it to nobody");
  for (const f of readdirSync(join(SRC, "adminPolicy", "seed"))) assert.ok(!readFileSync(join(SRC, "adminPolicy", "seed", f), "utf8").includes(KEY), `${f} names it`);
  for (const f of readdirSync(join(FUNCTIONS, "migrations")).filter((x) => x.endsWith(".sql"))) {
    const sql = readFileSync(join(FUNCTIONS, "migrations", f), "utf8").split("-- Down Migration")[0].replace(/^\s*--.*$/gm, "");
    if (sql.includes(KEY)) assert.doesNotMatch(sql, /role_capabilities|principal_capabilities/i, `${f} registers the key and also grants`);
  }
  // It is an ADMIN-grantable BUSINESS_ACTION by key only: the protected Administrator does not imply it (BUSINESS_ACTION is not an implied kind).
  const impl = require("../lib/adminPolicy/protectedAdministrator.js");
  assert.equal(impl.isImpliedForProtectedAdministrator({ key: KEY, objectKey: "opportunity", actionKind: "BUSINESS_ACTION" }), false);
});

test("STRUCTURE: the command locks through the Q-1a store, never reads the record unscoped, never sets a company by overwrite, and records its reason", () => {
  const src = code("eosCommercial/commands/commercialRecordCompanyService.ts");
  assert.match(ACTION, /^[a-z][A-Za-z]*\.[a-z][A-Za-z]*$/, "the operation must satisfy command_receipts.operation's CHECK (exactly two segments)");
  assert.match(src, /runCommercialCommand\(deps, actor, "recordCompany\.assign"/);
  assert.match(src, /lockOpportunity\(db, tenantId, recordId, scope\)/);
  assert.match(src, /lockAgreement\(db, tenantId, recordId, scope\)/);
  // 4 = the 3 UPDATEs (the parent, the inheriting children, the Agreement), each requiring the company to still be NULL, plus the ONE creator-authority read of the
  // company-less children that would inherit (SELECT DISTINCT created_by ... WHERE tenant_id AND opportunity_id: one lookup on sales_agreements_by_opportunity, bounded by that
  // Opportunity's Agreements). The count was verified against the source, not just bumped.
  assert.equal([...src.matchAll(/operating_company_key IS NULL/g)].length, 4, "every UPDATE (the parent, the inheriting children, the Agreement) requires the company to still be NULL, plus the creator read of the heirs");
  assert.equal([...src.matchAll(/UPDATE eos_commercial\.\w+ SET operating_company_key[^`]*operating_company_key IS NULL/g)].length, 3, "exactly three UPDATEs, each NULL-only");
  assert.match(src, /SELECT DISTINCT created_by FROM eos_commercial\.sales_agreements WHERE tenant_id = \$1 AND opportunity_id = \$2 AND operating_company_key IS NULL/, "the extra occurrence is the heirs' creator read");
  assert.doesNotMatch(src, /companyReach/, "the creator's authority is resolved by the governed resolver, never through the injectable test seam");
  assert.ok(src.indexOf("LINEAGE_DISAGREEMENT") < src.indexOf("await requireCreatorAuthority()"), "lineage validation, then the creator check");
  assert.ok(src.lastIndexOf("await requireCreatorAuthority()") < src.lastIndexOf("UPDATE eos_commercial.sales_agreements SET operating_company_key = $3, updated_by") && src.indexOf("await requireCreatorAuthority()") < src.indexOf("UPDATE eos_commercial.opportunities SET"), "and the creator check precedes every write");
  assert.doesNotMatch(src, /SET operating_company_key = \$3, edit_version[^`]*sales_agreements|cascade(?!d)/i, "no cascade verb; inheritance is the NULL-only UPDATE below");
  assert.doesNotMatch(src, /operating_company_key = NULL/, "no clear");
  assert.match(src, /action: "recordCompany\.assign"[\s\S]*reason,/);
  assert.ok(src.indexOf("lockOpportunity(") < src.indexOf("operatingCompanyKeyFor(") && src.indexOf("operatingCompanyKeyFor(") < src.indexOf("OPERATING_COMPANY_ALREADY_SET"), "visibility, target, then still-company-less");
  assert.ok(src.indexOf("OPERATING_COMPANY_ALREADY_SET") < src.indexOf("LINEAGE_DISAGREEMENT"), "still-company-less, then lineage");
  assert.doesNotMatch(src, /sales_orders/, "an Order is NOT NULL and never applies");
  // The offer is a read: it writes nothing and takes no lock.
  assert.doesNotMatch(code("eosCommercial/recordCompanyOffer.ts"), /\b(INSERT|UPDATE|DELETE)\b|FOR UPDATE/);
});

test("STRUCTURE: both record details carry the SERVER's offer, decided on the real parent before the link is masked; the field is absent when not offered", () => {
  const opp = code("eosCommercial/reads/opportunityReadProjection.ts");
  assert.match(opp, /readOperatingCompanyAssignmentOffer\(db, tenantId, actor, reach\.company, \{ operatingCompanyKey: r\.operating_company_key \?\? null \}\)/);
  assert.match(opp, /\.\.\.\(assignment \? \{ operatingCompanyAssignment: assignment \} : \{\}\)/);
  const sag = code("eosCommercial/reads/salesAgreementReadProjection.ts");
  assert.ok(sag.indexOf("const parentOpportunityId") < sag.indexOf("await maskUnreachedLinks(db, tenantId, reach.company, [r]"), "the parent id is captured before the link is masked");
  assert.match(sag, /readOperatingCompanyAssignmentOffer\(db, tenantId, actor, reach\.company, \{ operatingCompanyKey: r\.operating_company_key \?\? null, parentOpportunityId \}\)/);
  assert.match(sag, /\.\.\.\(assignment \? \{ operatingCompanyAssignment: assignment \} : \{\}\)/);
});

// ════════════════════ named-only grant (security review, follow-up 1) ════════════════════

test("NAMED-ONLY GRANT: an object-wide GRANT of `opportunity` never confers commercial.recordCompany.assign, and the preview (the same command) does not list it; a REVOKE may still sweep it; it stays grantable by NAME", async () => {
  const commands = require("../lib/adminPolicy/policyCommands.js");
  const oa = require("../lib/adminPolicy/objectSecurityAuthority.js");
  const CAPS = [
    { id: "c-w", key: "opportunity.write", objectKey: "opportunity", actionKey: "write", actionKind: "EDIT" },
    { id: "c-s", key: "opportunity.createSalesOrder", objectKey: "opportunity", actionKey: "createSalesOrder", actionKind: "BUSINESS_ACTION" },
    { id: "c-a", key: KEY, objectKey: "opportunity", actionKey: "assignOperatingCompany", actionKind: "BUSINESS_ACTION" },
  ];
  const roles = [{ id: "r-admin", key: "admin", protected: true }, { id: "r-lead", key: "salesLead", protected: false }];
  const repo = () => ({
    listCapabilities: async () => CAPS,
    getMembership: async () => ({ status: "active" }), getPrincipal: async (id) => ({ id, status: "active" }), getAccessVersion: async () => ({ accessVersion: 1 }),
    listRoles: async () => roles,
    listAssignmentsForPrincipal: async () => [{ id: "a1", roleId: "r-admin", status: "active", scopeType: "global", accessVersionAtGrant: 1 }],
    getLinkedEmployeeAccessFact: async () => ({ employeeId: "e-1", employmentStatus: "ACTIVE" }),
    listRoleCapabilities: async () => [], getRoleByKey: async () => roles[1],
    getObjectByKey: async () => ({ key: "opportunity" }),
    transact: async () => { throw new Error("the stub never opens a transaction"); },
  });
  const admin = Object.freeze({ tenantId: "t1", uid: "p-admin", heldRoleKeys: ["admin"], protectedAdministrator: true, capabilities: new Set(["admin.securityPolicy.write"]) });
  const wide = (mode, extra = {}) => ({ objectKey: "opportunity", roleKey: "salesLead", mode, reason: "r", ...extra });
  assert.deepEqual([...oa.NAMED_ONLY_GRANT_CAPABILITIES], [KEY]);
  const grant = await commands.applyObjectWideRoleAuthority(repo(), admin, wide("GRANT"));
  assert.deepEqual(grant.actions.map((a) => a.capabilityKey).sort(), ["opportunity.createSalesOrder", "opportunity.write"], "the object-wide GRANT (and so its preview) does not list or confer the key");
  const byKind = await commands.applyObjectWideRoleAuthority(repo(), admin, wide("GRANT", { actionKinds: ["BUSINESS_ACTION"] }));
  assert.deepEqual(byKind.actions.map((a) => a.capabilityKey), ["opportunity.createSalesOrder"], "even asking for the BUSINESS_ACTION kind does not confer it");
  const revoke = await commands.applyObjectWideRoleAuthority(repo(), admin, wide("REVOKE"));
  assert.ok(revoke.actions.some((a) => a.capabilityKey === KEY), "a REVOKE may still sweep it: revoking only reduces authority");
  // the Object still LISTS the action, so it can be granted by naming it
  assert.ok(oa.actionsForObject(CAPS, "opportunity").some((c) => c.key === KEY));
  // the preview is the same command: the port routes applyObjectWideRoleAuthority to it, so there is no second expansion to leak the key
  assert.doesNotMatch(readFileSync(join(SRC, "adminPolicy", "authorityChangePreviewPort.ts"), "utf8"), /actionsForObject/);
  assert.equal([...readFileSync(join(SRC, "adminPolicy", "policyCommands.ts"), "utf8").matchAll(/NAMED_ONLY_GRANT_CAPABILITIES/g)].length, 2, "imported and applied once, in the object-wide expansion only");
});

// ════════════════════ creator authority (Owner ruling 2026-10-21: "company assignment constrained by the record creator's company authority; no Administrator bypass") ════════════════════

const bothReach = { companyReach: async () => authority.commercialCompanyReachOf({ unrestricted: false, protectedOwner: false, companyKeys: ["taylor-ops", "ventana-ops"], employeeIds: ["e-owner"], creatorId: "p-1" }) };
const adminReach = { companyReach: async () => authority.commercialCompanyReachOf({ unrestricted: true, protectedOwner: false, companyKeys: [], employeeIds: [], creatorId: "p-1" }) };
const TRANSFER = "COMPANY_TRANSFER_DECISION_REQUIRED";

test("CREATOR AUTHORITY: every shortfall of the creator -- outside the company, no Employee link, no standing, no creator -- is one neutral refusal, after lineage, with zero trace; no actor reach (even unrestricted) bypasses it", async () => {
  const cases = [
    ["a creator outside the target company", { createdBy: "p-creator" }, "ventana", bothReach],
    ["the unrestricted Administrator, creator outside the company", { createdBy: "p-creator" }, "ventana", adminReach],
    ["a creator with no Employee link", { createdBy: "p-unlinked" }, "taylor", {}],
    ["a creator that does not exist", { createdBy: "p-ghost" }, "taylor", {}],
    ["no creator recorded", { createdBy: null }, "taylor", {}],
  ];
  for (const [what, cfg, company, over] of cases) {
    const w = world({ opportunity: oppRow(), ...cfg });
    const err = await run(w, good({ operatingCompanyId: company }), ACTOR, over);
    assert.deepEqual([err.code, err.category], [TRANSFER, "PRECONDITION_FAILED"], what);
    assert.match(err.message, /separate governed transfer decision/);
    assert.doesNotMatch(err.message, /taylor|ventana/i, `${what}: names no company`);
    zeroTrace(w, what);
  }
  // Lineage is validated BEFORE the creator check: a disagreeing Agreement still answers LINEAGE_DISAGREEMENT even though the creator is outside the company.
  const lin = world({ opportunity: oppRow(), disagreeingChild: "ventana-ops", createdBy: "p-creator" });
  assert.equal((await run(lin, good())).code, "LINEAGE_DISAGREEMENT");
  zeroTrace(lin, "lineage first");
});

test("CREATOR AUTHORITY: a child that would inherit is checked too, and one failing creator refuses the whole command", async () => {
  const w = world({ opportunity: oppRow(), createdBy: "p-dual", children: [{ id: "sag-child" }], heirCreators: ["p-dual", "p-creator"] });
  const err = await run(w, good({ operatingCompanyId: "ventana" }), ACTOR, bothReach);
  assert.equal(err.code, TRANSFER);
  zeroTrace(w, "child creator lacks Ventana");
  const open = world({ opportunity: oppRow(), createdBy: "p-dual", children: [{ id: "sag-child" }], heirCreators: ["p-dual"] });
  const out = await run(open, good({ operatingCompanyId: "ventana" }), ACTOR, bothReach);
  assert.deepEqual([out.replayed, out.inheritedSalesAgreementIds], [false, ["sag-child"]], out.message);
});

test("CREATOR AUTHORITY: the creator's home company and an explicit grant are accepted; an Agreement is checked on its own creator", async () => {
  const home = world({ opportunity: oppRow(), createdBy: "p-creator" });
  assert.equal((await run(home, good())).replayed, false);
  const dual = world({ opportunity: oppRow(), createdBy: "p-dual" });
  assert.equal((await run(dual, good({ operatingCompanyId: "ventana" }), ACTOR, bothReach)).replayed, false);
  const agr = world({ agreement: agrRow({ opportunity_id: null }), createdBy: "p-creator" });
  const err = await run(agr, good({ family: "SALES_AGREEMENT", recordId: "sag-1", operatingCompanyId: "ventana" }), ACTOR, bothReach);
  assert.equal(err.code, TRANSFER);
  zeroTrace(agr, "Agreement, creator outside Ventana");
});
