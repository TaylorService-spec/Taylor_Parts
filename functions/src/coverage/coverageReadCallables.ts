// Commercial Coverage — trusted READ callable. A governed backend resolve over the Admin-SDK-only coverage
// collections — the client never reads sales_territories / commercial_coverage_assignments directly
// (firestore.rules denies it). Mirrors the Opportunity/Finance trusted-read pattern:
//   • authorization = capability `coverage.read`, fail-closed via the trusted effective-access feed; registered
//     active:false ⇒ hard DENY until a separate Owner grant;
//   • the read uses the Admin SDK and returns the resolved coverageAssignments[] for a context — ALL effective
//     + matching (split coverage), NEVER one salesperson / no winner / no credit / no commission;
//   • distinct honest states: denied · ready (possibly empty) · unavailable. Writes nothing; audits nothing;
//     widens no client Rule.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { SALES_TERRITORIES_COLLECTION, COMMERCIAL_COVERAGE_ASSIGNMENTS_COLLECTION } from "../constants/collections";
import { resolveCommercialCoverage, type CoverageContext, type CoverageAssignmentLike, type TerritoryLike } from "./coverageResolution";

export const COVERAGE_READ_CAPABILITY = "coverage.read";

async function requireCoverageRead(uid: string): Promise<void> {
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [COVERAGE_READ_CAPABILITY] });
    allowed = decisions[COVERAGE_READ_CAPABILITY] === true;
  } catch {
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to read commercial coverage.");
}

// Project one assignment into the minimal read shape (identity refs + scope + responsibility + dates; no
// derived credit/commission/winner).
function projectAssignment(id: string, a: CoverageAssignmentLike): Record<string, unknown> {
  return {
    assignmentId: id,
    assignee: a.assignee ?? null,
    scope: a.scope ?? null,
    responsibility: (a as { responsibility?: unknown }).responsibility ?? null,
    priority: (a as { priority?: unknown }).priority ?? null,
    effectiveFrom: a.effectiveFrom ?? null,
    effectiveTo: a.effectiveTo ?? null,
  };
}

// Resolve the commercial coverage for a context (company-scoped). Returns { status, coverageAssignments }:
// ALL effective + matching assignments (split coverage). status "ready" (possibly empty) | "unavailable".
export const resolveCoverageForContext = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  await requireCoverageRead(request.auth.uid);

  const data = (request.data ?? {}) as { companyId?: string; context?: CoverageContext };
  if (typeof data.companyId !== "string" || data.companyId.trim().length === 0) throw new HttpsError("invalid-argument", "companyId is required.");
  const ctx: CoverageContext = data.context ?? {};

  const db = getFirestore();
  const now = Date.now();
  try {
    // Scope the read to the company; resolve over the (bounded) active assignment set + the territories.
    const [assignSnap, terrSnap] = await Promise.all([
      db.collection(COMMERCIAL_COVERAGE_ASSIGNMENTS_COLLECTION).where("companyId", "==", data.companyId).limit(1001).get(),
      db.collection(SALES_TERRITORIES_COLLECTION).limit(1001).get(),
    ]);
    // A bounded resolver must never label a truncated result as complete. Return the existing unavailable
    // state until pagination/another authoritative retrieval strategy is introduced.
    if (assignSnap.size > 1000 || terrSnap.size > 1000) {
      return { status: "unavailable" as const, coverageAssignments: [] as Record<string, unknown>[] };
    }
    const assignments: CoverageAssignmentLike[] = assignSnap.docs.map((d) => ({ assignmentId: d.id, ...(d.data() as CoverageAssignmentLike) }));
    const territoriesById: Record<string, TerritoryLike> = {};
    for (const d of terrSnap.docs) territoriesById[d.id] = d.data() as TerritoryLike;
    const resolved = resolveCommercialCoverage(ctx, assignments, { now, territoriesById });
    return { status: "ready" as const, coverageAssignments: resolved.map((a) => projectAssignment((a as { assignmentId: string }).assignmentId, a)) };
  } catch {
    return { status: "unavailable" as const, coverageAssignments: [] as Record<string, unknown>[] };
  }
});
