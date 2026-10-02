// NATIONAL ACCOUNTS SALES -- the journey, its channel, its sites, its customers, and the Sales Manager (Controller
// NATIONAL ACCOUNTS RULINGS / COMPLETION PASS, 2026-09-30: "National Accounts does NOT require a separate commercial
// implementation. It is the existing Commercial lifecycle governed by commercial_sales_channel = NATIONAL_ACCOUNTS.").
//
// On a BASELINE-EQUAL tenant (support/serviceBaselineTenant.mjs: the governed seed, the canonical Security Roles with
// their baseline grants, the accepted live authority), with the sales channels made ACTIVE and every assignment made
// THROUGH THE ADMINISTRATION API -- the nonprod shape: the National Accounts seller holds `salesperson` scoped to
// salesChannel=NATIONAL_ACCOUNTS, the Retail seller to RETAIL. Over the REAL Commercial transport (POST /commercial/sales):
//
//   1. THE JOURNEY: a National Accounts seller takes an ACTIVE multi-site chain from Opportunity to a confirmed,
//      in-fulfillment Sales Order for ONE of its stores -- the single ratified lifecycle, channel as context -- ending at
//      the activated boundary (FULFILLED stays NOT_YET_ACTIVATED).
//   2. REFUSALS on that journey: foreign site, inactive / unknown / other-tenant customer, unknown or certification
//      product, a caller-supplied operating company that is not governed, an unauthorized persona.
//   3. ACTIVE CUSTOMER (DQ-5), channel-blind, with history preserved when a customer later goes inactive.
//   4. CHANNEL ISOLATION, both directions, reads (non-disclosing) and writes (OUTSIDE_SALES_CHANNEL_SCOPE).
//   5. AUTHORIZED CHANNELS ONLY (DQ-4): the picker offer is derived from each caller's governed holdings.
//   6. THE SALES MANAGER (DQ-1 / DQ-2) through Administration: before -- unassignable at channel scope, cannot accept or
//      close WON; the packet (role separation + DQ-021) -- then `salesManager @ salesChannel:RETAIL` and
//      `@ salesChannel:NATIONAL_ACCOUNTS` each manage ONLY their channel, a global manager both, the Owner neither.
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
const { createPostgresCatalogReferenceAuthority } = require("../lib/catalogAuthority/postgresCatalogReferenceAuthority.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const authorityBaseline = require("../lib/adminPolicy/roleCapabilityAuthorityBaseline.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-national";
const OTHER_TENANT = "t-national-other";
const key = () => `k-${randomUUID()}`;
const LINE = [{ kind: "SERVICE", ref: "svc-chain-pm", quantity: 4, unitPrice: 125000, businessUnitId: "SERVICE" }];

test("static: the Sales Manager packet -- separate the Role from tenant-wide audit, then exactly the two DQ-021 grants; nothing for the Owner", () => {
  assert.deepEqual(parity.salesManagerRoleSeparationOperations().map((o) => [o.operation, o.input.roleKey, o.input.objectKey, o.input.actionKey]), [
    ["revokeObjectActionFromRole", "salesManager", "auditLog", "read"],
  ]);
  assert.deepEqual(parity.salesManagerParityOperations().map((o) => [o.operation, o.input.roleKey, o.input.objectKey, o.input.actionKey]), [
    ["grantObjectActionToRole", "salesManager", "salesAgreement", "accept"],
    ["grantObjectActionToRole", "salesManager", "opportunity", "createSalesOrder"],
  ]);
  assert.deepEqual(parity.salesManagerActivationOperations().map((o) => o.operation),
    ["revokeObjectActionFromRole", "grantObjectActionToRole", "grantObjectActionToRole"], "separation first, then parity");
  for (const o of parity.salesManagerActivationOperations()) {
    assert.equal(o.input.roleKey, "salesManager", "the packet touches the Sales Manager Role only");
    assert.ok(typeof o.input.reason === "string" && o.input.reason.length > 20, "every operation states its ruling");
  }
});

test("static: the separation is an Administration decision -- the canonical default is unchanged (no catalog or migration edit)", () => {
  const { SALES_MANAGER_ROLE } = require("../lib/access/governedBusinessRoles.js");
  assert.equal(SALES_MANAGER_ROLE.permissions.includes("audit.event.read"), true, "the system default still declares it; the tenant's ADMIN_REVOKED decision explains its absence");
});

test("National Accounts Sales over the Commercial transport", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, repo, pool } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "natl" });
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  // The Catalog is ACTIVE in nonprod (2026-09-30): the transport is composed with the governed PostgreSQL Catalog authority.
  const deps = { reader: repo, pool, verifyToken: async (token) => ({ externalSubject: token, identityProvider: "firebase" }), allowedOrigins: [],
    catalog: createPostgresCatalogReferenceAuthority() };
  const com = async (who, operation, input) => {
    const res = await commercialHttp.handleCommercialRequest(deps, { method: "POST", url: "/commercial/sales",
      headers: { authorization: `Bearer ${who.subject}` }, body: JSON.stringify(input === undefined ? { operation } : { operation, input }) });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`); return r.body.result; };
  const refused = (r, status, code, what = "") => assert.deepEqual([r.status, r.body.code], [status, code], `${what} ${JSON.stringify(r.body)}`);
  const roleId = async (k) => (await repo.getRoleByKey(TENANT, k)).id;
  const assign = async (who, roleKey, channel, reason = "channel staffing") => admin("assignRole", { principalId: who.principalId, roleId: await roleId(roleKey),
    scopeType: "salesChannel", scopeValue: channel, reason });
  const scoped = async (who, roleKey, channel) => {
    const r = await assign(who, roleKey, channel);
    assert.equal(r.ok, true, `${roleKey}@${channel}: ${JSON.stringify(r).slice(0, 400)}`);
  };
  const roleCaps = async (roleKey) => (await q(`SELECT c.key FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id
      JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE rc.tenant_id = $1 AND r.key = $2 ORDER BY 1`, [TENANT, roleKey])).rows.map((r) => r.key);
  const executeAs = (who, operation, input) => executeAdminOperation({ repo },
    { caller: { externalSubject: who.subject, identityProvider: "firebase" }, operation, input, requestId: `r-${randomUUID()}` });
  const count = async (table) => (await one(`SELECT count(*)::int n FROM eos_commercial.${table}`)).n;

  // ── the tenant's channels, through Administration (STRATEGIC_ACCOUNTS is NOT activated) ──
  for (const salesChannel of ["RETAIL", "NATIONAL_ACCOUNTS"]) {
    assert.equal((await admin("setTenantSalesChannelStatus", { salesChannel, status: "ACTIVE", reason: "the channels this tenant sells through" })).ok, true, salesChannel);
  }
  // ── the Sales Manager Role exactly as nonprod holds it today (roleCapabilityAuthorityBaseline.json, measured): it carries
  //    audit.event.read. ──
  assert.ok((await roleCaps("salesManager")).includes("audit.event.read"), "the baseline-equal tenant carries the measured composition");
  // ── the people: sellers scoped to their channel; Sales Managers; the Owner; a persona with no Commercial authority ──
  const national = await person("uid-na-seller", [], { id: "e-national", name: "Jules National" });
  await scoped(national, "salesperson", "NATIONAL_ACCOUNTS");
  const retail = await person("uid-retail-seller", [], { id: "e-retail", name: "Harper Retail" });
  await scoped(retail, "salesperson", "RETAIL");
  const both = await person("uid-two-channel-seller", [], { id: "e-both", name: "Rowan Two-Channel" });
  await scoped(both, "salesperson", "RETAIL");
  await scoped(both, "salesperson", "NATIONAL_ACCOUNTS");
  const managerGlobal = await person("uid-sm-global", ["salesManager"], { id: "e-sm-global", name: "Morgan Manager" });
  const managerRetail = await person("uid-sm-retail", [], { id: "e-sm-retail", name: "Riley Retail Manager" });
  const managerNational = await person("uid-sm-national", [], { id: "e-sm-national", name: "Quinn National Manager" });
  const technician = await person("uid-tech", ["technician"], { id: "e-tech", name: "Tess Technician", technician: true });
  const nobody = await person("uid-no-commercial", [], { id: "e-nobody", name: "Nico Nobody" });
  // The Owner Role is protected from ordinary assignRole; a fixture assignment (as the Commercial persona suite does).
  const owner = await person("uid-owner", [], { id: "e-owner", name: "Owen Owner" });
  await repo.transact({ tenantId: TENANT, uid: "fixture" }, async (tx) => {
    const accessVersion = await tx.bumpAccessVersion(owner.principalId);
    return tx.createAssignment({ principalId: owner.principalId, roleId: await roleId("owner"), scopeType: "global", scopeValue: null, status: "active",
      grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion });
  });

  // ── the customers: an ACTIVE national chain with three stores; a retail deli; another chain; customers that are not ACTIVE;
  //    and a customer in ANOTHER tenant. One governed Part and one certification fixture Part. ──
  await q(`INSERT INTO eos_crm.accounts (id,tenant_id,name,status,owner_employee_id,created_by,updated_by) VALUES
    ('acct-chain',$1,'Summit Convenience (national)','ACTIVE','e-national','f','f'),
    ('acct-deli',$1,'Corner Deli','ACTIVE','e-retail','f','f'),
    ('acct-other-chain',$1,'Harbor Grill Group','ACTIVE','e-national','f','f'),
    ('acct-closed-chain',$1,'Desert Stop (closed)','INACTIVE','e-national','f','f'),
    ('acct-closed-deli',$1,'Old Town Deli (closed)','INACTIVE','e-retail','f','f'),
    ('acct-archived',$1,'Mesa Market (archived)','ARCHIVED','e-national','f','f'),
    ('acct-prospect',$1,'Canyon Foods (prospect)','PROSPECT','e-national','f','f'),
    ('acct-lapsing',$1,'Saguaro Fuel (national)','ACTIVE','e-national','f','f')`, [TENANT]);
  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [OTHER_TENANT]);
  await q(`INSERT INTO eos_crm.accounts (id,tenant_id,name,status,owner_employee_id,created_by,updated_by) VALUES ('acct-foreign',$1,'Foreign Chain','ACTIVE','e-x','f','f')`, [OTHER_TENANT]);
  await q(`INSERT INTO eos_crm.account_locations (id,tenant_id,account_id,name,address_city,created_by,updated_by) VALUES
    ('loc-chain-phx',$1,'acct-chain','Store 101','Phoenix','f','f'), ('loc-chain-tuc',$1,'acct-chain','Store 102','Tucson','f','f'),
    ('loc-chain-flg',$1,'acct-chain','Store 103','Flagstaff','f','f'), ('loc-deli',$1,'acct-deli','Deli','Mesa','f','f'),
    ('loc-harbor',$1,'acct-other-chain','Harbor 1','Yuma','f','f')`, [TENANT]);
  await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
             expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
           VALUES ('PRT-2001', $1, 'x', 'PRT-2001', 'Condenser Fan Motor', 'ACTIVE', 'EACH', 'STANDARD', 'STOCKED', false, false, false, false, 1, 'x')`, [TENANT]);
  const opp = (accountId, salesChannel, extra = {}) => ({ idempotencyKey: key(), accountId, salesChannel, operatingCompanyId: "taylor",
    lines: [{ kind: "SERVICE", ref: "svc-chain-pm", qty: 4 }], ...extra });
  const toDecision = async (who, id) => {
    for (const toStage of ["QUALIFYING", "SOLUTION", "QUOTING", "CUSTOMER_REVIEW", "DECISION"]) {
      ok(await com(who, "transitionOpportunity", { idempotencyKey: key(), opportunityId: id, toStage }), toStage);
    }
  };
  const directOrder = (accountId, salesChannel, extra = {}) => ({ idempotencyKey: key(), accountId, salesChannel, operatingCompanyId: "taylor",
    ownerEmployeeId: salesChannel === "RETAIL" ? "e-retail" : "e-national", lines: [{ kind: "SERVICE", ref: "svc-chain-pm", orderedQty: 1, unitPrice: 125000, businessUnitId: "SERVICE" }], ...extra });

  let o, a, so;
  await t.test("JOURNEY: a National Accounts seller takes an ACTIVE multi-site chain from Opportunity (governed product) to an in-fulfillment Sales Order for one store", async () => {
    const offer = ok(await com(national, "readMyCommercialCapabilities"), "offer");
    assert.deepEqual(offer.capabilities, [], "nothing is held tenant-wide");
    for (const k of ["opportunity.write", "salesAgreement.accept", "opportunity.createSalesOrder", "salesOrder.write"]) assert.ok(offer.channelScoped.includes(k), k);

    o = ok(await com(national, "createOpportunity", opp("acct-chain", "NATIONAL_ACCOUNTS", { need: "Fan motors and preventive maintenance across the chain",
      expectedValue: 500000, lines: [{ kind: "PART", ref: "PRT-2001", qty: 3 }, { kind: "SERVICE", ref: "svc-chain-pm", qty: 4 }] })), "create");
    assert.deepEqual([o.stage, o.accountableEmployeeId, o.accountablePersonSource], ["IDENTIFIED", "e-national", "DERIVED_FROM_RECORD_OWNER"]);
    await toDecision(national, o.opportunityId);
    a = ok(await com(national, "createSalesAgreement", { idempotencyKey: key(), opportunityId: o.opportunityId, ownerEmployeeId: "e-national",
      locationId: "loc-chain-tuc", isLease: false, fulfillmentIntent: "INSTALL",
      lines: [{ kind: "PART", ref: "PRT-2001", quantity: 3, unitPrice: 41000, businessUnitId: "PARTS" }, ...LINE] }), "agreement for Store 102");
    ok(await com(national, "updateSalesAgreementDraft", { idempotencyKey: key(), salesAgreementId: a.salesAgreementId, customerPO: "NAT-PO-9001" }), "PO");
    const accepted = ok(await com(national, "acceptSalesAgreement", { idempotencyKey: key(), salesAgreementId: a.salesAgreementId }), "accept");
    assert.deepEqual([accepted.state, accepted.acceptedBy], ["ACCEPTED", national.principalId]);
    so = ok(await com(national, "closeOpportunityAsWon", { idempotencyKey: key(), opportunityId: o.opportunityId }), "won");
    const row = await one(`SELECT state::text, sales_channel::text, location_id, owner_employee_id, customer_po FROM eos_commercial.sales_orders WHERE id = $1`, [so.salesOrderId]);
    assert.deepEqual(row, { state: "CONFIRMED", sales_channel: "NATIONAL_ACCOUNTS", location_id: "loc-chain-tuc", owner_employee_id: "e-national", customer_po: "NAT-PO-9001" });
    const detail = ok(await com(national, "getSalesOrderDetail", { salesOrderId: so.salesOrderId }), "order detail");
    assert.equal(JSON.stringify(detail).includes("Store 102"), true, "the order reads back the customer's SITE by name");
    assert.equal(JSON.stringify(detail).includes("PRT-2001"), true, "the governed product travels to the order");
    assert.equal(ok(await com(national, "transitionSalesOrder", { idempotencyKey: key(), salesOrderId: so.salesOrderId, transition: "ADVANCE" }), "advance").state, "IN_FULFILLMENT");
    // THE ACTIVATED BOUNDARY: FULFILLED stays NOT_YET_ACTIVATED (allocation / service creation are the held cross-domain integration).
    refused(await com(national, "transitionSalesOrder", { idempotencyKey: key(), salesOrderId: so.salesOrderId, transition: "ADVANCE" }), 412, "SALES_ORDER_NOT_FULLY_FULFILLED", "nothing fulfilled yet -- the governed quantity gate (DECISIONS #195)");
    const projection = ok(await com(national, "getAccountCommercialProjection", { accountId: "acct-chain" }), "projection");
    for (const id of [o.opportunityId, a.salesAgreementId, so.salesOrderId]) assert.ok(JSON.stringify(projection).includes(id), id);
    const receipts = (await q(`SELECT DISTINCT principal_id FROM eos_commercial.command_receipts`)).rows.map((r) => r.principal_id);
    assert.deepEqual(receipts, [national.principalId], "every write attributed to the seller");
  });

  await t.test("JOURNEY REFUSALS: unknown / certification product, ungoverned caller-supplied operating company, unauthorized persona -- nothing written", async () => {
    const before = await count("opportunities");
    for (const ref of ["PRT-NOT-IN-CATALOG", "CW-P-0000"]) {
      const r = await com(national, "createOpportunity", opp("acct-chain", "NATIONAL_ACCOUNTS", { lines: [{ kind: "PART", ref, qty: 1 }] }));
      assert.ok(r.status >= 400 && r.status < 500, `${ref} refused: ${JSON.stringify(r.body)}`);
    }
    const company = await com(national, "createOpportunity", opp("acct-chain", "NATIONAL_ACCOUNTS", { operatingCompanyId: "acme" }));
    assert.equal(company.status, 400, `an ungoverned operating company is refused, never inferred: ${JSON.stringify(company.body)}`);
    for (const [who, what] of [[technician, "technician"], [nobody, "no Commercial authority"]]) {
      refused(await com(who, "createOpportunity", opp("acct-chain", "NATIONAL_ACCOUNTS")), 403, "CAPABILITY_REQUIRED", what);
      refused(await com(who, "acceptSalesAgreement", { idempotencyKey: key(), salesAgreementId: a.salesAgreementId }), 403, "CAPABILITY_REQUIRED", `${what} accept`);
    }
    assert.equal(await count("opportunities"), before);
  });

  await t.test("SITES: an Agreement or Order names one of ITS customer's sites -- never another customer's, never a missing one -- and nothing is written", async () => {
    const o2 = ok(await com(national, "createOpportunity", opp("acct-chain", "NATIONAL_ACCOUNTS")), "create");
    await toDecision(national, o2.opportunityId);
    const before = await count("sales_agreements");
    for (const [locationId, what] of [["loc-harbor", "another chain's site"], ["loc-nowhere", "a site that does not exist"]]) {
      refused(await com(national, "createSalesAgreement", { idempotencyKey: key(), opportunityId: o2.opportunityId, ownerEmployeeId: "e-national", locationId, isLease: false, lines: LINE }),
        412, "LOCATION_NOT_FOR_ACCOUNT", what);
    }
    assert.equal(await count("sales_agreements"), before);
    const a2 = ok(await com(national, "createSalesAgreement", { idempotencyKey: key(), opportunityId: o2.opportunityId, ownerEmployeeId: "e-national", locationId: "loc-chain-phx", isLease: false, lines: LINE }), "own site");
    refused(await com(national, "updateSalesAgreementDraft", { idempotencyKey: key(), salesAgreementId: a2.salesAgreementId, locationId: "loc-harbor" }), 412, "LOCATION_NOT_FOR_ACCOUNT", "edit to a foreign site");
    ok(await com(national, "updateSalesAgreementDraft", { idempotencyKey: key(), salesAgreementId: a2.salesAgreementId, locationId: "loc-chain-flg" }), "move to another of its own sites");
    assert.equal((await one(`SELECT location_id FROM eos_commercial.sales_agreements WHERE id = $1`, [a2.salesAgreementId])).location_id, "loc-chain-flg");
    refused(await com(national, "createSalesOrder", directOrder("acct-chain", "NATIONAL_ACCOUNTS", { locationId: "loc-deli" })),
      412, "LOCATION_NOT_FOR_ACCOUNT", "a direct order naming another customer's site");
    // RETAIL SYMMETRY: the same rule, the same code.
    refused(await com(retail, "createSalesOrder", directOrder("acct-deli", "RETAIL", { locationId: "loc-chain-phx" })), 412, "LOCATION_NOT_FOR_ACCOUNT", "retail, a chain store");
  });

  await t.test("ACTIVE CUSTOMER (DQ-5): new Commercial work requires an ACTIVE customer -- both channels; unknown and other-tenant customers do not exist", async () => {
    const before = { o: await count("opportunities"), s: await count("sales_orders") };
    for (const [who, accountId, channel] of [[national, "acct-closed-chain", "NATIONAL_ACCOUNTS"], [retail, "acct-closed-deli", "RETAIL"],
      [national, "acct-archived", "NATIONAL_ACCOUNTS"], [national, "acct-prospect", "NATIONAL_ACCOUNTS"]]) {
      refused(await com(who, "createOpportunity", opp(accountId, channel)), 412, "ACCOUNT_NOT_ACTIVE", `${channel} ${accountId}`);
      refused(await com(who, "createSalesOrder", directOrder(accountId, channel)), 412, "ACCOUNT_NOT_ACTIVE", `${channel} direct order ${accountId}`);
    }
    refused(await com(national, "createOpportunity", opp("acct-nowhere", "NATIONAL_ACCOUNTS")), 404, "ACCOUNT_NOT_FOUND", "unknown");
    refused(await com(national, "createOpportunity", opp("acct-foreign", "NATIONAL_ACCOUNTS")), 404, "ACCOUNT_NOT_FOUND", "another tenant's customer");
    // Moving an Opportunity onto an inactive customer is new work on that customer: refused, and the record is unchanged.
    const mv = ok(await com(national, "createOpportunity", opp("acct-chain", "NATIONAL_ACCOUNTS")), "movable");
    refused(await com(national, "updateOpportunity", { idempotencyKey: key(), opportunityId: mv.opportunityId, expectedEditVersion: 1, accountId: "acct-closed-chain" }),
      412, "ACCOUNT_NOT_ACTIVE", "move onto an inactive customer");
    assert.equal((await one(`SELECT account_id FROM eos_commercial.opportunities WHERE id = $1`, [mv.opportunityId])).account_id, "acct-chain");
    assert.deepEqual({ o: await count("opportunities"), s: await count("sales_orders") }, { o: before.o + 1, s: before.s }, "only the movable Opportunity was written");
  });

  await t.test("ACTIVE CUSTOMER (DQ-5): work already under way when the customer later goes INACTIVE stays governed history and completes; nothing is rewritten", async () => {
    const live = ok(await com(national, "createOpportunity", opp("acct-lapsing", "NATIONAL_ACCOUNTS")), "opened while ACTIVE");
    await q(`UPDATE eos_crm.accounts SET status = 'INACTIVE' WHERE tenant_id = $1 AND id = 'acct-lapsing'`, [TENANT]);
    await toDecision(national, live.opportunityId);
    const ag = ok(await com(national, "createSalesAgreement", { idempotencyKey: key(), opportunityId: live.opportunityId, ownerEmployeeId: "e-national", isLease: false, lines: LINE }), "agreement continues");
    ok(await com(national, "acceptSalesAgreement", { idempotencyKey: key(), salesAgreementId: ag.salesAgreementId }), "accept continues");
    const order = ok(await com(national, "closeOpportunityAsWon", { idempotencyKey: key(), opportunityId: live.opportunityId }), "WON continues");
    assert.equal((await one(`SELECT account_id FROM eos_commercial.sales_orders WHERE id = $1`, [order.salesOrderId])).account_id, "acct-lapsing");
    refused(await com(national, "createOpportunity", opp("acct-lapsing", "NATIONAL_ACCOUNTS")), 412, "ACCOUNT_NOT_ACTIVE", "but no NEW work");
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
    const open = ok(await com(national, "createOpportunity", opp("acct-chain", "NATIONAL_ACCOUNTS")), "an open National Accounts Opportunity");
    refused(await com(national, "updateOpportunity", { idempotencyKey: key(), opportunityId: open.opportunityId, expectedEditVersion: 1, salesChannel: "RETAIL" }),
      403, "OUTSIDE_SALES_CHANNEL_SCOPE", "national pushing a record out to retail");
  });

  await t.test("AUTHORIZED CHANNELS ONLY (DQ-4): each caller is offered exactly the channels its governed authority admits -- derived, not by persona", async () => {
    const offers = async (who) => ok(await com(who, "readMyCommercialCapabilities"), "offer").channelOffers;
    assert.deepEqual(await offers(retail), { "opportunity.write": ["RETAIL"], "salesOrder.write": ["RETAIL"] }, "Retail seller: RETAIL only");
    assert.deepEqual(await offers(national), { "opportunity.write": ["NATIONAL_ACCOUNTS"], "salesOrder.write": ["NATIONAL_ACCOUNTS"] }, "National seller: NATIONAL_ACCOUNTS only");
    assert.deepEqual(await offers(both), { "opportunity.write": ["NATIONAL_ACCOUNTS", "RETAIL"], "salesOrder.write": ["NATIONAL_ACCOUNTS", "RETAIL"] }, "two scoped holdings: both");
    assert.deepEqual(await offers(managerGlobal), { "opportunity.write": ["NATIONAL_ACCOUNTS", "RETAIL"], "salesOrder.write": ["NATIONAL_ACCOUNTS", "RETAIL"] },
      "a global holder: every ACTIVE channel -- never the inactive STRATEGIC_ACCOUNTS");
    for (const who of [nobody, technician]) assert.deepEqual(await offers(who), { "opportunity.write": [], "salesOrder.write": [] }, "no authority: no channel");
    // The offer narrows the UI; the server still decides: a forged out-of-scope channel refuses.
    refused(await com(retail, "createOpportunity", opp("acct-deli", "NATIONAL_ACCOUNTS")), 403, "OUTSIDE_SALES_CHANNEL_SCOPE", "forged channel");
    refused(await com(retail, "createOpportunity", opp("acct-deli", "STRATEGIC_ACCOUNTS")), 403, "OUTSIDE_SALES_CHANNEL_SCOPE", "forged inactive channel");
    // NOT WRITABLE for anyone: a GLOBAL holder's scope admits every channel, so the ACTIVE-channel gate refuses it.
    refused(await com(managerGlobal, "createOpportunity", opp("acct-deli", "STRATEGIC_ACCOUNTS")), 412, "SALES_CHANNEL_NOT_ACTIVE", "global holder, inactive channel");
    refused(await com(managerGlobal, "createSalesOrder", directOrder("acct-deli", "STRATEGIC_ACCOUNTS")), 412, "SALES_CHANNEL_NOT_ACTIVE", "global holder, direct order");
    // The answer names only the caller's own channels: no Role, Principal, other holder, or unrelated tenant authority.
    const full = ok(await com(retail, "readMyCommercialCapabilities"), "offer");
    assert.deepEqual(Object.keys(full).sort(), ["capabilities", "channelOffers", "channelScoped"]);
  });

  await t.test("SALES MANAGER before the packet: Administration refuses a channel-scoped Sales Manager (it carries tenant-wide audit), and the Manager cannot accept or close WON", async () => {
    for (const [who, channel] of [[managerNational, "NATIONAL_ACCOUNTS"], [managerRetail, "RETAIL"]]) {
      const r = await assign(who, "salesManager", channel, "a per-channel Sales Manager");
      assert.equal(r.ok, false);
      assert.match(r.message, /SCOPE_AMBIGUOUS_ADMINISTRATION: salesManager carries Administration authority \(audit\.event\.read\)/);
    }
    const m = ok(await com(managerGlobal, "createOpportunity", opp("acct-chain", "NATIONAL_ACCOUNTS")), "manager create");
    await toDecision(managerGlobal, m.opportunityId);
    const ma = ok(await com(managerGlobal, "createSalesAgreement", { idempotencyKey: key(), opportunityId: m.opportunityId, ownerEmployeeId: "e-national", isLease: false, lines: LINE }), "draft");
    refused(await com(managerGlobal, "acceptSalesAgreement", { idempotencyKey: key(), salesAgreementId: ma.salesAgreementId }), 403, "CAPABILITY_REQUIRED", "accept before the packet");
    refused(await com(managerGlobal, "closeOpportunityAsWon", { idempotencyKey: key(), opportunityId: m.opportunityId }), 403, "CAPABILITY_REQUIRED", "won before the packet");
  });

  await t.test("SALES MANAGER packet through Administration: the Role sheds tenant-wide audit, gains DQ-021, and becomes salesChannel-assignable; Administration stays fail-closed", async () => {
    const before = await roleCaps("salesManager");
    for (const { operation, input } of parity.salesManagerActivationOperations()) {
      const r = await admin(operation, input);
      assert.equal(r.ok, true, `${operation} ${input.objectKey}.${input.actionKey} ${JSON.stringify(r).slice(0, 300)}`);
    }
    const after = await roleCaps("salesManager");
    assert.deepEqual(after, [...before.filter((k) => k !== "audit.event.read"), "opportunity.createSalesOrder", "salesAgreement.accept"].sort(), "net -1 +2, nothing else");
    // THE FINAL COMPOSITION: Commercial, customer, catalog and finance-read authority; NO Administration capability.
    const { isAdministrationCapability } = require("../lib/adminPolicy/assignmentScopeRuntime.js");
    assert.deepEqual(after.filter(isAdministrationCapability), [], "no Administration authority remains");
    const decision = await one(`SELECT decision FROM eos_policy.role_capability_decisions
                                 WHERE tenant_id = $1 AND role_key = 'salesManager' AND capability_key = 'audit.event.read' AND superseded_at IS NULL`, [TENANT]);
    assert.equal(decision?.decision, "ADMIN_REVOKED", "the separation is a recorded, current Administration decision");
    // VERIFIED, NOT DRIFT: against the nonprod system default + this tenant's decisions, the separation is explained by
    // ADMIN_REVOKED and the parity by ADMIN_GRANTED -- no Sales Manager cell is drift.
    const live = (await q(`SELECT r.key AS "roleKey", c.key AS "capabilityKey" FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id
        JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE rc.tenant_id = $1`, [TENANT])).rows;
    const decisions = (await repo.listRoleCapabilityDecisions(TENANT)).map((d) => ({ roleKey: d.roleKey, capabilityKey: d.capabilityKey, decision: d.decision }));
    const v = authorityBaseline.verifyLiveTenantAuthority({ live, decisions, environment: "nonprod" });
    assert.deepEqual(v.drift.filter((d) => d.roleKey === "salesManager"), [], JSON.stringify(v.drift.filter((d) => d.roleKey === "salesManager")));
    assert.ok(v.explainedByAdminRevoke.some((c) => c.roleKey === "salesManager" && c.capabilityKey === "audit.event.read"), "separation explained by ADMIN_REVOKED");
    for (const k of ["salesAgreement.accept", "opportunity.createSalesOrder"]) {
      assert.ok(v.explainedByAdminGrant.some((c) => c.roleKey === "salesManager" && c.capabilityKey === k), `${k} explained by ADMIN_GRANTED`);
    }
    // Administration's scope picker now offers salesChannel for the Role -- and confers ONLY the channel-evaluable keys.
    const scopes = await admin("listSupportedAssignmentScopes", { roleKey: "salesManager" });
    assert.equal(scopes.ok, true, JSON.stringify(scopes).slice(0, 300));
    const sc = scopes.data.roles[0].assignableScopes.find((s) => s.scopeType === "salesChannel");
    assert.deepEqual([sc.assignable, sc.refusal], [true, null]);
    assert.deepEqual([...sc.scopedCapabilities].sort(), ["opportunity.createSalesOrder", "opportunity.read", "opportunity.write", "salesAgreement.accept",
      "salesAgreement.create", "salesAgreement.read", "salesAgreement.updateDraft", "salesOrder.read", "salesOrder.write"]);
    // FAIL-CLOSED STAYS: re-granting tenant-wide audit to the Role once it has scoped holders is refused (asserted below,
    // after the scoped assignments exist).
  });

  await t.test("SALES MANAGER @ RETAIL and @ NATIONAL_ACCOUNTS: each manages, accepts and converts ONLY in its channel; sellers stay sellers; the Owner inherits nothing", async () => {
    await scoped(managerRetail, "salesManager", "RETAIL");
    await scoped(managerNational, "salesManager", "NATIONAL_ACCOUNTS");
    const regrant = await admin("grantObjectActionToRole", { roleKey: "salesManager", objectKey: "auditLog", actionKey: "read", reason: "attempt to restore tenant-wide audit" });
    assert.equal(regrant.ok, false);
    assert.match(regrant.message, /SCOPE_AMBIGUOUS_ADMINISTRATION/, "tenant-wide audit cannot return to a Role with scoped holders");

    // The seller drafts; the channel's manager accepts and closes WON (the Sales Order is created by the WON).
    const managed = async (seller, manager, accountId, channel, owner) => {
      const x = ok(await com(seller, "createOpportunity", opp(accountId, channel)), `${channel} seller create`);
      await toDecision(seller, x.opportunityId);
      const ag = ok(await com(seller, "createSalesAgreement", { idempotencyKey: key(), opportunityId: x.opportunityId, ownerEmployeeId: owner, isLease: false, lines: LINE }), "draft");
      return { x, ag, accept: () => com(manager, "acceptSalesAgreement", { idempotencyKey: key(), salesAgreementId: ag.salesAgreementId }),
        won: () => com(manager, "closeOpportunityAsWon", { idempotencyKey: key(), opportunityId: x.opportunityId }) };
    };
    const retailDeal = await managed(retail, managerRetail, "acct-deli", "RETAIL", "e-retail");
    const nationalDeal = await managed(national, managerNational, "acct-chain", "NATIONAL_ACCOUNTS", "e-national");
    // CROSS-CHANNEL: each manager is refused the other channel's management, and cannot see it.
    refused(await com(managerRetail, "acceptSalesAgreement", { idempotencyKey: key(), salesAgreementId: nationalDeal.ag.salesAgreementId }), 403, "OUTSIDE_SALES_CHANNEL_SCOPE", "retail manager accepting national");
    refused(await com(managerRetail, "closeOpportunityAsWon", { idempotencyKey: key(), opportunityId: nationalDeal.x.opportunityId }), 403, "OUTSIDE_SALES_CHANNEL_SCOPE", "retail manager closing national");
    refused(await com(managerRetail, "getOpportunityDetail", { opportunityId: nationalDeal.x.opportunityId }), 404, "RECORD_NOT_FOUND", "retail manager reading national");
    refused(await com(managerRetail, "createOpportunity", opp("acct-chain", "NATIONAL_ACCOUNTS")), 403, "OUTSIDE_SALES_CHANNEL_SCOPE", "retail manager creating national");
    refused(await com(managerNational, "acceptSalesAgreement", { idempotencyKey: key(), salesAgreementId: retailDeal.ag.salesAgreementId }), 403, "OUTSIDE_SALES_CHANNEL_SCOPE", "national manager accepting retail");
    refused(await com(managerNational, "closeOpportunityAsWon", { idempotencyKey: key(), opportunityId: retailDeal.x.opportunityId }), 403, "OUTSIDE_SALES_CHANNEL_SCOPE", "national manager closing retail");
    refused(await com(managerNational, "getSalesAgreementDetail", { salesAgreementId: retailDeal.ag.salesAgreementId }), 404, "RECORD_NOT_FOUND", "national manager reading retail");
    refused(await com(managerNational, "createSalesOrder", directOrder("acct-deli", "RETAIL")), 403, "OUTSIDE_SALES_CHANNEL_SCOPE", "national manager ordering retail");
    // OWN CHANNEL: accept, then WON creates the Sales Order in that channel.
    for (const [deal, channel, manager] of [[retailDeal, "RETAIL", managerRetail], [nationalDeal, "NATIONAL_ACCOUNTS", managerNational]]) {
      assert.deepEqual([(ok(await deal.accept(), `${channel} accept`)).state], ["ACCEPTED"]);
      const order = ok(await deal.won(), `${channel} won`);
      const row = await one(`SELECT sales_channel::text c, sales_agreement_id FROM eos_commercial.sales_orders WHERE id = $1`, [order.salesOrderId]);
      assert.deepEqual(row, { c: channel, sales_agreement_id: deal.ag.salesAgreementId });
      const accepted = await one(`SELECT accepted_by FROM eos_commercial.sales_agreements WHERE id = $1`, [deal.ag.salesAgreementId]);
      assert.equal(accepted.accepted_by, manager.principalId, "the channel's manager accepted");
    }
    // The managers' picker offers: their channel only.
    assert.deepEqual(ok(await com(managerRetail, "readMyCommercialCapabilities"), "offer").channelOffers["opportunity.write"], ["RETAIL"]);
    assert.deepEqual(ok(await com(managerNational, "readMyCommercialCapabilities"), "offer").channelOffers["opportunity.write"], ["NATIONAL_ACCOUNTS"]);
    // A scoped Sales Manager holds no tenant-wide audit visibility.
    const audit = await executeAs(managerRetail, "readPolicyAuditHistory", { limit: 5 });
    assert.equal(audit.ok, false, `a channel manager reads no tenant-wide audit: ${JSON.stringify(audit).slice(0, 200)}`);
    // Sellers remain sellers in their own channel.
    refused(await com(national, "createOpportunity", opp("acct-deli", "RETAIL")), 403, "OUTSIDE_SALES_CHANNEL_SCOPE", "seller still in its channel");
    refused(await com(retail, "createOpportunity", opp("acct-chain", "NATIONAL_ACCOUNTS")), 403, "OUTSIDE_SALES_CHANNEL_SCOPE", "seller still in its channel");
  });

  await t.test("SALES MANAGER global (Option A remains valid) completes both channels; the Owner model is unchanged -- neither accept nor WON", async () => {
    const complete = async (who, accountId, channel) => {
      const x = ok(await com(who, "createOpportunity", opp(accountId, channel)), `${channel} create`);
      await toDecision(who, x.opportunityId);
      const ag = ok(await com(who, "createSalesAgreement", { idempotencyKey: key(), opportunityId: x.opportunityId, ownerEmployeeId: channel === "RETAIL" ? "e-retail" : "e-national", isLease: false, lines: LINE }), "draft");
      ok(await com(who, "acceptSalesAgreement", { idempotencyKey: key(), salesAgreementId: ag.salesAgreementId }), `${channel} accept`);
      return ok(await com(who, "closeOpportunityAsWon", { idempotencyKey: key(), opportunityId: x.opportunityId }), `${channel} won`);
    };
    await complete(managerGlobal, "acct-chain", "NATIONAL_ACCOUNTS");
    await complete(managerGlobal, "acct-deli", "RETAIL");
    const ow = ok(await com(owner, "createOpportunity", opp("acct-chain", "NATIONAL_ACCOUNTS")), "owner create");
    await toDecision(owner, ow.opportunityId);
    const oa = ok(await com(owner, "createSalesAgreement", { idempotencyKey: key(), opportunityId: ow.opportunityId, ownerEmployeeId: "e-national", isLease: false, lines: LINE }), "owner draft");
    refused(await com(owner, "acceptSalesAgreement", { idempotencyKey: key(), salesAgreementId: oa.salesAgreementId }), 403, "CAPABILITY_REQUIRED", "owner accept");
    refused(await com(owner, "closeOpportunityAsWon", { idempotencyKey: key(), opportunityId: ow.opportunityId }), 403, "CAPABILITY_REQUIRED", "owner won");
    assert.deepEqual((await roleCaps("owner")).filter((k) => ["salesAgreement.accept", "opportunity.createSalesOrder"].includes(k)), [], "the Owner Role holds neither key");
  });
});
