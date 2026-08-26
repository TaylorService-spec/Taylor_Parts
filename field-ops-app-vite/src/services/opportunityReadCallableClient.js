// Opportunity — transport over the trusted `getOpportunityContext` callable
// (functions/src/opportunity/opportunityReadService.ts). Structure mirrors
// services/salesOrderReadCallableClient.js exactly: firebase is imported LAZILY (no import-time
// initializeApp side effect), and this is the only place that invokes the callable.
//
// READ, with no client-side readiness flag -- `opportunity.read` authorization and its
// per-environment activation are both enforced server-side (the callable throws permission-denied
// when unauthorized). Attempting the call and mapping whatever comes back is the same governed-read
// pattern every other read client in this codebase uses; a client-side pre-check would be a second,
// weaker copy of an authority that already exists.
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
  const res = await httpsCallable(functions, "getOpportunityContext")(payload);
  return res?.data;
}

// Fetch one Opportunity by id. Returns { result } on success (the callable's own
// {status, opportunity, accountName, salesOrderNumber} envelope, "ready" or "not-found", passed
// through VERBATIM for domain/opportunityView.js to interpret) or { errorStatus } on failure
// ("denied" | "unavailable") -- never throws.
//
// The envelope is not reshaped here on purpose. A transport that interprets is a second place the
// meaning of "not-found" can drift from the one the view model holds.
export async function fetchOpportunityContext(opportunityId) {
  try {
    const result = await invoke({ opportunityId });
    return { result };
  } catch (err) {
    return { errorStatus: mapErrorToStatus(err) };
  }
}
