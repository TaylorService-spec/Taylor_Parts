import { DISPATCHER_QUEUE_STATUSES } from "../../../services/workOrderQueries";
import { isToday } from "../shared/formatters";

// Epic 2 Phase 2A -- Views are FILTER CONFIGURATIONS, not UI states
// (per this phase's design lock): each entry is `filter(workOrder,
// ctx) -> boolean`, applied client-side over the single unfiltered
// useWorkOrders() subscription (see DispatcherWorkspace.jsx) rather
// than as separate Firestore queries -- one listener total, no
// duplicate subscriptions per view/filter, satisfying this phase's
// "no duplicate Firestore listeners" requirement.
//
// ctx currently carries { technicianId } (the signed-in user's own
// technicianId, from useAuth()) for the "mine" filters.
//
// KNOWN GAP, not silently papered over: "My Queue"/"Mine" is specified
// as "Work Orders belonging to this dispatcher," but WorkOrder has no
// createdBy/dispatcherId field at all (see types/workOrder.ts) -- only
// assignedTechId (a technician, not a dispatcher). Adding one is a
// Cloud Function change, explicitly out of scope this phase. This
// filter is implemented as assignedTechId === ctx.technicianId, which
// only matches if the signed-in account happens to be technician-
// linked -- a typical pure-dispatcher account will see this as always
// empty until a real "assigned dispatcher" concept exists (future
// epic).
function isMine(wo, ctx) {
  return !!ctx.technicianId && wo.assignedTechId === ctx.technicianId;
}

export const SAVED_VIEWS = [
  { key: "all", label: "All", filter: () => true },
  { key: "myQueue", label: "My Queue", filter: isMine },
  { key: "p1", label: "Priority 1", filter: (wo) => wo.priority === 1 },
  { key: "readyToDispatch", label: "Ready to Dispatch", filter: (wo) => wo.status === "READY_TO_DISPATCH" },
  { key: "scheduledToday", label: "Scheduled Today", filter: (wo) => isToday(wo.scheduledStart) },
  {
    key: "completedToday",
    label: "Completed Today",
    filter: (wo) => wo.status === "COMPLETED" && isToday(wo.completedAt),
  },
  { key: "cancelled", label: "Cancelled", filter: (wo) => wo.status === "CANCELLED" },
];

export const QUICK_FILTERS = [
  { key: "all", label: "All", filter: () => true },
  { key: "mine", label: "Mine", filter: isMine },
  { key: "p1", label: "P1", filter: (wo) => wo.priority === 1 },
  { key: "today", label: "Today", filter: (wo) => isToday(wo.scheduledStart) },
  { key: "waiting", label: "Waiting", filter: (wo) => DISPATCHER_QUEUE_STATUSES.includes(wo.status) },
  { key: "completed", label: "Completed", filter: (wo) => wo.status === "COMPLETED" },
  { key: "cancelled", label: "Cancelled", filter: (wo) => wo.status === "CANCELLED" },
];

// Friendly, specific copy per view/filter for the empty state -- "Great
// news -- no Priority 1 Work Orders", not a generic "No Data" (this
// phase's explicit UX rule). Falls back to a generic message for any
// key not listed here (e.g. a future user-defined saved view).
export const EMPTY_STATE_MESSAGES = {
  all: "No Work Orders yet.",
  myQueue: "Nothing in your queue right now.",
  p1: "Great news — no Priority 1 Work Orders.",
  readyToDispatch: "Nothing waiting to be dispatched.",
  scheduledToday: "Nothing scheduled for today yet.",
  completedToday: "No Work Orders completed today yet.",
  cancelled: "No cancelled Work Orders.",
  mine: "Nothing in your queue right now.",
  today: "Nothing scheduled for today yet.",
  waiting: "Nothing waiting on dispatch action.",
  completed: "No completed Work Orders.",
};

export const DEFAULT_EMPTY_STATE_MESSAGE = "No Work Orders match this view.";
