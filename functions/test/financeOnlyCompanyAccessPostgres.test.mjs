// FINANCE-ONLY COMPANY ASSIGNMENTS GRANT FINANCE REACH ONLY (Owner ruling "FINANCE COMPANY ACCESS AND ATTRIBUTION" item 1,
// 2026-10-17; DECISIONS #248), against a real PostgreSQL on the baseline-equal service tenant.
//
// The defect: EOS Core company authority (#235 rule 3) added every company named by ANY operatingCompany-scoped assignment, so
// `financeCompanyAccess@ventana` -- a Financials company assignment -- also opened Ventana for return intake, scheduling and
// every other company-scoped operation. The correction is governed DATA on the Role (roles.company_authority_effect, written
// only by updateRole): a FINANCE_ONLY Role's assignment supplies Finance reach and names no company in general authority.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";
import { assignFinanceCompanies, FINANCE_COMPANY_ACCESS_ROLE } from "./support/financeCompanyAccess.mjs";

const require = createRequire(import.meta.url);
const { resolveCompanyAuthority, readMyCompanyAuthority } = require("../lib/eosOps/companyAuthority.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-fonly";
const OTHER = "t-fonly-other";
const FIN = "/operations/finance", INV = "/operations/inventory", WO = "/operations/work-orders";
const REASON = "FINANCE_ONLY classification (local test tenant only)";

test("Finance-only company assignments grant Finance reach only, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, pool, call, repo } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "fonly" });
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body).slice(0, 500)}`); return r.body.result; };
  const refusedWith = (r, code, what = "") => { assert.equal(r.body.code, code, `${what} ${JSON.stringify(r.body).slice(0, 400)}`); assert.notEqual(r.status, 200); };
  const roleOf = async (key) => (await repo.getRoleByKey(TENANT, key));
  const effectOf = async (key) => (await q(`SELECT company_authority_effect AS e FROM eos_policy.roles WHERE tenant_id = $1 AND key = $2`, [TENANT, key])).rows[0].e;
  const companies = async (who) => (await resolveCompanyAuthority(pool, TENANT, who.principalId)).companies;
  const financeCompanies = async (who) => ok(await call(who, FIN, "readMyFinanceCompanyAccess", {})).companies.map((c) => c.operatingCompanyId);
  const grant = async (roleKey, key) => {
    const c = (await q(`SELECT object_key, action_key FROM eos_policy.capabilities WHERE key = $1`, [key])).rows[0];
    return admin("grantObjectActionToRole", { roleKey, objectKey: c.object_key, actionKey: c.action_key, reason: "local test tenant only" });
  };
  const classify = async (roleKey, companyAuthorityEffect) =>
    admin("updateRole", { roleId: (await roleOf(roleKey)).id, companyAuthorityEffect, reason: REASON });
  const assignAt = async (who, roleKey, company) => {
    const r = await admin("assignRole", { principalId: who.principalId, roleId: (await roleOf(roleKey)).id, scopeType: "operatingCompany", scopeValue: company, reason: "local test tenant only" });
    assert.equal(r.ok, true, `${who.subject}/${roleKey}@${company} ${JSON.stringify(r).slice(0, 300)}`);
  };

  // ── the migration changed nothing: every Role is OPERATIONAL until Administration says otherwise ──
  assert.equal(Number((await q(`SELECT count(*)::int AS n FROM eos_policy.roles WHERE company_authority_effect <> 'OPERATIONAL'`)).rows[0].n), 0);

  // ── people: Taylor home, a Ventana technician, and a scheduler / return clerk with only a Finance assignment at Ventana ──
  await person("uid-vtech", ["technician"], { id: "e-vtech", name: "Val Ventana-Tech", company: "ventana", technician: true });
  const fo = await person("uid-fo", ["dispatcher", "inventoryReturnsIntakeClerk"], { id: "e-fo", name: "Fin Dispatcher" });
  const mixed = await person("uid-mixed", ["dispatcher"], { id: "e-mixed", name: "Mixed Ops" });
  const both = await person("uid-both", ["dispatcher"], { id: "e-both", name: "Both Same Company" });
  const bothT = await person("uid-bothT", ["dispatcher"], { id: "e-botht", name: "Both Other Company" });
  const gm = await person("uid-gm", ["generalManager"], { id: "e-gm", name: "Gale GM" });
  const ctrl = await person("uid-ctrl", ["controller"], { id: "e-ctrl", name: "Sage Controller" });
  const unassigned = await person("uid-ctrl2", ["controller"], { id: "e-ctrl2", name: "Unassigned Controller" });
  const sysadmin = await person("uid-sysadmin", ["admin"], { id: "e-sysadmin", name: "Rowan Administrator" });

  // The Financials company assignment exactly as nonprod has it: a custom Role holding finance.payment.read, assigned per company.
  await assignFinanceCompanies({ admin, q, tenant: TENANT }, [fo, both, bothT], ["ventana"]);
  await assignFinanceCompanies({ admin, q, tenant: TENANT }, [gm, ctrl]);
  // A second Finance-only Role (the Financial Policy shape) and a MIXED Role (operational AND finance capabilities).
  assert.equal((await admin("createRole", { key: "financialPolicyPreparer", name: "Financial Policy Preparer", reason: "local test tenant only" })).ok, true);
  assert.equal((await grant("financialPolicyPreparer", "finance.policy.prepare")).ok, true);
  assert.equal((await admin("createRole", { key: "ventanaOffice", name: "Ventana Office", reason: "local test tenant only" })).ok, true);
  assert.equal((await grant("ventanaOffice", "finance.payment.read")).ok, true);
  assert.equal((await grant("ventanaOffice", "workOrder.record.read")).ok, true);
  await assignAt(mixed, "ventanaOffice", "ventana");
  await assignAt(both, "ventanaOffice", "ventana");
  await assignAt(bothT, "ventanaOffice", "taylor");

  await t.test("BEFORE classification nothing moves (the deploy is behaviour-preserving): the Finance assignment still expands company authority", async () => {
    assert.deepEqual(await companies(fo), ["taylor", "ventana"]);
    assert.equal(await effectOf(FINANCE_COMPANY_ACCESS_ROLE), "OPERATIONAL");
  });

  await t.test("CLASSIFY (governed): updateRole, a stated reason, one audit event with before/after", async () => {
    const roleId = (await roleOf(FINANCE_COMPANY_ACCESS_ROLE)).id;
    const noReason = await admin("updateRole", { roleId, companyAuthorityEffect: "FINANCE_ONLY" });
    assert.equal(noReason.ok, false, "the request id alone is not a reason");
    assert.equal(await effectOf(FINANCE_COMPANY_ACCESS_ROLE), "OPERATIONAL");
    const r = await classify(FINANCE_COMPANY_ACCESS_ROLE, "FINANCE_ONLY");
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
    assert.equal(await effectOf(FINANCE_COMPANY_ACCESS_ROLE), "FINANCE_ONLY");
    const audit = (await q(`SELECT before, after, reason, actor_uid FROM eos_policy.audit_events WHERE tenant_id = $1 AND action = 'updateRole' AND target_id = $2`, [TENANT, roleId])).rows;
    assert.equal(audit.length, 1, "exactly one audit event");
    assert.equal(audit[0].before.companyAuthorityEffect, "OPERATIONAL");
    assert.equal(audit[0].after.companyAuthorityEffect, "FINANCE_ONLY");
    assert.match(audit[0].reason, /FINANCE_ONLY classification/);
    // The same value again is no mutation: no second audit event.
    assert.equal((await classify(FINANCE_COMPANY_ACCESS_ROLE, "FINANCE_ONLY")).ok, true);
    assert.equal(Number((await q(`SELECT count(*)::int AS n FROM eos_policy.audit_events WHERE tenant_id = $1 AND action = 'updateRole' AND target_id = $2`, [TENANT, roleId])).rows[0].n), 1);
    assert.equal((await classify("financialPolicyPreparer", "FINANCE_ONLY")).ok, true);
  });

  await t.test("1+2: Finance reads work at the assigned company, and general company authority is UNCHANGED by the Finance-only assignment", async () => {
    assert.deepEqual(await companies(fo), ["taylor"], "the Ventana Finance assignment names no company in general authority");
    assert.deepEqual((await resolveCompanyAuthority(pool, TENANT, fo.principalId)).companyKeys, ["taylor"]);
    assert.deepEqual((await readMyCompanyAuthority(pool, TENANT, fo.principalId)).companies.map((c) => c.operatingCompanyId), ["taylor"]);
    assert.deepEqual(await financeCompanies(fo), ["ventana"], "Finance reach is exactly the assignment");
    const list = ok(await call(fo, FIN, "listObligations", { operatingCompanyId: "ventana" }));
    assert.ok(Array.isArray(list.items), "listObligations answers for the assigned company");
    refusedWith(await call(fo, FIN, "listObligations", { operatingCompanyId: "taylor" }), "OUTSIDE_OPERATING_COMPANY_SCOPE", "no Finance reach at the company it is not assigned");
  });

  await t.test("3: return intake, scheduling and dispatch for Ventana stay refused without separate operational authority", async () => {
    const intake = (company, key) => call(fo, INV, "recordReturnIntake", { operatingCompanyId: company, partId: "PRT-1", source: "CUSTOMER", condition: "OPENED", quantity: 1, idempotencyKey: key });
    const ventana = await intake("ventana", "k-v");
    refusedWith(ventana, "INVALID_INPUT", "Ventana return intake");
    assert.match(ventana.body.message, /not an active operating company you may act for/);
    const unknown = await intake("nope", "k-n");
    assert.deepEqual([unknown.status, unknown.body.code, unknown.body.message], [ventana.status, ventana.body.code, ventana.body.message], "out of scope reads like unknown");
    assert.equal((await intake("taylor", "k-t")).status, 200, "the home company still works");
    const pto = { employeeId: "e-vtech", kind: "PTO", start: "2030-10-20T00:00:00Z", end: "2030-10-21T00:00:00Z", reason: "fonly" };
    refusedWith(await call(fo, WO, "recordTechnicianUnavailability", pto), "EMPLOYEE_NOT_FOUND", "a Ventana technician is not the caller's to schedule");
    // The control: the same command for the same technician succeeds for a caller whose Ventana assignment is operational.
    assert.equal((await call(mixed, WO, "recordTechnicianUnavailability", pto)).status, 200, "a mixed Role's Ventana assignment still reaches Ventana");
  });

  await t.test("4: MIXED assignments -- a Role with operational and Finance capabilities still expands; Finance-only plus operational, same or different company", async () => {
    assert.equal(await effectOf("ventanaOffice"), "OPERATIONAL");
    assert.deepEqual(await companies(mixed), ["taylor", "ventana"], "a mixed Role names the company");
    assert.deepEqual(await companies(both), ["taylor", "ventana"], "Finance-only + operational at the SAME company: the operational one expands");
    assert.deepEqual(await companies(bothT), ["taylor"], "Finance-only at Ventana + operational at Taylor: Ventana is Finance reach only");
    assert.deepEqual(await financeCompanies(bothT), ["taylor", "ventana"], "its Finance reach is the union of both assignments' finance.payment.read");
    // A mixed Role cannot be classified FINANCE_ONLY, and the refusal changes nothing.
    const refused = await classify("ventanaOffice", "FINANCE_ONLY");
    assert.equal(refused.ok, false);
    assert.match(JSON.stringify(refused), /FINANCE_ONLY_CLASSIFICATION_REFUSED/);
    assert.equal(await effectOf("ventanaOffice"), "OPERATIONAL");
  });

  await t.test("5: no cross-tenant widening -- the classification is per tenant, and another tenant's principal has no authority here", async () => {
    await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [OTHER]);
    await q(`INSERT INTO eos_policy.roles (id,tenant_id,key,name,origin,created_by,updated_by) VALUES ('role-other-fca',$1,$2,'x','CUSTOM','f','f')`, [OTHER, FINANCE_COMPANY_ACCESS_ROLE]);
    const other = (await q(`SELECT company_authority_effect AS e FROM eos_policy.roles WHERE id = 'role-other-fca'`)).rows[0].e;
    assert.equal(other, "OPERATIONAL", "classifying this tenant's Role touched no other tenant's");
    assert.equal((await resolveCompanyAuthority(pool, OTHER, fo.principalId)).gap, "PRINCIPAL_NOT_ACTIVE");

    // The other tenant gets its own people and the SAME-KEY Role, assigned at Ventana; its classification is its own.
    for (const c of ["taylor", "ventana"]) {
      await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by) VALUES ($1,$2,'ACTIVE','fixture','fixture','fixture')`, [OTHER, c]);
    }
    await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status) VALUES ('p-other','p-other','eos','active')`);
    await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status) VALUES ('m-p-other',$1,'p-other','active')`, [OTHER]);
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,display_name) VALUES ('e-other',$1,'ACTIVE','taylor','Other Tenant Person')`, [OTHER]);
    await q(`INSERT INTO eos_policy.employee_principal_links (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
             VALUES ('l-other',$1,'p-other','e-other','taylor','OPERATOR_ASSERTED','active','f','f')`, [OTHER]);
    await q(`INSERT INTO eos_policy.user_role_assignments (id,tenant_id,principal_id,role_id,scope_type,scope_value,status,granted_by,access_version_at_grant,created_by,updated_by)
             VALUES ('ura-other',$1,'p-other','role-other-fca','operatingCompany','ventana','active','f',0,'f','f')`, [OTHER]);
    // Classification is a governed act; this raw transaction stands in for the other tenant's Administrator (the marker the command sets).
    const classifyOther = async (effect) => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query(`SELECT set_config('eos_policy.administration_command', 'on', true)`);
        if (effect === "FINANCE_ONLY") {
          await c.query(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
                         SELECT 'rc_other_fin', $1, 'role-other-fca', c.id, 'f','f','f' FROM eos_policy.capabilities c WHERE c.key = 'finance.payment.read'
                         ON CONFLICT DO NOTHING`, [OTHER]);
        }
        await c.query(`UPDATE eos_policy.roles SET company_authority_effect = $1 WHERE id = 'role-other-fca'`, [effect]);
        await c.query("COMMIT");
      } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
    };
    const here = async () => ({ fo: await companies(fo), foFinance: await financeCompanies(fo), mixed: await companies(mixed), role: await effectOf(FINANCE_COMPANY_ACCESS_ROLE) });
    const hereBefore = await here();
    assert.deepEqual(hereBefore, { fo: ["taylor"], foFinance: ["ventana"], mixed: ["taylor", "ventana"], role: "FINANCE_ONLY" });
    assert.deepEqual((await resolveCompanyAuthority(pool, OTHER, "p-other")).companies, ["taylor", "ventana"], "the other tenant's same-key Role is still OPERATIONAL");

    await classifyOther("FINANCE_ONLY");
    assert.deepEqual((await resolveCompanyAuthority(pool, OTHER, "p-other")).companies, ["taylor"], "classified there, narrowed there");
    assert.deepEqual(await here(), hereBefore, "...and this tenant's company authority and Finance reach did not move");

    await classifyOther("OPERATIONAL");
    assert.deepEqual((await resolveCompanyAuthority(pool, OTHER, "p-other")).companies, ["taylor", "ventana"], "widened there");
    assert.deepEqual(await here(), hereBefore, "...and this tenant's Finance-only Role is still Finance-only");
  });

  await t.test("6: no Administrator bypass -- Administrator standing reaches no company, in general authority or Finance", async () => {
    assert.deepEqual(await companies(sysadmin), ["taylor"], "only the home company; standing implies none");
    const view = await call(sysadmin, FIN, "readMyFinanceCompanyAccess", {});
    assert.deepEqual(view.status === 200 ? view.body.result.companies : [], [], "standing reaches no Finance company without an assignment");
    refusedWith(await call(sysadmin, FIN, "listObligations", { operatingCompanyId: "ventana" }), view.status === 200 ? "OUTSIDE_OPERATING_COMPANY_SCOPE" : "CAPABILITY_REQUIRED");
  });

  await t.test("7: the existing Finance personas keep exactly their Finance reach; their operational reach is their home company", async () => {
    assert.deepEqual(await financeCompanies(gm), ["taylor", "ventana"]);
    assert.deepEqual(await financeCompanies(ctrl), ["taylor", "ventana"]);
    assert.deepEqual(await financeCompanies(unassigned), [], "capability without a company assignment reaches no company");
    for (const who of [gm, ctrl, unassigned]) assert.deepEqual(await companies(who), ["taylor"], "Finance assignments name no operational company");
    ok(await call(gm, FIN, "listObligations", { operatingCompanyId: "consolidated" }));
  });

  await t.test("8: GOVERNED -- an ungoverned write is refused at the store, the governed one is audited, grants cannot contradict it", async () => {
    // A direct write (no Administration command) cannot change the classification, either way.
    await assert.rejects(() => q(`UPDATE eos_policy.roles SET company_authority_effect = 'OPERATIONAL' WHERE tenant_id = $1 AND key = $2`, [TENANT, FINANCE_COMPANY_ACCESS_ROLE]),
      /COMPANY_AUTHORITY_EFFECT_UNGOVERNED/);
    await assert.rejects(() => q(`UPDATE eos_policy.roles SET company_authority_effect = 'FINANCE_ONLY' WHERE tenant_id = $1 AND key = 'dispatcher'`, [TENANT]),
      /COMPANY_AUTHORITY_EFFECT_UNGOVERNED/);
    assert.equal(await effectOf(FINANCE_COMPANY_ACCESS_ROLE), "FINANCE_ONLY");
    assert.equal(await effectOf("dispatcher"), "OPERATIONAL");
    // A non-finance capability cannot be inserted into a FINANCE_ONLY Role by any writer; the command refuses it first.
    const refused = await grant(FINANCE_COMPANY_ACCESS_ROLE, "workOrder.record.read");
    assert.equal(refused.ok, false);
    assert.match(JSON.stringify(refused), /FINANCE_ONLY_ROLE_NON_FINANCE_CAPABILITY/);
    await assert.rejects(() => q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
        SELECT 'rc_fonly_direct', $1, r.id, c.id, 'f','f','f' FROM eos_policy.roles r, eos_policy.capabilities c
         WHERE r.tenant_id = $1 AND r.key = $2 AND c.key = 'workOrder.record.read'`, [TENANT, FINANCE_COMPANY_ACCESS_ROLE]),
      /FINANCE_ONLY_ROLE_NON_FINANCE_CAPABILITY/);
    // A finance.* key is still welcome; a person without Administration authority cannot classify.
    assert.equal((await grant(FINANCE_COMPANY_ACCESS_ROLE, "finance.policy.read")).ok, true);
    // A MOVE is an entry too: re-pointing an existing row at a non-finance capability, or moving a non-finance row INTO the
    // Role, is refused exactly like an insert.
    await assert.rejects(() => q(`UPDATE eos_policy.role_capabilities SET capability_id = (SELECT id FROM eos_policy.capabilities WHERE key = 'workOrder.record.read')
        WHERE tenant_id = $1 AND role_id = (SELECT id FROM eos_policy.roles WHERE tenant_id = $1 AND key = $2)
          AND capability_id = (SELECT id FROM eos_policy.capabilities WHERE key = 'finance.policy.read')`, [TENANT, FINANCE_COMPANY_ACCESS_ROLE]),
      /FINANCE_ONLY_ROLE_NON_FINANCE_CAPABILITY/);
    await assert.rejects(() => q(`UPDATE eos_policy.role_capabilities SET role_id = (SELECT id FROM eos_policy.roles WHERE tenant_id = $1 AND key = $2)
        WHERE tenant_id = $1 AND role_id = (SELECT id FROM eos_policy.roles WHERE tenant_id = $1 AND key = 'ventanaOffice')
          AND capability_id = (SELECT id FROM eos_policy.capabilities WHERE key = 'workOrder.record.read')`, [TENANT, FINANCE_COMPANY_ACCESS_ROLE]),
      /FINANCE_ONLY_ROLE_NON_FINANCE_CAPABILITY/);
    // capabilities.key is NOT immutable in the schema, so renaming a finance key a FINANCE_ONLY Role holds into a non-finance key is refused.
    await assert.rejects(() => q(`UPDATE eos_policy.capabilities SET key = 'zz.renamed.operational' WHERE key = 'finance.policy.read'`),
      /FINANCE_ONLY_ROLE_NON_FINANCE_CAPABILITY/);
    assert.equal(Number((await q(`SELECT count(*)::int AS n FROM eos_policy.capabilities WHERE key = 'finance.policy.read'`)).rows[0].n), 1, "the key is unchanged");
    const ungoverned = await executeAdminOperation({ repo }, { caller: { externalSubject: fo.subject, identityProvider: "firebase" }, operation: "updateRole",
      input: { roleId: (await roleOf(FINANCE_COMPANY_ACCESS_ROLE)).id, companyAuthorityEffect: "OPERATIONAL", reason: REASON }, requestId: "r-fonly-ungoverned" });
    assert.deepEqual([ungoverned.ok, ungoverned.code], [false, "FORBIDDEN"]);
    assert.equal(await effectOf(FINANCE_COMPANY_ACCESS_ROLE), "FINANCE_ONLY");
  });

  // ── 9: THE RACE (two connections, deterministic) ──
  // An invalid FINANCE_ONLY Role / non-finance capability pair must never COMMIT, whichever write arrives first. Lock order on
  // both write paths: the Role row first (the guard's unconditional FOR SHARE; the reclassification's UPDATE), then
  // role_capabilities (the reclassification's check). "Blocked" is asserted from pg_locks (a lock request not granted), never a
  // sleep; every transaction carries a bounded lock_timeout and statement_timeout so a regression FAILS instead of hanging CI;
  // every connection is destroyed in `finally`.
  const raceRole = async (key, financeCapKey = "finance.payment.read") => {
    const id = `role-race-${key}`;
    await q(`INSERT INTO eos_policy.roles (id,tenant_id,key,name,origin,created_by,updated_by) VALUES ($1,$2,$3,$3,'CUSTOM','f','f')`, [id, TENANT, key]);
    await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
             SELECT $3, $1, $2, c.id, 'f','f','f' FROM eos_policy.capabilities c WHERE c.key = $4`, [TENANT, id, `rc-race-${key}`, financeCapKey]);
    return id;
  };
  const raceTxs = [];
  const raceOpen = async () => {
    const c = await pool.connect();
    raceTxs.push(c);
    await c.query("BEGIN");
    await c.query("SET LOCAL lock_timeout = '20s'");
    await c.query("SET LOCAL statement_timeout = '60s'");
    return { c, pid: (await c.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid };
  };
  const waitingOnLock = async (pid) => {
    for (let i = 0; i < 400; i += 1) { // 10 s at most
      if ((await q(`SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted`, [pid])).rows.length > 0) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.fail("the second transaction never waited on a lock: the two writes are not serialised");
  };
  const raceDone = async () => { for (const c of raceTxs.splice(0)) c.release(true); };
  const reclassify = async ({ c }, roleId) => {
    await c.query(`SELECT set_config('eos_policy.administration_command', 'on', true)`); // as the governed command does
    return c.query(`UPDATE eos_policy.roles SET company_authority_effect = 'FINANCE_ONLY' WHERE id = $1`, [roleId]);
  };
  const insertNonFinance = ({ c }, roleId, id) => c.query(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
      SELECT $2, $1, $3, c.id, 'f','f','f' FROM eos_policy.capabilities c WHERE c.key = 'workOrder.record.read'`, [TENANT, id, roleId]);
  const settle = (promise) => promise.then(() => "ok", (e) => e.message);
  const nonFinanceHeld = async () => Number((await q(`SELECT count(*)::int AS n FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id
      JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE r.company_authority_effect = 'FINANCE_ONLY' AND c.key NOT LIKE 'finance.%'`)).rows[0].n);

  await t.test("9a RACE: reclassification in flight, a non-finance insert arrives -> the insert BLOCKS, then is refused; no invalid pair commits", async () => {
    try {
      const role = await raceRole("raceA");
      const a = await raceOpen(); const b = await raceOpen();
      await reclassify(a, role); // A holds the Role row, uncommitted
      const pending = settle(insertNonFinance(b, role, "rc-race-a-bad"));
      await waitingOnLock(b.pid);
      await a.c.query("COMMIT");
      assert.match(await pending, /FINANCE_ONLY_ROLE_NON_FINANCE_CAPABILITY/, "B re-read the committed classification and was refused");
    } finally { await raceDone(); }
    assert.equal(await effectOf("raceA"), "FINANCE_ONLY");
    assert.equal(await nonFinanceHeld(), 0, "no non-finance capability sits on a FINANCE_ONLY Role");
  });

  await t.test("9b RACE: a non-finance insert in flight on an OPERATIONAL Role, the reclassification arrives -> it BLOCKS, then is refused; the Role stays OPERATIONAL", async () => {
    try {
      const role = await raceRole("raceB");
      const b = await raceOpen(); const a = await raceOpen();
      await insertNonFinance(b, role, "rc-race-b-ok"); // B holds the Role row FOR SHARE (Role is OPERATIONAL in its snapshot), uncommitted
      const pending = settle(reclassify(a, role));
      await waitingOnLock(a.pid);
      await b.c.query("COMMIT");
      assert.match(await pending, /FINANCE_ONLY_CLASSIFICATION_REFUSED/, "A saw the committed non-finance row and was refused");
    } finally { await raceDone(); }
    assert.equal(await effectOf("raceB"), "OPERATIONAL");
    assert.equal(await nonFinanceHeld(), 0);
  });

  await t.test("9c RACE: the key-rename guard versus a concurrent reclassification, in both orders", async () => {
    const cap = async (id, key) => q(`INSERT INTO eos_policy.capabilities (id,key,description,object_key,action_key,action_kind,display_label)
      VALUES ($1,$2,'race fixture','raceFixture',$1,'READ','Race')`, [id, key]);
    const give = (roleId, capId, id) => q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by) VALUES ($3,$1,$2,$4,'f','f','f')`,
      [TENANT, roleId, id, capId]);
    const rename = ({ c }, capId) => c.query(`UPDATE eos_policy.capabilities SET key = 'zz.race.nonfinance.' || id WHERE id = $1`, [capId]);
    try {
      // (i) the reclassification is first: the rename waits, then is refused.
      const r1 = await raceRole("raceC1");
      await cap("cap-race-1", "finance.race.one"); await give(r1, "cap-race-1", "rc-race-c1");
      const a = await raceOpen(); const b = await raceOpen();
      await reclassify(a, r1);
      const pending1 = settle(rename(b, "cap-race-1"));
      await waitingOnLock(b.pid);
      await a.c.query("COMMIT");
      assert.match(await pending1, /FINANCE_ONLY_ROLE_NON_FINANCE_CAPABILITY/, "the rename re-read the committed classification and was refused");
      assert.equal((await q(`SELECT key FROM eos_policy.capabilities WHERE id = 'cap-race-1'`)).rows[0].key, "finance.race.one");
      // (ii) the rename is first (uncommitted): the reclassification waits, then sees the committed non-finance key and is refused.
      const r2 = await raceRole("raceC2");
      await cap("cap-race-2", "finance.race.two"); await give(r2, "cap-race-2", "rc-race-c2");
      const d = await raceOpen(); const e = await raceOpen();
      await rename(d, "cap-race-2");
      const pending2 = settle(reclassify(e, r2));
      await waitingOnLock(e.pid);
      await d.c.query("COMMIT");
      assert.match(await pending2, /FINANCE_ONLY_CLASSIFICATION_REFUSED/, "the reclassification saw the committed non-finance key and was refused");
    } finally { await raceDone(); }
    assert.equal(await effectOf("raceC1"), "FINANCE_ONLY");
    assert.equal(await effectOf("raceC2"), "OPERATIONAL");
    assert.equal(await nonFinanceHeld(), 0);
  });

  await t.test("REVERSIBLE and per-Role: widening back is the same governed command and restores the expansion; then the classification is restored", async () => {
    assert.equal((await classify(FINANCE_COMPANY_ACCESS_ROLE, "OPERATIONAL")).ok, true);
    assert.deepEqual(await companies(fo), ["taylor", "ventana"]);
    assert.equal((await classify(FINANCE_COMPANY_ACCESS_ROLE, "FINANCE_ONLY")).ok, true);
    assert.deepEqual(await companies(fo), ["taylor"]);
    assert.equal(Number((await q(`SELECT count(*)::int AS n FROM eos_policy.audit_events WHERE tenant_id = $1 AND action = 'updateRole'`, [TENANT])).rows[0].n) >= 4, true);
  });
});
