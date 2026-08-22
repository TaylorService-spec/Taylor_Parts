// GRANT RECONCILIATION — the classifier that says who holds what, and what is wrong.
//
// ============================ WHY THIS TEST EXISTS ============================
//
// This tool shipped with two bugs, and BOTH were found by running it against real data and noticing
// a number that looked wrong. That is luck, not method — and a reconciler is exactly the wrong
// place to rely on luck, because its output is believed. It is the thing people consult INSTEAD of
// reading the assignments themselves.
//
//   1. The revoked filter looked for `active === false` or `revokedAt`. Neither is what the writer
//      sets: RoleAssignmentStatus is "active" | "disabled". So a correctly REVOKED assignment
//      counted as live authority. A reconciler that OVERSTATES authority is worse than none.
//
//   2. Orphan detection compared only against certification employees, so the eight pre-existing
//      sandbox personas — linked to their own non-certification employee records, holding entirely
//      legitimate authority — were all reported as orphans. A tool that cries wolf about the
//      accounts a human signs in with is one nobody reads twice.
//
// Both are asserted below against the pure classifier.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "../..");
const { classifyGrants } = await import(
  pathToFileURL(path.resolve(REPO, "functions/scripts/certificationWorld/reconcileGrants.mjs")).href
);

const intended = (entries) => new Map(entries);
const actual = (entries) => new Map(entries.map(([uid, roles]) => [uid, new Set(roles)]));

test("an employee holding exactly the intended Role is ALREADY_CORRECT", () => {
  const f = classifyGrants({
    intendedByEmployee: intended([["cw-emp-011", { userId: "uid-a", roles: ["fieldManager"] }]]),
    actualByUid: actual([["uid-a", ["fieldManager"]]]),
    allClaimedUids: new Set(["uid-a"]),
  });
  assert.equal(f.ALREADY_CORRECT.length, 1);
  assert.equal(f.MISSING_GRANT.length, 0);
  assert.equal(f.UNEXPECTED_GRANT.length, 0);
});

test("an intended Role the principal does not hold is MISSING_GRANT", () => {
  const f = classifyGrants({
    intendedByEmployee: intended([["cw-emp-000", { userId: "uid-o", roles: ["owner"] }]]),
    actualByUid: actual([]),
    allClaimedUids: new Set(["uid-o"]),
  });
  assert.equal(f.MISSING_GRANT.length, 1);
  assert.equal(f.MISSING_GRANT[0].roleId, "owner");
});

test("a Role held but not intended is UNEXPECTED_GRANT, and is never a repair target", () => {
  // Reported so a human can decide. Auto-revoking authority that exists for a reason the fixture
  // does not know about is precisely what a fixture must not do.
  const f = classifyGrants({
    intendedByEmployee: intended([["cw-emp-011", { userId: "uid-a", roles: ["fieldManager"] }]]),
    actualByUid: actual([["uid-a", ["fieldManager", "owner"]]]),
    allClaimedUids: new Set(["uid-a"]),
  });
  assert.equal(f.UNEXPECTED_GRANT.length, 1);
  assert.equal(f.UNEXPECTED_GRANT[0].roleId, "owner");
  assert.equal(f.MISSING_GRANT.length, 0, "an unexpected grant must not also be reported as missing");
});

test("REGRESSION 1: a principal no employee claims is an orphan", () => {
  // The post-rebuild failure this whole pipeline exists to prevent: the assignment is real, and it
  // belongs to a ghost.
  const f = classifyGrants({
    intendedByEmployee: intended([]),
    actualByUid: actual([["uid-ghost", ["dispatcher"]]]),
    allClaimedUids: new Set(),
  });
  assert.equal(f.UID_MISMATCH.length, 1);
  assert.match(f.UID_MISMATCH[0].reason, /no employee document claims/);
});

