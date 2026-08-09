// The ONE vocabulary for Work Order priority.
//
// `priority` is a CANONICAL FACT: someone chose it when the Work Order was created,
// from a list that reads "1 - Emergency / 2 - High / 3 - Normal / 4 - Low". It is not
// derived and not a risk score -- Dispatch's separate at-risk signal is a different
// thing entirely and must not be confused with this.
//
// The vocabulary existed only inside WorkOrderWizard, was duplicated in the Scheduling
// workspace, and was missing everywhere else -- so five surfaces rendered a bare
// "Priority 2". A dispatcher persona reported the same record reading "Priority 2",
// "Emergency" and "High" on different screens and could not tell whether they were
// looking at one job or three. The number means nothing to someone who chose a word.
//
// One definition, used by every surface that shows priority, including the form that
// writes it -- so what a user picks is what every other screen says back to them.

/** value -> business label, exactly as offered at creation. */
export const WORK_ORDER_PRIORITY_LABEL = Object.freeze({
  1: "Emergency",
  2: "High",
  3: "Normal",
  4: "Low",
});

/** Ordered options for a priority selector: "1 - Emergency", etc. */
export const WORK_ORDER_PRIORITY_OPTIONS = Object.freeze(
  Object.entries(WORK_ORDER_PRIORITY_LABEL).map(([value, label]) => ({
    value: Number(value),
    label: `${value} - ${label}`,
  })),
);

/**
 * Display text for a priority value.
 *
 * An unrecognised or missing priority returns null rather than a guess or a bare
 * number -- callers decide how to render "we don't know", and must not present an
 * unknown priority as though it were a chosen one.
 */
export function workOrderPriorityLabel(priority) {
  const key = typeof priority === "number" ? priority : Number(priority);
  if (!Number.isInteger(key)) return null;
  return WORK_ORDER_PRIORITY_LABEL[key] ?? null;
}

/**
 * Priority for display alongside its number, e.g. "High (2)" -- the word leads because
 * that is what was chosen; the number stays because dispatchers and printed paperwork
 * still refer to it. Unknown values return null.
 */
export function workOrderPriorityText(priority) {
  const label = workOrderPriorityLabel(priority);
  return label === null ? null : `${label} (${priority})`;
}
