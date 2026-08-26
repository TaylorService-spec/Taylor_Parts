import { useCallback, useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { ACCOUNTS_COLLECTION } from "../domain/constants";
import { loadErrorMessage } from "../domain/loadErrorMessage";

const ENTITY = "customers";

// Sprint 2.0.2 -- Customer Foundation. Single-document live listener,
// same onSnapshot(doc(...)) shape already used by
// useCurrentTechnician.js -- not a new pattern.
//
// site-work #4: this hook used to pass no error callback to onSnapshot, so a
// DENIED or failed Account read never resolved -- `loading` stayed true
// forever (AccountDetail's "Loading..." never cleared), or a stale `account`
// left over from a previous id could keep rendering and read as a fact. It
// now fails closed to a safe `error` (loadErrorMessage -- never a raw
// code/path/id) and clears the stale account, so a FAILED read is
// distinguishable from a CONFIRMED absence (a successful read that found no
// such Account) and from still loading -- the same discipline
// useEquipmentDoc (hooks/useEquipment.js) and useLocationsForAccount already
// apply. Also adds the retry re-subscription and obsolete-callback guard
// useLocationsForAccount established, so callers can offer the same Retry
// affordance.
export function useAccount(accountId) {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // WHEN THIS READ LAST ANSWERED. Stamped on every delivery -- a snapshot OR an error -- so a
  // caller can say "read-checked 9:12 AM" and mean it, rather than implying a freshness it cannot
  // evidence. Null until the first answer arrives; a caller with no stamp says nothing.
  //
  // North Star Account P1 records a premise mismatch here rather than smoothing it over
  // (A-NS-1): the approved design's note says "useAccount is not a subscription", and this hook
  // IS one -- onSnapshot, below. The design's CONCLUSION is unaffected and is implemented as
  // written: no live badge, and honest "Read-checked <time> - Refresh" wording instead. The
  // wording is true under either premise (the data is at least as fresh as the stamp), which is
  // why the mismatch changes no business behavior and needed no ruling.
  const [checkedAt, setCheckedAt] = useState(null);
  // Bumped by retry() to force a clean teardown + re-subscribe. It is a
  // useEffect dep, so the effect's own cleanup runs first -- no duplicate
  // listener -- and it only changes on an explicit call, so there is no loop.
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!accountId) {
      setAccount(null);
      setError(null);
      setLoading(false);
      return;
    }

    // Obsolete-callback guard: a snapshot or error that arrives after this
    // effect is torn down (accountId changed, unmount, or a retry) must not
    // write state belonging to a subscription that no longer exists.
    // onSnapshot's unsub stops callbacks synchronously, so this is
    // belt-and-braces -- but it is the guard the sibling hooks keep, and it
    // closes the React-18 double-invoke / rapid-switch window.
    let active = true;
    setLoading(true);
    setError(null);
    const unsub = onSnapshot(
      doc(db, ACCOUNTS_COLLECTION, accountId),
      (snap) => {
        if (!active) return;
        setAccount(snap.exists() ? { id: snap.id, ...snap.data() } : null);
        setError(null);
        setLoading(false);
        setCheckedAt(Date.now());
      },
      (err) => {
        if (!active) return;
        // Fail closed: clear any stale account rather than leave a previous
        // id's data on screen looking current, and never render a failure as
        // "no such customer".
        setAccount(null);
        setError(loadErrorMessage(err, { entity: ENTITY }));
        setLoading(false);
        setCheckedAt(Date.now());
      }
    );

    return () => {
      active = false;
      unsub();
    };
  }, [accountId, attempt]);

  return { account, loading, error, retry, checkedAt };
}
