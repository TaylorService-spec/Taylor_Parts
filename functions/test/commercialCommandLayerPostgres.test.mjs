// WAVE C2 against a real postgres:16 -- the governed PostgreSQL Commercial command layer.
//
// Its OWN database, migrated by the normal runner. Every command runs through the real kernel: capability and
// membership authority, one transaction, number allocation, lines, ownership and accountability history, and the
// idempotency receipt. Failures are forced with temporary triggers so rollback is observed, not assumed.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const opp = require("../lib/eosCommercial/commands/opportunityCommandService.js");
const sa = require("../lib/eosCommercial/commands/salesAgreementCommandService.js");
const so = require("../lib/eosCommercial/commands/salesOrderCommandService.js");

const DB_NAME = `c2_commands_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => {
  const u = new URL(URL_BASE);
  u.pathname = `/${DB_NAME}`;
  return u.toString();
};
async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const ALL_CAPS = new Set(["opportunity.write", "opportunity.createSalesOrder", "salesAgreement.create", "salesAgreement.updateDraft", "salesAgreement.accept", "salesOrder.write"]);
const ACTOR = Object.freeze({ tenantId: "t1", principalId: "p1", capabilities: ALL_CAPS });
const OTHER_PRINCIPAL = Object.freeze({ tenantId: "t1", principalId: "p2", capabilities: ALL_CAPS });
const key = () => `k-${randomUUID()}`;
const code = (c) => (e) => e.code === c;
// A catalog authority for tests only: every reference whose ref starts with "missing" does not exist.
const catalog = { async verifyReferences(_db, _t, refs) { return refs.map((r) => (r.ref.startsWith("missing") ? "NOT_FOUND" : "FOUND")); } };

test("governed PostgreSQL Commercial command layer, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe",
  });
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 16 });
  t.after(async () => {
    await pool.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  const q = (text, values = []) => pool.query(text, values);
  const deps = { pool, catalog };
  const bare = { pool }; // no catalog authority: the deployed shape today
  const count = async (table, where = "true", values = []) => (await q(`SELECT count(*)::int n FROM eos_commercial.${table} WHERE ${where}`, values)).rows[0].n;
  const withTrigger = async (table, fn) => {
    const name = `force_fail_${table}`;
    await q(`CREATE OR REPLACE FUNCTION pg_temp_force_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced failure'; END $$ LANGUAGE plpgsql`);
    await q(`CREATE TRIGGER ${name} BEFORE INSERT ON eos_commercial.${table} FOR EACH ROW EXECUTE FUNCTION pg_temp_force_fail()`);
    try {
      await fn();
    } finally {
      await q(`DROP TRIGGER ${name} ON eos_commercial.${table}`);
    }
  };

  // ── the world ──
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, owner_employee_id, created_by, updated_by) VALUES
    ('acct-1','t1','Retail Customer','ACTIVE','e-retail','x','x'), ('acct-ownerless','t1','No Owner','ACTIVE',NULL,'x','x'), ('acct-t2','t2','Other Tenant','ACTIVE',NULL,'x','x')`);
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES
    ('e-retail','t1','ACTIVE','taylor'), ('e-national','t1','ACTIVE','taylor'), ('e-gm','t1','ACTIVE','taylor'), ('e-contractor','t1','CONTRACTOR','taylor'),
    ('e-leave','t1','ON_LEAVE','taylor'), ('e-t2','t2','ACTIVE','taylor')`);
  for (const [p, tenant, status] of [["p1", "t1", "active"], ["p2", "t1", "active"], ["p-outsider", "t2", "active"], ["p-disabled", "t1", "disabled"]]) {
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ($1,$1,'proof',$2)`, [p, status]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ($1,$2,$3)`, [`m-${p}`, tenant, p]);
  }

  const newOpportunity = (overrides = {}) => opp.createOpportunity(deps, ACTOR, {
    idempotencyKey: key(), accountId: "acct-1", salesChannel: "RETAIL", operatingCompanyId: "taylor", need: "Walk-in freezer",
    expectedValue: 18500.5, expectedCloseAt: Date.parse("2026-11-01T00:00:00Z"), lines: [{ kind: "EQUIPMENT_MODEL", ref: "model-a", qty: 1 }, { kind: "PART", ref: "part-b", qty: 2 }],
    ...overrides,
  });
  const STAGES = ["IDENTIFIED", "QUALIFYING", "SOLUTION", "QUOTING", "CUSTOMER_REVIEW", "DECISION"];
  const advanceToDecision = async (id) => {
    const { stage } = (await q(`SELECT stage::text FROM eos_commercial.opportunities WHERE id=$1`, [id])).rows[0];
    for (const toStage of STAGES.slice(STAGES.indexOf(stage) + 1)) {
      await opp.transitionOpportunity(deps, ACTOR, { idempotencyKey: key(), opportunityId: id, toStage });
    }
  };
  const agreementFor = (opportunityId, overrides = {}) => sa.createSalesAgreement(deps, ACTOR, {
    idempotencyKey: key(), opportunityId, ownerEmployeeId: "e-retail", isLease: false, fulfillmentIntent: "INSTALL",
    lines: [{ kind: "EQUIPMENT_MODEL", ref: "model-a", quantity: 1, unitPrice: 1250000 }, { kind: "SERVICE", ref: "svc-install", quantity: 1, unitPrice: 50000, businessUnitId: "INSTALLATION" }],
    shippingMinor: 15000, taxMinor: 8000, ...overrides,
  });

  // ════════════════════ OPPORTUNITY ════════════════════
  let o1;
  await t.test("(1)(3)(5) complete create commits number, row, lines, derived accountable person, history and receipt together", async () => {
    o1 = await newOpportunity({ creditedSalespersonId: "e-national" });
    assert.match(o1.opportunityNumber, /^OPP-\d{4}-000001$/);
    assert.equal(o1.replayed, false);
    assert.equal(o1.editVersion, 1);
    assert.deepEqual([o1.accountableEmployeeId, o1.accountablePersonSource], ["e-retail", "DERIVED_FROM_RECORD_OWNER"], "the Account owner is the upstream owner");
    const row = (await q(`SELECT owner_employee_id, accountable_employee_id, stage::text, sales_channel::text, need, expected_value::text, credited_salesperson_employee_id, created_by FROM eos_commercial.opportunities WHERE id=$1`, [o1.opportunityId])).rows[0];
    assert.deepEqual(row, { owner_employee_id: "e-retail", accountable_employee_id: "e-retail", stage: "IDENTIFIED", sales_channel: "RETAIL", need: "Walk-in freezer", expected_value: "18500.5", credited_salesperson_employee_id: "e-national", created_by: "p1" });
    assert.equal(await count("opportunity_lines", "opportunity_id=$1", [o1.opportunityId]), 2);
    assert.equal(await count("accountability_handoffs", "opportunity_id=$1 AND action='ESTABLISHMENT' AND source='DERIVED_FROM_RECORD_OWNER'", [o1.opportunityId]), 1);
    assert.equal(await count("command_receipts", "target_id=$1 AND operation='opportunity.create'", [o1.opportunityId]), 1);
  });

  await t.test("(2) an incomplete create refuses and writes nothing", async () => {
    const before = await count("opportunities");
    await assert.rejects(newOpportunity({ salesChannel: undefined }), code("CHANNEL_INVALID"));
    await assert.rejects(newOpportunity({ accountId: "acct-ownerless" }), code("OWNER_REQUIRED"), "no owner and no upstream owner");
    await assert.rejects(newOpportunity({ lines: [{ kind: "PART", ref: "p", qty: 0 }] }), code("LINE_INVALID"));
    assert.equal(await count("opportunities"), before);
  });

  await t.test("(4)(6)(7)(8) explicit accountable person: eligible succeeds; invalid, ineligible and cross-tenant refuse without fallback", async () => {
    const explicit = await newOpportunity({ accountableEmployeeId: "e-contractor" });
    assert.deepEqual([explicit.accountableEmployeeId, explicit.accountablePersonSource], ["e-contractor", "EXPLICIT"]);
    const before = await count("opportunities");
    await assert.rejects(newOpportunity({ accountableEmployeeId: "e-nobody" }), code("EXPLICIT_PERSON_INVALID"));
    await assert.rejects(newOpportunity({ accountableEmployeeId: "e-leave" }), code("EXPLICIT_PERSON_NOT_CURRENTLY_ELIGIBLE"));
    await assert.rejects(newOpportunity({ accountableEmployeeId: "e-t2" }), code("EXPLICIT_PERSON_INVALID"), "an Employee of another tenant resolved");
    assert.equal(await count("opportunities"), before, "a refused explicit person fell back to the owner");
  });

  await t.test("(9)(10) cross-tenant Account and unresolved or cross-tenant credited salesperson refuse", async () => {
    await assert.rejects(newOpportunity({ accountId: "acct-t2" }), code("ACCOUNT_NOT_FOUND"));
    await assert.rejects(newOpportunity({ creditedSalespersonId: "e-nobody" }), code("CREDITED_SALESPERSON_NOT_FOUND"));
    await assert.rejects(newOpportunity({ creditedSalespersonId: "e-t2" }), code("CREDITED_SALESPERSON_NOT_FOUND"));
    await assert.rejects(newOpportunity({ ownerEmployeeId: "e-t2" }), code("OWNER_NOT_FOUND"));
  });

  await t.test("(11)(12)(13) update with the current edit version applies and bumps it; a stale version refuses; next_action persists", async () => {
    const updated = await opp.updateOpportunity(deps, ACTOR, { idempotencyKey: key(), opportunityId: o1.opportunityId, expectedEditVersion: 1, nextAction: "Send revised quote", expectedValue: 21000, creditedSalespersonId: "e-gm" });
    assert.deepEqual(updated.changed.sort(), ["creditedSalespersonId", "expectedValue", "nextAction"]);
    assert.equal(updated.editVersion, 2);
    const row = (await q(`SELECT next_action, expected_value::text, credited_salesperson_employee_id, edit_version FROM eos_commercial.opportunities WHERE id=$1`, [o1.opportunityId])).rows[0];
    assert.deepEqual(row, { next_action: "Send revised quote", expected_value: "21000", credited_salesperson_employee_id: "e-gm", edit_version: "2" });
    await assert.rejects(opp.updateOpportunity(deps, ACTOR, { idempotencyKey: key(), opportunityId: o1.opportunityId, expectedEditVersion: 1, need: "stale" }), code("VERSION_CONFLICT"));
    assert.equal((await q(`SELECT need FROM eos_commercial.opportunities WHERE id=$1`, [o1.opportunityId])).rows[0].need, "Walk-in freezer");
    await assert.rejects(opp.updateOpportunity(deps, ACTOR, { idempotencyKey: key(), opportunityId: o1.opportunityId, expectedEditVersion: 2, accountableEmployeeId: "e-gm" }), code("ACCOUNTABLE_PERSON_NOT_EDITABLE"));
  });

  await t.test("(14)(15) an owner change is a governed handoff with history, and the Accountable Person does not move", async () => {
    const res = await opp.updateOpportunity(deps, ACTOR, { idempotencyKey: key(), opportunityId: o1.opportunityId, expectedEditVersion: 2, ownerEmployeeId: "e-national", ownershipHandoff: { reason: "territory" } });
    assert.ok(res.ownershipHandoffId);
    const row = (await q(`SELECT owner_employee_id, accountable_employee_id, edit_version FROM eos_commercial.opportunities WHERE id=$1`, [o1.opportunityId])).rows[0];
    assert.deepEqual(row, { owner_employee_id: "e-national", accountable_employee_id: "e-retail", edit_version: "3" });
    const history = (await q(`SELECT previous_owner_employee_id, new_owner_employee_id, source::text, reason, recorded_by FROM eos_commercial.ownership_handoffs WHERE opportunity_id=$1`, [o1.opportunityId])).rows;
    assert.deepEqual(history, [{ previous_owner_employee_id: "e-retail", new_owner_employee_id: "e-national", source: "DIRECT_HANDOFF", reason: "territory", recorded_by: "p1" }]);
    assert.equal(await count("accountability_handoffs", "opportunity_id=$1", [o1.opportunityId]), 1, "an owner change wrote accountability history");
  });

  await t.test("(16) a failed ownership-history write rolls back the owner change, the version bump and the receipt", async () => {
    const k = key();
    await withTrigger("ownership_handoffs", async () => {
      await assert.rejects(opp.updateOpportunity(deps, ACTOR, { idempotencyKey: k, opportunityId: o1.opportunityId, expectedEditVersion: 3, ownerEmployeeId: "e-gm", need: "changed" }), code("COMMAND_FAILED"));
    });
    const row = (await q(`SELECT owner_employee_id, need, edit_version FROM eos_commercial.opportunities WHERE id=$1`, [o1.opportunityId])).rows[0];
    assert.deepEqual(row, { owner_employee_id: "e-national", need: "Walk-in freezer", edit_version: "3" });
    assert.equal(await count("command_receipts", "operation='opportunity.update' AND result->>'editVersion' = '4'"), 0);
  });

  await t.test("(17)(18) a transition bumps the version; an illegal transition refuses", async () => {
    const res = await opp.transitionOpportunity(deps, ACTOR, { idempotencyKey: key(), opportunityId: o1.opportunityId, toStage: "QUALIFYING" });
    assert.deepEqual([res.stage, res.editVersion], ["QUALIFYING", 4]);
    await assert.rejects(opp.transitionOpportunity(deps, ACTOR, { idempotencyKey: key(), opportunityId: o1.opportunityId, toStage: "DECISION" }), code("ILLEGAL_TRANSITION"));
    await assert.rejects(opp.transitionOpportunity(deps, ACTOR, { idempotencyKey: key(), opportunityId: o1.opportunityId, outcome: "WON" }), code("OUTCOME_REQUIRES_DECISION"));
  });

  // ════════════════════ SALES AGREEMENT ════════════════════
  let a1;
  await t.test("(20) Agreement create commits number, lines, accountable person, history and receipt; (21) a second one refuses", async () => {
    a1 = await agreementFor(o1.opportunityId, { accountableEmployeeId: "e-gm" });
    assert.match(a1.salesAgreementNumber, /^SA-\d{4}-000001$/);
    assert.deepEqual([a1.state, a1.accountableEmployeeId, a1.accountablePersonSource], ["DRAFT", "e-gm", "EXPLICIT"]);
    const row = (await q(`SELECT account_id, opportunity_id, owner_employee_id, credited_salesperson_employee_id, currency, shipping_minor, tax_minor, is_lease, fulfillment_intent::text FROM eos_commercial.sales_agreements WHERE id=$1`, [a1.salesAgreementId])).rows[0];
    assert.deepEqual(row, { account_id: "acct-1", opportunity_id: o1.opportunityId, owner_employee_id: "e-retail", credited_salesperson_employee_id: "e-gm", currency: "USD", shipping_minor: "15000", tax_minor: "8000", is_lease: false, fulfillment_intent: "INSTALL" });
    assert.equal(await count("sales_agreement_lines", "sales_agreement_id=$1", [a1.salesAgreementId]), 2);
    assert.equal(await count("accountability_handoffs", "sales_agreement_id=$1 AND action='ESTABLISHMENT'", [a1.salesAgreementId]), 1);
    await assert.rejects(agreementFor(o1.opportunityId), code("AGREEMENT_ALREADY_EXISTS"));
    await assert.rejects(agreementFor(o1.opportunityId, { accountId: "acct-t2" }), code("FIELD_NOT_ACCEPTED"));
  });

  await t.test("catalog-referenced lines refuse without a catalog authority, and refuse unknown references with one", async () => {
    const o = await newOpportunity();
    await assert.rejects(sa.createSalesAgreement(bare, ACTOR, { idempotencyKey: key(), opportunityId: o.opportunityId, ownerEmployeeId: "e-retail", lines: [{ kind: "PART", ref: "part-b", quantity: 1 }] }), code("CATALOG_AUTHORITY_UNAVAILABLE"));
    await assert.rejects(agreementFor(o.opportunityId, { lines: [{ kind: "PART", ref: "missing-part", quantity: 1 }] }), code("REFERENCE_NOT_FOUND"));
    assert.equal(await count("sales_agreements", "opportunity_id=$1", [o.opportunityId]), 0);
  });

  await t.test("(22) a draft update replaces lines and charges atomically", async () => {
    const res = await sa.updateSalesAgreementDraft(deps, ACTOR, { idempotencyKey: key(), salesAgreementId: a1.salesAgreementId, customerPO: "PO-77", taxMinor: 9000,
      lines: [{ kind: "EQUIPMENT_MODEL", ref: "model-a", quantity: 1, unitPrice: 1300000 }] });
    assert.deepEqual(res.changed.sort(), ["customerPO", "lines", "taxMinor"]);
    const row = (await q(`SELECT customer_po, tax_minor, shipping_minor FROM eos_commercial.sales_agreements WHERE id=$1`, [a1.salesAgreementId])).rows[0];
    assert.deepEqual(row, { customer_po: "PO-77", tax_minor: "9000", shipping_minor: "15000" });
    assert.deepEqual((await q(`SELECT line_number, unit_price_minor FROM eos_commercial.sales_agreement_lines WHERE sales_agreement_id=$1 ORDER BY 1`, [a1.salesAgreementId])).rows, [{ line_number: 1, unit_price_minor: "1300000" }]);
  });

  await t.test("(24)(25) accept writes accepted_at and accepted_by from the governed context; (23) a non-DRAFT update refuses", async () => {
    await assert.rejects(sa.acceptSalesAgreement(deps, ACTOR, { idempotencyKey: key(), salesAgreementId: a1.salesAgreementId, acceptedBy: "someone-else" }), code("FIELD_NOT_ACCEPTED"));
    const unpricedOpp = await newOpportunity();
    const unpriced = await agreementFor(unpricedOpp.opportunityId, { lines: [{ kind: "EQUIPMENT_MODEL", ref: "model-a", quantity: 1 }] });
    await assert.rejects(sa.acceptSalesAgreement(deps, ACTOR, { idempotencyKey: key(), salesAgreementId: unpriced.salesAgreementId }), code("UNPRICED_LINE"));
    const res = await sa.acceptSalesAgreement(deps, OTHER_PRINCIPAL, { idempotencyKey: key(), salesAgreementId: a1.salesAgreementId });
    assert.equal(res.acceptedBy, "p2");
    const row = (await q(`SELECT state::text, accepted_by, accepted_at IS NOT NULL AS has_at FROM eos_commercial.sales_agreements WHERE id=$1`, [a1.salesAgreementId])).rows[0];
    assert.deepEqual(row, { state: "ACCEPTED", accepted_by: "p2", has_at: true });
    await assert.rejects(sa.updateSalesAgreementDraft(deps, ACTOR, { idempotencyKey: key(), salesAgreementId: a1.salesAgreementId, customerPO: "late" }), code("ILLEGAL_TRANSITION"));
    await assert.rejects(q(`UPDATE eos_commercial.sales_agreements SET accepted_by = NULL WHERE id=$1`, [a1.salesAgreementId]), /sales_agreements_accepted_exactly_when_accepted/);
  });

  await t.test("(26) a failed accountability-history or receipt write rolls back the Agreement", async () => {
    const o = await newOpportunity();
    await withTrigger("accountability_handoffs", async () => {
      await assert.rejects(agreementFor(o.opportunityId), code("COMMAND_FAILED"));
    });
    await withTrigger("command_receipts", async () => {
      await assert.rejects(agreementFor(o.opportunityId), code("COMMAND_FAILED"));
    });
    assert.equal(await count("sales_agreements", "opportunity_id=$1", [o.opportunityId]), 0);
    assert.equal(await count("number_counters", "series='SALES_AGREEMENT' AND last_value > 2"), 0, "a rolled-back create consumed a number");
  });

  // ════════════════════ CLOSE AS WON / SALES ORDER ════════════════════
  let won;
  await t.test("(19)(28) close-as-won commits WON, the Order, its lines, its accountable person and history, and the receipt as one unit", async () => {
    await advanceToDecision(o1.opportunityId);
    const version = (await q(`SELECT edit_version FROM eos_commercial.opportunities WHERE id=$1`, [o1.opportunityId])).rows[0].edit_version;
    won = await opp.closeOpportunityAsWon(deps, ACTOR, { idempotencyKey: key(), opportunityId: o1.opportunityId, salesChannel: "RETAIL" });
    assert.match(won.salesOrderNumber, /^SO-\d{4}-000001$/);
    assert.equal(won.recovered, false);
    assert.equal(won.editVersion, Number(version) + 1);
    const opportunity = (await q(`SELECT outcome::text, closed_at IS NOT NULL AS closed FROM eos_commercial.opportunities WHERE id=$1`, [o1.opportunityId])).rows[0];
    assert.deepEqual(opportunity, { outcome: "WON", closed: true });
    const order = (await q(`SELECT state::text, opportunity_id, sales_agreement_id, owner_employee_id, credited_salesperson_employee_id, customer_po, notes, accountable_employee_id, operating_company_key FROM eos_commercial.sales_orders WHERE id=$1`, [won.salesOrderId])).rows[0];
    assert.deepEqual(order, { state: "CONFIRMED", opportunity_id: o1.opportunityId, sales_agreement_id: a1.salesAgreementId, owner_employee_id: "e-national", credited_salesperson_employee_id: "e-gm", customer_po: "PO-77", notes: null, accountable_employee_id: "e-national", operating_company_key: "taylor" });
    assert.equal(await count("sales_order_lines", "sales_order_id=$1", [won.salesOrderId]), 1);
    assert.equal(await count("accountability_handoffs", "sales_order_id=$1 AND action='ESTABLISHMENT'", [won.salesOrderId]), 1);
    assert.equal((await q(`SELECT state::text FROM eos_commercial.sales_agreements WHERE id=$1`, [a1.salesAgreementId])).rows[0].state, "ACCEPTED", "the Agreement is only read");
  });

  await t.test("close-as-won without an ACCEPTED Agreement refuses and rolls back the WON transition", async () => {
    const o = await newOpportunity();
    await advanceToDecision(o.opportunityId);
    await agreementFor(o.opportunityId);
    await assert.rejects(opp.closeOpportunityAsWon(deps, ACTOR, { idempotencyKey: key(), opportunityId: o.opportunityId, salesChannel: "RETAIL" }), code("AGREEMENT_NOT_ACCEPTED"));
    assert.equal((await q(`SELECT outcome FROM eos_commercial.opportunities WHERE id=$1`, [o.opportunityId])).rows[0].outcome, null);
    await withTrigger("sales_order_lines", async () => {
      const aId = (await q(`SELECT id FROM eos_commercial.sales_agreements WHERE opportunity_id=$1`, [o.opportunityId])).rows[0].id;
      await sa.acceptSalesAgreement(deps, ACTOR, { idempotencyKey: key(), salesAgreementId: aId });
      await assert.rejects(opp.closeOpportunityAsWon(deps, ACTOR, { idempotencyKey: key(), opportunityId: o.opportunityId, salesChannel: "RETAIL" }), code("COMMAND_FAILED"));
    });
    assert.equal((await q(`SELECT outcome FROM eos_commercial.opportunities WHERE id=$1`, [o.opportunityId])).rows[0].outcome, null, "WON committed without its Order");
    assert.equal(await count("sales_orders", "opportunity_id=$1", [o.opportunityId]), 0);
  });

  await t.test("(29) a second Order for the Opportunity refuses; create-from-Opportunity requires WON", async () => {
    await assert.rejects(opp.closeOpportunityAsWon(deps, ACTOR, { idempotencyKey: key(), opportunityId: o1.opportunityId, salesChannel: "RETAIL" }), code("SALES_ORDER_ALREADY_EXISTS"));
    await assert.rejects(so.createSalesOrderFromOpportunity(deps, ACTOR, { idempotencyKey: key(), opportunityId: o1.opportunityId, salesChannel: "RETAIL" }), code("SALES_ORDER_ALREADY_EXISTS"));
    const open = await newOpportunity();
    await assert.rejects(so.createSalesOrderFromOpportunity(deps, ACTOR, { idempotencyKey: key(), opportunityId: open.opportunityId, salesChannel: "RETAIL" }), code("OPPORTUNITY_NOT_WON"));
  });

  await t.test("(28) create-from-Opportunity on a WON Opportunity without an Order is atomic", async () => {
    const o = await newOpportunity();
    await advanceToDecision(o.opportunityId);
    const agreement = await agreementFor(o.opportunityId);
    await sa.acceptSalesAgreement(deps, ACTOR, { idempotencyKey: key(), salesAgreementId: agreement.salesAgreementId });
    await opp.transitionOpportunity(deps, ACTOR, { idempotencyKey: key(), opportunityId: o.opportunityId, outcome: "WON" });
    const order = await so.createSalesOrderFromOpportunity(deps, ACTOR, { idempotencyKey: key(), opportunityId: o.opportunityId, salesChannel: "NATIONAL_ACCOUNTS", ownerEmployeeId: "e-gm" });
    assert.equal(order.opportunityId, o.opportunityId);
    const row = (await q(`SELECT owner_employee_id, sales_agreement_id, sales_channel::text FROM eos_commercial.sales_orders WHERE id=$1`, [order.salesOrderId])).rows[0];
    assert.deepEqual(row, { owner_employee_id: "e-gm", sales_agreement_id: agreement.salesAgreementId, sales_channel: "NATIONAL_ACCOUNTS" });
  });

  let direct;
  await t.test("(27) a direct Sales Order create is atomic, and refuses client-supplied inheritance", async () => {
    direct = await so.createSalesOrder(deps, ACTOR, { idempotencyKey: key(), accountId: "acct-1", ownerEmployeeId: "e-national", operatingCompanyId: "taylor", salesChannel: "NATIONAL_ACCOUNTS",
      notes: "Direct", lines: [{ kind: "PART", ref: "part-b", orderedQty: 3, unitPrice: 2500 }], accountableEmployeeId: "e-contractor" });
    assert.deepEqual([direct.state, direct.accountableEmployeeId, direct.accountablePersonSource], ["CONFIRMED", "e-contractor", "EXPLICIT"]);
    assert.equal(await count("sales_order_lines", "sales_order_id=$1", [direct.salesOrderId]), 1);
    await assert.rejects(so.createSalesOrder(deps, ACTOR, { idempotencyKey: key(), accountId: "acct-1", ownerEmployeeId: "e-national", inheritedCreditedSalespersonId: "e-gm", operatingCompanyId: "taylor", salesChannel: "RETAIL", lines: [{ kind: "PART", ref: "p", orderedQty: 1, unitPrice: 1 }] }), code("FIELD_NOT_ACCEPTED"));
  });

  await t.test("(30)(31) Sales Order transitions follow the lifecycle; the quantity-decided step refuses and no D2 field exists", async () => {
    const advanced = await so.transitionSalesOrder(deps, ACTOR, { idempotencyKey: key(), salesOrderId: direct.salesOrderId, transition: "ADVANCE" });
    assert.equal(advanced.state, "IN_FULFILLMENT");
    await assert.rejects(so.transitionSalesOrder(deps, ACTOR, { idempotencyKey: key(), salesOrderId: direct.salesOrderId, transition: "ADVANCE" }), code("FULFILLMENT_AUTHORITY_UNAVAILABLE"));
    assert.equal((await so.transitionSalesOrder(deps, ACTOR, { idempotencyKey: key(), salesOrderId: direct.salesOrderId, transition: "CANCEL" })).state, "CANCELLED");
    await assert.rejects(so.transitionSalesOrder(deps, ACTOR, { idempotencyKey: key(), salesOrderId: direct.salesOrderId, transition: "CANCEL" }), code("TERMINAL"));
    const columns = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='eos_commercial' AND table_name IN ('sales_orders','sales_order_lines')`)).rows.map((r) => r.column_name);
    for (const d2 of ["allocated_qty", "fulfilled_qty", "billed_qty", "service_work_order_ids", "allocated_at"]) assert.ok(!columns.includes(d2));
  });

  // ════════════════════ IDEMPOTENCY ════════════════════
  await t.test("(32)(33)(35)(36) one commit per key; replay returns the committed result; operation and principal scope the key", async () => {
    const k = key();
    const input = { idempotencyKey: k, accountId: "acct-1", salesChannel: "RETAIL", lines: [] };
    const first = await opp.createOpportunity(deps, ACTOR, input);
    const again = await opp.createOpportunity(deps, ACTOR, input);
    assert.deepEqual({ ...again, replayed: false }, first);
    assert.equal(again.replayed, true);
    assert.equal(await count("opportunities", "id=$1", [first.opportunityId]), 1);
    const byOther = await opp.createOpportunity(deps, OTHER_PRINCIPAL, input);
    assert.notEqual(byOther.opportunityId, first.opportunityId, "another principal replayed this principal's command");
    const transitioned = await opp.transitionOpportunity(deps, ACTOR, { idempotencyKey: k, opportunityId: first.opportunityId, toStage: "QUALIFYING" });
    assert.equal(transitioned.replayed, false, "a different operation with the same key replayed");
    assert.equal(await count("command_receipts", "idempotency_key_hash = encode(sha256(convert_to($1,'UTF8')),'hex')", [k]), 3);
    const raw = await q(`SELECT count(*)::int n FROM eos_commercial.command_receipts WHERE idempotency_key_hash = $1 OR result::text LIKE $2`, [k, `%${k}%`]);
    assert.equal(raw.rows[0].n, 0, "the raw idempotency key was persisted");
  });

  await t.test("(34) concurrent same-key submissions create exactly one record; the rest replay it", async () => {
    const input = { idempotencyKey: key(), accountId: "acct-1", salesChannel: "STRATEGIC_ACCOUNTS", lines: [{ kind: "SERVICE", ref: "svc", qty: 1 }] };
    const results = await Promise.all(Array.from({ length: 12 }, () => opp.createOpportunity(deps, ACTOR, input)));
    assert.equal(new Set(results.map((r) => r.opportunityId)).size, 1);
    assert.equal(results.filter((r) => !r.replayed).length, 1);
    assert.equal(await count("opportunities", "sales_channel='STRATEGIC_ACCOUNTS'"), 1);
    assert.equal(await count("accountability_handoffs", "opportunity_id=$1", [results[0].opportunityId]), 1);
  });

  await t.test("(37)(38) a failed command leaves no receipt, and a failed receipt leaves no business mutation", async () => {
    const k = key();
    await assert.rejects(opp.createOpportunity(deps, ACTOR, { idempotencyKey: k, accountId: "acct-1", salesChannel: "BAD" }), code("CHANNEL_INVALID"));
    assert.equal(await count("command_receipts", "idempotency_key_hash = encode(sha256(convert_to($1,'UTF8')),'hex')", [k]), 0);
    const ok = await opp.createOpportunity(deps, ACTOR, { idempotencyKey: k, accountId: "acct-1", salesChannel: "RETAIL" });
    assert.equal(ok.replayed, false, "the failed attempt poisoned the key");
    const before = await count("opportunities");
    await withTrigger("command_receipts", async () => {
      await assert.rejects(opp.createOpportunity(deps, ACTOR, { idempotencyKey: key(), accountId: "acct-1", salesChannel: "RETAIL" }), code("COMMAND_FAILED"));
    });
    assert.equal(await count("opportunities"), before, "the business mutation survived its failed receipt");
  });

  await t.test("(38) a failure at COMMIT, after the receipt is written, leaves neither the record nor its receipt", async () => {
    // A deferred constraint trigger raises only when the transaction commits -- the one failure point that comes AFTER
    // the receipt insert. A receipt written outside the business transaction would survive this; one inside cannot.
    await q(`CREATE OR REPLACE FUNCTION pg_temp_fail_at_commit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced commit failure'; END $$ LANGUAGE plpgsql`);
    await q(`CREATE CONSTRAINT TRIGGER fail_opportunity_at_commit AFTER INSERT ON eos_commercial.opportunities DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pg_temp_fail_at_commit()`);
    const k = key();
    const before = await count("opportunities");
    try {
      await assert.rejects(opp.createOpportunity(deps, ACTOR, { idempotencyKey: k, accountId: "acct-1", salesChannel: "RETAIL" }), code("COMMAND_FAILED"));
    } finally {
      await q(`DROP TRIGGER fail_opportunity_at_commit ON eos_commercial.opportunities`);
    }
    assert.equal(await count("opportunities"), before);
    assert.equal(await count("command_receipts", "idempotency_key_hash = encode(sha256(convert_to($1,'UTF8')),'hex')", [k]), 0, "the receipt outlived its transaction");
    const retry = await opp.createOpportunity(deps, ACTOR, { idempotencyKey: k, accountId: "acct-1", salesChannel: "RETAIL" });
    assert.equal(retry.replayed, false, "the retry replayed a result that was never committed");
  });

  // ════════════════════ REVIEW CORRECTIONS ════════════════════
  await t.test("a MALFORMED explicit accountable person refuses on every creating family and never derives from the owner", async () => {
    const won = await newOpportunity();
    await advanceToDecision(won.opportunityId);
    const snapshot = async () => [await count("opportunities"), await count("sales_agreements"), await count("sales_orders"), await count("accountability_handoffs"), await count("command_receipts")];
    const before = await snapshot();
    for (const malformed of [123, {}, true, ["e-gm"], "", "   "]) {
      await assert.rejects(newOpportunity({ accountableEmployeeId: malformed }), code("EXPLICIT_PERSON_INVALID"), `Opportunity accepted ${JSON.stringify(malformed)}`);
      await assert.rejects(agreementFor(won.opportunityId, { accountableEmployeeId: malformed }), code("EXPLICIT_PERSON_INVALID"), `Agreement accepted ${JSON.stringify(malformed)}`);
      await assert.rejects(so.createSalesOrder(deps, ACTOR, { idempotencyKey: key(), accountId: "acct-1", ownerEmployeeId: "e-national", operatingCompanyId: "taylor", salesChannel: "RETAIL",
        lines: [{ kind: "SERVICE", ref: "svc", orderedQty: 1, unitPrice: 100, businessUnitId: "SERVICE" }], accountableEmployeeId: malformed }), code("EXPLICIT_PERSON_INVALID"), `Sales Order accepted ${JSON.stringify(malformed)}`);
    }
    assert.deepEqual(await snapshot(), before, "a malformed explicit person created a record, a history row or a receipt");
    const absent = await newOpportunity({ accountableEmployeeId: null });
    assert.equal(absent.accountablePersonSource, "DERIVED_FROM_RECORD_OWNER", "a genuinely absent person no longer derives");
  });

  await t.test("the catalog boundary covers every command that accepts NEW product references", async () => {
    const service = [{ kind: "SERVICE", ref: "svc-visit", qty: 1 }];
    await assert.rejects(opp.createOpportunity(bare, ACTOR, { idempotencyKey: key(), accountId: "acct-1", salesChannel: "RETAIL", lines: [{ kind: "PART", ref: "part-b", qty: 1 }] }), code("CATALOG_AUTHORITY_UNAVAILABLE"));
    await assert.rejects(opp.createOpportunity(bare, ACTOR, { idempotencyKey: key(), accountId: "acct-1", salesChannel: "RETAIL", lines: [{ kind: "EQUIPMENT_MODEL", ref: "model-a", qty: 1 }] }), code("CATALOG_AUTHORITY_UNAVAILABLE"));
    const serviceOnly = await opp.createOpportunity(bare, ACTOR, { idempotencyKey: key(), accountId: "acct-1", salesChannel: "RETAIL", lines: service });
    assert.equal(serviceOnly.replayed, false, "a SERVICE-only Opportunity needs no catalog authority");
    await assert.rejects(opp.updateOpportunity(bare, ACTOR, { idempotencyKey: key(), opportunityId: serviceOnly.opportunityId, expectedEditVersion: 1, lines: [{ kind: "PART", ref: "part-b", qty: 1 }] }), code("CATALOG_AUTHORITY_UNAVAILABLE"));
    const unchanged = (await q(`SELECT edit_version FROM eos_commercial.opportunities WHERE id=$1`, [serviceOnly.opportunityId])).rows[0].edit_version;
    assert.equal(unchanged, "1", "a refused line replacement bumped the version");
    assert.deepEqual((await q(`SELECT kind::text FROM eos_commercial.opportunity_lines WHERE opportunity_id=$1`, [serviceOnly.opportunityId])).rows, [{ kind: "SERVICE" }]);
    const updated = await opp.updateOpportunity(bare, ACTOR, { idempotencyKey: key(), opportunityId: serviceOnly.opportunityId, expectedEditVersion: 1, need: "no line change" });
    assert.equal(updated.editVersion, 2, "an edit that does not replace lines needs no catalog authority");
    await assert.rejects(so.createSalesOrder(bare, ACTOR, { idempotencyKey: key(), accountId: "acct-1", ownerEmployeeId: "e-national", operatingCompanyId: "taylor", salesChannel: "RETAIL",
      lines: [{ kind: "PART", ref: "part-b", orderedQty: 1, unitPrice: 100 }] }), code("CATALOG_AUTHORITY_UNAVAILABLE"));
  });

  await t.test("a malformed catalog authority response refuses with zero mutation", async () => {
    const counts = async () => [await count("opportunities"), await count("sales_orders"), await count("sales_agreements"), await count("command_receipts")];
    const before = await counts();
    for (const verifyReferences of [async () => [], async (_d, _t, r) => [...r.map(() => "FOUND"), "FOUND"], async (_d, _t, r) => r.map(() => "MAYBE"), async () => "FOUND"]) {
      const broken = { pool, catalog: { verifyReferences } };
      await assert.rejects(opp.createOpportunity(broken, ACTOR, { idempotencyKey: key(), accountId: "acct-1", salesChannel: "RETAIL", lines: [{ kind: "PART", ref: "part-b", qty: 1 }] }), code("CATALOG_AUTHORITY_CONTRACT_VIOLATION"));
      await assert.rejects(so.createSalesOrder(broken, ACTOR, { idempotencyKey: key(), accountId: "acct-1", ownerEmployeeId: "e-national", operatingCompanyId: "taylor", salesChannel: "RETAIL",
        lines: [{ kind: "EQUIPMENT_MODEL", ref: "model-a", orderedQty: 1, unitPrice: 100 }] }), code("CATALOG_AUTHORITY_CONTRACT_VIOLATION"));
    }
    assert.deepEqual(await counts(), before);
  });

  await t.test("an Order derived from an ACCEPTED Agreement carries its committed references without a second catalog decision", async () => {
    const o = await newOpportunity();
    await advanceToDecision(o.opportunityId);
    const agreement = await agreementFor(o.opportunityId);
    await sa.acceptSalesAgreement(deps, ACTOR, { idempotencyKey: key(), salesAgreementId: agreement.salesAgreementId });
    const closed = await opp.closeOpportunityAsWon(bare, ACTOR, { idempotencyKey: key(), opportunityId: o.opportunityId, salesChannel: "RETAIL" });
    assert.deepEqual((await q(`SELECT kind::text, ref FROM eos_commercial.sales_order_lines WHERE sales_order_id=$1 ORDER BY line_number`, [closed.salesOrderId])).rows,
      [{ kind: "EQUIPMENT_MODEL", ref: "model-a" }, { kind: "SERVICE", ref: "svc-install" }]);
  });

  await t.test("closed_at is the command's governed instant, for a plain outcome and for close-as-won", async () => {
    const fixed = new Date("2026-10-15T12:34:56.789Z");
    const clocked = { pool, catalog, now: () => fixed };
    const lost = await newOpportunity();
    await opp.transitionOpportunity(clocked, ACTOR, { idempotencyKey: key(), opportunityId: lost.opportunityId, outcome: "LOST" });
    assert.equal((await q(`SELECT closed_at FROM eos_commercial.opportunities WHERE id=$1`, [lost.opportunityId])).rows[0].closed_at.toISOString(), fixed.toISOString());
    const toWin = await newOpportunity();
    await advanceToDecision(toWin.opportunityId);
    const agreement = await agreementFor(toWin.opportunityId);
    await sa.acceptSalesAgreement(deps, ACTOR, { idempotencyKey: key(), salesAgreementId: agreement.salesAgreementId });
    await opp.closeOpportunityAsWon(clocked, ACTOR, { idempotencyKey: key(), opportunityId: toWin.opportunityId, salesChannel: "RETAIL" });
    assert.equal((await q(`SELECT closed_at FROM eos_commercial.opportunities WHERE id=$1`, [toWin.opportunityId])).rows[0].closed_at.toISOString(), fixed.toISOString());
  });

  // ════════════════════ TENANCY / AUTHORITY ════════════════════
  await t.test("(39)(40)(41) cross-tenant sources, missing capability, non-member and disabled principals refuse", async () => {
    await assert.rejects(opp.updateOpportunity(deps, { ...ACTOR, tenantId: "t2" }, { idempotencyKey: key(), opportunityId: o1.opportunityId, expectedEditVersion: 1, need: "x" }), code("ACTOR_NOT_TENANT_MEMBER"));
    await assert.rejects(opp.transitionOpportunity(deps, { tenantId: "t2", principalId: "p-outsider", capabilities: ALL_CAPS }, { idempotencyKey: key(), opportunityId: o1.opportunityId, toStage: "QUALIFYING" }), code("RECORD_NOT_FOUND"));
    await assert.rejects(sa.createSalesAgreement(deps, { tenantId: "t2", principalId: "p-outsider", capabilities: ALL_CAPS }, { idempotencyKey: key(), opportunityId: o1.opportunityId, ownerEmployeeId: "e-t2", lines: [] }), code("RECORD_NOT_FOUND"));
    await assert.rejects(opp.createOpportunity(deps, { ...ACTOR, capabilities: new Set() }, { idempotencyKey: key(), accountId: "acct-1", salesChannel: "RETAIL" }), code("CAPABILITY_REQUIRED"));
    await assert.rejects(opp.closeOpportunityAsWon(deps, { ...ACTOR, capabilities: new Set(["opportunity.write"]) }, { idempotencyKey: key(), opportunityId: o1.opportunityId, salesChannel: "RETAIL" }), code("CAPABILITY_REQUIRED"));
    await assert.rejects(opp.createOpportunity(deps, { tenantId: "t1", principalId: "p-disabled", capabilities: ALL_CAPS }, { idempotencyKey: key(), accountId: "acct-1", salesChannel: "RETAIL" }), code("ACTOR_NOT_TENANT_MEMBER"));
    await assert.rejects(opp.createOpportunity(deps, { tenantId: "t1", principalId: "p-outsider", capabilities: ALL_CAPS }, { idempotencyKey: key(), accountId: "acct-1", salesChannel: "RETAIL" }), code("ACTOR_NOT_TENANT_MEMBER"));
    const crossLines = (await q(`SELECT count(*)::int n FROM eos_commercial.opportunity_lines l JOIN eos_commercial.opportunities o ON o.id = l.opportunity_id WHERE l.tenant_id <> o.tenant_id`)).rows[0].n;
    assert.equal(crossLines, 0);
  });

  await t.test("an identity-only (spine / seed) record cannot be driven by a governed command", async () => {
    await q(`INSERT INTO eos_commercial.opportunities (id, tenant_id, opportunity_number, account_id, owner_employee_id, created_by, updated_by) VALUES ('opp-spine','t1','SYN-NP-OPP-0001','acct-1','e-retail','seed','seed')`);
    await assert.rejects(opp.updateOpportunity(deps, ACTOR, { idempotencyKey: key(), opportunityId: "opp-spine", expectedEditVersion: 1, need: "x" }), code("RECORD_INCOMPLETE"));
    await assert.rejects(opp.transitionOpportunity(deps, ACTOR, { idempotencyKey: key(), opportunityId: "opp-spine", toStage: "QUALIFYING" }), code("RECORD_INCOMPLETE"));
  });

  await t.test("errors never leak SQL, driver messages or connection details", async () => {
    try {
      await withTrigger("opportunity_lines", () => newOpportunity());
      assert.fail("expected a refusal");
    } catch (err) {
      assert.equal(err.name, "CommercialCommandError");
      assert.doesNotMatch(`${err.message} ${err.stack}`, /forced failure|INSERT INTO|postgres:\/\/|eos_commercial\./);
    }
  });
});
