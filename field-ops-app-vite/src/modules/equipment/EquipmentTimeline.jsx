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
import { timelineEventWords } from "../../domain/equipmentNorthStar";
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
        // THE LOCKED 1c TABLE — Source · Date · Event, newest first and source-tagged. It was an
        // `<ol>` of run-together spans, which is the right SEMANTICS for a sequence and the wrong
        // shape for a log somebody scans: the source, the date and the event could not be read down
        // their own columns.
        //
        // AND IT PRINTED RAW ENUMS. `e.type` and `e.status` went to the screen unmapped, so a row
        // read "Service · WO-873 · REPAIR · IN_PROGRESS" while every other Work Order surface in
        // EOS already sourced those words from WORK_ORDER_TYPE_LABEL / WORK_ORDER_STATUS_LABEL.
        // `timelineEventWords` is now the one place those words come from, and an unrecognised
        // token is DROPPED rather than printed — printing it because it is the only thing we have
        // is precisely what was wrong.
        <div className="ns-table-wrap">
          <table className="ns-table ns-table--cards">
            <caption className="fo-sr-only">Equipment activity timeline, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Date</th>
                <th scope="col">Event</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const e = row.ref || {};
                const words = timelineEventWords(row);
                // rows are pre-sanitized to finite `at`; guard defensively anyway so a Date
                // render can never throw.
                const iso = Number.isFinite(row.at) ? new Date(row.at).toISOString() : null;
                const date = iso ? formatDate(row.at) : "";
                return (
                  <tr key={`${row.source}-${e.workOrderId || e.id || i}-${row.at}`} data-timeline-source={row.source}>
                    <td data-label="Source">{words.sourceLabel}</td>
                    <td data-label="Date">
                      {iso ? <time dateTime={iso}>{date}</time> : <span className="ns-state--na">Date unavailable</span>}
                    </td>
                    <td data-label="Event">
                      {/* The Work Order's governed reference is the link text. Its document id is
                          the link TARGET and is never the label. */}
                      {row.source === TIMELINE_SOURCE.SERVICE && words.workOrderId ? (
                        <Link to={`/service/work-orders/${words.workOrderId}`}>
                          {words.reference ?? words.fallbackEvent}
                        </Link>
                      ) : (
                        <span>{words.fallbackEvent}</span>
                      )}
                      {words.detail ? <span className="fo-muted"> · {words.detail}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
