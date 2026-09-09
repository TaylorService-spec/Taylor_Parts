import { useCallback, useEffect, useState } from "react";
import { governedCollectionClient } from "../access/governedCollectionClient";
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
// reference. The fail-closed OUTCOME matches the useEquipment.js read hooks; this hook is
// a superset -- it also carries the obsolete-callback guard, retry re-subscription, and
// the pure-outcome delegation those hooks do not.
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
    // GOVERNED READ, not a Firestore listener. `locations` is denied to every client in
    // firestore.rules now, so this resolves `crm.location.read` server-side. The accountId filter
    // is declared by the collection's registry entry; an undeclared one is refused rather than
    // dropped, which is what keeps a scoped read from becoming a read of every location.
    //
    // The pure outcome helpers are UNCHANGED and still own every fail-closed decision -- this hook
    // still only wires them to a lifecycle. locationFailureOutcome takes an Error, so a refused or
    // unreachable read is passed as one: the failure path stays the failure path, and an empty
    // list is never manufactured from a denial.
    governedCollectionClient
      .readGovernedList({
        sourceId: "accountLocations",
        filters: { accountId },
      })
      .then((outcome) => {
        if (!active) return;
        apply(
          outcome.ok
            ? locationSuccessOutcome(outcome.items)
            : locationFailureOutcome(new Error(outcome.result)),
        );
      });

    return () => {
      active = false;
    };
  }, [accountId, attempt, apply]);

  return { data, loading, error, retry };
}
