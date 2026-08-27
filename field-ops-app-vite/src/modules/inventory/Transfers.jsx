import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTransferOrders } from "../../hooks/useTransferOrders";
import { useTransferActions } from "../../hooks/useTransferActions";
import { fetchMobileLocationDocs } from "../../services/truckRegistryQueries";
import { buildTransferOrdersView } from "../operations/transferOrdersViewModel";
import { loadErrorMessage } from "../../domain/loadErrorMessage";
import {
  TRANSFER_FILTERS,
  DEFAULT_TRANSFER_FILTER,
  filterTransfers,
  countForFilter,
  summarizeTransfers,
  transferStatusLabel,
  transferStatusTone,
} from "../../domain/transfersView";
import WorkspaceIdentity from "../../shared/ui/WorkspaceIdentity.jsx";
import { UNRESOLVED_REFERENCE_LABEL } from "../../metadata/referenceResolution.js";
import { buildRowHref } from "../../metadata/listPresentation.js";
import { partIndexList } from "../../metadata/definitions/part.js";
import FilterBar from "../../shared/ui/FilterBar";
import LoadingState from "../../shared/ui/LoadingState";
import FailureState from "../../shared/ui/FailureState";
import EmptyState from "../../shared/ui/EmptyState";
import TransferOrderForm from "./TransferOrderForm";
import { Button } from "../../shared/ui/primitives/index.js";

// Inventory > Transfers -- the operating workspace for the governed Transfer command family
// (functions/src/inventoryTransfer/*). It REUSES the shared read (useTransferOrders ->
// operationsQueries) and the CANONICAL view-model (buildTransferOrdersView -- the same one the
// Operations dashboard uses) for display, then adds New Transfer / Dispatch / Receive / Cancel
// actions through useTransferActions -> services/transferCommandClient (the four onCall
// createTransferOrder/dispatchTransferOrder/receiveTransferOrder/cancelTransferOrder exports).
//
// HONEST POSTURE: every inventory.transfer.* capability is registered `active: false` and granted
// to NO Role today, so every real action attempt resolves `permission-denied` server-side. The
// controls render (so the workspace is reviewable and ready for the day the grant lands) but every
// call is re-authorized by the trusted backend regardless of what this UI shows -- there is no
// client-side bypass. A denied action surfaces the honest mapped message, never a fabricated
// success.
//
// Access: the Inventory > Transfers nav item is admin/dispatcher (PLACEHOLDER_DEFAULT_ROLES),
// matching the transfer_orders read rule's common path; a denied read fails closed to a
// FailureState. No Rules/deploy/grant/production is part of this workspace.
function Endpoint({ end }) {
  if (!end) return <span className="fo-muted">—</span>;
  const showType = end.type && end.type !== "WAREHOUSE";
  return (
    <span className="fo-transfer-endpoint">
      {end.label}
      {showType && <span className="fo-transfer-endpoint-type">{end.type.toLowerCase()}</span>}
    </span>
  );
}

