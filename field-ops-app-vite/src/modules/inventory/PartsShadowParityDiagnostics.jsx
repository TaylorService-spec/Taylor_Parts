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
import { statusLabel } from "../../shared/display/displayLabels.js";

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

  return (
    <div>
      <h2>Parts Shadow-Parity (Diagnostic — Non-Authoritative)</h2>
      <p className="fo-parity__hint">
        Read-only comparison of the canonical Part identity model against the current static-backed
        workspace model. Evidence only; changes no product behavior, is not persisted, and clears on refresh.
        Only a PASS result can qualify for Decision #44; FAIL/BLOCKED results are diagnostic evidence only.
      </p>
      <Button variant="primary" onClick={run} disabled={running} loading={running}>
        Run Shadow-Parity
      </Button>
      {v && v.invalid ? <p>Diagnostics unavailable (unrecognized result).</p> : null}
      {v && !v.invalid ? (
        <>
          {/* v.tone (background/color) comes from the domain module's TONE map
              (domain/partsShadowParityView.js, out of this migration's scope) and is a
              genuinely per-run value keyed off the diagnostic outcome -- left inline rather
              than duplicating that domain-owned color mapping into a second, driftable copy
              in index.css. Only the structural box (padding/border/radius/spacing) is a class. */}
          <div className="fo-parity__result-box" style={v.tone}>
            <strong>{v.tone.label}</strong>
            {v.reason ? <span> — {v.reason}</span> : null}
          </div>
          {/* Sanitized fields rendered for EVERY recognized result (— where absent). */}
          <ul className="fo-parity__list">
            <li className="fo-parity__cell" data-evidence-key="status">Status: {statusLabel(v.status)}</li>
            <li className="fo-parity__cell" data-evidence-key="capturedAtStart">Captured At Start: {m.capturedAtStart ?? "—"}</li>
            <li className="fo-parity__cell" data-evidence-key="capturedAtEnd">Captured At End: {m.capturedAtEnd ?? "—"}</li>
            <li className="fo-parity__cell" data-evidence-key="runId">Run ID: {m.runId ?? "—"}</li>
            <li className="fo-parity__cell" data-evidence-key="buildId">Build ID: {m.adapterCommit ?? "—"}</li>
            <li className="fo-parity__cell" data-evidence-key="staticCatalogHash">Static Catalog Hash: {m.staticCatalogHash ?? "—"}</li>
            <li className="fo-parity__cell" data-evidence-key="sourceCounts">Source Counts: {m.sourceCounts ? JSON.stringify(m.sourceCounts) : "—"}</li>
            <li className="fo-parity__cell" data-evidence-key="canonicalMatch">Canonical Match: {c.canonicalMatch ?? "—"}</li>
            <li className="fo-parity__cell" data-evidence-key="staticOnlyExcluded">Static-Only Excluded: {c.staticOnlyExcluded ?? "—"}</li>
            <li className="fo-parity__cell" data-evidence-key="rowMissing">Row Missing: {c.rowMissing ?? "—"}</li>
            <li className="fo-parity__cell" data-evidence-key="fieldDivergence">Field Divergence: {c.fieldDivergence ?? "—"}</li>
            <li className="fo-parity__cell" data-evidence-key="availabilityDivergence">Availability Divergence: {c.availabilityDivergence ?? "—"}</li>
            <li className="fo-parity__cell" data-evidence-key="workflowDivergence">Workflow Divergence: {c.workflowDivergence ?? "—"}</li>
            <li className="fo-parity__cell" data-evidence-key="unexpectedUnmatched">Unexpected Unmatched: {c.unexpectedUnmatched ?? "—"}</li>
            <li className="fo-parity__cell" data-evidence-key="structuralIssue">Structural Issue: {c.structuralIssue ?? "—"}</li>
          </ul>
          <Button variant="secondary" onClick={copyEvidence} className="fo-parity__copy-btn">
            Copy Sanitized Evidence
          </Button>
          {copied ? <span className="fo-parity__copied">Copied</span> : null}
        </>
      ) : null}
    </div>
  );
}
