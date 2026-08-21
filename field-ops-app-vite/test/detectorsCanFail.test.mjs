// A DETECTOR IS NOT TRUSTED BECAUSE IT PASSES. Run: node --test test/detectorsCanFail.test.mjs
//
// ============================ WHY THIS FILE EXISTS ============================
//
// The full-site certification program produced FIVE separate families of detector defect, and every
// one of them reported a confident, wrong answer:
//
//   1. Hash navigation on a path router     -> "53 of 54 routes clean", having never left page one.
//   2. Screen-reader landmarks as clipped   -> "54 of 54 routes broken".
//   3. Desktop controls vs a touch floor    -> 215 phantom tiny targets on surfaces that never
//                                              promised one.
//   4. Offscreen vs reachable-in-scroller   -> the Scheduling board reported broken at EVERY width,
//                                              1440 included.
//   5. A 20-char word treated as an id      -> "postPurchasingUpdate" reported as a raw key on the
//                                              screen whose subject matter is capability ids.
//
// And one guard in this very suite MATCHED NOTHING AT ALL: its pattern used \([^)]*\) for a find()
// argument, which stops at the `)` closing the arrow parameter `(t)`. It passed while ten violations
// sat in the tree, and was caught only by deliberately injecting an eleventh and watching the suite
// stay green.
//
// The lesson generalises past any one bug: A GREEN DETECTOR AND AN ABSENT DETECTOR ARE
// INDISTINGUISHABLE FROM THE OUTSIDE. Both say nothing. So a detector that gates certification owes
// evidence that it can still fail, and that evidence has to be executable, because a detector rots
// silently -- a refactor renames a class, a pattern stops matching, and the suite goes on reporting
// success forever.
//
// ============================ WHAT THIS DOES, AND DOES NOT, DO ============================
//
// Each case feeds a detector a KNOWN VIOLATION and asserts it objects, then feeds it clean input and
// asserts it does not. Both halves matter: a detector that always fires is as useless as one that
// never does, it just fails louder.
//
// This deliberately does NOT mutate real source files or stand up a browser. Detectors whose logic
// is expressible as a pure predicate are tested here against synthetic input; the geometry detectors
// in certify.mjs, which need a live DOM, carry their false-positive histories as named guards in
// that file and are exercised by the sweep itself. Building a headless-browser mutation harness to
// cover them would add more machinery than it protects -- the brief's own instruction is to target
// the detectors that gate certification, not to manufacture synthetic complexity.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const CERTIFY = readFileSync(
  path.join(ROOT, ".claude/skills/run-field-ops-app-vite/certify.mjs"), "utf8",
);

test("the inline technician-lookup guard fires on a real violation", () => {
  // The exact defect it exists to catch, in the exact form nine surfaces had written it.
  const guard = /technicians\s*\.\s*find\b[^\n]*?\?\.\s*name/g;
  const violation = 'const techName = (id) => technicians.find((t) => t.id === id)?.name ?? id;';
  assert.ok(guard.test(violation), "MUST match — this is the shape that shipped nine times");

  // The regression that made this guard vacuous, pinned so it cannot come back: an argument pattern
  // that stops at the arrow parameter's closing paren never reaches `?.name`.
  const vacuous = /technicians\s*\.\s*find\s*\([^)]*\)\s*\?\.\s*name/g;
  assert.ok(!vacuous.test(violation), "the OLD pattern matched nothing — kept here as the counter-example");
});

test("the inline technician-lookup guard does NOT fire on the correct call", () => {
  const guard = /technicians\s*\.\s*find\b[^\n]*?\?\.\s*name/g;
  const correct = 'const techName = (id) => resolveTechnicianIdentity(id, { technicians }).name;';
  assert.ok(!guard.test(correct), "a detector that always fires is as useless as one that never does");
});

test("the RAW_ID detector separates a Firestore key from ordinary vocabulary", () => {
  // Family 5. The check must catch random document keys and leave the app's own subject matter
  // alone -- a false positive here asks somebody to delete correct content.
  const pick = (text) =>
    (text.match(/\b[A-Za-z0-9]{20}\b/g) || [])
      .find((t) => /[0-9]/.test(t) && /[a-z]/.test(t) && /[A-Z]/.test(t));

  assert.equal(pick("doc 8fKq2LmZ0aBcDeFgHiJk here"), "8fKq2LmZ0aBcDeFgHiJk", "MUST catch a real key");
  assert.equal(pick("holds postPurchasingUpdate today"), undefined, "a capability id is not a raw key");
  assert.equal(pick("abcdefghijklmnopqrst"), undefined, "an all-lowercase word is not a key");
});

