"use strict";
// Finance — PURE plan-vs-actual core (F6 / FIN-003). Encodes invariant A of the financial baseline:
//
//   ACTUAL ≠ FORECAST ≠ BUDGET ≠ GOAL ≠ RECONCILED ACCOUNTING FACT — they may be COMPARED but never
//   silently BLENDED.
//
// Two halves, both policy-free:
//   • PLAN RECORD validation (buildPlanRecord): a GOAL or BUDGET is a VERSIONED planning authority
//     (Frame 0 section responsibilities) — explicit type, version, lifecycle DRAFT→APPROVED→SUPERSEDED,
//     an EXPLICIT measurement basis (which financial basis the plan is measured against — booked vs
//     billed vs collected vs cost; never implied), an explicit period, integer minor units, and FIN-002
//     attribution dimensions as its scope (company/BU/person — the same reporting spine actuals carry).
//     WHO may approve a plan is FIN-007 governance (undecided) — this core only refuses to compare
//     against anything not APPROVED.
//   • COMPARISON (comparePlanToActual): actuals arrive as explicit facts each declaring its OWN basis
//     and dimensions; a basis mismatch, currency mismatch, period-outside fact, or scope-foreign fact is
//     a REFUSAL or an exclusion-with-reason — never a silent blend. The result reports plan, actual,
//     variance, and exactly what was excluded and why. No I/O; no storage decided.
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlanError = exports.MEASUREMENT_BASES = exports.PLAN_STATUSES = exports.PLAN_TYPES = void 0;
exports.buildPlanRecord = buildPlanRecord;
exports.accumulateActualFacts = accumulateActualFacts;
exports.comparePlanToActual = comparePlanToActual;
exports.PLAN_TYPES = Object.freeze(["GOAL", "BUDGET"]);
exports.PLAN_STATUSES = Object.freeze(["DRAFT", "APPROVED", "SUPERSEDED"]);
/** The financial bases a plan may be measured against — the baseline's basis separation rule. */
exports.MEASUREMENT_BASES = Object.freeze(["BOOKED", "BILLED", "COLLECTED", "COST"]);
class PlanError extends Error {
    code;
    constructor(code, message) { super(message); this.name = "PlanError"; this.code = code; }
}
exports.PlanError = PlanError;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isInt = (v) => typeof v === "number" && Number.isSafeInteger(v);
const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
// Validate + freeze one versioned plan record. Pure validation only — persistence, numbering of versions,
// and approval AUTHORITY are not decided here.
function buildPlanRecord(input) {
    if (!exports.PLAN_TYPES.includes(input?.planType))
        throw new PlanError("TYPE_INVALID", `planType must be one of ${exports.PLAN_TYPES.join("/")} — a goal is not a budget`);
    if (!exports.PLAN_STATUSES.includes(input.status))
        throw new PlanError("STATUS_INVALID", `status must be one of ${exports.PLAN_STATUSES.join("/")}`);
    if (!exports.MEASUREMENT_BASES.includes(input.measurementBasis)) {
        throw new PlanError("BASIS_REQUIRED", `measurementBasis must be one of ${exports.MEASUREMENT_BASES.join("/")} — a plan with no declared basis cannot be measured`);
    }
    if (!isInt(input.version) || input.version < 1)
        throw new PlanError("VERSION_INVALID", "version must be a positive integer");
    if (!nonEmpty(input.currency))
        throw new PlanError("CURRENCY_REQUIRED", "currency is explicit on every plan");
    if (!isInt(input.amountMinor) || input.amountMinor < 0)
        throw new PlanError("AMOUNT_INVALID", "amountMinor must be a non-negative integer (minor units)");
    if (!ISO_DATE.test(input.periodStart ?? "") || !ISO_DATE.test(input.periodEnd ?? ""))
        throw new PlanError("PERIOD_INVALID", "periodStart/periodEnd must be ISO dates (YYYY-MM-DD)");
    if (input.periodEnd < input.periodStart)
        throw new PlanError("PERIOD_INVALID", "periodEnd precedes periodStart");
    const dim = (v, label) => {
        if (v === undefined || v === null)
            return null;
        if (!nonEmpty(v))
            throw new PlanError("SCOPE_INVALID", `${label} must be a non-empty id or absent`);
        return v.trim();
    };
    return Object.freeze({
        planType: input.planType,
        version: input.version,
        status: input.status,
        measurementBasis: input.measurementBasis,
        currency: input.currency.trim(),
        amountMinor: input.amountMinor,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        scope: Object.freeze({
            operatingCompanyId: dim(input.scope?.operatingCompanyId, "operatingCompanyId"),
            businessUnitId: dim(input.scope?.businessUnitId, "businessUnitId"),
            creditedSalespersonId: dim(input.scope?.creditedSalespersonId, "creditedSalespersonId"),
        }),
    });
}
// The ONE never-blend accumulation (shared by plan and forecast comparison): a basis or currency mismatch
// is a thrown category error; out-of-period / out-of-scope facts are NAMED exclusions; included facts sum.
function accumulateActualFacts(window, actuals) {
    const facts = Array.isArray(actuals) ? actuals : [];
    const excluded = [];
    let actualMinor = 0;
    let includedCount = 0;
    for (const f of facts) {
        if (!nonEmpty(f?.ref))
            throw new PlanError("FACT_INVALID", "every actual fact requires a ref");
        if (!isInt(f.amountMinor))
            throw new PlanError("FACT_INVALID", `fact ${f.ref}: amountMinor must be an integer (minor units)`);
        if (f.basis !== window.measurementBasis) {
            throw new PlanError("BASIS_MISMATCH", `fact ${f.ref} is ${f.basis} but the ${window.label} measures ${window.measurementBasis} — bases are compared, never blended`);
        }
        if (f.currency !== window.currency) {
            throw new PlanError("CURRENCY_MISMATCH", `fact ${f.ref} is ${f.currency} but the ${window.label} is ${window.currency}`);
        }
        if (!ISO_DATE.test(f.eventDate ?? ""))
            throw new PlanError("FACT_INVALID", `fact ${f.ref}: eventDate must be an ISO date`);
        if (f.eventDate < window.periodStart || f.eventDate > window.periodEnd) {
            excluded.push({ ref: f.ref, reason: `outside ${window.label} period ${window.periodStart}..${window.periodEnd}` });
            continue;
        }
        const scopeMiss = (window.scope.operatingCompanyId !== null && f.operatingCompanyId !== window.scope.operatingCompanyId && "operatingCompanyId") ||
            (window.scope.businessUnitId !== null && f.businessUnitId !== window.scope.businessUnitId && "businessUnitId") ||
            (window.scope.creditedSalespersonId !== null && f.creditedSalespersonId !== window.scope.creditedSalespersonId && "creditedSalespersonId");
        if (scopeMiss) {
            excluded.push({ ref: f.ref, reason: `outside ${window.label} scope (${scopeMiss})` });
            continue;
        }
        actualMinor += f.amountMinor;
        includedCount += 1;
    }
    return { actualMinor, includedCount, excluded };
}
// Compare APPROVED plan vs explicit actual facts. Refusals (thrown): non-APPROVED plan, a fact whose
// basis differs from the plan's (comparing collected cash to a booked goal is a category error, not an
// exclusion), or a currency mismatch. Exclusions (reported): facts outside the plan period or outside a
// constrained scope dimension — real facts that simply do not belong to this plan.
function comparePlanToActual(plan, actuals) {
    if (plan?.status !== "APPROVED") {
        throw new PlanError("PLAN_NOT_APPROVED", `only an APPROVED plan is a measurement authority (status ${plan?.status}) — drafts and superseded versions are history`);
    }
    const { actualMinor, includedCount, excluded } = accumulateActualFacts({ measurementBasis: plan.measurementBasis, currency: plan.currency, periodStart: plan.periodStart, periodEnd: plan.periodEnd, scope: plan.scope, label: "plan" }, actuals);
    return {
        planType: plan.planType,
        measurementBasis: plan.measurementBasis,
        currency: plan.currency,
        planMinor: plan.amountMinor,
        actualMinor,
        varianceMinor: actualMinor - plan.amountMinor,
        includedCount,
        excluded,
    };
}
//# sourceMappingURL=planVsActual.js.map