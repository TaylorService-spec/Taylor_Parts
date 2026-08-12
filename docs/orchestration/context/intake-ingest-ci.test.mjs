import test from "node:test";
import assert from "node:assert/strict";
import { assessCommittedStatus } from "./intake-ingest-ci.mjs";
import { buildIntakeStatus } from "../lib/intakeStatus.mjs";

const workArtifact = {
  location: "docs/orchestration/work-intake/EOS-TEST-001.work.json",
  sha256: "a".repeat(64),
};
const derived = buildIntakeStatus({
  requestId: "EOS-TEST-001",
  state: "READY",
  updatedAt: "2026-08-12T07:00:00Z",
  workArtifact,
});

test("matching baseline status remains derivable", () => {
  assert.deepEqual(assessCommittedStatus(derived, derived), { ok: true, preserve: false, reason: null });
});

test("verified COMPLETE outcome bound to the current work hash is preserved", () => {
  const complete = buildIntakeStatus({
    requestId: "EOS-TEST-001",
    state: "COMPLETE",
    updatedAt: "2026-08-12T07:20:00Z",
    workArtifact,
    resultRef: { location: "docs/orchestration/work-intake/results/EOS-TEST-001/x.result.json", sha256: "b".repeat(64) },
  });
  assert.deepEqual(assessCommittedStatus(complete, derived), { ok: true, preserve: true, reason: null });
});

test("tampered and stale-bound outcomes fail closed", () => {
  assert.equal(assessCommittedStatus({ ...derived, state: "COMPLETE" }, derived).ok, false);
  const stale = buildIntakeStatus({
    requestId: "EOS-TEST-001",
    state: "FAILED",
    updatedAt: "2026-08-12T07:20:00Z",
    workArtifact: { ...workArtifact, sha256: "c".repeat(64) },
  });
  assert.match(assessCommittedStatus(stale, derived).reason, /binding/);
});

test("baseline drift still fails closed", () => {
  const staged = buildIntakeStatus({
    requestId: "EOS-TEST-001",
    state: "STAGED",
    updatedAt: "2026-08-12T07:00:00Z",
    workArtifact,
  });
  assert.match(assessCommittedStatus(staged, derived).reason, /baseline state STAGED != derived READY/);
});
