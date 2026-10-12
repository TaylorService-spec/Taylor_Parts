// GRANT-IMPACT PREVIEW (PR 3) -- PROTECTED OWNER / ADMINISTRATOR INVARIANTS (arch/grant-impact-preview.md §5.2).
//
// "A preview can never alter Owner authority, even if the command would." For every Owner / Administrator invariant:
//   * the refusal is reproduced as WOULD_REFUSE with the code (and message) the commit returns;
//   * every protected principal's snapshot -- by the preview's resolver AND by the independent runtime evaluator
//     (explainEffectiveAccess) -- is unchanged by the preview, and the database is byte-identical;
//   * P2: a deliberately DEFECTIVE command that disables the Owner's assignment, run under preview (also with a throw
//     injected after it, and with the backend killed mid-preview), reports the Owner's loss and leaves the Owner untouched;
//   * the Owner as the ACTOR (R1 Administrator staffing) previews WOULD_APPLY, and its refusals are reproduced;
//   * anti-lockout through a direct exception (C7) and a Role assignment (C9);
//   * I11 (the last administering assignment) is reproduced by MESSAGE today -- PR 2 (#2074) gives it a code.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import pg from "pg";
import { FIELD_GROUPS, buildPreviewWorld, privateDatabase, tableHashes } from "./support/authorityPreviewFixture.mjs";
import { seedProtectedOwner } from "./support/protectedOwnerFixture.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const require = createRequire(import.meta.url);
const { snapshotTenantAuthority } = require("../lib/eosOps/authorityChangePreview.js");
const { explainEffectiveAccess } = require("../lib/eosOps/effectiveAccessExplanation.js");
const { bootstrapTenant, bootstrapAdministrator, ensureTenantPrincipal } = require("../lib/adminPolicy/tenantBootstrap.js");

const R = (extra) => ({ reason: "protected preview proof", ...extra });

