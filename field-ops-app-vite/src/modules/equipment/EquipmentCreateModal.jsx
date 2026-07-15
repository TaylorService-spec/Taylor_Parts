import { useCallback, useRef, useState } from "react";
import Modal from "../../shared/ui/Modal";
import { Field, FormActions, FormError, FormStatus } from "../../shared/ui/form";
import { describedBy } from "../../shared/ui/form/fieldA11y";

// Issue #232 unit E6 -- Equipment creation, on the same shared Modal + form-primitive
// pattern as LocationCreateModal/ContactCreateModal (Issue #214 PR-2). Close paths are
// ignored and a second submit is blocked while the write is in flight; nothing is
// persisted on failure.
//
// THE ACCOUNT IS FIXED, not chosen here. It comes from the register's current
// selection, which is also what bounds the register's query (Spec §7). Offering a
// customer picker inside the modal would let someone create equipment for a customer
// they are not looking at, and the created row would then vanish from the list that
// just "confirmed" it.
//
// LOCATION IS RESTRICTED TO THAT ACCOUNT (Spec §4). The options are the Account's own
// Locations -- there is no way to type or select a foreign one. E2 re-checks ownership
// before writing and E3's Rules re-check it server-side; this is the first of three
// independent guards, not the only one.
//
// STATUS IS DELIBERATELY ABSENT. Spec §2 says status defaults ACTIVE on create, and E1
// REFUSES an explicitly supplied non-ACTIVE or unrecognized status -- including null
// and "". So the form must omit the key entirely rather than send a "default": sending
// status: null or status: "" would be rejected as an invalid status for a control this
// form does not even offer. Reaching INACTIVE/RETIRED is a lifecycle action (§3/§5),
// never a create-time choice.
export default function EquipmentCreateModal({ accountName, locations, onCreate, onClose }) {
  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [assetTag, setAssetTag] = useState("");
  const [installedDate, setInstalledDate] = useState("");
  const [warrantyExpiresDate, setWarrantyExpiresDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  // Local required-field feedback before submit; the server-side result can add more.
  const nameError = (submitAttempted && !name.trim() ? "Enter an equipment name." : null) ?? fieldErrors.name ?? null;
  const locationError = (submitAttempted && !locationId ? "Select a location." : null) ?? fieldErrors.locationId ?? null;

  // Drop a field's SERVER error as soon as the user edits that field. Without this it
  // survived until the next submit: after a refused cross-Account destination, picking
  // a valid location still showed "Select a location that belongs to this customer."
  // on a now-valid control, with aria-invalid stuck true. An error must not outlive the
  // input it describes.
  const clearFieldError = (field) =>
    setFieldErrors((cur) => (cur[field] ? { ...cur, [field]: undefined } : cur));

  // useCallback is LOAD-BEARING, not tidiness. Modal's focus effect is keyed on
  // [onClose] (shared/ui/Modal.jsx), so a handler with a fresh identity each render
  // makes that effect tear down and re-run on EVERY KEYSTROKE: the cleanup restores
  // focus to the trigger and the re-run focuses the dialog's first focusable -- the ✕
  // button. Verified in a real browser: typing "Rooftop Unit 1" left the field EMPTY
  // with focus on ✕, and the first SPACE activated ✕ and discarded the form.
  //
  // This makes E6 correct within its own surface. It does NOT fix the root cause,
  // which is Modal's dependency array -- every other modal passing a plain function has
  // the same defect today. Reported to the Owner; see the PR.
  const requestClose = useCallback(() => {
    // Close-during-save protection: a close while the write is in flight is ignored,
    // so the modal cannot disappear before its own result is known.
    if (submittingRef.current) return;
    onClose();
  }, [onClose]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (submittingRef.current) return; // duplicate-submit guard
    setSubmitAttempted(true);
    setSaveError(null);
    setFieldErrors({});
    if (!name.trim() || !locationId) return;

    // The chosen Location document -- E2's createEquipment requires it to PROVE the
    // Account/Location relationship rather than take the id on trust. It is always
    // found here because the options came from this same list.
    const location = locations.find((l) => l.id === locationId) ?? null;

    // Note what is NOT here: `status`. See the header.
    const values = {
      locationId,
      name: name.trim(),
      manufacturer: manufacturer.trim() || null,
      model: model.trim() || null,
      serialNumber: serialNumber.trim() || null,
      assetTag: assetTag.trim() || null,
      installedDate: installedDate.trim() || null,
      warrantyExpiresDate: warrantyExpiresDate.trim() || null,
      notes: notes.trim() || null,
    };

    submittingRef.current = true;
    setSubmitting(true);
    try {
      // E2's write path RESOLVES a safe result rather than throwing; a raw error can
      // never reach here, so there is nothing to map or accidentally render.
      const result = await onCreate(values, location);
      if (!result?.ok) {
        setFieldErrors(result?.errors ?? {});
        setSaveError(result?.message ?? "Could not save this equipment. Nothing was saved — please try again.");
      }
      // On success the parent closes the modal and focuses the new row -- this
      // component deliberately does not close itself, so "closes once" is the
      // parent's single decision rather than a race between the two.
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Add Equipment" onClose={requestClose} closeLabel="Close">
      <form className="fo-form fo-create-modal-form" onSubmit={handleSubmit}>
        <p className="fo-muted">
          Adding to: <strong>{accountName}</strong> (the customer is fixed and cannot be changed here).
        </p>

        <Field id="equipment-create-name" label="Equipment name" required error={nameError} hint="e.g. Rooftop Unit 1">
          <input
            id="equipment-create-name"
            className="fo-wizard-control"
            value={name}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={describedBy("equipment-create-name", { hasHint: true, hasError: Boolean(nameError) })}
            onChange={(e) => { setName(e.target.value); clearFieldError("name"); }}
          />
        </Field>

        <Field
          id="equipment-create-location"
          label="Location"
          required
          error={locationError}
          hint="Only this customer's locations can be selected"
        >
          <select
            id="equipment-create-location"
            className="fo-wizard-control"
            value={locationId}
            aria-invalid={locationError ? true : undefined}
            aria-describedby={describedBy("equipment-create-location", { hasHint: true, hasError: Boolean(locationError) })}
            onChange={(e) => { setLocationId(e.target.value); clearFieldError("locationId"); }}
          >
            <option value="">Select a location…</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </Field>

        <Field id="equipment-create-manufacturer" label="Manufacturer">
          <input id="equipment-create-manufacturer" className="fo-wizard-control" value={manufacturer}
            onChange={(e) => setManufacturer(e.target.value)} />
        </Field>

        <Field id="equipment-create-model" label="Model">
          <input id="equipment-create-model" className="fo-wizard-control" value={model}
            onChange={(e) => setModel(e.target.value)} />
        </Field>

        <Field id="equipment-create-serial" label="Serial number">
          <input id="equipment-create-serial" className="fo-wizard-control" value={serialNumber}
            onChange={(e) => setSerialNumber(e.target.value)} />
        </Field>

        <Field id="equipment-create-asset-tag" label="Asset tag">
          <input id="equipment-create-asset-tag" className="fo-wizard-control" value={assetTag}
            onChange={(e) => setAssetTag(e.target.value)} />
        </Field>

        <Field id="equipment-create-installed" label="Installed date" hint="YYYY-MM-DD">
          <input id="equipment-create-installed" className="fo-wizard-control" type="date" value={installedDate}
            aria-describedby={describedBy("equipment-create-installed", { hasHint: true, hasError: false })}
            onChange={(e) => setInstalledDate(e.target.value)} />
        </Field>

        <Field id="equipment-create-warranty" label="Warranty expires" hint="YYYY-MM-DD">
          <input id="equipment-create-warranty" className="fo-wizard-control" type="date" value={warrantyExpiresDate}
            aria-describedby={describedBy("equipment-create-warranty", { hasHint: true, hasError: false })}
            onChange={(e) => setWarrantyExpiresDate(e.target.value)} />
        </Field>

        <Field id="equipment-create-notes" label="Notes">
          <input id="equipment-create-notes" className="fo-wizard-control" value={notes}
            onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <FormError role="alert" className="fo-equipment-save-error">{saveError}</FormError>
        <FormStatus>{submitting ? "Saving equipment..." : ""}</FormStatus>

        <FormActions>
          <button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Add Equipment"}</button>
          <button type="button" onClick={requestClose} disabled={submitting}>Cancel</button>
        </FormActions>
      </form>
    </Modal>
  );
}
