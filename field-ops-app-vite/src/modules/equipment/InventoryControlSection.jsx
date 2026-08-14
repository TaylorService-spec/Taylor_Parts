// Read-only Inventory-Control section for the Equipment detail page. PRESENTATIONAL only — it
// renders a pre-computed inventory-control view (from domain/equipmentInventoryControlAdapter.js)
// and holds no authority. It keeps the independent axes SEPARATE on the surface (baseline §7):
// inventory control, ownership/title, and availability are distinct rows, never collapsed. When
// the sale-close signal is not available (D-5 pending) the control state renders an honest UNKNOWN
// with the reason — matching the detail page's ethos of never presenting a not-yet-known as a fact.
import StatusPill from "../../shared/ui/StatusPill.jsx";
import { equipmentInventoryControlTone } from "../../domain/equipment";

const CONTROL_LABEL = {
  EXITED: "Inventory control ended",
  CONTROLLED: "Under Taylor inventory control",
  NOT_STARTED: "Not under Taylor inventory control",
  UNKNOWN: "Unknown",
};

const UNMET_LABEL = {
  INSTALLATION_INCOMPLETE: "Installation incomplete",
  SALE_OPEN: "Sale open",
};

export default function InventoryControlSection({ view }) {
  if (!view || typeof view !== "object") return null;
  const state = view.inventoryControl ?? "UNKNOWN";
  return (
    <section className="fo-panel" aria-labelledby="equip-inventory-control" data-inventory-control-section>
      <h2 id="equip-inventory-control">Inventory control</h2>
      <dl className="fo-detail-list">
        <dt>Status</dt>
        <dd>
          <StatusPill tone={equipmentInventoryControlTone(state)} label={CONTROL_LABEL[state] ?? "Unknown"} />
          {view.inventoryControlLabel ? <span className="fo-muted"> — {view.inventoryControlLabel}</span> : null}
        </dd>

        {Array.isArray(view.unmetConditions) && view.unmetConditions.length > 0 ? (
          <>
            <dt>Remaining to exit</dt>
            <dd>{view.unmetConditions.map((c) => UNMET_LABEL[c] ?? c).join(" · ")}</dd>
          </>
        ) : null}

        {/* Ownership/title is a SEPARATE axis — never inferred from inventory-control state. */}
        <dt>Ownership / title</dt>
        <dd>{view.ownershipTitle && view.ownershipTitle !== "UNKNOWN" ? view.ownershipTitle : <span className="fo-muted">Unknown (tracked separately from inventory control)</span>}</dd>

        {/* Availability is its own axis (INV-2): present ≠ available. */}
        <dt>Available for assignment</dt>
        <dd>{view.presentableAsAvailable ? "Yes" : <span className="fo-muted">No (committed / installed)</span>}</dd>
      </dl>

      {view.reason ? (
        <p className="fo-muted" data-inventory-control-reason>{view.reason}</p>
      ) : null}
    </section>
  );
}
