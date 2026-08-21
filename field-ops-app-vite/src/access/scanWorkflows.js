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
  LOOKUP: "LOOKUP",
  TRANSFER: "TRANSFER",
  CYCLE_COUNT: "CYCLE_COUNT",
  PUT_AWAY: "PUT_AWAY",
  PICK: "PICK",
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
 * Moving a transfer needs BOTH ends: dispatch sends stock out and receive takes it in, and a caller
 * who holds only one of them can still do useful work. So the workflow is offered when EITHER is
 * held, and the screen then offers only the action the selected transfer is actually waiting for.
 *
 * Both are registered active:false and granted to no Role today, so this denies for everyone.
 */
export const TRANSFER_DISPATCH_CAPABILITY = "inventory.transfer.dispatch";
export const TRANSFER_RECEIVE_CAPABILITY = "inventory.transfer.receive";

/**
 * COUNTING, not reconciling.
 *
 * A counter needs create + submit. `inventory.cycleCount.reconcile` is deliberately NOT consulted:
 * approving a variance is a manager's separate authority (DECISIONS #111 — a counter cannot approve
 * their own material variance), and offering the workflow on the strength of it would put counting
 * behind the wrong grant.
 */
export const CYCLE_COUNT_CREATE_CAPABILITY = "inventory.cycleCount.create";
export const CYCLE_COUNT_SUBMIT_CAPABILITY = "inventory.cycleCount.submit";

/**
 * PUT-AWAY needs BOTH: the authority to record a placement, and the authority to check that the bin
 * scanned is a real, active bin at this warehouse. Without the read the operator could only stow
 * into an unvalidated code, which is how stock gets recorded onto racking that does not exist.
 *
 * Deliberately NOT `inventory.location.bin.manage`: stowing all day must not confer the authority to
 * create and retire racking.
 */
export const PLACEMENT_RECORD_CAPABILITY = "inventory.placement.record";
export const BIN_READ_CAPABILITY = "inventory.location.bin.read";

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

  // ── Lookup-only scanning ────────────────────────────────────────────────────────────────────
  //
  // ALWAYS OFFERED, and that is a deliberate decision rather than a missing gate.
  //
  // Lookup reads the governed Part Master, which has NO capability in the permission catalog: the
  // `parts` collection is governed exclusively by firestore.rules (admin/dispatcher, or an ACTIVE
  // employee holding the PARTS_MANAGER or WAREHOUSE_MANAGER operational role). There is therefore
  // nothing here to consult that would honestly predict the outcome.
  //
  // The two ways to fake one are both worse than offering the attempt:
  //   - Re-implementing the Rules predicate client-side would create a second, weaker copy of the
  //     access rule that can drift, and drift lies in BOTH directions — hiding a workflow from
  //     someone who may use it, or offering one to someone who may not.
  //   - Inventing an `inventory.part.read` capability would be a client-side authority the backend
  //     never agreed to, and Phase E already rejected that shape.
  //
  // So the governed read IS the gate: the attempt is offered, and a refusal comes back as an
  // explicit DENIED state that says so. Lookup moves nothing, so an attempt costs nothing but a
  // refused read. See domain/partLookup.js.
  available.push({ workflow: SCAN_WORKFLOW.LOOKUP });

  // ── Transfers (existing governed transfer commands) ─────────────────────────────────────────
  //
  // No readiness constant: the transfer transport has never had one, and adding a second gate in
  // front of a capability that already denies would be belt-and-braces around an inert command.
  // The capability IS the gate, and a refusal is rendered as a refusal.
  if (holds(TRANSFER_DISPATCH_CAPABILITY) || holds(TRANSFER_RECEIVE_CAPABILITY)) {
    available.push({ workflow: SCAN_WORKFLOW.TRANSFER });
  } else {
    unavailable.push({ workflow: SCAN_WORKFLOW.TRANSFER, reason: UNAVAILABLE_REASON.NO_CAPABILITY });
  }

  // ── Cycle counting (existing governed cycle-count commands) ────────────────────────────────
  //
  // BOTH create and submit are required: a counter who can start a count but not submit it produces
  // an open count nobody can close, and one who can submit but not create has nothing to submit to.
  if (holds(CYCLE_COUNT_CREATE_CAPABILITY) && holds(CYCLE_COUNT_SUBMIT_CAPABILITY)) {
    available.push({ workflow: SCAN_WORKFLOW.CYCLE_COUNT });
  } else {
    unavailable.push({ workflow: SCAN_WORKFLOW.CYCLE_COUNT, reason: UNAVAILABLE_REASON.NO_CAPABILITY });
  }

  // ── Put-away (Phase L; DECISIONS #116) ──────────────────────────────────────────────────────
  //
  // Put-away also needs a STARTING POINT — which part, at which warehouse. It is launched from a
  // receipt or a lookup rather than started cold, so the workflow is offered on authority alone and
  // the surface itself explains what it needs when it arrives without one.
  if (holds(PLACEMENT_RECORD_CAPABILITY) && holds(BIN_READ_CAPABILITY)) {
    available.push({ workflow: SCAN_WORKFLOW.PUT_AWAY });
  } else {
    unavailable.push({ workflow: SCAN_WORKFLOW.PUT_AWAY, reason: UNAVAILABLE_REASON.NO_CAPABILITY });
  }

  // ── Pick and stage (Phase M) ────────────────────────────────────────────────────────────────
  //
  // The SAME two capabilities put-away needs, because a pick IS a placement: stock moving to a place
  // inside the warehouse it already belongs to, recorded with the demand it was gathered for.
  // Picking reserves nothing, so it needs no reservation authority -- there is none to need.
  if (holds(PLACEMENT_RECORD_CAPABILITY) && holds(BIN_READ_CAPABILITY)) {
    available.push({ workflow: SCAN_WORKFLOW.PICK });
  } else {
    unavailable.push({ workflow: SCAN_WORKFLOW.PICK, reason: UNAVAILABLE_REASON.NO_CAPABILITY });
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
  [SCAN_WORKFLOW.LOOKUP]: "Look something up",
  [SCAN_WORKFLOW.TRANSFER]: "Send or receive a transfer",
  [SCAN_WORKFLOW.CYCLE_COUNT]: "Count what is on the shelf",
  [SCAN_WORKFLOW.PUT_AWAY]: "Put stock away",
  [SCAN_WORKFLOW.PICK]: "Pick and stage for a job",
  [SCAN_WORKFLOW.SUPPLIER_RECEIVING]: "Receive a supplier purchase order",
  [SCAN_WORKFLOW.TECHNICIAN_WORK_ORDER]: "Scan parts for my work order",
});

