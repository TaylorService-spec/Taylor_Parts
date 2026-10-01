// GOVERNED SCOPE VALUES + SALES_CHANNEL -- end to end against PostgreSQL (lane GA, 2026-09-26).
//
// Proves, on a disposable database migrated by the normal runner:
//   A  tenant sales channels: the governed value source (activation command, audit, gate, NO_CHANGE, immutability,
//      deactivation fails closed while an assignment is scoped to the channel)
//   B  assignRole @ salesChannel: only THIS tenant's ACTIVE channel, only a Role carrying a Commercial read; one
//      manager may hold both channels (two scoped rows); unknown / foreign / inactive / mis-cased values refused
//   C  the runtime: the PostgreSQL Commercial reads (detail + list + Account projection) decide each record on its
//      STORED channel -- Retail-scoped cannot read a National Accounts Opportunity / Agreement / Order, lists are
//      filtered in SQL, both-channel manager sees both, two managers each see only theirs, a record with NO channel is
//      refused for a scoped holder (as NOT_FOUND -- no existence oracle), a GLOBAL holder is unchanged, and a scoped
//      holding never reaches the flat set or any write
//   D  Employee Operational Scope: governed targets per type (WAREHOUSE, REORDER_QUEUE), tenant-scoped; the command
//      refuses unknown / foreign / inactive targets and unknown types
//   E  Pass 10 P10-1: no SELF Operational Scope / Work Eligibility -- an administrator cannot scope or qualify the
//      Employee its own Principal is linked to (REORDER_QUEUE made this reachable), and cannot link to itself an
//      Employee that already holds a current scope or qualification (the S4 rule extended to these facts)
//   F  Pass 10 P10-3 / P10-4 / P10-5: no Account name/existence oracle for a scoped reader; a Sales Order carries its
//      source Opportunity's channel (commands) and lineage is disclosed only where the reader could read the linked
//      record (reads); the database refuses deactivating a channel under an active scoped assignment and refuses an
//      assignment scoped to a channel that is not ACTIVE
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { bindOperatingCompany } from "./support/governedOperatingCompanyBinding.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
const { bootstrapTenant, bootstrapAdministrator, ensureTenantPrincipal } = require("../lib/adminPolicy/tenantBootstrap.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const capabilityAuthority = require("../lib/eosOps/capabilityAuthority.js");
const composition = require("../lib/eosOps/entitledActionAuthority.js");
const commercial = require("../lib/eosCommercial/commercialHttp.js");
const opp = require("../lib/eosCommercial/commands/opportunityCommandService.js");
const sa = require("../lib/eosCommercial/commands/salesAgreementCommandService.js");
const so = require("../lib/eosCommercial/commands/salesOrderCommandService.js");
const { createCommercialRecord } = require("../lib/eosCommercial/commercialOwnershipRepository.js");
const workforce = require("../lib/eosWorkforce/workforceHttp.js");
const { resolveExperienceContext } = require("../lib/eosOps/experienceAuthority.js");

const OP = "operator-ga";
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const key = () => `k-${randomUUID()}`;
const catalog = { async verifyReferences(_db, _t, refs) { return refs.map(() => "FOUND"); } };
const WRITE_CAPS = new Set(["opportunity.write", "opportunity.createSalesOrder", "salesAgreement.create", "salesAgreement.updateDraft", "salesAgreement.accept", "salesOrder.write"]);

test("governed scope values and the SALES_CHANNEL scope, end to end", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `ga_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  const url = dbUrlFor(name);
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: url, max: 16 });
  const q = (s, v = []) => pool.query(s, v);
  const repo = new PostgresPolicyRepository(pool);

  // ── two tenants, each bootstrapped, each operating `taylor` (a company id is not a tenant boundary) ──
  const T = {};
  for (const k of ["a", "b"]) {
    const { tenant } = await bootstrapTenant(repo, { key: `ga-${k}`, name: k, actorUid: OP });
    T[k] = tenant.id;
    await bootstrapAdministrator(repo, { tenantId: tenant.id, externalSubject: `admin-${k}`, performedBy: OP, reason: "boot" });
    for (const cap of ["admin.securityPolicy.read", "admin.principalAccess.read", "employee.record.read", "admin.employeeOperationalScope.write"]) {
      await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
               SELECT 'rc-fx-' || md5($1 || c.id), $1, r.id, c.id, 'fixture','fixture','fixture'
                 FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id=$1 AND r.key='admin' AND c.key=$2
               ON CONFLICT DO NOTHING`, [tenant.id, cap]);
    }
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
             VALUES ($1,'taylor','ACTIVE','fixture','fixture','fixture')`, [tenant.id]);
    // The commercial writers resolve operating_company_key only through the governed binding -- never key = id. The
    // same keys subtest D states for its scope targets.
    await bindOperatingCompany(q, tenant.id, "taylor", `taylor-${k}`);
  }
  const call = (subject, operation, input) => executeAdminOperation({ repo },
    { caller: { externalSubject: subject, identityProvider: "firebase" }, operation, input, requestId: `r-${operation}` });
  const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
  const roleIdOf = async (tenant, k) => (await repo.getRoleByKey(tenant, k)).id;
  const person = async (tenant, subject) => {
    const made = await ensureTenantPrincipal(repo, { tenantId: tenant, externalSubject: subject, actorUid: OP, actorRoleKeys: ["admin"] });
    return made.principal?.id ?? made.id ?? made.principalId;
  };
  const context = (subject) => capabilityAuthority.resolveOperationalContext(repo, pool,
    { identityProvider: "firebase", externalSubject: subject, requestedTenantId: null }, composition.postgresGrantConditionProvider(pool));
  const sales = async (subject, operation, input) => {
    const r = await commercial.executeCommercialOperation({ reader: repo, pool },
      { caller: { externalSubject: subject, identityProvider: "firebase", requestedTenantId: null }, operation, input: input ?? {} });
    return r;
  };
  const wf = (subject, operation, input = {}) => workforce.executeWorkforceOperation({ reader: repo, pool },
    { caller: { externalSubject: subject, identityProvider: "firebase", requestedTenantId: null }, operation, input });

  // ── Security Roles, through the governed Administration commands: ONE commercial-read Role, no per-channel Role ──
  const defineRole = async (tk, k, grants) => {
    ok(await call(`admin-${tk}`, "createRole", { key: k, name: k, reason: "ga fixture" }));
    for (const [objectKey, actionKey] of grants) ok(await call(`admin-${tk}`, "grantObjectActionToRole", { objectKey, actionKey, roleKey: k, reason: "ga fixture" }));
  };
  const COMMERCIAL_READS = [["opportunity", "read"], ["salesAgreement", "read"], ["salesOrder", "read"]];
  await defineRole("a", "salesLead", [...COMMERCIAL_READS, ["account", "read"]]); // account read is INERT at a channel
  await defineRole("a", "staffOnly", [["employee", "read"]]);
  await defineRole("b", "salesLead", COMMERCIAL_READS);

  // ── Commercial records in tenant A: one chain per channel, a STRATEGIC one, and identity-only (no-channel) rows ──
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, owner_employee_id, created_by, updated_by) VALUES
    ('acct-1',$1,'Shared Customer','ACTIVE','e-1','x','x'), ('acct-b',$2,'B Customer','ACTIVE','e-b','x','x')`, [T.a, T.b]);
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES
    ('e-1',$1,'ACTIVE','taylor'), ('e-b',$2,'ACTIVE','taylor')`, [T.a, T.b]);
  for (const [p, tenant] of [["p-writer-a", T.a], ["p-writer-b", T.b]]) {
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ($1,$1,'proof','active')`, [p]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ($1,$2,$3)`, [`m-${p}`, tenant, p]);
  }
  const WA = { tenantId: T.a, principalId: "p-writer-a", capabilities: WRITE_CAPS };
  const WB = { tenantId: T.b, principalId: "p-writer-b", capabilities: WRITE_CAPS };
  const writeDeps = { pool, catalog };
  const newOpp = (actor, channel, accountId = "acct-1") => opp.createOpportunity(writeDeps, actor, {
    idempotencyKey: key(), accountId, salesChannel: channel, operatingCompanyId: "taylor", need: `${channel} need`,
    lines: [{ kind: "SERVICE", ref: "svc", qty: 1 }] });
  const newAgreement = (actor, opportunityId, owner = "e-1") => sa.createSalesAgreement(writeDeps, actor, {
    idempotencyKey: key(), opportunityId, ownerEmployeeId: owner, lines: [{ kind: "SERVICE", ref: "svc", quantity: 1, unitPrice: 100, businessUnitId: "SERVICE" }] });
  const newOrder = (actor, channel, accountId = "acct-1", owner = "e-1") => so.createSalesOrder(writeDeps, actor, {
    idempotencyKey: key(), accountId, ownerEmployeeId: owner, operatingCompanyId: "taylor", salesChannel: channel,
    lines: [{ kind: "SERVICE", ref: "svc", orderedQty: 1, unitPrice: 100, businessUnitId: "SERVICE" }] });

  // The migration activates nothing (pinned here, before any fixture). The fixture records below are created while the
  // channels are ACTIVE -- new Commercial work requires an ACTIVE channel -- and the channels are then set INACTIVE again,
  // so section A starts from a tenant with NO active channel and activates them through Administration.
  const migratedChannelRows = (await q(`SELECT count(*)::int n FROM eos_policy.tenant_sales_channels`)).rows[0].n;
  for (const tenant of [T.a, T.b]) for (const channel of ["NATIONAL_ACCOUNTS", "RETAIL", "STRATEGIC_ACCOUNTS"]) {
    await q(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id, sales_channel, status, source, established_by, updated_by) VALUES ($1, $2, 'ACTIVE', 'fixture', 'fixture', 'fixture')`, [tenant, channel]);
  }
  const R = { opp: await newOpp(WA, "RETAIL") };
  const N = { opp: await newOpp(WA, "NATIONAL_ACCOUNTS") };
  const S = { opp: await newOpp(WA, "STRATEGIC_ACCOUNTS") };
  R.agreement = await newAgreement(WA, R.opp.opportunityId);
  N.agreement = await newAgreement(WA, N.opp.opportunityId);
  R.order = await newOrder(WA, "RETAIL");
  N.order = await newOrder(WA, "NATIONAL_ACCOUNTS");
  S.order = await newOrder(WA, "STRATEGIC_ACCOUNTS");
  const spineOpp = await createCommercialRecord(pool, T.a, "seed", { kind: "OPPORTUNITY", recordNumber: "SEED-OPP-1", accountId: "acct-1", ownerEmployeeId: "e-1", operatingCompanyId: "taylor", createdBy: "seed" });
  const spineAgreement = await createCommercialRecord(pool, T.a, "seed", { kind: "SALES_AGREEMENT", recordNumber: "SEED-SA-1", accountId: "acct-1", ownerEmployeeId: "e-1", operatingCompanyId: "taylor", createdBy: "seed", opportunityId: spineOpp.id });
  const spineOrder = await createCommercialRecord(pool, T.a, "seed", { kind: "SALES_ORDER", recordNumber: "SEED-SO-1", accountId: "acct-1", ownerEmployeeId: "e-1", operatingCompanyId: "taylor", createdBy: "seed", opportunityId: spineOpp.id, salesAgreementId: spineAgreement.id });
  const B = { opp: await newOpp(WB, "RETAIL", "acct-b") };
  await q(`UPDATE eos_policy.tenant_sales_channels SET status = 'INACTIVE', updated_by = 'fixture', updated_at = now()`);

  const retailMgr = await person(T.a, "retail-mgr");
  const nationalMgr = await person(T.a, "national-mgr");
  const bothMgr = await person(T.a, "both-mgr");
  const globalReader = await person(T.a, "global-reader");
  const bystander = await person(T.a, "bystander");
  const retailB = await person(T.b, "retail-b");
  const lead = await roleIdOf(T.a, "salesLead");
  const assign = (admin, principalId, roleId, scopeType, scopeValue) => call(admin, "assignRole",
    { principalId, roleId, reason: "channel staffing", ...(scopeType ? { scopeType } : {}), ...(scopeValue !== undefined ? { scopeValue } : {}) });
  const refusedWith = (r, code) => {
    assert.deepEqual([r.ok, r.code], [false, "INVALID_INPUT"], JSON.stringify(r));
    assert.match(r.message, new RegExp(`^${code}`));
  };

  // ════════════════════ A. the governed value source ════════════════════
  await t.test("A: tenant sales channels start EMPTY; activation is governed, audited, gated, tenant-scoped", async () => {
    assert.equal(migratedChannelRows, 0, "the migration activated a channel");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.tenant_sales_channels WHERE status = 'ACTIVE'`)).rows[0].n, 0, "a channel is active before Administration activates it");
    const empty = ok(await call("admin-a", "listSupportedAssignmentScopes", {})).scopeTypes.find((s) => s.scopeType === "salesChannel");
    assert.deepEqual([empty.supported, empty.label, empty.contextKey, empty.values], [true, "Sales Channel", "salesChannel", []]);
    // The three reads (lane GA) and, since DQ-020, the six Commercial writes -- each decided against the record's channel.
    assert.deepEqual(empty.capabilities.map((c) => c.capabilityKey), ["opportunity.read", "salesAgreement.read", "salesOrder.read",
      "opportunity.write", "opportunity.createSalesOrder", "salesAgreement.create", "salesAgreement.updateDraft", "salesAgreement.accept", "salesOrder.write"]);
    // With nothing activated, no channel can be assigned -- there is no value to name.
    refusedWith(await assign("admin-a", retailMgr, lead, "salesChannel", "RETAIL"), "SCOPE_VALUE_INVALID");

    const set = (admin, salesChannel, status, reason = "we sell through this channel") =>
      call(admin, "setTenantSalesChannelStatus", { salesChannel, status, reason });
    assert.equal(ok(await set("admin-a", "RETAIL", "ACTIVE")).outcome, "ACTIVATED");
    assert.equal(ok(await set("admin-a", "NATIONAL_ACCOUNTS", "ACTIVE")).outcome, "ACTIVATED");
    assert.equal(ok(await set("admin-a", "RETAIL", "ACTIVE")).outcome, "NO_CHANGE");
    const audit = (await q(`SELECT target_id, after->>'status' AS status FROM eos_policy.audit_events
                             WHERE tenant_id=$1 AND action='setTenantSalesChannelStatus' ORDER BY target_id`, [T.a])).rows;
    assert.deepEqual(audit, [{ target_id: "NATIONAL_ACCOUNTS", status: "ACTIVE" }, { target_id: "RETAIL", status: "ACTIVE" }], "one event per change; NO_CHANGE writes none");
    // Refusals: an unknown channel, a mis-cased one, a bad status, no reason, and a caller without admin.securityPolicy.write.
    for (const [input, code] of [[{ salesChannel: "WHOLESALE", status: "ACTIVE", reason: "x" }, "SALES_CHANNEL_INVALID"],
      [{ salesChannel: "retail", status: "ACTIVE", reason: "x" }, "SALES_CHANNEL_INVALID"],
      [{ salesChannel: "RETAIL", status: "ON", reason: "x" }, "SALES_CHANNEL_INVALID"]]) {
      refusedWith(await call("admin-a", "setTenantSalesChannelStatus", input), code);
    }
    assert.equal((await call("admin-a", "setTenantSalesChannelStatus", { salesChannel: "STRATEGIC_ACCOUNTS", status: "ACTIVE" })).ok, false, "a reason is required");
    assert.equal((await call("bystander", "setTenantSalesChannelStatus", { salesChannel: "STRATEGIC_ACCOUNTS", status: "ACTIVE", reason: "x" })).code, "FORBIDDEN");
    // Tenant-scoped values: A offers exactly its two; B offers none until B activates its own.
    const values = async (admin) => ok(await call(admin, "listSupportedAssignmentScopes", {})).scopeTypes.find((s) => s.scopeType === "salesChannel").values;
    assert.deepEqual((await values("admin-a")).map((v) => [v.value, v.label]), [["NATIONAL_ACCOUNTS", "National Accounts"], ["RETAIL", "Retail"]]);
    assert.deepEqual(await values("admin-b"), []);
    // Never destroyed: DELETE and TRUNCATE are refused by the database itself.
    await assert.rejects(q(`DELETE FROM eos_policy.tenant_sales_channels WHERE tenant_id=$1`, [T.a]), /TENANT_SALES_CHANNEL_IMMUTABLE/);
    await assert.rejects(q(`TRUNCATE eos_policy.tenant_sales_channels`), /TENANT_SALES_CHANNEL_IMMUTABLE/);
    await assert.rejects(q(`UPDATE eos_policy.tenant_sales_channels SET sales_channel='STRATEGIC_ACCOUNTS' WHERE tenant_id=$1 AND sales_channel='RETAIL'`, [T.a]), /TENANT_SALES_CHANNEL_IMMUTABLE/);
  });

  // ════════════════════ B. assignment: governed values only ════════════════════
  await t.test("B: assignRole @ salesChannel -- only THIS tenant's ACTIVE channel, only a Role with a Commercial read", async () => {
    ok(await assign("admin-a", retailMgr, lead, "salesChannel", "RETAIL"));
    ok(await assign("admin-a", nationalMgr, lead, "salesChannel", "NATIONAL_ACCOUNTS"));
    // ONE manager, BOTH channels: two scoped rows of the SAME Role -- no per-channel Role exists or is needed.
    ok(await assign("admin-a", bothMgr, lead, "salesChannel", "RETAIL"));
    ok(await assign("admin-a", bothMgr, lead, "salesChannel", "NATIONAL_ACCOUNTS"));
    ok(await assign("admin-a", globalReader, lead));
    const rows = (await q(`SELECT scope_type, scope_value FROM eos_policy.user_role_assignments WHERE tenant_id=$1 AND principal_id=$2 ORDER BY scope_value`, [T.a, bothMgr])).rows;
    assert.deepEqual(rows, [{ scope_type: "salesChannel", scope_value: "NATIONAL_ACCOUNTS" }, { scope_type: "salesChannel", scope_value: "RETAIL" }]);
    // Arbitrary / inactive / mis-cased / foreign values are refused.
    // (The transport trims a value, so "RETAIL " is RETAIL; case is never folded.)
    for (const value of ["STRATEGIC_ACCOUNTS", "retail", "WHOLESALE", "Retail", ""]) {
      refusedWith(await assign("admin-a", bystander, lead, "salesChannel", value), "SCOPE_VALUE_INVALID");
    }
    // A Role with nothing evaluable at a channel would be a grant of nothing.
    refusedWith(await assign("admin-a", bystander, await roleIdOf(T.a, "staffOnly"), "salesChannel", "RETAIL"), "SCOPE_NOT_EVALUABLE_FOR_ROLE");
    // Administration authority is tenant-wide: never channel-scoped.
    refusedWith(await assign("admin-a", bystander, await roleIdOf(T.a, "admin"), "salesChannel", "RETAIL"), "SCOPE_AMBIGUOUS_ADMINISTRATION");
    // Tenant isolation of VALUES: A's activation is not B's.
    const leadB = await roleIdOf(T.b, "salesLead");
    refusedWith(await assign("admin-b", retailB, leadB, "salesChannel", "RETAIL"), "SCOPE_VALUE_INVALID");
    ok(await call("admin-b", "setTenantSalesChannelStatus", { salesChannel: "RETAIL", status: "ACTIVE", reason: "B sells retail" }));
    ok(await assign("admin-b", retailB, leadB, "salesChannel", "RETAIL"));
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.user_role_assignments WHERE tenant_id=$1 AND principal_id=$2`, [T.a, bystander])).rows[0].n, 0);
    // Per-Role vocabulary: salesLead may take a channel and would grant only the three reads; account read stays inert.
    const sl = ok(await call("admin-a", "listSupportedAssignmentScopes", { roleKey: "salesLead" })).roles[0]
      .assignableScopes.find((s) => s.scopeType === "salesChannel");
    assert.deepEqual([sl.assignable, sl.scopedCapabilities, sl.inertCapabilities],
      [true, ["opportunity.read", "salesAgreement.read", "salesOrder.read"], ["customer.record.read"]]);
  });

  // ════════════════════ C. the runtime ════════════════════
  const detail = async (subject, operation, idField, id) => sales(subject, operation, { [idField]: id });
  const listIds = async (subject, operation) => {
    const r = await sales(subject, operation, { limit: 200 });
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.result.items.map((i) => i.id).sort();
  };
  const notFound = (r, family) => {
    assert.deepEqual([r.ok, r.status, r.code], [false, 404, "RECORD_NOT_FOUND"], JSON.stringify(r));
    assert.equal(r.message, `the ${family} does not exist in this tenant`);
  };
  const sorted = (...ids) => ids.sort();

  await t.test("C: a scoped holding is never in the flat set; it is a salesChannel-qualified holding", async () => {
    const ctx = await context("retail-mgr");
    assert.deepEqual(ctx.principalContext.heldRoleKeys, []);
    for (const k of ["opportunity.read", "salesAgreement.read", "salesOrder.read"]) assert.equal(ctx.capabilities.has(k), false, k);
    assert.deepEqual(ctx.scopedHeld.map((h) => [h.capabilityKey, h.scopeType, h.scopeValue]).sort(), [
      ["opportunity.read", "salesChannel", "RETAIL"], ["salesAgreement.read", "salesChannel", "RETAIL"], ["salesOrder.read", "salesChannel", "RETAIL"]]);
    assert.deepEqual(ctx.inertScoped.map((i) => [i.capabilityKey, i.reason]), [["customer.record.read", "SCOPE_NOT_EVALUABLE_FOR_CAPABILITY"]]);
  });

  await t.test("C: Retail-scoped cannot read a National Accounts Opportunity / Agreement / Order; lists are filtered", async () => {
    assert.equal((await detail("retail-mgr", "getOpportunityDetail", "opportunityId", R.opp.opportunityId)).ok, true);
    assert.equal((await detail("retail-mgr", "getSalesAgreementDetail", "salesAgreementId", R.agreement.salesAgreementId)).ok, true);
    assert.equal((await detail("retail-mgr", "getSalesOrderDetail", "salesOrderId", R.order.salesOrderId)).ok, true);
    notFound(await detail("retail-mgr", "getOpportunityDetail", "opportunityId", N.opp.opportunityId), "Opportunity");
    notFound(await detail("retail-mgr", "getSalesAgreementDetail", "salesAgreementId", N.agreement.salesAgreementId), "Sales Agreement");
    notFound(await detail("retail-mgr", "getSalesOrderDetail", "salesOrderId", N.order.salesOrderId), "Sales Order");
    notFound(await detail("retail-mgr", "getOpportunityDetail", "opportunityId", S.opp.opportunityId), "Opportunity");
    // No existence oracle: an out-of-channel record reads EXACTLY like a missing id.
    notFound(await detail("retail-mgr", "getOpportunityDetail", "opportunityId", "no-such-opportunity"), "Opportunity");
    assert.deepEqual(await listIds("retail-mgr", "listOpportunities"), [R.opp.opportunityId]);
    assert.deepEqual(await listIds("retail-mgr", "listSalesAgreements"), [R.agreement.salesAgreementId]);
    assert.deepEqual(await listIds("retail-mgr", "listSalesOrders"), [R.order.salesOrderId]);
    const account = await sales("retail-mgr", "getAccountCommercialProjection", { accountId: "acct-1" });
    assert.equal(account.ok, true, JSON.stringify(account));
    assert.deepEqual([account.result.opportunities.items.map((i) => i.id), account.result.salesAgreements.items.map((i) => i.id),
      account.result.salesOrders.items.map((i) => i.id)], [[R.opp.opportunityId], [R.agreement.salesAgreementId], [R.order.salesOrderId]]);
  });

  await t.test("C: two managers each see only their channel; one manager with both channels sees both", async () => {
    assert.deepEqual(await listIds("national-mgr", "listOpportunities"), [N.opp.opportunityId]);
    assert.deepEqual(await listIds("national-mgr", "listSalesAgreements"), [N.agreement.salesAgreementId]);
    assert.deepEqual(await listIds("national-mgr", "listSalesOrders"), [N.order.salesOrderId]);
    notFound(await detail("national-mgr", "getOpportunityDetail", "opportunityId", R.opp.opportunityId), "Opportunity");
    notFound(await detail("national-mgr", "getSalesOrderDetail", "salesOrderId", R.order.salesOrderId), "Sales Order");
    assert.deepEqual(await listIds("both-mgr", "listOpportunities"), sorted(R.opp.opportunityId, N.opp.opportunityId));
    assert.deepEqual(await listIds("both-mgr", "listSalesAgreements"), sorted(R.agreement.salesAgreementId, N.agreement.salesAgreementId));
    assert.deepEqual(await listIds("both-mgr", "listSalesOrders"), sorted(R.order.salesOrderId, N.order.salesOrderId));
    for (const [op, f, id] of [["getOpportunityDetail", "opportunityId", N.opp.opportunityId], ["getSalesAgreementDetail", "salesAgreementId", R.agreement.salesAgreementId],
      ["getSalesOrderDetail", "salesOrderId", N.order.salesOrderId]]) {
      assert.equal((await detail("both-mgr", op, f, id)).ok, true, op);
    }
    notFound(await detail("both-mgr", "getSalesOrderDetail", "salesOrderId", S.order.salesOrderId), "Sales Order");
  });

  await t.test("C: a record with NO channel is refused for a scoped holder; a GLOBAL holder is unchanged", async () => {
    notFound(await detail("both-mgr", "getOpportunityDetail", "opportunityId", spineOpp.id), "Opportunity");
    notFound(await detail("both-mgr", "getSalesAgreementDetail", "salesAgreementId", spineAgreement.id), "Sales Agreement");
    notFound(await detail("both-mgr", "getSalesOrderDetail", "salesOrderId", spineOrder.id), "Sales Order");
    // The global holder reads the whole tenant exactly as before: every complete record, every channel, and the
    // identity-only rows answer RECORD_INCOMPLETE (not NOT_FOUND) as they always did.
    assert.deepEqual(await listIds("global-reader", "listOpportunities"), sorted(R.opp.opportunityId, N.opp.opportunityId, S.opp.opportunityId));
    assert.deepEqual(await listIds("global-reader", "listSalesOrders"), sorted(R.order.salesOrderId, N.order.salesOrderId, S.order.salesOrderId));
    const incomplete = await detail("global-reader", "getOpportunityDetail", "opportunityId", spineOpp.id);
    assert.deepEqual([incomplete.ok, incomplete.code], [false, "RECORD_INCOMPLETE"]);
    assert.equal((await detail("global-reader", "getSalesOrderDetail", "salesOrderId", N.order.salesOrderId)).ok, true);
  });

  await t.test("C: a scoped holding confers no write, no other tenant, and nothing to a principal without it", async () => {
    const write = await sales("both-mgr", "createOpportunity", { idempotencyKey: key(), accountId: "acct-1", salesChannel: "RETAIL",
      operatingCompanyId: "taylor", need: "x", lines: [{ kind: "SERVICE", ref: "svc", qty: 1 }] });
    assert.deepEqual([write.ok, write.code], [false, "CAPABILITY_REQUIRED"]);
    const nothing = await sales("bystander", "listOpportunities", {});
    assert.deepEqual([nothing.ok, nothing.code], [false, "CAPABILITY_REQUIRED"], JSON.stringify(nothing));
    // Tenant B's RETAIL manager sees B's RETAIL record and nothing of A's.
    assert.deepEqual(await listIds("retail-b", "listOpportunities"), [B.opp.opportunityId]);
    notFound(await detail("retail-b", "getOpportunityDetail", "opportunityId", R.opp.opportunityId), "Opportunity");
  });

  await t.test("C: revoke is seen on the next request; a channel is never deactivated under a scoped assignment", async () => {
    const refused = await call("admin-a", "setTenantSalesChannelStatus", { salesChannel: "NATIONAL_ACCOUNTS", status: "INACTIVE", reason: "stop" });
    assert.deepEqual([refused.ok, refused.code], [false, "CONFLICT"], JSON.stringify(refused));
    assert.match(refused.message, /^SALES_CHANNEL_HAS_SCOPED_ASSIGNMENTS/);
    for (const principalId of [nationalMgr, bothMgr]) {
      const held = ok(await call("admin-a", "listPrincipalRoleAssignments", { principalId })).assignments
        .filter((a) => a.status === "active" && a.scopeType === "salesChannel" && a.scopeValue === "NATIONAL_ACCOUNTS");
      for (const a of held) ok(await call("admin-a", "revokeRole", { assignmentId: a.id, reason: "channel closed" }));
    }
    assert.deepEqual(await listIds("both-mgr", "listOpportunities"), [R.opp.opportunityId], "the revoke narrowed the next read");
    const none = await sales("national-mgr", "listOpportunities", {});
    assert.deepEqual([none.ok, none.code], [false, "CAPABILITY_REQUIRED"]);
    assert.equal(ok(await call("admin-a", "setTenantSalesChannelStatus", { salesChannel: "NATIONAL_ACCOUNTS", status: "INACTIVE", reason: "stop" })).outcome, "DEACTIVATED");
    refusedWith(await assign("admin-a", nationalMgr, lead, "salesChannel", "NATIONAL_ACCOUNTS"), "SCOPE_VALUE_INVALID");
  });

  // ════════════════════ D. Employee Operational Scope: governed targets ════════════════════
  await t.test("D: listOperationalScopeTargets serves each type's governed, tenant-scoped values; the command refuses the rest", async () => {
    const wh = (id, tenant, status = "ACTIVE") => q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
      VALUES ($1,$2,'taylor',$3,'Somewhere, AZ',$4,'NATIVE','fixture','fixture')`, [id, tenant, `WH ${id}`, status]);
    await wh("wh-a1", T.a); await wh("wh-a-old", T.a, "INACTIVE"); await wh("wh-b1", T.b);
    await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
             VALUES ($1,'taylor','taylor-a','ACTIVE','NATIVE','fixture','fixture','fixture'), ($2,'taylor','taylor-b','ACTIVE','NATIVE','fixture','fixture','fixture')
             ON CONFLICT DO NOTHING`, [T.a, T.b]);
    await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES ('e-scope',$1,'ACTIVE','taylor')`, [T.a]);

    const targets = await wf("admin-a", "listOperationalScopeTargets", {});
    assert.equal(targets.ok, true, JSON.stringify(targets));
    const byType = Object.fromEntries(targets.result.scopeTypes.map((s) => [s.scopeType, s]));
    assert.deepEqual(Object.keys(byType), ["WAREHOUSE", "REORDER_QUEUE"]);
    assert.deepEqual(byType.WAREHOUSE.values.map((v) => v.value), ["wh-a1"], "ACTIVE, this tenant only");
    assert.deepEqual(byType.REORDER_QUEUE.values.map((v) => v.value), ["taylor-a"]);
    assert.equal(byType.WAREHOUSE.available, true);
    const bTargets = (await wf("admin-b", "listOperationalScopeTargets", {})).result.scopeTypes;
    assert.deepEqual(bTargets.map((s) => s.values.map((v) => v.value)), [["wh-b1"], ["taylor-b"]]);
    // An extra field is refused, and the read is gated on employee.record.read.
    assert.equal((await wf("admin-a", "listOperationalScopeTargets", { scopeType: "WAREHOUSE" })).ok, false);
    assert.equal((await wf("bystander", "listOperationalScopeTargets", {})).ok, false);

    const assignScope = (scopeType, scopeId) => wf("admin-a", "assignEmployeeOperationalScope", { employeeId: "e-scope", scopeType, scopeId, reason: "governed pick" });
    assert.equal((await assignScope("WAREHOUSE", "wh-a1")).ok, true);
    assert.equal((await assignScope("REORDER_QUEUE", "taylor-a")).ok, true, "REORDER_QUEUE is assignable against the governed key");
    for (const [scopeType, scopeId, reason] of [["WAREHOUSE", "wh-b1", "WAREHOUSE_NOT_FOUND"], ["WAREHOUSE", "wh-nowhere", "WAREHOUSE_NOT_FOUND"],
      ["WAREHOUSE", "wh-a-old", "WAREHOUSE_INACTIVE"], ["REORDER_QUEUE", "taylor-b", "REORDER_QUEUE_NOT_FOUND"],
      ["REORDER_QUEUE", "taylor", "REORDER_QUEUE_NOT_FOUND"], ["LOCATION", "wh-a1", "OPERATIONAL_SCOPE_TYPE_INVALID"],
      ["BUSINESS_UNIT", "SERVICE", "OPERATIONAL_SCOPE_TYPE_INVALID"]]) {
      const r = await assignScope(scopeType, scopeId);
      assert.deepEqual([r.ok, r.code], [false, reason], `${scopeType}:${scopeId} ${JSON.stringify(r)}`);
    }
    const held = (await wf("admin-a", "listEmployeeOperationalScopes", { employeeId: "e-scope" })).result.items.map((i) => `${i.scopeType}:${i.scopeId}`).sort();
    assert.deepEqual(held, ["REORDER_QUEUE:taylor-a", "WAREHOUSE:wh-a1"]);
    // An INACTIVE key cannot receive a new queue scope.
    await q(`UPDATE eos_policy.tenant_operating_company_keys SET status='INACTIVE' WHERE tenant_id=$1`, [T.a]);
    await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES ('e-scope2',$1,'ACTIVE','taylor')`, [T.a]);
    const inactive = await wf("admin-a", "assignEmployeeOperationalScope", { employeeId: "e-scope2", scopeType: "REORDER_QUEUE", scopeId: "taylor-a", reason: "x" });
    assert.deepEqual([inactive.ok, inactive.code], [false, "REORDER_QUEUE_INACTIVE"]);
    const after = (await wf("admin-a", "listOperationalScopeTargets", {})).result.scopeTypes.find((s) => s.scopeType === "REORDER_QUEUE");
    assert.deepEqual([after.available, after.values], [false, []]);
    assert.match(after.reason, /no ACTIVE governed value/);
    // Restore the key: the later subtests write commercial records, which resolve operating_company_key only through
    // an ACTIVE binding. What this subtest proved is the scope refusal above, not a permanently retired key.
    await q(`UPDATE eos_policy.tenant_operating_company_keys SET status='ACTIVE' WHERE tenant_id=$1 AND operating_company_key='taylor-a'`, [T.a]);
  });

  // ════════════════════ F. Pass 10 P10-3 / P10-4 / P10-5 ════════════════════
  await t.test("F (P10-3): a channel-scoped reader cannot read an Account's name, nor tell it from a missing one, without an admitted record", async () => {
    // D deactivated NATIONAL_ACCOUNTS. New Commercial work in it is refused even for a GLOBAL writer, until Administration
    // re-activates it.
    await assert.rejects(newOpp(WA, "NATIONAL_ACCOUNTS"), (err) => err.code === "SALES_CHANNEL_NOT_ACTIVE");
    ok(await call("admin-a", "setTenantSalesChannelStatus", { salesChannel: "NATIONAL_ACCOUNTS", status: "ACTIVE", reason: "selling national accounts again" }));
    await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, owner_employee_id, created_by, updated_by) VALUES
      ('acct-n',$1,'NATIONAL ONLY SECRET CO','ACTIVE','e-1','x','x'), ('acct-empty',$1,'NO RECORDS CO','ACTIVE','e-1','x','x')`, [T.a]);
    await newOpp(WA, "NATIONAL_ACCOUNTS", "acct-n");
    const shape = (r) => [r.ok, r.status, r.code, r.message];
    const missing = await sales("retail-mgr", "getAccountCommercialProjection", { accountId: "acct-nope" });
    assert.deepEqual(shape(missing).slice(0, 3), [false, 404, "ACCOUNT_NOT_FOUND"], JSON.stringify(missing));
    for (const accountId of ["acct-n", "acct-empty"]) {
      const r = await sales("retail-mgr", "getAccountCommercialProjection", { accountId });
      assert.deepEqual(shape(r), shape(missing), `${accountId}: ${JSON.stringify(r)}`);
      assert.equal(JSON.stringify(r).includes("SECRET"), false);
    }
    // An Account with an admitted record still answers, name included (section C proves the families).
    assert.equal((await sales("retail-mgr", "getAccountCommercialProjection", { accountId: "acct-1" })).result.account.name, "Shared Customer");
    // A GLOBAL holder is unchanged: an Account with no records answers with its name.
    const global = await sales("global-reader", "getAccountCommercialProjection", { accountId: "acct-empty" });
    assert.deepEqual([global.ok, global.result?.account?.name], [true, "NO RECORDS CO"], JSON.stringify(global));
  });

  await t.test("F (P10-4): a Sales Order carries its source Opportunity's channel -- inherited when omitted, a different one refused", async () => {
    const STAGES = ["IDENTIFIED", "QUALIFYING", "SOLUTION", "QUOTING", "CUSTOMER_REVIEW", "DECISION"];
    const won = await newOpp(WA, "NATIONAL_ACCOUNTS");
    for (const toStage of STAGES.slice(1)) await opp.transitionOpportunity(writeDeps, WA, { idempotencyKey: key(), opportunityId: won.opportunityId, toStage });
    const agreement = await newAgreement(WA, won.opportunityId);
    await sa.acceptSalesAgreement(writeDeps, WA, { idempotencyKey: key(), salesAgreementId: agreement.salesAgreementId });
    await opp.transitionOpportunity(writeDeps, WA, { idempotencyKey: key(), opportunityId: won.opportunityId, outcome: "WON" });
    const mismatch = (e) => e?.code === "SALES_CHANNEL_MISMATCH";
    await assert.rejects(so.createSalesOrderFromOpportunity(writeDeps, WA, { idempotencyKey: key(), opportunityId: won.opportunityId, salesChannel: "RETAIL" }), mismatch);
    await assert.rejects(so.createSalesOrder(writeDeps, WA, { idempotencyKey: key(), accountId: "acct-1", ownerEmployeeId: "e-1", operatingCompanyId: "taylor",
      salesChannel: "RETAIL", sourceOpportunityId: won.opportunityId, lines: [{ kind: "SERVICE", ref: "svc", orderedQty: 1, unitPrice: 100, businessUnitId: "SERVICE" }] }), mismatch);
    const order = await so.createSalesOrderFromOpportunity(writeDeps, WA, { idempotencyKey: key(), opportunityId: won.opportunityId });
    const row = (await q(`SELECT sales_channel::text AS c FROM eos_commercial.sales_orders WHERE id=$1`, [order.salesOrderId])).rows[0];
    assert.equal(row.c, "NATIONAL_ACCOUNTS", "the channel is inherited from the source Opportunity");
    // The RETAIL reader cannot see that Order at all.
    notFound(await detail("retail-mgr", "getSalesOrderDetail", "salesOrderId", order.salesOrderId), "Sales Order");
  });

  await t.test("F (P10-4): lineage references are disclosed only where the reader could read the linked record", async () => {
    // A cross-channel chain as a raw writer (or an older build) could leave it: the RETAIL Order points at the NATIONAL
    // Opportunity / Agreement, and the NATIONAL Order points at the RETAIL Opportunity / Agreement.
    await q(`UPDATE eos_commercial.sales_orders SET opportunity_id=$1, sales_agreement_id=$2 WHERE id=$3`,
      [N.opp.opportunityId, N.agreement.salesAgreementId, R.order.salesOrderId]);
    await q(`UPDATE eos_commercial.sales_orders SET opportunity_id=$1, sales_agreement_id=$2 WHERE id=$3`,
      [R.opp.opportunityId, R.agreement.salesAgreementId, N.order.salesOrderId]);
    const order = await detail("retail-mgr", "getSalesOrderDetail", "salesOrderId", R.order.salesOrderId);
    assert.equal(order.ok, true, JSON.stringify(order));
    assert.deepEqual([order.result.sourceOpportunity, order.result.sourceAgreement], [null, null], "NATIONAL lineage leaked to a RETAIL reader");
    const o = await detail("retail-mgr", "getOpportunityDetail", "opportunityId", R.opp.opportunityId);
    assert.deepEqual([o.ok, o.result.salesAgreement?.id, o.result.salesOrder], [true, R.agreement.salesAgreementId, null], JSON.stringify(o));
    const a = await detail("retail-mgr", "getSalesAgreementDetail", "salesAgreementId", R.agreement.salesAgreementId);
    assert.deepEqual([a.ok, a.result.sourceOpportunity?.id, a.result.salesOrder], [true, R.opp.opportunityId, null], JSON.stringify(a));
    // A GLOBAL holder is unchanged: every reference is there.
    const g = await detail("global-reader", "getSalesOrderDetail", "salesOrderId", R.order.salesOrderId);
    assert.deepEqual([g.result.sourceOpportunity?.id, g.result.sourceAgreement?.id], [N.opp.opportunityId, N.agreement.salesAgreementId]);
    const go = await detail("global-reader", "getOpportunityDetail", "opportunityId", R.opp.opportunityId);
    assert.equal(go.result.salesOrder?.id, N.order.salesOrderId);
  });

  await t.test("F (P10-5): the database refuses a stranded scope in both directions, and serializes with the command", async () => {
    // Back to D's state: NATIONAL_ACCOUNTS INACTIVE (F re-activated it only to create its fixtures).
    ok(await call("admin-a", "setTenantSalesChannelStatus", { salesChannel: "NATIONAL_ACCOUNTS", status: "INACTIVE", reason: "stop again" }));
    // RETAIL is ACTIVE and retail-mgr holds an ACTIVE assignment scoped to it: a raw deactivation is refused.
    await assert.rejects(q(`UPDATE eos_policy.tenant_sales_channels SET status='INACTIVE', updated_by='raw' WHERE tenant_id=$1 AND sales_channel='RETAIL'`, [T.a]),
      /SALES_CHANNEL_HAS_SCOPED_ASSIGNMENTS/);
    assert.equal((await sales("retail-mgr", "listOpportunities", {})).ok, true, "the scoped holder is intact");
    // A raw assignment naming a channel this tenant never activated (STRATEGIC_ACCOUNTS), or an INACTIVE one
    // (NATIONAL_ACCOUNTS, deactivated in C), is refused -- the runtime would otherwise honour it.
    for (const channel of ["STRATEGIC_ACCOUNTS", "NATIONAL_ACCOUNTS", "WHOLESALE"]) {
      await assert.rejects(q(`INSERT INTO eos_policy.user_role_assignments (id,tenant_id,principal_id,role_id,scope_type,scope_value,status,granted_by,granted_at,access_version_at_grant,created_by,updated_by)
        VALUES ($1,$2,$3,$4,'salesChannel',$5,'active','raw',now(),0,'raw','raw')`, [`ura-${randomUUID()}`, T.a, bystander, lead, channel]), /SALES_CHANNEL_NOT_ACTIVE/, channel);
    }
    // Re-activating a revoked assignment onto an INACTIVE channel is refused the same way.
    const revoked = (await q(`SELECT id FROM eos_policy.user_role_assignments WHERE tenant_id=$1 AND scope_type='salesChannel' AND scope_value='NATIONAL_ACCOUNTS' AND status<>'active' LIMIT 1`, [T.a])).rows[0];
    assert.ok(revoked, "section C revoked the NATIONAL_ACCOUNTS assignments");
    await assert.rejects(q(`UPDATE eos_policy.user_role_assignments SET status='active' WHERE id=$1`, [revoked.id]), /SALES_CHANNEL_NOT_ACTIVE/);
    // An unheld channel may still be deactivated raw (the guard is exactly "no stranded scope").
    ok(await call("admin-a", "setTenantSalesChannelStatus", { salesChannel: "STRATEGIC_ACCOUNTS", status: "ACTIVE", reason: "try it" }));
    await q(`UPDATE eos_policy.tenant_sales_channels SET status='INACTIVE', updated_by='raw' WHERE tenant_id=$1 AND sales_channel='STRATEGIC_ACCOUNTS'`, [T.a]);
    // The count is snapshot-dependent: a deactivation outside READ COMMITTED is refused.
    const c = await pool.connect();
    try {
      await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      const msg = await c.query(`UPDATE eos_policy.tenant_sales_channels SET status='INACTIVE', updated_by='raw' WHERE tenant_id=$1 AND sales_channel='RETAIL'`, [T.a])
        .then(() => "DEACTIVATED", (e) => e.message);
      assert.match(msg, /TENANT_SALES_CHANNEL_REQUIRES_READ_COMMITTED/);
    } finally { await c.query("ROLLBACK").catch(() => {}); c.release(); }
    // A raw scoped assignment racing a raw deactivation: they serialize on the channel row, never both commit.
    const racer = await person(T.a, "racer-a");
    ok(await call("admin-a", "setTenantSalesChannelStatus", { salesChannel: "STRATEGIC_ACCOUNTS", status: "ACTIVE", reason: "race" }));
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      await c1.query("BEGIN");
      await c1.query(`INSERT INTO eos_policy.user_role_assignments (id,tenant_id,principal_id,role_id,scope_type,scope_value,status,granted_by,granted_at,access_version_at_grant,created_by,updated_by)
        VALUES ($1,$2,$3,$4,'salesChannel','STRATEGIC_ACCOUNTS','active','raw',now(),0,'raw','raw')`, [`ura-${randomUUID()}`, T.a, racer, lead]);
      const deactivate = c2.query(`UPDATE eos_policy.tenant_sales_channels SET status='INACTIVE', updated_by='raw' WHERE tenant_id=$1 AND sales_channel='STRATEGIC_ACCOUNTS'`, [T.a])
        .then(() => "DEACTIVATED", (e) => e.message);
      await new Promise((r) => setTimeout(r, 300));
      await c1.query("COMMIT");
      assert.match(await deactivate, /SALES_CHANNEL_HAS_SCOPED_ASSIGNMENTS/);
    } finally { c1.release(); c2.release(); }
    assert.equal((await q(`SELECT status FROM eos_policy.tenant_sales_channels WHERE tenant_id=$1 AND sales_channel='STRATEGIC_ACCOUNTS'`, [T.a])).rows[0].status, "ACTIVE");
  });

  // ════════════════════ E. Pass 10 P10-1: no self-scope, no self-qualification, no self-link onto either ════════════════════
  await t.test("E: an administrator cannot give its OWN linked Employee an Operational Scope or Work Eligibility, nor link one to itself", async () => {
    await q(`UPDATE eos_policy.tenant_operating_company_keys SET status='ACTIVE' WHERE tenant_id=$1`, [T.a]);
    for (const id of ["e-self", "e-self2", "e-self3"]) {
      await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES ($1,$2,'ACTIVE','taylor')`, [id, T.a]);
    }
    const caps = new Map((await repo.listCapabilities()).map((c) => [c.key, c]));
    const defineByCaps = async (roleKey, keys) => defineRole("a", roleKey, keys.map((k) => [caps.get(k).objectKey, caps.get(k).actionKey]));
    // The actor: may scope, qualify and link Employees, and reads the Reorder queue (the surface REORDER_QUEUE narrows).
    await defineByCaps("scopeSteward", ["employee.record.read", "admin.employeeOperationalScope.write", "admin.employeeWorkEligibility.write",
      "admin.employeeProfile.write", "reorder.request.read"]);
    const steward = await person(T.a, "steward-a");
    ok(await assign("admin-a", steward, await roleIdOf(T.a, "scopeSteward")));
    // ANOTHER administrator with the same authority -- the rule is "not yourself", not "not at all".
    const peer = await person(T.a, "steward-peer-a");
    ok(await assign("admin-a", peer, await roleIdOf(T.a, "scopeSteward")));
    const other = await person(T.a, "other-a");
    const as = (subject, operation, input) => wf(subject, operation, { reason: "governed change", ...input });
    const scopeRows = async (employeeId) => (await q(`SELECT scope_type, scope_id FROM eos_workforce.employee_operational_scopes
      WHERE tenant_id=$1 AND employee_id=$2 AND effective_to IS NULL ORDER BY 1,2`, [T.a, employeeId])).rows;

    // (1) The PROVED path (probe X9): a peer links e-self to the steward, then the steward scopes its own Employee.
    assert.equal((await as("steward-peer-a", "linkEmployeePrincipal", { employeeId: "e-self", linkedPrincipalId: steward })).ok, true);
    const before = await resolveExperienceContext(repo, pool, { externalSubject: "steward-a", identityProvider: "firebase", requestedTenantId: null });
    for (const [scopeType, scopeId] of [["REORDER_QUEUE", "taylor-a"], ["WAREHOUSE", "wh-a1"]]) {
      const self = await as("steward-a", "assignEmployeeOperationalScope", { employeeId: "e-self", scopeType, scopeId });
      assert.deepEqual([self.ok, self.status, self.code], [false, 403, "OPERATIONAL_SCOPE_SELF"], JSON.stringify(self));
    }
    const selfQ = await as("steward-a", "assignEmployeeWorkEligibility", { employeeId: "e-self", qualificationCode: "PARTS_OPERATIONS" });
    assert.deepEqual([selfQ.ok, selfQ.status, selfQ.code], [false, 403, "WORK_ELIGIBILITY_SELF"], JSON.stringify(selfQ));
    assert.deepEqual(await scopeRows("e-self"), [], "nothing was written");
    const after = await resolveExperienceContext(repo, pool, { externalSubject: "steward-a", identityProvider: "firebase", requestedTenantId: null });
    assert.deepEqual([[...before.surfaces].includes("inventory.reorderQueue"), [...after.surfaces].includes("inventory.reorderQueue")], [false, false],
      "the actor did not open the Reorder queue surface for itself");
    // The peer may do it; the steward may END its own (ending only narrows).
    assert.equal((await as("steward-peer-a", "assignEmployeeOperationalScope", { employeeId: "e-self", scopeType: "REORDER_QUEUE", scopeId: "taylor-a" })).ok, true);
    assert.equal((await as("steward-peer-a", "assignEmployeeWorkEligibility", { employeeId: "e-self", qualificationCode: "PARTS_OPERATIONS" })).ok, true);
    const ended = await as("steward-a", "endEmployeeOperationalScope", { employeeId: "e-self", scopeType: "REORDER_QUEUE", scopeId: "taylor-a" });
    assert.deepEqual([ended.ok, ended.result?.outcome], [true, "ENDED"], JSON.stringify(ended));
    assert.equal((await as("steward-a", "endEmployeeWorkEligibility", { employeeId: "e-self", qualificationCode: "PARTS_OPERATIONS" })).ok, true);

    // (2) The mirror image: an Employee already holding a current scope / qualification cannot be linked to oneself.
    assert.equal((await as("steward-peer-a", "assignEmployeeOperationalScope", { employeeId: "e-self2", scopeType: "WAREHOUSE", scopeId: "wh-a1" })).ok, true);
    assert.equal((await as("steward-peer-a", "assignEmployeeWorkEligibility", { employeeId: "e-self3", qualificationCode: "SERVICE_TECHNICIAN" })).ok, true);
    // e-self is still linked to the steward; move that link away first so the steward may hold another.
    assert.equal((await as("steward-peer-a", "unlinkEmployeePrincipal", { employeeId: "e-self", expectedCurrentPrincipalId: steward })).ok, true);
    const link2 = await as("steward-a", "linkEmployeePrincipal", { employeeId: "e-self2", linkedPrincipalId: steward });
    assert.deepEqual([link2.ok, link2.status, link2.code], [false, 403, "OPERATIONAL_SCOPE_SELF_LINK"], JSON.stringify(link2));
    const link3 = await as("steward-a", "linkEmployeePrincipal", { employeeId: "e-self3", linkedPrincipalId: steward });
    assert.deepEqual([link3.ok, link3.status, link3.code], [false, 403, "WORK_ELIGIBILITY_SELF_LINK"], JSON.stringify(link3));
    // Through relink as well: e-self3 linked to someone else, then moved onto the actor.
    assert.equal((await as("steward-peer-a", "linkEmployeePrincipal", { employeeId: "e-self3", linkedPrincipalId: other })).ok, true);
    const move = await as("steward-a", "relinkEmployeePrincipal", { employeeId: "e-self3", expectedCurrentPrincipalId: other, newPrincipalId: steward });
    assert.deepEqual([move.ok, move.code], [false, "WORK_ELIGIBILITY_SELF_LINK"], JSON.stringify(move));
    // Another administrator may make the link: the rule is "not yourself".
    assert.equal((await as("steward-peer-a", "linkEmployeePrincipal", { employeeId: "e-self2", linkedPrincipalId: steward })).ok, true);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.employee_principal_links WHERE tenant_id=$1 AND employee_id='e-self2' AND principal_id=$2 AND status='active'`,
      [T.a, steward])).rows[0].n, 1);
  });
});
