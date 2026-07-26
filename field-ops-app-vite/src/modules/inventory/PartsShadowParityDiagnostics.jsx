// INV-CONVERGENCE-E Stage A -- admin/dispatcher-gated, NON-AUTHORITATIVE, read-only
// shadow-parity diagnostics surface. ISOLATED from PartsList and PartDetail (imports
// neither; neither imports this). Not wired into navigation in this unit -- placing it
// behind a diagnostics route is a separate, isolated step. Renders only the sanitized
// diagnostics view (counts/hashes/timestamps/summaries); never raw records, never a
// source consumers read from. Performs NO writes.
//
// Readers are dependency-injected (default: canonical + static). The ledger/reorder/PO
// live readers must be supplied by a later wiring step; until then they report
// unavailable and the run reports BLOCKED_INCOMPLETE_INPUT -- honest and safe.
import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { captureShadowParity } from "../../domain/partsShadowParityCapture";
import { toDiagnosticsView, isDiagnosticsAuthorized } from "../../domain/partsShadowParityView";
import { defaultReaders } from "./partsShadowParityReaders";

const box = { padding: 12, border: "1px solid #dadce0", borderRadius: 8, marginTop: 8 };

export default function PartsShadowParityDiagnostics({ readers }) {
  const { role } = useAuth();
  const authorized = isDiagnosticsAuthorized(role);
  const [state, setState] = useState({ phase: "loading" });

  useEffect(() => {
    if (!authorized) {
      setState({ phase: "denied" });
      return;
    }
    let cancelled = false;
    setState({ phase: "loading" });
    captureShadowParity(readers ?? defaultReaders()).then((result) => {
      if (!cancelled) setState({ phase: "ready", view: toDiagnosticsView(result) });
    });
    return () => {
      cancelled = true;
    };
  }, [authorized, readers]);

  if (state.phase === "denied") {
    return <p>Parts shadow-parity diagnostics are available to admin/dispatcher only.</p>;
  }
  if (state.phase === "loading") return <p>Running shadow-parity…</p>;

  const v = state.view;
  if (v.invalid) return <p>Diagnostics unavailable (unrecognized result).</p>;
  const c = v.counts;
  return (
    <div>
      <h2>Parts shadow-parity (diagnostic — non-authoritative)</h2>
      <p style={{ color: "#5f6368", fontSize: 13 }}>
        Read-only comparison of the canonical Part identity model against the current static-backed
        workspace model. Evidence only; changes no product behavior and is not persisted.
      </p>
      <div style={{ ...box, ...v.tone }}>
        <strong>{v.tone.label}</strong>
        {v.reason ? <span> — {v.reason}</span> : null}
      </div>
      {!v.isBlocked ? (
        <ul style={{ marginTop: 12 }}>
          <li>canonicalMatch: {c.canonicalMatch ?? "—"}</li>
          <li>staticOnlyExcluded: {c.staticOnlyExcluded ?? "—"}</li>
          <li>unexpectedUnmatched: {c.unexpectedUnmatched ?? "—"}</li>
          <li>nameDivergence: {c.nameDivergence ?? "—"}</li>
          <li>normalizedUnitDivergence: {c.normalizedUnitDivergence ?? "—"}</li>
          <li>provenanceIssue: {c.provenanceIssue ?? "—"}</li>
        </ul>
      ) : null}
      <p style={{ color: "#5f6368", fontSize: 12, fontFamily: "monospace" }}>
        run={v.meta.runId ?? "—"} · commit={v.meta.adapterCommit ?? "—"} · staticHash={v.meta.staticCatalogHash ?? "—"}
      </p>
    </div>
  );
}
