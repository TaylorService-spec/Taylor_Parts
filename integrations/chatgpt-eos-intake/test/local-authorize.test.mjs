import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLocalAuthorization, resolveGhIdentity } from "../src/local-authorize-mcp.mjs";
import { resolveReviewAuthorization, isVerifiedReviewAuthorization } from "../../../docs/orchestration/lib/reviewAuthorization.mjs";

const GRANT = {
  workId: "EOS-BASELINE-001", reviewId: "REV-001",
  sourceCommit: "ebec132f6aed8f26940f628fced1390ed18b4d38",
  workArtifactSha256: "42334e2c474b70d0b80ce96e0cf961cce1767db7441dfd23a69365f0fc20a07e",
  maxSpendUsd: 0.10, expiresAt: "2026-08-11T23:59:00Z", provenance: "Owner authorized one governed GPT baseline",
};
const IDENTITY = { subject: "github:rudydigiorgio", clientId: "github-oauth:12345" };

test("builds a valid authorization that the broker will VERIFY, bound to the exact grant", () => {
  const artifact = buildLocalAuthorization({ input: GRANT, identity: IDENTITY, now: "2026-08-11T15:00:00Z" });
  // exact-grant binding
  assert.equal(artifact.capability, "OPENAI_REVIEW");
  assert.equal(artifact.workId, "EOS-BASELINE-001");
  assert.equal(artifact.reviewId, "REV-001");
  assert.equal(artifact.sourceCommit, GRANT.sourceCommit);
  assert.equal(artifact.workArtifactSha256, GRANT.workArtifactSha256);
  assert.equal(artifact.maxSpendUsd, 0.10);
  assert.equal(artifact.authorizationState, "AUTHORIZED");
  assert.equal(artifact.budgetAuthorizationState, "AUTHORIZED");
  // authenticated authorizer carried from the verified identity (never a typed string)
  assert.equal(artifact.authorizedBy.subject, "github:rudydigiorgio");
  assert.equal(artifact.authorizedBy.oauthClientId, "github-oauth:12345");
  assert.equal(artifact.artifactLocation, "docs/orchestration/work-intake/authorizations/EOS-BASELINE-001/REV-001.authorization.json");

  // the broker's verification path accepts it (hash-pinned, unexpired → in the verified set)
  const resolved = resolveReviewAuthorization({ workId: artifact.workId, reviewId: artifact.reviewId, sourceCommit: artifact.sourceCommit, workArtifactSha256: artifact.workArtifactSha256, location: artifact.artifactLocation, sha256: artifact.sha256, bytes: JSON.stringify(artifact), now: "2026-08-11T16:00:00Z" });
  assert.equal(isVerifiedReviewAuthorization(resolved, "2026-08-11T16:00:00Z"), true);

  // no secret material anywhere in the authority artifact
  assert.doesNotMatch(JSON.stringify(artifact), /sk-[A-Za-z0-9]|OPENAI_API_KEY|Bearer /);
});

test("fails closed when the Owner is not gh-authenticated", () => {
  assert.throws(() => resolveGhIdentity({ exec: () => { throw new Error("gh not logged in"); } }), /NOT_AUTHENTICATED/);
});

test("a tampered grant (over-budget or bad hash) does not produce a valid authorization", () => {
  assert.throws(() => buildLocalAuthorization({ input: { ...GRANT, maxSpendUsd: 0 }, identity: IDENTITY }), /positive|invalid/i);
  assert.throws(() => buildLocalAuthorization({ input: { ...GRANT, sourceCommit: "not-a-sha" }, identity: IDENTITY }), /Git SHA|invalid/i);
});
