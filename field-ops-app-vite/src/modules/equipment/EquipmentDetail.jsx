import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useEquipmentDoc, useWorkOrdersForEquipment } from "../../hooks/useEquipment";
import { useAccount } from "../../hooks/useAccount";
import { useLocationsForAccount } from "../../hooks/useLocationsForAccount";
import {
  equipmentDisplayName,
  equipmentSummary,
  equipmentServiceHistory,
  groupServiceHistoryByYear,
  isRetired,
} from "../../domain/equipment";
import { trustedActionUnavailable } from "../../domain/equipment";
import LoadingState from "../../shared/ui/LoadingState";
import EmptyState from "../../shared/ui/EmptyState";
import FailureState from "../../shared/ui/FailureState";
import { EQUIPMENT_STATUS } from "../../domain/constants";

// Issue #232 unit E7 -- the Equipment detail page (Spec §8), route /equipment/:equipmentId.
//
// Every read is bounded: one document subscription for the asset, one equipmentId-scoped
// query for its Work Orders, and the Account/Locations lookups the register already
// uses. Service History is DERIVED from those Work Orders (§10) -- there is no separate
// ledger -- and is shaped purely, client-side, by the E1 helpers over that already
// bounded set. No per-record query loop.
//
// LIFECYCLE ACTIONS ARE PRESENT BUT UNAVAILABLE, deliberately. Move / retire /
// reactivate are trusted-writer actions gated on Issue #15 (Functions undeployed), and
// E2's seam reports that rather than pretending. Showing them disabled with the real
// reason is the honest rendering: hiding them would imply the asset cannot be moved or
// retired at all, and enabling them would promise a write nothing can perform. Edit is
// E8's; it is not stubbed here.

const STATUS_LABEL = {
  [EQUIPMENT_STATUS.ACTIVE]: "Active",
  [EQUIPMENT_STATUS.INACTIVE]: "Inactive",
  [EQUIPMENT_STATUS.RETIRED]: "Retired",
};

