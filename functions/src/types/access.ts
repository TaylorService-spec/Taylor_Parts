// Enterprise Access & Administration Platform (Issue #226) -- governed
// object type contracts. Fixed by docs/specifications/
// enterprise-access-and-administration-platform.md §5 and sequenced by
// docs/implementation-plans/enterprise-access-and-administration-platform.md
// (Row 1 / Task 6). These are CONTRACTS ONLY -- no collection, Rule,
// Function, or runtime behavior is created by this file. `admin`/
// `dispatcher`/`technician` keep authorizing exactly as they do today
// until a later, separately-authorized row activates any of this.
//
// Mirrored (not imported -- no shared/monorepo tooling exists in this
// repo) at field-ops-app-vite/src/types/access.ts. If either file
// changes, change the other to match.
import type { Timestamp } from "firebase-admin/firestore";

// Spec §6: "<domain>.<resource>.<action>", lower-camel segments,
// immutable once published. This is a nominal string type (not an enum)
// because the catalog (permissionCatalog.ts) is the single source of
// truth for which ids exist -- the type only fixes the shape.
export type PermissionId = string;

export type ScopeType =
  | "global"
  | "tenant"
  | "domain"
  | "location"
  | "ownAssignment";

// Spec §5.4 -- `tenant` is reserved and inert until Issue #140 defines
// it; it must never widen access (§10 of the Specification).
export interface Scope {
  type: ScopeType;
  value?: string;
}

export type ConditionKind =
  | "statusEquals"
  | "statusIn"
  | "isOwnAssignment"
  | "employmentActive"
  | "operationalRoleActive";

// Spec §5.5 -- a declarative predicate, never arbitrary code. Unknown/
// malformed `kind` fails closed (Spec §13) wherever this is evaluated.
export interface Condition {
  kind: ConditionKind;
  params: Record<string, unknown>;
}

// Spec §5.1 -- a pure capability declaration. Carries no principal, no
// Scope, no Condition.
export interface Permission {
  id: PermissionId;
  description: string;
  resource: string;
  action: string;
  deprecated?: boolean;
  // Set only when `deprecated` is true; the successor id a caller
  // should migrate to. Deprecation is additive, never a silent rename
  // (Spec §6).
  deprecatedInFavorOf?: PermissionId;
  // Issue #325 / ADR-007 D-226 -- a REGISTERED capability (present in
  // the catalog, so `findPermission` finds it) that is not currently
  // grantable. Distinct from absent-from-catalog ("unregistered" --
  // `findPermission` returns undefined, DenialReason "unknownPermission")
  // and from `deprecated` (a superseded-but-still-live id). Omitted or
  // `true` means active -- every existing catalog entry is unaffected by
  // this addition. `false` is a hard, unconditional DENY in
  // resolveEffectivePermission regardless of any Role grant (Spec §13
  // fail-closed posture) -- the mechanism ADR-007 §2.6 requires for
  // "sensitive fields are denied by default and activated only through
  // dedicated security review" (e.g. a field-read capability catalogued
  // ahead of its wave's review, or a security-text field pending its
  // wave-1 review's explicit confirmation, per docs/specifications/
  // governed-object-based-report-creator.md §4/§5). Generic on Permission
  // (not a field-only type) since the same "registered but not yet live"
  // need is not inherently field-specific, but its first and, as of this
  // addition, only use is the `report.*` field-read/object-read
  // capability class below.
  //
  // "Active vocabulary": this is the canonical "Capability active"
  // sense (enabled in that environment) -- distinct from Employee
  // active, Role assignment active, and Record active. See
  // docs/architecture/ADR-012-persona-authority-composition-and-scope.md
  // section 2.2a.
  active?: boolean;
}

// Spec §5.2 -- a named bundle of Permission ids. This field is
// literally `PermissionId[]`, matching the Specification-Approved
// shape exactly -- it is not restructured here, even though Conditions
// (below) attach to individual grants.
export type RolePermissions = PermissionId[];

// Spec §5.5 -- Conditions are "attached to Permissions-within-Roles by
// repository declaration." Rather than changing `Role.permissions`'
// approved `PermissionId[]` shape to carry them, this is a side map
// keyed by the same PermissionId: a Role's optional
// `conditionsByPermission` supplies the Conditions (if any) that gate
// that particular grant. A PermissionId absent from this map carries
// no Condition beyond Scope matching (Spec §8 step 3).
export type RoleConditionsByPermission = Partial<
  Record<PermissionId, Condition[]>
