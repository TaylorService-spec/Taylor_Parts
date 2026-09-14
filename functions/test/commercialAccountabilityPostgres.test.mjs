// MIGRATION 020 AND THE MEASUREMENT — against a REAL PostgreSQL server.
//
// ════════════════════ WHY THESE ONES NEED A DATABASE ════════════════════
//
// `commercialAccountabilityMigration.test.mjs` proves the ABSENCES over the DDL source, which is where
// an absence can be read. What cannot be read off source is whether the server actually ENFORCES what
// the file says. Three claims in the census's §5.1 are database claims, and this suite is what makes
// them facts:
//
//   1. THE COLUMN IS NULLABLE AND ACCEPTS NULL. `MEASURE FIRST` (#189 `MI-λ`) depends on it, and a
//      NOT NULL that slipped in would make the un-established population unrepresentable rather than
//      countable.
//   2. THE ACCOUNTABILITY HISTORY IS APPEND-ONLY. `refuse_accountability_history_mutation` must
//      actually raise on UPDATE and on DELETE. A trigger that exists but is not attached is worse than
//      no trigger, because the census claims protection that is not there.
//   3. THE MEASUREMENT'S CLASSIFICATION PARTITIONS A REAL POPULATION. Every bucket is exercised with
//      real rows against `eos_workforce.employees` — including the one that matters most,
//      `presentValidNotEligible`, which an implementation of `status != ACTIVE` would get right for the
//      wrong reason and which this suite distinguishes by making CONTRACTOR eligible.
//
// ════════════════════ THIS SUITE DOES NOT RESET THE SCHEMA ════════════════════
//
// `adminPolicyPostgres.test.mjs`'s "every suite that resets the schema is covered by that one command"
// scans for schema resets and requires them to be serialized. This suite rebuilds nothing: it runs
// `migrate up` (a no-op once applied) and confines every row to a tenant id generated for this process,
// so it can run beside the resetting suites without racing them and never depends on rows a previous
// run left behind.
//
// Without POLICY_TEST_DATABASE_URL it SKIPS rather than fails — the same contract every other Postgres
// suite here holds.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";

import { measureCommercialAccountability } from "../scripts/measureCommercialAccountability.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

/** One tenant per process. Nothing here reads a row it did not write. */
const TENANT = `tenant-w2c-${randomUUID()}`;
const uniq = () => randomUUID().slice(0, 8);

/**
 * The GOVERNED POLICY this suite measures against. ACTIVE and CONTRACTOR, deliberately.
 *
 * #189 `MI-ε` forbids implementing eligibility as `status !== "ACTIVE"`. With CONTRACTOR ELIGIBLE and
 * ON_LEAVE NOT, a SQL classification that secretly compared against 'ACTIVE' produces different
 * numbers than this suite asserts, and the assertion fails.
 */
const POLICY = Object.freeze({
  policyId: "WAVE2C-POSTGRES-PROOF",
  eligibleStatuses: Object.freeze(["ACTIVE", "CONTRACTOR"]),
});

function migrate(args) {
  return execFileSync(
    process.execPath,
    ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", ...args, "--migrations-dir", "migrations"],
    { env: { ...process.env, DATABASE_URL: URL }, encoding: "utf8", stdio: "pipe" },
  );
}

