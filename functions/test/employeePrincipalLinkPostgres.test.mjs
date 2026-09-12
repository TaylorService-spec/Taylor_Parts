// Employee ↔ Principal linkage — migration 008's STRUCTURAL proofs.
//
// ════════════════════ THESE RUN AGAINST A REAL DATABASE ════════════════════
//
// Same contract as adminPolicyPostgres.test.mjs and eosOpsOperatingCompanyCustodyPostgres.test.mjs:
// set POLICY_TEST_DATABASE_URL to run; without it this SKIPS loudly rather than fails, so a
// developer with no local cluster is not blocked and a green run with no database cannot be
// mistaken for a green run with one.
//
// ════════════════════ THIS SUITE DOES NOT RESET THE SHARED SCHEMA ════════════════════
//
// adminPolicyPostgres.test.mjs and eosOpsOperatingCompanyCustodyPostgres.test.mjs each drop and
// re-migrate `eos_policy` from clean, and `node --test` runs FILES concurrently -- which is why
// adminPolicyPostgres.test.mjs's "every suite that resets the schema is covered by that one command"
// exists to force every such file into one serialized npm script.
//
// A third resetter would be a third file in that race, so this one is not a resetter. It brings the
// database to head with an idempotent `migrate up` and then clears ONLY the rows it owns: its own
// table, and the `prn-uid-*` principals and memberships its own fixtures create. That is enough for
// "each test starts from a known state" without any claim over a schema it shares.
//
// It still belongs in the serialized `test:adminPolicyPostgres` command so it runs in CI at all --
// recorded in docs/handoff/w1-c5-registrations.md, because functions/package.json is a shared file
// this lane may not edit.
//
// ════════════════════ WHY THE CLAIMS ARE STRUCTURAL ════════════════════
//
// "The writers will remember not to link one person twice" is not a property. "The database refuses
// the second active link" is. Every assertion below is a property of PostgreSQL -- a partial unique
// index, a composite foreign key, a CHECK constraint -- and an in-memory double would prove none of
// them.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import pg from "pg";

import {
  establishLink,
  readActiveLinkForEmployee,
  readActiveLinkForPrincipal,
  resolveEmployeeIdForPrincipal,
  revokeLinkForEmployee,
  listLinkHistoryForEmployee,
  EmployeePrincipalLinkConflict,
} from "../lib/employeeIdentity/employeePrincipalLinkRepository.js";
import {
  EmployeePrincipalLinkInvalid,
  EmployeePrincipalLinkRefused,
  LINK_REFUSAL,
} from "../lib/employeeIdentity/employeePrincipalLink.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const MIGRATION_FILE = "migrations/1758412800000_employee-principal-linkage.sql";

let pool = null;
function db() {
  pool ??= new pg.Pool({ connectionString: URL, max: 4 });
  return pool;
}

function migrate(args) {
  return execFileSync(
    process.execPath,
    ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", ...args, "--migrations-dir", "migrations"],
    { env: { ...process.env, DATABASE_URL: URL }, encoding: "utf8", stdio: "pipe" },
  );
}

/**
 * Bring the database to head and clear ONLY this suite's own rows.
 *
 * `migrate up` is idempotent, so this works both on an empty database and after another suite has
 * re-migrated from clean. The deletes are scoped to this file's own table and its own `prn-uid-*`
 * fixture identities -- never a schema, never another suite's data. See the header for why.
 */
async function reset() {
  migrate(["up"]);
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  await client.query("DELETE FROM eos_policy.employee_principal_links");
  await client.query("DELETE FROM eos_policy.tenant_memberships WHERE principal_id LIKE 'prn-uid-%'");
  await client.query("DELETE FROM eos_policy.principals WHERE id LIKE 'prn-uid-%'");
  for (const id of [TENANT_A, TENANT_B]) {
    await client.query(
      "INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $1, $1) ON CONFLICT DO NOTHING",
      [id],
    );
  }
  await client.end();
}

