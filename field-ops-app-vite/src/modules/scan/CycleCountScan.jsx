import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import ScanInput from "../../shared/ui/ScanInput.jsx";
import { FEEDBACK } from "../../domain/scanInputPolicy.js";
import { normalizeScanToken } from "../../domain/scannedIdentity.js";
import { resolveTrackingModeFromControlType } from "../../domain/inventoryLedgerEvent.js";
import { buildPartLookup, LOOKUP_STATE } from "../../domain/partLookup.js";
import { createQueue, addScan, removeEntry } from "../../domain/scanObservationQueue.js";
import { runBounded } from "../../domain/boundedRun.js";
import { buildCreateSheetRequest, buildSubmitLineRequest } from "../../domain/cycleCountCommandRequest.js";
import { mapCycleCountActionError, isRetryableCycleCountError } from "../../domain/cycleCountActionResult.js";
import {
  buildCountLines, linesToSubmit, lineDraft, pendingWorkCount, isDuplicateSerial, COUNT_LINE_STATE,
} from "../../domain/cycleCountScanSession.js";
import { cycleCountCommandClient } from "../../services/cycleCountCommandClient.js";
import { lookupScannedPart } from "../../services/partAliasCallableClient.js";
import { submitOrQueue, SUBMIT_RESULT } from "../../offline/submitOrQueue.js";
import { useProvidedOfflineRuntime } from "../../offline/OfflineRuntimeContext.jsx";
import { captureCycleCountSubmit } from "../../offline/warehouseIntent.js";
import { PENDING_TEXT, NOT_DURABLE_TEXT } from "../../offline/useWarehouseSubmit.js";

// SCAN · CYCLE COUNT -- count a Bin (or a warehouse or truck) part by part (BIN-P8, Cycle Count A2).
//
// Scan the bin label once: the count sheet is locked to that Bin. Then scan everything on it -- many
// Parts, repeat scans of the same Part, serial numbers -- review the lines, correct them, and submit.
// Each Part is its own line on the server (A1): its expected quantity is snapshotted when the line opens
// and is NOT shown until THAT line is submitted. Siblings stay blind. A counter can leave and resume a
// sheet from any device (A4); a manager reconciles lines on the Cycle Counts workspace.
//
// Counting moves no stock. The only path to an adjustment is a reviewer's reconciliation.
//
// Scans use the SAME observation queue as Receiving and Move stock, the SAME governed Part read as
// Lookup (lookupScannedPart), and are processed strictly in order so a fast "part, serial" pair from a
// wedge scanner is never mistaken for two parts.

const CONCURRENCY = 4;
const LOCATION_LABEL = { BIN: "Bin", WAREHOUSE: "Warehouse", MOBILE: "Truck" };

