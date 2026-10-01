// SECURITY ROLE ASSIGNMENT SCOPE -- THE RUNTIME HALF (lane SC, 2026-09-26).
//
// Pure: no database, no Firebase, no I/O. `assignmentScope.ts` answers "does this assignment's scope admit this
// decision". This file answers the two questions that come before it:
//
//   1. WHICH scope types can the runtime decide at all, and from WHICH record fact (the business context)?
//   2. WHICH capabilities have a gate site that actually supplies that business context?
//
// Effective authority is:
//
//   Principal -> Security Role assignment -> capability -> ASSIGNMENT SCOPE -> record business context
//             -> record relationship (grant condition) -> domain preconditions
//
// ════════════════════ A SCOPED ASSIGNMENT NEVER BEHAVES AS GLOBAL ════════════════════
//
// A scoped assignment contributes NOTHING to the flat capability set. It contributes SCOPE-QUALIFIED HOLDINGS
// (`ScopedHolding`), and only for capabilities listed in SCOPE_EVALUABLE_GRANTS for that scope type -- i.e. only
// where a real gate site hands the decision the record's business context. Every other capability the scoped Role
// carries is INERT at that scope, reported as such, and grants nothing. A decision that supplies no context for the
// holding's scope type, or a different value, is REFUSED.
//
// ════════════════════ NO CONFIGURATION THE RUNTIME IGNORES ════════════════════
//
// Administration may only create a scoped assignment whose scope type has at least one consumer AND whose Role
// carries at least one capability evaluable at that scope (the R-32 "some-binding, never every-binding" rule,
// DECISIONS #152). A scope type with no consumer is refused at assignRole. The list below is therefore the single
// statement of what scoped Security Role authority means today; adding a consumer is a reviewed edit here plus the
// gate site that supplies the context.
//
// SALES CHANNEL (lane GA, 2026-09-26) IS a scope type now, because it has what pass 8 §9.1 said it lacked: governed
// values (eos_policy.tenant_sales_channels over the Commercial record vocabulary eos_commercial.commercial_sales_channel)
// and real consumers -- the PostgreSQL Commercial reads, which supply the record's STORED sales_channel as business
// context and filter lists in SQL. A channel is a scope VALUE, never a Role: one Security Role (e.g. salesManager) is
// assigned once per channel, and nothing derives a channel from a Job Role, a Functional Role or a Role definition.
import { VALUE_MATCHED_SCOPE_TYPES } from "./assignmentScope";
import { ADMINISTRATION_READ_CAPABILITY_KEYS } from "./administrationSurfaceAuthority";

/** The value-matched assignment scope types this runtime knows how to decide. `domain` has no record fact. */
export const ASSIGNMENT_SCOPE_RUNTIME_TYPES = Object.freeze(["operatingCompany", "businessUnit", "location", "salesChannel"] as const);
export type AssignmentScopeRuntimeType = (typeof ASSIGNMENT_SCOPE_RUNTIME_TYPES)[number];

/** The record fact a gate site supplies for each scope type. Resolved server-side from the governed record. */
export type BusinessContextKey = "operatingCompanyId" | "businessUnit" | "warehouseId" | "salesChannel";
export type BusinessContext = Readonly<Partial<Record<BusinessContextKey, string>>>;

export interface AssignmentScopeDimension {
  readonly scopeType: AssignmentScopeRuntimeType;
  /** How Administration names it. */
  readonly label: string;
  /** The business-context key a gate site must supply for a scoped holding to be decided. */
  readonly contextKey: BusinessContextKey;
  /** Where a valid scope VALUE comes from, tenant-scoped. Values are validated against it on assignRole. */
  readonly valueSource: string;
}

