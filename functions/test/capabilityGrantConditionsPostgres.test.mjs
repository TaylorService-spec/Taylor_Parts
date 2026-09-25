// THE CONDITION BELONGS TO ONE GRANT -- migration 1762214400000, proved against a real PostgreSQL.
//
// ════════════════════ WHAT THIS FILE IS, AND WHAT IT IS NOT ════════════════════
//
// Lane AB designed `eos_policy.capability_grant_conditions` and left the migration slot to the lane
// that owns migrations. This lane wrote that migration, carrying Lane AB's
// PROPOSED_GRANT_CONDITION_SCHEMA character for character.
//
// LANE AB's EVALUATOR IS NOT IN THIS LINEAGE. Its commit d48b55a3 imports
// `WITHHELD_CONDITIONED_CELLS` and `ContextualActionOutcome` from
// `src/eosOps/contextualActionAuthority.ts`, a module introduced by its OWN BASE 7d1dc5e5 -- a
// different lane's unmerged work, absent from this branch and from main. Cherry-picking d48b55a3
// here produces source that does not compile, and stubbing that module would mean INVENTING
// `WITHHELD_CONDITIONED_CELLS`, the very constant that holds the two Technician Purchase Order
// cells withheld. So this file proves what can honestly be proved from this lineage:
//
//   1. the migrated RELATION is exactly the designed one, and holds ZERO rows;
//   2. neither GRANT TABLE gained a condition or scope column -- the separation is the point;
//   3. the relation can CARRY the sentence "Role A holds X unconditionally, Role B holds the SAME X
//      only when WORK_ELIGIBILITY(PARTS_OPERATIONS) holds", read back out of SQL;
//   4. deciding over those stored facts is a UNION -- any applicable path that succeeds allows --
//      and an UNCONDITIONAL path invokes the contextual reader ZERO times. The predicate half of
//      that decision is `contextualAuthorization.authorizeAnyPath`, which IS in this lineage and is
//      the same evaluator the conditioned path will use;
//   5. the DOWN refuses while rows exist rather than widening every conditioned grant back to
//      unconditional.
//
// NOTHING IS ACTIVATED. The migration inserts no row. The condition rows below are written into a
// THROWAWAY database only, onto grants migration 1761696000000 genuinely writes -- purchasingManager
// and warehouseAssociate, both real holders of reorder.purchaseOrder.read. The WITHHELD Technician
// Purchase Order cells are not granted, not conditioned and not named as data anywhere here.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const evaluator = require("../lib/eosOps/contextualAuthorization.js");

const MIGRATION_FILE = "1762214400000_capability-grant-conditions.sql";
const MIGRATION_SQL = readFileSync(resolve(FUNCTIONS_DIR, `migrations/${MIGRATION_FILE}`), "utf8");
const UP = MIGRATION_SQL.split("-- Down Migration")[0];
const DOWN = MIGRATION_SQL.split("-- Down Migration")[1];
const stripComments = (s) => s.replace(/^\s*--.*$/gm, "");

/**
 * `PROPOSED_GRANT_CONDITION_SCHEMA`, copied VERBATIM out of Lane AB's commit d48b55a3
 * (functions/src/eosOps/conditionalEntitlement.ts). The migration must carry this exact text: the
 * reader Lane AB wrote was written against it, and a migration carrying a paraphrase would mean the
 * relation the code opens and the relation the database holds were never the same object.
 */
const LANE_AB_SCHEMA = `CREATE TABLE eos_policy.capability_grant_conditions (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    grant_scope     TEXT NOT NULL CHECK (grant_scope IN ('ROLE','PRINCIPAL')),
    grantor_key     TEXT NOT NULL,
    capability_key  TEXT NOT NULL REFERENCES eos_policy.capabilities(key),
    condition       JSONB NOT NULL,
    status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETIRED')),
    established_by  TEXT NOT NULL,
    established_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      TEXT NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, grant_scope, grantor_key, capability_key)
);
CREATE INDEX capability_grant_conditions_by_capability
    ON eos_policy.capability_grant_conditions (tenant_id, capability_key);`;

const PO_READ = "reorder.purchaseOrder.read";
const TENANT = "t-lane-ae";
const COMPANY_KEY = "sample-co-synthetic";
const ELIGIBILITY = (qualificationCode) => ({ kind: "WORK_ELIGIBILITY", qualificationCode });

