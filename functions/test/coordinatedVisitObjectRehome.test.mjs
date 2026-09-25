// RETIRING TWO EMPTY OBJECTS WITHOUT LOSING THE ONE CAPABILITY THAT GOVERNED SOMETHING REAL.
//
// dispatchSchedule and notifications were Administration policy rows over records that do not
// exist. Retiring them is easy to get wrong in exactly one way: taking down
// `fulfillment.coordinatedVisit.read` with the Object it happened to be filed under, or -- worse --
// "saving" it by filing it as a generic Sales Order Read.
//
// So the assertion this file exists for is the SEPARATION, proved in BOTH directions: holding the
// coordinated-visit read must never satisfy a generic salesOrder READ, and holding salesOrder.read
// must never satisfy the coordinated-visit read. They are different acts on the same Object.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { resolveObjectAction, effectiveCapabilities, objectActionsForPrincipal, actionsForObject } =
  require("../lib/adminPolicy/objectSecurityAuthority.js");
const { COMPARABLE_CRED_KINDS, DATA_AUTHORITY_MIGRATION_BLOCKERS, COORDINATED_VISIT_RUNTIME_CUTOVER_BLOCKER } =
  require("../lib/adminPolicy/migration/credEquivalence.js");
const { deriveLegacyRoleGrants } = require("../lib/eosOps/migration/inventoryCapabilityGrantMigration.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
const { bootstrapTenant } = require("../lib/adminPolicy/tenantBootstrap.js");

const MIGRATION = "1761955200000_retire-dispatch-notification-objects-rehome-coordinated-visit.sql";
const CAP = "fulfillment.coordinatedVisit.read";
const RETIRED = ["dispatchSchedule", "notifications"];
const GOVERNED_HOLDERS = ["admin", "dispatcher", "fieldManager", "operationsManager", "owner"];

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const migrate = (dbUrl, args) => execFileSync(process.execPath,
  ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", ...args, "--migrations-dir", "migrations", "--no-check-order"],
  { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "pipe" });

/**
 * How many steps reach back to THIS migration -- itself plus everything that sorts after it.
 *
 * This file used to say `["down", "1"]`, which quietly meant "this migration is the newest one on
 * disk". That was true the day it was written and stopped being true the moment another migration
 * landed: `down 1` then reversed somebody else's work and every assertion below measured the wrong
 * thing. Counted rather than pinned, so the next migration added to the chain costs nothing here.
 */
const STEPS_TO_THIS_MIGRATION = String(
  readdirSync(resolve(FUNCTIONS_DIR, "migrations"))
    .filter((f) => f.endsWith(".sql") && f >= MIGRATION).length,
);

// ════════════════════ SOURCE-LEVEL ════════════════════

test("the migration creates no table for either retired Object", () => {
  const sql = readFileSync(resolve(FUNCTIONS_DIR, `migrations/${MIGRATION}`), "utf8");
  // Comments carry the reasoning and name both keys on purpose; the CODE is what must be clean.
  const code = sql.replace(/^\s*--.*$/gm, "");
  assert.ok(code.includes("DELETE FROM objects WHERE key = v_key"), "non-vacuous: the retirement is here");
  for (const forbidden of [/CREATE\s+TABLE/i, /CREATE\s+SCHEMA/i]) {
    assert.equal(forbidden.test(code), false, `${forbidden} would invent the authority this slice refuses to invent`);
  }
  // Notification visibility gets NO successor capability, by ruling.
  assert.equal(/'notification[^']*'\s*,\s*'/.test(code), false, "no capability is registered over notifications");
  // And reorder.request.read.queue is left exactly where it was.
  assert.equal(code.includes("reorder.request.read.queue"), false, "the queue capability is not touched");
});

test("the re-homed capability is registered as a BUSINESS_ACTION, never a CRED verb", () => {
  const code = readFileSync(resolve(FUNCTIONS_DIR, `migrations/${MIGRATION}`), "utf8").replace(/^\s*--.*$/gm, "");
  assert.ok(code.includes("'salesOrder', 'readCoordinatedVisits', 'BUSINESS_ACTION', 'Read Coordinated Visits'"),
    "the exact governed metadata, or this proves nothing");
  assert.ok(code.includes(`'${CAP}'`), "the capability KEY is unchanged");
  // The one substitution that would quietly flatten it.
  assert.equal(/'salesOrder',\s*'read'/.test(code), false, "it must not be filed as the Object's generic Read");
  // BUSINESS_ACTION is excluded from the CRED comparator by construction, so a business act can
  // never satisfy a stored CRED cell. That is the structural half of the separation.
  assert.equal(COMPARABLE_CRED_KINDS.has("BUSINESS_ACTION"), false);
  assert.equal(COMPARABLE_CRED_KINDS.has("READ"), true, "non-vacuity: the set is real");
});

