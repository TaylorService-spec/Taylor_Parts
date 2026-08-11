import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalize, sha256Canonical, makeArtifact, verifyArtifact, makeArtifactStore, artifactRef, ARTIFACT_KINDS } from "./reviewArtifacts.mjs";
import { makeReviewManifest } from "./reviewManifest.mjs";

// In-memory fake fs (write/read/mkdir) for the durable store.
function memFs() {
  const files = new Map();
  return { files, writeFileSync: (p, d) => files.set(p, d), readFileSync: (p) => { if (!files.has(p)) { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; } return files.get(p); }, mkdirSync: () => {} };
}

test("canonicalize is key-order independent → identical hash for identical content", () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), canonicalize({ a: 2, b: 1 }));
  assert.equal(sha256Canonical({ x: [1, { p: 1, q: 2 }] }), sha256Canonical({ x: [1, { q: 2, p: 1 }] }));
  assert.notEqual(sha256Canonical({ a: 1 }), sha256Canonical({ a: 2 }));
  // undefined dropped; sha is 64-hex
  assert.match(sha256Canonical({ a: 1, b: undefined }), /^[0-9a-f]{64}$/);
  assert.equal(sha256Canonical({ a: 1 }), sha256Canonical({ a: 1, b: undefined }));
});

test("makeArtifact is content-addressed (artifactId = kind:sha256); identical content → same id", () => {
  const a = makeArtifact({ kind: "facts", content: { f: 1 }, sourceCommit: "abc" });
  const b = makeArtifact({ kind: "facts", content: { f: 1 }, sourceCommit: "different-commit" });
  assert.equal(a.artifactId, `facts:${a.sha256}`);
  assert.equal(a.sha256, b.sha256, "identity is content, not metadata");
  assert.throws(() => makeArtifact({ kind: "bogus", content: {} }));
  assert.deepEqual([...ARTIFACT_KINDS], ["request", "facts", "evidence", "result", "finding"]);
});

test("verifyArtifact: exact match ok; any tamper fails closed", () => {
  const art = makeArtifact({ kind: "result", content: { verdict: "YES" } });
  assert.equal(verifyArtifact(art, { verdict: "YES" }).ok, true);
  assert.equal(verifyArtifact(art, { verdict: "NO" }).ok, false);         // changed content
  assert.equal(verifyArtifact({ ...art, artifactId: "result:deadbeef" }, { verdict: "YES" }).ok, false); // id/hash disagree
});

test("store: put verifies before writing; get verifies before returning; mismatch FAILS CLOSED", () => {
  const fs = memFs();
  const store = makeArtifactStore({ dir: "root", fs });
  const art = makeArtifact({ kind: "evidence", content: { e: "diff" } });
  assert.equal(store.put(art, { e: "diff" }).ok, true);
  assert.equal(store.get(art).ok, true);
  assert.deepEqual(store.get(art).content, { e: "diff" });
  // refuse to store content that doesn't match the artifact hash
  assert.equal(store.put(art, { e: "TAMPERED" }).ok, false);
  // tamper the stored bytes on disk → get fails closed
  fs.files.set(`root/${art.location}`, JSON.stringify({ e: "TAMPERED" }));
  const g = store.get(art);
  assert.equal(g.ok, false);
  assert.equal(g.tampered, true);
});

test("artifactRef carries identity only (no substance)", () => {
  const art = makeArtifact({ kind: "request", content: { question: "is F resolved?", bigContext: "x".repeat(5000) } });
  const ref = artifactRef(art);
  assert.deepEqual(Object.keys(ref).sort(), ["artifactId", "kind", "location", "sha256", "sourceCommit"].sort());
  assert.ok(!JSON.stringify(ref).includes("x".repeat(50)), "the substance never rides in the reference");
});

test("manifest resolves review:<id> → refs; list slots dedupe by content hash", () => {
  const m = makeReviewManifest();
  const req = artifactRef(makeArtifact({ kind: "request", content: { q: 1 } }));
  const ev1 = artifactRef(makeArtifact({ kind: "evidence", content: { e: 1 } }));
  const ev1dup = artifactRef(makeArtifact({ kind: "evidence", content: { e: 1 } })); // same content → same hash
  const ev2 = artifactRef(makeArtifact({ kind: "evidence", content: { e: 2 } }));
  m.register("R1", "request", req).register("R1", "evidence", ev1).register("R1", "evidence", ev1dup).register("R1", "evidence", ev2);
  const r = m.resolve("R1");
  assert.equal(r.request.artifactId, req.artifactId);
  assert.equal(r.evidence.length, 2, "duplicate evidence (same hash) not re-registered");
  assert.equal(m.refsFor("R1").length, 3); // request + 2 evidence
  // round-trip through the index
  const m2 = makeReviewManifest(m.toIndex());
  assert.deepEqual(m2.resolve("R1"), r);
});
