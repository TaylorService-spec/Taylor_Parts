// Sales Opportunity — transport over the two trusted, capability-gated WRITE callables
// (functions/src/opportunity/opportunityCallables.ts's createOpportunity, transitionOpportunity). Structure
// mirrors services/salesOrderCommandClient.js exactly: firebase is imported LAZILY (no import-time
// initializeApp side effect), and this is the only place that invokes these callables.
//
// opportunity.write is already sandbox-activated (config/environments.json's
// capabilityActivationOverrides) and granted to admin/dispatcher (owner inherits) in
// compatibilityRoles.ts — like salesOrderCommandClient.js, there is no "not deployed" client-side
// posture carried here; a persona's authorization is resolved fail-closed server-side
// (resolveEffectiveAccess) on every call, and this client just attempts the call and maps whatever
// comes back.
//
// Never throws. Each method returns { result } on success or { errorStatus } on failure, where
// errorStatus is the callable's HttpsError `code` (functions/-prefix stripped), or "internal" when the
// failure carries no usable code. domain/opportunityCommandOutcome.js owns turning that code into a
// safe, human message — this file performs transport only.
function mapErrorToStatus(err) {
  const raw = err && typeof err.code === "string" ? err.code : "";
  const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
  return code || "internal";
}

async function invoke(name, payload) {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import("firebase/functions"),
    import("../firebase/firebase.js"),
  ]);
  const res = await httpsCallable(functions, name)(payload);
  return res?.data;
}

// idempotencyKey is OPTIONAL on createOpportunity but carried through VERBATIM (never regenerated here)
// when the caller supplies one — hooks/useOpportunityCreate.js owns generating it once per user intent
// and reusing it across a retry of the same intent.
export async function createOpportunity(input) {
  try {
    const result = await invoke("createOpportunity", input);
    return { result };
  } catch (err) {
    return { errorStatus: mapErrorToStatus(err) };
  }
}

// idempotencyKey is REQUIRED by transitionOpportunity and, likewise, carried through verbatim —
// hooks/useOpportunityTransitions.js owns generating/scoping it.
export async function transitionOpportunity({ opportunityId, toStage, outcome, idempotencyKey }) {
  try {
    const payload = {
      opportunityId,
      idempotencyKey,
      ...(toStage !== undefined ? { toStage } : {}),
      ...(outcome !== undefined ? { outcome } : {}),
    };
    const result = await invoke("transitionOpportunity", payload);
    return { result };
  } catch (err) {
    return { errorStatus: mapErrorToStatus(err) };
  }
}

export const opportunityCommandClient = Object.freeze({
  createOpportunity,
  transitionOpportunity,
});
