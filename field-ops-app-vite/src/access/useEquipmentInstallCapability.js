// The React hook that integrates the trusted effective-access feed into Install gating. Structure
// mirrors access/useSalesOrderCapabilities.js EXACTLY -- the same two coordinated sources: a live
// users/{uid}.accessVersion subscription plus a re-fetch of resolveEffectiveAccessCallable keyed to
// the observed version. See equipmentInstallCapabilityAccess.js on why the pure primitives are
// shared rather than duplicated.
//
// Fail-closed by construction (buildHasCapability): denied while loading, on any error/unavailable/
// malformed result, when signed out, on a principal change, and while the version is changing -- so
// a revocation takes effect the instant accessVersion bumps, before the re-fetch even returns.
//
// WHAT THIS DOES NOT DO: decide anything. The install command re-checks equipment.install INSIDE its
// transaction, reading roleAssignments through that transaction so a concurrent revocation conflicts
// the commit. This hook decides what to RENDER, and rendering is not authority.
import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { doc, onSnapshot } from "firebase/firestore";
import { functions, db } from "../firebase/firebase";
import { USERS_COLLECTION } from "../domain/constants";
import {
  EQUIPMENT_INSTALL_CAPABILITY,
  EQUIPMENT_INSTALL_CAPABILITY_REQUEST,
  VERSION_STATUS, FEED_STATUS,
  SIGNED_OUT_VERSION, IDLE_FEED, isValidObservedVersion, interpretAccessResult, buildHasCapability,
} from "./equipmentInstallCapabilityAccess.js";

const RESOLVE_EFFECTIVE_ACCESS_CALLABLE = "resolveEffectiveAccessCallable";

// Default firebase-backed seams; `deps` lets a test/harness inject fakes. Production always uses these
// real ones -- the callable being reachable (or not) is what determines whether writes are truly live.
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

export function useEquipmentInstallCapability(user, deps = {}) {
  const uid = user?.uid ?? null;
  const subscribeAccessVersion = deps.subscribeAccessVersion ?? defaultSubscribeAccessVersion;
  const callFeed = deps.callFeed ?? defaultCallFeed;

  const [version, setVersion] = useState(SIGNED_OUT_VERSION);
  const [feed, setFeed] = useState(IDLE_FEED);

  useEffect(() => {
    if (!uid) { setVersion(SIGNED_OUT_VERSION); return undefined; }
    setVersion({ status: VERSION_STATUS.LOADING, uid, version: null });
    const unsubscribe = subscribeAccessVersion(uid, {
      next: (rawVersion) => {
        setVersion(isValidObservedVersion(rawVersion)
          ? { status: VERSION_STATUS.READY, uid, version: rawVersion }
          : { status: VERSION_STATUS.ERROR, uid, version: null });
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
      .then(() => callFeed(EQUIPMENT_INSTALL_CAPABILITY_REQUEST))
      .then((res) => {
        if (cancelled) return;
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
  const accessVersion = version.status === VERSION_STATUS.READY ? version.version : null;
  // canInstall is the ONE question this surface asks, resolved through the shared fail-closed
  // builder rather than by reading decisions directly -- reading them directly is how a surface
  // ends up treating "not yet loaded" as "allowed".
  return {
    canInstall: hasCapability(EQUIPMENT_INSTALL_CAPABILITY),
    hasCapability,
    accessVersion,
    versionStatus: version.status,
    feedStatus: feed.status,
  };
}
