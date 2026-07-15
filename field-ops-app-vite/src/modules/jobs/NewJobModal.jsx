import { useRef, useState } from "react";
import Modal from "../../shared/ui/Modal";
import { Field, FormActions, FormError, FormStatus } from "../../shared/ui/form";
import { describedBy } from "../../shared/ui/form/fieldA11y";
import { jobSaveErrorMessage } from "../../domain/legacyCreateSaveErrors";

// Issue #214 PR-5 -- the create form that used to sit above the live results table
// on Jobs.jsx, moved into the shared accessible Modal on the System-A form
// primitives (Field / FormActions / FormError / FormStatus). Fields (Customer,
// description, optional Street/City/State/Zip), the required-Customer+description
// validation meaning, the exact createJob(customer, description, address) payload
// and write path, permissions, and the address = null-when-empty rule are all
// PRESERVED from the old inline form -- this is a presentation/container change
// only.
//
// `onCreate({ customer, description, address })` performs the write and, on
// success, closes this modal + announces + moves focus to the new row (in
// Jobs.jsx). It THROWS on a blocked/denied write, which this component catches to
// keep the modal open with safe categorized copy -- nothing is persisted on
// failure. While the write is in flight, every close path (Escape / backdrop /
// close button / Cancel) is ignored and a second submit is blocked.
export default function NewJobModal({ onCreate, onClose }) {
  const [customer, setCustomer] = useState("");
  const [description, setDescription] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const customerError = submitAttempted && !customer.trim() ? "Enter a customer." : null;
  const descriptionError = submitAttempted && !description.trim() ? "Enter a work order description." : null;

  function requestClose() {
    if (submittingRef.current) return; // never close over an in-flight write
    onClose();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submittingRef.current) return; // block duplicate submit
    setSubmitAttempted(true);
    setSaveError(null);
    const trimmedCustomer = customer.trim();
    const trimmedDescription = description.trim();
    if (!trimmedCustomer || !trimmedDescription) return; // same required meaning as before

    // Same address assembly as the old inline form: null unless any part is set.
    const trimmedStreet = street.trim();
    const trimmedCity = city.trim();
    const trimmedState = state.trim();
    const trimmedZip = zip.trim();
    const hasAddress = trimmedStreet || trimmedCity || trimmedState || trimmedZip;
    const address = hasAddress
      ? { street: trimmedStreet, city: trimmedCity, state: trimmedState, zip: trimmedZip }
      : null;

    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onCreate({ customer: trimmedCustomer, description: trimmedDescription, address });
    } catch (err) {
      console.error("Job create failed:", err);
      setSaveError(jobSaveErrorMessage(err));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal title="New Job" onClose={requestClose} closeLabel="Close">
      <form className="fo-form fo-create-modal-form" onSubmit={handleSubmit}>
        <Field id="job-customer" label="Customer" required error={customerError}>
          <input
            id="job-customer"
            className="fo-wizard-control"
            value={customer}
            aria-invalid={customerError ? true : undefined}
            aria-describedby={describedBy("job-customer", { hasError: Boolean(customerError) })}
            onChange={(e) => setCustomer(e.target.value)}
          />
        </Field>

        <Field id="job-description" label="Work order description" required error={descriptionError}>
          <input
            id="job-description"
            className="fo-wizard-control"
            value={description}
            aria-invalid={descriptionError ? true : undefined}
            aria-describedby={describedBy("job-description", { hasError: Boolean(descriptionError) })}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <Field id="job-street" label="Street" hint="Optional">
          <input id="job-street" className="fo-wizard-control" value={street}
            aria-describedby={describedBy("job-street", { hasHint: true })}
            onChange={(e) => setStreet(e.target.value)} />
        </Field>
        <Field id="job-city" label="City" hint="Optional">
          <input id="job-city" className="fo-wizard-control" value={city}
            aria-describedby={describedBy("job-city", { hasHint: true })}
            onChange={(e) => setCity(e.target.value)} />
        </Field>
        <Field id="job-state" label="State" hint="Optional">
          <input id="job-state" className="fo-wizard-control" value={state}
            aria-describedby={describedBy("job-state", { hasHint: true })}
            onChange={(e) => setState(e.target.value)} />
        </Field>
        <Field id="job-zip" label="Zip" hint="Optional">
          <input id="job-zip" className="fo-wizard-control" value={zip}
            aria-describedby={describedBy("job-zip", { hasHint: true })}
            onChange={(e) => setZip(e.target.value)} />
        </Field>

        <FormError role="alert" className="fo-job-save-error">{saveError}</FormError>
        <FormStatus>{submitting ? "Saving…" : ""}</FormStatus>

        <FormActions>
          <button type="submit" disabled={submitting}>{submitting ? "Saving…" : "New Job"}</button>
          <button type="button" onClick={requestClose} disabled={submitting}>Cancel</button>
        </FormActions>
      </form>
    </Modal>
  );
}
