// Per-environment capability activation -- frontend build-time constant
// (per-environment-capability-activation-spec.md, Owner-directed 2026-08-14).
//
// The set of sales/fulfillment/finance spine capability ids this environment
// activates despite their catalog `active:false`. Resolved from the ONE
// environment registry (config/environments.json) via vite.config.js at BUILD
// time -- the same governed pattern as receivingReadiness.js's
// RECEIVING_TRANSPORT_READY, NOT a runtime probe or a literal.
//
// A production build bakes in `[]`: resolveEnvironment.mjs is role-keyed, so the
// override cannot exist in a production bundle even if the registry were mis-
// edited. An absent registry key is likewise `[]`.
//
// PRESENTATION ONLY. This feeds the UI's permission PREVIEW (nav visibility,
// action enablement) so a human tester can DRIVE the spine through the UI in the
// sandbox. It is never authoritative: every real write is gated by the backend
// callable resolver (effectiveAccessFeed.ts), which derives its own override set
// from the deployed project's trusted GCLOUD_PROJECT identity, not from anything
// the client sends. A tampered client bundle can at most reveal a button whose
// backend action still fails closed.
export const CAPABILITY_ACTIVATION_OVERRIDES = Object.freeze(
  Array.isArray(__APP_CAPABILITY_ACTIVATION_OVERRIDES__)
    ? [...__APP_CAPABILITY_ACTIVATION_OVERRIDES__]
    : [],
);

// Convenience frozen Set for the resolver's `activationOverrides` input shape.
export const CAPABILITY_ACTIVATION_OVERRIDE_SET = Object.freeze(
  new Set(CAPABILITY_ACTIVATION_OVERRIDES),
);
