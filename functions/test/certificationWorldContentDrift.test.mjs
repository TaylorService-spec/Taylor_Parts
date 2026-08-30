// SAME VERSION, SAME COUNTS, DIFFERENT CONTENT -- and verify used to call that COMPLETE.
//
// ============================ THE FAILURE THIS EXISTS TO PREVENT ============================
//
// On 2026-08-30, EOS Ownership Model v1 added deterministic ownership fields to account and
// equipment records. It created no records and deleted none:
//
//   before   version 1.6.0   1092 records   fingerprint 005ebb1b
//   after    version 1.6.0   1092 records   fingerprint ed95c91d
//
// Every figure classifyWorld compared was identical. It reported COMPLETE, and went on reporting it,
// against a repository that no longer described the installed world. The only thing that noticed was
// an unrelated test that happened to pin the fingerprint.
//
// That is the worst shape a verification failure can take: not a wrong answer, but a confident right-
// looking one. An operator reading COMPLETE has no reason to look further, and the drift compounds
// silently underneath every later decision that trusts it.
//
// So content is now part of completeness, and these cases hold that line -- INCLUDING the exact
// 005ebb1b vs ed95c91d pair, as a fixture, with no live Firebase anywhere.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;
/** Source with line endings normalized -- a CRLF checkout otherwise breaks every boundary search. */
function readFileSyncNormalized(rel) {
  return readFileSync(path.resolve(REPO, rel), "utf8")
    .split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
}

const { classifyWorld, WORLD_STATE, SEED_POLICY } =
  await import(L("functions/scripts/certificationWorld/verify.mjs"));

/** The real shape: version 1.7.0, the ten collections, 1092 records, all counts matching. */
const COUNTS = Object.freeze({
  accounts: 100, locations: 180, contacts: 337, equipment_models: 48, mobile_locations: 5,
  employees: 47, equipment: 278, parts: 45, fieldops_technicians: 11, fieldops_jobs: 41,
});
const TOTAL = Object.values(COUNTS).reduce((a, b) => a + b, 0);

const healthyLinkage = { expectedLinked: 47, linked: 47, reverseLinked: 47, mismatched: [], duplicateUids: [] };

const world = (over = {}) => ({
  expected: { version: "1.7.0", counts: COUNTS },
  actual: { ...COUNTS },
  versionsFound: ["1.7.0"],
  duplicateIds: [],
  invariantViolations: [],
  identityLinkage: healthyLinkage,
  ...over,
});

test("the world fixture is the real one -- 1092 records across ten collections", () => {
  // If this drifts from the actual dataset the rest of the file is testing a world that does not
  // exist, which is its own kind of silent pass.
  assert.equal(TOTAL, 1092);
  assert.equal(Object.keys(COUNTS).length, 10);
});

// ── THE EXACT REGRESSION ──────────────────────────────────────────────────────────────────────

test("THE 005ebb1b vs ed95c91d CASE: same version, same 1092 count, different content => NOT COMPLETE", () => {
  const r = classifyWorld(world({
    fingerprint: { expected: "ed95c91d", installed: "005ebb1b" },
  }));
  assert.notEqual(r.state, WORLD_STATE.COMPLETE, "this is the exact case that used to report COMPLETE");
  assert.equal(r.state, WORLD_STATE.CONTENT_DRIFT);
});

test("the drift report names BOTH fingerprints, so nobody has to go and compute one", () => {
  const r = classifyWorld(world({ fingerprint: { expected: "ed95c91d", installed: "005ebb1b" } }));
  const text = r.findings.join(" | ");
  assert.match(text, /005ebb1b/, "the installed fingerprint must be shown");
  assert.match(text, /ed95c91d/, "the expected fingerprint must be shown");
});

test("the drift report says the counts matched, so it is not mistaken for missing records", () => {
  // An operator told only "fingerprint mismatch" reasonably wonders whether records are missing.
  // Saying the counts DID match is what points them at content rather than at a reseed.
  const r = classifyWorld(world({ fingerprint: { expected: "ed95c91d", installed: "005ebb1b" } }));
  assert.match(r.findings.join(" | "), /record count matches/i);
  assert.deepEqual(r.missing, {}, "nothing is missing");
  assert.deepEqual(r.extra, {}, "nothing is extra");
});

// ── DRIFT IS ITS OWN STATE, NOT A FLATTENED ONE ───────────────────────────────────────────────

