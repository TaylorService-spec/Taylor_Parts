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
