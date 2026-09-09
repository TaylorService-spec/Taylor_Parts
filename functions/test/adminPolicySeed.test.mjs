// EOS Administration policy — the BOOTSTRAP SEED proofs.
//
// The six properties the ruling requires, each asserted rather than asserted-about: deterministic,
// tenant-aware, idempotent, versioned, auditable, safe to rerun.
//
// Runs against the in-memory adapter (fast, and the properties are the seed's, not the database's)
// AND against real PostgreSQL when POLICY_TEST_DATABASE_URL is set -- because "idempotent" over a
// store with unique constraints is a different claim from "idempotent" over a Map.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { InMemoryPolicyRepository } from "../lib/adminPolicy/inMemoryPolicyRepository.js";
import { PostgresPolicyRepository } from "../lib/adminPolicy/postgresPolicyRepository.js";
import { resolvePolicyDatabaseConfig } from "../lib/adminPolicy/policyDatabase.js";
import { SEED_VERSION, deriveObjectCred, seedSnapshotCounts, seedTenantPolicy } from "../lib/adminPolicy/seed/policySeed.js";
import { SEED_WORKFLOWS } from "../lib/adminPolicy/workflowSeeds.js";
import { loadPrincipalPolicy, resolveObjectAccess } from "../lib/adminPolicy/effectiveObjectAccess.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const PG_SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set";
const SEEDER = "uid-bootstrap";
const TENANT = "tenant-seed";

// ============================ derivation ============================

test("CRED is DERIVED from what a Role holds, never hand-written", () => {
  const held = new Set(["customer.record.read", "customer.record.update"]);
  const cred = deriveObjectCred(
    held,
    { C: ["customer.record.create"], R: ["customer.record.read"], E: ["customer.record.update"], D: [] },
    true,
  );
  assert.deepEqual(cred, { C: false, R: true, E: true, D: false });
});

test("D-2: a verb NO capability governs is never granted, to anyone", () => {
  // Not "not granted to this Role" -- not grantable at all. Persisting it would be a permission the
  // engine could never honour, which an administrator would read as real.
  const everything = new Set(["a", "b", "c"]);
  const cred = deriveObjectCred(everything, { C: [], R: [], E: [], D: [] }, true);
  assert.deepEqual(cred, { C: false, R: false, E: false, D: false }, "holding every id grants nothing ungoverned");
});

test("D is refused on an object that does not support deletion", () => {
  const cred = deriveObjectCred(new Set(["x.delete"]), { C: [], R: [], E: [], D: ["x.delete"] }, false);
  assert.equal(cred.D, false);
});

// ============================ the seed, in memory ============================

async function seededMemory(tenantId = TENANT) {
  const repo = new InMemoryPolicyRepository();
  const result = await seedTenantPolicy(repo, tenantId, SEEDER);
  return { repo, result };
}

test("a clean tenant is seeded with the measured model", async () => {
  const { repo, result } = await seededMemory();
  const counts = seedSnapshotCounts();

  assert.equal(result.created.objects, counts.objects, "every object in the snapshot");
  assert.equal(result.created.fields, counts.fields, "and every field");
  assert.equal(result.alreadySeeded, false);
  assert.equal(result.seedVersion, SEED_VERSION);

  const objects = await repo.listObjects(tenantId());
  assert.equal(objects.length, counts.objects);
  assert.ok(objects.every((o) => o.origin === "SYSTEM"), "shipped objects are SYSTEM, not CUSTOM");

  function tenantId() { return TENANT; }
});

test("the three workflow FAMILIES are seeded, and Sales stays three machines", async () => {
  const { repo, result } = await seededMemory();
  const workflows = await repo.listWorkflows(TENANT);

  assert.equal(result.created.workflows, SEED_WORKFLOWS.length);
  const keys = workflows.map((w) => w.key).sort();
  assert.deepEqual(keys, ["partsPurchasing", "salesAgreement", "salesOpportunity", "salesOrder", "workOrder"]);

  // SALES IS THREE, NOT ONE. Opportunity, Agreement and Order are chained by events rather than
  // transitions -- there is no edge from WON to DRAFT -- so one giant Sales machine would have
  // invented transitions no code performs.
  const sales = keys.filter((k) => k.startsWith("sales"));
  assert.deepEqual(sales, ["salesAgreement", "salesOpportunity", "salesOrder"]);
});

test("seeded workflow versions are DRAFT — a definition routes nothing", async () => {
  const { repo } = await seededMemory();
  for (const workflow of await repo.listWorkflows(TENANT)) {
    const versions = await repo.listWorkflowVersions(TENANT, workflow.id);
    assert.equal(versions.length, 1);
    assert.equal(versions[0].status, "DRAFT", `${workflow.key} is seeded as a draft`);
    assert.equal(versions[0].version, 1);
  }
});