test("the five Role grants are derived from the governed catalog, not chosen", () => {
  const derived = deriveLegacyRoleGrants([CAP]).map((g) => g.roleKey).sort();
  assert.deepEqual(derived, [...GOVERNED_HOLDERS].sort(),
    "the migration's grant list must be what the Role catalog already says");
  const code = readFileSync(resolve(FUNCTIONS_DIR, `migrations/${MIGRATION}`), "utf8").replace(/^\s*--.*$/gm, "");
  for (const role of derived) assert.ok(code.includes(`('${role}')`), `${role} must be granted`);
});

test("the governed seed no longer declares either retired Object", () => {
  const seed = JSON.parse(readFileSync(
    resolve(FUNCTIONS_DIR, "src/adminPolicy/seed/policySeedSnapshot.json"), "utf8"));
  assert.equal(seed.objects.length, 40,
    "41 minus the two Objects that governed nothing, plus reportDefinition -- Reporting Slice 1, "
    + "migration 1762300800000. The retirement this file guards is unaffected: a later Object being "
    + "REGISTERED does not un-retire dispatchSchedule or notifications, and the two assertions "
    + "below still name them.");
  for (const key of RETIRED) {
    assert.equal(seed.objects.some((o) => o.key === key), false, `${key} must be gone from the seed`);
  }
  // The Sales Order row is UNCHANGED: the coordinated-visit read is deliberately not added to its
  // R cell, because this matrix has only CRED verbs and a named business act is not one.
  const salesOrder = seed.objects.find((o) => o.key === "salesOrder");
  assert.ok(salesOrder, "non-vacuity: the successor Object exists");
  assert.deepEqual(salesOrder.capabilitiesByVerb.R, ["salesOrder.read"],
    "the coordinated-visit read must not appear as a generic Sales Order Read");
});

test("the runtime read has NOT moved, and the gap is named rather than implied", () => {
  // Governing an act in PostgreSQL while the read it governs still reaches Firestore is a real gap.
  // This slice moved the AUTHORITY only, by ruling, so the blocker is recorded here and the source
  // it points at is checked -- a tracker naming a file that no longer reads that collection would be
  // a stale reassurance, which is worse than no tracker.
  const b = COORDINATED_VISIT_RUNTIME_CUTOVER_BLOCKER;
  assert.equal(b.capability, CAP);
  assert.equal(b.objectKey, "salesOrder");
  assert.equal(b.actionKey, "readCoordinatedVisits");
  const service = readFileSync(resolve(FUNCTIONS_DIR, "..", b.readService), "utf8");
  assert.ok(service.includes("WORK_ORDERS_COLLECTION"),
    "the named read service must still be the one reading the legacy collection");
  assert.ok(b.reason.length > 20, "a real reason, not a label");
});

test("no CRED cell is blocked by a data authority any more", () => {
  assert.deepEqual(Object.keys(DATA_AUTHORITY_MIGRATION_BLOCKERS), [],
    "both remaining blockers were Objects over nothing, and they were retired rather than built");
});

// ════════════════════ DATABASE-LEVEL ════════════════════

