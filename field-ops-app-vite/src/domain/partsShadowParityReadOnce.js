// INV-CONVERGENCE-E Stage A completion -- pure reader-outcome wrapper. Turns a
// throwing one-shot fetch (getDocs) into the { ok, rows } | { ok:false, code }
// reader contract the capture orchestrator expects, mapping a Firestore
// `permission-denied` to "permission-denied" and anything else to "unavailable".
// No Firebase/network import here (the fetch fn is injected), so it is unit-tested
// offline; each call invokes the fetch exactly once.
export async function readOnce(fetchFn) {
  try {
    const rows = await fetchFn();
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  } catch (err) {
    const code = err && err.code === "permission-denied" ? "permission-denied" : "unavailable";
    return { ok: false, code };
  }
}
