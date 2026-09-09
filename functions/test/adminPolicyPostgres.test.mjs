// EOS Administration policy — the POSTGRESQL proofs.
//
// ════════════════════ THESE RUN AGAINST A REAL DATABASE ════════════════════
//
// Not an emulator, not an in-memory double. The properties under test are properties of PostgreSQL
// -- a unique index, a foreign key, a CHECK constraint, a partial unique index, transactional
// rollback -- and an emulator that approximates them proves nothing about the database that will
// actually hold the policy.
//
// Set POLICY_TEST_DATABASE_URL to run. Without it the suite SKIPS rather than fails: a developer
// without a local cluster should not be blocked, and CI supplies one through a service container.
// The skip is loud, so a green run with no database cannot be mistaken for a green run with one.
//
// EACH TEST OWNS ITS OWN SCHEMA STATE. The migration is re-run from clean at the start, so a test
// that leaves rows behind cannot make the next one pass.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { PostgresPolicyRepository } from "../lib/adminPolicy/postgresPolicyRepository.js";
import { resolvePolicyDatabaseConfig } from "../lib/adminPolicy/policyDatabase.js";
import {
  loadPrincipalPolicy,
  resolveFieldAccess,
  resolveObjectAccess,
} from "../lib/adminPolicy/effectiveObjectAccess.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const ACTOR = { uid: "uid-admin" };
const actorFor = (tenantId) => ({ tenantId, uid: ACTOR.uid });

let pool = null;

/** Re-run the migration from a clean schema, so every test starts from the same known state. */
function migrateFromClean() {
  execFileSync(process.execPath, [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations",
  ], { env: { ...process.env, DATABASE_URL: URL }, stdio: "pipe" });
}

async function reset() {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS eos_policy CASCADE");
  await client.query("DROP TABLE IF EXISTS pgmigrations");
  await client.end();
  migrateFromClean();
  await seedTenants();
}

/** Tenants are a foreign-key parent for everything; the seed creates them, so the tests do too. */
async function seedTenants() {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  for (const id of [TENANT_A, TENANT_B]) {
    await client.query("INSERT INTO eos_policy.tenants (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, id]);
  }
  await client.end();
}

function repo() {
  pool ??= new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: URL, max: 4 }));
  return new PostgresPolicyRepository(pool);
}

async function query(text, values = []) {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  try {
    return await client.query(text, values);
  } finally {
    await client.end();
  }
}

test.after(async () => {
  if (pool) await pool.end();
});

// ============================ schema ============================

test("clean database -> migrate -> the expected schema", { skip: SKIP }, async () => {
  await reset();

  const tables = await query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'eos_policy' ORDER BY 1",
  );
  assert.deepEqual(tables.rows.map((r) => r.table_name), [
    "audit_events", "object_fields", "objects", "principal_access_versions",
    "role_field_permission_overrides", "role_object_permissions", "roles", "tenants",
    "user_role_assignments", "workflow_actions", "workflow_instance_events", "workflow_instances",
    "workflow_role_bindings", "workflow_steps", "workflow_versions", "workflows",
  ], "sixteen tables, named exactly");

  const enums = await query(
    `SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'eos_policy' AND t.typtype = 'e' ORDER BY 1`,
  );
  assert.deepEqual(enums.rows.map((r) => r.typname), [
    "assignment_status", "definition_lifecycle", "definition_origin",
    "field_data_type", "field_sensitivity", "workflow_version_status",
  ]);

  // The field type vocabulary is the repository's existing one. A drift here means the database and
  // the metadata registry disagree about what a field can be.
  const types = await query(
    `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'field_data_type' ORDER BY e.enumsortorder`,
  );
  assert.deepEqual(types.rows.map((r) => r.enumlabel), [
    "STRING", "TEXT", "NUMBER", "CURRENCY_MINOR", "BOOLEAN", "DATE", "TIMESTAMP",
    "ENUM", "ENUM_SET", "ADDRESS", "REFERENCE", "ID",
  ]);
});

