// Wave 7 extension, PART 5 -- the SECOND bounded attention-projection slice (WO / Dispatch), mirroring
// the Wave 6 Parts Attention Projection pattern (domain/partsAttentionProjection.js) EXACTLY: pure
// normalization of ALREADY-READ, AUTHORITATIVE facts into a stable attention model -- NOT business
// authority, NOT a new collection, NOT an independent workflow, NOT a generic Action Center.
//
// Source of truth stays fieldops_wos + its existing governed lifecycle (workOrderWorkflow.js /
// transitionEngine.ts); this module only classifies what already exists. Every fact this module reports
// traces to a canonical source it COMPOSES rather than re-derives:
//
//   READY_TO_DISPATCH (unscheduled)  -- schedulingWorkspace.js's SCHEDULABLE_STATUS constant.
//   PAST_DUE / OVERLAP (scheduling)  -- schedulingWorkspace.js's toMillis()/detectDayOverlaps() helpers,
//                                       applied globally (not week-bound -- see workOrderOverlapItems).
//   Parts blocker                    -- workOrderPartsReadiness.js's buildWorkOrderPartsReadiness()
//                                       OUTPUT, already computed by the caller from its own resolved
//                                       warehouse/truck/procurement dimensions. This module never reads
//                                       or re-derives a single part dimension itself.
//
// Explicitly NOT projected (audited, does not exist / out of scope -- see docs/roadmaps and the Wave 7
// PART 5 task brief): technician skill/eligibility (no such model exists), a distinct "schedule blocker"
// state (does not exist), and a due date for unscheduled work (scheduledStart is the ONLY date authority
// and only exists once scheduled -- inventing one here would be exactly the fabrication this pattern
// forbids). Stalled-job risk (jobRiskScoring.js) and dispatch ranking (dispatchScoring.js) are NOT
// re-projected into this taxonomy either -- they already have their own established 4-tier severity
// panels (AtRiskPanel / OverloadedTechPanel); duplicating them here under this 2-value taxonomy would
// create the exact "same badge vocabulary, different meaning" confusion partsAttentionProjection.js's
// consumer (NotificationPanel.jsx) explicitly warns against for urgency vs. severity.
//
// Taxonomy (Owner's 3-category model, same as Parts): ACTION_ITEM ("you need to do something") vs
// NOTIFICATION ("something happened / is in motion, no action required right now"). No ALERT category --
// no repository evidence justifies inventing severity independent of workflow status.

// SCHEDULABLE_STATUS is schedulingWorkspace.js's own derivation of "the one status from which Schedule is
// a valid transition" (itself derived from workOrderWorkflow.js's transition table, not a re-typed
// literal) -- reused here so this stays in lockstep with that mirror automatically. toMillis()/
// detectDayOverlaps() are its own timestamp-normalization and interval-overlap primitives, reused below
// rather than re-implemented.
import { SCHEDULABLE_STATUS, toMillis, detectDayOverlaps } from "./schedulingWorkspace.js";

export const WO_ATTENTION_TYPE = Object.freeze({
  ACTION_ITEM: "ACTION_ITEM",
  NOTIFICATION: "NOTIFICATION",
});

// A WO in either of these statuses is terminal for attention purposes -- CANCELLED is dead work,
// CLOSED is fully wound down. COMPLETED is deliberately NOT terminal here even though it is close to the
// end of the lifecycle: none of the three audited signals below can ever fire for a COMPLETED/CLOSED/
// CANCELLED WO anyway (none of them require gating on this set explicitly), this constant exists so any
// future signal added to this module has one obvious, shared terminal boundary to check against, matching
// the Parts pattern's explicit terminal-status list.
export const WO_ATTENTION_TERMINAL_STATUSES = Object.freeze(["CLOSED", "CANCELLED"]);

function isNonEmptyString(v) {
  return typeof v === "string" && v.length > 0;
}

