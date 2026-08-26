import { useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useWorkOrder } from "../../hooks/useWorkOrder";
import { useAccount } from "../../hooks/useAccount";
import { useLocation as useLocationDoc } from "../../hooks/useLocation";
import { useEquipmentDoc } from "../../hooks/useEquipment";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { useWorkOrderReadinessContext } from "../../hooks/useWorkOrderReadinessContext.js";
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
import { formatAddress } from "../../domain/address";
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
import { buildWorkOrderPartsReadiness } from "../../domain/workOrderPartsReadiness.js";
import { READINESS } from "../../domain/readinessLanguage.js";
import {
  deriveWorkOrderIntelligence,
  mergeWorkOrderAttention,
} from "../../domain/workOrderIntelligence.js";

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
// separate suggestion panel. Governed intelligence contributes to the existing AttentionBand only
// when the canonical readiness projection has a substantiated ATTENTION state. UNKNOWN remains quiet.
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
  const { context: readinessContext } = useWorkOrderReadinessContext(workOrderId);
  // useEquipmentDoc returns { equipment, loading, error } — NOT { data }. Destructuring `data`
  // here left `equipment` permanently undefined, so the rail's Equipment section rendered
  // "reference unavailable" on every work order that has a unit, and the Record shell reported the
  // unit as no longer existing. Wiring drift, fixed in the wiring. The readiness branch above was
  // cut before that fix and still carried the old key; this is the corrected one.
  const { equipment } = useEquipmentDoc(workOrder?.equipmentId ?? null);
  const { account, error: accountError } = useAccount(workOrder?.customerId ?? null);
  const { location, error: locationError } = useLocationDoc(workOrder?.locationId ?? null);
  const { data: technicians, error: techniciansError } = useFirestoreCollection(TECHNICIANS_COLLECTION);

  // ONE DERIVATION PER FACT (NS-P4). Everything below renders what these return; nothing re-derives.
  const header = useMemo(() => workOrderHeader(workOrder), [workOrder]);
  const spine = useMemo(() => workOrderSpine(workOrder?.status), [workOrder?.status]);
  const plan = useMemo(() => workOrderPartsPlan(workOrder), [workOrder]);
  const baseAttention = useMemo(
    () => workOrderAttention(workOrder, { nowMillis: Date.now(), partsPlan: plan }),
    [workOrder, plan],
  );
  // The trusted callable returns SOURCE DIMENSIONS, not a second readiness answer. The existing pure
  // projection remains the one authority that derives READY / ATTENTION / UNKNOWN.
  const partsReadiness = useMemo(
    () => readinessContext && workOrder
      ? buildWorkOrderPartsReadiness({
          workOrder,
          plannedParts: readinessContext.plannedParts ?? [],
          capabilities: readinessContext.capabilities ?? {},
        })
      : null,
    [readinessContext, workOrder],
  );
  // Intelligence joins the SAME attention channel; it never creates a second copilot/suggestion band.
  const intelligence = useMemo(
    () => deriveWorkOrderIntelligence(workOrder, { partsPlan: plan, partsReadiness }),
    [workOrder, plan, partsReadiness],
  );
  const attention = useMemo(
    () => mergeWorkOrderAttention(baseAttention, intelligence),
    [baseAttention, intelligence],
  );
  // The Sales Order reference is not resolvable from this page today — there is no per-id governed
  // read reachable here for it. The edge therefore renders as UNRESOLVED, naming the entity and
  // stating the absence, and never as the document id.
  const lineage = useMemo(() => workOrderLineage(workOrder, { salesOrderReference: null }), [workOrder]);

  // The lifecycle tail, from that ONE lineage derivation. Three states, three sentences — a
  // resolvable reference would read "from SO-…", and until a naming read exists the other two say
  // which of "not linked" and "linked but unreadable" is true, because those are different facts
  // about the record and a dispatcher acts differently on each.
  const salesOrderEdge = lineage.find((e) => e.key === "salesOrder") ?? null;
  const lineageTail = !salesOrderEdge
    ? null
    : salesOrderEdge.state === EDGE.RESOLVED
      ? `from ${salesOrderEdge.reference}`
      : salesOrderEdge.state === EDGE.UNRESOLVED
        ? "Linked to a sales order — reference unavailable."
        : "Lineage isn’t linked on this record yet.";

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
  const siteAddress = formatAddress(location?.address ?? location ?? null);

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
      {/* THE UTILITY LINE (P1v2). Context left, live indicator right — the concept's arrangement,
          which also puts the trail where a reader looks for it first.

          THE LIVE CLAIM IS TRUE, which is why it is the one intelligence affordance on the concept
          that shipped whole. useWorkOrder is an onSnapshot subscription: this record really does
          update without a reload. The concept's ⌘K hint has no command palette behind it and is
          NOT rendered — an affordance for a shortcut that does nothing is worse than its absence. */}
      <div className="ns-page__utility">
        <span className="ns-page__context">
          <Link to={objectListPathWithState(OBJECT_LIST_KEY.WORK_ORDERS, savedListState(OBJECT_LIST_KEY.WORK_ORDERS))}>
            Service → Work Orders
          </Link>
          {header.reference ? ` → ${header.reference}` : null}
        </span>
        <span className="ns-live">
          <span className="ns-live__dot" aria-hidden="true" />
          Live — this record updates in real time
        </span>
      </div>
      <div className="ns-rulepair" />

      <RecordIdentity
        kicker={kicker}
        reference={header.reference}
        fallbackName="Work Order"
        // THE STATE AS A CLAUSE (P1v2), from the SAME vocabulary the spine uses. The pill became a
        // sentence because the concept writes one, and a sentence is the one status treatment that
        // is safe without a glyph: the meaning is in the words, not the colour.
        statusWords={header.statusSentence ?? header.statusWords}
        statusTone={header.statusTone}
        statusVariant="sentence"
        facts={[
          { key: "customer", label: null, value: account?.name ?? (accountError ? "Customer — not available to you" : "Customer — reference unavailable") },
          { key: "site", label: null, value: location?.name ?? (locationError ? "Site — not available to you" : "Site — reference unavailable") },
          { key: "tech", label: "Tech", value: techName ?? (workOrder.scheduledTechId ? "reference unavailable" : "Unassigned") },
          { key: "window", label: "Window", value: window },
          // GAP 8 — the concept puts a first-visit-fix likelihood here. There is no predictor, so
          // the slot states that rather than showing a percentage. A number here would be read as
          // computed, and acted on.
          {
            key: "fvf",
            label: null,
            value: <span className="ns-gap-note">First-visit fix — not computed</span>,
            title: "Requires a prediction engine — a post-pilot governance item",
          },
        ]}
        actions={
          // The governed action cluster, unchanged. Legality is decided by getAllowedActions and the
          // engine; this file neither widens nor narrows it.
          //
          // ─────────── THE TWO DISABLED BUTTONS ARE NOT ACTIONS ───────────
          //
          // The concept's header carries Reschedule and Message technician. The engine grants a
          // dispatcher NEITHER at DISPATCHED — Reschedule is not a transition that exists, and
          // there is no notification channel to message down. Owner ruling (P1v2): render them as
          // truthful disabled placeholders so the action architecture matches the approved source
          // now and lights up when the behaviour ships, with the behaviour itself as separate,
          // separately-approved work (B1, B2).
          //
          // They carry NO onClick, NO handler, NO command, NO capability check — there is nothing
          // to check, because there is nothing behind them. `disabled` is not a permission decision
          // here and must never be mistaken for one: a permission-disabled button means "not you",
          // and these mean "not yet, for anyone". The tooltip says which, in those words.
          <>
            <button
              type="button"
              className="fo-button ns-btn-pending"
              disabled
              title="Not available yet — rescheduling a dispatched work order needs a transition the engine does not have (backlog B1). Not a permission limit."
            >
              Reschedule
            </button>
            <button
              type="button"
              className="fo-button ns-btn-pending ns-btn-pending--primary"
              disabled
              title="Not available yet — there is no technician notification channel to send to (backlog B2). Not a permission limit."
            >
              Message technician
            </button>
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
          </>
        }
      />

      {/* THE LIFECYCLE SPINE (NS-P1) — the single change the audits called critically absent.
          Rendered as the BAND rather than the row: on a record page the spine is the loudest
          horizontal element, and a click on any stage opens the one line of recorded fact the
          concept shows beneath it. Both renderings consume workOrderSpine, so they cannot
          disagree about where the record is.

          LINEAGE RIDES HERE (P1v2), not in the rail. The concept trails the band with
          "from SO-2026-000141"; the reference is not resolvable from this page (see `lineage`),
          so the tail states the absence instead. It is stated in ONE place — the rail's separate
          Lineage section is gone, because the same sentence in both is the NS-P4 defect this
          composition exists to remove. */}
      <LifecycleBand
        steps={spine.steps}
        terminal={spine.terminal}
        ariaLabel="Work order lifecycle"
        detailFor={(stepKey) => workOrderStageDetail(workOrder, stepKey, (v) => formatMoment(v, { unknown: "" }))}
        tail={lineageTail}
      />
      {spine.unrecognised ? (
        <HonestState state={HONEST_STATE.NOT_APPLICABLE} detail="This work order's state is not one the lifecycle recognises." />
      ) : null}

      <AttentionBand items={attention} />

      {accountError ? <HonestState state={HONEST_STATE.UNAVAILABLE} detail={accountError} /> : null}
      {locationError ? <HonestState state={HONEST_STATE.UNAVAILABLE} detail={locationError} /> : null}
      {techniciansError ? (
        <HonestState
          state={HONEST_STATE.UNAVAILABLE}
          detail="You don’t have access to the technician list. Some assignment info may be missing."
        />
      ) : null}

      {/* GAP 5 — THE SUGGESTION SLOT, KEPT EMPTY AND SAID SO.
          The approved concept puts a suggestion band here. No engine is connected: #1493 wired the
          governed intelligence contract, and it returns speak:false until a trusted readiness
          assembler exists, so nothing is proposed.

          The slot renders anyway, holding its geometry, stating the absence. It is deliberately
          NOT bronze while empty — bronze is this system's "pay attention" colour, and an empty
          slot dressed as advice is exactly the fabrication the whole composition refuses.
          .ns-suggest--active restores it the day something real has something to say. */}
      <div className="ns-suggest" aria-label="Suggested">
        <span className="ns-suggest__label">Suggested</span>
        <span>No suggestion engine is connected yet — nothing is proposed for this job.</span>
      </div>

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

          {/* PARTS — and the READINESS COLUMN IS REAL NOW, which changes what this section may say.
              The caveat rides with the HEADING, where the concept carries its "verified against
              truck stock" note: under the table it can be scrolled away from the numbers it
              qualifies; beside the title it cannot.

              WHAT THE CAVEAT SAYS DEPENDS ON WHAT IS TRUE. P1v2 was written when no readiness
              existed anywhere, so its annotation reads "readiness by source isn't recorded yet".
              #1497/#1498 then shipped a governed readiness projection — reservation, warehouse and
              procurement evidence through a trusted callable — and in an environment where that is
              active the P1v2 sentence would be a FALSE disclosure: it would tell a dispatcher the
              system knows nothing while the column beside it answers. So the annotation follows the
              projection. Truck stock genuinely remains unread, which is why the active wording
              still names it rather than implying full coverage.

              The column itself carries the projection's own words and never a tick this system
              cannot substantiate: an invented ✓ sends a technician to a job without the part. */}
          <RuledSection
            title="Parts"
            meta={
              <span className="ns-section__note">
                {partsReadiness
                  ? "· readiness covers reservation, warehouse and procurement evidence — truck stock is still unread"
                  : "· readiness by source (truck / warehouse) isn’t recorded yet — quantities are planned demand"}
                {plan.length > 0 ? ` · ${plan.length} part${plan.length === 1 ? "" : "s"} planned` : ""}
              </span>
            }
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
                      {plan.map((line, i) => {
                        const readiness = readinessForRow(partsReadiness, i);
                        return (
                          <tr key={line.partId ?? `line-${i}`}>
                            <td>
                              {line.name ?? <span className="ns-state--na">Part — reference unavailable</span>}
                              {line.sku && line.sku !== line.name ? <span className="ns-lineage__label"> · {line.sku}</span> : null}
                            </td>
                            <td className="ns-num">{line.qtyPlanned ?? "—"}</td>
                            <td>
                              {readiness
                                ? <span>{readiness.label}</span>
                                : <span className="ns-state--na">Not available</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="ns-table__note">
                  {partsReadiness
                    ? "Readiness is derived from governed reservation, warehouse and procurement evidence. Truck inventory is still unavailable, so a part that depends on truck stock remains Unknown."
                    : "Planning demand only — never reserves stock or records usage. Readiness evidence is not active in this environment yet."}
                </p>
              </>
            )}
          </RuledSection>

          {/* The parts-plan EDITOR keeps its own ruled panel: it is an editor, which is the one
              context the panel variant is admitted for (Grammar R13), and it owns the governed
              write and its capability gate. It is BELOW the readiness table on purpose — a
              dispatcher reads what is ready before deciding what to change. */}
          <RuledSection title="Edit parts plan" panel>
            <WorkOrderPartsPlanEditor workOrder={workOrder} capability={partsPlanCapability} />
          </RuledSection>

          {/* The concept annotates its timeline as reconstructed rather than audited, and that
              annotation is what makes the scheduled WINDOW admissible as a row: labelled this way
              the list is explicitly milestones, not an audit trail, so a planned time sitting
              among recorded ones is not a claim that it happened. Without the label it would be. */}
          <RuledSection
            title="Timeline"
            meta={
              <span className="ns-section__note">
                · reconstructed from Work Order milestones — approximate, not a recorded audit trail
              </span>
            }
          >
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
            {/* GAP 6 — the concept puts a repair-history insight box here (repeat repairs, spend
                against replacement cost). Those need an equipment-history read this route does not
                perform. The slot states that; it does not guess at a repair count. */}
            <p className="ns-gap-note">
              Repair-history insight (repeat repairs, spend against replacement) needs an
              equipment-history read this page doesn’t perform yet.
            </p>
          </RuledSection>

          <RuledSection title="Site">
            {location?.name ? <p>{location.name}</p> : null}
            {/* The address the concept puts under the site name — a technician reads it to get
                there. Rendered only when the location record actually carries one; formatAddress
                returns null rather than a partial line, and a blank address line is worse than
                none. */}
            {siteAddress ? <p className="ns-rail__meta">{siteAddress}</p> : null}
            {locationError
              ? <HonestState state={HONEST_STATE.DENIED} subject="The site record" />
              : !location?.name
                ? <HonestState state={HONEST_STATE.NOT_APPLICABLE} detail="Site — reference unavailable." />
                : null}
            {/* GAP 3 — site contact and access notes have no fields on Location. Omitted entirely
                rather than rendered as an empty label: a blank "Access:" invites someone to
                believe the site has none. */}
          </RuledSection>

          {/* GAP 7 — the concept's dispatcher-context section: the technician's day load, how far
              this job can slip, sibling work orders at the same site. All three need scheduling
              reads this route does not perform, and #1494 adds no read. The section keeps its
              place in the rail and says so once. */}
          <RuledSection title="Dispatcher context">
            <p className="ns-gap-note">
              Technician day load, slip windows and sibling work orders require scheduling reads
              this route doesn’t perform yet.
            </p>
          </RuledSection>

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

// THE RECORDED LIFECYCLE EVENTS, newest first, in the Work Order-s own vocabulary.
//
// ════════ WHY THIS DOES NOT RENDER buildTimeline, AND WHAT THAT COLLIDES WITH ════════
//
// This page used to call buildTimeline([workOrder]) — the JOB/activity-feed model — and #1491
// fixed a real typo in that rendering (it read `e.at`; the canonical event carries `timestamp`).
// That fix is correct about the shared event shape and is kept in the suites. It is not enough to
// make the job model truthful ABOUT A WORK ORDER, and the fix made the untruth harder to see: the
// column of "Unknown" times that hid the typo was at least visibly empty.
//
// What buildTimeline([workOrder]) actually returns for a DISPATCHED work order carrying a real
// createdAt and a real dispatchedAt (measured, not reasoned about):
//
//   JOB_ASSIGNED         "Job assigned"              stamped createdAt
//   WORK_ORDER_READY     "Work order became READY"   stamped createdAt
//   JOB_CREATED          "Job created"               stamped createdAt
//   WORK_ORDER_CREATED   "Work order created"        stamped createdAt
//
// Three problems, in order of severity. Every event carries the SAME time, because jobEvents()
// stamps each one `toMillis(job.createdAt)` — so the page asserts an assignment happened at a
// moment nothing recorded. The record was never READY; that event is inferred from field phase,
// not read. And `dispatchedAt`, a governed timestamp the document genuinely carries, does not
// appear at all. A reader cannot tell any of that apart from recorded history.
//
// buildTimeline remains the authority where its inputs are jobs — Control Tower and the Activity
// Timeline panel — and nothing about it changes here. For a Work Order, the document-s own
// lifecycle timestamps are the record of when, and this reads those and only those. Which model
// owns Work Order history across surfaces is a real architectural question and is REPORTED, not
// settled here; what is settled is that this page will not render a fabricated one.
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

/** One row's readiness, from the ONE projection that derives it. No second answer here. */
function readinessForRow(partsReadiness, index) {
  const key = partsReadiness?.rows?.[index]?.readiness;
  return typeof key === "string" ? READINESS[key] ?? null : null;
}

// titleCase() is deliberately gone: it was a second enum-to-label derivation that disagreed with
// domain/workOrderType.js on two of the five real values ("Service call", "Pm"). The kicker reads
// the governed vocabulary.

// "Tue Aug 26, 8:00 AM – 12:00 PM". WHICH DAY is the fact a dispatcher is checking, and a clock
// time alone does not carry it; the end needs only the time, since a window that crosses midnight
// is not a thing this business schedules.
function formatWindow(start, end) {
  const s = formatMoment(start, { unknown: "", weekday: true });
  if (!s) return "Not scheduled";
  const e = formatClockTime(end, { unknown: "" });
  return e ? `${s} – ${e}` : s;
}
