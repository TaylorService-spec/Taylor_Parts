// THE GUARD MUST REFUSE THE EXACT RELEASE THAT ALREADY HAPPENED.
//
// platform-sandbox was deployed from an unmerged branch head whose tree was byte-identical to the
// main commit that followed. The content was safe by luck; the process was not. These tests pin the
// rule that refuses it — including, specifically, the byte-identical case, because "the tree matches"
// is the argument that made the original slip look acceptable in hindsight.
import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateReleaseProvenance,
  PROVENANCE_FAILURE as F,
  DEFAULT_RELEASE_BRANCH,
} from "./releaseProvenance.mjs";

const MAIN = "1373eff2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BRANCH_HEAD = "3aed0c0cbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const OLDER_MAIN = "baae967cccccccccccccccccccccccccccccccccc";

const state = (over = {}) => ({
  branch: DEFAULT_RELEASE_BRANCH,
  head: MAIN,
  remoteHead: MAIN,
  dirty: "",
  mergedIntoRelease: true,
  ...over,
});

// ═════════════════════════════════════════ the allowed case

test("CURRENT MERGED MAIN IS ALLOWED", () => {
  const v = evaluateReleaseProvenance(state());
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.deepEqual(v.failures, []);
});

test("a worktree on a detached HEAD at the release commit is ALLOWED", () => {
  // This repo is worked in several worktrees and `main` is often checked out in one of them, so a
  // release built elsewhere at the same COMMIT is legitimate. Refusing it would break real usage in
  // the name of a branch NAME, which is not what provenance means.
  const v = evaluateReleaseProvenance(state({ branch: "HEAD" }));
  assert.equal(v.ok, true, JSON.stringify(v));
});

test("a differently-named branch sitting on the release commit is allowed, and says so", () => {
  const v = evaluateReleaseProvenance(state({ branch: "release-wt" }));
  assert.equal(v.ok, true);
  assert.ok(v.detail.some((d) => /not 'main'/.test(d)), "the situation is reported even though it passes");
});

// ═════════════════════════════════════════ THE MUTATION PROOF

test("THE UNMERGED BRANCH HEAD IS REFUSED", () => {
  const v = evaluateReleaseProvenance(state({ branch: "feat/item-reference-control", head: BRANCH_HEAD, mergedIntoRelease: false }));
  assert.equal(v.ok, false);
  assert.ok(v.failures.includes(F.UNMERGED_COMMIT));
});

test("AN UNMERGED HEAD WITH A BYTE-IDENTICAL TREE IS STILL REFUSED", () => {
  // The whole point. The guard is given no way to learn that the tree matches, because a tree match
  // must never be able to buy a release. This asserts the rule depends on CONTAINMENT alone.
  const identicalTreeButUnmerged = state({
    branch: "feat/item-reference-control",
    head: BRANCH_HEAD,
    mergedIntoRelease: false,
    remoteHead: MAIN,
  });
  const v = evaluateReleaseProvenance(identicalTreeButUnmerged);
  assert.equal(v.ok, false, "byte-identical is not provenance");
  assert.ok(v.failures.includes(F.UNMERGED_COMMIT));
  assert.ok(v.detail.some((d) => /NOT provenance/i.test(d)), "and it must SAY why, or the next person repeats it");
});

// ═════════════════════════════════════════ the other refusals

test("a merged but STALE commit is refused unless deliberately named", () => {
  const stale = state({ head: OLDER_MAIN, remoteHead: MAIN, mergedIntoRelease: true });
  const refused = evaluateReleaseProvenance(stale);
  assert.equal(refused.ok, false);
  assert.ok(refused.failures.includes(F.BEHIND_RELEASE));

  // A deliberate re-deploy or rollback is legitimate WHEN NAMED.
  const allowed = evaluateReleaseProvenance(stale, { allowCommit: OLDER_MAIN });
  assert.equal(allowed.ok, true, JSON.stringify(allowed));
});

test("an explicit allowance CANNOT launder an unmerged commit", () => {
  // An exception may permit an OLDER release. It may never permit an unreviewed one.
  const v = evaluateReleaseProvenance(
    state({ head: BRANCH_HEAD, mergedIntoRelease: false }),
    { allowCommit: BRANCH_HEAD },
  );
  assert.equal(v.ok, false);
  assert.ok(v.failures.includes(F.UNMERGED_COMMIT));
});

test("A DIRTY WORKTREE IS REFUSED, untracked files included", () => {
  // A release built from a tree containing unknown files is a release nobody can reproduce.
  for (const dirty of [" M functions/src/index.ts", "?? .tmp-scratch.mjs"]) {
    const v = evaluateReleaseProvenance(state({ dirty }));
    assert.equal(v.ok, false, `dirty state must refuse: ${dirty}`);
    assert.ok(v.failures.includes(F.DIRTY_WORKTREE));
  }
});

test("an unresolvable release ref is refused rather than assumed", () => {
  const v = evaluateReleaseProvenance(state({ remoteHead: null, mergedIntoRelease: false }));
  assert.equal(v.ok, false);
  assert.ok(v.failures.includes(F.NO_REMOTE_RELEASE));
});

test("failures ACCUMULATE — the report names every reason, not the first", () => {
  const v = evaluateReleaseProvenance(state({ head: BRANCH_HEAD, mergedIntoRelease: false, dirty: "?? x.mjs" }));
  assert.ok(v.failures.includes(F.UNMERGED_COMMIT));
  assert.ok(v.failures.includes(F.DIRTY_WORKTREE));
  assert.ok(v.failures.length >= 2, "fixing one and re-running to discover the next wastes a deploy cycle");
});
