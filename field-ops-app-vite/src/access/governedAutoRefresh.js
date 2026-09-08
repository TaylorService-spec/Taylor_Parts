// Automatic governed refresh -- the replacement for a Firestore `onSnapshot` subscription.
//
// ════════════════════ REALTIME PARITY, STATED HONESTLY ════════════════════
//
//   old  Firestore push (onSnapshot)
//   new  automatic governed refresh, bounded <= 5 seconds
//
// This IS a behaviour change and is recorded as one rather than described as parity: an update that
// used to arrive in milliseconds now arrives within five seconds. What the observable requirement
// demands is preserved -- a dispatcher with an open board sees work move without reloading.
//
// WHY POLLING AND NOT A PUSH CHANNEL. A governed callable cannot stream, and the alternatives (SSE,
// WebSockets, a second Firebase data channel) are realtime INFRASTRUCTURE: a standing commitment
// far larger than the screen behaviours that need it. This is the same governed read, repeated.
//
// COST IS BOUNDED DELIBERATELY. The interval suspends while the document is hidden, so a forgotten
// background tab costs nothing, and it resumes with an IMMEDIATE read rather than after another
// full interval when the tab is shown or the window focused.
//
// This is the mechanism half only. It holds no data and knows nothing about work orders,
// technicians or capabilities -- callers pass a read function and receive its results.
export const GOVERNED_REFRESH_MS = 5000;

/**
 * @param read     async () => value. Called immediately, then on the interval.
 * @param onValue  called with each successful read's value.
 * @param onError  called with an Error when a read fails. The caller decides what a failure means
 *                 for what is already on screen -- this helper never invents an empty result,
 *                 because an empty list rendered on a failed read states that the business has no
 *                 rows, which is a different and much more confident claim than "the read failed".
 * @returns        an unsubscribe function, matching the Firestore listener API it replaces so
 *                 consumers keep their existing teardown.
 */
export function startGovernedRefresh(read, onValue, onError, { intervalMs = GOVERNED_REFRESH_MS } = {}) {
  let active = true;
  let timer = null;

  const tick = async () => {
    try {
      const value = await read();
      if (!active) return;
      onValue(value);
    } catch (err) {
      if (!active) return;
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  const start = () => {
    if (timer === null && active) timer = setInterval(tick, intervalMs);
  };
  const stop = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const onVisibility = () => {
    if (typeof document !== "undefined" && document.hidden) {
      stop();
      return;
    }
    tick();
    start();
  };
  const onFocus = () => {
    tick();
    start();
  };

  tick();
  const hidden = typeof document !== "undefined" && document.hidden;
  if (!hidden) start();
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  if (typeof window !== "undefined") window.addEventListener("focus", onFocus);

  return () => {
    active = false;
    stop();
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    if (typeof window !== "undefined") window.removeEventListener("focus", onFocus);
  };
}
