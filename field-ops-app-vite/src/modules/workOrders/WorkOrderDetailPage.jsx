import { useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useWorkOrder } from "../../hooks/useWorkOrder";
import { useAccount } from "../../hooks/useAccount";
import { useLocation as useLocationDoc } from "../../hooks/useLocation";
import { useEquipmentDoc } from "../../hooks/useEquipment";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { TECHNICIANS_COLLECTION } from "../../domain/constants";
import { Button } from "../../shared/ui/primitives";
import RecordIdentity from "../../shared/ui/RecordIdentity.jsx";
import AttentionBand from "../../shared/ui/AttentionBand.jsx";
import RuledSection from "../../shared/ui/RuledSection.jsx";
import HonestState, { HONEST_STATE } from "../../shared/ui/HonestState.jsx";
import LifecycleBand from "../../shared/ui/LifecycleBand.jsx";
import WorkOrderActions from "../controlTower/WorkOrderActions";
import WorkOrderPartsPlanEditor from "./WorkOrderPartsPlanEditor";
import { useWorkOrderPartsPlanCapability } from "../../access/useWorkOrderPartsPlanCapability.js";
import { objectListPathWithState, OBJECT_LIST_KEY } from "../../navigation/objectRoutes.js";
import { savedListState } from "../../navigation/listStateMemory.js";
import { resolveTechnicianIdentity } from "../../domain/actorDisplayName";
import { equipmentDisplayName, equipmentSummary } from "../../domain/equipment";
import { workOrderPriorityText } from "../../domain/workOrderPriority";
import { workOrderTypeLabel } from "../../domain/workOrderType.js";
import { formatClockTime, formatMoment } from "../../domain/displayTimestamp";
import MetadataRecordPage from "../../metadata/MetadataRecordPage.jsx";
import { workOrderRecordPageRailSubset } from "../../metadata/definitions/workOrderPage.js";
import { workOrderEntity } from "../../metadata/definitions/workOrder.js";
import { REFERENCE_STATE } from "../../metadata/referenceResolution.js";
import {
  workOrderHeader,
  workOrderSpine,
  workOrderAttention,
  workOrderPartsPlan,
  workOrderStageDetail,
  workOrderTimeline,
  workOrderLineage,
  EDGE,
} from "../../domain/workOrderNorthStar.js";

