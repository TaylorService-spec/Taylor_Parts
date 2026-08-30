// EOS Ownership Model v1 — the PRODUCTION GUARD, asserted rather than promised.
//
// The pre-backfill gate asks for "confirmation that the proposed applier cannot touch production".
// NO APPLIER EXISTS YET -- that is the honest answer, and it is the strongest one available: a tool
// that does not exist cannot write anywhere.
//
// What CAN be confirmed today is the guard every ownership-writing script in this program already
// carries, and that is what this suite pins. When an applier is authorized it inherits this same
// guard, and this suite is what will fail if it does not.
//
// The guard is asserted by READING the scripts, not by running them against a project. A test that
// proved production refusal by attempting a production connection would be the thing it is testing
// against.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const script = (rel) => readFileSync(join(here, "..", "scripts", rel), "utf8");

/** Every script in this program that can write. If one is added, it belongs in this list. */
const WRITING_SCRIPTS = ["seedOperatingCompanies.js", "certificationWorld/seedAccountOwners.mjs"];

/** Every script that only reads. These must have no write path at all. */
const READ_ONLY_SCRIPTS = [
  "ownershipCensusDryRun.js",
  "ownershipDerivationCheck.js",
  "ownershipBackfillSimulation.js",
  // workOrderJobLineageCheck.js was DELETED (DECISIONS #143): it measured "does this Work Order
  // have a parent Job", a question the withdrawn R-12 model made meaningful and the corrected model
  // does not. Its result is preserved in DECISIONS #143 and in sb-evidence. A tool that answers a
  // question the domain no longer asks is a trap, not an asset.
];

test("every ownership-writing script refuses production, by name AND by registry role", () => {
  // Asserts the GUARANTEE, not one mechanism for it. A script may satisfy this two ways:
  //
  //   DELEGATED  — it uses certificationWorld/executionTarget.mjs, the shared authority. This is
  //                the STRONGER form and is preferred: the shared authority also distinguishes
  //                eos-platform-sandbox from eos-platform-certification, which a local role check
  //                cannot, and it requires a per-target named live flag.
  //   LOCAL      — it performs the checks itself.
  //
  // The earlier version of this test demanded the LOCAL form of every script, and that was a defect
  // in the test: when seedAccountOwners.mjs moved to the shared authority -- a strict improvement,
  // required by certificationExecutionTarget.mjs -- this test failed the better implementation.
  // A test that pins a mechanism blocks the mechanism from improving.
  for (const rel of WRITING_SCRIPTS) {
    const src = script(rel);
    const delegated = /from "\.\/executionTarget\.mjs"|from "\.\.\/certificationWorld\/executionTarget\.mjs"/.test(src)
      && /resolveExecutionTarget\s*\(/.test(src);

    if (delegated) {
      // A delegating script must actually GATE on the result, not merely import it.
      assert.match(src, /assertBothLiveFlags\s*\(/, `${rel} delegates but never demands the live flags`);
      continue;
    }

    // Belt: the customer production project is named and refused explicitly.
    assert.match(src, /taylor-parts/, `${rel} must name the production project to refuse it`);
    assert.match(src, /REFUSING: taylor-parts is the customer production project/, `${rel} must refuse taylor-parts by name`);
    // Braces: the environment REGISTRY is the authority, so a new production project added there is
    // refused without anyone remembering to add its name here.
    assert.match(src, /config\/environments\.json/, `${rel} must consult the environment registry`);
    assert.match(src, /role/, `${rel} must refuse on the registry role, not only on a name`);
    // An unknown project fails CLOSED rather than being treated as safe.
    assert.match(src, /fail closed|Unknown projects fail closed/i, `${rel} must fail closed on an unknown project`);
    // No default target -- a script that could run with no --projectId could run somewhere unintended.
    assert.match(src, /--projectId is required/, `${rel} must require an explicit target`);
  }
});

test("the shared execution-target authority is what the delegating scripts rely on", () => {
  // If a script delegates, the thing it delegates TO must still carry the guarantees. Otherwise
  // "delegated" above would be a way to opt out of the check rather than a stronger way to pass it.
  const shared = readFileSync(join(here, "..", "scripts", "certificationWorld", "executionTarget.mjs"), "utf8");
  assert.match(shared, /PRODUCTION_PROJECT = "taylor-parts"/, "the shared authority must name production");
  assert.match(shared, /Refused by name/, "the shared authority must refuse production by name");
  assert.match(shared, /role === "production"/, "the shared authority must refuse production by registry role");
  assert.match(shared, /--projectId is required/, "the shared authority must require an explicit target");
  assert.match(shared, /Unknown project/, "the shared authority must fail closed on an unknown project");
  // The distinction a local guard cannot make: two different sandbox-role projects, two flags.
  assert.match(shared, /LIVE_SANDBOX_PROJECT = "eos-platform-sandbox"/);
  assert.match(shared, /CERTIFICATION_PROJECT = "eos-platform-certification"/);
});

test("the read-only tools contain no Firestore write call at all", () => {
  // Anchored to Firestore handles on purpose. A bare search for `.set(` or `.add(` also matches
  // in-memory Map.set and Set.add, and a check that cries wolf is one an operator learns to ignore.
  const firestoreWrite = /\b(db|collection\([^)]*\)|doc\([^)]*\))\.(set|update|delete|add)\(|\.batch\(|runTransaction\(/;
  for (const rel of READ_ONLY_SCRIPTS) {
    assert.doesNotMatch(script(rel), firestoreWrite, `${rel} must contain no Firestore write`);
  }
});

test("the backfill simulation has no apply mode, and none may be added quietly", () => {
  const src = script("ownershipBackfillSimulation.js");
  // The simulation is the backfill with the writes removed. If an --apply flag ever appears, it must
  // arrive with its own authorization and its own production guard -- and this assertion is what
  // makes adding one a deliberate act rather than a small convenience.
  assert.doesNotMatch(src, /args\.apply|"--apply"|args\["apply"\]/, "the simulation must not gain an apply mode without review");
  assert.match(src, /NOTHING WAS WRITTEN/, "the simulation must state plainly that it wrote nothing");
});

test("no ownership script targets production as a default anywhere", () => {
  for (const rel of [...WRITING_SCRIPTS, ...READ_ONLY_SCRIPTS]) {
    const src = script(rel);
    // A hardcoded production default is the failure mode this catches: a script that works without
    // a target is a script that can run against the wrong one.
    assert.doesNotMatch(src, /projectId\s*[=:]\s*["']taylor-parts["']/, `${rel} must never default to production`);
  }
});