export const ASSIGNMENT_SCOPE_DIMENSIONS: Readonly<Record<AssignmentScopeRuntimeType, AssignmentScopeDimension>> = Object.freeze({
  operatingCompany: Object.freeze({
    scopeType: "operatingCompany", label: "Company", contextKey: "operatingCompanyId",
    valueSource: "eos_policy.tenant_operating_companies (ACTIVE, this tenant)",
  }),
  businessUnit: Object.freeze({
    scopeType: "businessUnit", label: "Business Unit", contextKey: "businessUnit",
    valueSource: "none governed per tenant (FIN-002 BUSINESS_UNITS is a platform constant, not tenant Administration data)",
  }),
  // R-29 (#150): `location` IS the warehouse-scope authority; its value is a governed warehouse id.
  location: Object.freeze({
    scopeType: "location", label: "Warehouse", contextKey: "warehouseId",
    valueSource: "eos_ops.warehouses (ACTIVE, this tenant)",
  }),
  // Lane GA: the record's STORED channel (opportunities.sales_channel; an Agreement's is its Opportunity's;
  // sales_orders.sales_channel). Values: the channels THIS tenant has activated.
  salesChannel: Object.freeze({
    scopeType: "salesChannel", label: "Sales Channel", contextKey: "salesChannel",
    valueSource: "eos_policy.tenant_sales_channels (ACTIVE, this tenant; vocabulary eos_commercial.commercial_sales_channel)",
  }),
});

export interface ScopeEvaluableGrant {
  readonly scopeType: AssignmentScopeRuntimeType;
  readonly capabilityKey: string;
  /** The gate sites (transport.operation) that resolve the record's business context and decide the holding. */
  readonly consumers: readonly string[];
}

/**
 * THE CONSUMERS. A (scope type, capability) pair appears here only when every listed gate site resolves the
 * record's business context server-side and decides scoped holdings with `authorizeEntitledAction`.
 *
 *   operatingCompany x employee.record.read  -- the Employee's governed eos_workforce.employees.operating_company_id,
 *                                               read inside the read's own snapshot.
 *   salesChannel x opportunity.read / salesAgreement.read / salesOrder.read
 *                                            -- the record's STORED sales channel, read in the Commercial read's own
 *                                               snapshot (an Agreement's is its source Opportunity's, joined in the
 *                                               same statement). A record with NO channel admits no scoped holder.
 *   salesChannel x opportunity.write / opportunity.createSalesOrder / salesAgreement.create / .updateDraft / .accept /
 *                  salesOrder.write         -- DQ-020 (Controller 2026-09-28): Commercial WRITES are not tenant-wide.
 *                                               Each command decides the holding against the GOVERNING channel of the
 *                                               record it writes, fixed by the record's relationship (a create: the
 *                                               channel it is created in; an Agreement: its source Opportunity's; an
 *                                               edit that moves the channel: both), inside its own transaction
 *                                               (the Commercial command kernel's CommercialWriteScope).
 *
 * businessUnit and location have NO PostgreSQL consumer today: FIN-004 company/BU reach is still bound through
 * Firestore roleAssignments (finance/financeReadCallables.ts), Commercial carries a business unit per LINE and its
 * kernels are flat-set only, and the R-32 location-scoped reorder/inventory bindings live on the legacy Firebase path
 * (Reorder cutover #1961 HELD). The evaluator can decide them; Administration refuses them until a consumer lands.
 */