/**
 * A real principal who is a real member of the tenant.
 *
 * Migration 008 reuses migration 003's Ruling B shape, so an Employee linked to a principal who is
 * not a member of THIS tenant is unrepresentable. These proofs therefore create the identity the
 * platform would, which is also what lets the integrity test below show the constraint firing.
 */
async function makeMember(tenantId, subject, { provider = "firebase" } = {}) {
  const principalId = `prn-${subject}`;
  await db().query(
    `INSERT INTO eos_policy.principals (id, external_subject, identity_provider)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [principalId, subject, provider],
  );
  await db().query(
    `INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [`mem-${tenantId}-${principalId}`, tenantId, principalId],
  );
  return principalId;
}

/** A principal that exists but belongs to NO tenant. */
async function makeStranger(subject) {
  const principalId = `prn-${subject}`;
  await db().query(
    `INSERT INTO eos_policy.principals (id, external_subject, identity_provider)
     VALUES ($1, $2, 'firebase') ON CONFLICT DO NOTHING`,
    [principalId, subject],
  );
  return principalId;
}

const linkInput = (overrides) => ({
  tenantId: TENANT_A,
  employeeId: "emp-1",
  operatingCompanyId: "taylor",
  linkSource: "RECIPROCAL_FIREBASE_UID_LINK",
  ...overrides,
});

/**
 * Reverse every migration that sorts STRICTLY NEWER than this lane's own, so that a single
 * `node-pg-migrate down` once again reverses THIS migration.
 *
 * A lane suite proving "my down refuses while my tables still hold data" runs one `down` step. That
 * reverses whichever migration is newest -- this lane's own only while this lane's own is last. It
 * was last on the branch and is not last on main: eleven migrations landed together at the W1
 * integration, and this test was reversing a stranger's migration and reporting
 * "Missing expected exception" while the refusal it checks worked perfectly.
 *
 * Driven by what is APPLIED (pgmigrations) rather than by a file count, so calling it twice in one
 * test is a no-op the second time instead of digging past the migration under test.
 */
async function peelMigrationsNewerThan(prefix) {
  for (;;) {
    const applied = await db().query("SELECT name FROM pgmigrations ORDER BY id DESC LIMIT 1");
    const newest = applied.rows[0]?.name;
    if (!newest || newest.startsWith(prefix) || newest < prefix) return;
    migrate(["down"]);
  }
}

