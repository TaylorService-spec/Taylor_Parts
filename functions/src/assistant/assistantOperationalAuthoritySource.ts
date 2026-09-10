// THE OPERATIONAL AUTHORITY SOURCE. Storage-neutral, ADR-015 above the line.
//
// ============================ WHY THIS EXISTS, SEPARATELY FROM THE POSTGRES POLICY READER ============================
//
// The Postgres stored Role system this PR's sibling code (`assistantRoute.ts`'s use of
// `resolvePrincipalContext`) already reaches governs the ADMINISTRATION policy subsystem today --
// Objects, Fields, and the Administration screens. It does NOT yet govern Work Orders, Inventory,
// Purchasing, Sales, or any other business module. Those are still authorized by the EXISTING
// operational model `assistantAuthorization.ts` already documents:
//
//   effective operational authority =
//     business Role assignments + functional Role assignments + legacy compatibility Role
//     intersected with active environment capabilities
//
// Using the Postgres-stored Role as a stand-in for that model would be a second, easier path to the
// same business data -- exactly the "two authorization models and only one of them is tested" failure
// this platform's own governance program exists to prevent. So this file exists to keep the two
// sources apart: whatever resolves "which business/functional/compatibility Role ids does this
// principal hold TODAY, operationally" is a SEPARATE seam from the Postgres policy reader, and this is
// that seam, storage-neutral like `assistantBusinessDataReader.ts`.
//
// ============================ NOT YET BOUND, ON PURPOSE ============================
//
// Wiring the REAL resolver here would mean reading wherever operational Role assignments live today
// (an existing Firestore-backed model, per `governedBusinessRoles.ts`/`compatibilityRoles.ts` and the
// employee record) -- exactly the credential/data-plane decision this PR's sibling
// `firestoreAssistantAdapters.ts` explicitly defers. So this resolver is deferred the same way, for
// the same reason: `resolveAssistantOperationalAuthoritySource()` returns `null` today, and the route
// refuses a DASHBOARD request explicitly rather than falling back to the Postgres policy Role as a
// substitute source of business authority.
import type { AssistantActor } from "./assistantAuthorization";

/** What the source needs to resolve one principal's currently-held operational Role ids. */
export interface AssistantOperationalAuthorityScope {
  readonly tenantId: string;
  readonly principalUid: string;
}

export type OperationalRoleIds = Pick<AssistantActor, "businessRoleIds" | "functionalRoleIds" | "compatibilityRoleId">;

export interface AssistantOperationalAuthoritySource {
  /**
   * The Role ids this principal operationally holds RIGHT NOW, from the SAME source Work
   * Order/Inventory/Purchasing/Sales authorization already reads. Never the Postgres policy Role.
   */
  resolveOperationalRoleIds(scope: AssistantOperationalAuthorityScope): Promise<OperationalRoleIds>;
}

export interface AssistantOperationalAuthorityEnv {
  readonly [key: string]: string | undefined;
}

/**
 * NOT YET AUTHORIZED / NOT YET BOUND -- the operational-authority counterpart to
 * `resolveAssistantFirestoreClient`. Binding this is a separate infrastructure task, not "fill one
 * line later": it requires deciding how the assistant reaches the existing operational Role
 * assignment store without reintroducing an unreviewed second authority path.
 */
export function resolveAssistantOperationalAuthoritySource(
  _env: AssistantOperationalAuthorityEnv,
): AssistantOperationalAuthoritySource | null {
  return null;
}
