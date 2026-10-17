// The caller's OWN EOS capability set, read as a ONE-SHOT and refetched on events -- never a subscription, never polled.
// Firebase exit F1 (DECISIONS #244). Replaces, where an EOS API is declared, the Firestore users/{uid}.accessVersion
// onSnapshot + resolveEffectiveAccessCallable pair of access/useReportCapabilities.js.
//
//   browser -> resolveMyCapabilities (services/operationsApiClient.js) -> POST /operations/inventory
//           -> the caller's resolved EOS Principal, ACTIVE membership, Roles and eos_policy.role_capabilities
//
// WHEN IT READS. On sign-in / principal change; when the window regains focus or the tab becomes visible; on a route
// change (EosAccessRouteRefresh in App.jsx); and after a governed role change (notifyEosAccessChanged). Focus and route
// refreshes are throttled so a burst of navigation is one request, not one per click; a role change is never throttled.
// There is no timer that re-reads on its own.
//
// FAIL CLOSED, AND SETTLED. Nothing is held while the first read is in flight, when it is refused or fails, when the
// answer is malformed, when no one is signed in, or while a previous principal's answer is still the one held. A read
// that does not answer within READ_TIMEOUT_MS is a FAILED read: a settled deny, never an infinite "Loading...". A
// refetch keeps the previous answer on screen until the new one lands (no flicker); a refetch that fails denies.
//
// `version` is an integer the shell can key lists on. EOS has no access counter and no push channel, so it is
// synthesised: it advances only when the fetched capability SET differs from the one held, so a focus refresh that
// changes nothing re-keys nothing.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { operationsApiClient } from "../services/operationsApiClient.js";
import { EOS_ACCESS_CHANGED_EVENT, notifyEosAccessChanged } from "./eosAccessEvents.js";
import {
  MY_CAPABILITIES_OPERATION,
  capabilitySignature,
  eosCapabilitiesFrom,
  eosKeyForFirebaseId,
} from "./eosCapabilityAccess.js";

export { EOS_ACCESS_CHANGED_EVENT, notifyEosAccessChanged };

export const EOS_CAPABILITY_STATE = Object.freeze({ LOADING: "loading", READY: "ready", FAILED: "failed" });
export const READ_TIMEOUT_MS = 10000;
export const REFRESH_THROTTLE_MS = 5000;

const FAILED_READ = Object.freeze({ ok: false, code: "UNREACHABLE" });

