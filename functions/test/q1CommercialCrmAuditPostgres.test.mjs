// Q-1 against a real postgres:16 -- audit on every APPLIED Commercial and CRM command.
//
// Every applied command writes exactly ONE eos_policy.audit_events row in its own transaction: action = the operation, actor_uid =
// the Principal, target_kind / target_id, before / after as structured fields, the reason where the command takes one. A replay writes
// nothing, a refusal writes nothing, and a failure of the audit write itself rolls the whole command back (no applied-but-unaudited
// command). Its OWN database, migrated by the normal runner.
import { endPoolAndDrain } from "./support/poolTeardown.mjs";
import { bindOperatingCompany } from "./support/governedOperatingCompanyBinding.mjs";
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
const accounts = require("../lib/eosCrm/accountAuthority.js");
const contacts = require("../lib/eosCrm/contactAuthority.js");
const sites = require("../lib/eosCrm/accountLocationAuthority.js");

const DB_NAME = `q1_audit_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

const COMMERCIAL_CAPS = ["opportunity.write", "opportunity.createSalesOrder", "salesAgreement.create", "salesAgreement.updateDraft", "salesAgreement.accept", "salesOrder.write"];
const SELLER = Object.freeze({ tenantId: "t1", principalId: "p1", capabilities: new Set(COMMERCIAL_CAPS) });
const ACCEPTOR = Object.freeze({ tenantId: "t1", principalId: "p2", capabilities: new Set(COMMERCIAL_CAPS) });
const GM = Object.freeze({ tenantId: "t1", principalId: "p-gm", capabilities: new Set([...COMMERCIAL_CAPS, "salesAgreement.tradeIn.approve"]) });
const CRM_CAPS = new Set(["customer.record.read", "customer.record.create", "customer.record.update"]);
const CRM = Object.freeze({ tenantId: "t1", principalId: "p1", capabilities: CRM_CAPS });
const key = () => `k-${randomUUID()}`;
const code = (c) => (e) => {
  assert.equal(e.code, c, `expected ${c}, got ${e.code}: ${e.message}`);
  return true;
};

test("Q-1: one audit row per applied Commercial and CRM command, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], { maxBuffer: 256 * 1024 * 1024,
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe",
  });
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 8 });
  t.after(async () => {
    await endPoolAndDrain(pool);
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  const q = (text, values = []) => pool.query(text, values);
  const catalog = { async verifyReferences(_db, _t, refs) { return refs.map(() => "FOUND"); } };
  const deps = { pool, catalog };
  const crmDeps = { pool };

  // ── the world ──
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1')`);
  for (const channel of ["NATIONAL_ACCOUNTS", "RETAIL", "STRATEGIC_ACCOUNTS"]) {
    await q(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id, sales_channel, status, source, established_by, updated_by) VALUES ('t1', $1, 'ACTIVE', 'fixture', 'fixture', 'fixture')`, [channel]);
  }
  await bindOperatingCompany(q, "t1", "taylor", "taylor-ops-t1");
  await bindOperatingCompany(q, "t1", "ventana", "ventana-ops-t1");
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, owner_employee_id, created_by, updated_by) VALUES ('acct-1','t1','Retail Customer','ACTIVE','e-retail','x','x')`);
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES
    ('e-retail','t1','ACTIVE','taylor'), ('e-national','t1','ACTIVE','taylor'), ('e-gm','t1','ACTIVE','taylor')`);
  for (const p of ["p1", "p2", "p-gm"]) {
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ($1,$1,'proof','active')`, [p]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ($1,'t1',$2)`, [`m-${p}`, p]);
  }
  // Trade-in approval is RESERVED to a global owner / generalManager Role (DECISIONS #226): p-gm holds generalManager.
  await q(`INSERT INTO eos_policy.roles (id,tenant_id,key,name,origin,created_by,updated_by) VALUES ('role-gm','t1','generalManager','generalManager','SYSTEM','fixture','fixture')`);
  await q(`INSERT INTO eos_policy.user_role_assignments (id,tenant_id,principal_id,role_id,scope_type,scope_value,status,granted_by,access_version_at_grant,created_by,updated_by)
           VALUES ('a-gm','t1','p-gm','role-gm','global',NULL,'active','f',0,'f','f')`);
  // p1 may grant a customer discount up to 10%.
  await q(`INSERT INTO eos_commercial.sales_discount_authorities (tenant_id, principal_id, max_discount_basis_points, updated_by) VALUES ('t1','p1',1000,'fixture')`);

  // ── the harness ──
  const total = async () => (await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id = 't1'`)).rows[0].n;
  const subset = (actual, expected, label) => {
    for (const [k, v] of Object.entries(expected)) assert.deepEqual(actual?.[k], v, `${label}.${k}`);
  };
  /** Run an APPLIED command: exactly one new row, with the operation as its action and the stated fields. */
  async function applied(label, run, want) {
    const n0 = await total();
    const res = await run();
    assert.equal(await total(), n0 + 1, `${label}: exactly one audit row`);
    const row = (await q(`SELECT * FROM eos_policy.audit_events WHERE tenant_id = 't1' ORDER BY occurred_at DESC, id DESC LIMIT 1`)).rows[0];
    assert.equal(row.action, want.action, `${label}: action is the operation`);
    assert.equal(row.actor_uid, want.actor ?? "p1", `${label}: actor_uid is the Principal`);
    assert.equal(row.target_kind, want.kind, `${label}: target_kind`);
    assert.equal(row.target_id, typeof want.id === "function" ? want.id(res) : want.id, `${label}: target_id`);
    assert.equal(row.reason, want.reason ?? null, `${label}: reason`);
    if (want.before === null) assert.equal(row.before, null, `${label}: a create has no before`);
    else subset(row.before, want.before, `${label}.before`);
    subset(row.after, typeof want.after === "function" ? want.after(res) : want.after, `${label}.after`);
    return res;
  }
  /** A replay of the same command with the same key: answered, `replayed`, and not audited again. */
  async function replayed(label, run) {
    const n0 = await total();
    const res = await run();
    assert.equal(res.replayed, true, `${label}: answered as a replay`);
    assert.equal(await total(), n0, `${label}: a replay writes no audit row`);
  }
  /** A refused command: the governed refusal, and no audit row. */
  async function refused(label, run, expectedCode) {
    const n0 = await total();
    await assert.rejects(run(), code(expectedCode), label);
    assert.equal(await total(), n0, `${label}: a refusal writes no audit row`);
  }
  const forceFail = async (table, fn) => {
    await q(`CREATE OR REPLACE FUNCTION q1_force_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced failure'; END $$ LANGUAGE plpgsql`);
    await q(`CREATE TRIGGER q1_force_fail BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION q1_force_fail()`);
    try {
      await fn();
    } finally {
      await q(`DROP TRIGGER q1_force_fail ON ${table}`);
    }
  };
  const STAGES = ["QUALIFYING", "SOLUTION", "QUOTING", "CUSTOMER_REVIEW", "DECISION"];
  const newOpportunityInput = () => ({
    idempotencyKey: key(), accountId: "acct-1", salesChannel: "RETAIL", operatingCompanyId: "taylor", need: "Walk-in freezer",
    expectedValue: 18500.5, expectedCloseAt: Date.parse("2026-11-01T00:00:00Z"), lines: [{ kind: "EQUIPMENT_MODEL", ref: "model-a", qty: 1 }, { kind: "PART", ref: "part-b", qty: 2 }],
  });
  const agreementInput = (opportunityId) => ({
    idempotencyKey: key(), opportunityId, ownerEmployeeId: "e-retail", isLease: false, fulfillmentIntent: "INSTALL",
    lines: [{ kind: "EQUIPMENT_MODEL", ref: "model-a", quantity: 1, unitPrice: 1250000 }, { kind: "SERVICE", ref: "svc-install", quantity: 1, unitPrice: 50000, businessUnitId: "INSTALLATION" }],
    shippingMinor: 15000, taxMinor: 8000,
  });

  // ════════════════════ OPPORTUNITY ════════════════════
  const createInput = newOpportunityInput();
  let o;
  await t.test("opportunity.create: one row, before null, the number and the owner; the idempotency key is never stored; a replay writes nothing", async () => {
    o = await applied("create", () => opp.createOpportunity(deps, SELLER, createInput), {
      action: "opportunity.create", kind: "opportunity", id: (r) => r.opportunityId, before: null,
      after: (r) => ({ opportunityNumber: r.opportunityNumber, accountId: "acct-1", ownerEmployeeId: "e-retail", salesChannel: "RETAIL", stage: "IDENTIFIED", accountableEmployeeId: "e-retail" }),
    });
    const row = (await q(`SELECT * FROM eos_policy.audit_events WHERE action = 'opportunity.create'`)).rows[0];
    assert.ok(!JSON.stringify(row).includes(createInput.idempotencyKey), "the raw idempotency key is not in the audit row");
    await replayed("create replay", () => opp.createOpportunity(deps, SELLER, createInput));
  });

  await t.test("opportunity.update: before / after state only the changed fields and the edit version; a stale version refuses with no row; a replay writes nothing", async () => {
    const input = { idempotencyKey: key(), opportunityId: o.opportunityId, expectedEditVersion: 1, nextAction: "Send revised quote", expectedValue: 21000 };
    await applied("update", () => opp.updateOpportunity(deps, SELLER, input), {
      action: "opportunity.update", kind: "opportunity", id: o.opportunityId,
      before: { nextActionLength: null, expectedValue: 18500.5, editVersion: 1 }, after: { nextActionLength: "Send revised quote".length, expectedValue: 21000, editVersion: 2 },
    });
    const row = (await q(`SELECT before, after FROM eos_policy.audit_events WHERE action = 'opportunity.update' AND target_id = $1 ORDER BY occurred_at DESC LIMIT 1`, [o.opportunityId])).rows[0];
    assert.ok(!JSON.stringify(row).includes("Send revised quote"), "free text is recorded as a length, never as text");
    assert.ok(!("nextAction" in row.after), "no nextAction value key");
    await replayed("update replay", () => opp.updateOpportunity(deps, SELLER, input));
    await refused("stale version", () => opp.updateOpportunity(deps, SELLER, { idempotencyKey: key(), opportunityId: o.opportunityId, expectedEditVersion: 1, need: "stale" }), "VERSION_CONFLICT");
    await refused("no capability", () => opp.updateOpportunity(deps, { ...SELLER, capabilities: new Set() }, { idempotencyKey: key(), opportunityId: o.opportunityId, expectedEditVersion: 2, need: "x" }), "CAPABILITY_REQUIRED");
  });

  await t.test("opportunity.update with an owner handoff: the handoff reason is the audit reason", async () => {
    await applied("handoff", () => opp.updateOpportunity(deps, SELLER, {
      idempotencyKey: key(), opportunityId: o.opportunityId, expectedEditVersion: 2, ownerEmployeeId: "e-national", ownershipHandoff: { reason: "territory" },
    }), {
      action: "opportunity.update", kind: "opportunity", id: o.opportunityId, reason: "territory",
      before: { ownerEmployeeId: "e-retail", editVersion: 2 }, after: (r) => ({ ownerEmployeeId: "e-national", editVersion: 3, ownershipHandoffId: r.ownershipHandoffId }),
    });
  });

  await t.test("opportunity.transition: the stage before and after; an illegal jump refuses with no row", async () => {
    const input = { idempotencyKey: key(), opportunityId: o.opportunityId, toStage: "QUALIFYING" };
    await applied("transition", () => opp.transitionOpportunity(deps, SELLER, input), {
      action: "opportunity.transition", kind: "opportunity", id: o.opportunityId,
      before: { stage: "IDENTIFIED", outcome: null, editVersion: 3 }, after: { stage: "QUALIFYING", outcome: null, editVersion: 4 },
    });
    await replayed("transition replay", () => opp.transitionOpportunity(deps, SELLER, input));
    await refused("illegal jump", () => opp.transitionOpportunity(deps, SELLER, { idempotencyKey: key(), opportunityId: o.opportunityId, toStage: "DECISION" }), "ILLEGAL_TRANSITION");
  });

  await t.test("a lone surrogate in a recorded string cannot turn an applied command into a failure: the audit row holds U+FFFD instead", async () => {
    // The line reference reaches the audit `after` straight from the input (not re-read from the database), and jsonb rejects a lone surrogate escape.
    const input = { ...newOpportunityInput(), lines: [{ kind: "PART", ref: "part\uD800-x", qty: 1 }] };
    await applied("lone surrogate", () => opp.createOpportunity(deps, SELLER, input), {
      action: "opportunity.create", kind: "opportunity", id: (r) => r.opportunityId, before: null,
      after: { lines: [{ kind: "PART", ref: "part�-x", qty: 1 }] },
    });
  });

  // ════════════════════ SALES AGREEMENT ════════════════════
  let won; let agreement;
  await t.test("salesAgreement.create / updateDraft (discount) / trade-in approve and decline / accept", async () => {
    won = await applied("opportunity for the chain", () => opp.createOpportunity(deps, SELLER, newOpportunityInput()), {
      action: "opportunity.create", kind: "opportunity", id: (r) => r.opportunityId, before: null, after: { stage: "IDENTIFIED" },
    });
    const createIn = { ...agreementInput(won.opportunityId), customerDiscount: { kind: "PERCENT", percentBasisPoints: 500 },
      tradeIns: [{ description: "Used reach-in", proposedValueMinor: 40000 }, { description: "Used cooler", proposedValueMinor: 30000 }] };
    agreement = await applied("agreement create", () => sa.createSalesAgreement(deps, SELLER, createIn), {
      action: "salesAgreement.create", kind: "sales_agreement", id: (r) => r.salesAgreementId, before: null,
      after: (r) => ({ salesAgreementNumber: r.salesAgreementNumber, opportunityId: won.opportunityId, accountId: "acct-1", state: "DRAFT",
        customerDiscount: { kind: "PERCENT", percentBasisPoints: 500 },
        tradeIns: [
          { itemNumber: 1, proposedValueMinor: 40000, approvalStatus: "PROPOSED", approvedCreditMinor: null, descriptionLength: "Used reach-in".length },
          { itemNumber: 2, proposedValueMinor: 30000, approvalStatus: "PROPOSED", approvedCreditMinor: null, descriptionLength: "Used cooler".length },
        ] }),
    });
    await replayed("agreement create replay", () => sa.createSalesAgreement(deps, SELLER, createIn));
    await refused("agreement already exists", () => sa.createSalesAgreement(deps, SELLER, agreementInput(won.opportunityId)), "AGREEMENT_ALREADY_EXISTS");

    const instructions = "Call Pat on 555-0100 before delivery";
    const draftIn = { idempotencyKey: key(), salesAgreementId: agreement.salesAgreementId, customerPO: "PO-77", specialInstructions: instructions,
      customerDiscount: { kind: "PERCENT", percentBasisPoints: 750 } };
    await applied("draft update", () => sa.updateSalesAgreementDraft(deps, SELLER, draftIn), {
      action: "salesAgreement.updateDraft", kind: "sales_agreement", id: agreement.salesAgreementId,
      before: { customerPO: null, specialInstructionsLength: null, customerDiscount: { kind: "PERCENT", percentBasisPoints: 500 } },
      after: { customerPO: "PO-77", specialInstructionsLength: instructions.length, customerDiscount: { kind: "PERCENT", percentBasisPoints: 750 } },
    });
    const draftRow = (await q(`SELECT before, after FROM eos_policy.audit_events WHERE action = 'salesAgreement.updateDraft' AND target_id = $1`, [agreement.salesAgreementId])).rows[0];
    assert.ok(!JSON.stringify(draftRow).includes("555-0100"), "special instructions are recorded as a length");
    await replayed("draft update replay", () => sa.updateSalesAgreementDraft(deps, SELLER, draftIn));
    await refused("discount above the actor's authority", () => sa.updateSalesAgreementDraft(deps, SELLER,
      { idempotencyKey: key(), salesAgreementId: agreement.salesAgreementId, customerDiscount: { kind: "PERCENT", percentBasisPoints: 1001 } }), "DISCOUNT_EXCEEDS_AUTHORITY");

    // A DRAFT with a proposed trade-in cannot be accepted until each is decided: approve item 1, decline item 2 (reason required).
    const approveIn = { idempotencyKey: key(), salesAgreementId: agreement.salesAgreementId, itemNumber: 1, approvedCreditMinor: 35000, reason: "inspected" };
    await refused("a seller cannot approve (capability)", () => sa.approveSalesAgreementTradeIn(deps, SELLER, approveIn), "CAPABILITY_REQUIRED");
    await applied("trade-in approve", () => sa.approveSalesAgreementTradeIn(deps, GM, approveIn), {
      action: "salesAgreement.approveTradeIn", kind: "sales_agreement", id: agreement.salesAgreementId, actor: "p-gm", reason: "inspected",
      before: { itemNumber: 1, approvalStatus: "PROPOSED", proposedValueMinor: 40000, tradeInCreditMinor: 0 },
      after: { itemNumber: 1, approvalStatus: "APPROVED", approvedCreditMinor: 35000, tradeInCreditMinor: 35000 },
    });
    await replayed("trade-in approve replay", () => sa.approveSalesAgreementTradeIn(deps, GM, approveIn));
    await refused("already decided", () => sa.approveSalesAgreementTradeIn(deps, GM, { ...approveIn, idempotencyKey: key() }), "TRADE_IN_ALREADY_DECIDED");
    await refused("a decline states its reason", () => sa.declineSalesAgreementTradeIn(deps, GM,
      { idempotencyKey: key(), salesAgreementId: agreement.salesAgreementId, itemNumber: 2 }), "REASON_REQUIRED");
    await refused("a decline reason over the existing 500-character limit", () => sa.declineSalesAgreementTradeIn(deps, GM,
      { idempotencyKey: key(), salesAgreementId: agreement.salesAgreementId, itemNumber: 2, reason: "x".repeat(501) }), "REASON_TOO_LONG");
    await applied("trade-in decline", () => sa.declineSalesAgreementTradeIn(deps, GM,
      { idempotencyKey: key(), salesAgreementId: agreement.salesAgreementId, itemNumber: 2, reason: "not in condition" }), {
      action: "salesAgreement.declineTradeIn", kind: "sales_agreement", id: agreement.salesAgreementId, actor: "p-gm", reason: "not in condition",
      before: { itemNumber: 2, approvalStatus: "PROPOSED", proposedValueMinor: 30000, tradeInCreditMinor: 35000 },
      after: { itemNumber: 2, approvalStatus: "DECLINED", approvedCreditMinor: null, tradeInCreditMinor: 35000 },
    });

    // Restating item 1 with a corrected description returns it to PROPOSED, so the credit AFTER the command is 0 (syncApprovedTradeInCredit),
    // not the 35000 the draft held before it; item 2 keeps its decision. The audit states the value after the sync and each trade-in's decision.
    const corrected = "Used reach-in (corrected)";
    await applied("draft update restating trade-ins", () => sa.updateSalesAgreementDraft(deps, SELLER, {
      idempotencyKey: key(), salesAgreementId: agreement.salesAgreementId, customerPO: "PO-78",
      tradeIns: [{ description: corrected, proposedValueMinor: 40000 }, { description: "Used cooler", proposedValueMinor: 30000 }] }), {
      action: "salesAgreement.updateDraft", kind: "sales_agreement", id: agreement.salesAgreementId,
      before: { customerPO: "PO-77", tradeInMinor: 35000, tradeIns: [
        { itemNumber: 1, proposedValueMinor: 40000, approvalStatus: "APPROVED", approvedCreditMinor: 35000, descriptionLength: "Used reach-in".length },
        { itemNumber: 2, proposedValueMinor: 30000, approvalStatus: "DECLINED", approvedCreditMinor: null, descriptionLength: "Used cooler".length }] },
      after: { customerPO: "PO-78", tradeInMinor: 0, tradeIns: [
        { itemNumber: 1, proposedValueMinor: 40000, approvalStatus: "PROPOSED", approvedCreditMinor: null, descriptionLength: corrected.length },
        { itemNumber: 2, proposedValueMinor: 30000, approvalStatus: "DECLINED", approvedCreditMinor: null, descriptionLength: "Used cooler".length }] },
    });
    await applied("trade-in re-approve", () => sa.approveSalesAgreementTradeIn(deps, GM,
      { idempotencyKey: key(), salesAgreementId: agreement.salesAgreementId, itemNumber: 1, approvedCreditMinor: 35000, reason: "re-inspected" }), {
      action: "salesAgreement.approveTradeIn", kind: "sales_agreement", id: agreement.salesAgreementId, actor: "p-gm", reason: "re-inspected",
      before: { itemNumber: 1, approvalStatus: "PROPOSED", proposedValueMinor: 40000, tradeInCreditMinor: 0 },
      after: { itemNumber: 1, approvalStatus: "APPROVED", approvedCreditMinor: 35000, tradeInCreditMinor: 35000 },
    });

    const acceptIn = { idempotencyKey: key(), salesAgreementId: agreement.salesAgreementId };
    await applied("accept", () => sa.acceptSalesAgreement(deps, ACCEPTOR, acceptIn), {
      action: "salesAgreement.accept", kind: "sales_agreement", id: agreement.salesAgreementId, actor: "p2",
      before: { state: "DRAFT" }, after: { state: "ACCEPTED", acceptedBy: "p2" },
    });
    await replayed("accept replay", () => sa.acceptSalesAgreement(deps, ACCEPTOR, acceptIn));
    await refused("accepted is immutable", () => sa.updateSalesAgreementDraft(deps, SELLER, { idempotencyKey: key(), salesAgreementId: agreement.salesAgreementId, customerPO: "late" }), "ILLEGAL_TRANSITION");
  });

  // ════════════════════ CLOSE AS WON / SALES ORDER ════════════════════
  let order;
  await t.test("opportunity.closeAsWon: one row on the Opportunity names the Sales Order it created", async () => {
    for (const toStage of STAGES) await opp.transitionOpportunity(deps, SELLER, { idempotencyKey: key(), opportunityId: won.opportunityId, toStage });
    const input = { idempotencyKey: key(), opportunityId: won.opportunityId, salesChannel: "RETAIL" };
    order = await applied("closeAsWon", () => opp.closeOpportunityAsWon(deps, SELLER, input), {
      action: "opportunity.closeAsWon", kind: "opportunity", id: won.opportunityId,
      before: { stage: "DECISION", outcome: null }, after: (r) => ({ outcome: "WON", salesOrderId: r.salesOrderId, salesOrderNumber: r.salesOrderNumber, recovered: false }),
    });
    await replayed("closeAsWon replay", () => opp.closeOpportunityAsWon(deps, SELLER, input));
    await refused("the Opportunity already has an Order", () => opp.closeOpportunityAsWon(deps, SELLER, { ...input, idempotencyKey: key() }), "SALES_ORDER_ALREADY_EXISTS");
  });

  await t.test("salesOrder.createFromOpportunity: a WON Opportunity without an Order gets its Order, with one row", async () => {
    const recovered = await opp.createOpportunity(deps, SELLER, newOpportunityInput());
    for (const toStage of STAGES) await opp.transitionOpportunity(deps, SELLER, { idempotencyKey: key(), opportunityId: recovered.opportunityId, toStage });
    const ag = await sa.createSalesAgreement(deps, SELLER, agreementInput(recovered.opportunityId));
    await sa.acceptSalesAgreement(deps, SELLER, { idempotencyKey: key(), salesAgreementId: ag.salesAgreementId });
    await opp.transitionOpportunity(deps, SELLER, { idempotencyKey: key(), opportunityId: recovered.opportunityId, outcome: "WON" });
    await refused("channel mismatch", () => so.createSalesOrderFromOpportunity(deps, SELLER, { idempotencyKey: key(), opportunityId: recovered.opportunityId, salesChannel: "NATIONAL_ACCOUNTS", ownerEmployeeId: "e-gm" }), "SALES_CHANNEL_MISMATCH");
    const input = { idempotencyKey: key(), opportunityId: recovered.opportunityId, ownerEmployeeId: "e-gm" };
    await applied("createFromOpportunity", () => so.createSalesOrderFromOpportunity(deps, SELLER, input), {
      action: "salesOrder.createFromOpportunity", kind: "sales_order", id: (r) => r.salesOrderId, before: null,
      after: (r) => ({ salesOrderNumber: r.salesOrderNumber, opportunityId: recovered.opportunityId, salesAgreementId: ag.salesAgreementId, state: "CONFIRMED", salesChannel: "RETAIL" }),
    });
    await replayed("createFromOpportunity replay", () => so.createSalesOrderFromOpportunity(deps, SELLER, input));
  });

  let direct;
  await t.test("salesOrder.create (direct), transition (ADVANCE, CANCEL) and the service-provider authorization", async () => {
    const createIn = { idempotencyKey: key(), accountId: "acct-1", ownerEmployeeId: "e-national", operatingCompanyId: "taylor", salesChannel: "NATIONAL_ACCOUNTS",
      notes: "Direct", lines: [{ kind: "PART", ref: "part-b", orderedQty: 3, unitPrice: 2500 }], accountableEmployeeId: "e-gm" };
    direct = await applied("direct create", () => so.createSalesOrder(deps, SELLER, createIn), {
      action: "salesOrder.create", kind: "sales_order", id: (r) => r.salesOrderId, before: null,
      after: (r) => ({ salesOrderNumber: r.salesOrderNumber, accountId: "acct-1", opportunityId: null, state: "CONFIRMED", salesChannel: "NATIONAL_ACCOUNTS",
        ownerEmployeeId: "e-national", accountableEmployeeId: "e-gm", accountablePersonSource: "EXPLICIT" }),
    });
    await replayed("direct create replay", () => so.createSalesOrder(deps, SELLER, createIn));
    await refused("server-derived inheritance is refused", () => so.createSalesOrder(deps, SELLER, { ...createIn, idempotencyKey: key(), inheritedCreditedSalespersonId: "e-gm" }), "FIELD_NOT_ACCEPTED");

    const advanceIn = { idempotencyKey: key(), salesOrderId: direct.salesOrderId, transition: "ADVANCE" };
    await applied("advance", () => so.transitionSalesOrder(deps, SELLER, advanceIn), {
      action: "salesOrder.transition", kind: "sales_order", id: direct.salesOrderId, before: { state: "CONFIRMED" }, after: { state: "IN_FULFILLMENT", transition: "ADVANCE" },
    });
    await replayed("advance replay", () => so.transitionSalesOrder(deps, SELLER, advanceIn));
    await refused("not fully fulfilled", () => so.transitionSalesOrder(deps, SELLER, { idempotencyKey: key(), salesOrderId: direct.salesOrderId, transition: "ADVANCE" }), "SALES_ORDER_NOT_FULLY_FULFILLED");

    const authIn = { idempotencyKey: key(), salesOrderId: direct.salesOrderId, serviceOperatingCompanyId: "ventana", scopes: ["SERVICE"], reason: "Ventana services this order" };
    await applied("authorize", () => so.authorizeSalesOrderServiceProvider(deps, SELLER, authIn), {
      action: "salesOrder.authorizeServiceProvider", kind: "sales_order", id: direct.salesOrderId, before: null,
      after: { serviceOperatingCompanyKey: "ventana-ops-t1", scopes: ["SERVICE"], status: "ACTIVE" }, reason: "Ventana services this order",
    });
    await replayed("authorize replay", () => so.authorizeSalesOrderServiceProvider(deps, SELLER, authIn));
    await refused("a reason is required", () => so.authorizeSalesOrderServiceProvider(deps, SELLER, { ...authIn, idempotencyKey: key(), reason: " " }), "REASON_REQUIRED");
    await refused("an authorize reason over the existing 500-character limit", () => so.authorizeSalesOrderServiceProvider(deps, SELLER, { ...authIn, idempotencyKey: key(), reason: "x".repeat(501) }), "REASON_TOO_LONG");
    await refused("a revoke reason over the existing 500-character limit", () => so.revokeSalesOrderServiceProvider(deps, SELLER,
      { idempotencyKey: key(), salesOrderId: direct.salesOrderId, serviceOperatingCompanyId: "ventana", reason: "x".repeat(501) }), "REASON_TOO_LONG");
    await applied("revoke", () => so.revokeSalesOrderServiceProvider(deps, SELLER,
      { idempotencyKey: key(), salesOrderId: direct.salesOrderId, serviceOperatingCompanyId: "ventana", reason: "work finished" }), {
      action: "salesOrder.revokeServiceProvider", kind: "sales_order", id: direct.salesOrderId, reason: "work finished",
      before: { serviceOperatingCompanyKey: "ventana-ops-t1", status: "ACTIVE" }, after: { serviceOperatingCompanyKey: "ventana-ops-t1", status: "REVOKED" },
    });
    // Re-authorizing a revoked provider carries the REVOKED row as its before.
    await applied("re-authorize", () => so.authorizeSalesOrderServiceProvider(deps, SELLER, { ...authIn, idempotencyKey: key() }), {
      action: "salesOrder.authorizeServiceProvider", kind: "sales_order", id: direct.salesOrderId, reason: "Ventana services this order",
      before: { serviceOperatingCompanyKey: "ventana-ops-t1", status: "REVOKED" }, after: { status: "ACTIVE" },
    });

    const cancelIn = { idempotencyKey: key(), salesOrderId: direct.salesOrderId, transition: "CANCEL" };
    await applied("cancel", () => so.transitionSalesOrder(deps, SELLER, cancelIn), {
      action: "salesOrder.transition", kind: "sales_order", id: direct.salesOrderId, before: { state: "IN_FULFILLMENT" }, after: { state: "CANCELLED", transition: "CANCEL" },
    });
    await refused("terminal", () => so.transitionSalesOrder(deps, SELLER, { idempotencyKey: key(), salesOrderId: direct.salesOrderId, transition: "CANCEL" }), "TERMINAL");
  });

  // ════════════════════ CRM ════════════════════
  let account; let contact; let site;
  await t.test("crm.createAccount / updateAccount (owner handoff reason) / createContact / updateContact / createAccountLocation / updateAccountLocation / importAccountContacts", async () => {
    const accIn = { idempotencyKey: key(), name: "Audit Co", status: "ACTIVE", ownerEmployeeId: "e-retail" };
    account = await applied("createAccount", () => accounts.createAccount(crmDeps, CRM, accIn), {
      action: "crm.createAccount", kind: "crm_account", id: (r) => r.accountId, before: null,
      after: (r) => ({ accountId: r.accountId, name: "Audit Co", status: "ACTIVE", ownerEmployeeId: "e-retail" }),
    });
    await replayed("createAccount replay", () => accounts.createAccount(crmDeps, CRM, accIn));
    await refused("createAccount without an owner", () => accounts.createAccount(crmDeps, CRM, { idempotencyKey: key(), name: "No Owner", status: "ACTIVE" }), "OWNER_REQUIRED");
    await refused("createAccount without the capability", () => accounts.createAccount(crmDeps, { ...CRM, capabilities: new Set(["customer.record.read"]) }, { ...accIn, idempotencyKey: key() }), "CAPABILITY_REQUIRED");

    await applied("updateAccount", () => accounts.updateAccount(crmDeps, CRM, { accountId: account.accountId, name: "Audit Co Renamed" }), {
      action: "crm.updateAccount", kind: "crm_account", id: account.accountId, before: { name: "Audit Co" }, after: { name: "Audit Co Renamed" },
    });
    await applied("updateAccount owner handoff", () => accounts.updateAccount(crmDeps, CRM,
      { accountId: account.accountId, ownerEmployeeId: "e-national", ownershipHandoff: { reason: "territory realignment" } }), {
      action: "crm.updateAccount", kind: "crm_account", id: account.accountId, reason: "territory realignment",
      before: { ownerEmployeeId: "e-retail" }, after: { ownerEmployeeId: "e-national" },
    });
    // Notes and the billing address are free text / contact details: a length and presence flags, never the text.
    await applied("updateAccount notes and billing address", () => accounts.updateAccount(crmDeps, CRM,
      { accountId: account.accountId, notes: "Prefers calls after 5pm", billingAddress: { street: "1 Main St", city: "Tempe", state: "AZ", zip: "85281" } }), {
      action: "crm.updateAccount", kind: "crm_account", id: account.accountId,
      before: { notesLength: null, billingAddressPresent: false }, after: { notesLength: "Prefers calls after 5pm".length, billingAddressPresent: true, notesChanged: true, billingAddressChanged: true },
    });
    await refused("updateAccount with nothing to change", () => accounts.updateAccount(crmDeps, CRM, { accountId: account.accountId }), "NO_CHANGES_REQUESTED");
    await refused("updateAccount on an unknown Account", () => accounts.updateAccount(crmDeps, CRM, { accountId: "acct-nope", name: "x" }), "ACCOUNT_NOT_FOUND");

    const contactIn = { idempotencyKey: key(), accountId: account.accountId, name: "Pat Doe", email: "pat@example.com" };
    contact = await applied("createContact", () => contacts.createContact(crmDeps, CRM, contactIn), {
      action: "crm.createContact", kind: "crm_contact", id: (r) => r.contactId, before: null, after: { accountId: account.accountId, name: "Pat Doe", emailPresent: true, phonePresent: false },
    });
    await replayed("createContact replay", () => contacts.createContact(crmDeps, CRM, contactIn));
    await applied("updateContact", () => contacts.updateContact(crmDeps, CRM, { contactId: contact.contactId, phone: "555-0100" }), {
      action: "crm.updateContact", kind: "crm_contact", id: contact.contactId, before: { phonePresent: false }, after: { phonePresent: true, phoneChanged: true, emailChanged: false },
    });
    await refused("updateContact on an unknown Contact", () => contacts.updateContact(crmDeps, CRM, { contactId: "cont-nope", phone: "1" }), "CONTACT_NOT_FOUND");

    const importIn = { idempotencyKey: key(), accountId: account.accountId, contacts: [{ name: "Imported One" }, { name: "Imported Two" }] };
    const imported = await applied("importAccountContacts", () => contacts.importAccountContacts(crmDeps, CRM, importIn), {
      action: "crm.importAccountContacts", kind: "crm_account", id: account.accountId, before: null, after: { importedCount: 2 },
    });
    const importRow = (await q(`SELECT after FROM eos_policy.audit_events WHERE action = 'crm.importAccountContacts'`)).rows[0];
    assert.deepEqual(importRow.after.contactIds.slice().sort(), imported.contacts.map((c) => c.contactId).sort(), "the one row names every imported Contact");
    await replayed("importAccountContacts replay", () => contacts.importAccountContacts(crmDeps, CRM, importIn));
    await refused("an invalid row refuses the whole import", () => contacts.importAccountContacts(crmDeps, CRM,
      { idempotencyKey: key(), accountId: account.accountId, contacts: [{ name: "Fine" }, { name: "" }] }), "IMPORT_ROWS_INVALID");

    const siteIn = { idempotencyKey: key(), accountId: account.accountId, name: "Main yard", addressCity: "Phoenix" };
    site = await applied("createAccountLocation", () => sites.createAccountLocation(crmDeps, CRM, siteIn), {
      action: "crm.createAccountLocation", kind: "crm_account_location", id: (r) => r.accountLocationId, before: null,
      after: { accountId: account.accountId, name: "Main yard", addressPresent: true, accessNotesLength: null },
    });
    await replayed("createAccountLocation replay", () => sites.createAccountLocation(crmDeps, CRM, siteIn));
    await applied("updateAccountLocation", () => sites.updateAccountLocation(crmDeps, CRM, { accountLocationId: site.accountLocationId, accessNotes: "Gate code 1234" }), {
      action: "crm.updateAccountLocation", kind: "crm_account_location", id: site.accountLocationId, before: { accessNotesLength: null }, after: { accessNotesLength: "Gate code 1234".length, accessNotesChanged: true, addressChanged: false },
    });
    await refused("updateAccountLocation on an unknown site", () => sites.updateAccountLocation(crmDeps, CRM, { accountLocationId: "site-nope", name: "x" }), "ACCOUNT_LOCATION_NOT_FOUND");
  });

  // ════════════════════ same transaction ════════════════════
  await t.test("a failure of the receipt or of the audit write rolls the whole command back: no applied-but-unaudited command", async () => {
    const n0 = await total();
    const opps = async () => (await q(`SELECT count(*)::int n FROM eos_commercial.opportunities`)).rows[0].n;
    const o0 = await opps();
    await forceFail("eos_commercial.command_receipts", async () => {
      await assert.rejects(opp.createOpportunity(deps, SELLER, newOpportunityInput()), code("COMMAND_FAILED"));
    });
    assert.equal(await total(), n0, "the audit row rolled back with the command");
    assert.equal(await opps(), o0, "the Opportunity rolled back with the audit row");

    await forceFail("eos_policy.audit_events", async () => {
      await assert.rejects(opp.createOpportunity(deps, SELLER, newOpportunityInput()), code("COMMAND_FAILED"));
      await assert.rejects(accounts.updateAccount(crmDeps, CRM, { accountId: account.accountId, name: "Never Applied" }), code("CRM_COMMAND_FAILED"));
      await assert.rejects(contacts.createContact(crmDeps, CRM, { idempotencyKey: key(), accountId: account.accountId, name: "Never Applied" }), code("CRM_COMMAND_FAILED"));
    });
    assert.equal(await opps(), o0, "a command whose audit write fails is not applied");
    assert.equal((await q(`SELECT name FROM eos_crm.accounts WHERE id = $1`, [account.accountId])).rows[0].name, "Audit Co Renamed");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_crm.contacts WHERE name = 'Never Applied'`)).rows[0].n, 0);
    assert.equal(await total(), n0);
  });

  await t.test("audit_events is append-only: no free text and no contact detail reached it anywhere in the run", async () => {
    const everything = JSON.stringify((await q(`SELECT action, target_id, before, after, reason FROM eos_policy.audit_events WHERE tenant_id = 't1'`)).rows);
    for (const secret of ["Send revised quote", "pat@example.com", "555-0100", "Gate code", "Phoenix", "Prefers calls", "1 Main St", "Tempe", "85281",
      "Call Pat", "Used reach-in", "Used cooler", "Walk-in freezer"]) {
      assert.ok(!everything.includes(secret), `"${secret}" must be recorded as a length or a flag, never as text`);
    }
  });

  await t.test("every audit row of the run is attributed to a Principal and carries an operation action", async () => {
    const rows = (await q(`SELECT action, actor_uid, target_kind, target_id FROM eos_policy.audit_events WHERE tenant_id = 't1'`)).rows;
    assert.ok(rows.length > 30, `expected the whole run to be audited, saw ${rows.length}`);
    for (const r of rows) {
      assert.ok(["p1", "p2", "p-gm"].includes(r.actor_uid), `${r.action}: actor ${r.actor_uid}`);
      assert.match(r.action, /^(opportunity|salesAgreement|salesOrder|crm)\.[A-Za-z]+$/);
      assert.ok(r.target_id);
    }
  });
});
