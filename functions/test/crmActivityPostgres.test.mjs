// CRM ACTIVITY / NOTES ON EOS CORE (Firebase exit F7b, DECISIONS #243), against a real PostgreSQL.
//
// The Firestore behaviour kept (types, required Account, references by id, body bound, occurredAt vs createdAt, one key per
// actor = one activity, most-recent-first, a list longer than its limit answered "unavailable"); the read never wider than
// the Account read (crm.activity.read AND customer.record.read, the Account in this tenant); one audit row per create; the
// migration mirrors exactly the current holders; the Owner-gated copy CLI end to end.
import { endPoolAndDrain } from "./support/poolTeardown.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { hash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const require = createRequire(import.meta.url);
const A = require("../lib/eosCrm/crmActivityAuthority.js");
const { CRM_OPERATIONS } = require("../lib/eosCrm/crmHttp.js");
const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const T = "t-crmact";

test("the CRM route serves the two activity operations, and the migration mirrors exactly the current Firebase holders", () => {
  assert.ok(CRM_OPERATIONS.includes("listAccountActivities") && CRM_OPERATIONS.includes("createAccountActivity"));
  assert.deepEqual([...A.CRM_ACTIVITY_TYPES], ["SALES_NOTE", "CALL", "MEETING", "RELATIONSHIP", "GENERAL"]);
  const sql = readFileSync(join(FUNCTIONS_DIR, "migrations/1764590000000_crm-activity.sql"), "utf8");
  assert.match(sql, /r\.key IN \('admin', 'owner', 'crmActivityContributor'\)/, "no new holder: exactly the three the Firebase catalog grants");
});

