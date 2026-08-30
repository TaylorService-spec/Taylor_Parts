// Service Operations — North Star P1 projection.
//
// The derivation layer for the Service Operations Overview page, in the same shape families 1 and 2
// use (domain/workOrderNorthStar.js, domain/salesOrderNorthStar.js): a pure module that COMPOSES the
// already-governed domain functions into the exact rows the composition renders, so no derivation
// lives in JSX and every row is testable without a DOM.
//
// This module NEVER derives a business fact of its own. Every value below traces to a function that
// already owns it:
//
//   fieldPhase()                       domain/fieldWorkOrder.js       phase of a governed WO
//   workOrderAttentionItems()          domain/workOrderAttentionProjection.js   attention taxonomy
//   detectStalledJobs()                domain/jobRiskScoring.js       risk severity + factors
//   computeDispatchRecommendations()   domain/dispatchScoring.js      dispatch ranking
//   detectOverloadedTechnicians()      domain/dispatchScoring.js      overload threshold
//   groupJobsByTechnician()            modules/controlTower/techUtils.js   WO -> technician grouping
//   resolveTechnicianIdentity()        domain/actorDisplayName.js     name, never a raw id
//   technicianStatusLabel()            modules/dispatcherBoard/technicianStatusLabel.js  status word, never an enum
//   buildTimeline() / describeEvent()  domain/timelineBuilder.js, eventModel.js
//
// ── Owner rulings this module implements (Service Operations P1, 2026-08-30) ────────────────────
//
// SO-N1  Attention carries NO risk severity. The attention taxonomy (ACTION_ITEM / NOTIFICATION and
//        the four governed section labels) and the risk severity scale (jobRiskScoring's four tiers)
//        are separate vocabularies over separate questions, and workOrderAttentionProjection.js's own
//        header warns against merging them. Attention rows here carry attentionType and sectionLabel
//        only. Risk severity appears in the At risk table and nowhere else.
// SO-N2  No "Urgent" section, and no second unassigned derivation. The governed sections are the
//        only sections. "Unassigned work needing a dispatcher" is already Ready to Schedule; deriving
//        `unfinished && !assignedTechId` beside the projection would double-count the same work order
//        under two names.
// SO-N3  No per-event clock time in activity. timelineBuilder stamps EVERY milestone with the work
//        order's createdAt (documented approximation — no per-transition timestamps exist), so three
//        milestones for one WO share one clock time. Rendering it would claim a precision the data
//        does not have. Recorded as SO-G6; not solved here.
// SO-N4  No attention "owner". recipientRole is a ROLE ("DISPATCHER"), not a person.
// SO-N5  No activity actor. The event model carries no actor identity at all.
// SO-N7  On-shift excludes OFF_SHIFT. `technicians.length` would count off-shift staff and make the
//        label false.
// SO-N9  No "past readiness" — not a repository fact. The secondary count on Awaiting dispatch is the
//        governed Ready to Schedule attention count, named exactly that.
//
// SO-G5  Parts readiness is not read by this page, so the projection's Parts Blocked section is
//        honestly empty rather than fabricated. `partsReadinessByWorkOrderId` stays a parameter so the
//        section lights up unchanged the day a caller supplies it.

import { FIELD_PHASE, fieldPhase } from "./fieldWorkOrder.js";
import { TECH_STATUS } from "./constants.js";
import { resolveTechnicianIdentity } from "./actorDisplayName.js";
// Imported from its established home rather than moved into domain/. It has three consumers and
// test/workOrderStatusLabelConformance.test.mjs pins that exact import path -- relocating a shared
// helper is a separate change, not a rider on this migration.
import { technicianStatusLabel } from "../modules/dispatcherBoard/technicianStatusLabel.js";
import { detectStalledJobs } from "./jobRiskScoring.js";
import { computeDispatchRecommendations, detectOverloadedTechnicians } from "./dispatchScoring.js";
import { buildTimeline } from "./timelineBuilder.js";
import { describeEvent } from "./eventModel.js";
import {
  workOrderAttentionItems,
  groupWorkOrderAttentionItemsBySection,
} from "./workOrderAttentionProjection.js";
import { groupJobsByTechnician } from "../modules/controlTower/techUtils.js";

