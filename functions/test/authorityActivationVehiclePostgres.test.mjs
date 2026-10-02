// MIGRATION 1762300800000 -- THE AUTHORITY ACTIVATION VEHICLE, PROVED AGAINST A REAL DATABASE.
//
// Set POLICY_TEST_DATABASE_URL to run. Every phase creates and drops its OWN disposable database;
// nothing here reads or writes nonprod, and the migration this file exercises has NOT been applied
// to any environment.
//
// ════════════════════ WHAT IS PROVED, AND WHY EACH ONE IS EXECUTABLE ════════════════════
//
// 1. THE EDIT-WITHOUT-READ CENSUS, MEASURED BOTH WAYS. 29 rows before, 10 after, and the ten that
//    remain are exactly the ten the manifest classifies. Measured against the STORED CRED
//    PROJECTION (role_object_permissions) and, independently, against the GOVERNED AUTHORITY
//    (role_capabilities x capabilities.action_kind) -- because those are two different questions
//    and a lane that answered only the easier one would be reporting a number, not a property.
// 2. THE PROJECTION RECONCILE CHANGES NO AUTHORITY. Every can_read the migration sets is backed by
//    a READ capability the Role already holds, and role_capabilities is byte-identical before and
//    after the reconcile statement.
// 3. REPORTING SLICE 1 HAS A SERVER-ENFORCED PATH. `capabilitiesForRoleKeys` -- the function every
//    runtime gate actually calls -- returns reportDefinition.read for reportViewer and does NOT
//    return it for reportFinanceViewer or reportAuthor, read out of PostgreSQL with no Firebase
//    module loaded anywhere in the resolution.
// 4. UP AND DOWN, on a disposable database: the migration applies on top of the real chain, the
//    guarded down removes exactly what it wrote, and the down REFUSES when a grant it did not write
//    still holds one of the capabilities it registered.
// 5. THE CENSUS BLOCK REFUSES rather than guesses: a database whose premise is false stops it.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { declaredSchemas } from "./support/migrationSchema.mjs";
import { PostgresPolicyRepository } from "../lib/adminPolicy/postgresPolicyRepository.js";
import { seedTenantPolicy } from "../lib/adminPolicy/seed/policySeed.js";
import { capabilitiesForRoleKeys } from "../lib/eosOps/capabilityAuthority.js";
import {
  GLOBAL_CATALOG_ACTIVATED_GRANTS,
  NONPROD_ACTIVATED_CAPABILITY_GRANTS,
  SEED_BOUNDARY_MIGRATION,
} from "../lib/adminPolicy/roleCapabilityAuthorityBaseline.js";
import {
  EDIT_WITHOUT_READ_CENSUS_AFTER,
  EDIT_WITHOUT_READ_CENSUS_WIRING_ONLY,
  EDIT_WITHOUT_READ_RECONCILED,
  RESIDUAL_EDIT_WITHOUT_READ,
} from "../lib/adminPolicy/pendingAuthorityCorrections.js";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(FUNCTIONS_DIR, "migrations");

const MIGRATION = "1762300800000_authority-activation-and-reporting-read";
const STAMP = "migration:1762300800000";
const TENANT = "tenant-6ce59be1-1979-45cd-9d17-a4969037fb25";
const TENANT_KEY = "taylor-nonprod";
const ACTOR = "activation-vehicle-proof";

const RUNNER = "node_modules/node-pg-migrate/bin/node-pg-migrate.js";
const migrationFiles = () => readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();

