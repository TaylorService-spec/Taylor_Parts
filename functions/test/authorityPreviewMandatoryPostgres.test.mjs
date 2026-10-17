// MANDATORY GRANT-IMPACT PREVIEW (PR 4) -- the commit side, on PostgreSQL.
//
//   FLAG ON   every one of the nine authority changes needs a fresh previewDigest: absent -> PREVIEW_REQUIRED (428),
//             malformed -> PREVIEW_INVALID (400), moved -> STALE_PREVIEW (409); nothing written, nothing audited.
//   COMMIT    "the preview, ending in COMMIT": recomputed under the governance lock; the tenant-wide post-commit diff
//             equals the preview; every audit row of the commit carries {HUMAN_PREVIEWED, previewDigest, affectedCount}.
//   STALE     a concurrent commit, an employee status change, an assignment change, a condition change, a change landing
//             between the in-lock preview and the write, a replay, another actor, an altered input -> STALE_PREVIEW.
//   OWNER     every protected Owner / Administrator refusal is still returned through the mandatory path (same code,
//             same message), and no Owner's effective authority moves on any refused or stale attempt.
//   FLAG OFF  the engine never runs (today's path); a supplied digest (any value, null and "" too) is IGNORED.
import { endPoolAndDrain } from "./support/poolTeardown.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { ASSIGNED_ONLY, FIELD_GROUPS, PARTS_ELIGIBLE, buildPreviewWorld, privateDatabase, tableHashes } from "./support/authorityPreviewFixture.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const require = createRequire(import.meta.url);
const { snapshotTenantAuthority, diffTenantAuthority } = require("../lib/eosOps/authorityChangePreview.js");
const { createAuthorityChangeCommit } = require("../lib/eosOps/authorityChangeCommit.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const { handleAdminRequest } = require("../lib/adminPolicy/adminPolicyHttp.js");

const ADMIN = "gip-admin-a";
const GM = "gip-gm-a";
const json = (v) => JSON.parse(JSON.stringify(v));
const R = (extra) => ({ reason: "mandatory preview", ...extra });

test("MANDATORY PREVIEW: required, verified, stale-proof, audited, Owner-safe", { skip: SKIP, concurrency: 1 }, async (t) => {
  const db = await privateDatabase(URL_BASE, "gip_mand");
  let world;
  t.after(async () => { await endPoolAndDrain(world?.pool); await db.drop(); });
  world = await buildPreviewWorld(db.url);
  const { q, pool, repo, T, P } = world;
  const A = T.a;
  const commitStatements = [];
  let between = null;
  const committer = createAuthorityChangeCommit({
    pool, fieldGroups: FIELD_GROUPS,
    onStatements: (log) => commitStatements.push(log),
    betweenPasses: async () => { const fn = between; between = null; if (fn) await fn(); },
  });
  let engineCalls = 0;
  const counted = async (request) => { engineCalls += 1; return committer(request); };
  const ON = { ...world.deps, commitAuthorityChange: counted, previewMandatory: true };
  const OFF = { ...world.deps, commitAuthorityChange: counted };
  const call = (deps, subject, operation, input) => executeAdminOperation(deps,
    { caller: { externalSubject: subject, identityProvider: "firebase" }, operation, input, requestId: `mand-${operation}` });
  const preview = async (subject, operation, input) => {
    const r = await call(ON, subject, "previewAuthorityChange", { change: { operation, input } });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(r.data.digests.previewDigest, /^[0-9a-f]{64}$/);
    return r.data;
  };
  const commit = (subject, operation, input, previewDigest, deps = ON) =>
    call(deps, subject, operation, previewDigest === undefined ? input : { ...input, previewDigest });
  const roleId = (key) => world.roleId(A, key);
  const auditIds = async () => new Set((await q(`SELECT id FROM eos_policy.audit_events WHERE tenant_id=$1`, [A])).rows.map((r) => r.id));
  const newAudit = async (before) => (await q(`SELECT id, action, after FROM eos_policy.audit_events WHERE tenant_id=$1`, [A])).rows
    .filter((r) => !before.has(r.id));
  const ownerSnapshot = async () => json((await snapshotTenantAuthority(pool, repo, A, FIELD_GROUPS)).get(P.a.owner));
  const adminSnapshot = async () => json((await snapshotTenantAuthority(pool, repo, A, FIELD_GROUPS)).get(P.a.admin));

  /** A refused commit: the code in the message, the category, and NOTHING moved. */
  async function refusedCommit(label, run, { category, code }) {
    const hashes = await tableHashes(q);
    const owner = await ownerSnapshot();
    const r = await run();
    assert.equal(r.ok, false, `${label}: ${JSON.stringify(r)}`);
    assert.equal(r.code, category, `${label}: ${JSON.stringify(r)}`);
    assert.ok(r.message.startsWith(`${code}: `), `${label}: ${r.message}`);
    assert.deepEqual(await tableHashes(q), hashes, `${label}: a refused commit left a trace`);
    assert.deepEqual(await ownerSnapshot(), owner, `${label}: the Owner's authority moved`);
    return r;
  }

  /** A previewed commit: equals the preview tenant-wide; every audit row of the commit is marked. */
  async function previewedCommit(label, subject, operation, input, deps = ON) {
    const report = await preview(subject, operation, input);
    assert.ok(["WOULD_APPLY", "NO_OP"].includes(report.outcome), `${label}: ${JSON.stringify(report.refusal)}`);
    const before = await snapshotTenantAuthority(pool, repo, A, FIELD_GROUPS);
    const ids = await auditIds();
    const r = await commit(subject, operation, input, report.digests.previewDigest, deps);
    assert.equal(r.ok, true, `${label}: ${JSON.stringify(r)}`);
    const diff = json(diffTenantAuthority(before, await snapshotTenantAuthority(pool, repo, A, FIELD_GROUPS)));
    assert.equal(diff.length, report.affectedCount, `${label}: affectedCount`);
    if (report.detail === "FULL") assert.deepEqual(report.affected.map(({ before: b, after: a, ...d }) => d), diff, `${label}: commit != preview`);
    const rows = await newAudit(ids);
    if (report.outcome === "NO_OP") assert.deepEqual(rows, [], `${label}: a NO_OP commit audited`);
    else assert.ok(rows.length > 0, `${label}: WOULD_APPLY wrote no audit`);
    for (const row of rows) {
      assert.deepEqual(row.after.authorityChange, {
        mode: "HUMAN_PREVIEWED", previewed: true, previewDigest: report.digests.previewDigest,
        affectedCount: report.affectedCount, impactDigest: report.digests.impactDigest,
      }, `${label}: audit ${row.action} is not marked`);
    }
    return { report, r, rows };
  }

  const NINE = async () => [
    ["grantObjectActionToRole", R({ objectKey: "purchaseOrder", actionKey: "read", roleKey: "partsManager" })],
    ["revokeObjectActionFromRole", R({ objectKey: "purchaseOrder", actionKey: "read", roleKey: "partsManager" })],
    ["applyObjectWideRoleAuthority", R({ objectKey: "supplierCatalogItem", roleKey: "purchasingManager", mode: "GRANT" })],
    ["setGrantCondition", R({ objectKey: "workOrder", actionKey: "read", roleKey: "dispatcher", condition: ASSIGNED_ONLY })],
    ["retireGrantCondition", R({ objectKey: "workOrder", actionKey: "read", roleKey: "salesManager" })],
    ["grantObjectActionToPrincipal", R({ objectKey: "opportunity", actionKey: "read", principalId: P.a.plain })],
    ["revokeObjectActionFromPrincipal", R({ objectKey: "opportunity", actionKey: "read", principalId: P.a.plain })],
    ["assignRole", R({ principalId: P.a.plain, roleId: await roleId("partsManager") })],
    ["revokeRole", R({ assignmentId: P.a.staleAssignment })],
  ];

  // ════════ PREVIEW_REQUIRED / PREVIEW_INVALID ════════
  await t.test("FLAG ON: each of the nine without a previewDigest -> PREVIEW_REQUIRED (428 category), nothing written", async () => {
    for (const [operation, input] of await NINE()) {
      await refusedCommit(`${operation} required`, () => commit(ADMIN, operation, input), { category: "PRECONDITION_REQUIRED", code: "PREVIEW_REQUIRED" });
      await refusedCommit(`${operation} empty`, () => commit(ADMIN, operation, input, ""), { category: "PRECONDITION_REQUIRED", code: "PREVIEW_REQUIRED" });
    }
    assert.equal(engineCalls, 0, "no engine run for a missing preview");
  });
  await t.test("FLAG ON: a malformed previewDigest -> PREVIEW_INVALID, nothing written", async () => {
    const [operation, input] = (await NINE())[0];
    for (const bad of ["abc", "A".repeat(64), `${"0".repeat(63)}g`, 42, { previewDigest: "x" }, ["0".repeat(64)]]) {
      await refusedCommit(`invalid ${JSON.stringify(bad)}`, () => commit(ADMIN, operation, input, bad), { category: "INVALID_INPUT", code: "PREVIEW_INVALID" });
    }
    assert.equal(engineCalls, 0);
  });
  await t.test("FLAG ON: the command gate comes first -- an actor who could not commit gets FORBIDDEN, not PREVIEW_REQUIRED", async () => {
    const r = await commit(GM, "grantObjectActionToRole", R({ objectKey: "workOrder", actionKey: "dispatch", roleKey: "partsManager" }));
    assert.deepEqual([r.ok, r.code], [false, "FORBIDDEN"]);
    const s = await commit("gip-plain-a", "assignRole", R({ principalId: P.a.plain2, roleId: await roleId("dispatcher") }), "0".repeat(64));
    assert.deepEqual([s.ok, s.code], [false, "FORBIDDEN"]);
  });
  await t.test("HTTP: PREVIEW_REQUIRED is 428, PREVIEW_INVALID 400", async () => {
    const opts = ({ ...ON, verifyToken: async () => ({ externalSubject: ADMIN, identityProvider: "firebase" }), allowedOrigins: [] });
    const [operation, input] = (await NINE())[0];
    const send = (body) => handleAdminRequest(opts, { method: "POST", url: "/admin/policy", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: JSON.stringify(body) });
    const required = await send({ operation, input });
    assert.equal(required.status, 428, required.body);
    assert.match(JSON.parse(required.body).message, /^PREVIEW_REQUIRED: /);
    const invalid = await send({ operation, input: { ...input, previewDigest: "nope" } });
    assert.equal(invalid.status, 400, invalid.body);
  });
  await t.test("FLAG ON, server without a committer: refuses (no unpreviewed fallback)", async () => {
    const [operation, input] = (await NINE())[0];
    const report = await preview(ADMIN, operation, input);
    const r = await commit(ADMIN, operation, input, report.digests.previewDigest, { ...world.deps, previewMandatory: true });
    assert.deepEqual([r.ok, r.code], [false, "INTERNAL"]);
  });

  // ════════ previewed commits of all nine ════════
  await t.test("COMMIT: all nine, previewed then committed -- tenant-wide equal to the preview, every audit row marked", async () => {
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await previewedCommit("C1", ADMIN, "grantObjectActionToRole", R({ objectKey: "purchaseOrder", actionKey: "read", roleKey: "partsManager" }));
    await previewedCommit("C1 no-op", ADMIN, "grantObjectActionToRole", R({ objectKey: "purchaseOrder", actionKey: "read", roleKey: "partsManager" }));
    await previewedCommit("C1 conditioned", ADMIN, "grantObjectActionToRole", R({ objectKey: "workOrder", actionKey: "read", roleKey: "partsManager", condition: PARTS_ELIGIBLE }));
    await previewedCommit("C2", ADMIN, "revokeObjectActionFromRole", R({ objectKey: "purchaseOrder", actionKey: "read", roleKey: "partsManager" }));
    const c3 = await previewedCommit("C3", ADMIN, "applyObjectWideRoleAuthority", R({ objectKey: "supplierCatalogItem", roleKey: "purchasingManager", mode: "GRANT" }));
    assert.deepEqual(c3.report.perAction.map((a) => [a.capabilityKey, a.outcome]), c3.r.data.actions.map((a) => [a.capabilityKey, a.outcome]));
    await previewedCommit("C4", ADMIN, "setGrantCondition", R({ objectKey: "workOrder", actionKey: "read", roleKey: "dispatcher", condition: ASSIGNED_ONLY }));
    await previewedCommit("C2 cond", ADMIN, "revokeObjectActionFromRole", R({ objectKey: "workOrder", actionKey: "read", roleKey: "technician" }));
    await previewedCommit("C5", ADMIN, "retireGrantCondition", R({ objectKey: "workOrder", actionKey: "read", roleKey: "technician" }));
    await previewedCommit("C6", ADMIN, "grantObjectActionToPrincipal", R({ objectKey: "opportunity", actionKey: "read", principalId: P.a.plain, expiresAt: future }));
    await previewedCommit("C7", ADMIN, "revokeObjectActionFromPrincipal", R({ objectKey: "opportunity", actionKey: "read", principalId: P.a.plain }));
    await previewedCommit("C8", ADMIN, "assignRole", R({ principalId: P.a.plain, roleId: await roleId("dispatcher") }));
    await previewedCommit("C8 scoped", ADMIN, "assignRole", R({ principalId: P.a.plain2, roleId: await roleId("salesManager"), scopeType: "salesChannel", scopeValue: "RETAIL" }));
    await previewedCommit("C8 counts-only actor", GM, "assignRole", R({ principalId: P.a.plain2, roleId: await roleId("partsManager") }));
    const id = (await q(`SELECT a.id FROM eos_policy.user_role_assignments a JOIN eos_policy.roles r ON r.id=a.role_id
      WHERE a.tenant_id=$1 AND a.principal_id=$2 AND r.key='dispatcher' AND a.status='active'`, [A, P.a.plain])).rows[0].id;
    await previewedCommit("C9", ADMIN, "revokeRole", R({ assignmentId: id }));
    for (const log of commitStatements) {
      assert.equal(log.filter((s) => /^\s*COMMIT\s*$/i.test(s.text)).length <= 1, true, "at most one real COMMIT per commit");
      assert.equal(log.some((s) => /eos_policy\.preview/.test(s.text)), false, "a commit never arms the never-commit fence");
    }
  });
  await t.test("REPLAY: a digest that was committed cannot be committed again (the state moved)", async () => {
    const input = R({ objectKey: "purchaseOrder", actionKey: "read", roleKey: "partsManager" });
    const report = await preview(ADMIN, "grantObjectActionToRole", input);
    assert.equal((await commit(ADMIN, "grantObjectActionToRole", input, report.digests.previewDigest)).ok, true);
    await refusedCommit("replay", () => commit(ADMIN, "grantObjectActionToRole", input, report.digests.previewDigest), { category: "CONFLICT", code: "STALE_PREVIEW" });
  });

  // ════════ STALE_PREVIEW ════════
  const staleCase = async (label, input, operation, moveState) => {
    const report = await preview(ADMIN, operation, input);
    assert.equal(report.outcome, "WOULD_APPLY", label);
    await moveState();
    await refusedCommit(label, () => commit(ADMIN, operation, input, report.digests.previewDigest), { category: "CONFLICT", code: "STALE_PREVIEW" });
  };
  await t.test("STALE: a concurrent commit by another administrator path (unrelated cell, same tenant)", () =>
    staleCase("concurrent", R({ objectKey: "purchaseOrder", actionKey: "read", roleKey: "dispatcher" }), "grantObjectActionToRole",
      async () => assert.equal((await call(OFF, ADMIN, "grantObjectActionToRole", R({ objectKey: "opportunity", actionKey: "read", roleKey: "partsManager" }))).ok, true)));
  await t.test("STALE: a holder's Employee status changes between preview and commit", () =>
    staleCase("employee status", R({ objectKey: "purchaseOrder", actionKey: "read", roleKey: "dispatcher" }), "grantObjectActionToRole",
      () => q(`UPDATE eos_workforce.employees SET employment_status = 'ACTIVE' WHERE id = 'emp-gip-inel'`)));
  await t.test("STALE: an assignment of the Role changes between preview and commit", () =>
    staleCase("assignment", R({ objectKey: "purchaseOrder", actionKey: "read", roleKey: "dispatcher" }), "grantObjectActionToRole",
      () => world.assign(A, P.a.plain2, "dispatcher")));
  await t.test("STALE: a condition on the cell changes between preview and commit", () =>
    staleCase("condition", R({ objectKey: "purchaseOrder", actionKey: "read", roleKey: "dispatcher" }), "grantObjectActionToRole",
      async () => assert.equal((await call(OFF, ADMIN, "setGrantCondition", R({ objectKey: "workOrder", actionKey: "read", roleKey: "salesManager", condition: ASSIGNED_ONLY }))).ok, true)));
  await t.test("STALE: a change landing BETWEEN the in-lock preview and the write -> nothing committed", async () => {
    const input = R({ objectKey: "purchaseOrder", actionKey: "read", roleKey: "dispatcher" });
    const report = await preview(ADMIN, "grantObjectActionToRole", input);
    const rc = async () => Number((await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities WHERE tenant_id=$1`, [A])).rows[0].n);
    const grants = await rc();
    // A non-Administration writer (not blocked by the governance lock) moves an Employee status mid-commit.
    between = () => q(`UPDATE eos_workforce.employees SET employment_status = 'TERMINATED' WHERE id = 'emp-gip-inel'`);
    const r = await commit(ADMIN, "grantObjectActionToRole", input, report.digests.previewDigest);
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.ok(r.message.startsWith("STALE_PREVIEW: "), r.message);
    assert.equal(await rc(), grants, "the grant was committed despite a moved impact");
  });
  await t.test("STALE: another actor's digest, and an altered input (reason), never commit", async () => {
    const input = R({ principalId: P.a.plain2, roleId: await roleId("technician") });
    const report = await preview(ADMIN, "assignRole", input);
    await refusedCommit("other actor", () => commit(GM, "assignRole", input, report.digests.previewDigest), { category: "CONFLICT", code: "STALE_PREVIEW" });
    await refusedCommit("altered reason", () => commit(ADMIN, "assignRole", { ...input, reason: "something else" }, report.digests.previewDigest), { category: "CONFLICT", code: "STALE_PREVIEW" });
    await refusedCommit("altered role", async () => commit(ADMIN, "assignRole", { ...input, roleId: await roleId("dispatcher") }, report.digests.previewDigest), { category: "CONFLICT", code: "STALE_PREVIEW" });
    assert.equal((await commit(ADMIN, "assignRole", input, report.digests.previewDigest)).ok, true, "the untouched preview still commits");
  });
  await t.test("ISOLATION: a tenant-B digest cannot commit in tenant A", async () => {
    const input = R({ objectKey: "purchaseOrder", actionKey: "read", roleKey: "partsManager" });
    const b = await call(ON, "gip-admin-b", "previewAuthorityChange", { change: { operation: "revokeObjectActionFromRole", input } });
    await refusedCommit("foreign digest", () => commit(ADMIN, "revokeObjectActionFromRole", input, b.data.digests.previewDigest), { category: "CONFLICT", code: "STALE_PREVIEW" });
  });

  // ════════ protected Owner / Administrator through the mandatory path ════════
  await t.test("OWNER: every Owner/Administrator refusal is still returned through the mandatory path, Owner authority untouched", async () => {
    const assignmentOf = async (principalId, key) => (await q(`SELECT a.id FROM eos_policy.user_role_assignments a JOIN eos_policy.roles r ON r.id=a.role_id
      WHERE a.tenant_id=$1 AND a.principal_id=$2 AND r.key=$3 ORDER BY a.status, a.created_at LIMIT 1`, [A, principalId, key])).rows[0].id;
    const cases = [
      ["LAST_PROTECTED_OWNER", ADMIN, "revokeRole", R({ assignmentId: P.a.ownerAssignment })],
      ["PROTECTED_OWNER_MEMBERSHIP", ADMIN, "assignRole", R({ principalId: P.a.plain2, roleId: await roleId("owner") })],
      ["PROTECTED_ROLE_CONFLICT", ADMIN, "assignRole", R({ principalId: P.a.owner, roleId: await roleId("admin") })],
      ["SYSTEM_INVARIANT", ADMIN, "grantObjectActionToRole", R({ objectKey: "dataImport", actionKey: "execute", roleKey: "owner" })],
      ["SYSTEM_INVARIANT", ADMIN, "grantObjectActionToRole", R({ objectKey: "reorderRequest", actionKey: "assign", roleKey: "dispatcher" })],
      ["SYSTEM_INVARIANT", ADMIN, "grantObjectActionToPrincipal", R({ objectKey: "dataImport", actionKey: "execute", principalId: P.a.owner })],
      ["SYSTEM_INVARIANT", ADMIN, "grantObjectActionToPrincipal", R({ objectKey: "salesAgreement", actionKey: "approveTradeIn", principalId: P.a.plain2 })],
      ["SELF_ADMINISTRATION", ADMIN, "revokeRole", R({ assignmentId: await assignmentOf(P.a.admin, "admin") })],
      ["SELF_ADMINISTRATION", ADMIN, "grantObjectActionToRole", R({ objectKey: "auditLog", actionKey: "read", roleKey: "admin" })],
      ["PRIVILEGE_ESCALATION", GM, "assignRole", R({ principalId: P.a.plain2, roleId: await roleId("admin") })],
      ["WOULD_REMOVE_LAST_ADMINISTRATION_PATH", ADMIN, "revokeObjectActionFromRole", R({ objectKey: "rolesPermissions", actionKey: "editSecurityPolicy", roleKey: "admin" })],
      ["SCOPE_AMBIGUOUS_ADMINISTRATION", ADMIN, "grantObjectActionToRole", R({ objectKey: "rolesPermissions", actionKey: "read", roleKey: "salesManager" })],
    ];
    const admin = await adminSnapshot();
    for (const [code, subject, operation, input] of cases) {
      const report = await preview(subject, operation, input);
      assert.equal(report.outcome, "WOULD_REFUSE", `${code} ${operation}`);
      assert.equal(report.refusal.code, code, `${operation}: ${JSON.stringify(report.refusal)}`);
      // With the preview's own digest: the command's refusal, verbatim (never masked as STALE).
      await refusedCommit(`${code} ${operation}`, () => commit(subject, operation, input, report.digests.previewDigest),
        { category: report.refusal.category, code });
      // With no digest (flag ON): still never written -- PREVIEW_REQUIRED.
      await refusedCommit(`${code} ${operation} no digest`, () => commit(subject, operation, input), { category: "PRECONDITION_REQUIRED", code: "PREVIEW_REQUIRED" });
      // With a well-formed foreign digest: the change is refused on its own merits first.
      await refusedCommit(`${code} ${operation} wrong digest`, () => commit(subject, operation, input, "f".repeat(64)), { category: report.refusal.category, code });
    }
    assert.deepEqual(await adminSnapshot(), admin, "the Administrator's authority moved");
  });
  await t.test("OWNER: a permitted Owner reduction commits only as previewed (delta reported, audit marked)", async () => {
    const { report } = await previewedCommit("owner reduced", ADMIN, "revokeObjectActionFromRole", R({ objectKey: "rolesPermissions", actionKey: "assignRole", roleKey: "owner" }));
    assert.equal(report.protectedAffected.owners, 1);
    const owner = report.affected.find((d) => d.principalId === P.a.owner);
    assert.equal(owner.before, null, "a protected Owner is a delta only");
  });

  // ════════ NOT STALE: preview and commit share ONE rule (evaluateAuthorityChange) ════════
  await t.test("NOT STALE: for each of the nine, a preview immediately followed by its commit commits (incl. workflow bindings)", async () => {
    const fresh = await world.member(A, "gip-fresh-a");
    const wr = (report) => report.affected?.find((d) => d.principalId === fresh)?.changes.workflowResponsibilities ?? { added: [], removed: [] };
    const seen = new Set();
    const go = async (label, operation, input) => {
      const { report } = await previewedCommit(`not-stale ${label}`, ADMIN, operation, input);
      assert.equal(report.outcome, "WOULD_APPLY", `${label}: ${JSON.stringify(report.refusal)}`);
      seen.add(operation);
      return report;
    };
    const assigned = await go("C8 assign (workflow SECURITY_ROLE binding)", "assignRole", R({ principalId: fresh, roleId: await roleId("dispatcher") }));
    assert.ok(wr(assigned).added.some((r) => /Dispatch:ALLOWED via dispatcher$/.test(r)), JSON.stringify(wr(assigned)));
    await go("C1", "grantObjectActionToRole", R({ objectKey: "workOrder", actionKey: "read", roleKey: "generalEmployee" }));
    await go("C4", "setGrantCondition", R({ objectKey: "workOrder", actionKey: "read", roleKey: "generalEmployee", condition: ASSIGNED_ONLY }));
    await go("C2", "revokeObjectActionFromRole", R({ objectKey: "workOrder", actionKey: "read", roleKey: "generalEmployee" }));
    await go("C5", "retireGrantCondition", R({ objectKey: "workOrder", actionKey: "read", roleKey: "generalEmployee" }));
    await go("C3", "applyObjectWideRoleAuthority", R({ objectKey: "supplierCatalogItem", roleKey: "partsManager", mode: "GRANT" }));
    await go("C6", "grantObjectActionToPrincipal", R({ objectKey: "opportunity", actionKey: "read", principalId: fresh }));
    await go("C7", "revokeObjectActionFromPrincipal", R({ objectKey: "opportunity", actionKey: "read", principalId: fresh }));
    const id = (await q(`SELECT a.id FROM eos_policy.user_role_assignments a JOIN eos_policy.roles r ON r.id=a.role_id
      WHERE a.tenant_id=$1 AND a.principal_id=$2 AND r.key='dispatcher' AND a.status='active'`, [A, fresh])).rows[0].id;
    const revoked = await go("C9 revoke (workflow SECURITY_ROLE binding)", "revokeRole", R({ assignmentId: id }));
    assert.ok(wr(revoked).removed.length > 0, JSON.stringify(wr(revoked)));
    assert.equal(seen.size, 9);
  });

  // ════════ the lock-holding budget ════════
  await t.test("BUDGET: a commit that exceeds its total budget while holding the lock rolls back -> COMMIT_BUSY", async () => {
    let clock = 0;
    const slow = createAuthorityChangeCommit({ pool, fieldGroups: FIELD_GROUPS, totalBudgetMs: 1_000, now: () => { clock += 400; return clock; } });
    const input = R({ objectKey: "purchaseOrder", actionKey: "read", roleKey: "generalManager" });
    const report = await preview(ADMIN, "grantObjectActionToRole", input);
    assert.equal(report.outcome, "WOULD_APPLY");
    await refusedCommit("budget", () => commit(ADMIN, "grantObjectActionToRole", input, report.digests.previewDigest, { ...ON, commitAuthorityChange: slow }),
      { category: "CONFLICT", code: "COMMIT_BUSY" });
    const held = await q(`SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND granted
      AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`);
    assert.equal(held.rows.length, 0, "the governance lock was not released");
  });

  // ════════ flag OFF ════════
  await t.test("FLAG OFF: no digest -> today's path, the engine never runs, nothing marked", async () => {
    const calls = engineCalls;
    const ids = await auditIds();
    const r = await call(OFF, ADMIN, "grantObjectActionToRole", R({ objectKey: "purchaseOrder", actionKey: "read", roleKey: "technician" }));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(engineCalls, calls, "flag OFF without a digest must not use the engine");
    for (const row of await newAudit(ids)) assert.equal(row.after?.authorityChange, undefined);
  });
  await t.test("FLAG OFF: any supplied previewDigest (stale, malformed, null, \"\") is IGNORED -- today's path, unmarked", async () => {
    const input = R({ objectKey: "purchaseOrder", actionKey: "read", roleKey: "technician" });
    const offReport = (await call(OFF, ADMIN, "previewAuthorityChange", { change: { operation: "revokeObjectActionFromRole", input } })).data;
    assert.equal(offReport.previewMandatory, false, "an OFF server tells the client the digest is not required");
    const report = await preview(ADMIN, "revokeObjectActionFromRole", input);
    assert.equal(report.previewMandatory, true, "an ON server says it is required");
    await world.assign(A, P.a.pp, "technician");
    const calls = engineCalls;
    for (const [operation, digest] of [["revokeObjectActionFromRole", report.digests.previewDigest], ["grantObjectActionToRole", "zz"],
      ["revokeObjectActionFromRole", null], ["grantObjectActionToRole", ""], ["revokeObjectActionFromRole", "f".repeat(64)]]) {
      const ids = await auditIds();
      const r = await call(OFF, ADMIN, operation, { ...input, previewDigest: digest });
      assert.equal(r.ok, true, `${operation} ${JSON.stringify(digest)}: ${JSON.stringify(r)}`);
      const rows = await newAudit(ids);
      assert.ok(rows.length > 0, `${operation}: the today's-path commit wrote nothing`);
      for (const row of rows) assert.equal(row.after?.authorityChange, undefined, "an OFF commit is never marked");
    }
    assert.equal(engineCalls, calls, "flag OFF never runs the engine, whatever the client sends");
  });
});
