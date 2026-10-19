// PERFORMANCE GOALS -- transport over the trusted read callables
// (functions/src/performance/performanceGoalCallables.ts). Structure mirrors
// accountOpportunitiesReadCallableClient.js: firebase imported LAZILY (no import-time
// initializeApp side effect), and this is the only place these callables are invoked.
//
// NO CLIENT-SIDE READINESS FLAG. `performance.goal.read` authorization, its per-environment
// activation, and the four scope/visibility factors are ALL enforced server-side -- the callable
// answers permission-denied when unauthorized. Attempting the call and mapping what comes back is
// the same governed-read pattern every other read client here uses, and it is the honest one: a
// client-side guess about authority would be a second opinion, and the wrong one the moment a grant
// changes.
//
// THE TRANSPORT MOVES TARGETS, NEVER ACTUALS. Pairing a target with a measurement is the dashboard's
// job, done against each domain's own read -- see domain/goalProgress.js.

import { EOS_SESSION_SOURCE } from "../access/eosSessionSource.js";
import { createPerformanceGoalClient } from "./eosRecordsClients.js";

function mapErrorToStatus(err) {
  const raw = err && typeof err.code === "string" ? err.code : "";
  const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
  return code === "permission-denied" ? "denied" : "unavailable";
}

async function invoke(name, payload) {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import("firebase/functions"),
    import("../firebase/firebase.js"),
  ]);
  const res = await httpsCallable(functions, name)(payload);
  return res?.data;
}

/**
 * Current approved targets for a bounded, explicitly named set of (metric, scope) pairs.
 *
 * `onDate` is supplied by the CALLER, not defaulted here: the goal authority owns no clock, and a
 * transport that quietly picked "today" would be choosing a reporting date on the platform's behalf
 * in a system that has deliberately not decided what a reporting date is.
 *
 * Returns { result } (the callable's { results, onDate } envelope, passed through verbatim) or
 * { errorStatus } -- never throws. An empty target list short-circuits without a round trip.
 */
async function firebaseFetchCurrentPerformanceGoals(targets, onDate) {
  if (!Array.isArray(targets) || targets.length === 0) {
    return { result: { results: [], onDate } };
  }
  try {
    return { result: await invoke("listCurrentPerformanceGoals", { targets, onDate }) };
  } catch (err) {
    return { errorStatus: mapErrorToStatus(err) };
  }
}

/** Every version for ONE target, oldest first -- the management history view. */
async function firebaseFetchPerformanceGoalVersions(target) {
  try {
    return { result: await invoke("listPerformanceGoalVersions", { target }) };
  } catch (err) {
    return { errorStatus: mapErrorToStatus(err) };
  }
}

/**
 * The employees this principal may author goals FOR -- the subject picker's contents.
 *
 * OFFERED == ACCEPTED: the server returns the SAME visibility set the write commands enforce, so a
 * picker cannot offer a person the command would then refuse.
 */
async function firebaseFetchGoalSubjects() {
  try {
    return { result: await invoke("listGoalSubjects", {}) };
  } catch (err) {
    return { errorStatus: mapErrorToStatus(err) };
  }
}

// FIREBASE EXIT B4 (DECISIONS #B4; F7d): WHICH SOURCE ANSWERS is decided once at BUILD time by the F1 flag. Where an EOS API is declared the three reads go to the Operations
// transport (listCurrentPerformanceGoals / listPerformanceGoalVersions / listGoalSubjects: performance.goal.read, the four factors translated to EOS reach, and the caller's
// operating companies) and the Firebase callables above are never invoked -- not as a fallback, not on failure. The shapes are identical, so no screen changes.
const eosGoals = EOS_SESSION_SOURCE ? createPerformanceGoalClient() : null;
export const fetchCurrentPerformanceGoals = eosGoals ? eosGoals.fetchCurrentPerformanceGoals : firebaseFetchCurrentPerformanceGoals;
export const fetchPerformanceGoalVersions = eosGoals ? eosGoals.fetchPerformanceGoalVersions : firebaseFetchPerformanceGoalVersions;
export const fetchGoalSubjects = eosGoals ? eosGoals.fetchGoalSubjects : firebaseFetchGoalSubjects;
