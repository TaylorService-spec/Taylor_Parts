import { test } from "node:test";
import assert from "node:assert/strict";
import { makeLease, makeRequestClaim } from "./wakeLease.mjs";

// In-memory fs double.
function memFs() {
  const dirs = new Set(), files = new Map();
  return {
    dirs, files,
    mkdirSync(d) { if (dirs.has(d)) { const e = new Error("EEXIST"); e.code = "EEXIST"; throw e; } dirs.add(d); },
    writeFileSync(p, c) { files.set(p, c); },
    readFileSync(p) { if (!files.has(p)) throw new Error("ENOENT"); return files.get(p); },
    rmSync(d) { dirs.delete(d); for (const k of [...files.keys()]) if (k.startsWith(d)) files.delete(k); },
    rmdirSync(d) { dirs.delete(d); },
  };
}

test("acquire creates the lock; a second acquire is refused while held", () => {
  const fs = memFs();
  const a = makeLease({ dir: "/lock", fs, host: "h", pid: 1, now: () => 1000 });
  assert.equal(a.acquire().acquired, true);
  const b = makeLease({ dir: "/lock", fs, host: "h", pid: 2, now: () => 1000 });
  assert.equal(b.acquire().acquired, false, "duplicate lease refused");
});

test("release frees the lock so it can be re-acquired", () => {
  const fs = memFs();
  const a = makeLease({ dir: "/lock", fs, now: () => 0 });
  a.acquire(); a.release();
  assert.equal(makeLease({ dir: "/lock", fs, now: () => 0 }).acquire().acquired, true);
});

test("a stale lock is reclaimed ONLY when expired AND dead on this host", () => {
  const fs = memFs();
  // hold with a short lease, mark pid dead on this host via a fresh record
  const held = makeLease({ dir: "/lock", fs, host: "h", pid: 9, now: () => 0, leaseMs: 100 });
  held.acquire();
  // rewrite the record to reflect a dead pid (as a supervisor would after checking)
  fs.writeFileSync("/lock/owner.json", JSON.stringify({ pid: 9, host: "h", startedAt: 0, leaseUntil: 100, pidAlive: false }));
  // before expiry → not reclaimable
  assert.equal(makeLease({ dir: "/lock", fs, host: "h", now: () => 50 }).acquire().acquired, false);
  // after expiry + dead-on-host → reclaimable
  assert.equal(makeLease({ dir: "/lock", fs, host: "h", pid: 2, now: () => 200 }).acquire().acquired, true);
});

test("never steals a live/other-host lock", () => {
  const fs = memFs();
  makeLease({ dir: "/lock", fs, host: "h", pid: 9, now: () => 0, leaseMs: 100 }).acquire();
  fs.writeFileSync("/lock/owner.json", JSON.stringify({ pid: 9, host: "OTHER", startedAt: 0, leaseUntil: 100, pidAlive: false }));
  assert.equal(makeLease({ dir: "/lock", fs, host: "h", now: () => 999 }).acquire().acquired, false, "different host → never steal");
});

test("reclaims a verifiably-dead holder immediately via OS liveness probe (no expiry wait)", () => {
  const fs = memFs();
  // Real acquire() writes pidAlive:true and never flips it; a crashed/exited holder that skipped
  // release() would pin the lock forever without a liveness probe. A dead holder never releases, so
  // it is reclaimable IMMEDIATELY — even while the lease is still fresh (the EOS-INTAKE-001→next case).
  makeLease({ dir: "/lock", fs, host: "local", pid: 9, now: () => 0, leaseMs: 100000 }).acquire();
  assert.equal(makeLease({ dir: "/lock", fs, host: "local", pid: 2, now: () => 5, isPidAlive: () => false }).acquire().acquired, true, "dead holder → reclaim immediately, not-expired");
});

test("never steals from a live holder, even after the lease lapses", () => {
  const fs = memFs();
  makeLease({ dir: "/lock", fs, host: "local", pid: 9, now: () => 0, leaseMs: 100 }).acquire();
  assert.equal(makeLease({ dir: "/lock", fs, host: "local", pid: 5, now: () => 400, isPidAlive: () => true }).acquire().acquired, false, "expired but alive → hold");
});

// --- makeRequestClaim: per-request atomic claim (concurrent-write safety primitive) ---

test("makeRequestClaim: two workers on the SAME request collide — exactly one wins", () => {
  const fs = memFs();
  const opts = { lockRoot: "/claims", fs, host: "h", now: () => 0 };
  const a = makeRequestClaim("EOS-ISSUE-826", { ...opts, pid: 1 });
  const b = makeRequestClaim("EOS-ISSUE-826", { ...opts, pid: 2 });
  assert.equal(a.acquire().acquired, true, "first worker claims the item");
  assert.equal(b.acquire().acquired, false, "second worker on the same request is refused");
});

test("makeRequestClaim: workers on DIFFERENT requests run concurrently", () => {
  const fs = memFs();
  const opts = { lockRoot: "/claims", fs, host: "h", now: () => 0 };
  assert.equal(makeRequestClaim("EOS-ISSUE-826", { ...opts, pid: 1 }).acquire().acquired, true);
  assert.equal(makeRequestClaim("EOS-ISSUE-827", { ...opts, pid: 2 }).acquire().acquired, true, "disjoint requests → both claim");
});

test("makeRequestClaim: release frees the per-request claim for a retry", () => {
  const fs = memFs();
  const opts = { lockRoot: "/claims", fs, host: "h", now: () => 0 };
  const a = makeRequestClaim("EOS-ISSUE-840", { ...opts, pid: 1 });
  a.acquire(); a.release();
  assert.equal(makeRequestClaim("EOS-ISSUE-840", { ...opts, pid: 2 }).acquire().acquired, true, "reclaimable after release");
});

test("makeRequestClaim: a bad requestId fails closed (never shares a lock by normalization)", () => {
  const fs = memFs();
  for (const bad of ["", "ab", "../escape", "has space", "semi;colon", null]) {
    assert.throws(() => makeRequestClaim(bad, { lockRoot: "/claims", fs }), /requestId/, `rejected: ${JSON.stringify(bad)}`);
  }
});
