// The GENERIC governed-capability hook: observe users/{uid}.accessVersion, re-resolve a requested
// capability set through the trusted effective-access feed keyed to the observed version, and answer
// fail-closed until both agree.
//
// WHY THIS EXISTS RATHER THAN A FIFTH COPY. access/useReportCapabilities.js, useOpportunityCapabilities.js,
// useSalesOrderCapabilities.js and useEquipmentInstallCapability.js are the same forty lines of wiring with
// a different constant list; each says in its own header that no shared hook factory exists yet. Adding a
// fifth copy for Inbound Work would make the case worse. The already-shared, capability-id-agnostic
// primitives live in reportCapabilityAccess.js -- this file adds only the parameterised wiring, and takes
// the request list as an argument.
//
// The four existing hooks are deliberately NOT migrated here: that is a refactor of four live surfaces,
// unrelated to this feature, and it belongs in its own change. This is the target shape when it happens.
import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { doc, onSnapshot } from "firebase/firestore";
import { functions, db } from "../firebase/firebase";
import { USERS_COLLECTION } from "../domain/constants";
import {
  VERSION_STATUS,
  FEED_STATUS,
  SIGNED_OUT_VERSION,
  IDLE_FEED,
  isValidObservedVersion,
  interpretAccessResult,
  buildHasCapability,
} from "./reportCapabilityAccess.js";

const RESOLVE_EFFECTIVE_ACCESS_CALLABLE = "resolveEffectiveAccessCallable";

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

/**
 * @param user            the signed-in user (or null).
 * @param permissionIds   the capability ids to resolve, in ONE request so every control on a screen is
 *                        decided under a single accessVersion.
 * @param deps            injection seam for tests: { subscribeAccessVersion, callFeed }.
 */
export function useGovernedCapabilities(user, permissionIds, deps = {}) {
  const uid = user?.uid ?? null;
  const subscribeAccessVersion = deps.subscribeAccessVersion ?? defaultSubscribeAccessVersion;
  const callFeed = deps.callFeed ?? defaultCallFeed;
  // Stable across renders even when the caller passes a fresh array literal, so the feed effect below
  // cannot re-fire forever on an unmemoised prop.
  const requestKey = Array.isArray(permissionIds) ? permissionIds.join("|") : "";

  const [version, setVersion] = useState(SIGNED_OUT_VERSION);
  const [feed, setFeed] = useState(IDLE_FEED);

  useEffect(() => {
    if (!uid) {
      setVersion(SIGNED_OUT_VERSION);
      return undefined;
    }
    setVersion({ status: VERSION_STATUS.LOADING, uid, version: null });
    const unsubscribe = subscribeAccessVersion(uid, {
      next: (rawVersion) => {
        setVersion(
          isValidObservedVersion(rawVersion)
            ? { status: VERSION_STATUS.READY, uid, version: rawVersion }
            : { status: VERSION_STATUS.ERROR, uid, version: null },
        );
      },
      error: () => setVersion({ status: VERSION_STATUS.ERROR, uid, version: null }),
    });
    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, [uid, subscribeAccessVersion]);

  useEffect(() => {
    if (version.status !== VERSION_STATUS.READY || version.uid !== uid || !isValidObservedVersion(version.version)) {
      setFeed(IDLE_FEED);
      return undefined;
    }
    const targetVersion = version.version;
    let cancelled = false;
    setFeed({ status: FEED_STATUS.LOADING, forUid: uid, forVersion: targetVersion, decisions: null });

    Promise.resolve()
      .then(() => callFeed(requestKey ? requestKey.split("|") : []))
      .then((res) => {
        if (cancelled) return;
        const interpreted = interpretAccessResult(res?.data);
        setFeed(
          interpreted.ok
            ? { status: FEED_STATUS.READY, forUid: uid, forVersion: interpreted.accessVersion, decisions: interpreted.decisions }
            : { status: FEED_STATUS.ERROR, forUid: uid, forVersion: targetVersion, decisions: null },
        );
      })
      .catch(() => {
        if (cancelled) return;
        setFeed({ status: FEED_STATUS.ERROR, forUid: uid, forVersion: targetVersion, decisions: null });
      });

    return () => {
      cancelled = true;
    };
  }, [uid, version.status, version.uid, version.version, requestKey, callFeed]);

  return {
    hasCapability: buildHasCapability({ version, feed }, uid),
    accessVersion: version.status === VERSION_STATUS.READY ? version.version : null,
    versionStatus: version.status,
    feedStatus: feed.status,
  };
}

export default useGovernedCapabilities;
