// Sales Opportunity — TRUSTED MINIMAL READ PROJECTION (repo-only, fail-closed). Owner-ratified direction:
// the client does NOT receive broad direct-collection read authority merely for UI convenience. Instead a
// trusted backend resolves the caller's governed scope, reads canonical Opportunity records via the Admin
// SDK, and returns ONLY the minimal projection the Sales workspace needs. This deliberately AVOIDS a client
// firestore.rules widening for Opportunity reads (the `opportunities` collection stays Admin-SDK-only).
//
// Principles enforced here:
//   • fail closed; caller identity comes from the authenticated principal (request.auth.uid), never a
//     client-supplied employee id used as authorization;
//   • authorization is the governed capability `opportunity.read`, resolved through the trusted effective-
//     access feed (registered active:false ⇒ ungranted ⇒ deny for everyone until a separate Owner grant);
//   • the projection returns ONLY fields the Sales operating experience needs — it preserves canonical
//     Account/Contact/Location authority (returns `accountId`, does NOT copy Customer name/PII into the
//     Opportunity for rendering), never exposes a raw Firebase UID as business identity, and invents no
//     forecast/pricing authority;
//   • distinguishes the states the UI must tell apart: denied · empty · unavailable · degraded.
//
// EXPORT != DEPLOY, REGISTER != GRANT. Exported for build/test only; nothing runs in production until a
// separate deploy + capability grant.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { OPPORTUNITIES_COLLECTION } from "../constants/collections";
import { OPPORTUNITY_STAGES, OPPORTUNITY_OUTCOMES } from "./opportunityLifecycle";

export const OPPORTUNITY_READ_CAPABILITY = "opportunity.read";

// The minimal projected shape the Sales workspace consumes. No raw UID, no Customer PII — `accountId` only
// (names resolve separately from the canonical Account authority). Numeric fields are normalized to
// number|null; unknown/invalid stage or outcome is dropped to null rather than trusted.
export interface OpportunityProjection {
  id: string;
  accountId: string | null;
  salesChannel: string | null;
  ownerEmployeeId: string | null;
  stage: string | null;
  outcome: string | null;
  need: string | null;
  expectedValue: number | null;
  expectedCloseAt: number | null;
  nextAction: string | null;
  lines: Array<{ kind: string; ref: string; qty?: number }>;
  // The Sales Order back-link createSalesOrderFromOpportunity.ts writes atomically on WON->Create
  // Sales Order (functions/src/opportunity/createSalesOrderFromOpportunity.ts). Added 2026-08-15
  // alongside salesOrder.read -- Owner: "Preserve Opportunity -> Sales Order lineage visibly." Was
  // previously written but never projected, so the lineage existed in Firestore but was invisible
  // to every reader (the exact "coordination invisibility" finding from the gap audit).
  salesOrderId: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Pure projection of one canonical opportunity doc → the minimal shape. Returns null if the doc cannot yield
// a usable projection (missing id) so the caller can count it as a `degraded` skip rather than emit garbage.
export function projectOpportunity(id: string, data: Record<string, unknown> | undefined): OpportunityProjection | null {
  if (!id || !data || typeof data !== "object") return null;
  const stage = OPPORTUNITY_STAGES.includes(data.stage as never) ? (data.stage as string) : null;
  const outcome = OPPORTUNITY_OUTCOMES.includes(data.outcome as never) ? (data.outcome as string) : null;
  const rawLines = Array.isArray(data.lines) ? data.lines : [];
  const lines = rawLines
    .map((l) => {
      const kind = str((l as Record<string, unknown>)?.kind);
      const ref = str((l as Record<string, unknown>)?.ref);
      if (!kind || !ref) return null;
      const qty = num((l as Record<string, unknown>)?.qty);
      return qty != null ? { kind, ref, qty } : { kind, ref };
    })
    .filter((l): l is { kind: string; ref: string; qty?: number } => l !== null);
  return {
    id,
    accountId: str(data.accountId),
    salesChannel: str(data.salesChannel),
    ownerEmployeeId: str(data.ownerEmployeeId),
    stage,
    outcome,
    need: str(data.need),
    expectedValue: num(data.expectedValue),
    expectedCloseAt: num(data.expectedCloseAt),
    nextAction: str(data.nextAction),
    lines,
    salesOrderId: str(data.salesOrderId),
  };
}

export type OpportunityReadStatus = "ready" | "degraded";

export interface OpportunityReadResult {
  status: OpportunityReadStatus;
  opportunities: OpportunityProjection[];
  skipped: number; // docs that failed projection (drives the `degraded` status, honestly surfaced)
}

// Pure: turn a set of {id,data} docs into the read result, marking `degraded` when any doc had to be skipped.
// `empty` is simply status:"ready" with an empty list — the client distinguishes empty from unavailable/denied.
export function summarizeReadResult(docs: Array<{ id: string; data: Record<string, unknown> | undefined }>): OpportunityReadResult {
  const opportunities: OpportunityProjection[] = [];
  let skipped = 0;
  for (const d of docs) {
    const p = projectOpportunity(d.id, d.data);
    if (p) opportunities.push(p);
    else skipped += 1;
  }
  return { status: skipped > 0 ? "degraded" : "ready", opportunities, skipped };
}

// ---------------------------------------------------------------------------------------------------------
// ACCOUNT-SCOPED read (Wave 7 completion, PART 2). Answers "which Opportunities belong to THIS Account?" --
// listOpportunityContext above returns the caller's whole authorized scope with no accountId filter, which
// is the wrong shape for an Account workspace section. Reuses the SAME governed capability
// (`opportunity.read`) rather than minting a new one: the authorization question ("can this principal read
// Opportunities at all?") is identical: only the SERVER-SIDE query shape changes (accountId is a real
// Firestore `where` clause -- never a client-side filter over a broader read). Bounded: fetches `limit + 1`
// (mirrors financeReadCallables.ts's readAccountInvoiceAr) so a hit on the extra row honestly discloses
// `truncated: true` rather than silently dropping rows -- the UI shows "showing first N" instead of
// pretending the page is the whole account.
const DEFAULT_ACCOUNT_OPPORTUNITY_LIMIT = 50;
const MAX_ACCOUNT_OPPORTUNITY_LIMIT = 200;

export interface AccountOpportunityListResult {
  status: "ready";
  opportunities: OpportunityProjection[];
  skipped: number; // docs on this account that failed projection (honestly counted, not silently dropped)
  truncated: boolean; // true when the account's real Opportunity count exceeds `limit`
}

// Core bounded read, factored out of the onCall adapter so it is directly testable without a live
// `opportunity.read` grant (mirrors readAccountInvoiceAr's own factoring).
export async function readOpportunitiesForAccount(
  db: FirebaseFirestore.Firestore,
  accountId: string,
  limit: number
): Promise<AccountOpportunityListResult> {
  // No `.orderBy()` here on purpose: an equality filter + limit is served by Firestore's automatic
  // single-field index with zero composite-index requirement. Adding an orderBy on a different field would
  // require a new composite index (accountId ASC, <field> ASC) that does not exist today.
  const snap = await db.collection(OPPORTUNITIES_COLLECTION).where("accountId", "==", accountId).limit(limit + 1).get();
  const truncated = snap.size > limit;
  const docs = snap.docs.slice(0, limit).map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
  const result = summarizeReadResult(docs);
  return { status: "ready", opportunities: result.opportunities, skipped: result.skipped, truncated };
}

// The trusted account-scoped read callable. Same fail-closed shape as listOpportunityContext: unauthenticated
// -> unauthenticated, missing/blank accountId -> invalid-argument (checked BEFORE authorization, matching
// getSalesOrderContext's own ordering), ungranted -> permission-denied, read failure -> internal ("unavailable").
// A genuinely malformed/unknown accountId is not an error -- it is an honest "ready" result with zero
// Opportunities (the account simply has none), exactly like listOpportunityContext's own empty case.
export const listOpportunitiesForAccount = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");

