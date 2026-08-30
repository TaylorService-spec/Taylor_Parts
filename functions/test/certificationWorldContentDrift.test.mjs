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
    fingerprint: { expected: "ed95c91d", recorded: "005ebb1b", observed: "005ebb1b" },
  }));
  assert.notEqual(r.state, WORLD_STATE.COMPLETE, "this is the exact case that used to report COMPLETE");
  assert.equal(r.state, WORLD_STATE.CONTENT_DRIFT);
});

test("the drift report names BOTH fingerprints, so nobody has to go and compute one", () => {
  const r = classifyWorld(world({ fingerprint: { expected: "ed95c91d", recorded: "005ebb1b", observed: "005ebb1b" } }));
  const text = r.findings.join(" | ");
  assert.match(text, /005ebb1b/, "the mismatching fingerprint must be shown");
  assert.match(text, /ed95c91d/, "the expected fingerprint must be shown");
});

test("the drift report says the counts matched, so it is not mistaken for missing records", () => {
  // An operator told only "fingerprint mismatch" reasonably wonders whether records are missing.
  // Saying the counts DID match is what points them at content rather than at a reseed.
  const r = classifyWorld(world({ fingerprint: { expected: "ed95c91d", recorded: "005ebb1b", observed: "005ebb1b" } }));
  assert.match(r.findings.join(" | "), /record count matches/i);
  assert.deepEqual(r.missing, {}, "nothing is missing");
  assert.deepEqual(r.extra, {}, "nothing is extra");
});

// ── DRIFT IS ITS OWN STATE, NOT A FLATTENED ONE ───────────────────────────────────────────────

test("CONTENT_DRIFT is not PARTIAL and not VERSION_MISMATCH", () => {
  // Flattening into PARTIAL would say "records are missing" when none are, and into
  // VERSION_MISMATCH would say "install a different version" when the version is the one asked for.
  // Both send an operator to fix the wrong thing.
  const r = classifyWorld(world({ fingerprint: { expected: "ed95c91d", recorded: "005ebb1b", observed: "005ebb1b" } }));
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
  const r = classifyWorld(world({ fingerprint: { expected: "ed95c91d", recorded: "ed95c91d", observed: "ed95c91d" } }));
  assert.equal(r.state, WORLD_STATE.COMPLETE);
  assert.deepEqual(r.findings, []);
});

test("a world with NO recorded fingerprint cannot report COMPLETE", () => {
  // Absent evidence is not evidence of agreement. Reporting COMPLETE here would claim a check that
  // never ran, which is the same lie as reporting it on a mismatch.
  const r = classifyWorld(world({ fingerprint: { expected: "ed95c91d", recorded: null, observed: "ed95c91d" } }));
  assert.equal(r.state, WORLD_STATE.CONTENT_DRIFT);
  assert.match(r.findings.join(" | "), /no content fingerprint/i);
});

// ── ORDER OF CHECKS ───────────────────────────────────────────────────────────────────────────

test("content is judged BEFORE identity -- a drifted world's linkage is the wrong question", () => {
  const r = classifyWorld(world({
    fingerprint: { expected: "ed95c91d", recorded: "005ebb1b", observed: "005ebb1b" },
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
    fingerprint: { expected: "ed95c91d", recorded: "005ebb1b", observed: "005ebb1b" },
  }));
  assert.equal(r.state, WORLD_STATE.VERSION_MISMATCH);
});

