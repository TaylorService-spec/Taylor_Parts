// Finance — trusted AR READ callable. A governed backend read over the Admin-SDK-only invoices collection:
// authorized principals get a MINIMAL AR projection for an account; the client never reads invoices directly
// (firestore.rules denies it). Mirrors the Opportunity trusted-read pattern:
//   • authorization = capability `finance.read`, fail-closed via the trusted effective-access feed; registered
//     active:false ⇒ hard DENY until a separate Owner grant;
//   • the read uses the Admin SDK and returns ONLY the projected AR fields (no PII, accountId only), deriving
//     the AR position from facts;
//   • distinct honest states: denied · ready · unavailable. This is a READ — it writes nothing and audits
//     nothing (no mutation), and it does not widen any client Rule.
//   • bounded-read honesty (mirrors coverageReadCallables.ts's resolveCoverageForContext / PR #905): the read
//     fetches limit+1 and, if the extra row is present, the page is a TRUNCATION of the account's real invoice
//     set — a bounded resolver must never label that "ready" (that status implies a complete summary). It
//     returns "unavailable" instead, exactly like a failed read, rather than silently reporting a partial AR
//     position as if it were the whole account.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { INVOICES_COLLECTION } from "../constants/collections";
import { projectInvoiceAr, summarizeAccountAr, type InvoiceArRead } from "./financeReadProjection";
import {
  FINANCIAL_VISIBILITY_CAPABILITIES,
  FINANCE_READ_FACT_FAMILY_CAPABILITY,
  buildFinancialVisibilityAuthority,
  invoiceVisibilityFacts,
  type FinancialVisibilityAuthority,
  type FinancialVisibilityGrant,
  type FinancialVisibilityScope,
} from "./financialVisibility";
import { loadPrincipalPositions, visibleEmployeeIdsFor } from "../access/hierarchicalVisibility";

export const FINANCE_READ_CAPABILITY = FINANCE_READ_FACT_FAMILY_CAPABILITY;

// ============================ FIN-004: THE VISIBILITY LOADER ============================
//
// `finance.read` is the FACT-FAMILY gate; REACH comes from a visibility scope
// (financialVisibility.ts). Both are resolved here, server-side, in one effective-access call —
// following the R-32/#1672 lesson the reorder callables learned: authorization for a scoped
// domain is the per-record decision itself, and the loaded authority (not a global boolean) is
// what the read enforces with. SELF binds to users/{uid}.employeeId (the canonical uid→employee
// join, server-read only); TEAM composes access/hierarchicalVisibility.ts — its first live
// consumer. COMPANY/BUSINESS_UNIT grants resolve to BLOCKED (no reach) until the Owner's access
// workstream rules how a principal is bound to a company/unit value (FIN-BLOCK-001): a held-but-
// unbindable scope must confer nothing, never "everything of that kind".
export async function loadFinancialVisibilityAuthority(db: Firestore, uid: string): Promise<FinancialVisibilityAuthority> {
  const ids = [
    FINANCE_READ_FACT_FAMILY_CAPABILITY,
    FINANCIAL_VISIBILITY_CAPABILITIES.CONSOLIDATED,
    FINANCIAL_VISIBILITY_CAPABILITIES.OPERATING_COMPANY,
    FINANCIAL_VISIBILITY_CAPABILITIES.BUSINESS_UNIT,
    FINANCIAL_VISIBILITY_CAPABILITIES.TEAM,
    FINANCIAL_VISIBILITY_CAPABILITIES.SELF,
  ];
  let decisions: Readonly<Record<string, boolean>>;
  try {
    ({ decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: ids }));
  } catch (err) {
    console.error("[loadFinancialVisibilityAuthority] capability resolution failed", err);
    return buildFinancialVisibilityAuthority({ factFamilyAllowed: false, grants: [] });
  }

  const grants: FinancialVisibilityGrant[] = [];
  const blockedScopes: Array<{ scope: FinancialVisibilityScope; reason: string }> = [];

  if (decisions[FINANCIAL_VISIBILITY_CAPABILITIES.CONSOLIDATED] === true) {
    grants.push({ scope: "CONSOLIDATED" });
  }
  // FIN-BLOCK-001: company/BU value binding is an undecided access mechanism. Held ⇒ BLOCKED.
  if (decisions[FINANCIAL_VISIBILITY_CAPABILITIES.OPERATING_COMPANY] === true) {
    blockedScopes.push({ scope: "OPERATING_COMPANY", reason: "principal-to-company binding mechanism undecided (FIN-BLOCK-001); grant confers no reach" });
  }
  if (decisions[FINANCIAL_VISIBILITY_CAPABILITIES.BUSINESS_UNIT] === true) {
    blockedScopes.push({ scope: "BUSINESS_UNIT", reason: "principal-to-unit binding mechanism undecided (FIN-BLOCK-001); grant confers no reach" });
  }

  const needsEmployee = decisions[FINANCIAL_VISIBILITY_CAPABILITIES.SELF] === true
    || decisions[FINANCIAL_VISIBILITY_CAPABILITIES.TEAM] === true;
  if (needsEmployee) {
    try {
      const userSnap = await db.collection("users").doc(uid).get();
      const employeeId = userSnap.exists ? (userSnap.data()?.employeeId as string | undefined) : undefined;
      if (typeof employeeId === "string" && employeeId.trim().length > 0) {
        if (decisions[FINANCIAL_VISIBILITY_CAPABILITIES.SELF] === true) {
          grants.push({ scope: "SELF", employeeId });
        }
        if (decisions[FINANCIAL_VISIBILITY_CAPABILITIES.TEAM] === true) {
          const population = await loadPrincipalPositions(db);
          const visible = visibleEmployeeIdsFor(uid, population);
          if (visible.size > 0) grants.push({ scope: "TEAM", visibleEmployeeIds: visible });
          else blockedScopes.push({ scope: "TEAM", reason: "no visible employees resolved for this principal" });
        }
      } else {
        // A SELF/TEAM scope with no linked employee identity can bind to nobody — fail closed.
        blockedScopes.push({ scope: "SELF", reason: "principal has no linked employeeId" });
      }
    } catch (err) {
      console.error("[loadFinancialVisibilityAuthority] employee/team resolution failed", err);
      blockedScopes.push({ scope: "SELF", reason: "employee/team resolution failed; failing closed" });
    }
  }

  return buildFinancialVisibilityAuthority({
    factFamilyAllowed: decisions[FINANCE_READ_FACT_FAMILY_CAPABILITY] === true,
    grants,
    blockedScopes,
  });
}

