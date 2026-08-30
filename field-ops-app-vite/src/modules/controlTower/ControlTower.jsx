import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { TECHNICIANS_COLLECTION } from "../../domain/constants";
import { FIELD_PHASE, fieldPhase } from "../../domain/fieldWorkOrder";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { useWorkOrders } from "../../hooks/useWorkOrders";
import { useAccountNames } from "../../hooks/useAccountNames";
import { loadErrorMessage } from "../../domain/loadErrorMessage";
import LoadingState from "../../shared/ui/LoadingState";
import FailureState from "../../shared/ui/FailureState";
import {
  ACTIVITY_FILTER,
  AT_RISK_SORT,
  SERVICE_OPS_LINKS,
  activityEntries,
  atRiskRows,
  dispatchSuggestions,
  serviceOperationsAttention,
  serviceOperationsMetrics,
  technicianLoadRows,
} from "../../domain/serviceOperationsNorthStar";
import MetricStrip from "./panels/MetricStrip";
import WorkOrderAttentionPanel from "./panels/WorkOrderAttentionPanel";
import AtRiskPanel from "./panels/AtRiskPanel";
import TechnicianLoadPanel from "./panels/TechnicianLoadPanel";
import DispatchQueuePanel from "./panels/DispatchQueuePanel";
import ActivityTimelinePanel from "./panels/ActivityTimelinePanel";

// Service Operations — the North Star P1 composition (Overview archetype).
//
// WHAT THIS PAGE IS. The cross-cutting exceptions read across service: what needs a decision before
// somebody opens the board or the record. It is not a work-order list and not a second dispatch
// board — the migrated Work Order family owns the record, the Dispatcher Board owns placement, and
// this page owns the question of where to look first.
//
// WHAT IT REPLACED. An append-order accumulation: an <h2>, five unlinked stat tiles, a bare ⚠ div,
// then EVERY work order rendered as a full detail card with its own dispatcher action cluster, then
// technician load as unstyled text, then six equal-weight panels. The intelligence sat below the wall
// of cards, so the page's most decision-dense content was the hardest to reach. Ordering law now:
// kicker → header → attention → metrics → work → rail.
//
// ── The architectural invariant, stated as it actually is ───────────────────────────────────────
//
// The previous wording claimed "every panel receives exactly { jobs, technicians, workOrders } -- no
// panel may accept or require any other prop shape". That had stopped being true: WorkOrderAttentionPanel
// already took a fourth prop, and assertPanelProps only ever validated that three named arrays were
// arrays. Restating it to match the code rather than deleting it, because the real invariant is the
// load-bearing one and it is now stronger, not weaker:
//
//   1. THIS FILE OWNS THE READS. useWorkOrders / useFirestoreCollection / useAccountNames are called
//      here and nowhere else in this module. No section establishes its own Firestore authority.
//   2. DERIVATION LIVES OUTSIDE JSX. Every row, count and label below is produced by
//      domain/serviceOperationsNorthStar.js, which composes the governed domain modules
//      (workOrderAttentionProjection, jobRiskScoring, dispatchScoring, timelineBuilder). No section
//      scores, ranks, classifies or counts.
//   3. SECTIONS ARE PURE PRESENTERS. They receive finished rows plus local UI state (a sort key, a
//      filter, a collapse flag) and render. Their props are the rows they draw, which is why the old
//      fixed three-array shape no longer describes them.
//   4. THE GOVERNED PROJECTION SHAPES ARE PRESERVED. Attention items keep their governed
//      sectionLabel/attentionType/deepLink; risk signals keep their canonical Signal shape.
//
// test/serviceOperationsComposition.test.jsx asserts 1 and 2 against the source, so the wording cannot
// drift from the code again the way the sentence above did.
//
// ── Owner rulings (2026-08-30). Full text in docs/design/service-operations-north-star-composition-map.md
//
//   SO-N1 attention carries no risk severity      SO-N6 no technician-preselected board link
//   SO-N2 no Urgent section, no second derivation SO-N7 on-shift excludes OFF_SHIFT
//   SO-N3 no fabricated activity timestamps       SO-N8 governed /service/work-orders/:id route
//   SO-N4 no fabricated attention owner           SO-N9 no undefined "past readiness"
//   SO-N5 no fabricated activity actor            SO-G5 parts readiness stays unread, stated honestly
//
// NOTHING ON THIS PAGE WRITES. The per-card dispatcher transitions the old version carried
// (WorkOrderActions inside every WorkOrderDetail) are gone: a governed transition belongs on the
// record or the board, where it can show its preconditions, not scattered down a list.

