// PLATFORM QA (lane L5) -- IDEMPOTENCY KEYS ACROSS ACTORS, TENANTS, OPERATIONS AND PAYLOADS.
//
// The CRM and Commercial kernels replay a committed receipt for a repeated idempotency key. A replay is a READ of a
// prior result, so WHO may replay it is an authorization question:
//
//   * a different TENANT reusing the key must never receive the first tenant's result (cross-tenant disclosure);
//   * a different PRINCIPAL reusing it must not be handed another caller's result as its own;
//   * the same key with a DIFFERENT payload must refuse (CONFLICT), never replay the old result for a new request;
//   * the same key on a DIFFERENT operation must not replay across operations.
//
// Measured on both kernels that take keys. Disposable database (platformQaHarness.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SKIP, freshMigratedDatabase, composeTransports, tokenRegistry, makeActor, call } from "./platformQaHarness.mjs";
import { bindOperatingCompany } from "./support/governedOperatingCompanyBinding.mjs";

test("idempotency key matrix", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { pool } = await freshMigratedDatabase(t, "l5idem");
  await pool.query(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);
  // The tenants' sales channels, as Administration setTenantSalesChannelStatus records them: new Commercial work requires an ACTIVE channel.
  for (const tenant of ["t1", "t2"]) for (const channel of ["NATIONAL_ACCOUNTS", "RETAIL", "STRATEGIC_ACCOUNTS"]) {
    await pool.query(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id, sales_channel, status, source, established_by, updated_by) VALUES ($1, $2, 'ACTIVE', 'fixture', 'fixture', 'fixture')`, [tenant, channel]);
  }
  for (const t of ['t1', 't2']) await bindOperatingCompany((text, values) => pool.query(text, values), t, 'taylor', `taylor-${t}`); // ACTIVE + key bound (DQ-008)
  const tokens = tokenRegistry();
  const { repo, transports } = composeTransports(pool, tokens.verifyToken);
  const ctx = { repo, pool, tokens };
  const a1 = await makeActor(ctx, "t1", "l5-sub-idem-a", "ALL");
  const b1 = await makeActor(ctx, "t1", "l5-sub-idem-b", "ALL");
  const c2 = await makeActor(ctx, "t2", "l5-sub-idem-c", "ALL");
  await pool.query(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES
    ('e-i1','t1','ACTIVE','taylor'), ('e-i2','t2','ACTIVE','taylor')`);
  const acct = async (actor, emp) => (await call(transports.crm, "createAccount", { token: actor.token,
    input: { idempotencyKey: `seed-${randomUUID()}`, ownerEmployeeId: emp, name: "Idem", status: "ACTIVE" } })).body.result;
  const acct1 = await acct(a1, "e-i1");
  const acct2 = await acct(c2, "e-i2");

  const FAMILIES = {
    crm: {
      first: (actor, k, variant = "A") => call(transports.crm, "createAccount", { token: actor.token,
        input: { idempotencyKey: k, ownerEmployeeId: actor === c2 ? "e-i2" : "e-i1", name: `Idem ${variant}`, status: "ACTIVE" } }),
      otherOp: (actor, k) => call(transports.crm, "createContact", { token: actor.token,
        input: { idempotencyKey: k, accountId: actor === c2 ? acct2.accountId : acct1.accountId, name: "Other op" } }),
      idOf: (r) => r.body.result?.accountId ?? r.body.result?.contactId,
    },
    commercial: {
      first: (actor, k, variant = "A") => call(transports.commercial, "createOpportunity", { token: actor.token, input: {
        idempotencyKey: k, accountId: actor === c2 ? acct2.accountId : acct1.accountId, salesChannel: "RETAIL", operatingCompanyId: "taylor",
        need: `idem ${variant}`, lines: [{ kind: "SERVICE", ref: "svc-pm", qty: 1 }] } }),
      otherOp: (actor, k) => call(transports.commercial, "createSalesOrder", { token: actor.token, input: {
        idempotencyKey: k, accountId: actor === c2 ? acct2.accountId : acct1.accountId, ownerEmployeeId: actor === c2 ? "e-i2" : "e-i1",
        operatingCompanyId: "taylor", salesChannel: "RETAIL", lines: [{ kind: "SERVICE", ref: "svc-pm", orderedQty: 1, unitPrice: 1, businessUnitId: "SERVICE" }] } }),
      idOf: (r) => r.body.result?.opportunityId ?? r.body.result?.salesOrderId,
    },
  };

  const grid = {};
  for (const [family, f] of Object.entries(FAMILIES)) {
    const k = `shared-${randomUUID()}`;
    const original = await f.first(a1, k);
    assert.equal(original.status, 200, `${family} original: ${JSON.stringify(original.body)}`);
    const originalId = f.idOf(original);
    const cells = {
      "same actor, same payload": await f.first(a1, k),
      "same actor, DIFFERENT payload": await f.first(a1, k, "B"),
      "same actor, DIFFERENT operation": await f.otherOp(a1, k),
      "other Principal, same tenant, same payload": await f.first(b1, k),
      "other TENANT, same key": await f.first(c2, k),
    };
    grid[family] = Object.fromEntries(Object.entries(cells).map(([label, r]) => [label,
      `${r.status} ${r.code}${r.status === 200 ? ` replayed=${r.body.result?.replayed} ${f.idOf(r) === originalId ? "SAME-RESULT" : "new-result"}` : ""}`]));
  }
  t.diagnostic(`IDEMPOTENCY GRID ${JSON.stringify(grid, null, 1)}`);

  await t.test("a key never replays across tenants, Principals or operations (both kernels)", () => {
    for (const family of Object.keys(FAMILIES)) {
      assert.match(grid[family]["same actor, same payload"], /replayed=true SAME-RESULT/, `${family}: no replay for the identical request`);
      for (const label of ["other TENANT, same key", "other Principal, same tenant, same payload", "same actor, DIFFERENT operation"]) {
        assert.doesNotMatch(grid[family][label], /SAME-RESULT/, `${family} ${label}: handed the original result`);
      }
    }
  });
  await t.test("the same key with a DIFFERENT request: CRM refuses, Commercial replays the OLD result (L5-F10, pinned)", () => {
    // Measured 2026-09-28 at main 1d0745c6. CRM hashes the canonical request into the receipt and refuses a mismatch
    // 409 IDEMPOTENCY_KEY_REUSED (crmAuthorityKernel.ts). Commercial keys the receipt on (tenant, principal, operation,
    // key hash) only, so a changed request under a reused key answers 200 replayed=true with the FIRST request's
    // result: the caller is told its new request succeeded while nothing it asked for was written. Owner: L1
    // (eosCommercial kernel + eos_commercial.command_receipts). A fix moves this pin to "409 ...".
    assert.equal(grid.crm["same actor, DIFFERENT payload"], "409 IDEMPOTENCY_KEY_REUSED");
    assert.equal(grid.commercial["same actor, DIFFERENT payload"], "200 OK replayed=true SAME-RESULT");
  });
});