export interface AccountInvoiceArResult {
  status: "ready" | "unavailable";
  invoices: InvoiceArRead[];
  summary: ReturnType<typeof summarizeAccountAr>;
}

// The core bounded read, factored out of the onCall adapter so it can be exercised directly (with an injected
// Firestore) in tests without needing a live `finance.read` grant. Returns { status, invoices, summary }:
//   status "ready" (a COMPLETE page, possibly empty) | "unavailable" (the read failed, OR the page was
//   truncated by the `limit` bound — an honest "unavailable", never a partial "ready").
export async function readAccountInvoiceAr(
  db: Firestore,
  accountId: string,
  limit: number,
  // FIN-004: the per-invoice visibility predicate, over RAW stored facts. REQUIRED — a read with
  // no scope decision is not a thing this module offers; callers without an authority must not
  // reach here (the callable throws permission-denied first).
  isVisible: (facts: ReturnType<typeof invoiceVisibilityFacts>) => boolean,
): Promise<AccountInvoiceArResult> {
  const now = Date.now();
  try {
    // Fetch one row past the bound: if it comes back, the real result set exceeds `limit` and this page is a
    // truncation, not the whole account. The truncation check runs on the UNFILTERED account set —
    // a page that dropped rows to scope must still not claim completeness it cannot know.
    const snap = await db.collection(INVOICES_COLLECTION).where("accountId", "==", accountId).limit(limit + 1).get();
    if (snap.size > limit) {
      return { status: "unavailable", invoices: [], summary: summarizeAccountAr([]) };
    }
    // FIN-004 scope filter, BEFORE projection: an out-of-scope invoice contributes nothing — not a
    // row, not a summary amount, not a count. The caller cannot tell hidden from absent, which is
    // the point: visibility follows the number.
    const visibleDocs = snap.docs.filter((d) => isVisible(invoiceVisibilityFacts(d.data() ?? {})));
    const invoices: InvoiceArRead[] = visibleDocs.map((d) => projectInvoiceAr(d.id, d.data() ?? {}, now));
    return { status: "ready", invoices, summary: summarizeAccountAr(invoices) };
  } catch {
    // An honest "unavailable" — the read failed / is not connected — NOT "this account has zero invoices".
    return { status: "unavailable", invoices: [], summary: summarizeAccountAr([]) };
  }
}

// List the AR reads for an account's invoices (minimal projection). Returns { status, invoices, summary }:
//   status "ready" (a complete page, possibly empty) | "unavailable" (read failed, or the account's invoices
//   exceed `limit` and the page would otherwise be a silent truncation) — denied is thrown as permission-denied.
export const listAccountInvoiceAr = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");

  // FIN-004: fact family + reach, both required. A principal holding finance.read with no
  // visibility scope (or only blocked scopes) is refused — the pre-FIN-004 behavior where the one
  // boolean served any accountId consolidated-wide is retired. The caller's accountId can never
  // expand scope: the per-invoice predicate filters regardless of what was asked for.
  const db = getFirestore();
  const authority = await loadFinancialVisibilityAuthority(db, request.auth.uid);
  if (!authority.anyReach) {
    throw new HttpsError("permission-denied", "You are not authorized to read Finance AR at any visibility scope.");
  }

  const data = (request.data ?? {}) as { accountId?: string; limit?: number };
  if (typeof data.accountId !== "string" || data.accountId.trim().length === 0) throw new HttpsError("invalid-argument", "accountId is required.");
  const limit = Number.isSafeInteger(data.limit) && (data.limit as number) > 0 && (data.limit as number) <= 200 ? (data.limit as number) : 100;

  return readAccountInvoiceAr(db, data.accountId, limit, authority.isInvoiceVisible);
});
