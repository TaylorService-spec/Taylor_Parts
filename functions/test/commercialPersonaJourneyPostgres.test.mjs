// RETAIL SALES PERSONA JOURNEY -- the Commercial transport (POST /commercial/sales) driven by the CANONICAL persona
// Security Role compositions, with EXACTLY the grants the governed authority baseline declares for those Roles.
//
// ════════════════════ WHY THIS FILE EXISTS ════════════════════
//
// commercialTransportPostgres proves the transport against hand-built capability sets ("a write grant", "a read grant").
// That proves the MECHANISM. It does not prove that the personas an acceptance run logs in as can do their work, or that
// the nearby personas cannot. This file closes that gap without a login, a password or an emulator: identity ends at the
// token, and everything after it -- Principal, membership, Role, role_capabilities, the evaluator, the C2 commands and
// C3 reads -- is the product's own code over a real PostgreSQL.
//
//   * The persona -> Security Role composition is read from scripts/fixtures/personaAuthorityDimensions.v1.json (the
//     canonical persona manifest). The Role -> capability grants are read from
//     src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json (the governed rebuild baseline). NOTHING is granted here
//     that the baseline does not declare, and nothing it declares is withheld.
//   * The pinned COMMERCIAL_HOLDINGS table below is the expectation written down by hand. It is asserted against the
//     baseline FIRST, so the day a grant moves (e.g. an Administration decision closes the salesManager/owner parity
//     gap), this suite fails at the pin -- pointing at the decision -- instead of the change passing unobserved.
//
// It writes only to a database it creates and drops. No nonprod, no Firebase, no fixture edit.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";
import { bindOperatingCompany } from "./support/governedOperatingCompanyBinding.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const http = require("../lib/eosCommercial/commercialHttp.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const BASELINE = JSON.parse(readFileSync(resolve(FUNCTIONS_DIR, "src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json"), "utf8"));
const PERSONAS = JSON.parse(readFileSync(resolve(FUNCTIONS_DIR, "scripts/fixtures/personaAuthorityDimensions.v1.json"), "utf8")).personas;

const COMMERCIAL_KEYS = Object.freeze(["opportunity.read", "opportunity.write", "opportunity.createSalesOrder", "salesAgreement.read",
  "salesAgreement.create", "salesAgreement.updateDraft", "salesAgreement.accept", "salesOrder.read", "salesOrder.write"]);

/** Role key -> every capability the governed baseline grants it. */
const grantsOf = (roleKey) => BASELINE.grants.filter((g) => g.roleKey === roleKey).map((g) => g.capabilityKey);
/** Persona -> the Commercial capabilities its Security Roles hold, per the baseline. */
const commercialHoldingsOf = (roles) => [...new Set(roles.flatMap(grantsOf))].filter((k) => COMMERCIAL_KEYS.includes(k)).sort();

// ════════════════════ THE PINNED EXPECTATION ════════════════════
// Persona key (manifest) -> the Commercial capabilities it holds today. `salesManager` has no canonical persona holder
// (Owner 2026-09-26: a valid Security Role with zero holders), so it is measured as a Role-only pseudo persona.
const ALL = COMMERCIAL_KEYS;
const COMMERCIAL_HOLDINGS = Object.freeze({
  "retail-sales-a": ALL,
  "retail-sales-b": ALL,
  "national-accounts-sales": ALL,
  "general-manager": ALL,
  dispatcher: ALL,
  administrator: ALL,
  // GOVERNED_AUTHORITY_PARITY_GAP (Owner 2026-09-26 sales-manager ruling; archaeology 2026-09-25): owner and salesManager
  // hold opportunity.write + salesAgreement.create but NOT salesAgreement.accept / opportunity.createSalesOrder, so
  // neither can finish the Retail Sales chain. Pinned as CURRENT state; closing it is an Administration grant decision.
  "owner-executive": ["opportunity.read", "opportunity.write", "salesAgreement.read", "salesAgreement.create", "salesAgreement.updateDraft", "salesOrder.read", "salesOrder.write"],
  "role:salesManager": ["opportunity.read", "opportunity.write", "salesAgreement.read", "salesAgreement.create", "salesAgreement.updateDraft", "salesOrder.read", "salesOrder.write"],
  // Office Manager is CRM-only: customer.record.* and nothing Commercial.
  "office-manager": [],
  "finance-controller": ["opportunity.read", "salesOrder.read"],
  "service-manager": ["salesOrder.read"],
  "parts-associate": ["salesOrder.read"],
  "parts-manager": ["salesOrder.read"],
  "warehouse-associate": ["salesOrder.read"],
  "service-technician-a": [],
  "restricted-user": [],
  "records-clerk": [],
});
// DQ-020 (Controller 2026-09-28): Commercial writes are NOT tenant-wide. The sales personas hold `salesperson` at
// their channel -- the Administration configuration this suite proves (assignRole with scopeType salesChannel). The
// global holders above (owner, GM, dispatcher, administrator, salesManager) keep every channel.
const SALES_CHANNEL_OF = Object.freeze({ "retail-sales-a": "RETAIL", "retail-sales-b": "RETAIL", "national-accounts-sales": "NATIONAL_ACCOUNTS" });
const rolesOf = (persona) => (persona.startsWith("role:") ? [persona.slice(5)] : PERSONAS[persona].securityRoles);

