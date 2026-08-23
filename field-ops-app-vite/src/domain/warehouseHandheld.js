// THE WAREHOUSE / PARTS HANDHELD — what a phone in a warehouse shows, and what it refuses to.
//
// ============================ IT COMPOSES; IT IMPLEMENTS NOTHING ============================
//
// Every workflow here already exists and is already governed: supplier receiving, put-away, pick,
// transfer, cycle count, return intake, lookup. This module decides which of them a given person is
// offered and in what order. It owns no inventory rule, mints no capability, and cannot move stock.
//
// The authority derivation is `access/scanWorkflows.js`, reused rather than restated — a second
// opinion about who may put stock away is a second thing to keep in step, and it would drift.
//
// ============================ WHY HOME MOSTLY HAS NO COUNTS ============================
//
// The honest finding from tracing the contracts before building: transfers, cycle counts and returns
// have COMMANDS but no list or read callable. Receiving alone has `fetchReceivablePurchaseOrders`.
//
// So a Home showing "4 transfers waiting" would require inventing a read that does not exist —
// exactly what this package forbids, and worse, it would be a broad query across a collection a
// phone has no business subscribing to. Instead, a queue with no governed read is offered as a way
// IN, with no number and a plain statement that the count is not available here.
//
// A missing number is a small disappointment. A wrong number in a warehouse is a stock-out somebody
// discovers at a customer site.
//
// PURE. No JSX, no I/O, no listeners.
import {
  SCAN_WORKFLOW, SCAN_WORKFLOW_LABEL, deriveScanWorkflows,
} from "../access/scanWorkflows.js";

/** Four, and no more. Every extra tab is a decision a person makes before doing any work. */
export const WAREHOUSE_TABS = Object.freeze([
  { key: "home", label: "Home" },
  { key: "scan", label: "Scan" },
  { key: "work", label: "Work" },
  { key: "more", label: "More" },
]);

/**
 * ORDER OF ATTENTION — deterministic, from domain state, not from an invented severity score.
 *
 * There is no cross-domain urgency model in this platform, and inventing one here would mean a
 * number nobody agreed on deciding what a warehouse looks at first. So the order is a declared
 * sequence with a stated reason for each position, which is auditable in a way a score is not:
 *
 *   1  RECEIVING      stock is physically on the dock and unrecorded. Until it is received it does
 *                     not exist to the platform, so everything downstream is working from a lie.
 *   2  PUT_AWAY       received but not placed. It exists and cannot be found, which is worse for a
 *                     picker than it not existing.
 *   3  PICK           a job is waiting on parts. A person is blocked.
 *   4  TRANSFER       stock in motion between locations; the risk is it sitting in neither.
 *   5  CYCLE_COUNT    scheduled accuracy work. Important, rarely urgent.
 *   6  RETURN_INTAKE  arriving goods with no downstream dependency today.
 *   7  LOOKUP         a tool, not a queue. Always last.
 */
export const ATTENTION_ORDER = Object.freeze([
  SCAN_WORKFLOW.SUPPLIER_RECEIVING,
  SCAN_WORKFLOW.PUT_AWAY,
  SCAN_WORKFLOW.PICK,
  SCAN_WORKFLOW.TRANSFER,
  SCAN_WORKFLOW.CYCLE_COUNT,
  SCAN_WORKFLOW.RETURN_INTAKE,
  SCAN_WORKFLOW.LOOKUP,
]);

/** Why each sits where it does, so the order can be argued with rather than merely obeyed. */
export const ATTENTION_REASON = Object.freeze({
  [SCAN_WORKFLOW.SUPPLIER_RECEIVING]: "Stock on the dock is not stock the platform knows about.",
  [SCAN_WORKFLOW.PUT_AWAY]: "Received but not placed — it exists and cannot be found.",
  [SCAN_WORKFLOW.PICK]: "A job is waiting on parts.",
  [SCAN_WORKFLOW.TRANSFER]: "Stock in motion between two locations.",
  [SCAN_WORKFLOW.CYCLE_COUNT]: "Scheduled accuracy work.",
  [SCAN_WORKFLOW.RETURN_INTAKE]: "Goods arriving back.",
  [SCAN_WORKFLOW.LOOKUP]: "Check what something is.",
});

/**
 * Which queues can honestly show a number.
 *
 * Receiving only. `fetchReceivablePurchaseOrders` is a real governed read; nothing equivalent exists
 * for transfers, counts or returns. This is a FACT ABOUT THE BACKEND, recorded here so a future
 * reader knows the blank is deliberate and knows exactly what would fill it.
 */
export const COUNTABLE_QUEUES = Object.freeze([SCAN_WORKFLOW.SUPPLIER_RECEIVING]);

export const COUNT_UNAVAILABLE_TEXT =
  "Open to see what is waiting — a count is not available on this device yet.";

/**
 * The task a person is being offered, in their words rather than the workflow's.
 *
 * `SCAN_WORKFLOW_LABEL` describes the ACTION ("Receive a supplier purchase order"), which is right
 * on a menu of things to do. A Home tile answers a different question — what is waiting — so it gets
 * its own noun.
 */
export const QUEUE_TITLE = Object.freeze({
  [SCAN_WORKFLOW.SUPPLIER_RECEIVING]: "Receiving",
  [SCAN_WORKFLOW.PUT_AWAY]: "Put away",
  [SCAN_WORKFLOW.PICK]: "Pick and stage",
  [SCAN_WORKFLOW.TRANSFER]: "Transfers",
  [SCAN_WORKFLOW.CYCLE_COUNT]: "Cycle counts",
  [SCAN_WORKFLOW.RETURN_INTAKE]: "Returns",
  [SCAN_WORKFLOW.LOOKUP]: "Look something up",
});

