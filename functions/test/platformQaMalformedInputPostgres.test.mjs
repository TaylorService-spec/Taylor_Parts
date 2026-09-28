// PLATFORM QA (lane L5) -- MALFORMED INPUT NEVER BECOMES A 500, on any governed EOS operation.
//
// A governed refusal is a 4xx with a governed code; a 500 INTERNAL means an input reached a place that was not written
// to receive it (a driver type error, a JSON cast, a constraint the translator does not name). This matrix takes a
// VALID input for each operation below, then replaces ONE field at a time with each hostile value, as a caller holding
// every capability (so the capability gate is passed and the input reaches the kernel). Every answer must be < 500.
// Disposable database (platformQaHarness.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SKIP, freshMigratedDatabase, composeTransports, tokenRegistry, makeActor, call } from "./platformQaHarness.mjs";

const key = () => `l5-${randomUUID()}`;
const HOSTILE = {
  null: null,
  number: 12345,
  negative: -1,
  float: 1.5,
  boolean: true,
  array: ["x"],
  object: { nested: "x" },
  empty: "",
  whitespace: "   ",
  huge: "x".repeat(20000),
  sql: "' OR 1=1 --",
  path: "../../etc/passwd",
  nul: "a\u0000b",
  unicode: "‮😀",
};

test("malformed input matrix", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { pool } = await freshMigratedDatabase(t, "l5fuzz");
  await pool.query(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1')`);
  await pool.query(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
                    VALUES ('t1','taylor','ACTIVE','l5','l5','l5')`);
  const tokens = tokenRegistry();
  const { repo, transports } = composeTransports(pool, tokens.verifyToken);
  const ctx = { repo, pool, tokens };
  const actor = await makeActor(ctx, "t1", "l5-sub-fuzz", "ALL");
  await pool.query(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES
    ('e-fz-1','t1','ACTIVE','taylor'), ('e-fz-2','t1','ACTIVE','taylor')`);
  const ok = async (tr, op, input) => {
    const r = await call(transports[tr], op, { token: actor.token, input });
    assert.ok(r.status < 300, `fixture ${tr}.${op}: ${JSON.stringify(r.body)}`);
    return r.body.result ?? r.body.data;
  };
  const account = await ok("crm", "createAccount", { idempotencyKey: key(), ownerEmployeeId: "e-fz-1", name: "Fuzz Co", status: "ACTIVE" });
  const contact = await ok("crm", "createContact", { idempotencyKey: key(), accountId: account.accountId, name: "Ana" });
  const site = await ok("crm", "createAccountLocation", { idempotencyKey: key(), accountId: account.accountId, name: "Main" });
  const opp = await ok("commercial", "createOpportunity", { idempotencyKey: key(), accountId: account.accountId, salesChannel: "RETAIL",
    operatingCompanyId: "taylor", need: "fuzz", lines: [{ kind: "SERVICE", ref: "svc-pm", qty: 1 }] });
  const other = await makeActor(ctx, "t1", "l5-sub-fuzz-other", []);

  // [transport, operation, () => a VALID input]. A fresh idempotency key per call so a replay never masks the kernel.
  const CASES = [
    ["crm", "createAccount", () => ({ idempotencyKey: key(), ownerEmployeeId: "e-fz-1", name: "Fuzz", status: "ACTIVE", tags: ["a"] })],
    ["crm", "updateAccount", () => ({ accountId: account.accountId, notes: "n" })],
    ["crm", "createContact", () => ({ idempotencyKey: key(), accountId: account.accountId, name: "B" })],
    ["crm", "updateContact", () => ({ contactId: contact.contactId, phone: "555" })],
    ["crm", "updateAccountLocation", () => ({ accountLocationId: site.accountLocationId, accessNotes: "d" })],
    ["crm", "listAccounts", () => ({ nameStartsWith: "f", limit: 10 })],
    ["crm", "importAccountContacts", () => ({ idempotencyKey: key(), accountId: account.accountId, contacts: [{ name: "C" }] })],
    ["commercial", "createOpportunity", () => ({ idempotencyKey: key(), accountId: account.accountId, salesChannel: "RETAIL",
      operatingCompanyId: "taylor", need: "n", lines: [{ kind: "SERVICE", ref: "svc-pm", qty: 1 }] })],
    ["commercial", "updateOpportunity", () => ({ idempotencyKey: key(), opportunityId: opp.opportunityId, expectedEditVersion: 1, need: "m" })],
    ["commercial", "createSalesOrder", () => ({ idempotencyKey: key(), accountId: account.accountId, ownerEmployeeId: "e-fz-1", operatingCompanyId: "taylor",
      salesChannel: "RETAIL", lines: [{ kind: "SERVICE", ref: "svc-pm", orderedQty: 1, unitPrice: 100, businessUnitId: "SERVICE" }] })],
    ["commercial", "listOpportunities", () => ({ limit: 10 })],
    ["commercial", "getOpportunityDetail", () => ({ opportunityId: opp.opportunityId })],
    ["workforce", "readEmployee", () => ({ employeeId: "e-fz-1" })],
    ["workforce", "listEmployees", () => ({ limit: 10 })],
    ["workforce", "changeEmploymentStatus", () => ({ employeeId: "e-fz-2", employmentStatus: "ON_LEAVE", reason: "r" })],
    ["workforce", "assignEmployeeWorkEligibility", () => ({ employeeId: "e-fz-2", qualificationCode: "SERVICE_TECHNICIAN", reason: "r" })],
    ["workforce", "createEmployee", () => ({ employeeId: `e-fz-${randomUUID().slice(0, 8)}`, employmentStatus: "ACTIVE", operatingCompanyId: "taylor", reason: "r" })],
    ["workforce", "updateEmployeeProfile", () => ({ employeeId: "e-fz-1", profile: { displayName: "D" } })],
    ["administration", "createRole", () => ({ key: `l5_fz_${randomUUID().slice(0, 6)}`, name: "F", reason: "r" })],
    ["administration", "assignRole", () => ({ principalId: other.principalId, roleId: "nope", reason: "r" })],
    ["administration", "listPrincipalRoleAssignments", () => ({ principalId: other.principalId })],
    ["administration", "readPolicyAuditHistory", () => ({ limit: 5 })],
    ["administration", "explainEffectiveAccess", () => ({ principalId: other.principalId })],
  ];

  const fiveHundreds = [];
  let cells = 0;
  for (const [tr, op, valid] of CASES) {
    for (const field of Object.keys(valid())) {
      if (field === "idempotencyKey") continue;
      for (const [label, value] of Object.entries(HOSTILE)) {
        const input = { ...valid(), [field]: value };
        const r = await call(transports[tr], op, { token: actor.token, input });
        cells += 1;
        if (r.status >= 500) fiveHundreds.push(`${tr}.${op} ${field}=${label}: ${r.status} ${r.code}`);
      }
    }
  }
  // Every recorded 5xx must be the NUL root cause -- a 5xx from any other hostile value is a NEW defect.
  assert.deepEqual(fiveHundreds.filter((f) => !/=nul: /.test(f)), [], "a hostile value other than U+0000 produced a 5xx");
  t.diagnostic(`MALFORMED CELLS ${cells}; 5xx ${fiveHundreds.length}\n${fiveHundreds.join("\n")}`);
  assert.deepEqual(fiveHundreds, EXPECTED_5XX);
});

