// A same-session signal that the technician directory changed.
//
// The sibling of domain/reorderRequestsChanged.js, and it exists for the same reason: a governed
// callable cannot push, so a mutation made in THIS browser must tell the surfaces listening in this
// browser to re-read. Without it, creating a technician would leave the list beside the modal
// showing the old rows for up to a poll interval.
//
// IT IS NOT A REALTIME MECHANISM. It never crosses sessions and is not trying to: another
// dispatcher's change arrives through the bounded poll in useTechnicianDirectory, which is the
// documented parity for that case. This only closes the gap for the acting session, where waiting
// on a timer would be visibly wrong.
const listeners = new Set();

/** Subscribe to same-session directory changes. Returns an unsubscribe function. */
export function subscribeToTechnicianDirectoryChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Announce a successful technician mutation. Call AFTER the write resolves, never before. */
export function notifyTechnicianDirectoryChanged() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // One bad listener must not stop the others being told.
    }
  }
}
