// Issue #226 Row 16 -- Navigation/shared UI parity helpers (Task 21).
// PURE, dependency-free wrapper (no import of resolveEffectivePermission.ts/
// compatibilityRoles.ts -- both are supplied by the caller) so this file's
// own fallback/fail-closed contract is directly unit-testable with plain
// Node, matching this repo's existing pure-logic test convention (Node's
// ESM loader cannot resolve resolveEffectivePermission.ts's own internal
// extensionless imports without a build step, the same reason
// permissionDecisionCopy.test.mjs tests literal ResolveResult shapes rather
// than importing that resolver directly).
//
// Presentation-only preview of whether `role` effectively holds
// `permissionId` under the new Permission engine (Spec sec8) -- NEVER
// authoritative (Spec sec12). UI visibility stays convenience only; the
// real gate is firestore.rules/trusted Cloud Functions, unchanged by this
// helper. `fallback` is what the scattered inline role check this call
// site is replacing already computed -- returned if `role` isn't a known
// compatibility Role, or if the resolver throws on unexpected input
// (should not happen for a real catalog id, but a UI-only preview must
// never hard-fail to render nothing over a malformed/future role value).
const PREVIEW_GRANTED_AT = { toMillis: () => 0 };
const GLOBAL_TARGET = { scope: { type: "global" }, condition: {} };

function previewAssignment(roleId) {
  return {
    id: `preview-${roleId}`,
    principalUid: "preview",
    roleId,
    scope: { type: "global" },
    grantedBy: "preview",
    grantedAt: PREVIEW_GRANTED_AT,
    status: "active",
    accessVersionAtGrant: 1,
  };
}

// Curried factory: bind the real resolveEffectivePermission + COMPATIBILITY_ROLES
// once at each call site (App.jsx/AppHeader.jsx), producing a previewHasPermission(
// permissionId, role, { fallback }) function with no further imports to thread through.
//
// `activationOverrides` (spec 2026-08-14): the OPTIONAL build-time set of spine
// capability ids this environment activates despite catalog active:false. Passed
// straight into the resolver so the UI preview matches what the backend will
// authorize in this environment. Omitted / [] => today's behavior (spine stays
// preview-hidden), and it is [] in every production build by construction.
export function createPermissionPreviewer(resolveEffectivePermission, roles, activationOverrides) {
  const overrideSet =
    activationOverrides instanceof Set
      ? activationOverrides
      : new Set(Array.isArray(activationOverrides) ? activationOverrides : []);
  return function previewHasPermission(permissionId, role, { fallback = false } = {}) {
    if (!roles[role]) return fallback;
    try {
      const result = resolveEffectivePermission({
        permissionId,
        assignments: [previewAssignment(role)],
        roles,
        currentAccessVersion: 1,
        target: GLOBAL_TARGET,
        activationOverrides: overrideSet,
      });
      return result.decision === "ALLOW";
    } catch {
      return fallback;
    }
  };
}
