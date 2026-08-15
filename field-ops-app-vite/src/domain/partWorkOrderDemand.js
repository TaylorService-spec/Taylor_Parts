// Part -> Work Order Demand -- Wave 7 Item 3. Pure projection answering the Owner's question "Which Work
// Orders need this part?" from ALREADY-READ Work Order documents. No I/O here (the caller performs the
// Firestore reads -- see hooks/usePartWorkOrderDemand.js) -- this only DERIVES the per-Work-Order demand
// rows from the canonical fieldops_wos authority. It is a PROJECTION, not a second demand engine: it never
// creates, edits, or persists anything, and it never invents a quantity the WO document does not itself
// carry.
//
// Authority (unchanged, see domain/workOrderPartsReadiness.js's header for the full map):
//   PLANNED   WorkOrder.inventorySnapshot[].qtyPlanned  (keyed on partId)
//   USED      WorkOrder.inventorySnapshot[].qtyUsed
// Reserved/warehouse/truck/procurement availability are OUT OF SCOPE for this projection (that is
// workOrderPartsReadiness.js's job, per-job, not per-part-across-jobs) -- this module only answers "which
// Work Orders planned or used this part, and how much," never whether the part is available to them.
//
// Identity is partId-only (mirrors domain/workOrderPartsPlan.js's planLinesFromSnapshot): an
// inventorySnapshot row with no canonical partId cannot be honestly attributed to this Part, so it is
// simply not counted as a match -- never fabricated into a row, never silently treated as "0 for this
// part" either.
//
// Terminal Work Orders (COMPLETED/CLOSED/CANCELLED) no longer NEED the part -- a finished or dead job has
// stopped consuming inventory. They are therefore excluded from the demand rows (a completed job is not
// "demand"), but the exclusion is counted and reported (`excludedTerminalCount`) so the caller can be
// honest about what was filtered rather than making terminal Work Orders silently vanish.
//
// The set is IMPORTED from workOrderPartsPlan.js rather than copied. That module's
// PLAN_TERMINAL_STATUSES is already drift-tested against the server's canonical TERMINAL_STATUSES
// (functions/src/transitionEngine.ts) by workOrderPartsPlan.test.mjs, so importing it means this module
// inherits that guarantee. A third hand-maintained copy would be a third thing to silently drift --
// this repo already carries one such copy in technicianRecommendationEngine.ts, and adding another is
// not a precedent worth extending.

import { PLAN_TERMINAL_STATUSES } from "./workOrderPartsPlan.js";

const TERMINAL_STATUSES = new Set(PLAN_TERMINAL_STATUSES);

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
const isFiniteNonNegNumber = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

// Sums qtyPlanned/qtyUsed across every inventorySnapshot row that carries THIS canonical partId (a WO can
// legitimately record more than one snapshot row for the same part -- see functions/src/inventoryService.ts).
// Returns null when nothing in the snapshot can be honestly matched to this part (no match at all, or the
// snapshot itself is missing/malformed) -- the caller treats null as "this Work Order is not demand for this
// part," never as a zero quantity for a part it does need. Malformed rows (non-object entries, a partId that
// isn't a non-empty string, a qty that isn't a finite number) are skipped, never crashed on and never
// coerced into a fabricated value.
function sumSnapshotForPart(inventorySnapshot, partId) {
  if (!Array.isArray(inventorySnapshot)) return null;

  let matched = false;
  let plannedTotal = 0;
  let plannedKnown = false;
  let usedTotal = 0;
  let usedKnown = false;

  for (const item of inventorySnapshot) {
    if (!item || typeof item !== "object") continue;
    const itemPartId = isNonEmptyString(item.partId) ? item.partId.trim() : null;
    if (!itemPartId || itemPartId !== partId) continue; // no canonical id, or a different part -- not a match

    matched = true;
    if (isFiniteNonNegNumber(item.qtyPlanned)) {
      plannedTotal += item.qtyPlanned;
      plannedKnown = true;
    }
    if (isFiniteNonNegNumber(item.qtyUsed)) {
      usedTotal += item.qtyUsed;
      usedKnown = true;
    }
  }

  if (!matched) return null;
  return {
    qtyPlanned: plannedKnown ? plannedTotal : null, // null = UNKNOWN, never a fabricated 0
    qtyUsed: usedKnown ? usedTotal : null,
  };
}

// Builds the per-Work-Order demand rows for one canonical partId from a set of already-read Work Order
// documents (each `{ id, status, woNumber?, customerId?, locationId?, scheduledStart?, inventorySnapshot?,
// ... }` -- the raw fieldops_wos shape, id included). Duplicate Work Order ids (e.g. the same document
// surfacing twice across paginated/merged reads) are suppressed -- one row per Work Order, ever.
//
// Returns:
//   rows                  -- one row per NON-TERMINAL Work Order that demands this part (see below)
//   excludedTerminalCount -- how many otherwise-matching Work Orders were excluded for being terminal
//   malformedCount        -- how many input entries could not be read as a Work Order at all (no crash)
export function buildPartWorkOrderDemand({ workOrders = [], partId } = {}) {
  const target = isNonEmptyString(partId) ? partId.trim() : null;
  if (!target || !Array.isArray(workOrders)) {
    return { rows: [], excludedTerminalCount: 0, malformedCount: 0 };
  }

  const seenWorkOrderIds = new Set();
  const rows = [];
  let excludedTerminalCount = 0;
  let malformedCount = 0;

  for (const wo of workOrders) {
    if (!wo || typeof wo !== "object") {
      malformedCount += 1;
      continue;
    }
    const id = isNonEmptyString(wo.id) ? wo.id.trim() : null;
    if (!id) {
      malformedCount += 1;
      continue;
    }
    if (seenWorkOrderIds.has(id)) continue; // duplicate suppression -- already produced (or evaluated) once

    const matched = sumSnapshotForPart(wo.inventorySnapshot, target);
    if (!matched) continue; // this Work Order does not carry this part -- not demand for it

    seenWorkOrderIds.add(id);

    const status = isNonEmptyString(wo.status) ? wo.status.trim() : null;
    if (status && TERMINAL_STATUSES.has(status)) {
      excludedTerminalCount += 1;
      continue; // finished/dead -- no longer needs the part
    }

    const qtyPlanned = matched.qtyPlanned;
    const qtyUsed = matched.qtyUsed;
    // "Remaining requirement" is only mathematically safe when BOTH sides are known numbers -- otherwise
    // it stays null (UNKNOWN), never a guess built from a partially-known input.
    const remaining =
      typeof qtyPlanned === "number" && typeof qtyUsed === "number" ? Math.max(0, qtyPlanned - qtyUsed) : null;

    rows.push({
      workOrderId: id,
      woNumber: isNonEmptyString(wo.woNumber) ? wo.woNumber.trim() : null,
      status: status ?? null,
      customerId: isNonEmptyString(wo.customerId) ? wo.customerId.trim() : null,
      locationId: isNonEmptyString(wo.locationId) ? wo.locationId.trim() : null,
      // Firestore Timestamp (or null) -- the caller formats it; this stays a pure passthrough, never a
      // computed/derived date.
      scheduledStart: wo.scheduledStart ?? null,
      qtyPlanned,
      qtyUsed,
      remaining,
    });
  }

  return { rows, excludedTerminalCount, malformedCount };
}
