// EI Receiving -- the SINGLE fail-closed write-readiness seam for the Receiving callable
// transport (LF1b).
//
// receiveInventoryStock and listReceivingLocationOptions are deployed and live (2026-08-06,
// Decision #63). inventory.stock.receive is granted through governed role composition to admin,
// dispatcher, and owner. RECEIVING_TRANSPORT_READY nonetheless remains FALSE because the
// customer-facing Phase-F Hosting/readiness activation has not been authorized.
//
// While false, the transport (services/receivingCallableClient.js) makes ZERO callable attempts
// and fails closed. This is a compile-time constant, NOT a runtime probe -- the code never reaches
// Functions to guess. Changing this constant AND releasing the resulting Hosting bundle requires a
// separate explicit Owner authorization; flipping it alone is not activation.
//
// This module exposes ONLY the constant -- there is NO runtime override/resolver seam. Readiness
// can be changed only by editing this governed constant; consumers read it directly. Tests that
// need the ready branch mock this module at build time (vi.mock), which introduces no
// production-importable bypass.
// O-3 — resolved from the ONE environment registry (config/environments.json)
// via vite.config.js, not a literal. Classification: this is DEPLOYMENT /
// ENVIRONMENT configuration, not build configuration — the same source revision
// is the Release Candidate, and each environment supplies its own readiness. That
// keeps an RC a single identified revision (D1 records commit AND environmentId)
// while still allowing a sandbox to exercise a capability production has not
// activated. Fails closed: the registry requires an explicit boolean per
// environment, so an absent flag is a build error, never a default-to-enabled.
export const RECEIVING_TRANSPORT_READY = __APP_READINESS__.RECEIVING_TRANSPORT_READY;
