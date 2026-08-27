// THE POST-DEPLOY REMOTE IDENTITY CHECK, PROVED AGAINST A REAL SERVER.
//
// ════════════════════ WHAT THIS EXISTS TO STOP ════════════════════
//
// The remote branch of scripts/_releaseIdentityGate.mjs was a SINGLE fetch. Firebase Hosting
// prints "Deploy complete!" when the release is created; it becomes current a moment later. On the
// 34b19c8d sandbox refresh the gap was measurable — version created 01:33:04.311Z, releaseTime
// 01:33:08.142Z — and the gate read inside it, was served the previous release, and refused a
// deploy that had entirely succeeded (REMOTE_COMMIT_MISMATCH, exit 6).
//
// The fix must survive propagation lag WITHOUT becoming unable to fail. That second half is the
// one worth testing hardest: a gate that waits is only an improvement if a genuinely wrong commit
// still fails closed, every time, no matter how long it is offered.
//
// ════════════════════ WHY A REAL HTTP SERVER ════════════════════
//
// The gate is a script, not a module: it reads argv and calls process.exit. Testing it by running
// it — against a server that can be made to lie in specific ways — proves the shipped path rather
// than a refactored copy of it. A stub would prove the stub.
//
// Run: node --test test/releaseIdentityRemoteRetry.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const GATE = join(REPO, "scripts", "_releaseIdentityGate.mjs");

const APPROVED = "34b19c8d3b081c7b6842e57e77e79a9dacd2f758";
// What a REAL version.json carries: the short sha. The gate is handed the full one, so serving the
// short form also exercises sameCommit's "compare on the shorter of the two" rule rather than
// sidestepping it with an exact string match.
const APPROVED_SHORT = "34b19c8d";
const STALE = "c45979b7";

/**
 * A version.json server whose answer is a function of the request count, so a test can say
 * "stale twice, then current" without timing anything.
 */
function serveVersions(sequence) {
  let n = 0;
  const server = createServer((req, res) => {
    const body = sequence(n++, req);
    if (body === null) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("upstream is unwell");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        origin: `http://127.0.0.1:${port}`,
        requests: () => n,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

/**
 * The gate aggregates SEVERAL checks (HEAD, origin/main, a clean tree, the artifact) and exits 6 if
 * ANY fails. These tests are about ONE of them, so they assert that branch's verdict rather than
 * the process exit code -- otherwise a dirty working tree during development, which is a real and
 * correct finding of a different check, would fail every remote-branch test.
 */
const remotePassed = (r) =>
  !/REMOTE_COMMIT_MISMATCH|REMOTE_UNREADABLE|REMOTE_ENVIRONMENT_MISMATCH/.test(r.stderr + r.stdout);

const version = (commit) => ({
  commit,
  base: "/",
  buildTime: "2026-08-27T01:32:56.817Z",
  environmentId: "platform-sandbox",
  environmentRole: "sandbox",
  schema: 2,
});

/** Run the gate's REMOTE branch with test-speed timings. Never rejects; returns the outcome. */
function runGate(origin, { deadlineMs = 3000, intervalMs = 100 } = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [GATE, "--root", REPO, "--approved", APPROVED, "--remote", origin],
      {
        env: {
          ...process.env,
          EOS_RELEASE_REMOTE_DEADLINE_MS: String(deadlineMs),
          EOS_RELEASE_REMOTE_INTERVAL_MS: String(intervalMs),
        },
      },
      (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout: String(stdout), stderr: String(stderr) }),
    );
  });
}

// ═══════════════════════════ the three outcomes the log must tell apart

test("immediate success — the release is already current, and it does not wait", async () => {
  const s = await serveVersions(() => version(APPROVED_SHORT));
  const { code, stdout } = await runGate(s.origin);
  await s.close();
  assert.ok(remotePassed({ code, stdout, stderr: "" }), stdout);
  assert.match(stdout, /deployed commit 34b19c8d matches the approved commit/);
  // No propagation note, because there was no propagation to wait for.
  assert.ok(!/still propagating/.test(stdout), "must not claim a wait that did not happen");
  assert.equal(s.requests(), 1, "one read is enough when the answer is already right");
});

test("stale then current — the exact race that broke the 34b19c8d refresh now PASSES", async () => {
  // Two stale reads, then the release becomes current: the shape of the observed incident.
  const s = await serveVersions((n) => version(n < 2 ? STALE : APPROVED_SHORT));
  const { code, stdout } = await runGate(s.origin);
  await s.close();
  assert.ok(remotePassed({ code, stdout, stderr: "" }), stdout);
  assert.match(stdout, /deployed commit 34b19c8d matches the approved commit/);
  // And it SAYS it waited. "Waiting for propagation" and "was already correct" are different
  // facts about a release, and an operator reading the log should be able to tell them apart.
  assert.match(stdout, /still propagating/);
  assert.ok(s.requests() >= 3, `expected retries, saw ${s.requests()} request(s)`);
});

test("persistent stale — still fails closed, with the last commit actually observed", async () => {
  const s = await serveVersions(() => version(STALE));
  const { code, stdout, stderr } = await runGate(s.origin);
  await s.close();
  assert.equal(code, 6, "a release that never becomes current must still refuse");
  assert.ok(!remotePassed({ code, stdout, stderr }), "the remote branch itself must be the refusal");
  assert.match(stderr, /REMOTE_COMMIT_MISMATCH/);
  // The diagnostic that distinguishes "wrong artifact is live" from "propagation never finished".
  assert.match(stdout, /deployed commit is c45979b7/);
  assert.match(stdout, /last of \d+ reads over \d+s/);
});

// ═══════════════════════════ the ways it must NOT become permissive

