// THE RELEASE PROVENANCE CONTROL, PROVEN AGAINST REAL REPOSITORIES.
//
// ============================ THE INCIDENT ============================
//
// platform-sandbox was deployed from `e068beb0` — a commit on an unmerged feature branch. Proven by
// artifact: the emitted dist/version.json carrying that commit and buildTime was found in a Claude
// worktree, while the designated operator checkout still held the previous release and its HEAD
// reflog showed no movement across the deploy window.
//
// The provenance guard was NOT at fault. Run against that commit it refuses with UNMERGED_COMMIT and
// exits 3 — asserted below. The hole was that a release could be built from a checkout the guard
// never got to inspect, and that nothing looked again between the guard and the deploy.
//
// ============================ WHY REAL REPOSITORIES ============================
//
// Every case below builds an actual git repository in a temp directory and runs the actual scripts.
// A stubbed `git` would let the test pass on a control that reads the wrong ref, which is exactly
// the class of defect this file exists to catch.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveReleaseRoot, RELEASE_ROOT_FAILURE } from "../../scripts/releaseRoot.mjs";
import { evaluateReleaseProvenance, PROVENANCE_FAILURE } from "../../scripts/releaseProvenance.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/**
 * A real repository with an `origin` it can resolve, shaped enough to look like an EOS checkout.
 * Returns { dir, origin, mainSha }.
 */
function makeRepo() {
  const base = mkdtempSync(join(tmpdir(), "prov-"));
  const origin = join(base, "origin.git");
  const work = join(base, "work");
  execFileSync("git", ["init", "--bare", "-b", "main", origin], { stdio: "ignore" });
  execFileSync("git", ["clone", origin, work], { stdio: "ignore" });
  git(work, ["config", "user.email", "t@example.test"]);
  git(work, ["config", "user.name", "T"]);
  // The markers releaseRoot.mjs requires of a real checkout.
  mkdirSync(join(work, "scripts"), { recursive: true });
  mkdirSync(join(work, "field-ops-app-vite"), { recursive: true });
  mkdirSync(join(work, "functions"), { recursive: true });
  writeFileSync(join(work, "scripts", "_sandboxRefresh.run.sh"), "#!/usr/bin/env bash\n");
  writeFileSync(join(work, "scripts", "_certificationRoutes.mjs"), "// marker\n");
  writeFileSync(join(work, "firebase.json"), "{}\n");
  // dist/ is ignored, exactly as it is in the real repository. Without this the G-series fixtures
  // make the tree dirty simply by BUILDING, and the identity gate refuses them for DIRTY_TREE
  // before it ever looks at the stamp — the gate behaving correctly and the fixture lying.
  writeFileSync(join(work, ".gitignore"), "field-ops-app-vite/dist/\n");
  writeFileSync(join(work, "README.md"), "one\n");
  git(work, ["add", "-A"]);
  git(work, ["commit", "-m", "main commit"]);
  git(work, ["push", "-u", "origin", "main"]);
  git(work, ["fetch", "origin"]);
  return { base, dir: work, origin, mainSha: git(work, ["rev-parse", "HEAD"]) };
}

function state(dir) {
  const head = git(dir, ["rev-parse", "HEAD"]);
  let remoteHead = null;
  try { remoteHead = git(dir, ["rev-parse", "origin/main"]); } catch { remoteHead = null; }
  let merged = true;
  try { git(dir, ["merge-base", "--is-ancestor", head, "origin/main"]); } catch { merged = false; }
  return {
    branch: git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]),
    head,
    remoteHead,
    dirty: git(dir, ["status", "--porcelain"]),
    mergedIntoRelease: merged,
  };
}

const cleanup = (repo) => rmSync(repo.base, { recursive: true, force: true });

// ═════════════════════════════════════ A. merged current main -> ALLOWED

test("A. the tip of origin/main is ALLOWED", () => {
  const repo = makeRepo();
  try {
    const v = evaluateReleaseProvenance(state(repo.dir));
    assert.equal(v.ok, true, `expected allow, got: ${v.failures.join(", ")}`);
  } finally { cleanup(repo); }
});

