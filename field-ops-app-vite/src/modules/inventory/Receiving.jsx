import { useEffect, useMemo, useState } from "react";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import LoadingState from "../../shared/ui/LoadingState";
import FailureState from "../../shared/ui/FailureState";
import EmptyState from "../../shared/ui/EmptyState";
import { Button } from "../../shared/ui/primitives/index.js";
import ReceiveAgainstPurchaseOrder from "../receiving/ReceiveAgainstPurchaseOrder";
import MultiScanReceiving from "../receiving/MultiScanReceiving";
import AcquireExistingUnit from "../receiving/AcquireExistingUnit";
import { useAuth } from "../../auth/AuthContext";
import { useSerializedAssetAcquireCapability } from "../../access/useSerializedAssetAcquireCapability";
import { useReorderRequestsByStatuses } from "../../hooks/useReorderRequests";
import { usePurchaseOrdersByIds } from "../../hooks/usePurchaseOrdersByIds";
import { useSuppliers } from "../../hooks/useSuppliers";
import { buildPurchaseOrdersView } from "../../domain/purchaseOrdersView";
import { REORDER_REQUEST_STATUS } from "../../domain/constants";
import {
  buildReceivingWorkspaceQueue,
  QUEUE_STATE,
  RECEIVING_JOURNEY,
} from "../../domain/receivingWorkspaceQueue";
import { fetchReceivablePurchaseOrders, fetchReceivingLocationOptions } from "../../services/receivingCallableClient";
import { RECEIVING_OUTCOME } from "../../domain/receivingTransport";

// Inventory > Receiving — the Receiving workspace, recomposed to the North Star P1 design
// (docs/north-star/receiving/, frame 1a). ONE page identity, ONE "Awaiting receipt" queue over the
// two governed candidate reads with an explicit Journey column (decision RCV-D1), the exceptional
// non-PO path set apart below, and the Recent-receipts slot held in its honest unavailable state.
//
// PRESENTATION / COMPOSITION ONLY. Both receiving journeys are the EXISTING components with their
// existing mutation paths untouched — the queue replaces the journey chip toggle as the way IN, and
// a row opens the same governed workflow the chips did. The queue itself is read-composed by
// domain/receivingWorkspaceQueue.js (see its header for what each column's authority is, and for
// the named gaps RCV-G5/RCV-G6 this screen deliberately does not paper over).
//
// TWO PURCHASING AUTHORITIES, TWO JOURNEYS, ONE GOVERNED COMMAND. A reorder PO is one part at a
// full quantity and its document is immutable; a supplier PO carries several lines and accepts
// partial receipts over time. The row SAYS which journey it is, because an operator genuinely has
// to know which they are holding. Both journeys submit through the same trusted
// receiveInventoryStock command, which re-validates everything client composition concluded.
//
// ND-33 — THE EXCEPTIONAL PATH, DELIBERATELY BESIDE THE NORMAL ONES AND NOT AMONG THEM. Add
// existing unit is not a third way to receive (no purchase order, no supplier, provenance
// NON_PO_ACQUISITION), so it is not a queue row and not a journey — it sits apart, after the
// queue, named for what it does, and is ABSENT (not disabled) without the acquire capability.
const ORDERED_ONLY = [REORDER_REQUEST_STATUS.ORDERED];

