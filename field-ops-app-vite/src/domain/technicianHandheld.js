// THE HANDHELD, DECIDED — what a technician sees, in what order, and what it may claim.
//
// ============================ WHY THIS IS A DOMAIN MODULE ============================
//
// A phone screen has room for one answer. Which answer, and in which order, is a product decision
// that deserves to be readable and testable on its own — not scattered through JSX where the next
// person changes it by accident while adjusting a margin.
//
// ============================ THE ORDER IS NOT INVENTED HERE ============================
//
// `sortFieldWorkOrders` already defines the canonical field ordering: active work first, then by how
// far along it is, then by Work Order number for stability. This module composes that; it does not
// re-decide it. A second ordering rule would be a second answer to "what is next", and the two would
// disagree the first time somebody touched one.
//
// PURE: no firebase, no React. Tested in technicianHandheld.test.mjs.
import { activeFieldWorkOrders, isActiveFieldWorkOrder, sortFieldWorkOrders, nextFieldAction, fieldActionLabel } from "./fieldWorkOrder.js";

/** The four things a technician does. More than four is a desktop menu wearing a phone's clothes. */
export const HANDHELD_TABS = Object.freeze([
  { key: "home", label: "Home", path: "" },
  { key: "jobs", label: "Jobs", path: "jobs" },
  { key: "scan", label: "Scan", path: "scan" },
  { key: "more", label: "More", path: "more" },
]);

/**
 * How a captured action stands with the server.
 *
 * Present from the start, before the offline runtime exists, because a UI built on the assumption
 * that every action completes immediately cannot later be taught otherwise without rewriting it.
 * SYNCED is the only one of these a component may render as done.
 */
export const SYNC_STATE = Object.freeze({
  SYNCED: "SYNCED",
  PENDING_SYNC: "PENDING_SYNC",
  SYNCING: "SYNCING",
  CONFLICT: "CONFLICT",
  REFUSED: "REFUSED",
  NEEDS_ATTENTION: "NEEDS_ATTENTION",
});

/** What each state says to a technician, and whether it may claim the work is done. */
export const SYNC_PRESENTATION = Object.freeze({
  [SYNC_STATE.SYNCED]: { label: "Saved", tone: "ok", claimsComplete: true },
  [SYNC_STATE.PENDING_SYNC]: { label: "Waiting to sync", tone: "pending", claimsComplete: false },
  [SYNC_STATE.SYNCING]: { label: "Syncing…", tone: "pending", claimsComplete: false },
  [SYNC_STATE.CONFLICT]: { label: "Needs review — changed elsewhere", tone: "attention", claimsComplete: false },
  [SYNC_STATE.REFUSED]: { label: "Not accepted", tone: "attention", claimsComplete: false },
  [SYNC_STATE.NEEDS_ATTENTION]: { label: "Needs attention", tone: "attention", claimsComplete: false },
});

/**
 * OFFLINE CLASSIFICATION — the contract WO-03 has to satisfy.
 *
 * Written down now, while each workflow is fresh, because the alternative is an offline runtime
 * built against assumptions nobody wrote down. `capturable` means a technician may record the intent
 * with no network; it never means the platform accepted it.
 *
 * `onlineRequired` is not a limitation to be engineered away — some of these genuinely cannot be
 * decided on a device. Resolving a scan against the catalogue needs the catalogue; completing a Work
 * Order needs the server's state machine.
 */
export const OFFLINE_MATRIX = Object.freeze([
  { workflow: "job list", readable: true, capturable: false, onlineRequired: false,
    note: "last-synced assigned work is readable; it is a snapshot, and must say so" },
  { workflow: "job detail", readable: true, capturable: false, onlineRequired: false,
    note: "same snapshot; history and customer context beyond the cached slice are not" },
  { workflow: "notes", readable: true, capturable: true, onlineRequired: false,
    note: "a typed note is a draft until the governed writer accepts it" },
  { workflow: "labor", readable: false, capturable: false, onlineRequired: true,
    note: "NO AUTHORITY EXISTS -- see TECHNICIAN LABOR AUTHORITY GAP. Nothing to capture into" },
  { workflow: "parts usage", readable: true, capturable: true, onlineRequired: false,
    note: "qtyUsed deltas are intent until updateWorkOrderExecutionData accepts them; inventory is never claimed changed" },
  { workflow: "scan resolution", readable: false, capturable: true, onlineRequired: true,
    note: "the raw identifier can be captured offline as intent; it means nothing until the server resolves it, and an unresolved scan is never a business action" },
  { workflow: "equipment installation", readable: true, capturable: true, onlineRequired: false,
    note: "PENDING_SYNC intent only; never INSTALLED until the server says so" },
  { workflow: "work order completion", readable: false, capturable: false, onlineRequired: true,
    note: "the state machine is the server's; a device may not advance a Work Order" },
]);

