// Enterprise Access & Administration Platform (Issue #226) -- mirror-
// integrity check for functions/src/access/compactClaims.ts vs its
// client mirror at field-ops-app-vite/src/access/compactClaims.ts
// (Customer review round 3 requirement: "keep the server/client pure
// modules synchronized and add a mirror-integrity assertion so
// functional drift is automatically detected").
//
// This repo's mirroring convention (see every access/ module's own
// header comment) has exactly one INTENTIONAL difference between a
// server module and its client mirror: the "Mirrored ... at <path>"
// cross-reference line, which necessarily points the opposite
// direction in each copy. Every other line must be byte-identical --
// any other difference is drift, not a documented exception.
//
// Reads the raw TypeScript SOURCE directly (no build step required) --
// this is a repo-hygiene check, not a runtime-behavior test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(err);
  }
}

// Neutralizes the two things that legitimately differ between a mirror
// pair WITHOUT masking any other real difference:
//   1. The cross-reference path itself ("functions/..." vs
//      "field-ops-app-vite/...") -- necessarily points the opposite
//      direction in each copy. Replaced with a common placeholder.
//   2. The WRAP POINT of the sentence containing that path -- a longer
//      path (field-ops-app-vite/...) pushes the line-wrap earlier than
//      the shorter functions/... path, even when the wording is
//      identical (this is what a naive per-line diff false-positived
//      on: the same sentence, wrapped one word differently). Every
//      contiguous run of non-blank `//` comment lines is joined into
//      one logical paragraph before comparing, so wrap width stops
//      mattering -- but code lines (never reflowed) and any genuine
//      wording difference within a paragraph still surface as a real
//      mismatch.
function normalizeForMirrorComparison(source, peerPathVariants) {
  let text = source;
  for (const variant of peerPathVariants) {
    text = text.split(variant).join("<PEER_ACCESS_MODULE_PATH>");
  }
  // Normalize CRLF -> LF first. A git checkout on Windows (core.autocrlf)
  // rewrites working-tree files to CRLF; without this, the trailing "\r"
  // left on each line after split("\n") makes the `.` in the comment
  // regex below refuse to match up to the true end of line (`.` never
  // matches \r), so the regex fails outright and comment lines silently
  // stop being recognized as comment lines -- reintroducing the exact
  // wrap-point false-positive this normalization exists to prevent.
  // Caught live: this test passed against LF-written files and then
  // failed on a freshly `git worktree add`-checked-out (CRLF) copy.
  text = text.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const normalizedLines = [];
  let paragraph = null;
  for (const line of lines) {
    const commentMatch = /^\s*\/\/(.*)$/.exec(line);
    const commentBody = commentMatch ? commentMatch[1].trim() : null;
    if (commentMatch && commentBody !== "") {
      paragraph = paragraph === null ? commentBody : `${paragraph} ${commentBody}`;
      continue;
    }
    if (paragraph !== null) {
      normalizedLines.push(paragraph);
      paragraph = null;
    }
    normalizedLines.push(line);
  }
  if (paragraph !== null) normalizedLines.push(paragraph);
  return normalizedLines.join("\n");
}

function assertMirrorPairMatches(moduleFileName) {
  const serverRelativePath = `functions/src/access/${moduleFileName}`;
  const clientRelativePath = `field-ops-app-vite/src/access/${moduleFileName}`;
  const serverSource = readFileSync(join(REPO_ROOT, serverRelativePath), "utf8");
  const clientSource = readFileSync(join(REPO_ROOT, clientRelativePath), "utf8");
  const peerPathVariants = [serverRelativePath, clientRelativePath];
  const serverNormalized = normalizeForMirrorComparison(serverSource, peerPathVariants);
  const clientNormalized = normalizeForMirrorComparison(clientSource, peerPathVariants);
  assert.equal(
    serverNormalized,
    clientNormalized,
    `${moduleFileName}: functions/ and field-ops-app-vite/ copies differ beyond the documented mirror cross-reference (path + its wrap point) -- functional drift detected`,
  );
}

check("compactClaims.ts: server and client mirrors are identical beyond the documented cross-reference line", () => {
  assertMirrorPairMatches("compactClaims.ts");
});

// COVERAGE GAP CLOSED (metadata program Phase 0 audit). assertMirrorPairMatches()
// was already generic, but only compactClaims.ts was ever passed to it -- so two
// other deliberately-mirrored access/ modules carried the same "if either file
// changes, change the other to match" header with nothing enforcing it.
//
// governedBusinessRoles.ts is the one that matters most: it declares the Role ->
// permission grants, it is the file a capability/role change has to edit in
// lockstep across both copies, and a silent divergence there means the client's
// idea of what a Role grants stops matching the server's. Rules and trusted
// commands remain the authorization boundary either way -- a drifted client
// mirror cannot grant anything -- but it CAN make the UI show or hide the wrong
// affordances, which is a real defect and exactly the kind that hides for months.
//
// Their sibling parity tests (governedBusinessRoles.test.mjs,
// shadowParityHarness.test.mjs) test BEHAVIOR of one copy. That is a different
// question from whether the two files still agree, which is what this asserts.
check("governedBusinessRoles.ts: server and client mirrors are identical beyond the documented cross-reference line", () => {
  assertMirrorPairMatches("governedBusinessRoles.ts");
});

check("shadowParityHarness.ts: server and client mirrors are identical beyond the documented cross-reference line", () => {
  assertMirrorPairMatches("shadowParityHarness.ts");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
