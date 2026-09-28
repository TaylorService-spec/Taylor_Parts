// PLATFORM QA (lane L5) -- A SCOPED ASSIGNMENT CONFERS EXACTLY WHAT THE SCOPE RUNTIME DECLARES, ON EVERY TRANSPORT.
//
// A Role assigned at a non-global scope (lane SC) must be honoured ONLY by the consumers
// adminPolicy/assignmentScopeRuntime.ts SCOPE_EVALUABLE_GRANTS names, and only for records inside the scope. Every other
// gate -- Administration's read gate, the Operations capability read, the CRM kernel, every mutation -- must treat the
// holder exactly like a Principal with no Role at all.
//
// DIFFERENTIAL: for every operation of all five transports, the scoped holder's answer is compared with a zero-Role
// Principal's answer to the SAME request. Any operation whose answer differs is something the scope conferred; that
// set must be a subset of the declared consumers. The Role behind the scope holds EVERY capability, so a leak anywhere
// is visible. Disposable database (platformQaHarness.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { SKIP, freshMigratedDatabase, composeTransports, tokenRegistry, makeActor, call } from "./platformQaHarness.mjs";

const require = createRequire(import.meta.url);
const { SCOPE_EVALUABLE_GRANTS } = require("../lib/adminPolicy/assignmentScopeRuntime.js");
const key = () => `l5-${randomUUID()}`;

