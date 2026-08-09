// Shared Agent Manager — Global Resource Governor.
//
// Treats remote network/AI capacity as a FINITE SHARED resource across all of
// EOS (Design + UX + any workstream). Conservative starting limits (§4); these
// are GLOBAL, not per-workstream. Required before any unattended Option B.
//
// Local work — source inspection, git/worktrees, tests, lint, typecheck, builds,
// emulators, local browser, roadmap rendering — does NOT consume a REMOTE_AI slot
// (execution: "LOCAL"). Only requests that actually make a remote model/service
// call are governed here.
//
// A request that cannot get a slot is READY_BUT_WAITING_RESOURCE — a transient
// resource wait, NOT a Product BLOCKED_DEPENDENCY (§4). Pure: no I/O.

export const CAPACITY = Object.freeze({
  REMOTE_AI: 2,          // total concurrent remote agents across EOS
  BROWSER_REMOTE: 1,     // concurrent remote browser agents
  NETWORK_HEAVY_REMOTE: 1, // concurrent network-heavy remote operations
  MUTATING_REMOTE: 1,    // mutating remote agents run sequentially (§7)
});

// The resource footprint a request occupies while running.
export function classifyResourceNeed(request) {
  const remote = request.execution === "REMOTE";
  return {
    remoteAi: remote ? 1 : 0,                     // LOCAL work consumes no remote slot
    browser: remote && request.requiresBrowser ? 1 : 0,
    networkHeavy: remote && request.networkHeavy === true ? 1 : 0,
    mutating: remote && request.mutating === true ? 1 : 0,
  };
}

// Sum current in-flight footprints.
function inUse(allocations) {
  return (allocations || []).reduce((a, n) => ({
    remoteAi: a.remoteAi + (n.remoteAi || 0),
    browser: a.browser + (n.browser || 0),
    networkHeavy: a.networkHeavy + (n.networkHeavy || 0),
    mutating: a.mutating + (n.mutating || 0),
  }), { remoteAi: 0, browser: 0, networkHeavy: 0, mutating: 0 });
}

// Can `need` be admitted on top of `allocations` without exceeding any GLOBAL limit?
export function allocate(allocations, need) {
  const used = inUse(allocations);
  const waitingOn = [];
  if (used.remoteAi + need.remoteAi > CAPACITY.REMOTE_AI) waitingOn.push("REMOTE_AI");
  if (used.browser + need.browser > CAPACITY.BROWSER_REMOTE) waitingOn.push("BROWSER_REMOTE");
  if (used.networkHeavy + need.networkHeavy > CAPACITY.NETWORK_HEAVY_REMOTE) waitingOn.push("NETWORK_HEAVY_REMOTE");
  if (used.mutating + need.mutating > CAPACITY.MUTATING_REMOTE) waitingOn.push("MUTATING_REMOTE");
  return waitingOn.length === 0
    ? { decision: "GRANT", need }
    : { decision: "WAIT_RESOURCE", waitingOn };
}

export function capacitySnapshot(allocations) {
  const used = inUse(allocations);
  return {
    remoteAi: { used: used.remoteAi, total: CAPACITY.REMOTE_AI },
    browser: { used: used.browser, total: CAPACITY.BROWSER_REMOTE },
    networkHeavy: { used: used.networkHeavy, total: CAPACITY.NETWORK_HEAVY_REMOTE },
    mutating: { used: used.mutating, total: CAPACITY.MUTATING_REMOTE },
  };
}
