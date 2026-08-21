import { useCallback, useEffect, useRef, useState } from "react";
import ScanInput from "../../shared/ui/ScanInput.jsx";
import DictatableNote from "../../shared/ui/DictatableNote.jsx";
import { Button } from "../../shared/ui/primitives/index.js";
import { returnCommandClient } from "../../services/returnCommandClient.js";
import { FEEDBACK } from "../../domain/scanInputPolicy.js";

// TAKING A RETURN IN -- recording what came back, and nothing more.
//
// ============================ WHAT THIS SCREEN DOES NOT DO ============================
//
// DECISIONS #118: returns intake and returns disposition are SEPARATE AUTHORITIES, and a return must
// never automatically restore inventory to sellable stock.
//
// So this screen records an ARRIVAL. It does not decide what happens next, and it deliberately
// offers no control that could imply otherwise -- no "return to stock", no "scrap", no condition that
// routes anywhere. Every return lands in one state, AWAITING_DISPOSITION, and waits for a decision
// this screen has no authority to make. The open questions behind that decision are packaged in
// docs/product/returns-disposition-decision-package.md.
//
// The screen says so out loud, because an operator handing back a good part reasonably assumes
// scanning it in puts it back on the shelf.
//
// ============================ CONDITION IS AN OBSERVATION, NOT A ROUTE ============================
//
// The condition list is the server's closed set, offered verbatim. UNKNOWN is a real choice meaning
// "nobody could tell" -- and it is NOT the default, because a default UNKNOWN turns "I did not look"
// and "I looked and could not tell" into the same record. An unrecognized value is refused by the
// command rather than coerced, which is why this is a select rather than a free-text field.
//
// ============================ IT WRITES NOTHING ELSE ============================
//
// One governed command, one document. No ledger event, no balance, no serialized-asset state change.
// A returned serialized unit does not become AVAILABLE here.

/** The server's closed set, mirrored verbatim. Adding one here without adding it there is refused. */
export const RETURN_CONDITIONS = Object.freeze([
  { value: "UNOPENED", label: "Unopened" },
  { value: "OPENED", label: "Opened" },
  { value: "DAMAGED", label: "Damaged" },
  { value: "UNKNOWN", label: "Cannot tell" },
]);

export const RETURN_SOURCES = Object.freeze([
  { value: "WORK_ORDER", label: "A work order" },
  { value: "CUSTOMER", label: "A customer" },
  { value: "TRUCK", label: "A truck" },
  { value: "SUPPLIER", label: "A supplier" },
  { value: "UNKNOWN", label: "Not known" },
]);

const newKey = () => `ret-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export default function ReturnIntakeScan({ deps }) {
  const client = deps?.returnClient ?? returnCommandClient;

  const [partId, setPartId] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [source, setSource] = useState("WORK_ORDER");
  const [sourceReference, setSourceReference] = useState("");
  const [condition, setCondition] = useState("");
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef(newKey());
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const scanPart = useCallback((raw) => {
    const value = String(raw ?? "").trim();
    if (value === "") return FEEDBACK.REJECTED;
    setPartId(value);
    setError(null);
    return FEEDBACK.ACCEPTED;
  }, []);

  const submit = useCallback(async () => {
    if (!partId || condition === "" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.recordReturnIntake({
        partId,
        source,
        // Only sent when there is something to say. An empty reference is not a fact worth storing.
        ...(sourceReference.trim() ? { sourceReference: sourceReference.trim() } : {}),
        condition,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        quantity,
        idempotencyKey: keyRef.current,
      });
      if (!alive.current) return;
      setOutcome(result);
    } catch (err) {
      if (!alive.current) return;
      const raw = typeof err?.code === "string" ? err.code : "";
      const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : (raw || "internal");
      setError(
        code === "permission-denied"
          ? "You are not authorized to take returns in. That authority has not been granted, or is not switched on here."
          : code === "invalid-argument"
            ? "That return could not be accepted — check the part and the condition."
            : "That return could not be recorded. Nothing was changed.",
      );
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [partId, condition, busy, client, source, sourceReference, reason, quantity]);

  const startAnother = useCallback(() => {
    // A NEW key: the next return is a different event, and reusing the key would replay the last one.
    keyRef.current = newKey();
    setPartId(null); setQuantity(1); setSourceReference(""); setCondition(""); setReason("");
    setOutcome(null); setError(null);
  }, []);

  if (outcome) {
    return (
      <div className="fo-returns">
        <p className="fo-scan__notice fo-scan__notice--ok" role="status">
          ✓ Recorded — {outcome.quantity ?? quantity} × {outcome.partId ?? partId} came back.
          {" "}
          {/* Said plainly. Handing a good part back feels like restocking it, and it is not. */}
          It is <strong>awaiting a disposition decision</strong> and has <strong>not</strong> gone back
          into sellable stock. Stock counts are unchanged.
        </p>
        <Button type="button" variant="primary" onClick={startAnother}>Take another return</Button>
      </div>
    );
  }

  return (
    <div className="fo-returns">
      <p className="fo-scan__plan">
        This records what came back. It does not decide what happens to it, and it does not put
        anything back into sellable stock.
      </p>

      {!partId ? (
        <>
          <p className="fo-muted">Scan the part that came back.</p>
          <ScanInput onScan={scanPart} label="Scan returned part" placeholder="Scan or type a part code" deps={deps?.scanInputDeps} />
        </>
      ) : (
        <>
          <section className="fo-scan__result" aria-label={`Return ${partId}`}>
            <p className="fo-scan__kind">Returned</p>
            <h3 className="fo-scan__id">{partId}</h3>
          </section>

          <div className="fo-scan__qty" role="group" aria-label="How many came back">
            <Button type="button" variant="secondary" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Fewer">−</Button>
            <span aria-live="polite">{quantity}</span>
            <Button type="button" variant="secondary" onClick={() => setQuantity((q) => q + 1)} aria-label="More">+</Button>
          </div>

          <label className="fo-returns__field">
            <span>Where did it come from?</span>
            <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Where did it come from">
              {RETURN_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>

          <label className="fo-returns__field">
            <span>Reference <span className="fo-muted">(optional)</span></span>
            <input
              value={sourceReference}
              onChange={(e) => setSourceReference(e.target.value)}
              aria-label="Reference"
              placeholder="Work order or RMA number"
              autoComplete="off"
            />
          </label>

          {/* NO DEFAULT. A pre-selected condition is a condition nobody observed. */}
          <label className="fo-returns__field">
            <span>What condition is it in?</span>
            <select value={condition} onChange={(e) => setCondition(e.target.value)} aria-label="What condition is it in">
              <option value="">Choose…</option>
              {RETURN_CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>

          <DictatableNote
            value={reason}
            onChange={setReason}
            label="Why did it come back?"
            placeholder="Type it, or press Speak and read it back"
            deps={deps?.dictation}
          />

          {error && <p className="fo-scan__notice fo-scan__notice--warn" role="alert">{error}</p>}

          <Button type="button" variant="primary" className="fo-returns__submit" onClick={submit} disabled={condition === "" || busy}>
            {busy ? "Recording…" : "Record this return"}
          </Button>
          {condition === "" && (
            <p className="fo-scan__reason">Choose a condition before recording. It is an observation, so nobody can choose it for you.</p>
          )}
        </>
      )}
    </div>
  );
}