test("REGRESSION 1b: a NON-certification employee's principal is NOT an orphan", () => {
  // The bug: the eight pre-existing sandbox personas hold legitimate authority through their own
  // non-certification employee records. Comparing against certification employees alone reported
  // every one of them as an orphan.
  const f = classifyGrants({
    intendedByEmployee: intended([["cw-emp-011", { userId: "uid-cert", roles: ["fieldManager"] }]]),
    actualByUid: actual([["uid-cert", ["fieldManager"]], ["uid-persona", ["salesManager"]]]),
    // The persona is claimed by an employee document, just not a certification one.
    allClaimedUids: new Set(["uid-cert", "uid-persona"]),
  });
  assert.equal(f.UID_MISMATCH.length, 0, "a legitimate non-certification principal was reported as an orphan");
  assert.equal(f.UNEXPECTED_GRANT.length, 0, "a principal outside the fixture is not the fixture's business");
});

test("an employee with NO principal reports UID_MISMATCH, not MISSING_GRANT", () => {
  // The distinction is the repair: granting needs a principal that does not exist, so the fix is
  // the relink phase. Calling it MISSING_GRANT would send someone to run the wrong tool.
  const f = classifyGrants({
    intendedByEmployee: intended([["cw-emp-020", { userId: null, roles: ["technician", "inventoryLookupReader"] }]]),
    actualByUid: actual([]),
    allClaimedUids: new Set(),
  });
  assert.equal(f.MISSING_GRANT.length, 0);
  assert.equal(f.UID_MISMATCH.length, 2);
  assert.match(f.UID_MISMATCH[0].reason, /no userId link/);
});

test("SoD conflicts are evaluated on what is HELD, not on what is intended", () => {
  // A conflict created by a grant from outside this fixture is still a conflict.
  const f = classifyGrants({
    intendedByEmployee: intended([["cw-emp-030", { userId: "uid-c", roles: ["inventoryCycleCountCounter"] }]]),
    actualByUid: actual([["uid-c", ["inventoryCycleCountCounter", "inventoryCycleCountReconciler"]]]),
    allClaimedUids: new Set(["uid-c"]),
    sodPairs: [["inventoryCycleCountCounter", "inventoryCycleCountReconciler"]],
  });
  assert.equal(f.SOD_CONFLICT.length, 1);
  assert.deepEqual(f.SOD_CONFLICT[0].roles, ["inventoryCycleCountCounter", "inventoryCycleCountReconciler"]);
});

test("SoD pairs are accepted in either shape without silently matching nothing", () => {
  // A pair table in an unexpected shape would make this check pass on every world by finding no
  // conflicts anywhere — the quietest way for a guard to stop guarding.
  const asObjects = classifyGrants({
    intendedByEmployee: intended([["e", { userId: "u", roles: [] }]]),
    actualByUid: actual([["u", ["a", "b"]]]),
    allClaimedUids: new Set(["u"]),
    sodPairs: [{ a: "a", b: "b" }],
  });
  assert.equal(asObjects.SOD_CONFLICT.length, 1, "object-shaped SoD pairs were silently ignored");
});

test("REGRESSION 2 (documented): the caller must exclude disabled assignments", () => {
  // The classifier trusts `actualByUid` to contain ACTIVE assignments only, because that is the
  // caller's read. This asserts the consequence of getting it wrong, so the contract is visible
  // here rather than only in the reader's head: a disabled assignment fed in as active is
  // indistinguishable from real authority.
  const withRevokedIncluded = classifyGrants({
    intendedByEmployee: intended([["e", { userId: "u", roles: [] }]]),
    actualByUid: actual([["u", ["inventoryLookupReader"]]]), // as if a "disabled" doc had been kept
    allClaimedUids: new Set(["u"]),
  });
  assert.equal(withRevokedIncluded.UNEXPECTED_GRANT.length, 1,
    "a revoked assignment passed in as active is reported as real authority -- the caller MUST filter on status === 'active'");
});
