import re
from ed import edit
# 1. the e2e suite joins test:adminPolicyPostgres (after catalogReadAuthorizationPostgres)
p = "functions/package.json"
s = open(p, encoding="utf-8", newline="").read()
assert s.count("test/catalogReadAuthorizationPostgres.test.mjs") >= 1
line = [l for l in s.splitlines() if '"test:adminPolicyPostgres"' in l][0]
assert "test/catalogReadAuthorizationPostgres.test.mjs" in line, "not in the postgres suite"
edit(p, [(line, line.replace("test/catalogReadAuthorizationPostgres.test.mjs", "test/catalogReadAuthorizationPostgres.test.mjs test/manufacturerCopyPostgres.test.mjs"))])
# 2. the admin-policy relevance list
edit(".github/ci/eos-admin-policy-paths.txt", [
("functions/scripts/catalogCutover.js\n", "functions/scripts/catalogCutover.js\nfunctions/scripts/manufacturerCopy.js\n"),
("functions/test/catalogReadAuthorizationPostgres.test.mjs\n", "functions/test/catalogReadAuthorizationPostgres.test.mjs\nfunctions/test/manufacturerCopyPostgres.test.mjs\n"),
])
# 3. the operator-scripts workflow path filters (pull_request and push)
edit(".github/workflows/access-operator-scripts-tests.yml", [
('      - "functions/scripts/catalogCutover.js"\n', '      - "functions/scripts/catalogCutover.js"\n      - "functions/scripts/manufacturerCopy.js"\n'),
], count=2)
# 4. fence tests, after the catalog cutover block
edit("functions/test/operatorScriptEnvironmentFence.test.mjs", [
("""// ============================ THE REORDER CUTOVER ============================""",
"""// ============================ THE MANUFACTURER COPY (Firebase exit F5) ============================
//
// scripts/manufacturerCopy.js inserts eos_ops.manufacturers rows (copy). It must refuse before `pg` is resolved and has no
// production mode. Unlike the cutovers its mode is OPTIONAL: omitted, it is the read-only dry run.
const MFR_COPY = "scripts/manufacturerCopy.js";
const MFR_ARGS = ["--environment", "platform-sandbox", "--databaseUrlEnv", "MFR_FENCE_DB", "--tenantKey", "taylor-nonprod", "--snapshot", "/nonexistent/snapshot.json"];
const MFR_ENV = { EOS_ENVIRONMENT: "nonprod", MFR_FENCE_DB: "postgres://fence:fence@127.0.0.1:1/never" };

for (const [label, args, env, pattern] of [
  ["an unknown mode", ["--mode", "apply", ...MFR_ARGS], MFR_ENV, /--mode must be one of dryrun \\| copy \\| verify/],
  ["no environment", ["--tenantKey", "t", "--snapshot", "x.json"], MFR_ENV, /--environment is required/],
  ["production environment", ["--mode", "copy", ...MFR_ARGS.map((a) => (a === "platform-sandbox" ? "taylor-parts-production" : a))], MFR_ENV, /production/],
  ["EOS_ENVIRONMENT not nonprod", MFR_ARGS, { ...MFR_ENV, EOS_ENVIRONMENT: "production" }, /EOS_ENVIRONMENT must read exactly 'nonprod'/],
  ["frozen Certification world", MFR_ARGS.map((a) => (a === "platform-sandbox" ? "platform-certification" : a)), MFR_ENV, /Certification world, which is frozen/],
  ["no tenant key", ["--environment", "platform-sandbox", "--databaseUrlEnv", "MFR_FENCE_DB", "--snapshot", "x.json"], MFR_ENV, /--tenantKey is required/],
  ["no snapshot", ["--environment", "platform-sandbox", "--databaseUrlEnv", "MFR_FENCE_DB", "--tenantKey", "t"], MFR_ENV, /--snapshot <file> is required/],
  ["copy without an EOS principal", ["--mode", "copy", ...MFR_ARGS, "--reviewedChecksum", "c"], MFR_ENV, /--principalId <EOS principal id> is required/],
  ["copy without the reviewed checksum", ["--mode", "copy", ...MFR_ARGS, "--principalId", "p"], MFR_ENV, /--reviewedChecksum is required/],
]) {
  test(`manufacturer copy: refuses (${label}) before any client library loads`, () => {
    const res = runCli(MFR_COPY, args, env);
    const out = assertRefusedBeforeAnySdk(res, `manufacturer copy, ${label}`);
    assert.match(out, pattern);
  });
}

// ============================ THE REORDER CUTOVER ============================"""),
])