test("CRM activity, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `crmact_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const url = (() => { const u = new URL(URL_BASE); u.pathname = `/${name}`; return u.toString(); })();
  const admin = new pg.Client({ connectionString: URL_BASE });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"],
    { maxBuffer: 256 * 1024 * 1024, cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  const pool = new pg.Pool({ connectionString: url, max: 6 });
  t.after(async () => {
    await endPoolAndDrain(pool);
    const c = new pg.Client({ connectionString: URL_BASE });
    await c.connect();
    await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await c.end();
  });
  const q = (sql, v = []) => pool.query(sql, v);
  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1), ('t-other','t-other','t-other')`, [T]);
  for (const [pid, tenant] of [["p-rep", T], ["p-reader", T], ["p-other", "t-other"]]) {
    await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status) VALUES ($1,$1,'eos','active')`, [pid]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status) VALUES ($1,$2,$3,'active')`, [`m-${pid}`, tenant, pid]);
  }
  await q(`INSERT INTO eos_crm.accounts (id,tenant_id,name,status,created_by,updated_by) VALUES ('acct-1',$1,'Harbor Diner','ACTIVE','f','f'),
                                                                                         ('acct-2',$1,'Quiet Cafe','ACTIVE','f','f')`, [T]);
  await q(`INSERT INTO eos_crm.accounts (id,tenant_id,name,status,created_by,updated_by) VALUES ('acct-x','t-other','Elsewhere','ACTIVE','f','f')`);
  const caps = (...k) => new Set(k);
  const rep = { tenantId: T, principalId: "p-rep", capabilities: caps("crm.activity.read", "crm.activity.create", "customer.record.read") };
  const activityOnly = { tenantId: T, principalId: "p-reader", capabilities: caps("crm.activity.read") };
  const accountOnly = { tenantId: T, principalId: "p-reader", capabilities: caps("customer.record.read") };
  const deps = { pool };
  const refusal = async (fn) => { try { await fn(); return null; } catch (e) { return [e.code, e.category]; } };
  const counts = async () => (await q(`SELECT (SELECT count(*) FROM eos_crm.activities)::int AS a,
      (SELECT count(*) FROM eos_policy.audit_events WHERE target_kind = 'crm_activity')::int AS au`)).rows[0];

  await t.test("CREATE: one row + one audit row; a retry under the same key is the same activity", async () => {
    const before = await counts();
    const r = await A.createAccountActivity(deps, rep, { accountId: "acct-1", type: "CALL", body: "  Called about the cooler  ", idempotencyKey: "k1" });
    assert.deepEqual([r.success, r.replayed], [true, false]);
    assert.deepEqual(await counts(), { a: before.a + 1, au: before.au + 1 });
    const again = await A.createAccountActivity(deps, rep, { accountId: "acct-1", type: "CALL", body: "Called about the cooler", idempotencyKey: "k1" });
    assert.deepEqual([again.replayed, again.activityId], [true, r.activityId]);
    assert.deepEqual(await counts(), { a: before.a + 1, au: before.au + 1 }, "a replay writes nothing");
  });

  await t.test("CREATE refusals: capability, a missing or other-tenant Account, an unknown type, a future occurredAt, a long body", async () => {
    const before = await counts();
    assert.deepEqual(await refusal(() => A.createAccountActivity(deps, accountOnly, { accountId: "acct-1", type: "CALL", body: "x", idempotencyKey: "k2" })),
      ["CAPABILITY_REQUIRED", "FORBIDDEN"]);
    assert.deepEqual(await refusal(() => A.createAccountActivity(deps, rep, { accountId: "acct-x", type: "CALL", body: "x", idempotencyKey: "k3" })),
      ["ACCOUNT_NOT_FOUND", "NOT_FOUND"], "another tenant's Account reads as absent");
    assert.deepEqual(await refusal(() => A.createAccountActivity(deps, rep, { accountId: "acct-1", type: "TASK", body: "x", idempotencyKey: "k4" })),
      ["TYPE_INVALID", "INVALID_INPUT"]);
    assert.deepEqual(await refusal(() => A.createAccountActivity(deps, rep, { accountId: "acct-1", type: "CALL", body: "x", idempotencyKey: "k5",
      occurredAtMillis: Date.now() + 60 * 60 * 1000 })), ["OCCURRED_AT_FUTURE", "INVALID_INPUT"]);
    assert.deepEqual(await refusal(() => A.createAccountActivity(deps, rep, { accountId: "acct-1", type: "CALL", body: "x".repeat(4001), idempotencyKey: "k6" })),
      ["BODY_TOO_LONG", "INVALID_INPUT"]);
    assert.deepEqual(await counts(), before, "no refusal wrote anything");
  });

  await t.test("READ: never wider than the Account read -- both keys, the Account in this tenant; most recent first; backdating kept", async () => {
    const backdated = Date.now() - 3 * 24 * 60 * 60 * 1000;
    await A.createAccountActivity(deps, rep, { accountId: "acct-1", type: "MEETING", body: "Site visit", occurredAtMillis: backdated, idempotencyKey: "k7",
      contactId: "ct-9", opportunityId: "opp-3" });
    assert.deepEqual(await refusal(() => A.listAccountActivities(deps, activityOnly, { accountId: "acct-1" })), ["CAPABILITY_REQUIRED", "FORBIDDEN"],
      "crm.activity.read alone does not read an Account's activity");
    assert.deepEqual(await refusal(() => A.listAccountActivities(deps, accountOnly, { accountId: "acct-1" })), ["CAPABILITY_REQUIRED", "FORBIDDEN"]);
    assert.deepEqual(await refusal(() => A.listAccountActivities(deps, rep, { accountId: "acct-x" })), ["ACCOUNT_NOT_FOUND", "NOT_FOUND"]);
    const list = await A.listAccountActivities(deps, rep, { accountId: "acct-1" });
    assert.equal(list.status, "ready");
    assert.deepEqual(list.activities.map((a) => a.type), ["CALL", "MEETING"], "most recent INTERACTION first, not recording order");
    const meeting = list.activities[1];
    assert.equal(meeting.occurredAtMillis, backdated);
    assert.ok(meeting.createdAtMillis > meeting.occurredAtMillis, "occurredAt and createdAt stay two facts");
    assert.deepEqual([meeting.contactId, meeting.opportunityId, meeting.salesOrderId, meeting.createdByUid], ["ct-9", "opp-3", null, "p-rep"]);
    assert.deepEqual(await A.listAccountActivities(deps, rep, { accountId: "acct-1", limit: 1 }), { status: "unavailable", activities: [] },
      "a list longer than its limit is never a partial 'ready'");
    assert.deepEqual(await A.listAccountActivities(deps, rep, { accountId: "acct-2" }), { status: "ready", activities: [] });
  });

  await t.test("the table refuses what the command refuses", async () => {
    const ins = (over) => q(`INSERT INTO eos_crm.activities (tenant_id,id,account_id,type,body,occurred_at,created_by,idempotency_key,provenance)
      VALUES ($1,$2,'acct-1',$3,'b',now(),$4,$5,$6)`, [T, over.id, over.type ?? "CALL", over.by === undefined ? "p" : over.by, over.key === undefined ? "k" : over.key, over.prov ?? "NATIVE"]);
    await assert.rejects(() => ins({ id: "z1", type: "TASK" }), /activities_type_known/);
    await assert.rejects(() => ins({ id: "z2", by: null }), /activities_native_actor/);
    await ins({ id: "z3", by: null, key: null, prov: "MIGRATED" });
    await q(`DELETE FROM eos_crm.activities WHERE id = 'z3'`);
  });

  await t.test("COPY CLI: census by default (read-only, Account gaps named); copy needs the Owner's go-ahead; rerun no-op; verify", async () => {
    const dir = mkdtempSync(join(tmpdir(), "crmact-copy-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const ts = { $timestamp: { seconds: 1760000000, nanoseconds: 5000000 } };
    const doc = (id, over = {}) => ({ id, data: { accountId: "acct-2", type: "SALES_NOTE", body: "Quoted the unit", occurredAtMillis: 1759990000123,
      createdAt: ts, createdByUid: "firebase-uid-7", contactId: null, opportunityId: null, salesOrderId: null, ...over } });
    const file = (n, v) => { const f = join(dir, n); const s = JSON.stringify(v); writeFileSync(f, s); writeFileSync(`${f}.sha256`, `${hash("sha256", s)}  ${n}\n`); return f; };
    const snap = (docs) => file(`s-${randomUUID()}.json`, { format: "EOS_CRM_ACTIVITY_SNAPSHOT", version: 1,
      source: { firebaseProjectId: "eos-platform-sandbox", exportedAt: "2026-10-17T00:00:00.000Z" }, crmActivities: docs });
    const run = (s, extra = []) => {
      const res = spawnSync(process.execPath, ["scripts/crmActivityCopy.js", "--environment", "platform-sandbox", "--databaseUrlEnv", "CA_TEST_DB",
        "--tenantKey", T, "--snapshot", s, ...extra], { cwd: FUNCTIONS_DIR, encoding: "utf8", env: { ...process.env, EOS_ENVIRONMENT: "nonprod", CA_TEST_DB: url } });
      return { status: res.status, json: res.stdout ? JSON.parse(res.stdout) : null, err: res.stderr };
    };
    const migrated = async () => (await q(`SELECT id, created_by, idempotency_key FROM eos_crm.activities WHERE provenance = 'MIGRATED' ORDER BY id`)).rows;

    const gappy = run(snap([doc("fs-1"), doc("fs-2", { accountId: "acct-gone" })]));
    assert.equal(gappy.status, 1, gappy.err);
    assert.equal(gappy.json.report.accountGaps, 1);
    assert.deepEqual(gappy.json.report.legacyActorProvenance, { "firebase-uid-7": 2 });
    const good = snap([doc("fs-1"), doc("fs-2", { type: "CALL" })]);
    const census = run(good);
    assert.equal(census.status, 0, census.err);
    assert.deepEqual(await migrated(), [], "a census writes nothing");
    const checksum = census.json.report.checksum;
    assert.match(run(good, ["--mode", "copy", "--principalId", "p-rep", "--reviewedChecksum", checksum]).err, /--ownerAuthorization is required/);
    const copy = run(good, ["--mode", "copy", "--principalId", "p-rep", "--reviewedChecksum", checksum, "--ownerAuthorization", "Owner F7b test"]);
    assert.equal(copy.status, 0, copy.err);
    assert.deepEqual([copy.json.outcome, copy.json.inserted], ["APPLIED", 2]);
    assert.deepEqual(await migrated(), [{ id: "fs-1", created_by: null, idempotency_key: null }, { id: "fs-2", created_by: null, idempotency_key: null }],
      "the Firebase actor is evidence, never a column");
    const again = run(good, ["--mode", "copy", "--principalId", "p-rep", "--reviewedChecksum", checksum, "--ownerAuthorization", "Owner F7b test"]);
    assert.deepEqual([again.status, again.json.outcome], [0, "NO_CHANGE"]);
    const verify = run(good, ["--mode", "verify"]);
    assert.equal(verify.status, 0, verify.err);
    assert.equal(verify.json.report.reconciled, true);
    const list = await A.listAccountActivities(deps, rep, { accountId: "acct-2" });
    assert.deepEqual(list.activities.map((a) => [a.id, a.createdByUid]), [["fs-1", null], ["fs-2", null]].sort(), "copied activities read like any other");
    assert.ok(!(copy.err + JSON.stringify(copy.json)).includes(URL_BASE), "the database URL leaked");
  });
});

test("STATIC: the copy tool loads no Firebase module and is insert-only; the exporter only reads crm_activities", () => {
  const strip = (f) => readFileSync(join(FUNCTIONS_DIR, f), "utf8").replace(/^\s*\/\/.*$/gm, "");
  const copy = strip("scripts/crmActivityCopy.js");
  for (const banned of [/\bUPDATE\s+eos_crm/i, /\bDELETE\b/i, /\bTRUNCATE\b/i, /require\(["'][^"']*firebase/i]) assert.doesNotMatch(copy, banned);
  const exporter = strip("scripts/exportCrmActivitySnapshot.js");
  assert.match(readFileSync(join(FUNCTIONS_DIR, "scripts/exportCrmActivitySnapshot.js"), "utf8").split("\n")[0], /^\/\/ FIREBASE_EXIT_MIGRATION_ONLY\r?$/);
  assert.doesNotMatch(exporter, /\.(set|add|update|delete|create|commit|batch|runTransaction|bulkWriter|recursiveDelete)\s*\(/);
  assert.deepEqual([...exporter.matchAll(/\bdb\.(\w+)\(/g)].map((m) => m[1]), ["collection"]);
});
