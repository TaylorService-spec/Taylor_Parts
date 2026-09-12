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
import { declaredSchemas } from "./support/migrationSchema.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { declaredTables, migrationFiles, migrationsAfter } from "./support/migrationSchema.mjs";
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

/** How many migrations exist, counted rather than remembered. See its callers for why. */
const migrationCount = () => readdirSync("migrations").filter((f) => f.endsWith(".sql")).length;

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const ACTOR = { uid: "uid-admin" };
const actorFor = (tenantId) => ({ tenantId, uid: ACTOR.uid });

let pool = null;

/**
 * The migration set, COUNTED rather than remembered.
 *
 * These proofs used to hardcode "reverse seven". Every migration added after them broke a test that
 * was making a claim about reversal, not about how many migrations exist -- and the number is also
 * the one thing several concurrent branches each change. Derived from the directory, the claims stay
 * about what they are about.
 */
const MIGRATION_FILES = readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort();
/** `down` steps that reverse everything from the newest through the migration at `prefix`, inclusive. */
function stepsBackTo(prefix) {
  const index = MIGRATION_FILES.findIndex((f) => f.startsWith(prefix));
  assert.ok(index >= 0, `migration ${prefix} is present`);
  return MIGRATION_FILES.length - index;
}

/** Re-run the migration from a clean schema, so every test starts from the same known state. */
function migrateFromClean() {
  execFileSync(process.execPath, [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations",
  ], { env: { ...process.env, DATABASE_URL: URL }, stdio: "pipe" });
}

