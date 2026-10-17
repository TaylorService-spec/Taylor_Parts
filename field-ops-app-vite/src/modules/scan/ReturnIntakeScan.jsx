import { useCallback, useEffect, useRef, useState } from "react";
import ScanInput from "../../shared/ui/ScanInput.jsx";
import DictatableNote from "../../shared/ui/DictatableNote.jsx";
import { Button } from "../../shared/ui/primitives/index.js";
import { returnCommandClient } from "../../services/returnCommandClient.js";
import { FEEDBACK } from "../../domain/scanInputPolicy.js";
import { useWarehouseSubmit, WAREHOUSE_SUBMIT, PENDING_TEXT, NOT_DURABLE_TEXT } from "../../offline/useWarehouseSubmit.js";
import { captureReturnIntake } from "../../offline/warehouseIntent.js";

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
// One governed command, one record. No ledger event, no balance, no serialized-asset state change.
// A returned serialized unit does not become AVAILABLE here.
//
// ============================ ON EOS CORE (Firebase exit F7a, DECISIONS #242) ============================
//
// The command is EOS's recordReturnIntake (POST /operations/inventory). By Owner ruling a return names its OPERATING
// COMPANY (required) and may name its receiving WAREHOUSE. The choices offered are the server's own answer
// (listReturnIntakeOptions: the caller's companies, and the warehouses in reach for each); with one company it is chosen
// for them, with several nobody guesses. The server re-checks both on every call.

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

// OFFLINE INTAKE KEEPS WORKING. The last options the SERVER gave THIS USER on this device are kept, and used only when the
// options read cannot reach the server (`unavailable`). It never bypasses authorization: nothing is decided here, and a
// queued intake replays through recordReturnIntake, which re-checks the capability, the company and the warehouse. A
// refusal is never answered from the cache.
//
// ISOLATION (Lane D / Owner, #2133): the entry is keyed by the STABLE signed-in identity (deps.cacheOwner = identity source
// + subject) and carries the tenant and Principal the SERVER resolved for that answer; it is used only when its owner
// matches and both are recorded. With no identity nothing is cached or read. Older shared entries (v1, keyed by nothing;
// v2, keyed by subject alone) are deleted on sight and never read.
const OPTIONS_CACHE_PREFIX = "eos.returnIntake.options.v3:";
const RETIRED_CACHE_KEYS = (storage) => Object.keys(storage).filter((k) => k === "eos.returnIntake.options.v1" || k.startsWith("eos.returnIntake.options.v2:"));
const forgetRetiredCaches = () => {
  try { const s = globalThis.localStorage; if (s) for (const k of RETIRED_CACHE_KEYS(s)) s.removeItem(k); } catch { /* best effort */ }
};
const cacheOptions = (owner, value) => {
  if (!owner || typeof value.tenantId !== "string" || typeof value.principalId !== "string") return;
  try {
    globalThis.localStorage?.setItem(OPTIONS_CACHE_PREFIX + owner, JSON.stringify({
      owner, tenantId: value.tenantId, principalId: value.principalId, companies: value.companies, warehouses: value.warehouses,
    }));
  } catch { /* best effort */ }
};
const cachedOptions = (owner) => {
  if (!owner) return null;
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(OPTIONS_CACHE_PREFIX + owner) ?? "null");
    return v && v.owner === owner && typeof v.tenantId === "string" && typeof v.principalId === "string"
      && Array.isArray(v.companies) && Array.isArray(v.warehouses)
      ? { companies: v.companies, warehouses: v.warehouses } : null;
  } catch { return null; }
};

/** The refusal, in words. `details.code` is the server's own (EosOperationError). */
function refusalText(rawCode, detailCode) {
  // An offline replay's refusal may still carry the SDK's "functions/" prefix; the meaning is the same.
  const code = typeof rawCode === "string" && rawCode.startsWith("functions/") ? rawCode.slice("functions/".length) : rawCode;
  if (code === "permission-denied") {
    return detailCode === "COMPANY_AUTHORITY_REQUIRED"
      ? "You have no operating company to take returns in for. Ask an administrator."
      : "You are not authorized to take returns in. That authority has not been granted, or is not switched on here.";
  }
  if (code === "invalid-argument") {
    return detailCode === "OPERATING_COMPANY_NOT_GOVERNED"
      ? "That company is not one you can take returns in for."
      : "That return could not be accepted — check the part and the condition.";
  }
  if (code === "not-found") return "That receiving warehouse is not available for that company.";
  return "That return could not be recorded. Nothing was changed.";
}

