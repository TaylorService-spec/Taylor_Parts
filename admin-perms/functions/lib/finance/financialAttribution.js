"use strict";
// FIN-002 — THE ONE REPORTING-ATTRIBUTION AUTHORITY.
//
// Every reportable operational financial fact must ultimately answer: WHICH COMPANY, WHICH
// BUSINESS UNIT, WHICH CREDITED/RESPONSIBLE PERSON, WHICH CUSTOMER, WHICH SOURCE RECORD, WHICH
// EVENT TIME, WHICH CURRENCY. This module is the single definition of that vocabulary and of the
// snapshot those facts freeze into. There is deliberately NO Sales copy, NO Finance copy, NO
// Service copy — commercial commands, the dormant finance core, and future Service billing all
// import from here (docs/financials/FIN-002_REPORTING_ATTRIBUTION_MODEL.md; DECISIONS #154).
//
// ============================ WHAT THIS MODULE REFUSES TO DO ============================
//
// It INFERS NOTHING. Company is never inferred from a location/warehouse/manufacturer name or a
// Taylor/Ventana text label (Ruling R-14 — the company id is explicit or inherited from the
// governed upstream record, or it is null). Business unit is never inferred from a UI route.
// Credit is never derived from createdBy — the person who clicked Create is an actor, not the
// salesperson the sale is credited to. OWNERSHIP != SALES CREDIT: `ownerEmployeeId` remains the
// ownership authority (EOS Ownership Model v1, D-1..D-5); `creditedSalespersonId` is a DISTINCT
// reporting fact that defaults from the governed commercial owner at the point a sale enters the
// commercial chain and is thereafter carried — never silently re-derived from whoever owns the
// Customer today. HISTORICAL STAYS HISTORICAL: a frozen snapshot is corrected only by a governed
// FIN-007 attribution-adjustment event, never by an ordinary update.
//
// Pure: no Firestore, no clock, no identity. Callers supply every fact.
Object.defineProperty(exports, "__esModule", { value: true });
exports.AttributionError = exports.isFinancialSourceType = exports.FINANCIAL_SOURCE_TYPES = exports.isBusinessUnitId = exports.BUSINESS_UNITS = void 0;
exports.deriveLineBusinessUnit = deriveLineBusinessUnit;
exports.deriveWorkOrderBusinessUnit = deriveWorkOrderBusinessUnit;
exports.buildFinancialAttributionSnapshot = buildFinancialAttributionSnapshot;
exports.requireInvoiceParty = requireInvoiceParty;
exports.buildInvoiceEventAttribution = buildInvoiceEventAttribution;
exports.resolveCreditedSalesperson = resolveCreditedSalesperson;
/**
 * The canonical business-unit vocabulary (FIN-002; initial approved reporting units).
 *
 * IDs are authority; labels are presentation and live with the surfaces that render them.
 * Future governed units are ADDED here — never invented ad hoc at a call site.
 */
exports.BUSINESS_UNITS = Object.freeze(["SERVICE", "EQUIPMENT_SALES", "PARTS", "INSTALLATION"]);
const isBusinessUnitId = (v) => typeof v === "string" && exports.BUSINESS_UNITS.includes(v);
exports.isBusinessUnitId = isBusinessUnitId;
/**
 * The canonical source-lineage vocabulary. ONLY record types the model actually has today —
 * no persisted object exists solely to have a sourceType. WORK_ORDER is included because
 * fieldops_wos exists and Service billing (F4) will reference it; WORK_ORDER_CHARGE is NOT,
 * because no such record type exists yet.
 */
exports.FINANCIAL_SOURCE_TYPES = Object.freeze([
    "SALES_AGREEMENT",
    "SALES_ORDER",
    "SALES_ORDER_LINE",
    "WORK_ORDER",
    "INVOICE",
    "PAYMENT",
    "ADJUSTMENT",
    "REFUND",
]);
const isFinancialSourceType = (v) => typeof v === "string" && exports.FINANCIAL_SOURCE_TYPES.includes(v);
exports.isFinancialSourceType = isFinancialSourceType;
class AttributionError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "AttributionError";
    }
}
exports.AttributionError = AttributionError;
const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
const finiteNum = (v) => typeof v === "number" && Number.isFinite(v);
/**
 * Line-kind → business-unit derivation for commercial lines.
 *
 * EQUIPMENT_MODEL and PART classify themselves — the line kind IS the business fact. SERVICE does
 * NOT: a SERVICE line may be service work or installation work, and FIN-002's creation contract
 * refuses to let an ambiguous reportable line enter silently. The caller must say which — an
 * explicit `businessUnitId` of SERVICE or INSTALLATION is REQUIRED on a SERVICE-kind line.
 *
 * An explicit value on a self-classifying kind must MATCH the derivation — a PART line labelled
 * EQUIPMENT_SALES is a contradiction, not an override. Overrides/splits are FIN-009 allocation
 * policy, not a creation-time loophole.
 */