test("GRANT-IMPACT PREVIEW: protected Owner / Administrator invariants", { skip: SKIP, concurrency: 1 }, async (t) => {
  const db = await privateDatabase(URL_BASE, "gip_protected");
  let world;
  let side;
  t.after(async () => { await side?.end(); await world?.pool.end(); await db.drop(); });
  world = await buildPreviewWorld(db.url);
  side = new pg.Pool({ connectionString: db.url, max: 2, idleTimeoutMillis: 0 });
  const { q, pool, repo, call, T, P, grant, assign, member } = world;

  /** Every protected principal of a tenant, by the preview's resolver AND the independent runtime evaluator. */
  async function protectedState(tenantId) {
    const snaps = await snapshotTenantAuthority(pool, repo, tenantId, FIELD_GROUPS);
    const out = {};
    for (const [id, s] of snaps) {
      if (s.protectedStanding === null) continue;
      let explained;
      try {
        const e = await explainEffectiveAccess(repo, pool, { tenantId, principalId: id });
        explained = { capabilities: e.capabilities, allowed: e.actions.filter((a) => a.result === "ALLOWED").map((a) => a.capabilityKey) };
      } catch (err) { explained = { refused: err.refusal ?? String(err) }; }
      out[id] = { snapshot: JSON.parse(JSON.stringify(s)), explained };
    }
    assert.ok(Object.keys(out).length >= 2, "the fixture has an Owner and an Administrator");
    return out;
  }

  /** Preview, prove nothing protected moved, commit, and require the commit to return the same refusal. */
  async function refuses(tenantId, subject, operation, input, code, message) {
    const hashes = await tableHashes(q);
    const protectedBefore = await protectedState(tenantId);
    const preview = await call(subject, "previewAuthorityChange", { change: { operation, input } });
    assert.equal(preview.ok, true, JSON.stringify(preview));
    assert.equal(preview.data.outcome, "WOULD_REFUSE", `${code}: ${JSON.stringify(preview.data)}`);
    assert.equal(preview.data.refusal.code, code);
    if (message) assert.match(preview.data.refusal.message, message);
    assert.deepEqual(await tableHashes(q), hashes, `${code}: the preview left a trace`);
    assert.deepEqual(await protectedState(tenantId), protectedBefore, `${code}: a protected principal moved under preview`);
    const real = await call(subject, operation, input);
    assert.equal(real.ok, false);
    assert.deepEqual([real.code, real.message], [preview.data.refusal.category, preview.data.refusal.message], code);
    assert.deepEqual(await protectedState(tenantId), protectedBefore, `${code}: the refused commit moved a protected principal`);
    return preview.data;
  }

  /** Preview a permitted change: nothing moves under preview; the commit moves exactly the previewed protected deltas. */
  async function applies(tenantId, subject, operation, input) {
    const hashes = await tableHashes(q);
    const protectedBefore = await protectedState(tenantId);
    const preview = await call(subject, "previewAuthorityChange", { change: { operation, input } });
    assert.equal(preview.ok, true, JSON.stringify(preview));
    assert.equal(preview.data.outcome, "WOULD_APPLY", JSON.stringify(preview.data.refusal));
    assert.deepEqual(await tableHashes(q), hashes);
    assert.deepEqual(await protectedState(tenantId), protectedBefore, "a protected principal moved under preview");
    const real = await call(subject, operation, input);
    assert.equal(real.ok, true, JSON.stringify(real));
    const after = await protectedState(tenantId);
    const movedIds = [...new Set([...Object.keys(after), ...Object.keys(protectedBefore)])]
      .filter((id) => JSON.stringify(after[id]?.snapshot) !== JSON.stringify(protectedBefore[id]?.snapshot)).sort();
    if (preview.data.detail === "FULL") {
      const previewedIds = preview.data.affected.filter((d) => d.protectedStanding !== null).map((d) => d.principalId).sort();
      assert.deepEqual(movedIds, previewedIds, "the protected principals the commit moved are exactly the previewed ones");
    } else {
      // A counts-only actor (the Owner holds no admin.principalAccess.read): the protected COUNTS must match.
      const { owners, administrators } = preview.data.protectedAffected;
      assert.equal(owners + administrators, movedIds.length, "the protected count the commit moved is the previewed one");
    }
    return preview.data;
  }

  const A = T.a;
  const roleIdA = (key) => world.roleId(A, key);
  const adminAssignmentOf = async (tenantId, principalId) => (await q(`SELECT a.id FROM eos_policy.user_role_assignments a JOIN eos_policy.roles r ON r.id = a.role_id
     WHERE a.tenant_id = $1 AND a.principal_id = $2 AND r.key = 'admin' AND a.status = 'active'`, [tenantId, principalId])).rows[0].id;

  // ════════ P2 -- the adversarial seam ════════
  const administratorActor = { tenantId: A, uid: P.a.admin, heldRoleKeys: ["admin"], protectedAdministrator: true };
  const defective = (after) => async (simRepo) => {
    await simRepo.transact({ tenantId: A, uid: "defective-test-command" }, async (tx) => {
      await tx.setAssignmentStatus(P.a.ownerAssignment, "disabled"); // NO guard: this is the defect under test
      await tx.bumpAccessVersion(P.a.owner);
    });
    if (after) await after(simRepo);
  };
  const request = (run) => ({ actor: administratorActor, operation: "revokeRole", input: {}, subject: { kind: "PRINCIPAL", principalId: P.a.owner }, detail: true, run });

  await t.test("P2: a DEFECTIVE command disabling the Owner: the preview reports the loss and the Owner is untouched", async () => {
    const hashes = await tableHashes(q);
    const before = await protectedState(A);
    const r = await world.simulator(request(defective()));
    assert.equal(r.outcome, "WOULD_APPLY");
    const owner = r.report.affected.find((d) => d.principalId === P.a.owner);
    assert.equal(owner.protectedStanding, "OWNER");
    assert.ok(owner.changes.heldRoleKeys.removed.includes("owner"), JSON.stringify(owner.changes));
    assert.equal(owner.before, null, "a protected principal is reported as a delta only");
    assert.deepEqual(await tableHashes(q), hashes);
    assert.deepEqual(await protectedState(A), before, "the Owner moved");
  });
  await t.test("P2: ... with a throw injected after the defect, and with the backend killed mid-preview", async () => {
    const hashes = await tableHashes(q);
    const before = await protectedState(A);
    const thrown = await world.simulator(request(defective(async () => { throw new Error("injected after the defect"); })));
    assert.equal(thrown.outcome, "WOULD_REFUSE");
    await assert.rejects(world.simulator(request(defective(async (simRepo) => {
      const { rows } = await simRepo.pool.query("SELECT pg_backend_pid() AS pid");
      await side.query("SELECT pg_terminate_backend($1)", [rows[0].pid]);
      await simRepo.pool.query("SELECT 1");
    }))));
    assert.deepEqual(await tableHashes(q), hashes);
    assert.deepEqual(await protectedState(A), before);
  });

  // ════════ Owner invariants, refused ════════
  await t.test("I1 LAST_PROTECTED_OWNER", () => refuses(A, "gip-admin-a", "revokeRole", R({ assignmentId: P.a.ownerAssignment }), "LAST_PROTECTED_OWNER"));
  await t.test("I2 PROTECTED_OWNER_MEMBERSHIP: appoint, and remove a non-last Owner", async () => {
    await refuses(A, "gip-admin-a", "assignRole", R({ principalId: P.a.plain, roleId: await roleIdA("owner") }), "PROTECTED_OWNER_MEMBERSHIP");
    P.a.owner2 = await member(A, "gip-owner2-a");
    P.a.owner2Assignment = (await seedProtectedOwner(repo, { tenantId: A, principalId: P.a.owner2 })).id;
    await refuses(A, "gip-admin-a", "revokeRole", R({ assignmentId: P.a.owner2Assignment }), "PROTECTED_OWNER_MEMBERSHIP");
  });
  await t.test("I3/I4 Owner ruling A (owner never admin.dataImport.execute): Role cell, assignment, direct grant", async () => {
    await refuses(A, "gip-admin-a", "grantObjectActionToRole", R({ objectKey: "dataImport", actionKey: "execute", roleKey: "owner" }), "SYSTEM_INVARIANT");
    await grant(A, "partsAssociate", "admin.dataImport.execute");
    await refuses(A, "gip-admin-a", "assignRole", R({ principalId: P.a.owner, roleId: await roleIdA("partsAssociate") }), "SYSTEM_INVARIANT");
    await refuses(A, "gip-admin-a", "grantObjectActionToPrincipal", R({ objectKey: "dataImport", actionKey: "execute", principalId: P.a.owner }), "SYSTEM_INVARIANT");
  });
  await t.test("I6 PROTECTED_ROLE_CONFLICT", async () =>
    refuses(A, "gip-admin-a", "assignRole", R({ principalId: P.a.owner, roleId: await roleIdA("admin") }), "PROTECTED_ROLE_CONFLICT"));
  await t.test("I8 SELF_ADMINISTRATION: the Administrator removing itself; the Owner appointing itself", async () => {
    await refuses(A, "gip-admin-a", "revokeRole", R({ assignmentId: await adminAssignmentOf(A, P.a.admin) }), "SELF_ADMINISTRATION");
    await refuses(A, "gip-owner-a", "assignRole", R({ principalId: P.a.owner, roleId: await roleIdA("admin") }), "SELF_ADMINISTRATION");
  });
  await t.test("I12 ADMIN_NOT_CONDITIONABLE on the Administrator's Role cell", () => refuses(A, "gip-admin-a", "setGrantCondition",
    R({ objectKey: "rolesPermissions", actionKey: "editSecurityPolicy", roleKey: "admin", condition: { paths: [[{ kind: "WORK_ELIGIBILITY", qualificationCode: "PARTS_OPERATIONS" }]] } }),
    "CONDITION_NOT_SUPPORTED"));

  // ════════ the Owner as the ACTOR: R1 Administrator staffing ════════
  await t.test("R1: the Owner appoints an Administrator (WOULD_APPLY), then removes it (WOULD_APPLY)", async () => {
    await applies(A, "gip-owner-a", "assignRole", R({ principalId: P.a.plain2, roleId: await roleIdA("admin") }));
    await applies(A, "gip-owner-a", "revokeRole", R({ assignmentId: await adminAssignmentOf(A, P.a.plain2) }));
  });
  await t.test("R1 refusals: a SCOPED Administrator (I9 PRIVILEGE_ESCALATION); the Owner cannot edit security policy (FORBIDDEN)", async () => {
    await refuses(A, "gip-owner-a", "assignRole", R({ principalId: P.a.plain2, roleId: await roleIdA("admin"), scopeType: "salesChannel", scopeValue: "RETAIL" }), "PRIVILEGE_ESCALATION");
    const forbidden = await call("gip-owner-a", "previewAuthorityChange", { change: { operation: "grantObjectActionToRole",
      input: R({ objectKey: "workOrder", actionKey: "dispatch", roleKey: "partsManager" }) } });
    assert.deepEqual([forbidden.ok, forbidden.code], [false, "FORBIDDEN"]);
  });

  // ════════ anti-lockout (I10) through a DIRECT exception (C7) and a Role assignment (C9) -- tenant B ════════
  await t.test("I10 C7: revoking the last admitted holder's DIRECT admin.securityPolicy.write -> WOULD_REMOVE_LAST_ADMINISTRATION_PATH", async () => {
    const B = T.b;
    await q(`INSERT INTO eos_policy.principal_capabilities (id, tenant_id, principal_id, capability_id, granted_by, created_by, updated_by, exception_reason)
             SELECT 'pc-fx-spw', $1, $2, c.id, 'fixture', 'fixture', 'fixture', 'anti-lockout fixture' FROM eos_policy.capabilities c WHERE c.key = 'admin.securityPolicy.write'`, [B, P.b.disp]);
    await q(`DELETE FROM eos_policy.role_capabilities rc USING eos_policy.roles r, eos_policy.capabilities c
              WHERE rc.role_id = r.id AND rc.capability_id = c.id AND rc.tenant_id = $1 AND r.key = 'admin' AND c.key = 'admin.securityPolicy.write'`, [B]);
    await refuses(B, "gip-admin-b", "revokeObjectActionFromPrincipal", R({ objectKey: "rolesPermissions", actionKey: "editSecurityPolicy", principalId: P.b.disp }),
      "WOULD_REMOVE_LAST_ADMINISTRATION_PATH");
  });
  await t.test("I10 C9: revoking the last admitted Role path to admin.administratorRole.assign -> WOULD_REMOVE_LAST_ADMINISTRATION_PATH", async () => {
    const B = T.b;
    await grant(B, "officeManager", "admin.administratorRole.assign");
    await q(`DELETE FROM eos_policy.role_capabilities rc USING eos_policy.roles r, eos_policy.capabilities c
              WHERE rc.role_id = r.id AND rc.capability_id = c.id AND rc.tenant_id = $1 AND r.key = 'owner' AND c.key = 'admin.administratorRole.assign'`, [B]);
    const assignment = await assign(B, P.b.disp, "officeManager");
    await refuses(B, "gip-admin-b", "revokeRole", R({ assignmentId: assignment.id }), "WOULD_REMOVE_LAST_ADMINISTRATION_PATH");
  });

  // ════════ I11 -- the last administering assignment (tenant C: an Administrator and no Owner) ════════
  await t.test("I11: removing the last administering assignment is refused (message today; PR 2 #2074 adds its code)", async () => {
    const { tenant } = await bootstrapTenant(repo, { key: "gip-c", name: "gip c", actorUid: "fixture" });
    const C = tenant.id;
    await bootstrapAdministrator(repo, { tenantId: C, externalSubject: "gip-admin-c", performedBy: "fixture", reason: "boot" });
    const adminC = (await repo.getPrincipalBySubject("firebase", "gip-admin-c")).id;
    const made = await ensureTenantPrincipal(repo, { tenantId: C, externalSubject: "gip-gm-c", actorUid: "fixture", actorRoleKeys: ["admin"] });
    const gmC = made.principal?.id ?? made.id ?? made.principalId;
    for (const cap of ["admin.roleAssignment.write", "admin.administratorRole.assign"]) await grant(C, "generalManager", cap);
    await assign(C, gmC, "generalManager");
    const hashes = await tableHashes(q);
    const preview = await call("gip-gm-c", "previewAuthorityChange", { change: { operation: "revokeRole",
      input: R({ assignmentId: await adminAssignmentOf(C, adminC) }) } });
    assert.equal(preview.data.outcome, "WOULD_REFUSE", JSON.stringify(preview.data));
    assert.match(preview.data.refusal.message, /last active administering assignment/);
    assert.deepEqual(await tableHashes(q), hashes);
    const real = await call("gip-gm-c", "revokeRole", R({ assignmentId: await adminAssignmentOf(C, adminC) }));
    assert.deepEqual([real.ok, real.code, real.message], [false, preview.data.refusal.category, preview.data.refusal.message]);
  });
});
