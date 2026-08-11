import { test } from "node:test";
import assert from "node:assert/strict";
import { assessDelta, buildFindingDeltaFeed, resolveDeltaOutcome, DELTA_DISPOSITIONS } from "./reviewDelta.mjs";

test("assessDelta: unchanged impl + authority hashes → NO_MATERIAL_CHANGE, no review warranted", () => {
  const a = assessDelta({
    priorImplRef: { sha256: "impl1" }, newImplRef: { sha256: "impl1" },
    priorAuthorityRef: { sha256: "auth1" }, newAuthorityRef: { sha256: "auth1" },
  });
  assert.equal(a.disposition, "NO_MATERIAL_CHANGE");
  assert.equal(a.warrantsReview, false);
  assert.equal(a.implChanged, false);
  assert.equal(a.authorityChanged, false);
});

test("assessDelta: changed implementation hash warrants a delta review", () => {
  const a = assessDelta({ priorImplRef: { sha256: "impl1" }, newImplRef: { sha256: "impl2" } });
  assert.equal(a.disposition, "DELTA_REVIEW");
  assert.equal(a.implChanged, true);
  assert.equal(a.warrantsReview, true);
  assert.ok(DELTA_DISPOSITIONS.includes(a.disposition));
});

test("assessDelta: authority change alone warrants a delta review", () => {
  const a = assessDelta({
    priorImplRef: { sha256: "impl1" }, newImplRef: { sha256: "impl1" },
    priorAuthorityRef: { sha256: "auth1" }, newAuthorityRef: { sha256: "auth2" },
  });
  assert.equal(a.authorityChanged, true);
  assert.equal(a.warrantsReview, true);
});

test("buildFindingDeltaFeed: narrow per-finding question; carries refs not the original request", () => {
  const finding = { findingId: "F-01", summary: "name parity", ref: { artifactId: "finding:abc", sha256: "abc" } };
  const { question, feed, breakdown } = buildFindingDeltaFeed({
    finding,
    newImplRef: { artifactId: "facts:impl2", sha256: "impl2", kind: "facts" },
    authorityRefs: [{ artifactId: "auth:xyz", sha256: "xyz" }],
    changedRefs: [{ artifactId: "evidence:d1", sha256: "d1" }],
  });
  assert.equal(question.questionId, "delta:F-01");
  assert.match(question.ask, /Is finding F-01 resolved/);
  // the finding rides as a reference to its durable artifact
  assert.ok(feed.facts.some((f) => f.ref && f.ref.artifactId === "finding:abc"));
  // the changed material rides as a reference
  assert.ok(feed.facts.some((f) => f.ref && f.ref.artifactId === "evidence:d1"));
  // authority rides as a reference, not text
  assert.equal(feed.authority[0].artifactId, "auth:xyz");
  assert.ok(breakdown.totalEstimate > 0);
  // it does NOT resend the original request or resolved findings narrative
  assert.ok(!JSON.stringify(feed).includes("original request"));
});

test("buildFindingDeltaFeed requires a findingId", () => {
  assert.throws(() => buildFindingDeltaFeed({ finding: {}, newImplRef: { sha256: "x" } }), /findingId/);
});

test("resolveDeltaOutcome: YES resolves; non-YES keeps open; OWNER_REQUIRED escalates", () => {
  const out = resolveDeltaOutcome([
    { findingId: "F-01", verdict: "YES" },
    { findingId: "F-02", verdict: "NO" },
    { findingId: "F-03", verdict: "EVIDENCE_REQUIRED" },
  ]);
  assert.deepEqual(out.resolved, ["F-01"]);
  assert.deepEqual(out.unresolved, ["F-02", "F-03"]);
  assert.equal(out.allResolved, false);
  assert.equal(out.escalate, false);

  const allYes = resolveDeltaOutcome([{ findingId: "F-01", verdict: "YES" }]);
  assert.equal(allYes.allResolved, true);

  const owner = resolveDeltaOutcome([{ findingId: "F-01", verdict: "OWNER_REQUIRED" }]);
  assert.equal(owner.escalate, true);
  assert.equal(owner.allResolved, false);
});