// The canonical Work Order deep link (SO-N8). Attention items carry their own `deepLink` built by the
// projection; rows built from OTHER sources (risk, dispatch) need the same route, and it is defined
// once here rather than re-typed per section. `/work-orders/:id` — the route the design handoff named
// — does not exist; the real route is nested under /service.
export const workOrderHref = (workOrderId) => `/service/work-orders/${workOrderId}`;

// Where the page's links go. Board routes come from navConfig's Service subnav paths; naming them
// once keeps a relabelled nav item from silently breaking five call sites.
export const SERVICE_OPS_LINKS = Object.freeze({
  workOrders: "/service/work-orders",
  dispatcherBoard: "/service/dispatcher-board",
});

// Anchors for the metric strip's exception links. A metric's exception count must REACH its rows
// (grammar pattern 4), and on a single-page composition that means an in-page anchor.
export const SECTION_ID = Object.freeze({
  attention: "service-ops-attention",
  atRisk: "service-ops-at-risk",
  technicianLoad: "service-ops-technician-load",
});

const accountLabel = (workOrder, accountNames) => {
  if (!workOrder) return null;
  const resolved = accountNames?.get?.(workOrder.customerId);
  return resolved || null;
};

const workOrderById = (workOrders) => {
  const map = new Map();
  for (const wo of workOrders ?? []) {
    if (wo && typeof wo.id === "string") map.set(wo.id, wo);
  }
  return map;
};

// ── Attention (pattern 3) ─────────────────────────────────────────────────────────────────────────

// Governed sections only, in WO_ATTENTION_SECTION_ORDER, with the account resolved for display.
// Returns `{ sections, total, partsReadinessConnected }`.
//
// The account is a JOIN, not a derivation: the attention item carries workOrderId, the work order
// carries customerId, and useAccountNames already resolved customerId -> name for this same snapshot.
// When it cannot be resolved the row simply omits the account — it never prints the customerId, which
// is a document key and not a customer (DECISIONS #106).
export function serviceOperationsAttention({
  workOrders = [],
  technicians = [],
  accountNames,
  partsReadinessByWorkOrderId = null,
  nowMs = Date.now(),
} = {}) {
  const items = workOrderAttentionItems({
    workOrders,
    // SO-G5: `null` (this page's real state) and `{}` are both "no readiness supplied". The projection
    // takes an object, so the empty object is what it receives; the DIFFERENCE is reported out as
    // partsReadinessConnected so the composition can state the boundary instead of showing a clean
    // Parts section that merely looks clean.
    partsReadinessByWorkOrderId: partsReadinessByWorkOrderId ?? {},
    nowMs,
  });

  const byId = workOrderById(workOrders);
  const decorated = items.map((item) => {
    const wo = byId.get(item.workOrderId);
    return {
      ...item,
      account: accountLabel(wo, accountNames),
      // Present only where the governed item actually carries a technician (the Scheduling Conflict
      // signal). Never a raw id — resolveTechnicianIdentity refuses that (F-UID-1).
      technicianName: item.techId
        ? resolveTechnicianIdentity(item.techId, { technicians }).name
        : null,
      href: item.deepLink,
    };
  });

  return {
    sections: groupWorkOrderAttentionItemsBySection(decorated),
    total: decorated.length,
    partsReadinessConnected: partsReadinessByWorkOrderId != null,
  };
}

// The Ready to Schedule count, for the Awaiting dispatch metric's exception line (SO-N9). Read off the
// SAME projection the attention block renders, so the number a dispatcher sees in the strip and the
// rows they land on after clicking cannot disagree.
export const readyToScheduleCount = (attention) =>
  attention?.sections?.find((s) => s.sectionLabel === "Ready to Schedule")?.items.length ?? 0;

// ── Metric strip (pattern 4) ──────────────────────────────────────────────────────────────────────

