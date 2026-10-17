from ed import edit
p = "functions/test/returnIntakePostgres.test.mjs"
edit(p, [
("""import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";""",
"""import { execFileSync, spawnSync } from "node:child_process";
import { hash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";"""),
("""    await insert({ key: "x4", provenance: "MIGRATED", receivedBy: null });
  });
});""",
"""    await insert({ key: "x4", provenance: "MIGRATED", receivedBy: null });
    await q(`DELETE FROM eos_ops.inventory_returns WHERE id = 'ret_x4'`);
  });

  // ════════════ the Owner-gated copy (scripts/returnIntakeCopy.js), run as on Render ════════════
  await t.test("COPY CLI: census by default (read-only, gaps named); copy needs the Owner's go-ahead; rerun no-op; verify", async () => {
    const dir = mkdtempSync(join(tmpdir(), "returns-copy-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const ts = { $timestamp: { seconds: 1760000000, nanoseconds: 123456000 } };
    const doc = (key, over = {}) => ({ id: `ret_${key}`, data: { idempotencyKey: key, partId: "PRT-9", source: "CUSTOMER", sourceReference: null,
      condition: "OPENED", reason: null, quantity: 1, serialNumbers: [], state: "AWAITING_DISPOSITION", receivedAt: ts, receivedBy: "firebase-uid-1", ...over } });
    const snapshot = { format: "EOS_RETURNS_SNAPSHOT", version: 1, source: { firebaseProjectId: "eos-platform-sandbox", exportedAt: "2026-10-17T00:00:00.000Z" },
      inventoryReturns: [doc("legacy-1"), doc("legacy-2", { quantity: null, serialNumbers: ["S-1"] })] };
    const file = (name, value) => { const f = join(dir, name); const text = JSON.stringify(value); writeFileSync(f, text); writeFileSync(`${f}.sha256`, `${hash("sha256", text)}  ${name}\\n`); return f; };
    const snap = file("snap.json", snapshot);
    const mapping = (returns) => file(`map-${randomUUID()}.json`, { format: "EOS_RETURNS_COMPANY_MAPPING", version: 1, returns });
    const run = (extra) => {
      const res = spawnSync(process.execPath, ["scripts/returnIntakeCopy.js", "--environment", "platform-sandbox", "--databaseUrlEnv", "RET_TEST_DB",
        "--tenantKey", T, "--snapshot", snap, ...extra], { cwd: FUNCTIONS_DIR, encoding: "utf8", env: { ...process.env, EOS_ENVIRONMENT: "nonprod", RET_TEST_DB: url } });
      return { status: res.status, json: res.stdout ? JSON.parse(res.stdout) : null, err: res.stderr };
    };
    const count = async () => (await q(`SELECT count(*)::int AS n FROM eos_ops.inventory_returns WHERE provenance = 'MIGRATED'`)).rows[0].n;

    const gaps = run([]);
    assert.equal(gaps.status, 1, gaps.err);
    assert.equal(gaps.json.report.mappingGaps.unmapped, 2, "no mapping: every record is a named gap, never a guessed company");
    assert.deepEqual(gaps.json.report.legacyActorProvenance, { "firebase-uid-1": 2 });
    const bad = mapping({ "ret_legacy-1": { operatingCompanyId: "taylor", warehouseId: "wh-v" }, "ret_legacy-2": { operatingCompanyId: "nope" } });
    const badCensus = run(["--mapping", bad]);
    assert.deepEqual([badCensus.json.report.mappingGaps.warehouseCompanyMismatch, badCensus.json.report.mappingGaps.companyNotGoverned], [1, 1]);
    const good = mapping({ "ret_legacy-1": { operatingCompanyId: "taylor", warehouseId: "wh-t" }, "ret_legacy-2": { operatingCompanyId: "ventana" } });
    const census = run(["--mapping", good]);
    assert.equal(census.status, 0, census.err);
    assert.equal(census.json.readOnly, true);
    assert.equal(await count(), 0, "a census writes nothing");
    const checksum = census.json.report.checksum;
    const noOwner = run(["--mode", "copy", "--mapping", good, "--principalId", clerk.principalId, "--reviewedChecksum", checksum]);
    assert.equal(noOwner.status, 2);
    assert.match(noOwner.err, /--ownerAuthorization is required/);
    const drift = run(["--mode", "copy", "--mapping", bad, "--principalId", clerk.principalId, "--reviewedChecksum", checksum, "--ownerAuthorization", "test"]);
    assert.match(drift.err, /SOURCE_CHECKSUM_DRIFT/);
    assert.equal(await count(), 0);
    const copy = run(["--mode", "copy", "--mapping", good, "--principalId", clerk.principalId, "--reviewedChecksum", checksum, "--ownerAuthorization", "Owner F7a test"]);
    assert.equal(copy.status, 0, copy.err);
    assert.deepEqual([copy.json.outcome, copy.json.inserted], ["APPLIED", 2]);
    const rows = (await q(`SELECT id, received_by, created_by, received_at, quantity, serial_numbers FROM eos_ops.inventory_returns WHERE provenance = 'MIGRATED' ORDER BY id`)).rows;
    assert.deepEqual(rows.map((r) => [r.id, r.received_by, r.created_by]), [["ret_legacy-1", null, clerk.principalId], ["ret_legacy-2", null, clerk.principalId]],
      "the Firebase actor is evidence, never a column");
    const again = run(["--mode", "copy", "--mapping", good, "--principalId", clerk.principalId, "--reviewedChecksum", checksum, "--ownerAuthorization", "Owner F7a test"]);
    assert.deepEqual([again.status, again.json.outcome], [0, "NO_CHANGE"]);
    const verify = run(["--mode", "verify", "--mapping", good]);
    assert.equal(verify.status, 0, verify.err);
    assert.equal(verify.json.report.reconciled, true);
    assert.ok(!(copy.err + JSON.stringify(copy.json)).includes(URL_BASE), "the database URL leaked");
  });
});

test("STATIC: the copy tool loads no Firebase module and is insert-only; the exporter only reads inventory_returns", () => {
  const strip = (f) => readFileSync(join(FUNCTIONS_DIR, f), "utf8").replace(/^\\s*\\/\\/.*$/gm, "");
  const copy = strip("scripts/returnIntakeCopy.js");
  for (const banned of [/\\bUPDATE\\s+eos_ops/i, /\\bDELETE\\b/i, /\\bTRUNCATE\\b/i, /require\\(["'][^"']*firebase/i]) assert.doesNotMatch(copy, banned);
  const exporter = strip("scripts/exportReturnIntakeSnapshot.js");
  assert.match(readFileSync(join(FUNCTIONS_DIR, "scripts/exportReturnIntakeSnapshot.js"), "utf8").split("\\n")[0], /^\\/\\/ FIREBASE_EXIT_MIGRATION_ONLY\\r?$/);
  assert.doesNotMatch(exporter, /\\.(set|add|update|delete|create|commit|batch|runTransaction|bulkWriter|recursiveDelete)\\s*\\(/);
  assert.deepEqual([...exporter.matchAll(/\\bdb\\.(\\w+)\\(/g)].map((m) => m[1]), ["collection"]);
  assert.match(exporter, /collection\\(SOURCE_COLLECTION\\)\\.get\\(\\)/);
});"""),
])

