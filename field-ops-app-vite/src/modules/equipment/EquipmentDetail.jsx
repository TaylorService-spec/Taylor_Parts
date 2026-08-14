import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useEquipmentDoc, useWorkOrdersForEquipment } from "../../hooks/useEquipment";
import { useAccount } from "../../hooks/useAccount";
import { useLocationsForAccount } from "../../hooks/useLocationsForAccount";
import {
  equipmentDisplayName,
  equipmentSummary,
  isRetired,
  equipmentStatusTone,
} from "../../domain/equipment";
import { trustedActionUnavailable } from "../../domain/equipment";
import { updateEquipment } from "../../domain/equipmentRepository";
import EquipmentEditModal from "./EquipmentEditModal";
import EquipmentTimeline from "./EquipmentTimeline";
import InventoryControlSection from "./InventoryControlSection";
import { buildEquipmentInventoryControlView } from "../../domain/equipmentInventoryControlAdapter";
import LoadingState from "../../shared/ui/LoadingState";
import FailureState from "../../shared/ui/FailureState";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ActionRail from "../../shared/ui/ActionRail.jsx";
import ContextBand from "../../shared/ui/ContextBand.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
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
  const { account, loading: accountLoading, error: accountError, retry: retryAccount } =
    useAccount(equipment?.accountId ?? null);
  const { data: locations, loading: locationsLoading, error: locationsError, retry: retryLocations } =
    useLocationsForAccount(equipment?.accountId ?? null);

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

  // #324: distinct on a FAILED read, so the edit modal (which shows this as read-only
  // context) reads "Location unavailable" rather than "Unknown location" -- the latter
  // would assert the location is genuinely unset when we merely could not load it. The
  // inline cell above renders its own failure+retry; this string is what feeds the modal.
  const locationName = locationsError
    ? "Location unavailable"
    : locations.find((l) => l.id === equipment.locationId)?.name ?? "Unknown location";
  const retired = isRetired(equipment);
  // One shared reason string, from the same seam the buttons would call -- so the copy
  // a user reads cannot drift from what the action would actually do.
  const unavailableReason = trustedActionUnavailable("equipment.move").message;

  // §8 identity + status. The display name is the human reference; the id is never
  // rendered as one (§8), though it is legitimately in the URL.
  const actions = (
    <ActionRail
      start={<Link to="/equipment" className="fo-back-link">&larr; Back to Equipment</Link>}
      primary={
        // Available, so it is a live control -- kept alongside the asset's identity
        // rather than among the #15-gated lifecycle actions below.
        <button type="button" className="fo-btn-primary" data-equipment-action="edit" onClick={() => setEditing(true)}>
          Edit
        </button>
      }
    />
  );
  const context = (
    <ContextBand
      items={[
        {
          key: "status",
          label: "Status",
          value: (
            <StatusPill
              tone={equipmentStatusTone(equipment.status)}
              label={STATUS_LABEL[equipment.status] ?? "Unknown"}
              data-equipment-status={equipment.status ?? ""}
            />
          ),
        },
        { key: "summary", label: "Details", value: equipmentSummary(equipment) },
      ]}
    />
  );

  return (
    <WorkspaceShell title={equipmentDisplayName(equipment)} actions={actions} context={context} className="fo-equipment-detail">
      <div className="fo-detail-grid">
        {/* §8 Account + installed Location. Both render their NAME; an unresolved
            reference says so rather than exposing the raw id.
            Both now distinguish a FAILED read from a genuinely-unknown one:
            LOCATION since #291, and ACCOUNT since site-work #4 -- a denied/failed
            read shows an actionable failure with retry instead of stating
            "Unknown customer"/"Unknown location" as a fact when we simply could
            not look. */}
        <section className="fo-panel" aria-labelledby="equip-where">
          <h2 id="equip-where">Customer &amp; location</h2>
          <dl className="fo-detail-list">
            <dt>Customer</dt>
            <dd data-equipment-account>
              {accountLoading ? (
                <span className="fo-muted">Loading…</span>
              ) : accountError ? (
                <span className="fo-inline-error" role="alert" data-account-error>
                  {accountError}{" "}
                  <button type="button" className="fo-link-btn" onClick={retryAccount}>Retry</button>
                </span>
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
                  <button type="button" className="fo-link-btn" onClick={retryLocations}>Retry</button>
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

        {/* Ventana lifecycle — two-condition inventory-control read (install complete AND sale
            close). The sale-close signal is a separate Sales Order authority not available on
            this surface and D-5 is unratified, so this renders an honest UNKNOWN with the reason
            rather than a fabricated state — see domain/equipmentInventoryControlAdapter.js. */}
        <InventoryControlSection view={buildEquipmentInventoryControlView(equipment)} />

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
      {/* §8/§10 + INV-EQ-P2 -- ONE unified Activity Timeline (service + inventory),
          replacing the year-grouped Service History. Reuses the same bounded Work
          Order subscription (workOrders); the inventory half is an injected source
          that stays inert -- honestly reported, never fabricated -- until the
          Enterprise Inventory sources exist. A read failure is reported as unavailable,
          never rendered as "no activity". */}
      <EquipmentTimeline
        workOrders={workOrders}
        equipmentId={equipmentId}
        workOrdersLoading={woLoading}
        workOrdersError={woError}
      />

      {/* Mounted only while open, so the form always seeds from the CURRENT record: a
          modal kept mounted and merely hidden would reopen holding whatever the user
          typed and abandoned last time, and present it as the stored value.
          `locationName` is passed already resolved -- the modal shows ownership as
          context and must never re-derive it, let alone offer it. */}
      {editing ? (
        <EquipmentEditModal
          equipment={equipment}
          accountName={accountError ? "Customer unavailable" : account?.name ?? "Unknown customer"}
          locationName={locationName}
          onSave={handleSave}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </WorkspaceShell>
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
