import { WORK_ORDER_STATUS_VALUES } from "./workOrderStatus.js";

// The five status GROUPS the Work Orders list offers as chips.
//
// Lives in domain/ rather than inside the screen for the reason every other vocabulary in
// this folder does: the moment a second surface wants "Open work", a copy appears, and the
// two disagree about whether SCHEDULED counts. It is also what lets a test assert the
// groups against the lifecycle without importing a React component.
//
// ─────────────────────────────────────────────────────────────────────────────
// "ACTIVE" IS NOT THE ONLY ACTIVE, AND THAT IS DELIBERATE
//
// This group's key stays ACTIVE (internal, never persisted) but its LABEL is not bare
// "Active". The five statuses here — dispatched through work-in-progress — are a different
// population from the Dispatcher Board capacity card's "In Progress" count
// (WORK_IN_PROGRESS only) and from the Operations panel's eight-status "Active" column.
// All three are variants of the discovered fifth sense of "active" documented in
// docs/architecture/ADR-012-persona-authority-composition-and-scope.md. Labelling this one
// "Active" would make two screens claim the same word for two different numbers.
//
// ─────────────────────────────────────────────────────────────────────────────
// EACH GROUP IS A QUERY, NOT A CLIENT-SIDE PASS
//
// A group applies as `status IN [...]`, which Firestore serves from the SAME
// (status, createdAt DESC) composite an equality filter uses — so the chips cost no new
// index and no unbounded read. That is why the sets are written as explicit status lists
// rather than as "everything except CLOSED": a negation cannot be served from that index.

/** ALL first: the list treats `options[0]` as the cleared state. */
export const WORK_ORDER_STATUS_GROUPS = Object.freeze([
  { key: "ALL", label: "All", statuses: null },
  { key: "OPEN", label: "Open", statuses: Object.freeze(["CREATED", "READY_TO_DISPATCH", "SCHEDULED"]) },
  {
    key: "ACTIVE",
    label: "Dispatched+",
    statuses: Object.freeze(["DISPATCHED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS"]),
  },
  { key: "DONE", label: "Done", statuses: Object.freeze(["COMPLETED", "CLOSED"]) },
  { key: "CANCELLED", label: "Cancelled", statuses: Object.freeze(["CANCELLED"]) },
].map(Object.freeze));

/**
 * Every status the chips can apply.
 *
 * A chip naming a status the engine does not have would filter to nothing forever and read
 * as an empty queue rather than as a typo, so this is asserted against the lifecycle.
 */
export const WORK_ORDER_STATUS_GROUP_VALUES = Object.freeze(
  WORK_ORDER_STATUS_GROUPS.flatMap((g) => g.statuses ?? []),
);

/** Every lifecycle status covered by exactly one group — no gaps, no double-counting. */
export function statusGroupCoverage() {
  const counts = new Map(WORK_ORDER_STATUS_VALUES.map((s) => [s, 0]));
  for (const status of WORK_ORDER_STATUS_GROUP_VALUES) {
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return {
    uncovered: [...counts].filter(([, n]) => n === 0).map(([s]) => s),
    duplicated: [...counts].filter(([, n]) => n > 1).map(([s]) => s),
    unknown: WORK_ORDER_STATUS_GROUP_VALUES.filter((s) => !WORK_ORDER_STATUS_VALUES.includes(s)),
  };
}

/**
 * Which group a set of applied status values represents.
 *
 * Returns "ALL" when nothing is filtered, the matching group key when the values are
 * exactly one group's set, and null when a status filter is applied that is not one of the
 * groups — added through the shared filter builder, which is legitimate. Null rather than
 * "ALL", because lighting the All chip while a filter is applied would state the opposite
 * of what is on screen.
 */
export function activeStatusGroupKey(appliedValues) {
  if (appliedValues == null) return "ALL";
  const values = [...(Array.isArray(appliedValues) ? appliedValues : [appliedValues])].sort();
  for (const group of WORK_ORDER_STATUS_GROUPS) {
    if (!group.statuses) continue;
    const want = [...group.statuses].sort();
    if (want.length === values.length && want.every((v, i) => v === values[i])) return group.key;
  }
  return null;
}
