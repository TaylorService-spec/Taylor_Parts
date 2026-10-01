// NATIONAL ACCOUNTS SALES -- the journey, its channel, its sites, and DQ-021 (Controller SERVICE EXPERIENCE ACTIVATION
// CLOSURE, 2026-09-30: "Next journey: NATIONAL ACCOUNTS SALES ... reconcile ... the actual employee journey. Reuse the
// already-proven CRM, Catalog, Commercial transport, Retail Sales lifecycle, channel isolation. Do not rebuild Commercial.").
//
// On a BASELINE-EQUAL tenant (support/serviceBaselineTenant.mjs: the governed seed, the canonical Security Roles with
// their baseline grants, the accepted live authority), with the sales channels made ACTIVE and every assignment made
// THROUGH THE ADMINISTRATION API -- the nonprod shape: the National Accounts seller holds `salesperson` scoped to
// salesChannel=NATIONAL_ACCOUNTS, the Retail seller to RETAIL. Over the REAL Commercial transport (POST /commercial/sales):
//
//   1. THE JOURNEY: a National Accounts seller takes a multi-site national customer from Opportunity to a confirmed,
//      in-fulfillment Sales Order for ONE of its sites -- the single ratified lifecycle, channel as context.
//   2. SITES: an Agreement / Order names one of ITS customer's sites -- never another customer's, never a missing one
//      (the reconciliation found the site stored unvalidated; fixed in commercialCommandKernel.requireAccountLocation).
//   3. CHANNEL ISOLATION, both directions, reads and writes.
//   4. DQ-021 through Administration: before the packet the Sales Manager cannot accept / close WON; after it, a GLOBAL
//      Sales Manager (Option A) completes either channel; the Owner model is unchanged. FINDING: a channel-scoped Sales
//      Manager (Option B) is refused by Administration today (the Role bundles tenant-wide Administration authority).
//
// Real PostgreSQL. Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";

