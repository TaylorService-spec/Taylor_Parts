import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import ScanInput from "../../shared/ui/ScanInput.jsx";
import { FEEDBACK } from "../../domain/scanInputPolicy.js";
import { normalizeScanToken } from "../../domain/scannedIdentity.js";
import { resolveTrackingModeFromControlType } from "../../domain/inventoryLedgerEvent.js";
import { buildPartLookup, LOOKUP_STATE } from "../../domain/partLookup.js";
import { createQueue, addScan, removeEntry, undoLastScan } from "../../domain/scanObservationQueue.js";
import { runBounded } from "../../domain/boundedRun.js";
import {
  MOVE_ROUTE, MOVE_ENDPOINT, deriveMoveRoute,
  buildMovementLines, canConfirm, freezeBatch, LINE_STATE, LINE_STATE_TEXT,
  toRelocationRequest, toTransferRequest,
  resultFromResponse, resultFromError, LINE_RESULT, FAILURE_TEXT, summarizeBatch, retryableLines,
  binScanRequest, endpointFromBinResolution, warehouseEndpoint,
} from "../../domain/stockMovementSession.js";
import { binCommandClient } from "../../services/binCommandClient.js";
import { stockMovementClient } from "../../services/stockMovementClient.js";
import { transferCommandClient } from "../../services/transferCommandClient.js";
import { fetchPartMasterByIds } from "../../services/partMasterQueries";
import { resolveScannedIdentifier } from "../../services/partAliasCallableClient.js";
import { fetchWarehouses } from "../../services/operationsQueries";

// SCAN · MOVE STOCK — warehouse multi-scan (BIN-P6, Decision #170).
// Spec: docs/specifications/bin-stock-relocation-and-multi-scan.md §9.
//
// One screen for put-away, bin-to-bin, removing from a bin, and sending to a truck. The operator says
// WHERE FROM and WHERE TO, scans everything that is going, reviews it, and confirms once.
//
// ============================ WHAT THIS SCREEN NEVER DOES ============================
//
// It never moves stock by scanning. A scan is an observation in the ONE shared queue (the same queue
// Receiving uses). Only "Move" sends anything, and then one governed command per line.
//
// It never chooses a ledger type. The route -- a move inside one warehouse, or a transfer -- comes from
// the two endpoints and the SAME custody rule the server applies, and the server re-checks it.
//
// It never decides a bin exists, or which warehouse owns it. Both come from the trusted bin resolve.
//
// It never reports "Success" over a partial result. Each line says what happened to it, a failure on
// one line never retracts the others, and only a technical failure is offered for retry -- under the
// SAME key, so a line that actually went through replays instead of moving twice.

