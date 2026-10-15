"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAccountInvoiceAr = exports.FINANCE_READ_CAPABILITY = void 0;
exports.loadFinancialVisibilityAuthority = loadFinancialVisibilityAuthority;
exports.readAccountInvoiceAr = readAccountInvoiceAr;
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
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const resolveEffectivePermission_1 = require("../access/resolveEffectivePermission");
const environmentCapabilityOverrides_1 = require("../access/environmentCapabilityOverrides");
const compactClaims_1 = require("../access/compactClaims");
const operationalRoleContext_1 = require("../access/operationalRoleContext");
const compatibilityRoles_1 = require("../access/compatibilityRoles");
const governedBusinessRoles_1 = require("../access/governedBusinessRoles");
const operatingCompanyAuthority_1 = require("../ownership/operatingCompanyAuthority");
const financialAttribution_1 = require("./financialAttribution");
const collections_1 = require("../constants/collections");
const financeReadProjection_1 = require("./financeReadProjection");
const financialVisibility_1 = require("./financialVisibility");
const hierarchicalVisibility_1 = require("../access/hierarchicalVisibility");
exports.FINANCE_READ_CAPABILITY = financialVisibility_1.FINANCE_READ_FACT_FAMILY_CAPABILITY;
// ============================ FIN-004: THE VISIBILITY LOADER ============================
//
// `finance.read` is the FACT-FAMILY gate; REACH comes from a visibility scope
// (financialVisibility.ts). Both are resolved here, server-side, from ONE principal-state
// snapshot — following the R-32/#1672 lesson the reorder callables learned: authorization for a
// scoped domain is the per-record decision itself, and the loaded authority (not a global
// boolean) is what the read enforces with. SELF binds to users/{uid}.employeeId (the canonical
// uid→employee join, server-read only); TEAM composes access/hierarchicalVisibility.ts.
//
// COMPANY/BUSINESS_UNIT (FIN-BLOCK-001 CLOSED, Owner-directed): reach is bound through the
// governed access-scope types `operatingCompany` / `businessUnit` on the principal's
// RoleAssignments — ACCESS AUTHORITY FACTS, never employee/customer/location/warehouse
// inference. The value sets are small and governed (2 companies, 4 units), so the loader asks
// the ONE canonical resolver per candidate value with a scoped target — exactly how the reorder
// warehouse authority resolves {type:"location"}. A held company/BU capability with NO scoped
// binding still confers nothing (BLOCKED, with the reason) — never "everything of that kind".
async function loadFinancialVisibilityAuthority(db, uid) {
    const grants = [];
    const blockedScopes = [];
    let decisions;
    let allowsAt;
    try {
        const [userSnap, assignmentsSnap] = await Promise.all([
            db.collection("users").doc(uid).get(),
            db.collection("roleAssignments").where("principalUid", "==", uid).where("status", "==", "active").get(),
        ]);
        const userData = userSnap.exists ? userSnap.data() : undefined;
        const rawVersion = userData?.accessVersion;
        let accessVersion = 0;
        if (rawVersion !== undefined && rawVersion !== null) {
            // Malformed access data is a denial, never a default (same rule as the reorder authority).
            if (!(0, compactClaims_1.isValidAccessVersionValue)(rawVersion)) {
                return (0, financialVisibility_1.buildFinancialVisibilityAuthority)({ factFamilyAllowed: false, grants: [] });
            }
            accessVersion = rawVersion;
        }
        const assignments = assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const operationalRoleActive = await (0, operationalRoleContext_1.buildOperationalRoleActiveResolverFromEmployeeId)(db, uid, userData?.employeeId);
        const roles = { ...compatibilityRoles_1.COMPATIBILITY_ROLES, ...governedBusinessRoles_1.GOVERNED_BUSINESS_ROLES };
        const activationOverrides = (0, environmentCapabilityOverrides_1.resolveRuntimeCapabilityOverrides)();
        allowsAt = (permissionId, scope) => (0, resolveEffectivePermission_1.resolveEffectivePermission)({
            permissionId,
            assignments,
            roles,
            currentAccessVersion: accessVersion,
            target: { scope, condition: { operationalRoleActive } },
            activationOverrides,
        }).decision === "ALLOW";
        // Capability-level (global-target) decisions — identical semantics to the effective-access
        // feed, resolved against this same snapshot so every decision below is mutually consistent.
        decisions = {};
        for (const id of [
            financialVisibility_1.FINANCE_READ_FACT_FAMILY_CAPABILITY,
            financialVisibility_1.FINANCIAL_VISIBILITY_CAPABILITIES.CONSOLIDATED,
            financialVisibility_1.FINANCIAL_VISIBILITY_CAPABILITIES.OPERATING_COMPANY,
            financialVisibility_1.FINANCIAL_VISIBILITY_CAPABILITIES.BUSINESS_UNIT,
            financialVisibility_1.FINANCIAL_VISIBILITY_CAPABILITIES.TEAM,
            financialVisibility_1.FINANCIAL_VISIBILITY_CAPABILITIES.SELF,
        ]) {
            decisions[id] = allowsAt(id, { type: "global" });
        }
    }
    catch (err) {
        console.error("[loadFinancialVisibilityAuthority] capability resolution failed", err);
        return (0, financialVisibility_1.buildFinancialVisibilityAuthority)({ factFamilyAllowed: false, grants: [] });
    }
    if (decisions[financialVisibility_1.FINANCIAL_VISIBILITY_CAPABILITIES.CONSOLIDATED] === true) {
        grants.push({ scope: "CONSOLIDATED" });
    }
    // COMPANY/BU reach: enumerate the governed value sets and ask the canonical resolver with a
    // value-matched scoped target. A company/BU-scoped assignment can NEVER satisfy the global
    // targets above, and a global assignment carrying the capability reaches every governed value
    // here only through the same resolver rules that govern everything else (admin included — no
    // bypass path exists outside resolveEffectivePermission).
    for (const companyId of Object.values(operatingCompanyAuthority_1.OPERATING_COMPANY_IDS)) {
        if (allowsAt(financialVisibility_1.FINANCIAL_VISIBILITY_CAPABILITIES.OPERATING_COMPANY, { type: "operatingCompany", value: companyId })) {
            grants.push({ scope: "OPERATING_COMPANY", operatingCompanyId: companyId });
        }
    }
    for (const businessUnitId of financialAttribution_1.BUSINESS_UNITS) {
        if (allowsAt(financialVisibility_1.FINANCIAL_VISIBILITY_CAPABILITIES.BUSINESS_UNIT, { type: "businessUnit", value: businessUnitId })) {
            grants.push({ scope: "BUSINESS_UNIT", businessUnitId });
        }
    }
    // A held capability that bound to no governed value is surfaced honestly, and confers nothing.
    if (decisions[financialVisibility_1.FINANCIAL_VISIBILITY_CAPABILITIES.OPERATING_COMPANY] === true && !grants.some((g) => g.scope === "OPERATING_COMPANY")) {
        blockedScopes.push({ scope: "OPERATING_COMPANY", reason: "no operatingCompany-scoped binding resolves for this principal; a valueless grant confers no reach" });
    }
    if (decisions[financialVisibility_1.FINANCIAL_VISIBILITY_CAPABILITIES.BUSINESS_UNIT] === true && !grants.some((g) => g.scope === "BUSINESS_UNIT")) {
        blockedScopes.push({ scope: "BUSINESS_UNIT", reason: "no businessUnit-scoped binding resolves for this principal; a valueless grant confers no reach" });
    }
    const needsEmployee = decisions[financialVisibility_1.FINANCIAL_VISIBILITY_CAPABILITIES.SELF] === true
        || decisions[financialVisibility_1.FINANCIAL_VISIBILITY_CAPABILITIES.TEAM] === true;
    if (needsEmployee) {
        try {
            const userSnap = await db.collection("users").doc(uid).get();
            const employeeId = userSnap.exists ? userSnap.data()?.employeeId : undefined;
            if (typeof employeeId === "string" && employeeId.trim().length > 0) {
                if (decisions[financialVisibility_1.FINANCIAL_VISIBILITY_CAPABILITIES.SELF] === true) {
                    grants.push({ scope: "SELF", employeeId });
                }
                if (decisions[financialVisibility_1.FINANCIAL_VISIBILITY_CAPABILITIES.TEAM] === true) {
                    const population = await (0, hierarchicalVisibility_1.loadPrincipalPositions)(db);
                    const visible = (0, hierarchicalVisibility_1.visibleEmployeeIdsFor)(uid, population);
                    if (visible.size > 0)
                        grants.push({ scope: "TEAM", visibleEmployeeIds: visible });
                    else
                        blockedScopes.push({ scope: "TEAM", reason: "no visible employees resolved for this principal" });
                }
            }
            else {
                // A SELF/TEAM scope with no linked employee identity can bind to nobody — fail closed.
                blockedScopes.push({ scope: "SELF", reason: "principal has no linked employeeId" });
            }
        }
        catch (err) {
            console.error("[loadFinancialVisibilityAuthority] employee/team resolution failed", err);
            blockedScopes.push({ scope: "SELF", reason: "employee/team resolution failed; failing closed" });
        }
    }
    return (0, financialVisibility_1.buildFinancialVisibilityAuthority)({
        factFamilyAllowed: decisions[financialVisibility_1.FINANCE_READ_FACT_FAMILY_CAPABILITY] === true,
        grants,
        blockedScopes,
    });
}
// The core bounded read, factored out of the onCall adapter so it can be exercised directly (with an injected
// Firestore) in tests without needing a live `finance.read` grant. Returns { status, invoices, summary }:
//   status "ready" (a COMPLETE page, possibly empty) | "unavailable" (the read failed, OR the page was
//   truncated by the `limit` bound — an honest "unavailable", never a partial "ready").
async function readAccountInvoiceAr(db, accountId, limit, 
// FIN-004: the per-invoice visibility predicate, over RAW stored facts. REQUIRED — a read with
// no scope decision is not a thing this module offers; callers without an authority must not
// reach here (the callable throws permission-denied first).
isVisible) {
    const now = Date.now();
    try {
        // Fetch one row past the bound: if it comes back, the real result set exceeds `limit` and this page is a
        // truncation, not the whole account. The truncation check runs on the UNFILTERED account set —
        // a page that dropped rows to scope must still not claim completeness it cannot know.
        const snap = await db.collection(collections_1.INVOICES_COLLECTION).where("accountId", "==", accountId).limit(limit + 1).get();
        if (snap.size > limit) {
            return { status: "unavailable", invoices: [], summary: (0, financeReadProjection_1.summarizeAccountAr)([]) };
        }
        // FIN-004 scope filter, BEFORE projection: an out-of-scope invoice contributes nothing — not a
        // row, not a summary amount, not a count. The caller cannot tell hidden from absent, which is
        // the point: visibility follows the number.
        const visibleDocs = snap.docs.filter((d) => isVisible((0, financialVisibility_1.invoiceVisibilityFacts)(d.data() ?? {})));
        const invoices = visibleDocs.map((d) => (0, financeReadProjection_1.projectInvoiceAr)(d.id, d.data() ?? {}, now));
        return { status: "ready", invoices, summary: (0, financeReadProjection_1.summarizeAccountAr)(invoices) };
    }
    catch {
        // An honest "unavailable" — the read failed / is not connected — NOT "this account has zero invoices".
        return { status: "unavailable", invoices: [], summary: (0, financeReadProjection_1.summarizeAccountAr)([]) };
    }
}
// List the AR reads for an account's invoices (minimal projection). Returns { status, invoices, summary }:
//   status "ready" (a complete page, possibly empty) | "unavailable" (read failed, or the account's invoices
//   exceed `limit` and the page would otherwise be a silent truncation) — denied is thrown as permission-denied.
exports.listAccountInvoiceAr = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    // FIN-004: fact family + reach, both required. A principal holding finance.read with no
    // visibility scope (or only blocked scopes) is refused — the pre-FIN-004 behavior where the one
    // boolean served any accountId consolidated-wide is retired. The caller's accountId can never
    // expand scope: the per-invoice predicate filters regardless of what was asked for.
    const db = (0, firestore_1.getFirestore)();
    const authority = await loadFinancialVisibilityAuthority(db, request.auth.uid);
    if (!authority.anyReach) {
        throw new https_1.HttpsError("permission-denied", "You are not authorized to read Finance AR at any visibility scope.");
    }
    const data = (request.data ?? {});
    if (typeof data.accountId !== "string" || data.accountId.trim().length === 0)
        throw new https_1.HttpsError("invalid-argument", "accountId is required.");
    const limit = Number.isSafeInteger(data.limit) && data.limit > 0 && data.limit <= 200 ? data.limit : 100;
    return readAccountInvoiceAr(db, data.accountId, limit, authority.isInvoiceVisible);
});
//# sourceMappingURL=financeReadCallables.js.map