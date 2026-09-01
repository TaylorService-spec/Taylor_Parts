// FIN-002 — THE ONE REPORTING-ATTRIBUTION AUTHORITY.
//
// Every reportable operational financial fact must ultimately answer: WHICH COMPANY, WHICH
// BUSINESS UNIT, WHICH CREDITED/RESPONSIBLE PERSON, WHICH CUSTOMER, WHICH SOURCE RECORD, WHICH
// EVENT TIME, WHICH CURRENCY. This module is the single definition of that vocabulary and of the
// snapshot those facts freeze into. There is deliberately NO Sales copy, NO Finance copy, NO
// Service copy — commercial commands, the dormant finance core, and future Service billing all
// import from here (docs/financials/FIN-002_REPORTING_ATTRIBUTION_MODEL.md; DECISIONS #152).
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

/**
 * The canonical business-unit vocabulary (FIN-002; initial approved reporting units).
 *
 * IDs are authority; labels are presentation and live with the surfaces that render them.
 * Future governed units are ADDED here — never invented ad hoc at a call site.
 */
export const BUSINESS_UNITS = Object.freeze(["SERVICE", "EQUIPMENT_SALES", "PARTS", "INSTALLATION"] as const);
export type BusinessUnitId = (typeof BUSINESS_UNITS)[number];
export const isBusinessUnitId = (v: unknown): v is BusinessUnitId =>
  typeof v === "string" && (BUSINESS_UNITS as readonly string[]).includes(v);

/**
 * The canonical source-lineage vocabulary. ONLY record types the model actually has today —
 * no persisted object exists solely to have a sourceType. WORK_ORDER is included because
 * fieldops_wos exists and Service billing (F4) will reference it; WORK_ORDER_CHARGE is NOT,
 * because no such record type exists yet.
 */
export const FINANCIAL_SOURCE_TYPES = Object.freeze([
  "SALES_AGREEMENT",
  "SALES_ORDER",
  "SALES_ORDER_LINE",
  "WORK_ORDER",
  "INVOICE",
  "PAYMENT",
  "ADJUSTMENT",
  "REFUND",
] as const);
export type FinancialSourceType = (typeof FINANCIAL_SOURCE_TYPES)[number];
export const isFinancialSourceType = (v: unknown): v is FinancialSourceType =>
  typeof v === "string" && (FINANCIAL_SOURCE_TYPES as readonly string[]).includes(v);

export type AttributionErrorCode =
  | "BUSINESS_UNIT_REQUIRED"
  | "BUSINESS_UNIT_INVALID"
  | "BUSINESS_UNIT_MISMATCH"
  | "COMPANY_INVALID"
  | "CUSTOMER_REQUIRED"
  | "SOURCE_REQUIRED"
  | "EVENT_TIME_REQUIRED"
  | "CURRENCY_REQUIRED"
  | "PERSON_INVALID";

