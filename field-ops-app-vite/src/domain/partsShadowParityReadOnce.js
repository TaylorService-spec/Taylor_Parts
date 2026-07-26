// INV-CONVERGENCE-E Stage A completion -- pure reader-outcome wrapper. Turns a
// one-shot fetch (getDocs) into the { ok, rows } | { ok:false, code } reader contract
// the capture orchestrator expects. FAILS CLOSED: a successful but non-array result is
// NOT coerced into an empty array -- it is reported incomplete so a malformed read can
// never masquerade as a legitimate zero-record snapshot. No Firebase/network import
// here (the fetch fn is injected), so it is unit-tested offline; one call per read.
//
//   Array (incl. []):        { ok: true, rows }
//   non-array success:       { ok: false, code: "incomplete-input" }
//   permission-denied throw: { ok: false, code: "permission-denied" }
//   any other throw:         { ok: false, code: "unavailable" }
export async function readOnce(fetchFn) {
  let rows;
  try {
    rows = await fetchFn();
  } catch (err) {
    const code = err && err.code === "permission-denied" ? "permission-denied" : "unavailable";
    return { ok: false, code };
  }
  if (!Array.isArray(rows)) return { ok: false, code: "incomplete-input" };
  return { ok: true, rows };
}