// Measured 2026-09-28 at main 1d0745c6: 756 cells, 20 answer 5xx, and EVERY ONE is the same root cause -- a NUL
// character (U+0000) in a string field reaches PostgreSQL, which refuses it (SQLSTATE 22021 "invalid byte sequence for
// encoding UTF8: 0x00"), and no transport or kernel translator names 22021, so it surfaces as 500 *_FAILED / INTERNAL --
// and once (Commercial ownerEmployeeId) as 503 EMPLOYEE_AUTHORITY_UNAVAILABLE, which a client reads as an OUTAGE.
// L5 ledger XLF-L5-05 (P3): the fix is one input rule at each transport envelope (refuse U+0000 as INVALID_INPUT) or
// 22021 -> INVALID_INPUT in each translator; the files are frozen/other-lane, so it is recorded, not fixed here.
// Every other hostile value (null, numbers, booleans, arrays, objects, empty, whitespace, 20 000 chars, SQL, path,
// bidi/emoji) is a governed 4xx or an honest 2xx on all 23 operations.
const EXPECTED_5XX = [
  "crm.createAccount name=nul: 500 CRM_COMMAND_FAILED",
  "crm.updateAccount notes=nul: 500 CRM_COMMAND_FAILED",
  "crm.createContact name=nul: 500 CRM_COMMAND_FAILED",
  "crm.updateContact phone=nul: 500 CRM_COMMAND_FAILED",
  "crm.updateAccountLocation accessNotes=nul: 500 CRM_COMMAND_FAILED",
  "crm.listAccounts nameStartsWith=nul: 500 CRM_READ_FAILED",
  "commercial.createOpportunity accountId=nul: 500 COMMAND_FAILED",
  "commercial.createOpportunity need=nul: 500 COMMAND_FAILED",
  "commercial.updateOpportunity opportunityId=nul: 500 COMMAND_FAILED",
  "commercial.updateOpportunity need=nul: 500 COMMAND_FAILED",
  "commercial.createSalesOrder accountId=nul: 500 COMMAND_FAILED",
  "commercial.createSalesOrder ownerEmployeeId=nul: 503 EMPLOYEE_AUTHORITY_UNAVAILABLE",
  "commercial.getOpportunityDetail opportunityId=nul: 500 READ_FAILED",
  "workforce.readEmployee employeeId=nul: 500 READ_FAILED",
  "workforce.changeEmploymentStatus employeeId=nul: 500 COMMAND_FAILED",
  "workforce.assignEmployeeWorkEligibility employeeId=nul: 500 COMMAND_FAILED",
  "administration.createRole name=nul: 500 INTERNAL",
  "administration.createRole reason=nul: 500 INTERNAL",
  "administration.listPrincipalRoleAssignments principalId=nul: 500 INTERNAL",
  "administration.explainEffectiveAccess principalId=nul: 500 INTERNAL",
];
