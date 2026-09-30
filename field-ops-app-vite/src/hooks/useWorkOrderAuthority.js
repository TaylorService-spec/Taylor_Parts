import { useEffect, useState } from "react";
import {
  readWorkOrderAuthorityStatus,
  workOrderApiClient,
  WORK_ORDER_READINESS,
  WORK_ORDER_NOT_YET_ACTIVATED_MESSAGE,
} from "../services/workOrderApiClient.js";

// Is the governed Work Order authority switched on? (DQ-S4: readiness stays fail-closed.)
//
// Returns { readiness, notYetActivated, message, loading }. `readiness` is one of WORK_ORDER_READINESS:
// LOADING while asking, ACTIVE only on the server's explicit ACTIVE, NOT_YET_ACTIVATED on its explicit
// answer, UNAVAILABLE when the question itself could not be answered (never read as ACTIVE).
//
// One answer is shared for the page lifetime of a module instance (a short TTL), so ten Work Order
// surfaces on one screen ask once. Nothing here falls back to Firestore -- there is nothing to fall back to.
const TTL_MS = 60_000;
let cached = null; // { at, value }
let inflight = null;

export function __resetWorkOrderAuthorityCacheForTests() {
  cached = null;
  inflight = null;
}

export function loadWorkOrderAuthority(client = workOrderApiClient, now = Date.now()) {
  if (cached && now - cached.at < TTL_MS) return Promise.resolve(cached.value);
  if (!inflight) {
    inflight = readWorkOrderAuthorityStatus(client)
      .then((value) => {
        // An UNAVAILABLE answer is not cached: the next surface asks again.
        if (value.readiness !== WORK_ORDER_READINESS.UNAVAILABLE) cached = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function describeWorkOrderReadiness(readiness) {
  if (readiness === WORK_ORDER_READINESS.NOT_YET_ACTIVATED) return WORK_ORDER_NOT_YET_ACTIVATED_MESSAGE;
  if (readiness === WORK_ORDER_READINESS.UNAVAILABLE) return "The EOS Work Order service could not be reached. Nothing is shown in its place.";
  return null;
}

export function useWorkOrderAuthority({ client = workOrderApiClient } = {}) {
  const [readiness, setReadiness] = useState(
    cached ? cached.value.readiness : WORK_ORDER_READINESS.LOADING,
  );

  useEffect(() => {
    let active = true;
    loadWorkOrderAuthority(client).then((value) => {
      if (active) setReadiness(value.readiness);
    });
    return () => {
      active = false;
    };
  }, [client]);

  return {
    readiness,
    loading: readiness === WORK_ORDER_READINESS.LOADING,
    notYetActivated: readiness === WORK_ORDER_READINESS.NOT_YET_ACTIVATED,
    active: readiness === WORK_ORDER_READINESS.ACTIVE,
    message: describeWorkOrderReadiness(readiness),
  };
}
