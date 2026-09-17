// SECURITY ROLE ASSIGNMENT CENSUS -- the integration proofs over REAL readers.
//
//   POLICY_TEST_DATABASE_URL set     the PostgreSQL policy reader produces the same census as the in-memory one for
//                                    the same world (ids normalized), and the CLI's pool is READ ONLY at the database.
//   + FIRESTORE_EMULATOR_HOST set    the CLI's Firestore legacy reader over an emulator produces the SAME census, to
//                                    the checksum, as the array reader over the same documents.
//
// Each layer SKIPS loudly when its store is absent. The emulator layer uses a `demo-` project id, which the Firebase
// SDK only ever resolves to an emulator, and it refuses to run unless FIRESTORE_EMULATOR_HOST is a loopback address.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import pg from "pg";
import { declaredSchemas } from "./support/migrationSchema.mjs";
import { InMemoryPolicyRepository } from "../lib/adminPolicy/inMemoryPolicyRepository.js";
import { PostgresPolicyRepository } from "../lib/adminPolicy/postgresPolicyRepository.js";
import { resolvePolicyDatabaseConfig } from "../lib/adminPolicy/policyDatabase.js";
import { buildRoleAssignmentCensus, canonicalJson } from "../lib/adminPolicy/migration/roleAssignmentCensus.js";
import {
  CENSUS_TENANT_KEY, LEGACY_ASSIGNMENTS, LEGACY_PRIVILEGED_REQUESTS, LEGACY_USERS, arrayLegacyReader, seedPolicyWorld,
} from "./support/roleAssignmentCensusFixture.mjs";

const require = createRequire(import.meta.url);
const URL = process.env.POLICY_TEST_DATABASE_URL;
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;
const PG_SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set";
const EMULATOR_SKIP = !URL ? PG_SKIP
  : !EMULATOR ? "FIRESTORE_EMULATOR_HOST is not set -- the Firestore reader layer needs an emulator"
  : !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(EMULATOR) ? `FIRESTORE_EMULATOR_HOST=${EMULATOR} is not loopback; refusing`
  : false;

async function resetDatabase() {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  for (const schema of declaredSchemas()) await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await client.query("DROP TABLE IF EXISTS pgmigrations");
  await client.end();
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    env: { ...process.env, DATABASE_URL: URL }, stdio: "pipe",
  });
}

/**
 * Replace every store-generated id (Principal, Role, assignment) with a token derived from natural keys, then sort
 * every array canonically -- so two adapters' censuses of the same world compare equal exactly when their FACTS do.
 */
async function normalize(census, repo) {
  const tokens = new Map();
  for (const r of census.postgres.rows) {
    tokens.set(r.principalId, `principal<${r.subject}>`);
    tokens.set(r.assignmentId, `assignment<${r.subject}|${r.roleKey}|${r.scopeType}|${r.scopeValue ?? ""}|${r.status}>`);
  }
  for (const r of census.firestore.rows) if (r.principalId) tokens.set(r.principalId, `principal<${r.subject}>`);
  for (const p of census.identity.principalsWithoutActiveMembership) tokens.set(p.principalId, `principal<${p.subject}>`);
  for (const role of await repo.listRoles(census.tenant.id)) tokens.set(role.id, `role<${role.key}>`);
  let text = JSON.stringify({ ...census, reportSha256: null });
  for (const [id, token] of [...tokens.entries()].sort((a, b) => b[0].length - a[0].length)) text = text.split(id).join(token);
  const sortDeep = (v) => Array.isArray(v) ? v.map(sortDeep).sort((a, b) => (canonicalJson(a) < canonicalJson(b) ? -1 : 1))
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sortDeep(x)])) : v;
  return sortDeep(JSON.parse(text));
}

