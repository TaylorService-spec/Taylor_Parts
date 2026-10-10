// PROTECTED ADMINISTRATOR AUDIT PROVENANCE across EVERY direct audit writer (DECISIONS #225 / PR-3).
//
// PR-1 stamped the Administration repository and the Workforce kernel. Every OTHER direct writer of eos_policy.audit_events
// (configuration, catalog, purchasing, inventory, rental, finance, scheduling, workforce catalogs, preview) now records
// `after.authorizedBy` = the protected-Administrator marker when -- and only when -- the acting principal has standing,
// through ONE helper (administrationReach.withActorAuthority). Operator migration / cutover / copy tooling and fixtures
// have no acting principal with standing and are listed explicitly as exempt.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";

const require = createRequire(import.meta.url);
const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const T = "t-paudit";

/** Writers that are NOT actor-driven (operator tooling, cutovers, fixtures) or stamp by their own PR-1 path. */
const EXEMPT = new Set([
  "adminPolicy/postgresPolicyRepository.ts",          // PR-1: appendAudit merges actorAuthority
  "eosWorkforce/commands/employeeCommandKernel.ts",   // PR-1: its own standing read
  "eosOps/migration/inventoryBaselineCutover.ts",
  "eosWorkforce/migration/tenantOperatingCompanies.ts",
  "eosWorkforce/migration/jobRoleCatalogSeed.ts",
  "eosWorkforce/migration/employeeProfileCutover.ts",
  "eosOps/migration/reorderPurchaseOrderMigrationCopy.ts",
  "eosOps/migration/reorderObjectMigrationCopy.ts",
  "eosOps/migration/reorderAssignmentMigrationCopy.ts",
  "crm/crmCutoverCopy.ts",
  "commercialMigration/commercialC5Target.ts",
  "catalogMaster/catalogCutover.ts",
  "eosOps/syntheticAcceptanceWarehouse.ts",
]);

test("every actor-driven direct audit writer records Administrator provenance through the one helper", () => {
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".ts")) files.push(p); } };
  walk(SRC);
  const missing = [];
  let writers = 0;
  for (const f of files) {
    const rel = f.slice(SRC.length + 1);
    const src = readFileSync(f, "utf8");
    // The literal schema or a templated one (`${SCHEMA}.audit_events`) -- both are direct writers.
    const inserts = (src.match(/INSERT INTO\s+(?:eos_policy|\$\{[^}]+\})\.audit_events/g) ?? []).length;
    if (inserts === 0 || EXEMPT.has(rel)) continue;
    writers += 1;
    const stamped = (src.match(/withActorAuthority\(/g) ?? []).length;
    if (stamped < inserts) missing.push(`${rel}: ${inserts} insert(s), ${stamped} stamped`);
  }
  assert.deepEqual(missing, [], "a direct audit writer does not record Administrator provenance");
  assert.ok(writers >= 28, `covered ${writers} writer files`);
  for (const rel of EXEMPT) assert.ok(files.some((f) => f.endsWith(rel)), `stale exemption: ${rel}`);
});

test("withActorAuthority: standing stamps a record; nothing else changes", { skip: SKIP, concurrency: false }, async (t) => {
  const { pool, repo, person } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: T, prefix: "paudit" });
  const { withActorAuthority } = require("../lib/eosOps/administrationReach.js");
  const { PROTECTED_ADMINISTRATOR } = require("../lib/adminPolicy/protectedAdministrator.js");
  const { resolveOperationalContext } = require("../lib/eosOps/capabilityAuthority.js");
  const { postgresGrantConditionProvider } = require("../lib/eosOps/entitledActionAuthority.js");
  const { createJobRole } = require("../lib/eosWorkforce/commands/employeeJobRoleCommands.js");
  const ctxOf = (subject) => resolveOperationalContext(repo, pool, { identityProvider: "firebase", externalSubject: subject, requestedTenantId: null }, postgresGrantConditionProvider(pool));
  const admin = await ctxOf("uid-paudit-admin");
  const adminId = admin.principalContext.uid;
  const dispatcher = await person("uid-paudit-disp", ["dispatcher"]);

  await t.test("a standing actor's record is stamped; a non-standing actor's is not; non-records and existing stamps are untouched", async () => {
    const stamped = await withActorAuthority(pool, T, adminId, { a: 1 });
    assert.equal(stamped.authorizedBy.standing, PROTECTED_ADMINISTRATOR);
    assert.deepEqual(await withActorAuthority(pool, T, dispatcher.principalId, { a: 1 }), { a: 1 });
    assert.equal(await withActorAuthority(pool, T, adminId, null), null);
    assert.deepEqual(await withActorAuthority(pool, T, adminId, [1]), [1]);
    const r1 = { a: 1, authorizedBy: { capabilityKey: "admin.administratorRole.assign" } };
    assert.equal(await withActorAuthority(pool, T, adminId, r1), r1);
    assert.deepEqual(await withActorAuthority(pool, "t-not-a-tenant", adminId, { a: 1 }), { a: 1 }, "no standing in another tenant");
  });

  await t.test("end to end: an Administrator's Job Role catalog write carries the provenance", async () => {
    const actor = { tenantId: T, principalId: adminId, capabilities: admin.capabilities, conditionallyHeld: admin.conditionallyHeld,
      scopedHeld: admin.scopedHeld, entitlements: admin.entitlements };
    await createJobRole({ pool }, actor, { jobRoleId: "padmin-audit-role", displayName: "PR-3 audit role" });
    const { rows } = await pool.query(`SELECT after FROM eos_policy.audit_events WHERE tenant_id = $1 AND target_id = 'padmin-audit-role'`, [T]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].after.authorizedBy.standing, PROTECTED_ADMINISTRATOR);
  });
});
