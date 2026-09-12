// Shared inventory-balance read — the single fail-closed transport gate. Same shape and same
// discipline as receivingReadiness.js and partIdentifierReadiness.js.
//
// `getPartBalance` is EXPORTED but NOT DEPLOYED, so there is nothing for this transport to reach, and
// config/environments.json sets this constant false in EVERY environment (verified 2026-09-12).
//
// CORRECTED 2026-09-12: this paragraph used to add "and `inventory.balance.read` is registered
// `active: false` and granted to no Role ... nobody to reach it". The grant half is false: the id is
// held by fifteen governed business Roles (least-privilege inventoryLookupReader) and is ACTIVATED in
// platform-sandbox (access/governedBusinessRoles.ts, config/environments.json). `active: false` is the
// production posture. The undeployed callable and this transport gate are what close the seam.
//
// While false, services/inventoryBalanceCallableClient.js makes ZERO callable attempts. This is a
// compile-time constant, NOT a runtime probe — the code never reaches Functions to guess. Flipping
// it AND releasing the resulting bundle requires a separate explicit Owner authorization, and
// flipping it alone is not activation: the capability must be activated and granted too.
//
// There is deliberately NO runtime override seam. Tests that need the ready branch mock this module
// at build time (vi.mock), which introduces no production-importable bypass.
//
// Resolved from the ONE environment registry (config/environments.json) via vite.config.js, never a
// literal. scripts/resolveEnvironment.mjs lists the key as REQUIRED, so an environment that omits it
// is a build error rather than a silent default-to-enabled.
export const INVENTORY_BALANCE_READ_READY = __APP_READINESS__.INVENTORY_BALANCE_READ_READY;

/**
 * Why balances are unavailable, in the user's words.
 *
 * Exported as the single source for that sentence so the lookup surface, its rows and its tests
 * cannot drift into three slightly different explanations of the same fact.
 */
export const INVENTORY_BALANCE_UNAVAILABLE_REASON =
  "Stock balances are built and governed, but not switched on in this environment yet.";
