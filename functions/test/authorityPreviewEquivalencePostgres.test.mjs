// GRANT-IMPACT PREVIEW (PR 3, advisory) -- EQUIVALENCE, REFUSALS, READ GATING, TENANT ISOLATION, DIGESTS.
//
// For every one of the nine authority-changing commands, on a fixture covering a scoped holder, a conditioned grant, a
// direct-exception overlap, protected Administrator standing, a protected Owner, an ineligible employee, a stale
// assignment and a principal holding two Roles (partsManager + purchasingManager), each step:
//
//   1. previews the change through the Administration API (previewAuthorityChange) and proves the preview left NO trace:
//      every eos_policy and eos_workforce table (audit_events, decisions, access versions included) byte-identical;
//   2. COMMITS the same request through the unchanged command path;
//   3. diffs a TENANT-WIDE resolver snapshot before/after the commit and requires it to EQUAL the preview's report
//      exactly -- not only for the principals the preview thought were candidates;
//   4. requires WOULD_REFUSE to carry the SAME code and message the commit returns, NO_OP to write nothing, and
//      object-wide perAction to equal the command's own result.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { ASSIGNED_ONLY, FIELD_GROUPS, PARTS_ELIGIBLE, buildPreviewWorld, privateDatabase, tableHashes } from "./support/authorityPreviewFixture.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const require = createRequire(import.meta.url);
const { snapshotTenantAuthority, diffTenantAuthority } = require("../lib/eosOps/authorityChangePreview.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");

const ADMIN = "gip-admin-a";
const GM = "gip-gm-a";
const json = (v) => JSON.parse(JSON.stringify(v));

