// WO Parts Planning — Phase 2 (client pure core): validate the BUSINESS INTENT "plan these parts for this
// Work Order" before it is handed to the governed producer command. Pure (no I/O; unit-tested).
//
// This is the CLIENT mirror of the invariants the trusted server command (setWorkOrderPartsPlan — see
// docs/design/wo-parts-plan-command.md) will re-enforce as the authority. It never writes anything and
// never reserves anything: a plan is a set of PLANNED quantities only.
//
//   PLAN PARTS  !=  RESERVE PARTS  !=  USE PARTS.
//
// Planning may set the governed qtyPlanned representation. It must NOT create reservations, inventory
// movements, usage, procurement, required or returned quantities, or equipment-compatibility authority —
// those stay with their existing owners (dispatch/reservation, execution capture, the reorder chain, …).
// Identity is the canonical `partId` (never the non-authoritative catalog SKU).

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
const isPositiveInt = (v) => typeof v === "number" && Number.isInteger(v) && v > 0;

// Validate + normalize a proposed plan (a list of intent lines) into the canonical planned-parts shape.
// Each line: { partId, name?, qtyPlanned }. Returns { ok:true, value:[{partId,name,qtyPlanned}] } or
// { ok:false, error } with a stable, user-safe code. An EMPTY plan is valid input (it expresses "clear the
// plan"); whether a specific part may actually be removed is a MERGE invariant (see planRemovalBlocked),
// because a part that already has recorded usage cannot be un-planned.
export function buildPartsPlanInput(lines) {
  if (!Array.isArray(lines)) return { ok: false, error: "PLAN_MUST_BE_LIST" };

  const seen = new Set();
  const value = [];
  for (const raw of lines) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "LINE_INVALID" };
    const partId = isNonEmptyString(raw.partId) ? raw.partId.trim() : null;
    if (!partId) return { ok: false, error: "PART_REQUIRED" };
    if (seen.has(partId)) return { ok: false, error: "DUPLICATE_PART" };
    if (!isPositiveInt(raw.qtyPlanned)) return { ok: false, error: "QTY_INVALID" };
    seen.add(partId);
    value.push({
      partId,
      name: isNonEmptyString(raw.name) ? raw.name.trim() : null,
      qtyPlanned: raw.qtyPlanned,
    });
  }
  return { ok: true, value };
}

// Which currently-planned parts would this proposed plan REMOVE (present now, absent from the plan)?
// Pure helper the UI uses to warn before submit; the server command re-checks authoritatively.
export function planRemovals(currentPlanned = [], proposed = []) {
  const keep = new Set(proposed.map((p) => p.partId));
  return currentPlanned.filter((c) => c.partId && !keep.has(c.partId)).map((c) => c.partId);
}

// A removal is BLOCKED when the part already has recorded usage (qtyUsed > 0): you cannot un-plan a part a
// technician has already consumed against. Returns the blocked partIds (empty = safe to submit). PLAN never
// touches qtyUsed; this only guards the plan from erasing a part that execution already acted on.
export function planRemovalBlocked(currentPlanned = [], proposed = []) {
  const removed = new Set(planRemovals(currentPlanned, proposed));
  return currentPlanned
    .filter((c) => removed.has(c.partId) && typeof c.qtyUsed === "number" && c.qtyUsed > 0)
    .map((c) => c.partId);
}

// CLIENT MIRROR of the server's plannability guard (assertPlannable,
// functions/src/workOrderPartsPlan/setWorkOrderPartsPlan.ts, which uses the canonical
// TERMINAL_STATUSES from functions/src/transitionEngine.ts). Planning a finished or dead job would
// misrepresent it, so the command refuses.
//
// This is UX ONLY -- it decides whether to OFFER editing, never whether editing is permitted. The
// server re-checks and is the authority. If the two ever disagree, the server wins and the user sees
// an honest error rather than a silent success.
//
// Kept in lockstep with the server set by workOrderPartsPlan.test.mjs, which asserts these exact
// three ids; if the server's TERMINAL_STATUSES changes, that test fails here.
export const PLAN_TERMINAL_STATUSES = Object.freeze(["COMPLETED", "CLOSED", "CANCELLED"]);

export function isPlanEditableStatus(status) {
  // An unknown/absent status is NOT treated as terminal: the server makes the real call, and
  // hiding the editor on a status we simply don't recognize would strand a legitimately plannable
  // Work Order with no way to act on it.
  if (typeof status !== "string" || status.trim().length === 0) return true;
  return !PLAN_TERMINAL_STATUSES.includes(status.trim());
}

// Project the Work Order's recorded inventorySnapshot into editable plan lines.
//
// The snapshot is the WO's own authoritative record and carries BOTH planned and used quantities;
// this keeps them distinct rather than flattening them. `qtyUsed` rides along read-only so the editor
// can show consumption and enforce the removal guard, but it is NEVER part of the plan payload the
// command receives -- PLAN != USE.
//
// Lines with no planned quantity but recorded usage are still returned (qtyPlanned 0), because they
// are real consumption the planner must see; they simply are not currently planned.
//
// Rows with NO canonical partId are returned too, marked `editable: false`. They must NOT be hidden:
// the command replaces the WHOLE plan, so a payload that silently omitted a legacy row would DELETE
// a real planned part. Keeping them visible is what makes planHasUnresolvedLines able to refuse the
// edit rather than destroy data. The row keeps its own snapshot-recorded category/unit so whatever
// surface renders it can degrade exactly as the Work Order's own record does.
export function planLinesFromSnapshot(inventorySnapshot = []) {
  if (!Array.isArray(inventorySnapshot)) return [];
  return inventorySnapshot
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const partId = typeof item.partId === "string" && item.partId.trim() ? item.partId.trim() : null;
      return {
        partId,
        editable: partId !== null,
        raw: item,
        qtyPlanned: typeof item.qtyPlanned === "number" && item.qtyPlanned > 0 ? item.qtyPlanned : 0,
        qtyUsed: typeof item.qtyUsed === "number" && item.qtyUsed > 0 ? item.qtyUsed : 0,
      };
    });
}

// Does this plan contain a PLANNED row the client cannot address by canonical partId?
//
// Identity for the command is partId-only. If such a row exists, no safe full-plan payload can be
// built from the client: including it is impossible, and omitting it means removal. The editor must
// therefore refuse to edit at all rather than offer a save that would quietly drop a real planned
// part. (The server can match and backfill legacy rows itself; that reconciliation is its job, not
// something the UI may pre-empt by guessing an identity.)
export function planHasUnresolvedLines(lines = []) {
  return lines.some((l) => l && l.editable === false && l.qtyPlanned > 0);
}