test("a SECOND migrate changes nothing", { skip: SKIP }, async () => {
  await reset();
  const before = await query(
    `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_schema = 'eos_policy' ORDER BY table_name, column_name`,
  );
  const appliedBefore = await query("SELECT name FROM pgmigrations ORDER BY id");

  migrateFromClean(); // again, with the migration already recorded

  const after = await query(
    `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_schema = 'eos_policy' ORDER BY table_name, column_name`,
  );
  const appliedAfter = await query("SELECT name FROM pgmigrations ORDER BY id");

  assert.deepEqual(after.rows, before.rows, "the schema is byte-identical after a repeat run");
  assert.deepEqual(appliedAfter.rows, appliedBefore.rows, "and the migration is not recorded twice");
});

test("the DOWN migration removes the schema, and UP restores it", { skip: SKIP }, async () => {
  await reset();
  execFileSync(process.execPath, [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js", "down", "--migrations-dir", "migrations",
  ], { env: { ...process.env, DATABASE_URL: URL }, stdio: "pipe" });

  const gone = await query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'eos_policy'");
  assert.equal(gone.rows[0].n, 0, "down leaves nothing behind");

  migrateFromClean();
  const back = await query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'eos_policy'");
  assert.equal(back.rows[0].n, 16, "and up restores all sixteen");
});

// ============================ constraints ============================

test("UNIQUE constraints hold, per tenant", { skip: SKIP }, async () => {
  await reset();
  const r = repo();

  await r.transact(actorFor(TENANT_A), (tx) =>
    tx.createObject({ key: "customer", label: "Customer", labelPlural: null, description: null,
      origin: "SYSTEM", lifecycle: "ACTIVE", supportsDelete: true }));

  await assert.rejects(
    () => r.transact(actorFor(TENANT_A), (tx) =>
      tx.createObject({ key: "customer", label: "Duplicate", labelPlural: null, description: null,
        origin: "CUSTOM", lifecycle: "ACTIVE", supportsDelete: true })),
    /object key "customer" already exists/,
  );

  // THE SAME KEY IN ANOTHER TENANT IS FINE. Uniqueness is per tenant, or two customers could never
  // both call their main object "customer".
  const other = await r.transact(actorFor(TENANT_B), (tx) =>
    tx.createObject({ key: "customer", label: "Customer", labelPlural: null, description: null,
      origin: "SYSTEM", lifecycle: "ACTIVE", supportsDelete: true }));
  assert.equal(other.tenantId, TENANT_B);
});

test("FOREIGN KEYS refuse an orphan", { skip: SKIP }, async () => {
  await reset();
  await assert.rejects(
    () => query(
      `INSERT INTO eos_policy.object_fields
         (id, tenant_id, object_id, key, label, data_type, origin, created_by, updated_by)
       VALUES ('f1', $1, 'no-such-object', 'k', 'K', 'STRING', 'CUSTOM', 'u', 'u')`,
      [TENANT_A],
    ),
    /violates foreign key constraint/,
    "a field cannot belong to an object that does not exist",
  );
});

test("an ENUM field with no allowed values is refused BY THE DATABASE", { skip: SKIP }, async () => {
  // The command refuses it too. This proves the constraint holds against a writer that skipped the
  // command -- which is the only kind of writer a constraint is for.
  await reset();
  const r = repo();
  const object = await r.transact(actorFor(TENANT_A), (tx) =>
    tx.createObject({ key: "customer", label: "Customer", labelPlural: null, description: null,
      origin: "SYSTEM", lifecycle: "ACTIVE", supportsDelete: true }));

  await assert.rejects(
    () => query(
      `INSERT INTO eos_policy.object_fields
         (id, tenant_id, object_id, key, label, data_type, allowed_values, origin, created_by, updated_by)
       VALUES ('f1', $1, $2, 'tier', 'Tier', 'ENUM', '{}', 'CUSTOM', 'u', 'u')`,
      [TENANT_A, object.id],
    ),
    /enum_has_values/,
  );
});

test("an override that says NOTHING is refused BY THE DATABASE", { skip: SKIP }, async () => {
  // "No opinion" is the absence of a row. Two spellings of it would be two sources of truth.
  await reset();
  const r = repo();
  const { object, field, role } = await makeWorld(r, TENANT_A);
  await assert.rejects(
    () => query(
      `INSERT INTO eos_policy.role_field_permission_overrides
         (id, tenant_id, role_id, field_id, created_by, updated_by)
       VALUES ('o1', $1, $2, $3, 'u', 'u')`,
      [TENANT_A, role.id, field.id],
    ),
    /override_says_something/,
  );
  assert.ok(object.id, "the world was built");
});

