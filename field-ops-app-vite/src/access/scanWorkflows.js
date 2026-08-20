// SHARED SCAN WORKSPACE — which workflows a caller may actually use. PURE; no I/O, no JSX, no
// transport, unit-tested.
//
// ============================ AUTHORITY, NOT ROLE NAME ============================
//
// Availability derives from the EXISTING effective-access model — the same trusted feed that already
// gates every other governed surface — plus operational context. It never asks what a role is called.
//
// The legacy ROLE_NAV_ACCESS map understands only `admin`, `dispatcher` and `technician`, so it
// cannot express a Parts Associate or a Warehouse Manager at all
// (docs/governance/parts-scanner-access-decision.md §3). Adding governed business roles to it would
// add keys nothing reads. So nothing here consults it.
//
// NO NEW CAPABILITY WAS CREATED. Supplier receiving is gated on `inventory.stock.receive`, which
// already governs receiving and is already active and granted. A `scanner.access` boolean would have
// been a second, weaker answer to a question an existing authority already answers.
//
// ============================ ABSENT, NOT DISABLED ============================
//
// A workflow whose command does not exist is not listed. A disabled control would tell an operator
// the operation exists and that they merely lack permission — which for put-away, pick, stage,
// transfer, return and cycle count is false: those commands are not built. Only two workflows can
// appear here, because only two exist.

/** The workflows this workspace can surface. Extended only when a real command exists behind one. */
export const SCAN_WORKFLOW = Object.freeze({
  SUPPLIER_RECEIVING: "SUPPLIER_RECEIVING",
  TECHNICIAN_WORK_ORDER: "TECHNICIAN_WORK_ORDER",
});

/** Why a workflow the caller might expect is not offered. Shown only where it helps them act. */
export const UNAVAILABLE_REASON = Object.freeze({
  NO_CAPABILITY: "NO_CAPABILITY",
  NOT_READY: "NOT_READY",
  NO_TECHNICIAN_IDENTITY: "NO_TECHNICIAN_IDENTITY",
  NO_ASSIGNED_WORK: "NO_ASSIGNED_WORK",
});

export const RECEIVE_CAPABILITY = "inventory.stock.receive";

/**
 * Derive the available workflows.
 *
 * @param ctx.hasCapability  the trusted fail-closed gate (access/reportCapabilityAccess.js's
 *                           buildHasCapability). Absent or throwing ⇒ denied, never allowed.
 * @param ctx.receivingReady the governed client transport readiness constant. FALSE means the
 *                           callables are unreachable in this environment, which is a different fact
 *                           from "you may not" and is reported as such.
 * @param ctx.role           the caller's legacy role, used ONLY for the technician journey, whose
 *                           server-side rule is itself role-based (updateWorkOrderExecutionData).
 *                           It is never used to decide warehouse eligibility.
 * @param ctx.technicianId   the resolved technician identity, or null.
 * @param ctx.assignedWorkOrderCount  how many Work Orders are assigned to that identity.
 */
export function deriveScanWorkflows(ctx = {}) {
  const { hasCapability, receivingReady = false, role = null, technicianId = null, assignedWorkOrderCount = 0 } = ctx;

  const holds = (capabilityId) => {
    // A THROWING gate is a denial, never an allow — the same fail-closed posture every other
    // capability consumer in this codebase takes.
    try {
      return typeof hasCapability === "function" && hasCapability(capabilityId) === true;
    } catch {
      return false;
    }
  };

  const available = [];
  const unavailable = [];

  // ── Supplier receiving (Phase D) ────────────────────────────────────────────────────────────
  //
  // Two independent conditions, reported separately because they call for different actions: a
  // missing capability is an access request, and an unready transport is a deployment. Telling
  // someone they lack permission when the truth is that nothing is switched on sends them to ask for
  // access they may already have.
  const canReceive = holds(RECEIVE_CAPABILITY);
  if (!canReceive) {
    unavailable.push({ workflow: SCAN_WORKFLOW.SUPPLIER_RECEIVING, reason: UNAVAILABLE_REASON.NO_CAPABILITY });
  } else if (!receivingReady) {
    unavailable.push({ workflow: SCAN_WORKFLOW.SUPPLIER_RECEIVING, reason: UNAVAILABLE_REASON.NOT_READY });
  } else {
    available.push({ workflow: SCAN_WORKFLOW.SUPPLIER_RECEIVING });
  }

  // ── Technician Work Order scanning (existing journey) ───────────────────────────────────────
  //
  // MIRRORS the conditions updateWorkOrderExecutionData already enforces, which is where
  // domain/scanActions.js derives its one action from: technician role, a resolved technician
  // identity, and work assigned to it. The server remains the authority and re-checks all three.
  //
  // This is the one place a role name is consulted, and only because the SERVER rule is itself
  // role-based — mirroring it is honest, whereas inventing a capability the catalog does not define
  // would be a client-side authority the backend never agreed to.
  if (role !== "technician" || !technicianId) {
    unavailable.push({ workflow: SCAN_WORKFLOW.TECHNICIAN_WORK_ORDER, reason: UNAVAILABLE_REASON.NO_TECHNICIAN_IDENTITY });
  } else if (assignedWorkOrderCount <= 0) {
    // A technician with no assigned work has nothing to scan against. State, not permission — and a
    // different message, because the fix is being assigned work rather than being granted access.
    unavailable.push({ workflow: SCAN_WORKFLOW.TECHNICIAN_WORK_ORDER, reason: UNAVAILABLE_REASON.NO_ASSIGNED_WORK });
  } else {
    available.push({ workflow: SCAN_WORKFLOW.TECHNICIAN_WORK_ORDER });
  }

  return Object.freeze({
    available: Object.freeze(available),
    unavailable: Object.freeze(unavailable),
    /** True when the workspace has nothing at all to offer — which must be SAID, not left blank. */
    empty: available.length === 0,
  });
}

/** Plain-language labels. The workspace shows what a workflow IS, never an enum. */
export const SCAN_WORKFLOW_LABEL = Object.freeze({
  [SCAN_WORKFLOW.SUPPLIER_RECEIVING]: "Receive a supplier purchase order",
  [SCAN_WORKFLOW.TECHNICIAN_WORK_ORDER]: "Scan parts for my work order",
});

export const SCAN_WORKFLOW_DESCRIPTION = Object.freeze({
  [SCAN_WORKFLOW.SUPPLIER_RECEIVING]:
    "Scan a delivery against one purchase order, check it against what was ordered, and receive it.",
  [SCAN_WORKFLOW.TECHNICIAN_WORK_ORDER]:
    "Scan a part to record that you used it on the job you are working.",
});

/**
 * Why a workflow is missing, in the user's words.
 *
 * Each says what would change it, because "unavailable" without a next step is indistinguishable
 * from broken.
 */
export const UNAVAILABLE_TEXT = Object.freeze({
  [UNAVAILABLE_REASON.NO_CAPABILITY]:
    "You are not authorized to receive stock. An administrator can grant it.",
  [UNAVAILABLE_REASON.NOT_READY]:
    "Receiving is built and you are authorized, but it is not switched on in this environment yet.",
  [UNAVAILABLE_REASON.NO_TECHNICIAN_IDENTITY]:
    "Work order scanning is for technicians working an assigned job.",
  [UNAVAILABLE_REASON.NO_ASSIGNED_WORK]:
    "You have no assigned work orders to scan against right now.",
});
