import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FINDINGS, SUBJECT_HEAD } from "./pr790-final-evidence.mjs";
import { sha256Canonical } from "../lib/reviewArtifacts.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("final evidence declares only F1-F4 and exact immutable subject", () => {
  assert.deepEqual(Object.keys(FINDINGS), ["F1", "F2", "F3", "F4"]); assert.equal(SUBJECT_HEAD, "8a71f7cd3006fc149c7a80c52967a1643935ac7d");
  for (const cases of Object.values(FINDINGS)) for (const [file, name] of cases) { assert.ok(!/^[A-Za-z]:\\/.test(file)); assert.ok(file.includes("/") && name.length > 10); }
});

test("persisted final evidence is self-consistent and entirely exact-head machine evidence", () => {
  const manifest = JSON.parse(readFileSync(join(root, "docs/orchestration/reviews/evidence/pr-790/PR-790-FINAL-EVIDENCE.json"), "utf8"));
  const tests = JSON.parse(readFileSync(join(root, "docs/orchestration/reviews/evidence/pr-790/PR-790-TEST-EVIDENCE.json"), "utf8"));
  const { sha256, ...unsigned } = manifest;
  assert.equal(sha256Canonical(unsigned), sha256);
  assert.equal(sha256Canonical(tests), manifest.testEvidenceArtifactSha);
  assert.equal(manifest.reviewedHead, SUBJECT_HEAD);
  assert.equal(tests.reviewedHead, SUBJECT_HEAD);
  assert.equal(tests.workflowRunId, "31465996621");
  assert.equal(tests.cases.length, 14);
  assert.ok(tests.cases.every((item) => item.status === "PASS" && item.exitCode === 0 && item.sourceCommit === SUBJECT_HEAD));
  for (const finding of Object.values(manifest.findingEvidence)) {
    assert.ok(finding.paths.every((item) => item.sourceCommit === SUBJECT_HEAD && item.githubUrl.includes(SUBJECT_HEAD) && !/^[A-Za-z]:\\/.test(item.path)));
    assert.ok(finding.namedTests.every((item) => item.status === "PASS" && item.workflowRunId === "31465996621"));
  }
});
