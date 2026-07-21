// Issue #325 / ADR-007 -- the React hook that integrates the trusted effective-access feed into
// client capability gating, hardened for LIVE grant/revocation without logout.
//
// Two coordinated sources:
//   1. A live subscription to users/{uid}.accessVersion (self-read, already permitted by Rules).
//      Only a finite, non-negative integer is accepted; missing/malformed/subscription-failure -> deny.
//   2. The resolveEffectiveAccess callable, re-fetched whenever the observed version changes. The
//      feed returns the accessVersion it resolved against; we STORE it and grant only when it
//      exactly matches the current observed version.
//
// Fail-closed by construction (buildHasCapability): denied while loading, on any error/unavailable/
// malformed result, when signed out, on a principal change, and while the version is CHANGING (the
// stored decisions' version no longer matches the observed one) -- so a revocation takes effect the
// instant accessVersion bumps, before the re-fetch even returns; a grant takes effect as soon as the
// re-fetch returns a matching version. Because the callable is UNDEPLOYED, a production fetch
// rejects -> error -> denied: production stays fail-closed until a separate deployment + Owner auth.
//
// Stale/out-of-order guarded: each fetch is keyed to (uid, observed version) and a `cancelled` flag
// discards a late response from a superseded principal/version; the version-match in the gate is the
// belt to that suspenders. Governed access is derived ONLY from the callable's decisions -- this
// hook never reads users/{uid}.role, Role names, or client Role definitions.
import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { doc, onSnapshot } from "firebase/firestore";
import { functions, db } from "../firebase/firebase";
import { USERS_COLLECTION } from "../domain/constants";
import {
  REPORT_CAPABILITY_REQUEST, VERSION_STATUS, FEED_STATUS,
  SIGNED_OUT_VERSION, IDLE_FEED, isValidObservedVersion, interpretAccessResult, buildHasCapability,
} from "./reportCapabilityAccess.js";

const RESOLVE_EFFECTIVE_ACCESS_CALLABLE = "resolveEffectiveAccessCallable";

// Default firebase-backed seams; `deps` lets a test/harness inject fakes (a fake subscription and a
// fake callable). Production always uses these real ones -- the callable, being undeployed, is what
// keeps production fail-closed.
function defaultSubscribeAccessVersion(uid, handlers) {
  return onSnapshot(
    doc(db, USERS_COLLECTION, uid),
    (snap) => handlers.next(snap.exists() ? snap.get("accessVersion") : undefined),
    () => handlers.error(),
  );
}
function defaultCallFeed(permissionIds) {
  return httpsCallable(functions, RESOLVE_EFFECTIVE_ACCESS_CALLABLE)({ permissionIds });
}

export function useReportCapabilities(user, deps = {}) {
  const uid = user?.uid ?? null;
  const subscribeAccessVersion = deps.subscribeAccessVersion ?? defaultSubscribeAccessVersion;
  const callFeed = deps.callFeed ?? defaultCallFeed;

  const [version, setVersion] = useState(SIGNED_OUT_VERSION);
  const [feed, setFeed] = useState(IDLE_FEED);

  // 1. Observe users/{uid}.accessVersion. Reset immediately on logout / account change.
  useEffect(() => {
    if (!uid) { setVersion(SIGNED_OUT_VERSION); return undefined; }
    setVersion({ status: VERSION_STATUS.LOADING, uid, version: null });
    const unsubscribe = subscribeAccessVersion(uid, {
      next: (rawVersion) => {
        setVersion(isValidObservedVersion(rawVersion)
          ? { status: VERSION_STATUS.READY, uid, version: rawVersion }
          : { status: VERSION_STATUS.ERROR, uid, version: null }); // missing / malformed / negative / fractional
      },
      error: () => setVersion({ status: VERSION_STATUS.ERROR, uid, version: null }), // subscription failure
    });
    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, [uid, subscribeAccessVersion]);

  // 2. Re-fetch effective-access decisions whenever a VALID observed version for the current
  //    principal changes. Any non-ready/mismatched version clears the feed (deny).
  useEffect(() => {
    if (version.status !== VERSION_STATUS.READY || version.uid !== uid || !isValidObservedVersion(version.version)) {
      setFeed(IDLE_FEED);
      return undefined;
    }
    const targetVersion = version.version;
    let cancelled = false;
    setFeed({ status: FEED_STATUS.LOADING, forUid: uid, forVersion: targetVersion, decisions: null });

    Promise.resolve()
      .then(() => callFeed(REPORT_CAPABILITY_REQUEST))
      .then((res) => {
        if (cancelled) return; // superseded by a newer version/principal -> discard this late response
        const interpreted = interpretAccessResult(res?.data);
        setFeed(interpreted.ok
          ? { status: FEED_STATUS.READY, forUid: uid, forVersion: interpreted.accessVersion, decisions: interpreted.decisions }
          : { status: FEED_STATUS.ERROR, forUid: uid, forVersion: targetVersion, decisions: null });
      })
      .catch(() => {
        if (cancelled) return;
        setFeed({ status: FEED_STATUS.ERROR, forUid: uid, forVersion: targetVersion, decisions: null });
      });

    return () => { cancelled = true; };
  }, [uid, version.status, version.uid, version.version, callFeed]);

  const hasCapability = buildHasCapability({ version, feed }, uid);
  // `accessVersion` is the current observed version (null unless ready); a consumer keys on it to
  // re-fetch its own data on every access change (freshness), e.g. Saved Reports re-lists.
  const accessVersion = version.status === VERSION_STATUS.READY ? version.version : null;
  return { hasCapability, accessVersion, versionStatus: version.status, feedStatus: feed.status };
}
