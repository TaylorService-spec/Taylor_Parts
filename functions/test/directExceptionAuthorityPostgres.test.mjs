// LANE DX -- DIRECT PRINCIPAL EXCEPTIONS, COMPLETE SUPPORT, against PostgreSQL.
//
// Owner target (Option A): a direct grant in eos_policy.principal_capabilities is a capability SOURCE of the ONE runtime
// resolution (capabilityAuthority.resolveOperationalCapabilities, behind resolveOperationalContext), with a Role grant's
// semantics on every gate. Proved here, table-driven:
//
//   PARITY        a Principal holding K through DIRECT grants gets the SAME decision as a Principal holding K through
//                 an equivalent Role grant, on every gate: eosOps (resolveMyCapabilities + the entitled command seam),
//                 the Commercial kernel, CRM, Workforce, experience surfaces, the Administration read gate, the
//                 Administration mutation gate, the workflow effective-authority half and explainEffectiveAccess --
//                 and a Principal holding nothing is refused on each (non-vacuity).
//   CONDITIONED   a direct grant with an ACTIVE PRINCIPAL-cell condition is conditionallyHeld, NEVER flat, on every gate,
//                 exactly as the equivalent conditioned Role grant.
//   EXPIRED       an expired direct grant confers nothing anywhere and is not shown.
//   INVARIANTS    no self-grant / self-condition; Owner ruling A at the principal (direct, and assignRole after a direct
//                 grant); no scope on a direct grant; anti-lockout counts only unexpired, unconditioned direct holders;
//                 never-widen on retire; tenant isolation; audit exactly once per effective change, none for a no-op.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";
import { seedProtectedOwner } from "./support/protectedOwnerFixture.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
const { bootstrapTenant, bootstrapAdministrator, ensureTenantPrincipal } = require("../lib/adminPolicy/tenantBootstrap.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const capabilityAuthority = require("../lib/eosOps/capabilityAuthority.js");
const composition = require("../lib/eosOps/entitledActionAuthority.js");
const { executeOperation: executeOpsOperation } = require("../lib/eosOps/eosOpsHttp.js");
const { resolveExperienceContext } = require("../lib/eosOps/experienceAuthority.js");
const { explainEffectiveAccess } = require("../lib/eosOps/effectiveAccessExplanation.js");
const { postgresContextualReader } = require("../lib/eosOps/contextualAuthorization.js");
const { operationalWorkflowAuthority } = require("../lib/adminPolicy/workflowAuthority.js");
const { executeCommercialOperation } = require("../lib/eosCommercial/commercialHttp.js");
const { executeCrmOperation } = require("../lib/eosCrm/crmHttp.js");
const { executeWorkforceOperation } = require("../lib/eosWorkforce/workforceHttp.js");
const actorAuthority = require("../lib/eosWorkforce/commands/employeeAdministrationAuthority.js");

const OP = "operator-dx";
const R = "a governed reason for the direct-exception proof";
const CRM_ACTIVE = Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" });
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) { const c = new pg.Client({ connectionString: url }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }

// The capability set K both parity Principals hold -- one key per gate family.
const K = Object.freeze({
  OPS: "workOrder.lifecycle.dispatch",
  COMMERCIAL: "opportunity.read",
  CRM: "customer.record.read",
  WORKFORCE: "employee.record.read",
  ADMIN_READ: "audit.event.read",
  ADMIN_WRITE: "admin.securityPolicy.write",
});
const CONDITIONED = "workOrder.record.read";
const RA_WO = Object.freeze({ paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" });

test("lane DX: direct Principal exceptions are enforced by every runtime gate, exactly like a Role grant", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `dxpar_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => { await pool?.end(); await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)); });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 16 });
  const q = (s, v = []) => pool.query(s, v);
  const repo = new PostgresPolicyRepository(pool);
  const { tenant } = await bootstrapTenant(repo, { key: "dx-a", name: "a", actorUid: OP });
  const T = tenant.id;
  const { tenant: tenantB } = await bootstrapTenant(repo, { key: "dx-b", name: "b", actorUid: OP });
  const TB = tenantB.id;
  await bootstrapAdministrator(repo, { tenantId: T, externalSubject: "admin-a", performedBy: OP, reason: "boot" });
  await bootstrapAdministrator(repo, { tenantId: TB, externalSubject: "admin-b", performedBy: OP, reason: "boot" });
  // The explanation read and the audit read are granted to the tenant administrator for the proof.
  for (const tid of [T, TB]) {
    await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
             SELECT 'rc-dx-' || md5($1 || c.id), $1, r.id, c.id, 'fixture','fixture','fixture'
               FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id=$1 AND r.key='admin'
                AND c.key IN ('admin.principalAccess.read','audit.event.read','admin.securityPolicy.read')
             ON CONFLICT DO NOTHING`, [tid]);
  }
  const call = (subject, operation, input = {}) => executeAdminOperation(
    { repo, explainEffectiveAccess: (tenantId, principalId) => explainEffectiveAccess(repo, pool, { tenantId, principalId }) },
    { caller: { externalSubject: subject, identityProvider: "firebase" }, operation, input, requestId: `r-${operation}` });
  const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
  const caller = (subject, requestedTenantId = null) => ({ externalSubject: subject, identityProvider: "firebase", requestedTenantId });
  const person = async (subject, tenantId = T) => {
    const made = await ensureTenantPrincipal(repo, { tenantId, externalSubject: subject, actorUid: OP, actorRoleKeys: ["admin"] });
    return made.principal?.id ?? made.id ?? made.principalId;
  };
  const roleIdOf = async (key, tenantId = T) => (await repo.getRoleByKey(tenantId, key)).id;
  const catalog = new Map((await repo.listCapabilities()).map((c) => [c.key, c]));
  const target = (key) => { const c = catalog.get(key); assert.ok(c, `capability ${key} is catalogued`); return { objectKey: c.objectKey, actionKey: c.actionKey }; };
  const auditCount = async (tenantId = T) => (await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id=$1`, [tenantId])).rows[0].n;
  const context = (subject, tenantId = null) => capabilityAuthority.resolveOperationalContext(repo, pool, caller(subject, tenantId),
    composition.postgresGrantConditionProvider(pool));

  // ── the parity population: the SAME key set K, once through a Role and once through direct exceptions ──
  const viaRole = await person("via-role");
  const viaDirect = await person("via-direct");
  const nobody = await person("nobody");
  const third = await person("third");
  ok(await call("admin-a", "createRole", { key: "dxEquivalent", name: "DX equivalent", reason: R }));
  for (const key of Object.values(K)) ok(await call("admin-a", "grantObjectActionToRole", { ...target(key), roleKey: "dxEquivalent", reason: R }));
  ok(await call("admin-a", "assignRole", { principalId: viaRole, roleId: await roleIdOf("dxEquivalent"), reason: R }));
  // An EMPTY Role for the other two, so all three are staffed identically apart from the grant source.
  ok(await call("admin-a", "createRole", { key: "dxEmpty", name: "DX empty", reason: R }));
  for (const p of [viaDirect, nobody]) ok(await call("admin-a", "assignRole", { principalId: p, roleId: await roleIdOf("dxEmpty"), reason: R }));
  for (const key of Object.values(K)) {
    ok(await call("admin-a", "grantObjectActionToPrincipal", { ...target(key), principalId: viaDirect, reason: `${R}: ${key}` }));
  }

  // ════════════════════ the gates, table-driven ════════════════════
  const reader = postgresContextualReader(pool);
  const GATES = [
    { gate: "eosOps resolveMyCapabilities", key: K.OPS, decide: async (s) => {
      const r = await executeOpsOperation({ reader: repo, pool }, { caller: caller(s), operation: "resolveMyCapabilities" });
      return r.ok ? r.result.capabilities.includes(K.OPS) : `REFUSED:${r.code}`;
    } },
    { gate: "eosOps entitled command seam (authorizeResolvedOperationalAction)", key: K.OPS, decide: async (s) => {
      const d = await composition.authorizeResolvedOperationalAction(reader, await context(s), { capabilityKey: K.OPS });
      return [d.allowed, d.outcome, d.viaCondition];
    } },
    { gate: "entitled seam re-resolving from the pool (authorizeEntitledResolvedAction)", key: K.OPS, decide: async (s) => {
      const d = await composition.authorizeEntitledResolvedAction(pool, await context(s), { capabilityKey: K.OPS });
      return [d.allowed, d.outcome];
    } },
    { gate: "Commercial kernel (listOpportunities)", key: K.COMMERCIAL, decide: async (s) => {
      const r = await executeCommercialOperation({ reader: repo, pool }, { caller: caller(s), operation: "listOpportunities", input: {} });
      return r.ok ? "OK" : `${r.code}`;
    } },
    { gate: "CRM kernel (listAccounts)", key: K.CRM, decide: async (s) => {
      const r = await executeCrmOperation({ reader: repo, pool, writerAuthority: CRM_ACTIVE }, { caller: caller(s), operation: "listAccounts", input: {} });
      return r.ok ? "OK" : `${r.code}`;
    } },
    { gate: "Workforce readMyWorkforceCapabilities", key: K.WORKFORCE, decide: async (s) => {
      const r = await executeWorkforceOperation({ reader: repo, pool }, { caller: caller(s), operation: "readMyWorkforceCapabilities", input: {} });
      return r.ok ? JSON.stringify(r.result).includes(K.WORKFORCE) : `REFUSED:${r.code}`;
    } },
    { gate: "Workforce listEmployees", key: K.WORKFORCE, decide: async (s) => {
      const r = await executeWorkforceOperation({ reader: repo, pool }, { caller: caller(s), operation: "listEmployees", input: {} });
      return r.ok ? "OK" : `${r.code}`;
    } },
    { gate: "Workforce operator actor (resolveEmployeeAdministrationActor)", key: K.WORKFORCE, decide: async (s) => {
      const p = s === "via-role" ? viaRole : s === "via-direct" ? viaDirect : nobody;
      const a = await actorAuthority.resolveEmployeeAdministrationActor(pool, { tenantId: T, principalId: p });
      return a.capabilities.has(K.WORKFORCE);
    } },
    { gate: "experience surfaces (resolveExperienceContext)", key: null, decide: async (s) =>
      JSON.stringify([...(await resolveExperienceContext(repo, pool, caller(s))).surfaces].sort()) },
    { gate: "Administration read gate (readPolicyAuditHistory)", key: K.ADMIN_READ, decide: async (s) => {
      const r = await call(s, "readPolicyAuditHistory", { limit: 1 });
      return r.ok ? "OK" : r.code;
    } },
    { gate: "Administration mutation gate (grantObjectActionToPrincipal to a third Principal)", key: K.ADMIN_WRITE, decide: async (s) => {
      const r = await call(s, "grantObjectActionToPrincipal", { ...target("workOrder.lifecycle.cancel"), principalId: third, reason: `${R} by ${s}` });
      return r.ok ? "OK" : r.code;
    } },
    { gate: "workflow effective-authority half (operationalWorkflowAuthority)", key: K.OPS, decide: async (s) => {
      const ctx = await context(s);
      const actor = { tenantId: ctx.principalContext.tenantId, principalId: ctx.principalContext.uid, capabilities: ctx.capabilities,
        conditionallyHeld: ctx.conditionallyHeld, scopedHeld: ctx.scopedHeld, entitlements: ctx.entitlements };
      const d = await operationalWorkflowAuthority(reader, actor, "workOrder").authorize({ capabilityKey: K.OPS, recordId: "wo-x", guardKind: null });
      return [d.allowed, d.outcome];
    } },
    { gate: "explainEffectiveAccess (the Administration explanation)", key: null, decide: async (s) => {
      const p = s === "via-role" ? viaRole : s === "via-direct" ? viaDirect : nobody;
      const e = ok(await call("admin-a", "explainEffectiveAccess", { principalId: p }));
      return JSON.stringify(Object.values(K).map((key) => { const a = e.actions.find((x) => x.capabilityKey === key); return [key, a.result, a.reasonCode]; }));
    } },
  ];

  await t.test("PARITY: every gate decides a direct exception exactly as the equivalent Role grant; a holder of nothing is refused", async () => {
    assert.ok(GATES.length >= 13);
    for (const g of GATES) {
      const role = await g.decide("via-role");
      const direct = await g.decide("via-direct");
      const none = await g.decide("nobody");
      assert.deepEqual(direct, role, `${g.gate}: the direct exception decided differently from the Role grant`);
      assert.notDeepEqual(none, role, `${g.gate}: vacuous -- a Principal holding nothing got the same answer`);
    }
    // The runtime context itself: same flat set; the direct rows are reported; the Role join alone lacks them.
    const [cr, cd] = [await context("via-role"), await context("via-direct")];
    for (const key of Object.values(K)) {
      assert.equal(cr.capabilities.has(key), true, key);
      assert.equal(cd.capabilities.has(key), true, key);
    }
    assert.deepEqual(cd.directGrants.map((g) => g.capabilityKey).sort(), Object.values(K).sort());
    assert.deepEqual(cr.directGrants, []);
    const e = ok(await call("admin-a", "explainEffectiveAccess", { principalId: viaDirect }));
    for (const key of Object.values(K)) {
      const row = e.actions.find((a) => a.capabilityKey === key);
      // The stored reason is the administrator's words plus the request id (the audit convention).
      assert.deepEqual([row.result, row.directGrant.label, row.directGrant.enforced, row.directGrant.exceptionReason.startsWith(`${R}: ${key}`),
        row.directGrant.grantedBy],
      ["ALLOWED", "DIRECT_EXCEPTION", true, true, (await capabilityAuthority.resolveOperationalContext(repo, pool, caller("admin-a"))).principalContext.uid], key);
      assert.equal("notEnforcedOnRoleOnlyRuntimePaths" in row.directGrant, false, "the not-enforced flag is gone where it is no longer true");
    }
    const matrix = ok(await call("admin-a", "getObjectActionGrantMatrix", { objectKey: target(K.OPS).objectKey }));
    const cell = matrix.actions.find((a) => a.capabilityKey === K.OPS).principals.find((p) => p.principalId === viaDirect);
    assert.deepEqual([cell.source, cell.enforced, cell.exceptionReason.startsWith(`${R}: ${K.OPS}`), cell.condition], ["DIRECT_EXCEPTION", true, true, null]);
  });

  // ════════════════════ conditioned: never flat ════════════════════
  const condRole = await person("cond-role");
  const condDirect = await person("cond-direct");
  ok(await call("admin-a", "createRole", { key: "dxConditioned", name: "DX conditioned", reason: R }));
  ok(await call("admin-a", "grantObjectActionToRole", { ...target(CONDITIONED), roleKey: "dxConditioned", reason: R, condition: RA_WO }));
  ok(await call("admin-a", "assignRole", { principalId: condRole, roleId: await roleIdOf("dxConditioned"), reason: R }));
  ok(await call("admin-a", "assignRole", { principalId: condDirect, roleId: await roleIdOf("dxEmpty"), reason: R }));

  await t.test("CONDITIONED: a conditioned direct exception is conditionallyHeld, never flat, and decides like the conditioned Role grant", async () => {
    const before = await auditCount();
    ok(await call("admin-a", "grantObjectActionToPrincipal", { ...target(CONDITIONED), principalId: condDirect, reason: R, condition: RA_WO }));
    assert.equal(await auditCount(), before + 1, "grant + condition is ONE audited change");
    const cell = (await q(`SELECT status, condition FROM eos_policy.capability_grant_conditions WHERE tenant_id=$1 AND grant_scope='PRINCIPAL' AND grantor_key=$2`, [T, condDirect])).rows;
    assert.deepEqual(cell.map((c) => [c.status, c.condition.recordKind]), [["ACTIVE", "workOrder"]]);
    for (const s of ["cond-role", "cond-direct"]) {
      const ctx = await context(s);
      assert.equal(ctx.capabilities.has(CONDITIONED), false, `${s}: a conditioned grant reached the flat set`);
      assert.equal(ctx.conditionallyHeld.has(CONDITIONED), true, s);
      const flat = await capabilityAuthority.capabilitiesWithoutUnevaluatedConditions(pool, ctx.principalContext,
        new Set([...ctx.capabilities, CONDITIONED]), composition.postgresGrantConditionProvider(pool));
      assert.equal(flat.has(CONDITIONED), false, `${s}: the flat-set kernels (Commercial, CRM) would read it unconditioned`);
      const surfacesCtx = await resolveExperienceContext(repo, pool, caller(s));
      assert.ok(Array.isArray(surfacesCtx.surfaces));
      const op = await executeOpsOperation({ reader: repo, pool }, { caller: caller(s), operation: "resolveMyCapabilities" });
      assert.equal(op.result.capabilities.includes(CONDITIONED), false, `${s}: resolveMyCapabilities reported it flat`);
      const admin = await actorAuthority.resolveEmployeeAdministrationActor(pool, { tenantId: T, principalId: s === "cond-role" ? condRole : condDirect });
      assert.equal(admin.capabilities.has(CONDITIONED), false, `${s}: the operator actor read it flat`);
      assert.equal(admin.conditionallyHeld.has(CONDITIONED), true);
    }
    const decisions = [];
    for (const s of ["cond-role", "cond-direct"]) {
      const ctx = await context(s);
      const noRecord = await composition.authorizeResolvedOperationalAction(reader, ctx, { capabilityKey: CONDITIONED });
      const someRecord = await composition.authorizeResolvedOperationalAction(reader, ctx, { capabilityKey: CONDITIONED, recordId: "wo-not-mine" });
      decisions.push([noRecord.allowed, noRecord.outcome, noRecord.denials.map((d) => d.detail), someRecord.allowed, someRecord.outcome]);
    }
    assert.deepEqual(decisions[1], decisions[0], "the conditioned direct exception decided differently from the conditioned Role grant");
    assert.equal(decisions[0][0], false);
    const [er, ed] = [ok(await call("admin-a", "explainEffectiveAccess", { principalId: condRole })),
      ok(await call("admin-a", "explainEffectiveAccess", { principalId: condDirect }))];
    const [rr, rd] = [er.actions.find((a) => a.capabilityKey === CONDITIONED), ed.actions.find((a) => a.capabilityKey === CONDITIONED)];
    assert.deepEqual([rd.result, rd.reasonCode, rd.withheldFromFlatSetKernels], [rr.result, rr.reasonCode, rr.withheldFromFlatSetKernels]);
    assert.deepEqual([rd.result, rd.withheldFromFlatSetKernels], ["CONDITIONAL", true]);
    assert.deepEqual(rd.directGrant.condition, RA_WO);
    // The Administration read view agrees: not flat.
    const view = ok(await call("admin-a", "getPrincipalEffectiveAccess", { principalId: condDirect }));
    assert.equal(view.effective.some((c) => c.capabilityKey === CONDITIONED), false);
  });

  await t.test("CONDITIONED: set / retire on a direct-exception cell -- audited once, never widening, admin.* refused", async () => {
    const other = { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" };
    let before = await auditCount();
    ok(await call("admin-a", "setGrantCondition", { ...target(CONDITIONED), principalId: condDirect, condition: other, reason: R }));
    assert.equal(await auditCount(), before, "an identical condition is a no-op and writes no audit");
    const retire = await call("admin-a", "retireGrantCondition", { ...target(CONDITIONED), principalId: condDirect, reason: R });
    assert.deepEqual([retire.ok, retire.code], [false, "CONFLICT"], JSON.stringify(retire));
    assert.match(retire.message, /CONDITION_RETIREMENT_WOULD_WIDEN/);
    assert.equal(await auditCount(), before);
    // Raw retire is refused by the database trigger too.
    await assert.rejects(() => q(`UPDATE eos_policy.capability_grant_conditions SET status='RETIRED' WHERE tenant_id=$1 AND grant_scope='PRINCIPAL' AND grantor_key=$2`, [T, condDirect]),
      /CONDITION_RETIREMENT_WOULD_WIDEN/);
    // Revoke (one audit), then retire (one audit) -- and a re-grant would be conditioned again until then.
    ok(await call("admin-a", "revokeObjectActionFromPrincipal", { ...target(CONDITIONED), principalId: condDirect, reason: R }));
    assert.equal(await auditCount(), before + 1);
    assert.equal((await context("cond-direct")).conditionallyHeld.has(CONDITIONED), false, "revoked means nothing, not ALL");
    ok(await call("admin-a", "retireGrantCondition", { ...target(CONDITIONED), principalId: condDirect, reason: R }));
    assert.equal(await auditCount(), before + 2);
    // admin.* and any key off the CONDITIONABLE_GRANTS allow-list may never carry a condition, directly either.
    before = await auditCount();
    const adminCond = await call("admin-a", "grantObjectActionToPrincipal", { ...target(K.ADMIN_WRITE), principalId: third, reason: R,
      condition: { paths: [[{ kind: "WORK_ELIGIBILITY", qualificationCode: "PARTS_OPERATIONS" }]] } });
    assert.deepEqual([adminCond.ok, adminCond.code], [false, "INVALID_INPUT"]);
    assert.match(adminCond.message, /CONDITION_NOT_SUPPORTED/);
    const neither = await call("admin-a", "setGrantCondition", { ...target(CONDITIONED), condition: RA_WO, reason: R });
    const both = await call("admin-a", "setGrantCondition", { ...target(CONDITIONED), roleKey: "dxConditioned", principalId: condDirect, condition: RA_WO, reason: R });
    assert.deepEqual([neither.code, both.code], ["INVALID_INPUT", "INVALID_INPUT"]);
    assert.equal(await auditCount(), before);
  });

  // ════════════════════ expiry ════════════════════
  await t.test("EXPIRED: an expired direct exception confers nothing on any gate and is not shown; a re-grant refreshes it (one audit)", async () => {
    const lapsed = await person("lapsed");
    ok(await call("admin-a", "assignRole", { principalId: lapsed, roleId: await roleIdOf("dxEmpty"), reason: R }));
    await q(`INSERT INTO eos_policy.principal_capabilities (id,tenant_id,principal_id,capability_id,granted_by,created_by,updated_by,exception_reason,expires_at)
             SELECT 'pc-dx-lapsed',$1,$2,c.id,'fixture','fixture','fixture','lapsed cover',now() - interval '1 minute'
               FROM eos_policy.capabilities c WHERE c.key = $3`, [T, lapsed, K.ADMIN_READ]);
    const ctx = await context("lapsed");
    assert.equal(ctx.capabilities.has(K.ADMIN_READ), false);
    assert.deepEqual(ctx.directGrants, []);
    const audit = await call("lapsed", "readPolicyAuditHistory", { limit: 1 });
    assert.deepEqual([audit.ok, audit.code], [false, "FORBIDDEN"]);
    const e = ok(await call("admin-a", "explainEffectiveAccess", { principalId: lapsed }));
    assert.equal(e.actions.find((a) => a.capabilityKey === K.ADMIN_READ).directGrant, null);
    const before = await auditCount();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    ok(await call("admin-a", "grantObjectActionToPrincipal", { ...target(K.ADMIN_READ), principalId: lapsed, reason: "renewed cover", expiresAt: future }));
    assert.equal(await auditCount(), before + 1);
    assert.equal((await context("lapsed")).capabilities.has(K.ADMIN_READ), true);
    ok(await call("admin-a", "grantObjectActionToPrincipal", { ...target(K.ADMIN_READ), principalId: lapsed, reason: "again", expiresAt: future }));
    assert.equal(await auditCount(), before + 1, "an unexpired identical grant is a no-op and writes no audit");
    const past = await call("admin-a", "grantObjectActionToPrincipal", { ...target(K.OPS), principalId: lapsed, reason: R, expiresAt: new Date(Date.now() - 1000).toISOString() });
    assert.deepEqual([past.ok, past.code], [false, "INVALID_INPUT"]);
  });

  // ════════════════════ Pass 8 / 9 invariants at the Principal ════════════════════
  await t.test("NO SELF-GRANT: a principal may not grant, condition or retire a condition on itself", async () => {
    const adminA = (await context("admin-a")).principalContext.uid;
    const before = await auditCount();
    for (const [op, input] of [
      ["grantObjectActionToPrincipal", { ...target(K.OPS), principalId: adminA, reason: R }],
      ["setGrantCondition", { ...target(CONDITIONED), principalId: adminA, condition: RA_WO, reason: R }],
      ["retireGrantCondition", { ...target(CONDITIONED), principalId: adminA, reason: R }],
    ]) {
      const r = await call("admin-a", op, input);
      assert.deepEqual([r.ok, r.code], [false, "FORBIDDEN"], `${op}: ${JSON.stringify(r)}`);
      assert.match(r.message, /SELF_ADMINISTRATION/);
    }
    // The direct holder of admin.securityPolicy.write may not widen ITSELF either.
    const self = await call("via-direct", "grantObjectActionToPrincipal", { ...target("workOrder.lifecycle.cancel"), principalId: viaDirect, reason: R });
    assert.deepEqual([self.ok, self.code], [false, "FORBIDDEN"]);
    assert.equal(await auditCount(), before);
  });

  await t.test("NO SCOPE: a direct exception carries no scope -- a scoped direct grant is refused by name", async () => {
    const before = await auditCount();
    for (const scope of [{ scopeType: "operatingCompany", scopeValue: "taylor" }, { scopeType: "operatingCompany" }, { scopeValue: "taylor" }]) {
      const r = await call("admin-a", "grantObjectActionToPrincipal", { ...target(K.WORKFORCE), principalId: third, reason: R, ...scope });
      assert.deepEqual([r.ok, r.code], [false, "INVALID_INPUT"], JSON.stringify(scope));
      assert.match(r.message, /DIRECT_GRANT_SCOPE_UNSUPPORTED/);
    }
    assert.equal(await auditCount(), before);
    assert.deepEqual((await context("third")).scopedHeld, [], "a direct grant never produces a scoped holding");
  });

  await t.test("OWNER RULING A at the principal: no excluded key by a direct grant, and no owner Role over one", async () => {
    const ownerP = await person("owner-p");
    // The protected Owner is not appointed through ordinary administration (Controller ruling 2026-09-27).
    await seedProtectedOwner(repo, { tenantId: T, principalId: ownerP });
    const before = await auditCount();
    for (const key of ["equipment.install", "inventory.stock.receive", "workOrder.lifecycle.dispatch"]) {
      const r = await call("admin-a", "grantObjectActionToPrincipal", { ...target(key), principalId: ownerP, reason: R });
      assert.deepEqual([r.ok, r.code], [false, "CONFLICT"], `${key}: ${JSON.stringify(r)}`);
      assert.match(r.message, /SYSTEM_INVARIANT/);
    }
    assert.equal(await auditCount(), before);
    // The reverse order: a Principal holding an excluded key DIRECTLY may not then be given the owner Role.
    const holder = await person("excluded-holder");
    ok(await call("admin-a", "grantObjectActionToPrincipal", { ...target("equipment.install"), principalId: holder, reason: R }));
    // Ordinary administration can no longer appoint the Owner at all (Controller ruling 2026-09-27), so this is now
    // refused by the protected-Owner rule before Owner ruling A is even consulted -- still refused, still no row.
    const staff = await call("admin-a", "assignRole", { principalId: holder, roleId: await roleIdOf("owner"), reason: R });
    assert.deepEqual([staff.ok, staff.code], [false, "FORBIDDEN"], JSON.stringify(staff));
    assert.match(staff.message, /PROTECTED_OWNER_MEMBERSHIP/);
  });

  await t.test("ANTI-LOCKOUT: only an UNEXPIRED, UNCONDITIONED direct holder keeps the tenant administrable", async () => {
    const count = () => repo.transact({ tenantId: T, uid: OP }, (tx) => tx.administrationHolderCount(K.ADMIN_WRITE, {}));
    const base = await count(); // admin-a (Role) + via-role (Role) + via-direct (direct, no expiry)
    const expiring = await person("expiring-admin");
    ok(await call("admin-a", "grantObjectActionToPrincipal", { ...target(K.ADMIN_WRITE), principalId: expiring, reason: R,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString() }));
    assert.equal(await count(), base, "an EXPIRING direct holder is a lockout on a timer and does not count");
    // A conditioned direct holder cannot be made for admin.* (refused above); a RAW one is still not counted, and the
    // gate agrees it is not flat.
    const conditionedAdmin = await person("conditioned-admin");
    await q(`INSERT INTO eos_policy.capability_grant_conditions (id,tenant_id,grant_scope,grantor_key,capability_key,condition,status,established_by,updated_by)
             VALUES ('gc-dx-raw',$1,'PRINCIPAL',$2,$3,$4::jsonb,'ACTIVE','fixture','fixture')`,
    [T, conditionedAdmin, K.ADMIN_WRITE, JSON.stringify({ paths: [[{ kind: "WORK_ELIGIBILITY", qualificationCode: "PARTS_OPERATIONS" }]] })]);
    ok(await call("admin-a", "grantObjectActionToPrincipal", { ...target(K.ADMIN_WRITE), principalId: conditionedAdmin, reason: R }));
    assert.equal(await count(), base, "a conditioned direct holder does not count");
    assert.equal((await context("conditioned-admin")).capabilities.has(K.ADMIN_WRITE), false, "and the gate agrees: not flat");
    const forbidden = await call("conditioned-admin", "grantObjectActionToPrincipal", { ...target(K.OPS), principalId: third, reason: R });
    assert.deepEqual([forbidden.ok, forbidden.code], [false, "FORBIDDEN"]);
    // An UNEXPIRED, UNCONDITIONED direct holder DOES count.
    const plain = await person("plain-admin");
    ok(await call("admin-a", "grantObjectActionToPrincipal", { ...target(K.ADMIN_WRITE), principalId: plain, reason: R }));
    assert.equal(await count(), base + 1);
  });

  await t.test("ANTI-LOCKOUT end to end: revoking the last unexpired direct path is refused; an expiring grant is no rescue", async () => {
    // A dedicated tenant: its administrator's Role path is removed, leaving ONE unexpired direct holder and one
    // EXPIRING direct holder.
    const { tenant: tl } = await bootstrapTenant(repo, { key: "dx-lock", name: "lock", actorUid: OP });
    await bootstrapAdministrator(repo, { tenantId: tl.id, externalSubject: "admin-l", performedBy: OP, reason: "boot" });
    const callL = (subject, operation, input) => executeAdminOperation({ repo },
      { caller: { externalSubject: subject, identityProvider: "firebase", requestedTenantId: tl.id }, operation, input, requestId: `rl-${operation}` });
    const d1 = (await ensureTenantPrincipal(repo, { tenantId: tl.id, externalSubject: "direct-l1", actorUid: OP, actorRoleKeys: ["admin"] }));
    const d2 = (await ensureTenantPrincipal(repo, { tenantId: tl.id, externalSubject: "direct-l2", actorUid: OP, actorRoleKeys: ["admin"] }));
    const id1 = d1.principal?.id ?? d1.id ?? d1.principalId;
    const id2 = d2.principal?.id ?? d2.id ?? d2.principalId;
    ok(await callL("admin-l", "grantObjectActionToPrincipal", { ...target(K.ADMIN_WRITE), principalId: id1, reason: R }));
    ok(await callL("admin-l", "grantObjectActionToPrincipal", { ...target(K.ADMIN_WRITE), principalId: id2, reason: R,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString() }));
    // The direct holder removes the Role path: allowed, because it (unexpired, unconditioned) still administers.
    ok(await callL("direct-l1", "revokeObjectActionFromRole", { ...target(K.ADMIN_WRITE), roleKey: "admin", reason: R }));
    // Now the expiring holder may NOT remove the last unexpired path, and neither may the holder itself.
    for (const subject of ["direct-l2", "direct-l1"]) {
      const r = await callL(subject, "revokeObjectActionFromPrincipal", { ...target(K.ADMIN_WRITE), principalId: id1, reason: R });
      assert.deepEqual([r.ok, r.code], [false, "CONFLICT"], `${subject}: ${JSON.stringify(r)}`);
      assert.match(r.message, /WOULD_REMOVE_LAST_ADMINISTRATION_PATH/);
    }
  });

  await t.test("TENANT ISOLATION: a direct exception is confined to its tenant, both ways", async () => {
    // Tenant B's administrator cannot grant to a tenant-A Principal.
    const cross = await call("admin-b", "grantObjectActionToPrincipal", { ...target(K.OPS), principalId: viaRole, reason: R });
    assert.deepEqual([cross.ok, cross.code], [false, "INVALID_INPUT"], JSON.stringify(cross));
    // A Principal who is a member of BOTH tenants holds a direct exception in A only.
    const both = await person("both-tenants");
    await repo.transact({ tenantId: TB, uid: OP }, (tx) => tx.createTenantMembership(both));
    ok(await call("admin-a", "grantObjectActionToPrincipal", { ...target(K.OPS), principalId: both, reason: R }));
    assert.equal((await context("both-tenants", T)).capabilities.has(K.OPS), true);
    const inB = await context("both-tenants", TB);
    assert.equal(inB.capabilities.has(K.OPS), false, "a tenant-A direct exception leaked into tenant B");
    assert.deepEqual(inB.directGrants, []);
    const explainB = await call("admin-b", "explainEffectiveAccess", { principalId: viaDirect });
    assert.deepEqual([explainB.ok, explainB.code], [false, "NOT_FOUND"]);
  });

  await t.test("CELL LOCK (migration 1762992000000): a raw direct-grant INSERT racing a condition retire can never leave the grant held unconditioned", async () => {
    const racer = await person("racer");
    const capId = catalog.get(CONDITIONED).id;
    // An ACTIVE PRINCIPAL-cell condition on an UN-held cell: retiring it is legal -- unless a grant commits first.
    await q(`INSERT INTO eos_policy.capability_grant_conditions (id,tenant_id,grant_scope,grantor_key,capability_key,condition,status,established_by,updated_by)
             VALUES ('gc-dx-race',$1,'PRINCIPAL',$2,$3,$4::jsonb,'ACTIVE','fixture','fixture')`, [T, racer, CONDITIONED, JSON.stringify(RA_WO)]);
    const trigger = (await q(`SELECT tgname FROM pg_trigger WHERE tgrelid='eos_policy.principal_capabilities'::regclass AND NOT tgisinternal`)).rows.map((r) => r.tgname);
    assert.ok(trigger.includes("principal_capabilities_cell_lock"), "the cell-lock trigger is installed");
    const c1 = new pg.Client({ connectionString: dbUrlFor(name) });
    const c2 = new pg.Client({ connectionString: dbUrlFor(name) });
    await c1.connect(); await c2.connect();
    try {
      await c1.query("BEGIN");
      await c1.query(`INSERT INTO eos_policy.principal_capabilities (id,tenant_id,principal_id,capability_id,granted_by,created_by,updated_by,exception_reason)
                      VALUES ('pc-dx-race',$1,$2,$3,'raw','raw','raw','raw race')`, [T, racer, capId]);
      // Client 2 retires the condition. It must WAIT on the cell lock the insert took, then see the committed grant.
      let settled = false;
      const retire = c2.query(`UPDATE eos_policy.capability_grant_conditions SET status='RETIRED' WHERE id='gc-dx-race'`)
        .then(() => "RETIRED", (err) => err.message).finally(() => { settled = true; });
      await new Promise((r) => setImmediate(r));
      await c1.query("SELECT pg_sleep(0.3)");
      assert.equal(settled, false, "the retire did not wait for the uncommitted direct grant");
      await c1.query("COMMIT");
      assert.match(await retire, /CONDITION_RETIREMENT_WOULD_WIDEN/);
    } finally { await c1.end(); await c2.end(); }
    const state = (await q(`SELECT status FROM eos_policy.capability_grant_conditions WHERE id='gc-dx-race'`)).rows[0].status;
    assert.equal(state, "ACTIVE", "the held direct grant keeps its condition");
    const ctx = await context("racer");
    assert.deepEqual([ctx.capabilities.has(CONDITIONED), ctx.conditionallyHeld.has(CONDITIONED)], [false, true]);
    // A direct exception's cell is its identity: re-pointing a row is refused.
    await assert.rejects(() => q(`UPDATE eos_policy.principal_capabilities SET principal_id=$1 WHERE id='pc-dx-race'`, [third]),
      /identity and never changes/);
  });

  await t.test("SALES_CHANNEL composes: a direct grant is never scoped; a channel-scoped Role + a global direct grant is the union, the scoped part never widens", async () => {
    ok(await call("admin-a", "setTenantSalesChannelStatus", { salesChannel: "RETAIL", status: "ACTIVE", reason: R }));
    ok(await call("admin-a", "setTenantSalesChannelStatus", { salesChannel: "NATIONAL_ACCOUNTS", status: "ACTIVE", reason: R }));
    ok(await call("admin-a", "createRole", { key: "dxChannelReader", name: "DX channel reader", reason: R }));
    for (const key of ["opportunity.read", "salesOrder.read"]) {
      ok(await call("admin-a", "grantObjectActionToRole", { ...target(key), roleKey: "dxChannelReader", reason: R }));
    }
    const mixed = await person("channel-plus-direct");
    ok(await call("admin-a", "assignRole", { principalId: mixed, roleId: await roleIdOf("dxChannelReader"), reason: R,
      scopeType: "salesChannel", scopeValue: "RETAIL" }));
    // (1) a direct grant can never carry the channel scope.
    const scopedDirect = await call("admin-a", "grantObjectActionToPrincipal", { ...target("opportunity.read"), principalId: mixed, reason: R,
      scopeType: "salesChannel", scopeValue: "RETAIL" });
    assert.deepEqual([scopedDirect.ok, scopedDirect.code], [false, "INVALID_INPUT"]);
    assert.match(scopedDirect.message, /DIRECT_GRANT_SCOPE_UNSUPPORTED/);
    // (2) a GLOBAL direct grant of ONE of the scoped keys.
    ok(await call("admin-a", "grantObjectActionToPrincipal", { ...target("salesOrder.read"), principalId: mixed, reason: R }));
    const ctx = await context("channel-plus-direct");
    assert.equal(ctx.capabilities.has("salesOrder.read"), true, "the direct grant is global");
    assert.equal(ctx.capabilities.has("opportunity.read"), false, "the channel-scoped key never becomes flat");
    assert.deepEqual(ctx.scopedHeld.map((h) => [h.capabilityKey, h.scopeValue, h.sourceRole]).sort(),
      [["opportunity.read", "RETAIL", "dxChannelReader"], ["salesOrder.read", "RETAIL", "dxChannelReader"]],
      "the direct grant adds no scoped holding and removes none");
    const decide = async (capabilityKey, salesChannel) => {
      const d = await composition.authorizeResolvedOperationalAction(reader, ctx,
        { capabilityKey, ...(salesChannel ? { businessContext: { salesChannel } } : {}) });
      return [d.allowed, d.outcome, d.viaGrantor?.kind ?? null, d.viaScope?.scopeValue ?? null];
    };
    // The scoped part: RETAIL only; NATIONAL and "no context" refused -- the direct grant of ANOTHER key widens nothing.
    assert.deepEqual(await decide("opportunity.read", "RETAIL"), [true, "ALLOWED", "ROLE", "RETAIL"]);
    assert.deepEqual((await decide("opportunity.read", "NATIONAL_ACCOUNTS")).slice(0, 2), [false, "OUTSIDE_ASSIGNMENT_SCOPE"]);
    assert.deepEqual((await decide("opportunity.read", null)).slice(0, 2), [false, "SCOPE_CONTEXT_REQUIRED"]);
    // The union: salesOrder.read is global through the direct grant, in every channel.
    assert.deepEqual(await decide("salesOrder.read", "NATIONAL_ACCOUNTS"), [true, "ALLOWED", "PRINCIPAL", null]);
    assert.deepEqual(await decide("salesOrder.read", "RETAIL"), [true, "ALLOWED", "PRINCIPAL", null]);
    // The Commercial transport hands the SAME composition to its reads: flat keys include the direct grant, scoped
    // holdings stay scoped.
    const list = await executeCommercialOperation({ reader: repo, pool }, { caller: caller("channel-plus-direct"), operation: "listSalesOrders", input: {} });
    assert.equal(list.ok, true, JSON.stringify(list));
    const opp = await executeCommercialOperation({ reader: repo, pool }, { caller: caller("channel-plus-direct"), operation: "listOpportunities", input: {} });
    assert.equal(opp.ok, true, "the Retail-scoped holder still lists (channel-filtered) opportunities");
  });

  await t.test("AUDIT exactly once: grant, revoke and condition changes each write ONE event naming the direct exception; no-ops write none", async () => {
    const who = await person("audited");
    const before = await auditCount();
    ok(await call("admin-a", "grantObjectActionToPrincipal", { ...target(K.CRM), principalId: who, reason: "audited grant" }));
    ok(await call("admin-a", "grantObjectActionToPrincipal", { ...target(K.CRM), principalId: who, reason: "audited grant" }));
    const revoked = await call("admin-a", "revokeObjectActionFromPrincipal", { ...target(K.CRM), principalId: who, reason: "audited revoke" });
    ok(revoked);
    const again = await call("admin-a", "revokeObjectActionFromPrincipal", { ...target(K.CRM), principalId: who, reason: "audited revoke" });
    assert.equal(again.ok, true);
    assert.equal(again.data, null, "revoking what is not held is a no-op");
    const missingReason = await call("admin-a", "revokeObjectActionFromPrincipal", { ...target(K.CRM), principalId: who });
    assert.deepEqual([missingReason.ok, missingReason.code], [false, "INVALID_INPUT"]);
    const rows = (await q(`SELECT action, before, after, reason FROM eos_policy.audit_events WHERE tenant_id=$1 ORDER BY occurred_at, id`, [T])).rows.slice(before);
    assert.deepEqual(rows.map((r) => r.action), ["grantObjectActionToPrincipal", "revokeObjectActionFromPrincipal"]);
    assert.deepEqual([rows[0].after.source, rows[0].after.granteeKey, rows[0].after.capabilityKey, rows[0].after.exceptionReason.startsWith("audited grant")],
      ["DIRECT_EXCEPTION", who, K.CRM, true]);
    assert.deepEqual([rows[1].before.source, rows[1].after.held], ["DIRECT_EXCEPTION", false]);
  });
});
