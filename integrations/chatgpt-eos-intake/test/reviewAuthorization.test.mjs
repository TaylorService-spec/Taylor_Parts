import test from "node:test";
import assert from "node:assert/strict";
import { buildReviewAuthorization, resolveReviewAuthorization, isVerifiedReviewAuthorization } from "../../../docs/orchestration/lib/reviewAuthorization.mjs";

test("review authorization binds authenticated Owner, work, budget, source, and hash without credential fields", () => {
  const artifact = buildReviewAuthorization({ workId: "EOS-INTAKE-002", reviewId: "REVIEW-790", maxSpendUsd: 0.25, sourceCommit: "a".repeat(40), workArtifactSha256: "b".repeat(64), expiresAt: "2026-08-12T06:00:00.000Z", provenance: "Owner request" }, { subject: "owner", clientId: "chatgpt" }, "2026-08-11T06:00:00.000Z");
  assert.equal(artifact.authorizationState, "AUTHORIZED");
  assert.equal(artifact.budgetAuthorizationState, "AUTHORIZED");
  assert.equal(artifact.authorizedBy.subject, "owner");
  assert.equal(artifact.sha256.length, 64);
  assert.ok(!/secret|apiKey|api_key/i.test(JSON.stringify(artifact)));
  const pointer = { workId: artifact.workId, reviewId: artifact.reviewId, sourceCommit: artifact.sourceCommit, workArtifactSha256: artifact.workArtifactSha256, location: artifact.artifactLocation, sha256: artifact.sha256, now: "2026-08-11T07:00:00.000Z" };
  const resolved = resolveReviewAuthorization({ ...pointer, bytes: JSON.stringify(artifact) });
  assert.equal(isVerifiedReviewAuthorization(resolved, pointer.now), true);
  for (const mutation of [{ maxSpendUsd: 99 }, { workId: "EOS-INTAKE-999" }, { reviewId: "REVIEW-999" }, { sourceCommit: "c".repeat(40) }, { workArtifactSha256: "d".repeat(64) }]) assert.throws(() => resolveReviewAuthorization({ ...pointer, bytes: JSON.stringify({ ...artifact, ...mutation }) }), /mismatch/);
  assert.throws(() => resolveReviewAuthorization({ ...pointer, bytes: JSON.stringify(artifact), now: artifact.expiresAt }), /expired/);
});