test("CONTENT_DRIFT is not PARTIAL and not VERSION_MISMATCH", () => {
  // Flattening into PARTIAL would say "records are missing" when none are, and into
  // VERSION_MISMATCH would say "install a different version" when the version is the one asked for.
  // Both send an operator to fix the wrong thing.
  const r = classifyWorld(world({ fingerprint: { expected: "ed95c91d", installed: "005ebb1b" } }));
  assert.notEqual(r.state, WORLD_STATE.PARTIAL);
  assert.notEqual(r.state, WORLD_STATE.VERSION_MISMATCH);
  assert.notEqual(r.state, WORLD_STATE.ABSENT);
});

test("CONTENT_DRIFT refuses to proceed and is NOT treated as already-applied", () => {
  // alreadyApplied is what COMPLETE carries. If drift inherited it, the seeder would skip a world
  // that specifically needs rebuilding -- the same silence, one layer down.
  const policy = SEED_POLICY[WORLD_STATE.CONTENT_DRIFT];
  assert.ok(policy, "CONTENT_DRIFT must have an explicit seed policy");
  assert.equal(policy.proceed, false);
  assert.notEqual(policy.alreadyApplied, true);
  assert.match(policy.reason, /VERIFY IS EVIDENCE, NOT REPAIR/);
});

// ── A MATCHING FINGERPRINT STILL COMPLETES ────────────────────────────────────────────────────

test("matching fingerprints still report COMPLETE", () => {
  const r = classifyWorld(world({ fingerprint: { expected: "ed95c91d", installed: "ed95c91d" } }));
  assert.equal(r.state, WORLD_STATE.COMPLETE);
  assert.deepEqual(r.findings, []);
});

test("a world with NO recorded fingerprint cannot report COMPLETE", () => {
  // Absent evidence is not evidence of agreement. Reporting COMPLETE here would claim a check that
  // never ran, which is the same lie as reporting it on a mismatch.
  const r = classifyWorld(world({ fingerprint: { expected: "ed95c91d", installed: null } }));
  assert.equal(r.state, WORLD_STATE.CONTENT_DRIFT);
  assert.match(r.findings.join(" | "), /no content fingerprint/i);
});

// ── ORDER OF CHECKS ───────────────────────────────────────────────────────────────────────────

test("content is judged BEFORE identity -- a drifted world's linkage is the wrong question", () => {
  const r = classifyWorld(world({
    fingerprint: { expected: "ed95c91d", installed: "005ebb1b" },
    identityLinkage: { expectedLinked: 47, linked: 0, reverseLinked: 0, mismatched: [], duplicateUids: [] },
  }));
  assert.equal(r.state, WORLD_STATE.CONTENT_DRIFT,
    "drift must win: relinking principals into a world that is the wrong dataset fixes nothing");
});

test("version mismatch still wins over content drift", () => {
  // Counts compared across versions are meaningless, and so is a fingerprint. The existing
  // precedence is preserved rather than quietly reordered by the new check.
  const r = classifyWorld(world({
    versionsFound: ["1.6.0"],
    fingerprint: { expected: "ed95c91d", installed: "005ebb1b" },
  }));
  assert.equal(r.state, WORLD_STATE.VERSION_MISMATCH);
});

test("missing records still report PARTIAL, not drift", () => {
  const r = classifyWorld(world({
    actual: { ...COUNTS, accounts: 99 },
    fingerprint: { expected: "ed95c91d", installed: "005ebb1b" },
  }));
  assert.equal(r.state, WORLD_STATE.PARTIAL, "a genuinely incomplete world is still PARTIAL");
});

// ── THE FINGERPRINT ARGUMENT IS OPTIONAL, AND THAT MUST NOT BE A LOOPHOLE ─────────────────────

test("omitting the fingerprint preserves the pure count-classification contract", () => {
  // The pure unit tests of count classification must not be forced to model content, exactly as
  // they are not forced to model identity. A LIVE verify always supplies it.
  const { fingerprint, ...withoutFingerprint } = world();
  const r = classifyWorld(withoutFingerprint);
  assert.equal(r.state, WORLD_STATE.COMPLETE);
});

test("the LIVE verify always supplies a fingerprint -- the optionality is for unit tests only", () => {
  // Asserted against the caller, because an optional argument is only safe while the one call site
  // that matters actually passes it.
  const src = readFileSyncNormalized("functions/scripts/certificationWorld.mjs");
  const fn = src.slice(src.indexOf("async function doVerify"));
  const body = fn.slice(0, fn.indexOf(String.fromCharCode(10) + "}" + String.fromCharCode(10)));
  assert.match(body, /fingerprint: \{ expected:/, "doVerify must pass a fingerprint to classifyWorld");
  assert.match(body, /worldFingerprint\(records\)/, "the expectation must come from the repository builder");
});

