import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { safeRequestId, safeDiffPath, readReviewInputs } from "./reviewInputSafety.mjs";

const REPO = resolve("/repo");
// Build the exists set using the SAME resolve() the code uses, so it's cross-platform (Windows
// resolve() yields drive-prefixed backslash paths; POSIX yields /repo/...). Compare via resolve too.
const existsRel = (rels) => { const set = new Set(rels.map((r) => resolve(REPO, r))); return (p) => set.has(p); };
const expect = (rel) => resolve(REPO, rel);

test("empty diff_path → valid, omits the diff (path null)", () => {
  const r = safeDiffPath({ repoRoot: REPO, rawPath: "", exists: () => true });
  assert.deepEqual(r, { ok: true, path: null });
  assert.equal(safeDiffPath({ repoRoot: REPO, rawPath: "   ", exists: () => true }).path, null);
});

test("normal repository-relative diff path that exists → ok, resolved inside checkout", () => {
  const r = safeDiffPath({ repoRoot: REPO, rawPath: "changes/pr.diff", exists: existsRel(["changes/pr.diff"]) });
  assert.equal(r.ok, true);
  assert.equal(r.path, expect("changes/pr.diff"));
});

test("spaces in the diff path stay ONE value (env var → single string, never argv-split)", () => {
  const r = safeDiffPath({ repoRoot: REPO, rawPath: "my changes/pr one.diff", exists: existsRel(["my changes/pr one.diff"]) });
  assert.equal(r.ok, true);
  assert.equal(r.path, expect("my changes/pr one.diff")); // whole thing is the path
});

test("shell metacharacters are inert filename chars — never syntax, never executed", () => {
  // Each is treated purely as a (nonexistent) filename → rejected by existence, NOT interpreted.
  for (const evil of ['a; rm -rf /', 'a && curl x', 'a | sh', 'a$(whoami)', 'a`id`', 'a > b', 'a<b', "a'\"b"]) {
    const r = safeDiffPath({ repoRoot: REPO, rawPath: evil, exists: () => false });
    assert.equal(r.ok, false);            // rejected as non-existent, never shelled out
    assert.match(r.reason, /does not exist|traverse|outside/);
  }
  // even if such a file DID exist in-repo, it is returned as a literal path, not run
  const r = safeDiffPath({ repoRoot: REPO, rawPath: "weird;name.diff", exists: existsRel(["weird;name.diff"]) });
  assert.equal(r.ok, true);
  assert.equal(r.path, expect("weird;name.diff"));
});

test("absolute paths and drive letters are rejected (repo-relative only)", () => {
  assert.equal(safeDiffPath({ repoRoot: REPO, rawPath: "/etc/passwd", exists: () => true }).ok, false);
  assert.equal(safeDiffPath({ repoRoot: REPO, rawPath: "C:\\Windows\\x", exists: () => true }).ok, false);
});

test("path traversal outside the checkout is rejected", () => {
  assert.match(safeDiffPath({ repoRoot: REPO, rawPath: "../secrets.env", exists: () => true }).reason, /traverse/);
  assert.match(safeDiffPath({ repoRoot: REPO, rawPath: "a/../../b", exists: () => true }).reason, /traverse/);
});

test("non-existent in-repo path is rejected (must exist when supplied)", () => {
  assert.match(safeDiffPath({ repoRoot: REPO, rawPath: "does/not/exist.diff", exists: () => false }).reason, /does not exist/);
});

test("request_id special chars cannot execute — bounded, de-newlined, used only as a string", () => {
  assert.equal(safeRequestId("$(rm -rf /)"), "$(rm -rf /)");   // returned as a LITERAL string (never shell)
  assert.equal(safeRequestId("a\nb\tc"), "a b c");             // control chars flattened
  assert.equal(safeRequestId(""), "REVIEW");                   // default
  assert.equal(safeRequestId("x".repeat(500)).length, 120);    // bounded
});

test("readReviewInputs pulls both from env with the same safety rules", () => {
  const r = readReviewInputs({ env: { REVIEW_REQUEST_ID: "R2", REVIEW_DIFF_PATH: "d/x.diff" }, repoRoot: REPO, exists: existsRel(["d/x.diff"]) });
  assert.equal(r.requestId, "R2");
  assert.equal(r.diff.ok, true);
});