// Exactly four metrics. Every one is linked and every one carries its exception count, or states in
// words that it has none — the grammar forbids an unlinked vanity number.
//
// `techniciansAvailable` is the honest-state switch, not a styling flag: when the technician read has
// failed, the on-shift metric reports `null` (rendered "unavailable") rather than 0, because zero is
// only reported when zero is KNOWN.
export function serviceOperationsMetrics({
  workOrders = [],
  technicians = [],
  attention,
  techniciansAvailable = true,
} = {}) {
  const byPhase = (phase) => workOrders.filter((wo) => fieldPhase(wo) === phase).length;

  const awaitingDispatch = byPhase(FIELD_PHASE.AWAITING_DISPATCH);
  const inProgress = byPhase(FIELD_PHASE.ASSIGNED) + byPhase(FIELD_PHASE.ON_SITE);
  const completed = byPhase(FIELD_PHASE.FINISHED);

  // SO-N7 -- on shift is every technician NOT off shift. `technicians.length` would count off-shift
  // staff under a label that says they are working.
  const onShift = techniciansAvailable
    ? technicians.filter((t) => t?.status !== TECH_STATUS.OFF_SHIFT).length
    : null;

  const atRiskCount = detectStalledJobs(workOrders, technicians).length;
  const overloadedCount = techniciansAvailable
    ? detectOverloadedTechnicians(technicians, workOrders).length
    : 0;
  const readyCount = readyToScheduleCount(attention);

  return [
    {
      key: "awaitingDispatch",
      label: "Awaiting dispatch",
      value: awaitingDispatch,
      href: SERVICE_OPS_LINKS.dispatcherBoard,
      // SO-N9 -- the governed fact, named exactly what the projection calls it.
      exception:
        readyCount > 0
          ? { count: readyCount, text: "ready to schedule", tone: "attention", href: `#${SECTION_ID.attention}` }
          : null,
    },
    {
      key: "inProgress",
      label: "In progress",
      value: inProgress,
      href: SERVICE_OPS_LINKS.workOrders,
      exception:
        atRiskCount > 0
          ? { count: atRiskCount, text: "at risk", tone: "warn", href: `#${SECTION_ID.atRisk}` }
          : null,
    },
    {
      key: "onShift",
      label: "Technicians on shift",
      value: onShift,
      href: SERVICE_OPS_LINKS.dispatcherBoard,
      exception:
        overloadedCount > 0
          ? { count: overloadedCount, text: "overloaded", tone: "warn", href: `#${SECTION_ID.technicianLoad}` }
          : null,
    },
    {
      // SO-D4 -- "Completed this week" would claim a windowed read this page does not have. The count
      // is every finished work order in the loaded snapshot, so the label says only what it is.
      key: "completed",
      label: "Completed",
      value: completed,
      href: SERVICE_OPS_LINKS.workOrders,
      exception: null,
    },
  ];
}

// ── At risk (pattern 5) ───────────────────────────────────────────────────────────────────────────

export const AT_RISK_SORT = Object.freeze({ SEVERITY: "severity", AGE: "age" });

// Severity as a WORD. The panel this replaces printed `signal.severity` straight into the badge, so
// the page rendered the raw enum "CRITICAL" at the reader — the grammar's "status in words, never
// enums" applies to severity too. This is a display mapping over an existing value, not a second
// severity scale: the tiers, thresholds and ordering all stay in domain/controlTower/types.js.
const SEVERITY_WORD = Object.freeze({
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
});
export const severityWord = (severity) => SEVERITY_WORD[severity] ?? "Unrated";