test("protected Roles are marked protected, and only those", async () => {
  const { repo } = await seededMemory();
  const roles = await repo.listRoles(TENANT);
  const protectedKeys = roles.filter((r) => r.protected).map((r) => r.key).sort();
  assert.deepEqual(protectedKeys, ["admin", "owner"], "the recovery Roles, and no others");
});

test("IDEMPOTENT: a second run creates nothing", async () => {
  const { repo, result } = await seededMemory();
  const second = await seedTenantPolicy(repo, TENANT, SEEDER);

  assert.equal(second.alreadySeeded, true);
  for (const [what, n] of Object.entries(second.created)) {
    assert.equal(n, 0, `${what}: nothing created on the second run`);
  }
  // And the store is unchanged, not merely un-added-to.
  assert.equal((await repo.listObjects(TENANT)).length, result.created.objects);
  assert.equal((await repo.listRoles(TENANT)).length, result.created.roles);
});

test("DETERMINISTIC: two clean tenants get byte-identical policy", async () => {
  const a = await seededMemory("tenant-1");
  const b = await seededMemory("tenant-2");

  const shape = async ({ repo }, tenantId) => {
    const objects = await repo.listObjects(tenantId);
    const out = [];
    for (const o of objects) {
      const fields = await repo.listFields(tenantId, o.id);
      out.push(`${o.key}:${o.supportsDelete}:${fields.map((f) => `${f.key}/${f.dataType}`).join(",")}`);
    }
    return out;
  };

  assert.deepEqual(await shape(a, "tenant-1"), await shape(b, "tenant-2"), "same inputs, same output");
  assert.deepEqual(a.result.created, b.result.created, "and the same counts");
});

test("TENANT-AWARE: seeding one tenant does not touch another", async () => {
  const repo = new InMemoryPolicyRepository();
  await seedTenantPolicy(repo, "tenant-1", SEEDER);
  assert.equal((await repo.listObjects("tenant-2")).length, 0, "tenant 2 is untouched");

  await seedTenantPolicy(repo, "tenant-2", SEEDER);
  const one = (await repo.listObjects("tenant-1")).map((o) => o.key).sort();
  const two = (await repo.listObjects("tenant-2")).map((o) => o.key).sort();
  assert.deepEqual(one, two, "both get the same model");
  assert.notDeepEqual(
    (await repo.listObjects("tenant-1")).map((o) => o.id),
    (await repo.listObjects("tenant-2")).map((o) => o.id),
    "as separate rows",
  );
});

test("AUDITABLE and VERSIONED: one event per run, carrying the version and the counts", async () => {
  const { repo, result } = await seededMemory();
  const events = await repo.listAuditEvents(TENANT, 100);
  const seedEvents = events.filter((e) => e.action === "seedTenantPolicy");

  assert.equal(seedEvents.length, 1);
  assert.equal(seedEvents[0].actorUid, SEEDER);
  assert.equal(seedEvents[0].targetId, TENANT);
  assert.equal(seedEvents[0].after.seedVersion, SEED_VERSION);
  assert.deepEqual(seedEvents[0].after.created, result.created);
  assert.equal(seedEvents[0].after.alreadySeeded, false);

  // A rerun is recorded TOO. "Already seeded" is the evidence that rerunning was safe.
  await seedTenantPolicy(repo, TENANT, SEEDER);
  const after = (await repo.listAuditEvents(TENANT, 100)).filter((e) => e.action === "seedTenantPolicy");
  assert.equal(after.length, 2);
  assert.equal(after[1].after.alreadySeeded, true);
});

test("SAFE TO RERUN: an administrator's later edit is not undone", async () => {
  // The failure this guards against is a seed that "restores defaults" on every deploy and silently
  // reverts a customer's configuration.
  const { repo } = await seededMemory();
  const role = (await repo.listRoles(TENANT)).find((r) => r.key === "dispatcher");
  const object = (await repo.listObjects(TENANT)).find((o) => o.key === "account");
  assert.ok(role && object, "the fixtures exist");

  // The administrator removes everything the seed granted this Role on this object.
  await repo.transact({ tenantId: TENANT, uid: "uid-admin" }, (tx) =>
    tx.setObjectPermission(role.id, object.id, { C: false, R: false, E: false, D: false }));

  await seedTenantPolicy(repo, TENANT, SEEDER);

  const row = (await repo.listObjectPermissions(TENANT, [role.id])).find((p) => p.objectId === object.id);
  assert.deepEqual(row.cred, { C: false, R: false, E: false, D: false }, "the seed did not re-grant it");
});

