// ACTIVATION BLOCKER #1 against a real postgres:16 -- the governed PostgreSQL accountability audit authority.
//
// An accountable-person change and its append-only history row are written in ONE transaction, the history row
// says whether it was an ESTABLISHMENT or a HANDOFF and how the person was established, and a failure of the
// history write refuses the mutation. Migration 021 is also proved SAFE over history rows that predate it.
//
// Its OWN database, so exact counts are facts about rows this file wrote.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const repo = require("../lib/eosCommercial/commercialAccountabilityRepository.js");
const { createCommercialRecord } = require("../lib/eosCommercial/commercialOwnershipRepository.js");
const { createPostgresEmployeeAuthority } = require("../lib/employeeIdentity/postgresEmployeeAuthority.js");
const { decideAccountabilityEligibility } = require("../lib/employeeIdentity/employeeAuthority.js");
const { mintGovernedAccountablePerson } = require("../lib/responsibility/accountablePersonStorage.js");
const { establishCreationAccountablePerson } = require("../lib/responsibility/accountablePersonEstablishment.js");

const V1 = Object.freeze({ policyId: "COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1", eligibleStatuses: Object.freeze(["ACTIVE", "CONTRACTOR"]) });
const DB_NAME = `acc_history_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => {
  const u = new URL(URL_BASE);
  u.pathname = `/${DB_NAME}`;
  return u.toString();
};
const migrate = (...args) =>
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", ...args, "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR,
    env: { ...process.env, DATABASE_URL: dbUrl() },
    stdio: "pipe",
  });

async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

test("governed PostgreSQL accountability audit authority, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));

  // Stop at migration 020 so history can exist BEFORE 021 arrives.
  migrate("20");
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 4 });
  // One hook, in order: close the pool, THEN drop the database it was connected to.
  t.after(async () => {
    await pool.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  const q = (text, values = []) => pool.query(text, values);

  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES
    ('e-owner','t1','ACTIVE','taylor'), ('e-a','t1','ACTIVE','taylor'), ('e-b','t1','CONTRACTOR','taylor'),
    ('e-leave','t1','ON_LEAVE','taylor'), ('e-t2','t2','ACTIVE','taylor')`);
  const opportunity = (id, number, accountable = null) =>
    q(`INSERT INTO eos_commercial.opportunities (id, tenant_id, opportunity_number, account_id, owner_employee_id, accountable_employee_id, created_by, updated_by)
       VALUES ($1,'t1',$2,'acct','e-owner',$3,'seed','seed')`, [id, number, accountable]);
  await opportunity("o-legacy-1", "OPP-L1");
  await opportunity("o-legacy-2", "OPP-L2");
  // History written before 021: one establishment-shaped, one handoff-shaped. No provenance was recorded then.
  await q(`INSERT INTO eos_commercial.accountability_handoffs (id, tenant_id, opportunity_id, previous_accountable_employee_id, new_accountable_employee_id, eligibility_policy_id, recorded_by)
    VALUES ('legacy-est','t1','o-legacy-1',NULL,'e-a','LEGACY','legacy'), ('legacy-hof','t1','o-legacy-2','e-a','e-b','LEGACY','legacy')`);

  await t.test("MIGRATION SAFETY: 021 applies over existing history, rewrites nothing and invents no provenance", async () => {
    migrate("1"); // exactly migration 021 -- later migrations (022 adds the Account key) are not what this proves
    const rows = (await q(`SELECT id, action, source, previous_accountable_employee_id, new_accountable_employee_id FROM eos_commercial.accountability_handoffs ORDER BY id`)).rows;
    assert.deepEqual(rows, [
      { id: "legacy-est", action: "ESTABLISHMENT", source: null, previous_accountable_employee_id: null, new_accountable_employee_id: "e-a" },
      { id: "legacy-hof", action: "HANDOFF", source: null, previous_accountable_employee_id: "e-a", new_accountable_employee_id: "e-b" },
    ]);
    await assert.rejects(q(`UPDATE eos_commercial.accountability_handoffs SET reason = 'x' WHERE id = 'legacy-est'`), /append-only/);
    const applied = (await q(`SELECT name FROM public.pgmigrations ORDER BY run_on, id`)).rows.map((r) => r.name);
    assert.equal(applied.at(-1), "1759363200000_accountability-history-action-and-source");
    assert.ok(!applied.some((n) => n.includes("employee-principal-link-employee-fk")), "(17) the deferred Employee FK ran");
  });

  await t.test("the database enforces the history contract for every NEW row", async () => {
    const insert = (id, previous, source) =>
      q(`INSERT INTO eos_commercial.accountability_handoffs (id, tenant_id, opportunity_id, previous_accountable_employee_id, new_accountable_employee_id, eligibility_policy_id, recorded_by, source)
         VALUES ($1,'t1','o-legacy-1',$2,'e-b','P','x',$3)`, [id, previous, source]);
    await assert.rejects(insert("no-source", null, null), /accountability_handoff_source_recorded/);
    await assert.rejects(insert("derived-handoff", "e-a", "DERIVED_FROM_RECORD_OWNER"), /accountability_handoff_is_explicit/);
    await assert.rejects(q(`INSERT INTO eos_commercial.accountability_handoffs (id, tenant_id, opportunity_id, new_accountable_employee_id, eligibility_policy_id, recorded_by, source, action)
      VALUES ('forced-action','t1','o-legacy-1','e-b','P','x','EXPLICIT','HANDOFF')`), /generated column|cannot insert/i);
  });

  const authority = createPostgresEmployeeAuthority(pool);
  const explicit = async (employeeId, tenantId = "t1") => {
    const r = await authority.resolveEmployeeReference({ tenantId, employeeId });
    assert.equal(r.outcome, "RESOLVED", `${employeeId} did not resolve`);
    return mintGovernedAccountablePerson(r.employee, decideAccountabilityEligibility(r.employee, V1), "EXPLICIT");
  };
  const historyCount = async () => (await q(`SELECT count(*)::int AS n FROM eos_commercial.accountability_handoffs`)).rows[0].n;
  const accountableOf = async (id) => (await q(`SELECT accountable_employee_id AS a, owner_employee_id AS o FROM eos_commercial.opportunities WHERE id = $1`, [id])).rows[0];

  let createdId;
  await t.test("(1) ESTABLISHMENT at creation: record, establishment and history commit in ONE transaction", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const person = await establishCreationAccountablePerson({ employeeAuthority: createPostgresEmployeeAuthority(client) }, {
        tenantId: "t1", family: "opportunity", currentRecordOwnerEmployeeId: "e-owner", eligibilityPolicy: V1,
      });
      const record = await createCommercialRecord(client, "t1", "actor-create", {
        kind: "OPPORTUNITY", recordNumber: "OPP-NEW", accountId: "acct", ownerEmployeeId: "e-owner", createdBy: "actor-create",
      });
      createdId = record.id;
      const h = await repo.stageCommercialAccountablePersonChange(client, "t1", "actor-create", "ESTABLISHMENT", {
        family: "opportunity", recordId: record.id, accountablePerson: person, reason: "created",
      });
      await client.query("COMMIT");
      assert.equal(h.action, "ESTABLISHMENT");
      assert.equal(h.source, "DERIVED_FROM_RECORD_OWNER");
      assert.equal(h.previousAccountableEmployeeId, null);
      assert.equal(h.newAccountableEmployeeId, "e-owner");
    } finally {
      client.release();
    }
    assert.equal((await accountableOf(createdId)).a, "e-owner");
  });

  let established;
  await t.test("(2)(4)(5)(6)(7)(8) an EXISTING record with no accountable person receives an ESTABLISHMENT", async () => {
    await opportunity("o-existing", "OPP-EX");
    const before = new Date();
    established = await repo.establishCommercialAccountablePerson(pool, "t1", "actor-1", {
      family: "opportunity", recordId: "o-existing", accountablePerson: await explicit("e-a"), reason: "first governed accountable person",
    });
    assert.equal(established.action, "ESTABLISHMENT", "a first assignment on an existing record is NOT a handoff");
    assert.equal(established.source, "EXPLICIT");
    assert.equal(established.previousAccountableEmployeeId, null);
    assert.equal(established.newAccountableEmployeeId, "e-a");
    assert.equal(established.eligibilityPolicyId, V1.policyId);
    assert.equal(established.recordedBy, "actor-1");
    assert.equal(established.reason, "first governed accountable person");
    assert.equal(established.tenantId, "t1");
    assert.equal(established.family, "opportunity");
    assert.equal(established.recordId, "o-existing");
    assert.ok(established.effectiveAt instanceof Date && established.recordedAt instanceof Date);
    assert.ok(established.recordedAt.getTime() >= before.getTime() - 5000);
    assert.equal((await accountableOf("o-existing")).a, "e-a");
  });

  await t.test("(3)(4)(5)(6)(9) HANDOFF from A to B: column and history move together, ownership untouched", async () => {
    const ownershipBefore = (await q(`SELECT count(*)::int AS n FROM eos_commercial.ownership_handoffs`)).rows[0].n;
    const h = await repo.handOffCommercialAccountablePerson(pool, "t1", "actor-2", {
      family: "opportunity", recordId: "o-existing", accountablePerson: await explicit("e-b"), reason: "coverage change",
      expectedPreviousAccountableEmployeeId: "e-a",
    });
    assert.deepEqual(
      [h.action, h.source, h.previousAccountableEmployeeId, h.newAccountableEmployeeId, h.eligibilityPolicyId, h.recordedBy, h.reason],
      ["HANDOFF", "EXPLICIT", "e-a", "e-b", V1.policyId, "actor-2", "coverage change"],
    );
    const row = await accountableOf("o-existing");
    assert.deepEqual(row, { a: "e-b", o: "e-owner" }, "(6) the owner moved with the accountable person");
    assert.equal((await q(`SELECT count(*)::int AS n FROM eos_commercial.ownership_handoffs`)).rows[0].n, ownershipBefore, "an accountability change wrote ownership history");
    const stored = (await q(`SELECT action, source::text, previous_accountable_employee_id AS p, new_accountable_employee_id AS n FROM eos_commercial.accountability_handoffs WHERE opportunity_id = 'o-existing' ORDER BY recorded_at, id`)).rows;
    assert.deepEqual(stored, [
      { action: "ESTABLISHMENT", source: "EXPLICIT", p: null, n: "e-a" },
      { action: "HANDOFF", source: "EXPLICIT", p: "e-a", n: "e-b" },
    ]);
  });

  await t.test("(10) a history write that FAILS rolls back the accountable person -- and a record created with it", async () => {
    await q(`CREATE FUNCTION pg_temp_fail_history() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced history failure'; END $$ LANGUAGE plpgsql`);
    await q(`CREATE TRIGGER force_history_failure BEFORE INSERT ON eos_commercial.accountability_handoffs FOR EACH ROW EXECUTE FUNCTION pg_temp_fail_history()`);
    try {
      const count = await historyCount();
      await assert.rejects(
        repo.handOffCommercialAccountablePerson(pool, "t1", "actor-3", { family: "opportunity", recordId: "o-existing", accountablePerson: await explicit("e-a") }),
        /forced history failure/,
      );
      assert.equal((await accountableOf("o-existing")).a, "e-b", "the accountable person changed although its history was not written");
      assert.equal(await historyCount(), count);

      // Composed with record creation in the caller's transaction: the whole unit is refused.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const record = await createCommercialRecord(client, "t1", "actor-3", { kind: "OPPORTUNITY", recordNumber: "OPP-DOOMED", accountId: "acct", ownerEmployeeId: "e-owner", createdBy: "actor-3" });
        await assert.rejects(repo.stageCommercialAccountablePersonChange(client, "t1", "actor-3", "ESTABLISHMENT", { family: "opportunity", recordId: record.id, accountablePerson: await explicit("e-a") }), /forced history failure/);
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
      assert.equal((await q(`SELECT count(*)::int AS n FROM eos_commercial.opportunities WHERE opportunity_number = 'OPP-DOOMED'`)).rows[0].n, 0);
    } finally {
      await q(`DROP TRIGGER force_history_failure ON eos_commercial.accountability_handoffs`);
      await q(`DROP FUNCTION pg_temp_fail_history()`);
    }
  });

  await t.test("(11) invalid, ineligible, cross-tenant, forged and mislabelled changes refuse BEFORE any mutation", async () => {
    await opportunity("o-empty", "OPP-EMPTY");
    const snapshot = async () => [await historyCount(), (await accountableOf("o-existing")).a, (await accountableOf("o-empty")).a];
    const before = await snapshot();

    // Invalid and ineligible never become a minted value, so there is nothing for the writer to persist.
    await assert.rejects(establishCreationAccountablePerson({ employeeAuthority: authority }, { tenantId: "t1", family: "opportunity", explicitAccountableEmployeeId: "e-nobody", eligibilityPolicy: V1 }), (e) => e.code === "EXPLICIT_PERSON_INVALID");
    await assert.rejects(establishCreationAccountablePerson({ employeeAuthority: authority }, { tenantId: "t1", family: "opportunity", explicitAccountableEmployeeId: "e-leave", eligibilityPolicy: V1 }), (e) => e.code === "EXPLICIT_PERSON_NOT_CURRENTLY_ELIGIBLE");
    await assert.rejects(establishCreationAccountablePerson({ employeeAuthority: authority }, { tenantId: "t1", family: "opportunity", explicitAccountableEmployeeId: "e-t2", eligibilityPolicy: V1 }), (e) => e.code === "EXPLICIT_PERSON_INVALID", "an Employee of another tenant resolved");

    const code = (c) => (e) => e.code === c;
    await assert.rejects(repo.establishCommercialAccountablePerson(pool, "t1", "x", { family: "opportunity", recordId: "o-empty", accountablePerson: await explicit("e-t2", "t2") }), code("ACCOUNTABLE_PERSON_OTHER_TENANT"));
    await assert.rejects(repo.establishCommercialAccountablePerson(pool, "t1", "x", { family: "opportunity", recordId: "o-empty", accountablePerson: { accountableEmployeeId: "e-a", tenantId: "t1", source: "EXPLICIT", eligibilityPolicyId: V1.policyId, employmentStatus: "ACTIVE" } }), code("ACCOUNTABLE_PERSON_NOT_GOVERNED"));
    await assert.rejects(repo.establishCommercialAccountablePerson(pool, "t1", "x", { family: "opportunity", recordId: "o-existing", accountablePerson: await explicit("e-a") }), code("ALREADY_ESTABLISHED"));
    await assert.rejects(repo.handOffCommercialAccountablePerson(pool, "t1", "x", { family: "opportunity", recordId: "o-empty", accountablePerson: await explicit("e-a") }), code("NOTHING_TO_HAND_OFF"));
    await assert.rejects(repo.handOffCommercialAccountablePerson(pool, "t1", "x", { family: "opportunity", recordId: "o-existing", accountablePerson: await explicit("e-b") }), code("HANDOFF_IS_NO_OP"));
    await assert.rejects(repo.handOffCommercialAccountablePerson(pool, "t1", "x", { family: "opportunity", recordId: "o-existing", accountablePerson: await explicit("e-a"), expectedPreviousAccountableEmployeeId: "e-a" }), code("PRECONDITION_FAILED"));
    const derived = await establishCreationAccountablePerson({ employeeAuthority: authority }, { tenantId: "t1", family: "opportunity", currentRecordOwnerEmployeeId: "e-a", eligibilityPolicy: V1 });
    await assert.rejects(repo.handOffCommercialAccountablePerson(pool, "t1", "x", { family: "opportunity", recordId: "o-existing", accountablePerson: derived }), code("HANDOFF_SOURCE_NOT_EXPLICIT"));
    await assert.rejects(repo.establishCommercialAccountablePerson(pool, "t1", "x", { family: "opportunity", recordId: "o-missing", accountablePerson: await explicit("e-a") }), code("RECORD_NOT_FOUND"));
    await assert.rejects(repo.establishCommercialAccountablePerson(pool, "t1", "x", { family: "account", recordId: "o-empty", accountablePerson: await explicit("e-a") }), code("FAMILY_NOT_ACCOUNTABLE"));
    await assert.rejects(repo.establishCommercialAccountablePerson(pool, "t2", "x", { family: "opportunity", recordId: "o-empty", accountablePerson: await explicit("e-a") }), code("ACCOUNTABLE_PERSON_OTHER_TENANT"));

    assert.deepEqual(await snapshot(), before, "a refused change mutated a record or wrote history");
  });

  await t.test("(12) the recorded history is append-only", async () => {
    await assert.rejects(q(`UPDATE eos_commercial.accountability_handoffs SET new_accountable_employee_id = 'e-owner' WHERE id = $1`, [established.id]), /append-only/);
    await assert.rejects(q(`DELETE FROM eos_commercial.accountability_handoffs WHERE id = $1`, [established.id]), /append-only/);
  });

  await t.test("(17) no foreign key onto the Employee authority was introduced", async () => {
    const fks = (await q(`SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f' AND confrelid = 'eos_workforce.employees'::regclass`)).rows[0].n;
    assert.equal(fks, 0);
  });
});