test("a workflow version cannot have TWO initial steps", { skip: SKIP }, async () => {
  // A partial unique index, because an instance with two possible starting points has an ambiguous
  // beginning and the ambiguity only surfaces when the first record is created.
  await reset();
  const r = repo();
  const version = await r.transact(actorFor(TENANT_A), async (tx) => {
    const wf = await tx.createWorkflow({ key: "wf", name: "WF", description: null, objectKey: null, origin: "SYSTEM" });
    const v = await tx.createWorkflowVersion({ workflowId: wf.id, version: 1, status: "DRAFT", publishedAt: null, publishedBy: null });
    await tx.createWorkflowStep({ workflowVersionId: v.id, key: "A", label: "A", initial: true, terminal: false });
    return v;
  });

  await assert.rejects(
    () => r.transact(actorFor(TENANT_A), (tx) =>
      tx.createWorkflowStep({ workflowVersionId: version.id, key: "B", label: "B", initial: true, terminal: false })),
    /workflow_one_initial_step/,
  );
});

test("a step cannot be both initial and terminal", { skip: SKIP }, async () => {
  await reset();
  const r = repo();
  const version = await r.transact(actorFor(TENANT_A), async (tx) => {
    const wf = await tx.createWorkflow({ key: "wf", name: "WF", description: null, objectKey: null, origin: "SYSTEM" });
    return tx.createWorkflowVersion({ workflowId: wf.id, version: 1, status: "DRAFT", publishedAt: null, publishedBy: null });
  });
  await assert.rejects(
    () => r.transact(actorFor(TENANT_A), (tx) =>
      tx.createWorkflowStep({ workflowVersionId: version.id, key: "X", label: "X", initial: true, terminal: true })),
    /not_both_ends/,
  );
});

// ============================ transactions ============================

test("a transaction ROLLS BACK completely, audit event included", { skip: SKIP }, async () => {
  await reset();
  const r = repo();

  await assert.rejects(
    () => r.transact(actorFor(TENANT_A), async (tx) => {
      await tx.createRole({ key: "halfWritten", name: "Half", description: null, origin: "CUSTOM", protected: false });
      await tx.appendAudit({
        action: "createRole", actorUid: ACTOR.uid, targetKind: "role", targetId: "x",
        occurredAt: new Date().toISOString(), reason: null, before: null, after: null,
      });
      throw new Error("something failed after the writes");
    }),
    /something failed/,
  );

  const roles = await r.listRoles(TENANT_A);
  assert.deepEqual(roles, [], "no partial policy");
  const audit = await r.listAuditEvents(TENANT_A, 100);
  assert.deepEqual(audit, [], "and no orphan audit event");
});

test("a rollback does not leak the pool client", { skip: SKIP }, async () => {
  // A leaked client is a pool slot gone for the life of the process, and the symptom appears much
  // later as an unexplained hang. Proved by exhausting the pool's worth of failures and then
  // succeeding -- which is impossible if the failures kept their clients.
  await reset();
  const r = repo();
  for (let i = 0; i < 8; i += 1) {
    await assert.rejects(() => r.transact(actorFor(TENANT_A), async () => { throw new Error("boom"); }), /boom/);
  }
  const role = await r.transact(actorFor(TENANT_A), (tx) =>
    tx.createRole({ key: "after", name: "After", description: null, origin: "CUSTOM", protected: false }));
  assert.equal(role.key, "after", "the pool still hands out clients");
});

test("the access version bump is atomic under concurrency", { skip: SKIP }, async () => {
  // A read-then-write would lose updates, and a lost access-version bump means a revoked grant stays
  // cached as valid. Ten concurrent bumps must produce exactly ten.
  await reset();
  const r = repo();
  await Promise.all(
    Array.from({ length: 10 }, () => r.transact(actorFor(TENANT_A), (tx) => tx.bumpAccessVersion("uid-1"))),
  );
  const version = await r.getAccessVersion(TENANT_A, "uid-1");
  assert.equal(version.accessVersion, 10, "no bump was lost");
});

