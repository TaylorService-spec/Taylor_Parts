import { useCallback, useEffect, useMemo, useState } from "react";
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
import { updateEquipment } from "../../domain/equipmentRepository";
import EquipmentEditModal from "./EquipmentEditModal";
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
// retired at all, and enabling them would promise a write nothing can perform.
//
// EDIT (E8) IS DIFFERENT, and sits apart from them for that reason: it is an ordinary
// client write that Rules permit today, so it is genuinely available -- including on a
// RETIRED asset, per the Owner's E3 decision (descriptive corrections stay allowed; a
// wrong serial number is still worth fixing after the asset leaves service). It edits
// descriptive fields only; ownership and status are not its to change.

const STATUS_LABEL = {
  [EQUIPMENT_STATUS.ACTIVE]: "Active",
  [EQUIPMENT_STATUS.INACTIVE]: "Inactive",
  [EQUIPMENT_STATUS.RETIRED]: "Retired",
};

export default function EquipmentDetail() {
  const { equipmentId } = useParams();
  const navigate = useNavigate();
  const { equipment, loading, error } = useEquipmentDoc(equipmentId);
  // `loading` on each of these is load-bearing, not decoration. The equipment document
  // and everything keyed off it are INDEPENDENT subscriptions, and the doc always wins
  // (a single-doc read resolves before a collection query, and the Account/Location
  // subscriptions cannot even start until accountId is known). So there is always at
  // least one render where the page has the asset but not its context -- and rendering
  // a not-yet-known answer as a fact is how "No service history" ends up on an asset
  // with three work orders.
  const { data: workOrders, loading: woLoading, error: woError } = useWorkOrdersForEquipment(equipmentId);
  const { account, loading: accountLoading } = useAccount(equipment?.accountId ?? null);
  const { data: locations, loading: locationsLoading, error: locationsError, retry: retryLocations } =
    useLocationsForAccount(equipment?.accountId ?? null);

  const history = useMemo(
    () => groupServiceHistoryByYear(equipmentServiceHistory(workOrders, equipmentId)),
    [workOrders, equipmentId]
  );

  // E8. Declared with the other hooks, above this component's early returns -- a
  // useState after them would run conditionally.
  const [editing, setEditing] = useState(false);

  // Close the editor when the route moves to a DIFFERENT asset. Without this, browser
  // Back between two detail pages re-opens the modal unrequested on the new record --
  // the user asked to leave, and instead they land in an editor they never opened.
  // Data-safe either way (the modal remounts re-seeded from the new record), but a form
  // appearing over an asset you merely navigated to is a surprise, not a feature.
  useEffect(() => { setEditing(false); }, [equipmentId]);

  // The saved record arrives through useEquipmentDoc's live subscription, so this page
  // has nothing to update by hand. That is true of the PAGE only -- the modal does hold a
  // local copy of the values, and its drift against a concurrent write was E8's blocker:
  // it freezes the record it seeded from and diffs against that, so a save is a
  // field-level merge rather than an overwrite. See EquipmentEditModal's header.
  // Closing is this component's single decision; the modal never closes itself (E6's rule).
  const handleSave = useCallback(async (changed, before) => {
    const result = await updateEquipment(equipmentId, changed, { before });
    if (result?.ok) setEditing(false);
    return result;
  }, [equipmentId]);

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
        {/* Available, so it is a live control -- placed with the asset's identity rather
            than among the #15-gated lifecycle actions below. */}
        <div className="fo-btn-row fo-equipment-detail-actions">
          <button type="button" data-equipment-action="edit" onClick={() => setEditing(true)}>
            Edit
          </button>
        </div>
      </header>

      <div className="fo-detail-grid">
        {/* §8 Account + installed Location. Both render their NAME; an unresolved
            reference says so rather than exposing the raw id.
            LOCATION now distinguishes a FAILED read from a genuinely-unknown one (#291):
            a denied/failed Locations query shows an actionable failure with retry instead
            of "Unknown location" stated as a fact.
            ACCOUNT still cannot: useAccount passes no error callback and returns no error,
            so "Unknown customer" remains ambiguous there. That is the same class one hook
            over, out of #291's Location scope; not fixed here rather than widened silently. */}
        <section className="fo-panel" aria-labelledby="equip-where">
          <h2 id="equip-where">Customer &amp; location</h2>
          <dl className="fo-detail-list">
            <dt>Customer</dt>
            <dd data-equipment-account>
              {accountLoading ? (
                <span className="fo-muted">Loading…</span>
              ) : account ? (
                <Link to={`/customers/${equipment.accountId}`}>{account.name}</Link>
              ) : (
                <span className="fo-muted">Unknown customer</span>
              )}
            </dd>
            <dt>Installed location</dt>
            <dd data-equipment-location>
              {locationsLoading ? (
                <span className="fo-muted">Loading…</span>
              ) : locationsError ? (
                <span className="fo-inline-error" role="alert" data-location-error>
                  {locationsError}{" "}
                  <button type="button" className="fo-link-button" onClick={retryLocations}>Retry</button>
                </span>
              ) : (
                locationName
              )}
            </dd>
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

        {/* §8 lifecycle actions, each per §5 gating.
            Edit is NOT among them and is not disabled: it is an ordinary write Rules
            permit today. Grouping an available action beside unavailable ones under one
            "not available yet" note would make it read as gated too. */}
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
        {woLoading ? (
          // §9: loading is NOT database-empty. Without this branch the page rendered
          // "No work orders reference this equipment yet" on every cold load, as a
          // statement of fact, until the query returned -- on an asset with three of
          // them. The register got this right; the detail page did not, and its own
          // comment above ("a failure is reported rather than rendered as 'none'
          // because that is a claim we would be making") named the principle it broke.
          <LoadingState>Loading service history…</LoadingState>
        ) : woError ? (
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

      {/* Mounted only while open, so the form always seeds from the CURRENT record: a
          modal kept mounted and merely hidden would reopen holding whatever the user
          typed and abandoned last time, and present it as the stored value.
          `locationName` is passed already resolved -- the modal shows ownership as
          context and must never re-derive it, let alone offer it. */}
      {editing ? (
        <EquipmentEditModal
          equipment={equipment}
          accountName={account?.name ?? "Unknown customer"}
          locationName={locationName}
          onSave={handleSave}
          onClose={() => setEditing(false)}
        />
      ) : null}
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
