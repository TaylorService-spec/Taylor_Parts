// INV-EQ-P2 -- the Equipment Detail Activity Timeline. Replaces the year-grouped
// Service History with ONE unified, source-tagged, newest-first timeline that composes
// the already-loaded Work Orders (service) with an injected inventory-history source
// (inert by default). It shows an explicit "inventory not yet connected" status without
// fabricating inventory rows, and preserves honest loading/unavailable/empty/partial
// behavior. All logic lives in the pure view-model + the merged composeUnifiedTimeline;
// this JSX stays thin.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  mapServiceEvents,
  buildEquipmentTimeline,
  deriveTimelineState,
  isInventoryConnected,
  TIMELINE_STATE,
  TIMELINE_SOURCE,
} from "../../domain/equipmentTimelineView";
import {
  inertInventoryHistorySource,
  readInventoryHistorySource,
  INVENTORY_HISTORY_STATUS,
} from "../../access/equipmentInventoryHistorySource";
import LoadingState from "../../shared/ui/LoadingState";
import EmptyState from "../../shared/ui/EmptyState";
import FailureState from "../../shared/ui/FailureState";

function formatDate(at) {
  if (typeof at !== "number") return "";
  try {
    return new Date(at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export default function EquipmentTimeline({
  workOrders,
  equipmentId,
  workOrdersLoading = false,
  workOrdersError = null,
  inventorySource = inertInventoryHistorySource,
}) {
  const { status: inventoryStatus, events: inventoryEvents } = readInventoryHistorySource(inventorySource);
  const serviceEvents = useMemo(() => mapServiceEvents(workOrders, equipmentId), [workOrders, equipmentId]);
  const { rows } = useMemo(() => buildEquipmentTimeline({ serviceEvents, inventoryEvents }), [serviceEvents, inventoryEvents]);
  const state = deriveTimelineState({
    serviceLoading: workOrdersLoading,
    serviceError: !!workOrdersError,
    inventoryStatus,
    rowCount: rows.length,
  });
  const inventoryConnected = isInventoryConnected(inventoryStatus);

  return (
    <section className="fo-panel" aria-labelledby="equip-timeline" data-history-section>
      <h2 id="equip-timeline">Activity timeline</h2>

      {!inventoryConnected && (
        <p className="fo-muted" role="status">
          {inventoryStatus === INVENTORY_HISTORY_STATUS.DENIED
            ? "You are not able to view inventory history for this asset."
            : "Inventory history (receiving, transfers, installation, ledger) is not yet connected — only service activity is shown. Nothing here is simulated."}
        </p>
      )}

      {/* If the Service read failed but other-source (inventory) rows are still shown,
          disclose that Service history is unavailable -- never hide a source failure. */}
      {!!workOrdersError && (state === TIMELINE_STATE.READY || state === TIMELINE_STATE.PARTIAL) && (
        <p className="fo-warning" role="status">
          Service history is currently unavailable — showing other activity only.
        </p>
      )}

      {state === TIMELINE_STATE.LOADING && <LoadingState>Loading activity…</LoadingState>}

      {state === TIMELINE_STATE.UNAVAILABLE && (
        <FailureState
          title="Activity unavailable"
          message={typeof workOrdersError === "string" && workOrdersError ? workOrdersError : "This asset’s activity is temporarily unavailable."}
        />
      )}

      {state === TIMELINE_STATE.EMPTY && (
        <EmptyState variant="database" title="No activity yet" message="No service activity references this equipment yet." />
      )}

      {(state === TIMELINE_STATE.READY || state === TIMELINE_STATE.PARTIAL) && (
        <ol className="fo-timeline" aria-label="Equipment activity timeline">
          {rows.map((row, i) => {
            const e = row.ref || {};
            const isService = row.source === TIMELINE_SOURCE.SERVICE;
            const sourceLabel = isService ? "Service" : "Inventory";
            // rows are pre-sanitized to finite `at`; guard defensively anyway so a Date
            // render can never throw.
            const iso = Number.isFinite(row.at) ? new Date(row.at).toISOString() : null;
            const date = iso ? formatDate(row.at) : "";
            return (
              <li key={`${row.source}-${e.workOrderId || e.id || i}-${row.at}`} data-timeline-source={row.source}>
                <span className="fo-tag" aria-label={`${sourceLabel} event`}>{sourceLabel}</span>{" "}
                {iso ? <time dateTime={iso}>{date}</time> : null}{" "}
                {isService && e.workOrderId ? (
                  <Link to={`/service/work-orders/${e.workOrderId}`}>{e.woNumber ?? "Work order"}</Link>
                ) : (
                  <span>{row.kind || "Event"}</span>
                )}
                {isService && e.type ? <span className="fo-muted"> · {e.type}</span> : null}
                {isService && e.status ? <span className="fo-muted"> · {e.status}</span> : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