test("missing records still report PARTIAL, not drift", () => {
  const r = classifyWorld(world({
    actual: { ...COUNTS, accounts: 99 },
    fingerprint: { expected: "ed95c91d", recorded: "005ebb1b", observed: "005ebb1b" },
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
  assert.match(body, /fingerprint: \{/, "doVerify must pass a fingerprint to classifyWorld");
  assert.match(body, /expected: expectedFingerprint/, "doVerify must pass the expected fingerprint");
  assert.match(body, /recorded: deployed/, "doVerify must pass the deployment record's fingerprint as RECORDED");
  assert.match(body, /observed: observedFingerprint/, "doVerify must pass a measured OBSERVED fingerprint");
  assert.match(body, /worldFingerprint\(records\)/, "the expectation must come from the repository builder");
});

test("OBSERVED is fingerprinted from the FETCHED governed base documents, never manufactured from the deployment record", () => {
  // The gap this whole correction closes: a verify that reads the deployment record's claimed
  // fingerprint proves provenance, not current content. The observed value must come from hashing
  // the documents doVerify actually fetched (`found`, marker-scoped over exactly the builder's
  // base collections) with the SAME canonical worldFingerprint authority the expectation uses.
  const src = readFileSyncNormalized("functions/scripts/certificationWorld.mjs");
  const fn = src.slice(src.indexOf("async function doVerify"));
  const body = fn.slice(0, fn.indexOf(String.fromCharCode(10) + "}" + String.fromCharCode(10)));
  assert.match(body, /const observedFingerprint = worldFingerprint\(found\)\.hash/,
    "observed must be recomputed from the fetched installed documents");
  assert.doesNotMatch(body, /observed:\s*deployed/,
    "observed must never be sourced from the deployment record");
  assert.doesNotMatch(body, /observedFingerprint\s*=\s*deployed/,
    "observed must never be copied from the deployment record");
});

// ── EXPECTED / RECORDED / OBSERVED: three authorities, and any one can be the liar ─────────────
//
// The v1.7 correction. RECORDED (certification_world/current.fingerprint) is provenance evidence:
// what an installation CLAIMED it wrote. It says nothing about what the 1092 live documents
// contain now. A verify that compares EXPECTED against RECORDED alone is capable of reporting
// COMPLETE over mutated live content whose deployment record still carries the right hash -- the
// exact confident-right-looking failure the top of this file describes, one authority over.
// COMPLETE requires EXPECTED == RECORDED AND EXPECTED == OBSERVED. The governed v1.7 resting
// authority is fcc38a5f over 1092 rows, and these cases pin it by value.

const V17 = "fcc38a5f";

test("recorded matches but the LIVE documents drifted => CONTENT_DRIFT (the deployment record cannot vouch for current content)", () => {
  const r = classifyWorld(world({
    fingerprint: { expected: V17, recorded: V17, observed: "deadbeef" },
  }));
  assert.equal(r.state, WORLD_STATE.CONTENT_DRIFT);
  const text = r.findings.join(" | ");
  assert.match(text, /installed-content fingerprint deadbeef/, "must name the observed mismatch");
  assert.match(text, /changed after, or independently of, the recorded installation/,
    "must tell the operator the live content moved out from under a faithful record");
});

test("live documents match but the deployment record disagrees => CONTENT_DRIFT (stale/corrupt provenance)", () => {
  const r = classifyWorld(world({
    fingerprint: { expected: V17, recorded: "ed95c91d", observed: V17 },
  }));
  assert.equal(r.state, WORLD_STATE.CONTENT_DRIFT);
  const text = r.findings.join(" | ");
  assert.match(text, /deployment-record fingerprint ed95c91d/, "must name the recorded mismatch");
  assert.match(text, /provenance record is stale or corrupt/,
    "must tell the operator the record, not the content, is the broken authority");
});

test("recorded AND observed both wrong (differently) => CONTENT_DRIFT naming both failures", () => {
  const r = classifyWorld(world({
    fingerprint: { expected: V17, recorded: "aaaa1111", observed: "bbbb2222" },
  }));
  assert.equal(r.state, WORLD_STATE.CONTENT_DRIFT);
  const text = r.findings.join(" | ");
  assert.match(text, /deployment-record fingerprint aaaa1111/);
  assert.match(text, /installed-content fingerprint bbbb2222/);
});

test("all three fcc38a5f, plus every other completeness requirement => COMPLETE", () => {
  const r = classifyWorld(world({
    fingerprint: { expected: V17, recorded: V17, observed: V17 },
  }));
  assert.equal(r.state, WORLD_STATE.COMPLETE);
  assert.deepEqual(r.findings, []);
});

test("a missing OBSERVED measurement cannot report COMPLETE, same as a missing recorded value", () => {
  // Symmetric with the no-recorded-fingerprint case: content the verify never hashed is content
  // it may not vouch for.
  const r = classifyWorld(world({
    fingerprint: { expected: V17, recorded: V17, observed: null },
  }));
  assert.equal(r.state, WORLD_STATE.CONTENT_DRIFT);
  assert.match(r.findings.join(" | "), /no observed fingerprint was measured/i);
});

test("any fingerprint mismatch is never treated as already-applied", () => {
  // alreadyApplied is COMPLETE's property alone; every drifted world must remain a rebuild
  // candidate, whichever of the three authorities failed.
  for (const fp of [
    { expected: V17, recorded: V17, observed: "deadbeef" },
    { expected: V17, recorded: "ed95c91d", observed: V17 },
    { expected: V17, recorded: "aaaa1111", observed: "bbbb2222" },
  ]) {
    const r = classifyWorld(world({ fingerprint: fp }));
    const policy = SEED_POLICY[r.state];
    assert.equal(policy.proceed, false);
    assert.notEqual(policy.alreadyApplied, true);
  }
});

// ── OBSERVED USES THE CANONICAL FINGERPRINT SEMANTICS ─────────────────────────────────────────

const { worldFingerprint } = await import(L("functions/scripts/certificationWorld/state.mjs"));

test("worldFingerprint is order-independent -- Firestore read order can never fabricate drift", () => {
  // doVerify feeds `found` in whatever order the per-collection reads returned; the builder feeds
  // records in emission order. The hash must not care, and this pins that property on the SAME
  // function both sides call rather than trusting two implementations to agree.
  const rows = [
    { collection: "accounts", id: "a1", data: { name: "Alpha", ownerEmployeeId: "e1" } },
    { collection: "accounts", id: "a2", data: { name: "Beta" } },
    { collection: "locations", id: "l1", data: { accountId: "a1", city: "Phoenix" } },
  ];
  const forward = worldFingerprint(rows);
  const reversed = worldFingerprint([...rows].reverse());
  assert.equal(forward.hash, reversed.hash, "row order must not change the fingerprint");
  assert.equal(forward.rowCount, 3);
});

test("worldFingerprint ignores volatile server-stamp fields, so a faithful install observes the builder's own hash", () => {
  // The seeder stamps createdAt/updatedAt and the relink phase adds userId; all are declared
  // VOLATILE. An installed document differing ONLY by those must hash identically to the builder
  // record -- otherwise OBSERVED would cry drift over its own environment.
  const builder = [{ collection: "employees", id: "e1", data: { name: "Pat", role: "technician" } }];
  const installed = [{
    collection: "employees", id: "e1",
    data: { name: "Pat", role: "technician", createdAt: "2026-08-30T00:00:00Z", updatedAt: "2026-08-31T00:00:00Z", userId: "uid-environment" },
  }];
  assert.equal(worldFingerprint(builder).hash, worldFingerprint(installed).hash);
});

test("a real content difference DOES change the observed fingerprint", () => {
  // The mirror-image guard: after excluding volatile fields, the comparison must still detect
  // change -- an exclusion list that grew too broad would pass everything.
  const a = [{ collection: "employees", id: "e1", data: { name: "Pat", role: "technician" } }];
  const b = [{ collection: "employees", id: "e1", data: { name: "Pat", role: "dispatcher" } }];
  assert.notEqual(worldFingerprint(a).hash, worldFingerprint(b).hash);
});