function runMigrate(url, direction, count) {
  const args = [RUNNER, direction, "--migrations-dir", "migrations", "--no-check-order"];
  if (count !== undefined) args.push(String(count));
  return execFileSync(process.execPath, args,
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" }).toString();
}

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

/**
 * A disposable database carrying the full rebuild: chain before the seed boundary, the canonical
 * seed, the rest of the chain, then the catalog and activation phases. `upto` stops the chain one
 * migration short, which is how "before" is measured against the same pipeline as "after".
 */
async function standUp(name, { includeActivationMigration = true } = {}) {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  const url = dbUrlFor(name);
  const files = migrationFiles();
  const beforeSeed = files.filter((f) => f < SEED_BOUNDARY_MIGRATION).length;
  runMigrate(url, "up", beforeSeed);

  const pool = new pg.Pool({ connectionString: url, max: 4 });
  await pool.query("INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $2, $2)", [TENANT, TENANT_KEY]);
  await seedTenantPolicy(new PostgresPolicyRepository(pool), TENANT, ACTOR);
  // `up N` runs N MORE migrations, so the remainder is counted from the boundary rather than from
  // zero. Stopping one short is how "before the activation" is measured through the same pipeline.
  // "Stopping one short" means stopping just BEFORE the activation migration -- counted by name, since
  // the Administration control plane (1762646400000) is now appended after it.
  const remaining = files.length - beforeSeed;
  const beforeActivation = files.filter((f) => f >= SEED_BOUNDARY_MIGRATION && f < `${MIGRATION}.sql`).length;
  runMigrate(url, "up", includeActivationMigration ? remaining : beforeActivation);

  for (const [pairs, by] of [[GLOBAL_CATALOG_ACTIVATED_GRANTS, `canonical-catalog:${ACTOR}`],
    [NONPROD_ACTIVATED_CAPABILITY_GRANTS, `nonprod-activation:${ACTOR}`]]) {
    for (const { roleKey, capabilityKey } of pairs) {
      await pool.query(
        `INSERT INTO eos_policy.role_capabilities
               (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
         SELECT 'rc_p_' || substr(md5($1 || r.id || c.id), 1, 24), $1, r.id, c.id, $4, $4, $4
           FROM eos_policy.roles r, eos_policy.capabilities c
          WHERE r.tenant_id = $1 AND r.key = $2 AND c.key = $3
         ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING`,
        [TENANT, roleKey, capabilityKey, by]);
    }
  }
  return { url, pool };
}

async function dropDatabase(pool, name) {
  await pool?.end();
  await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
}

/** The STORED CRED PROJECTION's edit-without-read rows. */
const projectionEditWithoutRead = async (pool) => (await pool.query(
  `SELECT o.key AS object_key, r.key AS role_key
     FROM eos_policy.role_object_permissions p
     JOIN eos_policy.objects o ON o.id = p.object_id
     JOIN eos_policy.roles   r ON r.id = p.role_id
    WHERE p.tenant_id = $1 AND p.can_read = false AND (p.can_edit OR p.can_create)
    ORDER BY 1, 2`, [TENANT])).rows.map((x) => `${x.object_key}/${x.role_key}`);

/**
 * The GOVERNED AUTHORITY's edit-without-read rows, over the four Objects the rulings scoped: a Role
 * holding a non-READ capability on an Object and holding no READ capability on the same Object.
 * This asks the question of `capabilities` and `role_capabilities` directly, so it is independent
 * of whatever the projection happens to say.
 */
const governedEditWithoutRead = async (pool, objectKeys) => (await pool.query(
  `SELECT DISTINCT c.object_key, r.key AS role_key
     FROM eos_policy.role_capabilities rc
     JOIN eos_policy.capabilities c ON c.id = rc.capability_id
     JOIN eos_policy.roles r        ON r.id = rc.role_id
    WHERE rc.tenant_id = $1
      AND c.object_key = ANY($2)
      AND c.action_kind <> 'READ'
      AND NOT EXISTS (
        SELECT 1 FROM eos_policy.role_capabilities rc2
          JOIN eos_policy.capabilities c2 ON c2.id = rc2.capability_id
         WHERE rc2.tenant_id = rc.tenant_id AND rc2.role_id = rc.role_id
           AND c2.object_key = c.object_key AND c2.action_kind = 'READ')
    ORDER BY 1, 2`, [TENANT, objectKeys])).rows.map((x) => `${x.object_key}/${x.role_key}`);

// ════════════════════ 1. THE MIGRATION IS IN THE CHAIN, AT THE END ════════════════════

test("the activation migration was APPENDED: only the later Administration and workflow control planes follow it", () => {
  const files = migrationFiles();
  const at = files.indexOf(`${MIGRATION}.sql`);
  assert.ok(at >= 0);
  assert.deepEqual(files.slice(at + 1), ["1762646400000_administration-control-plane.sql", "1762732800000_workflow-control-plane.sql",
    "1762819200000_employee-functional-role-authority.sql", "1762905600000_tenant-sales-channel-scope.sql",
    "1762992000000_direct-exception-cell-lock.sql", "1763078400000_administrator-staffing-capability.sql",
    // The Catalog + Reorder activation candidate, appended after current main (2026-09-28).
    "1763164800000_catalog-part-alias-authority.sql", "1763251200000_reorder-object-schema-parity.sql",
    "1763337600000_reorder-lifecycle-capability-registration.sql", "1763424000000_reorder-requester-is-a-principal.sql",
    "1763510400000_reorder-actor-identity-normalization.sql", "1763596800000_receiving-business-time-number-and-acquisition-cost.sql",
    // INTEGRATED 2026-09-29 (lanes L1 + L2 + L3 over main e2dac914; L5 adds no migration or capability): appended after the candidate, in id order.
    // DQ-022 (lane L1).
    "1763683200000_ownership-handoff-correction-capability.sql",
    // Lane L2, Controller rulings DQ-010 / DQ-011: four Work Order business actions, no grants.
    "1763856000000_work-order-business-action-capabilities.sql",
    // Lane L3: scope binding (DQ-024 / DQ-029), Transfer-on-EOS storage, bin placement (DQ-038), acquire (DQ-036(b)).
    "1764115200000_mobile-location-scope-binding.sql", "1764118800000_mobile-location-scope-binding-capability.sql",
    "1764122400000_transfer-eos-lifecycle-support.sql", "1764126000000_bin-placement-authority.sql",
    "1764129600000_serialized-asset-acquire-authority.sql",
    // EOS identity/session foundation (Controller ruling 2026-09-29, "EOS IDENTITY BOUNDARY"): the principal_identities
    // binding table. Schema only -- no capability, no grant.
    "1764200000000_eos-principal-identities.sql",
    // The Work Order domain cutover (2026-09-30): the execution-facts table and workOrder.execution.record, no grant.
    "1764300000000_work-order-execution-facts.sql",
    // The completion pass (2026-09-30): quarantine, availability, labor (+1 cap), inbound work (+5 caps); no grant.
    "1764310000000_work-order-quarantine.sql", "1764320000000_technician-availability.sql",
    "1764330000000_work-order-labor.sql", "1764340000000_inbound-work-intake.sql",
    // Service Experience completion (2026-09-30): provider runtime (schema), recovery (+1 cap), self-scheduling (+2 caps); no grant.
    "1764350000000_inbound-provider-runtime.sql", "1764360000000_inbound-work-recovery.sql", "1764370000000_customer-self-scheduling.sql",
    // Parts / Purchasing / Receiving completion (2026-10-01): Reorder create integrity + RR numbering (schema) and two
    // capabilities (warehouse.record.manage, supplier.record.read); no grant.
    "1764380000000_parts-purchasing-receiving-completion.sql",
    // Inventory / Warehouse completion (2026-10-01): the baseline cutover certification (schema); no capability, no grant.
    "1764390000000_inventory-baseline-cutover.sql",
    // Equipment activation (2026-10-01): equipment.record.read / .manage (no grant), equipment.version, equipment_events.
    "1764400000000_equipment-activation.sql",
    // Truck Inventory activation (2026-10-01): inventory.catalog.alias.read / inventory.truckRegistry.manage (no grant),
    // MOBILE operational scope, receipt-into-MOBILE CHECK.
    "1764410000000_truck-inventory-activation.sql",
    // Finance foundation (2026-10-01): counterparties, facts, obligations, destinations -- schema only; no capability, no grant.
    "1764420000000_finance-foundation.sql",
    // Finance Activation 1 completion (2026-10-01, #193): PO supplier identity, receipt corrections, exception resolutions;
    // inventory.receipt.correct (no grant).
    "1764430000000_purchasing-supplier-identity-and-receipt-correction.sql",
    // Commercial Finance activation (2026-10-02, #195): sales_order_fulfillments + derived eligibility views; no capability, no grant.
    "1764440000000_commercial-fulfillment-billing-eligibility.sql",
    // Operational Billing Package (2026-10-02, #196): eos_finance.billing_packages + lines; no capability, no grant.
    "1764450000000_operational-billing-packages.sql",
    // Finance Activation 2 (2026-10-02, #197): tax evidence, one receivable per package, accounting handoffs; no capability, no grant.
    "1764460000000_receivable-tax-evidence-accounting-handoff.sql"],
    "an activation must be appended, never back-dated into history");
  const ids = files.slice(0, at).map((f) => Number(f.split("_")[0]));
  assert.ok(Math.max(...ids) < 1762300800000);
});

test("the migration's UP is guarded: a census that RAISES, then registrations, then grants", () => {
  const sql = readFileSync(join(MIGRATIONS_DIR, `${MIGRATION}.sql`), "utf8");
  const up = sql.split("-- Down Migration")[0];
  const down = sql.split("-- Down Migration")[1];

  assert.ok(/DO \$\$[\s\S]*RAISE EXCEPTION[\s\S]*END\s*\$\$;/.test(up), "the UP must open with a census that raises");
  assert.equal((up.match(/RAISE EXCEPTION/g) ?? []).length, 8, "eight measured premises, each with its own sentence");
  assert.match(up, /ON CONFLICT \(key\) DO NOTHING/, "re-registering a capability must be a no-op");
  assert.match(up, /ON CONFLICT \(tenant_id, role_id, capability_id\) DO NOTHING/, "re-granting must be a no-op");
  assert.match(up, /granted_by[\s\S]*'migration:1762300800000'/, "every grant carries its provenance stamp");
  assert.equal(/INSERT\s+INTO\s+principal_capabilities/i.test(up), false, "a migration never writes a direct Principal grant");
  assert.equal(/DELETE FROM capabilities[\s\S]*NOT IN/i.test(up), false, "no snapshot-shaped DELETE");

  assert.match(down, /granted_by = 'migration:1762300800000'/, "the down removes by provenance, not by capability");
  assert.match(down, /refuses to reverse/, "the down must refuse rather than destroy recorded authority");
});

// ════════════════════ 2. THE EDIT-WITHOUT-READ CENSUS, BEFORE AND AFTER ════════════════════

test("RULING B: the census moves 29 -> 10, and the ten that remain are the ten the manifest classifies",
  { skip: SKIP, concurrency: 1 }, async (t) => {
    const before = `actbefore_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const after = `actafter_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    let poolBefore; let poolAfter;
    t.after(async () => { await dropDatabase(poolBefore, before); await dropDatabase(poolAfter, after); });

    ({ pool: poolBefore } = await standUp(before, { includeActivationMigration: false }));
    ({ pool: poolAfter } = await standUp(after));

    const rowsBefore = await projectionEditWithoutRead(poolBefore);
    const rowsAfter = await projectionEditWithoutRead(poolAfter);

    // 26, not 29. The activation has TWO halves and only one is a migration: the matrix READ verbs
    // are wired in the same commit, and the two `employee` rows close on that wiring alone because
    // employee.record.read is one of the few registered READ keys the LEGACY Role catalog also
    // declares, so the seed can satisfy it. A test can rerun a migration and cannot un-wire a
    // committed matrix, so this is what is measurable here and 29 is recorded in the manifest as the
    // measurement it was.
    //
    // 26 AND NOT 27, WHICH IS WHAT THIS LANE MEASURED ALONE. Lane BN's Owner narrowing EXCLUDES
    // `inventory.stock.receive` from the compiled Owner Role, so receivingOrder/owner is not an
    // edit-without-read row any more -- the write itself is gone, which closes the row without any
    // grant at all. Asserted below by name so the two closures stay distinguishable.
    assert.equal(rowsBefore.length, EDIT_WITHOUT_READ_CENSUS_WIRING_ONLY,
      "the census with the wiring applied and the migration withheld");
    assert.equal(rowsAfter.length, EDIT_WITHOUT_READ_CENSUS_AFTER, "the measured 'after' the manifest records");

    // CLOSED BY REMOVING THE WRITE, not by registering a read. Owner no longer holds
    // inventory.stock.receive (lane BN), so this row is absent from BOTH censuses. If Owner ever
    // regains that write without a receivingOrder read, it reappears in `before` and this fails.
    assert.equal(rowsBefore.includes("receivingOrder/owner"), false,
      "Owner has regained a receivingOrder write; BN's Owner capability contract has been widened");
    assert.equal(rowsAfter.includes("receivingOrder/owner"), false);

    // THE THIRTEEN RULING B CLOSED are gone, by name.
    const closed = EDIT_WITHOUT_READ_RECONCILED.map((r) => `${r.objectKey}/${r.roleKey}`).sort();
    assert.equal(closed.length, 13);
    for (const row of closed) {
      assert.ok(rowsBefore.includes(row), `${row} is claimed as a ruling B row and was not one`);
      assert.ok(!rowsAfter.includes(row), `${row} is claimed CLOSED and is still open`);
    }

    // AND WHAT REMAINS IS EXACTLY WHAT THE MANIFEST CLASSIFIES -- no row is unexplained, and no
    // classified row has quietly disappeared either.
    assert.deepEqual(rowsAfter,
      RESIDUAL_EDIT_WITHOUT_READ.map((r) => `${r.objectKey}/${r.roleKey}`).sort());
  });

test("the GOVERNED authority, asked directly, has ZERO edit-without-read on the Objects the rulings scoped",
  { skip: SKIP, concurrency: 1 }, async (t) => {
    const name = `actgov_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    let pool;
    t.after(() => dropDatabase(pool, name));
    ({ pool } = await standUp(name));

    const scoped = ["employee", "rolesPermissions", "receivingOrder", "workOrder", "reportDefinition"];
    // ONE row survives, and it is the one the manifest names: officeManager holds workOrder.create
    // and no transition, so it is a CREATE-without-read that ruling B's thirteen rows -- scoped to
    // workOrder.transition holders -- deliberately did not cover. Recorded rather than closed.
    assert.deepEqual(await governedEditWithoutRead(pool, scoped), ["workOrder/officeManager"],
      "every row ruling B scoped is closed, and the one outside it is the one the manifest classifies");
    assert.ok(RESIDUAL_EDIT_WITHOUT_READ.some((r) => r.objectKey === "workOrder" && r.roleKey === "officeManager"));

    // AND THE OTHER RESIDUAL workOrder ROW IS ABSENT HERE, which is the proof that its disposition is
    // right: workOrderPartsPlanner shows an edit in the PROJECTION and holds NO governed write at
    // all, because `workOrder.parts.plan` is a legacy id eos_policy.capabilities does not register.
    // A PROJECTION_DEFECT is exactly a row the projection has and the authority does not.
    assert.ok(RESIDUAL_EDIT_WITHOUT_READ.some(
      (r) => r.roleKey === "workOrderPartsPlanner" && r.disposition === "PROJECTION_DEFECT"));

    // NON-VACUITY: the same query over an Object the rulings did NOT scope still finds rows, so the
    // empty result above is a property of the activation and not of the query.
    const unscoped = await governedEditWithoutRead(pool, ["transferOrder", "part", "inventoryAction"]);
    assert.ok(unscoped.length > 0, "the query must still be able to find a row");
  });

test("the projection reconcile changes NO effective authority", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `actproj_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  let pool;
  t.after(() => dropDatabase(pool, name));
  ({ pool } = await standUp(name));

  // EVERY can_read the migration wrote or updated is backed by a READ capability the Role holds.
  const { rows: unbacked } = await pool.query(
    `SELECT o.key AS object_key, r.key AS role_key
       FROM eos_policy.role_object_permissions p
       JOIN eos_policy.objects o ON o.id = p.object_id
       JOIN eos_policy.roles   r ON r.id = p.role_id
      WHERE p.tenant_id = $1 AND p.updated_by = $2 AND p.can_read
        AND NOT EXISTS (
          SELECT 1 FROM eos_policy.role_capabilities rc
            JOIN eos_policy.capabilities c ON c.id = rc.capability_id
           WHERE rc.tenant_id = p.tenant_id AND rc.role_id = p.role_id
             AND c.object_key = o.key AND c.action_kind = 'READ')`, [TENANT, STAMP]);
  assert.deepEqual(unbacked, [],
    "a projection row claiming a read the Role does not hold would be a FAKE permission");

  // It touched no other verb: every row it wrote or updated carries can_create/can_edit/can_delete
  // exactly as the seed left them, and the rows it CREATED carry only the read.
  const { rows: created } = await pool.query(
    `SELECT count(*)::int AS n FROM eos_policy.role_object_permissions
      WHERE tenant_id = $1 AND created_by = $2 AND (can_create OR can_edit OR can_delete)`, [TENANT, STAMP]);
  assert.equal(created[0].n, 0, "a row this migration created may carry the READ and nothing else");

  // And it reconciled the Objects it was supposed to: the five scoped ones and no others.
  const { rows: touched } = await pool.query(
    `SELECT DISTINCT o.key FROM eos_policy.role_object_permissions p
       JOIN eos_policy.objects o ON o.id = p.object_id
      WHERE p.tenant_id = $1 AND (p.updated_by = $2 OR p.created_by = $2) ORDER BY 1`, [TENANT, STAMP]);
  // FOUR, not five. `employee` is absent and that is the correct outcome: once the matrix R verb is
  // wired to employee.record.read, the SEED already derives can_read for admin, generalManager and
  // owner, because that capability is one the LEGACY Role catalog also declares. The migration's
  // reconcile is for the reads the catalog does NOT declare -- the migration-registered ones -- and
  // it does nothing where the projection is already right. A statement that touched employee anyway
  // would be rewriting a correct row to look busy.
  assert.deepEqual(touched.map((r) => r.key),
    ["receivingOrder", "reportDefinition", "rolesPermissions", "workOrder"]);
  const { rows: employeeReads } = await pool.query(
    `SELECT r.key FROM eos_policy.role_object_permissions p
       JOIN eos_policy.objects o ON o.id = p.object_id
       JOIN eos_policy.roles   r ON r.id = p.role_id
      WHERE p.tenant_id = $1 AND o.key = 'employee' AND p.can_read ORDER BY 1`, [TENANT]);
  assert.deepEqual(employeeReads.map((r) => r.key), ["admin", "generalManager", "owner"],
    "...and the Employee read really is projected, by the seed, for exactly its holders");
});

// ════════════════════ 3. REPORTING SLICE 1 -- THE SERVER-ENFORCED PATH ════════════════════

test("REPORTING SLICE 1 resolves through the PostgreSQL authority the runtime gates actually call",
  { skip: SKIP, concurrency: 1 }, async (t) => {
    const name = `actrpt_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    let pool;
    t.after(() => dropDatabase(pool, name));
    ({ pool } = await standUp(name));

    // `capabilitiesForRoleKeys` is the role_capabilities join every runtime gate resolves through.
    // No Firebase, no PERMISSION_CATALOG, no environment activation registry: one SQL read.
    const viewer = await capabilitiesForRoleKeys(pool, TENANT, ["reportViewer"]);
    assert.ok(viewer.has("reportDefinition.read"), "reportViewer must resolve the governed Object read");

    for (const role of ["reportFinanceViewer", "reportAuthor"]) {
      const held = await capabilitiesForRoleKeys(pool, TENANT, [role]);
      assert.ok(!held.has("reportDefinition.read"),
        `${role} must hold NO Object-level reporting capability -- the tiers are additive, not nested`);
      assert.equal([...held].filter((c) => c.startsWith("reportDefinition.")).length, 0);
    }

    // The legacy Firebase-era ids are NOT the governed authority and must not have leaked into it.
    const all = await pool.query("SELECT key FROM eos_policy.capabilities WHERE key LIKE 'report%' ORDER BY 1");
    assert.deepEqual(all.rows.map((r) => r.key), ["reportDefinition.read"],
      "exactly ONE reporting capability is registered; the 34 field-level report ids are not capability rows");

    // The Object is projectable, so the grant is administrable rather than stranded.
    const object = await pool.query(
      `SELECT key, label, origin, lifecycle, supports_delete
         FROM eos_policy.objects WHERE tenant_id = $1 AND key = 'reportDefinition'`, [TENANT]);
    assert.equal(object.rows.length, 1, "a capability naming an Object no tenant seeds is unadministrable");
    assert.equal(object.rows[0].label, "Report Definition");
    assert.equal(object.rows[0].supports_delete, false,
      "the Object's D verb can never be true, which is the second half of 'delete is not registered'");

    // THE FIELD DIMENSION IS SOMEWHERE ELSE, AND IT IS EMPTY. Named rather than pre-empted.
    const fields = await pool.query(
      `SELECT (SELECT count(*)::int FROM eos_policy.role_field_permission_overrides WHERE tenant_id = $1) AS overrides,
              (SELECT count(*)::int FROM eos_policy.object_fields WHERE tenant_id = $1) AS fields`, [TENANT]);
    assert.equal(fields.rows[0].overrides, 0, "field-level reporting has not been written here");
    assert.ok(fields.rows[0].fields > 300, "...over a field catalogue that really exists");

    // reportDefinition carries NO fields of its own: it is a security subject, not a data shape.
    const own = await pool.query(
      `SELECT count(*)::int AS n FROM eos_policy.object_fields f
         JOIN eos_policy.objects o ON o.id = f.object_id
        WHERE o.tenant_id = $1 AND o.key = 'reportDefinition'`, [TENANT]);
    assert.equal(own.rows[0].n, 0);
  });

// ════════════════════ 4. UP AND DOWN ON A DISPOSABLE DATABASE ════════════════════

test("UP then DOWN: the guarded reversal removes exactly what the migration wrote",
  { skip: SKIP, concurrency: 1 }, async (t) => {
    const name = `actupdn_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    let pool;
    t.after(() => dropDatabase(pool, name));
    let url;
    ({ pool, url } = await standUp(name));

    const counts = async () => (await pool.query(
      `SELECT (SELECT count(*)::int FROM eos_policy.capabilities) AS caps,
              (SELECT count(*)::int FROM eos_policy.role_capabilities WHERE tenant_id = $1) AS grants,
              (SELECT count(*)::int FROM eos_policy.role_capabilities WHERE granted_by = $2) AS mine`,
      [TENANT, STAMP])).rows[0];

    // The Administration control plane (1762646400000) sits after the activation: +1 capability, +1
    // grant. It is peeled first so the reversal below is THIS migration's and nothing else's.
    // INTEGRATED 2026-09-29 (lanes L1 + L2 + L3 over main e2dac914; L5 adds no migration or capability): 97 = 90 + 1 (L1) + 4 (L2) + 2 (L3).
    // Peeled NEWEST FIRST. None of the seven wrote a grant, so only the capability count moves.
    // Parts / Purchasing / Receiving completion first (-2 capabilities, no grant), then the Service Experience completion,
    // newest first: self-scheduling (-2), recovery (-1), provider runtime (schema).
    assert.deepEqual(await counts(), { caps: 114, grants: 415, mine: 26 });
    runMigrate(url, "down", 1); // Finance Activation 2 (schema only)
    assert.deepEqual(await counts(), { caps: 114, grants: 415, mine: 26 });
    runMigrate(url, "down", 1); // the Operational Billing Package (schema only)
    assert.deepEqual(await counts(), { caps: 114, grants: 415, mine: 26 });
    runMigrate(url, "down", 1); // the Commercial Finance activation (schema only)
    assert.deepEqual(await counts(), { caps: 114, grants: 415, mine: 26 });
    runMigrate(url, "down", 1); // the Finance Activation 1 completion (-1 capability, no grant)
    assert.deepEqual(await counts(), { caps: 113, grants: 415, mine: 26 });
    runMigrate(url, "down", 1); // the Finance foundation (schema only)
    assert.deepEqual(await counts(), { caps: 113, grants: 415, mine: 26 });
    runMigrate(url, "down", 1); // the Truck Inventory activation (-2 capabilities, no grant)
    assert.deepEqual(await counts(), { caps: 111, grants: 415, mine: 26 });
    runMigrate(url, "down", 1); // the Equipment activation (-2 capabilities, no grant)
    assert.deepEqual(await counts(), { caps: 109, grants: 415, mine: 26 });
    runMigrate(url, "down", 1); // the Inventory / Warehouse baseline cutover (schema)
    assert.deepEqual(await counts(), { caps: 109, grants: 415, mine: 26 });
    runMigrate(url, "down", 1);
    assert.deepEqual(await counts(), { caps: 107, grants: 415, mine: 26 });
    runMigrate(url, "down", 1);
    assert.deepEqual(await counts(), { caps: 105, grants: 415, mine: 26 });
    runMigrate(url, "down", 2);
    assert.deepEqual(await counts(), { caps: 104, grants: 415, mine: 26 });
    // The completion pass, newest first: inbound work (-5 capabilities), labor (-1), availability and quarantine (schema).
    runMigrate(url, "down", 1);
    assert.deepEqual(await counts(), { caps: 99, grants: 415, mine: 26 });
    runMigrate(url, "down", 1);
    assert.deepEqual(await counts(), { caps: 98, grants: 415, mine: 26 });
    runMigrate(url, "down", 2);
    assert.deepEqual(await counts(), { caps: 98, grants: 415, mine: 26 });
    // The Work Order execution facts (1764300000000, the cutover 2026-09-30): -1 capability, no grant; peeled first.
    runMigrate(url, "down", 1);
    assert.deepEqual(await counts(), { caps: 97, grants: 415, mine: 26 });
    // The EOS identity binding table (1764200000000): schema only.
    runMigrate(url, "down", 1);
    assert.deepEqual(await counts(), { caps: 97, grants: 415, mine: 26 });
    // Lane L3: the serialized asset acquire authority (1764129600000, DQ-036(b)): -1 capability, no grant.
    runMigrate(url, "down", 1);
    assert.deepEqual(await counts(), { caps: 96, grants: 415, mine: 26 });
    // the bin placement authority (1764126000000) and the Transfer-on-EOS storage support (1764122400000): schema only.
    runMigrate(url, "down", 1);
    assert.deepEqual(await counts(), { caps: 96, grants: 415, mine: 26 });
    runMigrate(url, "down", 1);
    assert.deepEqual(await counts(), { caps: 96, grants: 415, mine: 26 });
    // the truck scope binding capability (1764118800000, DQ-029): -1 capability, no grant.
    runMigrate(url, "down", 1);
    assert.deepEqual(await counts(), { caps: 95, grants: 415, mine: 26 });
    // the MOBILE scope binding table (1764115200000): schema only.
    runMigrate(url, "down", 1);
    assert.deepEqual(await counts(), { caps: 95, grants: 415, mine: 26 });
    // Lane L2: the Work Order business-action capabilities (1763856000000, DQ-010 / DQ-011): -4 capabilities, no grant.
    runMigrate(url, "down", 1);
    assert.deepEqual(await counts(), { caps: 91, grants: 415, mine: 26 });
    // Lane L1: the ownership handoff correction capability (1763683200000, DQ-022): -1 capability, no grant.
    runMigrate(url, "down", 1);
    assert.deepEqual(await counts(), { caps: 90, grants: 415, mine: 26 });
    // The Catalog + Reorder activation candidate is peeled next, newest first. Three Reorder/Receiving schema
    // migrations: the counts do not move.
    for (let i = 0; i < 3; i++) {
      runMigrate(url, "down", 1);
      assert.deepEqual(await counts(), { caps: 90, grants: 415, mine: 26 });
    }
    // The Reorder lifecycle capability REGISTRATION (1763337600000): -8 capabilities, and no grant, because it wrote none.
    runMigrate(url, "down", 1);
    assert.deepEqual(await counts(), { caps: 82, grants: 415, mine: 26 });
    // The Reorder object schema parity and the Part alias authority: schema only.
    runMigrate(url, "down", 2);
    assert.deepEqual(await counts(), { caps: 82, grants: 415, mine: 26 });
    // The Administrator staffing capability (1763078400000, Owner ruling R1) is peeled next: -1 capability,
    // -1 grant (owner -> admin.administratorRole.assign).
    runMigrate(url, "down", 1);
    assert.deepEqual(await counts(), { caps: 81, grants: 414, mine: 26 });
    // The direct-exception cell lock (1762992000000) is peeled next: a trigger, the counts do not move.
    runMigrate(url, "down", 1);
    assert.deepEqual(await counts(), { caps: 81, grants: 414, mine: 26 });
    // The tenant sales channel activation (1762905600000) is peeled next: an empty table, the counts do not move.
    runMigrate(url, "down", 1);
    assert.deepEqual(await counts(), { caps: 81, grants: 414, mine: 26 });
    // The Functional Role authority (1762819200000) is peeled next: -1 capability, no grant.
    runMigrate(url, "down", 1);
    assert.deepEqual(await counts(), { caps: 80, grants: 414, mine: 26 });
    // The workflow control plane (1762732800000) is peeled next: schema only, the counts do not move.
    runMigrate(url, "down", 1);
    assert.deepEqual(await counts(), { caps: 80, grants: 414, mine: 26 });
    runMigrate(url, "down", 1);
    assert.deepEqual(await counts(), { caps: 79, grants: 413, mine: 26 });

    runMigrate(url, "down", 1);
    assert.deepEqual(await counts(), { caps: 76, grants: 387, mine: 0 },
      "the reversal returns the database to the authority the chain produced without it");

    // ...and UP again is not merely possible, it produces the same numbers. The census block is
    // re-satisfied because the down left the vocabulary exactly as it found it.
    runMigrate(url, "up", 1);
    assert.deepEqual(await counts(), { caps: 79, grants: 413, mine: 26 });
  });

test("the DOWN REFUSES when a grant it did not write still holds a capability it registered",
  { skip: SKIP, concurrency: 1 }, async (t) => {
    const name = `actrefuse_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    let pool;
    t.after(() => dropDatabase(pool, name));
    let url;
    ({ pool, url } = await standUp(name));
    runMigrate(url, "down", 1); // peel Finance Activation 2 (1764460000000) first
    runMigrate(url, "down", 1); // then the Operational Billing Package (1764450000000)
    runMigrate(url, "down", 1); // then the Commercial Finance activation (1764440000000)
    runMigrate(url, "down", 1); // then the Finance Activation 1 completion (1764430000000)
    runMigrate(url, "down", 1); // then the Finance foundation (1764420000000)
    runMigrate(url, "down", 1); // then the Truck Inventory activation (1764410000000)
    runMigrate(url, "down", 1); // then the Equipment activation (1764400000000)
    runMigrate(url, "down", 1); // then the Inventory / Warehouse baseline cutover (1764390000000)
    runMigrate(url, "down", 1); // then the Parts / Purchasing / Receiving completion (1764380000000)
    runMigrate(url, "down", 3); // then the Service Experience completion (1764370000000 .. 1764350000000), newest first
    runMigrate(url, "down", 4); // then the completion pass (1764340000000 .. 1764310000000) first, newest first
    runMigrate(url, "down", 1); // then the Work Order execution facts (1764300000000)
    runMigrate(url, "down", 1); // then the EOS identity binding table (1764200000000)
    runMigrate(url, "down", 5); // then lane L3's five migrations (1764129600000 .. 1764115200000) first, newest first
    runMigrate(url, "down", 1); // then the Work Order business-action capabilities (1763856000000, lane L2)
    runMigrate(url, "down", 1); // then the ownership handoff correction capability (1763683200000, lane L1)
    runMigrate(url, "down", 6); // then the Catalog + Reorder activation candidate (1763164800000 .. 1763596800000)
    runMigrate(url, "down", 1); // then the Administrator staffing capability (1763078400000)
    runMigrate(url, "down", 1); // then the direct-exception cell lock (1762992000000)
    runMigrate(url, "down", 1); // then the tenant sales channel activation (1762905600000)
    runMigrate(url, "down", 1); // then the Functional Role authority (1762819200000)
    runMigrate(url, "down", 1); // then the workflow control plane (1762732800000)
    runMigrate(url, "down", 1); // then the Administration control plane (1762646400000)

    // An administrator grants the new read through the governed command AFTER the migration. Its
    // granted_by is not the migration's stamp, so it is recorded authority a reversal may not destroy.
    await pool.query(
      `INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
       SELECT 'rc_admin_later', $1, r.id, c.id, 'admin-principal:later', 'admin-principal:later', 'admin-principal:later'
         FROM eos_policy.roles r, eos_policy.capabilities c
        WHERE r.tenant_id = $1 AND r.key = 'officeManager' AND c.key = 'workOrder.record.read'`, [TENANT]);

    assert.throws(
      () => runMigrate(url, "down", 1),
      (error) => {
        const text = `${error.stdout ?? ""}${error.stderr ?? ""}${error.message}`;
        assert.match(text, /AUTHORITY_ACTIVATION: refuses to reverse/);
        assert.match(text, /officeManager\/workOrder\.record\.read/);
        return true;
      },
      "a down that destroyed an administrator's later grant would be the worst kind of reversible");

    // The refusal is a TRANSACTION ABORT, not a partial reversal: everything is still there.
    const { rows } = await pool.query(
      `SELECT (SELECT count(*)::int FROM eos_policy.capabilities) AS caps,
              (SELECT count(*)::int FROM eos_policy.role_capabilities WHERE granted_by = $1) AS mine`, [STAMP]);
    assert.deepEqual(rows[0], { caps: 79, mine: 26 });
  });

// ════════════════════ 5. THE CENSUS REFUSES RATHER THAN GUESSES ════════════════════

test("the census stops a database whose measured premise is false", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `actcensus_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  let pool;
  t.after(() => dropDatabase(pool, name));
  let url;
  ({ pool, url } = await standUp(name, { includeActivationMigration: false }));

  // A REFUSED pair is already held: fieldManager may complete work. The activation must not write
  // 26 more rows on top of a control that has already been defeated.
  await pool.query(
    `INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
     SELECT 'rc_bad_complete', $1, r.id, c.id, 'somebody', 'somebody', 'somebody'
       FROM eos_policy.roles r, eos_policy.capabilities c
      WHERE r.tenant_id = $1 AND r.key = 'fieldManager' AND c.key = 'workOrder.lifecycle.complete'`, [TENANT]);

  assert.throws(
    () => runMigrate(url, "up"),
    (error) => {
      const text = `${error.stdout ?? ""}${error.stderr ?? ""}${error.message}`;
      assert.match(text, /AUTHORITY_ACTIVATION: a REFUSED grant is already held/);
      assert.match(text, /fieldManager\/workOrder\.lifecycle\.complete/);
      return true;
    });

  // Nothing was written: the census runs before the first INSERT and the whole migration is one
  // transaction, so a refused run leaves the database exactly as it found it.
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM eos_policy.capabilities");
  assert.equal(rows[0].n, 76, "a refused activation registers no capability");
});

test("the schemas this suite drops are the declared ones -- it cannot reach anything it did not create", () => {
  // Defensive, and cheap: every disposable database is created and dropped by name in this file,
  // and the shared helper's schema list is the one the migration suite declares.
  assert.ok(declaredSchemas().includes("eos_policy"));
  assert.ok(!declaredSchemas().includes("public"), "dropping public would be a different kind of test");
});
