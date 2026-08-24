// The ONE vocabulary for Work Order type.
//
// `type` is a CANONICAL FACT chosen at creation, from WorkOrderWizard's five options
// (SERVICE_CALL / PM / INSTALL / WARRANTY / INSPECTION). It says what KIND of job this is,
// which is a different question from `status` (where the job has got to) and from
// `priority` (how urgently it needs doing).
//
// The values existed only as a bare string array inside the wizard, so every surface that
// showed the field rendered the machine value: the Work Orders list printed "SERVICE_CALL"
// and "PM" in a column headed Type. "PM" is a term the business does use out loud, but
// "SERVICE_CALL" is not — nobody says "I have a service underscore call today".
//
// Same shape and the same reasoning as workOrderStatus.js and workOrderPriority.js: one
// definition, used by every surface including the form that writes it, so what somebody
// picks is what every other screen says back to them.

/** The closed set, in the order the wizard offers them. */
export const WORK_ORDER_TYPE_VALUES = Object.freeze([
  "SERVICE_CALL",
  "PM",
  "INSTALL",
  "WARRANTY",
  "INSPECTION",
]);

/** value -> business label. */
export const WORK_ORDER_TYPE_LABEL = Object.freeze({
  SERVICE_CALL: "Service Call",
  // Expanded. "PM" is what the trade says out loud, and the first draft of this file kept it
  // — but makeFieldDefinition REFUSES an enum label identical to its stored value, because a
  // label map that echoes its keys is how a definition that never labelled anything gets
  // through review. The guard is right and the exception was not worth carving, so the field
  // renders what the abbreviation stands for.
  PM: "Preventive Maintenance",
  INSTALL: "Install",
  WARRANTY: "Warranty",
  INSPECTION: "Inspection",
});

/**
 * Display text for a type value.
 *
 * An unrecognised or missing type returns null rather than the raw value or a guess.
 * Callers decide how to render "we don't know" — and a legacy record carrying a type this
 * build has never heard of must not be shown as though it were one of the five.
 */
export function workOrderTypeLabel(type) {
  if (typeof type !== "string" || !type) return null;
  return WORK_ORDER_TYPE_LABEL[type] ?? null;
}