export default function ControlTower() {
  // ── The only reads on this page ────────────────────────────────────────────────────────────────
  const { data: workOrders, loading, error } = useWorkOrders();
  const { data: technicians, error: techniciansError } = useFirestoreCollection(TECHNICIANS_COLLECTION);
  const accountNames = useAccountNames(
    useMemo(
      () => Array.from(new Set(workOrders.map((wo) => wo.customerId).filter(Boolean))),
      [workOrders],
    ),
  );

  // ── Local UI state. Not business state: a sort key, a filter and a collapse flag. ──────────────
  const [atRiskSort, setAtRiskSort] = useState(AT_RISK_SORT.SEVERITY);
  const [activityFilter, setActivityFilter] = useState(ACTIVITY_FILTER.ALL);
  const [trayCollapsed, setTrayCollapsed] = useState(false);

  const techniciansAvailable = !techniciansError;

  // ── Derivation, all of it, in one place ────────────────────────────────────────────────────────
  const attention = useMemo(
    // SO-G5: partsReadinessByWorkOrderId is deliberately NOT passed. This page does not read parts
    // readiness, and the projection reports that boundary back so the composition can state it
    // rather than render a Parts section that merely looks clean.
    () => serviceOperationsAttention({ workOrders, technicians, accountNames }),
    [workOrders, technicians, accountNames],
  );
  const metrics = useMemo(
    () => serviceOperationsMetrics({ workOrders, technicians, attention, techniciansAvailable }),
    [workOrders, technicians, attention, techniciansAvailable],
  );
  const riskRows = useMemo(
    () => atRiskRows({ workOrders, technicians, accountNames, sort: atRiskSort }),
    [workOrders, technicians, accountNames, atRiskSort],
  );
  const loadRows = useMemo(
    () => (techniciansAvailable ? technicianLoadRows({ workOrders, technicians }) : []),
    [workOrders, technicians, techniciansAvailable],
  );
  const suggestions = useMemo(
    () => dispatchSuggestions({ workOrders, technicians }),
    [workOrders, technicians],
  );
  const activity = useMemo(
    () => activityEntries({ workOrders, filter: activityFilter }),
    [workOrders, activityFilter],
  );
  const openWorkOrderCount = useMemo(
    () => workOrders.filter((wo) => fieldPhase(wo) !== FIELD_PHASE.FINISHED).length,
    [workOrders],
  );

  // ── Honest states (1c). A number is reported only when it is known. ────────────────────────────
  if (loading) {
    return (
      <div className="ns-page">
        <h1 className="ns-identity__title">Service Operations</h1>
        {/* LoadingState takes CHILDREN, not a `label` prop. The page this replaces passed
            label="Loading operations", which the primitive ignored -- so it silently rendered the
            generic "Loading…" default and the specific wording never reached anyone. */}
        <LoadingState>Loading service operations…</LoadingState>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ns-page">
        <h1 className="ns-identity__title">Service Operations</h1>
        <FailureState
          title="Service operations could not be loaded"
          message={`${loadErrorMessage(error, { entity: "work orders" })} Your work elsewhere is unaffected.`}
        />
      </div>
    );
  }

  return (
    <div className="ns-page">
      <div className="ns-page__utility">
        <p className="ns-page__context">Service → Service Operations</p>
        {/* The live claim is one this page can actually make: both operational reads
            (subscribeToWorkOrders, useFirestoreCollection) are onSnapshot subscriptions, so the
            numbers really do move without a reload. */}
        <p className="ns-live">
          <span className="ns-live__dot" aria-hidden="true" />
          Live — updates as work orders change
        </p>
      </div>
      <div className="ns-rulepair" />

      <header className="ns-identity">
        <div className="ns-identity__main">
          <h1 className="ns-identity__title">Service Operations</h1>
          <p className="ns-identity__facts">
            The exceptions read across service — what needs a decision before the board or the record.
          </p>
        </div>
        {/* Action architecture: the cluster sits at the right end of the header and nowhere else.
            One filled primary. Both are navigation — this page holds no governed transition. */}
        <div className="ns-identity__actions">
          {/* Links, not buttons: these navigate, and a <button> that navigates is the wrong element
              for anyone using a keyboard or a screen reader. They borrow the design system's own
              fo-button classes rather than introducing a second button family. */}
          <Link className="fo-button fo-button--secondary" to={SERVICE_OPS_LINKS.workOrders}>
            Work orders
          </Link>
          <Link className="fo-button fo-button--primary" to={SERVICE_OPS_LINKS.dispatcherBoard}>
            Open Dispatch Board
          </Link>
        </div>
      </header>

      {/* The technician read can fail INDEPENDENTLY of the work-order read. When it does the work
          orders are still worth showing, but anything technician-shaped would quietly degrade, so
          the degradation is announced rather than left to look like the data. Kept verbatim from the
          page this replaces — it was the one thing on it doing honest state correctly. */}
      {techniciansError && (
        <p className="ns-state ns-state--denied" role="alert">
          Technician names could not be loaded, so technician load and assignments are unavailable
          below. {loadErrorMessage(techniciansError, { entity: "technicians" })} Your work elsewhere is
          unaffected.
        </p>
      )}

      <div className="ns-record-body">
        <div className="ns-work">
          <WorkOrderAttentionPanel attention={attention} />

          <MetricStrip metrics={metrics} />

          <AtRiskPanel
            rows={riskRows}
            sort={atRiskSort}
            onSortChange={setAtRiskSort}
            openWorkOrderCount={openWorkOrderCount}
          />

          <TechnicianLoadPanel
            rows={loadRows}
            available={techniciansAvailable}
            unavailableReason={
              techniciansError ? loadErrorMessage(techniciansError, { entity: "technicians" }) : null
            }
          />

          <DispatchQueuePanel
            suggestions={suggestions}
            collapsed={trayCollapsed}
            onToggleCollapsed={setTrayCollapsed}
          />
        </div>

        <ActivityTimelinePanel
          entries={activity}
          filter={activityFilter}
          onFilterChange={setActivityFilter}
        />
      </div>
    </div>
  );
}
