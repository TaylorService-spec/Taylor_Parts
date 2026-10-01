// PLATFORM QA (lane L5) -- THE CROSS-TRANSPORT CONTRACT, measured over one real PostgreSQL.
//
// The five EOS transports (Administration, Operations, Commercial, CRM, Workforce) were written as siblings and each
// states "same posture as the sibling transports". This file holds them to it, as a MATRIX rather than per-transport
// anecdotes, because the defects it exists to catch only show up when two transports are compared:
//
//   AUTH SHAPE      the same identity/tenancy refusal must produce the same HTTP status on every transport, and a
//                   governed refusal is never a 500.
//   NO ORACLE       a caller WITHOUT authority (no capability, or authority only in ANOTHER tenant) must receive the
//                   identical answer for a record id that exists and one that does not -- otherwise the refusal
//                   itself discloses which records exist ("CAPABILITY FIRST, ALWAYS", contextualAuthorization.ts).
//   NO FOOTPRINT    a refused call writes nothing: no audit row, no receipt, no history row.
//   NO VACUITY      every "real" id is proven real by an authorized control read that returns 200.
//
// Everything is written to a disposable database (platformQaHarness.mjs). Nothing shared is mutated.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  SKIP, freshMigratedDatabase, composeTransports, tokenRegistry, makeActor, call, callNode, auditFootprint,
} from "./platformQaHarness.mjs";
import { bindOperatingCompany } from "./support/governedOperatingCompanyBinding.mjs";

const FAKE = "l5-does-not-exist-0001";
const key = () => `l5-${randomUUID()}`;

