// EI Truck Registry -- the Manage Truck drawer for a selected truck. It exposes ONLY the
// eight governed commands (no fabricated generic update): assign / reassign / unassign
// driver, change status, change home warehouse, deactivate, reactivate. Each command is
// CAS'd with the truck's current version (record.version); a version conflict surfaces as
// the sanitized reload-required outcome. displayLabel and vehicleNumber are shown READ-ONLY
// (a governed update command for them is not approved in this gate). Deactivate / reactivate
// require an inline confirmation. The ADMIN-ONLY Created-in-Error delete uses the shared
// destructive ConfirmDialog (required reason). Built on the shared Modal (focus trap, Escape).
import { useEffect, useState } from "react";
import Modal from "../../../shared/ui/Modal";
import ConfirmDialog from "../../../shared/ui/ConfirmDialog";
import { Field } from "../../../shared/ui/form";
import GovernedStatusSelect from "./GovernedStatusSelect";
import BoundedSelect from "./BoundedSelect";
import WriteDisabledNotice from "./WriteDisabledNotice";
import OutcomeBanner from "./OutcomeBanner";
import {
  TRUCK_COMMAND_OUTCOME,
  REACTIVATION_TARGET_OPTIONS,
  DEACTIVATED_STATUS,
  truckStatusLabel,
} from "../../../domain/truckManagement.js";
import { TRUCK_DEACTIVATE_READY, TRUCK_DELETE_READY } from "../../../config/truckManagementReadiness.js";
import { Button } from "../../../shared/ui/primitives/index.js";

const dash = (v) => (v == null || v === "" ? "—" : v);

