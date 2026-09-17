// readMyWorkforceCapabilities -- which Workforce controls the CALLER may be offered, answered by the same PostgreSQL
// authority that authorizes the Workforce commands and reads (Workforce census finding #17).
//
// ════════════════════ ONE SOURCE OF TRUTH: THE RESOLVED CONTEXT ════════════════════
//
// The transport has already resolved the caller through resolveOperationalContext (EOS Principal, ACTIVE tenant
// membership, qualifying Roles, eos_policy.role_capabilities) and hands this read that actor. This read does NOT
// query role_capabilities again and does not resolve anything of its own: it answers from `actor.capabilities`, the
// exact set every Workforce command re-checks. So an offer and an authorization can no longer disagree.
//
// It runs through the read kernel like every other Employee read, so an inactive Principal or membership refuses inside
// the read-only transaction exactly as a governed read does, and the answer is never a partial or default grant.
//
// ════════════════════ WHAT IT RETURNS, AND WHAT IT NEVER RETURNS ════════════════════
//
//   { capabilities: [...] }  the caller's held capabilities INTERSECTED with the closed Workforce list below, in that
//                            list's order. Nothing else: no Role key, no Principal id, no tenant, no subject, and no
//                            capability outside the list (a Commercial, Inventory or Administration grant the same
//                            Role holds is never disclosed here).
//
// CAPABILITY. None beyond an active Principal with an active membership: it only tells a caller about themselves, and
// accepts no selector, so it cannot describe anyone else. It confers nothing -- every command still re-checks.
//
// NO NEW CAPABILITY. The list names four EXISTING ids only; none is invented and none is granted here.
import { acceptOnly, runEmployeeRead, type EmployeeReadActor, type EmployeeReadDeps } from "./employeeReadKernel";

/** The closed list of Workforce capability ids a caller may learn it holds. Existing ids only. */
export const WORKFORCE_CAPABILITY_IDS = Object.freeze([
  "employee.record.read",
  "admin.principalAccess.read",
  "admin.employeeProfile.write",
  "admin.employeeJobRole.write",
] as const);

export interface MyWorkforceCapabilities {
  readonly capabilities: readonly string[];
}

export function readMyWorkforceCapabilities(deps: EmployeeReadDeps, actor: EmployeeReadActor, input?: Record<string, unknown>): Promise<MyWorkforceCapabilities> {
  return runEmployeeRead(deps, actor, () => acceptOnly(input, []), () => [],
    // The body runs only after the kernel has confirmed the active Principal + active membership in the snapshot.
    async () => ({ capabilities: WORKFORCE_CAPABILITY_IDS.filter((id) => actor.capabilities.has(id)) }));
}