/** Operation -> the capabilities it requires (the C2/C3 contract), and an input that fails AFTER authorization. */
const OPERATIONS = Object.freeze({
  createOpportunity: [["opportunity.write"], (channel = "RETAIL") => ({ idempotencyKey: `k-${randomUUID()}`, accountId: "acct-missing", salesChannel: channel, lines: [{ kind: "SERVICE", ref: "s", qty: 1 }] })],
  updateOpportunity: [["opportunity.write"], () => ({ idempotencyKey: `k-${randomUUID()}`, opportunityId: "opp-missing", expectedEditVersion: 1, need: "x" })],
  transitionOpportunity: [["opportunity.write"], () => ({ idempotencyKey: `k-${randomUUID()}`, opportunityId: "opp-missing", toStage: "QUALIFYING" })],
  closeOpportunityAsWon: [["opportunity.write", "opportunity.createSalesOrder"], () => ({ idempotencyKey: `k-${randomUUID()}`, opportunityId: "opp-missing" })],
  createSalesOrderFromOpportunity: [["opportunity.createSalesOrder"], () => ({ idempotencyKey: `k-${randomUUID()}`, opportunityId: "opp-missing" })],
  createSalesAgreement: [["salesAgreement.create"], () => ({ idempotencyKey: `k-${randomUUID()}`, opportunityId: "opp-missing" })],
  updateSalesAgreementDraft: [["salesAgreement.updateDraft"], () => ({ idempotencyKey: `k-${randomUUID()}`, salesAgreementId: "sag-missing", customerPO: "x" })],
  acceptSalesAgreement: [["salesAgreement.accept"], () => ({ idempotencyKey: `k-${randomUUID()}`, salesAgreementId: "sag-missing" })],
  createSalesOrder: [["salesOrder.write"], (channel = "RETAIL") => ({ idempotencyKey: `k-${randomUUID()}`, accountId: "acct-missing", ownerEmployeeId: "e-retail-a", salesChannel: channel, operatingCompanyId: "taylor", lines: [{ kind: "SERVICE", ref: "s", orderedQty: 1, unitPrice: 100, businessUnitId: "SERVICE" }] })],
  transitionSalesOrder: [["salesOrder.write"], () => ({ idempotencyKey: `k-${randomUUID()}`, salesOrderId: "sor-missing", transition: "ADVANCE" })],
  getOpportunityDetail: [["opportunity.read"], () => ({ opportunityId: "opp-missing" })],
  listOpportunities: [["opportunity.read"], () => ({})],
  getSalesAgreementDetail: [["salesAgreement.read"], () => ({ salesAgreementId: "sag-missing" })],
  listSalesAgreements: [["salesAgreement.read"], () => ({})],
  getSalesOrderDetail: [["salesOrder.read"], () => ({ salesOrderId: "sor-missing" })],
  listSalesOrders: [["salesOrder.read"], () => ({})],
  getAccountCommercialProjection: [["opportunity.read", "salesAgreement.read", "salesOrder.read"], () => ({ accountId: "acct-missing" })],
  // The caller's own capabilities: any active member may ask about itself.
  readMyCommercialCapabilities: [[], () => ({})],
});

// ════════════════════ PART 1 -- no database ════════════════════

test("the pinned Commercial holdings are exactly what the governed baseline grants each persona's Security Roles", () => {
  for (const [persona, expected] of Object.entries(COMMERCIAL_HOLDINGS)) {
    if (!persona.startsWith("role:")) assert.ok(PERSONAS[persona], `the persona manifest no longer declares ${persona}`);
    assert.deepEqual(commercialHoldingsOf(rolesOf(persona)), [...expected].sort(), `${persona}: baseline and pin disagree -- a grant moved`);
  }
  // Every canonical sales persona is ONE Security Role, salesperson; the channel is business data, never a Role.
  for (const p of ["retail-sales-a", "retail-sales-b", "national-accounts-sales"]) assert.deepEqual(PERSONAS[p].securityRoles, ["salesperson"]);
});

test("the operation table names every operation the transport exposes, and nothing else", () => {
  assert.deepEqual(Object.keys(OPERATIONS).sort(), [...http.COMMERCIAL_READ_OPERATIONS, ...http.COMMERCIAL_MUTATION_OPERATIONS].sort());
});

// ════════════════════ PART 2 -- the persona matrix and the Retail Sales journey, in PostgreSQL ════════════════════

const dbUrlFor = (name) => { const u = new URL(URL_BASE); u.pathname = `/${name}`; return u.toString(); };
async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

