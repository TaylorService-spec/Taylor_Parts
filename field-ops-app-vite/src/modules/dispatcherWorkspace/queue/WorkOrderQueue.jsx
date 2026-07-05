import { useMemo } from "react";
import QueueHeader from "./QueueHeader";
import QueueRow from "./QueueRow";
import LoadingSkeleton from "../../../shared/ui/LoadingSkeleton";
import EmptyState from "../../../shared/ui/EmptyState";

// Stable sort (per this phase's performance requirement): priority
// ascending (1 = Emergency first), then createdAt ascending (older
// first) as the tiebreaker -- ties never reorder between renders,
// since Array.prototype.sort is stable in all engines this app targets
// and the comparator itself is deterministic (no random/index-based
// tiebreak).
function compareWorkOrders(a, b) {
  if (a.priority !== b.priority) return a.priority - b.priority;
  const aCreated = a.createdAt?.toMillis?.() ?? 0;
  const bCreated = b.createdAt?.toMillis?.() ?? 0;
  return aCreated - bCreated;
}

// Plain <table>/<tbody> today, but structured to be virtualization-ready
// (per this phase's requirement): each row is keyed by a stable
// workOrder.id and rendered by one component (QueueRow) with no
// index-dependent logic -- swapping this .map() for a windowing
// library's render-visible-rows callback later would not require
// restructuring QueueRow itself.
export default function WorkOrderQueue({ workOrders, loading, technicians, selectedId, onSelect, emptyMessage }) {
  const sorted = useMemo(() => [...workOrders].sort(compareWorkOrders), [workOrders]);

  if (loading) {
    return <LoadingSkeleton rows={6} columns={9} />;
  }

  if (sorted.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <table className="fo-table fo-queue-table">
      <QueueHeader />
      <tbody>
        {sorted.map((wo) => (
          <QueueRow
            key={wo.id}
            workOrder={wo}
            technicians={technicians}
            isSelected={wo.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </tbody>
    </table>
  );
}
