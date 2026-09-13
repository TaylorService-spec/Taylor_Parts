// NORTH STAR — Work Order detail page (family 1).
// Drop in as: field-ops-app-vite/src/modules/workOrders/NorthStarWorkOrderDetailPage.jsx
// Swap the route element in App.jsx from <WorkOrderDetailPage /> to
// <NorthStarWorkOrderDetailPage /> (keep the old file untouched for rollback).
//
// VISUAL SOURCE OF TRUTH: the bundled `North Star - Work Order.dc.html` (the
// approved concept). This component reproduces its composition, hierarchy,
// geometry, and action architecture. Where the concept shows capabilities that
// do not exist (suggestion engine, live truck-stock reads, ETAs, prediction,
// presence, dispatcher-context reads), the structural slot is preserved and an
// honest state is rendered — never fabricated data.
//
// PRESENTATION ONLY. Every read/write below is the existing sanctioned path:
// useWorkOrder (onSnapshot), useAccount/useLocation/useEquipmentDoc resolvers,
// WorkOrderActions (transitionWorkOrder + getAllowedActions), and
// WorkOrderPartsPlanEditor (governed setWorkOrderPartsPlan + capability gate).
// No new Firestore reads, no new writes, no authority changes.

import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useWorkOrder } from "../../hooks/useWorkOrder";
import { useAccount } from "../../hooks/useAccount";
import { useLocation as useLocationDoc } from "../../hooks/useLocation";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { TECHNICIANS_COLLECTION } from "../../domain/constants";
import { useEquipmentDoc } from "../../hooks/useEquipment";
import { useWorkOrderPartsPlanCapability } from "../../access/useWorkOrderPartsPlanCapability.js";
import { objectListPathWithState, OBJECT_LIST_KEY } from "../../navigation/objectRoutes.js";
import { savedListState } from "../../navigation/listStateMemory.js";
import { resolveTechnicianIdentity } from "../../domain/actorDisplayName";
import { equipmentDisplayName, equipmentSummary } from "../../domain/equipment";
import { workOrderPriorityText } from "../../domain/workOrderPriority";
import { formatAddress } from "../../domain/address";
import LoadingState from "../../shared/ui/LoadingState";
import FailureState from "../../shared/ui/FailureState";
import { Button } from "../../shared/ui/primitives";
import WorkOrderActions from "../controlTower/WorkOrderActions";
import WorkOrderPartsPlanEditor from "./WorkOrderPartsPlanEditor";