// ============================ tenancy ============================

test("TENANT ISOLATION: a read cannot cross the boundary", { skip: SKIP }, async () => {
  await reset();
  const r = repo();
  const a = await makeWorld(r, TENANT_A);
  const b = await makeWorld(r, TENANT_B);

  await grant(r, TENANT_A, a.role.id, a.object.id, { C: false, R: true, E: false, D: false });
  await assign(r, TENANT_A, "uid-1", a.role.id);

  const policyA = await loadPrincipalPolicy(r, TENANT_A, "uid-1");
  assert.equal(resolveObjectAccess(policyA, "customer").cred.R, true);

  // The SAME uid, asked about the other tenant.
  const policyB = await loadPrincipalPolicy(r, TENANT_B, "uid-1");
  assert.equal(policyB.qualifyingRoleIds.length, 0, "tenant A's assignment is invisible in tenant B");
  assert.equal(resolveObjectAccess(policyB, "customer").cred.R, false);

  // And tenant B's FIELD is not readable through tenant A's policy, even though both tenants have a
  // "customer" object with the same key.
  assert.equal(resolveFieldAccess(policyA, "customer", b.field).cred.R, false);
});

test("TENANT ISOLATION: a write cannot cross the boundary", { skip: SKIP }, async () => {
  await reset();
  const r = repo();
  const a = await makeWorld(r, TENANT_A);
  const b = await makeWorld(r, TENANT_B);

  // Tenant B's actor naming tenant A's object. It reports the same "not found" as a missing row --
  // distinguishing them would confirm the other tenant's row exists.
  await assert.rejects(
    () => r.transact(actorFor(TENANT_B), (tx) => tx.setObjectPermission(b.role.id, a.object.id, { C: false, R: true, E: false, D: false })),
    /object not found/,
  );
});

// ============================ workflow version integrity ============================

test("a PUBLISHED version cannot be edited", { skip: SKIP }, async () => {
  await reset();
  const r = repo();
  const version = await r.transact(actorFor(TENANT_A), async (tx) => {
    const wf = await tx.createWorkflow({ key: "wf", name: "WF", description: null, objectKey: null, origin: "SYSTEM" });
    const v = await tx.createWorkflowVersion({ workflowId: wf.id, version: 1, status: "DRAFT", publishedAt: null, publishedBy: null });
    await tx.createWorkflowStep({ workflowVersionId: v.id, key: "A", label: "A", initial: true, terminal: false });
    return tx.publishWorkflowVersion(v.id);
  });
  assert.equal(version.status, "PUBLISHED");
  assert.ok(version.publishedAt, "and it records when");

  await assert.rejects(
    () => r.transact(actorFor(TENANT_A), (tx) =>
      tx.createWorkflowStep({ workflowVersionId: version.id, key: "B", label: "B", initial: false, terminal: false })),
    /PUBLISHED and cannot be edited/,
  );
});

test("a PUBLISHED row must record who published it and when", { skip: SKIP }, async () => {
  // Enforced by the database, so a writer that skipped the command cannot record a publication with
  // nobody's name on it.
  await reset();
  const r = repo();
  const version = await r.transact(actorFor(TENANT_A), async (tx) => {
    const wf = await tx.createWorkflow({ key: "wf", name: "WF", description: null, objectKey: null, origin: "SYSTEM" });
    return tx.createWorkflowVersion({ workflowId: wf.id, version: 1, status: "DRAFT", publishedAt: null, publishedBy: null });
  });
  await assert.rejects(
    () => query("UPDATE eos_policy.workflow_versions SET status = 'PUBLISHED' WHERE id = $1", [version.id]),
    /published_records_when/,
  );
});

