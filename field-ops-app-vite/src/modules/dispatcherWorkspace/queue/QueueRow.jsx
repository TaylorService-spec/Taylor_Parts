import { memo } from "react";
import { QUEUE_COLUMNS } from "./columns";

// Memoized per this phase's performance requirement: clicking a row to
// select it only re-renders the row that gained `isSelected` and the
// row that lost it, not all N rows in the queue (React.memo's default
// shallow prop comparison is enough here since `workOrder`/`technicians`
// only change reference when their actual data changes -- Firestore
// snapshot updates, not local UI state like search/filter selection).
//
// Priority stripe / status badge / planned-parts indicator are the
// "visual scanning" requirements (section 9). `scanningSlots` reserves
// layout space for future indicators (SLA warning, waiting on parts,
// warranty, signature pending, invoice pending) -- none of those have
// backing data yet (no such fields exist on WorkOrder), so this always
// renders empty today, but adding one later means adding an entry here,
// not restructuring the row.
const SCANNING_SLOTS = ["slaWarning", "waitingOnParts", "warranty", "signaturePending", "invoicePending"];

function QueueRow({ workOrder, technicians, isSelected, onSelect }) {
  return (
    <tr
      className={isSelected ? "fo-queue-row fo-queue-row-selected" : "fo-queue-row"}
      onClick={() => onSelect(workOrder.id)}
    >
      <td className={`fo-priority-stripe fo-priority-stripe-${workOrder.priority}`} aria-hidden="true" />
      {QUEUE_COLUMNS.map((col) => (
        <td key={col.key}>{col.render(workOrder, { technicians })}</td>
      ))}
      <td className="fo-scanning-slots">
        {SCANNING_SLOTS.map((slot) => (
          <span key={slot} className={`fo-scanning-slot fo-scanning-slot-${slot}`} />
        ))}
      </td>
    </tr>
  );
}

export default memo(QueueRow);
