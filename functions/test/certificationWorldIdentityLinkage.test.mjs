// A REBUILT WORLD IS NOT COMPLETE UNTIL ITS PEOPLE ARE LINKED TO THEIR PRINCIPALS.
//
// ============================ THE GAP THIS CLOSES ============================
//
// `reset` deletes the marker-scoped records; `rebuild` reseeds them from the repository. The 47
// certification employees carry a `userId` pointing at their Auth principal, and `buildWorld()`
// does NOT contain it -- correctly, because a UID is environment state and a deterministic fixture
// must not depend on one.
//
// So a rebuild recreates all 717 records, every count matches, the fingerprint matches, and all 47
// employee->principal links are gone. Role assignments are keyed on UID and survive separately,
// which makes it worse rather than better: they still exist, pointing at principals that no
// employee document claims any more. The world would report COMPLETE while nobody could sign in as
// anyone, and the 82 governed grants would be attached to people the system can no longer name.
//
// Measured on the live sandbox before this was written: 47 of 47 marked employees carried a
// userId that buildWorld() has no way to restore.
//
// The existing `certificationIdentitySurvivesReset` test proves Auth PRINCIPALS are never deleted.
// That is true, and it is a different claim: the principal surviving says nothing about whether the
// employee document still points at it.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;
const { classifyWorld, WORLD_STATE, SEED_POLICY, identityLinkageFindings } =
  await import(L("functions/scripts/certificationWorld/verify.mjs"));

/** A world whose DATA is exactly right, so only identity can decide the outcome. */
const perfectData = {
  expected: { version: "1.2.0", counts: { accounts: 2, employees: 2 } },
  actual: { accounts: 2, employees: 2 },
  versionsFound: ["1.2.0"],
  duplicateIds: [],
  invariantViolations: [],
};

const linkage = (over = {}) => ({ expectedLinked: 47, linked: 47, reverseLinked: 47, mismatched: [], duplicateUids: [], ...over });

test("data complete AND fully linked is COMPLETE", () => {
  const r = classifyWorld({ ...perfectData, identityLinkage: linkage() });
  assert.equal(r.state, WORLD_STATE.COMPLETE);
  assert.deepEqual(r.findings, []);
});

test("MUTATION: every record present but no links is NOT COMPLETE", () => {
  // The exact post-rebuild state. This is the assertion the whole file exists for.
  const r = classifyWorld({ ...perfectData, identityLinkage: linkage({ linked: 0, reverseLinked: 0 }) });
  assert.equal(r.state, WORLD_STATE.IDENTITY_LINKAGE_INCOMPLETE);
  assert.notEqual(r.state, WORLD_STATE.COMPLETE);
  assert.match(r.findings.join(" "), /47 of 47 certification employees have no userId link/);
});

test("a HALF link is caught -- forward present, reverse missing", () => {
  // The failure that looks like success: every check starting from the employee passes, and every
  // lookup starting from the signed-in user fails.
  const r = classifyWorld({ ...perfectData, identityLinkage: linkage({ reverseLinked: 40 }) });
  assert.equal(r.state, WORLD_STATE.IDENTITY_LINKAGE_INCOMPLETE);
  assert.match(r.findings.join(" "), /7 of 47 reverse users\/\{uid\}\.employeeId links are missing/);
});

test("CROSSED links are caught even though both sides exist", () => {
  // The dangerous one. Both directions are populated, so every presence check passes and two people
  // are wired to each other's identity -- with governed Role assignments keyed on those UIDs.
  const r = classifyWorld({
    ...perfectData,
    identityLinkage: linkage({ mismatched: [{ employeeId: "cw-emp-011", userId: "uid-a", reverse: "cw-emp-012" }] }),
  });
  assert.equal(r.state, WORLD_STATE.IDENTITY_LINKAGE_INCOMPLETE);
  assert.match(r.findings.join(" "), /link mismatch: employee cw-emp-011/);
});

test("two employees claiming ONE principal is caught", () => {
  const r = classifyWorld({
    ...perfectData,
    identityLinkage: linkage({ duplicateUids: [{ userId: "uid-a", employeeIds: ["cw-emp-011", "cw-emp-012"] }] }),
  });
  assert.equal(r.state, WORLD_STATE.IDENTITY_LINKAGE_INCOMPLETE);
  assert.match(r.findings.join(" "), /duplicate principal: uid uid-a claimed by cw-emp-011, cw-emp-012/);
});

test("IDENTITY_LINKAGE_INCOMPLETE does not invite a reseed", () => {
  // Reseeding cannot help: the records are all present. Sending an operator to `seed` would produce
  // a no-op and read as "the tool is broken" rather than "the wrong repair was suggested".
  const policy = SEED_POLICY[WORLD_STATE.IDENTITY_LINKAGE_INCOMPLETE];
  assert.ok(policy, "the new state has no seed policy -- the seeder would not know what to do with it");
  assert.equal(policy.proceed, false);
  assert.match(policy.reason, /relink|reconcile/i);
  assert.equal(Boolean(policy.alreadyApplied), false, "an unlinked world must not be reported as already applied");
});

test("identity is only judged when a measurement was supplied", () => {
  // Pure DATA classification is still assertable without modelling identity. Omitting the
  // measurement means "not evaluated", not "passed" -- and the LIVE verify path always supplies it.
  const r = classifyWorld(perfectData);
  assert.equal(r.state, WORLD_STATE.COMPLETE);
});

test("the live verify path actually MEASURES linkage rather than defaulting it", () => {
  // Guards the previous test's escape hatch. If the live caller stopped passing identityLinkage,
  // every rebuild would report COMPLETE again and this whole file would pass while asserting
  // nothing about reality.
  const src = readFileSync(path.resolve(REPO, "functions/scripts/certificationWorld.mjs"), "utf8");
  assert.match(src, /measureIdentityLinkage\(db, found\)/, "the live verify no longer measures identity linkage");
  assert.match(src, /identityLinkage,/, "the measurement is taken but not passed to classifyWorld");
});

test("findings are specific enough to act on", () => {
  // "identity linkage incomplete" with no numbers sends someone to read 60 employee documents.
  const findings = identityLinkageFindings(linkage({ linked: 45, reverseLinked: 44 }));
  assert.equal(findings.length, 2);
  for (const f of findings) assert.match(f, /\d+ of 47/);
});

test("a fully linked measurement produces NO findings", () => {
  assert.deepEqual(identityLinkageFindings(linkage()), []);
});