test("retirement and re-home, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `cvrehome_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  const dbUrl = dbUrlFor(name);
  migrate(dbUrl, ["up"]);

  // REVERSE this migration, SEED, then re-apply it -- the order it will actually run in against a
  // live database. The seed is what writes Roles and stored CRED, and it runs after migrations in
  // every real environment, so applying the grant insert to an empty roles table would prove
  // nothing about preservation. The retirement half does NOT come back on the way down, which is
  // itself the point: the seed no longer declares either Object.
  migrate(dbUrl, ["down", STEPS_TO_THIS_MIGRATION]);
  pool = new pg.Pool({ connectionString: dbUrl, max: 6 });
  const repo = new PostgresPolicyRepository(pool);
  const { tenant } = await bootstrapTenant(repo, { key: "taylor-cv", name: "Taylor", actorUid: "operator" });
  migrate(dbUrl, ["up", STEPS_TO_THIS_MIGRATION]);

  await t.test("both Objects are gone, and so is every subordinate policy row they carried", async () => {
    const { rows } = await pool.query(
      `SELECT key FROM eos_policy.objects WHERE key = ANY($1)`, [RETIRED]);
    assert.deepEqual(rows, [], "no retired Object survives the seed");
    const orphans = await pool.query(`
      SELECT count(*)::int n FROM eos_policy.role_object_permissions r
       WHERE NOT EXISTS (SELECT 1 FROM eos_policy.objects o WHERE o.id = r.object_id)`);
    assert.equal(orphans.rows[0].n, 0, "no CRED row points at a deleted Object");
    const total = await pool.query("SELECT count(*)::int n FROM eos_policy.objects");
    assert.equal(total.rows[0].n, 40, "the seed and the database agree on 40 Objects");
  });

  await t.test("the capability survives, under the Sales Order, with exactly its five grants", async () => {
    const { rows } = await pool.query(
      `SELECT object_key, action_key, action_kind, display_label FROM eos_policy.capabilities WHERE key = $1`, [CAP]);
    assert.equal(rows.length, 1, "the capability was not lost with the Object it was filed under");
    assert.deepEqual(rows[0], {
      object_key: "salesOrder", action_key: "readCoordinatedVisits",
      action_kind: "BUSINESS_ACTION", display_label: "Read Coordinated Visits",
    });
    const grants = await pool.query(`
      SELECT r.key FROM eos_policy.role_capabilities rc
        JOIN eos_policy.capabilities c ON c.id = rc.capability_id
        JOIN eos_policy.roles r ON r.id = rc.role_id
       WHERE c.key = $1 ORDER BY r.key`, [CAP]);
    assert.deepEqual(grants.rows.map((r) => r.key), deriveLegacyRoleGrants([CAP]).map((g) => g.roleKey).sort(),
      "exactly the Roles the governed catalog already gave it -- no widening, no narrowing");
  });

  await t.test("CRED SAFETY: the two Sales Order reads never satisfy each other", async () => {
    const capabilities = await repo.listCapabilities();
    const coordinated = resolveObjectAction(capabilities, "salesOrder", "readCoordinatedVisits");
    const generic = resolveObjectAction(capabilities, "salesOrder", "read");
    assert.notEqual(coordinated.id, generic.id, "two capabilities, not one");
    assert.equal(coordinated.key, CAP);
    assert.equal(generic.key, "salesOrder.read");
    assert.equal(generic.actionKind, "READ");
    assert.equal(coordinated.actionKind, "BUSINESS_ACTION");

    const holding = (capabilityId) => objectActionsForPrincipal(effectiveCapabilities({
      tenantId: tenant.id, principalId: "synthetic:cred-safety",
      roleDerivedCapabilityIds: [capabilityId], directCapabilityIds: [], capabilities,
    }));

    // DIRECTION 1 -- the coordinated-visit read does not confer a generic Sales Order Read.
    const fromCoordinated = holding(coordinated.id).salesOrder;
    assert.deepEqual(fromCoordinated, ["readCoordinatedVisits"]);
    assert.equal(fromCoordinated.includes("read"), false,
      "holding the coordinated-visit read must NOT satisfy salesOrder READ");

    // DIRECTION 2 -- and a generic Sales Order Read does not confer the coordinated-visit read.
    const fromGeneric = holding(generic.id).salesOrder;
    assert.deepEqual(fromGeneric, ["read"]);
    assert.equal(fromGeneric.includes("readCoordinatedVisits"), false,
      "holding salesOrder.read must NOT satisfy the coordinated-visit read");

    // The Object projects both, distinctly -- the separation is visible to an administrator rather
    // than hidden inside the resolver.
    const onSalesOrder = actionsForObject(capabilities, "salesOrder").map((c) => c.actionKey);
    assert.ok(onSalesOrder.includes("read") && onSalesOrder.includes("readCoordinatedVisits"),
      "non-vacuity: both actions are declared on the same Object");
  });

  await t.test("the re-home reverses exactly, and the retirement is a documented no-op", async () => {
    migrate(dbUrl, ["down", STEPS_TO_THIS_MIGRATION]);
    const caps = await pool.query("SELECT count(*)::int n FROM eos_policy.capabilities WHERE key = $1", [CAP]);
    assert.equal(caps.rows[0].n, 0, "the additive half reverses");
    const grants = await pool.query(
      "SELECT count(*)::int n FROM eos_policy.role_capabilities WHERE granted_by = 'migration:1761955200000'");
    assert.equal(grants.rows[0].n, 0, "and takes its grants with it");
    // The retirement does NOT come back -- reversing a retirement is a forward decision.
    const objects = await pool.query("SELECT count(*)::int n FROM eos_policy.objects WHERE key = ANY($1)", [RETIRED]);
    assert.equal(objects.rows[0].n, 0, "FORWARD_CORRECTION_REQUIRED, not a silent resurrection");
    migrate(dbUrl, ["up", STEPS_TO_THIS_MIGRATION]);
    const back = await pool.query("SELECT count(*)::int n FROM eos_policy.capabilities WHERE key = $1", [CAP]);
    assert.equal(back.rows[0].n, 1, "and up restores it");
  });
});
