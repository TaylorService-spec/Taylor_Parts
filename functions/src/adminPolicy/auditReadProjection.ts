/**
 * AUDIT READ PROJECTION -- the closed per-kind registry for `readPolicyAuditHistory` (PR 5a, access-NEUTRAL).
 *
 * `eos_policy.audit_events` is one append-only trail written by every governed domain. The Administration audit read
 * (gate `audit.event.read`) returns its rows, `before`/`after` included. Some of those rows are control-plane facts --
 * exactly what `audit.event.read` exists to show -- and some carry BUSINESS RECORD values (an Employee's profile, a
 * supplier's terms, a reorder's quantities) that a reader of the audit trail may not be entitled to read at the record.
 *
 * This module CLASSIFIES every `target_kind` a writer in code produces, closed and pure:
 *
 *   PASS_THROUGH           governance / control-plane kinds -- their values ARE the audit read's purpose.
 *   PASS_THROUGH_EVIDENCE  one-shot migration / cutover receipts -- digests and counts, no record values.
 *   VALUE_GATED            business kinds; the PROPOSED record-read gate is recorded here AS DATA.
 *   (anything else)        UNKNOWN -- see below.
 *
 * ════════════════════ WHAT PR 5a ENFORCES, AND WHAT IT DOES NOT ════════════════════
 *
 * PR 5a is ACCESS-NEUTRAL by Owner ruling: it withholds NO value from any reader who sees it today. So:
 *
 *   * A VALUE_GATED gate is ENFORCED only when every role that holds `audit.event.read` today already holds the gate
 *     UNCONDITIONALLY at role level (repository authority baseline + the nonprod census, zero direct grants of
 *     `audit.event.read`, and an Administration read key may never ride a scoped assignment). That is true for
 *     exactly `inventory.transaction.read`, i.e. the `binPlacement` and `stockRelocation` kinds. For every current
 *     reader the enforced gate is satisfied, so every response stays byte-identical.
 *   * Every other VALUE_GATED gate is RECORDED_NOT_ENFORCED -- its values pass through unchanged. Enforcing it would
 *     remove access from at least one current audit.event.read role; that is PR 5b, HELD for the Owner.
 *   * An UNKNOWN kind FAILS CLOSED (Owner, 2026-10-13): its values are withheld from EVERY reader, the Owner and the
 *     Administrator included (`valuesWithheld.reason = "UNREGISTERED_KIND"`, `requires: []`). This is access-neutral
 *     today because every kind written by code AND every kind present in nonprod data is registered, so no existing
 *     row is UNKNOWN. The static writer-kind coverage test (auditReadProjectionRegistry.test.mjs) makes an
 *     unregistered writer kind a CI failure, so a new writer is caught before it degrades to metadata-only.
 *
 * The projector never drops, reorders or adds a row (no existence oracle, no paging drift); it may only replace
 * `before`/`after` of an UNKNOWN row, or of a row whose ENFORCED gate the reader does not hold. A stored `{ withheld: true }` is never
 * replaced -- the projector never un-withholds.
 *
 * PURE: no repository, no clock, no Firebase. The caller resolves the reader's effective access ONCE per read.
 */
import type { PolicyAuditEventRecord } from "./types";

export type AuditKindClass = "PASS_THROUGH" | "PASS_THROUGH_EVIDENCE" | "VALUE_GATED";

/** Whether a VALUE_GATED gate is applied by this build. Only ENFORCED gates ever change a response. */
export type AuditGateEnforcement = "ENFORCED" | "RECORDED_NOT_ENFORCED";

/**
 * The proposed record-read gate of a VALUE_GATED kind, recorded as data.
 *
 * `requires` is the set of capability keys a reader must hold (ALL of them). An EMPTY `requires` with a `decision`
 * means the Object has no read capability today and the gate is an Owner decision (D2) -- `candidate` names the key
 * the design proposes, if any. `decision: "D5"` marks a proposed gate that is itself still an Owner decision. `actionRequires` adds keys for specific actions (e.g. principal-link events also
 * reveal Principal identity). `fieldGroupsObject` names the Object whose governed field groups additionally apply.
 */