>;

// The three seeded compatibility Roles (`admin`, `dispatcher`,
// `technician`) are `systemSeed: true, compatibility: true` and their
// grants are repository-declared and frozen to reproduce today's
// matrix exactly (Spec §7).
export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: RolePermissions;
  conditionsByPermission?: RoleConditionsByPermission;
  compatibility?: boolean;
  systemSeed?: boolean;
  // Row 7 (Task 12) / ADR-005 sec2.4: a privileged Role's grant/revoke
  // requires a second, distinct authorized approver and is never
  // eligible for the single-admin assignApprovedRole path. Absent or
  // false means "ordinary pre-approved, non-privileged" (Spec sec2.4's
  // single-admin-assignable category).
  privileged?: boolean;
}

// "Active vocabulary": this is the canonical "Role assignment active"
// sense (included in effective-access resolution) -- distinct from
// Employee active (employmentStatus), Capability active
// (PermissionDefinition.active / per-env overrides), and Record active
// (generic master-data isActive/status). See
// docs/architecture/ADR-012-persona-authority-composition-and-scope.md
// section 2.2a for the full vocabulary.
export type RoleAssignmentStatus = "active" | "disabled";

// Spec §5.3 -- binds a Role to a principal within a Scope. Creation/
// disabling is a trusted-writer command (Implementation Plan Row 7,
// #15-gated) that bumps `accessVersion` and emits an Audit Event.
// No client-direct write, ever.
export interface RoleAssignment {
  id: string;
  principalUid: string;
  roleId: string;
  scope: Scope;
  grantedBy: string;
  grantedAt: Timestamp;
  approvedBy?: string;
  status: RoleAssignmentStatus;
  accessVersionAtGrant: number;
}

export type ApproverConstraint =
  | "distinctFromRequester"
  | "platformAdmin"
  | "companyAdmin";

// Spec §5.6 -- fixed by ADR-005 §2.4; the full approval matrix is
// deferred to a later Specification-of-record. No approval-policy
// editor exists in the MVP (Spec §16) -- this is a repository-declared
// contract only.
export interface ApprovalPolicy {
  changeType: string;
  requiresApproval: boolean;
  approverConstraint: ApproverConstraint;
}

export type AccessRequestStatus = "pending" | "approved" | "rejected";

// Spec §5.7 -- the record contract exists so audit/trace exist from
// day one; the request -> review -> decision workflow and UI are
// deferred. Until then, access changes are Owner-authorized
// operator-script actions that still emit Audit Events.
export interface AccessRequest {
  id: string;
  requestedBy: string;
  requestedChange: string;
  requestedScope: Scope;
  status: AccessRequestStatus;
  decidedBy?: string;
  decidedAt?: Timestamp;
  reason?: string;
}

