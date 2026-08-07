import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { useAssignedWorkOrders } from "../../hooks/useAssignedWorkOrders";
import { updateWorkOrderExecutionData } from "../../services/workOrderService";
import { activeFieldWorkOrders } from "../../domain/fieldWorkOrder";
import { resolveScannedIdentity, SCAN_RESOLUTION } from "../../domain/scannedIdentity";
import { buildScanCandidates, notFoundReason } from "../../domain/scanCandidates";
import { deriveScanActions, SCAN_ACTIONS } from "../../domain/scanActions";
import { snapshotPartName } from "../../domain/workOrderInventorySnapshot";

/**
 * F2 — the field scanner, rebuilt on the entity resolution boundary.
 *
 * A scan is a CONTEXTUAL ENTRY POINT, not a workspace. This screen answers
 * exactly three questions and then gets out of the way:
 *
 *   What did I scan?      -> governed identity, or an honest failure
 *   Can I read it?        -> candidate scope, stated plainly
 *   What may I do here?   -> actions derived from authority, not a menu
 *
 * WHAT THIS REPLACED. The previous scanner matched against `demo/
 * InventoryContext`'s in-memory parts array and offered a literal five-item
 * action menu (receive / use on work order / load truck / cycle count / add to
 * PO) to everyone, always. That produced the defect persona review found: a
 * technician's planned part `PRT-1001` did not exist in a scanner that only
 * knew the demo SKU `CMP-048-230` — two disconnected part-number universes on
 * one screen.
 *
 * That is fixed by RESOLVING IDENTITY through the governed layer, not by
 * aliasing identifiers. There is no scanner-local normalization and no
 * hardcoded equivalence: `scannedIdentity` matches exactly, on canonical
 * identifiers, against candidates the caller is genuinely authorised to read.
 * `demo/InventoryContext` is untouched elsewhere in the app — only the field
 * scan path stops depending on it.
 *
 * AUTHORITY. This component decides nothing. `deriveScanActions` MIRRORS the
 * conditions `updateWorkOrderExecutionData` enforces server-side so the UI does
 * not offer an action the callable would reject; the server remains the
 * authority and rejects independently.
 */

const STATE = { IDLE: "IDLE", SCANNING: "SCANNING", RESOLVING: "RESOLVING", DONE: "DONE" };