test("one live workflow per business record", { skip: SKIP }, async () => {
  await reset();
  const r = repo();
  const version = await r.transact(actorFor(TENANT_A), async (tx) => {
    const wf = await tx.createWorkflow({ key: "wf", name: "WF", description: null, objectKey: "workOrder", origin: "SYSTEM" });
    return tx.createWorkflowVersion({ workflowId: wf.id, version: 1, status: "DRAFT", publishedAt: null, publishedBy: null });
  });
  await r.transact(actorFor(TENANT_A), (tx) =>
    tx.createWorkflowInstance({ workflowVersionId: version.id, objectKey: "workOrder", recordId: "wo-1", currentStepKey: "A" }));

  await assert.rejects(
    () => r.transact(actorFor(TENANT_A), (tx) =>
      tx.createWorkflowInstance({ workflowVersionId: version.id, objectKey: "workOrder", recordId: "wo-1", currentStepKey: "A" })),
    /duplicate key|already exists/,
    "a second instance would give the record two current states",
  );
});

// ============================ audit integrity ============================

test("AUDIT survives the policy it describes", { skip: SKIP }, async () => {
  // No cascading delete from a policy row to its audit event. The record of who changed the rules
  // must outlive the rule, or it answers nothing when it matters.
  await reset();
  const r = repo();
  const role = await r.transact(actorFor(TENANT_A), async (tx) => {
    const created = await tx.createRole({ key: "temp", name: "Temp", description: null, origin: "CUSTOM", protected: false });
    await tx.appendAudit({
      action: "createRole", actorUid: ACTOR.uid, targetKind: "role", targetId: created.id,
      occurredAt: new Date().toISOString(), reason: "under test", before: null, after: { key: "temp" },
    });
    return created;
  });

  await query("DELETE FROM eos_policy.roles WHERE id = $1", [role.id]);
  const audit = await r.listAuditEvents(TENANT_A, 100);
  assert.equal(audit.length, 1, "the event is still there");
  assert.equal(audit[0].targetId, role.id, "still naming the role that no longer exists");
  assert.deepEqual(audit[0].after, { key: "temp" }, "with its JSONB payload intact");
});

test("audit events come back oldest-first, so a sequence reads in order", { skip: SKIP }, async () => {
  await reset();
  const r = repo();
  const base = Date.parse("2026-09-08T00:00:00Z");
  await r.transact(actorFor(TENANT_A), async (tx) => {
    // DISTINCT timestamps, one second apart. Equal ones would make the expected order depend on the
    // id tiebreak -- which the query does apply, but asserting on generated ids would be testing
    // the id generator rather than the ordering.
    for (const [i, action] of ["first", "second", "third"].entries()) {
      await tx.appendAudit({
        action, actorUid: ACTOR.uid, targetKind: "t", targetId: "x",
        occurredAt: new Date(base + i * 1000).toISOString(),
        reason: null, before: null, after: null,
      });
    }
  });
  const audit = await r.listAuditEvents(TENANT_A, 100);
  assert.deepEqual(audit.map((e) => e.action), ["first", "second", "third"], "oldest first");

  // And the bound takes the MOST RECENT events, still oldest-first within the page.
  const lastTwo = await r.listAuditEvents(TENANT_A, 2);
  assert.deepEqual(lastTwo.map((e) => e.action), ["second", "third"]);
});

// ============================ round-trip through the resolver ============================

test("the resolver works identically over Postgres", { skip: SKIP }, async () => {
  // The whole point of the port: the same resolution code, a different store, the same answers --
  // including the doorway invariant, which is the one that must never depend on the adapter.
  await reset();
  const r = repo();
  const { object, field, role } = await makeWorld(r, TENANT_A);

  await grant(r, TENANT_A, role.id, object.id, { C: false, R: false, E: false, D: false });
  await r.transact(actorFor(TENANT_A), (tx) => tx.setFieldOverride(role.id, field.id, { R: true }));
  await assign(r, TENANT_A, "uid-1", role.id);

  const policy = await loadPrincipalPolicy(r, TENANT_A, "uid-1");
  const decision = resolveFieldAccess(policy, "customer", field);
  assert.equal(decision.cred.R, false, "the field grant does not open the doorway");
  assert.equal(decision.basis, "doorwayClosed");
});

test("an EMPTY override deletes the row rather than storing a second spelling of silence", { skip: SKIP }, async () => {
  await reset();
  const r = repo();
  const { field, role } = await makeWorld(r, TENANT_A);

  await r.transact(actorFor(TENANT_A), (tx) => tx.setFieldOverride(role.id, field.id, { R: false }));
  assert.equal((await r.listFieldOverrides(TENANT_A, [role.id])).length, 1);

  await r.transact(actorFor(TENANT_A), (tx) => tx.setFieldOverride(role.id, field.id, {}));
  assert.equal((await r.listFieldOverrides(TENANT_A, [role.id])).length, 0, "the row is gone, not blanked");
});

