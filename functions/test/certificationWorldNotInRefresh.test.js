// DEPLOYING CODE MUST NEVER DESTROY SANDBOX TEST DATA.
// Run: node --test functions/test/certificationWorldNotInRefresh.test.js
//
// ============================ WHAT THIS PROTECTS ============================
//
// The Certification World is a permanent fixture system. Operational test history -- work orders
// worked, counts submitted, returns taken in -- is allowed to ACCUMULATE between intentional resets,
// and that accumulated state is often the most valuable thing in the sandbox.
//
// A sandbox refresh deploys application code. It has no business clearing data. The two operations
// are separate by policy, and policy that lives only in a document is policy that survives exactly
// until someone adds a convenient import.
//
// So the separation is enforced structurally: the refresh tooling must not reference the
// certification world's reset or rebuild path at all.
//
// This is deliberately a STRUCTURAL check rather than a behavioural one. Proving "refresh did not
// delete anything" requires running a deploy, which this repository does not do from a test -- and
// which would prove it only for the run that happened. Proving the code cannot reach the destructive
// path holds for every run.
//
// If reset/rebuild is ever deliberately integrated into another workflow, this test fails and the
// change becomes explicit and reviewed -- which is the point. It is not meant to forbid the
// integration; it is meant to stop one arriving by accident through an incidental import.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.resolve(__dirname, "../..");

// The tooling a normal application refresh runs. If a new entry point joins this lifecycle, add it
// here -- an unlisted file is unprotected, and the omission would be invisible.
const REFRESH_TOOLING = [
  "scripts/_sandboxRefresh.run.sh",
  "scripts/Invoke-SandboxRefresh.ps1",
  "scripts/_sandboxRegressionGate.sh",
  "scripts/_sandboxDeployGuard.mjs",
];

// Any reference to these is a route to destroying certification data.
const DESTRUCTIVE_REFERENCES = [
  "certificationWorld.mjs",
  "certificationWorld/",
  "--confirm-reset",
];

test("normal sandbox refresh tooling exists where this guard expects it", () => {
  // A guard that silently checks nothing is worse than no guard: it also reports success. If a file
  // is renamed, this fails loudly rather than passing over an empty list.
  for (const rel of REFRESH_TOOLING) {
    assert.ok(fs.existsSync(path.join(REPO, rel)), `${rel} is missing -- update REFRESH_TOOLING, do not delete the guard`);
  }
});

test("no refresh tooling can reach certification world reset or rebuild", () => {
  const offenders = [];
  for (const rel of REFRESH_TOOLING) {
    const src = fs.readFileSync(path.join(REPO, rel), "utf8");
    for (const marker of DESTRUCTIVE_REFERENCES) {
      if (src.includes(marker)) offenders.push(`${rel} references ${marker}`);
    }
  }
  assert.deepEqual(
    offenders, [],
    "Deploying application code must never silently destroy sandbox test data.\n" +
    "A Certification World reset is an EXPLICIT operator action, never a side effect of a refresh.\n" +
    "If this integration is intended, that is a reviewed decision -- change this guard deliberately:\n  " +
    offenders.join("\n  "),
  );
});

test("the certification world CLI still refuses to reset without explicit confirmation", () => {
  // The other half of the same protection. Even invoked directly, reset must not be the default --
  // a destructive default is an accident waiting for a tired operator at the end of a long day.
  const cli = fs.readFileSync(path.join(REPO, "functions/scripts/certificationWorld.mjs"), "utf8");
  assert.match(cli, /reset is destructive/, "reset must refuse to run without --confirm-reset");
  assert.match(cli, /--confirm-reset/, "the explicit confirmation flag must still exist");
  assert.match(cli, /refusing to rebuild over a/, "rebuild must refuse to clobber an existing world unasked");
});
