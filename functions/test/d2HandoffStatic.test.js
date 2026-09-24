// F-RULES-1 D2 -- static validation of the D2 deployment handoff.
//
// ORIGINAL PURPOSE (unchanged). Guard the exact failure the operator caught in
// run 1: a hand-copied Rules hash that does not match the governed git BLOB (a
// Windows CRLF working-tree hash had been recorded). Every 64-hex hash literal
// in the handoff must be DERIVED, never typed.
//
// WHAT CHANGED, AND WHY (2026-09-23). This file used to derive that expectation
// from `HEAD:firestore.rules`. That was correct only while D2 was the LIVE gate
// and the handoff tracked the tip of the branch it would be deployed from.
//
// D2 was executed once, on 2026-07-23, from base commit 75289cc, and closed by
// 655dc150 (evidence import) / 49ba3363 (workstream closure). The handoff is now
// a HISTORICAL RECORD of a past production deployment. Its hash is a DEPLOYMENT
// IDENTITY -- the bytes that were actually released -- not a content pin on the
// current rules file. Pinning it to a moving HEAD asserted the opposite: that a
// closed deployment record must be rewritten every time main's Rules change.
//
// That is not merely wrong, it is unsafe. main now carries the #1929 CRM
// write-grant retirement (c9399b52), which is authorized for NONPROD ONLY under
// the standing Owner production Firebase Rules fence (2026-09-16,
// docs/roadmaps/CURRENT.md). Satisfying the old assertion would have meant
// editing a production-deploy runbook to name main's current rules -- falsified
// audit evidence pointed at the one project the fence forbids.
//
// So the derivation is re-anchored, not removed. The expectation now comes from
// TWO independent sources that must agree:
//   1. the firestore.rules blob at the D2 base commit (75289cc), via `git show`;
//   2. the archived post-deploy production ruleset captured off the live Rules
//      API during the run, which is itself checksum-guarded by its own
//      checksums.sha256 and pinned `-text` by .gitattributes.
// Both are content in this repository; neither is a number a human may type.
// A hand-copied or CRLF-damaged hash still fails, which is the guard's point.
//
// NOTE: this file makes NO claim about what is deployed anywhere today. A
// repository hash is not deployment proof. It asserts only that the recorded
// identity of a past deploy matches the artifact that was deployed.
//   node --test test/d2HandoffStatic.test.js
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");

const REPO = join(__dirname, "..", "..");
const HANDOFF = readFileSync(join(REPO, "docs", "operations", "f-rules-1-d2-deployment-handoff.md"), "utf8");

/** The commit D2 was prepared and executed from (d2-deployment-report.md §1). */
const D2_BASE_COMMIT = "75289cc";
const D2_EVIDENCE = join(REPO, "docs", "audits", "f-rules-1", "d2-rules-deployment");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function blobSha(rev, path) {
  return sha256(execFileSync("git", ["-C", REPO, "show", `${rev}:${path}`]));
}

test("root and mirror Rules blobs are byte-identical", () => {
  // Live invariant at the current commit: there are two governed copies and
  // they may never diverge. Unrelated to the historical D2 identity below.
  assert.equal(blobSha("HEAD", "firestore.rules"), blobSha("HEAD", "field-ops-app-vite/firestore.rules"));
});

test("the archived D2 ruleset matches the governed blob at the D2 base commit", () => {
  // The deployment identity, derived two ways. `post-deploy-production.rules`
  // was fetched from the live Rules API after the deploy; if it equals the
  // repository blob at 75289cc then the release was byte-exactly the governed
  // artifact, which is what LIVE-EQUALS-GOVERNED-BLOB asserted during the run.
  const archived = sha256(readFileSync(join(D2_EVIDENCE, "post-deploy-production.rules")));
  assert.equal(archived, blobSha(D2_BASE_COMMIT, "firestore.rules"));
  assert.equal(archived, blobSha(D2_BASE_COMMIT, "field-ops-app-vite/firestore.rules"));
});

test("the archived D2 ruleset still matches its own recorded checksum", () => {
  // The evidence directory is self-checksummed; if that drifts, the anchor
  // used by the test below is no longer trustworthy and nothing derived from
  // it means anything.
  const manifest = readFileSync(join(D2_EVIDENCE, "checksums.sha256"), "utf8");
  const recorded = /^([0-9a-f]{64})\s+post-deploy-production\.rules$/m.exec(manifest);
  assert.ok(recorded, "checksums.sha256 must record post-deploy-production.rules");
  assert.equal(sha256(readFileSync(join(D2_EVIDENCE, "post-deploy-production.rules"))), recorded[1]);
});

test("every hash literal in the D2 handoff equals the deployed D2 Rules sha256", () => {
  const deployed = sha256(readFileSync(join(D2_EVIDENCE, "post-deploy-production.rules")));
  const literals = [...new Set(HANDOFF.match(/\b[0-9a-f]{64}\b/g) ?? [])];
  assert.ok(literals.length >= 1, "the handoff must document the deployed blob hash");
  for (const h of literals) {
    assert.equal(h, deployed, `stale/hand-copied hash in handoff: ${h}`);
  }
});

test("the handoff's checks are self-deriving from the blob, not hand-copied", () => {
  assert.match(HANDOFF, /git show HEAD:firestore\.rules \| sha256sum/);
  assert.match(HANDOFF, /TREE-MATCHES-BLOB/);
  assert.match(HANDOFF, /MIRROR-MATCHES-BLOB/);
  assert.match(HANDOFF, /LIVE-EQUALS-GOVERNED-BLOB/);
});

test("the handoff is marked closed and carries the production Rules fence", () => {
  // The runbook's Step 3 and ROLLBACK block deploy to the production project.
  // It must not read as executable: an operator who finds it and runs it would
  // push main-era Rules to `taylor-parts`, which the standing Owner ruling
  // forbids. This assertion is what keeps the banner from being dropped.
  assert.match(HANDOFF, /CLOSED — HISTORICAL RECORD\. DO NOT EXECUTE\./);
  assert.match(HANDOFF, /never.{0,40}deployed to the production project `taylor-parts`/s);
});
