// SAL-03(c) (P0, Owner security ruling 2026-10-21): SERVER-SIDE OWNER ELIGIBILITY ON COMPANY-LESS COMMERCIAL RECORDS.
//
// A company-less Opportunity / Sales Agreement is visible and writable to its owner (Q-1a). Before this fix a creator could NAME a foreign-company Employee
// as that owner and push the record (account, need, lines, pricing, discount) across the Taylor/Ventana boundary. The rule now enforced in the commercial
// command kernel (requireEligibleCompanylessOwner), for a NEW owner at creation or reassignment of a company-less record only:
//   the owner is (1) the creator's own linked Employee (actor at creation; the record's STORED creator at reassignment), or
//                 (2) the Account's governed owner, when that owner's home company is inside the creator's company authority.
// Refusals reuse the words of an owner that does not exist (OWNER_NOT_FOUND) -- or, for a merely INHERITED owner, of an Account with nothing to inherit
// (OWNER_REQUIRED) -- so they never say that a foreign Employee exists. Company-keyed records keep today's behaviour; historical owners are never re-judged.
//
// Real PostgreSQL, real command and read services, real server-side refusals; nothing injected. World = the reproduction world (Taylor and Ventana).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";
import { endPoolAndDrain } from "./support/poolTeardown.mjs";
import { bindOperatingCompany } from "./support/governedOperatingCompanyBinding.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const opp = require("../lib/eosCommercial/commands/opportunityCommandService.js");
const sa = require("../lib/eosCommercial/commands/salesAgreementCommandService.js");
const oppRead = require("../lib/eosCommercial/reads/opportunityReadProjection.js");
const saRead = require("../lib/eosCommercial/reads/salesAgreementReadProjection.js");