export default function CycleCountScan({ deps }) {
  const client = deps?.cycleCountClient ?? cycleCountCommandClient;
  const lookupPart = deps?.lookupPart ?? lookupScannedPart;
  const provided = useProvidedOfflineRuntime();
  const offline = deps?.offline ?? provided;
  const reportPending = deps?.onPendingWorkChange;

  const [sheet, setSheet] = useState(null); // { sheetId, location, label }
  const [queue, setQueue] = useState(createQueue());
  const [parts, setParts] = useState(() => new Map());       // partId -> { trackingMode, label }
  const [serverLines, setServerLines] = useState(() => new Map()); // partId -> server projection
  const [zeroed, setZeroed] = useState(() => new Set());
  const [unresolved, setUnresolved] = useState([]);
  const [awaitingSerial, setAwaitingSerial] = useState(null);
  const [results, setResults] = useState({}); // partId -> { status, message, retryable }
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const lines = useMemo(() => buildCountLines({ observations: queue.observations, parts, serverLines, zeroed }), [queue, parts, serverLines, zeroed]);
  const pending = pendingWorkCount(lines);
  useEffect(() => { reportPending?.(pending); }, [pending, reportPending]);
  useEffect(() => () => reportPending?.(0), [reportPending]);

  const reset = useCallback(() => {
    setSheet(null); setQueue(createQueue()); setParts(new Map()); setServerLines(new Map()); setZeroed(new Set());
    setUnresolved([]); setAwaitingSerial(null); setResults({}); setNotice(null);
  }, []);

  // ---------------------------------------------------------------- starting and resuming a sheet
  const startSheet = useCallback(async (locationType, locationId, label) => {
    const built = buildCreateSheetRequest({ locationType, locationId });
    if (!built.ok) { setNotice("Choose where you are counting."); return false; }
    setBusy(true); setNotice(null);
    try {
      const out = await client.createCycleCountSheet(built.value);
      // The label (a Bin's current code, a Warehouse's name) comes from the durable read -- the screen
      // never needs its own bins or warehouses read to show where it is counting.
      const summary = await client.getCycleCountSheet({ sheetId: out.sheetId, limit: 1 }).then((g) => g?.sheet).catch(() => null);
      if (!alive.current) return false;
      setSheet({ sheetId: out.sheetId, location: out.location ?? built.value.location, label: summary?.locationLabel ?? label });
      return true;
    } catch (err) {
      if (alive.current) setNotice(mapCycleCountActionError(err));
      return false;
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [client]);

  // The label IS the bin's stable identity (EOS-LOC:<binId>). Whether that bin may be counted -- active,
  // its Warehouse active and past the Bin conversion gate -- is the SERVER's eligibility decision, made
  // when the sheet is created; this screen does not pre-judge it and needs no bin read of its own.
  const scanBinToStart = useCallback(async (raw) => {
    const token = normalizeScanToken(raw);
    if (typeof token !== "string" || !token.startsWith("bin_")) {
      return { feedback: FEEDBACK.REJECTED, detail: "Scan the bin's label (its printed barcode)." };
    }
    return (await startSheet("BIN", token, token)) ? FEEDBACK.ACCEPTED : FEEDBACK.REJECTED;
  }, [startSheet]);

  const resume = useCallback(async (summary) => {
    setBusy(true); setNotice(null);
    try {
      const got = new Map(); const info = new Map();
      let cursor = null;
      do { // every page -- a resumed sheet must never silently show only its first lines
        const page = await client.getCycleCountSheet({ sheetId: summary.sheetId, ...(cursor ? { cursor } : {}) });
        for (const l of page.lines ?? []) { got.set(l.partId, l); info.set(l.partId, { trackingMode: l.trackingMode, label: l.partId }); }
        cursor = page.nextCursor ?? null;
      } while (cursor);
      if (!alive.current) return;
      setSheet({ sheetId: summary.sheetId, location: summary.location, label: summary.locationLabel ?? summary.location?.locationId });
      setServerLines(got); setParts(info);
    } catch (err) {
      if (alive.current) setNotice(mapCycleCountActionError(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [client]);

  // ---------------------------------------------------------------- scanning items (strictly ordered)
  const chain = useRef(Promise.resolve());
  const expectingSerial = useRef(null);
  const serverLinesRef = useRef(serverLines);
  useEffect(() => { serverLinesRef.current = serverLines; }, [serverLines]);
  const queueRef = useRef(queue);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  const setExpecting = useCallback((partId) => { expectingSerial.current = partId; setAwaitingSerial(partId); }, []);

  const processItem = useCallback(async (raw) => {
    setNotice(null);
    if (expectingSerial.current) {
      const partId = expectingSerial.current;
      const serialNo = raw.trim();
      if (isDuplicateSerial(queueRef.current.observations, partId, serialNo)) {
        return { feedback: FEEDBACK.REJECTED, detail: "That serial is already counted." };
      }
      setQueue((q) => { const next = addScan(q, { partId, serialNo }); queueRef.current = next; return next; });
      setExpecting(null);
      return FEEDBACK.ACCEPTED;
    }
    const { catalogResult, aliasOutcome } = await Promise.resolve().then(() => lookupPart(raw))
      .catch(() => ({ catalogResult: { ok: false, code: "unavailable" }, aliasOutcome: null }));
    if (!alive.current) return FEEDBACK.NEUTRAL;
    const lookup = buildPartLookup({ catalogResult, aliasOutcome, token: raw });
    if (lookup.state !== LOOKUP_STATE.RESOLVED || !lookup.part) {
      const message = lookup.message ?? "That code does not match a part.";
      setUnresolved((u) => [...u, { token: raw, message }]);
      return { feedback: FEEDBACK.REJECTED, detail: message };
    }
    const part = lookup.part;
    const label = part.name ? `${part.partId} · ${part.name}` : part.partId;
    let known = serverLinesRef.current.get(part.partId);
    if (known && known.status !== "OPEN") {
      return { feedback: FEEDBACK.REJECTED, detail: "That part's count is already submitted on this sheet." };
    }
    if (!known) {
      // A Part seen for the first time -- planned or discovered -- opens its line. The server snapshots
      // what it expects; the response deliberately says nothing about it.
      try {
        const opened = await client.openCycleCountLine({ sheetId: sheet.sheetId, partId: part.partId });
        known = { partId: part.partId, status: opened.status ?? "OPEN", trackingMode: opened.trackingMode };
        setServerLines((m) => { const next = new Map(m).set(part.partId, known); serverLinesRef.current = next; return next; });
      } catch (err) {
        const message = mapCycleCountActionError(err);
        setUnresolved((u) => [...u, { token: raw, message }]);
        return { feedback: FEEDBACK.REJECTED, detail: message };
      }
    }
    const mode = known.trackingMode ?? resolveTrackingModeFromControlType(part.controlType).mode ?? "NONE";
    setParts((m) => new Map(m).set(part.partId, { trackingMode: mode, label }));
    if (mode === "SERIAL") { setExpecting(part.partId); return FEEDBACK.ACCEPTED; }
    setQueue((q) => { const next = addScan(q, { partId: part.partId }); queueRef.current = next; return next; });
    setZeroed((z) => { if (!z.has(part.partId)) return z; const n = new Set(z); n.delete(part.partId); return n; });
    return FEEDBACK.ACCEPTED;
  }, [client, lookupPart, sheet, setExpecting]);

  const scanItem = useCallback((raw) => {
    const next = chain.current.then(() => processItem(raw));
    chain.current = next.catch(() => {});
    return next;
  }, [processItem]);

  // ---------------------------------------------------------------- corrections before submit
  const removeLastOf = useCallback((line) => {
    const last = line.entryIds[line.entryIds.length - 1];
    if (last) setQueue((q) => removeEntry(q, last));
  }, []);
  const setZero = useCallback((line) => {
    setQueue((q) => line.entryIds.reduce((acc, id) => removeEntry(acc, id), q));
    setZeroed((z) => new Set(z).add(line.partId));
  }, []);
  const removeLine = useCallback(async (line) => {
    setBusy(true);
    try {
      await client.cancelCycleCountLine({ sheetId: sheet.sheetId, partId: line.partId });
      if (!alive.current) return;
      setQueue((q) => line.entryIds.reduce((acc, id) => removeEntry(acc, id), q));
      setZeroed((z) => { const n = new Set(z); n.delete(line.partId); return n; });
      setServerLines((m) => new Map(m).set(line.partId, { ...(m.get(line.partId) ?? {}), status: "CANCELLED" }));
    } catch (err) {
      if (alive.current) setNotice(mapCycleCountActionError(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [client, sheet]);

  // ---------------------------------------------------------------- submitting, line by line
  const submitLines = useCallback(async (targets) => {
    if (targets.length === 0) return;
    setBusy(true); setNotice(null);
    setResults((r) => ({ ...r, ...Object.fromEntries(targets.map((l) => [l.partId, { status: "sending" }])) }));
    await runBounded(targets, async (line) => {
      const built = buildSubmitLineRequest(sheet.sheetId, line.partId, line.trackingMode, lineDraft(line));
      if (!built.ok) { setResults((r) => ({ ...r, [line.partId]: { status: "failed", message: "That count is not valid.", retryable: false } })); return; }
      let response = null;
      const send = async () => {
        try { response = await client.submitCycleCountLine(built.value); return { ok: true, serverIds: { status: response?.status ?? "COUNTED" } }; }
        catch (err) { return { ok: false, error: { code: err?.code ?? null, details: err?.details ?? null }, thrown: err }; }
      };
      const capture = (wasOffline) => captureCycleCountSubmit({
        principalUid: offline?.principalUid ?? "self", sheetId: sheet.sheetId, partId: line.partId,
        ...(line.trackingMode === "SERIAL" ? { countedSerialNumbers: built.value.countedSerialNumbers } : { countedQuantity: built.value.countedQuantity }),
        locationId: sheet.location?.locationId ?? null,
        captureKey: `count:${sheet.sheetId}:${line.partId}`, at: Date.now(), offline: wasOffline,
      });
      let outcome;
      if (offline?.enqueue) {
        outcome = await submitOrQueue({ send, buildIntent: capture, enqueue: offline.enqueue, nav: typeof navigator === "undefined" ? null : navigator });
      } else {
        const sent = await send();
        outcome = sent.ok ? { result: SUBMIT_RESULT.SENT } : { result: SUBMIT_RESULT.REFUSED, error: sent.thrown ?? sent.error };
      }
      if (!alive.current) return;
      if (outcome.result === SUBMIT_RESULT.SENT) {
        // THIS line's expected value arrives here -- after its count already has.
        setServerLines((m) => new Map(m).set(line.partId, { ...(m.get(line.partId) ?? {}), ...response, trackingMode: line.trackingMode, status: "COUNTED" }));
        setQueue((q) => line.entryIds.reduce((acc, id) => removeEntry(acc, id), q));
        setZeroed((z) => { const n = new Set(z); n.delete(line.partId); return n; });
        setResults((r) => ({ ...r, [line.partId]: { status: response?.outcome === "replayed" ? "already" : "done" } }));
      } else if (outcome.result === SUBMIT_RESULT.QUEUED) {
        setResults((r) => ({ ...r, [line.partId]: { status: "queued", message: PENDING_TEXT.CYCLE_COUNT_SUBMIT } }));
      } else if (outcome.result === SUBMIT_RESULT.QUEUED_NOT_DURABLE) {
        // The observations stay on screen: they are the only copy.
        setResults((r) => ({ ...r, [line.partId]: { status: "failed", message: NOT_DURABLE_TEXT, retryable: true } }));
      } else {
        const err = outcome.error ?? {};
        setResults((r) => ({ ...r, [line.partId]: { status: "failed", message: mapCycleCountActionError(err), retryable: isRetryableCycleCountError(err) } }));
      }
    }, CONCURRENCY);
    if (alive.current) setBusy(false);
  }, [client, offline, sheet]);

  const submitAll = () => submitLines(linesToSubmit(lines));
  const toRetry = linesToSubmit(lines).filter((l) => results[l.partId]?.status === "failed" && results[l.partId]?.retryable);

  // ---------------------------------------------------------------- render
  if (!sheet) {
    return <StartOrResume client={client} busy={busy} notice={notice} onScanBin={scanBinToStart} onStart={startSheet} onResume={resume} deps={deps} />;
  }
  const outstanding = linesToSubmit(lines);
  return (
    <div className="fo-receiving-session">
      <section className="fo-receiving-session__section" aria-label="Counting">
        <p className="fo-receiving-session__kicker">Counting · {LOCATION_LABEL[sheet.location?.type] ?? "Location"}</p>
        <h3 className="fo-receiving-session__identity">{sheet.label ?? sheet.location?.locationId}</h3>
        <p className="fo-muted">
          Scan everything here. You will not be shown what was expected for a part until you submit its count --
          that is deliberate, so the count reflects the shelf and not the system. Counting moves no stock.
        </p>
        <ScanInput
          onScan={scanItem}
          label={awaitingSerial ? `Scan the serial number for ${parts.get(awaitingSerial)?.label ?? awaitingSerial}` : "Scan item"}
          placeholder={awaitingSerial ? "Serial number" : "Scan a part"}
          deps={deps?.scanInputDeps}
        />
        {awaitingSerial && (
          <button type="button" className="fo-link-btn" onClick={() => setExpecting(null)}>Cancel serial scan</button>
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

      {lines.length > 0 && (
        <section className="fo-receiving-session__section" aria-label="Lines">
          <div className="fo-table-scroll">
            <table className="fo-table fo-receiving-session__table">
              <thead><tr><th scope="col">Part</th><th scope="col" className="num">Counted</th><th scope="col">Status</th><th scope="col"><span className="fo-sr-only">Correct</span></th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <CountLineRow key={l.partId} line={l} result={results[l.partId]} busy={busy}
                    onRemoveLast={() => removeLastOf(l)} onZero={() => setZero(l)} onRemoveLine={() => removeLine(l)} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="fo-receiving-session__section fo-receiving-session__section--submit" aria-label="Submit">
        <Button onClick={submitAll} disabled={busy || outstanding.length === 0}>
          {outstanding.length === 0 ? "Scan items to count" : `Submit ${outstanding.length} count${outstanding.length === 1 ? "" : "s"}`}
        </Button>
        {toRetry.length > 0 && <Button variant="secondary" onClick={() => submitLines(toRetry)} disabled={busy}>Try again ({toRetry.length})</Button>}
        <Button variant="tertiary" onClick={reset} disabled={busy || pending > 0}>
          {pending > 0 ? "Submit or clear your counts before leaving" : "Done with this location"}
        </Button>
        {notice && <p className="fo-inline-error" role="alert">{notice}</p>}
      </section>
    </div>
  );
}

const STATE_TEXT = {
  [COUNT_LINE_STATE.COUNTING]: "Not submitted",
  [COUNT_LINE_STATE.NOT_COUNTED]: "Not counted yet",
  [COUNT_LINE_STATE.SUBMITTED]: "Submitted",
  [COUNT_LINE_STATE.DECIDED]: "Reviewed",
  [COUNT_LINE_STATE.REMOVED]: "Removed",
};
const RESULT_TEXT = { sending: "Sending…", done: "Submitted", already: "Already submitted", queued: null };

function CountLineRow({ line, result, busy, onRemoveLast, onZero, onRemoveLine }) {
  const submitted = line.state === COUNT_LINE_STATE.SUBMITTED || line.state === COUNT_LINE_STATE.DECIDED;
  const editable = line.state === COUNT_LINE_STATE.COUNTING || line.state === COUNT_LINE_STATE.NOT_COUNTED;
  const statusText = result?.status === "failed" ? result.message
    : result?.status === "queued" ? result.message
    : RESULT_TEXT[result?.status] ?? STATE_TEXT[line.state];
  return (
    <tr>
      <td>
        {line.label}
        {line.trackingMode === "SERIAL" && line.countedSerialNumbers.length > 0 && (
          <><br /><span className="fo-muted">{line.countedSerialNumbers.join(", ")}</span></>
        )}
        {/* ONLY a submitted line shows what was expected -- its own value, from its own response. */}
        {submitted && <><br /><span className="fo-muted"><SubmittedFigures line={line} /></span></>}
      </td>
      <td className="num">{line.countedQuantity}</td>
      <td>{result?.status === "failed" ? <span className="fo-warning">{statusText}</span> : statusText}</td>
      <td>
        {editable && line.entryIds.length > 0 && (
          <button type="button" className="fo-link-btn" onClick={onRemoveLast} disabled={busy}>
            {line.trackingMode === "SERIAL" ? "Remove last serial" : "−1"}
          </button>
        )}
        {editable && line.countedQuantity !== 0 && (
          <> <button type="button" className="fo-link-btn" onClick={onZero} disabled={busy}>None here</button></>
        )}
        {line.state === COUNT_LINE_STATE.NOT_COUNTED && (
          <> <button type="button" className="fo-link-btn" onClick={onZero} disabled={busy}>Count as zero</button>{" "}
            <button type="button" className="fo-link-btn" onClick={onRemoveLine} disabled={busy}>Remove line</button></>
        )}
      </td>
    </tr>
  );
}

function SubmittedFigures({ line }) {
  if (line.trackingMode === "SERIAL") {
    const sv = line.serialVariance ?? {};
    return <>Expected but not found: {sv.missing?.length ? sv.missing.join(", ") : "none"} · Found but not expected: {sv.unexpected?.length ? sv.unexpected.join(", ") : "none"}</>;
  }
  if (typeof line.variance !== "number") return <>Submitted — a reviewer sees the variance.</>;
  return <>Expected {line.expectedQuantity} · {line.variance === 0 ? "matches" : `variance ${line.variance > 0 ? "+" : ""}${line.variance}`}</>;
}

function StartOrResume({ client, busy, notice, onScanBin, onStart, onResume, deps }) {
  const [openSheets, setOpenSheets] = useState(null);
  const [listError, setListError] = useState(null);
  const [locationType, setLocationType] = useState("WAREHOUSE");
  const [locationId, setLocationId] = useState("");

  const loadOpen = async () => {
    setListError(null);
    try {
      const page = await client.listCycleCountSheets({ status: "OPEN" });
      setOpenSheets(page.sheets ?? []);
    } catch (err) {
      setListError(mapCycleCountActionError(err));
    }
  };

  return (
    <div className="fo-receiving-session">
      <section className="fo-receiving-session__section" aria-label="Start counting">
        <p className="fo-receiving-session__kicker">Count a bin</p>
        <ScanInput onScan={onScanBin} label="Scan the bin label" placeholder="Bin label" deps={deps?.scanInputDeps} />
        {notice && <p className="fo-inline-error" role="alert">{notice}</p>}
      </section>

      <section className="fo-receiving-session__section" aria-label="Resume">
        <p className="fo-receiving-session__kicker">Continue a count</p>
        <Button variant="secondary" onClick={loadOpen} disabled={busy}>Show open counts</Button>
        {listError && <p className="fo-inline-error" role="alert">{listError}</p>}
        {openSheets && openSheets.length === 0 && <p className="fo-muted">There are no open counts.</p>}
        {openSheets && openSheets.length > 0 && (
          <ul className="fo-list" aria-label="Open counts">
            {openSheets.map((s) => (
              <li key={s.sheetId}>
                <button type="button" className="fo-link-btn" onClick={() => onResume(s)} disabled={busy}>
                  {LOCATION_LABEL[s.location?.type] ?? "Location"} {s.locationLabel ?? s.location?.locationId}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="fo-receiving-session__section" aria-label="Count a warehouse or truck">
        <p className="fo-receiving-session__kicker">Count a whole warehouse or truck</p>
        <form onSubmit={(e) => { e.preventDefault(); onStart(locationType, locationId, locationId); }}>
          <label>
            Where
            <select className="fo-input" value={locationType} onChange={(e) => setLocationType(e.target.value)} aria-label="Location type">
              <option value="WAREHOUSE">Warehouse</option>
              <option value="MOBILE">Truck</option>
            </select>
          </label>
          <label>
            Location
            <input className="fo-input" value={locationId} onChange={(e) => setLocationId(e.target.value)} aria-label="Location" />
          </label>
          <Button type="submit" variant="secondary" disabled={busy || locationId.trim() === ""}>Start counting</Button>
        </form>
      </section>
    </div>
  );
}