test("the PostgreSQL policy reader yields the same census as the in-memory reader for the same world", { skip: PG_SKIP }, async () => {
  await resetDatabase();
  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: URL, max: 2 }));
  try {
    const pgRepo = new PostgresPolicyRepository(pool);
    await seedPolicyWorld(pgRepo);
    // Distinctive in-memory ids, so normalization can never rewrite an unrelated substring.
    let n = 0;
    const memRepo = new InMemoryPolicyRepository({ nextId: () => `memid${String(++n).padStart(6, "0")}` });
    await seedPolicyWorld(memRepo);

    const fromPg = await buildRoleAssignmentCensus({ legacy: arrayLegacyReader(), policy: pgRepo, tenantKey: CENSUS_TENANT_KEY });
    const fromMemory = await buildRoleAssignmentCensus({ legacy: arrayLegacyReader(), policy: memRepo, tenantKey: CENSUS_TENANT_KEY });
    assert.deepEqual(await normalize(fromPg, pgRepo), await normalize(fromMemory, memRepo));
    assert.equal(fromPg.summary.onlyInFirestore, 5);
    assert.equal(fromPg.summary.onlyInPostgres, 2);

    // Through the CLI's own pool: every transaction READ ONLY at the database, and the census still runs over it.
    const { openReadOnlyPolicyPool } = require("../scripts/roleAssignmentCensusCli.js");
    const readOnly = openReadOnlyPolicyPool(URL);
    try {
      await assert.rejects(readOnly.query("INSERT INTO eos_policy.tenants (id, key, name) VALUES ('x', 'x', 'x')"), (err) => err.code === "25006");
      const viaReadOnly = await buildRoleAssignmentCensus({ legacy: arrayLegacyReader(), policy: new PostgresPolicyRepository(readOnly), tenantKey: CENSUS_TENANT_KEY });
      assert.equal(viaReadOnly.reportSha256, fromPg.reportSha256);
    } finally {
      await readOnly.end();
    }
  } finally {
    await pool.end();
  }
});

test("the Firestore legacy reader over an emulator yields the SAME census, to the checksum, as the array reader", { skip: EMULATOR_SKIP }, async () => {
  const PROJECT = "demo-role-census";
  // Clear the emulator's documents for this demo project only.
  const cleared = await fetch(`http://${EMULATOR}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  assert.ok(cleared.ok, `emulator reset: ${cleared.status}`);

  const { initializeApp, deleteApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = initializeApp({ projectId: PROJECT }, `role-census-test-${Date.now()}`);
  await resetDatabase();
  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: URL, max: 2 }));
  try {
    const db = getFirestore(app);
    // The TEST writes the fixture into the emulator; the CLI under test performs reads only.
    const extra = { grantedBy: "uid-fixture", note: "ignored" };
    for (const d of LEGACY_ASSIGNMENTS) await db.collection("roleAssignments").doc(d.id).set({ ...d.data, ...extra });
    for (const d of LEGACY_USERS) await db.collection("users").doc(d.id).set({ ...d.data, displayName: "Synthetic" });
    for (const d of LEGACY_PRIVILEGED_REQUESTS) await db.collection("privilegedRoleRequests").doc(d.id).set(d.data);

    const repo = new PostgresPolicyRepository(pool);
    await seedPolicyWorld(repo);
    const { createFirestoreLegacyReader } = require("../scripts/roleAssignmentCensusCli.js");
    const fromEmulator = await buildRoleAssignmentCensus({ legacy: createFirestoreLegacyReader(db), policy: repo, tenantKey: CENSUS_TENANT_KEY });
    const fromArrays = await buildRoleAssignmentCensus({ legacy: arrayLegacyReader(), policy: repo, tenantKey: CENSUS_TENANT_KEY });
    assert.equal(fromEmulator.reportSha256, fromArrays.reportSha256);
    assert.deepEqual(fromEmulator, fromArrays);
    assert.doesNotMatch(JSON.stringify(fromEmulator), /Synthetic|uid-fixture/, "fields the census does not consult never enter the report");
  } finally {
    await pool.end();
    await deleteApp(app);
  }
});
