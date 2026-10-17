// END A pg POOL AND WAIT FOR ITS SOCKETS TO CLOSE -- the teardown every PostgreSQL suite needs before it force-drops its
// private database.
//
// pg-pool 3.x resolves `pool.end()` as soon as it has ASKED each client to close: Pool._remove drops the client from its
// list and calls client.end() without waiting. A `DROP DATABASE ... WITH (FORCE)` issued right after then terminates any
// backend still processing its Terminate, and that client -- ending, with the pool's idle listener still attached --
// surfaces 57P01 "terminating connection due to administrator command" as an uncaughtException that node:test pins on
// whichever subtest opened the client (#2120 traced and proved this on assignmentScopeRuntimePostgres).
//
// So: count the pool's clients, end it, and wait for one `remove` per client. pg-pool emits `remove` from client.end's
// callback, i.e. once the socket is closed. Bounded, and LOUD when exceeded: a teardown that hangs a CI job is worse than
// the flake it replaces.
export async function endPoolAndDrain(pool, { timeoutMs = 15000 } = {}) {
  if (!pool || pool.ending || pool.ended) return;
  const expected = pool.totalCount;
  let onRemove;
  const drained = expected === 0 ? null : new Promise((resolve, reject) => {
    let seen = 0;
    const timer = setTimeout(() => reject(new Error(
      `endPoolAndDrain: ${expected - seen} of ${expected} pool client(s) did not close within ${timeoutMs}ms`)), timeoutMs);
    onRemove = () => { if (++seen >= expected) { clearTimeout(timer); resolve(); } };
    pool.on("remove", onRemove);
  });
  try {
    await pool.end();
    await drained;
  } finally {
    if (onRemove) pool.off("remove", onRemove);
  }
}
