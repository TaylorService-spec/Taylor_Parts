// THE WORK ORDER LIST BINDING -- the reference implementation of the site-wide filtering and sorting standard
// (docs/architecture/object-filter-sort-standard.md §2.2). It is the SERVER metadata for the office Work Order list: for
// every governed field id, what the kernel can actually execute. A field absent here cannot be filtered, sorted or
// searched, whatever a client sends.
//
// Field ids are the METADATA ids (field-ops-app-vite/src/metadata/definitions/workOrder.js), never column names, so URLs and
// static saved views keep working. test/workOrderListQuery.test.mjs pins that every field the client definition declares
// filterable or sortable is served here.
//
// Deliberately NOT bound:
//   complaint            ND-6 (Owner, 2026-10-15): complaint-text search is disabled by default pending field-governance review.
//   diagnosis/resolution technician-authored text, detail only.
//   rentalAgreementId    the rental route's company isolation is a #235 residual (P0); nothing rental-shaped is offered here.
//   *_principal_id, id   machine identity (DECISIONS #106).
import { defineFieldGroups, fieldAccessFor, groupOf } from "./governedFieldGroups";
import { defineListBinding, effectiveListFields, type EffectiveListFields, type ListFieldBinding } from "./listQuery";
import { WORK_ORDER_STATUSES } from "./workOrderLifecycle";
import { NATIVE_WORK_ORDER_TYPES } from "./workOrderCreateCommand";
import { WORK_ORDER_RECORD_READ } from "./workOrderRecordRead";

/** eos_ops.ops_work_order_severity, in its declared (most severe first) order -- migration 1761004800000. */
export const WORK_ORDER_SEVERITIES = Object.freeze(["EQUIPMENT_DOWN", "PARTIAL_OPERATION", "COSMETIC", "PREVENTIVE"]);
/** eos_ops.ops_work_order_provenance. */
export const WORK_ORDER_PROVENANCES = Object.freeze(["NATIVE", "MIGRATED"]);
/** The governed priority scale (work_orders_priority_governed CHECK). */
export const WORK_ORDER_PRIORITIES = Object.freeze([1, 2, 3, 4]);

/** The assignee's display name, exactly as the list's summary derives it (preferred, display, first + last). */
const ASSIGNEE_NAME = "lower(coalesce(nullif(e.preferred_name, ''), nullif(e.display_name, ''), nullif(btrim(concat_ws(' ', e.first_name, e.last_name)), '')))";

const instant = (column: string): ListFieldBinding => ({
  type: "TIMESTAMP", nullable: true,
  filter: { expr: column, cast: "timestamptz", operators: ["GREATER_OR_EQUAL", "LESS_THAN", "IS_NULL", "IS_NOT_NULL"] },
  sort: { expr: column, cast: "timestamptz", nullable: true },
});
const requiredInstant = (column: string): ListFieldBinding => ({
  type: "TIMESTAMP", nullable: false,
  filter: { expr: column, cast: "timestamptz", operators: ["GREATER_OR_EQUAL", "LESS_THAN"] },
  sort: { expr: column, cast: "timestamptz", nullable: false },
});

/**
 * The expressions name the aliases of workOrderQueries.ts SUMMARY_FROM: w (work_orders), a (the OPEN assignment),
 * e (its employee), acct (the customer account), loc (the customer location).
 */