// Status → sentence, in words. Presentation only (the engine owns legality).
const STATUS_SENTENCE = {
  CREATED: "Created — not yet ready to dispatch",
  READY_TO_DISPATCH: "Ready to schedule",
  SCHEDULED: "Scheduled — awaiting dispatch",
  DISPATCHED: "Dispatched — awaiting technician acceptance",
  ACCEPTED: "Accepted — technician preparing",
  EN_ROUTE: "Technician en route",
  ARRIVED: "Technician on site",
  WORK_IN_PROGRESS: "Work in progress",
  COMPLETED: "Completed — awaiting closeout",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

// Six presentation stages over the engine's statuses. Mapping only — never a
// second state machine.
const STAGES = [
  { key: "created", label: "Created", statuses: ["CREATED", "READY_TO_DISPATCH"] },
  { key: "scheduled", label: "Scheduled", statuses: ["SCHEDULED"] },
  { key: "dispatched", label: "Dispatched", statuses: ["DISPATCHED", "ACCEPTED", "EN_ROUTE"] },
  { key: "onsite", label: "On site", statuses: ["ARRIVED", "WORK_IN_PROGRESS"] },
  { key: "complete", label: "Complete", statuses: ["COMPLETED"] },
  { key: "closed", label: "Closed", statuses: ["CLOSED"] },
];

const fmt = (ts) => (ts && typeof ts.toDate === "function" ? ts.toDate().toLocaleString() : null);

function stageIndexFor(status) {
  const i = STAGES.findIndex((s) => s.statuses.includes(status));
  return i === -1 ? 0 : i;
}

// Facts shown in the stage-detail strip — real recorded timestamps only.
function stageFacts(stageKey, wo) {
  switch (stageKey) {
    case "created": return fmt(wo.createdAt) ? `Created ${fmt(wo.createdAt)}` : "Creation time not recorded";
    case "scheduled": return fmt(wo.scheduledStart) ? `Window starts ${fmt(wo.scheduledStart)}` : "No window recorded";
    case "dispatched": return fmt(wo.dispatchedAt) ? `Dispatched ${fmt(wo.dispatchedAt)}${fmt(wo.acceptedAt) ? ` · accepted ${fmt(wo.acceptedAt)}` : " · awaiting acceptance"}` : "Not yet dispatched";
    case "onsite": return fmt(wo.arrivedAt) ? `Arrived ${fmt(wo.arrivedAt)}${fmt(wo.workStartedAt) ? ` · work started ${fmt(wo.workStartedAt)}` : ""}` : "Starts when the technician arrives — no live ETA feed exists yet";
    case "complete": return fmt(wo.completedAt) ? `Completed ${fmt(wo.completedAt)}` : "Completion records part usage and labor";
    case "closed": return fmt(wo.closedAt) ? `Closed ${fmt(wo.closedAt)}` : "Dispatcher closeout follows completion";
    default: return "";
  }
}

export default function NorthStarWorkOrderDetailPage() {
  const { workOrderId } = useParams();
  const navigate = useNavigate();
  const { role, user } = useAuth();
  const partsPlanCapability = useWorkOrderPartsPlanCapability(user);
  const { workOrder, loading, error, retry } = useWorkOrder(workOrderId);
  const { data: equipment } = useEquipmentDoc(workOrder?.equipmentId ?? null);
  const { account, error: accountError } = useAccount(workOrder?.customerId ?? null);
  const { location, error: locationError } = useLocationDoc(workOrder?.locationId ?? null);
  const { data: technicians, error: techniciansError } = useFirestoreCollection(TECHNICIANS_COLLECTION);
  const [openStage, setOpenStage] = useState(null); // null = follow current

  const backToWorkOrders = () =>
    navigate(objectListPathWithState(OBJECT_LIST_KEY.WORK_ORDERS, savedListState(OBJECT_LIST_KEY.WORK_ORDERS)));

  // NS utility line: context left, live indicator right. "Live" is truthful —
  // useWorkOrder subscribes via onSnapshot. The concept's ⌘K hint has no
  // command palette behind it, so it is not rendered.
  const frame = (children) => (
    <div className="ns-page">
      <div className="ns-utility">
        <span className="ns-utility-context">
          Service →{" "}
          <a href="#back" onClick={(e) => { e.preventDefault(); backToWorkOrders(); }}>Work Orders</a>
          {workOrder?.woNumber ? ` → ${workOrder.woNumber}` : ""}
        </span>
        <span className="ns-live"><span className="ns-live-dot" /> Live — this record updates in real time</span>
      </div>
      <div className="ns-rulepair" />
      {children}
    </div>
  );

  if (loading) return frame(<LoadingState>Loading work order…</LoadingState>);
  if (error) return frame(
    <FailureState message={error} action={<Button variant="secondary" onClick={retry}>Retry</Button>} />
  );
  if (!workOrder) return frame(
    <FailureState message="This work order could not be found."
      action={<Button variant="secondary" onClick={backToWorkOrders}>Back to Work Orders</Button>} />
  );

  const cancelled = workOrder.status === "CANCELLED";
  const currentIdx = stageIndexFor(workOrder.status);
  const shownStage = openStage ?? STAGES[currentIdx].key;
  const tech = resolveTechnicianIdentity(workOrder.assignedTechId, { technicians });
  const priority = workOrderPriorityText(workOrder.priority);
  const window = fmt(workOrder.scheduledStart);
  const equipLabel = equipment ? equipmentDisplayName(equipment) : null;
  const equipMeta = equipment ? equipmentSummary(equipment) : null;

  return frame(
    <>
      <header className="ns-record-header">
        <div style={{ minWidth: 0 }}>
          <p className="ns-kicker">
            Work Order · {workOrder.type || "Service"}{priority ? ` · ${priority}` : ""}
          </p>
          <h1 className="ns-title">{workOrder.woNumber ?? "Work Order — reference unavailable"}</h1>
          <div className="ns-facts">
            <span className="ns-fact-status">
              {STATUS_SENTENCE[workOrder.status] ?? workOrder.status}
              {tech.state === "resolved" && fmt(workOrder.acceptedAt) ? ` — ${tech.name} accepted` : ""}
            </span>
            <span>
              <strong>{account?.name ?? "Customer unavailable"}</strong>
              {" · "}
              {location?.name ?? "Location unavailable"}
            </span>
            {tech.state === "resolved" && <span>Tech <strong>{tech.name}</strong></span>}
            {window && <span>Window <strong>{window}</strong></span>}
            {/* NS slot: first-visit-fix likelihood. GAP — no prediction engine. */}
            <span className="ns-gap-note" title="Requires the prediction engine — a post-pilot governance item">
              First-visit fix — not computed
            </span>
          </div>
        </div>
        {/* The existing action source, re-skinned by .ns-action-cluster CSS only:
            first allowed transition renders filled, others outlined, Cancel as
            red text. Gates, dialogs, tech picker, schedule form untouched.
            showStatus={false} — the fact row already states the status once. */}
        <div className="ns-action-cluster">
          {/* BEHAVIORAL BACKLOG (see README § Behavioral backlog): the concept's
              Reschedule and Message-technician actions. Rendered disabled so the
              action architecture matches the North Star today; enable them ONLY
              by extending the engine / adding the notification channel (B1/B2),
              never by bypassing transitionWorkOrder or getAllowedActions. */}
          <button type="button" className="fo-button ns-btn-pending" disabled
            title="Backlog B1 — needs a Reschedule transition (DISPATCHED → SCHEDULED) added to the transition engine; not legal today">
            Reschedule
          </button>
          <button type="button" className="fo-button ns-btn-pending ns-btn-pending--primary" disabled
            title="Backlog B2 — needs a technician notification channel; none exists today">
            Message technician
          </button>
          <WorkOrderActions workOrder={workOrder} role={role} technicians={technicians} showStatus={false} />
        </div>
      </header>

      {accountError && <FailureState message={accountError} />}
      {locationError && <FailureState message={locationError} />}
      {techniciansError && (
        <FailureState message="You don't have access to the technician list. Some assignment info may be missing." />
      )}

      <div className="ns-lifecycle" role="tablist" aria-label="Lifecycle">
        <span className="ns-lifecycle-label">Lifecycle</span>
        {STAGES.map((s, i) => {
          const state = cancelled
            ? (i <= currentIdx ? "done" : "future")
            : i < currentIdx ? "done" : i === currentIdx ? "current" : "future";
          const cls = [
            "ns-chip",
            `ns-chip--${state}`,
            i === 0 ? "ns-chip--first" : "",
            i === STAGES.length - 1 && !cancelled ? "ns-chip--last" : "",
          ].join(" ").trim();
          return (
            <button key={s.key} type="button" className={cls} aria-expanded={shownStage === s.key}
              onClick={() => setOpenStage(shownStage === s.key ? STAGES[currentIdx].key : s.key)}>
              {state === "done" ? "✓ " : ""}{s.label}
              {state === "current" && !cancelled && <span className="ns-pulse" />}
            </button>
          );
        })}
        {cancelled && <span className="ns-chip ns-chip--terminal ns-chip--last">Cancelled</span>}
        {/* GAP #1 — SO lineage: render "from SO-…" here once a naming read exists. */}
        {!workOrder.salesOrderId && (
          <span className="ns-lifecycle-tail">Lineage isn’t linked on this record yet.</span>
        )}
      </div>
      <div className="ns-stage-detail">
        <div className={`ns-stage-detail-row ${stageIndexFor(workOrder.status) > STAGES.findIndex((s) => s.key === shownStage) ? "ns-stage-detail-row--done" : shownStage !== STAGES[currentIdx].key ? "ns-stage-detail-row--future" : ""}`}>
          {shownStage === STAGES[currentIdx].key && <strong>You are here.</strong>}
          <span>{stageFacts(shownStage, workOrder)}</span>
        </div>
      </div>

      {/* NS structural slot: the suggestion strip. GAP #5 — no suggestion engine
          is connected; the slot renders its honest empty state, never advice. */}
      <div className="ns-suggest">
        <span className="ns-suggest-label">Suggested</span>
        <span>No suggestion engine is connected yet — nothing is proposed for this job.</span>
      </div>

      <div className="ns-body-grid">
        <div>
          <section className="ns-section" aria-label="The job">
            <h2 className="ns-h2">The job</h2>
            <div className="ns-prose">
              {workOrder.complaint && <p><strong>Complaint.</strong> {workOrder.complaint}</p>}
              {workOrder.diagnosis && <p><strong>Working diagnosis.</strong> {workOrder.diagnosis}</p>}
              {workOrder.resolution && <p><strong>Resolution.</strong> {workOrder.resolution}</p>}
              {!workOrder.complaint && !workOrder.diagnosis && !workOrder.resolution && (
                <p className="ns-gap-note">No complaint recorded.</p>
              )}
            </div>
          </section>

          <section className="ns-section" aria-label="Parts">
            {/* GAP #2 — readiness by source (truck/warehouse) has no read yet;
                the honest disclosure lives in the heading annotation, where the
                concept carries its "verified against truck stock" note. */}
            <h2 className="ns-h2">
              Parts <span className="ns-h2-note">· readiness by source (truck / warehouse) isn’t recorded yet — quantities are planned demand</span>
            </h2>
            <div className="ns-embed">
              <WorkOrderPartsPlanEditor workOrder={workOrder} capability={partsPlanCapability} />
            </div>
          </section>

          <section className="ns-section" aria-label="Timeline">
            <h2 className="ns-h2">
              Timeline <span className="ns-h2-note">· reconstructed from Work Order milestones — approximate, not a recorded audit trail</span>
            </h2>
            <div className="ns-timeline">
              {[
                ["Closed", workOrder.closedAt],
                ["Completed", workOrder.completedAt],
                ["Work started", workOrder.workStartedAt],
                ["Arrived", workOrder.arrivedAt],
                ["En route", workOrder.enRouteAt],
                ["Accepted", workOrder.acceptedAt],
                ["Dispatched", workOrder.dispatchedAt],
                ["Scheduled", workOrder.scheduledStart],
                ["Created", workOrder.createdAt],
              ].filter(([, v]) => v != null).map(([label, v]) => (
                <div className="ns-timeline-row" key={label}>
                  <span className="ns-timeline-when">{fmt(v)}</span>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside>
          {equipLabel && (
            <section className="ns-rail-section" aria-label="Equipment">
              <h3 className="ns-rail-h">Equipment</h3>
              <strong>{equipLabel}</strong>
              {equipMeta && <><br /><span className="ns-rail-meta">{equipMeta}</span></>}
              {/* GAP #6 — the concept's repair-history insight box. */}
              <p className="ns-gap-note">Repair-history insight (repeat repairs, spend vs replacement) needs an equipment-history read this page doesn’t perform yet.</p>
            </section>
          )}
          <section className="ns-rail-section" aria-label="Site">
            <h3 className="ns-rail-h">Site</h3>
            <strong>{location?.name ?? "Location unavailable"}</strong>
            {location && formatAddress(location.address ?? location) && (
              <><br /><span className="ns-rail-meta">{formatAddress(location.address ?? location)}</span></>
            )}
            {/* GAP #3 — contact + access notes: no fields exist; nothing rendered. */}
          </section>
          {/* GAP #7 — the concept's dispatcher-context section (tech day load,
              slip window, sibling WOs). The slot is kept; the reads are not. */}
          <section className="ns-rail-section" aria-label="Dispatcher context">
            <h3 className="ns-rail-h">Dispatcher context</h3>
            <p className="ns-gap-note">Technician day load, slip windows, and sibling work orders require scheduling reads this route doesn’t perform yet.</p>
          </section>
          <section className="ns-rail-section" aria-label="Record detail">
            <details>
              <summary className="ns-rail-h" style={{ cursor: "pointer" }}>Record detail</summary>
              <dl>
                <dt>Type</dt><dd>{workOrder.type ?? "—"}</dd>
                <dt>Priority</dt><dd>{priority ?? "Not set"}{workOrder.severity ? ` · severity ${String(workOrder.severity).toLowerCase()}` : ""}</dd>
                <dt>Status</dt><dd>{STATUS_SENTENCE[workOrder.status] ?? workOrder.status}</dd>
              </dl>
            </details>
          </section>
        </aside>
      </div>
    </>
  );
}
