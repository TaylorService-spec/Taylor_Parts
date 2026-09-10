import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import StatusPill from "../../shared/ui/StatusPill.jsx";
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
import {
  blindCellText, counterLineWord, lineStatusTone, deriveFinishCounting,
} from "../../domain/cycleCountNorthStar.js";
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
//
// ============================ NORTH STAR P1 (design handoff, 2026-09-10) ============================
//
// Frames 1b (desktop) / 1c (handheld). This screen renders one line list -- `.fo-cc-lines` -- laid out
// as a dense table above the mobile breakpoint and as full-width cards below it (CC-D6: the SAME data,
// a different CSS shape, never a second derivation). The sticky context header and sticky session bar
// are CC-D6/CC-D8; "Finish Counting" is CC-B2 -- a command-free, derived session close (there is no
// stored counter-completion state on the server, and this screen must never claim one). "Hidden until
// submitted" is the one literal blind-cell string (domain/cycleCountNorthStar.js's `blindCellText`).
//
// TECHNICIAN MOBILE FLOW: the handoff describes a "Truck 7" header sourced from a governed
// technician-to-truck assignment. No such assignment exists anywhere in this codebase today (no field
// on the technician doc, no field on the truck registry, no hook) -- inventing one here would be
// exactly the "no invented authority" rule this feature is built to honor. So MOBILE stays a manual
// location pick from `StartOrResume`'s existing form, gated on the `inventoryCycleCountCounter`
// capability alone, same as WAREHOUSE. A real "My Truck" header is a product decision (a governed
// custody/assignment concept), not a side effect of this UI package -- flagged in the PR, same
// treatment as CC-G2.

const CONCURRENCY = 4;
const LOCATION_LABEL = { BIN: "Bin", WAREHOUSE: "Warehouse", MOBILE: "Truck" };
const DONE_STATES = new Set([COUNT_LINE_STATE.SUBMITTED, COUNT_LINE_STATE.DECIDED, COUNT_LINE_STATE.REMOVED]);