export interface AuditValueGate {
  readonly requires: readonly string[];
  readonly enforcement: AuditGateEnforcement;
  readonly actionRequires?: Readonly<Record<string, readonly string[]>>;
  readonly fieldGroupsObject?: string;
  readonly decision?: "D2" | "D5";
  readonly candidate?: string | null;
}

export type AuditKindEntry =
  | { readonly class: "PASS_THROUGH" }
  | { readonly class: "PASS_THROUGH_EVIDENCE" }
  | { readonly class: "VALUE_GATED"; readonly gate: AuditValueGate };

const PASS = Object.freeze({ class: "PASS_THROUGH" as const });
const EVIDENCE = Object.freeze({ class: "PASS_THROUGH_EVIDENCE" as const });
const recorded = (requires: readonly string[], extra: Omit<AuditValueGate, "requires" | "enforcement"> = {}): AuditKindEntry =>
  Object.freeze({ class: "VALUE_GATED" as const, gate: Object.freeze({ requires: Object.freeze([...requires]), enforcement: "RECORDED_NOT_ENFORCED" as const, ...extra }) });
const enforced = (requires: readonly string[]): AuditKindEntry =>
  Object.freeze({ class: "VALUE_GATED" as const, gate: Object.freeze({ requires: Object.freeze([...requires]), enforcement: "ENFORCED" as const }) });
const d2 = (candidate: string | null): AuditKindEntry => recorded([], { decision: "D2", candidate });

const PRINCIPAL_LINK_REQUIRES = Object.freeze(["employee.record.read", "admin.principalAccess.read"]);

/**
 * THE REGISTRY. Closed: one entry per `target_kind` written by code in functions/src and functions/scripts today.
 * Keyed by kind, never by action (the `authorization` kind writes a variable `<domain>.<operation>.denied` action, and
 * the kind is what names the record).
 */
export const AUDIT_KIND_REGISTRY: Readonly<Record<string, AuditKindEntry>> = Object.freeze({
  // ── governance / control plane ──
  role: PASS,
  roleAssignment: PASS,
  roleCapability: PASS,
  principalCapability: PASS,
  grantCondition: PASS,
  roleObjectPermission: PASS,
  roleFieldOverride: PASS,
  object: PASS,
  objectField: PASS,
  tenantSalesChannel: PASS,
  principal: PASS,
  tenant: PASS,
  tenantMembership: PASS,
  workflowVersion: PASS,
  workflowInstance: PASS,
  eosSession: PASS,
  // EOS native login (#2067): the authentication-event retention policy is governance configuration.
  securityEventRetention: PASS,
  authorization: PASS,
  jobRole: PASS,
  functionalRole: PASS,
  operating_company_setting: PASS,

  // ── one-shot migration / cutover receipts ──
  catalog_snapshot: EVIDENCE,
  crm_cutover: EVIDENCE,
  commercial_snapshot: EVIDENCE,
  employee_profile_snapshot: EVIDENCE,
  inventoryBaseline: EVIDENCE,
  reorder_assignment_migration: EVIDENCE,
  reorder_object_migration: EVIDENCE,
  reorder_purchase_order_migration: EVIDENCE,
  workOrderQuarantine: EVIDENCE,

  // ── business records: ENFORCED (every current audit.event.read role holds the gate; neutral today) ──
  binPlacement: enforced(["inventory.transaction.read"]),
  stockRelocation: enforced(["inventory.transaction.read"]),

  // ── business records: gate RECORDED, NOT ENFORCED (enforcing would remove access today -- PR 5b, Owner D1) ──
  employee: recorded(["employee.record.read"], {
    actionRequires: Object.freeze({
      "employee.principalLink.establish": PRINCIPAL_LINK_REQUIRES,
      "employee.principalLink.revoke": PRINCIPAL_LINK_REQUIRES,
      "employee.principalLink.relink": PRINCIPAL_LINK_REQUIRES,
    }),
  }),
  part: recorded(["inventory.catalog.read"]),
  part_alias: recorded(["inventory.catalog.alias.read"]),
  equipment_model: recorded(["equipment.compatibility.view"]),
  manufacturer: recorded(["inventory.manufacturer.read"]),
  part_supplier_item: recorded(["inventory.supplierTerms.read"], { fieldGroupsObject: "supplierCatalogItem" }),
  supplier: recorded(["supplier.record.read"]),
  reorder_request: recorded(["reorder.request.read"]),
  reorderRequest: recorded(["reorder.request.read"]),
  purchase_order: recorded(["reorder.purchaseOrder.read"]),
  receiving_order: recorded(["receivingOrder.record.read"]),
  inboundWorkRequest: recorded(["inboundWork.request.read"]),
  workOrder: recorded(["workOrder.record.read"]),
  sales_order: recorded(["salesOrder.read"]),
  rental_agreement: recorded(["rental.agreement.read"]),
  rental_assignment: recorded(["rental.agreement.read"]),
  rental_charge: recorded(["rental.agreement.read"]),
  rental_fleet_unit: recorded(["rental.agreement.read"]),
  warehouse: recorded(["warehouse.record.read"]),
  bin: recorded(["warehouse.record.read"]),
  transferOrder: recorded(["warehouse.transferOrder.read"]),
  serializedAsset: recorded(["inventory.serializedAsset.read"]),
  // EOS native login (#2067): before/after carry principalId, loginIdentifier and subject -- identity data. Proposed
  // gate recorded as data only (Owner decision D5 candidate); NOT enforced in 5a.
  loginAccount: recorded(["admin.principalAccess.read"], { decision: "D5" }),

  // ── business records whose Object has no read capability today: the gate is an Owner decision (D2) ──
  inboundMailbox: d2("inboundWork.intake.manage"),
  inboundRoutingRule: d2("inboundWork.intake.manage"),
  inboundProviderConnection: d2("inboundWork.intake.manage"),
  selfSchedulingPolicy: d2("workOrder.selfScheduling.configure"),
  sales_discount_authority: d2(null),
  billing_package: d2("finance.invoice.read"),
  accounting_destination: d2(null),
  counterparty_company_profile: d2(null),
  truck: d2(null),
  mobileLocation: d2(null),
  mobileLocationScopeBinding: d2("inventory.location.scopeBinding.manage"),
  cycleCountSheet: d2(null),
  cycleCountLine: d2(null),
});