export const SCOPE_EVALUABLE_GRANTS: readonly ScopeEvaluableGrant[] = Object.freeze([
  Object.freeze({
    scopeType: "operatingCompany" as const,
    capabilityKey: "employee.record.read",
    consumers: Object.freeze(["workforce.readEmployee", "workforce.listEmployees", "workforce.listManagedEmployees"]),
  }),
  Object.freeze({
    scopeType: "salesChannel" as const,
    capabilityKey: "opportunity.read",
    consumers: Object.freeze(["commercial.getOpportunityDetail", "commercial.listOpportunities", "commercial.getAccountCommercialProjection"]),
  }),
  Object.freeze({
    scopeType: "salesChannel" as const,
    capabilityKey: "salesAgreement.read",
    consumers: Object.freeze(["commercial.getSalesAgreementDetail", "commercial.listSalesAgreements", "commercial.getAccountCommercialProjection"]),
  }),
  Object.freeze({
    scopeType: "salesChannel" as const,
    capabilityKey: "salesOrder.read",
    consumers: Object.freeze(["commercial.getSalesOrderDetail", "commercial.listSalesOrders", "commercial.getAccountCommercialProjection"]),
  }),
  // DQ-020: the Commercial WRITES, each decided against the governing channel of the record it writes.
  Object.freeze({
    scopeType: "salesChannel" as const,
    capabilityKey: "opportunity.write",
    consumers: Object.freeze(["commercial.createOpportunity", "commercial.updateOpportunity", "commercial.transitionOpportunity", "commercial.closeOpportunityAsWon"]),
  }),
  Object.freeze({
    scopeType: "salesChannel" as const,
    capabilityKey: "opportunity.createSalesOrder",
    consumers: Object.freeze(["commercial.closeOpportunityAsWon", "commercial.createSalesOrderFromOpportunity"]),
  }),
  Object.freeze({
    scopeType: "salesChannel" as const,
    capabilityKey: "salesAgreement.create",
    consumers: Object.freeze(["commercial.createSalesAgreement"]),
  }),
  Object.freeze({
    scopeType: "salesChannel" as const,
    capabilityKey: "salesAgreement.updateDraft",
    consumers: Object.freeze(["commercial.updateSalesAgreementDraft"]),
  }),
  Object.freeze({
    scopeType: "salesChannel" as const,
    capabilityKey: "salesAgreement.accept",
    consumers: Object.freeze(["commercial.acceptSalesAgreement"]),
  }),
  Object.freeze({
    scopeType: "salesChannel" as const,
    capabilityKey: "salesOrder.write",
    consumers: Object.freeze(["commercial.createSalesOrder", "commercial.transitionSalesOrder"]),
  }),
  // EQUIPMENT ACTIVATION (Controller OD-3, 2026-10-01): a seller reads customer Equipment ONLY through the governed
  // commercial relationship -- an Equipment record is admitted when its Account has an Opportunity or a Sales Order whose
  // STORED channel the holding admits, decided in the register read's own query (eosOps/equipmentOperations.ts).
  Object.freeze({
    scopeType: "salesChannel" as const,
    capabilityKey: "equipment.record.read",
    consumers: Object.freeze(["equipment.listEquipment", "equipment.readEquipment"]),
  }),
]);

/** Why a scope type is not assignable, when it is not. */
export const UNSUPPORTED_SCOPE_REASONS: Readonly<Record<string, string>> = Object.freeze({
  global: "global is not a scope: it is the unscoped assignment",
  tenant: "reserved and inert (spec 5.4, Issue #140); it must never widen access",
  domain: "no governed record carries a domain fact, so no gate can decide it",
  ownAssignment: "a per-record relationship, not a scope: use a RECORD_ASSIGNMENT grant condition",
  businessUnit: "no PostgreSQL gate supplies a record's business unit (FIN-004 reach is Firestore-bound; Commercial carries BU per line), and no tenant-governed value source exists",
  location: "no PostgreSQL gate supplies a record's warehouse (R-32 location bindings are on the legacy path; Reorder cutover held)",
});

const exactValue = (v: unknown): v is string => typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200;

export const isAssignmentScopeRuntimeType = (t: unknown): t is AssignmentScopeRuntimeType =>
  typeof t === "string" && (ASSIGNMENT_SCOPE_RUNTIME_TYPES as readonly string[]).includes(t)
  && (VALUE_MATCHED_SCOPE_TYPES as readonly string[]).includes(t);