test("employee ↔ principal linkage, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  await t.test("a link is established, read back, and resolves the Employee for the principal", async () => {
    await reset();
    const principalId = await makeMember(TENANT_A, "uid-1");
    const record = await establishLink(db(), linkInput({ principalId }));

    assert.equal(record.tenantId, TENANT_A);
    assert.equal(record.employeeId, "emp-1");
    assert.equal(record.principalId, principalId);
    assert.equal(record.operatingCompanyId, "taylor");
    assert.equal(record.linkSource, "RECIPROCAL_FIREBASE_UID_LINK");
    assert.equal(record.status, "active");

    assert.equal((await readActiveLinkForEmployee(db(), TENANT_A, "emp-1")).id, record.id);
    assert.equal((await readActiveLinkForPrincipal(db(), TENANT_A, principalId)).id, record.id);
    assert.equal(await resolveEmployeeIdForPrincipal(db(), TENANT_A, principalId), "emp-1");
  });

  await t.test("a principal with no link resolves to NULL -- there is no fallback", async () => {
    await reset();
    const principalId = await makeMember(TENANT_A, "uid-unlinked");
    assert.equal(await resolveEmployeeIdForPrincipal(db(), TENANT_A, principalId), null);
    assert.equal(await readActiveLinkForEmployee(db(), TENANT_A, "emp-anything"), null);
  });

  await t.test("ONE ACTIVE LINK PER EMPLOYEE -- a second principal for the same Employee is refused", async () => {
    await reset();
    const first = await makeMember(TENANT_A, "uid-1");
    const second = await makeMember(TENANT_A, "uid-2");
    await establishLink(db(), linkInput({ principalId: first }));

    await assert.rejects(
      establishLink(db(), linkInput({ principalId: second })),
      (err) =>
        err instanceof EmployeePrincipalLinkConflict && err.code === "EMPLOYEE_ALREADY_LINKED",
      "one Employee is not two logins",
    );

    // And the index itself refuses it, not only the repository's pre-read: a direct INSERT that
    // bypasses this module still cannot produce the second active row.
    await assert.rejects(
      db().query(
        `INSERT INTO eos_policy.employee_principal_links
           (id, tenant_id, principal_id, employee_id, operating_company_id, link_source)
         VALUES ('raw-1', $1, $2, 'emp-1', 'taylor', 'RECIPROCAL_FIREBASE_UID_LINK')`,
        [TENANT_A, second],
      ),
      (err) => err.constraint === "employee_principal_links_one_active_per_employee",
    );
  });

  await t.test("ONE ACTIVE LINK PER PRINCIPAL -- a second Employee for the same login is refused", async () => {
    await reset();
    const principalId = await makeMember(TENANT_A, "uid-1");
    await establishLink(db(), linkInput({ principalId }));

    await assert.rejects(
      establishLink(db(), linkInput({ principalId, employeeId: "emp-2" })),
      (err) =>
        err instanceof EmployeePrincipalLinkConflict && err.code === "PRINCIPAL_ALREADY_LINKED",
      "one login is not two Employees",
    );
  });

  await t.test("re-establishing the SAME link is idempotent; a different one is not", async () => {
    await reset();
    const principalId = await makeMember(TENANT_A, "uid-1");
    const first = await establishLink(db(), linkInput({ principalId }));
    const again = await establishLink(db(), linkInput({ principalId }));
    assert.equal(again.id, first.id, "already true is not a conflict");

    const other = await makeMember(TENANT_A, "uid-2");
    await assert.rejects(
      establishLink(db(), linkInput({ principalId: other })),
      (err) => err instanceof EmployeePrincipalLinkConflict,
      "now says something else IS a conflict",
    );
  });

  await t.test("RULING B REUSED -- a principal who is not a member of THIS tenant is unrepresentable", async () => {
    await reset();
    const stranger = await makeStranger("uid-stranger");
    await assert.rejects(
      establishLink(db(), linkInput({ principalId: stranger })),
      (err) => err instanceof EmployeePrincipalLinkConflict && err.code === "NOT_A_TENANT_MEMBER",
    );

    // A member of tenant B cannot be linked by tenant A: the composite key, not a principal-only key.
    const inB = await makeMember(TENANT_B, "uid-b");
    await assert.rejects(
      establishLink(db(), linkInput({ tenantId: TENANT_A, principalId: inB })),
      (err) => err instanceof EmployeePrincipalLinkConflict && err.code === "NOT_A_TENANT_MEMBER",
      "a cross-tenant identity leak is a foreign-key failure, not a policy hope",
    );
    // The same principal IS linkable inside tenant B, which is what proves the refusal above was
    // about the tenant rather than about the principal.
    const ok = await establishLink(db(), linkInput({ tenantId: TENANT_B, principalId: inB }));
    assert.equal(ok.tenantId, TENANT_B);
  });

  await t.test("a revoked link stays as history and does not block a re-link", async () => {
    await reset();
    const first = await makeMember(TENANT_A, "uid-1");
    const second = await makeMember(TENANT_A, "uid-2");
    await establishLink(db(), linkInput({ principalId: first }));

    const revoked = await revokeLinkForEmployee(db(), TENANT_A, "emp-1");
    assert.equal(revoked.status, "revoked");
    assert.equal(await readActiveLinkForEmployee(db(), TENANT_A, "emp-1"), null);
    assert.equal(await resolveEmployeeIdForPrincipal(db(), TENANT_A, first), null);

    // The partial index is on status='active', so the re-link succeeds and BOTH rows survive.
    const relinked = await establishLink(db(), linkInput({ principalId: second }));
    assert.equal(relinked.status, "active");
    const history = await listLinkHistoryForEmployee(db(), TENANT_A, "emp-1");
    assert.deepEqual(
      history.map((h) => [h.principalId, h.status]),
      [
        [first, "revoked"],
        [second, "active"],
      ],
    );

    // Revoking when there is nothing active is a legitimate end state, not an error.
    await revokeLinkForEmployee(db(), TENANT_A, "emp-1");
    assert.equal(await revokeLinkForEmployee(db(), TENANT_A, "emp-1"), null);
  });

  await t.test("the link_source CHECK makes a technician-id coincidence unrepresentable", async () => {
    await reset();
    const principalId = await makeMember(TENANT_A, "uid-1");

    // Refused by the module, with the sentence rather than a constraint name.
    await assert.rejects(
      establishLink(db(), linkInput({ principalId, linkSource: "TECHNICIAN_ID_COINCIDENCE" })),
      EmployeePrincipalLinkInvalid,
    );

    // And refused by the DATABASE on a path that never comes through the module.
    await assert.rejects(
      db().query(
        `INSERT INTO eos_policy.employee_principal_links
           (id, tenant_id, principal_id, employee_id, operating_company_id, link_source)
         VALUES ('raw-tech', $1, $2, 'emp-1', 'taylor', 'TECHNICIAN_ID_COINCIDENCE')`,
        [TENANT_A, principalId],
      ),
      (err) => err.constraint === "employee_principal_links_source_known",
    );
  });

  await t.test("an OPERATOR_ASSERTED link requires an author and a reason -- in code AND in SQL", async () => {
    await reset();
    const principalId = await makeMember(TENANT_A, "uid-1");

    await assert.rejects(
      establishLink(db(), linkInput({ principalId, linkSource: "OPERATOR_ASSERTED" })),
      EmployeePrincipalLinkInvalid,
    );
    await assert.rejects(
      db().query(
        `INSERT INTO eos_policy.employee_principal_links
           (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by)
         VALUES ('raw-assert', $1, $2, 'emp-1', 'taylor', 'OPERATOR_ASSERTED', '   ')`,
        [TENANT_A, principalId],
      ),
      (err) => err.constraint === "employee_principal_links_assertion_has_author",
    );

    const ok = await establishLink(
      db(),
      linkInput({
        principalId,
        linkSource: "OPERATOR_ASSERTED",
        assertedBy: "owner@example.com",
        assertionReason: "verified against the HR record",
      }),
    );
    assert.equal(ok.assertedBy, "owner@example.com");
    assert.equal(ok.assertionReason, "verified against the HR record");
  });

  await t.test("the operating company is NOT NULL, shape-checked, and never defaulted", async () => {
    await reset();
    const principalId = await makeMember(TENANT_A, "uid-1");

    await assert.rejects(
      establishLink(db(), linkInput({ principalId, operatingCompanyId: undefined })),
      (err) =>
        err instanceof EmployeePrincipalLinkRefused &&
        err.reason === LINK_REFUSAL.OPERATING_COMPANY_NOT_STATED,
    );

    // No DEFAULT exists, so an INSERT that omits the column fails rather than claiming a company.
    await assert.rejects(
      db().query(
        `INSERT INTO eos_policy.employee_principal_links
           (id, tenant_id, principal_id, employee_id, link_source)
         VALUES ('raw-nocompany', $1, $2, 'emp-1', 'RECIPROCAL_FIREBASE_UID_LINK')`,
        [TENANT_A, principalId],
      ),
      (err) => err.code === "23502",
    );

    // A malformed company id is refused by the CHECK, not silently stored.
    await assert.rejects(
      db().query(
        `INSERT INTO eos_policy.employee_principal_links
           (id, tenant_id, principal_id, employee_id, operating_company_id, link_source)
         VALUES ('raw-badcompany', $1, $2, 'emp-1', 'Taylor Freezer', 'RECIPROCAL_FIREBASE_UID_LINK')`,
        [TENANT_A, principalId],
      ),
      (err) => err.constraint === "employee_principal_links_operating_company_shape",
    );

    // SHAPE, never membership: a company this deployment has not seeded is still well-formed, so the
    // schema accepts it and a new operating company is not a schema migration.
    const ok = await establishLink(db(), linkInput({ principalId, operatingCompanyId: "third-co" }));
    assert.equal(ok.operatingCompanyId, "third-co");
  });

  await t.test("the employee_id shape CHECK refuses a path or an untrimmed id", async () => {
    await reset();
    const principalId = await makeMember(TENANT_A, "uid-1");
    for (const bad of ["employees/emp-1", " emp-1", ""]) {
      await assert.rejects(
        db().query(
          `INSERT INTO eos_policy.employee_principal_links
             (id, tenant_id, principal_id, employee_id, operating_company_id, link_source)
           VALUES ($3, $1, $2, $4, 'taylor', 'RECIPROCAL_FIREBASE_UID_LINK')`,
          [TENANT_A, principalId, `raw-${bad.length}`, bad],
        ),
        (err) => err.constraint === "employee_principal_links_employee_id_shape",
        `employee_id ${JSON.stringify(bad)} must be refused`,
      );
    }
  });

  await t.test("migration 008 is reversible -- down drops the table, up recreates it", async () => {
    await reset();
    const principalId = await makeMember(TENANT_A, "uid-1");
    await establishLink(db(), linkInput({ principalId }));

    await peelMigrationsNewerThan("1758412800000_");
    migrate(["down"]);
    const gone = await db().query(
      "SELECT to_regclass('eos_policy.employee_principal_links') AS present",
    );
    assert.equal(gone.rows[0].present, null, "down leaves no table behind");

    migrate(["up"]);
    const back = await db().query(
      "SELECT to_regclass('eos_policy.employee_principal_links') AS present",
    );
    assert.notEqual(back.rows[0].present, null, "up recreates it");
    // A dropped table takes its rows with it: the re-created one is empty, which is why this is a
    // schema migration and not a data one.
    const rows = await db().query("SELECT count(*)::int AS n FROM eos_policy.employee_principal_links");
    assert.equal(rows.rows[0].n, 0);
  });

  await t.test("the migration adds NOTHING to principals and no employee master table", async () => {
    await reset();
    // Migration 002's header says why principals must stay provider-neutral and business-free. If a
    // later change hangs an employee_id off it, this fails and the header gets read again.
    const columns = await db().query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'eos_policy' AND table_name = 'principals' ORDER BY column_name`,
    );
    assert.deepEqual(
      columns.rows.map((r) => r.column_name),
      ["created_at", "display_name", "external_subject", "id", "identity_provider", "status", "updated_at"],
    );

    // And this migration does NOT create a Postgres Employee master -- the canonical Employee record
    // is still Firestore's `employees` collection, and a second master here would be the copy whose
    // original stays authoritative elsewhere.
    const employeeTable = await db().query("SELECT to_regclass('eos_policy.employees') AS present");
    assert.equal(employeeTable.rows[0].present, null);
  });
});

test("the migration file itself is standard PostgreSQL and touches no earlier migration", () => {
  const sql = readFileSync(MIGRATION_FILE, "utf8");
  assert.match(sql, /-- Up Migration/);
  assert.match(sql, /-- Down Migration/);
  // Additive only: it creates its own table and never alters one an earlier migration owns.
  assert.doesNotMatch(sql, /ALTER TABLE (principals|tenants|tenant_memberships|user_role_assignments)\b/);
  // No platform-specific anything, same rule as migrations 001-007.
  assert.doesNotMatch(sql, /\brender\b/i);
  assert.doesNotMatch(sql, /CREATE EXTENSION/i);
});