// Issue #325 / ADR-007 D-AUDIT (docs/architecture/ADR-007-governed-
// object-based-report-creator.md §2.7, docs/specifications/governed-
// object-based-report-creator.md §11) -- report definition changes,
// runs, exports, sharing, and (designed, not yet activated) scheduling
// each get their own AuditAction, extending this SAME immutable Audit
// Event path rather than creating a second audit system. Inert: nothing
// in this repository emits any of these eight values yet (the trusted
// execution/projection service, D-FN, does not exist -- #15-gated and
// additionally gated on the Customer Reporting lane's own F4 completing
// first). Naming matches this union's existing verb+Noun convention.
export type AuditAction =
  | "grantRole"
  | "revokeRole"
  | "assignApprovedRole"
  | "setUserStatus"
  | "approveAccessRequest"
  | "rejectAccessRequest"
  | "breakGlassRestore"
  | "createReportDefinition"
  | "renameReportDefinition"
  | "duplicateReportDefinition"
  | "deleteReportDefinition"
  | "runReportDefinition"
  | "exportReportDefinition"
  | "shareReportDefinition"
  | "scheduleReportDefinition"
  // F-RULES-1 / Decision #39 (Owner O-5) -- technician completes their own
  // assigned legacy job through the trusted completeAssignedJob callable
  // (functions/src/completeAssignedJob.ts). Same verb+Noun convention,
  // extending this SAME immutable Audit Event path -- no parallel enum.
  | "completeAssignedJob"
  // INV-1 Phase 1 PR 1.2 -- Part Master trusted mutations (ADR-008 / Decision #40)
  | "createPart"
  | "updatePart"
  | "changePartStatus"
  | "createManufacturer"
  | "updateManufacturer"
  | "changeManufacturerStatus"
  // INV-1 Phase 1 PR 1.3 -- Part alias trusted mutations (ADR-008 / Decision #40)
  | "createPartAlias"
  | "deactivatePartAlias"
  | "reactivatePartAlias"
  | "preserveInternalPartNumberAlias"
  // INV-1 Phase 1 PR 1.4 -- part supplier items (ADR-008 / Decision #40)
  | "createPartSupplierItem"
  | "updatePartSupplierItem"
  | "changePartSupplierItemStatus"
  | "setPreferredSupplier"
  // Supplier Master (DECISIONS #78) -- governed Supplier reference object, catalog-governed
  // (keep this comment free of the semicolon character -- adminCredentialEligibility slices the
  //  AuditAction union at the first one)
  | "createSupplier"
  | "updateSupplier"
  | "activateSupplier"
  | "deactivateSupplier"
  // D4 -- Part-Equipment Compatibility trusted persistence. Five lifecycle actions
  // extending this SAME immutable Audit Event path, not a parallel audit system:
  // a durable initiation, the terminal command outcome, and the three specialized
  // governed events (verification change, correction, conflict surfacing).
  | "initiateEquipmentCompatibilityCommand"
  | "equipmentCompatibilityCommand"
  | "equipmentCompatibilityVerification"
  | "equipmentCompatibilityCorrection"
  | "equipmentCompatibilityConflict"
  // EI Truck Registry (ADR-010 / Decision #60) -- trusted internal write service. Seven narrow
  // actions extending this SAME immutable Audit Event path (no parallel audit system) -- create,
  // driver assign/reassign (shared) and unassign, status and home-warehouse change, plus the
  // paired deactivate/reactivate. assignTruckDriver covers both assign and reassign (the same
  // governed write). Same verb+Noun convention. Runtime allow-list mirror lives in
  // access/auditEventWriter.ts's AUDIT_ACTIONS. This comment is deliberately punctuated without
  // the statement-terminator character, since mirror checks parse the union up to the first one.
  | "createTruck"
  | "assignTruckDriver"
  | "unassignTruckDriver"
  | "changeTruckStatus"
  | "changeTruckHomeWarehouse"
  | "deactivateTruck"
  | "reactivateTruck"
  | "deleteTruckCreatedInError"
  // Legacy Compatibility-Admin Bootstrap -- one-time, audited migration of an
  // existing legacy `users/{uid}.role === "admin"` principal into the governed
  // roleAssignment model (ADR-005 / ADR-009 controlled technical exception).
  | "bootstrapCompatibilityAdmin"
  // AUTH-PR-3 (Authentication Modernization) -- admin-initiated password
  // recovery. Durable, SEPARATE events for initiation, delivery outcome, and
  // session revocation (docs/assessments/auth-modernization-architecture.md
  // §6.2). Same verb+Noun convention, extending this SAME immutable Audit Event
  // path -- no parallel audit system.
  | "initiateAdminPasswordReset"
  | "deliverAdminPasswordReset"
  // "listResetEligibleUsers" (PRE-3, G-PRE3-IMPL): governed access event for the
  // reset-candidate listing -- attribution only (actor/action/outcome/scope/time),
  // no identities, no result count. AuditAction is FUNCTIONS-AUTHORITATIVE: this and
  // the other server-only admin-reset actions intentionally do NOT appear in the
  // field-ops-app-vite AuditAction consumer subset (only AuditOutcome is mirrored
  // byte-identically). D-PRE3-ACTION option (a).
  | "listResetEligibleUsers"
  | "revokeUserSessions"
  // EI Phase-2 Receiving (Phase C): the trusted receiveInventoryStock command's Audit Event action.
  // Distinct from the client audit-only `RECEIVE_STOCK` inventory_action (domain/constants.js).
  | "receiveInventoryStock"
  // Finance (Billing/AR) -- the trusted issueInvoice command's Audit Event action (invoice issuance)
  | "issueInvoice"
  // Finance (Billing/AR) -- the trusted applyPayment command's Audit Event action (cash receipt + application)
  | "applyPayment"
  // Finance (Billing/AR) -- the trusted recordInvoiceAdjustment command's Audit Event action (credit/charge/write-off)
  | "recordInvoiceAdjustment"
  // Commercial Coverage & Territory (#15) -- the trusted coverage commands' Audit Event actions
  | "createSalesTerritory"
  | "createCoverageAssignment"
  // Finance (Billing/AR) -- the trusted recordRefund command's Audit Event action (money returned after payment)
  | "recordRefund"
  // Work Order Engine (idempotency remediation) -- the trusted updateWorkOrderExecutionData callable adopts
  // this SAME immutable Audit Event path as its idempotency substrate, a deterministic Audit Event id makes a
  // retried call a no-op replay so an additive qtyUsed delta or execution-log append is never double-applied,
  // no parallel enum. Comment intentionally free of the statement-terminator character (mirror checks slice here)
  | "updateWorkOrderExecutionData"
  // Work Order Engine (idempotency remediation) -- the trusted createWorkOrder callable uses the same
  // deterministic Audit Event marker so a retried create returns the already-created Work Order instead of
  // minting a second one and burning a WO number, no parallel enum
  | "createWorkOrder"
  // Commercial command idempotency markers for the Opportunity and Sales Order create callables.
  | "createOpportunity"
  | "createSalesOrder"
  // Commercial command idempotency markers for the Opportunity and Sales Order TRANSITION callables (site-work
  // r3 item G) -- the same deterministic Audit Event id mechanism as the create markers above, so a retried
  // ADVANCE/OUTCOME/CANCEL call replays its prior result instead of skipping or double-applying a stage.
  | "transitionOpportunity"
  | "transitionSalesOrder"
  // P1.3 -- the governed, human-invoked WON -> Create Sales Order action (decision #3: no Firestore trigger).
  // Its own deterministic Audit Event id space, separate from createSalesOrder's, so a replay key never
  // collides across the two callables.
  | "createSalesOrderFromOpportunity"
  // The ATOMIC WON action -- closes an Opportunity as WON and creates its Sales Order in one
  // transaction. Its own union member, and its own deterministic Audit Event id space, so a
  // replay of the atomic action cannot collide with either standalone callable
  | "closeOpportunityAsWon"
  // P1.1 (Sales->Cash fulfillment spine) -- the trusted transitionWorkOrder Complete-action write-back to
  // the linked Sales Order's `lines[].fulfilledQty`. Traceability only, NOT the idempotency gate (COMPLETED
  // is structurally once-per-Work-Order via canTransition, see transitionWorkOrder.ts's header comment).
  | "salesOrderFulfillmentWriteBack"
  // Wave 7 extension PART 1.4 -- the trusted createCrmActivity command's deterministic Audit Event marker
  // (same idempotency-replay mechanism as createSalesOrder/createOpportunity above). Capability
  // crm.activity.create registered active:false -- see permissionCatalog.ts.
  | "createCrmActivity"
  // Enterprise Inventory Phase 4 (Transfer operating authority) -- the trusted transfer command
  // family's Audit Event actions. WAREHOUSE/MOBILE(truck) endpoints only -- CUSTOMER delivery is a
  // separate, not-yet-authorized phase. Capabilities inventory.transfer.create/dispatch/receive/cancel
  // registered active:false -- see permissionCatalog.ts.
  | "createTransferOrder"
  | "dispatchTransferOrder"
  | "receiveTransferOrder"
  | "cancelTransferOrder"
  // Enterprise Inventory -- Cycle Count operating authority -- the trusted cycle count command family's
  // Audit Event actions. Capabilities inventory.cycleCount.create/submit/reconcile/cancel registered
  // active:false -- see permissionCatalog.ts.
  | "createCycleCount"
  | "submitCycleCount"
  | "reconcileCycleCount"
  | "cancelCycleCount"
  // M23 blind-count remediation -- reconcileCycleCount's sibling terminal decision. A manager
  // reviewing a submitted count now disposes of it as APPROVE (reconcileCycleCount, unchanged
  // above) or REJECT (this action) -- reject stages no ledger evidence, it only records the
  // decision, so it needed its own action rather than overloading reconcileCycleCount's meaning.
  | "rejectCycleCount"
  // Work Order transition audit trail (M9/H19 remediation) -- the trusted transitionWorkOrder callable's
  // OWN Audit Event for every applied action (Schedule/Dispatch/Accept/Travel/Arrive/WorkStart/Complete/
  // Close/Cancel/MarkReady), not only the Complete-with-linked-Sales-Order write-back which already had
  // its own separate salesOrderFulfillmentWriteBack action above. Deterministic Audit Event id (derived
  // from workOrderId + action, see workOrderTransitionMath.ts) makes every applied transition traceable
  // to a stable id -- collision-free without a caller-supplied idempotency key, because canTransition()
  // already makes a given action apply to a given Work Order at most once across its whole lifecycle
  | "transitionWorkOrder"
  // H20 fix (dispatch reassignment) -- an ADDITIONAL, narrower event beside "transitionWorkOrder" above,
  // same coexistence pattern as salesOrderFulfillmentWriteBack beside it for Complete: the generic event
  // records the STATE TRANSITION (status A -> status B) and carries no technician-identity detail at all,
  // so it cannot express a reassignment on its own. This event fires only for the narrow case where the
  // technician actually being Dispatched differs from wo.scheduledTechId, and carries what the generic
  // event structurally cannot -- prior technician, new technician, and the dispatcher-supplied reason
  // (required for this case only). Two events describing the one Dispatch call, each meaningful on its
  // own query ("every transition on this Work Order" vs. "every technician reassignment"), not a
  // duplicate of the same fact twice. Traceability only, not an idempotency gate -- Dispatch is
  // structurally once-per-Work-Order via canTransition (SCHEDULED -> DISPATCHED, same as every other
  // action here).
  | "reassignWorkOrderTechnician"
  // Phantom Sales Order link repair (functions/src/repair/phantomSalesOrderLinkRepair.ts) -- the operator
  // CLI's repair of a Work Order salesOrderId that points at a non-existent Sales Order. Two separate,
  // durable events: the repair itself (tombstones the link -- salesOrderId is never modified) and, only if
  // an operator later reverts it, the paired rollback. Same verb+Noun convention, extending this SAME
  // immutable Audit Event path -- no parallel audit system.
  | "repairPhantomSalesOrderLink"
  | "rollbackPhantomSalesOrderLinkRepair";