const CONCURRENCY = 4;
const newSessionId = () => `ms_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const ROUTE_TEXT = Object.freeze({
  [MOVE_ROUTE.RELOCATION]: "Move within this warehouse",
  [MOVE_ROUTE.TRANSFER]: "Transfer — the stock leaves this warehouse",
});

const RESULT_TEXT = Object.freeze({
  [LINE_RESULT.APPLIED]: "Moved",
  [LINE_RESULT.REPLAYED]: "Already moved",
  [LINE_RESULT.PENDING]: "Sending…",
});

function LocationPicker({ title, which, endpoint, warehouse, allowTruck, trucks, onWarehouse, onBinScan, onTruck, onClear, busy, scanInputDeps }) {
  return (
    <section className="fo-receiving-session__section" aria-label={title}>
      <h3 className="fo-receiving-session__kicker">{title}</h3>
      {endpoint ? (
        <p className="fo-receiving-session__identity">
          <strong>{endpoint.label}</strong>{" "}
          <button type="button" className="fo-link-btn" onClick={onClear} disabled={busy}>Change</button>
        </p>
      ) : (
        <>
          <Button variant="secondary" onClick={onWarehouse} disabled={!warehouse || busy}>
            {warehouse ? `${warehouse.name || warehouse.id} — not in a bin` : "Choose a warehouse first"}
          </Button>
          <ScanInput
            onScan={onBinScan}
            label={`Scan ${which} bin`}
            placeholder="Scan the bin label or type its code"
            disabled={!warehouse || busy}
            deps={scanInputDeps}
          />
          {allowTruck && trucks.length > 0 && (
            <label className="fo-muted">
              Or a truck{" "}
              <select className="fo-input" defaultValue="" onChange={(e) => e.target.value && onTruck(e.target.value)} disabled={busy}>
                <option value="">Choose a truck</option>
                {trucks.map((t) => <option key={t.locationId} value={t.locationId}>{t.label}</option>)}
              </select>
            </label>
          )}
        </>
      )}
    </section>
  );
}

export default function MoveStockScan({ deps }) {
  const hasCapability = deps?.hasCapability;
  const holds = (id) => { try { return typeof hasCapability === "function" && hasCapability(id) === true; } catch { return false; } };
  const canPlace = holds("inventory.placement.record");
  const canSendToTruck = holds("inventory.transfer.create") && holds("inventory.transfer.dispatch");

  const loadWarehouses = deps?.fetchWarehouses ?? fetchWarehouses;
  const binClient = deps?.binClient ?? binCommandClient;
  // TARGETED reads by id, never the whole catalogue: a warehouse scanning dozens of items must not pull
  // every Part on every session (see PART_CATALOGUE_WHOLE_COLLECTION_READ, which this screen is not on).
  const readParts = deps?.fetchParts ?? fetchPartMasterByIds;
  const resolveIdentifier = deps?.resolveIdentifier ?? resolveScannedIdentifier;
  const relocate = deps?.relocate ?? stockMovementClient.relocateStock;
  const transfer = deps?.transferClient ?? transferCommandClient;
  const loadTrucks = deps?.fetchTrucks ?? null;
  const onPendingWorkChange = deps?.onPendingWorkChange;
  const sessionId = useRef(deps?.sessionId ?? newSessionId());

  const [warehouses, setWarehouses] = useState([]);
  const [warehouseRead, setWarehouseRead] = useState("loading");
  const [warehouseId, setWarehouseId] = useState("");
  const [trucks, setTrucks] = useState([]);
  const [source, setSource] = useState(null);
  const [destination, setDestination] = useState(null);
  const [queue, setQueue] = useState(createQueue());
  const [parts, setParts] = useState(() => new Map()); // partId -> { mode, label }
  const [awaitingSerial, setAwaitingSerial] = useState(null);
  const [unresolved, setUnresolved] = useState([]);
  const [recordPlacement, setRecordPlacement] = useState(true);
  const [batch, setBatch] = useState(null);
  const [results, setResults] = useState({});
  const [batchNo, setBatchNo] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => loadWarehouses())
      .then((rows) => { if (live) { setWarehouses(rows ?? []); setWarehouseRead("ok"); } })
      .catch((err) => { if (live) setWarehouseRead(err?.code === "permission-denied" ? "denied" : "failed"); });
    if (canSendToTruck && loadTrucks) {
      Promise.resolve().then(() => loadTrucks()).then((rows) => { if (live) setTrucks(rows ?? []); }).catch(() => {});
    }
    return () => { live = false; };
  }, [loadWarehouses, loadTrucks, canSendToTruck]);

  const warehouse = warehouses.find((w) => w.id === warehouseId) ?? null;
  const tracking = useMemo(() => new Map([...parts].map(([id, p]) => [id, p.mode])), [parts]);
  const lines = useMemo(() => buildMovementLines(queue.observations, tracking), [queue, tracking]);
  const route = useMemo(() => deriveMoveRoute(source, destination), [source, destination]);
  const placementApplies = route.route === MOVE_ROUTE.RELOCATION && destination?.type === MOVE_ENDPOINT.BIN && canPlace;

  // Protect pending work from an accidental back-navigation: the workspace asks before leaving.
  const pendingCount = queue.observations.length + unresolved.length
    + (batch ? batch.lines.filter((l) => results[l.lineId]?.status !== LINE_RESULT.APPLIED && results[l.lineId]?.status !== LINE_RESULT.REPLAYED).length : 0);
  useEffect(() => { onPendingWorkChange?.(pendingCount); }, [pendingCount, onPendingWorkChange]);

  // ---------------- locations ----------------
  const resolveBinEndpoint = useCallback(async (raw) => {
    const { kind, request } = binScanRequest(raw, warehouseId, normalizeScanToken);
    const res = kind === "token" ? await binClient.resolveBinToken(request) : await binClient.resolveBin(request);
    return endpointFromBinResolution(res);
  }, [binClient, warehouseId]);

  const scanLocation = useCallback((setter) => async (raw) => {
    setNotice(null);
    try {
      const { endpoint, reason } = await resolveBinEndpoint(raw);
      if (!alive.current) return FEEDBACK.NEUTRAL;
      if (!endpoint) return { feedback: FEEDBACK.REJECTED, detail: reason };
      setter(endpoint);
      return FEEDBACK.ACCEPTED;
    } catch (err) {
      if (alive.current) setNotice(err?.code === "functions/permission-denied" ? "You are not authorized to look up bins." : "The bin could not be checked. Try again.");
      return FEEDBACK.REJECTED;
    }
  }, [resolveBinEndpoint]);

  // ---------------- items ----------------
  // ITEM SCANS ARE PROCESSED STRICTLY IN ORDER. A wedge scanner can deliver "part, serial" faster than
  // the part lookup returns; handled concurrently, the serial would be resolved as an unknown PART and
  // the scan after it mistaken for the serial. So each scan waits for the one before it, and the
  // "expecting a serial" fact is read from a ref that the chain updates synchronously.
  const chain = useRef(Promise.resolve());
  const expectingSerial = useRef(null);
  const setExpecting = useCallback((partId) => { expectingSerial.current = partId; setAwaitingSerial(partId); }, []);

  const processItem = useCallback(async (raw) => {
    setNotice(null);
    if (expectingSerial.current) {
      // The scan after a serialized part IS its serial. The server checks it is at the source.
      const partId = expectingSerial.current;
      setQueue((q) => addScan(q, { partId, serialNo: raw.trim() }));
      setExpecting(null);
      return FEEDBACK.ACCEPTED;
    }
    try {
      // The alias resolver answers "which part does this code belong to"; then only that part, and the
      // code itself as a part id, are read. Both halves go into the SAME buildPartLookup Lookup uses.
      const aliasOutcome = await Promise.resolve().then(() => resolveIdentifier({ rawValue: raw })).catch(() => ({ errorStatus: "internal" }));
      // The transport nests its answer: { result: { result: "FOUND", partId } }. Only a FOUND alias names
      // a part worth reading; an inactive or ambiguous one is reported by buildPartLookup as it is.
      const aliasPartId = aliasOutcome?.result?.result === "FOUND" && typeof aliasOutcome.result.partId === "string"
        ? aliasOutcome.result.partId
        : null;
      const catalogResult = await Promise.resolve()
        .then(() => readParts([raw.trim(), ...(aliasPartId ? [aliasPartId] : [])]))
        .catch(() => ({ ok: false, code: "unavailable" }));
      if (!alive.current) return FEEDBACK.NEUTRAL;
      const lookup = buildPartLookup({ catalogResult, aliasOutcome, token: raw });
      if (lookup.state !== LOOKUP_STATE.RESOLVED || !lookup.part) {
        // Unresolved identity stays VISIBLE -- it is never dropped, and it blocks nothing it should not.
        setUnresolved((u) => [...u, { token: raw, message: lookup.message ?? "That code does not match a part." }]);
        return { feedback: FEEDBACK.REJECTED, detail: lookup.message ?? "That code does not match a part." };
      }
      const part = lookup.part;
      const mode = resolveTrackingModeFromControlType(part.controlType).mode;
      setParts((m) => new Map(m).set(part.partId, { mode: mode ?? "UNKNOWN", label: part.name ? `${part.partId} · ${part.name}` : part.partId }));
      if (mode === "SERIAL") {
        setExpecting(part.partId);
        return FEEDBACK.ACCEPTED;
      }
      setQueue((q) => addScan(q, { partId: part.partId }));
      return FEEDBACK.ACCEPTED;
    } catch {
      setNotice("That scan could not be checked. Try again.");
      return FEEDBACK.REJECTED;
    }
  }, [readParts, resolveIdentifier, setExpecting]);

  const scanItem = useCallback((raw) => {
    const next = chain.current.then(() => processItem(raw));
    chain.current = next.catch(() => {});
    return next;
  }, [processItem]);

  const removeLine = useCallback((line) => {
    setQueue((q) => line.entryIds.reduce((acc, id) => removeEntry(acc, id), q));
  }, []);

  // ---------------- confirm / retry ----------------
  const execute = useCallback(async (frozen, toSend, placement) => {
    setBusy(true);
    setResults((r) => ({ ...r, ...Object.fromEntries(toSend.map((l) => [l.lineId, { lineId: l.lineId, status: LINE_RESULT.PENDING, failure: null }])) }));
    const out = await runBounded(toSend, async (line) => {
      try {
        if (frozen.route === MOVE_ROUTE.RELOCATION) {
          return resultFromResponse(line, await relocate(toRelocationRequest(frozen, line, { recordPlacement: placement })));
        }
        const created = await transfer.createTransferOrder(toTransferRequest(frozen, line));
        const dispatched = await transfer.dispatchTransferOrder({ transferOrderId: created?.transferOrderId });
        const replayed = created?.outcome === "replayed" && dispatched?.outcome === "replayed";
        return resultFromResponse(line, { outcome: replayed ? "replayed" : "applied" });
      } catch (err) {
        return resultFromError(line, err);
      }
    }, CONCURRENCY);
    if (!alive.current) return;
    setResults((r) => ({ ...r, ...Object.fromEntries(out.map((res) => [res.lineId, res])) }));
    setBusy(false);
  }, [relocate, transfer]);

  const confirm = useCallback(async () => {
    if (!canConfirm(lines, route)) return;
    const next = batchNo + 1;
    const frozen = freezeBatch({ sessionId: sessionId.current, batchNo: next, lines, source, destination, route });
    setBatchNo(next);
    setBatch(frozen);
    setResults({});
    setQueue(createQueue()); // the observations now live in the frozen batch
    await execute(frozen, frozen.lines, placementApplies && recordPlacement);
  }, [lines, route, batchNo, source, destination, execute, placementApplies, recordPlacement]);

  const retry = useCallback(async () => {
    if (!batch) return;
    await execute(batch, retryableLines(batch, results), placementApplies && recordPlacement);
  }, [batch, results, execute, placementApplies, recordPlacement]);

  const summary = batch ? summarizeBatch(batch, results) : null;
  // A failed line never silently disappears: a new batch cannot replace one that still has failures
  // until they are retried or the operator explicitly says they have dealt with them.
  const blockedByPrior = !!(batch && summary && !summary.complete);
  const toRetry = batch ? retryableLines(batch, results) : [];

  // ---------------- render ----------------
  if (warehouseRead === "denied") {
    return <p className="fo-scan__state fo-scan__state--denied">You are not authorized to see warehouses, so stock cannot be moved from here.</p>;
  }

  return (
    <div className="fo-receiving-session">
      <section className="fo-receiving-session__section" aria-label="Warehouse">
        <label className="fo-receiving-session__kicker" htmlFor="move-warehouse">Warehouse</label>
        {warehouseRead === "failed" && <p className="fo-inline-error">The warehouse list could not be read. Try again.</p>}
        <select id="move-warehouse" className="fo-input" value={warehouseId}
          onChange={(e) => { setWarehouseId(e.target.value); setSource(null); setDestination(null); }}
          disabled={busy || (batch && summary && !summary.complete)}>
          <option value="">Choose a warehouse</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name || w.id}</option>)}
        </select>
      </section>

      <LocationPicker title="Moving from" which="source" endpoint={source} warehouse={warehouse}
        allowTruck={false} trucks={[]} busy={busy} scanInputDeps={deps?.scanInputDeps}
        onWarehouse={() => warehouse && setSource(warehouseEndpoint(warehouse))}
        onBinScan={scanLocation(setSource)} onClear={() => setSource(null)} />

      <LocationPicker title="Moving to" which="destination" endpoint={destination} warehouse={warehouse}
        allowTruck={canSendToTruck} trucks={trucks} busy={busy} scanInputDeps={deps?.scanInputDeps}
        onWarehouse={() => warehouse && setDestination(warehouseEndpoint(warehouse))}
        onBinScan={scanLocation(setDestination)}
        onTruck={(id) => { const t = trucks.find((x) => x.locationId === id); if (t) setDestination({ type: MOVE_ENDPOINT.MOBILE, locationId: t.locationId, custodyWarehouseId: null, label: t.label }); }}
        onClear={() => setDestination(null)} />

      {source && destination && (
        <p className="fo-receiving-session__identity" role="status">
          {route.route === MOVE_ROUTE.INVALID
            ? <span className="fo-warning">{route.reason === "same_location" ? "Moving from and to the same place." : "Those locations cannot be moved between from here."}</span>
            : <><strong>{ROUTE_TEXT[route.route]}</strong> — {source.label} → {destination.label}</>}
        </p>
      )}

      <section className="fo-receiving-session__section" aria-label="Items">
        <h3 className="fo-receiving-session__kicker">What is moving</h3>
        {awaitingSerial && (
          <p className="fo-scan__notice fo-scan__notice--pending" role="status">
            Scan the serial number for {parts.get(awaitingSerial)?.label ?? awaitingSerial}.{" "}
            <button type="button" className="fo-link-btn" onClick={() => setExpecting(null)}>Cancel</button>
          </p>
        )}
        <ScanInput onScan={scanItem} label={awaitingSerial ? "Scan serial number" : "Scan item"}
          placeholder={awaitingSerial ? "Scan the serial on the unit" : "Scan each item going"}
          disabled={busy || route.route === MOVE_ROUTE.INVALID} deps={deps?.scanInputDeps} />
        <p className="fo-muted">Scanning records what is going. Nothing moves until you confirm.</p>

        {lines.length > 0 && (
          <div className="fo-table-scroll">
            <table className="fo-table fo-receiving-session__table">
              <thead><tr><th scope="col">Item</th><th scope="col" className="num">Qty</th><th scope="col">Status</th><th scope="col"><span className="fo-sr-only">Remove</span></th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.lineId}>
                    <td>{parts.get(l.partId)?.label ?? l.partId}{l.serialNo ? <><br /><span className="fo-muted">Serial {l.serialNo}</span></> : null}</td>
                    <td className="num">{l.quantity}</td>
                    <td>{l.state === LINE_STATE.READY ? LINE_STATE_TEXT[l.state] : <span className="fo-warning">{LINE_STATE_TEXT[l.state]}</span>}</td>
                    <td><button type="button" className="fo-link-btn" onClick={() => removeLine(l)} disabled={busy}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {queue.observations.length > 0 && (
          <button type="button" className="fo-link-btn" onClick={() => setQueue((q) => undoLastScan(q))} disabled={busy}>Undo last scan</button>
        )}
        {unresolved.length > 0 && (
          <ul className="fo-list" aria-label="Scans that did not match">
            {unresolved.map((u, i) => (
              <li key={`${u.token}-${i}`} className="fo-warning">
                {u.token}: {u.message}{" "}
                <button type="button" className="fo-link-btn" onClick={() => setUnresolved((all) => all.filter((_, j) => j !== i))}>Dismiss</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="fo-receiving-session__section fo-receiving-session__section--submit" aria-label="Confirm">
        {placementApplies && (
          <label>
            <input type="checkbox" checked={recordPlacement} onChange={(e) => setRecordPlacement(e.target.checked)} disabled={busy} />{" "}
            Also record this as a put-away
          </label>
        )}
        {blockedByPrior && lines.length > 0 && (
          <p className="fo-warning" role="status">Deal with the lines that did not move before moving more.</p>
        )}
        <Button onClick={confirm} disabled={busy || blockedByPrior || !canConfirm(lines, route)}>
          {lines.length === 0 ? "Scan items to move" : `Move ${lines.length} line${lines.length === 1 ? "" : "s"}`}
        </Button>
        {notice && <p className="fo-inline-error" role="alert">{notice}</p>}
      </section>

      {batch && summary && (
        <section className={`fo-receiving-session__section${summary.complete ? "" : " fo-receiving-session__section--attention"}`} aria-label="Result" aria-live="polite">
          <h3 className="fo-receiving-session__kicker">Result</h3>
          {/* Counts, never a headline: a partial result must be impossible to miss. */}
          <p>
            {summary.applied} moved · {summary.replayed} already moved · {summary.failed} not moved
            {summary.pending > 0 ? ` · ${summary.pending} sending` : ""}
          </p>
          <ul className="fo-list">
            {batch.lines.map((l) => {
              const r = results[l.lineId];
              const text = !r ? "Not sent" : r.status === LINE_RESULT.FAILED ? FAILURE_TEXT[r.failure] : RESULT_TEXT[r.status];
              return (
                <li key={l.lineId} className={r?.status === LINE_RESULT.FAILED ? "fo-warning" : undefined}>
                  <strong>{parts.get(l.partId)?.label ?? l.partId}</strong>{l.serialNo ? ` (serial ${l.serialNo})` : ` × ${l.quantity}`}: {text}
                </li>
              );
            })}
          </ul>
          {toRetry.length > 0 && (
            <Button variant="secondary" onClick={retry} disabled={busy}>Try again ({toRetry.length})</Button>
          )}
          {!summary.complete && summary.pending === 0 && (
            <Button variant="tertiary" onClick={() => { setBatch(null); setResults({}); }} disabled={busy}>
              I have dealt with the lines that did not move
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