// Rows for the At risk table. detectStalledJobs owns severity, score and factors; this only joins the
// account/technician for display and applies the requested sort.
//
// R23 (lossless composition): a work order missing `createdAt` still gets a row. Its age reads "age
// unknown" and it sorts LAST rather than being dropped or shown as 0h — an exception record never
// disappears because a field is absent.
export function atRiskRows({
  workOrders = [],
  technicians = [],
  accountNames,
  sort = AT_RISK_SORT.SEVERITY,
} = {}) {
  const signals = detectStalledJobs(workOrders, technicians);
  const byId = workOrderById(workOrders);

  const rows = signals.map((signal) => {
    const wo = byId.get(signal.id) ?? byId.get(signal.metadata?.workOrderId);
    const techId = wo?.assignedTechId ?? null;
    const ageHours = typeof signal.metadata?.ageHours === "number" ? signal.metadata.ageHours : null;
    return {
      id: signal.id,
      workOrderId: wo?.id ?? signal.id,
      reference: signal.label,
      account: accountLabel(wo, accountNames),
      severity: signal.severity,
      severityWord: severityWord(signal.severity),
      ageHours,
      ageText: ageHours === null ? "age unknown" : `~${Math.round(ageHours)}h`,
      why: (signal.metadata?.factors ?? []).map((f) => f.explanation).join(" · "),
      technicianName: techId ? resolveTechnicianIdentity(techId, { technicians }).name : null,
      href: workOrderHref(wo?.id ?? signal.id),
    };
  });

  if (sort === AT_RISK_SORT.AGE) {
    // -Infinity for null keeps unknown ages last under a descending sort, and never produces NaN.
    const age = (r) => (r.ageHours === null ? -Infinity : r.ageHours);
    return [...rows].sort((a, b) => age(b) - age(a));
  }
  return rows; // detectStalledJobs already returns severity -> score order
}

// ── Technician load (pattern 5) ───────────────────────────────────────────────────────────────────

// One row per technician: status in words, active work orders, and whether the overload domain says
// they are overloaded. Replaces both the old "Technician Load" text divs and the separate Overloaded
// panel — one table, one reading of technician state.
//
// Unassigned work is deliberately NOT a technician row here: it is already Ready to Schedule in the
// attention block (SO-N2), and giving it a row would state the same backlog twice.
export function technicianLoadRows({ workOrders = [], technicians = [] } = {}) {
  const groups = groupJobsByTechnician(workOrders);
  const overloadedIds = new Set(
    detectOverloadedTechnicians(technicians, workOrders).map(({ technician }) => technician.id),
  );

  return technicians
    .map((technician) => ({
      id: technician.id,
      name: resolveTechnicianIdentity(technician.id, { technicians }).name,
      statusLabel: technicianStatusLabel(technician.status),
      activeCount: (groups[technician.id] ?? []).length,
      overloaded: overloadedIds.has(technician.id),
    }))
    .sort((a, b) => b.activeCount - a.activeCount || a.name.localeCompare(b.name));
}

// ── Dispatch suggestions (the page's one suggestion slot) ─────────────────────────────────────────

// Read-only (SO-G4). computeDispatchRecommendations ranks; assignment is the governed command on the
// Dispatch Board and is not reachable from this page at all.
export function dispatchSuggestions({ workOrders = [], technicians = [] } = {}) {
  const signals = computeDispatchRecommendations(workOrders, technicians);

  const rows = signals.map((signal) => {
    const recommended = signal.metadata?.recommended ?? null;
    return {
      id: signal.id,
      reference: signal.metadata?.job?.woNumber || signal.id,
      technicianName: recommended
        ? resolveTechnicianIdentity(recommended.technicianId, { technicians }).name
        : null,
      score: recommended ? Math.round(signal.score) : null,
      reasons: recommended?.reasons ?? [],
      href: SERVICE_OPS_LINKS.dispatcherBoard,
    };
  });

  return {
    rows,
    openCount: rows.length,
    placeableCount: rows.filter((r) => r.technicianName !== null).length,
  };
}

// ── Activity rail ────────────────────────────────────────────────────────────────────────────────

export const ACTIVITY_FILTER = Object.freeze({
  ALL: "ALL",
  WORK_ORDER: "WORK_ORDER",
  JOB: "JOB",
  SYSTEM: "SYSTEM",
});

// Entries for the rail. Description only — no clock time (SO-N3) and no actor (SO-N5), because
// neither is a fact this event model holds. The provenance line the composition renders under these
// entries is not decoration: it is what makes a snapshot-derived list honest about being one.
export function activityEntries({ workOrders = [], filter = ACTIVITY_FILTER.ALL } = {}) {
  const timeline = buildTimeline(workOrders);
  const filtered =
    filter === ACTIVITY_FILTER.ALL
      ? timeline
      : timeline.filter((event) => event.entity.type === filter);

  return filtered.map((event, index) => ({
    key: `${event.entity.type}-${event.entity.id}-${event.type}-${index}`,
    description: describeEvent(event),
    entityType: event.entity.type,
    severity: event.severity,
  }));
}
