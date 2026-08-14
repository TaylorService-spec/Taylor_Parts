// Truck Inventory — the fleet peer-object card. Reference adopter of the shared
// shared/ui/OperationalCard.jsx primitive (Wave 4): each truck is a peer object in a
// browseable collection (the legitimate card use), so it carries only PRESENTATION — the
// parent owns selection, filtering, and every governed gate. Status chrome routes through
// StatusPill + the truck domain's tone maps so a truck's state reads identically to the same
// semantic state on any other surface. Preserves Wave 1's exact information density (id,
// status, technician/location, Value/Serialized/Parts/Discrepancies, last-reconciled note) —
// only the chrome moved to the shared primitive.
import OperationalCard from "../../shared/ui/OperationalCard.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import { truckFleetStatusTone, truckDiscrepancyTone } from "../../domain/truckInventoryView";

const dash = (v) => (v == null ? "—" : v);

export default function TruckFleetCard({ truck, onOpen }) {
  const t = truck;
  const status = t.status;
  const discrepancies = t.metrics.discrepancies;

  return (
    <OperationalCard
      title={t.id}
      status={
        status == null
          ? { tone: "unknown", asText: true, label: "Unavailable" }
          : { tone: truckFleetStatusTone(status), label: status }
      }
      subtitle={`${t.technician || "Unassigned"}${t.location ? ` · ${t.location}` : ""}`}
      metadata={[
        { key: "value", label: "Value", value: dash(t.metrics.inventoryValue) },
        { key: "serialized", label: "Serialized", value: dash(t.metrics.serializedCount) },
        { key: "parts", label: "Parts", value: dash(t.metrics.partsCount) },
        {
          key: "discrepancies",
          label: "Discrepancies",
          value: discrepancies == null ? "—" : (
            <StatusPill tone={truckDiscrepancyTone(discrepancies)} label={String(discrepancies)} />
          ),
        },
      ]}
      footer={`Reconciled ${dash(t.metrics.lastReconciliation)}`}
      onSelect={onOpen}
    />
  );
}
