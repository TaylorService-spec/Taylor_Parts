import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assessBaseCompatibility, focusedChecks, integrationRecordLocation, readCanonicalGitBlob } from "./intake-patch-integrate.mjs";
import { patchSha256, verifyPatchManifest } from "../lib/intakePatch.mjs";

function git(repo, ...args) {
  const out = spawnSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true });
  assert.equal(out.status, 0, out.stderr); return out.stdout.trim();
}

test("integration replay has one deterministic record path", () => {
  assert.equal(integrationRecordLocation("EOS-ISSUE-819", "a".repeat(64)), `docs/orchestration/work-intake/results/EOS-ISSUE-819/integration/${"a".repeat(64)}.json`);
});
test("focused node tests are derived only from changed test modules", () => {
  assert.deepEqual(focusedChecks(["docs/a.mjs", "docs/a.test.mjs"]), [
    ["node", "--check", "docs/a.mjs"], ["node", "--check", "docs/a.test.mjs"], ["node", "--test", "docs/a.test.mjs"],
  ]);
});
test("unrelated main advancement is safe but target drift is stale", () => {
  assert.deepEqual(assessBaseCompatibility({ isAncestor: true, changedSinceBase: ["results/x.json"], patchPaths: ["src/a.mjs"] }), { ok: true, reason: null });
  assert.deepEqual(assessBaseCompatibility({ isAncestor: true, changedSinceBase: ["src/a.mjs"], patchPaths: ["src/a.mjs"] }), { ok: false, reason: "patch targets changed since base: src/a.mjs" });
  assert.equal(assessBaseCompatibility({ isAncestor: false, changedSinceBase: [], patchPaths: [] }).ok, false);
});

test("canonical Git blob identity ignores checkout line endings and never applies", () => {
  const repo = mkdtempSync(join(tmpdir(), "eos-blob-"));
  git(repo, "init"); git(repo, "config", "user.email", "eos@test.invalid"); git(repo, "config", "user.name", "EOS test");
  mkdirSync(join(repo, "results"));
  const lf = Buffer.from("diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n");
  writeFileSync(join(repo, "results", "change.patch"), lf);
  git(repo, "add", "."); git(repo, "commit", "-m", "artifact");
  writeFileSync(join(repo, "results", "change.patch"), lf.toString("utf8").replaceAll("\n", "\r\n"));
  const statusBefore = git(repo, "status", "--porcelain");
  const canonical = readCanonicalGitBlob({ repo, path: "results/change.patch" });
  assert.deepEqual(canonical, lf);
  assert.equal(patchSha256(canonical), patchSha256(lf));
  assert.notEqual(patchSha256(readFileSync(join(repo, "results", "change.patch"))), patchSha256(lf));
  assert.equal(git(repo, "status", "--porcelain"), statusBefore, "verification must not apply or modify repository state");
  assert.notEqual(patchSha256(Buffer.concat([canonical, Buffer.from("tamper")])), patchSha256(lf));
});

test("recovered 819 canonical blob satisfies its approved manifest", () => {
  const manifestPath = new URL("../work-intake/results/EOS-ISSUE-819/3c7ecc0a0a533d422aef79006cf02c2e9cdc080dd97ca7200a96991fef21d052.patch.json", import.meta.url);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const patch = readCanonicalGitBlob({ path: manifest.patchLocation });
  assert.deepEqual(verifyPatchManifest(manifest, patch, { requestId: "EOS-ISSUE-819" }), { ok: true, errors: [] });
  const tampered = Buffer.concat([patch, Buffer.from("tamper")]);
  assert.match(verifyPatchManifest(manifest, tampered, { requestId: "EOS-ISSUE-819" }).errors.join("; "), /patch hash mismatch/);
});
