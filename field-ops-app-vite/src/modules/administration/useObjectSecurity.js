// READING OBJECT-OWNED SECURITY, from a screen.
//
// Three projections of ONE server authority, plus the Object/action inventory the first two are
// read against:
//
//   Object    -> actions -> who holds each        useObjectSecurityMatrix
//   Role      -> objects -> actions               useRoleSecurity
//   Principal -> roles + direct grants -> access  usePrincipalEffectiveAccess
//
// ════════════════════ THESE ARE NOT AN AUTHORITY, AND NOTHING RENDERS THEM YET ════════════════════
//
// They are READS. They decide nothing, they are not Permission Preview's replacement, and no
// Administration screen or navigation entry calls them in this tranche. They exist so that the
// screen which eventually does has one place to ask from -- the same reason the Workforce reads
// were named ahead of their UI.
//
// The answers come from PostgreSQL through the EOS trusted API. A client-only check is never
// sufficient for access, so what these return is for DISPLAY: showing an administrator what the
// server would answer, not deciding it here.
//
// ════════════════════ A MISSING KEY IS NOT A REQUEST ════════════════════
//
// `useObjectSecurityMatrix(null)` asks nothing rather than sending an empty input and rendering the
// INVALID_INPUT that comes back. That is not the client validating: it is a screen with no Object
// selected yet, which is a state, not an error. The moment a key is present the request goes out
// and the SERVER decides whether it is a good one.
import { usePolicyStore } from "./usePolicyStore.js";

/** Every Object this tenant registered, with the actions it governs. Takes no input. */
export function useObjectsWithActions(options = {}) {
  return usePolicyStore("listObjectsWithActions", null, options);
}

/** One Object: every action it governs and who holds each -- Roles AND Principals. */
export function useObjectSecurityMatrix(objectKey, options = {}) {
  return usePolicyStore(
    "getObjectSecurityMatrix",
    objectKey ? { objectKey } : null,
    { ...options, enabled: options.enabled !== false && Boolean(objectKey) },
  );
}

/** One Security Role: the Objects it reaches and the actions it may perform on each. */
export function useRoleSecurity(roleKey, options = {}) {
  return usePolicyStore(
    "getRoleSecurity",
    roleKey ? { roleKey } : null,
    { ...options, enabled: options.enabled !== false && Boolean(roleKey) },
  );
}

/**
 * One Principal: active Roles, direct grants, and the effective capabilities with their provenance.
 *
 * A PRINCIPAL, not an Employee. Work Eligibility, Operational Scope and the linked Employee are not
 * in this answer and must not be joined onto it here -- they are subordinate constraints on a
 * capability already held, and a business fact shown beside a grant reads as a grant.
 */
export function usePrincipalEffectiveAccess(principalId, options = {}) {
  return usePolicyStore(
    "getPrincipalEffectiveAccess",
    principalId ? { principalId } : null,
    { ...options, enabled: options.enabled !== false && Boolean(principalId) },
  );
}
