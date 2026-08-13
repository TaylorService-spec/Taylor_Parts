import test from "node:test";
import assert from "node:assert/strict";
import { authorizeIssueIntake, buildIssueIntake, validateIssueEvent } from "./issue-intake-producer.mjs";
import { resolveWorkIntake } from "../lib/workIntake.mjs";

const event = {
  action: "labeled",
  label: { name: "eos-intake" },
  sender: { login: "owner" },
  repository: { owner: { login: "owner" } },
  issue: {
    number: 810,
    state: "open",
    title: "EOS Test - Equipment date validation",
    body: "## Purpose\nFix the integrity finding.\n\n## Scope\n- field-ops-app-vite/src/modules/equipment/**\n- field-ops-app-vite/test/**\n\n## Required work\n- Add validation.\n\n## Completion\nPublish governed evidence.",
    author_association: "OWNER",
    html_url: "https://github.com/TaylorService-spec/Taylor_Parts/issues/810",
    created_at: "2026-08-12T07:01:32Z",
    updated_at: "2026-08-12T07:01:32Z",
    user: { login: "owner" },
  },
};

test("Owner-labeled Issue becomes a resolvable hash-pinned EOS-ready artifact", () => {
  const artifact = buildIssueIntake(event);
  assert.equal(artifact.requestId, "EOS-ISSUE-810");
  assert.equal(artifact.status, "EOS_READY");
  assert.equal(artifact.authority.authorizationState, "REPO_SAFE");
  assert.deepEqual(artifact.scope, ["field-ops-app-vite/src/modules/equipment/**", "field-ops-app-vite/test/**"]);
  assert.deepEqual(artifact.relatedRefs.issues, [event.issue.html_url]);
  assert.equal(resolveWorkIntake({
    requestId: artifact.requestId,
    location: artifact.artifactLocation,
    sha256: artifact.sha256,
    bytes: JSON.stringify(artifact),
  }).sha256, artifact.sha256);
});

test("governed EOS acceptance is separate from GitHub label acceptance", () => {
  const staged = buildIssueIntake(event);
  const authorized = authorizeIssueIntake(staged, event);
  assert.equal(authorized.status, "EXECUTION_AUTHORIZED");
  assert.equal(authorized.authority.authorizationState, "AUTHORIZED");
  assert.notEqual(authorized.sha256, staged.sha256);
});

test("non-Owner label actor cannot dispatch", () => {
  assert.throws(() => buildIssueIntake({ ...event, sender: { login: "collaborator" } }), /repository Owner must apply/);
});

test("producer rejects untrusted authors, wrong labels, PRs, and incomplete templates", () => {
  assert.match(validateIssueEvent({ ...event, label: { name: "bug" } }).join(";"), /label must be eos-intake/);
  assert.match(validateIssueEvent({ ...event, issue: { ...event.issue, author_association: "NONE" } }).join(";"), /OWNER, MEMBER, or COLLABORATOR/);
  assert.match(validateIssueEvent({ ...event, issue: { ...event.issue, pull_request: {} } }).join(";"), /not a pull request/);
  assert.match(validateIssueEvent({ ...event, issue: { ...event.issue, body: "## Purpose\nOnly one section" } }).join(";"), /Scope/);
});

test("same Issue event produces byte-identical artifacts", () => {
  assert.deepEqual(buildIssueIntake(event), buildIssueIntake(structuredClone(event)));
});

// ── #840 fix: issue task classification + governed profile grant ───────────────────────────────────────
const implEvent = (labels = []) => ({
  ...event,
  issue: {
    ...event.issue, number: 840, labels,
    body: "## Purpose\nRepair the runtime.\n\n## Scope\n- docs/orchestration/**\n\n## Required work\n- Implement the fix and add a function.\n\n## Completion\nDraft PR.",
    html_url: "https://github.com/TaylorService-spec/Taylor_Parts/issues/840",
  },
});

test("#840: buildIssueIntake classifies the requested execution contract (implementation => PATCH_PRODUCER request)", () => {
  const a = buildIssueIntake(implEvent());
  assert.equal(a.execution.taskClass, "PATCH_PRODUCER");
  assert.equal(a.execution.expectedArtifactClass, "PATCH");
  assert.deepEqual(a.execution.requiredExecutionReceipts, ["tests"]);
  assert.equal(a.execution.verifierRequired, true);
  // an analysis-shaped issue defaults to least privilege
  assert.equal(buildIssueIntake(event).execution.taskClass, "READ_ONLY_ANALYSIS");
});

test("#840: issue TEXT alone never grants authority — authorize defaults to READ_ONLY_ANALYSIS without an eos-authorize-* label", () => {
  const staged = buildIssueIntake(implEvent());
  const authorized = authorizeIssueIntake(staged, implEvent());
  assert.equal(authorized.execution.taskClass, "PATCH_PRODUCER", "the REQUEST is PATCH_PRODUCER");
  assert.equal(authorized.authority.authorizedExecutionProfile, "READ_ONLY_ANALYSIS", "but the GRANT is least-privilege without a governed label");
});

test("#840: an Owner-applied eos-authorize-patch label is the SEPARATE governed grant", () => {
  const ev = implEvent([{ name: "eos-intake" }, { name: "eos-authorize-patch" }]);
  const authorized = authorizeIssueIntake(buildIssueIntake(ev), ev);
  assert.equal(authorized.authority.authorizedExecutionProfile, "PATCH_PRODUCER");
  // the intake label by itself is not an authorization grant
  const evNoGrant = implEvent([{ name: "eos-intake" }]);
  assert.equal(authorizeIssueIntake(buildIssueIntake(evNoGrant), evNoGrant).authority.authorizedExecutionProfile, "READ_ONLY_ANALYSIS");
});