test("setting a permission twice UPDATES rather than duplicating", { skip: SKIP }, async () => {
  await reset();
  const r = repo();
  const { object, role } = await makeWorld(r, TENANT_A);

  await grant(r, TENANT_A, role.id, object.id, { C: false, R: true, E: false, D: false });
  await grant(r, TENANT_A, role.id, object.id, { C: true, R: true, E: true, D: false });

  const rows = await r.listObjectPermissions(TENANT_A, [role.id]);
  assert.equal(rows.length, 1, "one row, not two the resolver would have to union with itself");
  assert.deepEqual(rows[0].cred, { C: true, R: true, E: true, D: false });
});

// ============================ helpers ============================

async function makeWorld(r, tenantId) {
  return r.transact(actorFor(tenantId), async (tx) => {
    const object = await tx.createObject({
      key: "customer", label: "Customer", labelPlural: "Customers", description: null,
      origin: "SYSTEM", lifecycle: "ACTIVE", supportsDelete: true,
    });
    const field = await tx.createField({
      objectId: object.id, key: "creditLimit", label: "Credit Limit", description: null,
      dataType: "NUMBER", required: false, allowedValues: [], defaultValue: null, searchable: false,
      sortable: false, reportable: true, sensitivity: "CONFIDENTIAL", referenceTo: null,
      origin: "SYSTEM", lifecycle: "ACTIVE",
    });
    const role = await tx.createRole({
      key: "viewer", name: "Viewer", description: null, origin: "CUSTOM", protected: false,
    });
    return { object, field, role };
  });
}

const grant = (r, tenantId, roleId, objectId, cred) =>
  r.transact(actorFor(tenantId), (tx) => tx.setObjectPermission(roleId, objectId, cred));

const assign = (r, tenantId, principalUid, roleId) =>
  r.transact(actorFor(tenantId), async (tx) => {
    const accessVersion = await tx.bumpAccessVersion(principalUid);
    return tx.createAssignment({
      principalUid, roleId, scopeType: "global", scopeValue: null, status: "active",
      grantedBy: ACTOR.uid, grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion,
    });
  });

// ============================ the registered command is the authority ============================

test("the registered PostgreSQL script runs BOTH suites, serially", () => {
  // WHY THIS IS A TEST. These two files each drop and re-migrate the same schema, and `node --test`
  // runs FILES concurrently by default. They raced in CI -- one dropped the schema mid-transaction
  // of the other -- and the failure was invisible locally because the files had only ever been run
  // SEPARATELY. "Both suites pass" was true of two runs that never happened at the same time.
  //
  // So the registered command is the proof, and this pins its two load-bearing properties: it
  // covers both files, and it serializes them. Removing either would restore the race silently.
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const command = pkg.scripts["test:adminPolicyPostgres"];

  assert.ok(command, "the registered command exists");
  assert.match(command, /--test-concurrency=1/, "it must serialize the files that share a schema");
  assert.match(command, /adminPolicyPostgres\.test\.mjs/, "it must run the schema suite");
  assert.match(command, /adminPolicySeed\.test\.mjs/, "it must run the seed suite");
  assert.match(command, /npm run build/, "it must run against a fresh build, not a stale lib/");
});

test("every suite that resets the schema is covered by that one command", () => {
  // A third file that drops the schema and is NOT in the registered command would race the other
  // two exactly as these did. Found by looking for the reset itself rather than by remembering.
  const resetters = readdirSync("test")
    .filter((f) => f.endsWith(".test.mjs"))
    .filter((f) => /DROP SCHEMA/i.test(readFileSync(join("test", f), "utf8")));
  const command = JSON.parse(readFileSync("package.json", "utf8")).scripts["test:adminPolicyPostgres"];

  assert.ok(resetters.length >= 2, `expected the two known resetters, found ${resetters.length}`);
  for (const file of resetters) {
    assert.ok(command.includes(file), `${file} resets the schema but the registered command does not run it`);
  }
});