edit("functions/test/operatorScriptEnvironmentFence.test.mjs", [
("""// ============================ THE REORDER CUTOVER ============================""",
"""// ============================ THE RETURNS-INTAKE COPY (Firebase exit F7a) ============================
//
// scripts/returnIntakeCopy.js inserts eos_ops.inventory_returns rows (copy). It must refuse before `pg` is resolved, has no
// production mode, and never copies without the Owner's go-ahead or without a person's company mapping. Census is the default.
const RET_COPY = "scripts/returnIntakeCopy.js";
const RET_ARGS = ["--environment", "platform-sandbox", "--databaseUrlEnv", "RET_FENCE_DB", "--tenantKey", "taylor-nonprod", "--snapshot", "/nonexistent/snapshot.json"];
const RET_ENV = { EOS_ENVIRONMENT: "nonprod", RET_FENCE_DB: "postgres://fence:fence@127.0.0.1:1/never" };
const RET_COPY_ARGS = ["--mode", "copy", ...RET_ARGS, "--mapping", "m.json", "--principalId", "p", "--reviewedChecksum", "c"];

for (const [label, args, env, pattern] of [
  ["an unknown mode", ["--mode", "apply", ...RET_ARGS], RET_ENV, /--mode must be one of census \\| copy \\| verify/],
  ["no environment", ["--tenantKey", "t", "--snapshot", "x.json"], RET_ENV, /--environment is required/],
  ["production environment", RET_ARGS.map((a) => (a === "platform-sandbox" ? "taylor-parts-production" : a)), RET_ENV, /production/],
  ["EOS_ENVIRONMENT not nonprod", RET_ARGS, { ...RET_ENV, EOS_ENVIRONMENT: "production" }, /EOS_ENVIRONMENT must read exactly 'nonprod'/],
  ["frozen Certification world", RET_ARGS.map((a) => (a === "platform-sandbox" ? "platform-certification" : a)), RET_ENV, /Certification world, which is frozen/],
  ["no tenant key", ["--environment", "platform-sandbox", "--databaseUrlEnv", "RET_FENCE_DB", "--snapshot", "x.json"], RET_ENV, /--tenantKey is required/],
  ["no snapshot", ["--environment", "platform-sandbox", "--databaseUrlEnv", "RET_FENCE_DB", "--tenantKey", "t"], RET_ENV, /--snapshot <file> is required/],
  ["verify without a company mapping", ["--mode", "verify", ...RET_ARGS], RET_ENV, /--mapping <file> is required/],
  ["copy without the Owner's go-ahead", RET_COPY_ARGS, RET_ENV, /--ownerAuthorization is required for copy/],
  ["copy without an EOS principal", RET_COPY_ARGS.filter((a, i, all) => a !== "--principalId" && all[i - 1] !== "--principalId").concat(["--ownerAuthorization", "o"]), RET_ENV, /--principalId <EOS principal id> is required/],
]) {
  test(`returns-intake copy: refuses (${label}) before any client library loads`, () => {
    const res = runCli(RET_COPY, args, env);
    const out = assertRefusedBeforeAnySdk(res, `returns-intake copy, ${label}`);
    assert.match(out, pattern);
  });
}

// ============================ THE REORDER CUTOVER ============================"""),
])
