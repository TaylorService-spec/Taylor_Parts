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
import { toDiagnosticsView, isDiagnosticsAuthorized, runFailureView, sanitizedEvidencePayload } from "../../domain/partsShadowParityView";
import { defaultReaders } from "./partsShadowParityReaders";
import { Button } from "../../shared/ui/primitives/index.js";

const box = { padding: 12, border: "1px solid var(--color-border)", borderRadius: 8, marginTop: 8 };

export default function PartsShadowParityDiagnostics({ readers }) {
  const { role } = useAuth();
  const authorized = isDiagnosticsAuthorized(role);
  // phases: "idle" | "running" | "ready"; result ephemeral, reset on mount/refresh.
  const [state, setState] = useState({ phase: "idle" });
  const [copied, setCopied] = useState(false);
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
    setCopied(false);
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
  const m = v && !v.invalid ? v.meta : null;

  // Manual "Copy sanitized evidence": copies ONLY the sanitized payload built from the
  // view model (no write, no network, no download, no persistence, no secrets/records).
  // Unavailable before a result exists (button only rendered when a result is present).
  function copyEvidence() {
    const payload = sanitizedEvidencePayload(v);
    if (!payload) return;
    const text = JSON.stringify(payload, null, 2);
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => setCopied(false));
    }
  }

  const cell = { padding: "2px 0" };
  return (
    <div>
      <h2>Parts shadow-parity (diagnostic — non-authoritative)</h2>
      <p style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>
        Read-only comparison of the canonical Part identity model against the current static-backed
        workspace model. Evidence only; changes no product behavior, is not persisted, and clears on refresh.
        Only a PASS result can qualify for Decision #44; FAIL/BLOCKED results are diagnostic evidence only.
      </p>
      <Button variant="primary" onClick={run} disabled={running} loading={running}>
        Run shadow-parity
      </Button>
      {v && v.invalid ? <p>Diagnostics unavailable (unrecognized result).</p> : null}
      {v && !v.invalid ? (
        <>
          <div style={{ ...box, ...v.tone }}>
            <strong>{v.tone.label}</strong>
            {v.reason ? <span> — {v.reason}</span> : null}
          </div>
          {/* Sanitized fields rendered for EVERY recognized result (— where absent). */}
          <ul style={{ marginTop: 12, listStyle: "none", padding: 0, fontFamily: "monospace", fontSize: 13 }}>
            <li style={cell}>status: {v.status}</li>
            <li style={cell}>capturedAtStart: {m.capturedAtStart ?? "—"}</li>
            <li style={cell}>capturedAtEnd: {m.capturedAtEnd ?? "—"}</li>
            <li style={cell}>runId: {m.runId ?? "—"}</li>
            <li style={cell}>buildId: {m.adapterCommit ?? "—"}</li>
            <li style={cell}>staticCatalogHash: {m.staticCatalogHash ?? "—"}</li>
            <li style={cell}>sourceCounts: {m.sourceCounts ? JSON.stringify(m.sourceCounts) : "—"}</li>
            <li style={cell}>canonicalMatch: {c.canonicalMatch ?? "—"}</li>
            <li style={cell}>staticOnlyExcluded: {c.staticOnlyExcluded ?? "—"}</li>
            <li style={cell}>rowMissing: {c.rowMissing ?? "—"}</li>
            <li style={cell}>fieldDivergence: {c.fieldDivergence ?? "—"}</li>
            <li style={cell}>availabilityDivergence: {c.availabilityDivergence ?? "—"}</li>
            <li style={cell}>workflowDivergence: {c.workflowDivergence ?? "—"}</li>
            <li style={cell}>unexpectedUnmatched: {c.unexpectedUnmatched ?? "—"}</li>
            <li style={cell}>structuralIssue: {c.structuralIssue ?? "—"}</li>
          </ul>
          <Button variant="secondary" onClick={copyEvidence} style={{ marginTop: 8 }}>
            Copy sanitized evidence
          </Button>
          {copied ? <span style={{ marginLeft: 8, color: "var(--color-success)", fontSize: 12 }}>copied</span> : null}
        </>
      ) : null}
    </div>
  );
}
