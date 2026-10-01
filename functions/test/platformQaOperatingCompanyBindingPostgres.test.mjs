// PLATFORM QA (lane L5) -- OPERATING-COMPANY BINDING, one matrix across every command that STATES a company.
//
// Rulings under measurement:
//   * operating_company_id and operating_company_key are DIFFERENT vocabularies and must never be assumed equal
//     (Reorder Domain Cutover ruling, 2026-09-19; tenant_operating_company_keys binds them). A KEY supplied where an
//     ID is required must be refused, never silently accepted as an id.
//   * Employee lifecycle, option (b) (2026-09-16): the company must hold an ACTIVE eos_policy.tenant_operating_companies
//     row FOR THE ACTOR'S TENANT -- "a code-recognised id is not enough"; unknown, other-tenant-only and INACTIVE fail
//     closed.
//   * Commercial R-14: explicit or inherited, never inferred, no default; an ungoverned id is a caller error.
//
// The matrix asks every company-stating command the SAME four questions and records where the answers diverge.
// Disposable database (platformQaHarness.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SKIP, freshMigratedDatabase, composeTransports, tokenRegistry, makeActor, call } from "./platformQaHarness.mjs";

const key = () => `l5-${randomUUID()}`;

test("operating-company binding matrix", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { pool } = await freshMigratedDatabase(t, "l5opco");
  await pool.query(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);
  // The tenants' sales channels, as Administration setTenantSalesChannelStatus records them: new Commercial work requires an ACTIVE channel.
  for (const tenant of ["t1", "t2"]) for (const channel of ["NATIONAL_ACCOUNTS", "RETAIL", "STRATEGIC_ACCOUNTS"]) {
    await pool.query(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id, sales_channel, status, source, established_by, updated_by) VALUES ($1, $2, 'ACTIVE', 'fixture', 'fixture', 'fixture')`, [tenant, channel]);
  }
  // t1: taylor ACTIVE (bound to key sample-co-synthetic); ventana INACTIVE. t2: ventana ACTIVE only.
  await pool.query(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by) VALUES
    ('t1','taylor','ACTIVE','l5','l5','l5'), ('t2','ventana','ACTIVE','l5','l5','l5')`);
  await pool.query(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
                    VALUES ('t1','taylor','sample-co-synthetic','ACTIVE','NATIVE','l5','l5','l5')`);
  const tokens = tokenRegistry();
  const { repo, transports } = composeTransports(pool, tokens.verifyToken);
  const ctx = { repo, pool, tokens };
  const actor = await makeActor(ctx, "t1", "l5-sub-opco", "ALL");
  await pool.query(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES ('e-opco-owner','t1','ACTIVE','taylor')`);
  const account = (await call(transports.crm, "createAccount", { token: actor.token,
    input: { idempotencyKey: key(), ownerEmployeeId: "e-opco-owner", name: "OpCo Probe", status: "ACTIVE" } })).body.result;
  assert.ok(account?.accountId, "fixture account");

  let n = 0;
  const COMMANDS = {
    "commercial.createOpportunity": (company) => call(transports.commercial, "createOpportunity", { token: actor.token, input: {
      idempotencyKey: key(), accountId: account.accountId, salesChannel: "RETAIL", operatingCompanyId: company, need: "opco probe",
      lines: [{ kind: "SERVICE", ref: "svc-pm", qty: 1 }] } }),
    "commercial.createSalesOrder": (company) => call(transports.commercial, "createSalesOrder", { token: actor.token, input: {
      idempotencyKey: key(), accountId: account.accountId, ownerEmployeeId: "e-opco-owner", operatingCompanyId: company, salesChannel: "RETAIL",
      lines: [{ kind: "SERVICE", ref: "svc-pm", orderedQty: 1, unitPrice: 100, businessUnitId: "SERVICE" }] } }),
    "workforce.createEmployee": (company) => call(transports.workforce, "createEmployee", { token: actor.token, input: {
      employeeId: `e-opco-${++n}`, employmentStatus: "ACTIVE", operatingCompanyId: company, reason: "l5 opco probe" } }),
    "workforce.changeOperatingCompany": async (company) => {
      const id = `e-opco-chg-${++n}`;
      await pool.query(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES ($1,'t1','ACTIVE','taylor')`, [id]);
      // Move away first so the target is a CHANGE, not a NO_CHANGE, for the taylor cell.
      if (company === "taylor") await pool.query(`UPDATE eos_workforce.employees SET operating_company_id='ventana' WHERE id=$1`, [id]);
      return call(transports.workforce, "changeOperatingCompany", { token: actor.token, input: { employeeId: id, operatingCompanyId: company, reason: "l5 opco probe" } });
    },
  };
  const VALUES = {
    "governed id, ACTIVE for this tenant (taylor)": "taylor",
    "governed id, INACTIVE for this tenant (ventana)": "ventana",
    "the KEY bound to taylor (sample-co-synthetic)": "sample-co-synthetic",
    "well-formed, ungoverned (acme)": "acme",
  };
  // ventana INACTIVE for t1: make the row exist so "INACTIVE" is a real state, not "absent".
  await pool.query(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by) VALUES ('t1','ventana','INACTIVE','l5','l5','l5')`);
  // ...and KEYED, so the Commercial answer is decided by the company's INACTIVE status, not by a missing key binding.
  await pool.query(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
                    VALUES ('t1','ventana','ventana-key','ACTIVE','NATIVE','l5','l5','l5')`);

  const grid = {};
  for (const [cmd, run] of Object.entries(COMMANDS)) {
    grid[cmd] = {};
    for (const [label, value] of Object.entries(VALUES)) {
      const r = await run(value);
      grid[cmd][label] = `${r.status} ${r.code}`;
    }
  }
  t.diagnostic(`OPCO GRID ${JSON.stringify(grid, null, 1)}`);

  await t.test("the tenant-ACTIVE governed id is accepted by every company-stating command", () => {
    for (const cmd of Object.keys(COMMANDS)) assert.match(grid[cmd]["governed id, ACTIVE for this tenant (taylor)"], /^200 /, cmd);
  });
  await t.test("a KEY is never accepted where an ID is required, and an ungoverned id is refused -- every command", () => {
    for (const cmd of Object.keys(COMMANDS)) {
      assert.match(grid[cmd]["the KEY bound to taylor (sample-co-synthetic)"], /^4\d\d /, `${cmd} accepted an operating-company KEY as an id`);
      assert.match(grid[cmd]["well-formed, ungoverned (acme)"], /^4\d\d /, `${cmd} accepted an ungoverned company`);
    }
  });
  await t.test("a company INACTIVE for the actor's tenant: measured, per command", () => {
    const inactive = Object.fromEntries(Object.keys(COMMANDS).map((cmd) => [cmd, grid[cmd]["governed id, INACTIVE for this tenant (ventana)"]]));
    // Workforce: ruled (option b); Commercial: ruled DQ-008. Both refuse; pinned as measured.
    assert.deepEqual(inactive, EXPECTED_INACTIVE);
  });
});

// Re-measured on main e2dac914 (PR #2000). L5-F07 is CLOSED by Controller DQ-008: a NEW Opportunity / Sales Order
// against a company INACTIVE for the tenant is refused (412), history untouched. Commercial resolves the company through
// its ACTIVE key binding, so the refusal is named OPERATING_COMPANY_KEY_NOT_BOUND even when a key row exists for the
// inactive company (the binding read admits only ACTIVE companies) -- fail-closed and correct; the code name is
// imprecise (L5 KNOWN_LIMITATION P4). Workforce names the same fact OPERATING_COMPANY_INACTIVE.
const EXPECTED_INACTIVE = {
  // INTEGRATION RE-MEASURE (L1+L2+L5, 2026-09-29): lane L1's DQ-008 implementation (157b4e13) checks the company's
  // tenant status BEFORE the key binding, so Commercial now names the fact OPERATING_COMPANY_INACTIVE, like Workforce
  // (L5 KNOWN_LIMITATION P4 resolved). Still 412, still fail-closed.
  "commercial.createOpportunity": "412 OPERATING_COMPANY_INACTIVE",
  "commercial.createSalesOrder": "412 OPERATING_COMPANY_INACTIVE",
  "workforce.createEmployee": "412 OPERATING_COMPANY_INACTIVE",
  "workforce.changeOperatingCompany": "412 OPERATING_COMPANY_INACTIVE",
};
