// EMPLOYEE COMPANY-ACCESS GRANTS (Owner decision packet 2026-10-17 ruling 3 "COMPANY AUTHORITY", Option A; ruling #2140-R;
// DECISIONS #249), against a real PostgreSQL on the baseline-equal service tenant.
//
// A grant is REACH to one more operating company for one Employee. It is not a Role, not a capability and not Finance access.
// The proofs below are the Owner's conditions made executable: it adds exactly that company and nothing else; revoke and expiry
// remove it on the next request; a future start does not apply yet; nobody grants to themselves; only a holder of
// admin.roleAssignment.write in the Employee's own tenant can grant or revoke; cross-tenant is impossible; an Employee with no
// access-eligible link gets nothing; a Finance-only assignment plus a grant gives operational reach from the grant only; a
// change is previewed and committed with the preview's digest (a stale digest is refused); every change is audited once; the
// store refuses an ungoverned write; and the migration reverses (and refuses while a grant is ACTIVE).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";
import { assignFinanceCompanies, FINANCE_COMPANY_ACCESS_ROLE } from "./support/financeCompanyAccess.mjs";

const require = createRequire(import.meta.url);
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { resolveCompanyAuthority, readMyCompanyAuthority } = require("../lib/eosOps/companyAuthority.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const { snapshotTenantAuthority } = require("../lib/eosOps/authorityChangePreview.js");
const { createAuthorityChangePreview } = require("../lib/eosOps/authorityChangePreview.js");
const { createAuthorityChangeCommit } = require("../lib/eosOps/authorityChangeCommit.js");
const { seedTenantPolicy } = require("../lib/adminPolicy/seed/policySeed.js");
const { bootstrapAdministrator } = require("../lib/adminPolicy/tenantBootstrap.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-ecag";
const OTHER = "t-ecag-other";
const FIN = "/operations/finance", INV = "/operations/inventory";
const REASON = "#2140-R transition preservation (local test tenant only)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("Employee company-access grants, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, pool, call, repo } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "ecag" });
  const dbUrl = pool.options.connectionString;
  const ADMIN_SUBJECT = "uid-ecag-admin";

  // Previewing and committing needs the server-composed engines (the harness `admin` composes only the repository).
  const preview = createAuthorityChangePreview({ pool, budgetMs: 60_000, statementTimeoutMs: 30_000, lockTimeoutMs: 20_000 });
  const committer = createAuthorityChangeCommit({ pool, totalBudgetMs: 120_000, statementTimeoutMs: 30_000, lockTimeoutMs: 20_000 });
  const PLAIN = { repo };
  const MAND = { repo, previewAuthorityChange: preview, commitAuthorityChange: committer, previewMandatory: true };
  const as = (subject, operation, input = {}, deps = PLAIN) => executeAdminOperation(deps,
    { caller: { externalSubject: subject, identityProvider: "firebase" }, operation, input, requestId: `r-${randomUUID()}` });
  const okData = (r, what = "") => { assert.equal(r.ok, true, `${what} ${JSON.stringify(r).slice(0, 600)}`); return r.data; };
  const refused = (r, pattern, what = "") => {
    assert.equal(r.ok, false, `${what} was accepted: ${JSON.stringify(r).slice(0, 300)}`);
    assert.match(`${r.code}: ${r.message}`, pattern, what);
  };
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body).slice(0, 500)}`); return r.body.result; };

  const companies = async (who) => (await resolveCompanyAuthority(pool, TENANT, who.principalId)).companies;
  const grantsOf = async (employeeId) => (await q(`SELECT * FROM eos_policy.employee_company_authority_grants WHERE tenant_id = $1 AND employee_id = $2 ORDER BY granted_at, id`, [TENANT, employeeId])).rows;
  const auditRows = async (action) => (await q(`SELECT * FROM eos_policy.audit_events WHERE tenant_id = $1 AND action = $2 ORDER BY occurred_at, id`, [TENANT, action])).rows;
  const allGrantAudit = async () => Number((await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id = $1 AND action IN ('grantCompanyAuthority','revokeCompanyAuthority')`, [TENANT])).rows[0].n);
  const tableDigest = async (names) => Object.fromEntries(await Promise.all(names.map(async (n) =>
    [n, (await q(`SELECT count(*)::int n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) h FROM eos_policy.${n} x`)).rows[0]])));
  const financeCompanies = async (who) => ok(await call(who, FIN, "readMyFinanceCompanyAccess", {})).companies.map((c) => c.operatingCompanyId);
  const intake = (who, company) => call(who, INV, "recordReturnIntake", { operatingCompanyId: company, partId: "PRT-1", source: "CUSTOMER", condition: "OPENED", quantity: 1, idempotencyKey: `k-${randomUUID()}` });
  /** A governed transaction: the Administration command marker, then the statements, then COMMIT -- what the store guard requires. */
  const governed = async (fn) => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('eos_policy.administration_command', 'on', true)`);
      const out = await fn(c);
      await c.query("COMMIT");
      return out;
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  };
  const grantInput = (employeeId, operatingCompanyId, extra = {}) => ({ employeeId, operatingCompanyId, reason: REASON, ...extra });

  // ── companies: Taylor and Ventana exist; add a third ACTIVE company and an INACTIVE one ──
  for (const [id, status] of [["delta", "ACTIVE"], ["dormant", "INACTIVE"]]) {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by) VALUES ($1,$2,$3,'fixture','fixture','fixture')`, [TENANT, id, status]);
  }

  // ── people (home Taylor unless stated) ──
  const ana = await person("uid-ana", ["dispatcher"], { id: "e-ana", name: "Ana Dispatcher" });
  const ric = await person("uid-ric", ["inventoryReturnsIntakeClerk"], { id: "e-ric", name: "Ric Returns Clerk" });
  const fo = await person("uid-fo", ["dispatcher"], { id: "e-fo", name: "Fin Ops (Ventana Finance)" });
  const fo2 = await person("uid-fo2", ["dispatcher"], { id: "e-fo2", name: "Fin Ops (Taylor Finance)" });
  const win1 = await person("uid-win1", ["dispatcher"], { id: "e-win1", name: "Win One (scheduled)" });
  const win2 = await person("uid-win2", ["dispatcher"], { id: "e-win2", name: "Win Two (expiring)" });
  const inact = await person("uid-inact", ["dispatcher"], { id: "e-inact", name: "Inact (company turns inactive)" });
  const nolink = await person("uid-nolink", ["dispatcher"], { id: "e-nolink", name: "No Link", linked: false });
  const term = await person("uid-term", ["dispatcher"], { id: "e-term", name: "Terminated Person", status: "TERMINATED" });
  const vtech = await person("uid-vtech", ["technician"], { id: "e-vtech", name: "Val Ventana-Tech", company: "ventana", technician: true });
  const sysadmin = await person("uid-sysadmin", ["admin"], { id: "e-sysadmin", name: "Rowan Administrator" });
  const guardee = await person("uid-guardee", ["dispatcher"], { id: "e-guardee", name: "Guard Subject" });

  // ── a second tenant with its own Administrator, Employee and a company that exists nowhere else ──
  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [OTHER]);
  await seedTenantPolicy(repo, OTHER, "operator-ecag");
  for (const c of ["taylor", "ventana", "elsewhere"]) {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by) VALUES ($1,$2,'ACTIVE','fixture','fixture','fixture')`, [OTHER, c]);
  }
  await bootstrapAdministrator(repo, { tenantId: OTHER, externalSubject: "uid-ecag-other-admin", performedBy: "operator-ecag", reason: "initial administrator" });
  await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,display_name) VALUES ('e-oth',$1,'ACTIVE','taylor','Other Tenant Person')`, [OTHER]);

  // Finance: fo holds Financials at VENTANA, fo2 at TAYLOR; both Roles are FINANCE_ONLY (#248), so they name no operational company.
  await assignFinanceCompanies({ admin, q, tenant: TENANT }, [fo], ["ventana"]);
  await assignFinanceCompanies({ admin, q, tenant: TENANT }, [fo2], ["taylor"]);
  okData(await admin("updateRole", { roleId: (await repo.getRoleByKey(TENANT, FINANCE_COMPANY_ACCESS_ROLE)).id, companyAuthorityEffect: "FINANCE_ONLY", reason: "FINANCE_ONLY classification (local test tenant only)" }), "classify");

  await t.test("0. the migration changed nothing: no grant exists, and every resolver answer is the home company", async () => {
    assert.equal(Number((await q(`SELECT count(*)::int n FROM eos_policy.employee_company_authority_grants`)).rows[0].n), 0);
    for (const who of [ana, ric, fo, fo2, win1, win2, inact, sysadmin]) assert.deepEqual(await companies(who), ["taylor"], who.subject);
    assert.deepEqual(await companies(vtech), ["ventana"]);
    assert.deepEqual(await financeCompanies(fo), ["ventana"]);
  });

  await t.test("1. ANTI-ESCALATION: the gate is admin.roleAssignment.write, and a refused request learns and changes nothing", async () => {
    const before = await allGrantAudit();
    // A Dispatcher holds neither the write nor the read.
    refused(await as("uid-ana", "grantCompanyAuthority", grantInput("e-ric", "ventana")), /FORBIDDEN/, "grant");
    refused(await as("uid-ana", "revokeCompanyAuthority", { grantId: "g-any", reason: REASON }), /FORBIDDEN/, "revoke");
    refused(await as("uid-ana", "listEmployeeCompanyAuthority", { employeeId: "e-ric" }), /FORBIDDEN/, "list");
    refused(await as("uid-ana", "previewAuthorityChange", { change: { operation: "grantCompanyAuthority", input: grantInput("e-ric", "ventana") } }, MAND), /FORBIDDEN/, "preview");
    // A stranger (not a member of this tenant at all).
    refused(await as("uid-nobody", "grantCompanyAuthority", grantInput("e-ric", "ventana")), /FORBIDDEN/, "stranger");
    assert.equal((await grantsOf("e-ric")).length, 0);
    assert.equal(await allGrantAudit(), before, "a refusal is not audited");
  });

  await t.test("2. ANTI-ESCALATION: nobody grants themselves company access (SELF_ADMINISTRATION), and the refusal is audited nowhere", async () => {
    const before = await allGrantAudit();
    refused(await as("uid-sysadmin", "grantCompanyAuthority", grantInput("e-sysadmin", "ventana")), /SELF_ADMINISTRATION/, "an Administrator granting their own Employee");
    refused(await as("uid-sysadmin", "previewAuthorityChange", { change: { operation: "grantCompanyAuthority", input: grantInput("e-sysadmin", "ventana") } }, MAND).then((r) => ({ ok: r.ok && r.data.outcome !== "WOULD_REFUSE", code: r.data?.refusal?.code, message: r.data?.refusal?.message })), /SELF_ADMINISTRATION/, "the preview says the same");
    assert.equal((await grantsOf("e-sysadmin")).length, 0);
    assert.deepEqual(await companies(sysadmin), ["taylor"]);
    assert.equal(await allGrantAudit(), before);
  });

  await t.test("3. CROSS-TENANT IS IMPOSSIBLE: another tenant's Administrator cannot name this tenant's Employee, company or grant, and this tenant's cannot name theirs", async () => {
    const before = await allGrantAudit();
    refused(await as("uid-ecag-other-admin", "grantCompanyAuthority", grantInput("e-ana", "ventana")), /employee not found/, "their admin, our Employee");
    refused(await as("uid-ecag-other-admin", "listEmployeeCompanyAuthority", { employeeId: "e-ana" }), /employee not found/, "their admin reads our Employee");
    refused(await as(ADMIN_SUBJECT, "grantCompanyAuthority", grantInput("e-ana", "elsewhere")), /SCOPE_VALUE_INVALID/, "our admin, their company");
    refused(await as(ADMIN_SUBJECT, "grantCompanyAuthority", grantInput("e-oth", "ventana")), /employee not found/, "our admin, their Employee");
    assert.equal(await allGrantAudit(), before);
    // The database refuses the same shapes written directly (composite same-tenant foreign keys), even inside an Administration transaction.
    await assert.rejects(() => governed((c) => c.query(`INSERT INTO eos_policy.employee_company_authority_grants (id,tenant_id,employee_id,operating_company_id,reason,granted_by) VALUES ('g-x1',$1,'e-oth','ventana','x','x')`, [TENANT])), /ecag_employee_fk|foreign key/);
    await assert.rejects(() => governed((c) => c.query(`INSERT INTO eos_policy.employee_company_authority_grants (id,tenant_id,employee_id,operating_company_id,reason,granted_by) VALUES ('g-x2',$1,'e-ana','elsewhere','x','x')`, [TENANT])), /SCOPE_VALUE_INVALID|ecag_company_fk/);
  });

  await t.test("4. THE COMMAND'S OWN REFUSALS: reason, unknown Employee, home company, unknown or INACTIVE company, malformed dates", async () => {
    const before = await allGrantAudit();
    refused(await as(ADMIN_SUBJECT, "grantCompanyAuthority", { employeeId: "e-ana", operatingCompanyId: "ventana" }), /REASON_REQUIRED/, "no reason");
    refused(await as(ADMIN_SUBJECT, "grantCompanyAuthority", { employeeId: "e-ana", operatingCompanyId: "ventana", reason: "  " }), /REASON_REQUIRED/, "blank reason");
    refused(await as(ADMIN_SUBJECT, "grantCompanyAuthority", grantInput("e-nobody", "ventana")), /employee not found/, "unknown Employee");
    refused(await as(ADMIN_SUBJECT, "grantCompanyAuthority", grantInput("e-ana", "taylor")), /COMPANY_IS_HOME/, "the Employee's own company");
    refused(await as(ADMIN_SUBJECT, "grantCompanyAuthority", grantInput("e-vtech", "ventana")), /COMPANY_IS_HOME/, "a Ventana Employee's own company");
    refused(await as(ADMIN_SUBJECT, "grantCompanyAuthority", grantInput("e-ana", "nonesuch")), /SCOPE_VALUE_INVALID/, "unknown company");
    refused(await as(ADMIN_SUBJECT, "grantCompanyAuthority", grantInput("e-ana", "dormant")), /SCOPE_VALUE_INVALID/, "INACTIVE company");
    refused(await as(ADMIN_SUBJECT, "grantCompanyAuthority", grantInput("e-ana", "ventana", { effectiveUntil: "2030-01-01T00:00:00" })), /COMPANY_GRANT_WINDOW_INVALID/, "no offset");
    refused(await as(ADMIN_SUBJECT, "grantCompanyAuthority", grantInput("e-ana", "ventana", { effectiveUntil: "2001-01-01T00:00:00Z" })), /COMPANY_GRANT_WINDOW_INVALID/, "already over");
    refused(await as(ADMIN_SUBJECT, "grantCompanyAuthority", grantInput("e-ana", "ventana", { effectiveFrom: "2031-01-01T00:00:00Z", effectiveUntil: "2030-06-01T00:00:00Z" })), /COMPANY_GRANT_WINDOW_INVALID/, "end before start");
    refused(await as(ADMIN_SUBJECT, "revokeCompanyAuthority", { grantId: "g-nonesuch", reason: REASON }), /company-access grant not found/, "unknown grant");
    assert.equal((await grantsOf("e-ana")).length, 0);
    assert.equal(await allGrantAudit(), before, "no refusal wrote an audit event");
  });

  await t.test("5. PREVIEW, THEN COMMIT WITH THE DIGEST: the preview shows exactly the company added and nothing else; a missing, malformed or stale digest is refused", async () => {
    const input = grantInput("e-ana", "ventana");
    // Mandatory path: no digest, no commit.
    refused(await as(ADMIN_SUBJECT, "grantCompanyAuthority", input, MAND), /PREVIEW_REQUIRED/, "no digest");
    refused(await as(ADMIN_SUBJECT, "grantCompanyAuthority", { ...input, previewDigest: "nope" }, MAND), /PREVIEW_INVALID/, "malformed digest");
    assert.equal((await grantsOf("e-ana")).length, 0);

    const p = okData(await as(ADMIN_SUBJECT, "previewAuthorityChange", { change: { operation: "grantCompanyAuthority", input } }, MAND), "preview");
    assert.equal(p.outcome, "WOULD_APPLY");
    assert.equal(p.detail, "FULL");
    assert.equal(p.previewMandatory, true);
    assert.equal(p.affectedCount, 1, "exactly one member's authority moves");
    const delta = p.affected[0];
    assert.equal(delta.principalId, ana.principalId);
    assert.deepEqual(Object.keys(delta.changes), ["companyAuthority"], "the ONLY thing that changes is company authority: no capability, surface, scoped holding or Role");
    assert.deepEqual(delta.changes.companyAuthority, { added: ["ventana"], removed: [] });
    assert.equal(delta.accessVersion, null, "a grant moves no access version");
    assert.match(delta.notes.join(" "), /COMPANY_AUTHORITY_CHANGED/);
    assert.equal((await grantsOf("e-ana")).length, 0, "a preview writes nothing");
    assert.match(p.digests.previewDigest, /^[0-9a-f]{64}$/);

    // A STALE digest: the state moves between the preview and the commit (another grant lands).
    okData(await as(ADMIN_SUBJECT, "grantCompanyAuthority", grantInput("e-win1", "delta")), "an unrelated grant lands");
    refused(await as(ADMIN_SUBJECT, "grantCompanyAuthority", { ...input, previewDigest: p.digests.previewDigest }, MAND), /STALE_PREVIEW/, "stale digest");
    assert.equal((await grantsOf("e-ana")).length, 0, "a stale commit writes nothing");
    // A digest for ANOTHER change is stale too.
    const other = okData(await as(ADMIN_SUBJECT, "previewAuthorityChange", { change: { operation: "grantCompanyAuthority", input: grantInput("e-ric", "ventana") } }, MAND));
    refused(await as(ADMIN_SUBJECT, "grantCompanyAuthority", { ...input, previewDigest: other.digests.previewDigest }, MAND), /STALE_PREVIEW/, "another change's digest");

    // Fresh preview -> commit.
    const fresh = okData(await as(ADMIN_SUBJECT, "previewAuthorityChange", { change: { operation: "grantCompanyAuthority", input } }, MAND));
    const before = {
      tables: await tableDigest(["capabilities", "role_capabilities", "principal_capabilities", "user_role_assignments", "principal_access_versions", "capability_grant_conditions", "roles"]),
      snap: (await snapshotTenantAuthority(pool, repo, TENANT, [])).get(ana.principalId),
      audits: await allGrantAudit(),
    };
    const row = okData(await as(ADMIN_SUBJECT, "grantCompanyAuthority", { ...input, previewDigest: fresh.digests.previewDigest }, MAND), "commit");
    assert.equal(row.employeeId, "e-ana");
    assert.equal(row.operatingCompanyId, "ventana");
    assert.equal(row.status, "active");
    assert.equal(row.effectiveUntil, null);
    assert.equal(row.grantedBy, (await q(`SELECT id FROM eos_policy.principals WHERE external_subject = $1`, [ADMIN_SUBJECT])).rows[0].id);

    // The commit equals the preview: reach gained, NOTHING else.
    assert.deepEqual(await companies(ana), ["taylor", "ventana"]);
    const after = (await snapshotTenantAuthority(pool, repo, TENANT, [])).get(ana.principalId);
    const { companyAuthority: bc, ...bRest } = before.snap;
    const { companyAuthority: ac, ...aRest } = after;
    assert.deepEqual(bc, ["taylor"]);
    assert.deepEqual(ac, ["taylor", "ventana"]);
    assert.deepEqual(aRest, bRest, "capabilities, surfaces, scoped holdings, Roles, administration gates: byte-identical");
    assert.deepEqual(await tableDigest(["capabilities", "role_capabilities", "principal_capabilities", "user_role_assignments", "principal_access_versions", "capability_grant_conditions", "roles"]), before.tables,
      "a grant writes no capability, no Role grant, no assignment and no access version");
    assert.equal(await allGrantAudit(), before.audits + 1, "exactly one audit event");
    const keys = (await resolveCompanyAuthority(pool, TENANT, ana.principalId)).companyKeys;
    assert.deepEqual(keys, ["taylor", "ventana"]);
    const mine = await readMyCompanyAuthority(pool, TENANT, ana.principalId);
    assert.deepEqual(mine.companies.map((c) => c.operatingCompanyId), ["taylor", "ventana"]);
    assert.ok(mine.companies.every((c) => typeof c.businessTimeZone === "string" && c.businessTimeZone.length > 0));

    // Replaying the same digest is stale (the state moved).
    refused(await as(ADMIN_SUBJECT, "grantCompanyAuthority", { ...input, previewDigest: fresh.digests.previewDigest }, MAND), /STALE_PREVIEW/, "replay");
  });

  await t.test("6. AUDIT: one event per real change, with before/after, the stated reason, the actor and the preview mark; an identical grant is idempotent", async () => {
    const rows = await auditRows("grantCompanyAuthority");
    const mine = rows.filter((r) => r.after?.employeeId === "e-ana");
    assert.equal(mine.length, 1);
    const [event] = mine;
    assert.equal(event.target_kind, "companyAuthorityGrant");
    assert.equal(event.before, null);
    assert.equal(event.after.operatingCompanyId, "ventana");
    assert.equal(event.after.status, "active");
    assert.equal(event.reason.startsWith(REASON), true);
    assert.equal(event.actor_uid, (await q(`SELECT id FROM eos_policy.principals WHERE external_subject = $1`, [ADMIN_SUBJECT])).rows[0].id);
    assert.equal(event.after.authorityChange.mode, "HUMAN_PREVIEWED");
    assert.equal(event.after.authorityChange.previewed, true);
    assert.match(event.after.authorityChange.previewDigest, /^[0-9a-f]{64}$/);
    assert.equal(event.target_id, (await grantsOf("e-ana"))[0].id);

    const total = await allGrantAudit();
    const again = okData(await as(ADMIN_SUBJECT, "grantCompanyAuthority", grantInput("e-ana", "ventana")), "identical grant");
    assert.equal(again.id, (await grantsOf("e-ana"))[0].id, "the existing row is returned");
    assert.equal((await grantsOf("e-ana")).length, 1);
    assert.equal(await allGrantAudit(), total, "an identical grant is not a change and writes no audit event");
    refused(await as(ADMIN_SUBJECT, "grantCompanyAuthority", grantInput("e-ana", "ventana", { effectiveUntil: new Date(Date.now() + 86_400_000).toISOString() })), /COMPANY_GRANT_EXISTS/, "a different window is not silently merged");

    // The audit history read serves the event under the Employee.
    const history = okData(await as(ADMIN_SUBJECT, "readPolicyAuditHistory", { employeeId: "e-ana", limit: 50 }), "audit history");
    assert.ok(JSON.stringify(history).includes("grantCompanyAuthority"), "the Administration audit history carries it");
  });

  await t.test("7. THE GRANT IS REACH ONLY: a person without the capability gains nothing usable; a person with it acts in the granted company", async () => {
    // ana holds a company grant at Ventana but not the returns-intake capability.
    const withGrantNoCapability = await intake(ana, "ventana");
    assert.notEqual(withGrantNoCapability.status, 200, "reach without the capability does nothing");
    // ric holds the capability and NOT yet the company.
    const noReach = await intake(ric, "ventana");
    assert.equal(noReach.status === 200, false);
    assert.equal(noReach.body.code, "INVALID_INPUT");
    assert.match(noReach.body.message, /not an active operating company you may act for/);
    assert.equal((await intake(ric, "taylor")).status, 200, "the home company always worked");
    okData(await as(ADMIN_SUBJECT, "grantCompanyAuthority", grantInput("e-ric", "ventana")), "grant ric");
    assert.equal((await intake(ric, "ventana")).status, 200, "capability + company = it works");
    assert.equal((await intake(ric, "delta")).status === 200, false, "and only the granted company");
  });

  await t.test("8. FINANCE IS SEPARATE: a Finance-only assignment plus a grant gives operational reach from the grant only, and Finance reach never moves", async () => {
    assert.deepEqual(await companies(fo), ["taylor"], "a FINANCE_ONLY assignment at Ventana names no operational company");
    assert.deepEqual(await financeCompanies(fo), ["ventana"]);
    const financeBefore = await financeCompanies(fo);
    okData(await as(ADMIN_SUBJECT, "grantCompanyAuthority", grantInput("e-fo", "ventana")), "grant fo");
    assert.deepEqual(await companies(fo), ["taylor", "ventana"], "operational reach comes from the grant");
    assert.deepEqual(await financeCompanies(fo), financeBefore, "Finance reach is unchanged");
    // fo2 holds Finance at TAYLOR only.
    assert.deepEqual(await financeCompanies(fo2), ["taylor"]);
    okData(await as(ADMIN_SUBJECT, "grantCompanyAuthority", grantInput("e-fo2", "ventana")), "grant fo2");
    assert.deepEqual(await companies(fo2), ["taylor", "ventana"]);
    assert.deepEqual(await financeCompanies(fo2), ["taylor"], "a company-access grant does not give Finance access to the company");
    const finance = await call(fo2, FIN, "listObligations", { operatingCompanyId: "ventana" });
    assert.equal(finance.status === 200, false);
    assert.equal(finance.body.code, "OUTSIDE_OPERATING_COMPANY_SCOPE");
  });

  await t.test("9. REVOCATION IS IMMEDIATE: previewed, committed with the digest, audited once, and the next request has no reach", async () => {
    const grant = (await grantsOf("e-ana"))[0];
    const input = { grantId: grant.id, reason: "cover ended" };
    refused(await as(ADMIN_SUBJECT, "revokeCompanyAuthority", input, MAND), /PREVIEW_REQUIRED/, "revoke needs the digest too");
    const p = okData(await as(ADMIN_SUBJECT, "previewAuthorityChange", { change: { operation: "revokeCompanyAuthority", input } }, MAND));
    assert.equal(p.outcome, "WOULD_APPLY");
    assert.deepEqual(p.affected[0].changes.companyAuthority, { added: [], removed: ["ventana"] });
    assert.deepEqual(Object.keys(p.affected[0].changes), ["companyAuthority"]);
    const before = await allGrantAudit();
    const row = okData(await as(ADMIN_SUBJECT, "revokeCompanyAuthority", { ...input, previewDigest: p.digests.previewDigest }, MAND), "revoke");
    assert.equal(row.status, "revoked");
    assert.ok(row.revokeReason.startsWith("cover ended"), row.revokeReason);
    assert.deepEqual(await companies(ana), ["taylor"], "the very next resolve has no Ventana");
    assert.equal(await allGrantAudit(), before + 1);
    const event = (await auditRows("revokeCompanyAuthority")).find((r) => r.target_id === grant.id);
    assert.equal(event.before.status, "active");
    assert.equal(event.after.status, "revoked");
    assert.equal(event.after.revokedBy, row.revokedBy);
    assert.ok(event.reason.startsWith("cover ended"), event.reason);
    refused(await as(ADMIN_SUBJECT, "revokeCompanyAuthority", { grantId: grant.id, reason: "again" }), /COMPANY_GRANT_NOT_ACTIVE/, "revoking a revoked grant");
    // The same for ric, in the world: the next request is refused at once.
    const ricGrant = (await grantsOf("e-ric"))[0];
    okData(await as(ADMIN_SUBJECT, "revokeCompanyAuthority", { grantId: ricGrant.id, reason: "done" }), "revoke ric");
    const after = await intake(ric, "ventana");
    assert.equal(after.status === 200, false, "revoked reach is gone on the next request");
    assert.equal(after.body.code, "INVALID_INPUT");
    // History is kept, and a later grant is a new row.
    okData(await as(ADMIN_SUBJECT, "grantCompanyAuthority", grantInput("e-ana", "ventana")), "grant again");
    assert.equal((await grantsOf("e-ana")).length, 2);
    assert.deepEqual((await grantsOf("e-ana")).map((r) => r.status), ["revoked", "active"]);
    // The list read shows both, with the history, and offers no home or already-granted company.
    const view = okData(await as(ADMIN_SUBJECT, "listEmployeeCompanyAuthority", { employeeId: "e-ana" }), "list");
    assert.equal(view.homeOperatingCompanyId, "taylor");
    assert.deepEqual(view.grants.map((g) => g.displayState), ["REVOKED", "ACTIVE"]);
    assert.deepEqual(view.grantableCompanies.map((c) => c.value), ["delta"], "not the home company, not Ventana (already granted), not an INACTIVE company");
    okData(await as(ADMIN_SUBJECT, "revokeCompanyAuthority", { grantId: (await grantsOf("e-ana"))[1].id, reason: "tidy" }), "revoke the second");
    assert.deepEqual(await companies(ana), ["taylor"]);
  });

  await t.test("10. EFFECTIVE DATES ARE SERVER TIME: a future start does not apply yet; an end in the near future expires on the database clock; an expired-but-unrevoked grant blocks a regrant until revoked", async () => {
    const hour = 3_600_000;
    const scheduled = okData(await as(ADMIN_SUBJECT, "grantCompanyAuthority", grantInput("e-win1", "ventana", {
      effectiveFrom: new Date(Date.now() + hour).toISOString(), effectiveUntil: new Date(Date.now() + 2 * hour).toISOString() })), "scheduled");
    assert.deepEqual(await companies(win1), ["delta", "taylor"], "a future effective_from does not apply yet (win1 holds only the open-ended Delta grant made in test 5)");
    const listed = okData(await as(ADMIN_SUBJECT, "listEmployeeCompanyAuthority", { employeeId: "e-win1" }));
    assert.equal(listed.grants.find((g) => g.id === scheduled.id).displayState, "SCHEDULED");

    const until = new Date(Date.now() + 5000).toISOString();
    const expiring = okData(await as(ADMIN_SUBJECT, "grantCompanyAuthority", grantInput("e-win2", "ventana", { effectiveUntil: until })), "expiring");
    assert.equal(new Date(expiring.effectiveUntil).toISOString(), until);
    assert.deepEqual(await companies(win2), ["taylor", "ventana"], "in-window");
    await sleep(5600);
    assert.deepEqual(await companies(win2), ["taylor"], "expired on the database clock, with no job and no revoke");
    assert.equal((await grantsOf("e-win2"))[0].status, "active", "the row is still 'active': expiry is a read-time fact");
    assert.equal(okData(await as(ADMIN_SUBJECT, "listEmployeeCompanyAuthority", { employeeId: "e-win2" })).grants[0].displayState, "EXPIRED");
    refused(await as(ADMIN_SUBJECT, "grantCompanyAuthority", grantInput("e-win2", "ventana")), /COMPANY_GRANT_EXISTS/, "an expired-but-unrevoked grant must be revoked first");
    okData(await as(ADMIN_SUBJECT, "revokeCompanyAuthority", { grantId: expiring.id, reason: "expired; tidy" }), "revoke the expired grant");
    okData(await as(ADMIN_SUBJECT, "grantCompanyAuthority", grantInput("e-win2", "ventana")), "regrant");
    assert.deepEqual(await companies(win2), ["taylor", "ventana"]);
  });

  await t.test("11. IDENTITY FIRST: an Employee with no access-eligible link gets nothing, grants or not; an INACTIVE company is ignored", async () => {
    okData(await as(ADMIN_SUBJECT, "grantCompanyAuthority", grantInput("e-nolink", "ventana")), "grant to an unlinked Employee is allowed (it is inert)");
    okData(await as(ADMIN_SUBJECT, "grantCompanyAuthority", grantInput("e-term", "ventana")), "grant to a terminated Employee is allowed (it is inert)");
    const unlinked = await resolveCompanyAuthority(pool, TENANT, nolink.principalId);
    assert.deepEqual([unlinked.companies, unlinked.gap], [[], "EMPLOYEE_LINK_REQUIRED"]);
    const terminated = await resolveCompanyAuthority(pool, TENANT, term.principalId);
    assert.deepEqual([terminated.companies, terminated.gap], [[], "EMPLOYEE_NOT_ACCESS_ELIGIBLE"]);
    // A grant to a company that later turns INACTIVE stops counting.
    okData(await as(ADMIN_SUBJECT, "grantCompanyAuthority", grantInput("e-inact", "delta")), "grant delta");
    assert.deepEqual(await companies(inact), ["delta", "taylor"]);
    await q(`UPDATE eos_policy.tenant_operating_companies SET status = 'INACTIVE' WHERE tenant_id = $1 AND operating_company_id = 'delta'`, [TENANT]);
    assert.deepEqual(await companies(inact), ["taylor"], "the ACTIVE-company filter still applies to a grant");
    await q(`UPDATE eos_policy.tenant_operating_companies SET status = 'ACTIVE' WHERE tenant_id = $1 AND operating_company_id = 'delta'`, [TENANT]);
    assert.deepEqual(await companies(inact), ["delta", "taylor"]);
  });

  await t.test("12. THE STORE GUARD: an ungoverned write is refused; a governed one is bound by the table's own constraints; history is never deleted", async () => {
    const row = okData(await as(ADMIN_SUBJECT, "grantCompanyAuthority", grantInput("e-guardee", "ventana")), "guard subject");
    const insert = (id, extra = {}) => {
      const v = { id, employee: "e-guardee", company: "delta", reason: "x", from: "now()", until: "NULL", ...extra };
      return `INSERT INTO eos_policy.employee_company_authority_grants (id,tenant_id,employee_id,operating_company_id,reason,granted_by,effective_from,effective_until)
              VALUES ('${v.id}','${TENANT}','${v.employee}','${v.company}','${v.reason}','x',${v.from},${v.until})`;
    };
    // Ungoverned (no Administration command marker): every write is refused by name.
    await assert.rejects(() => q(insert("g-raw")), /COMPANY_GRANT_UNGOVERNED/);
    await assert.rejects(() => q(`UPDATE eos_policy.employee_company_authority_grants SET status = 'revoked', revoked_by = 'x', revoked_at = now(), revoke_reason = 'x' WHERE id = $1`, [row.id]), /COMPANY_GRANT_UNGOVERNED/);
    await assert.rejects(() => q(`DELETE FROM eos_policy.employee_company_authority_grants WHERE id = $1`, [row.id]), /COMPANY_GRANT_UNGOVERNED/);
    await assert.rejects(() => q(`TRUNCATE eos_policy.employee_company_authority_grants`), /governed history/);
    assert.equal((await grantsOf("e-guardee"))[0].status, "active", "nothing moved");
    // Governed: history is never deleted, and an active row only ever moves to revoked.
    await assert.rejects(() => governed((c) => c.query(`DELETE FROM eos_policy.employee_company_authority_grants WHERE id = $1`, [row.id])), /COMPANY_GRANT_UNGOVERNED/);
    await assert.rejects(() => governed((c) => c.query(`UPDATE eos_policy.employee_company_authority_grants SET reason = 'rewritten' WHERE id = $1`, [row.id])), /COMPANY_GRANT_IMMUTABLE/);
    await assert.rejects(() => governed((c) => c.query(`UPDATE eos_policy.employee_company_authority_grants SET operating_company_id = 'delta' WHERE id = $1`, [row.id])), /COMPANY_GRANT_IMMUTABLE/);
    await assert.rejects(() => governed((c) => c.query(`UPDATE eos_policy.employee_company_authority_grants SET effective_until = now() + interval '9 years' WHERE id = $1`, [row.id])), /COMPANY_GRANT_IMMUTABLE/);
    await assert.rejects(() => governed((c) => c.query(`UPDATE eos_policy.employee_company_authority_grants SET status = 'revoked' WHERE id = $1`, [row.id])), /ecag_revoke_has_author|check constraint/);
    // The table's own constraints.
    await assert.rejects(() => governed((c) => c.query(insert("g-dup", { company: "ventana" }))), /ecag_one_active|duplicate key/);
    await assert.rejects(() => governed((c) => c.query(insert("g-home", { company: "taylor" }))), /COMPANY_IS_HOME/);
    await assert.rejects(() => governed((c) => c.query(insert("g-inactive", { company: "dormant" }))), /SCOPE_VALUE_INVALID/);
    await assert.rejects(() => governed((c) => c.query(insert("g-over", { from: "now() - interval '2 hours'", until: "now() - interval '1 hour'" }))), /COMPANY_GRANT_WINDOW_INVALID/);
    await assert.rejects(() => governed((c) => c.query(insert("g-window", { from: "now() + interval '2 hours'", until: "now() + interval '1 hour'" }))), /ecag_window|check constraint/);
    await assert.rejects(() => governed((c) => c.query(insert("g-blank", { reason: " " }))), /ecag_reason_stated|check constraint/);
    await assert.rejects(() => governed((c) => c.query(insert("g-ghost", { employee: "e-ghost" }))), /ecag_employee_fk|foreign key/);
    assert.deepEqual((await grantsOf("e-guardee")).map((r) => r.id), [row.id], "every rejected write left nothing behind");
    // The legal transition, written by hand under the marker, is accepted (what the command does).
    await governed((c) => c.query(`UPDATE eos_policy.employee_company_authority_grants SET status = 'revoked', revoked_by = 'x', revoked_at = now(), revoke_reason = 'guard test' WHERE id = $1`, [row.id]));
    assert.equal((await grantsOf("e-guardee"))[0].status, "revoked");
  });

  await t.test("13. THE PREVIEW NEVER COMMITS: a preview of a grant leaves no row, no audit event and no trace", async () => {
    const tables = await q(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'eos_policy' AND table_type = 'BASE TABLE' ORDER BY 1`);
    const hash = async () => Object.fromEntries(await Promise.all(tables.rows.map(async ({ table_name: n }) =>
      [n, (await q(`SELECT count(*)::int n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) h FROM eos_policy.${n} x`)).rows[0]])));
    const before = await hash();
    const p = okData(await as(ADMIN_SUBJECT, "previewAuthorityChange", { change: { operation: "grantCompanyAuthority", input: grantInput("e-guardee", "delta") } }, MAND));
    assert.equal(p.outcome, "WOULD_APPLY");
    assert.deepEqual(await hash(), before);
    const refusedPreview = okData(await as(ADMIN_SUBJECT, "previewAuthorityChange", { change: { operation: "grantCompanyAuthority", input: grantInput("e-guardee", "taylor") } }, MAND));
    assert.equal(refusedPreview.outcome, "WOULD_REFUSE");
    assert.equal(refusedPreview.refusal.code, "COMPANY_IS_HOME");
    assert.deepEqual(await hash(), before);
  });

  await t.test("14. THE MIGRATION REVERSES: the down refuses while a grant is ACTIVE, and drops the table once none is", async () => {
    const migrate = (direction, count) => execFileSync(process.execPath, [
      "node_modules/node-pg-migrate/bin/node-pg-migrate.js", direction, "--migrations-dir", "migrations", "--no-check-order", ...(count === undefined ? [] : [String(count)]),
    ], { maxBuffer: 256 * 1024 * 1024, cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "pipe" });
    // Firebase exit B1 appended 1764620000000 (finance visibility mirror + credit trigger): its reversal is clean (nothing names it), so
    // it is peeled first and this proof still runs against ITS OWN migration, which the final `up` below restores along with it.
    const newest = async () => (await q(`SELECT name FROM public.pgmigrations ORDER BY id DESC LIMIT 1`)).rows[0].name;
    // Firebase exit B3 appended 1764630000000 (warehouse receiving + bins on EOS): its down is guarded and clean when nothing was written to it, so it is peeled first too.
    // Firebase exit B4 appended 1764640000000 (records and reporting on EOS): its down refuses only if a row was written to its tables, and nothing here wrote one, so it is peeled first.
    // B4 report / goal parity (1764650000000) wrote only role_capabilities rows, so its down is clean here and it is peeled before the migration that registered the keys.
    // P-1 supplier PO authoring (1764660000000): its down refuses only if an order, a number, a command record, a decision or a direct grant names it, and nothing here wrote one, so it is peeled first of all.
    if ((await newest()) === "1764660000000_supplier-po-authoring") migrate("down", 1);
    if ((await newest()) === "1764650000000_b4-report-goal-grant-parity") migrate("down", 1);
    if ((await newest()) === "1764640000000_records-reporting-on-eos") migrate("down", 1);
    if ((await newest()) === "1764630000000_warehouse-receiving-bins-on-eos") migrate("down", 1);
    if ((await newest()) === "1764620000000_finance-visibility-and-credit-immutability") migrate("down", 1);
    const last = await newest();
    assert.equal(last, "1764610000000_employee-company-authority-grants", "this is the newest migration (after the later finance visibility migration is peeled)");
    const active = Number((await q(`SELECT count(*)::int n FROM eos_policy.employee_company_authority_grants WHERE status = 'active'`)).rows[0].n);
    assert.ok(active > 0, "there are ACTIVE grants to refuse on");
    let failure = null;
    try { migrate("down", 1); } catch (e) { failure = `${e.stderr ?? ""}${e.stdout ?? ""}${e.message}`; }
    assert.match(failure ?? "", /refuses to reverse|ACTIVE company-access grant/, "the down refuses while a grant is active");
    assert.equal(Number((await q(`SELECT count(*)::int n FROM eos_policy.employee_company_authority_grants`)).rows[0].n) > 0, true, "and destroyed nothing");
    // Revoke every active grant (the governed command), then the down succeeds.
    for (const g of (await q(`SELECT id FROM eos_policy.employee_company_authority_grants WHERE tenant_id = $1 AND status = 'active'`, [TENANT])).rows) {
      okData(await as(ADMIN_SUBJECT, "revokeCompanyAuthority", { grantId: g.id, reason: "down-path test" }), `revoke ${g.id}`);
    }
    migrate("down", 1);
    assert.equal((await q(`SELECT to_regclass('eos_policy.employee_company_authority_grants') AS t`)).rows[0].t, null, "the table is gone");
    assert.equal((await q(`SELECT count(*)::int n FROM pg_proc WHERE proname = 'employee_company_authority_grants_governed'`)).rows[0].n, 0, "and its guard function");
    // Up again: the table returns empty (default-inert).
    migrate("up");
    assert.equal(Number((await q(`SELECT count(*)::int n FROM eos_policy.employee_company_authority_grants`)).rows[0].n), 0);
    assert.deepEqual(await companies(ana), ["taylor"]);
  });
});
