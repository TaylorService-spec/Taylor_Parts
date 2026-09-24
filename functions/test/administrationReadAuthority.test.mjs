// A READ IS NOT A WRITE -- the Administration read authority, proved against a real database.
//
// ════════════════════ THE DEFECT THIS CLOSES ════════════════════
//
// Administration > Objects, Roles & Permissions, Workflows, Permission Preview and Overview had no
// registered READ capability. The only `rolesPermissions` rows in eos_policy.capabilities were
// `admin.roleAssignment.write` and `admin.accessRequest.decide` -- both ADMIN_ACTION. Gating a read
// surface on either would make "may look at the security matrix" and "may rewrite it" the same
// grant, which is not a smaller mistake than having no gate at all: it hands every reader the
// authority to change what they were only meant to see.
//
// Migration 1762041600000 registers ONE Object-specific read, `admin.securityPolicy.read`
// (rolesPermissions / read / READ). Everything below is a way of proving that it stayed a read.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const surfaceAuthority = require("../lib/adminPolicy/administrationSurfaceAuthority.js");
const {
  ADMINISTRATION_SURFACES,
  ADMINISTRATION_SURFACE_READ_CAPABILITY,
  ADMINISTRATION_READ_CAPABILITY_KEYS,
  ADMINISTRATION_WRITE_CAPABILITY_KEYS,
  administrationSurfacesReadableBy,
  mayReachAdministration,
  mayReadAdministrationSurface,
} = surfaceAuthority;

const THE_READ = "admin.securityPolicy.read";

// ════════════════════ 1. SOURCE LEVEL -- no database needed ════════════════════

test("the Administration surface map names a READ or nothing, never a write", () => {
  // The whole point of the module. If a surface ever came to point at an ADMIN_ACTION, every
  // principal who could open that screen would hold the authority to change what it shows.
  const writes = new Set(ADMINISTRATION_WRITE_CAPABILITY_KEYS);
  const overlap = ADMINISTRATION_READ_CAPABILITY_KEYS.filter((k) => writes.has(k));
  assert.deepEqual(overlap, [], "an Administration surface is gated by a write capability");
  for (const surface of ADMINISTRATION_SURFACES) {
    const required = ADMINISTRATION_SURFACE_READ_CAPABILITY[surface];
    assert.ok(required === null || typeof required === "string", `${surface} has no declared authority`);
    if (typeof required === "string") {
      assert.equal(writes.has(required), false, `${surface} is gated by the write "${required}"`);
      // Nothing may be gated on a key whose NAME says write, either. The shape of the id is not the
      // authority, but a read pointing at `.write` is a mistake worth catching at its cheapest.
      assert.equal(/\.(write|create|edit|publish|version|bindRole|assign|decide|execute|stage)$/.test(required), false,
        `${surface} is gated by "${required}", which names a mutation`);
    }
  }
});

test("only the Overview reads nothing, and it is a disjunction rather than a capability", () => {
  const nulls = ADMINISTRATION_SURFACES.filter((s) => ADMINISTRATION_SURFACE_READ_CAPABILITY[s] === null);
  assert.deepEqual([...nulls], ["overview"],
    "a surface that reads governed data must name the Object capability that governs it");
  // NO BLANKET KEY. The Owner ruling forbids one; this asserts nobody quietly added it back.
  for (const key of ADMINISTRATION_READ_CAPABILITY_KEYS) {
    assert.notEqual(key, "administration.read", "a blanket administration read has been minted");
    assert.ok(key.includes("."), `"${key}" is not a canonical capability key`);
  }
  // The Overview cannot be held by a principal who can open nothing, and cannot be denied to one who
  // can open something. That is the property a derived answer buys over a grantable one.
  assert.equal(mayReadAdministrationSurface([], "overview"), false);
  assert.equal(mayReadAdministrationSurface([THE_READ], "overview"), true);
  assert.equal(mayReachAdministration(["audit.event.read"]), true);
  assert.equal(mayReachAdministration(["admin.roleAssignment.write"]), false,
    "a WRITE must not open the Administration domain by itself");
});