export default function ReturnIntakeScan({ deps }) {
  const client = deps?.returnClient ?? returnCommandClient;
  const cacheOwner = typeof deps?.cacheOwner === "string" && deps.cacheOwner !== "" ? deps.cacheOwner : null;
  // ONE submit policy. Intake only -- there is no disposition to queue because there is none at all.
  const warehouse = useWarehouseSubmit({ offline: deps?.offline });

  // The server's answer to "which company, which warehouse" -- never a list made up here.
  const [options, setOptions] = useState({ state: "loading", companies: [], warehouses: [], error: null });
  const [companyId, setCompanyId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
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
  // StrictMode note: a phantom cleanup-then-remount at initial mount must restore true here, or
  // this flag lies "dead" for the component's whole real lifetime and silently discards every
  // later async result (a live, reproduced bug -- see the Cycle Count North Star P1 PR history).
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    let cancelled = false;
    forgetRetiredCaches();
    Promise.resolve()
      .then(() => client.listReturnIntakeOptions())
      .then((r) => {
        const value = { companies: Array.isArray(r?.companies) ? r.companies : [], warehouses: Array.isArray(r?.warehouses) ? r.warehouses : [] };
        cacheOptions(cacheOwner, { ...value, tenantId: r?.tenantId, principalId: r?.principalId });
        return value;
      })
      .catch((err) => {
        const raw = typeof err?.code === "string" ? err.code : "";
        const cached = raw === "unavailable" ? cachedOptions(cacheOwner) : null;
        if (cached) return cached;
        throw err;
      })
      .then((value) => {
        if (cancelled) return;
        setOptions({ state: "ready", ...value, error: null });
        if (value.companies.length === 1) setCompanyId(value.companies[0].operatingCompanyId);
      })
      .catch((err) => {
        if (cancelled) return;
        const raw = typeof err?.code === "string" ? err.code : "";
        setOptions({ state: "failed", companies: [], warehouses: [], error: refusalText(raw || "internal", err?.details?.code) });
      });
    return () => { cancelled = true; };
  }, [client, cacheOwner]);

  const scanPart = useCallback((raw) => {
    const value = String(raw ?? "").trim();
    if (value === "") return FEEDBACK.REJECTED;
    setPartId(value);
    setError(null);
    return FEEDBACK.ACCEPTED;
  }, []);

  const submit = useCallback(async () => {
    if (!partId || condition === "" || companyId === "" || busy) return;
    setBusy(true);
    setError(null);
    const request = {
      operatingCompanyId: companyId,
      ...(warehouseId ? { warehouseId } : {}),
      partId,
      source,
      // Only sent when there is something to say. An empty reference is not a fact worth storing.
      ...(sourceReference.trim() ? { sourceReference: sourceReference.trim() } : {}),
      condition,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
      quantity,
      idempotencyKey: keyRef.current,
    };
    // The shared policy carries back `serverIds` only, so the command's full response is kept here.
    let serverResponse = null;
    try {
      const submitted = await warehouse.submit(
        async () => {
          const result = await client.recordReturnIntake(request);
          serverResponse = result;
          return { ok: true, serverIds: { returnId: result?.returnId ?? null } };
        },
        // INTAKE ONLY, offline as online. Nothing in this capture restocks, disposes, credits,
        // repairs or scraps -- those authorities do not exist.
        (wasOffline) => captureReturnIntake({
          principalUid: deps?.offline?.principalUid ?? "self",
          sourceId: source, partId, quantity, condition,
          notes: reason.trim() || null,
          // The replay sends EXACTLY what the online attempt sent, under the same key.
          request,
          captureKey: keyRef.current, at: Date.now(), offline: wasOffline,
        }),
      );
      if (!alive.current) return;

      if (submitted?.result === WAREHOUSE_SUBMIT.SENT) {
        setOutcome(serverResponse ?? { returnId: submitted.serverIds?.returnId ?? null });
      } else if (submitted?.result === WAREHOUSE_SUBMIT.QUEUED) {
        // PENDING, and explicitly NOT restocked -- taking a return in never restores stock.
        setOutcome({ queued: true, pendingText: PENDING_TEXT.RETURN_INTAKE });
      } else if (submitted?.result === WAREHOUSE_SUBMIT.QUEUED_NOT_DURABLE) {
        setError(NOT_DURABLE_TEXT);
      } else {
        const raw = typeof submitted?.error?.code === "string" ? submitted.error.code : "";
        setError(refusalText(raw || "internal", submitted?.error?.details?.code));
      }
    } catch (err) {
      if (!alive.current) return;
      const raw = typeof err?.code === "string" ? err.code : "";
      setError(refusalText(raw || "internal", err?.details?.code));
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [partId, condition, companyId, warehouseId, busy, client, source, sourceReference, reason, quantity]);

  const startAnother = useCallback(() => {
    // A NEW key: the next return is a different event, and reusing the key would replay the last one.
    keyRef.current = newKey();
    setPartId(null); setQuantity(1); setSourceReference(""); setCondition(""); setReason("");
    setOutcome(null); setError(null);
  }, []);

  // HELD, NOT RECORDED. Its own branch, above the recorded one, because "✓ Recorded" is a statement
  // about the platform and the platform has not seen this.
  if (outcome?.queued) {
    return (
      <div className="fo-returns">
        <p className="fo-scan__notice fo-scan__notice--pending" role="status">{outcome.pendingText}</p>
        <Button type="button" variant="primary" onClick={startAnother}>Take Another Return</Button>
      </div>
    );
  }

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
        <Button type="button" variant="primary" onClick={startAnother}>Take Another Return</Button>
      </div>
    );
  }

  return (
    <div className="fo-returns">
      <p className="fo-scan__plan">
        This records what came back. It does not decide what happens to it, and it does not put
        anything back into sellable stock.
      </p>

      {options.state === "loading" && <p className="fo-muted" role="status">Loading your companies…</p>}
      {options.state === "failed" && <p className="fo-scan__notice fo-scan__notice--warn" role="alert">{options.error}</p>}
      {options.state === "ready" && (
        <>
          <label className="fo-returns__field">
            <span>Which company is taking it in?</span>
            <select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setWarehouseId(""); }} aria-label="Which company is taking it in">
              {options.companies.length !== 1 && <option value="">Choose…</option>}
              {options.companies.map((c) => (
                <option key={c.operatingCompanyId} value={c.operatingCompanyId}>{c.operatingCompanyKey ?? c.operatingCompanyId}</option>
              ))}
            </select>
          </label>
          <label className="fo-returns__field">
            <span>Receiving warehouse <span className="fo-muted">(Optional)</span></span>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-label="Receiving warehouse" disabled={companyId === ""}>
              <option value="">Not stated</option>
              {options.warehouses.filter((w) => w.operatingCompanyId === companyId).map((w) => (
                <option key={w.warehouseId} value={w.warehouseId}>{w.name}</option>
              ))}
            </select>
          </label>
        </>
      )}

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
            <span>Reference <span className="fo-muted">(Optional)</span></span>
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

          <Button type="button" variant="primary" className="fo-returns__submit" onClick={submit} disabled={condition === "" || companyId === "" || busy}>
            {busy ? "Recording…" : "Record This Return"}
          </Button>
          {condition === "" && (
            <p className="fo-scan__reason">Choose a condition before recording. It is an observation, so nobody can choose it for you.</p>
          )}
          {condition !== "" && companyId === "" && options.state === "ready" && (
            <p className="fo-scan__reason">Choose the company taking it in before recording.</p>
          )}
        </>
      )}
    </div>
  );
}