function deriveLineBusinessUnit(kind, explicitBusinessUnitId) {
    const explicit = nonEmpty(explicitBusinessUnitId) ? explicitBusinessUnitId.trim() : null;
    if (explicit !== null && !(0, exports.isBusinessUnitId)(explicit)) {
        throw new AttributionError("BUSINESS_UNIT_INVALID", `"${explicit}" is not a governed business unit id`);
    }
    if (kind === "EQUIPMENT_MODEL" || kind === "PART") {
        const derived = kind === "EQUIPMENT_MODEL" ? "EQUIPMENT_SALES" : "PARTS";
        if (explicit !== null && explicit !== derived) {
            throw new AttributionError("BUSINESS_UNIT_MISMATCH", `A ${kind} line is ${derived}; an explicit businessUnitId of ${explicit} contradicts the line itself. ` +
                "Cross-unit allocation is FIN-009 policy, not a line label.");
        }
        return derived;
    }
    // SERVICE — genuinely ambiguous between SERVICE and INSTALLATION. Refuse to guess.
    if (explicit === null) {
        throw new AttributionError("BUSINESS_UNIT_REQUIRED", "A SERVICE line must declare businessUnitId (SERVICE or INSTALLATION) — service and installation " +
            "work are different reporting units and the system will not guess which this is.");
    }
    if (explicit !== "SERVICE" && explicit !== "INSTALLATION") {
        throw new AttributionError("BUSINESS_UNIT_MISMATCH", `A SERVICE line is service or installation work; businessUnitId ${explicit} is neither.`);
    }
    return explicit;
}
/**
 * Work-order-type → business unit, from the EXISTING WorkOrderType authority
 * (functions/src/types/workOrder.ts) — INSTALL is installation work; every other current type is
 * service activity. Fail-closed: an unrecognised type yields null (UNKNOWN), never a guess.
 * FIN-002 vocabulary only — no Service billing is created here (that is Phase F4).
 */
function deriveWorkOrderBusinessUnit(workOrderType) {
    if (workOrderType === "INSTALL")
        return "INSTALLATION";
    if (workOrderType === "SERVICE_CALL" || workOrderType === "PM" || workOrderType === "WARRANTY" || workOrderType === "INSPECTION") {
        return "SERVICE";
    }
    return null;
}
/** Build (and validate) one frozen snapshot. The returned object is frozen — history, not state. */
function buildFinancialAttributionSnapshot(input) {
    if (!nonEmpty(input?.customerId)) {
        throw new AttributionError("CUSTOMER_REQUIRED", "A financial attribution snapshot requires customerId");
    }
    if (!(0, exports.isFinancialSourceType)(input.sourceType)) {
        throw new AttributionError("SOURCE_REQUIRED", `sourceType must be one of: ${exports.FINANCIAL_SOURCE_TYPES.join(", ")}`);
    }
    if (!nonEmpty(input.sourceRecordId)) {
        throw new AttributionError("SOURCE_REQUIRED", "sourceRecordId is required — every number must say where it came from");
    }
    if (!finiteNum(input.eventAtMillis) || input.eventAtMillis <= 0) {
        throw new AttributionError("EVENT_TIME_REQUIRED", "eventAtMillis must be a positive epoch-millis number");
    }
    if (!nonEmpty(input.currency)) {
        throw new AttributionError("CURRENCY_REQUIRED", "currency is explicit on every financial snapshot — never implied");
    }
    const bu = nonEmpty(input.businessUnitId) ? input.businessUnitId.trim() : null;
    if (bu !== null && !(0, exports.isBusinessUnitId)(bu)) {
        throw new AttributionError("BUSINESS_UNIT_INVALID", `"${bu}" is not a governed business unit id`);
    }
    const person = (v, label) => {
        if (v === undefined || v === null)
            return null;
        if (!nonEmpty(v))
            throw new AttributionError("PERSON_INVALID", `${label} must be a non-empty id or absent`);
        return v.trim();
    };
    // COMPANY: REQUIRED. Absent / null / empty-or-whitespace = unresolved upstream → COMPANY_REQUIRED.
    // A non-string value is a caller defect, not a resolution failure → COMPANY_INVALID.
    const company = (v) => {
        if (v !== undefined && v !== null && typeof v !== "string") {
            throw new AttributionError("COMPANY_INVALID", "operatingCompanyId must be a governed company id string");
        }
        if (!nonEmpty(v)) {
            throw new AttributionError("COMPANY_REQUIRED", "A reportable financial snapshot requires operatingCompanyId — resolve the governed company " +
                "upstream (explicit or inherited); it is never inferred, defaulted, or left to fill in later");
        }
        return v.trim();
    };
    return Object.freeze({
        operatingCompanyId: company(input.operatingCompanyId),
        businessUnitId: bu,
        creditedSalespersonId: person(input.creditedSalespersonId, "creditedSalespersonId"),
        responsibleEmployeeId: person(input.responsibleEmployeeId, "responsibleEmployeeId"),
        customerId: input.customerId.trim(),
        sourceType: input.sourceType,
        sourceRecordId: input.sourceRecordId.trim(),
        eventAtMillis: input.eventAtMillis,
        currency: input.currency.trim(),
    });
}
/**
 * Derive the governed company + customer for an invoice-downstream event from the INVOICE, treating
 * any caller-supplied ids as assertions only (mirror of the invoice↔Sales Order company correction).
 * `err` lets each command core throw its own typed error class with the shared codes
 * COMPANY_REQUIRED / COMPANY_MISMATCH / ACCOUNT_REQUIRED / ACCOUNT_MISMATCH.
 */
