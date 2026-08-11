// Content-addressed review artifacts — the durable substance layer of the reciprocal review contract.
// "FACTS TRAVEL, STORY STAYS HOME": AI messages carry compact REFERENCES (artifactId + sha256 + location);
// the durable artifact carries the substance. Consumers resolve → read → recompute hash → compare →
// consume ONLY on an exact match; a mismatch FAILS CLOSED. This adds no second review ledger — it is the
// content-addressed storage the manifest/index resolves against.
//
// Pure except where fs is INJECTED (the store), so hashing/verification are deterministic and testable
// with no filesystem. Does NOT touch selector / Wake Supervisor / authority model / aiExchange lifecycle /
// provider routing / review semantics.

import { createHash } from "node:crypto";

export const ARTIFACT_KINDS = Object.freeze(["request", "facts", "evidence", "result", "finding"]);

/**
 * Deterministic canonical serialization: object keys sorted recursively, arrays in order, so the SAME
 * logical content ALWAYS yields the SAME bytes (and therefore the same hash) regardless of key order.
 * undefined is dropped (JSON has no undefined); functions/symbols are not permitted in artifacts.
 */
export function canonicalize(value) {
  return JSON.stringify(sortDeep(value));
}
function sortDeep(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(sortDeep);
  const out = {};
  for (const k of Object.keys(v).sort()) {
    if (v[k] === undefined) continue;
    out[k] = sortDeep(v[k]);
  }
  return out;
}

/** SHA-256 (hex) over the canonical serialization of `content`. The identity of the substance. */
export function sha256Canonical(content) {
  return createHash("sha256").update(canonicalize(content), "utf8").digest("hex");
}

/**
 * Build a content-addressed artifact envelope. The artifactId is `${kind}:${sha256}` so identity IS the
 * content hash — identical content is the same artifact (natural deduplication). `location` is where the
 * substance is stored (relative path/key); `provenance`/`sourceCommit`/`createdAt` are system-owned.
 * @returns {{ artifactId, kind, location, sha256, sourceCommit, createdAt, provenance }}
 */
export function makeArtifact({ kind, content, location = null, sourceCommit = null, createdAt = null, provenance = null } = {}) {
  if (!ARTIFACT_KINDS.includes(kind)) throw new Error(`makeArtifact: unknown kind ${JSON.stringify(kind)}`);
  const sha256 = sha256Canonical(content);
  return Object.freeze({
    artifactId: `${kind}:${sha256}`,
    kind,
    location: location || `reviews/${kind}/${sha256}.json`,
    sha256,
    sourceCommit,
    createdAt,
    provenance,
  });
}

/**
 * Verify content against an artifact envelope: recompute the hash over the SAME canonical serialization
 * and compare. Fail-closed — any mismatch (tamper, wrong content, corruption) is NEVER consumed.
 * @returns {{ ok: boolean, reason: string, recomputed: string }}
 */
export function verifyArtifact(artifact, content) {
  if (!artifact || typeof artifact.sha256 !== "string") return { ok: false, reason: "no artifact/sha256", recomputed: null };
  const recomputed = sha256Canonical(content);
  if (recomputed !== artifact.sha256) return { ok: false, reason: `hash mismatch (expected ${artifact.sha256.slice(0, 12)}…, got ${recomputed.slice(0, 12)}…)`, recomputed };
  if (artifact.artifactId && artifact.artifactId !== `${artifact.kind}:${artifact.sha256}`) return { ok: false, reason: "artifactId does not match kind:sha256", recomputed };
  return { ok: true, reason: "hash verified", recomputed };
}

/**
 * Durable content-addressed store over an INJECTED fs (node:fs in production, an in-memory fake in tests).
 * put() writes the canonical content at the artifact.location and returns the artifact; get() reads it back
 * and VERIFIES the hash before returning — a mismatch returns { ok:false } and never yields content.
 * Idempotent: putting identical content at the same content-addressed location is a no-op-equivalent.
 */
export function makeArtifactStore({ dir = "", fs, join = (a, b) => (a ? `${a}/${b}` : b) } = {}) {
  if (!fs || typeof fs.writeFileSync !== "function" || typeof fs.readFileSync !== "function") {
    throw new Error("makeArtifactStore: an fs with writeFileSync/readFileSync/mkdirSync must be injected");
  }
  const full = (loc) => (dir ? join(dir, loc) : loc);
  return {
    put(artifact, content) {
      const v = verifyArtifact(artifact, content);
      if (!v.ok) return { ok: false, reason: `refusing to store: ${v.reason}` }; // never store mismatched substance
      const path = full(artifact.location);
      const parent = path.replace(/[/\\][^/\\]*$/, "");
      try { if (parent && parent !== path) fs.mkdirSync(parent, { recursive: true }); } catch { /* best effort */ }
      fs.writeFileSync(path, canonicalize(content), "utf8");
      return { ok: true, artifact, location: path };
    },
    get(artifact) {
      const path = full(artifact.location);
      let raw;
      try { raw = fs.readFileSync(path, "utf8"); } catch (e) { return { ok: false, reason: `not found at ${artifact.location}` }; }
      let content;
      try { content = JSON.parse(raw); } catch { return { ok: false, reason: "stored artifact is not valid JSON" }; }
      const v = verifyArtifact(artifact, content);
      if (!v.ok) return { ok: false, reason: `FAIL-CLOSED: ${v.reason}`, tampered: true }; // resolved but hash mismatch
      return { ok: true, content, artifact };
    },
  };
}

/** A compact REFERENCE to an artifact for an AI message — carries identity, never the substance. */
export function artifactRef(artifact) {
  return { artifactId: artifact.artifactId, kind: artifact.kind, sha256: artifact.sha256, location: artifact.location, sourceCommit: artifact.sourceCommit ?? null };
}
