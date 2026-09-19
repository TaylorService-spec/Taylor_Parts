// Workforce capability REQUEST -- PURE (no React, no Firebase; node-testable). Workforce census finding #17.
//
// NOT A QUESTION FOR THE FIREBASE FEED. Every other *_CAPABILITY_REQUEST in this directory is asked of the trusted
// Firebase effective-access feed. This one is asked of the governed PostgreSQL Workforce transport
// (readMyWorkforceCapabilities), which answers from the caller's resolved EOS Principal, ACTIVE membership, Roles and
// eos_policy.role_capabilities -- the SAME capabilities every Workforce command re-checks. The Administration Employee
// pages decide which Workforce controls to OFFER from that answer (hooks/useWorkforceCapabilities.js).
//
// The list mirrors the server's closed WORKFORCE_CAPABILITY_IDS (functions/src/eosWorkforce/reads/
// myWorkforceCapabilities.ts). The server intersects the caller's capabilities with it; the client refuses an answer
// naming anything outside it. Existing ids only: no capability is invented, granted or activated here.
export const MY_WORKFORCE_CAPABILITIES_OPERATION = "readMyWorkforceCapabilities";

export const WORKFORCE_CAPABILITY_REQUEST = Object.freeze([
  "employee.record.read",
  "admin.principalAccess.read",
  "admin.employeeProfile.write",
  "admin.employeeJobRole.write",
  "admin.employeeWorkEligibility.write",
  "admin.employeeOperationalScope.write",
]);

const KNOWN = new Set(WORKFORCE_CAPABILITY_REQUEST);

/**
 * The held Workforce ids from a successful result, or null when the answer is not exactly the governed shape: an object
 * with an array of known capability ids. An unknown id makes the whole answer malformed -- never silently kept or dropped.
 */
export function workforceCapabilitiesFrom(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const list = result.capabilities;
  if (!Array.isArray(list)) return null;
  if (!list.every((id) => typeof id === "string" && KNOWN.has(id))) return null;
  return new Set(list);
}
