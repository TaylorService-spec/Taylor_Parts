// DEMO-BACKED, NOT the real inventory write path. All five ACTIONS below mutate
// the in-memory demo/InventoryContext.jsx (no Firestore, resets on reload) -- they
// do NOT write to the governed inventory_transactions ledger. It DOES read live
// jobs (useFirestoreCollection(JOBS_COLLECTION)) for the job picker, so do not
// mistake it for a connected write surface. This component is intentionally NOT
// routed live yet (see App.jsx): its real receiving path is the W3
// receiveInventoryStock callable, wired at W3 activation (Blaze/#15). Until then,
// if it is ever shown it MUST carry an in-UI "demo -- not saved" banner (R5).
import { useEffect, useMemo, useRef, useState } from "react";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { JOBS_COLLECTION, JOB_STATUS } from "../../domain/constants";
import { useInventory } from "../../demo/InventoryContext";

const ACTIONS = [
  { id: "work-order", label: "Use on work order", hint: "Remove from truck stock" },
  { id: "transfer", label: "Load my truck", hint: "Move from warehouse" },
  { id: "receive", label: "Receive inventory", hint: "Add to warehouse" },
  { id: "count", label: "Cycle count", hint: "Set quantity on hand" },
  { id: "purchase-order", label: "Add to purchase order", hint: "Add to draft order" },
];

