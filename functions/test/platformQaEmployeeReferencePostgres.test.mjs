// PLATFORM QA (lane L5) -- EMPLOYEE REFERENCES: one matrix over every command that names an Employee as a party.
//
// Rulings under measurement:
//   * An Employee reference is tenant-scoped: another tenant's Employee, or an id that does not exist, is NOT an
//     Employee of this tenant and must be refused -- never stored as a dangling or cross-tenant reference.
//   * COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1 (Owner 2026-09-14), scope Opportunity / Sales Agreement / Sales Order:
//     ACTIVE and CONTRACTOR are eligible for NEW accountability; ON_LEAVE / INACTIVE / TERMINATED / RETIRED are valid
//     references but NOT eligible. Lifecycle and eligibility stay separate facts.
//   * Work assignment requires an ACTIVE Employee (workOrderAssignmentAuthority / reorderAssignmentAuthority).
// Disposable database (platformQaHarness.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SKIP, freshMigratedDatabase, composeTransports, tokenRegistry, makeActor, call } from "./platformQaHarness.mjs";
import { bindOperatingCompany } from "./support/governedOperatingCompanyBinding.mjs";

const key = () => `l5-${randomUUID()}`;

test("employee reference matrix", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { pool } = await freshMigratedDatabase(t, "l5empref");
  await pool.query(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);
  await bindOperatingCompany((text, values) => pool.query(text, values), 't1', 'taylor'); // ACTIVE + key bound (DQ-008)
  const tokens = tokenRegistry();
  const { repo, transports } = composeTransports(pool, tokens.verifyToken);
  const ctx = { repo, pool, tokens };
  const actor = await makeActor(ctx, "t1", "l5-sub-empref", "ALL");
  const STATUS_OF = { "e-active": "ACTIVE", "e-contractor": "CONTRACTOR", "e-leave": "ON_LEAVE", "e-inactive": "INACTIVE",
    "e-terminated": "TERMINATED", "e-retired": "RETIRED" };
  for (const [id, status] of Object.entries(STATUS_OF)) {
    await pool.query(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES ($1,'t1',$2,'taylor')`, [id, status]);
  }
  await pool.query(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES ('e-other-tenant','t2','ACTIVE','taylor'), ('e-subject','t1','ACTIVE','taylor')`);
  const account = (await call(transports.crm, "createAccount", { token: actor.token,
    input: { idempotencyKey: key(), ownerEmployeeId: "e-active", name: "Ref Co", status: "ACTIVE" } })).body.result;
  const opp = (await call(transports.commercial, "createOpportunity", { token: actor.token, input: { idempotencyKey: key(), accountId: account.accountId,
    salesChannel: "RETAIL", operatingCompanyId: "taylor", need: "ref", lines: [{ kind: "SERVICE", ref: "svc-pm", qty: 1 }] } })).body.result;
  assert.ok(opp?.opportunityId, "fixture opportunity");

  const COMMANDS = {
    "crm.createAccount(owner)": (emp) => call(transports.crm, "createAccount", { token: actor.token,
      input: { idempotencyKey: key(), ownerEmployeeId: emp, name: `Ref ${emp}`, status: "ACTIVE" } }),
    "commercial.createSalesOrder(owner)": (emp) => call(transports.commercial, "createSalesOrder", { token: actor.token, input: {
      idempotencyKey: key(), accountId: account.accountId, ownerEmployeeId: emp, operatingCompanyId: "taylor", salesChannel: "RETAIL",
      lines: [{ kind: "SERVICE", ref: "svc-pm", orderedQty: 1, unitPrice: 100, businessUnitId: "SERVICE" }] } }),
    "commercial.createSalesAgreement(owner)": async (emp) => {
      const o = (await call(transports.commercial, "createOpportunity", { token: actor.token, input: { idempotencyKey: key(), accountId: account.accountId,
        salesChannel: "RETAIL", operatingCompanyId: "taylor", need: `ref ${emp}`, lines: [{ kind: "SERVICE", ref: "svc-pm", qty: 1 }] } })).body.result;
      return call(transports.commercial, "createSalesAgreement", { token: actor.token, input: { idempotencyKey: key(), opportunityId: o.opportunityId,
        ownerEmployeeId: emp, lines: [{ kind: "SERVICE", ref: "svc-pm", quantity: 1, unitPrice: 100, businessUnitId: "SERVICE" }] } });
    },
    "workforce.establishReportingRelationship(manager)": (emp) => call(transports.workforce, "establishReportingRelationship", { token: actor.token,
      input: { employeeId: "e-subject", managerEmployeeId: emp, reason: "l5 ref probe" } }).then(async (r) => {
      // Reset so the next cell is an establish, not a no-op/conflict.
      await call(transports.workforce, "endReportingRelationship", { token: actor.token, input: { employeeId: "e-subject", reason: "l5 reset" } });
      return r;
    }),
  };
  const REFS = [...Object.keys(STATUS_OF), "e-other-tenant", "e-does-not-exist"];

  const grid = {};
  for (const [cmd, run] of Object.entries(COMMANDS)) {
    grid[cmd] = {};
    for (const ref of REFS) {
      const r = await run(ref);
      grid[cmd][ref] = `${r.status} ${r.code}`;
    }
  }
  t.diagnostic(`EMPLOYEE REFERENCE GRID ${JSON.stringify(grid, null, 1)}`);

  await t.test("another tenant's Employee and a missing id are refused by every command, identically", () => {
    for (const cmd of Object.keys(COMMANDS)) {
      assert.match(grid[cmd]["e-other-tenant"], /^4\d\d /, `${cmd} accepted another tenant's Employee`);
      assert.equal(grid[cmd]["e-other-tenant"], grid[cmd]["e-does-not-exist"], `${cmd}: other-tenant differs from missing (existence oracle)`);
    }
  });
  await t.test("an ACTIVE Employee is accepted by every command", () => {
    for (const cmd of Object.keys(COMMANDS)) assert.match(grid[cmd]["e-active"], /^200 /, cmd);
  });
  await t.test("Commercial accountability honours ELIGIBILITY_V1 (ACTIVE, CONTRACTOR eligible; the rest refused)", () => {
    for (const cmd of ["commercial.createSalesOrder(owner)", "commercial.createSalesAgreement(owner)"]) {
      const eligible = Object.entries(STATUS_OF).filter(([id]) => /^200 /.test(grid[cmd][id])).map(([, s]) => s).sort();
      assert.deepEqual(eligible, ["ACTIVE", "CONTRACTOR"], `${cmd}: eligible statuses ${eligible}`);
    }
  });
  await t.test("the non-ruled cells, pinned as measured", () => {
    const pinned = Object.fromEntries(["crm.createAccount(owner)", "workforce.establishReportingRelationship(manager)"].map((cmd) =>
      [cmd, Object.fromEntries(Object.keys(STATUS_OF).map((id) => [STATUS_OF[id], grid[cmd][id]]))]));
    assert.deepEqual(pinned, EXPECTED_UNRULED);
  });
});

// Measured 2026-09-28 at main 1d0745c6. L5-F09 (DECISION CANDIDATE, L1 / Workforce owner): ELIGIBILITY_V1 is scoped to
// Opportunity / Sales Agreement / Sales Order, so a NEW CRM Account can be owned by -- and a NEW reporting line can
// point at -- a TERMINATED or RETIRED Employee. Whether V2 (a new policy version, per the ruling) extends to Account
// ownership and to new managers is not answered by any ruling. Pinned as measured.
const ALL_STATUSES_OK = { ACTIVE: "200 OK", CONTRACTOR: "200 OK", ON_LEAVE: "200 OK", INACTIVE: "200 OK", TERMINATED: "200 OK", RETIRED: "200 OK" };
const EXPECTED_UNRULED = {
  "crm.createAccount(owner)": ALL_STATUSES_OK,
  "workforce.establishReportingRelationship(manager)": ALL_STATUSES_OK,
};
