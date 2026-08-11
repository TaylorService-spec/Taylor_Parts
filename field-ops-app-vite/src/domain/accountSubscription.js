// #785 -- the pure state decisions behind useAccount, pulled out of the React shell so
// they are node-testable directly (the same discipline as domain/locationSubscription.js).
// The hook owns the onSnapshot lifecycle, the obsolete-callback guard, and retry
// re-subscription; WHAT each outcome resolves to lives here, where it can be asserted
// without a browser.
//
// This is the SINGLE-DOCUMENT sibling of locationSubscription.js: one Account, not a
// collection, so success carries `account` (a record or null) rather than a `data` array.
// The point is identical to #291's for Location: on the Equipment detail screen a DENIED
// or failed customer read must be distinguishable from a genuinely-absent customer -- it
// must never fall through to "Unknown customer" and render a failure as a fact.
//
// Dependency-free beyond loadErrorMessage (itself firebase-free), so this stays
// node-importable.
import { loadErrorMessage } from "./loadErrorMessage.js";

const ENTITY = "customer details";

// A snapshot arrived. `account` is the record when the document exists, or null when it
// genuinely does not -- a confirmed absence, NOT a failure. Loading is done and any prior
// error is cleared (a later success supersedes an earlier failure -- e.g. after a retry).
export function accountSuccessOutcome(account) {
  return { account: account ?? null, loading: false, error: null };
}

// The subscription failed. FAIL CLOSED: surface NO account (never a stale record) and a
// SAFE message -- loadErrorMessage never emits a raw code, path, id, or collection name.
// This is the whole point of #785: a failure must be distinguishable from "no such
// customer" and from "still loading", and it must never be rendered as a fact.
export function accountFailureOutcome(err) {
  return { account: null, loading: false, error: loadErrorMessage(err, { entity: ENTITY }) };
}

// No account to look up (null/blank id): not loading, not an error, simply nothing to
// resolve. An absent id is not a failed read.
export function accountIdleOutcome() {
  return { account: null, loading: false, error: null };
}
