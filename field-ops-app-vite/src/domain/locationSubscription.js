// #291 -- the pure state decisions behind useLocationsForAccount, pulled out of the
// React shell so they are node-testable directly (the same discipline as domain/*).
// The hook owns the onSnapshot lifecycle, the obsolete-callback guard, and retry
// re-subscription -- lifecycle concerns proven in the browser gate -- while WHAT each
// outcome resolves to lives here, where it can be asserted without a browser.
//
// Dependency-free beyond loadErrorMessage (itself firebase-free), so this stays
// node-importable.
import { loadErrorMessage } from "./loadErrorMessage.js";

const ENTITY = "locations";

// A snapshot arrived: this is the data, we are no longer loading, and any prior error is
// cleared (a later success supersedes an earlier failure -- e.g. after a retry).
export function locationSuccessOutcome(docs) {
  return { data: Array.isArray(docs) ? docs : [], loading: false, error: null };
}

// The subscription failed. FAIL CLOSED: surface NOTHING rather than a stale or partial
// list, and a SAFE message -- loadErrorMessage never emits a raw code, path, id, or
// collection name. This is the whole point of #291: a failure must be distinguishable
// from "no locations" and from "still loading", and it must never be rendered as a fact.
export function locationFailureOutcome(err) {
  return { data: [], loading: false, error: loadErrorMessage(err, { entity: ENTITY }) };
}

// No account to look up (null/blank id): not loading, not an error, simply empty. An
// absent account is not a failed read.
export function locationIdleOutcome() {
  return { data: [], loading: false, error: null };
}
