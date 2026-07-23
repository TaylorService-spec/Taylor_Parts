// INV-1 Phase 1, PR 1.9 -- governed READ-ONLY Part Master management
// foundation (ADR-008 / Decision #40). Displays canonical Part records
// (admin/dispatcher, per the Tier 2 Rules posture). Deliberately contains
// NO write controls, NO edit/create/delete/activation actions, NO alias or
// supplier-item management, NO import execution -- mutation stays
// trusted-service-only. Renders only pre-validated view models from
// domain/partMasterView.js (malformed records surface as a count, never as
// raw objects). Reads no quantities: stock truth remains the ledger.
import { useEffect, useState } from "react";
import { fetchPartMasterList } from "../../services/partMasterQueries";

const STATUS_TONE = {
  ACTIVE: { background: "#e6f4ea", color: "#137333" },
  DRAFT: { background: "#e8eaed", color: "#3c4043" },
  INACTIVE: { background: "#fef7e0", color: "#b06000" },
  SUPERSEDED: { background: "#e8f0fe", color: "#1a56db" },
  DISCONTINUED: { background: "#fce8e6", color: "#c5221f" },
};

function StatusBadge({ status }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.DRAFT;
  return (
    <span style={{ ...tone, padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 600 }}>
      {status}
    </span>
  );
}

export default function PartMasterList() {
  const [state, setState] = useState({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchPartMasterList().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setState({ phase: result.code === "permission-denied" ? "denied" : "error" });
      } else {
        setState({ phase: "ready", parts: result.parts, invalidCount: result.invalid.length });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.phase === "loading") return <p>Loading Part Master…</p>;
  if (state.phase === "denied") {
    return <p>You do not have access to the Part Master. Contact an administrator if you believe this is an error.</p>;
  }
  if (state.phase === "error") return <p>The Part Master is currently unavailable. Try again later.</p>;
  if (state.parts.length === 0) {
    return (
      <div>
        <h2>Part Master</h2>
        <p>No canonical Part records exist yet. Parts are created through the governed trusted service only.</p>
      </div>
    );
  }
  return (
    <div>
      <h2>Part Master</h2>
      <p style={{ color: "#5f6368", fontSize: 13 }}>
        Read-only canonical part registry. Stock levels live in the inventory ledger; management actions are governed
        and not available from this screen.
        {state.invalidCount > 0 ? ` ${state.invalidCount} malformed record(s) were excluded and need review.` : ""}
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #dadce0" }}>
            <th style={{ padding: 8 }}>Part #</th>
            <th style={{ padding: 8 }}>Name</th>
            <th style={{ padding: 8 }}>Category</th>
            <th style={{ padding: 8 }}>Control</th>
            <th style={{ padding: 8 }}>Class</th>
            <th style={{ padding: 8 }}>Unit</th>
            <th style={{ padding: 8 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {state.parts.map((part) => (
            <tr key={part.partId} style={{ borderBottom: "1px solid #f1f3f4" }}>
              <td style={{ padding: 8, fontFamily: "monospace" }}>{part.internalPartNumber}</td>
              <td style={{ padding: 8 }}>{part.name}</td>
              <td style={{ padding: 8 }}>{part.category || "—"}</td>
              <td style={{ padding: 8 }}>{part.controlType}</td>
              <td style={{ padding: 8 }}>{part.stockingClass}</td>
              <td style={{ padding: 8 }}>{part.stockingUnit}</td>
              <td style={{ padding: 8 }}><StatusBadge status={part.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