export default function EquipmentDetail() {
  const { equipmentId } = useParams();
  const navigate = useNavigate();
  const { equipment, loading, error } = useEquipmentDoc(equipmentId);
  const { data: workOrders, error: woError } = useWorkOrdersForEquipment(equipmentId);
  const { account } = useAccount(equipment?.accountId ?? null);
  const { data: locations } = useLocationsForAccount(equipment?.accountId ?? null);

  const history = useMemo(
    () => groupServiceHistoryByYear(equipmentServiceHistory(workOrders, equipmentId)),
    [workOrders, equipmentId]
  );

  const backToRegister = (
    <button type="button" onClick={() => navigate("/equipment")}>Back to Equipment</button>
  );

  if (loading) {
    return <div className="fo-panel"><LoadingState>Loading equipment…</LoadingState></div>;
  }

  // A read FAILURE and a NOT-FOUND are different facts and §9 requires they stay
  // distinguishable: one means we could not look, the other means we looked and it is
  // not there. Reporting a denied read as "not found" would tell the user the asset
  // does not exist when it may simply not be theirs to see.
  if (error) {
    return <div className="fo-panel"><FailureState message={error} action={backToRegister} /></div>;
  }

  if (!equipment) {
    return (
      <div className="fo-panel">
        <FailureState message="This equipment could not be found." action={backToRegister} />
      </div>
    );
  }

  const locationName = locations.find((l) => l.id === equipment.locationId)?.name ?? "Unknown location";
  const retired = isRetired(equipment);
  // One shared reason string, from the same seam the buttons would call -- so the copy
  // a user reads cannot drift from what the action would actually do.
  const unavailableReason = trustedActionUnavailable("equipment.move").message;

  return (
    <section className="fo-workspace fo-equipment-detail">
      {/* Safe Back: a real route, never history.back() -- a direct link or a refresh
          must land somewhere sensible rather than leaving the app. */}
      <Link to="/equipment" className="fo-back-link">&larr; Back to Equipment</Link>

      {/* §8 identity + status. The display name is the human reference; the id is never
          rendered as one (§8), though it is legitimately in the URL. */}
      <header className="fo-detail-header">
        <h1 className="fo-equipment-title">{equipmentDisplayName(equipment)}</h1>
        <span
          className={`fo-badge fo-badge-equipment-${String(equipment.status ?? "").toLowerCase()}`}
          data-equipment-status={equipment.status ?? ""}
        >
          {STATUS_LABEL[equipment.status] ?? "Unknown"}
        </span>
        <p className="fo-muted fo-equipment-subtitle">{equipmentSummary(equipment)}</p>
      </header>

      <div className="fo-detail-grid">
        {/* §8 Account + installed Location. Both render their NAME; an unresolved
            reference says so rather than exposing the raw id. */}
        <section className="fo-panel" aria-labelledby="equip-where">
          <h2 id="equip-where">Customer &amp; location</h2>
          <dl className="fo-detail-list">
            <dt>Customer</dt>
            <dd data-equipment-account>
              {account ? (
                <Link to={`/customers/${equipment.accountId}`}>{account.name}</Link>
              ) : (
                <span className="fo-muted">Unknown customer</span>
              )}
            </dd>
            <dt>Installed location</dt>
            <dd data-equipment-location>{locationName}</dd>
          </dl>
        </section>

        {/* §8 manufacturer / model / serial / asset tag. */}
        <section className="fo-panel" aria-labelledby="equip-identity" data-identification-section>
          <h2 id="equip-identity">Identification</h2>
          <dl className="fo-detail-list">
            <Row label="Manufacturer" value={equipment.manufacturer} />
            <Row label="Model" value={equipment.model} />
            <Row label="Serial number" value={equipment.serialNumber} />
            <Row label="Asset tag" value={equipment.assetTag} />
          </dl>
        </section>

        {/* §8 service information. */}
        <section className="fo-panel" aria-labelledby="equip-service">
          <h2 id="equip-service">Service information</h2>
          <dl className="fo-detail-list">
            <Row label="Installed" value={equipment.installedDate} />
            <Row label="Warranty expires" value={equipment.warrantyExpiresDate} />
            <Row label="Notes" value={equipment.notes} />
          </dl>
        </section>

        {/* §8 lifecycle actions, each per §5 gating. */}
        <section className="fo-panel" aria-labelledby="equip-actions">
          <h2 id="equip-actions">Lifecycle actions</h2>
          <div className="fo-btn-row">
            <button type="button" disabled data-equipment-action="move">Move</button>
            {retired ? (
              <button type="button" disabled data-equipment-action="reactivate">Reactivate</button>
            ) : (
              <button type="button" disabled data-equipment-action="retire">Retire</button>
            )}
          </div>
          {/* The reason is stated, not implied by a greyed-out button. */}
          <p className="fo-muted fo-action-reason" role="note">{unavailableReason}</p>
        </section>
      </div>

      {/* §8 linked Work Orders + §10 derived Service History. Both come from the same
          bounded subscription; a failure is reported rather than rendered as "none",
          because "this asset has no service history" is a claim we would be making. */}
      <section className="fo-panel" aria-labelledby="equip-history" data-history-section>
        <h2 id="equip-history">Service history</h2>
        {woError ? (
          <FailureState message={woError} />
        ) : history.length === 0 ? (
          <EmptyState
            variant="database"
            title="No service history"
            message="No work orders reference this equipment yet."
          />
        ) : (
          history.map((group) => (
            <div key={String(group.year)} className="fo-history-year" data-history-year={String(group.year)}>
              <h3 className="fo-history-year-heading">{group.year}</h3>
              <ul className="fo-history-list">
                {group.entries.map((entry) => (
                  <li key={entry.workOrderId} data-history-entry={entry.workOrderId}>
                    {/* The Work Order NUMBER is the human reference; the id is only the
                        link target. entry has no `id` field -- keying on workOrderId. */}
                    <Link to={`/service/work-orders/${entry.workOrderId}`}>
                      {entry.woNumber ?? "Work order"}
                    </Link>
                    {entry.type ? <span className="fo-muted"> · {entry.type}</span> : null}
                    {entry.status ? <span className="fo-muted"> · {entry.status}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </section>
  );
}

// An absent optional field is reported as such rather than rendered blank -- "not
// recorded" and "recorded as empty" read identically otherwise (Spec §1 optionals are
// string|null).
function Row({ label, value }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value ? value : <span className="fo-muted">Not recorded</span>}</dd>
    </>
  );
}
