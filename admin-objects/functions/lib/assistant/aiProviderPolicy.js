"use strict";
// PROVIDER POLICY. Which provider may see this request, decided before the request is sent.
//
// ============================ THE DESIGN THIS REFUSES ============================
//
//   try the private model; if it fails, send it to OpenAI
//
// That is a data-governance decision made by an outage. It routes exactly the traffic an operator
// was most careful about -- the private-only traffic -- to an external vendor at the precise moment
// nobody is watching, and it leaves no trace that a boundary was crossed, because from the caller's
// side it simply worked. Availability is not consent.
//
// So the rule here is structural rather than advisory: THE SELECTION FUNCTION CANNOT SEE FAILURES.
// `selectAiProvider` is synchronous and pure, takes configuration and the request's data class, and
// has no parameter through which a provider error, a health check or an attempt count could arrive.
// A caller physically cannot re-run it "now that the private one is down" and get a different
// answer, because down is not an input.
//
// There is deliberately NO function in this module that takes a list of providers and tries them in
// order. That absence is the feature, and it is asserted by test.
//
// ============================ WHAT A PRIVATE OUTAGE PRODUCES ============================
//
// A governed unavailable outcome. The assistant says it is unavailable, EOS keeps working, and the
// data stays where the policy said it stays. That is the correct behaviour, not a degraded one.
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRIVATE_PROVIDER_UNAVAILABLE_MESSAGE = exports.PROVIDER_PRIVACY_CLASS = void 0;
exports.selectAiProvider = selectAiProvider;
exports.externalDisclosureIsPossible = externalDisclosureIsPossible;
exports.PROVIDER_PRIVACY_CLASS = Object.freeze({
    selfHosted: "PRIVATE",
    openai: "EXTERNAL",
    anthropic: "EXTERNAL",
});
function firstPrivate(available) {
    return available.find((id) => exports.PROVIDER_PRIVACY_CLASS[id] === "PRIVATE") ?? null;
}
function chooseExternal(config) {
    const external = config.availableProviders.filter((id) => exports.PROVIDER_PRIVACY_CLASS[id] === "EXTERNAL");
    if (external.length === 0)
        return null;
    const preferred = config.preferredExternalProvider;
    if (preferred && external.includes(preferred))
        return preferred;
    return external[0];
}
/**
 * Choose the one provider this request may use.
 *
 * Synchronous, pure, and failure-blind by construction. Call it once, before anything is sent; do
 * not call it again after an error.
 */
function selectAiProvider(config, request) {
    if (config.availableProviders.length === 0) {
        return { outcome: "UNAVAILABLE", reason: "NO_PROVIDER_CONFIGURED" };
    }
    const priv = firstPrivate(config.availableProviders);
    if (config.policy === "PRIVATE_ONLY") {
        if (priv)
            return { outcome: "SELECTED", providerId: priv, privacyClass: "PRIVATE", reason: "PRIVATE_PROVIDER_SELECTED" };
        // The one branch the whole module exists for. There is no external option below this line.
        return { outcome: "UNAVAILABLE", reason: "PRIVATE_PROVIDER_UNAVAILABLE" };
    }
    if (config.policy === "PRIVATE_PREFERRED") {
        if (priv)
            return { outcome: "SELECTED", providerId: priv, privacyClass: "PRIVATE", reason: "PRIVATE_PROVIDER_SELECTED" };
        // Private is not available. That fact does NOT create permission -- it only means we now check
        // whether this data class was ALREADY permitted to go external, which is a decision an operator
        // wrote down in advance and not one this outage just made.
        const permitted = config.externallyPermittedDataClasses ?? [];
        if (!permitted.includes(request.dataClass)) {
            return { outcome: "UNAVAILABLE", reason: "EXTERNAL_USE_NOT_PERMITTED_FOR_DATA_CLASS" };
        }
        const external = chooseExternal(config);
        if (!external)
            return { outcome: "UNAVAILABLE", reason: "PRIVATE_PROVIDER_UNAVAILABLE" };
        return { outcome: "SELECTED", providerId: external, privacyClass: "EXTERNAL", reason: "EXTERNAL_PROVIDER_SELECTED_BY_POLICY" };
    }
    // FRONTIER_ALLOWED -- external use is intentional here, so it needs no per-data-class permit.
    const external = chooseExternal(config);
    if (external) {
        return { outcome: "SELECTED", providerId: external, privacyClass: "EXTERNAL", reason: "EXTERNAL_PROVIDER_SELECTED_BY_POLICY" };
    }
    if (priv)
        return { outcome: "SELECTED", providerId: priv, privacyClass: "PRIVATE", reason: "PRIVATE_PROVIDER_SELECTED" };
    return { outcome: "UNAVAILABLE", reason: "NO_PROVIDER_CONFIGURED" };
}
/**
 * Whether this policy could ever send this data class to an external provider.
 *
 * Exists so an operator surface can state the answer plainly rather than inferring it from three
 * settings, and so a test can assert the answer for PRIVATE_ONLY is `false` for every data class.
 */
function externalDisclosureIsPossible(config, dataClass) {
    if (config.policy === "PRIVATE_ONLY")
        return false;
    if (config.policy === "FRONTIER_ALLOWED")
        return true;
    return (config.externallyPermittedDataClasses ?? []).includes(dataClass);
}
/** The message a governed unavailable outcome produces. It explains, and it does not offer a bypass. */
exports.PRIVATE_PROVIDER_UNAVAILABLE_MESSAGE = "The assistant is unavailable right now because its private model is not reachable, and this "
    + "request is not permitted to use an external provider. Everything else in EOS is unaffected.";
//# sourceMappingURL=aiProviderPolicy.js.map