export default function PartsScanner({ technicianId }) {
  const { role } = useAuth();
  const { data: workOrders, loading: workOrdersLoading, error: workOrdersError } =
    useAssignedWorkOrders(technicianId);

  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState(STATE.IDLE);
  const [identity, setIdentity] = useState(null);
  const [notice, setNotice] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [qty, setQty] = useState(1);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(null);

  // The candidate set is built ONLY from work the caller can already read.
  // No catalogParts: a technician cannot read the Part Master (firestore.rules
  // gates `parts` to admin/dispatcher or a parts/warehouse operational role),
  // so the scope narrows honestly to their own assigned work.
  const candidates = useMemo(() => buildScanCandidates({ workOrders }), [workOrders]);

  const active = useMemo(() => activeFieldWorkOrders(workOrders), [workOrders]);
  const activeWorkOrder = active[0] ?? null;

  const actions = useMemo(
    () => deriveScanActions(identity, { role, technicianId, workOrders, activeWorkOrder }),
    [identity, role, technicianId, workOrders, activeWorkOrder],
  );

  // DISPLAY ENRICHMENT ONLY -- never identity, never authority. A result card
  // that echoes the code you just typed cannot confirm you picked up the right
  // part, and "this job" means nothing on a card far below the job it refers
  // to. Both names come from records already read.
  const shown = useMemo(() => {
    if (!identity || identity.resolutionState !== SCAN_RESOLUTION.RESOLVED) return identity;
    let displayName = null;
    let jobLabel = null;
    if (identity.entityType === "PART") {
      const planned = (activeWorkOrder?.inventorySnapshot ?? []).find(
        (row) => row.partId === identity.entityId || row.sku === identity.entityId,
      );
      if (planned) displayName = snapshotPartName(planned) || null;
      if (activeWorkOrder) jobLabel = activeWorkOrder.woNumber ?? activeWorkOrder.id;
    } else if (identity.entityType === "WORK_ORDER") {
      const wo = workOrders.find((w) => w.id === identity.entityId || w.woNumber === identity.entityId);
      // Never show a raw Firestore document id to a technician.
      if (wo) displayName = wo.woNumber ?? wo.id;
    }
    return { ...identity, displayName, jobLabel };
  }, [identity, activeWorkOrder, workOrders]);

  const closeCamera = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOpen(false);
  }, []);

  useEffect(() => () => closeCamera(), [closeCamera]);

  const resolve = useCallback((raw) => {
    setPhase(STATE.RESOLVING);
    setNotice(null);
    const result = resolveScannedIdentity(raw, candidates);
    setIdentity(result);
    setPhase(STATE.DONE);
    if (result.resolutionState === SCAN_RESOLUTION.RESOLVED) navigator.vibrate?.(60);
  }, [candidates]);

  async function detect(detector) {
    if (!videoRef.current || !streamRef.current) return;
    try {
      if (videoRef.current.readyState >= 2) {
        const codes = await detector.detect(videoRef.current);
        if (codes[0]?.rawValue) {
          const value = codes[0].rawValue;
          closeCamera();
          return resolve(value);
        }
      }
    } catch {
      // A frame can fail while the camera focuses; keep scanning.
    }
    frameRef.current = requestAnimationFrame(() => detect(detector));
  }

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      return setNotice("Camera scanning isn’t available on this device. Enter the code instead.");
    }
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      setCameraOpen(true);
      setPhase(STATE.SCANNING);
      setTimeout(async () => {
        if (!videoRef.current) return;
        videoRef.current.srcObject = streamRef.current;
        await videoRef.current.play();
        if ("BarcodeDetector" in window) {
          const formats = await window.BarcodeDetector.getSupportedFormats();
          // Every format the device supports, not just QR -- the boundary
          // normalizes whatever comes back.
          const usable = formats.filter((f) => f !== "unknown");
          if (usable.length) return detect(new window.BarcodeDetector({ formats: usable }));
        }
        setNotice("Live decoding isn’t supported here. Enter the code below.");
      }, 0);
    } catch {
      setNotice("Camera access wasn’t granted. You can still enter the code.");
    }
  }

  async function invoke(action) {
    if (!action.enabled || pendingAction) return;
    if (action.id !== SCAN_ACTIONS.RECORD_PART_USAGE) {
      // VIEW_CONTEXT and lifecycle actions belong to their owning surfaces; a
      // scan is an entry point, not a second Work Order screen.
      setNotice("Open this from your job to continue.");
      return;
    }
    // Pending state is scoped to the INVOKED action -- it previously applied to
    // the whole group, so every button read "Recording...".
    setPendingAction(action.id);
    setNotice(null);
    try {
      await updateWorkOrderExecutionData(action.payload.workOrderId, {
        qtyUsedUpdates: [{ sku: action.payload.sku, delta: qty }],
      });
      setNotice(`Recorded ${qty} × ${action.payload.label} on ${action.payload.woNumber}.`);
      setIdentity(null);
      setQuery("");
      setQty(1);
    } catch (err) {
      // The server is the authority and may still refuse. Say so plainly --
      // never silently, and never as "not found".
      setNotice(err?.message || "That couldn’t be recorded. Nothing was changed.");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="fo-scan">
      <form
        className="fo-scan__entry"
        onSubmit={(e) => { e.preventDefault(); resolve(query); }}
      >
        <button type="button" className="fo-scan__camera" onClick={openCamera}>
          Scan a code
        </button>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Or type a part or work order code"
          aria-label="Part or work order code"
          enterKeyHint="search"
        />
        <button type="submit" className="fo-scan__find">Find</button>
      </form>

      {cameraOpen && (
        <div className="fo-scan__camera-modal" role="dialog" aria-modal="true" aria-label="Scanner">
          <div>
            <video ref={videoRef} autoPlay playsInline muted />
            <p>Point the camera at the code</p>
            <button type="button" onClick={closeCamera}>Cancel</button>
          </div>
        </div>
      )}

      {notice && <p className="fo-scan__notice" role="status">{notice}</p>}

      <ScanResult
        phase={phase}
        identity={shown}
        actions={actions}
        scope={candidates.scope}
        loading={workOrdersLoading}
        denied={!!workOrdersError}
        pendingAction={pendingAction}
        qty={qty}
        onQty={setQty}
        onInvoke={invoke}
      />
    </div>
  );
}

