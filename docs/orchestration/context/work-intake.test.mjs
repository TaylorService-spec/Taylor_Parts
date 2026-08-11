import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { intakeDigest, buildContentAddressedResult } from "../lib/workIntake.mjs";
import { consumeWorkPointer, persistResult } from "./work-intake.mjs";
import { contextPackageFor } from "./build-package.mjs";

function repoFixture() {
  const root = mkdtempSync(join(tmpdir(), "eos-intake-"));
  const location = "docs/orchestration/work-intake/TEST-001.work.json";
  const artifact = {
    requestId: "TEST-001", title: "Test", intent: "Verify bridge", scope: ["docs/orchestration/"], contextScope: ["orchestration"],
    source: { producer: "Owner/ChatGPT", provenance: "test" }, status: "EXECUTION_AUTHORIZED",
    authority: { authorizationState: "AUTHORIZED", basis: "test", protectedBoundary: null },
    artifactLocation: location, sha256: "0".repeat(64), createdAt: "2026-08-10T00:00:00Z", updatedAt: "2026-08-10T00:00:00Z",
    relatedRefs: { issues: [], pullRequests: [] },
  };
  artifact.sha256 = intakeDigest(artifact);
  mkdirSync(join(root, "docs/orchestration/work-intake"), { recursive: true });
  writeFileSync(join(root, location), JSON.stringify(artifact));
  return { root, location, artifact };
}

test("runner resolves and hands an ordinary item to the existing selector", () => {
  const { root, location, artifact } = repoFixture();
  const out = consumeWorkPointer({ repoRoot: root, requestId: artifact.requestId, location, sha256: artifact.sha256, sourceCommit: "a".repeat(40) });
  assert.equal(out.selection.decision, "RUN");
  assert.equal(out.selection.item.id, artifact.requestId);
  assert.equal(out.supervisorState.item.status, "READY");
  assert.equal(out.supervisorState.item.authorized, true);
  assert.deepEqual(out.supervisorState.item.scope, ["orchestration"]);
  assert.equal(out.submit, "work://TEST-001");
});

test("runner refuses a repo traversal location", () => {
  assert.throws(() => consumeWorkPointer({ repoRoot: "C:/repo", requestId: "TEST-001", location: "../escape.json", sha256: "a".repeat(64) }), /escapes repo root/);
});

test("projected item passes the existing C-7 context sufficiency gate", () => {
  const { root, location, artifact } = repoFixture();
  const out = consumeWorkPointer({ repoRoot: root, requestId: artifact.requestId, location, sha256: artifact.sha256, sourceCommit: "a".repeat(40) });
  const context = contextPackageFor({ id: out.supervisorState.item.id, scope: out.supervisorState.item.scope, role: out.supervisorState.item.workstream, objective: out.supervisorState.item.purpose, sourceCommit: out.supervisorState.sourceCommit });
  assert.equal(context.sufficiency, "SUFFICIENT");
  assert.equal(context.governingAuthority, "orch-operating-model");
});

test("result persistence writes immutable content and manifest artifacts", () => {
  const { root, artifact } = repoFixture();
  const result = buildContentAddressedResult({ request: artifact, outputBytes: "# Result\n\nCompact evidence.", summary: "Compact evidence.", createdAt: "2026-08-10T01:00:00Z" });
  const pointer = persistResult({ repoRoot: root, result });
  assert.equal(pointer.pointer, "result://TEST-001");
  assert.equal(readFileSync(join(root, result.contentLocation), "utf8"), "# Result\n\nCompact evidence.");
  assert.equal(JSON.parse(readFileSync(join(root, result.manifestLocation), "utf8")).sha256, result.manifest.sha256);
  assert.throws(() => persistResult({ repoRoot: root, result }), /exist/i);
});
