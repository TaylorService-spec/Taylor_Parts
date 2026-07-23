// F-RULES-1 D2 -- static validation of the D2 deployment handoff. Guards
// the exact failure the operator caught in run 1: a hand-copied Rules hash
// that does not match the governed git BLOB (a Windows CRLF working-tree
// hash had been recorded). Every 64-hex hash literal in the handoff must
// equal the sha256 of the firestore.rules BLOB at the current commit,
// derived here via `git show` -- never copied.
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

function blobSha(path) {
  const blob = execFileSync("git", ["-C", REPO, "show", `HEAD:${path}`]);
  return createHash("sha256").update(blob).digest("hex");
}

test("root and mirror Rules blobs are byte-identical", () => {
  assert.equal(blobSha("firestore.rules"), blobSha("field-ops-app-vite/firestore.rules"));
});

test("every hash literal in the D2 handoff equals the governed Rules blob sha256", () => {
  const governed = blobSha("firestore.rules");
  const literals = [...new Set(HANDOFF.match(/\b[0-9a-f]{64}\b/g) ?? [])];
  assert.ok(literals.length >= 1, "the handoff must document the governed blob hash");
  for (const h of literals) {
    assert.equal(h, governed, `stale/hand-copied hash in handoff: ${h}`);
  }
});

test("the handoff's checks are self-deriving from the blob, not hand-copied", () => {
  assert.match(HANDOFF, /git show HEAD:firestore\.rules \| sha256sum/);
  assert.match(HANDOFF, /TREE-MATCHES-BLOB/);
  assert.match(HANDOFF, /MIRROR-MATCHES-BLOB/);
  assert.match(HANDOFF, /LIVE-EQUALS-GOVERNED-BLOB/);
});