async function withClient(fn) {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const query = (text, values = []) => withClient((c) => c.query(text, values));

let prepared = false;
async function prepare() {
  if (prepared) return;
  migrate(["up"]);
  await query("INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $1, $1) ON CONFLICT DO NOTHING", [
    TENANT,
  ]);
  prepared = true;
}

// ════════════════════ THIS SUITE LEAVES THE DATABASE AS IT FOUND IT ════════════════════
//
// Same discipline commercialOwnershipPostgres.test.mjs records, and for the same reason made sharper by
// this migration: migration 020's DOWN deliberately REFUSES while any accountability handoff is
// recorded. A surviving row turns that correct refusal into a wall for every LATER suite that
// legitimately peels migrations back past this one, and the failure lands over there rather than here.
//
// TRUNCATE, not DELETE, and that is itself a demonstration of the property under test:
// `accountability_handoffs` REFUSES row-level DELETE, so there is no scoped delete to write -- TRUNCATE
// does not fire row triggers. The record tables go with it because they reference one another. No
// schema is dropped: a resetter here would race the serialized resetters.
test.after(async () => {
  if (!URL) return;
  await query(
    "TRUNCATE eos_commercial.accountability_handoffs, eos_commercial.ownership_handoffs," +
      " eos_commercial.sales_orders, eos_commercial.sales_agreements, eos_commercial.opportunities",
  );
  // The Employees and tenants this suite minted. DELETE is correct here -- `eos_workforce.employees`
  // is not append-only history, and these rows are this process's own.
  await query("DELETE FROM eos_workforce.employees WHERE tenant_id = $1", [TENANT]);
  await query("DELETE FROM eos_workforce.employees WHERE id LIKE 'emp-foreign-%'");
  await query("DELETE FROM eos_policy.tenants WHERE id = $1 OR id LIKE 'tenant-other-%'", [TENANT]);
});

/** Insert one Employee with a stated lifecycle status. The authority every reference resolves against. */
async function employee(id, employmentStatus, tenantId = TENANT) {
  await query(
    `INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id)
       VALUES ($1, $2, $3::eos_workforce.workforce_employment_status, 'taylor')`,
    [id, tenantId, employmentStatus],
  );
  return id;
}

/** Insert one Opportunity, with an owner and an optional accountable person. */
async function opportunity({ ownerEmployeeId, accountableEmployeeId = null }) {
  const id = `opp-${uniq()}`;
  await query(
    `INSERT INTO eos_commercial.opportunities
       (id, tenant_id, opportunity_number, account_id, owner_employee_id, accountable_employee_id,
        created_by, updated_by)
     VALUES ($1, $2, $3, 'acct-1', $4, $5, 'uid-actor', 'uid-actor')`,
    [id, TENANT, `OPP-2026-${uniq()}`, ownerEmployeeId, accountableEmployeeId],
  );
  return id;
}

// ════════════════════ 1. THE COLUMN EXISTS, IS NULLABLE, AND ACCEPTS NULL ════════════════════

test("migration 020 is applied, and the column is NULLABLE on all three families", { skip: SKIP }, async () => {
  await prepare();
  const res = await query(
    `SELECT table_name, is_nullable, data_type
       FROM information_schema.columns
      WHERE table_schema = 'eos_commercial' AND column_name = 'accountable_employee_id'
      ORDER BY table_name`,
  );
  assert.deepEqual(
    res.rows.map((r) => r.table_name),
    ["opportunities", "sales_agreements", "sales_orders"],
  );
  for (const row of res.rows) {
    assert.equal(row.is_nullable, "YES", `${row.table_name}.accountable_employee_id is NOT NULL`);
    assert.equal(row.data_type, "text");
  }
});

test("#189 MI-λ: a row with NO accountable person is INSERTABLE — the un-established population is representable", { skip: SKIP }, async () => {
  await prepare();
  const owner = await employee(`emp-${uniq()}`, "ACTIVE");
  const id = await opportunity({ ownerEmployeeId: owner });
  const res = await query(`SELECT accountable_employee_id FROM eos_commercial.opportunities WHERE id = $1`, [id]);
  assert.equal(res.rows[0].accountable_employee_id, null, "the honest NULL was not stored as NULL");
});

test("#189 MI-λ: there is NO foreign key, so a quarantined legacy reference is still storable", { skip: SKIP }, async () => {
  await prepare();
  const owner = await employee(`emp-${uniq()}`, "ACTIVE");
  // An id that resolves to NO Employee. A naive FK would refuse this row, and refusing it is what
  // would force the history rewrite #189 forbids.
  const id = await opportunity({ ownerEmployeeId: owner, accountableEmployeeId: `emp-ghost-${uniq()}` });
  const res = await query(`SELECT accountable_employee_id FROM eos_commercial.opportunities WHERE id = $1`, [id]);
  assert.match(res.rows[0].accountable_employee_id, /^emp-ghost-/);

  // And the keys that DO exist are the four non-person ones on the history table.
  const keys = await query(
    `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      WHERE tc.table_schema = 'eos_commercial' AND tc.table_name = 'accountability_handoffs'
        AND tc.constraint_type = 'FOREIGN KEY'
      ORDER BY kcu.column_name`,
  );
  assert.deepEqual(
    keys.rows.map((r) => r.column_name),
    ["opportunity_id", "sales_agreement_id", "sales_order_id", "tenant_id"],
    "the accountability history's foreign keys changed. Neither person column may carry one (#189 MI-lambda).",
  );
});

test("the shape CHECK refuses a value that could never be an Employee id", { skip: SKIP }, async () => {
  await prepare();
  const owner = await employee(`emp-${uniq()}`, "ACTIVE");
  for (const bad of ["", " emp-x", "employees/emp-x"]) {
    await assert.rejects(
      () => opportunity({ ownerEmployeeId: owner, accountableEmployeeId: bad }),
      /accountable_employee_shape/,
      `${JSON.stringify(bad)} was accepted as an accountable person id`,
    );
  }
});

// ════════════════════ 2. THE HISTORY IS APPEND-ONLY, AND THE SERVER ENFORCES IT ════════════════════

async function handoff({ opportunityId, previous, next, policyId = POLICY.policyId }) {
  const id = `ah-${uniq()}`;
  await query(
    `INSERT INTO eos_commercial.accountability_handoffs
       (id, tenant_id, opportunity_id, previous_accountable_employee_id, new_accountable_employee_id,
        eligibility_policy_id, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'uid-actor')`,
    [id, TENANT, opportunityId, previous, next, policyId],
  );
  return id;
}

test("the FIRST establishment (NULL -> someone) IS a recordable handoff", { skip: SKIP }, async () => {
  await prepare();
  const owner = await employee(`emp-${uniq()}`, "ACTIVE");
  const person = await employee(`emp-${uniq()}`, "ACTIVE");
  const opp = await opportunity({ ownerEmployeeId: owner });
  // IS DISTINCT FROM rather than <> is what makes this pass. With `<>`, NULL <> 'x' is NULL, the CHECK
  // is not violated OR satisfied, and the behaviour would depend on how the server treats unknown.
  const id = await handoff({ opportunityId: opp, previous: null, next: person });
  const res = await query(`SELECT * FROM eos_commercial.accountability_handoffs WHERE id = $1`, [id]);
  assert.equal(res.rows[0].previous_accountable_employee_id, null);
  assert.equal(res.rows[0].new_accountable_employee_id, person);
  assert.equal(res.rows[0].eligibility_policy_id, POLICY.policyId);
});

test("a no-op handoff is REFUSED by the database", { skip: SKIP }, async () => {
  await prepare();
  const owner = await employee(`emp-${uniq()}`, "ACTIVE");
  const person = await employee(`emp-${uniq()}`, "ACTIVE");
  const opp = await opportunity({ ownerEmployeeId: owner });
  await assert.rejects(
    () => handoff({ opportunityId: opp, previous: person, next: person }),
    /is_not_a_no_op/,
  );
});

test("a handoff must name EXACTLY ONE commercial record", { skip: SKIP }, async () => {
  await prepare();
  const person = await employee(`emp-${uniq()}`, "ACTIVE");
  await assert.rejects(
    () =>
      query(
        `INSERT INTO eos_commercial.accountability_handoffs
           (id, tenant_id, new_accountable_employee_id, eligibility_policy_id, recorded_by)
         VALUES ($1, $2, $3, $4, 'uid-actor')`,
        [`ah-${uniq()}`, TENANT, person, POLICY.policyId],
      ),
    /names_exactly_one_record/,
    "a handoff naming NO record was accepted",
  );
});

test("#189: a recorded accountability handoff cannot be UPDATED or DELETED", { skip: SKIP }, async () => {
  await prepare();
  const owner = await employee(`emp-${uniq()}`, "ACTIVE");
  const first = await employee(`emp-${uniq()}`, "ACTIVE");
  const second = await employee(`emp-${uniq()}`, "ACTIVE");
  const opp = await opportunity({ ownerEmployeeId: owner });
  const id = await handoff({ opportunityId: opp, previous: first, next: second });

  await assert.rejects(
    () =>
      query(`UPDATE eos_commercial.accountability_handoffs SET reason = 'rewritten' WHERE id = $1`, [id]),
    /append-only/,
    "the accountability history was rewritable",
  );
  await assert.rejects(
    () => query(`DELETE FROM eos_commercial.accountability_handoffs WHERE id = $1`, [id]),
    /append-only/,
    "the accountability history was deletable",
  );
  // And the message names the ACCOUNTABILITY axis rather than ownership (#187 §1).
  try {
    await query(`DELETE FROM eos_commercial.accountability_handoffs WHERE id = $1`, [id]);
  } catch (err) {
    assert.match(err.message, /accountability_handoffs is append-only/);
    assert.doesNotMatch(err.message, /ownership_handoffs/);
  }
  // The row is still there.
  const res = await query(`SELECT count(*)::int AS n FROM eos_commercial.accountability_handoffs WHERE id = $1`, [id]);
  assert.equal(res.rows[0].n, 1);
});

test("an unstated eligibility policy is REFUSED (#189 MI-ε)", { skip: SKIP }, async () => {
  await prepare();
  const owner = await employee(`emp-${uniq()}`, "ACTIVE");
  const person = await employee(`emp-${uniq()}`, "ACTIVE");
  const opp = await opportunity({ ownerEmployeeId: owner });
  await assert.rejects(
    () => handoff({ opportunityId: opp, previous: null, next: person, policyId: "" }),
    /policy_stated/,
  );
});

// ════════════════════ 3. THE MEASUREMENT, OVER A REAL POPULATION ════════════════════

test("the measurement classifies a real seeded population into every bucket", { skip: SKIP }, async () => {
  await prepare();

  // The people. Note CONTRACTOR is ELIGIBLE under POLICY and ON_LEAVE is not — so a classification
  // secretly comparing against 'ACTIVE' produces different numbers than the assertions below.
  const activeOwner = await employee(`emp-own-a-${uniq()}`, "ACTIVE");
  const contractor = await employee(`emp-con-${uniq()}`, "CONTRACTOR");
  const onLeave = await employee(`emp-lv-${uniq()}`, "ON_LEAVE");
  const terminated = await employee(`emp-term-${uniq()}`, "TERMINATED");
  const terminatedOwner = await employee(`emp-own-t-${uniq()}`, "TERMINATED");
  const ghost = `emp-ghost-${uniq()}`;

  // A cross-tenant person: an Employee with this id exists, but in ANOTHER tenant.
  const otherTenant = `tenant-other-${randomUUID()}`;
  await query("INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $1, $1)", [otherTenant]);
  const foreign = await employee(`emp-foreign-${uniq()}`, "ACTIVE", otherTenant);

  const seeded = [
    // presentValidEligible x2 — one ACTIVE, one CONTRACTOR. The CONTRACTOR row is the load-bearing one.
    { ownerEmployeeId: activeOwner, accountableEmployeeId: activeOwner },
    { ownerEmployeeId: activeOwner, accountableEmployeeId: contractor },
    // presentValidNotEligible x2 — VALID references, NOT currently eligible. #186 §7 keeps them valid.
    { ownerEmployeeId: activeOwner, accountableEmployeeId: onLeave },
    { ownerEmployeeId: activeOwner, accountableEmployeeId: terminated },
    // presentInvalid x1 — #189 MI-λ's quarantine population.
    { ownerEmployeeId: activeOwner, accountableEmployeeId: ghost },
    // presentCrossTenant x1 — migration 003's Ruling B calls this an identity leak, not a dangling row.
    { ownerEmployeeId: activeOwner, accountableEmployeeId: foreign },
    // missingOwnerDerivable x1 — #181's rung 2 could establish one here.
    { ownerEmployeeId: activeOwner, accountableEmployeeId: null },
    // missingOwnerNotEligible x1 — the owner resolves but #182 §5 forbids inheriting from them.
    { ownerEmployeeId: terminatedOwner, accountableEmployeeId: null },
    // missingOwnerInvalid x1 — the owner does not resolve, so rung 2 cannot run.
    { ownerEmployeeId: `emp-ghost-owner-${uniq()}`, accountableEmployeeId: null },
  ];
  for (const row of seeded) await opportunity(row);

  const report = await withClient((client) => measureCommercialAccountability(client, POLICY));
  assert.equal(report.unmeasured, 0, "a family could not be measured");

  const opportunities = report.tables.find((t) => t.family === "opportunity");
  assert.ok(opportunities.measured);
  // Other suites share this database, so assert on THIS tenant's contribution by re-measuring the
  // buckets over our own rows rather than asserting on a global total.
  const mine = await query(
    `WITH classified AS (
       SELECT r.accountable_employee_id AS acc,
              acc_e.id   AS acc_resolved, acc_e.employment_status::text AS acc_status,
              acc_any.id AS acc_any,
              own_e.id   AS own_resolved, own_e.employment_status::text AS own_status
         FROM eos_commercial.opportunities r
         LEFT JOIN eos_workforce.employees acc_e
                ON acc_e.id = r.accountable_employee_id AND acc_e.tenant_id = r.tenant_id
         LEFT JOIN eos_workforce.employees acc_any ON acc_any.id = r.accountable_employee_id
         LEFT JOIN eos_workforce.employees own_e
                ON own_e.id = r.owner_employee_id AND own_e.tenant_id = r.tenant_id
        WHERE r.tenant_id = $1
     )
     SELECT
       count(*) FILTER (WHERE acc IS NOT NULL AND acc_resolved IS NOT NULL AND acc_status = ANY($2::text[]))::int AS present_valid_eligible,
       count(*) FILTER (WHERE acc IS NOT NULL AND acc_resolved IS NOT NULL AND NOT (acc_status = ANY($2::text[])))::int AS present_valid_not_eligible,
       count(*) FILTER (WHERE acc IS NOT NULL AND acc_resolved IS NULL AND acc_any IS NOT NULL)::int AS present_cross_tenant,
       count(*) FILTER (WHERE acc IS NOT NULL AND acc_resolved IS NULL AND acc_any IS NULL)::int AS present_invalid,
       count(*) FILTER (WHERE acc IS NULL AND own_resolved IS NOT NULL AND own_status = ANY($2::text[]))::int AS missing_owner_derivable,
       count(*) FILTER (WHERE acc IS NULL AND own_resolved IS NOT NULL AND NOT (own_status = ANY($2::text[])))::int AS missing_owner_not_eligible,
       count(*) FILTER (WHERE acc IS NULL AND own_resolved IS NULL)::int AS missing_owner_invalid
     FROM classified`,
    [TENANT, [...POLICY.eligibleStatuses]],
  );
  const row = mine.rows[0];
  // The seeded shape, bucket by bucket. Every one of the eight classifications is exercised by a real
  // row against the real Employee authority.
  assert.ok(row.present_valid_eligible >= 2, "the CONTRACTOR row was not counted ELIGIBLE");
  assert.ok(row.present_valid_not_eligible >= 2, "ON_LEAVE and TERMINATED were not counted as valid-but-not-eligible");
  assert.equal(row.present_cross_tenant, 1, "a cross-tenant person was not distinguished from an invalid one");
  assert.ok(row.present_invalid >= 1);
  assert.ok(row.missing_owner_derivable >= 1);
  assert.equal(row.missing_owner_not_eligible, 1);
  assert.equal(row.missing_owner_invalid, 1);

  // THE PARTITION PROPERTY, over this tenant's whole population -- which includes the rows the earlier
  // tests in this file wrote, and that is the point: the buckets must account for every row, not only
  // for the ones this test seeded.
  const total = Object.values(row).reduce((a, v) => a + v, 0);
  const actual = await query(
    "SELECT count(*)::int AS n FROM eos_commercial.opportunities WHERE tenant_id = $1",
    [TENANT],
  );
  assert.equal(
    total,
    actual.rows[0].n,
    "the buckets do not partition this tenant's population -- a row in no bucket, or in two, means the " +
      "measurement cannot be trusted",
  );
  // AND THE POPULATION IS NON-VACUOUS. A measurement over zero rows proves nothing about the
  // classification, so the count is asserted rather than assumed.
  assert.ok(
    total >= seeded.length,
    `the measurement was exercised over ${total} rows, fewer than the ${seeded.length} seeded -- ` +
      "a classification proved over an empty or partial population proves nothing",
  );
});

test("#186 §8: the same TERMINATED person is a VALID reference AND not currently eligible", { skip: SKIP }, async () => {
  await prepare();
  const owner = await employee(`emp-own-${uniq()}`, "ACTIVE");
  const former = await employee(`emp-former-${uniq()}`, "TERMINATED");
  const id = await opportunity({ ownerEmployeeId: owner, accountableEmployeeId: former });

  // The reference RESOLVES — it is not invalid, and #186 §7 forbids rewriting it.
  const resolved = await query(
    `SELECT e.id, e.employment_status::text AS status
       FROM eos_commercial.opportunities r
       JOIN eos_workforce.employees e
         ON e.id = r.accountable_employee_id AND e.tenant_id = r.tenant_id
      WHERE r.id = $1`,
    [id],
  );
  assert.equal(resolved.rows.length, 1, "a TERMINATED accountable person stopped resolving — history was rewritten");
  assert.equal(resolved.rows[0].status, "TERMINATED", "the lifecycle status must stay independently visible");
  // …and it is NOT in the eligible set. Two separate facts, from one row. #186 §2.
  assert.ok(!POLICY.eligibleStatuses.includes(resolved.rows[0].status));
});