/** Capabilities a scoped assignment of this type can confer. Empty for an unknown or unconsumed type. */
export function scopeEvaluableCapabilities(scopeType: unknown): ReadonlySet<string> {
  return new Set(SCOPE_EVALUABLE_GRANTS.filter((g) => g.scopeType === scopeType).map((g) => g.capabilityKey));
}

/** A scope type Administration may assign: known to the runtime AND consumed by at least one gate site. */
export const isRuntimeSupportedScopeType = (t: unknown): t is AssignmentScopeRuntimeType =>
  isAssignmentScopeRuntimeType(t) && scopeEvaluableCapabilities(t).size > 0;

export function runtimeSupportedScopeTypes(): readonly AssignmentScopeRuntimeType[] {
  return ASSIGNMENT_SCOPE_RUNTIME_TYPES.filter((t) => isRuntimeSupportedScopeType(t));
}

/** One qualifying, non-global assignment, as the principal context carries it. */
export interface ScopedAssignment {
  readonly assignmentId: string | null;
  readonly roleKey: string;
  readonly scopeType: string;
  readonly scopeValue: string | null;
}

/**
 * A capability held ONLY within one assignment scope. Never in the flat set; decided only by the entitled seam, and
 * only when the decision supplies the record's business context for `scopeType`.
 */
export interface ScopedHolding<C = unknown> {
  readonly capabilityKey: string;
  readonly scopeType: AssignmentScopeRuntimeType;
  readonly scopeValue: string;
  readonly sourceRole: string;
  readonly assignmentId: string | null;
  /** The grant condition on (sourceRole, capabilityKey), when there is one. It narrows further; never widens. */
  readonly condition: C | null;
}

/** A scoped assignment's capability that the runtime cannot decide at that scope: reported, grants nothing. */
export interface InertScopedCapability {
  readonly capabilityKey: string;
  readonly scopeType: string;
  readonly scopeValue: string | null;
  readonly sourceRole: string;
  readonly reason: "SCOPE_NOT_EVALUABLE_FOR_CAPABILITY" | "SCOPE_TYPE_UNSUPPORTED";
}

/**
 * Turn scoped assignments + their Roles' grants into holdings. Pure; the caller supplies the grant rows (the SAME
 * role_capabilities join the flat set uses) and the condition lookup (the SAME catalog).
 */
export function scopedHoldingsFrom<C>(
  assignments: readonly ScopedAssignment[],
  grants: readonly { readonly roleKey: string; readonly capabilityKey: string }[],
  conditionOf: (roleKey: string, capabilityKey: string) => C | null,
): { readonly held: readonly ScopedHolding<C>[]; readonly inert: readonly InertScopedCapability[] } {
  const held: ScopedHolding<C>[] = [];
  const inert: InertScopedCapability[] = [];
  const seen = new Set<string>();
  for (const a of assignments) {
    const supported = isRuntimeSupportedScopeType(a.scopeType) && exactValue(a.scopeValue);
    const evaluable = supported ? scopeEvaluableCapabilities(a.scopeType) : new Set<string>();
    for (const g of grants) {
      if (g.roleKey !== a.roleKey) continue;
      if (!supported) {
        inert.push(Object.freeze({ capabilityKey: g.capabilityKey, scopeType: a.scopeType, scopeValue: a.scopeValue,
          sourceRole: a.roleKey, reason: "SCOPE_TYPE_UNSUPPORTED" as const }));
        continue;
      }
      if (!evaluable.has(g.capabilityKey)) {
        inert.push(Object.freeze({ capabilityKey: g.capabilityKey, scopeType: a.scopeType, scopeValue: a.scopeValue,
          sourceRole: a.roleKey, reason: "SCOPE_NOT_EVALUABLE_FOR_CAPABILITY" as const }));
        continue;
      }
      const key = `${a.roleKey}|${g.capabilityKey}|${a.scopeType}|${a.scopeValue}`;
      if (seen.has(key)) continue;
      seen.add(key);
      held.push(Object.freeze({
        capabilityKey: g.capabilityKey, scopeType: a.scopeType as AssignmentScopeRuntimeType, scopeValue: a.scopeValue as string,
        sourceRole: a.roleKey, assignmentId: a.assignmentId, condition: conditionOf(a.roleKey, g.capabilityKey),
      }));
    }
  }
  const order = (x: { capabilityKey: string; sourceRole: string; scopeType: string; scopeValue: string | null }) =>
    `${x.capabilityKey}|${x.sourceRole}|${x.scopeType}|${x.scopeValue ?? ""}`;
  return {
    held: Object.freeze(held.sort((x, y) => order(x).localeCompare(order(y)))),
    inert: Object.freeze(inert.sort((x, y) => order(x).localeCompare(order(y)))),
  };
}