const DB_NAME = `sal03f_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => { const u = new URL(URL_BASE); u.pathname = `/${DB_NAME}`; return u.toString(); };
async function withClient(url, fn) { const c = new pg.Client({ connectionString: url }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }

const T = "t1";
const CAPS = new Set(["opportunity.read", "opportunity.write", "salesAgreement.read", "salesAgreement.create", "salesAgreement.updateDraft"]);
const key = () => `k-${randomUUID()}`;
const catalog = { async verifyReferences(_db, _t, refs) { return refs.map(() => "FOUND"); } };
const outcome = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, code: e?.code ?? e?.name, category: e?.category, message: String(e?.message ?? e) }));

test("SAL-03(c): owner eligibility on company-less Opportunities and Sales Agreements", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], { maxBuffer: 256 * 1024 * 1024,
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe" });
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 8 });
  t.after(async () => { await endPoolAndDrain(pool); await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`)); });
  const q = (text, values = []) => pool.query(text, values);
  const wdeps = { pool, catalog };
  const rdeps = { pool };

  // ── the world: Taylor and Ventana, two Employees each, one linked Principal each, and the accounts ──
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1')`);
  for (const ch of ["NATIONAL_ACCOUNTS", "RETAIL"]) {
    await q(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id, sales_channel, status, source, established_by, updated_by) VALUES ('t1',$1,'ACTIVE','fixture','fixture','fixture')`, [ch]);
  }
  await bindOperatingCompany(q, T, "taylor", "taylor-ops-t1");
  await bindOperatingCompany(q, T, "ventana", "ventana-ops-t1");
  // A company that is governed but has NO active key binding: its Employee's home company cannot be shown to lie inside anyone's authority.
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by) VALUES ('t1','unkeyed','ACTIVE','test-fixture','fixture','fixture')`);
  for (const [id, co] of [["e-tay", "taylor"], ["e-tay2", "taylor"], ["e-ven", "ventana"], ["e-ven2", "ventana"], ["e-nohome", "unkeyed"]]) {
    await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at) VALUES ($1,'t1','ACTIVE',$2,'2020-01-01T00:00:00Z')`, [id, co]);
  }
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, owner_employee_id, created_by, updated_by) VALUES
    ('a-plain','t1','Plain Customer','ACTIVE','e-tay','x','x'),
    ('a-tay2','t1','Taylor-side Customer owned by the second Taylor seller','ACTIVE','e-tay2','x','x'),
    ('a-ven','t1','Ventana-owned Customer','ACTIVE','e-ven','x','x'),
    ('a-nohome','t1','Customer owned by an Employee whose home company has no active key','ACTIVE','e-nohome','x','x'),
    ('a-ownerless','t1','Ownerless Customer','ACTIVE',NULL,'x','x')`);
  const principal = async (id, employeeId, company) => {
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ($1,$1,'proof','active')`, [id]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ($1,'t1',$2)`, [`m-${id}`, id]);
    await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason, status)
             VALUES ($1,'t1',$2,$3,$4,'OPERATOR_ASSERTED','fixture','test','active')`, [`l-${id}`, id, employeeId, company]);
    return id;
  };
  const tay = await principal("p-tay", "e-tay", "taylor");
  const tay2 = await principal("p-tay2", "e-tay2", "taylor");
  const ven = await principal("p-ven", "e-ven", "ventana");
  // The foreign seller ALSO holds sufficient customer-discount authority, seeded the governed way (eos_commercial.sales_discount_authorities).
  await q(`INSERT INTO eos_commercial.sales_discount_authorities (tenant_id, principal_id, max_discount_basis_points, updated_by) VALUES ('t1',$1,1000,'fixture')`, [ven]);
  await q(`INSERT INTO eos_commercial.sales_discount_authorities (tenant_id, principal_id, max_discount_basis_points, updated_by) VALUES ('t1',$1,1000,'fixture')`, [tay]);

  const actor = (principalId, caps = CAPS, scopedHeld = undefined) => ({ tenantId: T, principalId, capabilities: caps, ...(scopedHeld ? { scopedHeld } : {}) });
  const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  const mkOpp = (who, over) => outcome(opp.createOpportunity(wdeps, actor(who), defined({ idempotencyKey: key(), salesChannel: "RETAIL", need: "Reach-in replacement",
    lines: [{ kind: "SERVICE", ref: "svc", qty: 1 }], accountId: "a-plain", ...over })));
  const mkAgr = (who, opportunityId, ownerEmployeeId, over = {}) => outcome(sa.createSalesAgreement(wdeps, actor(who), { idempotencyKey: key(), opportunityId, ownerEmployeeId,
    isLease: false, fulfillmentIntent: "INSTALL", lines: [{ kind: "SERVICE", ref: "svc-install", quantity: 1, unitPrice: 50000, businessUnitId: "INSTALLATION" }],
    shippingMinor: 100, taxMinor: 50, ...over }));
  const editVersion = async (id) => Number((await q(`SELECT edit_version FROM eos_commercial.opportunities WHERE id=$1`, [id])).rows[0].edit_version);
  const editOpp = async (who, id, over) => outcome(opp.updateOpportunity(wdeps, actor(who), { idempotencyKey: key(), opportunityId: id, expectedEditVersion: await editVersion(id), ...over }));
  const oppRow = async (id) => (await q(`SELECT operating_company_key, owner_employee_id, created_by FROM eos_commercial.opportunities WHERE id=$1`, [id])).rows[0];
  const ok = (r, label) => assert.equal(r.ok, true, `${label}: ${JSON.stringify(r)}`);
  const OWNER_NOT_FOUND = (r, label) => { assert.equal(r.ok, false, `${label}: expected a refusal`); assert.equal(r.code, "OWNER_NOT_FOUND", label); assert.equal(r.category, "NOT_FOUND", label); };
  const NOT_THERE = (r, label) => { assert.equal(r.ok, false, label); assert.equal(r.code, "RECORD_NOT_FOUND", `${label}: ${JSON.stringify(r)}`); };
  const countOppsOwnedBy = async (employeeId) => Number((await q(`SELECT count(*) AS n FROM eos_commercial.opportunities WHERE owner_employee_id=$1`, [employeeId])).rows[0].n);

  // The OWNER-NOT-FOUND words for a name that does not exist at all: the refusal for a foreign Employee must be indistinguishable from it.
  const ghost = await mkOpp(tay, { ownerEmployeeId: "e-does-not-exist" });
  assert.equal(ghost.ok, false);
  const stripId = (m, id) => m.split(id).join("<ID>");

  await t.test("NEGATIVE: creation naming a foreign-company Employee is refused in both directions, with the words of a nonexistent owner", async () => {
    const tToV = await mkOpp(tay, { ownerEmployeeId: "e-ven" });
    OWNER_NOT_FOUND(tToV, "Taylor creator -> Ventana owner");
    assert.equal(stripId(tToV.message, "e-ven"), stripId(ghost.message, "e-does-not-exist"), "same words as a nonexistent owner");
    const vToT = await mkOpp(ven, { accountId: "a-ven", ownerEmployeeId: "e-tay" });
    OWNER_NOT_FOUND(vToT, "Ventana creator -> Taylor owner");
    assert.equal(await countOppsOwnedBy("e-ven"), 0);
    assert.equal(await countOppsOwnedBy("e-tay"), 0);
  });

  await t.test("NEGATIVE: no OTHER Employee may be named, even a same-company one who is neither the creator nor the Account's owner", async () => {
    OWNER_NOT_FOUND(await mkOpp(tay, { ownerEmployeeId: "e-tay2" }), "same-company bystander on a-plain (owner e-tay)");
    OWNER_NOT_FOUND(await mkOpp(tay, { ownerEmployeeId: "e-nohome" }), "an Employee whose home company has no active key");
    assert.equal(await countOppsOwnedBy("e-tay2"), 0);
  });

  await t.test("NEGATIVE: an account-inherited owner from the OTHER company is a refusal, blank or named (D-4 unchanged: no default to the signed-in Employee)", async () => {
    const blank = await mkOpp(tay, { accountId: "a-ven" });
    assert.equal(blank.ok, false);
    assert.equal(blank.code, "OWNER_REQUIRED", "inherited foreign owner reads as an Account with nothing to inherit");
    assert.equal(blank.category, "INVALID_INPUT");
    assert.ok(!blank.message.includes("e-ven"), "the refusal never names the foreign Employee");
    const named = await mkOpp(tay, { accountId: "a-ven", ownerEmployeeId: "e-ven" });
    OWNER_NOT_FOUND(named, "explicitly naming the foreign account owner");
    const reverse = await mkOpp(ven, { accountId: "a-tay2" });
    assert.equal(reverse.code, "OWNER_REQUIRED", "Ventana creator, Taylor-owned account");
    OWNER_NOT_FOUND(await mkOpp(ven, { accountId: "a-tay2", ownerEmployeeId: "e-tay2" }), "Ventana creator naming the Taylor account owner");
    // An account owner whose home company has no active key cannot be shown to be inside the creator's companies: fail closed.
    assert.equal((await mkOpp(tay, { accountId: "a-nohome" })).code, "OWNER_REQUIRED");
    assert.equal(await countOppsOwnedBy("e-ven"), 0);
  });

  await t.test("NEGATIVE: forged provenance (createdBy / creator / inheritedOwner in the input) is ignored or refused", async () => {
    const forged = { createdBy: ven, creatorPrincipalId: ven, recordCreatorPrincipalId: ven, created_by: ven };
    OWNER_NOT_FOUND(await mkOpp(tay, { ownerEmployeeId: "e-ven", ...forged }), "forged creator fields do not make a foreign owner eligible");
    const inh = await mkOpp(tay, { ownerEmployeeId: "e-ven", inheritedOwner: { resolution: "RESOLVED", owner: { type: "USER", id: "e-ven" } } });
    assert.equal(inh.ok, false);
    assert.equal(inh.code, "FIELD_NOT_ACCEPTED", "inheritedOwner is server-derived");
    // Forged creator fields on an otherwise legitimate create are ignored: the stored creator is the authenticated actor.
    const legit = await mkOpp(tay, { ownerEmployeeId: "e-tay", ...forged });
    if (legit.ok) assert.equal((await oppRow(legit.v.opportunityId)).created_by, tay);
    const o = await mkOpp(tay, { ownerEmployeeId: "e-tay" });
    ok(o, "setup");
    OWNER_NOT_FOUND(await mkAgr(tay, o.v.opportunityId, "e-ven", forged), "Agreement: forged creator fields with a foreign owner");
    assert.equal(await countOppsOwnedBy("e-ven"), 0);
  });

  await t.test("NEGATIVE: a company-less Agreement with a foreign named owner is refused; creator / account-owner Agreements are allowed", async () => {
    const o = await mkOpp(tay, { ownerEmployeeId: "e-tay" });
    ok(o, "setup opportunity");
    OWNER_NOT_FOUND(await mkAgr(tay, o.v.opportunityId, "e-ven"), "foreign Agreement owner");
    OWNER_NOT_FOUND(await mkAgr(tay, o.v.opportunityId, "e-tay2"), "same-company bystander Agreement owner (not creator, not account owner)");
    ok(await mkAgr(tay, o.v.opportunityId, "e-tay"), "the creator names themself on the Agreement");
    const o2 = await mkOpp(tay, { accountId: "a-tay2" });   // blank owner inherits e-tay2 (same company)
    ok(o2, "setup inherited");
    ok(await mkAgr(tay, o2.v.opportunityId, "e-tay2"), "the Opportunity's Account owner (same company) is eligible");
  });

  await t.test("NEGATIVE: reassigning a company-less Opportunity to a foreign (or bystander) Employee is refused and the owner does not move", async () => {
    const o = await mkOpp(tay, { ownerEmployeeId: "e-tay" });
    ok(o, "setup");
    const id = o.v.opportunityId;
    OWNER_NOT_FOUND(await editOpp(tay, id, { ownerEmployeeId: "e-ven" }), "reassign to the foreign Employee");
    OWNER_NOT_FOUND(await editOpp(tay, id, { ownerEmployeeId: "e-tay2" }), "reassign to a same-company bystander");
    assert.equal((await oppRow(id)).owner_employee_id, "e-tay");
    // Judged against the STORED creator (p-tay), never the editor: the owner (not the creator) cannot hand it to themself-as-editor either, and a forged field changes nothing.
    OWNER_NOT_FOUND(await editOpp(tay, id, { ownerEmployeeId: "e-ven", createdBy: ven, creatorPrincipalId: ven }), "forged creator on reassignment");
    assert.equal((await oppRow(id)).owner_employee_id, "e-tay");
    // The account-owner path on reassignment: a-tay2's owner is e-tay2 -> move the Opportunity onto it and reassign in one edit (new account is the inheritance source).
    ok(await editOpp(tay, id, { accountId: "a-tay2", ownerEmployeeId: "e-tay2" }), "reassign to the (same-company) account owner");
    assert.equal((await oppRow(id)).owner_employee_id, "e-tay2");
    // ... and the foreign account owner stays refused on reassignment.
    const o3 = await mkOpp(tay, { ownerEmployeeId: "e-tay" });
    OWNER_NOT_FOUND(await editOpp(tay, o3.v.opportunityId, { accountId: "a-ven", ownerEmployeeId: "e-ven" }), "reassign to the foreign account owner");
  });

  await t.test("AFTER the fix, the foreign seller (even with discount authority) reaches nothing of a Taylor company-less record, and cannot be handed one", async () => {
    const o = await mkOpp(tay, { ownerEmployeeId: "e-tay" });
    ok(o, "setup");
    const a = await mkAgr(tay, o.v.opportunityId, "e-tay");
    ok(a, "setup agreement");
    const id = o.v.opportunityId, aid = a.v.salesAgreementId;
    NOT_THERE(await outcome(oppRead.getOpportunityDetail(rdeps, actor(ven), { opportunityId: id })), "foreign read");
    assert.equal((await oppRead.listOpportunities(rdeps, actor(ven), {})).items.some((i) => i.id === id), false, "foreign list");
    NOT_THERE(await editOpp(ven, id, { need: "foreign edit" }), "foreign edit");
    NOT_THERE(await editOpp(ven, id, { ownerEmployeeId: "e-ven" }), "foreign reassignment");
    NOT_THERE(await outcome(saRead.getSalesAgreementDetail(rdeps, actor(ven), { salesAgreementId: aid })), "foreign pricing view");
    NOT_THERE(await outcome(sa.updateSalesAgreementDraft(wdeps, actor(ven), { idempotencyKey: key(), salesAgreementId: aid, specialInstructions: "x" })), "foreign draft edit");
    NOT_THERE(await outcome(sa.updateSalesAgreementDraft(wdeps, actor(ven), { idempotencyKey: key(), salesAgreementId: aid, customerDiscount: { kind: "PERCENT", percentBasisPoints: 500 } })),
      "foreign discount with sufficient discount authority");
    // the reverse direction: a Ventana company-less record is invisible to Taylor sellers
    const ov = await mkOpp(ven, { accountId: "a-ven", ownerEmployeeId: "e-ven" });
    ok(ov, "setup Ventana");
    NOT_THERE(await outcome(oppRead.getOpportunityDetail(rdeps, actor(tay), { opportunityId: ov.v.opportunityId })), "Taylor reading the Ventana record");
    NOT_THERE(await editOpp(tay, ov.v.opportunityId, { ownerEmployeeId: "e-tay" }), "Taylor reassigning the Ventana record");
    ok(await outcome(sa.updateSalesAgreementDraft(wdeps, actor(tay), { idempotencyKey: key(), salesAgreementId: aid, customerDiscount: { kind: "PERCENT", percentBasisPoints: 500 } })),
      "control: the creator's own discount (authorized, same company) is applied");
  });

  await t.test("POSITIVE: the creator names themself; a blank owner inherits a same-company account owner (D-4); a blank owner with no account owner is refused", async () => {
    const self = await mkOpp(tay, { ownerEmployeeId: "e-tay" });
    ok(self, "creator names themself");
    assert.deepEqual(await oppRow(self.v.opportunityId), { operating_company_key: null, owner_employee_id: "e-tay", created_by: tay });
    const inherited = await mkOpp(tay, { accountId: "a-tay2" });
    ok(inherited, "blank owner inherits the same-company account owner");
    assert.equal((await oppRow(inherited.v.opportunityId)).owner_employee_id, "e-tay2");
    const blank = await mkOpp(tay2, { accountId: "a-plain" });   // blank owner, account owner e-tay is a same-company Employee that is NOT the signed-in one
    ok(blank, "inherits e-tay, never defaults to the signed-in e-tay2");
    assert.equal((await oppRow(blank.v.opportunityId)).owner_employee_id, "e-tay");
    const none = await mkOpp(tay, { accountId: "a-ownerless" });
    assert.equal(none.ok, false);
    assert.equal(none.code, "OWNER_REQUIRED", "D-4: no owner and nothing to inherit is a refusal, never the signed-in employee");
    // named explicitly == the account owner (same company)
    ok(await mkOpp(tay, { accountId: "a-tay2", ownerEmployeeId: "e-tay2" }), "explicitly naming the same-company account owner");
  });

  await t.test("POSITIVE: legitimate company-less operations by the creator and by the owner; transitions; an authorized same-company discount", async () => {
    const o = await mkOpp(tay, { accountId: "a-tay2" });   // creator p-tay, owner e-tay2
    ok(o, "setup");
    const id = o.v.opportunityId;
    ok(await editOpp(tay, id, { need: "edited by the creator" }), "creator edits");
    ok(await editOpp(tay2, id, { need: "edited by the owner" }), "owner edits");
    ok(await outcome(opp.transitionOpportunity(wdeps, actor(tay), { idempotencyKey: key(), opportunityId: id, toStage: "QUALIFYING" })), "creator advances the stage");
    ok(await outcome(opp.transitionOpportunity(wdeps, actor(tay2), { idempotencyKey: key(), opportunityId: id, toStage: "SOLUTION" })), "owner advances the stage");
    ok(await outcome(oppRead.getOpportunityDetail(rdeps, actor(tay2), { opportunityId: id })), "owner reads");
    const a = await mkAgr(tay, id, "e-tay2", { customerDiscount: { kind: "PERCENT", percentBasisPoints: 500 } });
    ok(a, "Agreement with a valid discount by an authorized same-company actor");
    const detail = await saRead.getSalesAgreementDetail(rdeps, actor(tay2), { salesAgreementId: a.v.salesAgreementId });
    assert.ok(detail, "owner reads the Agreement and its pricing");
    ok(await outcome(sa.updateSalesAgreementDraft(wdeps, actor(tay), { idempotencyKey: key(), salesAgreementId: a.v.salesAgreementId, specialInstructions: "creator edit" })), "creator edits the draft");
    // reassignment still works for the creator onto an eligible owner (themself): the owner is currently e-tay2
    ok(await editOpp(tay, id, { ownerEmployeeId: "e-tay" }), "the stored creator reassigns the record to their own Employee");
    assert.equal((await oppRow(id)).owner_employee_id, "e-tay");
  });

  await t.test("POSITIVE/CONTROL: company-KEYED records keep today's behaviour (owner not judged; isolation by company alone); channel restrictions unchanged", async () => {
    const keyed = await mkOpp(tay, { operatingCompanyId: "taylor", accountId: "a-ven", ownerEmployeeId: "e-ven" });
    ok(keyed, "a company-keyed record is not subject to the company-less owner rule");
    NOT_THERE(await outcome(oppRead.getOpportunityDetail(rdeps, actor(ven), { opportunityId: keyed.v.opportunityId })), "isolation holds: the foreign owner still cannot see a company-keyed record");
    NOT_THERE(await editOpp(ven, keyed.v.opportunityId, { need: "x" }), "foreign edit of a company-keyed record");
    ok(await editOpp(tay, keyed.v.opportunityId, { ownerEmployeeId: "e-tay2" }), "company-keyed reassignment unchanged (no company-less rule)");
    // Sales-channel scope: a RETAIL-only writer cannot create a NATIONAL_ACCOUNTS company-less record, owner rule or not.
    const retailOnly = actor(tay, new Set(), [{ capabilityKey: "opportunity.write", scopeType: "salesChannel", scopeValue: "RETAIL", sourceRole: "r", assignmentId: null, condition: null }]);
    const na = await outcome(opp.createOpportunity(wdeps, retailOnly, { idempotencyKey: key(), accountId: "a-plain", salesChannel: "NATIONAL_ACCOUNTS", ownerEmployeeId: "e-tay", need: "n", lines: [{ kind: "SERVICE", ref: "svc", qty: 1 }] }));
    assert.equal(na.code, "OUTSIDE_SALES_CHANNEL_SCOPE");
    ok(await outcome(opp.createOpportunity(wdeps, retailOnly, { idempotencyKey: key(), accountId: "a-plain", salesChannel: "RETAIL", ownerEmployeeId: "e-tay", need: "n", lines: [{ kind: "SERVICE", ref: "svc", qty: 1 }] })), "in-scope channel still works");
  });

  await t.test("POSITIVE: a HISTORICAL owner is never re-judged; only a NEW owner value is checked", async () => {
    const o = await mkOpp(tay, { ownerEmployeeId: "e-tay" });
    ok(o, "setup");
    const id = o.v.opportunityId;
    await q(`UPDATE eos_commercial.opportunities SET owner_employee_id = 'e-ven' WHERE id = $1`, [id]);   // a pre-fix record: foreign owner, company-less
    ok(await editOpp(tay, id, { need: "ordinary edit by the creator" }), "an ordinary edit that does not change the owner is untouched");
    ok(await outcome(opp.transitionOpportunity(wdeps, actor(tay), { idempotencyKey: key(), opportunityId: id, toStage: "QUALIFYING" })), "transitions are untouched");
    assert.equal((await oppRow(id)).owner_employee_id, "e-ven", "no rewrite");
    OWNER_NOT_FOUND(await editOpp(tay, id, { ownerEmployeeId: "e-ven2" }), "but handing it to ANOTHER foreign Employee is a new owner value and is refused");
    ok(await editOpp(tay, id, { ownerEmployeeId: "e-tay" }), "and the creator can take it back");
  });

  await t.test("DOCUMENTED: Sales Orders always carry a company (NOT NULL), so the company-less rule never applies to them", async () => {
    const { rows } = await q(`SELECT is_nullable FROM information_schema.columns WHERE table_schema='eos_commercial' AND table_name='sales_orders' AND column_name='operating_company_key'`);
    assert.equal(rows[0].is_nullable, "NO");
  });
});