export default function PartsScanner() {
  const inventory = useInventory();
  const { data: jobs } = useFirestoreCollection(JOBS_COLLECTION);
  const [query, setQuery] = useState("");
  const [part, setPart] = useState(null);
  const [action, setAction] = useState("work-order");
  const [quantity, setQuantity] = useState(1);
  const [jobId, setJobId] = useState("");
  const [notice, setNotice] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const scanFrameRef = useRef(null);
  const decoderControlsRef = useRef(null);

  const activeJobs = useMemo(() => jobs.filter((job) =>
    job.status === JOB_STATUS.ASSIGNED || job.status === JOB_STATUS.IN_PROGRESS
  ), [jobs]);

  useEffect(() => {
    if (!jobId && activeJobs[0]) setJobId(activeJobs[0].id);
  }, [activeJobs, jobId]);

  useEffect(() => () => {
    cancelAnimationFrame(scanFrameRef.current);
    decoderControlsRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  function valueFromQrPayload(rawValue) {
    const value = rawValue.trim();
    try {
      const parsed = JSON.parse(value);
      return parsed.partId ?? parsed.sku ?? parsed.barcode ?? parsed.item ?? value;
    } catch {
      try {
        const url = new URL(value);
        return url.searchParams.get("part") ?? url.searchParams.get("sku") ?? url.searchParams.get("barcode") ?? value;
      } catch {
        return value.replace(/^TAYLOR-PART:/i, "");
      }
    }
  }

  function acceptScan(rawValue) {
    const lookupValue = valueFromQrPayload(rawValue);
    const match = findPart(lookupValue);
    if (!match) {
      closeCamera();
      setQuery(lookupValue);
      setNotice(`QR code read, but no part matches “${lookupValue}”.`);
      return;
    }
    closeCamera();
    setPart(match);
    setQuery("");
    setNotice(`${match.name} scanned from company QR code.`);
    navigator.vibrate?.(80);
  }

  async function detectQrCodes(detector) {
    if (!videoRef.current || !streamRef.current) return;
    try {
      if (videoRef.current.readyState >= 2) {
        const codes = await detector.detect(videoRef.current);
        if (codes[0]?.rawValue) return acceptScan(codes[0].rawValue);
      }
    } catch {
      // A frame can fail while the phone camera is focusing; keep scanning.
    }
    scanFrameRef.current = requestAnimationFrame(() => detectQrCodes(detector));
  }

  function findPart(value) {
    const clean = value.trim().toLowerCase();
    return inventory.parts.find((item) =>
      [item.barcode, item.sku, item.id, item.name].some((field) => field?.toLowerCase() === clean)
    );
  }

  function handleLookup(event) {
    event?.preventDefault();
    const match = findPart(query);
    if (!match) return setNotice(`No part found for “${query}”. Try a SKU or barcode below.`);
    setPart(match);
    setQuery("");
    setNotice(`${match.name} scanned and ready.`);
  }

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) return setNotice("Camera scanning is not available here. Enter the barcode instead.");
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      setCameraOpen(true);
      setTimeout(async () => {
        if (!videoRef.current) return;
        videoRef.current.srcObject = streamRef.current;
        await videoRef.current.play();
        if ("BarcodeDetector" in window) {
          const formats = await window.BarcodeDetector.getSupportedFormats();
          if (formats.includes("qr_code")) {
            detectQrCodes(new window.BarcodeDetector({ formats: ["qr_code"] }));
          } else {
            await startEmbeddedQrDecoder();
          }
        } else await startEmbeddedQrDecoder();
      }, 0);
    } catch {
      setNotice("Camera access was not granted. You can still enter a barcode or SKU.");
    }
  }

  async function startEmbeddedQrDecoder() {
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 150 });
      decoderControlsRef.current = await reader.decodeFromVideoElement(videoRef.current, (result) => {
        if (result?.getText()) acceptScan(result.getText());
      });
    } catch {
      setNotice("The camera opened, but QR decoding could not start. Enter the printed SKU below the code.");
    }
  }

  function closeCamera() {
    cancelAnimationFrame(scanFrameRef.current);
    scanFrameRef.current = null;
    decoderControlsRef.current?.stop();
    decoderControlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOpen(false);
  }

  function applyAction() {
    const qty = Math.max(1, Number(quantity) || 1);
    if (!part) return;
    if (action === "work-order") {
      if (!jobId) return setNotice("Choose a work order first.");
      if ((inventory.truckStock[part.id] ?? 0) < qty) return setNotice("Not enough stock on your truck.");
      inventory.consumePart(jobId, part.id, qty);
    } else if (action === "transfer") {
      if ((inventory.warehouseStock[part.id] ?? 0) < qty) return setNotice("Not enough stock in the warehouse.");
      inventory.transferPart(part.id, qty);
    } else if (action === "receive") inventory.receivePart(part.id, qty);
    else if (action === "count") inventory.setCount(part.id, qty, "truck");
    else inventory.addToPurchaseOrder(part.id, qty);
    setNotice(`${qty} × ${part.name} added successfully.`);
    setPart(null);
    setQuantity(1);
  }

  return (
    <div className="scan-workspace">
      <header className="scan-hero">
        <div><span className="scan-eyebrow">FIELD INVENTORY</span><h2>Scan. Move. Done.</h2><p>Capture every part where the work happens.</p></div>
        <div className="scan-location"><span>Current location</span><strong>Truck 14 · Taylor Service</strong></div>
      </header>

      <section className="scan-card scan-card-primary">
        <div className="scan-step">1</div><div className="scan-card-body"><h3>Scan a part</h3><p>Use the camera, barcode, or part number.</p>
          <form className="scan-entry" onSubmit={handleLookup}>
            <button type="button" className="scan-camera" onClick={openCamera} aria-label="Open company QR scanner">▣ <span>Scan company QR</span></button>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="QR value, barcode, or SKU" aria-label="QR value, barcode, or SKU" />
            <button type="submit">Find part</button>
          </form>
          <div className="scan-quick">Try: {inventory.parts.map((item) => <button key={item.id} onClick={() => { setPart(item); setNotice(`${item.name} selected.`); }}>{item.sku}</button>)}</div>
        </div>
      </section>

      {cameraOpen && <div className="scan-camera-modal" role="dialog" aria-modal="true" aria-label="Company QR scanner"><div><video ref={videoRef} autoPlay playsInline muted /><span className="scan-reticle" /><p><strong>Company QR scanner</strong><br />Center the QR code in the frame</p><button onClick={closeCamera}>Cancel scan</button></div></div>}
      {notice && <div className="scan-notice" role="status">{notice}</div>}

      {part && <section className="scan-card scan-result">
        <div className="scan-part-icon">{part.category.slice(0, 1)}</div>
        <div className="scan-part-info"><span className="scan-eyebrow">{part.category}</span><h3>{part.name}</h3><p>{part.sku} · Barcode {part.barcode}</p><div className="scan-stock"><span><b>{inventory.truckStock[part.id] ?? 0}</b> on truck</span><span><b>{inventory.warehouseStock[part.id] ?? 0}</b> warehouse</span></div></div>
      </section>}

      {part && <section className="scan-card scan-action-card"><div className="scan-step">2</div><div className="scan-card-body"><h3>What are you doing?</h3>
        <div className="scan-actions">{ACTIONS.map((item) => <button key={item.id} className={action === item.id ? "active" : ""} onClick={() => setAction(item.id)}><strong>{item.label}</strong><span>{item.hint}</span></button>)}</div>
        {action === "work-order" && <label className="scan-field">Work order<select value={jobId} onChange={(e) => setJobId(e.target.value)}><option value="">Select work order</option>{activeJobs.map((job) => <option key={job.id} value={job.id}>{job.customer} — {job.description}</option>)}</select></label>}
        <label className="scan-field">{action === "count" ? "Counted quantity" : "Quantity"}<div className="scan-quantity"><button onClick={() => setQuantity((q) => Math.max(1, q - 1))}>−</button><input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} /><button onClick={() => setQuantity((q) => Number(q) + 1)}>+</button></div></label>
        <button className="scan-confirm" onClick={applyAction}>Confirm {ACTIONS.find((item) => item.id === action)?.label.toLowerCase()}</button>
      </div></section>}

      <section className="scan-summary">
        <div><span>Truck units</span><strong>{Object.values(inventory.truckStock).reduce((a, b) => a + b, 0)}</strong></div>
        <div><span>PO draft</span><strong>{inventory.purchaseOrderDraft.reduce((sum, line) => sum + line.quantity, 0)} items</strong></div>
        <div><span>Recent activity</span><strong>{inventory.scanActivity.length}</strong></div>
      </section>
      {inventory.scanActivity.length > 0 && <section className="scan-card scan-activity"><h3>Today’s scans</h3>{inventory.scanActivity.slice(0, 5).map((item) => <div key={item.id}><span className="scan-activity-mark">✓</span><span><b>{item.type}</b><small>{item.quantity} × {inventory.parts.find((p) => p.id === item.partId)?.name}</small></span><time>{new Date(item.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div>)}</section>}
    </div>
  );
}
