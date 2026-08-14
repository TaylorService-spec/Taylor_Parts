// Truck Inventory — the ONE fleet peer-object card (Wave-1 composition).
//
// A card is the CORRECT primitive here: each truck is a peer object in a browseable collection (the
// legitimate card use, as opposed to a card standing in for a page/section wrapper). It carries only
// PRESENTATION — the parent owns selection, filtering, and every governed gate. Status chrome routes
// through the shared StatusPill + the truck domain's tone maps so a truck's state reads identically to
// the same semantic state on any other surface.
import StatusPill from "../../shared/ui/StatusPill.jsx";
import { truckFleetStatusTone, truckDiscrepancyTone } from "../../domain/truckInventoryView";

const dash = (v) => (v == null ? "—" : v);

export default function TruckFleetCard({ truck, onOpen }) {
  const t = truck;
  const status = t.status;
  const discrepancies = t.metrics.discrepancies;
  return (
    <button type="button" className="fo-card fo-card--peer" onClick={onOpen}>
      <div className="fo-card__head">
        <b>{t.id}</b>
        {/* An ungoverned/absent status is "Unavailable" text, never a coloured pill (unknown tone). */}
        {status == null ? (
          <StatusPill tone="unknown" asText label="Unavailable" />
        ) : (
          <StatusPill tone={truckFleetStatusTone(status)} label={status} />
        )}
      </div>
      <div className="fo-muted">
        {t.technician || "Unassigned"}
        {t.location ? ` · ${t.location}` : ""}
      </div>
      <dl className="fo-card__metrics">
        <div><dt className="fo-muted">Value</dt><dd>{dash(t.metrics.inventoryValue)}</dd></div>
        <div><dt className="fo-muted">Serialized</dt><dd>{dash(t.metrics.serializedCount)}</dd></div>
        <div><dt className="fo-muted">Parts</dt><dd>{dash(t.metrics.partsCount)}</dd></div>
        <div>
          <dt className="fo-muted">Discrepancies</dt>
          <dd>
            {discrepancies == null ? "—" : (
              <StatusPill tone={truckDiscrepancyTone(discrepancies)} label={String(discrepancies)} />
            )}
          </dd>
        </div>
      </dl>
      <div className="fo-muted fo-card__foot">Reconciled {dash(t.metrics.lastReconciliation)}</div>
    </button>
  );
}