// The grant rows are PARSED out of the migration that writes them, never copied: a test that
// restates a grant list is a second source of truth for who holds what.
const GRANT_SQL = readFileSync(resolve(FUNCTIONS_DIR,
  "migrations/1761696000000_parts-associate-eligibility-and-reorder-queue-scope.sql"), "utf8");
const MIGRATION_GRANTS = [...GRANT_SQL.matchAll(/\('([A-Za-z]+)',\s*'(reorder\.[A-Za-z.]+)'\)/g)]
  .map((m) => ({ roleKey: m[1], capabilityKey: m[2] }));
const holdersOf = (capabilityKey) =>
  MIGRATION_GRANTS.filter((g) => g.capabilityKey === capabilityKey).map((g) => g.roleKey).sort();

// ════════════════════════════════════════════════════════════════════════════════════════════════
// SOURCE LEVEL -- no database needed.
// ════════════════════════════════════════════════════════════════════════════════════════════════

test("the migration carries Lane AB's schema verbatim and activates nothing", async (t) => {
  await t.test("PROPOSED_GRANT_CONDITION_SCHEMA is reproduced character for character", () => {
    assert.ok(UP.includes(LANE_AB_SCHEMA),
      "the migration's DDL is not Lane AB's PROPOSED_GRANT_CONDITION_SCHEMA");
  });

  await t.test("STRUCTURE ONLY: the up inserts nothing, of any kind", () => {
    const code = stripComments(UP);
    assert.doesNotMatch(code, /INSERT\s+INTO/i, "a structure migration wrote a row");
    assert.doesNotMatch(code, /UPDATE\s+\w/i, "a structure migration changed a row");
    assert.doesNotMatch(code, /DELETE\s+FROM/i, "a structure migration deleted a row");
    // Non-vacuous: the DDL really is here.
    assert.match(code, /CREATE TABLE eos_policy\.capability_grant_conditions/);
  });

  await t.test("the two grant tables are not touched -- the separation IS the design", () => {
    const code = stripComments(UP);
    assert.doesNotMatch(code, /ALTER\s+TABLE[\s\S]{0,120}(role_capabilities|principal_capabilities)/i,
      "a condition column on a grant table would make the grant tables answer WHICH as well as WHAT");
    // And the DDL itself names neither relation.
    assert.doesNotMatch(LANE_AB_SCHEMA, /role_capabilities|principal_capabilities/);
  });

  await t.test("the DOWN refuses rather than destroying recorded policy", () => {
    assert.match(DOWN, /refuses to reverse/,
      "a down that dropped a populated table would widen every conditioned grant to unconditional");
    assert.match(DOWN, /DROP TABLE eos_policy\.capability_grant_conditions/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// AGAINST A REAL, MIGRATED POSTGRESQL.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("the conditional entitlement relation, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `laneae_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  const migrate = (...args) => execFileSync(process.execPath,
    ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", ...args, "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  migrate("up");
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 4 });
  const q = (sql, v = []) => pool.query(sql, v);

  // ════════════════════ the relation the migration actually built ════════════════════

  await t.test("the relation exists, with the designed columns, keys and index", async () => {
    const { rows: present } = await q(
      `SELECT to_regclass('eos_policy.capability_grant_conditions') IS NOT NULL AS present`);
    assert.equal(present[0].present, true, "migration 1762214400000 did not create the relation");

    const { rows: cols } = await q(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema='eos_policy' AND table_name='capability_grant_conditions'
        ORDER BY ordinal_position`);
    assert.deepEqual(cols.map((c) => [c.column_name, c.data_type, c.is_nullable]), [
      ["id", "text", "NO"],
      ["tenant_id", "text", "NO"],
      ["grant_scope", "text", "NO"],
      ["grantor_key", "text", "NO"],
      ["capability_key", "text", "NO"],
      ["condition", "jsonb", "NO"],
      ["status", "text", "NO"],
      ["established_by", "text", "NO"],
      ["established_at", "timestamp with time zone", "NO"],
      ["updated_by", "text", "NO"],
      ["updated_at", "timestamp with time zone", "NO"],
    ]);
    // `condition` NOT NULL is load-bearing: a NULL condition would be an unconditional grant
    // wearing a conditioned row's clothes.
    assert.equal(cols.find((c) => c.column_name === "condition").is_nullable, "NO");
    assert.equal(cols.find((c) => c.column_name === "status").column_default, "'ACTIVE'::text");

    const { rows: cons } = await q(
      `SELECT contype, pg_get_constraintdef(oid) AS def
         FROM pg_constraint WHERE conrelid='eos_policy.capability_grant_conditions'::regclass
        ORDER BY contype, def`);
    const defs = cons.map((c) => c.def);
    assert.ok(defs.includes("PRIMARY KEY (id)"), defs.join(" | "));
    assert.ok(defs.includes("UNIQUE (tenant_id, grant_scope, grantor_key, capability_key)"),
      "ONE grant cell, ONE condition -- without this, 'what narrows this grant' is unanswerable");
    assert.ok(defs.includes("FOREIGN KEY (tenant_id) REFERENCES eos_policy.tenants(id)"), defs.join(" | "));
    assert.ok(defs.includes("FOREIGN KEY (capability_key) REFERENCES eos_policy.capabilities(key)"),
      "a condition on a capability the governed authority does not know is unresolvable");
    assert.ok(defs.some((d) => /CHECK .*grant_scope.*'ROLE'.*'PRINCIPAL'/s.test(d)), defs.join(" | "));
    assert.ok(defs.some((d) => /CHECK .*status.*'ACTIVE'.*'RETIRED'/s.test(d)), defs.join(" | "));

    const { rows: idx } = await q(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='eos_policy' AND indexname='capability_grant_conditions_by_capability'`);
    assert.equal(idx.length, 1, "the by-capability index is missing");
    assert.match(idx[0].indexdef, /\(tenant_id, capability_key\)/);
  });

  await t.test("ZERO conditional entitlements are activated by the migration", async () => {
    const { rows } = await q(`SELECT count(*)::int n FROM eos_policy.capability_grant_conditions`);
    assert.equal(rows[0].n, 0, "the migration inserted a conditional entitlement");
  });

  await t.test("neither GRANT table gained a condition or scope column", async () => {
    const { rows: cols } = await q(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema='eos_policy'
          AND table_name IN ('role_capabilities','principal_capabilities')`);
    const forbidden = ["condition", "condition_kind", "conditions", "predicate",
      "qualification_code", "scope", "scope_type", "own_only"];
    assert.deepEqual(cols.filter((c) => forbidden.includes(c.column_name)), [],
      "the grant tables answer WHAT; this relation answers WHICH; two homes is the drift to prevent");
    assert.equal(cols.filter((c) => c.table_name === "role_capabilities").length, 10,
      "role_capabilities grew or lost a column");
  });

  // ════════════════════ the fixture: real grants, one of them conditioned ════════════════════

  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [TENANT]);
  await q(`INSERT INTO eos_policy.tenant_operating_companies
             (tenant_id,operating_company_id,status,source,established_by,updated_by)
           VALUES ($1,$2,'ACTIVE','lane-ae','fixture','fixture')`, [TENANT, COMPANY_KEY]);

  // Exactly the two Roles this proof needs, and BOTH are genuine holders of the capability in
  // migration 1761696000000. No grant is invented, and no WITHHELD cell is touched.
  const ROLE_A = "purchasingManager";   // unconditional
  const ROLE_B = "warehouseAssociate";  // conditioned, in this throwaway database only
  for (const key of [ROLE_A, ROLE_B]) {
    assert.ok(holdersOf(PO_READ).includes(key), `${key} is not a real holder of ${PO_READ}`);
    await q(`INSERT INTO eos_policy.roles (id,tenant_id,key,name,origin,created_by,updated_by)
             VALUES ($1,$2,$3,$3,'SYSTEM','fixture','fixture')`, [`role-${key}`, TENANT, key]);
    await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
             SELECT $1,$2,$3,c.id,'fixture','fixture','fixture' FROM eos_policy.capabilities c WHERE c.key=$4`,
    [`rc-${key}`.slice(0, 60), TENANT, `role-${key}`, PO_READ]);
  }

  // Two people who differ in exactly ONE fact: the PARTS_OPERATIONS eligibility.
  const PEOPLE = { "ops-eligible": ["PARTS_OPERATIONS"], "ops-plain": [] };
  const emp = (k) => `emp-${k}`;
  const prn = (k) => `prn-${k}`;
  for (const [key, eligibility] of Object.entries(PEOPLE)) {
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number)
             VALUES ($1,$2,'ACTIVE',$3,$4)`, [emp(key), TENANT, COMPANY_KEY, `E-${key}`.slice(0, 32)]);
    await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status)
             VALUES ($1,$2,'firebase','active')`, [prn(key), `uid-${key}`]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status)
             VALUES ($1,$2,$3,'active')`, [`mem-${key}`.slice(0, 60), TENANT, prn(key)]);
    await q(`INSERT INTO eos_policy.employee_principal_links
               (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
             VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED','active','fixture','lane ae fixture')`,
    [`lnk-${key}`.slice(0, 60), TENANT, prn(key), emp(key), COMPANY_KEY]);
    for (const code of eligibility) {
      await q(`INSERT INTO eos_workforce.employee_work_eligibility
                 (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by)
               VALUES ($1,$2,$3,$4,now(),'fixture')`, [`we-${key}`.slice(0, 60), TENANT, emp(key), code]);
    }
  }

  const reader = evaluator.postgresContextualReader(pool);
  const counting = () => {
    const state = { reads: 0 };
    return [state, {
      linkedEmployeeId: async (...a) => { state.reads += 1; return reader.linkedEmployeeId(...a); },
      hasWorkEligibility: async (...a) => { state.reads += 1; return reader.hasWorkEligibility(...a); },
      hasOperationalScope: async (...a) => { state.reads += 1; return reader.hasOperationalScope(...a); },
      isAssignedEmployee: async (...a) => { state.reads += 1; return reader.isAssignedEmployee(...a); },
    }];
  };

  /**
   * The ENTITLEMENTS a set of Roles reaches for one capability, read out of the two relations: the
   * grant says WHAT, and the LEFT JOIN onto the condition relation says WHICH. A grant with no
   * matching ACTIVE condition row comes back with `condition === null` -- unconditional.
   */
  const entitlementsFor = async (roleKeys, capabilityKey) => (await q(
    `SELECT r.key AS grantor_key, gc.condition
       FROM eos_policy.role_capabilities rc
       JOIN eos_policy.roles r        ON r.id = rc.role_id
       JOIN eos_policy.capabilities c ON c.id = rc.capability_id
       LEFT JOIN eos_policy.capability_grant_conditions gc
              ON gc.tenant_id = rc.tenant_id
             AND gc.grant_scope = 'ROLE'
             AND gc.grantor_key = r.key
             AND gc.capability_key = c.key
             AND gc.status = 'ACTIVE'
      WHERE rc.tenant_id = $1 AND c.key = $2 AND r.key = ANY($3)
      ORDER BY r.key`, [TENANT, capabilityKey, roleKeys])).rows;

  /**
   * THE UNION RULE, over those stored facts. Any applicable path that succeeds grants access; an
   * UNCONDITIONAL entitlement is applicable with nothing read, so it is answered FIRST and the
   * contextual reader is never invoked.
   */
  const decide = async (ctxReader, { principalId, roleKeys, capabilityKey }) => {
    const entitlements = await entitlementsFor(roleKeys, capabilityKey);
    if (entitlements.length === 0) return { allowed: false, reason: "CAPABILITY_MISSING" };
    const unconditional = entitlements.find((e) => e.condition === null);
    if (unconditional) {
      return { allowed: true, reason: "ALLOWED", viaGrantor: unconditional.grantor_key, viaCondition: false };
    }
    let first;
    for (const e of entitlements) {
      const d = await evaluator.authorizeAnyPath(ctxReader, {
        actor: { tenantId: TENANT, principalId, capabilities: new Set([capabilityKey]) },
        capabilityKey,
        paths: e.condition.paths,
      });
      if (d.allowed) return { ...d, viaGrantor: e.grantor_key, viaCondition: true };
      first ??= { ...d, viaGrantor: e.grantor_key, viaCondition: true };
    }
    return first;
  };

  // ════════════════════ AE5 -- the sentence, said through the migrated relation ════════════════════

  await t.test("AE5: one capability, two grants, a condition on exactly ONE of them", async () => {
    await q(`INSERT INTO eos_policy.capability_grant_conditions
               (id,tenant_id,grant_scope,grantor_key,capability_key,condition,established_by,updated_by)
             VALUES ('cgc-ae-1',$1,'ROLE',$2,$3,$4::jsonb,'lane-ae','lane-ae')`,
    [TENANT, ROLE_B, PO_READ, JSON.stringify({ paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] })]);

    const both = await entitlementsFor([ROLE_A, ROLE_B], PO_READ);
    assert.deepEqual(both.map((e) => [e.grantor_key, e.condition === null]),
      [[ROLE_A, true], [ROLE_B, false]],
      "the condition must attach to ONE grantor's grant and leave the sibling grant unconditional");
    assert.deepEqual(both.find((e) => e.grantor_key === ROLE_B).condition,
      { paths: [[{ kind: "WORK_ELIGIBILITY", qualificationCode: "PARTS_OPERATIONS" }]] });
  });

  await t.test("AE5: the conditioned grant binds -- eligible ALLOWED, not eligible REFUSED", async () => {
    const [eligibleState, eligibleReader] = counting();
    const allowed = await decide(eligibleReader,
      { principalId: prn("ops-eligible"), roleKeys: [ROLE_B], capabilityKey: PO_READ });
    assert.equal(allowed.allowed, true);
    assert.equal(allowed.viaCondition, true);
    assert.ok(eligibleState.reads > 0, "a conditioned path must actually consult the context authority");

    const [plainState, plainReader] = counting();
    const refused = await decide(plainReader,
      { principalId: prn("ops-plain"), roleKeys: [ROLE_B], capabilityKey: PO_READ });
    assert.equal(refused.allowed, false);
    assert.equal(refused.reason, "WORK_ELIGIBILITY_MISSING");
    assert.ok(plainState.reads > 0);
  });

  await t.test("AE5: an UNCONDITIONAL path allows, and invokes the contextual reader ZERO times", async () => {
    // ops-plain holds NO PARTS_OPERATIONS eligibility. Reached through ROLE_A alone -- whose grant
    // carries no condition row -- the answer is yes, and NOTHING about the world is read.
    const [state, ctxReader] = counting();
    const d = await decide(ctxReader, { principalId: prn("ops-plain"), roleKeys: [ROLE_A], capabilityKey: PO_READ });
    assert.equal(d.allowed, true);
    assert.equal(d.viaCondition, false);
    assert.equal(d.viaGrantor, ROLE_A);
    assert.equal(state.reads, 0, "an unconditional path invoked the contextual reader");
  });

  await t.test("AE5: the UNION -- holding both, the unconditional path answers with no reads", async () => {
    const [state, ctxReader] = counting();
    const d = await decide(ctxReader,
      { principalId: prn("ops-plain"), roleKeys: [ROLE_A, ROLE_B], capabilityKey: PO_READ });
    assert.equal(d.allowed, true, "any applicable path succeeding must grant access");
    assert.equal(d.viaGrantor, ROLE_A);
    assert.equal(d.viaCondition, false);
    assert.equal(state.reads, 0,
      "the condition constrains ROLE_B's GRANT, not the person -- so it costs ROLE_A nothing");
    // And an eligible person reaching it only through the conditioned grant is still allowed: the
    // union is genuinely a union, not "the unconditional one or nothing".
    const [s2, r2] = counting();
    const viaCondition = await decide(r2,
      { principalId: prn("ops-eligible"), roleKeys: [ROLE_B], capabilityKey: PO_READ });
    assert.equal(viaCondition.allowed, true);
    assert.ok(s2.reads > 0);
  });

  await t.test("ONE grant cell, ONE condition: a second condition on the same cell is refused", async () => {
    await assert.rejects(() => q(`INSERT INTO eos_policy.capability_grant_conditions
               (id,tenant_id,grant_scope,grantor_key,capability_key,condition,established_by,updated_by)
             VALUES ('cgc-ae-dup',$1,'ROLE',$2,$3,'{}'::jsonb,'lane-ae','lane-ae')`,
    [TENANT, ROLE_B, PO_READ]), /duplicate key|unique/i);
  });

  await t.test("a RETIRED row is evidence, not a condition", async () => {
    await q(`UPDATE eos_policy.capability_grant_conditions SET status='RETIRED' WHERE id='cgc-ae-1'`);
    const both = await entitlementsFor([ROLE_A, ROLE_B], PO_READ);
    assert.deepEqual(both.map((e) => e.condition === null), [true, true],
      "withdrawing a condition is a status change; the row survives as evidence");
    const { rows } = await q(`SELECT count(*)::int n FROM eos_policy.capability_grant_conditions`);
    assert.equal(rows[0].n, 1, "the retired row was deleted instead of retained");
    await q(`UPDATE eos_policy.capability_grant_conditions SET status='ACTIVE' WHERE id='cgc-ae-1'`);
  });

  await t.test("a condition on a capability the governed authority does not know cannot be stored", async () => {
    await assert.rejects(() => q(`INSERT INTO eos_policy.capability_grant_conditions
               (id,tenant_id,grant_scope,grantor_key,capability_key,condition,established_by,updated_by)
             VALUES ('cgc-ae-bad',$1,'ROLE',$2,'no.such.capability','{}'::jsonb,'lane-ae','lane-ae')`,
    [TENANT, ROLE_B]), /foreign key|violates/i);
    await assert.rejects(() => q(`INSERT INTO eos_policy.capability_grant_conditions
               (id,tenant_id,grant_scope,grantor_key,capability_key,condition,established_by,updated_by)
             VALUES ('cgc-ae-scope',$1,'GROUP',$2,$3,'{}'::jsonb,'lane-ae','lane-ae')`,
    [TENANT, ROLE_B, PO_READ]), /grant_scope|check/i);
  });

  // ════════════════════ reversal ════════════════════

  await t.test("the DOWN refuses while a condition exists, and reverses when none does", async () => {
    // THE CHAIN HAS GROWN ABOVE THIS MIGRATION, so "down 1" no longer names it. Migration
    // 1762300800000 (the authority activation vehicle) was appended after 1762214400000, and a
    // reversal test that silently reversed the WRONG migration would report a property of some
    // other file. The steps are counted from the chain rather than hard-coded, so the next
    // migration appended after this one does not break it again.
    const chain = readdirSync(resolve(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();
    const index = chain.findIndex((f) => f.startsWith("1762214400000"));
    assert.ok(index >= 0, "the migration under test is still in the chain");
    const above = chain.length - 1 - index;
    if (above > 0) migrate("down", String(above));

    const failed = (() => { try { migrate("down", "1"); return null; } catch (e) { return e; } })();
    assert.ok(failed, "the down destroyed established policy instead of refusing");
    assert.match(String(failed.stderr ?? failed.message), /refuses to reverse/);
    // The refusal is atomic: the relation and its row are both still there.
    const { rows } = await q(`SELECT count(*)::int n FROM eos_policy.capability_grant_conditions`);
    assert.equal(rows[0].n, 1);

    await q(`DELETE FROM eos_policy.capability_grant_conditions`);
    migrate("down", "1");
    const { rows: gone } = await q(
      `SELECT to_regclass('eos_policy.capability_grant_conditions') IS NULL AS gone`);
    assert.equal(gone[0].gone, true, "an empty relation is this migration's own work and reverses");

    migrate("up", "1");
    const { rows: back } = await q(
      `SELECT to_regclass('eos_policy.capability_grant_conditions') IS NOT NULL AS present,
              (SELECT count(*)::int FROM eos_policy.capability_grant_conditions) AS n`);
    assert.equal(back[0].present, true);
    assert.equal(back[0].n, 0, "up restores the relation EMPTY, exactly as it was created");

    // ...and the chain is put back the way this subtest found it, so nothing after it runs against
    // a database that is silently missing the migrations above.
    if (above > 0) migrate("up", String(above));
  });

  await t.test("the grant population of the capability is unchanged by all of the above", async () => {
    const { rows } = await q(
      `SELECT r.key FROM eos_policy.role_capabilities rc
         JOIN eos_policy.roles r ON r.id = rc.role_id
         JOIN eos_policy.capabilities c ON c.id = rc.capability_id
        WHERE rc.tenant_id=$1 AND c.key=$2 ORDER BY r.key`, [TENANT, PO_READ]);
    assert.deepEqual(rows.map((r) => r.key), [ROLE_A, ROLE_B].sort(),
      "a condition NARROWS an entitlement and can never create or destroy one");
  });
});