export class AttributionError extends Error {
  code: AttributionErrorCode;
  constructor(code: AttributionErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "AttributionError";
  }
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const finiteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

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
export function deriveLineBusinessUnit(
  kind: "EQUIPMENT_MODEL" | "PART" | "SERVICE",
  explicitBusinessUnitId?: string | null
): BusinessUnitId {
  const explicit = nonEmpty(explicitBusinessUnitId) ? explicitBusinessUnitId.trim() : null;
  if (explicit !== null && !isBusinessUnitId(explicit)) {
    throw new AttributionError("BUSINESS_UNIT_INVALID", `"${explicit}" is not a governed business unit id`);
  }
  if (kind === "EQUIPMENT_MODEL" || kind === "PART") {
    const derived: BusinessUnitId = kind === "EQUIPMENT_MODEL" ? "EQUIPMENT_SALES" : "PARTS";
    if (explicit !== null && explicit !== derived) {
      throw new AttributionError(
        "BUSINESS_UNIT_MISMATCH",
        `A ${kind} line is ${derived}; an explicit businessUnitId of ${explicit} contradicts the line itself. ` +
          "Cross-unit allocation is FIN-009 policy, not a line label."
      );
    }
    return derived;
  }
  // SERVICE — genuinely ambiguous between SERVICE and INSTALLATION. Refuse to guess.
  if (explicit === null) {
    throw new AttributionError(
      "BUSINESS_UNIT_REQUIRED",
      "A SERVICE line must declare businessUnitId (SERVICE or INSTALLATION) — service and installation " +
        "work are different reporting units and the system will not guess which this is."
    );
  }
  if (explicit !== "SERVICE" && explicit !== "INSTALLATION") {
    throw new AttributionError(
      "BUSINESS_UNIT_MISMATCH",
      `A SERVICE line is service or installation work; businessUnitId ${explicit} is neither.`
    );
  }
  return explicit;
}

/**
 * Work-order-type → business unit, from the EXISTING WorkOrderType authority
 * (functions/src/types/workOrder.ts) — INSTALL is installation work; every other current type is
 * service activity. Fail-closed: an unrecognised type yields null (UNKNOWN), never a guess.
 * FIN-002 vocabulary only — no Service billing is created here (that is Phase F4).
 */
export function deriveWorkOrderBusinessUnit(workOrderType: unknown): BusinessUnitId | null {
  if (workOrderType === "INSTALL") return "INSTALLATION";
  if (workOrderType === "SERVICE_CALL" || workOrderType === "PM" || workOrderType === "WARRANTY" || workOrderType === "INSPECTION") {
    return "SERVICE";
  }
  return null;
}

/**
 * The event-time attribution snapshot every reportable financial event preserves.
 *
 * Not every dimension is valid for every event: a payment has no credited salesperson of its own,
 * a Service fact may have a responsible technician and no sales credit. Company, business unit and
 * both person dimensions are therefore NULLABLE — null means "this event genuinely has no such
 * attribution", recorded honestly, never a value waiting to be inferred later. Customer, source
 * lineage, event time and currency are REQUIRED on every snapshot: an event that cannot say whose
 * money, from where, when, in what currency is not reportable at all.
 */
export interface FinancialAttributionSnapshot {
  operatingCompanyId: string | null;
  businessUnitId: BusinessUnitId | null;
  creditedSalespersonId: string | null;
  responsibleEmployeeId: string | null;
  customerId: string;
  sourceType: FinancialSourceType;
  sourceRecordId: string;
  eventAtMillis: number;
  currency: string;
}

export interface BuildAttributionInput {
  operatingCompanyId?: string | null;
  businessUnitId?: string | null;
  creditedSalespersonId?: string | null;
  responsibleEmployeeId?: string | null;
  customerId: string;
  sourceType: string;
  sourceRecordId: string;
  eventAtMillis: number;
  currency: string;
}

/** Build (and validate) one frozen snapshot. The returned object is frozen — history, not state. */
export function buildFinancialAttributionSnapshot(input: BuildAttributionInput): FinancialAttributionSnapshot {
  if (!nonEmpty(input?.customerId)) {
    throw new AttributionError("CUSTOMER_REQUIRED", "A financial attribution snapshot requires customerId");
  }
  if (!isFinancialSourceType(input.sourceType)) {
    throw new AttributionError("SOURCE_REQUIRED", `sourceType must be one of: ${FINANCIAL_SOURCE_TYPES.join(", ")}`);
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
  if (bu !== null && !isBusinessUnitId(bu)) {
    throw new AttributionError("BUSINESS_UNIT_INVALID", `"${bu}" is not a governed business unit id`);
  }
  const person = (v: unknown, label: string): string | null => {
    if (v === undefined || v === null) return null;
    if (!nonEmpty(v)) throw new AttributionError("PERSON_INVALID", `${label} must be a non-empty id or absent`);
    return v.trim();
  };
  const company = (v: unknown): string | null => {
    if (v === undefined || v === null) return null;
    if (!nonEmpty(v)) throw new AttributionError("COMPANY_INVALID", "operatingCompanyId must be a non-empty id or absent");
    return v.trim();
  };
  return Object.freeze({
    operatingCompanyId: company(input.operatingCompanyId),
    businessUnitId: bu as BusinessUnitId | null,
    creditedSalespersonId: person(input.creditedSalespersonId, "creditedSalespersonId"),
    responsibleEmployeeId: person(input.responsibleEmployeeId, "responsibleEmployeeId"),
    customerId: input.customerId.trim(),
    sourceType: input.sourceType as FinancialSourceType,
    sourceRecordId: input.sourceRecordId.trim(),
    eventAtMillis: input.eventAtMillis,
    currency: input.currency.trim(),
  });
}

/**
 * Default sales credit for a NEW commercial record (Owner policy, DECISIONS #152):
 * explicit credit wins; else the credit inherited from the governed upstream commercial record;
 * else the governed commercial OWNER at the point the sale enters the chain. NEVER the creating
 * actor — an assistant creating an Opportunity for Salesperson A's customer credits A, not the
 * assistant. Returns null only when nothing governed exists to credit (the caller decides whether
 * that is legal for its record type).
 */
export function resolveCreditedSalesperson(
  explicit: string | null | undefined,
  inherited: string | null | undefined,
  commercialOwnerEmployeeId: string | null | undefined
): string | null {
  if (nonEmpty(explicit)) return explicit.trim();
  if (nonEmpty(inherited)) return inherited.trim();
  if (nonEmpty(commercialOwnerEmployeeId)) return commercialOwnerEmployeeId.trim();
  return null;
}
