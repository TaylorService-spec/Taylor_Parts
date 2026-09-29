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
import { bindOperatingCompany } from "./support/governedOperatingCompanyBinding.mjs";

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
  await bindOperatingCompany((text, values) => pool.query(text, values), 't1', 'taylor'); // company ACTIVE + key bound (DQ-008)
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
    ["catalog", "searchParts", () => ({ query: "valve", limit: 10 })],
    ["catalog", "lookupScannedPart", () => ({ rawValue: "0123456789" })],
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
  // And the NUL cells are the governed refusal specifically, not merely "some 4xx".
  for (const [tr, op, valid] of CASES) {
    const field = Object.keys(valid()).find((f) => f !== "idempotencyKey");
    const r = await call(transports[tr], op, { token: actor.token, input: { ...valid(), [field]: HOSTILE.nul } });
    assert.deepEqual([r.status, r.code], [400, "INVALID_INPUT"], `${tr}.${op} ${field}=nul`);
  }
  t.diagnostic(`MALFORMED CELLS ${cells}; 5xx ${fiveHundreds.length}\n${fiveHundreds.join("\n")}`);
  assert.deepEqual(fiveHundreds, EXPECTED_5XX);
});

// XLF-L5-05 FIXED 2026-09-28 (Controller XLF-002). At main 1d0745c6, 20 of these 756 cells answered 5xx -- every one
// a U+0000 reaching PostgreSQL (SQLSTATE 22021) unnamed by any translator (500 *_FAILED / INTERNAL, and once 503
// EMPLOYEE_AUTHORITY_UNAVAILABLE). Every transport now refuses U+0000 at the envelope (adminPolicy/requestText.ts)
// with 400 INVALID_INPUT before identity or any query. Zero 5xx is the governed answer.
const EXPECTED_5XX = [];
