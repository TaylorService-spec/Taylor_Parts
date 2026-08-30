// The Equipment North Star Quick Gate's own contract, asserted offline.
//
// The gate itself only runs against a deployed sandbox, so nothing in CI can execute it. What CI
// CAN do is hold the properties that make it safe and honest to run, because those are the ones
// that would be quietly lost in an edit:
//
//   READ-ONLY        it must never press Confirm installation. Installation is irreversible —
//                    accountId/locationId are immutable after create, nothing clears the serialized
//                    asset's link, and no recovery authority exists. A gate that proved the
//                    confirmation composition by performing one would be indefensible.
//   FAIL-CLOSED      it must refuse a missing --expect, a mismatched release, and any non-sandbox
//                    origin. A gate that measures the wrong bundle reports a green family from code
//                    that is not deployed, which is worse than no gate.
//   NOT VACUOUS      a precondition the sandbox does not offer must be REPORTED as skipped, never
//                    counted as a pass. This is the Parts gate's own lesson 3, held here by test.
//   NO PINNED NAME   ND-31 governs the unresolved-location REASON, not one literal string, and
//                    ND-32 governs the VALUES, not the column names. A gate that pinned either
//                    would fail a correct page — the Parts gate did exactly that when ND-30 renamed
//                    a column out from under it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, "..", ".claude", "skills", "run-field-ops-app-vite", "equipmentNorthStarQuickGate.mjs");
const source = readFileSync(GATE, "utf8");
// Comments explain what the gate refuses; only CODE can perform it. Scanning raw text would make
// the explanation the defect and reward deleting it.
const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

test("READ-ONLY — the gate never presses Confirm installation", () => {
  // It may LOCATE the confirm button (that is the assertion), and it may click Cancel. It must not
  // click confirm. The distinction is the `.click()` chained onto a confirm locator.
  assert.doesNotMatch(code, /confirmBtn\s*\.\s*click/);
  assert.doesNotMatch(code, /name:\s*\/\^?Confirm installation\$?\/i?\s*\}\s*\)\s*\.\s*click/);
});

test("READ-ONLY — the gate submits no form and issues no write verb", () => {
  // The only fetch it makes is a GET: version.json, and the governed Firestore document read.
  assert.doesNotMatch(code, /method:\s*["'](POST|PUT|PATCH|DELETE)["']/);
  assert.doesNotMatch(code, /\.press\(\s*["']Enter["']\s*\)/);
  assert.doesNotMatch(code, /type=["']submit["']/);
});

test("READ-ONLY — it creates no Equipment and runs no lifecycle command", () => {
  for (const forbidden of [/New Equipment/i, /Create equipment/i, /\bretire\b\s*\)\s*\.\s*click/i, /Save\b.*\.click/]) {
    assert.doesNotMatch(code, forbidden);
  }
});

test("FAIL-CLOSED — --expect is required, not optional", () => {
  assert.match(code, /if\s*\(\s*!EXPECT_SHA\s*\)/);
  assert.match(code, /process\.exit\(2\)/);
});

test("FAIL-CLOSED — a release mismatch refuses before any Equipment assertion", () => {
  const identityIdx = code.indexOf("release identity");
  const firstWorkspaceIdx = code.indexOf("openWorkspace(page)", code.indexOf("async function main"));
  assert.ok(identityIdx > 0, "the gate must have a release-identity check");
  assert.ok(
    identityIdx < firstWorkspaceIdx,
    "release identity must be CHECK ZERO — it runs before the browser measures anything",
  );
  assert.match(code, /REFUSING: the origin is not serving the release/);
});

test("FAIL-CLOSED — it refuses any origin that is not the sandbox, and any production role", () => {
  assert.match(code, /eos-platform-sandbox/);
  assert.match(code, /environmentRole === "production"/);
});

test("NOT VACUOUS — a skip is recorded as unmeasured, never as a pass", () => {
  assert.match(code, /skipped:\s*true/);
  // The summary must count them separately, so a run of skips cannot read as a green gate.
  assert.match(code, /skipped\.length/);
  assert.match(code, /SKIPPED \(unmeasured, not green\)/);
});

test("NO PINNED NAME — ND-31 is asserted as a reason, not as one literal string", () => {
  // The installed register accepts ANY governed reference-state sentence. If this list ever shrinks
  // to one entry, the gate has started failing correct pages.
  assert.match(code, /TRUTHFUL_REFERENCE_ABSENCES/);
  const list = /const TRUTHFUL_REFERENCE_ABSENCES = \[([\s\S]*?)\];/.exec(source)?.[1] ?? "";
  const entries = list.match(/"[^"]+"/g) ?? [];
  assert.ok(entries.length >= 4, `expected the governed reference states, got ${entries.length}: ${entries}`);
  for (const required of ['"No longer exists"', '"Not available to your role"', '"Could not be loaded"']) {
    assert.ok(entries.includes(required), `${required} must stay acceptable on the installed register`);
  }
});

test("NO PINNED NAME — ND-32 is asserted by deriving column positions from the deployed headings", () => {
  // Cells addressed by the INDEX of their own heading, never by a hard-coded data-label. This is
  // what stops a future ruling that renames a column from failing a correct page.
  assert.match(code, /headings\.findIndex/);
  assert.match(code, /td:nth-child\(\$\{i[A-Za-z]+ \+ 1\}\)/);
});

test("DIAGNOSABLE — no silent catch replaces the underlying error", () => {
  // `.catch(() => "")` and `.catch(() => 0)` are fine: they supply a DEFAULT for a value the gate
  // then reports. A bare `catch {}` that swallows a thrown error is not, and it is how a
  // ReferenceError was reported as a data finding for two full runs.
  assert.doesNotMatch(code, /catch\s*\{\s*\}/);
  assert.match(code, /Underlying error: \$\{err\?\.message \?\? err\}/);
});

test("NO FIXED DELAY where an observable readiness condition exists", () => {
  // One bounded poll loop for the Available terminal state is legitimate — it IS the observable
  // condition, sampled. What must not appear is a bare sleep standing in for a wait.
  const sleeps = code.match(/waitForTimeout\(\s*\d+\s*\)/g) ?? [];
  assert.ok(sleeps.length <= 1, `expected at most the terminal-state poll, found ${sleeps.length}: ${sleeps}`);
});

test("the gate names the family's rulings it exists to hold", () => {
  for (const ruling of ["ND-31", "ND-32", "EQ-G5", "EQ-D2", "EQ-G4", "EQ-G2"]) {
    assert.ok(source.includes(ruling), `${ruling} must be named in the gate`);
  }
});
