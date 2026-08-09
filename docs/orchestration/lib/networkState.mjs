// Shared Agent Manager — minimum network-aware state.
//
// The household network has shown instability CORRELATED with high concurrent
// remote-agent activity. This is NOT proven causation — but we design defensively
// around the observed correlation with the SMALLEST measurable policy (§5).
//
// NETWORK_UNAVAILABLE is NOT WORK_FAILED, NOT OWNER_DECISION, NOT a Product
// BLOCKED_DEPENDENCY. On unavailability we preserve assignments/checkpoints, stop
// launching NEW remote work, continue local READY work where safe, and resume
// remote execution only after a stability window — never aggressive retry against
// a failing connection. Pure state machine; no I/O, no timers (the driver owns the
// clock and feeds signals).

export const NETWORK_STATES = Object.freeze(["NORMAL", "NETWORK_PRESSURE", "NETWORK_UNAVAILABLE", "RECOVERY"]);
export const SIGNALS = Object.freeze(["PRESSURE_DETECTED", "UNAVAILABLE_DETECTED", "STABILITY_WINDOW_ELAPSED", "RECOVERED", "CLEARED"]);

export function transition(state, signal) {
  switch (signal) {
    case "UNAVAILABLE_DETECTED": return "NETWORK_UNAVAILABLE";
    case "PRESSURE_DETECTED": return state === "NETWORK_UNAVAILABLE" ? state : "NETWORK_PRESSURE";
    case "RECOVERED": // connection came back — enter RECOVERY, hold before resuming remote
      return state === "NETWORK_UNAVAILABLE" ? "RECOVERY" : state;
    case "STABILITY_WINDOW_ELAPSED": // a quiet window passed → return to NORMAL
      return state === "RECOVERY" ? "NORMAL" : state;
    case "CLEARED": return state === "NETWORK_PRESSURE" ? "NORMAL" : state;
    default: return state;
  }
}

// What remote/local execution is permitted in each state.
export function remotePolicy(state) {
  switch (state) {
    case "NORMAL":
      return { allowNewRemote: true, preserveCheckpoints: false, continueLocal: true, retry: "NORMAL" };
    case "NETWORK_PRESSURE": // throttle: finish in-flight, launch no new remote
      return { allowNewRemote: false, preserveCheckpoints: true, continueLocal: true, retry: "NONE" };
    case "NETWORK_UNAVAILABLE": // preserve + local-only + no aggressive retry
      return { allowNewRemote: false, preserveCheckpoints: true, continueLocal: true, retry: "NONE" };
    case "RECOVERY": // came back, but hold new remote until the stability window elapses
      return { allowNewRemote: false, preserveCheckpoints: true, continueLocal: true, retry: "BACKOFF" };
    default:
      return { allowNewRemote: false, preserveCheckpoints: true, continueLocal: true, retry: "NONE" };
  }
}