test("the seeded policy RESOLVES: a seeded Role reads what its capabilities say", async () => {
  const { repo } = await seededMemory();
  const admin = (await repo.listRoles(TENANT)).find((r) => r.key === "admin");

  await repo.transact({ tenantId: TENANT, uid: SEEDER }, async (tx) => {
    const v = await tx.bumpAccessVersion("uid-1");
    await tx.createAssignment({
      principalUid: "uid-1", roleId: admin.id, scopeType: "global", scopeValue: null,
      status: "active", grantedBy: SEEDER, grantedAt: new Date().toISOString(), accessVersionAtGrant: v,
    });
  });

  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-1");
  assert.equal(resolveObjectAccess(policy, "account").cred.R, true, "admin reads Accounts");
});

test("D-3 EVIDENCE: warehouseManager is seeded with GLOBAL Transfer Orders read", async () => {
  // OWNER RULING D-3 (2026-09-08). Two authorities described this cell:
  //
  //   canonical Detailed CRUD matrix   Transfer Orders R, GLOBAL
  //   retired firestore.rules          only transfers touching an ASSIGNED warehouse
  //
  // The ruling selects the MATRIX for the future EOS policy seed, and records the narrower Rules
  // population as migration history rather than future policy. This asserts the seed follows the
  // ruling, so a later change back to the narrower reading fails here with the reason attached.
  const { repo } = await seededMemory();
  const role = (await repo.listRoles(TENANT)).find((r) => r.key === "warehouseManager");
  const object = (await repo.listObjects(TENANT)).find((o) => o.key === "transferOrder");
  assert.ok(role && object, "both are seeded");

  const row = (await repo.listObjectPermissions(TENANT, [role.id])).find((p) => p.objectId === object.id);
  assert.equal(row?.cred.R, true, "GLOBAL read, per the canonical matrix");
});

// ============================ the seed, over PostgreSQL ============================

// ════════════════════ WHY THIS SUITE MUST RUN SERIALLY ════════════════════
//
// This test DROPS AND RE-MIGRATES the schema, and so does adminPolicyPostgres.test.mjs. `node --test`
// runs FILES concurrently by default, so the two race: one drops the schema while the other is
// mid-transaction, and the loser fails with `relation "eos_policy.tenants" does not exist`.
//
// `npm run test:adminPolicyPostgres` therefore passes `--test-concurrency=1`. Reproduced without it
// three times out of three; with it, clean.
//
// CAUGHT BY CI, NOT LOCALLY, and the reason is worth recording: locally the two files had only ever
// been run SEPARATELY. The npm script that runs them together was registered and never executed
// against a database until CI did it -- so "both suites pass" was true of two runs that never
// happened at the same time.
test("the seed runs over PostgreSQL, and is idempotent there too", { skip: PG_SKIP }, async () => {
  // Idempotence over a Map and idempotence over a store with unique constraints are different
  // claims. A second run must not merely skip -- it must not raise a duplicate key either.
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS eos_policy CASCADE");
  await client.query("DROP TABLE IF EXISTS pgmigrations");
  await client.end();
  execFileSync(process.execPath, [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations",
  ], { env: { ...process.env, DATABASE_URL: URL }, stdio: "pipe" });

  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: URL, max: 4 }));
  try {
    await pool.query("INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $1, $1)", [TENANT]);
    const repo = new PostgresPolicyRepository(pool);

    const first = await seedTenantPolicy(repo, TENANT, SEEDER);
    const counts = seedSnapshotCounts();
    assert.equal(first.created.objects, counts.objects);
    assert.equal(first.created.fields, counts.fields);
    assert.ok(first.created.roles > 40, `${first.created.roles} roles seeded`);
    assert.ok(first.created.objectPermissions > 0);
    assert.equal(first.missingRoleKeys.length, 0, "every workflow-bound Role exists");

    const second = await seedTenantPolicy(repo, TENANT, SEEDER);
    assert.equal(second.alreadySeeded, true, "a rerun creates nothing and raises nothing");

    // And the row counts did not move.
    const objects = await pool.query("SELECT count(*)::int n FROM eos_policy.objects WHERE tenant_id = $1", [TENANT]);
    assert.equal(objects.rows[0].n, counts.objects);
    const fields = await pool.query("SELECT count(*)::int n FROM eos_policy.object_fields WHERE tenant_id = $1", [TENANT]);
    assert.equal(fields.rows[0].n, counts.fields);
  } finally {
    await pool.end();
  }
});
