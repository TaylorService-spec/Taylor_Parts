// Execution lease — atomic mkdir lock + heartbeat record + stale reclaim (no DB), per WAKE-RESEARCH-001.
// Prevents duplicate/concurrent wake runs. fs is INJECTED so the pure logic is unit-testable; the
// runner passes node:fs. A lock is stealable only when its record is BOTH past its lease AND owned by
// a dead PID on THIS host (pair mtime with pid+host — never steal another host's live lock).

export function makeLease({ dir, fs, host = "local", pid = 0, now = () => 0, leaseMs = 600000 } = {}) {
  if (!dir || !fs) throw new Error("makeLease: dir and fs are required");
  const recPath = `${dir}/owner.json`;
  const readRec = () => { try { return JSON.parse(fs.readFileSync(recPath, "utf8")); } catch { return null; } };

  return {
    acquire() {
      try {
        fs.mkdirSync(dir); // atomic: fails if the lock dir already exists
      } catch (e) {
        // Directory exists — reclaim ONLY if the holder is stale AND dead on this host.
        const rec = readRec();
        const expired = rec && typeof rec.leaseUntil === "number" && now() >= rec.leaseUntil;
        const sameHostDead = rec && rec.host === host && rec.pidAlive === false;
        if (!(expired && sameHostDead)) return { acquired: false, reason: rec ? "held" : "locked" };
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
