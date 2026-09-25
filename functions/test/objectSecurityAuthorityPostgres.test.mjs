// OBJECT-OWNED SECURITY AUTHORITY -- role grants, direct Principal grants, and one effective access
// resolver, against a real postgres:16.
//
// The thing being proved is that there is ONE authority with THREE projections. Administration used
// to answer "who may do this" from a static frontend map while Render answered it from
// eos_policy.role_capabilities, and the two disagreed about 47 of ~70 keys. Every test here is a way
// that cannot happen again: the Object view, the Role view and the Principal view are all GROUP BYs
// over the same grant rows.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
const { bootstrapTenant, bootstrapAdministrator, ensureTenantPrincipal } = require("../lib/adminPolicy/tenantBootstrap.js");
const { resolvePrincipalContext } = require("../lib/adminPolicy/principalContext.js");
const commands = require("../lib/adminPolicy/policyCommands.js");
const authority = require("../lib/adminPolicy/objectSecurityAuthority.js");
const { measureCredEquivalence } = require("../lib/adminPolicy/migration/credEquivalence.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const { ADMINISTRATION_READ_CAPABILITY_KEYS } = require("../lib/adminPolicy/administrationSurfaceAuthority.js");

const OPERATOR = "operator-under-test";
const ADMIN_SUBJECT = "firebase-uid-admin";
const PLAIN_SUBJECT = "firebase-uid-plain";

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("object-owned security authority, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `objsec_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up",
    "--migrations-dir", "migrations", "--no-check-order"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe",
  });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 6 });
  const repo = new PostgresPolicyRepository(pool);

  const { tenant } = await bootstrapTenant(repo, { key: "taylor-objsec", name: "Taylor", actorUid: OPERATOR });
  await bootstrapAdministrator(repo, {
    tenantId: tenant.id, externalSubject: ADMIN_SUBJECT, displayName: "The Administrator",
    performedBy: OPERATOR, reason: "initial administrator",
  });
  const adminContext = await resolvePrincipalContext(repo, { externalSubject: ADMIN_SUBJECT });
  const admin = { tenantId: tenant.id, uid: adminContext.uid, heldRoleKeys: adminContext.heldRoleKeys };
  const plain = await ensureTenantPrincipal(repo, {
    tenantId: tenant.id, externalSubject: PLAIN_SUBJECT,
    actorUid: adminContext.uid, actorRoleKeys: adminContext.heldRoleKeys,
  });
  const plainId = plain.principal?.id ?? plain.id ?? plain.principalId;
  const nobody = { tenantId: tenant.id, uid: plainId, heldRoleKeys: [] };

  // ════════════════════ THE ADMINISTRATOR IS MADE A GRANTED READER ════════════════════
  //
  // Administration reads are gated on the capability the surface they serve declares. The grant
  // migrations (1762041600000, 1762128000000) resolve Roles by key, and in this database they ran
  // against an EMPTY `roles` table -- the tenant is bootstrapped afterwards -- so they granted
  // nothing here. The fixture writes what they would have written; the gate is not weakened.
  {
    const catalog = await repo.listCapabilities();
    const adminRole = await repo.getRoleByKey(tenant.id, "admin");
    await repo.transact({ tenantId: tenant.id, uid: adminContext.uid }, async (tx) => {
      for (const key of ADMINISTRATION_READ_CAPABILITY_KEYS) {
        await tx.grantRoleCapability({
          roleId: adminRole.id, capabilityId: catalog.find((c) => c.key === key).id,
          grantedBy: adminContext.uid, grantedAt: new Date().toISOString(),
        });
      }
    });
  }

  // ════════════════════ §25 ROLE GRANTS ════════════════════

  await t.test("an Object action resolves to exactly one canonical capability", async () => {
    const caps = await repo.listCapabilities();
    const dispatch = authority.resolveObjectAction(caps, "workOrder", "dispatch");
    assert.equal(dispatch.key, "workOrder.lifecycle.dispatch");
    assert.equal(dispatch.actionKind, "BUSINESS_ACTION");
    assert.equal(dispatch.displayLabel, "Dispatch Work Order");
  });

  await t.test("an authorized administrator grants and revokes an Object action to a Role", async () => {
    const grant = await commands.grantObjectActionToRole(repo, admin,
      { objectKey: "workOrder", actionKey: "dispatch", roleKey: "dispatcher", reason: "owner ruling" });
    assert.ok(grant.id);

    const role = await repo.getRoleByKey(tenant.id, "dispatcher");
    const held = await repo.listRoleCapabilities(tenant.id, [role.id]);
    assert.equal(held.some((g) => g.id === grant.id), true);

    // Idempotent: the same grant again returns the SAME row, never a duplicate.
    const again = await commands.grantObjectActionToRole(repo, admin,
      { objectKey: "workOrder", actionKey: "dispatch", roleKey: "dispatcher" });
    assert.equal(again.id, grant.id);

    const removed = await commands.revokeObjectActionFromRole(repo, admin,
      { objectKey: "workOrder", actionKey: "dispatch", roleKey: "dispatcher" });
    assert.equal(removed.id, grant.id);
    // Revoking something not granted is null, not a throw: it is a legitimate answer.
    assert.equal(await commands.revokeObjectActionFromRole(repo, admin,
      { objectKey: "workOrder", actionKey: "dispatch", roleKey: "dispatcher" }), null);
  });

  await t.test("unknown Object, unknown action and unknown Role each refuse distinctly", async () => {
    await assert.rejects(() => commands.grantObjectActionToRole(repo, admin,
      { objectKey: "nosuchObject", actionKey: "dispatch", roleKey: "dispatcher" }), /no governed Object/);
    await assert.rejects(() => commands.grantObjectActionToRole(repo, admin,
      { objectKey: "workOrder", actionKey: "frobnicate", roleKey: "dispatcher" }), /no governed action/);
    await assert.rejects(() => commands.grantObjectActionToRole(repo, admin,
      { objectKey: "workOrder", actionKey: "dispatch", roleKey: "nosuchRole" }), /role not found/);
  });

  await t.test("an unauthorized caller cannot grant, whatever else they hold", async () => {
    await assert.rejects(() => commands.grantObjectActionToRole(repo, nobody,
      { objectKey: "workOrder", actionKey: "dispatch", roleKey: "dispatcher" }), /not authorized/);
  });

  await t.test("a grant touches only the capability it names", async () => {
    const role = await repo.getRoleByKey(tenant.id, "technician");
    const before = (await repo.listRoleCapabilities(tenant.id, [role.id])).map((g) => g.capabilityId).sort();
    await commands.grantObjectActionToRole(repo, admin,
      { objectKey: "workOrder", actionKey: "complete", roleKey: "technician" });
    const after = (await repo.listRoleCapabilities(tenant.id, [role.id])).map((g) => g.capabilityId).sort();
    const added = after.filter((c) => !before.includes(c));
    assert.equal(added.length, 1, "exactly one capability changed");
    const caps = await repo.listCapabilities();
    assert.equal(caps.find((c) => c.id === added[0]).key, "workOrder.lifecycle.complete");
  });

  await t.test("every grant and revoke writes governed audit evidence", async () => {
    await commands.grantObjectActionToRole(repo, admin,
      { objectKey: "workOrder", actionKey: "cancel", roleKey: "dispatcher", reason: "audit check" });
    const events = await repo.listAuditEvents(tenant.id, 50);
    const granted = events.find((e) => e.action === "grantObjectActionToRole" && e.after?.actionKey === "cancel");
    assert.ok(granted, "the grant was audited");
    assert.equal(granted.actorUid, admin.uid, "the ACTOR is the server-resolved principal");
    assert.equal(granted.after.objectKey, "workOrder");
    assert.equal(granted.after.granteeType, "ROLE");
    assert.equal(granted.after.granteeKey, "dispatcher");
    assert.equal(granted.after.capabilityKey, "workOrder.lifecycle.cancel");
    assert.ok(granted.occurredAt, "server-authored timestamp");

    await commands.revokeObjectActionFromRole(repo, admin,
      { objectKey: "workOrder", actionKey: "cancel", roleKey: "dispatcher" });
    const after = await repo.listAuditEvents(tenant.id, 50);
    const revoked = after.find((e) => e.action === "revokeObjectActionFromRole");
    assert.ok(revoked, "the revoke was audited");
    assert.equal(revoked.before.granteeKey, "dispatcher");
    assert.equal(revoked.after, null);
  });

  // ════════════════════ §26 DIRECT PRINCIPAL GRANTS ════════════════════

  await t.test("a direct Principal grant succeeds, is idempotent, and revokes", async () => {
    const grant = await commands.grantObjectActionToPrincipal(repo, admin,
      { objectKey: "workOrder", actionKey: "dispatch", principalId: plainId });
    assert.equal(grant.principalId, plainId);
    const again = await commands.grantObjectActionToPrincipal(repo, admin,
      { objectKey: "workOrder", actionKey: "dispatch", principalId: plainId });
    assert.equal(again.id, grant.id, "re-granting returns the same row");

    const events = await repo.listAuditEvents(tenant.id, 80);
    const audited = events.find((e) => e.action === "grantObjectActionToPrincipal");
    assert.equal(audited.after.granteeType, "PRINCIPAL");
    assert.equal(audited.after.granteeKey, plainId);

    const removed = await commands.revokeObjectActionFromPrincipal(repo, admin,
      { objectKey: "workOrder", actionKey: "dispatch", principalId: plainId });
    assert.equal(removed.id, grant.id);
  });

  await t.test("an Employee id cannot stand in for a Principal", async () => {
    // Employees live in eos_workforce and have their own id space. A workforce record must not be
    // able to receive a capability: it may exist with no login at all.
    await assert.rejects(() => commands.grantObjectActionToPrincipal(repo, admin,
      { objectKey: "workOrder", actionKey: "dispatch", principalId: "emp_00000000000000000000000000" }),
    /not an active member/);
  });

  await t.test("a principal from another tenant refuses", async () => {
    const other = await bootstrapTenant(repo, { key: "other-objsec", name: "Other", actorUid: OPERATOR });
    const outsider = await ensureTenantPrincipal(repo, {
      tenantId: other.tenant.id, externalSubject: "firebase-uid-outsider",
      actorUid: OPERATOR, actorRoleKeys: ["admin"],
    });
    const outsiderId = outsider.principal?.id ?? outsider.id ?? outsider.principalId;
    await assert.rejects(() => commands.grantObjectActionToPrincipal(repo, admin,
      { objectKey: "workOrder", actionKey: "dispatch", principalId: outsiderId }), /not an active member/);
  });

  // ════════════════════ §28 EFFECTIVE ACCESS ════════════════════

  await t.test("Role-derived and direct grants union, de-duplicate, and keep provenance", async () => {
    const caps = await repo.listCapabilities();
    const dispatch = authority.resolveObjectAction(caps, "workOrder", "dispatch");
    const create = authority.resolveObjectAction(caps, "workOrder", "create");

    const both = authority.effectiveCapabilities({
      tenantId: tenant.id, principalId: plainId,
      roleDerivedCapabilityIds: [dispatch.id, create.id],
      directCapabilityIds: [dispatch.id],
      capabilities: caps,
    });
    assert.equal(both.length, 2, "held twice is still ONE capability");
    assert.equal(both.find((c) => c.actionKey === "dispatch").source, "ROLE_AND_DIRECT");
    assert.equal(both.find((c) => c.actionKey === "create").source, "ROLE");

    const directOnly = authority.effectiveCapabilities({
      tenantId: tenant.id, principalId: plainId,
      roleDerivedCapabilityIds: [], directCapabilityIds: [dispatch.id], capabilities: caps,
    });
    assert.equal(directOnly[0].source, "DIRECT");

    const objects = authority.objectActionsForPrincipal(both);
    assert.deepEqual(objects.workOrder, ["create", "dispatch"]);
  });

  await t.test("the Object view and the Role view are the same rows, grouped differently", async () => {
    await commands.grantObjectActionToRole(repo, admin,
      { objectKey: "workOrder", actionKey: "dispatch", roleKey: "dispatcher" });
    await commands.grantObjectActionToPrincipal(repo, admin,
      { objectKey: "workOrder", actionKey: "dispatch", principalId: plainId });

    const objectView = await executeAdminOperation(
      { repo }, { caller: { externalSubject: ADMIN_SUBJECT }, operation: "getObjectSecurityMatrix", input: { objectKey: "workOrder" } });
    const dispatchCell = objectView.data.actions.find((a) => a.actionKey === "dispatch");
    assert.ok(dispatchCell.roleKeys.includes("dispatcher"), "the Object view shows the Role");
    assert.ok(dispatchCell.principalIds.includes(plainId), "and the direct Principal");

    const roleView = await executeAdminOperation(
      { repo }, { caller: { externalSubject: ADMIN_SUBJECT }, operation: "getRoleSecurity", input: { roleKey: "dispatcher" } });
    assert.ok(roleView.data.objects.workOrder.includes("dispatch"),
      "the SAME grant appears in the Role view");

    // An action nobody holds is still RENDERED, with empty grantees: "nobody holds Dispatch" and
    // "Dispatch does not exist" are different facts and only the first is actionable.
    const complete = objectView.data.actions.find((a) => a.actionKey === "complete");
    assert.ok(complete, "an ungranted action is still listed");
  });

  await t.test("the Principal view combines roles, direct grants and effective access", async () => {
    const view = await executeAdminOperation(
      { repo }, { caller: { externalSubject: ADMIN_SUBJECT }, operation: "getPrincipalEffectiveAccess", input: { principalId: plainId } });
    assert.equal(view.ok, true, `principal view failed: ${JSON.stringify(view)}`);
    const keys = view.data.effective.map((c) => c.capabilityKey);
    assert.ok(keys.includes("workOrder.lifecycle.dispatch"), "the direct grant resolves");
    assert.equal(view.data.effective.find((c) => c.actionKey === "dispatch").source, "DIRECT");
    assert.ok(Array.isArray(view.data.roles));
    // Work Eligibility, Operational Scope and the linked Employee are DELIBERATELY not in this
    // payload: they are subordinate constraints, not security grants.
    for (const absent of ["workEligibility", "operationalScope", "employeeId", "jobRole"]) {
      assert.equal(absent in view.data, false, `${absent} must not read as a security grant`);
    }
  });

  await t.test("neither eligibility, scope, Job Role nor Employee identity can grant security", async () => {
    // Mechanical, not rhetorical: the resolver's ONLY inputs are capability ids.
    const src = require("node:fs").readFileSync(
      resolve(FUNCTIONS_DIR, "src/adminPolicy/objectSecurityAuthority.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of ["workEligibility", "operationalScope", "jobRole", "employeeId", "caller.role", "operationalRoles"]) {
      assert.equal(src.includes(forbidden), false, `the resolver reads ${forbidden}`);
    }
    assert.ok(src.includes("roleDerivedCapabilityIds") && src.includes("directCapabilityIds"),
      "the probe stopped matching the resolver and would now pass for the wrong reason");
  });

  // ════════════════════ §27 CRED EQUIVALENCE ════════════════════

  await t.test("CRED equivalence is MEASURED, and reports whether cutover is safe", async () => {
    const [objects, capabilities, roles, roleCaps, principalCaps] = await Promise.all([
      repo.listObjects(tenant.id), repo.listCapabilities(), repo.listRoles(tenant.id),
      repo.listRoleCapabilities(tenant.id), repo.listPrincipalCapabilities(tenant.id),
    ]);
    const roleIds = roles.map((r) => r.id);
    const objectPermissions = await repo.listObjectPermissions(tenant.id, roleIds);
    const principalIds = await repo.listTenantPrincipalIds(tenant.id);
    const principals = [];
    for (const pid of principalIds) {
      const assignments = await repo.listAssignmentsForPrincipal(tenant.id, pid);
      principals.push({ principalId: pid, roleIds: assignments.filter((a) => a.status === "active").map((a) => a.roleId) });
    }
    const report = measureCredEquivalence({
      principals,
      objectKeyById: new Map(objects.map((o) => [o.id, o.key])),
      objectPermissions: objectPermissions.map((p) => ({ roleId: p.roleId, objectId: p.objectId, cred: p.cred })),
      capabilities,
      roleCapabilities: roleCaps.map((g) => ({ roleId: g.roleId, capabilityId: g.capabilityId })),
      principalCapabilities: principalCaps.map((g) => ({ principalId: g.principalId, capabilityId: g.capabilityId })),
    });
    // THIS TEST DOES NOT ASSERT EQUIVALENCE. It asserts that equivalence is MEASURED and that the
    // gate is honest about the answer: the Owner's rule is that cutover requires missing = extra =
    // conflict = 0, and the measurement is what decides whether that is true. Asserting zero here
    // would make the test the claim rather than the evidence.
    assert.equal(typeof report.cutoverSafe, "boolean");
    assert.equal(report.conflict, report.missingInTarget + report.extraInTarget);
    console.log(`    CRED equivalence: equivalent=${report.equivalent} missingInTarget=${report.missingInTarget} `
      + `extraInTarget=${report.extraInTarget} ungovernedInTarget=${report.ungovernedInTarget} cutoverSafe=${report.cutoverSafe}`);
    // The resolver has NOT been cut over, and must not be while the measurement says it is unsafe.
    const credSrc = require("node:fs").readFileSync(
      resolve(FUNCTIONS_DIR, "src/adminPolicy/effectiveObjectAccess.ts"), "utf8");
    assert.ok(credSrc.includes("RoleObjectPermissionRecord"),
      "effectiveObjectAccess still reads stored CRED -- cutover is a later, measured decision");
  });

  await t.test("the field doorway invariant is untouched", async () => {
    const src = require("node:fs").readFileSync(
      resolve(FUNCTIONS_DIR, "src/adminPolicy/effectiveObjectAccess.ts"), "utf8");
    assert.ok(/A field grant NEVER opens an object the Role cannot read/i.test(src),
      "the doorway invariant must survive convergence");
    const rows = await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema='eos_policy' AND table_name IN ('role_object_permissions','role_field_permission_overrides')`);
    assert.equal(rows.rows[0].n, 2, "neither CRED table was dropped");
  });

  // ════════════════════ §29 FIREBASE BOUNDARY ════════════════════

  await t.test("the new security authority touches no Firebase", () => {
    const fs = require("node:fs");
    for (const file of ["src/adminPolicy/objectSecurityAuthority.ts", "src/adminPolicy/migration/credEquivalence.ts"]) {
      const src = fs.readFileSync(resolve(FUNCTIONS_DIR, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const forbidden of ["firebase", "firestore", "permissionCatalog", "objectPermissionMap", "request.auth"]) {
        assert.equal(src.toLowerCase().includes(forbidden.toLowerCase()), false, `${file} reaches for ${forbidden}`);
      }
    }
  });
});