// THE WORK ORDER, COMPOSED IN THE NORTH STAR GRAMMAR.
//
// Source of truth for the composition: the approved `Proposed - Work Order.dc.html`.
// Translation contract: docs/design/eos-north-star-design-grammar.md.
// Domain authority: unchanged — every action still resolves through transitionWorkOrder, and this
// file adds no command, no capability and no write path of its own.
//
// ════════════════════ WHAT ACTUALLY CHANGED, AND WHY IT IS NOT A RESTYLE ════════════════════
//
// The pilot audit of this page found "three UI generations stacked on one page: a metadata field
// grid, a legacy text-run card, and a parts-plan card, each with its own typography and table style.
// Status appears four times in four treatments." The old composition was: back-link, a metadata
// record grid, a presentation panel, a parts editor — each a card, in shipping order.
//
// The grammar replaces the ORDER, not the paint (NS-P2):
//
//   kicker → header → lifecycle → attention → work → rail
//
// The record grid no longer leads. THE JOB leads, because the pilot's hierarchy verdict was
// explicit: "The record grid leads; the job is buried. What should lead: state + the next
// transition." Type, priority and creator move to the rail as reference material.
//
// ════════════════════ WHAT IS DELIBERATELY NOT HERE ════════════════════
//
// No ETA, no arrival confidence, no first-visit-fix percentage, no "3 repairs in 12 months", no
// suggestion band. Those belong to `North Star - Work Order.dc.html`, whose own header states that
// none of the services behind them exist. A number that looks computed and is not is the single most
// damaging thing an operations system can render, so the composition leaves the space and the
// numbers stay unwritten until something can compute them.
//
// ════════════════════ ROUTE GATE (unchanged) ════════════════════
//
// App.jsx gates this route to admin/dispatcher. That is why useAccount()/useLocation() may be called
// unconditionally: a technician never mounts this component — their surface is
// TechnicianWorkOrderDetail. Persona composition, authority untouched (NS-P5).
export default function WorkOrderDetailPage() {
  const { workOrderId } = useParams();
  const navigate = useNavigate();
  const { role, user } = useAuth();

  const backToWorkOrders = () => navigate(
    objectListPathWithState(OBJECT_LIST_KEY.WORK_ORDERS, savedListState(OBJECT_LIST_KEY.WORK_ORDERS)),
  );

  const partsPlanCapability = useWorkOrderPartsPlanCapability(user);
  const { workOrder, loading, error, retry } = useWorkOrder(workOrderId);
  // useEquipmentDoc returns { equipment, loading, error } — NOT { data }. Destructuring `data`
  // here left `equipment` permanently undefined, so the rail-s Equipment section rendered
  // "reference unavailable" on every work order that has a unit, and the Record shell reported the
  // unit as no longer existing. Wiring drift, fixed in the wiring.
  const { equipment } = useEquipmentDoc(workOrder?.equipmentId ?? null);
  const { account, error: accountError } = useAccount(workOrder?.customerId ?? null);
  const { location, error: locationError } = useLocationDoc(workOrder?.locationId ?? null);
  const { data: technicians, error: techniciansError } = useFirestoreCollection(TECHNICIANS_COLLECTION);

  // ONE DERIVATION PER FACT (NS-P4). Everything below renders what these return; nothing re-derives.
  const header = useMemo(() => workOrderHeader(workOrder), [workOrder]);
  const spine = useMemo(() => workOrderSpine(workOrder?.status), [workOrder?.status]);
  const plan = useMemo(() => workOrderPartsPlan(workOrder), [workOrder]);
  const attention = useMemo(
    () => workOrderAttention(workOrder, { nowMillis: Date.now(), partsPlan: plan }),
    [workOrder, plan],
  );
  // The Sales Order reference is not resolvable from this page today — there is no per-id governed
  // read reachable here for it. The edge therefore renders as UNRESOLVED, naming the entity and
  // stating the absence, and never as the document id.
  const lineage = useMemo(() => workOrderLineage(workOrder, { salesOrderReference: null }), [workOrder]);

  if (loading) {
    return <div className="ns-page"><HonestState state={HONEST_STATE.LOADING} subject="work order" /></div>;
  }

  if (error) {
    return (
      <div className="ns-page">
        <HonestState
          state={HONEST_STATE.UNAVAILABLE}
          subject="This work order"
          detail={error}
          action={<Button variant="secondary" onClick={retry}>Try again</Button>}
        />
      </div>
    );
  }

  // A successful read that found nothing is EMPTY, and stays distinct from the failed read above.
  if (!workOrder) {
    return (
      <div className="ns-page">
        <HonestState
          state={HONEST_STATE.EMPTY}
          detail="This work order could not be found."
          action={<Button variant="secondary" onClick={backToWorkOrders}>Back to Work Orders</Button>}
        />
      </div>
    );
  }

  // REFERENCES BECOME NAMES. Where a read failed the page states that above; the field itself says
  // the reference did not resolve rather than printing the key (DECISIONS #106).
  const resolveWorkOrderReference = (fieldId, id) => {
    if (fieldId === "customerId") {
      return account?.name ? { state: REFERENCE_STATE.FOUND, label: account.name } : { state: REFERENCE_STATE.NOT_FOUND };
    }
    if (fieldId === "locationId") {
      return location?.name ? { state: REFERENCE_STATE.FOUND, label: location.name } : { state: REFERENCE_STATE.NOT_FOUND };
    }
    if (fieldId === "equipmentId") {
      if (!equipment) return { state: REFERENCE_STATE.NOT_FOUND };
      const summary = equipmentSummary(equipment);
      return {
        state: REFERENCE_STATE.FOUND,
        label: summary ? equipmentDisplayName(equipment) + " — " + summary : equipmentDisplayName(equipment),
      };
    }
    if (fieldId === "assignedTechId") {
      const identity = resolveTechnicianIdentity(id, { technicians });
      if (identity.state === "resolved") return { state: REFERENCE_STATE.FOUND, label: identity.name };
      return { state: REFERENCE_STATE.NOT_FOUND };
    }
    return undefined;
  };

  const techIdentity = resolveTechnicianIdentity(workOrder.scheduledTechId, { technicians });
  const techName = techIdentity.state === "resolved" ? techIdentity.name : null;
  const equipmentLabel = equipment
    ? [equipmentDisplayName(equipment), equipmentSummary(equipment)].filter(Boolean).join(" · ")
    : null;
  const window = formatWindow(workOrder.scheduledStart, workOrder.scheduledEnd);

  // THE KICKER: object type · governed reference. Priority rides here because the concept puts
  // "Work Order · Repair · P2 High" above the title.
  //
  // TYPE COMES FROM THE ONE VOCABULARY (NS-P4). This built the word with a local titleCase() —
  // a second enum-to-label derivation, and one that disagreed with the governed map on two of
  // the five real values: SERVICE_CALL rendered "Service call" where domain/workOrderType.js says
  // "Service Call", and PM rendered "Pm", which is not a word. An unrecognised type returns null
  // from the shared derivation and drops out of the kicker rather than being title-cased into
  // something that looks governed and is not.
  const kicker = ["Work Order", workOrderTypeLabel(workOrder.type), workOrderPriorityText(workOrder.priority)]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="ns-page">
      <div className="ns-page__crumb">
        <span>Enterprise Operations OS</span>
        <span className="ns-page__crumb-right">
          <Link to={objectListPathWithState(OBJECT_LIST_KEY.WORK_ORDERS, savedListState(OBJECT_LIST_KEY.WORK_ORDERS))}>
            Service → Work Orders
          </Link>
          {header.reference ? ` → ${header.reference}` : null}
        </span>
      </div>
      <div className="ns-rulepair" />

      <RecordIdentity
        kicker={kicker}
        reference={header.reference}
        fallbackName="Work Order"
        statusWords={header.statusWords}
        statusTone={header.statusTone}
        facts={[
          { key: "customer", label: null, value: account?.name ?? (accountError ? "Customer — not available to you" : "Customer — reference unavailable") },
          { key: "site", label: null, value: location?.name ?? (locationError ? "Site — not available to you" : "Site — reference unavailable") },
          { key: "tech", label: "Tech", value: techName ?? (workOrder.scheduledTechId ? "reference unavailable" : "Unassigned") },
          { key: "window", label: "Window", value: window },
        ]}
        actions={
          // The governed action cluster, unchanged. Legality is decided by getAllowedActions and the
          // engine; this file neither widens nor narrows it.
          <WorkOrderActions
            workOrder={workOrder}
            role={role}
            technicians={technicians}
            showStatus={false}
            // The concept fills exactly one button: the transition the dispatcher almost always
            // wants next. orderWorkflowActions already orders them; this only reweights the
            // rendering of that same list.
            emphasizeFirst
          />
        }
      />

      {/* THE LIFECYCLE SPINE (NS-P1) — the single change the audits called critically absent.
          Rendered as the BAND rather than the row: on a record page the spine is the loudest
          horizontal element, and a click on any stage opens the one line of recorded fact the
          concept shows beneath it. Both renderings consume workOrderSpine, so they cannot
          disagree about where the record is.

          No lineage tail. The concept trails the band with "from SO-2026-000141"; that reference
          is not resolvable from this page (see `lineage` above), and the rail already states its
          absence once. Saying it twice is the NS-P4 defect this page exists to remove. */}
      <LifecycleBand
        steps={spine.steps}
        terminal={spine.terminal}
        ariaLabel="Work order lifecycle"
        detailFor={(stepKey) => workOrderStageDetail(workOrder, stepKey, (v) => formatMoment(v, { unknown: "" }))}
      />
      {spine.unrecognised ? (
        <HonestState state={HONEST_STATE.NOT_APPLICABLE} detail="This work order's state is not one the lifecycle recognises." />
      ) : null}

      {/* ATTENTION BEFORE WORK. Renders nothing when clean. */}
      <AttentionBand items={attention} />

      {/* Read failures are stated ONCE, here, rather than each section inventing its own blank. */}
      {accountError ? <HonestState state={HONEST_STATE.UNAVAILABLE} detail={accountError} /> : null}
      {locationError ? <HonestState state={HONEST_STATE.UNAVAILABLE} detail={locationError} /> : null}
      {techniciansError ? (
        <HonestState
          state={HONEST_STATE.UNAVAILABLE}
          detail="You don’t have access to the technician list. Some assignment info may be missing."
        />
      ) : null}

      <div className="ns-record-body">
        <div>
          {/* THE JOB LEADS, and it is the one region on the page read as sentences rather than
              scanned as data — hence the measure and the prose line-height. Each lead-in is
              rendered only when the field it introduces exists: an empty "Working diagnosis."
              would read as a diagnosis of nothing. */}
          <RuledSection title="The job">
            <div className="ns-prose">
              {workOrder.complaint ? (
                <p><strong>Complaint.</strong> {workOrder.complaint}</p>
              ) : null}
              {workOrder.diagnosis ? (
                <p><strong>Working diagnosis.</strong> {workOrder.diagnosis}</p>
              ) : null}
              {workOrder.resolution ? (
                <p><strong>Resolution.</strong> {workOrder.resolution}</p>
              ) : null}
              {!workOrder.complaint && !workOrder.diagnosis && !workOrder.resolution ? (
                <p className="ns-state--na">No complaint was recorded.</p>
              ) : null}
            </div>
          </RuledSection>

          <RuledSection
            title="Parts plan"
            meta={plan.length > 0 ? `${plan.length} part${plan.length === 1 ? "" : "s"} planned` : null}
          >
            {plan.length === 0 ? (
              <HonestState state={HONEST_STATE.EMPTY} detail="No parts have been planned for this visit." />
            ) : (
              <>
                <div className="ns-table-wrap">
                  <table className="ns-table">
                    <thead>
                      <tr>
                        <th scope="col">Part</th>
                        <th scope="col" className="ns-num">Planned</th>
                        <th scope="col">Readiness</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.map((line, i) => (
                        <tr key={line.partId ?? `line-${i}`}>
                          <td>
                            {line.name ?? <span className="ns-state--na">Part — reference unavailable</span>}
                            {line.sku && line.sku !== line.name ? <span className="ns-lineage__label"> · {line.sku}</span> : null}
                          </td>
                          <td className="ns-num">{line.qtyPlanned ?? "—"}</td>
                          {/* THE HONEST READINESS. The concept shows "✓ On truck"; EOS cannot see a
                              truck, and a fabricated tick would send a technician to a job without
                              the part. */}
                          <td><span className="ns-state--na">Not available</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="ns-table__note">
                  Planning demand only — never reserves stock or records usage. Truck and staging
                  readiness aren&rsquo;t available yet, so this shows what was planned, not what is on hand.
                </p>
              </>
            )}
          </RuledSection>

          {/* The parts plan EDITOR keeps its panel: it is an editor, which is the one context the
              ruled panel is admitted for (Grammar R13). */}
          <RuledSection title="Edit parts plan" panel>
            <WorkOrderPartsPlanEditor workOrder={workOrder} capability={partsPlanCapability} />
          </RuledSection>

          <RuledSection title="Timeline">
            <WorkOrderTimeline workOrder={workOrder} />
          </RuledSection>
        </div>

        <aside className="ns-rail">
          <RuledSection title="Equipment">
            {equipmentLabel
              ? <p>{equipmentLabel}</p>
              : workOrder.equipmentId
                ? <HonestState state={HONEST_STATE.NOT_APPLICABLE} detail="Equipment — reference unavailable." />
                : <HonestState state={HONEST_STATE.NOT_APPLICABLE} detail="No unit is recorded on this work order." />}
          </RuledSection>

          <RuledSection title="Site">
            {location?.name ? <p>{location.name}</p> : null}
            {locationError
              ? <HonestState state={HONEST_STATE.DENIED} subject="The site record" />
              : !location?.name
                ? <HonestState state={HONEST_STATE.NOT_APPLICABLE} detail="Site — reference unavailable." />
                : null}
          </RuledSection>

          <RuledSection title="Lineage">
            <ul className="ns-lineage">
              {lineage.map((edge) => (
                <li className="ns-lineage__row" key={edge.key}>
                  <span className="ns-lineage__label">{edge.label}</span>
                  {edge.state === EDGE.RESOLVED ? (
                    <span>{edge.reference}</span>
                  ) : edge.state === EDGE.UNRESOLVED ? (
                    // Names the entity, states the absence. Never the document id.
                    <span className="ns-lineage__unresolved">Linked — reference unavailable</span>
                  ) : (
                    <span className="ns-lineage__unresolved">Not linked</span>
                  )}
                </li>
              ))}
            </ul>
          </RuledSection>

          {/* RECORD DETAIL — the shared metadata shell, in the rail where the concept puts it.
              This was briefly hand-rolled here as three rows, which was a second derivation of
              facts the metadata layer already owns: exactly the NS-P4 violation this whole
              implementation exists to remove, introduced while implementing it. The conformance
              suite caught it, which is what conformance suites are for.

              The shell also carries the reference RESOLVERS, so customer, site, unit and technician
              render as what they are and never as stored ids (DECISIONS #106). */}
          <RuledSection title="Record">
            <MetadataRecordPage
              definition={workOrderRecordPageRailSubset}
              record={workOrder}
              embedded
              entityResolver={() => workOrderEntity}
              resolveReference={resolveWorkOrderReference}
            />
          </RuledSection>
        </aside>
      </div>
    </div>
  );
}

/** The recorded lifecycle events, newest first, in the Work Order-s own vocabulary. */
function WorkOrderTimeline({ workOrder }) {
  const events = useMemo(() => workOrderTimeline(workOrder), [workOrder]);
  if (events.length === 0) {
    return <HonestState state={HONEST_STATE.EMPTY} detail="No recorded events yet." />;
  }
  // When on the left in a fixed column, what happened on the right — the composition-s timeline
  // shape. The moment carries its date: a clock time alone is unreadable on a record whose events
  // span several days.
  return (
    <ul className="ns-timeline">
      {events.map((e) => (
        <li className="ns-timeline__row" key={e.key}>
          <span className="ns-timeline__when">{formatMoment(e.at, { unknown: "—" })}</span>
          <span>{e.label}</span>
        </li>
      ))}
    </ul>
  );
}

// "Tue Aug 26, 8:00 AM – 12:00 PM". WHICH DAY is the fact a dispatcher is checking, and a clock
// time alone does not carry it; the end needs only the time, since a window that crosses midnight
// is not a thing this business schedules.
function formatWindow(start, end) {
  const s = formatMoment(start, { unknown: "", weekday: true });
  if (!s) return "Not scheduled";
  const e = formatClockTime(end, { unknown: "" });
  return e ? `${s} – ${e}` : s;
}
