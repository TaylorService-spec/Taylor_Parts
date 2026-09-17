// ROLE-KEY COMPLETENESS -- the offline proofs (in-memory policy store). The PostgreSQL proofs are in
// policyRoleCatalogReconcilePostgres.test.mjs.
//
// A tenant seeded before a catalog Role existed gains exactly the missing keys, with exactly the baseline Object CRED
// the seed writes for a Role it creates; nothing else is touched, a dry run writes nothing, a rerun adds nothing and
// audits nothing, and a tenant lacking the seed Objects is refused rather than half-reconciled.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InMemoryPolicyRepository } from "../lib/adminPolicy/inMemoryPolicyRepository.js";
import { seedTenantPolicy, seedRoleDefinitions } from "../lib/adminPolicy/seed/policySeed.js";
import { ROLE_CATALOG_RECONCILE_ACTION, RoleCatalogReconcileError, reconcileTenantRoleCatalog } from "../lib/adminPolicy/seed/roleCatalogReconcile.js";

const TENANT = "tenant-reconcile";
const KEY = "reconcile-tenant";
const SEEDER = "uid-seed";
const ACTOR = "role-catalog-reconcile:op";

/** The declared catalog plus two Roles "added later": one with Object grants, one with none. */
function grownCatalog() {
  const base = seedRoleDefinitions();
  return {
    ...base,
    zzFutureReader: { id: "zzFutureReader", name: "Future Reader", description: "added after the tenant was seeded", permissions: [...base.warehouseManager.permissions] },
    zzFutureNothing: { id: "zzFutureNothing", name: "Future Nothing", description: "holds no capability", permissions: [] },
  };
}

async function seededTenant() {
  const repo = new InMemoryPolicyRepository();
  await repo.transact({ tenantId: TENANT, uid: SEEDER }, (tx) => tx.createTenant({ key: KEY, name: "Reconcile" }));
  await seedTenantPolicy(repo, TENANT, SEEDER);
  return repo;
}

const snapshotOf = (repo) => JSON.stringify(repo.tables);

test("a dry run plans exactly the missing keys and writes nothing", async () => {
  const repo = await seededTenant();
  const before = snapshotOf(repo);
  const report = await reconcileTenantRoleCatalog(repo, KEY, { actorUid: ACTOR, roleDefinitions: grownCatalog() });
  assert.equal(report.outcome, "DRY_RUN");
  assert.equal(report.mode, "dry-run");
  assert.deepEqual(report.missingRoleKeys, ["zzFutureNothing", "zzFutureReader"]);
  const reader = report.plannedRoles.find((r) => r.key === "zzFutureReader");
  assert.ok(reader.objectPermissions > 0, "the reader Role derives Object CRED from its capabilities");
  assert.equal(report.plannedRoles.find((r) => r.key === "zzFutureNothing").objectPermissions, 0);
  assert.equal(snapshotOf(repo), before, "a dry run is a read");
});

test("apply creates exactly the missing Roles with the seed's derived Object CRED, and audits once", async () => {
  const repo = await seededTenant();
  const rolesBefore = await repo.listRoles(TENANT);
  const auditBefore = (await repo.listAuditEvents(TENANT, 1000)).length;

  const report = await reconcileTenantRoleCatalog(repo, KEY, { actorUid: ACTOR, apply: true, roleDefinitions: grownCatalog() });
  assert.equal(report.outcome, "APPLIED");
  assert.equal(report.created.roles, 2);
  assert.equal(report.created.objectPermissions, report.plannedObjectPermissions);

  const rolesAfter = await repo.listRoles(TENANT);
  assert.deepEqual(rolesAfter.map((r) => r.key).filter((k) => !rolesBefore.some((b) => b.key === k)).sort(), ["zzFutureNothing", "zzFutureReader"]);
  // Existing Roles are byte-identical, id and provenance included.
  assert.deepEqual(rolesAfter.filter((r) => rolesBefore.some((b) => b.id === r.id)), rolesBefore);

  // The new reader Role's Object CRED equals warehouseManager's SEEDED CRED: same capabilities, same derivation.
  const newRole = rolesAfter.find((r) => r.key === "zzFutureReader");
  const viewer = rolesAfter.find((r) => r.key === "warehouseManager");
  const credByObject = async (roleId) => Object.fromEntries((await repo.listObjectPermissions(TENANT, [roleId])).map((p) => [p.objectId, p.cred]));
  assert.deepEqual(await credByObject(newRole.id), await credByObject(viewer.id));
  assert.equal(newRole.origin, "SYSTEM");
  assert.equal(newRole.protected, false);

  const audit = await repo.listAuditEvents(TENANT, 1000);
  assert.equal(audit.length, auditBefore + 1);
  const event = audit.find((e) => e.action === ROLE_CATALOG_RECONCILE_ACTION);
  assert.equal(event.actorUid, ACTOR);
  assert.deepEqual(event.after.createdRoleKeys, ["zzFutureNothing", "zzFutureReader"]);
});