export const REGISTERED_AUDIT_KINDS: readonly string[] = Object.freeze(Object.keys(AUDIT_KIND_REGISTRY).sort());

/** The registry entry for a kind, or "UNKNOWN" for a kind no writer in code declares. */
export function classifyAuditKind(targetKind: string): AuditKindEntry | "UNKNOWN" {
  return Object.prototype.hasOwnProperty.call(AUDIT_KIND_REGISTRY, targetKind) ? AUDIT_KIND_REGISTRY[targetKind] : "UNKNOWN";
}

/** The capability keys a reader must hold to see this row's values, IF its gate is enforced; null when ungated. */
export function enforcedRequirementsFor(targetKind: string, action: string): readonly string[] | null {
  const entry = classifyAuditKind(targetKind);
  if (entry === "UNKNOWN" || entry.class !== "VALUE_GATED" || entry.gate.enforcement !== "ENFORCED") return null;
  const extra = entry.gate.actionRequires?.[action] ?? [];
  return [...new Set([...entry.gate.requires, ...extra])].sort();
}

/**
 * Kinds whose JSON payload a content filter (principalId, roleKey, objectKey, ...) must NOT match: a JSON match on a
 * row whose values may be withheld is a value oracle. Exactly the ENFORCED kinds; their writers' payloads carry none
 * of the filter keys, so excluding them changes no filter result today (proved in auditReadProjectionPostgres).
 */
export const CONTENT_FILTER_EXCLUDED_KINDS: readonly string[] = Object.freeze(
  REGISTERED_AUDIT_KINDS.filter((k) => {
    const e = AUDIT_KIND_REGISTRY[k];
    return e.class === "VALUE_GATED" && e.gate.enforcement === "ENFORCED";
  }),
);

/**
 * The ONLY kinds whose JSON payload a content filter may match: the registered kinds minus the ENFORCED ones. An UNKNOWN
 * kind fails closed for every reader, so a content match on it would be a value oracle too. Every kind present in data
 * is registered today, so restricting to this list changes no filter result (proved in auditReadProjectionPostgres).
 */