const str = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/**
 * Home, in one object.
 *
 * Operational, never analytical: what is in front of me, what is next, what is stopping me. No
 * revenue, no company KPIs, no CRM — a technician's phone is not a dashboard.
 */
export function composeTechnicianHome({ workOrders = [], readinessByWorkOrder = {}, pending = [] } = {}) {
  // A DEFAULT PARAMETER ONLY FIRES ON undefined. A caller passing null -- which a loading hook does,
  // routinely -- reached the spread inside the sorter and threw. Guarded here rather than at every
  // call site, because every call site is a screen a technician is looking at.
  const list = Array.isArray(workOrders) ? workOrders : [];
  const safePending = Array.isArray(pending) ? pending : [];
  const readiness = readinessByWorkOrder ?? {};
  const active = activeFieldWorkOrders(list);
  const all = sortFieldWorkOrders(list);

  // BLOCKED is derived from readiness the caller already resolved, never guessed. A job with no
  // readiness answer is UNKNOWN, which is not the same as ready and not the same as blocked.
  const blocked = all.filter((wo) => readiness[wo.id] === "MISSING" || readiness[wo.id] === "PARTIAL");

  return {
    // The single job the technician is on, if any. First in the canonical order, which puts the most
    // advanced active job first -- the one actually being worked.
    current: active[0] ?? null,
    // What follows it. Not "the rest of the list": the next thing to pick up.
    next: active[1] ?? null,
    today: all,
    activeCount: active.length,
    blocked,
    // Anything captured on the device and not yet accepted. Shown BEFORE the job list, because
    // unsynced work is the thing a technician most needs to know about and most easily forgets.
    pending: safePending.filter((p) => p?.state && p.state !== SYNC_STATE.SYNCED),
    // The primary action for the current job, from the governed matrix -- this screen never decides.
    primaryAction: active[0] ? nextFieldAction(active[0], active[0].assignedTechId) : null,
  };
}

/**
 * The label for Home's one button, or null when there is nothing to press.
 *
 * nextFieldAction returns `{ action, label }`, NOT an action string. Passing the object straight to
 * fieldActionLabel produced an object where a label belonged, and React refused to render it -- which
 * is the good outcome: the alternative was "[object Object]" on a technician's screen. The label the
 * governed matrix already chose is used directly; deriving it a second time from the action would be
 * a second answer to the same question.
 */
export function homePrimaryActionLabel(home) {
  const next = home?.primaryAction;
  if (!next) return null;
  return typeof next === "string" ? fieldActionLabel(next) : (next.label ?? fieldActionLabel(next.action));
}

/**
 * One job, reduced to what a card must show to be actionable.
 *
 * Everything here answers a question a technician asks before tapping: who, where, which machine,
 * when, is it ready, what do I do. Anything that answers none of those does not belong on a card.
 */
export function composeJobCard(workOrder, { readiness = null, customerName = null, locationLabel = null } = {}) {
  if (!workOrder) return null;
  return {
    workOrderId: workOrder.id,
    woNumber: str(workOrder.woNumber) ?? workOrder.id,
    customer: customerName ?? str(workOrder.customerId),
    location: locationLabel ?? str(workOrder.locationId),
    type: str(workOrder.type),
    status: str(workOrder.status),
    scheduledStart: workOrder.scheduledStart ?? null,
    // UNKNOWN IS A REAL ANSWER and is never rendered as Missing or as zero -- the two mean opposite
    // things to somebody deciding whether to drive to a site.
    readiness: readiness ?? "UNKNOWN",
    active: isActiveFieldWorkOrder(workOrder),
    isInstall: workOrder.type === "INSTALL",
    action: nextFieldAction(workOrder, workOrder.assignedTechId),
  };
}

export function composeJobCards(workOrders = [], context = {}) {
  // Same null guard, same reason.
  return sortFieldWorkOrders(Array.isArray(workOrders) ? workOrders : []).map((wo) => composeJobCard(wo, context[wo.id] ?? {}));
}

/**
 * What More may contain.
 *
 * Deliberately a closed list. "More" is where a handheld app goes to die: every desktop module that
 * does not fit the four tabs ends up here, and the phone becomes a menu. A technician holding
 * another business role still gets a technician's phone -- desktop EOS remains available separately.
 */
export const MORE_ITEMS = Object.freeze([
  { key: "sync", label: "Sync status" },
  { key: "scannerHelp", label: "Scanner help" },
  { key: "about", label: "App version" },
  { key: "account", label: "Account" },
]);

/** Reject anything trying to smuggle a desktop domain into More. */
export function assertMoreIsSmall(items = MORE_ITEMS) {
  const allowed = new Set(MORE_ITEMS.map((i) => i.key));
  return items.every((i) => allowed.has(i.key)) && items.length <= MORE_ITEMS.length;
}