/**
 * Every distinct outcome gets its own words. LOADING, DENIED, INVALID,
 * NOT_FOUND, AMBIGUOUS and RESOLVED are never collapsed into one another --
 * particularly not denial into absence.
 */
function ScanResult({ phase, identity, actions, scope, loading, denied, pendingAction, qty, onQty, onInvoke }) {
  if (loading) return <p className="fo-muted">Loading your work…</p>;

  // A read denial is NOT an empty scanner. Say which it is.
  if (denied) {
    return (
      <p className="fo-scan__state fo-scan__state--denied" role="alert">
        Your work orders couldn’t be loaded, so scanning can’t match anything right now.
      </p>
    );
  }

  if (phase === STATE.RESOLVING) return <p className="fo-muted">Checking…</p>;
  if (!identity) return null;

  if (identity.resolutionState === SCAN_RESOLUTION.INVALID) {
    return <p className="fo-scan__state" role="status">That code couldn’t be read. Try again, or type it in.</p>;
  }

  if (identity.resolutionState === SCAN_RESOLUTION.NOT_FOUND) {
    return (
      <p className="fo-scan__state" role="status">
        {/* Scoped search -- never claims the thing does not exist. */}
        {notFoundReason(scope, identity.tokenShape)}
      </p>
    );
  }

  if (identity.resolutionState === SCAN_RESOLUTION.AMBIGUOUS) {
    return (
      <div className="fo-scan__state" role="status">
        <p>That code matches more than one record. Pick the right one from your job.</p>
        <ul>
          {identity.candidates.map((c) => (
            <li key={`${c.entityType}:${c.entityId}`}>{c.entityType.replace("_", " ").toLowerCase()} · {c.entityId}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <section className="fo-scan__result" aria-label="Scan result">
      <p className="fo-scan__kind">{identity.entityType.replace("_", " ").toLowerCase()}</p>
      {/* The NAME, not the code I just typed echoed back. A result card that
          repeats your own input cannot confirm you picked the right part. */}
      <h3 className="fo-scan__id">{identity.displayName ?? identity.entityId}</h3>
      {identity.displayName && identity.displayName !== identity.entityId && (
        <p className="fo-scan__code">{identity.entityId}</p>
      )}
      {/* Name the job. "this job" is meaningless on a card 1400px below the
          job it refers to, with other jobs scrolling in between. */}
      {identity.jobLabel && <p className="fo-scan__job">for {identity.jobLabel}</p>}

      {actions.length === 0 ? (
        <p className="fo-muted">Nothing to do with this here.</p>
      ) : (
        <ul className="fo-scan__actions">
          {actions.map((a) => (
            <li key={a.id}>
              {a.id === SCAN_ACTIONS.RECORD_PART_USAGE && a.enabled && (
                <div className="fo-scan__qty">
                  <button type="button" onClick={() => onQty(Math.max(1, qty - 1))} aria-label="Fewer">−</button>
                  <span aria-live="polite">{qty}</span>
                  <button type="button" onClick={() => onQty(qty + 1)} aria-label="More">+</button>
                </div>
              )}
              <button
                type="button"
                className="fo-btn-field"
                disabled={!a.enabled || !!pendingAction}
                onClick={() => onInvoke(a)}
              >
                {pendingAction === a.id ? "Recording…" : a.label}
              </button>
              {/* Disabled actions explain themselves rather than vanishing. */}
              {!a.enabled && a.reason && <p className="fo-scan__reason">{a.reason}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
