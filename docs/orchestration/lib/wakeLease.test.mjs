import { test } from "node:test";
import assert from "node:assert/strict";
import { makeLease } from "./wakeLease.mjs";

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

test("reclaims a crashed holder (pidAlive never flipped) once expired, via OS liveness check", () => {
  const fs = memFs();
  // Real acquire() writes pidAlive:true and never flips it; a crashed holder that skipped release()
  // would pin the lock forever without a liveness check.
  makeLease({ dir: "/lock", fs, host: "local", pid: 9, now: () => 0, leaseMs: 100 }).acquire();
  // Before expiry: never steal, even if the pid is dead.
  assert.equal(makeLease({ dir: "/lock", fs, host: "local", pid: 2, now: () => 50, isPidAlive: () => false }).acquire().acquired, false, "not expired → hold");
  // Expired + pid dead on this host → reclaim.
  assert.equal(makeLease({ dir: "/lock", fs, host: "local", pid: 2, now: () => 200, isPidAlive: () => false }).acquire().acquired, true, "expired + dead → reclaim");
  // Expired but pid still alive → never steal from a live long-running worker.
  makeLease({ dir: "/lock", fs, host: "local", pid: 9, now: () => 200, leaseMs: 100 }); // (record now owned by pid 2 from the steal above)
  assert.equal(makeLease({ dir: "/lock", fs, host: "local", pid: 5, now: () => 400, isPidAlive: () => true }).acquire().acquired, false, "expired but alive → hold");
});
