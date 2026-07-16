// Issue #226 Row 11 -- Read-only Admin MVP (Task 16). Spec sec16's "denial
// explanation" MVP surface: pure, safe-copy translation of a
// resolveEffectivePermission() ResolveResult (src/access/resolveEffectivePermission.ts)
// into a human-readable status + explanation. Never surfaces a raw
// assignment/document id -- matchedRoleId is a repository-declared Role id
// (e.g. "admin"), not a secret or an opaque Firestore path.
const DENIAL_EXPLANATIONS = {
  unknownPermission: "This permission is not recognized by the platform's permission catalog.",
  malformedAssignments: "The principal's role assignments could not be read; access is denied until they can be verified.",
  noQualifyingGrant: "No active, currently-valid Role grants this permission for the selected scope.",
};

const DEFAULT_DENIAL_EXPLANATION = DENIAL_EXPLANATIONS.noQualifyingGrant;

export function describePermissionDecision(result) {
  if (!result || typeof result !== "object" || result.decision !== "ALLOW") {
    const reason = result && typeof result === "object" ? result.reason : undefined;
    return {
      statusLabel: "Denied",
      explanation: (reason && DENIAL_EXPLANATIONS[reason]) ?? DEFAULT_DENIAL_EXPLANATION,
    };
  }
  return {
    statusLabel: "Allowed",
    explanation: result.matchedRoleId
      ? `Granted by the "${result.matchedRoleId}" Role.`
      : "Granted by an active Role assignment.",
  };
}
