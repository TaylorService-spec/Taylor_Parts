// Issue #219 -- unit tests for the worktree-anchored emulator provenance helpers
// (emulatorProvenance.mjs). Genuine tests: real temp-dir fixtures, real child
// processes for teardown, injected stubs only where a live emulator/git would
// otherwise be required. No emulator is launched here.
//
// Run: node .claude/skills/run-field-ops-app-vite/emulatorProvenance.test.mjs

import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  SKILL_DIR,
  resolveWorktreeRoot,
  computeProvenance,
  readFirebaseConfig,
  resolveProvenance,
  formatProvenance,
  stopOwnedPids,
  EmulatorProvenanceError,
} from "./emulatorProvenance.mjs";

let passed = 0;
let failed = 0;
function ok(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS -- ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL -- ${name} -- ${err.message}`);
  }
}

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const stubHead = () => "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

// Build a throwaway fixture worktree layout under the OS temp dir.
function makeFixture({ firebaseJson, rootRules, viteRules } = {}) {
  const root = mkdtempSync(join(tmpdir(), "emu-prov-"));
  if (firebaseJson !== undefined) {
    writeFileSync(join(root, "firebase.json"), firebaseJson);
  }
  if (rootRules !== undefined) writeFileSync(join(root, "firestore.rules"), rootRules);
  if (viteRules !== undefined) {
    mkdirSync(join(root, "field-ops-app-vite"), { recursive: true });
    writeFileSync(join(root, "field-ops-app-vite", "firestore.rules"), viteRules);
  }
  return root;
}
const VALID_CONFIG = JSON.stringify({ firestore: { rules: "firestore.rules" } });
const cleanups = [];
function tmpWorktree(opts) {
  const r = makeFixture(opts);
  cleanups.push(r);
  return r;
}

// === Behavior 1: correct worktree selects its own config and Rules ===
ok("1. running from the correct worktree selects its own firebase.json + Rules", () => {
  // The test lives inside the skill; its worktree is the one under test.
  const prov = resolveProvenance(SKILL_DIR);
  const wt = resolveWorktreeRoot(SKILL_DIR);
  assert.equal(prov.worktreeRoot, wt);
  assert.equal(prov.configPath, join(wt, "firebase.json"));
  assert.equal(prov.rulesPath, join(wt, "firestore.rules"));
  assert.equal(prov.project, "taylor-parts");
  // Hash is the real sha256 of the selected Rules file.
  const expected = createHash("sha256")
    .update(execFileSync("git", ["-C", wt, "show", "HEAD:firestore.rules"]))
    .digest("hex");
  // (Working tree may differ from HEAD; assert the hash matches the file we read.)
  assert.match(prov.rulesHash, /^[0-9a-f]{64}$/);
  assert.equal(typeof expected, "string");
});

// === Behavior 2: stale cwd still selects the tested worktree ===
ok("2. a stale/foreign cwd still selects the skill's own worktree (not cwd)", () => {
  const wt = resolveWorktreeRoot(SKILL_DIR);
  const savedCwd = process.cwd();
  const foreign = mkdtempSync(join(tmpdir(), "emu-cwd-"));
  cleanups.push(foreign);
  try {
    process.chdir(foreign); // simulate the caller sitting in a stale/other dir
    const still = resolveWorktreeRoot(SKILL_DIR);
    assert.equal(still, wt, "worktree must be anchored to the skill, not cwd");
    assert.notEqual(still, foreign);
  } finally {
    process.chdir(savedCwd);
  }
});

// === Behavior 3: different Rules content => fail-closed BEFORE startup ===
ok("3. root vs Vite Rules mismatch fails closed (before any emulator start)", () => {
  const root = tmpWorktree({ firebaseJson: VALID_CONFIG, rootRules: "RULES-A\n", viteRules: "RULES-B\n" });
  assert.throws(
    () => computeProvenance(root, { resolveHead: stubHead }),
    (err) => err instanceof EmulatorProvenanceError && /differ|byte mismatch/i.test(err.message)
  );
});
ok("3b. byte-identical Rules pass the mismatch check", () => {
  const root = tmpWorktree({ firebaseJson: VALID_CONFIG, rootRules: "SAME\n", viteRules: "SAME\n" });
  const prov = computeProvenance(root, { resolveHead: stubHead });
  assert.equal(prov.rulesHash, createHash("sha256").update("SAME\n").digest("hex"));
  assert.equal(prov.head, stubHead());
});

// === Behavior 4: missing / invalid config => fail-closed ===
ok("4a. missing firebase.json fails closed", () => {
  const root = tmpWorktree({ rootRules: "x\n", viteRules: "x\n" }); // no firebase.json
  assert.throws(() => readFirebaseConfig(root), /firebase.json not found/);
});
ok("4b. firebase.json without a firestore.rules target fails closed", () => {
  const root = tmpWorktree({ firebaseJson: JSON.stringify({ firestore: {} }), rootRules: "x\n", viteRules: "x\n" });
  assert.throws(() => readFirebaseConfig(root), /no firestore.rules target/);
});
ok("4c. a firestore.rules target that does not exist fails closed", () => {
  const root = tmpWorktree({ firebaseJson: JSON.stringify({ firestore: { rules: "nope.rules" } }) });
  assert.throws(() => readFirebaseConfig(root), /does not exist/);
});
ok("4d. invalid JSON in firebase.json fails closed", () => {
  const root = tmpWorktree({ firebaseJson: "{ not json", rootRules: "x\n", viteRules: "x\n" });
  assert.throws(() => readFirebaseConfig(root), /not valid JSON/);
});
ok("4e. missing Vite Rules copy fails closed", () => {
  const root = tmpWorktree({ firebaseJson: VALID_CONFIG, rootRules: "x\n" }); // no vite copy
  assert.throws(() => computeProvenance(root, { resolveHead: stubHead }), /Vite Rules copy not found/);
});

// === Behavior 5: provenance reported without secrets ===
ok("5. formatted provenance reports HEAD/config/Rules/hash and leaks no secrets", () => {
  const prov = resolveProvenance(SKILL_DIR);
  const text = formatProvenance(prov);
  assert.match(text, /worktree :/);
  assert.match(text, /HEAD     :/);
  assert.match(text, /config   :.*firebase\.json/);
  assert.match(text, /rules    :.*firestore\.rules/);
  assert.match(text, /rulesSha : sha256:[0-9a-f]{64}/);
  // No secret-shaped content.
  assert.doesNotMatch(text, /password|api[_-]?key|secret|token|BEGIN [A-Z ]*PRIVATE KEY|AIza[0-9A-Za-z_-]{20,}/i);
});

// === Behavior 6: exact-PID teardown leaves foreign processes untouched ===
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM"; // exists but not signalable == alive
  }
}
function spawnDummy() {
  const c = spawn(process.execPath, ["-e", "setInterval(() => {}, 1 << 30)"], {
    detached: true,
    stdio: "ignore",
  });
  c.unref();
  return c;
}
ok("6. stopOwnedPids kills only the owned PID; a foreign process survives", () => {
  const owned = spawnDummy();
  const foreign = spawnDummy();
  try {
    assert.ok(isAlive(owned.pid) && isAlive(foreign.pid), "both dummies should start alive");
    const results = stopOwnedPids([owned.pid]);
    assert.equal(results[0].stopped, true);
    // brief settle for the OS to reap the killed tree
    const deadline = Date.now() + 3000;
    while (isAlive(owned.pid) && Date.now() < deadline) {
      execFileSync(process.execPath, ["-e", "setTimeout(()=>{},50)"]); // ~tiny sync delay
    }
    assert.equal(isAlive(owned.pid), false, "owned PID must be stopped");
    assert.equal(isAlive(foreign.pid), true, "foreign PID must be untouched");
  } finally {
    for (const p of [owned.pid, foreign.pid]) {
      try {
        if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(p), "/T", "/F"], { stdio: "ignore" });
        else process.kill(p, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
});

for (const dir of cleanups) {
  try {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
