import test from "node:test";
import assert from "node:assert/strict";
import { buildPatchManifest, pathMatchesScope, verifyPatchManifest } from "./intakePatch.mjs";

const SHA = "a".repeat(64), BASE = "b".repeat(40), NOW = "2026-08-12T22:00:00Z";

test("path globs authorize only explicit repository surfaces", () => {
  assert.equal(pathMatchesScope("docs/orchestration/lib/a.mjs", ["docs/orchestration/**"]), true);
  assert.equal(pathMatchesScope("src/admin.js", ["docs/orchestration/**"]), false);
});

test("source edits become a deterministic hash-bound patch manifest", () => {
  const patch = Buffer.from("diff --git a/docs/orchestration/a b/docs/orchestration/a\n");
  const a = buildPatchManifest({ requestId: "EOS-ISSUE-819", sourceWorkSha256: SHA, baseCommit: BASE, scope: ["docs/orchestration/**"], paths: ["docs/orchestration/a"], patchBytes: patch, createdAt: NOW });
  const b = buildPatchManifest({ requestId: "EOS-ISSUE-819", sourceWorkSha256: SHA, baseCommit: BASE, scope: ["docs/orchestration/**"], paths: ["docs/orchestration/a"], patchBytes: patch, createdAt: NOW });
  assert.deepEqual(a, b);
  assert.equal(a.integrationState, "AWAITING_EXPLICIT_APPROVAL");
  assert.equal(verifyPatchManifest(a, patch, { requestId: a.requestId, currentBase: BASE }).ok, true);
});

test("out-of-scope, stale, tampered, and replayed patches fail closed", () => {
  const patch = Buffer.from("patch");
  const blocked = buildPatchManifest({ requestId: "EOS-ISSUE-819", sourceWorkSha256: SHA, baseCommit: BASE, scope: ["docs/**"], paths: ["src/no.js"], patchBytes: patch, createdAt: NOW });
  assert.equal(blocked.integrationState, "BLOCKED_SCOPE");
  assert.equal(verifyPatchManifest(blocked, patch, { requestId: blocked.requestId, currentBase: BASE }).ok, false);
  const good = buildPatchManifest({ requestId: "EOS-ISSUE-819", sourceWorkSha256: SHA, baseCommit: BASE, scope: ["docs/**"], paths: ["docs/a"], patchBytes: patch, createdAt: NOW });
  assert.equal(verifyPatchManifest(good, Buffer.from("tampered"), { requestId: good.requestId, currentBase: BASE }).ok, false);
  assert.equal(verifyPatchManifest(good, patch, { requestId: good.requestId, currentBase: "c".repeat(40) }).ok, false);
  assert.equal(verifyPatchManifest({ ...good, integrationState: "INTEGRATED" }, patch, { requestId: good.requestId, currentBase: BASE }).ok, false);
});