export const SCAN_WORKFLOW_DESCRIPTION = Object.freeze({
  [SCAN_WORKFLOW.LOOKUP]:
    "Scan or type a part code to see what it is. Reads only — nothing is moved, counted or changed.",
  [SCAN_WORKFLOW.TRANSFER]:
    "Check a transfer against what you are physically holding, then send it or receive it.",
  [SCAN_WORKFLOW.CYCLE_COUNT]:
    "Scan everything you can find of one part at one location, and record what you saw. Counting changes nothing on its own.",
  [SCAN_WORKFLOW.PUT_AWAY]:
    "Record which bin you stowed stock in. It notes where the stock is, not what there is — counts do not change.",
  [SCAN_WORKFLOW.PICK]:
    "Gather what a job asked for and stage it. Shortages are recorded, not hidden. Picking does not hold the stock.",
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
/**
 * Per-workflow wording, where the generic sentence for a reason would lose the one word the reader
 * needs in order to ask for the right thing.
 *
 * NO_CAPABILITY is shared by receiving and transfers, but "not authorized to receive stock" and "not
 * authorized to move transfers" send an operator to ask for different grants. A shared REASON must
 * not force a shared SENTENCE.
 */
const WORKFLOW_UNAVAILABLE_TEXT = Object.freeze({
  [SCAN_WORKFLOW.SUPPLIER_RECEIVING]: Object.freeze({
    [UNAVAILABLE_REASON.NO_CAPABILITY]: "You are not authorized to receive stock. An administrator can grant it.",
  }),
  [SCAN_WORKFLOW.TRANSFER]: Object.freeze({
    [UNAVAILABLE_REASON.NO_CAPABILITY]: "You are not authorized to send or receive transfers. An administrator can grant it.",
  }),
  [SCAN_WORKFLOW.CYCLE_COUNT]: Object.freeze({
    [UNAVAILABLE_REASON.NO_CAPABILITY]: "You are not authorized to count stock. An administrator can grant it.",
  }),
  [SCAN_WORKFLOW.PUT_AWAY]: Object.freeze({
    [UNAVAILABLE_REASON.NO_CAPABILITY]: "You are not authorized to put stock away. An administrator can grant it.",
  }),
  [SCAN_WORKFLOW.PICK]: Object.freeze({
    [UNAVAILABLE_REASON.NO_CAPABILITY]: "You are not authorized to pick and stage stock. An administrator can grant it.",
  }),
});

export const UNAVAILABLE_TEXT = Object.freeze({
  [UNAVAILABLE_REASON.NO_CAPABILITY]:
    "You are not authorized. An administrator can grant it.",
  [UNAVAILABLE_REASON.NOT_READY]:
    "Receiving is built and you are authorized, but it is not switched on in this environment yet.",
  [UNAVAILABLE_REASON.NO_TECHNICIAN_IDENTITY]:
    "Work order scanning is for technicians working an assigned job.",
  [UNAVAILABLE_REASON.NO_ASSIGNED_WORK]:
    "You have no assigned work orders to scan against right now.",
});

/**
 * The sentence for one unavailable workflow: its own wording where it has one, and the reason's
 * general wording otherwise.
 */
export function unavailableText(workflow, reason) {
  return WORKFLOW_UNAVAILABLE_TEXT[workflow]?.[reason] ?? UNAVAILABLE_TEXT[reason] ?? null;
}
