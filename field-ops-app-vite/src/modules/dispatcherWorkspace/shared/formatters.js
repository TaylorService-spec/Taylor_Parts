// Epic 2 Phase 2A -- pure display-formatting helpers, no domain logic
// here (that stays in domain/*.js). Kept local to dispatcherWorkspace/
// since nothing else needs relative-time/date-only comparisons yet --
// promote to a shared/ location if a second consumer shows up.

// Firestore Timestamp | Date | number | null/undefined -> a JS Date, or
// null if there's nothing to convert. WorkOrder's timestamp fields come
// back from the client SDK as Timestamp instances (see
// types/workOrder.ts's header comment) -- this accepts a plain Date/
// number too so formatters work the same in a future test that doesn't
// go through Firestore.
function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  return new Date(value);
}

// "12 min ago", "3 hr ago", "5 days ago" -- coarse on purpose, this is
// for at-a-glance scanning, not a precise audit timestamp (those are
// the raw fields themselves, shown in WorkOrderDetail.jsx).
export function relativeTime(value) {
  const date = toDate(value);
  if (!date) return "—";

  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;

  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;

  const diffDays = Math.round(diffHr / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

export function formatDate(value) {
  const date = toDate(value);
  return date ? date.toLocaleDateString() : "—";
}

export function isToday(value) {
  const date = toDate(value);
  if (!date) return false;
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export function resolveTechnicianName(technicianId, technicians) {
  if (!technicianId) return "Unassigned";
  return technicians.find((t) => t.id === technicianId)?.name || technicianId;
}
