// THE PREVIEW'S COMPANY AUTHORITY IS SET-BASED (DECISIONS #249 follow-up): a regression guard.
//
// After the explicit company-access grants shipped, the Administration preview's tenant-wide snapshot computed each member's
// company authority with one `resolveCompanyAuthority` call (four queries) PER MEMBER, on BOTH sides of the change. On nonprod
// (a remote database) that made EVERY previewAuthorityChange -- a plain assignRole included -- answer PREVIEW_BUSY{BUDGET}
// (8303 ms against the 8000 ms budget). The snapshot now decides every member's company authority in TWO round trips
// (resolveCompanyAuthorityForMembers). This suite proves, on a tenant of 60+ members:
//   1. PARITY   the set-based read decides exactly what the per-principal resolver decides, for every member and every gap;
//   2. COST     the preview's statement count does not grow with the number of members for company authority (a structural
//               guard that fails if anyone reintroduces a per-member resolver call -- it does not depend on database latency);
//   3. BUDGET   the previews (grant, revoke and a plain assignRole) finish WOULD_APPLY, not PREVIEW_BUSY, under the default budget;
//   4. DIGEST   grants are covered by the digest: adding a grant moves it, and a stale digest is refused at commit.
import { endPoolAndDrain } from "./support/poolTeardown.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildPreviewWorld, privateDatabase } from "./support/authorityPreviewFixture.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const require = createRequire(import.meta.url);
const { resolveCompanyAuthority, resolveCompanyAuthorityForMembers } = require("../lib/eosOps/companyAuthority.js");
const { createAuthorityChangeCommit } = require("../lib/eosOps/authorityChangeCommit.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const { DEFAULT_PREVIEW_BUDGET_MS } = require("../lib/eosOps/authorityChangePreview.js");

const ADMIN = "gip-admin-a";
const MEMBERS = 64;
const REASON = "preview budget guard";

test("PREVIEW COMPANY AUTHORITY: set-based, equal to the per-principal resolver, inside the budget at 64+ members", { skip: SKIP, concurrency: 1 }, async (t) => {
  const db = await privateDatabase(URL_BASE, "gip_budget");
  let world;
  t.after(async () => { await endPoolAndDrain(world?.pool); await db.drop(); });
  world = await buildPreviewWorld(db.url);
  const { q, pool, repo, T, member, assign, statements } = world;
  const A = T.a;
  for (const c of ["taylor", "ventana"]) {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by) VALUES ($1,$2,'ACTIVE','fixture','fixture','fixture')`, [A, c]);
  }
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by) VALUES ($1,'dormant','INACTIVE','fixture','fixture','fixture')`, [A]);

  // ── a realistic tenant: MEMBERS more principals, every shape the company-authority rule distinguishes ──
  const grantable = [];
  for (let i = 0; i < MEMBERS; i += 1) {
    const principalId = await member(A, `bulk-${i}`);
    const employeeId = `e-bulk-${i}`;
    const unlinked = i % 13 === 0;
    const status = i % 11 === 0 ? "TERMINATED" : i % 17 === 0 ? "CONTRACTOR" : "ACTIVE";
    const home = i % 5 === 0 ? "ventana" : "taylor";
    await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at) VALUES ($1,$2,$3,$4,'2020-01-01T00:00:00Z')`, [employeeId, A, status, home]);
    if (!unlinked) {
      await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason)
               VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED','fixture','budget guard')`, [`epl-bulk-${i}`, A, principalId, employeeId, home]);
    }
    if (i % 7 === 0) await assign(A, principalId, "dispatcher", { scopeType: "operatingCompany", scopeValue: home === "taylor" ? "ventana" : "taylor" });
    if (i % 19 === 0) await assign(A, principalId, "dispatcher", { scopeType: "operatingCompany", scopeValue: "ventana", future: true });
    if (!unlinked && status !== "TERMINATED" && home === "taylor") grantable.push(employeeId);
  }
  // A few explicit grants (written under the Administration marker, as the command does), one not yet in effect.
  const governed = async (fn) => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('eos_policy.administration_command', 'on', true)`);
      await fn(c);
      await c.query("COMMIT");
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  };
  await governed(async (c) => {
    for (const [n, e] of grantable.slice(0, 3).entries()) {
      await c.query(`INSERT INTO eos_policy.employee_company_authority_grants (id,tenant_id,employee_id,operating_company_id,reason,granted_by) VALUES ($1,$2,$3,'ventana','fixture','fixture')`, [`g-fx-${n}`, A, e]);
    }
    await c.query(`INSERT INTO eos_policy.employee_company_authority_grants (id,tenant_id,employee_id,operating_company_id,reason,granted_by,effective_from,effective_until)
                   VALUES ('g-fx-future',$1,$2,'ventana','fixture','fixture', now() + interval '1 hour', now() + interval '2 hours')`, [A, grantable[3]]);
  });

  const ids = (await repo.listTenantPrincipalIds(A)).slice().sort();
  assert.ok(ids.length >= 50, `${ids.length} members`);

  await t.test("1. PARITY: the set-based read decides exactly what the per-principal resolver decides, gaps included", async () => {
    const many = await resolveCompanyAuthorityForMembers(pool, A, [...ids, "p-not-a-member-of-anything"]);
    const gaps = new Set();
    for (const id of ids) {
      const one = await resolveCompanyAuthority(pool, A, id);
      const set = many.get(id);
      assert.deepEqual([...set.companies], [...one.companies], `companies of ${id}`);
      assert.equal(set.gap, one.gap, `gap of ${id}`);
      gaps.add(one.gap);
    }
    assert.deepEqual(many.get("p-not-a-member-of-anything"), { companies: [], gap: "PRINCIPAL_NOT_ACTIVE" });
    // The fixture really exercises the rule: no-link, ineligible employee, and resolved members are all present.
    for (const gap of [null, "EMPLOYEE_LINK_REQUIRED", "EMPLOYEE_NOT_ACCESS_ELIGIBLE"]) assert.ok(gaps.has(gap), `no member with gap ${gap}`);
    const withGrant = ids.filter((id) => (many.get(id).companies.length > 1));
    assert.ok(withGrant.length >= 3, "members reach a second company by a grant or an operational assignment");
    // Another tenant's principal id asked in THIS tenant: nothing.
    const otherTenantMember = (await repo.listTenantPrincipalIds(T.b))[0];
    assert.equal((await resolveCompanyAuthorityForMembers(pool, A, [otherTenantMember])).get(otherTenantMember).gap, "PRINCIPAL_NOT_ACTIVE");
    // After a company turns INACTIVE and a disabled member, parity still holds.
    await q(`UPDATE eos_policy.tenant_operating_companies SET status = 'INACTIVE' WHERE tenant_id = $1 AND operating_company_id = 'ventana'`, [A]);
    const after = await resolveCompanyAuthorityForMembers(pool, A, ids);
    for (const id of ids) assert.deepEqual([...after.get(id).companies], [...(await resolveCompanyAuthority(pool, A, id)).companies], `INACTIVE parity ${id}`);
    await q(`UPDATE eos_policy.tenant_operating_companies SET status = 'ACTIVE' WHERE tenant_id = $1 AND operating_company_id = 'ventana'`, [A]);
  });

  await t.test("2. COST: the company-authority statements of a preview do not grow with the number of members", async () => {
    statements.length = 0;
    const r = await world.call(ADMIN, "previewAuthorityChange", { change: { operation: "grantCompanyAuthority",
      input: { employeeId: grantable[5], operatingCompanyId: "ventana", reason: REASON } } });
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 400));
    assert.equal(r.data.outcome, "WOULD_APPLY", JSON.stringify(r.data).slice(0, 400));
    assert.equal(statements.length, 1, "one attempt");
    const log = statements[0];
    const members = ids.length;
    // The grants table appears in: the policy-state digest (before, after), the set-based company read (before, after) and the
    // command itself (a handful of statements). A per-member resolver would add one statement per member per side (>= 2 x members).
    const touchingGrants = log.filter((s) => /employee_company_authority_grants/.test(s.text)).length;
    assert.ok(touchingGrants <= 16, `${touchingGrants} statements read the grants for ${members} members -- a per-member resolver is back`);
    const perMemberStandingReads = log.filter((s) => /FROM eos_policy\.principals p\s+JOIN eos_policy\.tenant_memberships m ON m\.principal_id = p\.id AND m\.tenant_id = \$1 AND m\.status = 'active'\s+WHERE p\.id = \$2/.test(s.text)).length;
    assert.equal(perMemberStandingReads, 0, "no per-member standing read of the single-principal resolver");
    t.diagnostic(`preview of ${members} members: ${log.length} statements (${(log.length / (members * 2)).toFixed(1)} per member-side); ${touchingGrants} read the grants; a per-member resolver would add ${members * 2 * 4} more`);
    assert.ok(log.length / (members * 2) < 40, `${log.length} statements for ${members} members`);
  });

  await t.test("3. BUDGET: previews of a grant, a revoke and a plain assignRole complete under the default budget at this size", async () => {
    const roleId = await world.roleId(A, "dispatcher");
    const target = world.P.a.plain;
    for (const [label, change] of [
      ["grantCompanyAuthority", { operation: "grantCompanyAuthority", input: { employeeId: grantable[6], operatingCompanyId: "ventana", reason: REASON } }],
      ["revokeCompanyAuthority", { operation: "revokeCompanyAuthority", input: { grantId: "g-fx-0", reason: REASON } }],
      ["assignRole", { operation: "assignRole", input: { principalId: target, roleId, reason: REASON } }],
    ]) {
      const started = Date.now();
      const r = await world.call(ADMIN, "previewAuthorityChange", { change });
      const elapsed = Date.now() - started;
      assert.equal(r.ok, true, `${label} ${JSON.stringify(r).slice(0, 300)}`);
      assert.notEqual(r.data.outcome, "PREVIEW_BUSY", `${label} busy: ${JSON.stringify(r.data.busy)}`);
      assert.ok(["WOULD_APPLY", "NO_OP"].includes(r.data.outcome), `${label}: ${r.data.outcome} ${JSON.stringify(r.data.refusal)}`);
      t.diagnostic(`${label}: ${r.data.outcome} in ${elapsed} ms of the ${DEFAULT_PREVIEW_BUDGET_MS} ms budget`);
      assert.ok(elapsed < DEFAULT_PREVIEW_BUDGET_MS, `${label} took ${elapsed} ms`);
    }
  });

  await t.test("4. DIGEST: grants are covered; adding one moves the digest and a stale digest is refused at commit", async () => {
    const committer = createAuthorityChangeCommit({ pool });
    const MAND = { ...world.deps, commitAuthorityChange: committer, previewMandatory: true };
    const as = (op, input) => executeAdminOperation(MAND, { caller: { externalSubject: ADMIN, identityProvider: "firebase" }, operation: op, input, requestId: `b-${op}` });
    const input = { employeeId: grantable[7], operatingCompanyId: "ventana", reason: REASON };
    const first = await as("previewAuthorityChange", { change: { operation: "grantCompanyAuthority", input } });
    assert.equal(first.data.outcome, "WOULD_APPLY");
    const delta = first.data.affected.find((d) => d.changes.companyAuthority);
    assert.ok(delta, "the grantee's company authority moves");
    assert.deepEqual(Object.keys(delta.changes), ["companyAuthority"]);
    assert.deepEqual(delta.changes.companyAuthority, { added: ["ventana"], removed: [] });
    assert.equal(first.data.affectedCount, 1);
    // An unrelated grant lands: the state digest (which covers the grants) moves, so the earlier digest is stale.
    await governed(async (c) => {
      await c.query(`INSERT INTO eos_policy.employee_company_authority_grants (id,tenant_id,employee_id,operating_company_id,reason,granted_by) VALUES ('g-fx-late',$1,$2,'ventana','fixture','fixture')`, [A, grantable[8]]);
    });
    const second = await as("previewAuthorityChange", { change: { operation: "grantCompanyAuthority", input } });
    assert.notEqual(second.data.digests.previewDigest, first.data.digests.previewDigest, "the digest covers the grants");
    const stale = await as("grantCompanyAuthority", { ...input, previewDigest: first.data.digests.previewDigest });
    assert.equal(stale.ok, false);
    assert.match(`${stale.code}: ${stale.message}`, /STALE_PREVIEW/);
    const committed = await as("grantCompanyAuthority", { ...input, previewDigest: second.data.digests.previewDigest });
    assert.equal(committed.ok, true, JSON.stringify(committed).slice(0, 300));
    assert.equal((await resolveCompanyAuthority(pool, A, (await q(`SELECT principal_id FROM eos_policy.employee_principal_links WHERE tenant_id = $1 AND employee_id = $2`, [A, grantable[7]])).rows[0].principal_id)).companies.includes("ventana"), true);
  });
});