// ═════════════════════════════════════ B. unmerged feature branch -> REFUSED

test("B. AN UNMERGED FEATURE BRANCH IS REFUSED — the incident, reproduced", () => {
  const repo = makeRepo();
  try {
    git(repo.dir, ["checkout", "-b", "feature/x"]);
    writeFileSync(join(repo.dir, "feature.txt"), "work\n");
    git(repo.dir, ["add", "-A"]);
    git(repo.dir, ["commit", "-m", "unmerged work"]);
    const v = evaluateReleaseProvenance(state(repo.dir));
    assert.equal(v.ok, false);
    assert.ok(v.failures.includes(PROVENANCE_FAILURE.UNMERGED_COMMIT));
  } finally { cleanup(repo); }
});

// ═════════════════════════════════════ C. byte-identical unmerged branch -> REFUSED

test("C. A BYTE-IDENTICAL UNMERGED BRANCH IS STILL REFUSED — a tree is not provenance", () => {
  const repo = makeRepo();
  try {
    // Same tree as main, different commit. This has happened here before and was "safe by luck".
    git(repo.dir, ["checkout", "-b", "feature/identical"]);
    git(repo.dir, ["commit", "--allow-empty", "-m", "identical tree, different commit"]);
    const s = state(repo.dir);
    assert.equal(git(repo.dir, ["rev-parse", "HEAD^{tree}"]), git(repo.dir, ["rev-parse", "origin/main^{tree}"]),
      "fixture should have an identical tree");
    const v = evaluateReleaseProvenance(s);
    assert.equal(v.ok, false);
    assert.ok(v.failures.includes(PROVENANCE_FAILURE.UNMERGED_COMMIT));
  } finally { cleanup(repo); }
});

// ═════════════════════════════════════ D. a feature worktree may not become the release root

test("D. AN AGENT WORKTREE IS REFUSED AS A RELEASE ROOT", () => {
  const repo = makeRepo();
  try {
    const agentRoot = join(repo.dir, ".claude", "worktrees", "some-agent");
    mkdirSync(join(agentRoot, "scripts"), { recursive: true });
    mkdirSync(join(agentRoot, "field-ops-app-vite"), { recursive: true });
    mkdirSync(join(agentRoot, "functions"), { recursive: true });
    writeFileSync(join(agentRoot, "scripts", "_sandboxRefresh.run.sh"), "#\n");
    writeFileSync(join(agentRoot, "firebase.json"), "{}\n");
    writeFileSync(join(agentRoot, ".git"), "gitdir: elsewhere\n");
    const v = resolveReleaseRoot({ argv: ["--release-root", agentRoot], env: {} });
    assert.equal(v.ok, false);
    assert.ok(v.failures.includes(RELEASE_ROOT_FAILURE.AGENT_WORKTREE),
      `expected AGENT_WORKTREE, got ${v.failures.join(", ")}`);
  } finally { cleanup(repo); }
});

test("D2. the release root is taken from the ARGUMENT, not from the caller's cwd", () => {
  const repo = makeRepo();
  try {
    const v = resolveReleaseRoot({ argv: ["--release-root", repo.dir], env: { EOS_RELEASE_ROOT: "/nowhere" } });
    assert.equal(v.ok, true, v.failures.join(", "));
    assert.equal(v.source, "--release-root");
    // And the explicit argument beats the environment, which beats the script location.
    const fromEnv = resolveReleaseRoot({ argv: [], env: { EOS_RELEASE_ROOT: repo.dir } });
    assert.equal(fromEnv.source, "EOS_RELEASE_ROOT");
  } finally { cleanup(repo); }
});

