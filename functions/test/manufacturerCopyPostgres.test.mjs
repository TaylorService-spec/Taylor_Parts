// scripts/manufacturerCopy.js, END TO END against a real PostgreSQL (Firebase exit F5 precondition).
//
// The operator CLI, run as a subprocess exactly as on Render: the default mode is a READ-ONLY dry run; copy inserts
// only, as an EOS Principal, bound to the reviewed checksum; a rerun inserts nothing; a tenant row that differs is a
// CONFLICT that refuses the whole copy and is never overwritten; verify compares and repairs nothing.
import { endPoolAndDrain } from "./support/poolTeardown.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { hash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DB_NAME = `mfr_copy_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => { const u = new URL(URL_BASE); u.pathname = `/${DB_NAME}`; return u.toString(); };

const doc = (id, name, status = "ACTIVE") => ({ id, data: { manufacturerId: id, name, normalizedName: name.toUpperCase(), status } });
const snapshotOf = (manufacturers) => ({
  format: "EOS_CATALOG_SNAPSHOT", version: 1,
  source: { firebaseProjectId: "eos-platform-sandbox", exportedAt: "2026-10-17T00:00:00.000Z" },
  parts: [], equipmentModels: [], manufacturers,
});

test("STATIC: the copy tool is insert-only and loads no Firebase module", () => {
  const code = readFileSync(join(FUNCTIONS_DIR, "scripts/manufacturerCopy.js"), "utf8").replace(/^\s*\/\/.*$/gm, "");
  for (const banned of [/\bUPDATE\s+eos_ops/i, /\bDELETE\b/i, /\bTRUNCATE\b/i, /require\(["'][^"']*firebase/i, /exportCatalogSnapshot/]) {
    assert.doesNotMatch(code, banned);
  }
});

test("manufacturer copy CLI, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const admin = new pg.Client({ connectionString: URL_BASE });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${DB_NAME}`);
  await admin.end();
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"],
    { maxBuffer: 256 * 1024 * 1024, cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe" });
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 4 });
  const dir = mkdtempSync(join(tmpdir(), "mfr-copy-"));
  t.after(async () => {
    rmSync(dir, { recursive: true, force: true });
    await endPoolAndDrain(pool);
    const c = new pg.Client({ connectionString: URL_BASE });
    await c.connect();
    await c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await c.end();
  });
  const q = (text, values = []) => pool.query(text, values);
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t-mfr', 'taylor-nonprod', 'copy proof'), ('t-other', 'other', 'other')`);
  await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ('p-op', 'p-op', 'proof', 'active'), ('p-out', 'p-out', 'proof', 'active')`);
  await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ('m-op', 't-mfr', 'p-op'), ('m-out', 't-other', 'p-out')`);

  const run = (snapshot, extra = []) => {
    const file = join(dir, `${randomUUID()}.json`);
    const text = JSON.stringify(snapshot);
    writeFileSync(file, text);
    writeFileSync(`${file}.sha256`, `${hash("sha256", text)}  snapshot.json\n`);
    const res = spawnSync(process.execPath, ["scripts/manufacturerCopy.js", "--environment", "platform-sandbox", "--databaseUrlEnv", "MFR_TEST_DB",
      "--tenantKey", "taylor-nonprod", "--snapshot", file, ...extra],
    { cwd: FUNCTIONS_DIR, encoding: "utf8", env: { ...process.env, EOS_ENVIRONMENT: "nonprod", MFR_TEST_DB: dbUrl() } });
    return { status: res.status, json: res.stdout ? JSON.parse(res.stdout) : null, err: res.stderr };
  };
  const rows = async () => (await q(`SELECT id, name, normalized_name, status, provenance, created_by FROM eos_ops.manufacturers WHERE tenant_id = 't-mfr' ORDER BY id`)).rows;
  const snap = snapshotOf([doc("m-taylor", "Taylor  Company"), doc("m-icetro", "Icetro", "INACTIVE")]);

  await t.test("the default is a READ-ONLY dry run that prints the checksum the copy needs", async () => {
    const dry = run(snap);
    assert.equal(dry.status, 0, dry.err);
    assert.equal(dry.json.mode, "dryrun");
    assert.equal(dry.json.readOnly, true);
    assert.deepEqual([dry.json.report.copyable, dry.json.report.applyable], [2, true]);
    assert.match(dry.json.report.checksum, /^[0-9a-f]{64}$/);
    assert.deepEqual(await rows(), [], "a dry run writes nothing");
    assert.ok(!(dry.err + JSON.stringify(dry.json)).includes(URL_BASE), "the database URL leaked");
  });

  await t.test("copy needs the reviewed checksum and a member Principal; a wrong checksum writes nothing", async () => {
    const checksum = run(snap).json.report.checksum;
    assert.match(run(snap, ["--mode", "copy", "--principalId", "p-op"]).err, /--reviewedChecksum is required/);
    const drift = run(snap, ["--mode", "copy", "--principalId", "p-op", "--reviewedChecksum", "0".repeat(64)]);
    assert.equal(drift.status, 2);
    assert.match(drift.err, /SOURCE_CHECKSUM_DRIFT/);
    const outsider = run(snap, ["--mode", "copy", "--principalId", "p-out", "--reviewedChecksum", checksum]);
    assert.equal(outsider.status, 2);
    assert.match(outsider.err, /not an active member/);
    assert.deepEqual(await rows(), []);
  });

  await t.test("copy inserts MIGRATED rows as the Principal; a rerun is a no-op; verify passes", async () => {
    const checksum = run(snap).json.report.checksum;
    const copy = run(snap, ["--mode", "copy", "--principalId", "p-op", "--reviewedChecksum", checksum]);
    assert.equal(copy.status, 0, copy.err);
    assert.deepEqual([copy.json.outcome, copy.json.inserted], ["APPLIED", 2]);
    assert.deepEqual(await rows(), [
      { id: "m-icetro", name: "Icetro", normalized_name: "ICETRO", status: "INACTIVE", provenance: "MIGRATED", created_by: "p-op" },
      { id: "m-taylor", name: "Taylor  Company", normalized_name: "TAYLOR COMPANY", status: "ACTIVE", provenance: "MIGRATED", created_by: "p-op" },
    ]);
    const again = run(snap, ["--mode", "copy", "--principalId", "p-op", "--reviewedChecksum", checksum]);
    assert.deepEqual([again.status, again.json.outcome, again.json.inserted], [0, "NO_CHANGE", 0]);
    const verify = run(snap, ["--mode", "verify"]);
    assert.equal(verify.status, 0, verify.err);
    assert.deepEqual([verify.json.report.sourceCount, verify.json.report.targetCount, verify.json.report.pass], [2, 2, true]);
  });

  await t.test("a tenant row that differs is a CONFLICT: the whole copy refuses and the row is never overwritten", async () => {
    await q(`UPDATE eos_ops.manufacturers SET name = 'Taylor Co (edited in EOS)' WHERE tenant_id = 't-mfr' AND id = 'm-taylor'`);
    const grown = snapshotOf([...snap.manufacturers, doc("m-kold", "Kold")]);
    const dry = run(grown);
    assert.equal(dry.status, 1);
    assert.deepEqual([dry.json.report.conflictIds, dry.json.report.copyable], [["m-taylor"], 1]);
    const copy = run(grown, ["--mode", "copy", "--principalId", "p-op", "--reviewedChecksum", dry.json.report.checksum]);
    assert.equal(copy.status, 2);
    assert.match(copy.err, /TARGET_CONFLICT/);
    assert.deepEqual((await rows()).map((r) => [r.id, r.name]), [["m-icetro", "Icetro"], ["m-taylor", "Taylor Co (edited in EOS)"]]);
    const verify = run(grown, ["--mode", "verify"]);
    assert.equal(verify.status, 1);
    assert.deepEqual([verify.json.report.missingInTarget, verify.json.report.differing], [["m-kold"], ["m-taylor"]]);
  });

  await t.test("a snapshot without a manufacturers section, or a BLOCKED record, refuses", async () => {
    const { manufacturers, ...old } = snap;
    assert.ok(manufacturers);
    assert.match(run(old).err, /no `manufacturers` section/);
    const bad = run(snapshotOf([doc("m-x", "X", "RETIRED")]));
    assert.equal(bad.status, 1);
    assert.deepEqual(bad.json.report.blockedRecords, [{ id: "m-x", blockers: ["STATUS_UNKNOWN"] }]);
  });
});
