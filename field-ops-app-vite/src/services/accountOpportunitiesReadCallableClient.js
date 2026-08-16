// Opportunity — transport over the trusted `listOpportunitiesForAccount` callable
// (functions/src/opportunity/opportunityReadService.ts). Wave 7 completion PART 2 -- account-scoped
// sibling of services/salesOrderReadCallableClient.js: firebase is imported LAZILY (no import-time
// initializeApp side effect), and this is the only place that invokes this callable.
//
// READ, no client-side readiness flag -- `opportunity.read` authorization and its per-environment
// activation are both enforced server-side (the callable throws permission-denied when unauthorized);
// attempting the call and mapping whatever comes back is the same governed-read pattern every other
// read client in this codebase uses.
function mapErrorToStatus(err) {
  const raw = err && typeof err.code === "string" ? err.code : "";
  const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
  return code === "permission-denied" ? "denied" : "unavailable";
}

async function invoke(payload) {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import("firebase/functions"),
    import("../firebase/firebase.js"),
  ]);
  const res = await httpsCallable(functions, "listOpportunitiesForAccount")(payload);
  return res?.data;
}

// Fetch the Opportunities scoped to one Account. Returns { result } on success (the callable's own
// {status, opportunities, skipped, truncated} envelope, passed through verbatim for
// domain/accountOpportunitiesView.js to interpret) or { errorStatus } on failure ("denied" |
// "unavailable") -- never throws.
export async function fetchAccountOpportunities(accountId, { limit } = {}) {
  try {
    const result = await invoke({ accountId, ...(limit ? { limit } : {}) });
    return { result };
  } catch (err) {
    return { errorStatus: mapErrorToStatus(err) };
  }
}