test("cross-transport contract matrix", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { pool } = await freshMigratedDatabase(t, "l5contract");
  await pool.query(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);
  // The tenants' sales channels, as Administration setTenantSalesChannelStatus records them: new Commercial work requires an ACTIVE channel.
  for (const tenant of ["t1", "t2"]) for (const channel of ["NATIONAL_ACCOUNTS", "RETAIL", "STRATEGIC_ACCOUNTS"]) {
    await pool.query(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id, sales_channel, status, source, established_by, updated_by) VALUES ($1, $2, 'ACTIVE', 'fixture', 'fixture', 'fixture')`, [tenant, channel]);
  }
  // Commercial creates need an ACTIVE tenant company AND its key binding (DQ-008, main e2dac914).
  await bindOperatingCompany((text, values) => pool.query(text, values), 't1', 'taylor');
  const tokens = tokenRegistry();
  const { repo, transports } = composeTransports(pool, tokens.verifyToken);
  const ctx = { repo, pool, tokens };

  const owner1 = await makeActor(ctx, "t1", "l5-sub-all-t1", "ALL");
  const none1 = await makeActor(ctx, "t1", "l5-sub-none-t1", []);
  const foreign2 = await makeActor(ctx, "t2", "l5-sub-all-t2", "ALL");
  // A Principal with memberships in BOTH tenants and no stated tenant: ambiguous, must refuse.
  const both = await makeActor(ctx, "t1", "l5-sub-both", []);
  await pool.query(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ($1,'t2',$2)`, [`tm-l5-${randomUUID()}`, both.principalId]);
  // A DISABLED Principal that still holds every capability.
  const disabled = await makeActor(ctx, "t1", "l5-sub-disabled", "ALL");
  await pool.query(`UPDATE eos_policy.principals SET status='disabled' WHERE id=$1`, [disabled.principalId]);
  // A verified subject with no EOS Principal at all.
  tokens.register("tok-l5-orphan", "l5-sub-orphan");

  // ── t1 business records, created through the product transports by the authorized t1 actor ──
  await pool.query(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES
    ('e-l5-1','t1','ACTIVE','taylor'), ('e-l5-2','t1','ACTIVE','taylor'), ('e-l5-t2','t2','ACTIVE','taylor')`);
  const must = async (transport, op, input) => {
    const r = await call(transports[transport], op, { token: owner1.token, input });
    assert.equal(r.status, 200, `fixture ${transport}.${op}: ${JSON.stringify(r.body)}`);
    return r.body.result ?? r.body.data;
  };
  const account = await must("crm", "createAccount", { idempotencyKey: key(), ownerEmployeeId: "e-l5-1", name: "L5 Retail", status: "ACTIVE" });
  const contact = await must("crm", "createContact", { idempotencyKey: key(), accountId: account.accountId, name: "Ana" });
  const site = await must("crm", "createAccountLocation", { idempotencyKey: key(), accountId: account.accountId, name: "Main" });
  const opp = await must("commercial", "createOpportunity", { idempotencyKey: key(), accountId: account.accountId, salesChannel: "RETAIL",
    operatingCompanyId: "taylor", need: "L5 service", lines: [{ kind: "SERVICE", ref: "svc-pm", qty: 1 }] });
  const agreement = await must("commercial", "createSalesAgreement", { idempotencyKey: key(), opportunityId: opp.opportunityId, ownerEmployeeId: "e-l5-1",
    lines: [{ kind: "SERVICE", ref: "svc-pm", quantity: 1, unitPrice: 1000, businessUnitId: "SERVICE" }] });
  const order = await must("commercial", "createSalesOrder", { idempotencyKey: key(), accountId: account.accountId, ownerEmployeeId: "e-l5-1",
    operatingCompanyId: "taylor", salesChannel: "RETAIL", lines: [{ kind: "SERVICE", ref: "svc-pm", orderedQty: 1, unitPrice: 1000, businessUnitId: "SERVICE" }] });
  const roleRow = (await pool.query(`SELECT r.id, r.key FROM eos_policy.roles r WHERE r.tenant_id='t1' AND r.key=$1`, [`l5-role-${owner1.subject}`])).rows[0];
  const assignmentId = (await pool.query(`SELECT id FROM eos_policy.user_role_assignments WHERE tenant_id='t1' AND principal_id=$1`, [owner1.principalId])).rows[0].id;

  // ── the id-bearing operations: [transport, operation, input(id), isRead] ──
  const ID_CASES = [
    ["crm", "getAccount", (id) => ({ accountId: id }), account.accountId, true],
    ["crm", "listAccountOwnershipHistory", (id) => ({ accountId: id }), account.accountId, true],
    ["crm", "listAccountContacts", (id) => ({ accountId: id }), account.accountId, true],
    ["crm", "listAccountLocations", (id) => ({ accountId: id }), account.accountId, true],
    ["crm", "getContact", (id) => ({ contactId: id }), contact.contactId, true],
    ["crm", "getAccountLocation", (id) => ({ accountLocationId: id }), site.accountLocationId, true],
    ["crm", "updateAccount", (id) => ({ accountId: id, notes: "l5" }), account.accountId, false],
    ["crm", "updateContact", (id) => ({ contactId: id, phone: "555-0199" }), contact.contactId, false],
    ["crm", "updateAccountLocation", (id) => ({ accountLocationId: id, accessNotes: "l5" }), site.accountLocationId, false],
    ["crm", "createContact", (id) => ({ idempotencyKey: key(), accountId: id, name: "Probe" }), account.accountId, false],
    ["commercial", "getOpportunityDetail", (id) => ({ opportunityId: id }), opp.opportunityId, true],
    ["commercial", "getSalesAgreementDetail", (id) => ({ salesAgreementId: id }), agreement.salesAgreementId, true],
    ["commercial", "getSalesOrderDetail", (id) => ({ salesOrderId: id }), order.salesOrderId, true],
    ["commercial", "getAccountCommercialProjection", (id) => ({ accountId: id }), account.accountId, true],
    ["commercial", "acceptSalesAgreement", (id) => ({ idempotencyKey: key(), salesAgreementId: id }), agreement.salesAgreementId, false],
    ["commercial", "createSalesOrderFromOpportunity", (id) => ({ idempotencyKey: key(), opportunityId: id }), opp.opportunityId, false],
    ["workforce", "readEmployee", (id) => ({ employeeId: id }), "e-l5-2", true],
    ["workforce", "readEmployeePrincipalLink", (id) => ({ employeeId: id }), "e-l5-2", true],
    ["workforce", "listManagedEmployees", (id) => ({ managerEmployeeId: id }), "e-l5-2", true],
    ["workforce", "listRecordsOwnedByEmployee", (id) => ({ employeeId: id, family: "ACCOUNT" }), "e-l5-1", true],
    ["workforce", "listAccountabilitiesForEmployee", (id) => ({ employeeId: id, family: "OPPORTUNITY" }), "e-l5-1", true],
    ["workforce", "listEmployeeJobRoleHistory", (id) => ({ employeeId: id }), "e-l5-2", true],
    ["workforce", "listEmployeeChangeHistory", (id) => ({ employeeId: id }), "e-l5-2", true],
    ["workforce", "listEmployeeWorkEligibility", (id) => ({ employeeId: id }), "e-l5-2", true],
    ["workforce", "listEmployeeOperationalScopes", (id) => ({ employeeId: id }), "e-l5-2", true],
    ["workforce", "listEmployeeFunctionalRoles", (id) => ({ employeeId: id }), "e-l5-2", true],
    ["workforce", "changeEmploymentStatus", (id) => ({ employeeId: id, employmentStatus: "ON_LEAVE", reason: "l5 probe" }), "e-l5-2", false],
    ["workforce", "assignEmployeeWorkEligibility", (id) => ({ employeeId: id, qualificationCode: "SERVICE_TECHNICIAN", reason: "l5 probe" }), "e-l5-2", false],
    ["administration", "readRolePolicy", (id) => ({ roleId: id }), roleRow.id, true],
    ["administration", "getRoleSecurity", (id) => ({ roleKey: id }), roleRow.key, true],
    ["administration", "getSecurityRoleDetail", (id) => ({ roleKey: id }), roleRow.key, true],
    ["administration", "listPrincipalRoleAssignments", (id) => ({ principalId: id }), none1.principalId, true],
    ["administration", "getPrincipalEffectiveAccess", (id) => ({ principalId: id }), none1.principalId, true],
    ["administration", "explainEffectiveAccess", (id) => ({ principalId: id }), none1.principalId, true],
    ["administration", "listPrincipalWorkflowResponsibilities", (id) => ({ principalId: id }), none1.principalId, true],
    ["administration", "revokeRole", (id) => ({ assignmentId: id, reason: "l5 probe" }), assignmentId, false],
    ["administration", "assignRole", (id) => ({ principalId: id, roleId: roleRow.id, reason: "l5 probe" }), none1.principalId, false],
  ];

  const findings = [];
  const oracleTable = [];
  const record = (kind, detail) => findings.push({ kind, ...detail });

  await t.test("NO VACUITY: every real id is readable by the authorized actor of its own tenant", async () => {
    const vacuous = [];
    for (const [tr, op, input, realId, isRead] of ID_CASES) {
      if (!isRead) continue;
      const r = await call(transports[tr], op, { token: owner1.token, input: input(realId) });
      if (r.status !== 200) vacuous.push(`${tr}.${op}: ${JSON.stringify(r.body).slice(0, 220)}`);
    }
    assert.deepEqual(vacuous, [], "a control read did not return 200, so its oracle cell would prove nothing");
  });

  await t.test("AUDIT ATTRIBUTION: the governed writes above are recorded against the EOS Principal, never the identity-provider subject", async () => {
    const { rows: cols } = await pool.query(
      `SELECT table_schema || '.' || table_name AS rel, column_name FROM information_schema.columns
        WHERE table_schema IN ('eos_policy','eos_ops','eos_commercial','eos_crm','eos_workforce')
          AND table_name ~ '(audit|receipt|history)' AND data_type IN ('text','jsonb','character varying')`);
    const leaks = [];
    let principalMentions = 0;
    for (const { rel, column_name: col } of cols) {
      const leak = (await pool.query(`SELECT count(*)::int n FROM ${rel} WHERE ${col}::text LIKE '%l5-sub-%'`)).rows[0].n;
      if (leak > 0) leaks.push(`${rel}.${col}: ${leak}`);
      principalMentions += (await pool.query(`SELECT count(*)::int n FROM ${rel} WHERE ${col}::text LIKE $1`, [`%${owner1.principalId}%`])).rows[0].n;
    }
    assert.deepEqual(leaks, [], "an audit/receipt/history row carries the identity-provider subject");
    // Six governed creates (3 CRM, 3 Commercial) ran as owner1: each must be attributable to the EOS Principal.
    assert.ok(principalMentions >= 6, `only ${principalMentions} audit/receipt/history cells name the acting EOS Principal`);
  });

  const before = await auditFootprint(pool);

  await t.test("NO ORACLE: an unauthorized caller gets the SAME answer for a real id and a missing id", async () => {
    for (const [label, actor] of [["no-capability(t1)", none1], ["other-tenant(t2, every capability)", foreign2]]) {
      for (const [tr, op, input, realId] of ID_CASES) {
        const real = await call(transports[tr], op, { token: actor.token, input: input(realId) });
        const fake = await call(transports[tr], op, { token: actor.token, input: input(FAKE) });
        const cell = { actor: label, transport: tr, operation: op, real: `${real.status} ${real.code}`, fake: `${fake.status} ${fake.code}` };
        oracleTable.push(`${label.padEnd(36)} ${`${tr}.${op}`.padEnd(58)} real=${cell.real.padEnd(34)} fake=${cell.fake}`);
        if (real.status >= 500 || fake.status >= 500) record("GOVERNED_REFUSAL_IS_500", cell);
        if (real.status >= 200 && real.status < 300) record("UNAUTHORIZED_SUCCESS", { ...cell, body: JSON.stringify(real.body).slice(0, 200) });
        if (real.status !== fake.status || real.code !== fake.code) record("EXISTENCE_ORACLE", cell);
      }
    }
  });

  t.diagnostic(`ORACLE TABLE\n${oracleTable.join("\n")}`);

  await t.test("NO FOOTPRINT: none of those refusals wrote an audit, receipt or history row", async () => {
    const after = await auditFootprint(pool);
    const moved = Object.keys(after).filter((rel) => after[rel] !== before[rel]).map((rel) => `${rel} ${before[rel]}->${after[rel]}`);
    if (moved.length > 0) record("REFUSAL_FOOTPRINT", { moved });
  });

  await t.test("AUTH SHAPE: one identity/tenancy refusal, one status, on every transport; never a 500", async () => {
    const probe = { administration: "listRoles", operations: "resolveMyCapabilities", commercial: "listOpportunities", crm: "listAccounts", catalog: "countParts", workforce: "listEmployees" };
    const CELLS = {
      "no bearer": (tr, op) => call(tr, op, { input: {} }),
      "unverifiable token": (tr, op) => call(tr, op, { token: "tok-garbage", input: {} }),
      "verified subject, no EOS Principal": (tr, op) => call(tr, op, { token: "tok-l5-orphan", input: {} }),
      "disabled Principal holding every capability": (tr, op) => call(tr, op, { token: disabled.token, input: {} }),
      "stated tenant the Principal is not a member of": (tr, op) => call(tr, op, { token: owner1.token, tenant: "t2", input: {} }),
      "stated tenant that does not exist": (tr, op) => call(tr, op, { token: owner1.token, tenant: "t-nope", input: {} }),
      "two memberships, no stated tenant": (tr, op) => call(tr, op, { token: both.token, input: {} }),
      "authority field in the body": (tr, op) => call(tr, op, { token: owner1.token, input: { tenantId: "t2" } }),
      "malformed JSON": (tr, op) => call(tr, op, { token: owner1.token, rawBody: "{not json" }),
      "GET": (tr, op) => call(tr, op, { token: owner1.token, method: "GET", input: {} }),
      "unknown operation": (tr) => call(tr, "l5NoSuchOperation", { token: owner1.token, input: {}, route: tr.route("x") }),
      "authorized control": (tr, op) => call(tr, op, { token: owner1.token, input: {} }),
    };
    const grid = {};
    for (const [cell, fn] of Object.entries(CELLS)) {
      grid[cell] = {};
      for (const [name, tr] of Object.entries(transports)) {
        const r = await fn(tr, probe[name]);
        grid[cell][name] = `${r.status} ${r.code ?? ""}`.trim();
        if (r.status >= 500) record("GOVERNED_REFUSAL_IS_500", { cell, transport: name, got: grid[cell][name] });
      }
      const statuses = new Set(Object.values(grid[cell]).map((v) => v.split(" ")[0]));
      if (statuses.size > 1) record("STATUS_DIVERGENCE", { cell, grid: grid[cell] });
    }
    t.diagnostic(`AUTH SHAPE GRID ${JSON.stringify(grid, null, 1)}`);
  });

  await t.test("MATRIX RESULT", () => {
    t.diagnostic(`FINDINGS ${JSON.stringify(findings, null, 1)}`);
    // Pinned: the divergences that are RECORDED (L5 ledger XLF / DQ) are listed explicitly so a new one fails here and
    // a fixed one fails here too -- neither can happen unobserved.
    const summary = findings.map((f) => `${f.kind}|${f.transport ?? ""}|${f.operation ?? f.cell ?? ""}|${f.actor ?? ""}`).sort();
    t.diagnostic(`SUMMARY ${JSON.stringify(summary, null, 1)}`);
    assert.deepEqual(summary.filter((s) => !EXPECTED_FINDINGS.includes(s))
      .filter((s) => s.startsWith("UNAUTHORIZED_SUCCESS") || s.startsWith("GOVERNED_REFUSAL_IS_500") || s.startsWith("REFUSAL_FOOTPRINT") || s.startsWith("EXISTENCE_ORACLE")), [],
      "an unauthorized caller succeeded, a governed refusal was a 500, a refusal wrote a row, or a refusal disclosed existence");
    assert.deepEqual(summary, EXPECTED_FINDINGS);
  });
});

// Measured 2026-09-28 at main 1d0745c6 and classified in the L5 ledger. Every entry here is a KNOWN, RECORDED divergence;
// none of them discloses a record (the ORACLE TABLE shows real == fake for every cell).
const EXPECTED_FINDINGS = [
  // L5-F03 (P4): Administration + Operations silently IGNORE an authority-bearing body field; Commercial/CRM/Workforce
  // refuse it 400 AUTHORITY_FIELD_NOT_ACCEPTED. Neither reads it, so no widening -- a posture difference only.
  "STATUS_DIVERGENCE||authority field in the body|",
  // (XLF-L5-01 FIXED 2026-09-28, Controller XLF-003: a verified subject with no EOS Principal is 403 on all five.)
  // L5-F04 (P4): listPrincipalRoleAssignments answers 200 {assignments: []} for a Principal id outside the caller's
  // tenant (and for a nonexistent one) where every sibling principal read answers 404. Same answer for real and fake:
  // no disclosure, only an inconsistent NOT_FOUND contract.
  "UNAUTHORIZED_SUCCESS|administration|listPrincipalRoleAssignments|other-tenant(t2, every capability)",
];

test("an UNREACHABLE policy database: every transport answers the same, and never as a refusal or an empty success", { skip: SKIP, concurrency: 1 }, async (t) => {
  // Port 9 on loopback: nothing listens, every query rejects with a connection error -- the shape of a Render
  // PostgreSQL outage as the process sees it.
  const broken = new pg.Pool({ connectionString: "postgres://eos@127.0.0.1:9/nowhere", max: 1, connectionTimeoutMillis: 2000 });
  t.after(() => broken.end());
  const tokens = tokenRegistry();
  tokens.register("tok-l5-outage", "l5-sub-outage");
  const ORIGIN = "https://app.l5.invalid";
  const { transports } = composeTransports(broken, tokens.verifyToken, { allowedOrigins: [ORIGIN] });
  const probe = { administration: "listRoles", operations: "resolveMyCapabilities", commercial: "listOpportunities", crm: "listAccounts", catalog: "countParts", workforce: "listEmployees" };
  const grid = {};
  for (const [name, tr] of Object.entries(transports)) {
    const r = await callNode(tr, probe[name], { token: "tok-l5-outage", input: {}, origin: ORIGIN });
    // A response WITHOUT the CORS header is unreadable to the browser: the client sees a network failure, not a 5xx.
    grid[name] = `${r.status} ${r.code ?? ""} cors=${r.cors ? "yes" : "NO"}`;
  }
  t.diagnostic(`OUTAGE GRID ${JSON.stringify(grid)}`);
  for (const [name, got] of Object.entries(grid)) {
    const status = Number(got.split(" ")[0]);
    assert.ok(status >= 500, `${name}: an outage answered ${got} -- a client would read it as a refusal or a result`);
  }
  // PINNED: all five answer 500 INTERNAL today. The governed vocabulary has UNAVAILABLE (503) and the client
  // categories distinguish it; see L5-F05 in the ledger. A change to 503 on every transport moves this pin.
  assert.deepEqual(grid, EXPECTED_OUTAGE_GRID);
});

// XLF-L5-02 FIXED 2026-09-28 (Controller XLF-004): Administration used to throw past its pure handler, so the node
// adapter's last-resort 500 carried no CORS header (a browser read it as a network failure). It now answers a readable
// 500 INTERNAL with CORS like the four siblings. None answers 503 (KNOWN_LIMITATION, uniform).
const EXPECTED_OUTAGE_GRID = {
  administration: "500 INTERNAL cors=yes",
  operations: "500 INTERNAL cors=yes",
  commercial: "500 INTERNAL cors=yes",
  crm: "500 INTERNAL cors=yes",
  catalog: "500 INTERNAL cors=yes",
  workforce: "500 INTERNAL cors=yes",
};