export default function Receiving({ deps }) {
  // ── the two governed candidate reads the queue composes ──────────────────────────────
  const requestsRead = useReorderRequestsByStatuses(ORDERED_ONLY);
  const ids = useMemo(() => requestsRead.data.map((r) => r.id), [requestsRead.data]);
  const purchaseOrdersRead = usePurchaseOrdersByIds(ids);
  const reorderView = useMemo(
    () => buildPurchaseOrdersView({ requestsRead, purchaseOrdersRead }),
    [requestsRead, purchaseOrdersRead]
  );

  const [supplierList, setSupplierList] = useState({ pending: true });
  const [readAttempt, setReadAttempt] = useState(0);
  const [readCheckedAt, setReadCheckedAt] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setSupplierList({ pending: true });
    (deps?.fetchReceivablePurchaseOrders ?? fetchReceivablePurchaseOrders)().then((res) => {
      if (cancelled) return;
      setSupplierList(res);
      setReadCheckedAt(new Date());
    });
    return () => { cancelled = true; };
  }, [readAttempt, deps]);

  // Supplier NAMES only — enrichment through the existing suppliers read. Its failure degrades a
  // cell to a stated absence; it never blocks or reclassifies the queue, so its error is unused.
  const suppliersRead = useSuppliers(0);
  const supplierNamesById = useMemo(() => {
    const map = {};
    for (const s of suppliersRead.suppliers) {
      if (s && typeof s.id === "string" && typeof s.name === "string") map[s.id] = s.name;
    }
    return map;
  }, [suppliersRead.suppliers]);

  const queue = useMemo(
    () => buildReceivingWorkspaceQueue({ reorderView, supplierList, supplierNamesById }),
    [reorderView, supplierList, supplierNamesById]
  );

  // ── workspace state: which governed workflow is open, if any ─────────────────────────
  // `open` carries the row's opaque navigation argument into the EXISTING journey component.
  // Nothing else about either journey changed; closing returns to the queue and re-reads it.
  //
  // AUTHORITY GAP — DO NOT INVENT (RCV-G7): the design's scan-first order entry is deliberately
  // ABSENT. Canonical supplier purchase_orders have no governed business order number (RCV-G5) and
  // no governed scan-identifier/barcode contract exists for them anywhere in the repository — the
  // progress read resolves a raw document id, and nothing prints, encodes, or resolves a scannable
  // order label. A field captioned "scan a purchase order" would therefore be claiming an
  // identifier authority that does not exist. Queue-row navigation is the supported entry path
  // until a scan-identifier contract is ruled and built.
  const [open, setOpen] = useState(null);
  const closeJourney = () => { setOpen(null); setReadAttempt((n) => n + 1); };

  // ── ND-33 acquire path (unchanged behaviour, relocated composition) ──────────────────
  const [acquiring, setAcquiring] = useState(false);
  const { user } = useAuth();
  const { canAcquire } = useSerializedAssetAcquireCapability(user);
  const [locations, setLocations] = useState({ status: null, options: [] });
  const [locationAttempt, setLocationAttempt] = useState(0);
  useEffect(() => {
    if (!acquiring) return undefined;
    let cancelled = false;
    setLocations({ status: null, options: [] });
    (deps?.fetchReceivingLocationOptions ?? fetchReceivingLocationOptions)()
      .then((res) => { if (!cancelled) setLocations({ status: res.status, options: res.options ?? [] }); })
      // The transport's own vocabulary, not a hand-typed string (the exact defect ND-33 closed on).
      .catch(() => { if (!cancelled) setLocations({ status: RECEIVING_OUTCOME.UNAVAILABLE, options: [] }); });
    return () => { cancelled = true; };
  }, [acquiring, locationAttempt, deps]);

  return (
    <WorkspaceShell
      className="fo-receiving-workspace"
      crumb={
        <>
          <div className="ns-page__utility">
            <span className="ns-page__context">
              Inventory <span aria-hidden="true">→</span> Receiving
            </span>
            <span>
              {readCheckedAt
                ? `Read-checked ${readCheckedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                : "Reading the receipt queue…"}
              {" · "}
              <button type="button" className="fo-link-btn" onClick={() => setReadAttempt((n) => n + 1)}>
                Refresh
              </button>
            </span>
          </div>
          <div className="ns-rulepair" />
        </>
      }
      title="Receiving"
      context={
        <p className="fo-receiving-purpose">
          Receive purchased inventory and record company-owned units entering managed custody.
          <span className="fo-receiving-purpose__gov"> Governed transaction · limited to Admin, Dispatcher, Owner.</span>
        </p>
      }
    >
      {open === null ? (
        <>
          <AwaitingReceiptQueue queue={queue} onOpen={setOpen} />

          <div className="fo-receiving-bottom">
            {/* ND-33: the exceptional path. Set apart below the queue — it is not a way to receive. */}
            <section className="fo-receiving-exception" aria-labelledby="acquire-existing-heading">
              <h3 id="acquire-existing-heading">A unit the company already owns</h3>
              <p className="fo-muted">
                For an opening balance, a legacy migration, or a machine the company owns that was never
                recorded. This does not create a purchase order or supplier receipt, and it does not assign
                the unit to a customer.
              </p>
              {/* ABSENT, not merely disabled, for a principal who does not hold the capability. */}
              {canAcquire ? (
                <Button variant="secondary" onClick={() => setAcquiring(true)}>Add existing unit</Button>
              ) : null}
            </section>

            {/* RCV-G1 — the receipt-history slot, held in its honest unavailable state. Receipts are
                recorded by the platform, but receiving_orders is deny-all with no governed read to
                show them back. The slot is structural on purpose: when a read service is ruled and
                built, it lights here — and rows will be labelled by the receiving order number,
                never the document id (RCV-G2). */}
            <section aria-labelledby="recent-receipts-heading">
              <h3 id="recent-receipts-heading">Recent receipts</h3>
              <div className="fo-receiving-slot">
                <strong>Not connected yet.</strong> Receipts are recorded by the platform, but no
                governed read exists to show them back, so receipt history cannot honestly render today.
              </div>
            </section>
          </div>
        </>
      ) : (
        <div className="fo-receiving-journey">
          <button type="button" className="fo-link-btn" onClick={closeJourney}>
            ← Back to the receipt queue
          </button>
          {open.journey === RECEIVING_JOURNEY.SUPPLIER ? (
            <MultiScanReceiving
              key={open.purchaseOrderId}
              deps={deps}
              initialPurchaseOrderId={open.purchaseOrderId}
              onExit={closeJourney}
            />
          ) : (
            <ReceiveAgainstPurchaseOrder
              key={open.reorderRequestId}
              initialReorderRequestId={open.reorderRequestId}
              onDone={closeJourney}
            />
          )}
        </div>
      )}

      {acquiring ? (
        <AcquireExistingUnit
          canAcquire={canAcquire}
          locationOptions={locations.options}
          locationsStatus={locations.status}
          onRetryLocations={() => setLocationAttempt((n) => n + 1)}
          onClose={() => setAcquiring(false)}
          // The unit is now in AVAILABLE company stock; refreshing the queue reconciles the reads.
          // It does NOT navigate into an Equipment record — acquiring creates none.
          onAcquired={() => setReadAttempt((n) => n + 1)}
        />
      ) : null}
    </WorkspaceShell>
  );
}

// ─────────────────────────────────────────────── the queue section

function AwaitingReceiptQueue({ queue, onOpen }) {
  const heading =
    queue.state === QUEUE_STATE.READY
      ? `Awaiting receipt · ${queue.rows.length} order${queue.rows.length === 1 ? "" : "s"}`
      : queue.state === QUEUE_STATE.READY_PARTIAL
        ? `Awaiting receipt · ${queue.rows.length} shown · incomplete`
        : "Awaiting receipt";

  return (
    <section aria-labelledby="awaiting-receipt-heading">
      <h3 id="awaiting-receipt-heading">{heading}</h3>

      {queue.state === QUEUE_STATE.LOADING && <LoadingState>Loading orders awaiting receipt…</LoadingState>}

      {queue.state === QUEUE_STATE.EMPTY && (
        <EmptyState
          variant="database"
          title="Nothing awaiting receipt"
          message="Both governed sources were read and no purchase order is currently awaiting receipt."
        />
      )}

      {queue.state === QUEUE_STATE.DENIED && (
        <FailureState
          title="Not authorized"
          message="You are not authorized to read the orders awaiting receipt."
        />
      )}

      {queue.state === QUEUE_STATE.UNAVAILABLE && (
        <p className="fo-warning" role="status">
          Receiving is built but not switched on in this environment, so the orders awaiting receipt
          cannot be read. This is not an empty queue — it is an unread one.
        </p>
      )}

      {queue.state === QUEUE_STATE.FAILED && (
        <FailureState
          title="The receipt queue could not be loaded"
          // Each source's OWN sentence — denied, not-switched-on and failed are different claims.
          message={queue.notices.map((n) => n.message).join(" ")}
        />
      )}

      {(queue.state === QUEUE_STATE.READY || queue.state === QUEUE_STATE.READY_PARTIAL) && (
        <>
          {queue.state === QUEUE_STATE.READY_PARTIAL && (
            <p className="fo-warning" role="status">
              {/* The queue below is real but INCOMPLETE — one source could not be read, and rows it
                  would contribute are missing, not absent. */}
              {queue.notices.map((n) => n.message).join(" ")}
            </p>
          )}
          {queue.rows.length > 0 && (
            <div className="fo-table-scroll">
              <table className="fo-table fo-receiving-queue" aria-label="Orders awaiting receipt">
                <thead>
                  <tr>
                    <th scope="col">Order</th>
                    <th scope="col">Journey</th>
                    <th scope="col">Supplier</th>
                    <th scope="col">Lines</th>
                    <th scope="col">Order status</th>
                    <th scope="col" className="fo-receiving-queue__action-col"><span className="sr-only">Action</span></th>
                  </tr>
                </thead>
                <tbody>
                  {queue.rows.map((row) => (
                    <tr key={row.key}>
                      <td data-label="Order">
                        {/* A stated absence, never a document id (RCV-G5; RR numbering unwired) —
                            in the row's own journey words, matching the journey it opens. */}
                        {row.orderReference
                          ? <strong>{row.orderReference}</strong>
                          : <span className="fo-muted">{row.orderReferenceAbsence}</span>}
                        {row.partId && (
                          <span className="fo-receiving-queue__part">
                            {row.partId}
                            {row.orderedQuantity != null ? ` · qty ${row.orderedQuantity}` : ""}
                          </span>
                        )}
                      </td>
                      <td data-label="Journey">{row.journeyWords}</td>
                      <td data-label="Supplier">
                        {row.supplierName ?? <span className="fo-muted">Supplier not resolved</span>}
                      </td>
                      <td data-label="Lines" className="fo-receiving-queue__num">{row.lineCount ?? "—"}</td>
                      <td data-label="Order status">{row.statusWords ?? <span className="fo-muted">Not recorded</span>}</td>
                      <td data-label="Action" className="fo-receiving-queue__action-col">
                        <Button
                          type="button"
                          variant="tertiary"
                          onClick={() => onOpen(row.open)}
                          aria-label={`Receive ${row.orderReference ?? row.supplierName ?? row.journeyWords}`}
                        >
                          Receive →
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="fo-receiving-queue__note fo-muted">
            One queue, two governed journeys — each row states which it is, and opens its own governed
            workflow. Receipt progress is shown when an order is opened; the list read does not carry it.
          </p>
        </>
      )}
    </section>
  );
}