// "uncertain" (PRE-1, G-PRE1-IMPL): a native reset send whose outcome could not be
// durably determined (Firebase may have accepted, but the outcome was not persisted).
// Distinct from "applied" (definitely done) and "denied" (definitely not done);
// used only for the admin-reset reconciliation_required transition. Kept byte-identical
// with the field-ops-app-vite mirror.
export type AuditOutcome = "applied" | "denied" | "uncertain";

// Spec §5.8 / §14 -- append-only and immutable (no update/delete by
// anyone, including admins); written only by a trusted writer; never
// contains secrets, tokens, raw credentials, full permission graphs, or
// PII beyond the minimal targetId.
//
// Issue #325 / ADR-007 D-AUDIT -- the four report-only fields below
// (objectId/rowCount/droppedFieldIds/droppedPredicateFieldIds/truncated)
// carry exactly the facts Spec §11 names ("definition id, object id,
// Scope, accessVersion, row counts and any dropped-field/dropped-
// predicate/truncation facts -- enough to reconstruct what was
// authorized and returned, never the row data itself"). `targetType`/
// `targetId` already generically carry "definition id" (e.g.
// targetType: "reportDefinition", targetId: the definition's id);
// `scope`/`accessVersionAfter` already generically carry Scope/
// accessVersion -- neither needs a report-specific duplicate field.
// These new fields are narrow and purpose-typed (a field-id string
// array, a non-negative row count, a boolean) -- structurally incapable
// of carrying row data, unlike a generic `details: Record<string,
// unknown>` catch-all would be, which this design deliberately avoids.
export interface AuditEvent {
  id: string;
  at: Timestamp;
  actorUid: string;
  action: AuditAction;
  targetType: string;
  targetId: string;
  scope?: Scope;
  approverUid?: string;
  outcome: AuditOutcome;
  summary: string;
  accessVersionAfter?: number;
  // Issue #325 / ADR-007 D-AUDIT -- present only when `action` is one of
  // the eight report AuditActions above; `objectId` is required on all
  // eight, `rowCount`/`droppedFieldIds`/`droppedPredicateFieldIds`/
  // `truncated` are meaningful only for runReportDefinition/
  // exportReportDefinition (Spec §11: "for runs/exports"). Enforced at
  // runtime by auditEventWriter.ts's assertValid(), same as every other
  // field on this interface.
  objectId?: string;
  rowCount?: number;
  droppedFieldIds?: string[];
  droppedPredicateFieldIds?: string[];
  truncated?: boolean;
}

// Spec §11 -- the ONLY four fields ever permitted in a custom claim.
// Never detailed permissions, Scopes, Conditions, approval limits, or
// territory lists (hard prohibition). `companyId` is present only after
// Issue #140 defines it -- reserved/empty until then.
export interface CompactClaims {
  companyId?: string;
  platformAdmin?: boolean;
  companyAdmin?: boolean;
  accessVersion?: number;
}
