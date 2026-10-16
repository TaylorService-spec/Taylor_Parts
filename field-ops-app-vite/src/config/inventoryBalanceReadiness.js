// Shared inventory-balance read — the single fail-closed transport gate. Same shape and same
// discipline as receivingReadiness.js and partIdentifierReadiness.js.
//
// `getPartBalance` is EXPORTED but NOT DEPLOYED, and `inventory.balance.read` is registered
// `active: false` and granted to no Role. So there is nothing to reach and nobody to reach it, and
// this constant is false in every environment.
//
// The client that read it (services/inventoryBalanceCallableClient.js, the getPartBalance callable) was
// deleted by the Firebase exit (PR-B, 2026-10-15), so no code path reads this constant any more. It remains
// a REQUIRED registry key, and the governed balance returns as an EOS Core read rather than by flipping
// this flag. See docs/architecture/frontend-dormant-firebase-client-retirement-ledger.md.
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
