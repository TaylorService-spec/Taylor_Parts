// Commercial capability OFFER -- PURE (no React, no Firebase; node-testable). Pass 11 Retail Sales.
//
// NOT A QUESTION FOR THE FIREBASE FEED. The Opportunity / Sales Agreement / Sales Order screens used to ask the Firebase
// effective-access feed (resolveEffectiveAccessCallable over Firestore roles) which controls to offer, while every
// Commercial command and read is authorized by PostgreSQL. This asks the governed Commercial transport instead
// (readMyCommercialCapabilities), which answers from the caller's resolved EOS Principal, ACTIVE membership, Roles and
// eos_policy.role_capabilities -- the SAME capabilities every Commercial command re-checks. Same pattern as the Workforce
// offer (access/workforceCapabilityAccess.js).
//
// The list mirrors the server's closed COMMERCIAL_OFFER_CAPABILITY_IDS (functions/src/eosCommercial/reads/
// myCommercialCapabilities.ts). An answer naming anything outside it is MALFORMED -- never silently kept or dropped.
// salesOrder.fulfill / salesOrder.service are not in it: allocation and service creation are the held downstream
// boundary (Owner ruling D2), so they are never offered for a governed order.
export const MY_COMMERCIAL_CAPABILITIES_OPERATION = "readMyCommercialCapabilities";

export const COMMERCIAL_OFFER_CAPABILITY_IDS = Object.freeze([
  "opportunity.read",
  "opportunity.write",
  "opportunity.createSalesOrder",
  "salesAgreement.read",
  "salesAgreement.create",
  "salesAgreement.updateDraft",
  "salesAgreement.accept",
  "salesOrder.read",
  "salesOrder.write",
]);

const KNOWN = new Set(COMMERCIAL_OFFER_CAPABILITY_IDS);
const READ_KEYS = new Set(["opportunity.read", "salesAgreement.read", "salesOrder.read"]);

/**
 * The capability ids the caller may be OFFERED, from a successful answer, or null when the answer is not exactly the
 * governed shape. A channel-scoped READ is offerable (the server filters the rows to the caller's channels); a scoped
 * holding is never a write.
 */
export function commercialCapabilitiesFrom(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const { capabilities, channelScopedReads } = result;
  if (!Array.isArray(capabilities) || !Array.isArray(channelScopedReads)) return null;
  if (!capabilities.every((id) => typeof id === "string" && KNOWN.has(id))) return null;
  if (!channelScopedReads.every((id) => typeof id === "string" && READ_KEYS.has(id))) return null;
  return new Set([...capabilities, ...channelScopedReads]);
}