export const CONTENT_FILTER_KINDS: readonly string[] = Object.freeze(
  REGISTERED_AUDIT_KINDS.filter((k) => !CONTENT_FILTER_EXCLUDED_KINDS.includes(k)),
);

// ════════════════════ wire contract ════════════════════

export type AuditValuesWithheldReason = "RECORD_READ_REQUIRED" | "UNREGISTERED_KIND";

/** The marker on a row whose values were withheld from this reader. */
export interface AuditValuesWithheld {
  readonly reason: AuditValuesWithheldReason;
  readonly requires: readonly string[];
}

/**
 * A row as `readPolicyAuditHistory` returns it.
 *
 * Visible row: exactly the stored record (`before`/`after` present; `null` means "no prior/next state").
 * Withheld row: `before` and `after` are ABSENT -- never null, which already means "no state" -- and `valuesWithheld`
 * says why; `authorizedBy` (the actor's Protected Administrator standing, governance metadata) is lifted to the top
 * level when the stored `after` carried it. `valuesWithheld` is ABSENT on a visible row, never null.
 */
export type AuditEventReadRow = PolicyAuditEventRecord | WithheldAuditEventRow;

export interface WithheldAuditEventRow extends Omit<PolicyAuditEventRecord, "before" | "after"> {
  readonly valuesWithheld: AuditValuesWithheld;
  readonly authorizedBy?: unknown;
}

/** What the projector needs to know about the reader: the capability keys held UNCONDITIONALLY, tenant-wide. */
export interface AuditReader {
  readonly holds: (capabilityKey: string) => boolean;
}

/** True when some row's values could depend on the reader -- the only case the caller needs to resolve access. */
export function auditRowsNeedReader(rows: readonly PolicyAuditEventRecord[]): boolean {
  return rows.some((r) => enforcedRequirementsFor(r.targetKind, r.action) !== null);
}

/** True when the projection could change some row (an UNKNOWN kind, or an ENFORCED gate); false = identity. */
export function auditRowsNeedProjection(rows: readonly PolicyAuditEventRecord[]): boolean {
  return rows.some((r) => classifyAuditKind(r.targetKind) === "UNKNOWN" || enforcedRequirementsFor(r.targetKind, r.action) !== null);
}

/**
 * Project audit rows for one reader. Returns the SAME array (same row objects) when nothing is withheld -- the
 * identity projection every current reader receives on every existing row. `reader` null = holds nothing. Never drops, reorders or adds a row.
 */
export function projectAuditEvents<T extends PolicyAuditEventRecord>(
  rows: readonly T[],
  reader: AuditReader | null,
): readonly (T | WithheldAuditEventRow)[] {
  let out: (T | WithheldAuditEventRow)[] | null = null;
  rows.forEach((row, i) => {
    if (classifyAuditKind(row.targetKind) === "UNKNOWN") {
      // FAIL CLOSED: no reader -- not the Owner, not the Administrator -- sees the values of an unclassified kind.
      if (out === null) out = rows.slice();
      out[i] = withhold(row, { reason: "UNREGISTERED_KIND", requires: [] });
      return;
    }
    const requires = enforcedRequirementsFor(row.targetKind, row.action);
    if (requires === null) return;
    if (reader !== null && requires.every((k) => reader.holds(k))) return;
    if (out === null) out = rows.slice();
    out[i] = withhold(row, { reason: "RECORD_READ_REQUIRED", requires });
  });
  return out ?? rows;
}

function withhold(row: PolicyAuditEventRecord, marker: AuditValuesWithheld): WithheldAuditEventRow {
  const { before: _before, after, ...rest } = row;
  const authorizedBy = after !== null && typeof after === "object" && !Array.isArray(after)
    ? (after as Record<string, unknown>).authorizedBy
    : undefined;
  return {
    ...rest,
    valuesWithheld: Object.freeze({ reason: marker.reason, requires: Object.freeze([...marker.requires]) }),
    ...(authorizedBy !== undefined ? { authorizedBy } : {}),
  };
}
