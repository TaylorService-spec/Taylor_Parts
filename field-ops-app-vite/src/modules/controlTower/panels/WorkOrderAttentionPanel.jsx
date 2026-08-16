import { Link } from "react-router-dom";
import StatusPill from "../../../shared/ui/StatusPill.jsx";
import {
  WO_ATTENTION_TYPE,
  workOrderAttentionItems,
  groupWorkOrderAttentionItemsBySection,
} from "../../../domain/workOrderAttentionProjection";

// Wave 7 extension, PART 5 -- the WO / Dispatch Attention Panel, mirroring NotificationPanel.jsx's
// transitional-bell role for Parts: a purely presentational consumer of
// domain/workOrderAttentionProjection.js's normalized Attention Items. This panel computes NOTHING --
// it calls the domain projection over the same { workOrders, technicians } snapshot ControlTower already
// owns and renders the result, matching every other panel in this directory (AtRiskPanel /
// DispatchQueuePanel / OverloadedTechPanel): "No panel may inline scoring/derivation logic."
//
// `partsReadinessByWorkOrderId` is optional and defaults to {} -- ControlTower does not yet read the
// per-part warehouse/truck/procurement dimensions workOrderPartsReadiness.js needs (that would be a new,
// separate Firestore-read integration, out of this slice's scope), so the "Parts Blocked" section is
// honestly empty until a caller wires that data in. This is the SAME "capability not enabled -> honest
// degradation, never a fabricated result" pattern workOrderPartsReadiness.js itself uses for
// truckInventory -- not a bug, a documented boundary.
//
// `technicianName` mirrors ControlTower.jsx's own existing resolver (`technicians.find(t => t.id ===
// id)?.name || id`) -- these are Technician collection docs with a plain `name` field, NOT Firebase auth
// uids, so this is not the F-UID-1 "raw uid" case domain/actorDisplayName.js guards against. A technician
// id that resolves to nothing still falls back to a labeled placeholder, never a bare id string.
function technicianLabel(techId, technicians) {
  if (!techId) return null;
  const match = technicians.find((t) => t.id === techId);
  return match?.name || "Unassigned technician";
}

function AttentionRow({ item, technicians }) {
  return (
    <Link to={item.deepLink} className="work-order-card" style={{ display: "block" }}>
      <h3 style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        {item.woNumber}
        {item.attentionType === WO_ATTENTION_TYPE.ACTION_ITEM ? (
          <StatusPill tone="attention" label="Action needed" />
        ) : (
          <StatusPill tone="info" label="In progress" />
        )}
      </h3>
      {item.techId ? <div className="fo-muted">{`Technician: ${technicianLabel(item.techId, technicians)}`}</div> : null}
    </Link>
  );
}

export default function WorkOrderAttentionPanel({ workOrders = [], technicians = [], partsReadinessByWorkOrderId = {} }) {
  const items = workOrderAttentionItems({ workOrders, partsReadinessByWorkOrderId });
  const sections = groupWorkOrderAttentionItemsBySection(items);
  const total = items.length;

  return (
    <div className="tech-overview tech-overview--compact">
      <h3>Work Order Attention{total > 0 ? ` (${total})` : ""}</h3>
      {total === 0 ? (
        <p className="fo-muted">No work orders need attention.</p>
      ) : (
        sections.map((section) => (
          <div key={section.sectionLabel}>
            <p className="fo-notification-panel-section">{section.sectionLabel}</p>
            {section.items.map((item) => (
              <AttentionRow key={item.attentionItemId} item={item} technicians={technicians} />
            ))}
          </div>
        ))
      )}
    </div>
  );
}
