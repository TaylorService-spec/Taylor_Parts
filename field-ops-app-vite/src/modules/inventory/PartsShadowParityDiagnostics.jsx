// INV-CONVERGENCE-E Stage A -- admin/dispatcher-gated, NON-AUTHORITATIVE, read-only
// shadow-parity diagnostics surface. ISOLATED from PartsList and PartDetail (imports
// neither; neither imports this). Reached only via the dedicated operator-only route
// `/admin/diagnostics/inventory-parts-parity` (no ordinary Inventory nav entry).
// Renders only the sanitized diagnostics view (counts/hashes/timestamps/summaries);
// never raw records, never a source consumers read from. Performs NO writes.
//
// Execution: MANUAL start; only ONE run active at a time (the button is disabled and
// repeat clicks are ignored while running); the result is ephemeral in memory and a
// refresh clears it (no background execution, no persistence, no Firestore write).
import { useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { captureShadowParity } from "../../domain/partsShadowParityCapture";
import { toDiagnosticsView, isDiagnosticsAuthorized, runFailureView } from "../../domain/partsShadowParityView";
import { defaultReaders } from "./partsShadowParityReaders";

const box = { padding: 12, border: "1px solid #dadce0", borderRadius: 8, marginTop: 8 };

export default function PartsShadowParityDiagnostics({ readers }) {
  const { role } = useAuth();
  const authorized = isDiagnosticsAuthorized(role);
  // phases: "idle" | "running" | "ready"; result ephemeral, reset on mount/refresh.
  const [state, setState] = useState({ phase: "idle" });
  // One reader bundle per mount (stable across re-renders and across runs) so the
  // run-ID sequence persists and each execution gets a distinct run id.
  const readersRef = useRef(null);
  if (readersRef.current === null) readersRef.current = readers ?? defaultReaders();

  // Standard No Access state for unauthorized sessions -- real gate, not obscurity.
  if (!authorized) {
    return <p>Parts shadow-parity diagnostics are available to admin/dispatcher only.</p>;
  }

  const running = state.phase === "running";
  function run() {
    if (running) return; // single active run: ignore repeat clicks while in flight
    setState({ phase: "running" });
    captureShadowParity(readersRef.current)
      .then((result) => {
        setState({ phase: "ready", view: toDiagnosticsView(result) });
      })
      .catch(() => {
        // Unexpected rejection: leave running, show a sanitized blocked/unavailable state
        // (no raw error/stack/credentials/records), keep Run enabled for a later retry.
        setState({ phase: "ready", view: runFailureView() });
      });
  }

  const v = state.phase === "ready" ? state.view : null;
  const c = v && !v.invalid ? v.counts : null;
  return (
    <div>
      <h2>Parts shadow-parity (diagnostic — non-authoritative)</h2>
      <p style={{ color: "#5f6368", fontSize: 13 }}>
        Read-only comparison of the canonical Part identity model against the current static-backed
        workspace model. Evidence only; changes no product behavior, is not persisted, and clears on refresh.
      </p>
      <button type="button" onClick={run} disabled={running}>
        {running ? "Running…" : "Run shadow-parity"}
      </button>
      {v && v.invalid ? <p>Diagnostics unavailable (unrecognized result).</p> : null}
      {v && !v.invalid ? (
        <>
          <div style={{ ...box, ...v.tone }}>
            <strong>{v.tone.label}</strong>
            {v.reason ? <span> — {v.reason}</span> : null}
          </div>
          {!v.isBlocked ? (
            <ul style={{ marginTop: 12 }}>
              <li>canonicalMatch: {c.canonicalMatch ?? "—"}</li>
              <li>staticOnlyExcluded: {c.staticOnlyExcluded ?? "—"}</li>
              <li>current↔shadow rowMissing: {c.rowMissing ?? "—"}</li>
              <li>current↔shadow fieldDivergence: {c.fieldDivergence ?? "—"}</li>
              <li>current↔shadow availabilityDivergence: {c.availabilityDivergence ?? "—"}</li>
              <li>current↔shadow workflowDivergence: {c.workflowDivergence ?? "—"}</li>
              <li>unexpectedUnmatched: {c.unexpectedUnmatched ?? "—"}</li>
              <li>structuralIssue: {c.structuralIssue ?? "—"}</li>
            </ul>
          ) : null}
          <p style={{ color: "#5f6368", fontSize: 12, fontFamily: "monospace" }}>
            run={v.meta.runId ?? "—"} · commit={v.meta.adapterCommit ?? "—"} · staticHash={v.meta.staticCatalogHash ?? "—"}
          </p>
        </>
      ) : null}
    </div>
  );
}
