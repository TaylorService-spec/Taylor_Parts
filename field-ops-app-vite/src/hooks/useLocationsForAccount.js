import { useCallback, useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { LOCATIONS_COLLECTION } from "../domain/constants";
import {
  locationSuccessOutcome,
  locationFailureOutcome,
  locationIdleOutcome,
} from "../domain/locationSubscription";

// A single-field equality query needs no composite index.

// Sprint 2.0.2 -- Customer Foundation. A separate, additional scoped listener -- same
// precedent as PT-002's subscribeAssignedWorkOrders()/useAssignedWorkOrders(), not a
// modification of the generic useFirestoreCollection() hook. A single-field equality
// query needs no composite index.
//
// #291: this hook used to pass no error callback to onSnapshot, so a DENIED or failed
// Locations read never resolved -- `loading` stayed true forever, or a partial result
// stayed on screen -- and every consumer read that as "still loading" or "no locations".
// In the Equipment register that surfaced as rows stuck on "Unknown location", a failure
// rendered as a fact. It now fails closed to a safe `error` and clears stale data, so a
// failed lookup is distinct from loading, from empty, and from a genuinely unresolved
// reference. Matches the useEquipment.js read hooks exactly.
export function useLocationsForAccount(accountId) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Bumped by retry() to force a clean teardown + re-subscribe. It is a useEffect dep, so
  // the effect's own cleanup runs first -- no duplicate listener -- and it only changes on
  // an explicit call, so there is no loop.
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // Apply a pure outcome (domain/locationSubscription) to the three state setters. Keeps
  // the fail-closed decisions in one tested place; the hook only wires them to lifecycle.
  const apply = useCallback((outcome) => {
    setData(outcome.data);
    setError(outcome.error);
    setLoading(outcome.loading);
  }, []);

  useEffect(() => {
    if (!accountId) {
      apply(locationIdleOutcome());
      return;
    }

    // Obsolete-callback guard: a snapshot or error that arrives after this effect is torn
    // down (accountId changed, unmount, or a retry) must not write state belonging to a
    // subscription that no longer exists. onSnapshot's unsub stops callbacks synchronously,
    // so this is belt-and-braces -- but it is the guard the shared hooks are expected to
    // keep, and it closes the React-18 double-invoke / rapid-switch window.
    let active = true;
    setLoading(true);
    setError(null);
    const q = query(collection(db, LOCATIONS_COLLECTION), where("accountId", "==", accountId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (!active) return;
        apply(locationSuccessOutcome(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
      },
      (err) => {
        if (!active) return;
        apply(locationFailureOutcome(err));
      }
    );

    return () => {
      active = false;
      unsub();
    };
  }, [accountId, attempt, apply]);

  return { data, loading, error, retry };
}
