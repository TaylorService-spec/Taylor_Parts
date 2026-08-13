// Execution lease — atomic mkdir lock + heartbeat record + stale reclaim (no DB), per WAKE-RESEARCH-001.
// Prevents duplicate/concurrent wake runs. fs is INJECTED so the pure logic is unit-testable; the
// runner passes node:fs. A lock is stealable only when its record is BOTH past its lease AND owned by
// a dead PID on THIS host (pair mtime with pid+host — never steal another host's live lock).

export function makeLease({ dir, fs, host = "local", pid = 0, now = () => 0, leaseMs = 600000, isPidAlive = null } = {}) {
  if (!dir || !fs) throw new Error("makeLease: dir and fs are required");
  const recPath = `${dir}/owner.json`;
  const readRec = () => { try { return JSON.parse(fs.readFileSync(recPath, "utf8")); } catch { return null; } };

  // Two independent staleness signals, both scoped to THIS host (never judge another host's lock):
  //  • probeSaysDead — an injected OS liveness check reports the holder pid is gone. A dead holder
  //    will NEVER call release(), so its lock is reclaimable IMMEDIATELY, independent of the lease
  //    TTL. This is what keeps a crashed/killed holder — or a just-exited prior intake whose
  //    release() didn't land — from pinning the single execution lease.
  //  • flagSaysDead — the record itself is marked pidAlive:false (set by a supervisor, not by
  //    acquire() which always writes true). Weaker signal: honored only once the lease has expired,
  //    preserving the original TTL contract.
  const probeSaysDead = (rec) => !!rec && rec.host === host && typeof isPidAlive === "function" && isPidAlive(rec.pid) === false;
  const flagSaysDead = (rec) => !!rec && rec.host === host && rec.pidAlive === false;

  return {
    acquire() {
      try {
        fs.mkdirSync(dir); // atomic: fails if the lock dir already exists
      } catch (e) {
        // Directory exists — reclaim a verifiably-dead holder immediately, or an expired lease whose
        // record marks the holder dead. A live holder (probe says alive) is never stolen, even if the
        // lease lapsed — a long-running worker keeps its lock.
        const rec = readRec();
        const expired = rec && typeof rec.leaseUntil === "number" && now() >= rec.leaseUntil;
        const reclaimable = probeSaysDead(rec) || (expired && flagSaysDead(rec));
        if (!reclaimable) return { acquired: false, reason: rec ? "held" : "locked" };
        // steal: overwrite the record with ours
      }
      fs.writeFileSync(recPath, JSON.stringify({ pid, host, startedAt: now(), leaseUntil: now() + leaseMs, pidAlive: true }));
      return { acquired: true };
    },
    release() {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { fs.rmdirSync(dir); }
    },
    // For a supervisor deciding reclaim: is the current lock stale (expired + dead-on-this-host)?
    isReclaimable(pidAliveCheck) {
      const rec = readRec();
      if (!rec) return false;
      const expired = typeof rec.leaseUntil === "number" && now() >= rec.leaseUntil;
      const dead = rec.host === host && pidAliveCheck ? pidAliveCheck(rec.pid) === false : rec.pidAlive === false;
      return !!(expired && dead);
    },
  };
}

// Per-request atomic claim — the safety primitive for concurrent writes. Where makeLease({dir}) gives ONE
// dir-global lock (correct for the single-worker runtime), makeRequestClaim keys the SAME proven atomic-mkdir
// lease by requestId: two workers targeting the same item collide on `lock/<requestId>` and exactly one wins,
// while workers on DIFFERENT requests take DIFFERENT dirs and run concurrently. This is what lets the
// concurrent-write runner drain disjoint sectors in parallel without two writers ever grabbing the same work.
// Reuses makeLease verbatim (same reclaim/heartbeat/stale semantics) — only the lock path is per-request.
export function makeRequestClaim(requestId, { lockRoot, fs, host = "local", pid = 0, now = () => 0, leaseMs = 900000, isPidAlive = null } = {}) {
  // requestId becomes a path segment; constrain it to a safe slug so it can't escape lockRoot or collide by
  // normalization. A bad id fails closed (throws) rather than silently sharing a lock with another request.
  if (typeof requestId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(requestId)) {
    throw new Error("makeRequestClaim: requestId must be a 3-80 char slug of [A-Za-z0-9._-]");
  }
  if (!lockRoot || !fs) throw new Error("makeRequestClaim: lockRoot and fs are required");
  return makeLease({ dir: `${lockRoot}/${requestId}`, fs, host, pid, now, leaseMs, isPidAlive });
}