export type HoldingAdmission = "ADMITTED" | "SCOPE_CONTEXT_REQUIRED" | "OUTSIDE_ASSIGNMENT_SCOPE" | "SCOPE_NOT_EVALUABLE";

/**
 * Does the record's business context admit this holding? Fail-closed: an unconsumed type, a missing or malformed
 * context value, and a different value are all refusals. Only an exact same-type match admits.
 */
export function holdingAdmits(
  holding: Pick<ScopedHolding, "scopeType" | "scopeValue" | "capabilityKey">,
  context: BusinessContext | null | undefined,
): HoldingAdmission {
  if (!isRuntimeSupportedScopeType(holding?.scopeType) || !scopeEvaluableCapabilities(holding.scopeType).has(holding.capabilityKey)) {
    return "SCOPE_NOT_EVALUABLE";
  }
  if (!exactValue(holding.scopeValue)) return "SCOPE_NOT_EVALUABLE";
  const value = context?.[ASSIGNMENT_SCOPE_DIMENSIONS[holding.scopeType].contextKey];
  if (!exactValue(value)) return "SCOPE_CONTEXT_REQUIRED";
  return value === holding.scopeValue ? "ADMITTED" : "OUTSIDE_ASSIGNMENT_SCOPE";
}

/**
 * The scope values under which this capability is held UNCONDITIONALLY through scoped holdings -- for a list read
 * that must filter to them. Conditioned holdings are excluded (a list cannot evaluate a per-record condition).
 */
export function admittedScopeValues(
  holdings: readonly ScopedHolding[] | undefined, capabilityKey: string, scopeType: AssignmentScopeRuntimeType,
): readonly string[] {
  return [...new Set((holdings ?? [])
    .filter((h) => h.capabilityKey === capabilityKey && h.scopeType === scopeType && h.condition === null
      && holdingAdmits(h, { [ASSIGNMENT_SCOPE_DIMENSIONS[scopeType].contextKey]: h.scopeValue }) === "ADMITTED")
    .map((h) => h.scopeValue))].sort();
}

/**
 * THE ADMINISTRATION CAPABILITIES -- defined ONCE (Pass 9 S2). Every key that gates an Administration surface or
 * mutation: `admin.*`, every Administration surface READ key (ADMINISTRATION_READ_CAPABILITY_KEYS, e.g.
 * audit.event.read, workflowDefinition.read) and every `workflowDefinition.*` administration key. Every such gate reads
 * the tenant-wide flat set, so a Role carrying one is refused a scope ("Auditor @ Company X" would read the whole
 * tenant's audit trail), and one may never be granted to a Role that already has scoped holders. Anti-lockout keeps
 * counting GLOBAL holders only.
 */
export const ADMINISTRATION_CAPABILITY_PREFIXES: readonly string[] = Object.freeze(["admin.", "workflowDefinition."]);
export const isAdministrationCapability = (key: string): boolean => typeof key === "string"
  && (ADMINISTRATION_CAPABILITY_PREFIXES.some((p) => key.startsWith(p)) || ADMINISTRATION_READ_CAPABILITY_KEYS.includes(key));