const require = createRequire(import.meta.url);
const commercialHttp = require("../lib/eosCommercial/commercialHttp.js");
const parity = require("../lib/adminPolicy/salesManagerParityDelta.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-national";
const key = () => `k-${randomUUID()}`;
const LINE = [{ kind: "SERVICE", ref: "svc-chain-pm", quantity: 4, unitPrice: 125000, businessUnitId: "SERVICE" }];

test("static: the DQ-021 packet is exactly two Sales Manager grants and nothing for the Owner", () => {
  assert.deepEqual(parity.salesManagerParityOperations().map((o) => [o.operation, o.input.roleKey, o.input.objectKey, o.input.actionKey]), [
    ["grantObjectActionToRole", "salesManager", "salesAgreement", "accept"],
    ["grantObjectActionToRole", "salesManager", "opportunity", "createSalesOrder"],
  ]);
});

test("National Accounts Sales over the Commercial transport", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, repo, pool } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "natl" });
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const deps = { reader: repo, pool, verifyToken: async (token) => ({ externalSubject: token, identityProvider: "firebase" }), allowedOrigins: [] };
  const com = async (who, operation, input) => {
    const res = await commercialHttp.handleCommercialRequest(deps, { method: "POST", url: "/commercial/sales",
      headers: { authorization: `Bearer ${who.subject}` }, body: JSON.stringify(input === undefined ? { operation } : { operation, input }) });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`); return r.body.result; };
  const refused = (r, status, code, what = "") => assert.deepEqual([r.status, r.body.code], [status, code], `${what} ${JSON.stringify(r.body)}`);
  const roleId = async (k) => (await repo.getRoleByKey(TENANT, k)).id;
  const scoped = async (who, roleKey, channel) => {
    const r = await admin("assignRole", { principalId: who.principalId, roleId: await roleId(roleKey), scopeType: "salesChannel", scopeValue: channel, reason: "channel staffing" });
    assert.equal(r.ok, true, `${roleKey}@${channel}: ${JSON.stringify(r).slice(0, 400)}`);
  };

  // ── the tenant's channels, through Administration ──
  for (const salesChannel of ["RETAIL", "NATIONAL_ACCOUNTS"]) {
    assert.equal((await admin("setTenantSalesChannelStatus", { salesChannel, status: "ACTIVE", reason: "the channels this tenant sells through" })).ok, true, salesChannel);
  }
  // ── the people: sellers scoped to their channel; two Sales Managers (Option A global, Option B National Accounts) ──
  const national = await person("uid-na-seller", [], { id: "e-national", name: "Jules National" });
  await scoped(national, "salesperson", "NATIONAL_ACCOUNTS");
  const retail = await person("uid-retail-seller", [], { id: "e-retail", name: "Harper Retail" });
  await scoped(retail, "salesperson", "RETAIL");
  const managerA = await person("uid-sm-global", ["salesManager"], { id: "e-sm-global", name: "Morgan Manager" });
  // OPTION B IS NOT EXPRESSIBLE TODAY: the canonical salesManager Role bundles Administration authority (audit.event.read),
  // which every gate decides tenant-wide, so Administration refuses to channel-scope it. A per-channel Sales Manager would
  // need the Role split (a global context Role + a channel-scoped selling Role -- the D-B lesson). Pinned as a FINDING for
  // the Owner's org-shape decision, not decided here.
  const managerB = await person("uid-sm-national", [], { id: "e-sm-national", name: "Quinn National Manager" });
  const optionB = await admin("assignRole", { principalId: managerB.principalId, roleId: await roleId("salesManager"), scopeType: "salesChannel",
    scopeValue: "NATIONAL_ACCOUNTS", reason: "a National Accounts Sales Manager (Option B)" });
  assert.equal(optionB.ok, false);
  assert.match(optionB.message, /SCOPE_AMBIGUOUS_ADMINISTRATION: salesManager carries Administration authority/);
  // The Owner Role is protected from ordinary assignRole; a fixture assignment (as the Commercial persona suite does).
  const owner = await person("uid-owner", [], { id: "e-owner", name: "Owen Owner" });
  await repo.transact({ tenantId: TENANT, uid: "fixture" }, async (tx) => {
    const accessVersion = await tx.bumpAccessVersion(owner.principalId);
    return tx.createAssignment({ principalId: owner.principalId, roleId: await roleId("owner"), scopeType: "global", scopeValue: null, status: "active",
      grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion });
  });

  // ── the customers: a national chain with three sites; a retail deli; another chain's site ──
  await q(`INSERT INTO eos_crm.accounts (id,tenant_id,name,status,owner_employee_id,created_by,updated_by) VALUES
    ('acct-chain',$1,'Summit Convenience (national)','ACTIVE','e-national','f','f'),
    ('acct-deli',$1,'Corner Deli','ACTIVE','e-retail','f','f'),
    ('acct-other-chain',$1,'Harbor Grill Group','ACTIVE','e-national','f','f')`, [TENANT]);
  await q(`INSERT INTO eos_crm.account_locations (id,tenant_id,account_id,name,address_city,created_by,updated_by) VALUES
    ('loc-chain-phx',$1,'acct-chain','Store 101','Phoenix','f','f'), ('loc-chain-tuc',$1,'acct-chain','Store 102','Tucson','f','f'),
    ('loc-chain-flg',$1,'acct-chain','Store 103','Flagstaff','f','f'), ('loc-deli',$1,'acct-deli','Deli','Mesa','f','f'),
    ('loc-harbor',$1,'acct-other-chain','Harbor 1','Yuma','f','f')`, [TENANT]);
  const opp = (accountId, salesChannel, extra = {}) => ({ idempotencyKey: key(), accountId, salesChannel, operatingCompanyId: "taylor",
    lines: [{ kind: "SERVICE", ref: "svc-chain-pm", qty: 4 }], ...extra });
  const toDecision = async (who, id) => {
    for (const toStage of ["QUALIFYING", "SOLUTION", "QUOTING", "CUSTOMER_REVIEW", "DECISION"]) {
      ok(await com(who, "transitionOpportunity", { idempotencyKey: key(), opportunityId: id, toStage }), toStage);
    }
  };

  let o, a, so;
  await t.test("JOURNEY: a National Accounts seller takes a multi-site national customer from Opportunity to an in-fulfillment Sales Order for one site", async () => {
    const offer = ok(await com(national, "readMyCommercialCapabilities"), "offer");
    assert.deepEqual(offer.capabilities, [], "nothing is held tenant-wide");
    for (const k of ["opportunity.write", "salesAgreement.accept", "opportunity.createSalesOrder", "salesOrder.write"]) assert.ok(offer.channelScoped.includes(k), k);

    o = ok(await com(national, "createOpportunity", opp("acct-chain", "NATIONAL_ACCOUNTS", { need: "Preventive maintenance across the chain", expectedValue: 500000 })), "create");
    assert.deepEqual([o.stage, o.accountableEmployeeId, o.accountablePersonSource], ["IDENTIFIED", "e-national", "DERIVED_FROM_RECORD_OWNER"]);
    await toDecision(national, o.opportunityId);
    a = ok(await com(national, "createSalesAgreement", { idempotencyKey: key(), opportunityId: o.opportunityId, ownerEmployeeId: "e-national",
      locationId: "loc-chain-tuc", isLease: false, fulfillmentIntent: "INSTALL", lines: LINE }), "agreement for Store 102");
    ok(await com(national, "updateSalesAgreementDraft", { idempotencyKey: key(), salesAgreementId: a.salesAgreementId, customerPO: "NAT-PO-9001" }), "PO");
    const accepted = ok(await com(national, "acceptSalesAgreement", { idempotencyKey: key(), salesAgreementId: a.salesAgreementId }), "accept");
    assert.deepEqual([accepted.state, accepted.acceptedBy], ["ACCEPTED", national.principalId]);
    so = ok(await com(national, "closeOpportunityAsWon", { idempotencyKey: key(), opportunityId: o.opportunityId }), "won");
    const row = await one(`SELECT state::text, sales_channel::text, location_id, owner_employee_id, customer_po FROM eos_commercial.sales_orders WHERE id = $1`, [so.salesOrderId]);
    assert.deepEqual(row, { state: "CONFIRMED", sales_channel: "NATIONAL_ACCOUNTS", location_id: "loc-chain-tuc", owner_employee_id: "e-national", customer_po: "NAT-PO-9001" });
    const detail = ok(await com(national, "getSalesOrderDetail", { salesOrderId: so.salesOrderId }), "order detail");
    assert.equal(JSON.stringify(detail).includes("Store 102"), true, "the order reads back the customer's SITE by name");
    assert.equal(ok(await com(national, "transitionSalesOrder", { idempotencyKey: key(), salesOrderId: so.salesOrderId, transition: "ADVANCE" }), "advance").state, "IN_FULFILLMENT");
    refused(await com(national, "transitionSalesOrder", { idempotencyKey: key(), salesOrderId: so.salesOrderId, transition: "ADVANCE" }), 503, "FULFILLMENT_AUTHORITY_UNAVAILABLE", "the held fulfillment boundary");
    const projection = ok(await com(national, "getAccountCommercialProjection", { accountId: "acct-chain" }), "projection");
    for (const id of [o.opportunityId, a.salesAgreementId, so.salesOrderId]) assert.ok(JSON.stringify(projection).includes(id), id);
    const receipts = (await q(`SELECT DISTINCT principal_id FROM eos_commercial.command_receipts`)).rows.map((r) => r.principal_id);
    assert.deepEqual(receipts, [national.principalId], "every write attributed to the seller");
  });

  await t.test("SITES: an Agreement or Order names one of ITS customer's sites -- never another customer's, never a missing one -- and nothing is written", async () => {
    const o2 = ok(await com(national, "createOpportunity", opp("acct-chain", "NATIONAL_ACCOUNTS")), "create");
    await toDecision(national, o2.opportunityId);
    const before = (await one(`SELECT count(*)::int n FROM eos_commercial.sales_agreements`)).n;
    for (const [locationId, what] of [["loc-harbor", "another chain's site"], ["loc-nowhere", "a site that does not exist"]]) {
      refused(await com(national, "createSalesAgreement", { idempotencyKey: key(), opportunityId: o2.opportunityId, ownerEmployeeId: "e-national", locationId, isLease: false, lines: LINE }),
        412, "LOCATION_NOT_FOR_ACCOUNT", what);
    }
    assert.equal((await one(`SELECT count(*)::int n FROM eos_commercial.sales_agreements`)).n, before);
    const a2 = ok(await com(national, "createSalesAgreement", { idempotencyKey: key(), opportunityId: o2.opportunityId, ownerEmployeeId: "e-national", locationId: "loc-chain-phx", isLease: false, lines: LINE }), "own site");
    refused(await com(national, "updateSalesAgreementDraft", { idempotencyKey: key(), salesAgreementId: a2.salesAgreementId, locationId: "loc-harbor" }), 412, "LOCATION_NOT_FOR_ACCOUNT", "edit to a foreign site");
    ok(await com(national, "updateSalesAgreementDraft", { idempotencyKey: key(), salesAgreementId: a2.salesAgreementId, locationId: "loc-chain-flg" }), "move to another of its own sites");
    assert.equal((await one(`SELECT location_id FROM eos_commercial.sales_agreements WHERE id = $1`, [a2.salesAgreementId])).location_id, "loc-chain-flg");
    refused(await com(national, "createSalesOrder", { idempotencyKey: key(), accountId: "acct-chain", salesChannel: "NATIONAL_ACCOUNTS", operatingCompanyId: "taylor",
      ownerEmployeeId: "e-national", locationId: "loc-deli", lines: [{ kind: "SERVICE", ref: "svc-chain-pm", orderedQty: 1, unitPrice: 125000, businessUnitId: "SERVICE" }] }),
      412, "LOCATION_NOT_FOR_ACCOUNT", "a direct order naming another customer's site");
  });

  await t.test("CHANNEL ISOLATION: the Retail seller neither sees nor moves National Accounts work, and the National seller neither sees nor moves Retail work", async () => {
    const r = ok(await com(retail, "createOpportunity", opp("acct-deli", "RETAIL")), "retail create");
    const rList = ok(await com(retail, "listOpportunities", {}), "retail list");
    assert.equal(JSON.stringify(rList).includes(o.opportunityId), false, "a National Accounts Opportunity is not in the Retail list");
    refused(await com(retail, "getOpportunityDetail", { opportunityId: o.opportunityId }), 404, "RECORD_NOT_FOUND", "no existence oracle");
    refused(await com(retail, "getSalesOrderDetail", { salesOrderId: so.salesOrderId }), 404, "RECORD_NOT_FOUND", "order");
    refused(await com(retail, "getSalesAgreementDetail", { salesAgreementId: a.salesAgreementId }), 404, "RECORD_NOT_FOUND", "agreement");
    refused(await com(retail, "transitionOpportunity", { idempotencyKey: key(), opportunityId: o.opportunityId, toStage: "QUALIFYING" }), 403, "OUTSIDE_SALES_CHANNEL_SCOPE", "retail moving national");
    refused(await com(retail, "createOpportunity", opp("acct-chain", "NATIONAL_ACCOUNTS")), 403, "OUTSIDE_SALES_CHANNEL_SCOPE", "retail creating national");
    const nList = ok(await com(national, "listOpportunities", {}), "national list");
    assert.equal(JSON.stringify(nList).includes(r.opportunityId), false);
    refused(await com(national, "getOpportunityDetail", { opportunityId: r.opportunityId }), 404, "RECORD_NOT_FOUND", "national reading retail");
    refused(await com(national, "createOpportunity", opp("acct-deli", "RETAIL")), 403, "OUTSIDE_SALES_CHANNEL_SCOPE", "national creating retail");
  });

  await t.test("DQ-021 through Administration: before -- the Sales Manager drafts but cannot accept or close WON", async () => {
    const m = ok(await com(managerA, "createOpportunity", opp("acct-chain", "NATIONAL_ACCOUNTS")), "manager create");
    await toDecision(managerA, m.opportunityId);
    const ma = ok(await com(managerA, "createSalesAgreement", { idempotencyKey: key(), opportunityId: m.opportunityId, ownerEmployeeId: "e-national", isLease: false, lines: LINE }), "draft");
    refused(await com(managerA, "acceptSalesAgreement", { idempotencyKey: key(), salesAgreementId: ma.salesAgreementId }), 403, "CAPABILITY_REQUIRED", "accept before the packet");
    refused(await com(managerA, "closeOpportunityAsWon", { idempotencyKey: key(), opportunityId: m.opportunityId }), 403, "CAPABILITY_REQUIRED", "won before the packet");
  });

  await t.test("DQ-021 through Administration: after the packet -- a (global, Option A) Sales Manager completes both channels; a channel-scoped salesperson stays in its channel; the Owner model is unchanged", async () => {
    for (const { operation, input } of parity.salesManagerParityOperations()) assert.equal((await admin(operation, input)).ok, true, `${operation} ${input.actionKey}`);
    const grants = (await q(`SELECT c.key FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id JOIN eos_policy.capabilities c ON c.id = rc.capability_id
                              WHERE rc.tenant_id = $1 AND r.key = 'salesManager' AND c.key IN ('salesAgreement.accept','opportunity.createSalesOrder') ORDER BY 1`, [TENANT])).rows.map((r) => r.key);
    assert.deepEqual(grants, ["opportunity.createSalesOrder", "salesAgreement.accept"]);
    const complete = async (who, accountId, channel) => {
      const x = ok(await com(who, "createOpportunity", opp(accountId, channel)), `${channel} create`);
      await toDecision(who, x.opportunityId);
      const ag = ok(await com(who, "createSalesAgreement", { idempotencyKey: key(), opportunityId: x.opportunityId, ownerEmployeeId: channel === "RETAIL" ? "e-retail" : "e-national", isLease: false, lines: LINE }), "draft");
      ok(await com(who, "acceptSalesAgreement", { idempotencyKey: key(), salesAgreementId: ag.salesAgreementId }), `${channel} accept`);
      return ok(await com(who, "closeOpportunityAsWon", { idempotencyKey: key(), opportunityId: x.opportunityId }), `${channel} won`);
    };
    await complete(managerA, "acct-chain", "NATIONAL_ACCOUNTS");
    await complete(managerA, "acct-deli", "RETAIL");
    // The packet widens nobody else: the channel-scoped National Accounts seller is still refused Retail.
    refused(await com(national, "createOpportunity", opp("acct-deli", "RETAIL")), 403, "OUTSIDE_SALES_CHANNEL_SCOPE", "seller still in its channel");
    // The Owner stays on the governed Owner model: neither key.
    const ow = ok(await com(owner, "createOpportunity", opp("acct-chain", "NATIONAL_ACCOUNTS")), "owner create");
    await toDecision(owner, ow.opportunityId);
    const oa = ok(await com(owner, "createSalesAgreement", { idempotencyKey: key(), opportunityId: ow.opportunityId, ownerEmployeeId: "e-national", isLease: false, lines: LINE }), "owner draft");
    refused(await com(owner, "acceptSalesAgreement", { idempotencyKey: key(), salesAgreementId: oa.salesAgreementId }), 403, "CAPABILITY_REQUIRED", "owner accept");
    refused(await com(owner, "closeOpportunityAsWon", { idempotencyKey: key(), opportunityId: ow.opportunityId }), 403, "CAPABILITY_REQUIRED", "owner won");
  });
});