test("a rerun adds zero, opens no transaction and writes no audit event", async () => {
  const repo = await seededTenant();
  await reconcileTenantRoleCatalog(repo, KEY, { actorUid: ACTOR, apply: true, roleDefinitions: grownCatalog() });
  const before = snapshotOf(repo);
  const again = await reconcileTenantRoleCatalog(repo, KEY, { actorUid: ACTOR, apply: true, roleDefinitions: grownCatalog() });
  assert.equal(again.outcome, "NOTHING_TO_RECONCILE");
  assert.deepEqual(again.created, { roles: 0, objectPermissions: 0 });
  assert.equal(snapshotOf(repo), before);
});

test("a freshly seeded tenant has nothing to reconcile against the declared catalog", async () => {
  const repo = await seededTenant();
  const report = await reconcileTenantRoleCatalog(repo, KEY, { actorUid: ACTOR, apply: true });
  assert.equal(report.outcome, "NOTHING_TO_RECONCILE");
  assert.equal(report.catalogRoleKeys, Object.keys(seedRoleDefinitions()).length);
});

test("tenant Roles outside the catalog are reported and left alone", async () => {
  const repo = await seededTenant();
  await repo.transact({ tenantId: TENANT, uid: "uid-admin" }, (tx) => tx.createRole({ key: "customRegional", name: "Custom", description: null, origin: "CUSTOM", protected: false }));
  const report = await reconcileTenantRoleCatalog(repo, KEY, { actorUid: ACTOR, apply: true, roleDefinitions: grownCatalog() });
  assert.deepEqual(report.extraTenantRoleKeys, ["customRegional"]);
  assert.ok((await repo.listRoles(TENANT)).some((r) => r.key === "customRegional"));
});

test("a tenant missing the seed Objects is REFUSED and nothing is written", async () => {
  const repo = new InMemoryPolicyRepository();
  await repo.transact({ tenantId: TENANT, uid: SEEDER }, (tx) => tx.createTenant({ key: KEY, name: "Bare" }));
  const before = snapshotOf(repo);
  const report = await reconcileTenantRoleCatalog(repo, KEY, { actorUid: ACTOR, apply: true });
  assert.equal(report.outcome, "REFUSED_SEED_OBJECTS_MISSING");
  assert.ok(report.missingSeedObjectKeys.length > 0);
  assert.equal(snapshotOf(repo), before);
});

test("an unknown tenant is refused and never created; an actor is required", async () => {
  const repo = await seededTenant();
  await assert.rejects(reconcileTenantRoleCatalog(repo, "no-such-tenant", { actorUid: ACTOR }), RoleCatalogReconcileError);
  await assert.rejects(reconcileTenantRoleCatalog(repo, KEY, { actorUid: "" }), RoleCatalogReconcileError);
  assert.equal(await repo.getTenantByKey("no-such-tenant"), null);
});

test("workflow bindings for a reconciled Role are REPORTED, never created (the seed binds only workflows it creates)", async () => {
  const repo = await seededTenant();
  const definitions = seedRoleDefinitions();
  const report = await reconcileTenantRoleCatalog(repo, KEY, {
    actorUid: ACTOR,
    roleDefinitions: { ...definitions, zzFutureSales: { ...definitions.salesManager, id: "zzFutureSales" } },
  });
  assert.deepEqual(report.workflowRoleBindingsNotCreated, [], "no seed workflow names the new key");
});

test("STRUCTURAL: the reconcile writes only Roles, their Object CRED and one audit event", () => {
  const code = readFileSync("src/adminPolicy/seed/roleCatalogReconcile.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const txCalls = [...code.matchAll(/\btx\.(\w+)\(/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(txCalls)], ["appendAudit", "createRole", "setObjectPermission"]);
  assert.doesNotMatch(code, /Capabilit|Assignment|Membership|createPrincipal|updateRole|setFieldOverride|bumpAccessVersion/);
});
