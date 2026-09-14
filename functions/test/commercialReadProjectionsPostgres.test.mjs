// WAVE C3 against a real postgres:16 -- the governed PostgreSQL Commercial read projections.
//
// Its OWN database, migrated by the normal runner. The records are written by the real C2 commands (and, for the
// identity-only rows, by the bounded spine writer the synthetic seed uses), then read back through the real C3
// projections. Numbers in test names refer to the C3 work order's proof list.
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
const { createCommercialRecord } = require("../lib/eosCommercial/commercialOwnershipRepository.js");
const kernel = require("../lib/eosCommercial/reads/commercialReadKernel.js");
const oppRead = require("../lib/eosCommercial/reads/opportunityReadProjection.js");
const saRead = require("../lib/eosCommercial/reads/salesAgreementReadProjection.js");
const soRead = require("../lib/eosCommercial/reads/salesOrderReadProjection.js");
const { getAccountCommercialProjection } = require("../lib/eosCommercial/reads/accountCommercialProjection.js");

const DB_NAME = `c3_reads_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

const WRITE_CAPS = new Set(["opportunity.write", "opportunity.createSalesOrder", "salesAgreement.create", "salesAgreement.updateDraft", "salesAgreement.accept", "salesOrder.write"]);
const READ_CAPS = new Set(["opportunity.read", "salesAgreement.read", "salesOrder.read"]);
const WRITER_T1 = Object.freeze({ tenantId: "t1", principalId: "p1", capabilities: WRITE_CAPS });
const WRITER_T2 = Object.freeze({ tenantId: "t2", principalId: "p-t2", capabilities: WRITE_CAPS });
const READER = Object.freeze({ tenantId: "t1", principalId: "p-reader", capabilities: READ_CAPS });
const READER_T2 = Object.freeze({ tenantId: "t2", principalId: "p-t2", capabilities: READ_CAPS });
const key = () => `k-${randomUUID()}`;
const code = (c) => (e) => e.code === c;
const catalog = { async verifyReferences(_db, _t, refs) { return refs.map(() => "FOUND"); } };
const STAGES = ["IDENTIFIED", "QUALIFYING", "SOLUTION", "QUOTING", "CUSTOMER_REVIEW", "DECISION"];

test("governed PostgreSQL Commercial read projections, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe",
  });
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 8 });
  t.after(async () => {
    await pool.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  const q = (text, values = []) => pool.query(text, values);
  const writeDeps = { pool, catalog };

  // Every statement a read issues, captured. A read that wrote anything would show up here before it showed up in data.
  const statements = [];
  const spyPool = {
    connect: async () => {
      const client = await pool.connect();
      return { query: (text, values) => { statements.push(String(text)); return client.query(text, values); }, release: () => client.release() };
    },
  };
  const readDeps = { pool: spyPool };

  // ── the world ──
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, owner_employee_id, created_by, updated_by) VALUES
    ('acct-1','t1','Retail Customer','ACTIVE','e-retail','x','x'), ('acct-2','t1','Second Customer','ACTIVE','e-national','x','x'),
    ('acct-t2','t2','Retail Customer','ACTIVE','e-t2','x','x')`);
  await q(`INSERT INTO eos_crm.account_locations (id, tenant_id, account_id, name, created_by, updated_by) VALUES ('loc-1','t1','acct-1','Main Kitchen','x','x')`);
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES
    ('e-retail','t1','ACTIVE','taylor'), ('e-national','t1','ACTIVE','taylor'), ('e-gm','t1','ACTIVE','taylor'), ('e-contractor','t1','CONTRACTOR','taylor'),
    ('e-leaver','t1','ACTIVE','taylor'), ('e-t2','t2','ACTIVE','taylor')`);
  for (const [p, tenant, status] of [["p1", "t1", "active"], ["p-reader", "t1", "active"], ["p-t2", "t2", "active"], ["p-disabled", "t1", "disabled"]]) {
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ($1,$1,'proof',$2)`, [p, status]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ($1,$2,$3)`, [`m-${p}`, tenant, p]);
  }

  const newOpportunity = (actor, overrides = {}) => opp.createOpportunity(writeDeps, actor, {
    idempotencyKey: key(), accountId: "acct-1", salesChannel: "RETAIL", operatingCompanyId: "taylor", need: "Walk-in freezer",
    expectedValue: 18500.5, expectedCloseAt: Date.parse("2026-11-01T00:00:00Z"),
    lines: [{ kind: "EQUIPMENT_MODEL", ref: "model-a", qty: 1 }, { kind: "PART", ref: "part-retired", qty: 2 }, { kind: "SERVICE", ref: "svc-install", qty: 1 }],
    ...overrides,
  });
  const advanceToDecision = async (actor, id) => {
    for (const toStage of STAGES.slice(1)) await opp.transitionOpportunity(writeDeps, actor, { idempotencyKey: key(), opportunityId: id, toStage });
  };

  // The governed chain in t1: Opportunity -> Agreement (accepted) -> WON -> Sales Order.
  const o1 = await newOpportunity(WRITER_T1, { accountableEmployeeId: "e-gm", creditedSalespersonId: "e-leaver" });
  const a1 = await sa.createSalesAgreement(writeDeps, WRITER_T1, {
    idempotencyKey: key(), opportunityId: o1.opportunityId, ownerEmployeeId: "e-retail", accountableEmployeeId: "e-contractor", isLease: false,
    fulfillmentIntent: "INSTALL", locationId: "loc-1", customerPO: "PO-77",
    lines: [{ kind: "EQUIPMENT_MODEL", ref: "model-a", quantity: 1, unitPrice: 1250000, condition: "NEW" }, { kind: "SERVICE", ref: "svc-install", quantity: 2, unitPrice: 50000, businessUnitId: "INSTALLATION" }],
    shippingMinor: 15000, taxMinor: 8000, downPaymentMinor: 100000,
  });
  await advanceToDecision(WRITER_T1, o1.opportunityId);
  const draftBeforeAccept = await saRead.getSalesAgreementDetail(readDeps, READER, { salesAgreementId: a1.salesAgreementId });
  await sa.acceptSalesAgreement(writeDeps, WRITER_T1, { idempotencyKey: key(), salesAgreementId: a1.salesAgreementId });
  const won = await opp.closeOpportunityAsWon(writeDeps, WRITER_T1, { idempotencyKey: key(), opportunityId: o1.opportunityId, salesChannel: "RETAIL" });
  // A direct Order on the second Account, with a Location that has no eos_crm row.
  const direct = await so.createSalesOrder(writeDeps, WRITER_T1, {
    idempotencyKey: key(), accountId: "acct-2", ownerEmployeeId: "e-national", operatingCompanyId: "taylor", salesChannel: "NATIONAL_ACCOUNTS",
    notes: "Direct", locationId: "loc-unknown", lines: [{ kind: "PART", ref: "part-b", orderedQty: 3, unitPrice: 2500 }, { kind: "SERVICE", ref: "svc-x", orderedQty: 1, unitPrice: 4000, businessUnitId: "SERVICE" }],
  });
  // More complete Opportunities on acct-1 for paging, and one on acct-2.
  const extra = [];
  for (let i = 0; i < 4; i++) extra.push(await newOpportunity(WRITER_T1, { need: `Extra ${i}` }));
  const onAcct2 = await newOpportunity(WRITER_T1, { accountId: "acct-2" });
  // Tenant t2, on an Account with the same name.
  const t2opp = await newOpportunity(WRITER_T2, { accountId: "acct-t2", lines: [{ kind: "SERVICE", ref: "svc-t2", qty: 1 }] });
  const t2agreement = await sa.createSalesAgreement(writeDeps, WRITER_T2, { idempotencyKey: key(), opportunityId: t2opp.opportunityId, ownerEmployeeId: "e-t2", lines: [{ kind: "SERVICE", ref: "svc-t2", quantity: 1, unitPrice: 100, businessUnitId: "SERVICE" }] });
  const t2order = await so.createSalesOrder(writeDeps, WRITER_T2, { idempotencyKey: key(), accountId: "acct-t2", ownerEmployeeId: "e-t2", operatingCompanyId: "taylor", salesChannel: "RETAIL", lines: [{ kind: "SERVICE", ref: "svc-t2", orderedQty: 1, unitPrice: 100, businessUnitId: "SERVICE" }] });
  // Identity-only spine rows, exactly as the synthetic nonprod seed writes them.
  const spineOpp = await createCommercialRecord(pool, "t1", "seed", { kind: "OPPORTUNITY", recordNumber: "SEED-OPP-1", accountId: "acct-1", ownerEmployeeId: "e-retail", operatingCompanyId: "taylor", createdBy: "seed" });
  const spineAgreement = await createCommercialRecord(pool, "t1", "seed", { kind: "SALES_AGREEMENT", recordNumber: "SEED-SA-1", accountId: "acct-1", ownerEmployeeId: "e-retail", operatingCompanyId: "taylor", createdBy: "seed", opportunityId: spineOpp.id });
  const spineOrder = await createCommercialRecord(pool, "t1", "seed", { kind: "SALES_ORDER", recordNumber: "SEED-SO-1", accountId: "acct-1", ownerEmployeeId: "e-retail", operatingCompanyId: "taylor", createdBy: "seed", opportunityId: spineOpp.id, salesAgreementId: spineAgreement.id });
  // A person who has since left: still the credited salesperson of record.
  await q(`UPDATE eos_workforce.employees SET employment_status = 'TERMINATED' WHERE id = 'e-leaver'`);

  // ════════════════════ TENANCY / AUTHORITY ════════════════════
  await t.test("(6)(7)(8) another tenant's Opportunity, Agreement and Order are NOT_FOUND, never disclosed", async () => {
    await assert.rejects(oppRead.getOpportunityDetail(readDeps, READER_T2, { opportunityId: o1.opportunityId }), code("RECORD_NOT_FOUND"));
    await assert.rejects(saRead.getSalesAgreementDetail(readDeps, READER_T2, { salesAgreementId: a1.salesAgreementId }), code("RECORD_NOT_FOUND"));
    await assert.rejects(soRead.getSalesOrderDetail(readDeps, READER_T2, { salesOrderId: won.salesOrderId }), code("RECORD_NOT_FOUND"));
    await assert.rejects(oppRead.getOpportunityDetail(readDeps, READER, { opportunityId: t2opp.opportunityId }), code("RECORD_NOT_FOUND"));
    await assert.rejects(saRead.getSalesAgreementDetail(readDeps, READER, { salesAgreementId: t2agreement.salesAgreementId }), code("RECORD_NOT_FOUND"));
    await assert.rejects(soRead.getSalesOrderDetail(readDeps, READER, { salesOrderId: t2order.salesOrderId }), code("RECORD_NOT_FOUND"));
    const t2lists = [await oppRead.listOpportunities(readDeps, READER_T2), await saRead.listSalesAgreements(readDeps, READER_T2), await soRead.listSalesOrders(readDeps, READER_T2)];
    assert.deepEqual(t2lists.map((p) => p.items.map((i) => i.id)), [[t2opp.opportunityId], [t2agreement.salesAgreementId], [t2order.salesOrderId]]);
  });

  await t.test("(9) a disabled principal, and a principal of another tenant, refuse ACTOR_NOT_TENANT_MEMBER", async () => {
    await assert.rejects(oppRead.listOpportunities(readDeps, { ...READER, principalId: "p-disabled" }), code("ACTOR_NOT_TENANT_MEMBER"));
    await assert.rejects(oppRead.listOpportunities(readDeps, { ...READER, principalId: "p-t2" }), code("ACTOR_NOT_TENANT_MEMBER"));
    await assert.rejects(oppRead.listOpportunities(readDeps, { ...READER, principalId: "p-nobody" }), code("ACTOR_NOT_TENANT_MEMBER"));
  });

  await t.test("(10) the existing read capability is required; write capabilities never stand in for it", async () => {
    const writerOnly = { ...READER, capabilities: WRITE_CAPS };
    await assert.rejects(oppRead.getOpportunityDetail(readDeps, writerOnly, { opportunityId: o1.opportunityId }), code("CAPABILITY_REQUIRED"));
    await assert.rejects(saRead.getSalesAgreementDetail(readDeps, writerOnly, { salesAgreementId: a1.salesAgreementId }), code("CAPABILITY_REQUIRED"));
    await assert.rejects(soRead.listSalesOrders(readDeps, writerOnly), code("CAPABILITY_REQUIRED"));
    await assert.rejects(soRead.getSalesOrderDetail(readDeps, { ...READER, capabilities: new Set(["opportunity.read", "salesAgreement.read"]) }, { salesOrderId: won.salesOrderId }), code("CAPABILITY_REQUIRED"));
    await assert.rejects(getAccountCommercialProjection(readDeps, { ...READER, capabilities: new Set(["opportunity.read", "salesOrder.read"]) }, { accountId: "acct-1" }), code("CAPABILITY_REQUIRED"));
  });

  await t.test("(11) a caller-supplied tenantId is not a selector", async () => {
    await assert.rejects(oppRead.getOpportunityDetail(readDeps, READER_T2, { opportunityId: o1.opportunityId, tenantId: "t1" }), code("RECORD_NOT_FOUND"));
    const page = await oppRead.listOpportunities(readDeps, READER_T2, { tenantId: "t1" });
    assert.deepEqual(page.items.map((i) => i.id), [t2opp.opportunityId]);
    await assert.rejects(getAccountCommercialProjection(readDeps, READER_T2, { accountId: "acct-1", tenantId: "t1" }), code("ACCOUNT_NOT_FOUND"));
  });

  // ════════════════════ OPPORTUNITY ════════════════════
  await t.test("(12)(13)(16)(17)(18) Opportunity detail: complete governed facts, ordered lines, edit version, derived lineage", async () => {
    const d = await oppRead.getOpportunityDetail(readDeps, READER, { opportunityId: o1.opportunityId });
    const row = (await q(`SELECT edit_version, created_at, updated_at, closed_at FROM eos_commercial.opportunities WHERE id=$1`, [o1.opportunityId])).rows[0];
    assert.equal(d.id, o1.opportunityId);
    assert.equal(d.opportunityNumber, o1.opportunityNumber);
    assert.deepEqual([d.accountId, d.accountName, d.operatingCompanyId, d.salesChannel, d.stage, d.outcome, d.need, d.expectedValue, d.expectedCloseAt, d.nextAction],
      ["acct-1", "Retail Customer", "taylor", "RETAIL", "DECISION", "WON", "Walk-in freezer", 18500.5, "2026-11-01T00:00:00.000Z", null]);
    assert.equal(d.editVersion, Number(row.edit_version));
    assert.equal(d.closedAt, row.closed_at.toISOString());
    assert.deepEqual([d.createdAt, d.updatedAt], [row.created_at.toISOString(), row.updated_at.toISOString()]);
    assert.deepEqual(d.lines, [
      { lineNumber: 1, kind: "EQUIPMENT_MODEL", ref: "model-a", qty: 1 },
      { lineNumber: 2, kind: "PART", ref: "part-retired", qty: 2 },
      { lineNumber: 3, kind: "SERVICE", ref: "svc-install", qty: 1 },
    ]);
    assert.deepEqual(d.salesAgreement, { id: a1.salesAgreementId, number: a1.salesAgreementNumber, state: "ACCEPTED" });
    assert.deepEqual(d.salesOrder, { id: won.salesOrderId, number: won.salesOrderNumber, state: "CONFIRMED" });
    for (const legacy of ["name", "createdAtMillis", "updatedAtMillis", "salesAgreementId", "salesOrderId", "salesOrderNumber"]) assert.ok(!(legacy in d), `restored legacy field ${legacy}`);
    const open = await oppRead.getOpportunityDetail(readDeps, READER, { opportunityId: extra[0].opportunityId });
    assert.deepEqual([open.salesAgreement, open.salesOrder, open.closedAt, open.editVersion], [null, null, null, 1]);
  });

  await t.test("(14)(15)(39) owner, Accountable Person and credited salesperson stay distinct on every family", async () => {
    const d = await oppRead.getOpportunityDetail(readDeps, READER, { opportunityId: o1.opportunityId });
    assert.deepEqual([d.owner.employeeId, d.accountablePerson.employeeId, d.creditedSalesperson.employeeId], ["e-retail", "e-gm", "e-leaver"]);
    const a = await saRead.getSalesAgreementDetail(readDeps, READER, { salesAgreementId: a1.salesAgreementId });
    assert.deepEqual([a.owner.employeeId, a.accountablePerson.employeeId], ["e-retail", "e-contractor"]);
    const rows = (await q(`SELECT owner_employee_id, accountable_employee_id, credited_salesperson_employee_id FROM eos_commercial.sales_orders WHERE id=$1`, [won.salesOrderId])).rows[0];
    const o = await soRead.getSalesOrderDetail(readDeps, READER, { salesOrderId: won.salesOrderId });
    assert.deepEqual([o.owner.employeeId, o.accountablePerson.employeeId, o.creditedSalesperson.employeeId],
      [rows.owner_employee_id, rows.accountable_employee_id, rows.credited_salesperson_employee_id]);
  });

  await t.test("(19) a nonexistent id is NOT_FOUND on every family", async () => {
    await assert.rejects(oppRead.getOpportunityDetail(readDeps, READER, { opportunityId: "opp_missing" }), code("RECORD_NOT_FOUND"));
    await assert.rejects(saRead.getSalesAgreementDetail(readDeps, READER, { salesAgreementId: "sag_missing" }), code("RECORD_NOT_FOUND"));
    await assert.rejects(soRead.getSalesOrderDetail(readDeps, READER, { salesOrderId: "sor_missing" }), code("RECORD_NOT_FOUND"));
  });

  await t.test("(20)(21)(28)(34) identity-only rows refuse RECORD_INCOMPLETE in detail and are absent from every list and the Account projection", async () => {
    await assert.rejects(oppRead.getOpportunityDetail(readDeps, READER, { opportunityId: spineOpp.id }), code("RECORD_INCOMPLETE"));
    await assert.rejects(saRead.getSalesAgreementDetail(readDeps, READER, { salesAgreementId: spineAgreement.id }), code("RECORD_INCOMPLETE"));
    await assert.rejects(soRead.getSalesOrderDetail(readDeps, READER, { salesOrderId: spineOrder.id }), code("RECORD_INCOMPLETE"));
    const ids = [
      ...(await oppRead.listOpportunities(readDeps, READER, { limit: 200 })).items, ...(await saRead.listSalesAgreements(readDeps, READER, { limit: 200 })).items,
      ...(await soRead.listSalesOrders(readDeps, READER, { limit: 200 })).items,
    ].map((i) => i.id);
    for (const spine of [spineOpp.id, spineAgreement.id, spineOrder.id]) assert.ok(!ids.includes(spine), `${spine} listed as a business record`);
    const account = await getAccountCommercialProjection(readDeps, READER, { accountId: "acct-1", limit: 200 });
    const accountIds = [...account.opportunities.items, ...account.salesAgreements.items, ...account.salesOrders.items].map((i) => i.id);
    for (const spine of [spineOpp.id, spineAgreement.id, spineOrder.id]) assert.ok(!accountIds.includes(spine));
    // The spine rows are untouched and still countable by the measurement tools.
    assert.equal((await q(`SELECT count(*)::int n FROM eos_commercial.opportunities WHERE id=$1 AND stage IS NULL`, [spineOpp.id])).rows[0].n, 1);
  });

  // ════════════════════ SALES AGREEMENT ════════════════════
  await t.test("(22)(23)(24)(26)(27)(43) Agreement detail: governed facts, ordered lines, charge inputs, computed totals, lineage, Location display", async () => {
    const d = await saRead.getSalesAgreementDetail(readDeps, READER, { salesAgreementId: a1.salesAgreementId });
    assert.deepEqual([d.salesAgreementNumber, d.opportunityId, d.accountId, d.accountName, d.state, d.currency, d.customerPO, d.isLease, d.fulfillmentIntent],
      [a1.salesAgreementNumber, o1.opportunityId, "acct-1", "Retail Customer", "ACCEPTED", "USD", "PO-77", false, "INSTALL"]);
    assert.deepEqual(d.lines.map((l) => [l.lineNumber, l.kind, l.ref, l.businessUnit, l.quantity, l.unitPriceMinor, l.extendedMinor, l.condition]), [
      [1, "EQUIPMENT_MODEL", "model-a", "EQUIPMENT_SALES", 1, 1250000, 1250000, "NEW"],
      [2, "SERVICE", "svc-install", "INSTALLATION", 2, 50000, 100000, null],
    ]);
    assert.deepEqual(d.totals, { subtotalMinor: 1350000, shippingMinor: 15000, installChargeMinor: 0, taxMinor: 8000, totalMinor: 1373000, downPaymentMinor: 100000, tradeInMinor: 0, balanceMinor: 1273000 });
    assert.deepEqual(d.location, { locationId: "loc-1", name: "Main Kitchen" });
    assert.deepEqual(d.sourceOpportunity, { id: o1.opportunityId, number: o1.opportunityNumber, state: "DECISION" });
    assert.deepEqual(d.salesOrder, { id: won.salesOrderId, number: won.salesOrderNumber, state: "CONFIRMED" });
    assert.ok(!("acceptedByUid" in d) && !("totalsStored" in d));
  });

  await t.test("(25) acceptance metadata appears exactly when the state is ACCEPTED", async () => {
    assert.deepEqual([draftBeforeAccept.state, draftBeforeAccept.acceptedAt, draftBeforeAccept.acceptedByPrincipalId], ["DRAFT", null, null]);
    const accepted = await saRead.getSalesAgreementDetail(readDeps, READER, { salesAgreementId: a1.salesAgreementId });
    const row = (await q(`SELECT accepted_at, accepted_by FROM eos_commercial.sales_agreements WHERE id=$1`, [a1.salesAgreementId])).rows[0];
    assert.deepEqual([accepted.acceptedAt, accepted.acceptedByPrincipalId], [row.accepted_at.toISOString(), "p1"]);
    for (const item of (await saRead.listSalesAgreements(readDeps, READER, { limit: 200 })).items) {
      assert.equal(item.state === "ACCEPTED", item.acceptedAt !== null && item.acceptedByPrincipalId !== null, `${item.id} acceptance is inconsistent`);
    }
  });

  // ════════════════════ SALES ORDER ════════════════════
  await t.test("(29)(30)(31)(32)(33) Order detail: core Commercial facts, derived lineage, ordered lines, pricing, and no D2 execution field", async () => {
    const d = await soRead.getSalesOrderDetail(readDeps, READER, { salesOrderId: won.salesOrderId });
    assert.deepEqual([d.salesOrderNumber, d.opportunityId, d.salesAgreementId, d.accountId, d.state, d.salesChannel, d.currency],
      [won.salesOrderNumber, o1.opportunityId, a1.salesAgreementId, "acct-1", "CONFIRMED", "RETAIL", "USD"]);
    assert.ok(Date.parse(d.bookedAt) > 0);
    assert.deepEqual(d.sourceOpportunity, { id: o1.opportunityId, number: o1.opportunityNumber, state: "DECISION" });
    assert.deepEqual(d.sourceAgreement, { id: a1.salesAgreementId, number: a1.salesAgreementNumber, state: "ACCEPTED" });
    const agreementLines = (await saRead.getSalesAgreementDetail(readDeps, READER, { salesAgreementId: a1.salesAgreementId })).lines;
    assert.deepEqual(d.lines.map((l) => [l.lineNumber, l.ref, l.orderedQty, l.unitPriceMinor]), agreementLines.map((l) => [l.lineNumber, l.ref, l.quantity, l.unitPriceMinor]));
    const directDetail = await soRead.getSalesOrderDetail(readDeps, READER, { salesOrderId: direct.salesOrderId });
    assert.deepEqual([directDetail.sourceOpportunity, directDetail.sourceAgreement, directDetail.notes], [null, null, "Direct"]);
    assert.deepEqual([directDetail.pricingState, directDetail.totalMinor, directDetail.unpricedLineCount], ["PRICED", 11500, 0]);
    assert.deepEqual([d.pricingState, d.totalMinor], ["PRICED", 1350000]);
    const d2 = /allocat|fulfilled|billed|reserv|workOrder|serviceWorkOrder|invoice|readiness/i;
    const keys = (v) => (v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : []);
    assert.deepEqual(keys(d).filter((k) => d2.test(k)), [], "a D2 execution field is projected");
  });

  await t.test("(43) a Location with no eos_crm row keeps the record visible and fabricates no display", async () => {
    const d = await soRead.getSalesOrderDetail(readDeps, READER, { salesOrderId: direct.salesOrderId });
    assert.deepEqual(d.location, { locationId: "loc-unknown", name: null });
  });

  // ════════════════════ ACCOUNT-SCOPED ════════════════════
  await t.test("(35)(36)(37) the Account projection returns exactly this Account's records in this tenant, grouped by family", async () => {
    const p = await getAccountCommercialProjection(readDeps, READER, { accountId: "acct-1", limit: 200 });
    assert.deepEqual(p.account, { accountId: "acct-1", name: "Retail Customer" });
    const expectedOpps = (await q(`SELECT id FROM eos_commercial.opportunities WHERE tenant_id='t1' AND account_id='acct-1' AND stage IS NOT NULL ORDER BY opportunity_number DESC`)).rows.map((r) => r.id);
    assert.deepEqual(p.opportunities.items.map((i) => i.id), expectedOpps);
    assert.ok(!expectedOpps.includes(onAcct2.opportunityId));
    assert.deepEqual(p.salesAgreements.items.map((i) => i.id), [a1.salesAgreementId]);
    assert.deepEqual(p.salesOrders.items.map((i) => i.id), [won.salesOrderId]);
    for (const item of [...p.opportunities.items, ...p.salesAgreements.items, ...p.salesOrders.items]) assert.equal(item.accountId, "acct-1");
    assert.deepEqual([p.opportunities.truncated, p.salesAgreements.truncated, p.salesOrders.truncated], [false, false, false]);
    const other = await getAccountCommercialProjection(readDeps, READER, { accountId: "acct-2" });
    assert.deepEqual([other.salesOrders.items.map((i) => i.id), other.opportunities.items.map((i) => i.id)], [[direct.salesOrderId], [onAcct2.opportunityId]]);
    // t2 holds an Account with the same name; neither tenant sees the other's.
    const t2 = await getAccountCommercialProjection(readDeps, READER_T2, { accountId: "acct-t2" });
    assert.deepEqual([t2.account.name, t2.opportunities.items.map((i) => i.id), t2.salesAgreements.items.map((i) => i.id), t2.salesOrders.items.map((i) => i.id)],
      ["Retail Customer", [t2opp.opportunityId], [t2agreement.salesAgreementId], [t2order.salesOrderId]]);
    await assert.rejects(getAccountCommercialProjection(readDeps, READER, { accountId: "acct-t2" }), code("ACCOUNT_NOT_FOUND"));
    const truncated = await getAccountCommercialProjection(readDeps, READER, { accountId: "acct-1", limit: 2 });
    assert.deepEqual([truncated.opportunities.items.length, truncated.opportunities.truncated], [2, true]);
  });

  await t.test("(38)(40)(44) every statement a read issues targets PostgreSQL authorities only", async () => {
    statements.length = 0;
    await getAccountCommercialProjection(readDeps, READER, { accountId: "acct-1" });
    await oppRead.getOpportunityDetail(readDeps, READER, { opportunityId: o1.opportunityId });
    await saRead.getSalesAgreementDetail(readDeps, READER, { salesAgreementId: a1.salesAgreementId });
    await soRead.getSalesOrderDetail(readDeps, READER, { salesOrderId: won.salesOrderId });
    const schemas = new Set(statements.flatMap((s) => [...s.matchAll(/\b(eos_[a-z_]+)\./g)].map((m) => m[1])));
    assert.deepEqual([...schemas].sort(), ["eos_commercial", "eos_crm", "eos_policy", "eos_workforce"]);
    assert.ok(statements.some((s) => /eos_workforce\.employees/.test(s)), "Employee display did not consult the PostgreSQL Employee authority");
  });

  // ════════════════════ PEOPLE / DISPLAY ════════════════════
  await t.test("(40)(41)(42) person references: PostgreSQL resolution, historical Employees stay readable, no name and no Job Role invented", async () => {
    const d = await oppRead.getOpportunityDetail(readDeps, READER, { opportunityId: o1.opportunityId });
    assert.deepEqual(d.creditedSalesperson, { employeeId: "e-leaver", displayName: null, resolved: true }, "a TERMINATED Employee's historical reference stopped resolving");
    assert.deepEqual(d.owner, { employeeId: "e-retail", displayName: null, resolved: true });
    await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES ('e-temp','t1','ACTIVE','taylor')`);
    const temp = await newOpportunity(WRITER_T1, { creditedSalespersonId: "e-temp" });
    await q(`DELETE FROM eos_workforce.employees WHERE id = 'e-temp'`);
    const dangling = await oppRead.getOpportunityDetail(readDeps, READER, { opportunityId: temp.opportunityId });
    assert.deepEqual(dangling.creditedSalesperson, { employeeId: "e-temp", displayName: null, resolved: false }, "an unresolvable reference was hidden or fabricated");
    const keys = (v) => (v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : []);
    assert.deepEqual(keys(d).filter((k) => /jobRole|securityRole|role|employmentStatus|retail|national/i.test(k)), []);
    assert.equal(d.salesChannel, "RETAIL", "the channel is the record's own persisted fact");
  });

  await t.test("(45) product references remain readable as historical truth without any catalog authority", async () => {
    const d = await oppRead.getOpportunityDetail(readDeps, READER, { opportunityId: o1.opportunityId });
    assert.deepEqual(d.lines[1], { lineNumber: 2, kind: "PART", ref: "part-retired", qty: 2 });
    for (const line of d.lines) assert.deepEqual(Object.keys(line).sort(), ["kind", "lineNumber", "qty", "ref"]);
  });

  // ════════════════════ LIST SAFETY ════════════════════
  await t.test("(46)(47) keyset pages are deterministic, bounded, disjoint and complete", async () => {
    const all = (await oppRead.listOpportunities(readDeps, READER, { limit: 200 })).items.map((i) => i.id);
    const expected = (await q(`SELECT id FROM eos_commercial.opportunities WHERE tenant_id='t1' AND stage IS NOT NULL ORDER BY opportunity_number DESC, id DESC`)).rows.map((r) => r.id);
    assert.deepEqual(all, expected);
    const paged = [];
    let cursor;
    for (let i = 0; i < 10; i++) {
      const page = await oppRead.listOpportunities(readDeps, READER, { limit: 2, ...(cursor ? { cursor } : {}) });
      assert.ok(page.items.length <= 2);
      paged.push(...page.items.map((x) => x.id));
      assert.equal(page.truncated, page.nextCursor !== null);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    assert.deepEqual(paged, expected, "paging skipped, repeated or reordered records");
    assert.deepEqual((await oppRead.listOpportunities(readDeps, READER, { limit: 200 })).items.map((i) => i.id), all, "the order is not stable");
    const onlyDecision = await oppRead.listOpportunities(readDeps, READER, { stage: ["DECISION"] });
    assert.deepEqual(onlyDecision.items.map((i) => i.id), [o1.opportunityId]);
    assert.equal((await oppRead.listOpportunities(readDeps, READER)).items.length, Math.min(expected.length, kernel.DEFAULT_COMMERCIAL_PAGE_SIZE));
    const orders = await soRead.listSalesOrders(readDeps, READER, { state: "CONFIRMED", accountId: "acct-1" });
    assert.deepEqual(orders.items.map((i) => i.id), [won.salesOrderId]);
  });

  await t.test("(48)(49) invalid page, filter and cursor input refuse; hostile values stay parameters", async () => {
    for (const limit of [0, -1, 201, 2.5, "10", null]) await assert.rejects(oppRead.listOpportunities(readDeps, READER, { limit }), code("PAGE_SIZE_INVALID"), `limit ${limit}`);
    await assert.rejects(oppRead.listOpportunities(readDeps, READER, { stage: "WON" }), code("FILTER_INVALID"));
    await assert.rejects(soRead.listSalesOrders(readDeps, READER, { state: ["CONFIRMED", "stage' OR 1=1 --"] }), code("FILTER_INVALID"));
    await assert.rejects(saRead.listSalesAgreements(readDeps, READER, { state: [] }), code("FILTER_INVALID"));
    await assert.rejects(oppRead.listOpportunities(readDeps, READER, { cursor: "not-a-cursor" }), code("CURSOR_INVALID"));
    const orderCursor = kernel.encodeCommercialCursor("salesOrder", { number: "SO-9999-000001", id: "x" });
    await assert.rejects(oppRead.listOpportunities(readDeps, READER, { cursor: orderCursor }), code("CURSOR_INVALID"), "a cursor from another list was accepted");
    const hostile = await oppRead.listOpportunities(readDeps, READER, { accountId: "acct-1' OR '1'='1" });
    assert.deepEqual(hostile.items, []);
    const hostileCursor = kernel.encodeCommercialCursor("opportunity", { number: "') OR true --", id: "x" });
    assert.ok(Array.isArray((await oppRead.listOpportunities(readDeps, READER, { cursor: hostileCursor })).items));
    await assert.rejects(oppRead.getOpportunityDetail(readDeps, READER, { opportunityId: "   " }), code("RECORD_ID_REQUIRED"));
  });

  // ════════════════════ READ-ONLY ════════════════════
  await t.test("(4)(50) every projection leaves Commercial rows, histories, receipts and counters byte-identical, and issues no write", async () => {
    const TABLES = ["opportunities", "opportunity_lines", "sales_agreements", "sales_agreement_lines", "sales_orders", "sales_order_lines",
      "ownership_handoffs", "accountability_handoffs", "command_receipts", "number_counters"];
    const fingerprint = async () => {
      const out = {};
      for (const table of TABLES) out[table] = (await q(`SELECT count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM eos_commercial.${table} x`)).rows[0];
      out.crm = (await q(`SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM eos_crm.accounts x`)).rows[0].h;
      return out;
    };
    const before = await fingerprint();
    statements.length = 0;
    for (const [actor, id] of [[READER, o1.opportunityId], [READER, extra[1].opportunityId]]) await oppRead.getOpportunityDetail(readDeps, actor, { opportunityId: id });
    await saRead.getSalesAgreementDetail(readDeps, READER, { salesAgreementId: a1.salesAgreementId });
    await soRead.getSalesOrderDetail(readDeps, READER, { salesOrderId: won.salesOrderId });
    await soRead.getSalesOrderDetail(readDeps, READER, { salesOrderId: direct.salesOrderId });
    await oppRead.listOpportunities(readDeps, READER, { limit: 2 });
    await saRead.listSalesAgreements(readDeps, READER);
    await soRead.listSalesOrders(readDeps, READER);
    await getAccountCommercialProjection(readDeps, READER, { accountId: "acct-1" });
    await assert.rejects(oppRead.getOpportunityDetail(readDeps, READER, { opportunityId: spineOpp.id }), code("RECORD_INCOMPLETE"));
    assert.deepEqual(await fingerprint(), before, "a read changed persisted state");
    const writes = statements.filter((s) => /^\s*(INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b|nextval|pg_advisory|FOR UPDATE/i.test(s));
    assert.deepEqual(writes, []);
    assert.ok(statements.filter((s) => /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY$/.test(s)).length >= 10, "a read ran outside a read-only snapshot");
  });

  await t.test("(4) the snapshot itself is READ ONLY: a write attempted inside a read refuses and changes nothing", async () => {
    const before = (await q(`SELECT need FROM eos_commercial.opportunities WHERE id=$1`, [o1.opportunityId])).rows[0].need;
    await assert.rejects(
      kernel.runCommercialRead(readDeps, READER, ["opportunity.read"], () => null, (db) => db.query(`UPDATE eos_commercial.opportunities SET need = 'hijacked' WHERE id = $1`, [o1.opportunityId])),
      (e) => e.code === "READ_FAILED" && !/read-only|UPDATE|eos_commercial/.test(e.message),
    );
    assert.equal((await q(`SELECT need FROM eos_commercial.opportunities WHERE id=$1`, [o1.opportunityId])).rows[0].need, before);
  });

  await t.test("(5) a PostgreSQL failure inside a read leaks nothing", async () => {
    await assert.rejects(
      kernel.runCommercialRead(readDeps, READER, ["opportunity.read"], () => null, (db) => db.query(`SELECT * FROM eos_commercial.no_such_table`)),
      (e) => e.name === "CommercialCommandError" && e.code === "READ_FAILED" && e.message === "the read could not be completed",
    );
  });
});
