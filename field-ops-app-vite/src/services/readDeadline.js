// A bounded wait for READ-ONLY requests (RCV-02). Only reads may be abandoned on a clock: a read changes nothing, so giving up on it is always safe.
// A WRITE is never given a deadline here -- abandoning one that may already have committed would make it look failed and invite a double submit.
// 45s is above the server's own 30s statement bound (same figure as ISSUE_WAIT_MS in modules/financials/InvoiceIssueQueue.jsx), so a server answer always wins.
export const READ_WAIT_MS = 45_000;
export const READ_TIMED_OUT_REASON = "READ_TIMED_OUT";

/** `isRead` false returns the caller's own signal untouched and no timer. Always call `clear()` once the answer (body included) is in. */
export function readDeadline(isRead, callerSignal, waitMs = READ_WAIT_MS) {
  if (!isRead) return { signal: callerSignal, timedOut: () => false, clear() {} };
  const ctl = new AbortController();
  let fired = false;
  const timer = setTimeout(() => { fired = true; ctl.abort(); }, waitMs);
  if (callerSignal) {
    if (callerSignal.aborted) ctl.abort();
    else callerSignal.addEventListener("abort", () => ctl.abort(), { once: true });
  }
  return { signal: ctl.signal, timedOut: () => fired, clear: () => clearTimeout(timer) };
}
