import { resolveTechnicianName } from "../shared/formatters";

// Epic 2 Phase 2A -- config-driven searchable fields. Adding a future
// field (Equipment/SKU/Asset/Phone, per this phase's spec) means
// appending an entry here -- SearchBox.jsx/matchesSearch() below never
// need to change to support a new field.
export const SEARCHABLE_FIELDS = [
  { key: "woNumber", getValue: (wo) => wo.woNumber },
  { key: "customer", getValue: (wo) => wo.customerId },
  { key: "location", getValue: (wo) => wo.locationId },
  { key: "technician", getValue: (wo, ctx) => resolveTechnicianName(wo.assignedTechId, ctx.technicians) },
  { key: "status", getValue: (wo) => wo.status },
  { key: "priority", getValue: (wo) => String(wo.priority ?? "") },
  // Future, not implemented (no backing data yet -- see this phase's
  // spec section 7): { key: "equipment", getValue: ... },
  // { key: "sku", getValue: ... }, { key: "asset", getValue: ... },
  // { key: "phone", getValue: ... }.
];

export function matchesSearch(workOrder, query, ctx) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return SEARCHABLE_FIELDS.some((field) => (field.getValue(workOrder, ctx) ?? "").toString().toLowerCase().includes(q));
}