/**
 * Home, and the Work tab, from one derivation.
 *
 * Both answer "what may this person do", so both come from the same call. Home ranks by attention
 * and leads with what is waiting; Work is the same set as a plain list of places to go.
 *
 * ABSENCE, NOT DISABLEMENT. A workflow the caller has no capability for is not rendered greyed out:
 * a disabled tile asserts the operation exists and that access is the only obstacle, which for
 * several of these is simply untrue — the capability is registered `active: false` and carried by no
 * Role anywhere. Offering it would be an invitation to ask for something nobody can grant.
 */
export function composeWarehouseHome({
  hasCapability, receivingReady = false, role = null,
  technicianId = null, assignedWorkOrderCount = 0, counts = {},
} = {}) {
  const derived = deriveScanWorkflows({
    hasCapability, receivingReady, role, technicianId, assignedWorkOrderCount,
  });
  const availableKeys = new Set((derived.available ?? []).map((w) => w.workflow ?? w));

  const queues = ATTENTION_ORDER
    .filter((key) => availableKeys.has(key))
    .map((key) => {
      const countable = COUNTABLE_QUEUES.includes(key);
      const count = countable && typeof counts[key] === "number" ? counts[key] : null;
      return Object.freeze({
        key,
        title: QUEUE_TITLE[key] ?? key,
        actionLabel: SCAN_WORKFLOW_LABEL[key] ?? key,
        reason: ATTENTION_REASON[key] ?? null,
        // null means "we cannot say", and the UI must render that as words rather than as 0.
        count,
        countable,
        countText: countable ? null : COUNT_UNAVAILABLE_TEXT,
      });
    });

  return Object.freeze({
    queues: Object.freeze(queues),
    /** Nothing available is a real state, and a warehouse worker seeing it needs to know why. */
    empty: queues.length === 0,
    // Carried through unchanged so the shell can explain a workflow's absence where explaining helps
    // the person act — "the transport is not ready here" is different from "you may not".
    unavailable: derived.unavailable ?? [],
  });
}

/** Small on purpose. A closed list, so nobody drops the desktop side-nav in here later. */
export const WAREHOUSE_MORE_ITEMS = Object.freeze([
  { key: "sync", label: "Sync status" },
  { key: "scannerHelp", label: "Scanner help" },
  { key: "about", label: "App version" },
  { key: "account", label: "Account" },
]);

export function assertWarehouseMoreIsSmall(items = WAREHOUSE_MORE_ITEMS) {
  const allowed = new Set(WAREHOUSE_MORE_ITEMS.map((i) => i.key));
  return items.every((i) => allowed.has(i.key)) && items.length <= WAREHOUSE_MORE_ITEMS.length;
}

/**
 * OFFLINE CLASSIFICATION — WO-05's contract, written now while each workflow is fresh.
 *
 * `capturable` means a person may record the intent with no network. It never means the platform
 * accepted it, and WO-04 wires NONE of it — the states exist in the vocabulary, the runtime is not
 * connected to these commands, and no screen here claims otherwise.
 *
 * `onlineRequired` is not a gap to be engineered away later. Several of these genuinely cannot be
 * decided on a device: validating a bin needs the bin registry, and reconciling a variance needs an
 * authority check that is the whole point of the separation.
 */
export const WAREHOUSE_OFFLINE_MATRIX = Object.freeze([
  { workflow: "scan raw identifier", readable: true, capturable: true, onlineRequired: false,
    note: "the string can be captured; it means nothing until the server resolves it" },
  { workflow: "part lookup", readable: true, capturable: false, onlineRequired: true,
    note: "reads the governed Part Master; a cached part is a snapshot and must say so. Balances have no governed client read at all" },
  { workflow: "receiving", readable: false, capturable: true, onlineRequired: true,
    note: "observations are capturable; the receipt is ONE atomic server command and stock is never claimed received offline" },
  { workflow: "put-away", readable: false, capturable: true, onlineRequired: true,
    note: "a placement can be captured, but the destination bin must be validated against the registry before it means anything" },
  { workflow: "pick / stage", readable: true, capturable: true, onlineRequired: false,
    note: "the plan is readable from cache; staging is intent. Picking holds nothing either way" },
  { workflow: "transfer dispatch", readable: false, capturable: true, onlineRequired: true,
    note: "the lifecycle is the server's; a device may not move a transfer between states" },
  { workflow: "transfer receipt", readable: false, capturable: true, onlineRequired: true,
    note: "same lifecycle, other end. Receiving into a location the server has since changed is a conflict" },
  { workflow: "truck handoff", readable: false, capturable: true, onlineRequired: true,
    note: "it IS a transfer, and inherits the transfer contract exactly — no separate mobile movement model" },
  { workflow: "cycle count", readable: false, capturable: true, onlineRequired: false,
    note: "an observation is the most offline-friendly thing here: it asserts what a person saw, and changes nothing" },
  { workflow: "reconciliation", readable: false, capturable: false, onlineRequired: true,
    note: "NOT capturable, deliberately. Approving a variance is an authority decision, and capturing one offline would mean queueing an approval nobody had at the time" },
  { workflow: "return intake", readable: false, capturable: true, onlineRequired: true,
    note: "intake is capturable; it does NOT restock, offline or online, because disposition does not exist" },
]);

/** The seven workflows the matrix must cover, so a new workflow cannot be added without classifying it. */
export function offlineMatrixCovers(workflowKeys = []) {
  const covered = new Set(WAREHOUSE_OFFLINE_MATRIX.map((r) => r.workflow));
  return workflowKeys.every((k) => covered.has(k));
}