// One read, bounded. The abort cancels a real fetch; the race settles the read even if a client ignores the signal -- so a
// slow service is a FAILED read (a settled deny), never an infinite "Loading...".
async function readCapabilities(client, timeoutMs) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer = null;
  const expired = new Promise((resolve) => {
    timer = setTimeout(() => {
      if (controller) controller.abort();
      resolve(FAILED_READ);
    }, timeoutMs);
  });
  try {
    return await Promise.race([client.call(MY_CAPABILITIES_OPERATION, controller ? { signal: controller.signal } : {}), expired]);
  } catch {
    return FAILED_READ;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param user                the signed-in user (or null). Its uid keys the read; it is never sent -- the server
 *                            resolves the caller from the bearer token.
 * @param options.client      the Operations client seam ({ call })
 * @param options.enabled     false = make no request and hold nothing
 * @returns { status, held, version, hasEosKey(key), hasCapability(firebaseId), reload(), reloadNow() }
 */
export function useEosCapabilityFeed(user, {
  client = operationsApiClient,
  enabled = true,
  timeoutMs = READ_TIMEOUT_MS,
  throttleMs = REFRESH_THROTTLE_MS,
} = {}) {
  const principalKey = enabled && user?.uid ? user.uid : null;
  const [state, setState] = useState({ key: null, status: EOS_CAPABILITY_STATE.LOADING, held: null, version: 0 });
  // The client is an INJECTION SEAM, not reactive state: a caller passing a fresh object each render must not re-read in a loop.
  const clientRef = useRef(client);
  clientRef.current = client;
  const generation = useRef(0);
  const lastStartedAt = useRef(0);
  const signature = useRef({ key: null, value: null, version: 0 });

  const fetchNow = useCallback(() => {
    if (principalKey === null) return;
    generation.current += 1;
    const mine = generation.current;
    lastStartedAt.current = Date.now();
    readCapabilities(clientRef.current, timeoutMs).then((outcome) => {
      if (mine !== generation.current) return; // superseded by a newer read or a principal change
      const held = outcome?.ok === true ? eosCapabilitiesFrom(outcome.result) : null;
      if (held === null) {
        setState({ key: principalKey, status: EOS_CAPABILITY_STATE.FAILED, held: null, version: signature.current.version });
        return;
      }
      const next = capabilitySignature(held);
      const prior = signature.current;
      const version = prior.key === principalKey && prior.value === next ? prior.version : (prior.key === principalKey ? prior.version + 1 : 0);
      signature.current = { key: principalKey, value: next, version };
      setState({ key: principalKey, status: EOS_CAPABILITY_STATE.READY, held, version });
    });
  }, [principalKey, timeoutMs]);

  // Principal change / sign-in: forget the previous answer, read afresh.
  useEffect(() => {
    generation.current += 1; // discard any read still in flight for the previous principal
    signature.current = { key: null, value: null, version: 0 };
    if (principalKey === null) {
      setState({ key: null, status: EOS_CAPABILITY_STATE.FAILED, held: null, version: 0 });
      return undefined;
    }
    setState({ key: principalKey, status: EOS_CAPABILITY_STATE.LOADING, held: null, version: 0 });
    fetchNow();
    return () => {
      generation.current += 1; // unmount: a late answer must not set state
    };
  }, [principalKey, fetchNow]);

  const reloadNow = fetchNow;
  const reload = useCallback(() => {
    if (Date.now() - lastStartedAt.current >= throttleMs) fetchNow();
  }, [fetchNow, throttleMs]);

  // Focus / visibility / governed role change. No timer.
  useEffect(() => {
    if (principalKey === null || typeof window === "undefined") return undefined;
    const onFocus = () => reload();
    const onVisible = () => { if (typeof document === "undefined" || document.visibilityState === "visible") reload(); };
    const onChanged = () => reloadNow();
    window.addEventListener("focus", onFocus);
    window.addEventListener(EOS_ACCESS_CHANGED_EVENT, onChanged);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(EOS_ACCESS_CHANGED_EVENT, onChanged);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    };
  }, [principalKey, reload, reloadNow]);

  // Each answer is stamped with the principal it was asked for: a previous principal's grant never renders.
  const current = principalKey !== null && state.key === principalKey;
  const status = principalKey === null ? EOS_CAPABILITY_STATE.FAILED : current ? state.status : EOS_CAPABILITY_STATE.LOADING;
  const held = current && status === EOS_CAPABILITY_STATE.READY ? state.held : null;
  const version = current ? state.version : 0;

  const hasEosKey = useCallback((key) => held !== null && held.has(key), [held]);
  const hasCapability = useCallback((firebaseId) => held !== null && held.has(eosKeyForFirebaseId(firebaseId)), [held]);
  return useMemo(
    () => ({ status, held, version, hasEosKey, hasCapability, reload, reloadNow }),
    [status, held, version, hasEosKey, hasCapability, reload, reloadNow],
  );
}

/**
 * The shape access/useReportCapabilities.js returns, answered from EOS. `accessResolving` is true ONLY while the first
 * read is in flight for a signed-in principal; every later state (ready, failed, signed out) is a settled answer.
 */
export function useEosReportCapabilities(user, deps = {}) {
  const feed = useEosCapabilityFeed(user, deps);
  const signedIn = Boolean(user?.uid);
  const ready = feed.status === EOS_CAPABILITY_STATE.READY;
  return useMemo(() => ({
    hasCapability: feed.hasCapability,
    // The raw EOS key lookup, for the gates that are not Firebase ids (access/sessionAccess.js).
    hasEosKey: feed.hasEosKey,
    accessVersion: ready ? feed.version : null,
    accessResolving: signedIn && feed.status === EOS_CAPABILITY_STATE.LOADING,
    versionStatus: ready ? "ready" : feed.status,
    feedStatus: feed.status,
    reload: feed.reload,
  }), [feed, ready, signedIn]);
}