async function reset() {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  // EVERY schema the migrations create, read from functions/migrations rather than listed here.
  //
  // Each of these resetters carried its own hand-written list, and at the W1 integration no two of
  // them agreed: some dropped eos_crm, some eos_commercial, most neither. A schema left standing
  // while `pgmigrations` is dropped makes the next `up` re-run its migration against objects that
  // still exist -- the failure is `type "commercial_handoff_source" already exists`, 48 tests deep in
  // a suite that has nothing to do with the commercial schema. Derived, the list cannot drift again.
  for (const schema of declaredSchemas()) {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  // eos_ops (migration 005) is a sibling schema in the same database. Migration 003 was still the
  // most recent when this reset was written; it must also drop eos_ops now, or a second migrateFromClean()
  // in the same job fails with "already exists" the moment eos_ops has any migration to re-run.
  // Migration 008 created a THIRD schema. A reset that re-migrates from clean has to drop every
  // schema the migrations create, not only the two that existed when it was written: a surviving
  // eos_crm plus a dropped `pgmigrations` makes the next `up` re-run 008 against tables that are
  // still there.
  await client.query("DROP TABLE IF EXISTS pgmigrations");
  await client.end();
  migrateFromClean();
  await seedTenants();
}

/**
 * A real principal, a member of the tenant.
 *
 * Migration 003 made an assignment to a non-member -- and an access-version row for a principal who
 * does not exist -- UNREPRESENTABLE. These proofs therefore create the identity the platform would,
 * which is also what lets the integrity tests below assert that the constraint actually fires.
 */
async function makeMember(tenantId, subject) {
  const r = repo();
  return r.transact({ tenantId, uid: ACTOR.uid }, async (tx) => {
    const principal = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
    await tx.createTenantMembership(principal.id);
    return principal.id;
  });
}

/** Tenants are a foreign-key parent for everything; the seed creates them, so the tests do too. */
async function seedTenants() {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  for (const id of [TENANT_A, TENANT_B]) {
    await client.query(
      "INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [id, id, id],
    );
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
    "audit_events", "capabilities", "employee_principal_links", "object_fields", "objects",
    "principal_access_versions", "principals",
    "role_capabilities", "role_field_permission_overrides", "role_object_permissions", "roles",
    "tenant_admin_bootstraps", "tenant_memberships", "tenants",
    "user_role_assignments", "workflow_actions", "workflow_instance_events", "workflow_instances",
    "workflow_role_bindings", "workflow_steps", "workflow_versions", "workflows",
  ], "twenty-two tables -- sixteen from migration 001, three from 002 (identity), two from 004 " +
     "(operational capabilities), one from 008 (the Employee <-> Principal linkage). Migration 005 " +
     "(eos_ops) is a SEPARATE schema and adds none of these.");

  const enums = await query(
    `SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'eos_policy' AND t.typtype = 'e' ORDER BY 1`,
  );
  assert.deepEqual(enums.rows.map((r) => r.typname), [
    "assignment_status", "definition_lifecycle", "definition_origin",
    "field_data_type", "field_sensitivity", "principal_status", "workflow_version_status",
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

const MIGRATION_007 = "1757980800000_operating-company-and-serialized-custody.sql";
const migrationFileCount = () => migrationFiles().length;

test("the DOWN migrations remove the schema, and UP restores it", { skip: SKIP }, async () => {
  await reset();
  // ALL OF THEM, and the count is the point: `down` reverses ONE by default, so a single call leaves
  // the earlier migrations standing. A test that expected zero after one step would be asserting
  // that the newest migration undoes its predecessors' work, which it must not. The count is read
  // from the directory rather than written down, so an additive migration does not silently turn
  // this into a proof about a partial unwind.
  execFileSync(process.execPath, [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js", "down", String(migrationFileCount()),
    "--migrations-dir", "migrations",
  ], { env: { ...process.env, DATABASE_URL: URL }, stdio: "pipe" });

  const gone = await query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'eos_policy'");
  assert.equal(gone.rows[0].n, 0, "down leaves nothing behind");
  const opsGone = await query("SELECT count(*)::int n FROM information_schema.schemata WHERE schema_name = 'eos_ops'");
  assert.equal(opsGone.rows[0].n, 0, "eos_ops is gone too");

  migrateFromClean();
  const back = await query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'eos_policy'");
  assert.equal(back.rows[0].n, 22, "and up restores all twenty-two");
});

test("a migration reverses alone, leaving its predecessors intact", { skip: SKIP }, async () => {
  // The step that matters operationally: rolling back ONE migration must not take the ones under it
  // with it. Proved by reversing exactly one, then exactly one more, and counting what survives.
  await reset();
  const down = (count) => execFileSync(process.execPath, [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js", "down", String(count), "--migrations-dir", "migrations",
  ], { env: { ...process.env, DATABASE_URL: URL }, stdio: "pipe" });

  // ════════════ ONE UNWIND, BY NAME, NOT TWO ════════════
  //
  // `stepsBackTo("1757980800000_")` already reverses 007 AND everything above it in a single call --
  // it is the canonical "steps back to this migration" form, computed from the file list. An earlier
  // integration pass ALSO pre-reversed the post-007 migrations here, and the two unwinds compounded:
  // 11 steps plus 12 steps took 001-006 down too and eos_policy came back empty (0 !== 21). The
  // pre-unwind is gone; the single named unwind below is the one that runs.

  // 007 off: the operating-company column and the custody location type go, in the SIBLING eos_ops
  // schema. eos_policy must not notice at all -- 007 adds no eos_policy table, column or enum.
  //
  // Reversed BY NAME, not by a literal step count: anything newer than 007 comes off with it, and
  // this test stays a claim about 007 rather than about how many migrations happen to exist today.
  down(stepsBackTo("1757980800000_"));

  // AND THE UNWIND ACTUALLY REACHED THEM. Eleven additive migrations landed together at the W1
  // integration, and each lane had written its own "my tables are gone" block right here -- eleven
  // near-identical blocks, each naming its own tables, is precisely what makes this file re-conflict
  // at every future integration. The rule every one of them stood in for is asserted ONCE instead,
  // derived from the migration files rather than listed: NO table introduced by a migration newer
  // than 007 survives the unwind, in ANY schema. Schema-agnostic on purpose -- post-007 migrations
  // create tables in eos_ops, in eos_policy (the Employee <-> Principal linkage) and in schemas that
  // did not exist when this test was written (eos_crm, eos_commercial), and a rule that only looked
  // at eos_ops would have silently stopped covering most of them.
  // Each lane's own Postgres suite still proves its own tables' specific down behaviour.
  for (const [schema, tables] of declaredTables(migrationsAfter(MIGRATION_007))) {
    const survivors = await query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = $1 AND table_name = ANY($2::text[]) ORDER BY 1`,
      [schema, tables],
    );
    assert.deepEqual(survivors.rows, [],
      `every ${schema} table a post-007 migration created is gone once those migrations are reversed`);
  }
  const companyColumnGone = await query(
    "SELECT count(*)::int n FROM information_schema.columns WHERE table_schema = 'eos_ops'" +
    " AND column_name = 'operating_company_key'",
  );
  assert.equal(companyColumnGone.rows[0].n, 0, "no eos_ops table still carries the company column");
  const custodyTypeGone = await query(
    `SELECT count(*)::int n FROM pg_type t JOIN pg_namespace ns ON ns.oid = t.typnamespace
      WHERE ns.nspname = 'eos_ops' AND t.typname = 'ops_custody_location_type'`,
  );
  assert.equal(custodyTypeGone.rows[0].n, 0, "the custody location type is gone with it");
  const untouchedByOhSeven = await query(
    "SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'eos_policy'",
  );
  assert.equal(untouchedByOhSeven.rows[0].n, 21, "eos_policy is untouched by reversing an eos_ops migration");

  // 006 off: the P1A capability vocabulary rows go (13 new keys), the table and the five
  // pre-existing Cycle Count rows stay -- migration 006 is catalog-only, no new table.
  down(1);
  const capabilityRowCount = await query(
    "SELECT count(*)::int n FROM eos_policy.capabilities",
  );
  assert.equal(capabilityRowCount.rows[0].n, 5, "only the five pre-existing Cycle Count rows remain");
  const capabilitiesTableStillExists = await query(
    "SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'eos_policy' AND table_name = 'capabilities'",
  );
  assert.equal(capabilitiesTableStillExists.rows[0].n, 1, "the capabilities table itself is migration 004's, not 006's");
  const stillTwentyOneAfter006 = await query(
    "SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'eos_policy'",
  );
  assert.equal(stillTwentyOneAfter006.rows[0].n, 21, "no table was added or removed by reversing 006");

  // 005 off: eos_ops (a SEPARATE schema) disappears entirely; eos_policy is untouched.
  down(1);
  const opsGoneAlone = await query(
    "SELECT count(*)::int n FROM information_schema.schemata WHERE schema_name = 'eos_ops'",
  );
  assert.equal(opsGoneAlone.rows[0].n, 0, "eos_ops is gone");
  const stillTwentyOne = await query(
    "SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'eos_policy'",
  );
  assert.equal(stillTwentyOne.rows[0].n, 21, "eos_policy is untouched by reversing the sibling schema");

  // 004 off: the operational capability tables go, migration 001-003's nineteen stay.
  down(1);
  const capsGone = await query(
    "SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'eos_policy'" +
    " AND table_name IN ('capabilities', 'role_capabilities')",
  );
  assert.equal(capsGone.rows[0].n, 0, "the capability tables are gone");
  const back19 = await query(
    "SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'eos_policy'",
  );
  assert.equal(back19.rows[0].n, 19, "and the pre-existing nineteen survive");

  // 003 off: the integrity constraints go, the tables stay, and the column name reverts.
  down(1);
  const afterThree = await query(
    "SELECT count(*)::int n FROM pg_indexes WHERE schemaname = 'eos_policy'" +
    " AND indexname = 'user_role_assignments_one_active'",
  );
  assert.equal(afterThree.rows[0].n, 0, "the one-active index is gone");
  const renamed = await query(
    "SELECT count(*)::int n FROM information_schema.columns WHERE table_schema = 'eos_policy'" +
    " AND table_name = 'user_role_assignments' AND column_name = 'principal_uid'",
  );
  assert.equal(renamed.rows[0].n, 1, "and the column name reverted");
  const stillNineteen = await query(
    "SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'eos_policy'",
  );
  assert.equal(stillNineteen.rows[0].n, 19, "every table survives");

  // 002 off: the identity model goes, migration 001's sixteen tables stay.
  down(1);
  const identity = await query(
    "SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'eos_policy'" +
    " AND table_name IN ('principals', 'tenant_memberships', 'tenant_admin_bootstraps')",
  );
  assert.equal(identity.rows[0].n, 0, "the identity model is gone");

  const policy = await query(
    "SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'eos_policy'",
  );
  assert.equal(policy.rows[0].n, 16, "and migration 001's sixteen tables are untouched");

  migrateFromClean();
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
  // An access-version row belongs to a principal that exists (migration 003), so the identity comes
  // first -- which is also what the platform does.
  const principalId = await makeMember(TENANT_A, "subject-concurrent");
  await Promise.all(
    Array.from({ length: 10 }, () => r.transact(actorFor(TENANT_A), (tx) => tx.bumpAccessVersion(principalId))),
  );
  const version = await r.getAccessVersion(TENANT_A, principalId);
  assert.equal(version.accessVersion, 10, "no bump was lost");
});

// ============================ tenancy ============================

test("TENANT ISOLATION: a read cannot cross the boundary", { skip: SKIP }, async () => {
  await reset();
  const r = repo();
  const a = await makeWorld(r, TENANT_A);
  const b = await makeWorld(r, TENANT_B);

  await grant(r, TENANT_A, a.role.id, a.object.id, { C: false, R: true, E: false, D: false });
  const { principalId } = await assign(r, TENANT_A, "subject-isolation", a.role.id);

  const policyA = await loadPrincipalPolicy(r, TENANT_A, principalId);
  assert.equal(resolveObjectAccess(policyA, "customer").cred.R, true);

  // The SAME principal, asked about the other tenant.
  const policyB = await loadPrincipalPolicy(r, TENANT_B, principalId);
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
  const { principalId } = await assign(r, TENANT_A, "subject-resolver", role.id);

  const policy = await loadPrincipalPolicy(r, TENANT_A, principalId);
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

/**
 * Assign a Role, creating the principal and the membership the constraints require.
 *
 * Returns the EOS PRINCIPAL ID, which is not the subject string the caller passed. That difference
 * is the whole point of the identity model: a Firebase UID is a mapping key, not the authorization
 * model's identity.
 */
const assign = async (r, tenantId, subject, roleId) => {
  const principalId = await makeMember(tenantId, subject);
  const assignment = await r.transact(actorFor(tenantId), async (tx) => {
    const accessVersion = await tx.bumpAccessVersion(principalId);
    return tx.createAssignment({
      principalId, roleId, scopeType: "global", scopeValue: null, status: "active",
      grantedBy: ACTOR.uid, grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion,
    });
  });
  return { ...assignment, principalId };
};

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

/**
 * A file RESETS the schema when it hands a `DROP SCHEMA` to a query, not when it merely contains
 * those two words.
 *
 * ════════════════════ WHY THIS IS NARROWER THAN `/DROP SCHEMA/` ════════════════════
 *
 * The rule used to be "the file mentions DROP SCHEMA anywhere". That is a proxy for the real
 * property, and it misfires in the one direction nobody expects: a test that PROVES a migration
 * does NOT drop a schema has to name the statement it is forbidding, and was therefore classified
 * as a resetter and demanded registration in a Postgres command it must never join --
 * eosOpsCashApplication.test.mjs is a pure unit suite that opens no database at all.
 *
 * Registering a non-database suite in the serialized Postgres command to satisfy a proxy would be
 * the guard training people to lie to it. So the proxy is replaced by the property: every one of
 * the eight real resetters in this repository executes the statement the same way --
 * `client.query("DROP SCHEMA ...")` or `query(`DROP SCHEMA ...`)` -- and that is what is matched.
 *
 * NOTHING IS EXEMPTED and no allowlist exists: a file that drops a schema through a query is caught
 * exactly as before. `KNOWN_RESETTERS` below pins the floor so this narrowing cannot silently start
 * detecting fewer files than it did when it was written.
 */
const executesSchemaDrop = (source) => /\bquery\(\s*[`'"]\s*DROP\s+SCHEMA\b/i.test(source);

/** The resetters that existed when the rule above was tightened. The detector may never find FEWER. */
const KNOWN_RESETTERS = [
  "adminPolicyActivation.test.mjs",
  "adminPolicyPostgres.test.mjs",
  "adminPolicySeed.test.mjs",
  "eosOpsInventoryCommitmentPostgres.test.mjs",
  "eosOpsOperatingCompanyCustodyPostgres.test.mjs",
  "eosOpsPostgres.test.mjs",
  "eosOpsPurchasingPostgres.test.mjs",
  "inventoryCapabilityGrantMigration.test.mjs",
];

test("every suite that resets the schema is covered by that one command", () => {
  // A third file that drops the schema and is NOT in the registered command would race the other
  // two exactly as these did. Found by looking for the reset itself rather than by remembering.
  const resetters = readdirSync("test")
    .filter((f) => f.endsWith(".test.mjs"))
    .filter((f) => executesSchemaDrop(readFileSync(join("test", f), "utf8")));
  const command = JSON.parse(readFileSync("package.json", "utf8")).scripts["test:adminPolicyPostgres"];

  assert.ok(resetters.length >= 2, `expected the two known resetters, found ${resetters.length}`);
  for (const file of KNOWN_RESETTERS) {
    assert.ok(resetters.includes(file),
      `${file} resets the schema and the detector no longer sees it -- the rule has been narrowed too far`);
  }
  for (const file of resetters) {
    assert.ok(command.includes(file), `${file} resets the schema but the registered command does not run it`);
  }
});