test("the sweep still carries the guards for every false-positive family it has had", () => {
  // Structural, not behavioural: these are the geometry detectors that cannot be unit-tested without
  // a browser. What IS checkable is that the reasoning has not been quietly deleted in a cleanup --
  // each of these guards was written because the sweep had already reported a wrong number, and
  // removing one silently restores that number.
  for (const [marker, family] of [
    ["PATH navigation, not hash", "hash navigation reported 53/54 clean"],
    ["TOUCH TARGETS ARE ONLY PROMISED", "desktop controls vs a touch floor"],
    ["OFFSCREEN, BUT REACHABLE, IS NOT A DEFECT", "reachable-inside-a-scroller"],
    ["A FIRESTORE KEY IS NOT MERELY A LONG WORD", "20-char word treated as an id"],
    ["COVERAGE IS PART OF THE RESULT", "a half-measured sweep looking finished"],
  ]) {
    assert.ok(CERTIFY.includes(marker), `certify.mjs lost its guard for: ${family}`);
  }
});

test("the sweep cannot report a partial run as a pass", () => {
  // The one that mattered most: a run measured 136 of 270 visits and printed a tidy findings table.
  // On an unmeasured route the ABSENCE of a finding reads exactly like a clean result.
  assert.match(CERTIFY, /COVERAGE INCOMPLETE/, "the partial-run banner must exist");
  assert.match(CERTIFY, /process\.exitCode = 1/, "a partial run must exit non-zero, not merely warn");
  assert.match(CERTIFY, /sessionIsDead/, "a dead browser must be distinguished from a page defect");
});

test("the CSS coverage guard still owns a real, shrink-only backlog", () => {
  // Its burn-down list is the part that can rot into permission: entries that are no longer real
  // orphans quietly make room for new ones. cssClassCoverage.test.mjs asserts staleness itself; what
  // is asserted here is that the list has not simply been emptied or turned into a blanket allow.
  const cov = readFileSync(path.join(ROOT, "test/cssClassCoverage.test.mjs"), "utf8");
  assert.match(cov, /SHRINK ONLY/, "the burn-down list must still be declared shrink-only");
  assert.match(cov, /may only SHRINK/, "the staleness assertion must still exist");
});

test("the reachability profiler cannot report a partial profile as a complete one", () => {
  // The sibling tool learned this the same way certify.mjs did, one program later. A technician
  // profile reported 46 denied / 1 unmeasured and looked finished; the unmeasured route was
  // /reporting/builder at index 32, and that identical route loads in ~1.2s when probed directly
  // after login. It was position in the run, not the page -- the profiler visited 54 routes in one
  // browser with no recycling and no recovery, which is exactly the defect certify.mjs had already
  // been hardened against.
  //
  // Recorded here rather than left to the tool alone, because an unmeasured route produces NO
  // classification, and a missing classification is indistinguishable from a clean one.
  const reach = readFileSync(
    path.join(ROOT, ".claude/skills/run-field-ops-app-vite/reachability.mjs"), "utf8",
  );
  assert.match(reach, /openSession/, "must be able to reopen a session, not just launch one");
  assert.match(reach, /visitIndex % 15/, "must recycle before the browser degrades");
  assert.match(reach, /never measured/, "must say when a profile is incomplete");
  assert.match(reach, /process\.exitCode = 1/, "an incomplete profile must exit non-zero");
});

test("both sweep tools scope the emulator switch to local runs", () => {
  // CERT_BASE lets these run against a DEPLOYED sandbox. `?emulator=1` carried into a deployed run
  // would point the app at emulators that do not exist and fail every route for a reason unrelated
  // to the build -- a confidently wrong number, which is this program's signature failure. It stays
  // mandatory locally: dropping it repoints the app at PRODUCTION mid-run.
  for (const f of ["certify.mjs", "reachability.mjs", "createReach.mjs"]) {
    const src = readFileSync(path.join(ROOT, ".claude/skills/run-field-ops-app-vite", f), "utf8");
    assert.match(src, /CERT_BASE/, `${f} must accept a deployed base`);
    assert.match(src, /IS_LOCAL/, `${f} must scope the emulator switch to local runs`);
  }
});