export default function ManageTruckDrawer({
  record,
  driverName,
  commands,
  writeReady,
  isAdmin = false,
  useDriverOptions,
  useWarehouseOptions,
  onClose,
  onReconcile,
}) {
  const [driver, setDriver] = useState(record.assignedDriverEmployeeId || "");
  const [statusTarget, setStatusTarget] = useState(record.status || "");
  const [warehouse, setWarehouse] = useState(record.homeWarehouseId || "");
  const [busy, setBusy] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [confirm, setConfirm] = useState(null); // { action: "deactivate" | "reactivate", targetStatus? }
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Re-sync the controls to the current record after a successful op reconciles a new
  // version in (never mid-flight -- keyed on version, which only changes post-success).
  useEffect(() => {
    setDriver(record.assignedDriverEmployeeId || "");
    setStatusTarget(record.status || "");
    setWarehouse(record.homeWarehouseId || "");
    setConfirm(null);
  }, [record.version, record.assignedDriverEmployeeId, record.status, record.homeWarehouseId]);

  const drivers = useDriverOptions(writeReady);
  const warehouses = useWarehouseOptions(writeReady);
  const expectedVersion = record.version;
  const hasDriver = Boolean(record.assignedDriverEmployeeId);

  async function runAction(key, fn) {
    if (!writeReady || busy) return;
    setBusy(key);
    setOutcome(null);
    const result = await fn();
    setBusy(null);
    if (result.stale) return; // access changed mid-flight -- discard
    setOutcome(result);
    if (result.kind === TRUCK_COMMAND_OUTCOME.OK) setConfirm(null);
  }

  const onStatusUpdate = () => {
    if (!statusTarget || statusTarget === record.status) return;
    if (statusTarget === DEACTIVATED_STATUS) {
      setConfirm({ action: "deactivate" });
      return;
    }
    if (record.status === DEACTIVATED_STATUS) {
      setConfirm({ action: "reactivate", targetStatus: statusTarget });
      return;
    }
    runAction("status", () => commands.changeStatus({ truckId: record.truckId, status: statusTarget, expectedVersion }));
  };

  return (
    <Modal title={`Manage truck · ${record.truckId}`} onClose={onClose} closeLabel="Close">
      <div className="fo-create-modal-form" data-testid="manage-truck-drawer">
        {!writeReady && <WriteDisabledNotice />}

        {/* Read-only identity -- displayLabel/vehicleNumber are NOT editable in this gate. */}
        <dl className="fo-truck-summary-grid">
          <div><dt className="fo-muted">Display label</dt><dd className="fo-dd-tight" data-testid="tm-displayLabel-readonly">{dash(record.displayLabel)}</dd></div>
          <div><dt className="fo-muted">Vehicle number</dt><dd className="fo-dd-tight" data-testid="tm-vehicleNumber-readonly">{dash(record.vehicleNumber)}</dd></div>
          <div><dt className="fo-muted">Current status</dt><dd className="fo-dd-tight" data-testid="tm-current-status">{truckStatusLabel(record.status)}</dd></div>
          <div><dt className="fo-muted">Current driver</dt><dd className="fo-dd-tight" data-testid="tm-current-driver">{dash(driverName)}</dd></div>
        </dl>

        <OutcomeBanner outcome={outcome} onReload={onReconcile} />

        {/* Driver */}
        <fieldset className="fo-fieldset">
          <legend>Driver</legend>
          <Field id="tm-manage-driver" label="Employee">
            <BoundedSelect id="tm-manage-driver" value={driver} onChange={setDriver}
              options={drivers.options} loading={drivers.loading} error={drivers.error}
              placeholder="Select an employee…" emptyLabel="No active employees" disabled={!writeReady} />
          </Field>
          <div className="fo-btn-row">
            {hasDriver ? (
              <>
                <Button type="button" variant="primary" disabled={!writeReady || Boolean(busy) || !driver || driver === record.assignedDriverEmployeeId}
                  loading={busy === "reassign"}
                  onClick={() => runAction("reassign", () => commands.reassignDriver({ truckId: record.truckId, employeeId: driver, expectedVersion }))}>
                  Reassign driver
                </Button>
                <Button type="button" variant="secondary" disabled={!writeReady || Boolean(busy)}
                  loading={busy === "unassign"}
                  onClick={() => runAction("unassign", () => commands.unassignDriver({ truckId: record.truckId, expectedVersion }))}>
                  Unassign driver
                </Button>
              </>
            ) : (
              <Button type="button" variant="primary" disabled={!writeReady || Boolean(busy) || !driver}
                loading={busy === "assign"}
                onClick={() => runAction("assign", () => commands.assignDriver({ truckId: record.truckId, employeeId: driver, expectedVersion }))}>
                Assign driver
              </Button>
            )}
          </div>
        </fieldset>

        {/* Status */}
        <fieldset className="fo-fieldset">
          <legend>Status</legend>
          <Field id="tm-manage-status" label="Status">
            <GovernedStatusSelect id="tm-manage-status" value={statusTarget} onChange={setStatusTarget} disabled={!writeReady} />
          </Field>
          {confirm?.action === "deactivate" ? (
            <div className="fo-warning" role="group" aria-label="Confirm deactivate">
              <p>Deactivate this truck? Deactivation is blocked while governed inventory remains at its location.</p>
              {!TRUCK_DEACTIVATE_READY && (
                <p className="fo-warning" role="status" data-testid="tm-deactivate-unavailable">
                  Deactivate truck — unavailable until inventory-at-location verification is enabled.
                </p>
              )}
              <div className="fo-btn-row">
                <Button type="button" variant="destructive" disabled={Boolean(busy) || !TRUCK_DEACTIVATE_READY}
                  loading={busy === "deactivate"}
                  onClick={() => runAction("deactivate", () => commands.deactivateTruck({ truckId: record.truckId, expectedVersion }))}>
                  Confirm deactivate
                </Button>
                <Button type="button" variant="secondary" disabled={Boolean(busy)} onClick={() => setConfirm(null)}>Cancel</Button>
              </div>
            </div>
          ) : confirm?.action === "reactivate" ? (
            <div className="fo-warning" role="group" aria-label="Confirm reactivate">
              <p>Reactivate this truck to “{truckStatusLabel(confirm.targetStatus)}”?</p>
              <div className="fo-btn-row">
                <Button type="button" variant="primary" disabled={Boolean(busy)}
                  loading={busy === "reactivate"}
                  onClick={() => runAction("reactivate", () => commands.reactivateTruck({ truckId: record.truckId, targetStatus: confirm.targetStatus, expectedVersion }))}>
                  Confirm reactivate
                </Button>
                <Button type="button" variant="secondary" disabled={Boolean(busy)} onClick={() => setConfirm(null)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="fo-btn-row">
              <Button type="button" variant="primary" disabled={!writeReady || Boolean(busy) || !statusTarget || statusTarget === record.status}
                loading={busy === "status"} onClick={onStatusUpdate}>
                Update status
              </Button>
            </div>
          )}
          {record.status === DEACTIVATED_STATUS && (
            <p className="fo-muted">Reactivation targets: {REACTIVATION_TARGET_OPTIONS.map(truckStatusLabel).join(" or ")}.</p>
          )}
        </fieldset>

        {/* Home warehouse */}
        <fieldset className="fo-fieldset">
          <legend>Home warehouse</legend>
          <Field id="tm-manage-warehouse" label="Warehouse">
            <BoundedSelect id="tm-manage-warehouse" value={warehouse} onChange={setWarehouse}
              options={warehouses.options} loading={warehouses.loading} error={warehouses.error}
              placeholder="Select a warehouse…" emptyLabel="No warehouses available" disabled={!writeReady} />
          </Field>
          <div className="fo-btn-row">
            <Button type="button" variant="primary" disabled={!writeReady || Boolean(busy) || !warehouse || warehouse === record.homeWarehouseId}
              loading={busy === "warehouse"}
              onClick={() => runAction("warehouse", () => commands.changeHomeWarehouse({ truckId: record.truckId, homeWarehouseId: warehouse, expectedVersion }))}>
              Update home warehouse
            </Button>
          </div>
        </fieldset>

        {/* Danger zone -- ADMIN-ONLY Created-in-Error hard delete. */}
        {isAdmin && (
          <fieldset className="fo-fieldset" data-testid="tm-danger-zone">
            <legend>Danger zone · admin only</legend>
            <p className="fo-muted">
              Permanently delete a truck created in error. This removes the truck, its MOBILE inventory
              location, and the location link. Only trucks with NO operational history can be deleted —
              operational trucks cannot be deleted.
            </p>
            {!TRUCK_DELETE_READY && (
              <p className="fo-warning" role="status" data-testid="tm-delete-unavailable">
                Delete truck — unavailable until operational-reference verification is enabled.
              </p>
            )}
            <div className="fo-btn-row">
              <Button type="button" variant="destructive" data-testid="tm-delete-cie"
                disabled={!writeReady || Boolean(busy) || !TRUCK_DELETE_READY} onClick={() => setDeleteOpen(true)}>
                Delete truck (created in error)
              </Button>
            </div>
          </fieldset>
        )}

        <div className="fo-btn-row">
          <Button type="button" variant="secondary" onClick={onClose} disabled={Boolean(busy)}>Close</Button>
        </div>
      </div>

      {deleteOpen && (
        <ConfirmDialog
          title={`Delete truck ${record.truckId} (created in error)`}
          consequence="This permanently deletes the truck, its MOBILE inventory location, and the 1:1 location claim. It cannot be undone. Only a truck created in error with NO operational history can be deleted — a truck with inventory, transfers, ledger history, or a driver assignment cannot be deleted."
          confirmLabel="Delete truck"
          cancelLabel="Cancel"
          requireReason
          reasonLabel="Reason for deletion"
          reasonHint="Recorded in the immutable deletion audit (e.g. duplicate entry, wrong warehouse)."
          reasonRequiredMessage="Enter a reason to delete."
          onConfirm={async (reason) => {
            const result = await commands.deleteTruckCreatedInError({ truckId: record.truckId, expectedVersion, deletionReason: reason });
            if (result.stale) { setDeleteOpen(false); return; } // access changed mid-flight -- discard
            if (result.kind !== TRUCK_COMMAND_OUTCOME.OK) throw result; // ConfirmDialog renders mapError(result)
            onReconcile?.();
            setDeleteOpen(false);
            onClose?.(); // the truck is gone -- close the drawer back to the fleet
          }}
          onClose={() => setDeleteOpen(false)}
          mapError={(err) => (err && typeof err.message === "string" && err.message) ? err.message : "The truck could not be deleted."}
        />
      )}
    </Modal>
  );
}
