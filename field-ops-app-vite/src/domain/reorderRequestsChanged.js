// CROSS-COMPONENT REFRESH FOR REORDER REQUESTS -- the smallest signal that preserves a behaviour
// the Firestore removal would otherwise have cost.
//
// ════════════════════ WHAT THIS REPLACES, AND WHY IT IS NOT OPTIONAL ════════════════════
//
// The reorder hooks used onSnapshot deliberately. Their file header records the bug that forced it:
// PartsList.jsx's "Request Reorder" wrote, and AppHeader.jsx's Notification Panel -- already mounted
// elsewhere in the tree -- showed nothing until a browser reload, because each component held its
// own independent one-shot read with no shared cache or invalidation between them.
//
// Moving those reads to a governed callable removes Firestore, and a callable cannot stream. So the
// cross-component refresh has to come from somewhere, or the migration quietly reintroduces the
// exact bug onSnapshot was adopted to fix. Removing a Firestore dependency is not permission to
// remove observable application behaviour.
//
// ════════════════════ WHY THIS SHAPE ════════════════════
//
// The codebase's existing pattern is a hook-local `reloadToken` that the caller bumps after its OWN
// write (useCrmActivities, useOpportunities). That is the right tool for same-component refresh and
// cannot solve this case: the writer and the reader are different components, and the writer does
// not know the reader exists.
//
// So this is that same pattern with one addition -- the token lives in a module rather than in one
// component -- and nothing else. It is NOT an event bus: there is one subject, no payloads, no
// topics, no wildcard subscription, and no way to publish anything but "reorder requests changed".
// A reader learns only that it should re-read; it never learns what changed, which is what keeps
// this from growing into a client-side cache with its own coherence problems.
//
// NO AUTHORIZATION SURFACE. The signal carries no data. Every refresh it triggers is an ordinary
// governed read that re-resolves the caller's capability server-side, exactly as a first load does.

/** Subscribers. A Set so the same callback registering twice cannot be notified twice. */
const listeners = new Set();

/**
 * Monotonic change counter.
 *
 * A NUMBER rather than a boolean flag because it is consumed as a useEffect dependency: two writes
 * between renders must still read as "changed", and a flag that toggles back would cancel itself.
 */
let version = 0;

/** The current version. Stable between changes, so it is safe as a dependency and in a selector. */
export function getReorderRequestsVersion() {
  return version;
}

/**
 * Subscribe to reorder-request changes. Returns an unsubscribe function.
 *
 * Shaped for useSyncExternalStore, but usable directly by anything that wants to re-read.
 */
export function subscribeReorderRequestsChanged(onChange) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * Announce that reorder requests changed. Called by the write paths AFTER a mutation succeeds.
 *
 * AFTER, never before or optimistically: the point of the signal is to make readers re-read the
 * authoritative state, so announcing a change that did not commit would make every listening view
 * briefly wrong in the same way at the same time.
 *
 * Deliberately tolerant of a throwing listener -- one unmounting component with a stale callback
 * must not prevent every other view from refreshing.
 */
export function notifyReorderRequestsChanged() {
  version += 1;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A listener that throws is a bug in that listener, not a reason to abandon the rest.
    }
  }
}