test("D3. a directory that is not a checkout is refused, and says which marker is missing", () => {
  const base = mkdtempSync(join(tmpdir(), "notrepo-"));
  try {
    const v = resolveReleaseRoot({ argv: ["--release-root", base], env: {} });
    assert.equal(v.ok, false);
    assert.ok(v.failures.includes(RELEASE_ROOT_FAILURE.NOT_A_CHECKOUT));
    assert.ok(v.failures.some((f) => f.startsWith(RELEASE_ROOT_FAILURE.MISSING_MARKER)));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

// ═════════════════════════════════════ E. behind origin/main -> REFUSED

test("E. A COMMIT BEHIND origin/main IS REFUSED unless deliberately named", () => {
  const repo = makeRepo();
  try {
    const first = git(repo.dir, ["rev-parse", "HEAD"]);
    writeFileSync(join(repo.dir, "second.txt"), "two\n");
    git(repo.dir, ["add", "-A"]);
    git(repo.dir, ["commit", "-m", "second"]);
    git(repo.dir, ["push", "origin", "main"]);
    git(repo.dir, ["fetch", "origin"]);
    git(repo.dir, ["checkout", "--detach", first]);

    const s = state(repo.dir);
    const refused = evaluateReleaseProvenance(s);
    assert.equal(refused.ok, false);
    assert.ok(refused.failures.includes(PROVENANCE_FAILURE.BEHIND_RELEASE));

    // I. --allow-commit permits a MERGED older commit, deliberately.
    const allowed = evaluateReleaseProvenance(s, { allowCommit: first });
    assert.equal(allowed.ok, true, allowed.failures.join(", "));
  } finally { cleanup(repo); }
});

// ═════════════════════════════════════ F. dirty tree -> REFUSED

test("F. A DIRTY RELEASE TREE IS REFUSED — an artifact must be built from committed bytes", () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo.dir, "scratch.txt"), "uncommitted\n");
    const v = evaluateReleaseProvenance(state(repo.dir));
    assert.equal(v.ok, false);
    assert.ok(v.failures.includes(PROVENANCE_FAILURE.DIRTY_WORKTREE));
  } finally { cleanup(repo); }
});

// ═════════════════════════════════════ I. --allow-commit may never launder an unmerged commit

test("I. --allow-commit CANNOT AUTHORIZE AN UNMERGED COMMIT, whatever it is given", () => {
  const repo = makeRepo();
  try {
    git(repo.dir, ["checkout", "-b", "feature/y"]);
    git(repo.dir, ["commit", "--allow-empty", "-m", "unmerged"]);
    const s = state(repo.dir);
    for (const allow of [s.head, s.head.slice(0, 8), "deadbeef", null]) {
      const v = evaluateReleaseProvenance(s, { allowCommit: allow });
      assert.equal(v.ok, false, `--allow-commit ${allow} must not authorize an unmerged commit`);
      assert.ok(v.failures.includes(PROVENANCE_FAILURE.UNMERGED_COMMIT));
    }
  } finally { cleanup(repo); }
});

// ═════════════════════════════════════ G/H. the identity gate, run for real

function runIdentityGate(args) {
  try {
    const out = execFileSync(process.execPath, [join(REPO_ROOT, "scripts", "_releaseIdentityGate.mjs"), ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, out };
  } catch (err) {
    return { status: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

test("G. A version.json STAMPED WITH THE WRONG SHA IS REFUSED BEFORE DEPLOY", () => {
  const repo = makeRepo();
  try {
    const dist = join(repo.dir, "field-ops-app-vite", "dist");
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, "version.json"), JSON.stringify({ commit: "badc0ffe", base: "/" }));
    const r = runIdentityGate(["--root", repo.dir, "--approved", repo.mainSha, "--artifact", ""]);
    assert.notEqual(r.status, 0);
    assert.match(r.out, /ARTIFACT_COMMIT_MISMATCH/);
  } finally { cleanup(repo); }
});

test("G2. a correctly stamped artifact on the approved commit PASSES", () => {
  const repo = makeRepo();
  try {
    const dist = join(repo.dir, "field-ops-app-vite", "dist");
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, "version.json"), JSON.stringify({ commit: repo.mainSha.slice(0, 8), base: "/" }));
    const r = runIdentityGate(["--root", repo.dir, "--approved", repo.mainSha, "--artifact", ""]);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /RELEASE IDENTITY OK/);
  } finally { cleanup(repo); }
});

