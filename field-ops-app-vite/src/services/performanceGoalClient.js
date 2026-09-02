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
export async function fetchCurrentPerformanceGoals(targets, onDate) {
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
export async function fetchPerformanceGoalVersions(target) {
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
export async function fetchGoalSubjects() {
  try {
    return { result: await invoke("listGoalSubjects", {}) };
  } catch (err) {
    return { errorStatus: mapErrorToStatus(err) };
  }
}