function startOfDayMillis(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Shared identity/deep-link shape every WO Attention Item carries. `deepLink` is the EXACT canonical route
// every other WO surface already uses (WorkOrdersList.jsx, WorkOrderWizard.jsx, ServiceActivitySection.jsx,
// PartWorkOrderDemandSection.jsx, EquipmentTimeline.jsx, searchProviders.js) -- not a new route. Resolution
// for every signal below lives in the WO/Dispatch domain (Schedule / Dispatch / reassign), so every item
// routes to the SAME governed WO detail surface that can actually act on it, per the "resolution stays in
// the controlling domain" rule -- never an inline mutation from this projection.
function baseItem(wo, kind) {
  return {
    attentionItemId: `workOrder:${kind}:${wo.id}`,
    domain: "workOrder",
    objectType: "workOrder",
    objectId: wo.id,
    workOrderId: wo.id,
    woNumber: wo.woNumber ?? wo.id,
    deepLink: `/service/work-orders/${wo.id}`,
  };
}

// -- Signal 1: READY but unscheduled -----------------------------------------------------------------

// One WorkOrder -> one Attention Item, or null. A READY_TO_DISPATCH WO has nothing else standing between
// it and a dispatcher's Schedule action -- always actionable, never merely informational.
export function workOrderReadyUnscheduledItem(wo) {
  if (!wo || !isNonEmptyString(wo.id)) return null;
  if (wo.status !== SCHEDULABLE_STATUS) return null;
  return {
    ...baseItem(wo, "readyUnscheduled"),
    attentionType: WO_ATTENTION_TYPE.ACTION_ITEM,
    requiresAction: true,
    recipientRole: "DISPATCHER",
    sectionLabel: "Ready to Schedule",
    reason: "READY_TO_DISPATCH",
  };
}

// -- Signal 2: past-due scheduled work ----------------------------------------------------------------
// Mirrors schedulingWorkspace.buildWeeklySchedule's own PAST_DUE predicate EXACTLY (scheduledStart before
// today, status still SCHEDULED) -- reusing its toMillis() timestamp normalizer so every Firestore
// timestamp shape (client Timestamp, Date, {seconds,nanoseconds}, raw ms) is handled identically to the
// weekly board, never re-implemented. Unlike buildWeeklySchedule (which is week-windowed for the
// scheduling board's UI), this is intentionally GLOBAL: an attention projection must never miss a WO that
// fell overdue outside whatever week a dispatcher happens to be viewing.
export function workOrderPastDueItem(wo, { nowMs = Date.now() } = {}) {
  if (!wo || !isNonEmptyString(wo.id)) return null;
  if (wo.status !== "SCHEDULED") return null;
  const startMillis = toMillis(wo.scheduledStart);
  if (startMillis == null) return null;
  if (startMillis >= startOfDayMillis(nowMs)) return null;
  return {
    ...baseItem(wo, "pastDue"),
    attentionType: WO_ATTENTION_TYPE.ACTION_ITEM,
    requiresAction: true,
    recipientRole: "DISPATCHER",
    sectionLabel: "Past Due",
    reason: "PAST_DUE",
    scheduledStartMillis: startMillis,
  };
}

// -- Signal 3: scheduling conflict (technician double-booking) ----------------------------------------
// Groups every non-terminal WO with a resolvable scheduledStart + technician by (technician, calendar
// day), then hands each group to schedulingWorkspace's OWN detectDayOverlaps() -- the exact interval-
// overlap algorithm the weekly board uses -- instead of re-implementing interval intersection here. Global
// (not week-bound) for the same "never miss it because of the viewed week" reason as PAST_DUE above.
export function workOrderOverlapItems(workOrders = [], { nowMs = Date.now() } = {}) {
  void nowMs; // reserved for parity with the other batch signatures; overlap detection itself is time-independent
  if (!Array.isArray(workOrders)) return [];

  const byTechDay = new Map();
  const byId = new Map();
  for (const wo of workOrders) {
    if (!wo || !isNonEmptyString(wo.id)) continue;
    if (WO_ATTENTION_TERMINAL_STATUSES.includes(wo.status)) continue;
    const startMillis = toMillis(wo.scheduledStart);
    if (startMillis == null) continue;
    const endMillis = toMillis(wo.scheduledEnd);
    const techId = wo.assignedTechId || wo.scheduledTechId || null;
    if (!techId) continue; // overlap is inherently a per-technician concept -- no technician, no conflict to detect
    byId.set(wo.id, wo);
    const dayKey = `${techId}:${startOfDayMillis(startMillis)}`;
    if (!byTechDay.has(dayKey)) byTechDay.set(dayKey, []);
    byTechDay.get(dayKey).push({ id: wo.id, startMillis, endMillis, techId });
  }

  const overlapping = new Map(); // id -> techId, dedup across (rare) multiple conflicting pairs
  for (const jobs of byTechDay.values()) {
    for (const id of detectDayOverlaps(jobs)) {
      const job = jobs.find((j) => j.id === id);
      overlapping.set(id, job?.techId ?? null);
    }
  }

  const items = [];
  for (const [id, techId] of overlapping) {
    const wo = byId.get(id);
    if (!wo) continue;
    items.push({
      ...baseItem(wo, "overlap"),
      attentionType: WO_ATTENTION_TYPE.ACTION_ITEM,
      requiresAction: true,
      recipientRole: "DISPATCHER",
      sectionLabel: "Scheduling Conflict",
      reason: "OVERLAP",
      techId,
    });
  }
  return items;
}

// -- Signal 4: parts blocker --------------------------------------------------------------------------
// Composes an ALREADY-COMPUTED workOrderPartsReadiness.buildWorkOrderPartsReadiness() result for this WO
// -- this module never reads or re-derives a single warehouse/truck/procurement dimension itself.
//
// jobReadiness NO_PLAN is explicitly NOT surfaced: a job with nothing planned is not "blocked" (this is
// a load-bearing distinction the task brief calls out by name -- NO_PLAN must never read as an attention
// item). READY is nothing to do. UNKNOWN is an honest "cannot confirm" (a needed source -- e.g. truck
// inventory -- is unavailable/unknown), which is NOT the same as a CONFIRMED problem, so it is never
// escalated into an attention item either -- exactly readinessLanguage.js's own "UNAVAILABLE is not a
// readiness severity" rule.
//
// Only a CONFIRMED shortage (jobReadiness === ATTENTION, with at least one row that actually says so) is
// surfaced. That row's own `reason` (already derived by the readiness projection -- never re-derived here)
// decides ACTION_ITEM vs NOTIFICATION: PROCUREMENT_PENDING means the shortage is already being worked by
// the existing procurement chain -- nothing outstanding from the WO/Dispatch owner right now -- the exact
// same "in-motion vs. stalled" distinction partsAttentionProjection.js draws for PURCHASING_IN_PROGRESS,
// reused here rather than reinvented. Any other ATTENTION reason (SHORT / SHORT_PROCUREMENT_UNAVAILABLE)
// is a genuine, nothing-happening shortage -- an Action Item.
const PARTS_NOTIFICATION_REASONS = new Set(["PROCUREMENT_PENDING"]);

export function workOrderPartsBlockerItem(wo, partsReadiness) {
  if (!wo || !isNonEmptyString(wo.id)) return null;
  if (!partsReadiness || typeof partsReadiness !== "object") return null;
  if (partsReadiness.jobReadiness !== "ATTENTION") return null; // NO_PLAN / READY / UNKNOWN never surfaced

  const rows = Array.isArray(partsReadiness.rows) ? partsReadiness.rows : [];
  const attentionRows = rows.filter((r) => r && r.readiness === "ATTENTION");
  if (attentionRows.length === 0) return null; // rollup says ATTENTION but no row confirms it -- honest null, never guessed

  const allInMotion = attentionRows.every((r) => PARTS_NOTIFICATION_REASONS.has(r.reason));

  return {
    ...baseItem(wo, "partsBlocker"),
    attentionType: allInMotion ? WO_ATTENTION_TYPE.NOTIFICATION : WO_ATTENTION_TYPE.ACTION_ITEM,
    requiresAction: !allInMotion,
    // Resolution for a parts shortfall lives in Purchasing/Parts (the reorder-request lifecycle), not
    // Dispatch -- there is no WO/Dispatch role that "fixes" this by acting on the WO itself, so this is
    // honestly null rather than assigned to a role that can't actually resolve it.
    recipientRole: null,
    sectionLabel: "Parts Blocked",
    reason: allInMotion ? "PROCUREMENT_PENDING" : "SHORT",
    shortfallCount: attentionRows.length,
  };
}

// -- Batch + grouping ----------------------------------------------------------------------------------

// Many WorkOrders (+ an optional per-WO parts-readiness map, keyed by workOrderId, built by the caller
// from workOrderPartsReadiness.js) -> many Attention Items. Malformed/non-actionable entries dropped,
// never fabricated. A single `nowMs` is forwarded to every per-WO signal so one consistent snapshot is
// used across the whole batch (avoids staleness flapping mid-render), matching partsAttentionItems().
export function workOrderAttentionItems({
  workOrders = [],
  partsReadinessByWorkOrderId = {},
  nowMs = Date.now(),
} = {}) {
  if (!Array.isArray(workOrders)) return [];

  const items = [];
  for (const wo of workOrders) {
    const ready = workOrderReadyUnscheduledItem(wo);
    if (ready) items.push(ready);

    const pastDue = workOrderPastDueItem(wo, { nowMs });
    if (pastDue) items.push(pastDue);

    if (wo && isNonEmptyString(wo.id) && partsReadinessByWorkOrderId && typeof partsReadinessByWorkOrderId === "object") {
      const blocker = workOrderPartsBlockerItem(wo, partsReadinessByWorkOrderId[wo.id]);
      if (blocker) items.push(blocker);
    }
  }

  items.push(...workOrderOverlapItems(workOrders, { nowMs }));
  return items;
}

// Fixed section order, mirroring PARTS_ATTENTION_SECTION_ORDER's convention: one label per signal KIND
// (not per attentionType) -- Parts Blocked holds BOTH the ACTION_ITEM (SHORT) and NOTIFICATION
// (PROCUREMENT_PENDING) variants under one section, exactly like Purchasing Started does today.
export const WO_ATTENTION_SECTION_ORDER = Object.freeze([
  "Ready to Schedule",
  "Past Due",
  "Scheduling Conflict",
  "Parts Blocked",
]);

// Groups a flat Attention Item list into `{ sectionLabel, items }[]` in WO_ATTENTION_SECTION_ORDER,
// omitting empty sections. Pure, no I/O.
export function groupWorkOrderAttentionItemsBySection(items) {
  if (!Array.isArray(items)) return [];
  const bySection = new Map();
  for (const item of items) {
    if (!item || typeof item.sectionLabel !== "string") continue;
    if (!bySection.has(item.sectionLabel)) bySection.set(item.sectionLabel, []);
    bySection.get(item.sectionLabel).push(item);
  }
  return WO_ATTENTION_SECTION_ORDER.filter((label) => bySection.has(label)).map((label) => ({
    sectionLabel: label,
    items: bySection.get(label),
  }));
}