test("every capability the surface map requires is registered by a migration", () => {
  // Read from the migrations, because that is where a capability is born. A surface pointing at a
  // key no migration registers is a surface nobody can ever open, and it would look like a denial.
  const dir = resolve(FUNCTIONS_DIR, "migrations");
  const registered = new Set();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    const up = readFileSync(resolve(dir, file), "utf8")
      .split("-- Down Migration")[0].replace(/^\s*--.*$/gm, "");
    // Scoped to the statements that actually register a capability, so a key merely MENTIONED in
    // a comment or a DELETE list does not count as registered. The shapes the chain uses put the
    // key on its own line or inline, so the collection is per-statement rather than per-line.
    for (const stmt of up.split(";")) {
      if (!/INSERT\s+INTO\s+capabilities/i.test(stmt)) continue;
      for (const m of stmt.matchAll(/'([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)'/g)) registered.add(m[1]);
    }
  }
  assert.ok(registered.size >= 20, `the scan found only ${registered.size} capabilities -- it has stopped matching`);
  const missing = ADMINISTRATION_READ_CAPABILITY_KEYS.filter((k) => !registered.has(k));
  assert.deepEqual(missing, [], "an Administration surface requires a capability no migration registers");
});

test("migration 1762041600000 grants exactly two governed Roles, and no Principal", () => {
  // THE ACCESS DIFF, asserted where it is written rather than only where it lands. A future edit
  // that adds a Role to the VALUES list has to change this line, which is the point.
  const file = resolve(FUNCTIONS_DIR, "migrations/1762041600000_administration-security-policy-read-authority.sql");
  const sql = readFileSync(file, "utf8");
  const upOnly = sql.split("-- Down Migration")[0].replace(/^\s*--.*$/gm, "");
  const grantBlock = upOnly.split(";").find((s) => /INSERT\s+INTO\s+role_capabilities/i.test(s));
  assert.ok(grantBlock, "the migration writes no Role grant at all");
  const pairs = [...grantBlock.matchAll(/\('([A-Za-z][A-Za-z0-9]*)',\s*'([A-Za-z][A-Za-z0-9.]*)'\)/g)]
    .map((m) => `${m[1]} -> ${m[2]}`).sort();
  assert.deepEqual(pairs, [`admin -> ${THE_READ}`, `owner -> ${THE_READ}`]);
  assert.equal(/INSERT\s+INTO\s+principal_capabilities/i.test(upOnly), false,
    "a direct Principal grant is an Administration decision, never a migration's");
  // Idempotent by construction, and no blanket delete rule anywhere in the file.
  assert.match(grantBlock, /ON CONFLICT[\s\S]*DO NOTHING/i);
  assert.equal(/WHERE\s+key\s+NOT\s+IN/i.test(sql.replace(/^\s*--.*$/gm, "")), false,
    "a NOT IN rule deletes real configuration the moment a snapshot lags");
  // And it registers a READ, spelled out, under the Object it names.
  assert.match(upOnly, /'rolesPermissions',\s*'read',\s*'READ',\s*'View Security Policy'/);
});

test("the fail-closed cases are closed", () => {
  assert.equal(mayReadAdministrationSurface(null, "objects"), false);
  assert.equal(mayReadAdministrationSurface(undefined, "objects"), false);
  assert.equal(mayReadAdministrationSurface(new Set(), "objects"), false);
  assert.equal(mayReadAdministrationSurface([THE_READ], "notASurface"), false);
  assert.equal(mayReadAdministrationSurface([THE_READ], ""), false);
  assert.deepEqual([...administrationSurfacesReadableBy(null)], []);
});

// ════════════════════ 2. DATABASE LEVEL -- the real repository ════════════════════

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const migrate = (dbUrl, args) => execFileSync(process.execPath,
  ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", ...args, "--migrations-dir", "migrations", "--no-check-order"],
  { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "pipe" });

