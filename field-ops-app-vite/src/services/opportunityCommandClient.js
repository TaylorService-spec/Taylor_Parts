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

// The DOMAIN code the callable put in `details` (opportunityCallables.ts's mapCommandError).
// There are more distinct governed outcomes than HttpsError codes, so without this a version
// conflict and a malformed payload are indistinguishable to the caller. Only ever a string;
// anything else is treated as absent rather than passed along as a message.
function mapErrorDetail(err) {
  return typeof err?.details === "string" && err.details.length > 0 ? err.details : null;
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
    return { errorStatus: mapErrorToStatus(err), errorDetail: mapErrorDetail(err) };
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
    return { errorStatus: mapErrorToStatus(err), errorDetail: mapErrorDetail(err) };
  }
}

// CLOSING AS WON IS ITS OWN COMMAND, not a transition.
//
// transitionOpportunity CAN set outcome WON -- and doing so from here would be a defect, not
// a shortcut. A WON Opportunity must have exactly one Sales Order, and the transition
// callable creates none. Routing a Won through it produces precisely the split-brain
// closeOpportunityAsWon exists to prevent: an Opportunity that is WON, terminal, and has no
// order, recoverable only by a second call nobody makes when the first one appeared to work.
//
// So Won goes through the atomic command, which does both halves in ONE transaction. The
// client cannot assemble that guarantee out of two calls, and must not try.
//
// ownerEmployeeId and salesChannel are REQUIRED by the callable: the Sales Order needs its
// own owner and channel, and the server derives account and lines from the Opportunity
// rather than trusting the payload for them.
export async function closeOpportunityAsWon({
  opportunityId,
  ownerEmployeeId,
  salesChannel,
  locationId,
  customerPO,
  idempotencyKey,
}) {
  try {
    const result = await invoke("closeOpportunityAsWon", {
      opportunityId,
      ownerEmployeeId,
      salesChannel,
      idempotencyKey,
      ...(locationId !== undefined ? { locationId } : {}),
      ...(customerPO !== undefined ? { customerPO } : {}),
    });
    return { result };
  } catch (err) {
    return { errorStatus: mapErrorToStatus(err), errorDetail: mapErrorDetail(err) };
  }
}

// ORDINARY EDIT. Lifecycle fields are absent from this payload by construction -- the server
// never reads stage or outcome from an update, so sending them changes nothing, and this
// adapter does not offer them either.
//
// expectedUpdatedAtMillis is the optimistic-concurrency token the caller LOADED. It is
// required, and deliberately not defaulted here: a client that cannot say which version it
// edited has no business overwriting one.
//
// Fields are forwarded only when PRESENT. Absent and explicit-null mean different things all
// the way to the command core -- absent leaves a value alone, null clears it -- and
// collapsing them here would make clearing a field impossible to express.
export async function updateOpportunity({
  opportunityId,
  expectedUpdatedAtMillis,
  idempotencyKey,
  accountId,
  ownerEmployeeId,
  salesChannel,
  need,
  expectedValue,
  expectedCloseAt,
  nextAction,
  lines,
}) {
  try {
    const result = await invoke("updateOpportunity", {
      opportunityId,
      expectedUpdatedAtMillis,
      idempotencyKey,
      ...(accountId !== undefined ? { accountId } : {}),
      ...(ownerEmployeeId !== undefined ? { ownerEmployeeId } : {}),
      ...(salesChannel !== undefined ? { salesChannel } : {}),
      ...(need !== undefined ? { need } : {}),
      ...(expectedValue !== undefined ? { expectedValue } : {}),
      ...(expectedCloseAt !== undefined ? { expectedCloseAt } : {}),
      ...(nextAction !== undefined ? { nextAction } : {}),
      ...(lines !== undefined ? { lines } : {}),
    });
    return { result };
  } catch (err) {
    return { errorStatus: mapErrorToStatus(err), errorDetail: mapErrorDetail(err) };
  }
}

export const opportunityCommandClient = Object.freeze({
  createOpportunity,
  transitionOpportunity,
  closeOpportunityAsWon,
  updateOpportunity,
});
