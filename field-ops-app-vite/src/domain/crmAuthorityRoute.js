// WHERE THIS BUILD'S CRM (Account / Contact / customer site) READS AND WRITES GO. BUILD-TIME ONLY.
//
// The PostgreSQL CRM cutover is authorized for platform-sandbox ONLY. Every other build -- above all the
// production-capable GitHub Pages bundle (taylor-parts-production) -- keeps the legacy Firestore CRM path exactly
// as it was before the cutover work. THIS module is the one place that decision is made.
//
//   CRM via EOS API  -> browser -> EOS API (POST /crm/customer) -> governed PostgreSQL CRM
//   otherwise        -> the legacy Firestore CRM implementation, unchanged
//
// RULES (test/crmAuthorityRoute.test.mjs, test/crmClientCutover.test.jsx):
//   * The decision is a function of the BUILD's environment id only (config/environments.json, baked in by
//     vite.config.js). No runtime switch, no env var read at runtime, no URL flag, no user or server input.
//   * The allowlist is CLOSED. An unknown, absent or misspelled environment id selects the legacy path.
//   * NEVER A FALLBACK. Each public CRM module selects ONE implementation at module load. A failed EOS API call
//     surfaces as a failure; it is never retried against Firestore, the Firestore path never consults the EOS API,
//     and nothing writes both.
//
// HOW IT REACHES THE PUBLIC MODULES -- `__APP_CRM_VIA_EOS_API__`. vite.config.js computes
// `crmViaEosApiFor(<build environment id>)` from this module and injects the boolean as the
// `__APP_CRM_VIA_EOS_API__` define. Each routed module reads that define in ONE local line:
//
//   const CRM_VIA_EOS_API = typeof __APP_CRM_VIA_EOS_API__ === "boolean" && __APP_CRM_VIA_EOS_API__;
//
// and selects with a top-level ternary on imported bindings, e.g.
//
//   export const useAccount = CRM_VIA_EOS_API ? useAccountEosApi : useAccountFirestore;
//
// Why a define and not `import { CRM_VIA_EOS_API } from "./crmAuthorityRoute.js"`: Rolldown decides which modules
// and cross-chunk exports a bundle keeps BEFORE it folds an imported constant, so an imported flag leaves the
// unselected implementation (and services/crmApiClient.js) in the bundle as dead code. A literal the module can
// see for itself is folded at that stage, and the unselected implementation is dropped. Verified by building
// taylor-parts-production and platform-sandbox and grepping each bundle for the CRM route.
//
// The `typeof` guard means a plain node context (node --test) and the vitest harness, where the define is absent,
// select the legacy path -- absent means legacy, never EOS.

/** The environments whose CRM is served by the EOS API. Closed; changing it is a cutover decision. */
export const CRM_EOS_API_ENVIRONMENTS = Object.freeze(["platform-sandbox"]);

/** Whether a build for `environmentId` routes CRM to the EOS API. Exact, closed-allowlist match. */
export function crmViaEosApiFor(environmentId) {
  return typeof environmentId === "string" && CRM_EOS_API_ENVIRONMENTS.includes(environmentId);
}

/**
 * This build's environment id, or null. Guarded as modules/administration/AdminRolesPermissions.jsx guards it: the
 * define is absent in a plain node context, where an unguarded read of an undeclared global throws.
 */
export const CRM_BUILD_ENVIRONMENT_ID =
  typeof __APP_ENVIRONMENT__ === "object" && __APP_ENVIRONMENT__ ? (__APP_ENVIRONMENT__.id ?? null) : null;

/** This build's decision, from its baked environment id. True only in a platform-sandbox build. */
export const CRM_VIA_EOS_API = crmViaEosApiFor(CRM_BUILD_ENVIRONMENT_ID);