/** A submitted/decided line's own variance, straight off its own response -- never a second derivation. */
function lineHasVariance(line) {
  return line.trackingMode === "SERIAL"
    ? ((line.serialVariance?.missing?.length ?? 0) + (line.serialVariance?.unexpected?.length ?? 0)) > 0
    : (line.variance ?? 0) !== 0;
}

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
  const [recap, setRecap] = useState(null); // set once "Finish Counting" is confirmed -- Card A

  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const lines = useMemo(() => buildCountLines({ observations: queue.observations, parts, serverLines, zeroed }), [queue, parts, serverLines, zeroed]);
  const pending = pendingWorkCount(lines);
  useEffect(() => { reportPending?.(pending); }, [pending, reportPending]);
  useEffect(() => () => reportPending?.(0), [reportPending]);

  const reset = useCallback(() => {
    setSheet(null); setQueue(createQueue()); setParts(new Map()); setServerLines(new Map()); setZeroed(new Set());
    setUnresolved([]); setAwaitingSerial(null); setResults({}); setNotice(null); setRecap(null);
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

  // CC-B2: command-free, derived from the lines this device already holds -- never a claim about a
  // server-stored "counting finished" fact, because no such fact exists.
  const isLineDone = useCallback((l) => DONE_STATES.has(l.state), []);
  const finish = deriveFinishCounting(lines, isLineDone);
  const submittedCount = lines.filter((l) => l.state === COUNT_LINE_STATE.SUBMITTED || l.state === COUNT_LINE_STATE.DECIDED).length;
  const varianceCount = lines.filter((l) => (l.state === COUNT_LINE_STATE.SUBMITTED || l.state === COUNT_LINE_STATE.DECIDED) && lineHasVariance(l)).length;

  // ---------------------------------------------------------------- render
  if (!sheet) {
    return <StartOrResume client={client} busy={busy} notice={notice} onScanBin={scanBinToStart} onStart={startSheet} onResume={resume} deps={deps} />;
  }

  if (recap) {
    return (
      <div className="fo-receiving-session">
        <section className="fo-cc-recap" aria-label="Counting complete" role="status">
          <p className="fo-cc-recap__kicker">Counting complete</p>
          <p>
            {recap.total} line{recap.total === 1 ? "" : "s"} counted · {recap.total - recap.variances} match ·{" "}
            {recap.variances} variance{recap.variances === 1 ? "" : "s"} need review.
          </p>
          <p className="fo-muted">
            Counting records what you saw. <strong>Inventory has not been adjusted</strong> — review is a
            separate governed step.
          </p>
          <Button onClick={reset}>Done</Button>
        </section>
      </div>
    );
  }

  const outstanding = linesToSubmit(lines);
  return (
    <div className="fo-receiving-session fo-cc">
      <header className="fo-cc-sticky-header">
        <div>
          <p className="fo-cc-sticky-header__kicker">Counting</p>
          <p className="fo-cc-sticky-header__place">{sheet.label ?? sheet.location?.locationId}</p>
        </div>
        <p className="fo-cc-sticky-header__tally">{submittedCount}/{lines.length}<br /><span>lines counted</span></p>
      </header>

      <section className="fo-receiving-session__section" aria-label="Counting">
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
        {/* CC-D9: the first accepted scan above IS the hardware proof -- no separate device check. */}
        <p className="fo-cc-scanner-ready fo-muted" role="status">Scanner ready</p>
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
          {/* CC-D6: ONE table, ONE dataset. `.fo-cc-lines` reflows these same rows into full-width
              cards below the mobile breakpoint by CSS alone (see index.css) -- there is no second,
              card-shaped render of this data. */}
          <div className="fo-table-scroll">
            <table className="fo-table fo-receiving-session__table fo-cc-lines">
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

      <section className="fo-cc-sticky-bar" aria-label="Submit">
        <Button onClick={submitAll} disabled={busy || outstanding.length === 0}>
          {outstanding.length === 0 ? "Scan items to count" : `Submit ${outstanding.length} count${outstanding.length === 1 ? "" : "s"}`}
        </Button>
        {toRetry.length > 0 && <Button variant="secondary" onClick={() => submitLines(toRetry)} disabled={busy}>Try again ({toRetry.length})</Button>}
        <Button
          variant="primary"
          disabled={busy || !finish.enabled}
          onClick={() => setRecap({ total: lines.length, variances: varianceCount })}
        >
          Finish Counting
        </Button>
        {!finish.enabled && <span className="fo-cc-disabled-reason">{finish.reason}</span>}
        <Button variant="tertiary" onClick={reset} disabled={busy || pending > 0}>
          {pending > 0 ? "Submit or clear your counts before leaving" : "Leave — resume later"}
        </Button>
        {notice && <p className="fo-inline-error" role="alert">{notice}</p>}
      </section>
    </div>
  );
}

function CountLineRow({ line, result, busy, onRemoveLast, onZero, onRemoveLine }) {
  const submitted = line.state === COUNT_LINE_STATE.SUBMITTED || line.state === COUNT_LINE_STATE.DECIDED;
  const editable = line.state === COUNT_LINE_STATE.COUNTING || line.state === COUNT_LINE_STATE.NOT_COUNTED;
  const word = counterLineWord(line.state, { hasVariance: submitted && lineHasVariance(line), queuedOffline: result?.status === "queued" });
  const tone = lineStatusTone(word);
  const statusMessage = result?.status === "failed" ? result.message : result?.status === "queued" ? result.message : null;

  return (
    <tr className={`fo-cc-line--${tone}`}>
      <td data-label="Part">
        {line.label}
        {line.trackingMode === "SERIAL" && line.countedSerialNumbers.length > 0 && (
          <><br /><span className="fo-muted">{line.countedSerialNumbers.join(", ")}</span></>
        )}
        {/* ONLY a submitted line's own response may show what was expected -- everything else says so
            in words (blindCellText), never a number, never a hint. */}
        {submitted ? <><br /><span className="fo-muted"><SubmittedFigures line={line} /></span></> : (
          editable && <><br /><span className="fo-muted fo-cc-line__blind">{blindCellText()}</span></>
        )}
        {statusMessage && (
          <p className={result.status === "failed" ? "fo-warning" : "fo-muted"} role={result.status === "failed" ? "alert" : "status"}>
            {statusMessage}
          </p>
        )}
      </td>
      <td className="num" data-label="Counted">{line.countedQuantity}</td>
      <td data-label="Status"><StatusPill tone={tone} label={word} /></td>
      <td data-label="Correct">
        {editable && (
          <>
            {line.entryIds.length > 0 && (
              <button type="button" className="fo-link-btn" onClick={onRemoveLast} disabled={busy}>
                {line.trackingMode === "SERIAL" ? "Remove last serial" : "−1"}
              </button>
            )}
            {line.countedQuantity !== 0 && (
              <> <button type="button" className="fo-link-btn" onClick={onZero} disabled={busy}>None here</button></>
            )}
            {line.state === COUNT_LINE_STATE.NOT_COUNTED && (
              <> <button type="button" className="fo-link-btn" onClick={onZero} disabled={busy}>Count as zero</button>{" "}
                <button type="button" className="fo-link-btn" onClick={onRemoveLine} disabled={busy}>Remove line</button></>
            )}
          </>
        )}
      </td>
    </tr>
  );
}

function SubmittedFigures({ line }) {
  if (line.trackingMode === "SERIAL") {
    const sv = line.serialVariance ?? {};
    return (
      <p className="fo-muted">
        Expected but not found: {sv.missing?.length ? sv.missing.join(", ") : "none"} · Found but not expected: {sv.unexpected?.length ? sv.unexpected.join(", ") : "none"}
      </p>
    );
  }
  if (typeof line.variance !== "number") return <p className="fo-muted">Submitted — a reviewer sees the variance.</p>;
  return (
    <p className="fo-muted">
      Expected {line.expectedQuantity} · {line.variance === 0 ? "matches" : `variance ${line.variance > 0 ? "+" : ""}${line.variance}`}
    </p>
  );
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

      {/* MOBILE (truck) counting: manual selection, gated on capability alone -- see this file's
          header note on why there is no auto-scoped "My Truck" header here. */}
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