test("Retail Sales persona journey over the Commercial transport", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `c_persona_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  const url = dbUrlFor(name);
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
  });
  const pool = new pg.Pool({ connectionString: url, max: 8 });
  t.after(async () => {
    await pool.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  const q = (text, values = []) => pool.query(text, values);
  const repo = new PostgresPolicyRepository(pool);
  const TENANT = "t-retail";

  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1,$1,'Retail'), ('t-other','t-other','Other')`, [TENANT]);
  await bindOperatingCompany(q, TENANT, "taylor", "taylor-key");
  await bindOperatingCompany(q, "t-other", "taylor");
  // Ventana is a governed company with NO key binding in this tenant (the nonprod shape).
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
           VALUES ($1,'ventana','ACTIVE','test-fixture','fixture','fixture') ON CONFLICT DO NOTHING`, [TENANT]);

  // ── Roles, created ONCE each with EXACTLY the baseline grants (all of them, Commercial or not). ──
  const actorFor = (tenantId) => ({ tenantId, uid: "uid-fixture-admin" });
  const roleIds = new Map();
  const roleFor = async (tenantId, roleKey) => {
    const cacheKey = `${tenantId}|${roleKey}`;
    if (roleIds.has(cacheKey)) return roleIds.get(cacheKey);
    const role = await repo.transact(actorFor(tenantId), (tx) => tx.createRole({ key: roleKey, name: roleKey, description: null, origin: "CUSTOM", protected: false }));
    for (const capabilityKey of grantsOf(roleKey)) {
      const inserted = await q(`INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
               SELECT $1, $2, $3, c.id, 'baseline', 'baseline', 'baseline' FROM eos_policy.capabilities c WHERE c.key = $4`,
        [`rc_${role.id}_${capabilityKey}`, tenantId, role.id, capabilityKey]);
      if (COMMERCIAL_KEYS.includes(capabilityKey)) assert.equal(inserted.rowCount, 1, `${capabilityKey} is not a registered capability`);
    }
    roleIds.set(cacheKey, role.id);
    return role.id;
  };
  const TOKENS = new Map();
  const verifyToken = async (token) => {
    const subject = TOKENS.get(token);
    if (!subject) throw new Error("invalid token");
    return { externalSubject: subject, identityProvider: "firebase" };
  };
  const deps = { reader: repo, pool, verifyToken, allowedOrigins: [] };
  const signIn = async (persona, tenantId = TENANT, channel = tenantId === TENANT ? SALES_CHANNEL_OF[persona] ?? null : null) => {
    const subject = `uid-${persona.replace(/[^a-z0-9]/gi, "-")}-${tenantId}`;
    const principalId = await repo.transact(actorFor(tenantId), async (tx) => {
      const principal = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
      await tx.createTenantMembership(principal.id);
      return principal.id;
    });
    for (const roleKey of rolesOf(persona)) {
      const roleId = await roleFor(tenantId, roleKey);
      await repo.transact(actorFor(tenantId), async (tx) => {
        const accessVersion = await tx.bumpAccessVersion(principalId);
        return tx.createAssignment({ principalId, roleId, scopeType: channel ? "salesChannel" : "global", scopeValue: channel, status: "active", grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion });
      });
    }
    TOKENS.set(`tok-${subject}`, subject);
    return { persona, principalId, token: `tok-${subject}`, channel };
  };
  const call = async (actor, operation, input) => {
    const res = await http.handleCommercialRequest(deps, {
      method: "POST", url: "/commercial/sales", headers: { authorization: `Bearer ${actor.token}` },
      body: JSON.stringify(input === undefined ? { operation } : { operation, input }),
    });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  const ok = (res, what) => { assert.equal(res.status, 200, `${what}: ${JSON.stringify(res.body)}`); return res.body.result; };
  const refused = (res, status, code, what) => assert.deepEqual([res.status, res.body.code], [status, code], `${what}: ${JSON.stringify(res.body)}`);
  const key = () => `k-${randomUUID()}`;

  // ── The business world: Employees by status, Accounts owned by the sales personas. ──
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES
    ('e-retail-a',$1,'ACTIVE','taylor'), ('e-retail-b',$1,'ACTIVE','taylor'), ('e-national',$1,'ACTIVE','taylor'),
    ('e-contractor',$1,'CONTRACTOR','taylor'), ('e-inactive',$1,'INACTIVE','taylor'), ('e-leave',$1,'ON_LEAVE','taylor'),
    ('e-terminated',$1,'TERMINATED','taylor'), ('e-other-tenant','t-other','ACTIVE','taylor')`, [TENANT]);
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, owner_employee_id, created_by, updated_by) VALUES
    ('acct-retail',$1,'Corner Deli','ACTIVE','e-retail-a','x','x'), ('acct-national',$1,'Chain HQ','ACTIVE','e-national','x','x'),
    ('acct-inactive-owner',$1,'Old Book','ACTIVE','e-inactive','x','x'), ('acct-other','t-other','Elsewhere','ACTIVE','e-other-tenant','x','x')`, [TENANT]);

  for (const channel of ["RETAIL", "NATIONAL_ACCOUNTS"]) {
    await q(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id, sales_channel, status, source, established_by, updated_by)
             VALUES ($1,$2,'ACTIVE','fixture','fixture','fixture')`, [TENANT, channel]);
  }
  const personas = {};
  for (const persona of Object.keys(COMMERCIAL_HOLDINGS)) personas[persona] = await signIn(persona);
  const retailA = personas["retail-sales-a"];

  await t.test("MATRIX: every persona x every operation -- held capability reaches the domain, a missing one is 403 CAPABILITY_REQUIRED", async () => {
    let cells = 0;
    for (const [persona, holdings] of Object.entries(COMMERCIAL_HOLDINGS)) {
      for (const [operation, [required, input]] of Object.entries(OPERATIONS)) {
        // A channel-scoped seller is asked inside its own channel: this matrix proves the capability, the DQ-020 tests below the channel.
        const res = await call(personas[persona], operation, input(personas[persona].channel ?? undefined));
        const authorized = required.every((c) => holdings.includes(c));
        if (authorized) {
          assert.notEqual(res.status, 403, `${persona} ${operation} was refused although it holds ${required.join("+")}: ${JSON.stringify(res.body)}`);
          assert.notEqual(res.status, 500, `${persona} ${operation}: ${JSON.stringify(res.body)}`);
        } else {
          refused(res, 403, "CAPABILITY_REQUIRED", `${persona} ${operation}`);
        }
        cells += 1;
      }
    }
    assert.equal(cells, Object.keys(COMMERCIAL_HOLDINGS).length * Object.keys(OPERATIONS).length);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_commercial.command_receipts`)).rows[0].n, 0, "a refused or failed command left a receipt");
  });

  await t.test("OFFER == AUTHORITY: every persona's readMyCommercialCapabilities is exactly what the commands will accept", async () => {
    for (const [persona, holdings] of Object.entries(COMMERCIAL_HOLDINGS)) {
      const answer = ok(await call(personas[persona], "readMyCommercialCapabilities"), persona);
      const scopedPersona = Boolean(personas[persona].channel);
      assert.deepEqual([...(scopedPersona ? answer.channelScoped : answer.capabilities)].sort(), [...holdings].sort(), `${persona}: the offer disagrees with the authority`);
      assert.deepEqual(scopedPersona ? answer.capabilities : answer.channelScoped, [], `${persona}: global and channel-scoped holdings mixed`);
      assert.deepEqual(Object.keys(answer).sort(), ["capabilities", "channelScoped"], "the answer discloses nothing else");
    }
    // A salesManager holding its Role ONLY at salesChannel=RETAIL: everything it holds is offered as channel-scoped, and the
    // server decides each record against its channel (DQ-020).
    const scopedSubject = "uid-scoped-retail-manager";
    const scopedPrincipal = await repo.transact(actorFor(TENANT), async (tx) => {
      const principal = await tx.createPrincipal({ externalSubject: scopedSubject, identityProvider: "firebase" });
      await tx.createTenantMembership(principal.id);
      const accessVersion = await tx.bumpAccessVersion(principal.id);
      await tx.createAssignment({ principalId: principal.id, roleId: await roleFor(TENANT, "salesManager"), scopeType: "salesChannel", scopeValue: "RETAIL", status: "active", grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion });
      return principal.id;
    });
    TOKENS.set(`tok-${scopedSubject}`, scopedSubject);
    const scoped = { persona: "scoped", principalId: scopedPrincipal, token: `tok-${scopedSubject}` };
    const scopedAnswer = ok(await call(scoped, "readMyCommercialCapabilities"), "scoped");
    assert.deepEqual(scopedAnswer, { capabilities: [], channelScoped: [...COMMERCIAL_HOLDINGS["role:salesManager"]].sort((a, b) => COMMERCIAL_KEYS.indexOf(a) - COMMERCIAL_KEYS.indexOf(b)) });
    ok(await call(scoped, "listOpportunities"), "the offered read is served");
    refused(await call(scoped, "createOpportunity", { ...OPERATIONS.createOpportunity[1]("NATIONAL_ACCOUNTS"), accountId: "acct-national" }), 403, "OUTSIDE_SALES_CHANNEL_SCOPE", "scoped write outside its channel");

    refused(await call(retailA, "readMyCommercialCapabilities", { principalId: "someone-else" }), 400, "AUTHORITY_FIELD_NOT_ACCEPTED", "selector");
    refused(await call(retailA, "readMyCommercialCapabilities", { employeeId: "e-retail-b" }), 400, "FIELD_NOT_ACCEPTED", "any input");
  });

  // ════════════════════ THE RETAIL SALES JOURNEY, performed by retail-sales-a ════════════════════
  let opp;
  let agreement;
  let order;
  await t.test("JOURNEY 1: retail-sales-a creates a RETAIL Opportunity on its own Account; owner inherited, accountable derived, audit attributed", async () => {
    opp = ok(await call(retailA, "createOpportunity", {
      idempotencyKey: key(), accountId: "acct-retail", salesChannel: "RETAIL", operatingCompanyId: "taylor", need: "Reach-in cooler service plan",
      expectedValue: 4200, lines: [{ kind: "SERVICE", ref: "svc-pm-annual", qty: 1 }],
    }), "create");
    assert.deepEqual([opp.stage, opp.editVersion, opp.accountableEmployeeId, opp.accountablePersonSource], ["IDENTIFIED", 1, "e-retail-a", "DERIVED_FROM_RECORD_OWNER"]);
    const row = (await q(`SELECT owner_employee_id, operating_company_key, sales_channel::text, created_by, updated_by FROM eos_commercial.opportunities WHERE id=$1`, [opp.opportunityId])).rows[0];
    assert.deepEqual(row, { owner_employee_id: "e-retail-a", operating_company_key: "taylor-key", sales_channel: "RETAIL", created_by: retailA.principalId, updated_by: retailA.principalId });
    const established = (await q(`SELECT action::text, source::text, recorded_by FROM eos_commercial.accountability_handoffs WHERE opportunity_id=$1`, [opp.opportunityId])).rows;
    assert.deepEqual(established, [{ action: "ESTABLISHMENT", source: "DERIVED_FROM_RECORD_OWNER", recorded_by: retailA.principalId }]);
  });

  await t.test("JOURNEY 2: stages advance in order; an illegal jump and a premature outcome refuse 412; the read shows the version", async () => {
    refused(await call(retailA, "transitionOpportunity", { idempotencyKey: key(), opportunityId: opp.opportunityId, toStage: "QUOTING" }), 412, "ILLEGAL_TRANSITION", "skip ahead");
    refused(await call(retailA, "transitionOpportunity", { idempotencyKey: key(), opportunityId: opp.opportunityId, outcome: "WON" }), 412, "OUTCOME_REQUIRES_DECISION", "early WON");
    let version = 1;
    for (const toStage of ["QUALIFYING", "SOLUTION", "QUOTING", "CUSTOMER_REVIEW", "DECISION"]) {
      const moved = ok(await call(retailA, "transitionOpportunity", { idempotencyKey: key(), opportunityId: opp.opportunityId, toStage }), toStage);
      version += 1;
      assert.deepEqual([moved.stage, moved.editVersion], [toStage, version]);
    }
    const detail = ok(await call(retailA, "getOpportunityDetail", { opportunityId: opp.opportunityId }), "detail");
    assert.deepEqual([detail.stage, detail.editVersion], ["DECISION", 6]);
  });

  await t.test("JOURNEY 3: a section save with a stale edit version is 409; with the current version it applies and bumps it", async () => {
    refused(await call(retailA, "updateOpportunity", { idempotencyKey: key(), opportunityId: opp.opportunityId, expectedEditVersion: 1, nextAction: "stale" }), 409, "VERSION_CONFLICT", "stale");
    const saved = ok(await call(retailA, "updateOpportunity", {
      idempotencyKey: key(), opportunityId: opp.opportunityId, expectedEditVersion: 6,
      // The whole section rides along: unchanged owner and channel are not changes.
      ownerEmployeeId: "e-retail-a", salesChannel: "RETAIL", nextAction: "Send agreement",
    }), "section save");
    assert.deepEqual([saved.changed, saved.editVersion, saved.ownershipHandoffId], [["nextAction"], 7, null]);
  });

  await t.test("JOURNEY 3b: two concurrent saves against the same version -- exactly one applies, the other is 409", async () => {
    const [a, b] = await Promise.all([
      call(retailA, "updateOpportunity", { idempotencyKey: key(), opportunityId: opp.opportunityId, expectedEditVersion: 7, need: "first" }),
      call(retailA, "updateOpportunity", { idempotencyKey: key(), opportunityId: opp.opportunityId, expectedEditVersion: 7, need: "second" }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], `${JSON.stringify(a.body)} ${JSON.stringify(b.body)}`);
    assert.equal(Number((await q(`SELECT edit_version FROM eos_commercial.opportunities WHERE id=$1`, [opp.opportunityId])).rows[0].edit_version), 8);
  });

  await t.test("JOURNEY 4: Sales Agreement draft -> edit -> accept; a second accept is 412; an ACCEPTED Agreement cannot be edited", async () => {
    agreement = ok(await call(retailA, "createSalesAgreement", {
      idempotencyKey: key(), opportunityId: opp.opportunityId, ownerEmployeeId: "e-retail-a", isLease: false, fulfillmentIntent: "INSTALL",
      lines: [{ kind: "SERVICE", ref: "svc-pm-annual", quantity: 1, unitPrice: 420000, businessUnitId: "SERVICE" }],
    }), "agreement");
    assert.equal(agreement.state, "DRAFT");
    ok(await call(retailA, "updateSalesAgreementDraft", { idempotencyKey: key(), salesAgreementId: agreement.salesAgreementId, customerPO: "PO-778" }), "draft edit");
    const accepted = ok(await call(retailA, "acceptSalesAgreement", { idempotencyKey: key(), salesAgreementId: agreement.salesAgreementId }), "accept");
    assert.deepEqual([accepted.state, accepted.acceptedBy], ["ACCEPTED", retailA.principalId]);
    refused(await call(retailA, "acceptSalesAgreement", { idempotencyKey: key(), salesAgreementId: agreement.salesAgreementId }), 412, "ILLEGAL_TRANSITION", "second accept");
    refused(await call(retailA, "updateSalesAgreementDraft", { idempotencyKey: key(), salesAgreementId: agreement.salesAgreementId, customerPO: "PO-X" }), 412, "ILLEGAL_TRANSITION", "edit accepted");
    const row = (await q(`SELECT customer_po, accepted_by, operating_company_key FROM eos_commercial.sales_agreements WHERE id=$1`, [agreement.salesAgreementId])).rows[0];
    assert.deepEqual(row, { customer_po: "PO-778", accepted_by: retailA.principalId, operating_company_key: "taylor-key" });
  });

  await t.test("JOURNEY 5: close as WON creates the Sales Order atomically; a second close is 409; a WON Opportunity is not editable", async () => {
    const won = ok(await call(retailA, "closeOpportunityAsWon", { idempotencyKey: key(), opportunityId: opp.opportunityId }), "won");
    order = won;
    assert.equal(won.recovered, false);
    refused(await call(retailA, "closeOpportunityAsWon", { idempotencyKey: key(), opportunityId: opp.opportunityId }), 409, "SALES_ORDER_ALREADY_EXISTS", "second won");
    refused(await call(retailA, "updateOpportunity", { idempotencyKey: key(), opportunityId: opp.opportunityId, expectedEditVersion: 9, need: "x" }), 412, "CLOSED", "edit WON");
    const so = (await q(`SELECT state::text, sales_channel::text, owner_employee_id, operating_company_key, sales_agreement_id, customer_po, created_by FROM eos_commercial.sales_orders WHERE id=$1`, [won.salesOrderId])).rows[0];
    assert.deepEqual(so, { state: "CONFIRMED", sales_channel: "RETAIL", owner_employee_id: "e-retail-a", operating_company_key: "taylor-key", sales_agreement_id: agreement.salesAgreementId, customer_po: "PO-778", created_by: retailA.principalId });
    const detail = ok(await call(retailA, "getSalesOrderDetail", { salesOrderId: won.salesOrderId }), "so detail");
    assert.equal(detail.operatingCompanyId, "taylor", "the read maps the stored key back to the governed company");
  });

  await t.test("JOURNEY 6: Sales Order CONFIRMED -> IN_FULFILLMENT; FULFILLED is the held D2 boundary (503), never a guess", async () => {
    const advanced = ok(await call(retailA, "transitionSalesOrder", { idempotencyKey: key(), salesOrderId: order.salesOrderId, transition: "ADVANCE" }), "advance");
    assert.equal(advanced.state, "IN_FULFILLMENT");
    refused(await call(retailA, "transitionSalesOrder", { idempotencyKey: key(), salesOrderId: order.salesOrderId, transition: "ADVANCE" }), 503, "FULFILLMENT_AUTHORITY_UNAVAILABLE", "fulfil");
  });

  await t.test("JOURNEY 7: the Account projection shows the whole chain; every write left exactly one receipt attributed to the persona", async () => {
    const projection = ok(await call(retailA, "getAccountCommercialProjection", { accountId: "acct-retail" }), "projection");
    const ids = JSON.stringify(projection);
    for (const id of [opp.opportunityId, agreement.salesAgreementId, order.salesOrderId]) assert.ok(ids.includes(id), `${id} missing from the Account projection`);
    const receipts = (await q(`SELECT DISTINCT principal_id FROM eos_commercial.command_receipts`)).rows;
    assert.deepEqual(receipts, [{ principal_id: retailA.principalId }]);
  });

  await t.test("PRODUCT LINES (NO composed Catalog authority): a PART or EQUIPMENT_MODEL line fails closed 503 CATALOG_AUTHORITY_UNAVAILABLE and writes nothing", async () => {
    const before = (await q(`SELECT count(*)::int n FROM eos_commercial.opportunities`)).rows[0].n;
    for (const kind of ["PART", "EQUIPMENT_MODEL"]) {
      refused(await call(retailA, "createOpportunity", { idempotencyKey: key(), accountId: "acct-retail", salesChannel: "RETAIL", operatingCompanyId: "taylor", lines: [{ kind, ref: "anything", qty: 1 }] }),
        503, "CATALOG_AUTHORITY_UNAVAILABLE", kind);
    }
    assert.equal((await q(`SELECT count(*)::int n FROM eos_commercial.opportunities`)).rows[0].n, before);
  });

  await t.test("PRODUCT LINES (server composition, Catalog ACTIVE 2026-09-30): retail-sales-a quotes a governed PostgreSQL Part; an unknown or certification Part refuses", async () => {
    const { createPostgresCatalogReferenceAuthority } = require("../lib/catalogAuthority/postgresCatalogReferenceAuthority.js");
    const composed = { ...deps, catalog: createPostgresCatalogReferenceAuthority() };
    await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
               expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
             VALUES ('PRT-1005', $1, 'x', 'PRT-1005', 'Water Filter Cartridge', 'ACTIVE', 'EACH', 'STANDARD', 'STOCKED', false, false, false, false, 1, 'x')
             ON CONFLICT DO NOTHING`, [TENANT]);
    const callComposed = async (actor, operation, input) => {
      const res = await http.handleCommercialRequest(composed, { method: "POST", url: "/commercial/sales", headers: { authorization: `Bearer ${actor.token}` },
        body: JSON.stringify({ operation, input }) });
      return { status: res.status, body: JSON.parse(res.body) };
    };
    const created = ok(await callComposed(retailA, "createOpportunity", { idempotencyKey: key(), accountId: "acct-retail", salesChannel: "RETAIL",
      operatingCompanyId: "taylor", lines: [{ kind: "PART", ref: "PRT-1005", qty: 2 }] }), "PART line on a governed Part");
    assert.ok(created.opportunityId);
    for (const ref of ["PRT-NOT-IN-CATALOG", "CW-P-0000"]) {
      const res = await callComposed(retailA, "createOpportunity", { idempotencyKey: key(), accountId: "acct-retail", salesChannel: "RETAIL",
        operatingCompanyId: "taylor", lines: [{ kind: "PART", ref, qty: 1 }] });
      assert.notEqual(res.status, 200, `${ref} must not be accepted`);
    }
  });

  // ════════════════════ NEARBY UNAUTHORIZED ════════════════════

  await t.test("NEGATIVE: Office Manager (CRM-only), a technician, the restricted user and a no-Role clerk cannot read or touch the Opportunity", async () => {
    for (const persona of ["office-manager", "service-technician-a", "restricted-user", "records-clerk"]) {
      refused(await call(personas[persona], "getOpportunityDetail", { opportunityId: opp.opportunityId }), 403, "CAPABILITY_REQUIRED", `${persona} read`);
      refused(await call(personas[persona], "transitionOpportunity", { idempotencyKey: key(), opportunityId: opp.opportunityId, outcome: "LOST" }), 403, "CAPABILITY_REQUIRED", `${persona} write`);
    }
  });

  await t.test("NEGATIVE: read-only personas (finance controller, parts) read the Order but cannot move it", async () => {
    for (const persona of ["finance-controller", "parts-associate"]) {
      ok(await call(personas[persona], "getSalesOrderDetail", { salesOrderId: order.salesOrderId }), `${persona} read`);
      refused(await call(personas[persona], "transitionSalesOrder", { idempotencyKey: key(), salesOrderId: order.salesOrderId, transition: "CANCEL" }), 403, "CAPABILITY_REQUIRED", `${persona} cancel`);
    }
    refused(await call(personas["parts-associate"], "getSalesAgreementDetail", { salesAgreementId: agreement.salesAgreementId }), 403, "CAPABILITY_REQUIRED", "parts agreement");
  });

  await t.test("CURRENT STATE (pinned until the DQ-021 packet runs): the Owner and salesManager can draft but can neither accept an Agreement nor close as WON", async () => {
    for (const persona of ["owner-executive", "role:salesManager"]) {
      const o = ok(await call(personas[persona], "createOpportunity", { idempotencyKey: key(), accountId: "acct-retail", salesChannel: "RETAIL", operatingCompanyId: "taylor", lines: [{ kind: "SERVICE", ref: "svc", qty: 1 }] }), `${persona} create`);
      const a = ok(await call(personas[persona], "createSalesAgreement", { idempotencyKey: key(), opportunityId: o.opportunityId, ownerEmployeeId: "e-retail-a", isLease: false, lines: [{ kind: "SERVICE", ref: "svc", quantity: 1, unitPrice: 100, businessUnitId: "SERVICE" }] }), `${persona} agreement`);
      refused(await call(personas[persona], "acceptSalesAgreement", { idempotencyKey: key(), salesAgreementId: a.salesAgreementId }), 403, "CAPABILITY_REQUIRED", `${persona} accept`);
      refused(await call(personas[persona], "closeOpportunityAsWon", { idempotencyKey: key(), opportunityId: o.opportunityId }), 403, "CAPABILITY_REQUIRED", `${persona} won`);
    }
  });

  // DQ-021 (Controller 2026-09-28): salesManager receives salesAgreement.accept + opportunity.createSalesOrder through
  // CURRENT Administration in nonprod (the ledger's execution packet: grantObjectActionToRole x2), never a migration.
  // The Owner stays on the governed Owner model (ownerCapabilityContract: neither key), so the Owner half of the pinned
  // gap is the ruled state, not a gap. This is the NAMED POST-GRANT EXPECTATION: the same two rows the packet writes,
  // applied in this disposable database only, then removed so the pinned current state above stays the baseline.
  const base = (accountId, salesChannel) => ({ idempotencyKey: key(), accountId, salesChannel, operatingCompanyId: "taylor", lines: [{ kind: "SERVICE", ref: "s", qty: 1 }] });
  const DQ021_SALES_MANAGER_POST_GRANT = Object.freeze([...COMMERCIAL_HOLDINGS["role:salesManager"], "salesAgreement.accept", "opportunity.createSalesOrder"]);
  await t.test("DQ-021 POST-GRANT EXPECTATION: after the Administration packet, salesManager completes the chain; the Owner still cannot", async () => {
    const roleId = await roleFor(TENANT, "salesManager");
    const added = [];
    for (const capabilityKey of ["salesAgreement.accept", "opportunity.createSalesOrder"]) {
      const r = await q(`INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
               SELECT $1, $2, $3, c.id, 'dq021-packet', 'dq021-packet', 'dq021-packet' FROM eos_policy.capabilities c WHERE c.key = $4 RETURNING id`,
        [`rc_dq021_${capabilityKey}`, TENANT, roleId, capabilityKey]);
      added.push(r.rows[0].id);
    }
    try {
      const manager = personas["role:salesManager"];
      const offered = ok(await call(manager, "readMyCommercialCapabilities"), "offer");
      assert.deepEqual([...offered.capabilities].sort(), [...DQ021_SALES_MANAGER_POST_GRANT].sort());
      const o = ok(await call(manager, "createOpportunity", base("acct-retail", "RETAIL")), "create");
      for (const toStage of ["QUALIFYING", "SOLUTION", "QUOTING", "CUSTOMER_REVIEW", "DECISION"]) {
        ok(await call(manager, "transitionOpportunity", { idempotencyKey: key(), opportunityId: o.opportunityId, toStage }), toStage);
      }
      const a = ok(await call(manager, "createSalesAgreement", { idempotencyKey: key(), opportunityId: o.opportunityId, ownerEmployeeId: "e-retail-a", isLease: false, lines: [{ kind: "SERVICE", ref: "s", quantity: 1, unitPrice: 100, businessUnitId: "SERVICE" }] }), "agreement");
      ok(await call(manager, "acceptSalesAgreement", { idempotencyKey: key(), salesAgreementId: a.salesAgreementId }), "accept");
      ok(await call(manager, "closeOpportunityAsWon", { idempotencyKey: key(), opportunityId: o.opportunityId }), "won");
      refused(await call(personas["owner-executive"], "acceptSalesAgreement", { idempotencyKey: key(), salesAgreementId: a.salesAgreementId }), 403, "CAPABILITY_REQUIRED", "owner model unchanged");
    } finally {
      await q(`DELETE FROM eos_policy.role_capabilities WHERE id = ANY($1)`, [added]);
    }
  });

  await t.test("OTHER TENANT: a member of another tenant cannot see or move this tenant's records (404, never disclosed)", async () => {
    const outsider = await signIn("retail-sales-a", "t-other");
    refused(await call(outsider, "getOpportunityDetail", { opportunityId: opp.opportunityId }), 404, "RECORD_NOT_FOUND", "read");
    refused(await call(outsider, "transitionSalesOrder", { idempotencyKey: key(), salesOrderId: order.salesOrderId, transition: "CANCEL" }), 404, "RECORD_NOT_FOUND", "cancel");
    refused(await call(outsider, "createOpportunity", { idempotencyKey: key(), accountId: "acct-retail", salesChannel: "RETAIL", lines: [{ kind: "SERVICE", ref: "s", qty: 1 }] }), 404, "ACCOUNT_NOT_FOUND", "foreign account");
    const list = ok(await call(outsider, "listOpportunities"), "list");
    assert.equal(list.items.length, 0);
  });

  await t.test("OPERATING COMPANY: an unkeyed company refuses 412; an unknown company refuses; nothing is inferred", async () => {
    refused(await call(retailA, "createOpportunity", { idempotencyKey: key(), accountId: "acct-retail", salesChannel: "RETAIL", operatingCompanyId: "ventana", lines: [{ kind: "SERVICE", ref: "s", qty: 1 }] }), 412, "OPERATING_COMPANY_KEY_NOT_BOUND", "ventana");
    const unknown = await call(retailA, "createOpportunity", { idempotencyKey: key(), accountId: "acct-retail", salesChannel: "RETAIL", operatingCompanyId: "acme", lines: [{ kind: "SERVICE", ref: "s", qty: 1 }] });
    assert.equal(unknown.status, 400, JSON.stringify(unknown.body));
  });

  // ════════════════════ ACCOUNTABILITY ELIGIBILITY (COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1) ════════════════════

  await t.test("ELIGIBILITY: ACTIVE and CONTRACTOR may be the explicit accountable person; INACTIVE / ON_LEAVE / TERMINATED refuse, never fall back", async () => {
    const base = { accountId: "acct-retail", salesChannel: "RETAIL", operatingCompanyId: "taylor", lines: [{ kind: "SERVICE", ref: "s", qty: 1 }] };
    const contractor = ok(await call(retailA, "createOpportunity", { idempotencyKey: key(), ...base, accountableEmployeeId: "e-contractor" }), "contractor");
    assert.deepEqual([contractor.accountableEmployeeId, contractor.accountablePersonSource], ["e-contractor", "EXPLICIT"]);
    const before = (await q(`SELECT count(*)::int n FROM eos_commercial.opportunities`)).rows[0].n;
    for (const employee of ["e-inactive", "e-leave", "e-terminated"]) {
      refused(await call(retailA, "createOpportunity", { idempotencyKey: key(), ...base, accountableEmployeeId: employee }), 400, "EXPLICIT_PERSON_NOT_CURRENTLY_ELIGIBLE", employee);
    }
    refused(await call(retailA, "createOpportunity", { idempotencyKey: key(), ...base, accountableEmployeeId: "e-other-tenant" }), 400, "EXPLICIT_PERSON_INVALID", "other tenant");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_commercial.opportunities`)).rows[0].n, before, "a refused person fell back to the owner");
  });

  await t.test("ELIGIBILITY: an Account owned by an INACTIVE Employee cannot derive accountability -- the create refuses rather than invent one", async () => {
    const res = await call(retailA, "createOpportunity", { idempotencyKey: key(), accountId: "acct-inactive-owner", salesChannel: "RETAIL", operatingCompanyId: "taylor", lines: [{ kind: "SERVICE", ref: "s", qty: 1 }] });
    refused(res, 400, "DERIVED_PERSON_NOT_CURRENTLY_ELIGIBLE", "inactive owner");
    // ...and an ACTIVE explicit accountable person makes the same create legitimate (ownership and accountability are separate facts).
    ok(await call(retailA, "createOpportunity", { idempotencyKey: key(), accountId: "acct-inactive-owner", salesChannel: "RETAIL", operatingCompanyId: "taylor", accountableEmployeeId: "e-retail-a", lines: [{ kind: "SERVICE", ref: "s", qty: 1 }] }), "explicit");
  });

  // ════════════════════ OWNERSHIP HANDOFF ════════════════════

  await t.test("HANDOFF: an owner change is a governed handoff with append-only history; a handoff to another tenant's Employee refuses", async () => {
    const o = ok(await call(retailA, "createOpportunity", { idempotencyKey: key(), accountId: "acct-retail", salesChannel: "RETAIL", operatingCompanyId: "taylor", lines: [{ kind: "SERVICE", ref: "s", qty: 1 }] }), "create");
    refused(await call(retailA, "updateOpportunity", { idempotencyKey: key(), opportunityId: o.opportunityId, expectedEditVersion: 1, ownerEmployeeId: "e-other-tenant" }), 404, "OWNER_NOT_FOUND", "foreign owner");
    const moved = ok(await call(retailA, "updateOpportunity", { idempotencyKey: key(), opportunityId: o.opportunityId, expectedEditVersion: 1, ownerEmployeeId: "e-retail-b", ownershipHandoff: { reason: "vacation cover" } }), "handoff");
    assert.ok(moved.ownershipHandoffId);
    const history = (await q(`SELECT previous_owner_employee_id, new_owner_employee_id, source::text, reason, recorded_by FROM eos_commercial.ownership_handoffs WHERE opportunity_id=$1`, [o.opportunityId])).rows;
    assert.deepEqual(history, [{ previous_owner_employee_id: "e-retail-a", new_owner_employee_id: "e-retail-b", source: "DIRECT_HANDOFF", reason: "vacation cover", recorded_by: retailA.principalId }]);
    const row = (await q(`SELECT owner_employee_id, accountable_employee_id FROM eos_commercial.opportunities WHERE id=$1`, [o.opportunityId])).rows[0];
    assert.deepEqual(row, { owner_employee_id: "e-retail-b", accountable_employee_id: "e-retail-a" }, "ownership moved; accountability did not");
  });

  // ════════════════════ DQ-020: COMMERCIAL WRITES FOLLOW THE SALES CHANNEL ════════════════════

  await t.test("DQ-020: a channel-scoped seller writes inside its channel -- and the relationship, not the owner, decides (another RETAIL seller may work the record)", async () => {
    const o = ok(await call(retailA, "createOpportunity", base("acct-retail", "RETAIL")), "create");
    ok(await call(personas["retail-sales-b"], "updateOpportunity", { idempotencyKey: key(), opportunityId: o.opportunityId, expectedEditVersion: 1, nextAction: "b covers" }), "same channel, not the owner");
    ok(await call(personas["national-accounts-sales"], "createOpportunity", base("acct-national", "NATIONAL_ACCOUNTS")), "national in its own channel");
  });

  await t.test("DQ-020: outside its channel a scoped seller is refused on every write -- create, edit, stage, Agreement, Won, Order -- and nothing is written", async () => {
    const national = personas["national-accounts-sales"];
    const o = ok(await call(retailA, "createOpportunity", base("acct-retail", "RETAIL")), "retail create");
    const before = (await q(`SELECT count(*)::int n FROM eos_commercial.command_receipts`)).rows[0].n;
    const outside = (res, what) => refused(res, 403, "OUTSIDE_SALES_CHANNEL_SCOPE", what);
    outside(await call(national, "createOpportunity", base("acct-retail", "RETAIL")), "create RETAIL");
    outside(await call(national, "updateOpportunity", { idempotencyKey: key(), opportunityId: o.opportunityId, expectedEditVersion: 1, nextAction: "x" }), "edit RETAIL");
    outside(await call(national, "transitionOpportunity", { idempotencyKey: key(), opportunityId: o.opportunityId, toStage: "QUALIFYING" }), "stage RETAIL");
    outside(await call(national, "createSalesAgreement", { idempotencyKey: key(), opportunityId: o.opportunityId, ownerEmployeeId: "e-national", isLease: false, lines: [{ kind: "SERVICE", ref: "s", quantity: 1, unitPrice: 100, businessUnitId: "SERVICE" }] }), "agreement on RETAIL");
    outside(await call(national, "closeOpportunityAsWon", { idempotencyKey: key(), opportunityId: o.opportunityId }), "won RETAIL");
    outside(await call(national, "transitionSalesOrder", { idempotencyKey: key(), salesOrderId: order.salesOrderId, transition: "CANCEL" }), "cancel a RETAIL order");
    outside(await call(national, "updateSalesAgreementDraft", { idempotencyKey: key(), salesAgreementId: agreement.salesAgreementId, customerPO: "x" }), "edit a RETAIL agreement");
    // A retail seller cannot push its record out of its reach, nor a national seller pull one in.
    outside(await call(retailA, "updateOpportunity", { idempotencyKey: key(), opportunityId: o.opportunityId, expectedEditVersion: 1, salesChannel: "NATIONAL_ACCOUNTS" }), "move out of channel");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_commercial.command_receipts`)).rows[0].n, before, "a refused write left a receipt");
    const row = (await q(`SELECT sales_channel::text, stage::text, edit_version FROM eos_commercial.opportunities WHERE id=$1`, [o.opportunityId])).rows[0];
    assert.deepEqual(row, { sales_channel: "RETAIL", stage: "IDENTIFIED", edit_version: "1" });
  });

  await t.test("DQ-020: GLOBAL holders (GM, dispatcher, owner) keep every channel; a global `salesperson` assignment is tenant-wide -- the pre-DQ-020 nonprod configuration", async () => {
    const o = ok(await call(retailA, "createOpportunity", base("acct-retail", "RETAIL")), "retail create");
    ok(await call(personas["general-manager"], "transitionOpportunity", { idempotencyKey: key(), opportunityId: o.opportunityId, toStage: "QUALIFYING" }), "GM");
    ok(await call(personas["owner-executive"], "createOpportunity", base("acct-national", "NATIONAL_ACCOUNTS")), "owner");
    // The canonical sales personas hold `salesperson` GLOBALLY in nonprod today. Until Administration re-scopes those
    // assignments to their channels (the ledger's DQ-020 execution packet), that global holding stays tenant-wide:
    const legacyGlobal = await signIn("role:salesperson"); // the same Role, assigned globally
    ok(await call(legacyGlobal, "transitionOpportunity", { idempotencyKey: key(), opportunityId: o.opportunityId, toStage: "SOLUTION" }), "global salesperson (pre-rescoping)");
  });

  await t.test("D-B OPTION A (2026-09-30): a principal holding ONLY Commercial Shared Context reads its context but can sell nothing", async () => {
    // The nonprod Role exactly as Administration configured it: customer.record.read/create/update + inventory.catalog.read.
    const SHARED = ["customer.record.read", "customer.record.create", "customer.record.update", "inventory.catalog.read"];
    const role = await repo.transact(actorFor(TENANT), (tx) => tx.createRole({ key: "commercialSharedContext", name: "Commercial Shared Context", description: null, origin: "CUSTOM", protected: false }));
    for (const capabilityKey of SHARED) {
      const r = await q(`INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
               SELECT $1, $2, $3, c.id, 'admin', 'admin', 'admin' FROM eos_policy.capabilities c WHERE c.key = $4`, [`rc_${role.id}_${capabilityKey}`, TENANT, role.id, capabilityKey]);
      assert.equal(r.rowCount, 1, `${capabilityKey} is registered`);
    }
    const subject = "uid-shared-context-only";
    const principalId = await repo.transact(actorFor(TENANT), async (tx) => {
      const principal = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
      await tx.createTenantMembership(principal.id);
      const accessVersion = await tx.bumpAccessVersion(principal.id);
      await tx.createAssignment({ principalId: principal.id, roleId: role.id, scopeType: "global", scopeValue: null, status: "active", grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion });
      return principal.id;
    });
    TOKENS.set(`tok-${subject}`, subject);
    const sharedOnly = { persona: "shared-context-only", principalId, token: `tok-${subject}`, channel: null };
    const held = ok(await call(sharedOnly, "readMyCommercialCapabilities"), "own capabilities");
    const heldKeys = JSON.stringify(held);
    for (const selling of ["opportunity.write", "opportunity.createSalesOrder", "salesAgreement.create", "salesAgreement.updateDraft", "salesAgreement.accept", "salesOrder.write"]) {
      assert.ok(!heldKeys.includes(`"${selling}"`), `the shared-context Role offers ${selling}`);
    }
    const o = ok(await call(retailA, "createOpportunity", { idempotencyKey: key(), accountId: "acct-retail", salesChannel: "RETAIL", operatingCompanyId: "taylor", lines: [{ kind: "SERVICE", ref: "s", qty: 1 }] }), "a real Opportunity");
    const before = (await q(`SELECT count(*)::int n FROM eos_commercial.command_receipts`)).rows[0].n;
    for (const [operation, input] of [
      ["createOpportunity", { idempotencyKey: key(), accountId: "acct-retail", salesChannel: "RETAIL", operatingCompanyId: "taylor", lines: [{ kind: "SERVICE", ref: "s", qty: 1 }] }],
      ["createOpportunity", { idempotencyKey: key(), accountId: "acct-national", salesChannel: "NATIONAL_ACCOUNTS", operatingCompanyId: "taylor", lines: [{ kind: "SERVICE", ref: "s", qty: 1 }] }],
      ["transitionOpportunity", { idempotencyKey: key(), opportunityId: o.opportunityId, toStage: "QUALIFYING" }],
      ["createSalesAgreement", { idempotencyKey: key(), opportunityId: o.opportunityId, ownerEmployeeId: "e-retail-a", isLease: false, lines: [{ kind: "SERVICE", ref: "s", quantity: 1, unitPrice: 100, businessUnitId: "SERVICE" }] }],
      ["closeOpportunityAsWon", { idempotencyKey: key(), opportunityId: o.opportunityId }],
    ]) {
      const res = await call(sharedOnly, operation, input);
      assert.equal(res.status, 403, `${operation}: ${JSON.stringify(res.body)}`);
    }
    assert.equal((await q(`SELECT count(*)::int n FROM eos_commercial.command_receipts`)).rows[0].n, before, "nothing was written");
  });

  await t.test("FIREBASE: the journey loaded no Firebase module", () => {
    const loaded = Object.keys(require.cache).filter((p) => /[\\/]node_modules[\\/](firebase-admin|firebase-functions|@google-cloud[\\/]firestore)[\\/]/.test(p));
    assert.deepEqual(loaded, []);
  });
});
