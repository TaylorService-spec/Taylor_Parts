import { useRef, useState } from "react";
import Modal from "../../shared/ui/Modal";
import AddressFields from "../../shared/address/AddressFields";
import { Field, FormActions, FormError, FormStatus } from "../../shared/ui/form";
import { describedBy } from "../../shared/ui/form/fieldA11y";
import { locationSaveErrorMessage } from "../../domain/accountChildSaveErrors";

// Issue #214 PR-2 -- Location creation moved out of the inline form below the live
// Locations list into the same shared Modal pattern as ContactCreateModal, on the
// System-A form primitives. The account is FIXED by the Account Detail route.
// Every existing field (name, structured address via the shared AddressFields,
// access notes), the payload shape, validation, permissions, and the
// client-direct write path (domain/locations.js createLocation) are preserved --
// presentation/container change only. Close paths are ignored and a second submit
// is blocked while the write is in flight; nothing is persisted on failure.
export default function LocationCreateModal({ accountName, onCreate, onClose }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState({ street: "", city: "", state: "", zip: "" });
  const [accessNotes, setAccessNotes] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const nameError = submitAttempted && !name.trim() ? "Enter a site name." : null;

  function handleAddressChange(field, value) {
    setAddress((cur) => ({ ...cur, [field]: value }));
  }

  function requestClose() {
    if (submittingRef.current) return;
    onClose();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submittingRef.current) return;
    setSubmitAttempted(true);
    setSaveError(null);
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const payload = {
      name: trimmedName,
      address: {
        street: address.street.trim(),
        city: address.city.trim(),
        state: address.state.trim(),
        zip: address.zip.trim(),
      },
      accessNotes: accessNotes.trim() || null,
    };
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onCreate(payload);
    } catch (err) {
      console.error("Location create failed:", err);
      setSaveError(locationSaveErrorMessage(err));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Add Location" onClose={requestClose} closeLabel="Close">
      <form className="fo-form fo-create-modal-form" onSubmit={handleSubmit}>
        <p className="fo-muted">
          Adding to: <strong>{accountName}</strong> (the customer is fixed and cannot be changed here).
        </p>

        <Field id="location-name" label="Site name" required error={nameError} hint="e.g. Main Office">
          <input
            id="location-name"
            className="fo-wizard-control"
            value={name}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={describedBy("location-name", { hasHint: true, hasError: Boolean(nameError) })}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <AddressFields value={address} onChange={handleAddressChange} idPrefix="location-address" />

        <Field id="location-access-notes" label="Access notes">
          <input
            id="location-access-notes"
            className="fo-wizard-control"
            value={accessNotes}
            onChange={(e) => setAccessNotes(e.target.value)}
          />
        </Field>

        <FormError role="alert" className="fo-location-save-error">{saveError}</FormError>
        <FormStatus>{submitting ? "Saving location..." : ""}</FormStatus>

        <FormActions>
          <button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Add Location"}</button>
          <button type="button" onClick={requestClose} disabled={submitting}>Cancel</button>
        </FormActions>
      </form>
    </Modal>
  );
}