export default function Transfers({ accessVersion }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  const read = useTransferOrders(accessVersion, refreshKey);
  const { status, clearStatus, busyId, createTransfer, dispatchTransfer, receiveTransfer, cancelTransfer } = useTransferActions({ onSettled: bumpRefresh });

  const { rows, hiddenInvalidCount } = useMemo(
    () => buildTransferOrdersView(read.transferOrderDocs, read.warehouses),
    [read.transferOrderDocs, read.warehouses]
  );
  const summary = useMemo(() => summarizeTransfers(rows), [rows]);
  const [filterKey, setFilterKey] = useState(DEFAULT_TRANSFER_FILTER);
  const [showForm, setShowForm] = useState(false);

  const warehouseOptions = useMemo(
    () => (Array.isArray(read.warehouses) ? read.warehouses : []).map((w) => ({ id: w.id, label: w.name || w.id })),
    [read.warehouses],
  );
  const [truckLocations, setTruckLocations] = useState({ loading: true, options: [] });
  useEffect(() => {
    let cancelled = false;
    fetchMobileLocationDocs()
      .then((docs) => {
        if (cancelled) return;
        const options = docs
          .filter((d) => d?.data?.active !== false)
          .map((d) => ({ id: d.docId, label: d.data?.displayLabel || d.docId }));
        setTruckLocations({ loading: false, options });
      })
      .catch(() => {
        if (!cancelled) setTruckLocations({ loading: false, options: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const intro = <p className="fo-muted">Track inventory moving between locations — what's in transit, where from and to, and for which part.</p>;

  // THE AUTHORITY NOTICE BELONGS WITH THE CONTROLS, not on a loading or error screen.
  //
  // It first rendered inside `intro`, which every branch shows -- so a user waiting for the read
  // was told about their permissions before there was anything to act on, and two role="status"
  // regions existed at once during loading. Telling somebody what they may not do is only useful
  // next to the thing they were about to try.
  const authorityNotice = (
    <>
      {/* SAY WHAT THE BACKEND WILL DO, BEFORE THE BUTTON IS PRESSED.
          Every inventory.transfer.* capability is registered active:false and granted to no default
          Role, so for almost everyone who can reach this page the write resolves permission-denied
          server-side. The controls below were offered anyway, with the concession recorded only in a
          code comment nobody using the app can read.
          Receiving, with the identical posture, states its reason up front instead. This does the
          same. It changes no authority and hides no control -- a holder of the transfer Role still
          uses them exactly as before; it just stops the screen implying an action it cannot honour. */}
      <p className="fo-scan__notice fo-scan__notice--warn" role="status">
        Transfer actions need the inventory transfer authority, which is not switched on for most
        accounts here. You can review transfers below; creating, dispatching, receiving or cancelling
        one will be refused unless that authority has been granted to you.
      </p>
    </>
  );

  if (read.loading) {
    return (
      <WorkspaceIdentity crumb="Inventory → Transfers" title="Transfers">
        {intro}
        <LoadingState>Loading transfers…</LoadingState>
      </WorkspaceIdentity>
    );
  }
  if (read.error) {
    return (
      <WorkspaceIdentity crumb="Inventory → Transfers" title="Transfers">
        {intro}
        <FailureState title="Transfers unavailable" message={loadErrorMessage({ code: read.error }, { entity: "transfers" })} />
      </WorkspaceIdentity>
    );
  }

  const visibleRows = filterTransfers(rows, filterKey);
  const filterOptions = TRANSFER_FILTERS.map((f) => ({ key: f.key, label: f.label, count: countForFilter(rows, f.key) }));

  return (
    <WorkspaceIdentity
      crumb="Inventory → Transfers"
      title="Transfers"
      // EXACT, because this read is not paged: useTransferOrders returns the governed transfer set
      // in one call, so a count over the rows IS the collection count. `rows` is that set and
      // `visibleRows` is what the filter chips leave of it — two numbers, reported in two places.
      count={rows.length}
      countLabel={rows.length === 1 ? "transfer" : "transfers"}
      // In transit is the operational fact this page exists to answer. Omitted entirely when there
      // is none — never rendered as a zero, which reads as a reassurance rather than an absence.
      summaryItems={summary?.byStatus?.IN_TRANSIT > 0 ? [{ key: "transit", label: `${summary.byStatus.IN_TRANSIT} in transit` }] : []}
      action={!showForm ? (
        <Button variant="primary" onClick={() => setShowForm(true)}>
          New transfer
        </Button>
      ) : null}
    >
      {intro}
      {authorityNotice}
      {status && (
        <p className={status.kind === "error" ? "fo-warning" : "fo-muted"} role={status.kind === "error" ? "alert" : "status"}>
          {status.message}{" "}
          <button type="button" className="fo-transfer-dismiss" onClick={clearStatus}>Dismiss</button>
        </p>
      )}
      {showForm && (
        <TransferOrderForm
          warehouseOptions={warehouseOptions}
          truckOptions={truckLocations.options}
          submitting={busyId === "create"}
          onCancel={() => setShowForm(false)}
          onSubmit={async (draft) => {
            const result = await createTransfer(draft);
            if (result.ok) setShowForm(false);
            return result;
          }}
        />
      )}
      {summary.inFlight > 0 && (
        <p className="fo-muted" role="status">
          {summary.inFlight} transfer{summary.inFlight === 1 ? "" : "s"} in flight
          {summary.byStatus.IN_TRANSIT > 0 ? ` (${summary.byStatus.IN_TRANSIT} ${transferStatusLabel("IN_TRANSIT").toLowerCase()})` : ""}.
        </p>
      )}
      {hiddenInvalidCount > 0 && (
        <p className="fo-warning" role="alert">
          {hiddenInvalidCount} transfer record{hiddenInvalidCount === 1 ? "" : "s"} couldn't be displayed due to a data issue — report this if it persists.
        </p>
      )}
      {/*
        The transfer read used to be fully UNBOUNDED -- no cap and no truncation flag at all,
        so there was nothing to disclose because nothing was bounded. It is now capped, and a
        cap that nobody tells the reader about is the defect this program keeps removing: a
        capped list must never present its cap as the whole set. Two independent flags rather
        than one merged boolean, because two different collections are capped and merging them
        would hide WHICH list is incomplete.
      */}
      {read.transferOrdersTruncated && (
        <p className="fo-muted" role="status">
          Showing the most recent transfers. Some are not listed.
        </p>
      )}
      {read.warehousesTruncated && (
        <p className="fo-muted" role="status">
          Some warehouses are not loaded, so a transfer's endpoint may show its stored id instead of a name.
        </p>
      )}
      <FilterBar options={filterOptions} activeKey={filterKey} onChange={setFilterKey} />

      {rows.length === 0 ? (
        <EmptyState
          variant="database"
          title="No transfers yet"
          message="Inventory transfers between locations will appear here."
          guidance="A transfer records stock moving from one location to another. Transfers are created by Field Ops' backend processes rather than from this read-only screen, so this list stays empty until inventory actually moves."
        />
      ) : visibleRows.length === 0 ? (
        <EmptyState variant="filtered" title="No matching transfers" message="No transfers match this filter." />
      ) : (
        <div className="fo-table-scroll">
          <table className="fo-table" aria-label="Transfers">
            <thead>
              <tr>
                <th scope="col">Part</th>
                <th scope="col">From</th>
                <th scope="col" aria-hidden="true"></th>
                <th scope="col">To</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const rowBusy = busyId === row.transferOrderId;
                return (
                  <tr key={row.transferOrderId}>
                    {/* R3 — A DOCUMENT ID WAS THE LABEL, AND NOW NOTHING IS.
                        `partId` is `type: "REFERENCE" → part` (definitions/transferOrder.js): a
                        routing key, not content. It was rendered as the link's own visible text, so
                        every Transfer row put a Firestore id in front of an operator — the exact
                        defect DECISIONS #106 and the raw-id guard exist to stop, on the one surface
                        neither of them covered.

                        NO LABEL RESOLUTION IS AVAILABLE HERE, and that is stated rather than worked
                        around. The transfer document carries no part number and no part name; the
                        only resolver that could supply one (`useCanonicalPartNames`) issues
                        `fetchPartMasterList()` — a whole-catalogue read — and the Owner ruling for
                        this tranche forbids widening the read, adding a resolver callable, adding a
                        client read, or fabricating a name. So the reference is BLOCKED on a
                        list-level part-name projection, and it says so in the shared vocabulary
                        every other unresolved reference on the platform uses.

                        THE ID SURVIVES WHERE IT IS GOVERNED: in the href. The ruling permits it for
                        identity and navigation, and the destination is real — `/inventory/:partId`
                        is a mounted route — so the row still opens the part record, where the name
                        this cell cannot name is written down. An honest link to the answer beats a
                        confident label that is a database key. */}
                    <td>
                      {row.partId ? (
                        <Link to={buildRowHref(partIndexList.rowNavigationTo, row.partId)} className="ns-state--na">
                          {UNRESOLVED_REFERENCE_LABEL}
                        </Link>
                      ) : (
                        <span className="fo-muted">—</span>
                      )}
                    </td>
                    <td><Endpoint end={row.origin} /></td>
                    <td className="fo-transfer-arrow" aria-hidden="true">→</td>
                    <td><Endpoint end={row.destination} /></td>
                    <td>
                      <span className={`fo-transfer-status fo-transfer-status--${transferStatusTone(row.status)}`}>
                        {transferStatusLabel(row.status)}
                      </span>
                    </td>
                    <td className="fo-transfer-actions">
                      {row.status === "REQUESTED" && (
                        <>
                          <button type="button" className="fo-transfer-action-btn" disabled={rowBusy} onClick={() => dispatchTransfer(row.transferOrderId)}>
                            {rowBusy ? "Working…" : "Dispatch"}
                          </button>
                          <button type="button" className="fo-transfer-action-btn fo-transfer-action-btn--muted" disabled={rowBusy} onClick={() => cancelTransfer(row.transferOrderId)}>
                            Cancel
                          </button>
                        </>
                      )}
                      {row.status === "IN_TRANSIT" && (
                        <button type="button" className="fo-transfer-action-btn" disabled={rowBusy} onClick={() => receiveTransfer(row.transferOrderId)}>
                          {rowBusy ? "Working…" : "Receive"}
                        </button>
                      )}
                      {row.status !== "REQUESTED" && row.status !== "IN_TRANSIT" && <span className="fo-muted">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </WorkspaceIdentity>
  );
}
