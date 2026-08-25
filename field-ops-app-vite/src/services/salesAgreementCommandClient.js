// Sales Agreement -- transport over the three trusted, capability-gated WRITE callables and the two
// trusted READS (functions/src/salesAgreement/salesAgreementCallables.ts and
// salesAgreementReadService.ts). Structure mirrors services/salesOrderCommandClient.js exactly:
// firebase is imported LAZILY (no import-time initializeApp side effect), and this is the only
// place that invokes these callables.
//
// Never throws. Each method returns { result } on success or { errorStatus } on failure, where
// errorStatus is the callable's HttpsError `code` (functions/-prefix stripped), or "internal" when
// the failure carries no usable code. Turning that code into a human message belongs to the domain
// layer -- this file performs transport only.
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

const call = async (name, payload) => {
  try {
    return { result: await invoke(name, payload) };
  } catch (err) {
    return { errorStatus: mapErrorToStatus(err) };
  }
};

// idempotencyKey is REQUIRED and is carried through VERBATIM, never regenerated here: the caller
// owns generating it once per user intent and reusing it across a retry. A key minted inside this
// function would make every retry a fresh create.
//
// accountId is NOT sent, and this is the one thing to preserve if this file is ever refactored: the
// server derives the customer from the Opportunity, because that is the fact that decides who gets
// billed. The callable rejects the payload outright if it carries one.
export const createSalesAgreement = (payload) => call("createSalesAgreement", payload);
export const updateSalesAgreementDraft = (payload) => call("updateSalesAgreementDraft", payload);

// ACCEPT takes NO commercial input -- only which agreement, and the retry key. state, acceptedAt and
// acceptedBy are server-stamped, and sending them is refused rather than ignored.
export const acceptSalesAgreement = ({ salesAgreementId, idempotencyKey }) =>
  call("acceptSalesAgreement", { salesAgreementId, idempotencyKey });

export const getSalesAgreementContext = ({ salesAgreementId }) =>
  call("getSalesAgreementContext", { salesAgreementId });

// The entry point a salesperson actually uses: standing on an Opportunity, not knowing whether an
// agreement exists yet. A "not-found" result is a real answer, not an error.
export const getSalesAgreementForOpportunity = ({ opportunityId }) =>
  call("getSalesAgreementForOpportunity", { opportunityId });

// THE PRODUCT PICKER'S READ. One callable serves both the Part typeahead and the Equipment Model
// picker (functions/src/salesAgreement/productReferenceSearchService.ts), behind the existing
// inventory.catalog.read authority -- neither catalog is client-readable, and `parts` would be a
// whole-catalog download even if it were.
//
// `query` is ignored for EQUIPMENT_MODEL: that population is reference-data small and is listed
// whole (capped), so the surface can present a real select rather than making somebody guess a
// prefix of a canonical id they have never seen.
export const searchProductReferences = ({ kind, query, limit }) =>
  call("searchProductReferences", { kind, query, limit });