function requireInvoiceParty(input, invoice, err) {
    const invCompany = invoice?.companyId;
    const companyId = nonEmpty(invCompany) ? invCompany.trim() : null;
    if (!companyId) {
        throw err("COMPANY_REQUIRED", "the invoice carries no governed companyId; money moving against an invoice is a reportable financial event and cannot be recorded without its company");
    }
    const inCompany = input?.companyId;
    if (nonEmpty(inCompany) && inCompany.trim() !== companyId) {
        throw err("COMPANY_MISMATCH", `companyId "${inCompany}" does not match the invoice's governed companyId "${companyId}" — the caller does not choose the company`);
    }
    const invAccount = invoice?.accountId;
    const accountId = nonEmpty(invAccount) ? invAccount.trim() : null;
    if (!accountId) {
        throw err("ACCOUNT_REQUIRED", "the invoice carries no accountId; the event's customer comes from the governed invoice, never the caller");
    }
    const inAccount = input?.accountId;
    if (nonEmpty(inAccount) && inAccount.trim() !== accountId) {
        throw err("ACCOUNT_MISMATCH", `accountId "${inAccount}" does not match the invoice's accountId "${accountId}" — the caller does not choose the customer`);
    }
    return { companyId, accountId };
}
/**
 * Build the canonical snapshot for one invoice-downstream event. sourceType/sourceRecordId name the
 * governed record the facts came from (the invoice), mirroring how the invoice's own snapshot names
 * its Sales Order. eventAtMillis is the server record time (ctx-only, like bookedAtMillis).
 * Fails closed via the canonical builder: no invoice company ⇒ COMPANY_REQUIRED, no accountId ⇒
 * CUSTOMER_REQUIRED, no currency ⇒ CURRENCY_REQUIRED.
 */
function buildInvoiceEventAttribution(invoiceId, invoice, eventAtMillis) {
    return buildFinancialAttributionSnapshot({
        operatingCompanyId: invoice?.companyId ?? null,
        businessUnitId: invoice?.attribution?.businessUnitId ?? null,
        creditedSalespersonId: invoice?.attribution?.creditedSalespersonId ?? null,
        responsibleEmployeeId: invoice?.attribution?.responsibleEmployeeId ?? null,
        customerId: typeof invoice?.accountId === "string" ? invoice.accountId : "",
        sourceType: "INVOICE",
        sourceRecordId: invoiceId,
        eventAtMillis,
        currency: typeof invoice?.currency === "string" ? invoice.currency : "",
    });
}
/**
 * Default sales credit for a NEW commercial record (Owner policy, DECISIONS #154):
 * explicit credit wins; else the credit inherited from the governed upstream commercial record;
 * else the governed commercial OWNER at the point the sale enters the chain. NEVER the creating
 * actor — an assistant creating an Opportunity for Salesperson A's customer credits A, not the
 * assistant. Returns null only when nothing governed exists to credit (the caller decides whether
 * that is legal for its record type).
 */
function resolveCreditedSalesperson(explicit, inherited, commercialOwnerEmployeeId) {
    if (nonEmpty(explicit))
        return explicit.trim();
    if (nonEmpty(inherited))
        return inherited.trim();
    if (nonEmpty(commercialOwnerEmployeeId))
        return commercialOwnerEmployeeId.trim();
    return null;
}
//# sourceMappingURL=financialAttribution.js.map