test("scoped assignment differential matrix", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { pool } = await freshMigratedDatabase(t, "l5scope");
  await pool.query(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1')`);
  await pool.query(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by) VALUES
    ('t1','taylor','ACTIVE','l5','l5','l5'), ('t1','ventana','ACTIVE','l5','l5','l5')`);
  const tokens = tokenRegistry();
  const { repo, transports } = composeTransports(pool, tokens.verifyToken);
  const ctx = { repo, pool, tokens };
  const all = await makeActor(ctx, "t1", "l5-sub-scope-all", "ALL");
  const none = await makeActor(ctx, "t1", "l5-sub-scope-none", []);
  const roleId = (await pool.query(`SELECT id FROM eos_policy.roles WHERE tenant_id='t1' AND key=$1`, [`l5-role-${all.subject}`])).rows[0].id;

  // The sales-channel scope is only decidable for a channel the tenant has ACTIVE (lane GA).
  await pool.query(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id, sales_channel, status, source, established_by, updated_by)
                    VALUES ('t1','RETAIL','ACTIVE','l5','l5','l5'), ('t1','NATIONAL_ACCOUNTS','ACTIVE','l5','l5','l5')`);

  const refusedAtWrite = {};
  const scopedActor = async (subject, scopeType, scopeValue) => {
    const a = await makeActor(ctx, "t1", subject, []);
    try {
    await repo.transact({ tenantId: "t1", uid: "uid-l5-fixture-admin" }, async (tx) => {
      const accessVersion = await tx.bumpAccessVersion(a.principalId);
      return tx.createAssignment({ principalId: a.principalId, roleId, scopeType, scopeValue, status: "active",
        grantedBy: "l5-fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion });
    });
    } catch (err) {
      // The store itself refuses a scope it cannot decide: nothing can be conferred. Recorded, and the actor still
      // takes part in the differential (it must then equal the zero-Role Principal everywhere).
      refusedAtWrite[`${scopeType}=${scopeValue}`] = String(err.message).slice(0, 160);
    }
    return a;
  };
  const SCOPED = {
    "operatingCompany=taylor": await scopedActor("l5-sub-scope-opco", "operatingCompany", "taylor"),
    "salesChannel=RETAIL": await scopedActor("l5-sub-scope-retail", "salesChannel", "RETAIL"),
    "businessUnit=SERVICE": await scopedActor("l5-sub-scope-bu", "businessUnit", "SERVICE"),
    "location=SC-WH-MAIN": await scopedActor("l5-sub-scope-loc", "location", "SC-WH-MAIN"),
  };

  // Records: one in-scope and one out-of-scope per scoped axis.
  await pool.query(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES
    ('e-taylor','t1','ACTIVE','taylor'), ('e-ventana','t1','ACTIVE','ventana')`);
  const must = async (tr, op, input) => {
    const r = await call(transports[tr], op, { token: all.token, input });
    assert.equal(r.status, 200, `fixture ${tr}.${op}: ${JSON.stringify(r.body)}`);
    return r.body.result;
  };
  const account = await must("crm", "createAccount", { idempotencyKey: key(), ownerEmployeeId: "e-taylor", name: "Scope Co", status: "ACTIVE" });
  const oppRetail = await must("commercial", "createOpportunity", { idempotencyKey: key(), accountId: account.accountId, salesChannel: "RETAIL",
    operatingCompanyId: "taylor", need: "retail", lines: [{ kind: "SERVICE", ref: "svc-pm", qty: 1 }] });
  const oppNational = await must("commercial", "createOpportunity", { idempotencyKey: key(), accountId: account.accountId, salesChannel: "NATIONAL_ACCOUNTS",
    operatingCompanyId: "taylor", need: "national", lines: [{ kind: "SERVICE", ref: "svc-pm", qty: 1 }] });

  // Every operation, with the id-bearing ones given an in-scope record.
  const INPUTS = {
    "commercial.getOpportunityDetail": { opportunityId: oppRetail.opportunityId },
    "commercial.getAccountCommercialProjection": { accountId: account.accountId },
    "crm.getAccount": { accountId: account.accountId },
    "workforce.readEmployee": { employeeId: "e-taylor" },
    "workforce.readEmployeePrincipalLink": { employeeId: "e-taylor" },
    "workforce.listManagedEmployees": { managerEmployeeId: "e-taylor" },
    "workforce.listEmployeeWorkEligibility": { employeeId: "e-taylor" },
    "workforce.listEmployeeOperationalScopes": { employeeId: "e-taylor" },
    "workforce.listEmployeeJobRoleHistory": { employeeId: "e-taylor" },
  };
  const declared = new Map();
  for (const g of SCOPE_EVALUABLE_GRANTS) {
    for (const c of g.consumers) {
      const scopeLabel = g.scopeType === "operatingCompany" ? "operatingCompany=taylor" : g.scopeType === "salesChannel" ? "salesChannel=RETAIL" : g.scopeType;
      if (!declared.has(scopeLabel)) declared.set(scopeLabel, new Set());
      declared.get(scopeLabel).add(c);
    }
  }

  const conferred = {};
  for (const [label, actor] of Object.entries(SCOPED)) {
    conferred[label] = [];
    for (const [name, tr] of Object.entries(transports)) {
      for (const op of tr.operations) {
        const input = INPUTS[`${name}.${op}`] ?? {};
        const a = await call(tr, op, { token: actor.token, input: tr.mutations.has(op) ? {} : input });
        const b = await call(tr, op, { token: none.token, input: tr.mutations.has(op) ? {} : input });
        if (a.status !== b.status || a.code !== b.code) conferred[label].push(`${name}.${op} (${b.status} ${b.code} -> ${a.status} ${a.code})`);
      }
    }
  }
  t.diagnostic(`CONFERRED ${JSON.stringify(conferred, null, 1)}`);
  t.diagnostic(`REFUSED AT WRITE ${JSON.stringify(refusedAtWrite, null, 1)}`);

  await t.test("every difference a scope makes is a DECLARED scope consumer; unconsumed scope types confer nothing", () => {
    const undeclared = [];
    for (const [label, diffs] of Object.entries(conferred)) {
      for (const d of diffs) {
        const op = d.split(" ")[0];
        if (!declared.get(label)?.has(op)) undeclared.push(`${label}: ${d}`);
      }
    }
    assert.deepEqual(undeclared, []);
    assert.deepEqual(conferred["businessUnit=SERVICE"], []);
    assert.deepEqual(conferred["location=SC-WH-MAIN"], []);
  });

  await t.test("inside the scope a declared consumer answers; outside it the answer is the missing-record answer", async () => {
    const opco = SCOPED["operatingCompany=taylor"];
    const inScope = await call(transports.workforce, "readEmployee", { token: opco.token, input: { employeeId: "e-taylor" } });
    const outScope = await call(transports.workforce, "readEmployee", { token: opco.token, input: { employeeId: "e-ventana" } });
    const missing = await call(transports.workforce, "readEmployee", { token: opco.token, input: { employeeId: "e-nope" } });
    assert.equal(inScope.status, 200, JSON.stringify(inScope.body));
    assert.deepEqual([outScope.status, outScope.code], [missing.status, missing.code], "out-of-scope differs from missing: an existence oracle");
    const list = await call(transports.workforce, "listEmployees", { token: opco.token, input: {} });
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const ids = (list.body.result.items ?? list.body.result.employees ?? []).map((e) => e.employeeId ?? e.id);
    assert.ok(ids.includes("e-taylor") && !ids.includes("e-ventana"), `list not filtered to the scope: ${ids}`);

    const retail = SCOPED["salesChannel=RETAIL"];
    const r1 = await call(transports.commercial, "getOpportunityDetail", { token: retail.token, input: { opportunityId: oppRetail.opportunityId } });
    const r2 = await call(transports.commercial, "getOpportunityDetail", { token: retail.token, input: { opportunityId: oppNational.opportunityId } });
    const r3 = await call(transports.commercial, "getOpportunityDetail", { token: retail.token, input: { opportunityId: "opp-l5-nope" } });
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    assert.deepEqual([r2.status, r2.code], [r3.status, r3.code], "out-of-channel differs from missing: an existence oracle");
    const listed = await call(transports.commercial, "listOpportunities", { token: retail.token, input: {} });
    const items = (listed.body.result?.items ?? []).map((o) => o.opportunityId ?? o.id);
    assert.ok(items.includes(oppRetail.opportunityId) && !items.includes(oppNational.opportunityId), `channel list not filtered: ${items}`);
  });
});