test("H. A TREE THAT MOVED AFTER THE GUARD IS REFUSED BEFORE DEPLOY", () => {
  const repo = makeRepo();
  try {
    const approved = repo.mainSha;
    // The guard approved `approved`; now something commits into the same checkout, exactly as an
    // agent or a stray branch switch would between the guard and the Hosting deploy.
    writeFileSync(join(repo.dir, "late.txt"), "sneaked in\n");
    git(repo.dir, ["add", "-A"]);
    git(repo.dir, ["commit", "-m", "moved after approval"]);
    const r = runIdentityGate(["--root", repo.dir, "--approved", approved]);
    assert.notEqual(r.status, 0);
    assert.match(r.out, /HEAD_MOVED/);
  } finally { cleanup(repo); }
});

test("H2. a dirty tree at deploy time is refused even when HEAD still matches", () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo.dir, "dirt.txt"), "x\n");
    const r = runIdentityGate(["--root", repo.dir, "--approved", repo.mainSha]);
    assert.notEqual(r.status, 0);
    assert.match(r.out, /DIRTY_TREE/);
  } finally { cleanup(repo); }
});

test("the identity gate refuses to run without an approved commit — it cannot verify nothing", () => {
  const repo = makeRepo();
  try {
    const r = runIdentityGate(["--root", repo.dir, "--approved", ""]);
    assert.notEqual(r.status, 0);
    assert.match(r.out, /--approved <sha> is required/);
  } finally { cleanup(repo); }
});

// ═════════════════════════════════════ the runbook actually calls all of this

test("THE RUNBOOK WIRES THE CONTROL IN THE RIGHT ORDER", () => {
  const runbook = execFileSync("git", ["show", "HEAD:scripts/_sandboxRefresh.run.sh"], { cwd: REPO_ROOT, encoding: "utf8" });
  const at = (needle) => runbook.indexOf(needle);
  assert.ok(at("releaseRoot.mjs") > 0, "the release root must be resolved explicitly");
  assert.ok(at("_releaseProvenanceGuard.mjs") > 0, "the provenance guard must run");
  assert.ok(at("APPROVED_COMMIT=") > 0, "the approved commit must be captured once");
  assert.ok(at("_releaseIdentityGate.mjs") > 0, "the identity gate must run");
  // Root resolved before the guard; guard before the identity gate; identity gate before Hosting.
  assert.ok(at("releaseRoot.mjs") < at("_releaseProvenanceGuard.mjs"));
  assert.ok(at("_releaseProvenanceGuard.mjs") < at("_releaseIdentityGate.mjs"));
  assert.ok(at("_releaseIdentityGate.mjs") < at("firebase deploy --only hosting"));
  // And the post-deploy check is a GATE, not the old printout that could not fail.
  assert.ok(at("--remote https://eos-platform-sandbox.web.app") > at("firebase deploy --only hosting"),
    "the deployed artifact must be verified after the deploy");
  assert.ok(!runbook.includes("A clean exit does not mean the artifact is live"),
    "the advisory printout must be gone, replaced by a real check");
});

test("BOTH GATES REFUSE AN UNRESOLVED ROOT rather than certifying the caller's cwd", () => {
  for (const name of ["_sandboxQuickGate.sh", "_sandboxRegressionGate.sh"]) {
    const text = execFileSync("git", ["show", `HEAD:scripts/${name}`], { cwd: REPO_ROOT, encoding: "utf8" });
    assert.ok(text.includes("could not resolve the repository root"), `${name} must fail loudly on an unresolved root`);
    assert.ok(text.includes("EOS_GATE_ROOT_CHECKED"), `${name} must carry the root check`);
  }
});
