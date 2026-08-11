import test from "node:test";
import assert from "node:assert/strict";
import { buildReviewAuthorization, resolveReviewAuthorization, isVerifiedReviewAuthorization } from "../../../docs/orchestration/lib/reviewAuthorization.mjs";

test("review authorization binds authenticated Owner, work, budget, source, and hash without credential fields", () => {
  const artifact = buildReviewAuthorization({ workId: "EOS-INTAKE-002", reviewId: "REVIEW-790", maxSpendUsd: 0.25, sourceCommit: "a".repeat(40), provenance: "Owner request" }, { subject: "owner", clientId: "chatgpt" }, "2026-08-11T06:00:00.000Z");
  assert.equal(artifact.authorizationState, "AUTHORIZED");
  assert.equal(artifact.budgetAuthorizationState, "AUTHORIZED");
  assert.equal(artifact.authorizedBy.subject, "owner");
  assert.equal(artifact.sha256.length, 64);
  assert.ok(!/secret|apiKey|api_key/i.test(JSON.stringify(artifact)));
  const resolved = resolveReviewAuthorization({ workId: artifact.workId, reviewId: artifact.reviewId, location: artifact.artifactLocation, sha256: artifact.sha256, bytes: JSON.stringify(artifact) });
  assert.equal(isVerifiedReviewAuthorization(resolved), true);
  assert.throws(() => resolveReviewAuthorization({ workId: artifact.workId, reviewId: artifact.reviewId, location: artifact.artifactLocation, sha256: artifact.sha256, bytes: JSON.stringify({ ...artifact, maxSpendUsd: 99 }) }), /mismatch/);
});