test("the Administration read authority, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
  const { bootstrapTenant, bootstrapAdministrator } = require("../lib/adminPolicy/tenantBootstrap.js");
  const { resolvePrincipalContext } = require("../lib/adminPolicy/principalContext.js");
  const commands = require("../lib/adminPolicy/policyCommands.js");
  const objectSecurity = require("../lib/adminPolicy/objectSecurityAuthority.js");
  const { AdministrationDeniedError } = require("../lib/adminPolicy/administrationAuthority.js");
  const { capabilitiesForRoleKeys } = require("../lib/eosOps/capabilityAuthority.js");

  const name = `adminread_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  const dbUrl = dbUrlFor(name);

  // THE ORDER A LIVE DATABASE ACTUALLY SEES. A clean `up` proves the migration runs on a database
  // with NO tenant and therefore NO Objects and NO Roles -- which is every fresh environment, and is
  // where an Object census that refuses instead of skipping would break the chain. Then reverse just
  // this migration, SEED (the seed is what writes Roles and the Object catalogue, and it runs after
  // migrations everywhere real), and re-apply: applying the grant INSERT to an empty `roles` table
  // would prove nothing about who ends up holding it.
  migrate(dbUrl, ["up"]);
  migrate(dbUrl, ["down", "1"]);
  pool = new pg.Pool({ connectionString: dbUrl, max: 6 });
  const repo = new PostgresPolicyRepository(pool);
  const { tenant } = await bootstrapTenant(repo, { key: "taylor-adminread", name: "Taylor", actorUid: "operator" });
  migrate(dbUrl, ["up", "1"]);

  await bootstrapAdministrator(repo, {
    tenantId: tenant.id, externalSubject: "firebase-uid-admin", displayName: "The Administrator",
    performedBy: "operator", reason: "initial administrator",
  });
  const adminContext = await resolvePrincipalContext(repo, { externalSubject: "firebase-uid-admin" });
  const admin = { tenantId: tenant.id, uid: adminContext.uid, heldRoleKeys: adminContext.heldRoleKeys };

  await t.test("the read is registered UNDER the Object it governs", async () => {
    const caps = await repo.listCapabilities();
    const read = caps.find((c) => c.key === THE_READ);
    assert.ok(read, `${THE_READ} is not registered`);
    assert.equal(read.objectKey, "rolesPermissions");
    assert.equal(read.actionKey, "read");
    assert.equal(read.actionKind, "READ");
    assert.equal(read.displayLabel, "View Security Policy");
    // The Object must be one the Administration catalog actually projects, or the grant is
    // unadministrable -- the stranded-capability defect capabilityObjectAuthorityGuard exists for.
    const objects = await repo.listObjects(tenant.id);
    assert.ok(objects.some((o) => o.key === "rolesPermissions"),
      "the read names an Object this tenant's Administration cannot project");
  });

  await t.test("the read and the writes are three DIFFERENT cells of one Object", async () => {
    const caps = await repo.listCapabilities();
    const read = objectSecurity.resolveObjectAction(caps, "rolesPermissions", "read");
    const assign = objectSecurity.resolveObjectAction(caps, "rolesPermissions", "assignRole");
    const decide = objectSecurity.resolveObjectAction(caps, "rolesPermissions", "decideAccessRequest");
    assert.equal(read.key, THE_READ);
    assert.equal(assign.key, "admin.roleAssignment.write");
    assert.equal(decide.key, "admin.accessRequest.decide");
    assert.equal(new Set([read.key, assign.key, decide.key]).size, 3);
    assert.deepEqual([read.actionKind, assign.actionKind, decide.actionKind],
      ["READ", "ADMIN_ACTION", "ADMIN_ACTION"]);
  });

  // ════════════════════ THE GRANT POPULATION, PINNED ════════════════════

  const holdersOf = async (key) => {
    const { rows } = await pool.query(
      `SELECT r.key FROM eos_policy.role_capabilities rc
         JOIN eos_policy.capabilities c ON c.id = rc.capability_id
         JOIN eos_policy.roles r        ON r.id = rc.role_id
        WHERE rc.tenant_id = $1 AND c.key = $2 ORDER BY r.key`, [tenant.id, key]);
    return rows.map((r) => r.key);
  };

  await t.test("the governed Role grants are exactly the reviewed population", async () => {
    // GOVERNED ROLE GRANTS ONLY, and exactly two of them. The other Administration reads were
    // granted by migrations that ran BEFORE the seed in this database, so their holders are not
    // observable here -- they are asserted at source level above and measured in nonprod.
    assert.deepEqual(await holdersOf(THE_READ), ["admin", "owner"],
      "the security policy read must be held by admin and owner and nobody else");
    assert.equal((await holdersOf(THE_READ)).includes("dispatcher"), false,
      "dispatcher's Administration access today comes from a nav placeholder default, not a grant");
    // HELD AT ZERO, DELIBERATELY. Workflow Definition grant decisions are the Owner's --
    // migrationChainSafety asserts no migration may make one -- so Administration > Workflows is
    // correctly gated and readable by nobody until that decision is taken. Pinned so the day it
    // changes, it changes on purpose.
    assert.deepEqual(await holdersOf("workflowDefinition.read"), [],
      "WORKFLOW_DEFINITION_READ_GRANT_IS_OWNER_HELD -- a migration has granted it");
    // And the grant carries its own provenance, so a later withdrawal can tell a migration's grant
    // from an administrator's.
    const { rows } = await pool.query(
      `SELECT count(*)::int n FROM eos_policy.role_capabilities
        WHERE granted_by = 'migration:1762041600000'`);
    assert.equal(rows[0].n, 2);
  });

  await t.test("no direct Principal grant was manufactured", async () => {
    const { rows } = await pool.query("SELECT count(*)::int n FROM eos_policy.principal_capabilities");
    assert.equal(rows[0].n, 0, "a migration wrote a direct Principal grant");
  });

  // ════════════════════ AA3: A READ GRANT CONFERS NO WRITE ════════════════════

  await t.test("a Role holding ONLY the read resolves no write of any kind", async () => {
    await commands.createRole(repo, admin, {
      key: "securityPolicyReader", name: "Security Policy Reader",
      description: "Holds the Administration read and nothing else.", reason: "read/write separation proof",
    });
    await commands.grantObjectActionToRole(repo, admin, {
      roleKey: "securityPolicyReader", objectKey: "rolesPermissions", actionKey: "read",
      reason: "read/write separation proof",
    });

    // THE REAL RESOLVER, not a hand-built set: this is the same call every governed command makes.
    const effective = await capabilitiesForRoleKeys(pool, tenant.id, ["securityPolicyReader"]);
    assert.deepEqual([...effective].sort(), [THE_READ],
      "the read grant dragged something else in with it");
    for (const write of ADMINISTRATION_WRITE_CAPABILITY_KEYS) {
      assert.equal(effective.has(write), false, `holding the read conferred "${write}"`);
    }
    // And it confers nothing OUTSIDE Administration either -- no Customer, no Work Order, no Part.
    const everythingElse = (await repo.listCapabilities())
      .map((c) => c.key).filter((k) => k !== THE_READ);
    assert.deepEqual(everythingElse.filter((k) => effective.has(k)), []);

    // WHAT IT DOES OPEN, and only that.
    assert.deepEqual([...administrationSurfacesReadableBy(effective)],
      ["overview", "objects", "rolesPermissions"]);
    for (const denied of ["users", "workflows", "permissionPreview", "auditLogs"]) {
      assert.equal(mayReadAdministrationSurface(effective, denied), false,
        `the security policy read opened ${denied}, which it does not govern`);
    }
  });

  await t.test("a principal holding only the read is refused by the governed writes", async () => {
    // The Role KEY, not the capability, is what the live commands still check -- so this proves the
    // reader is refused on the path that actually runs today, not only in the capability model.
    const reader = { tenantId: tenant.id, uid: "reader-principal", heldRoleKeys: ["securityPolicyReader"] };
    await assert.rejects(
      () => commands.grantObjectActionToRole(repo, reader, {
        roleKey: "securityPolicyReader", objectKey: "rolesPermissions", actionKey: "assignRole",
      }),
      (err) => err instanceof AdministrationDeniedError,
      "a reader was allowed to grant itself the write");
    await assert.rejects(
      () => commands.createRole(repo, reader, { key: "smuggled", name: "Smuggled" }),
      (err) => err instanceof AdministrationDeniedError,
      "a reader was allowed to define a Role");
    // And the grant table is unchanged by the attempts: the reader still holds exactly the read.
    const after = await capabilitiesForRoleKeys(pool, tenant.id, ["securityPolicyReader"]);
    assert.deepEqual([...after].sort(), [THE_READ], "a refused write still moved a grant");
    assert.deepEqual(await holdersOf(THE_READ), ["admin", "owner", "securityPolicyReader"],
      "the migration's two grants, plus the administrator's own -- and nothing the reader added");
  });

  await t.test("the surface authority answers from capabilities alone, never a Role key", async () => {
    // Resolved through the REAL grant tables. In this database only migration 1762041600000's own
    // grants landed after the seed, so `admin` holds exactly the security policy read -- which makes
    // the point sharply: the answer follows the GRANT, not the fact that the Role is called "admin".
    const adminCaps = await capabilitiesForRoleKeys(pool, tenant.id, ["admin"]);
    assert.equal(adminCaps.has(THE_READ), true);
    assert.equal(mayReadAdministrationSurface(adminCaps, "objects"), true);
    assert.equal(mayReadAdministrationSurface(adminCaps, "rolesPermissions"), true);
    assert.equal(mayReadAdministrationSurface(adminCaps, "overview"), true);
    // Workflows stays shut for the administrator too, because NOBODY holds workflowDefinition.read.
    // A capability model that opened it anyway because the caller was "admin" would be the Role-key
    // authority this subsystem replaced.
    assert.equal(mayReadAdministrationSurface(adminCaps, "workflows"), false);

    const ownerCaps = await capabilitiesForRoleKeys(pool, tenant.id, ["owner"]);
    assert.equal(mayReadAdministrationSurface(ownerCaps, "rolesPermissions"), true);

    const dispatcherCaps = await capabilitiesForRoleKeys(pool, tenant.id, ["dispatcher"]);
    assert.equal(dispatcherCaps.has(THE_READ), false);
    assert.equal(mayReadAdministrationSurface(dispatcherCaps, "rolesPermissions"), false,
      "dispatcher holds no governed read of the security model");
    assert.equal(mayReadAdministrationSurface(dispatcherCaps, "objects"), false);

    const nothing = await capabilitiesForRoleKeys(pool, tenant.id, ["noSuchRole"]);
    assert.equal(nothing.size, 0);
    assert.deepEqual([...administrationSurfacesReadableBy(nothing)], []);
  });

  await t.test("the DOWN refuses to destroy an administrator's grant, and reverses cleanly without one", async () => {
    // A down that deleted a grant an ADMINISTRATOR made would be a migration erasing recorded
    // authority. `securityPolicyReader` above holds the read through the governed command, with the
    // administrator's provenance rather than the migration's, so the down must refuse.
    const failed = (() => {
      try { migrate(dbUrl, ["down", "1"]); return null; } catch (err) { return err; }
    })();
    assert.ok(failed, "the down destroyed an administrator's grant instead of refusing");
    assert.match(String(failed.stderr ?? failed.message), /refuses to reverse/);
    // The refusal is atomic -- every grant, and the capability, are still there.
    assert.deepEqual(await holdersOf(THE_READ), ["admin", "owner", "securityPolicyReader"]);
    const still = await pool.query("SELECT count(*)::int n FROM eos_policy.capabilities WHERE key = $1", [THE_READ]);
    assert.equal(still.rows[0].n, 1);

    // Withdraw the administrator's grant deliberately, and the reverse is then clean and exact.
    await commands.revokeObjectActionFromRole(repo, admin, {
      roleKey: "securityPolicyReader", objectKey: "rolesPermissions", actionKey: "read",
      reason: "withdrawn before reversing",
    });
    migrate(dbUrl, ["down", "1"]);
    assert.deepEqual(await holdersOf(THE_READ), [], "the migration's own grants went with it");
    const gone = await pool.query("SELECT count(*)::int n FROM eos_policy.capabilities WHERE key = $1", [THE_READ]);
    assert.equal(gone.rows[0].n, 0, "the additive half reverses");
    migrate(dbUrl, ["up", "1"]);
    assert.deepEqual(await holdersOf(THE_READ), ["admin", "owner"], "and up restores it exactly");
  });
});