export const WORK_ORDER_LIST_BINDING = defineListBinding({
  objectKey: "workOrder",
  id: { expr: "w.id", cast: "text" },
  defaultSort: [{ field: "createdAt", dir: "DESC" }],
  fields: {
    woNumber: {
      type: "STRING", nullable: true,
      filter: { expr: "w.work_order_number", cast: "text", operators: ["EQUALS", "TEXT_PREFIX"] },
      sort: { expr: "w.work_order_number", cast: "text", nullable: true },
      search: "w.work_order_number",
    },
    status: {
      type: "ENUM", nullable: false, values: WORK_ORDER_STATUSES,
      filter: { expr: "w.status::text", cast: "text", operators: ["EQUALS", "NOT_EQUALS", "IN", "NOT_IN"] },
      // Ordered by the enum itself: its declaration order IS the lifecycle order.
      sort: { expr: "w.status", cast: "eos_ops.ops_work_order_status", nullable: false },
    },
    // A classification, not a sequence: filterable, never sortable (NO_CANONICAL_ORDER, as the client definition records).
    type: {
      type: "ENUM", nullable: false, values: NATIVE_WORK_ORDER_TYPES,
      filter: { expr: "w.work_order_type::text", cast: "text", operators: ["EQUALS", "NOT_EQUALS", "IN", "NOT_IN"] },
    },
    priority: {
      type: "ENUM", nullable: false, values: WORK_ORDER_PRIORITIES,
      filter: { expr: "w.priority", cast: "smallint", operators: ["EQUALS", "NOT_EQUALS", "IN", "NOT_IN"] },
      sort: { expr: "w.priority", cast: "smallint", nullable: false },
    },
    severity: {
      type: "ENUM", nullable: true, values: WORK_ORDER_SEVERITIES,
      filter: { expr: "w.severity::text", cast: "text", operators: ["EQUALS", "NOT_EQUALS", "IN", "NOT_IN", "IS_NULL", "IS_NOT_NULL"] },
      sort: { expr: "w.severity", cast: "eos_ops.ops_work_order_severity", nullable: true },
    },
    // A reference filters by id (values come from the governed customer picker) and sorts and searches by the NAME the
    // row shows -- a join that already exists, so no denormalized copy and no rename propagation are needed.
    customerId: {
      type: "REFERENCE", nullable: false,
      filter: { expr: "w.customer_id", cast: "text", operators: ["EQUALS", "IN"] },
      sort: { expr: "lower(acct.name)", cast: "text", nullable: true },
      search: "acct.name",
    },
    locationId: {
      type: "REFERENCE", nullable: false,
      filter: { expr: "w.location_id", cast: "text", operators: ["EQUALS", "IN"] },
      sort: { expr: "lower(loc.name)", cast: "text", nullable: true },
      search: "loc.name",
    },
    equipmentId: {
      type: "REFERENCE", nullable: true,
      filter: { expr: "w.equipment_id", cast: "text", operators: ["EQUALS", "IN", "IS_NULL", "IS_NOT_NULL"] },
    },
    assignedTechId: {
      type: "REFERENCE", nullable: true,
      filter: { expr: "a.assignee_employee_id", cast: "text", operators: ["EQUALS", "IN", "IS_NULL", "IS_NOT_NULL"] },
      sort: { expr: ASSIGNEE_NAME, cast: "text", nullable: true },
    },
    // A relationship backed by the governed parts plan: Work Orders planning this Part.
    plannedPartId: {
      type: "REFERENCE", nullable: false,
      filter: {
        exists: "EXISTS (SELECT 1 FROM eos_ops.work_order_parts_plan pp WHERE pp.tenant_id = w.tenant_id AND pp.work_order_id = w.id AND pp.part_id = {v})",
        cast: "text", operators: ["EQUALS"],
      },
    },
    salesOrderId: {
      type: "REFERENCE", nullable: true,
      filter: { expr: "w.sales_order_id", cast: "text", operators: ["IS_NULL", "IS_NOT_NULL"] },
    },
    // Values are the CALLER's authorized company keys, never the tenant's whole set (design §2.2).
    company: {
      type: "ENUM", nullable: false, values: "CALLER",
      filter: { expr: "w.operating_company_key", cast: "text", operators: ["EQUALS", "IN"] },
      sort: { expr: "w.operating_company_key", cast: "text", nullable: false },
    },
    provenance: {
      type: "ENUM", nullable: false, values: WORK_ORDER_PROVENANCES,
      filter: { expr: "w.provenance::text", cast: "text", operators: ["EQUALS", "NOT_EQUALS"] },
    },
    estimatedDurationMinutes: {
      type: "NUMBER", nullable: true,
      filter: { expr: "w.estimated_duration_minutes", cast: "integer",
        operators: ["EQUALS", "GREATER_THAN", "GREATER_OR_EQUAL", "LESS_THAN", "LESS_OR_EQUAL", "IS_NULL", "IS_NOT_NULL"] },
      sort: { expr: "w.estimated_duration_minutes", cast: "integer", nullable: true },
    },
    scheduledStart: instant("w.scheduled_start"),
    scheduledEnd: instant("w.scheduled_end"),
    createdAt: requiredInstant("w.created_at"),
    updatedAt: requiredInstant("w.updated_at"),
    dispatchedAt: instant("w.dispatched_at"),
    acceptedAt: instant("w.accepted_at"),
    enRouteAt: instant("w.en_route_at"),
    arrivedAt: instant("w.arrived_at"),
    workStartedAt: instant("w.work_started_at"),
    completedAt: instant("w.completed_at"),
    closedAt: instant("w.closed_at"),
    partsPlanUpdatedAt: instant("w.parts_plan_updated_at"),
  },
});

/**
 * Field-level read authority over the list fields (governedFieldGroups, DECISIONS #230). v1 declares ONE group whose
 * read requirement is null -- governed by the record gate the list already enforces -- so it grants nothing and changes
 * no role. A future Owner-approved restricted group moves fields here and they leave filter, sort, search and describe
 * together, in one place.
 */
export const WORK_ORDER_LIST_FIELD_GROUPS = defineFieldGroups({
  objectKey: "workOrder",
  record: { read: WORK_ORDER_RECORD_READ },
  groups: [{
    key: "LIST", label: "Work Order list fields", fields: Object.keys(WORK_ORDER_LIST_BINDING.fields),
    read: null, create: null, edit: null, sensitive: false,
  }],
});

/** The binding narrowed to this caller: readable fields only, and the caller's own companies as the company picklist. */
export function workOrderListFieldsFor(capabilities: ReadonlySet<string>, companyKeys: readonly string[]): EffectiveListFields {
  const access = fieldAccessFor(WORK_ORDER_LIST_FIELD_GROUPS, capabilities);
  return effectiveListFields(WORK_ORDER_LIST_BINDING, {
    readable: (field) => {
      const g = groupOf(WORK_ORDER_LIST_FIELD_GROUPS, field);
      return g !== null && access[g.key]?.read === true;
    },
    // Tenant narrowing (design §7) arrives with its narrow-only store; today a tenant cannot change a SYSTEM field's list
    // eligibility (adminPolicy/policyCommands.ts updateFieldDefinition refuses SYSTEM edits), so there is nothing to apply.
    callerValues: { company: companyKeys },
  });
}