test("GRANT-IMPACT PREVIEW: preview == post-commit tenant-wide resolver diff, for all nine commands", { skip: SKIP, concurrency: 1 }, async (t) => {
  const db = await privateDatabase(URL_BASE, "gip_equiv");
  let world;
  t.after(async () => { await world?.pool.end(); await db.drop(); });
  world = await buildPreviewWorld(db.url);
  const { q, pool, repo, call, T, P } = world;
  const A = T.a;
  const auditCount = async (tenant) => Number((await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id=$1`, [tenant])).rows[0].n);
  const roleId = (key) => world.roleId(A, key);
  const outcomes = new Map();

  /** One previewed-then-committed step. Returns the preview report. */
  async function step(label, subject, operation, input, expect) {
    const hashes = await tableHashes(q);
    const snapBefore = await snapshotTenantAuthority(pool, repo, A, FIELD_GROUPS);
    const previewed = await call(subject, "previewAuthorityChange", { change: { operation, input } });
    assert.equal(previewed.ok, true, `${label}: ${JSON.stringify(previewed)}`);
    const report = previewed.data;
    assert.deepEqual(await tableHashes(q), hashes, `${label}: the preview left a trace in the database`);
    assert.equal(report.outcome, expect.outcome, `${label}: ${JSON.stringify(report.refusal)}`);
    const audit = await auditCount(A);
    const real = await call(subject, operation, input);
    const snapAfter = await snapshotTenantAuthority(pool, repo, A, FIELD_GROUPS);
    const diff = json(diffTenantAuthority(snapBefore, snapAfter));
    if (expect.outcome === "WOULD_REFUSE") {
      assert.equal(real.ok, false, `${label}: the commit was expected to refuse`);
      assert.equal(report.refusal.code, expect.code, `${label}: ${JSON.stringify(report.refusal)}`);
      assert.equal(real.code, report.refusal.category, `${label}: category`);
      assert.equal(real.message, report.refusal.message, `${label}: message`);
      assert.deepEqual(diff, [], `${label}: a refused commit changed authority`);
      assert.equal(await auditCount(A), audit, `${label}: a refused commit wrote audit`);
    } else {
      assert.equal(real.ok, true, `${label}: ${JSON.stringify(real)}`);
      assert.equal(report.refusal, null);
      if (expect.outcome === "NO_OP") {
        assert.equal(await auditCount(A), audit, `${label}: NO_OP but the commit audited`);
        assert.deepEqual(diff, [], `${label}: NO_OP but authority moved`);
      } else {
        assert.ok(await auditCount(A) > audit, `${label}: WOULD_APPLY but the commit wrote nothing`);
      }
    }
    // ── THE EQUIVALENCE ──
    assert.equal(report.affectedCount, diff.length, `${label}: affectedCount`);
    if (report.detail === "FULL") {
      assert.deepEqual(report.affected.map(({ before, after, ...d }) => d), diff, `${label}: preview != post-commit diff`);
      for (const d of report.affected) {
        if (d.protectedStanding === null) {
          assert.deepEqual(d.before, json(snapBefore.get(d.principalId)), `${label}: before snapshot of ${d.principalId}`);
          assert.deepEqual(d.after, json(snapAfter.get(d.principalId)), `${label}: after snapshot of ${d.principalId}`);
        } else {
          assert.equal(d.before, null, `${label}: a protected principal's full snapshot was disclosed`);
          assert.equal(d.after, null);
        }
      }
    } else {
      assert.equal(report.detail, "COUNTS_ONLY");
      assert.equal(report.affected, undefined, `${label}: counts-only preview disclosed principals`);
    }
    if (operation === "applyObjectWideRoleAuthority" && real.ok) {
      assert.deepEqual(report.perAction.map((a) => [a.capabilityKey, a.outcome, a.refusalCode]),
        real.data.actions.map((a) => [a.capabilityKey, a.outcome, a.refusal === null ? null : a.refusal.split(":")[0]]),
        `${label}: perAction != ObjectWideResult`);
    }
    for (const k of ["inputDigest", "policyStateDigest", "beforeDigest", "impactDigest"]) assert.match(report.digests[k], /^[0-9a-f]{64}$/);
    outcomes.set(label, { operation, outcome: report.outcome, code: report.refusal?.code ?? null });
    return { report, diff, real };
  }
  const R = (extra) => ({ reason: "preview equivalence", ...extra });

  // ════════ C1 grantObjectActionToRole ════════
  await t.test("C1 grant to one of TWO Roles a principal holds: WOULD_APPLY, the dual holder unaffected", async () => {
    const { report } = await step("C1 apply (dual holder unaffected)", ADMIN, "grantObjectActionToRole",
      R({ objectKey: "purchaseOrder", actionKey: "read", roleKey: "partsManager" }), { outcome: "WOULD_APPLY" });
    assert.equal(report.affectedCount, 0, "pp already holds reorder.purchaseOrder.read through purchasingManager");
    assert.equal(report.unaffectedHolders, 1);
  });
  await t.test("C1 identical grant: NO_OP", () => step("C1 no-op", ADMIN, "grantObjectActionToRole",
    R({ objectKey: "purchaseOrder", actionKey: "read", roleKey: "partsManager" }), { outcome: "NO_OP" }));
  await t.test("C1 grant reaching a governed FIELD GROUP: the field-group access moves", async () => {
    const { report } = await step("C1 field groups", ADMIN, "grantObjectActionToRole",
      R({ objectKey: "supplierCatalogItem", actionKey: "readTerms", roleKey: "purchasingManager" }), { outcome: "WOULD_APPLY" });
    const pp = report.affected.find((d) => d.principalId === P.a.pp);
    assert.ok(pp.changes.fieldGroups.added.includes("supplierCatalogItem.COMMERCIAL:read"), JSON.stringify(pp.changes));
    assert.ok(pp.changes.flat.added.includes("inventory.supplierTerms.read"));
  });
  await t.test("C1 Owner ruling A at the ROLE: owner never admin.dataImport.execute -> SYSTEM_INVARIANT", () => step("C1 owner dataImport",
    ADMIN, "grantObjectActionToRole", R({ objectKey: "dataImport", actionKey: "execute", roleKey: "owner" }), { outcome: "WOULD_REFUSE", code: "SYSTEM_INVARIANT" }));
  await t.test("C1 Owner ruling A at the PRINCIPAL (an owner holder of the Role) -> SYSTEM_INVARIANT", () => step("C1 owner principal",
    ADMIN, "grantObjectActionToRole", R({ objectKey: "reorderRequest", actionKey: "assign", roleKey: "dispatcher" }), { outcome: "WOULD_REFUSE", code: "SYSTEM_INVARIANT" }));
  await t.test("C1 widening a Role the actor holds -> SELF_ADMINISTRATION", () => step("C1 self",
    ADMIN, "grantObjectActionToRole", R({ objectKey: "auditLog", actionKey: "read", roleKey: "admin" }), { outcome: "WOULD_REFUSE", code: "SELF_ADMINISTRATION" }));
  await t.test("C1 a condition on an admin.* key -> CONDITION_NOT_SUPPORTED (ADMIN_NOT_CONDITIONABLE)", () => step("C1 admin conditioned",
    ADMIN, "grantObjectActionToRole", R({ objectKey: "principal", actionKey: "read", roleKey: "dispatcher", condition: ASSIGNED_ONLY }),
    { outcome: "WOULD_REFUSE", code: "CONDITION_NOT_SUPPORTED" }));
  await t.test("C1 Administration to a Role with a scoped holder -> SCOPE_AMBIGUOUS_ADMINISTRATION", () => step("C1 scoped admin",
    ADMIN, "grantObjectActionToRole", R({ objectKey: "rolesPermissions", actionKey: "read", roleKey: "salesManager" }),
    { outcome: "WOULD_REFUSE", code: "SCOPE_AMBIGUOUS_ADMINISTRATION" }));
  await t.test("C1 no reason -> REASON_REQUIRED", () => step("C1 reason", ADMIN, "grantObjectActionToRole",
    { objectKey: "workOrder", actionKey: "dispatch", roleKey: "partsManager" }, { outcome: "WOULD_REFUSE", code: "REASON_REQUIRED" }));
  await t.test("C1 CONDITIONED grant: the key is conditionallyHeld, never flat", async () => {
    const { report } = await step("C1 conditioned", ADMIN, "grantObjectActionToRole",
      R({ objectKey: "workOrder", actionKey: "read", roleKey: "partsManager", condition: PARTS_ELIGIBLE }), { outcome: "WOULD_APPLY" });
    const pp = report.affected.find((d) => d.principalId === P.a.pp);
    assert.deepEqual(pp.changes.conditionallyHeld.added, ["workOrder.record.read"]);
    assert.equal(pp.changes.flat?.added.includes("workOrder.record.read") ?? false, false);
  });

  // ════════ C2 revokeObjectActionFromRole ════════
  await t.test("C2 revoke from one of two Roles: the dual holder keeps the key", async () => {
    const { report } = await step("C2 dual keep", ADMIN, "revokeObjectActionFromRole",
      R({ objectKey: "purchaseOrder", actionKey: "read", roleKey: "purchasingManager" }), { outcome: "WOULD_APPLY" });
    assert.equal(report.affectedCount, 0);
  });
  await t.test("C2 revoke from the last Role: the dual holder loses it", async () => {
    const { report } = await step("C2 dual lose", ADMIN, "revokeObjectActionFromRole",
      R({ objectKey: "purchaseOrder", actionKey: "read", roleKey: "partsManager" }), { outcome: "WOULD_APPLY" });
    assert.deepEqual(report.affected.find((d) => d.principalId === P.a.pp).changes.flat.removed, ["reorder.purchaseOrder.read"]);
  });
  await t.test("C2 revoke of something not held: NO_OP", () => step("C2 no-op", ADMIN, "revokeObjectActionFromRole",
    R({ objectKey: "purchaseOrder", actionKey: "read", roleKey: "partsManager" }), { outcome: "NO_OP" }));
  await t.test("C2 anti-lockout -> WOULD_REMOVE_LAST_ADMINISTRATION_PATH", () => step("C2 anti-lockout", ADMIN, "revokeObjectActionFromRole",
    R({ objectKey: "rolesPermissions", actionKey: "editSecurityPolicy", roleKey: "admin" }), { outcome: "WOULD_REFUSE", code: "WOULD_REMOVE_LAST_ADMINISTRATION_PATH" }));

  // ════════ C3 applyObjectWideRoleAuthority ════════
  await t.test("C3 object-wide GRANT: perAction == the command's result, one savepoint per action", async () => {
    const { report } = await step("C3 grant", ADMIN, "applyObjectWideRoleAuthority",
      R({ objectKey: "supplierCatalogItem", roleKey: "purchasingManager", mode: "GRANT" }), { outcome: "WOULD_APPLY" });
    assert.ok(report.perAction.some((a) => a.outcome === "ALREADY_HELD") && report.perAction.some((a) => a.outcome === "GRANTED"));
  });
  await t.test("C3 object-wide GRANT where every action is refused: NO_OP with REFUSED per action", async () => {
    const { report } = await step("C3 all refused", ADMIN, "applyObjectWideRoleAuthority",
      R({ objectKey: "dataImport", roleKey: "owner", mode: "GRANT" }), { outcome: "NO_OP" });
    assert.ok(report.perAction.length > 0 && report.perAction.every((a) => a.outcome === "REFUSED" && a.refusalCode === "SYSTEM_INVARIANT"));
  });
  await t.test("C3 object-wide REVOKE", () => step("C3 revoke", ADMIN, "applyObjectWideRoleAuthority",
    R({ objectKey: "supplierCatalogItem", roleKey: "purchasingManager", mode: "REVOKE" }), { outcome: "WOULD_APPLY" }));

  // ════════ C4 setGrantCondition ════════
  await t.test("C4 condition on a held Role grant: holders move flat -> conditioned; the direct-exception overlap stays flat", async () => {
    const { report } = await step("C4 role", ADMIN, "setGrantCondition",
      R({ objectKey: "workOrder", actionKey: "read", roleKey: "dispatcher", condition: ASSIGNED_ONLY }), { outcome: "WOULD_APPLY" });
    const disp = report.affected.find((d) => d.principalId === P.a.disp);
    assert.deepEqual(disp.changes.flat.removed, ["workOrder.record.read"]);
    assert.equal(report.affected.some((d) => d.principalId === P.a.dx && d.changes.flat), false,
      "dx keeps workOrder.record.read flat through its unconditioned DIRECT exception");
    const owner = report.affected.find((d) => d.principalId === P.a.owner);
    assert.equal(owner.protectedStanding, "OWNER");
    assert.ok(owner.notes.includes("PROTECTED_OWNER_REDUCED: a protected Owner loses authority"));
  });
  await t.test("C4 identical condition: NO_OP", () => step("C4 no-op", ADMIN, "setGrantCondition",
    R({ objectKey: "workOrder", actionKey: "read", roleKey: "dispatcher", condition: ASSIGNED_ONLY }), { outcome: "NO_OP" }));
  await t.test("C4 condition on an admin key -> CONDITION_NOT_SUPPORTED", () => step("C4 admin key", ADMIN, "setGrantCondition",
    R({ objectKey: "rolesPermissions", actionKey: "read", roleKey: "dispatcher", condition: ASSIGNED_ONLY }), { outcome: "WOULD_REFUSE", code: "CONDITION_NOT_SUPPORTED" }));
  await t.test("C4 condition on a DIRECT exception: the overlap principal now holds it conditioned only", async () => {
    const { report } = await step("C4 principal", ADMIN, "setGrantCondition",
      R({ objectKey: "workOrder", actionKey: "read", principalId: P.a.dx, condition: PARTS_ELIGIBLE }), { outcome: "WOULD_APPLY" });
    assert.deepEqual(report.affected.find((d) => d.principalId === P.a.dx).changes.flat.removed, ["workOrder.record.read"]);
  });
  await t.test("C4 condition on the actor's own direct cell -> SELF_ADMINISTRATION", () => step("C4 self", ADMIN, "setGrantCondition",
    R({ objectKey: "workOrder", actionKey: "read", principalId: P.a.admin, condition: PARTS_ELIGIBLE }), { outcome: "WOULD_REFUSE", code: "SELF_ADMINISTRATION" }));

  // ════════ C5 retireGrantCondition ════════
  await t.test("C5 retire while held -> CONDITION_RETIREMENT_WOULD_WIDEN", () => step("C5 widen", ADMIN, "retireGrantCondition",
    R({ objectKey: "workOrder", actionKey: "read", roleKey: "dispatcher" }), { outcome: "WOULD_REFUSE", code: "CONDITION_RETIREMENT_WOULD_WIDEN" }));
  await t.test("C5 retire where no condition exists: NO_OP", () => step("C5 no-op", ADMIN, "retireGrantCondition",
    R({ objectKey: "workOrder", actionKey: "read", roleKey: "salesManager" }), { outcome: "NO_OP" }));
  await t.test("C2 then C5: revoke the conditioned grant, then retire its condition (WOULD_APPLY, no authority moves)", async () => {
    await step("C2 conditioned revoke", ADMIN, "revokeObjectActionFromRole", R({ objectKey: "workOrder", actionKey: "read", roleKey: "technician" }), { outcome: "WOULD_APPLY" });
    const { report } = await step("C5 apply", ADMIN, "retireGrantCondition", R({ objectKey: "workOrder", actionKey: "read", roleKey: "technician" }), { outcome: "WOULD_APPLY" });
    assert.equal(report.affectedCount, 0);
  });

  // ════════ C6 / C7 direct exceptions ════════
  const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
  await t.test("C6 direct exception: WOULD_APPLY, then NO_OP", async () => {
    await step("C6 apply", ADMIN, "grantObjectActionToPrincipal", R({ objectKey: "opportunity", actionKey: "read", principalId: P.a.plain, expiresAt: future }), { outcome: "WOULD_APPLY" });
    await step("C6 no-op", ADMIN, "grantObjectActionToPrincipal", R({ objectKey: "opportunity", actionKey: "read", principalId: P.a.plain, expiresAt: future }), { outcome: "NO_OP" });
  });
  await t.test("C6 refusals: reserved key, Owner ruling A, scope, self", async () => {
    await step("C6 reserved", ADMIN, "grantObjectActionToPrincipal", R({ objectKey: "salesAgreement", actionKey: "approveTradeIn", principalId: P.a.plain }), { outcome: "WOULD_REFUSE", code: "SYSTEM_INVARIANT" });
    await step("C6 owner", ADMIN, "grantObjectActionToPrincipal", R({ objectKey: "reorderRequest", actionKey: "assign", principalId: P.a.owner }), { outcome: "WOULD_REFUSE", code: "SYSTEM_INVARIANT" });
    await step("C6 owner dataImport", ADMIN, "grantObjectActionToPrincipal", R({ objectKey: "dataImport", actionKey: "execute", principalId: P.a.owner }), { outcome: "WOULD_REFUSE", code: "SYSTEM_INVARIANT" });
    await step("C6 scope", ADMIN, "grantObjectActionToPrincipal", R({ objectKey: "opportunity", actionKey: "read", principalId: P.a.plain2, scopeType: "salesChannel", scopeValue: "RETAIL" }), { outcome: "WOULD_REFUSE", code: "DIRECT_GRANT_SCOPE_UNSUPPORTED" });
    await step("C6 self", ADMIN, "grantObjectActionToPrincipal", R({ objectKey: "opportunity", actionKey: "read", principalId: P.a.admin }), { outcome: "WOULD_REFUSE", code: "SELF_ADMINISTRATION" });
  });
  await t.test("C7 revoke the direct exception: WOULD_APPLY, then NO_OP", async () => {
    await step("C7 apply", ADMIN, "revokeObjectActionFromPrincipal", R({ objectKey: "opportunity", actionKey: "read", principalId: P.a.plain }), { outcome: "WOULD_APPLY" });
    await step("C7 no-op", ADMIN, "revokeObjectActionFromPrincipal", R({ objectKey: "opportunity", actionKey: "read", principalId: P.a.plain }), { outcome: "NO_OP" });
  });

  // ════════ C8 assignRole ════════
  await t.test("C8 global assignment: WOULD_APPLY, then NO_OP (idempotent, no transaction)", async () => {
    await step("C8 apply", ADMIN, "assignRole", R({ principalId: P.a.plain, roleId: await roleId("dispatcher") }), { outcome: "WOULD_APPLY" });
    await step("C8 no-op", ADMIN, "assignRole", R({ principalId: P.a.plain, roleId: await roleId("dispatcher") }), { outcome: "NO_OP" });
  });
  await t.test("C8 SCOPED assignment: digests are deterministic (no generated assignment id, no clock)", async () => {
    const input = R({ principalId: P.a.plain2, roleId: await roleId("salesManager"), scopeType: "salesChannel", scopeValue: "RETAIL" });
    const first = await call(ADMIN, "previewAuthorityChange", { change: { operation: "assignRole", input } });
    const second = await call(ADMIN, "previewAuthorityChange", { change: { operation: "assignRole", input } });
    assert.deepEqual(second.data.digests, first.data.digests, "two previews of the same scoped assignment must bind identically");
    const { report } = await step("C8 scoped", ADMIN, "assignRole", input, { outcome: "WOULD_APPLY" });
    assert.deepEqual(report.digests, first.data.digests);
    const holder = report.affected.find((d) => d.principalId === P.a.plain2);
    assert.deepEqual(holder.changes.scopedHeld.added, ["opportunity.read@salesChannel=RETAIL via salesManager"]);
    assert.deepEqual(holder.changes.inertScoped.added, ["workOrder.record.read@salesChannel=RETAIL via salesManager (SCOPE_NOT_EVALUABLE_FOR_CAPABILITY)"]);
    assert.equal(JSON.stringify(report).includes("assignmentId"), false);
  });
  await t.test("C8 refusals: protected Owner, Owner/Administrator conflict, self, privilege escalation, scope", async () => {
    await step("C8 owner membership", ADMIN, "assignRole", R({ principalId: P.a.plain, roleId: await roleId("owner") }), { outcome: "WOULD_REFUSE", code: "PROTECTED_OWNER_MEMBERSHIP" });
    await step("C8 role conflict", ADMIN, "assignRole", R({ principalId: P.a.owner, roleId: await roleId("admin") }), { outcome: "WOULD_REFUSE", code: "PROTECTED_ROLE_CONFLICT" });
    await step("C8 self", ADMIN, "assignRole", R({ principalId: P.a.admin, roleId: await roleId("technician") }), { outcome: "WOULD_REFUSE", code: "SELF_ADMINISTRATION" });
    await step("C8 escalation", GM, "assignRole", R({ principalId: P.a.plain2, roleId: await roleId("admin") }), { outcome: "WOULD_REFUSE", code: "PRIVILEGE_ESCALATION" });
    await step("C8 scope", ADMIN, "assignRole", R({ principalId: P.a.plain2, roleId: await roleId("dispatcher"), scopeType: "salesChannel", scopeValue: "RETAIL" }),
      { outcome: "WOULD_REFUSE", code: "SCOPE_NOT_EVALUABLE_FOR_ROLE" });
  });
  await t.test("C8 the access-version bump RE-QUALIFIES a stale assignment (F-5), and the preview shows it", async () => {
    const { report } = await step("C8 stale", ADMIN, "assignRole", R({ principalId: P.a.stale, roleId: await roleId("generalEmployee") }), { outcome: "WOULD_APPLY" });
    const stale = report.affected.find((d) => d.principalId === P.a.stale);
    assert.ok(stale.changes.heldRoleKeys.added.includes("dispatcher"), JSON.stringify(stale));
    assert.ok(stale.notes.some((n) => n.startsWith("STALE_REQUALIFIED")));
  });
  await t.test("C8 an INELIGIBLE employee: resolution refuses; the change is latent only", async () => {
    const { report } = await step("C8 ineligible", ADMIN, "assignRole", R({ principalId: P.a.inel, roleId: await roleId("purchasingManager") }), { outcome: "WOULD_APPLY" });
    const inel = report.affected.find((d) => d.principalId === P.a.inel);
    assert.equal(inel.after?.status ?? "EMPLOYEE_NOT_ACCESS_ELIGIBLE", "EMPLOYEE_NOT_ACCESS_ELIGIBLE");
    assert.equal(inel.changes.flat, undefined, "an ineligible principal gains NOTHING at runtime");
    assert.ok(inel.changes.latent.added.includes("reorder.purchaseOrder.read") || inel.changes.latent.added.length > 0);
    assert.ok(inel.notes.some((n) => n.startsWith("INELIGIBLE")));
  });
  await t.test("C8 by an actor WITHOUT admin.principalAccess.read: counts only, still equivalent", async () => {
    const { report } = await step("C8 counts only", GM, "assignRole", R({ principalId: P.a.plain2, roleId: await roleId("partsManager") }), { outcome: "WOULD_APPLY" });
    assert.equal(report.detail, "COUNTS_ONLY");
    assert.equal(report.affectedCount, 1);
    assert.equal(JSON.stringify(report).includes(P.a.plain2), false, "no principal id in a counts-only preview");
  });

  // ════════ C9 revokeRole ════════
  const assignmentOf = async (principalId, key) => (await q(`SELECT a.id FROM eos_policy.user_role_assignments a JOIN eos_policy.roles r ON r.id=a.role_id
      WHERE a.tenant_id=$1 AND a.principal_id=$2 AND r.key=$3 ORDER BY a.status, a.created_at LIMIT 1`, [A, principalId, key])).rows[0].id;
  await t.test("C9 revoke: WOULD_APPLY; revoking it again re-disables and bumps (WOULD_APPLY, access version only)", async () => {
    const id = await assignmentOf(P.a.plain, "dispatcher");
    await step("C9 apply", ADMIN, "revokeRole", R({ assignmentId: id }), { outcome: "WOULD_APPLY" });
    const { report } = await step("C9 again", ADMIN, "revokeRole", R({ assignmentId: id }), { outcome: "WOULD_APPLY" });
    assert.ok(report.affected[0].notes.some((n) => n.startsWith("ACCESS_VERSION_ONLY")));
  });
  await t.test("C9 refusals: LAST_PROTECTED_OWNER, Administrator self-removal", async () => {
    await step("C9 last owner", ADMIN, "revokeRole", R({ assignmentId: P.a.ownerAssignment }), { outcome: "WOULD_REFUSE", code: "LAST_PROTECTED_OWNER" });
    await step("C9 self", ADMIN, "revokeRole", R({ assignmentId: await assignmentOf(P.a.admin, "admin") }), { outcome: "WOULD_REFUSE", code: "SELF_ADMINISTRATION" });
  });

  // ════════ protected impact ════════
  await t.test("P1: a permitted change that REDUCES the Owner: WOULD_APPLY, reported as a delta only, state untouched by the preview", async () => {
    const { report } = await step("P1 owner reduced", ADMIN, "revokeObjectActionFromRole",
      R({ objectKey: "rolesPermissions", actionKey: "assignRole", roleKey: "owner" }), { outcome: "WOULD_APPLY" });
    const owner = report.affected.find((d) => d.principalId === P.a.owner);
    assert.equal(owner.protectedStanding, "OWNER");
    assert.deepEqual(owner.changes.flat.removed, ["admin.roleAssignment.write"]);
    assert.equal(report.protectedAffected.owners, 1);
  });

  // ════════ coverage ════════
  await t.test("coverage: all nine commands previewed, every outcome reached", () => {
    const ops = new Set([...outcomes.values()].map((o) => o.operation));
    assert.equal(ops.size, 9, [...ops].join(","));
    for (const o of ["WOULD_APPLY", "NO_OP", "WOULD_REFUSE"]) assert.ok([...outcomes.values()].some((x) => x.outcome === o), o);
    const codes = new Set([...outcomes.values()].map((o) => o.code).filter(Boolean));
    for (const code of ["LAST_PROTECTED_OWNER", "PROTECTED_OWNER_MEMBERSHIP", "SYSTEM_INVARIANT", "PROTECTED_ROLE_CONFLICT",
      "WOULD_REMOVE_LAST_ADMINISTRATION_PATH", "SELF_ADMINISTRATION", "CONDITION_NOT_SUPPORTED", "PRIVILEGE_ESCALATION",
      "SCOPE_AMBIGUOUS_ADMINISTRATION", "CONDITION_RETIREMENT_WOULD_WIDEN", "DIRECT_GRANT_SCOPE_UNSUPPORTED", "REASON_REQUIRED",
      "SCOPE_NOT_EVALUABLE_FOR_ROLE"]) assert.ok(codes.has(code), `refusal ${code} was never reproduced`);
  });

  // ════════ read gating ════════
  await t.test("GATE: an actor who could not perform the change gets FORBIDDEN and NO simulation runs", async () => {
    const before = world.statements.length;
    for (const [subject, operation, input] of [
      [GM, "grantObjectActionToRole", R({ objectKey: "workOrder", actionKey: "dispatch", roleKey: "partsManager" })],
      ["gip-plain-a", "assignRole", R({ principalId: P.a.plain2, roleId: await roleId("dispatcher") })],
      ["gip-disp-a", "revokeRole", R({ assignmentId: P.a.ownerAssignment })],
    ]) {
      const r = await call(subject, "previewAuthorityChange", { change: { operation, input } });
      assert.deepEqual([r.ok, r.code], [false, "FORBIDDEN"], JSON.stringify(r));
      assert.equal(JSON.stringify(r).includes(P.a.owner), false);
    }
    assert.equal(world.statements.length, before, "a refused caller caused a simulation");
  });
  await t.test("GATE: only the nine commands are previewable, and the operation is not a mutation", async () => {
    for (const operation of ["createRole", "setTenantSalesChannelStatus", "previewAuthorityChange", "", null]) {
      const r = await call(ADMIN, "previewAuthorityChange", { change: { operation, input: {} } });
      assert.deepEqual([r.ok, r.code], [false, "INVALID_INPUT"], String(operation));
    }
    const r = await call(ADMIN, "previewAuthorityChange", {});
    assert.deepEqual([r.ok, r.code], [false, "INVALID_INPUT"]);
  });
  await t.test("GATE: a server that did not compose the simulator refuses (no repository fallback)", async () => {
    const r = await executeAdminOperation({ repo }, { caller: { externalSubject: ADMIN, identityProvider: "firebase" },
      operation: "previewAuthorityChange", input: { change: { operation: "assignRole", input: R({ principalId: P.a.plain2, roleId: await roleId("dispatcher") }) } } });
    assert.deepEqual([r.ok, r.code], [false, "INTERNAL"]);
  });

  // ════════ tenant isolation ════════
  await t.test("ISOLATION: a tenant-B preview never sees, lists or touches tenant A", async () => {
    const hashes = await tableHashes(q);
    const foreign = await call("gip-admin-b", "previewAuthorityChange", { change: { operation: "assignRole",
      input: R({ principalId: P.a.plain2, roleId: (await repo.getRoleByKey(T.b, "dispatcher")).id }) } });
    assert.equal(foreign.data.outcome, "WOULD_REFUSE");
    assert.equal(foreign.data.refusal.code, "INVALID_INPUT");
    const own = await call("gip-admin-b", "previewAuthorityChange", { change: { operation: "grantObjectActionToRole",
      input: R({ objectKey: "purchaseOrder", actionKey: "read", roleKey: "dispatcher" }) } });
    assert.equal(own.data.outcome, "WOULD_APPLY");
    const ids = own.data.affected.map((d) => d.principalId).sort();
    assert.deepEqual(ids, [P.b.disp, P.b.owner].sort());
    const text = JSON.stringify([foreign, own]);
    for (const id of Object.values(P.a)) assert.equal(text.includes(id), false, `tenant A principal ${id} leaked into a tenant B preview`);
    assert.deepEqual(await tableHashes(q), hashes);
  });
  await t.test("DIGEST: the policy-state digest moves with policy and with nothing else", async () => {
    const input = { change: { operation: "assignRole", input: R({ principalId: P.a.plain2, roleId: await roleId("technician") }) } };
    const one = (await call(ADMIN, "previewAuthorityChange", input)).data.digests;
    const again = (await call(ADMIN, "previewAuthorityChange", input)).data.digests;
    assert.deepEqual(again, one);
    // An unrelated non-Administration fact the resolver reads (an employment status) moves the state digest.
    await q(`UPDATE eos_workforce.employees SET employment_status = 'ACTIVE' WHERE id = 'emp-gip-inel'`);
    const moved = (await call(ADMIN, "previewAuthorityChange", input)).data.digests;
    assert.notEqual(moved.policyStateDigest, one.policyStateDigest);
    assert.equal(moved.inputDigest, one.inputDigest);
  });
});
