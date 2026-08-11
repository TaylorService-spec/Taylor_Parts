import { useCallback, useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { ACCOUNTS_COLLECTION } from "../domain/constants";
import {
  accountSuccessOutcome,
  accountFailureOutcome,
  accountIdleOutcome,
} from "../domain/accountSubscription";

// Sprint 2.0.2 -- Customer Foundation. Single-document live listener,
// same onSnapshot(doc(...)) shape already used by
// useCurrentTechnician.js -- not a new pattern.
//
// #785: this hook used to pass no error callback to onSnapshot, so a DENIED or failed
// customer read never resolved -- `loading` stayed true forever, or nothing arrived -- and
// every consumer read that as "still loading" or, once loading cleared elsewhere, as
// "Unknown customer". On the Equipment detail screen that surfaced a failure as a fact.
// It now fails closed to a safe `error` and clears stale data, so a failed lookup is
// distinct from loading, from a confirmed-absent customer, and from a genuinely unresolved
// reference -- the single-document sibling of #291's Location fix. Like that hook, it also
// carries the obsolete-callback guard and retry re-subscription, delegating the pure
// outcome decisions to domain/accountSubscription.js.
export function useAccount(accountId) {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Bumped by retry() to force a clean teardown + re-subscribe. It is a useEffect dep, so
  // the effect's own cleanup runs first -- no duplicate listener -- and it only changes on
  // an explicit call, so there is no loop.
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // Apply a pure outcome (domain/accountSubscription) to the three state setters. Keeps
  // the fail-closed decisions in one tested place; the hook only wires them to lifecycle.
  const apply = useCallback((outcome) => {
    setAccount(outcome.account);
    setError(outcome.error);
    setLoading(outcome.loading);
  }, []);

  useEffect(() => {
    if (!accountId) {
      apply(accountIdleOutcome());
      return;
    }

    // Obsolete-callback guard: a snapshot or error that arrives after this effect is torn
    // down (accountId changed, unmount, or a retry) must not write state belonging to a
    // subscription that no longer exists. onSnapshot's unsub stops callbacks synchronously,
    // so this is belt-and-braces -- but it closes the React-18 double-invoke / rapid-switch
    // window, matching useLocationsForAccount.
    let active = true;
    setLoading(true);
    setError(null);
    const unsub = onSnapshot(
      doc(db, ACCOUNTS_COLLECTION, accountId),
      (snap) => {
        if (!active) return;
        apply(accountSuccessOutcome(snap.exists() ? { id: snap.id, ...snap.data() } : null));
      },
      (err) => {
        if (!active) return;
        apply(accountFailureOutcome(err));
      }
    );

    return () => {
      active = false;
      unsub();
    };
  }, [accountId, attempt, apply]);

  return { account, loading, error, retry };
}