  const data = (request.data ?? {}) as { accountId?: unknown; limit?: unknown };
  if (typeof data.accountId !== "string" || data.accountId.trim().length === 0) {
    throw new HttpsError("invalid-argument", "accountId is required.");
  }
  const accountId = data.accountId.trim();
  const limit =
    Number.isSafeInteger(data.limit) && (data.limit as number) > 0 && (data.limit as number) <= MAX_ACCOUNT_OPPORTUNITY_LIMIT
      ? (data.limit as number)
      : DEFAULT_ACCOUNT_OPPORTUNITY_LIMIT;

  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({
      principalUid: request.auth.uid,
      permissionIds: [OPPORTUNITY_READ_CAPABILITY],
    });
    allowed = decisions[OPPORTUNITY_READ_CAPABILITY] === true;
  } catch {
    allowed = false; // fail closed
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to read Opportunities.");

  try {
    const db = getFirestore();
    return await readOpportunitiesForAccount(db, accountId, limit);
  } catch {
    throw new HttpsError("internal", "The opportunity read is temporarily unavailable.");
  }
});

// The trusted read callable. Returns the projected result; maps failures to HttpsError so the client can
// distinguish denied (permission-denied) from unavailable (internal). Empty and degraded ride the payload.
export const listOpportunityContext = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");

  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({
      principalUid: request.auth.uid,
      permissionIds: [OPPORTUNITY_READ_CAPABILITY],
    });
    allowed = decisions[OPPORTUNITY_READ_CAPABILITY] === true;
  } catch {
    allowed = false; // fail closed
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to read Opportunities.");

  try {
    const db = getFirestore();
    const snap = await db.collection(OPPORTUNITIES_COLLECTION).get();
    const result = summarizeReadResult(snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> })));
    return { status: result.status, opportunities: result.opportunities, skipped: result.skipped };
  } catch {
    // A read failure is UNAVAILABLE, distinct from denied/empty — surfaced as internal so the client seam
    // can render an honest "not connected / unavailable" state rather than "you have zero opportunities".
    throw new HttpsError("internal", "The opportunity read is temporarily unavailable.");
  }
});
