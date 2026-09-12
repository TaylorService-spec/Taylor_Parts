// Part identifier administration -- the SINGLE fail-closed write-readiness seam for the alias
// callable transport. Same shape and same discipline as receivingReadiness.js.
//
// The five callables (createPartAlias, deactivatePartAlias, reactivatePartAlias, listPartAliases,
// probePartAlias) are EXPORTED but NOT DEPLOYED by the slice that added them, so there is nothing for
// this transport to reach, and config/environments.json sets this constant false in EVERY environment
// (verified 2026-09-12).
//
// CORRECTED 2026-09-12: this paragraph used to add "and `inventory.catalog.manage` is not granted to
// any standing role ... nobody to reach it". That is false. The id is registered ACTIVE and is held by
// seven governed business Roles, including the durable standing inventoryCatalogAdministrator
// (access/governedBusinessRoles.ts). The transport gate below is the only thing closing this seam --
// which is the honest reason, and a stronger one than an imagined absence of grants.
//
// While false, services/partAliasCallableClient.js makes ZERO callable attempts. This is a
// compile-time constant, NOT a runtime probe -- the code never reaches Functions to guess. Flipping
// it AND releasing the resulting Hosting bundle requires a separate explicit Owner authorization,
// and flipping it alone is not activation.
//
// There is deliberately NO runtime override seam. Tests that need the ready branch mock this module
// at build time (vi.mock), which introduces no production-importable bypass.
//
// Resolved from the ONE environment registry (config/environments.json) via vite.config.js, never a
// literal. scripts/resolveEnvironment.mjs lists the key as REQUIRED, so an environment that omits it
// is a build error rather than a silent default-to-enabled.
export const PART_IDENTIFIER_TRANSPORT_READY = __APP_READINESS__.PART_IDENTIFIER_TRANSPORT_READY;

/**
 * Why the surface is unavailable, in the user's words rather than the system's.
 *
 * Exported as the single source for that sentence so the section, its controls, and its tests
 * cannot drift into three slightly different explanations of the same fact.
 */
export const PART_IDENTIFIER_UNAVAILABLE_REASON =
  "Identifier administration is built but not yet switched on in this environment. The commands exist and are governed; they have not been deployed or granted.";