test("a WRONG commit never becomes a pass, however long it is offered", async () => {
  // The load-bearing property. Waiting is only safe if waiting cannot be mistaken for agreeing.
  const wrong = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  const s = await serveVersions(() => version(wrong));
  const { code, stderr } = await runGate(s.origin, { deadlineMs: 1200, intervalMs: 100 });
  await s.close();
  assert.equal(code, 6);
  assert.match(stderr, /REMOTE_COMMIT_MISMATCH/);
});

test("a commit that merely SHARES A PREFIX is not the approved commit", async () => {
  // sameCommit compares on the shorter of the two, so a genuine short sha matches a full one.
  // That must not stretch into accepting a different commit that happens to start similarly.
  const s = await serveVersions(() => version("34b19c8e"));
  const { code, stderr } = await runGate(s.origin, { deadlineMs: 900, intervalMs: 100 });
  await s.close();
  assert.equal(code, 6, "34b19c8e is not 34b19c8d");
  assert.match(stderr, /REMOTE_COMMIT_MISMATCH/);
});

test("unreachable stays unreachable — retrying a dead origin is not a pass", async () => {
  // Port 1 with nothing on it. Every attempt fails to connect; no body is ever readable.
  const { code, stderr } = await runGate("http://127.0.0.1:1", { deadlineMs: 900, intervalMs: 100 });
  assert.equal(code, 6);
  assert.match(stderr, /REMOTE_UNREADABLE/);
});

test("a malformed body fails rather than being read as agreement", async () => {
  const s = await serveVersions(() => "not json at all");
  const { code, stderr } = await runGate(s.origin, { deadlineMs: 900, intervalMs: 100 });
  await s.close();
  assert.equal(code, 6);
  assert.match(stderr, /REMOTE_UNREADABLE/);
});

test("a 500 that later becomes a correct answer still succeeds", async () => {
  // Propagation is not the only transient. An origin erroring briefly and then serving the
  // approved commit is the same situation, and must resolve the same way.
  const s = await serveVersions((n) => (n < 2 ? null : version(APPROVED_SHORT)));
  const { code, stdout } = await runGate(s.origin);
  await s.close();
  assert.ok(remotePassed({ code, stdout, stderr: "" }), stdout);
  assert.match(stdout, /matches the approved commit/);
});

test("the wrong ENVIRONMENT still fails, even when the commit is right", async () => {
  const s = await serveVersions(() => ({ ...version(APPROVED_SHORT), environmentId: "taylor-parts", environmentRole: "production" }));
  const { code, stderr } = await runGate(s.origin);
  await s.close();
  assert.equal(code, 6);
  assert.match(stderr, /REMOTE_ENVIRONMENT_MISMATCH/);
});

test("every attempt is cache-busted, so nothing between here and the origin can answer for it", async () => {
  const seen = [];
  const s = await serveVersions((n, req) => {
    seen.push(req.url);
    return version(n < 1 ? STALE : APPROVED_SHORT);
  });
  await runGate(s.origin);
  await s.close();
  assert.ok(seen.length >= 2, "expected more than one attempt");
  assert.ok(seen.every((u) => /releaseIdentityCheck=\d+/.test(u)), `not cache-busted: ${seen.join(" ")}`);
  assert.equal(new Set(seen).size, seen.length, "each attempt must carry a DIFFERENT buster");
});

// ═══════════════════════════ the blast radius

test("the PRE-DEPLOY branch is untouched: no --remote means no polling and no network", async () => {
  // Step 3d runs this same gate WITHOUT --remote. If the retry had leaked into that path it would
  // have added a minute of waiting to every release before anything was even deployed.
  const src = readFileSync(GATE, "utf8");
  const remoteAt = src.indexOf("if (remote) {");
  assert.ok(remoteAt > 0, "the remote branch must still be guarded by `if (remote)`");
  assert.ok(
    src.indexOf("pollRemoteIdentity") > src.indexOf("const remote ="),
    "polling must be defined after the remote argument, inside the post-deploy region",
  );
  // The poll is invoked exactly once, and only from inside the remote branch.
  assert.equal((src.match(/await pollRemoteIdentity\(/g) ?? []).length, 1);
  assert.ok(src.slice(remoteAt).includes("await pollRemoteIdentity("), "polling must live in the remote branch");
});

test("no runbook sets the test-only timing overrides", async () => {
  // The overrides exist so this suite can exercise the timeout in a second rather than a minute.
  // If a runbook ever set one, a live release's deadline would be whatever that runbook said --
  // which is how a safety margin gets quietly shortened by a file nobody re-reads.
  for (const rel of [
    join(REPO, "scripts", "_sandboxRefresh.run.sh"),
    join(REPO, "scripts", "_prodRelease.run.sh"),
    join(REPO, "scripts", "Invoke-SandboxRefresh.ps1"),
    join(REPO, "sandbox-refresh.ps1"),
  ]) {
    let src;
    try { src = readFileSync(rel, "utf8"); } catch { continue; }
    assert.ok(!src.includes("EOS_RELEASE_REMOTE_DEADLINE_MS"), `${rel} sets the deadline override`);
    assert.ok(!src.includes("EOS_RELEASE_REMOTE_INTERVAL_MS"), `${rel} sets the interval override`);
  }
});

test("production defaults are 60s / 2s when nothing overrides them", async () => {
  const src = readFileSync(GATE, "utf8");
  assert.match(src, /EOS_RELEASE_REMOTE_DEADLINE_MS", 60_000/);
  assert.match(src, /EOS_RELEASE_REMOTE_INTERVAL_MS", 2_000/);
  // An unparseable or hostile value must fall back to the production number, never to something
  // smaller -- `envMs` returns the fallback unless the value is a finite positive number.
  assert.match(src, /Number\.isFinite\(n\) && n > 0 \? n : fallback/);
});
