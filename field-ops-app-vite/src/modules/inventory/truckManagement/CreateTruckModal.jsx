// EI Truck Registry -- the Create Truck form (form-by-form; CSV import is deferred). It
// collects the governed create fields, pre-validates them (validateCreateInput mirrors the
// trusted service's required-field contract), and on submit invokes the createTruck
// callable via the injected commands. The MOBILE inventory Location + its 1:1 claim are
// created ATOMICALLY server-side from the supplied locationId -- this form never writes
// Firestore directly and never fabricates the location link. Status must be EXPLICITLY
// selected. Built on the shared Modal (focus trap, Escape, backdrop, focus restore).
import { useState } from "react";
import Modal from "../../../shared/ui/Modal";
import { Field, FormActions, FormStatus } from "../../../shared/ui/form";
import { errorId } from "../../../shared/ui/form/fieldA11y";
import GovernedStatusSelect from "./GovernedStatusSelect";
import BoundedSelect from "./BoundedSelect";
import WriteDisabledNotice from "./WriteDisabledNotice";
import OutcomeBanner from "./OutcomeBanner";
import { validateCreateInput, TRUCK_COMMAND_OUTCOME } from "../../../domain/truckManagement.js";
import { Button } from "../../../shared/ui/primitives/index.js";

const EMPTY = { truckId: "", vehicleNumber: "", displayLabel: "", locationId: "", homeWarehouseId: "", status: "", assignedDriverEmployeeId: "" };

export default function CreateTruckModal({
  commands,
  writeReady,
  useDriverOptions,
  useWarehouseOptions,
  onClose,
  onCreated,
}) {
  const [form, setForm] = useState(EMPTY);
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState(null);

  // Pick-lists load ONLY when write-ready (never in the fail-closed production posture).
  const drivers = useDriverOptions(writeReady);
  const warehouses = useWarehouseOptions(writeReady);

  const set = (key) => (val) => setForm((prev) => ({ ...prev, [key]: typeof val === "string" ? val : val.target.value }));
  const { ok, errors, value } = validateCreateInput(form);

  async function handleSubmit(e) {
    e.preventDefault();
    setAttempted(true);
    setOutcome(null);
    if (!ok || !writeReady || submitting) return; // never invoke a callable when not ready/invalid
    setSubmitting(true);
    const result = await commands.createTruck(value);
    setSubmitting(false);
    if (result.stale) return; // access changed mid-flight -- discard
    if (result.kind === TRUCK_COMMAND_OUTCOME.OK) {
      onCreated?.(value.truckId);
      return;
    }
    setOutcome(result);
  }

  const err = (field) => (attempted && errors[field] ? errors[field] : null);

  return (
    <Modal title="Add truck" onClose={onClose} closeLabel="Close">
      <form className="fo-create-modal-form" onSubmit={handleSubmit} noValidate>
        {!writeReady && <WriteDisabledNotice />}

        <Field id="tm-truckId" label="Truck ID" required error={err("truckId")}>
          <input id="tm-truckId" className="fo-wizard-control" value={form.truckId} onChange={set("truckId")}
            aria-invalid={err("truckId") ? true : undefined} aria-describedby={err("truckId") ? errorId("tm-truckId") : undefined} />
        </Field>

        <Field id="tm-vehicleNumber" label="Vehicle number" required error={err("vehicleNumber")}>
          <input id="tm-vehicleNumber" className="fo-wizard-control" value={form.vehicleNumber} onChange={set("vehicleNumber")}
            aria-invalid={err("vehicleNumber") ? true : undefined} aria-describedby={err("vehicleNumber") ? errorId("tm-vehicleNumber") : undefined} />
        </Field>

        <Field id="tm-displayLabel" label="Display label" required error={err("displayLabel")}>
          <input id="tm-displayLabel" className="fo-wizard-control" value={form.displayLabel} onChange={set("displayLabel")}
            aria-invalid={err("displayLabel") ? true : undefined} aria-describedby={err("displayLabel") ? errorId("tm-displayLabel") : undefined} />
        </Field>

        <Field id="tm-locationId" label="Mobile location ID" required hint="The MOBILE inventory location and its 1:1 link are created automatically on the server." error={err("locationId")}>
          <input id="tm-locationId" className="fo-wizard-control" value={form.locationId} onChange={set("locationId")}
            aria-invalid={err("locationId") ? true : undefined} aria-describedby={err("locationId") ? errorId("tm-locationId") : undefined} />
        </Field>

        <Field id="tm-homeWarehouseId" label="Home warehouse" required error={err("homeWarehouseId")}>
          <BoundedSelect id="tm-homeWarehouseId" value={form.homeWarehouseId} onChange={set("homeWarehouseId")}
            options={warehouses.options} loading={warehouses.loading} error={warehouses.error}
            placeholder="Select a warehouse…" emptyLabel="No warehouses available" disabled={!writeReady}
            describedBy={err("homeWarehouseId") ? errorId("tm-homeWarehouseId") : undefined} />
        </Field>

        <Field id="tm-status" label="Initial status" required error={err("status")}>
          <GovernedStatusSelect id="tm-status" value={form.status} onChange={set("status")} disabled={!writeReady}
            describedBy={err("status") ? errorId("tm-status") : undefined} />
        </Field>

        <Field id="tm-driver" label="Assigned driver (optional)" hint="Driver assignment never changes inventory custody.">
          <BoundedSelect id="tm-driver" value={form.assignedDriverEmployeeId} onChange={set("assignedDriverEmployeeId")}
            options={drivers.options} loading={drivers.loading} error={drivers.error}
            placeholder="Unassigned" emptyLabel="No active employees" disabled={!writeReady} />
        </Field>

        <OutcomeBanner outcome={outcome} />
        <FormStatus visible={submitting}>{submitting ? "Adding truck…" : ""}</FormStatus>

        <FormActions>
          <Button type="submit" variant="primary" disabled={!writeReady} loading={submitting}>
            Add truck
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
        </FormActions>
      </form>
    </Modal>
  );
}
