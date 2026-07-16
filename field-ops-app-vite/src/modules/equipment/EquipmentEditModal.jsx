import { useCallback, useRef, useState } from "react";
import Modal from "../../shared/ui/Modal";
import { Field, FormActions, FormError, FormStatus } from "../../shared/ui/form";
import { describedBy } from "../../shared/ui/form/fieldA11y";
import { EDITABLE_EQUIPMENT_FIELDS, changedEquipmentFields } from "../../domain/equipment";

// Issue #232 unit E8 -- ordinary Equipment editing, on the same shared Modal +
// form-primitive pattern as EquipmentCreateModal (E6). Close paths are ignored and a
// second submit is blocked while the write is in flight; nothing is persisted on failure.
//
// WHAT THIS FORM MAY CHANGE is exactly EDITABLE_EQUIPMENT_FIELDS -- the descriptive and
// optional fields of Spec §6. The list is imported rather than retyped, so a field added
// to the domain contract cannot silently go missing here, and one removed there cannot
// linger here as a control that writes a key the payload builder drops.
//
// IDENTITY AND OWNERSHIP ARE READ-ONLY (Spec §6). Customer and Location are SHOWN, not
// offered: an installed asset's owner is not a detail you correct in passing, and its
// Location changes only through the move action (§5), which is audited. Rendering them
// read-only rather than omitting them is the honest choice -- they are load-bearing
// context for the edit, and hiding them would make the form look like it applies to an
// asset with no owner. E1 refuses a governed change, E2 refuses the write, and E3's
// Rules refuse it server-side; this form simply never asks.
//
// STATUS IS DELIBERATELY ABSENT, and this is not an oversight. Spec §3 defines
// ACTIVE<->INACTIVE as `setStatus` -- a named ACTION whose confirmation is "plain",
// as opposed to retire's "confirm" -- not a field on this form. Spec §6's "status
// (ACTIVE<->INACTIVE via the plain path)" names that action's plain path. E10 owns all
// four lifecycle actions and, per the Owner's E3 decision, resolves the ACTIVE<->INACTIVE
// path question. Ordinary edit treats status as governed and refuses it.
//
// RETIRED EQUIPMENT IS EDITABLE HERE, per the Owner's E3 decision (2): ordinary
// corrections to descriptive fields remain allowed on a retired asset, while status,
// accountId and locationId stay unchanged and hard deletion stays denied. A typo in a
// serial number is still worth fixing after the asset leaves service.
export default function EquipmentEditModal({ equipment, accountName, locationName, onSave, onClose }) {
  // THE FORM AND ITS DIFF BASIS ARE FROZEN TOGETHER, at open. `equipment` arrives from a
  // LIVE onSnapshot subscription, so its identity changes whenever anyone writes this
  // record -- including another session, while this modal sits open.
  //
  // Diffing the seeded values against the LIVE record loses that other session's write:
  //
  //   open:      { name: "RTU 1", manufacturer: "Carrier" }   -- form seeds "Carrier"
  //   meanwhile: session B saves manufacturer: "Trane"        -- prop updates, form does not
  //   user:      retypes the name only, saves
  //   diff(values@open, equipment@submit) -> { name: "RTU 2", manufacturer: "Carrier" }
  //                                          ^ reverts B, a field this user never touched
  //   diff(values@open, equipment@open)   -> { name: "RTU 2" }   -- correct field merge
  //
  // The values were seeded from THIS record, so it is the only honest thing to compare
  // them against: a difference must mean "the user changed it", never "the record moved
  // underneath them". Freezing is what makes the diff a field-level merge rather than a
  // last-writer-wins overwrite of everything the form happens to be holding.
  const [base] = useState(equipment);

  // `?? ""` because a controlled input needs a string and the stored optional fields are
  // null -- not because null and "" mean the same thing; the diff maps "" back to null.
  // Non-strings are coerced away rather than trusted: Rules forbid them, so one here
  // would be a record we cannot render, not a value to put in a text box.
  const [values, setValues] = useState(() =>
    Object.fromEntries(EDITABLE_EQUIPMENT_FIELDS.map(
      (f) => [f, typeof base[f] === "string" ? base[f] : ""])));
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const nameError =
    (submitAttempted && !values.name.trim() ? "Enter an equipment name." : null) ?? fieldErrors.name ?? null;

  const setField = (field, value) => {
    setValues((cur) => ({ ...cur, [field]: value }));
    // Drop a field's SERVER error as soon as the user edits that field -- an error must
    // not outlive the input it describes (the same rule E6 arrived at).
    setFieldErrors((cur) => (cur[field] ? { ...cur, [field]: undefined } : cur));
  };

  // The useCallback is DEFENSIVE, not load-bearing -- keep it, but do not read it as
  // required. Modal reads onClose through a ref and mounts its focus effect on [], so a
  // fresh identity each render costs nothing (#293, PR #296). Verified, not assumed:
  // removing it leaves the E8 browser gate fully green, which is the root fix holding
  // rather than a gap in the gate. Requiring useCallback of every caller was the trap
  // that shipped E6's unusable create form.
  const requestClose = useCallback(() => {
    // Close-during-save protection: a close while the write is in flight is ignored, so
    // the modal cannot disappear before its own result is known.
    if (submittingRef.current) return;
    onClose();
  }, [onClose]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (submittingRef.current) return; // duplicate-submit guard
    setSubmitAttempted(true);
    setSaveError(null);
    setFieldErrors({});
    if (!values.name.trim()) return;

    // SEND ONLY WHAT ACTUALLY CHANGED -- the domain owns this comparison (it is not
    // `!==`; see changedEquipmentFields). Deliberately NOT reimplemented here: a copy
    // in this file would be a second definition for the unit test to pin, and the test
    // would then prove things about the copy rather than about what this form sends.
    // Against `base`, not the live prop -- see the freeze at the top.
    const changed = changedEquipmentFields(values, base);

    submittingRef.current = true;
    setSubmitting(true);
    try {
      // `before` is the record this edit was actually based on -- the same frozen `base`
      // the diff used, so the evidence and the diff can never disagree about what the
      // record looked like.
      //
      // It is DEFENSIVE, and the honest statement of why: changedEquipmentFields iterates
      // EDITABLE_EQUIPMENT_FIELDS, so this form cannot produce a governed key even if its
      // state were polluted with one -- which means `before` has nothing to prove today,
      // and removing it leaves the gate green. It is passed anyway so that IF a governed
      // key ever reached E2 from here, it would be refused as a proven change rather than
      // silently unprovable (#287).
      const result = await onSave(changed, base);
      if (!result?.ok) {
        setFieldErrors(result?.errors ?? {});
        setSaveError(result?.message ?? "Could not save this equipment. Nothing was saved — please try again.");
      }
      // On success the parent closes -- "closes once" stays the parent's single
      // decision rather than a race between the two components.
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Edit Equipment" onClose={requestClose} closeLabel="Close">
      <form className="fo-form fo-create-modal-form" onSubmit={handleSubmit}>
        {/* Ownership as context, stated as fact rather than offered as a control. */}
        <dl className="fo-detail-list fo-equipment-edit-fixed">
          <dt>Customer</dt>
          <dd data-equipment-edit-account>{accountName}</dd>
          <dt>Location</dt>
          <dd data-equipment-edit-location>{locationName}</dd>
        </dl>
        <p className="fo-muted">
          The customer and location can't be changed here. Use <strong>Move</strong> to install this
          equipment at a different location.
        </p>

        <Field id="equipment-edit-name" label="Equipment name" required error={nameError} hint="e.g. Rooftop Unit 1">
          <input
            id="equipment-edit-name"
            className="fo-wizard-control"
            value={values.name}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={describedBy("equipment-edit-name", { hasHint: true, hasError: Boolean(nameError) })}
            onChange={(e) => setField("name", e.target.value)}
          />
        </Field>

        <Field id="equipment-edit-manufacturer" label="Manufacturer">
          <input id="equipment-edit-manufacturer" className="fo-wizard-control" value={values.manufacturer}
            onChange={(e) => setField("manufacturer", e.target.value)} />
        </Field>

        <Field id="equipment-edit-model" label="Model">
          <input id="equipment-edit-model" className="fo-wizard-control" value={values.model}
            onChange={(e) => setField("model", e.target.value)} />
        </Field>

        <Field id="equipment-edit-serial" label="Serial number">
          <input id="equipment-edit-serial" className="fo-wizard-control" value={values.serialNumber}
            onChange={(e) => setField("serialNumber", e.target.value)} />
        </Field>

        <Field id="equipment-edit-asset-tag" label="Asset tag">
          <input id="equipment-edit-asset-tag" className="fo-wizard-control" value={values.assetTag}
            onChange={(e) => setField("assetTag", e.target.value)} />
        </Field>

        <Field id="equipment-edit-installed" label="Installed date" hint="YYYY-MM-DD">
          <input id="equipment-edit-installed" className="fo-wizard-control" type="date" value={values.installedDate}
            aria-describedby={describedBy("equipment-edit-installed", { hasHint: true, hasError: false })}
            onChange={(e) => setField("installedDate", e.target.value)} />
        </Field>

        <Field id="equipment-edit-warranty" label="Warranty expires" hint="YYYY-MM-DD">
          <input id="equipment-edit-warranty" className="fo-wizard-control" type="date" value={values.warrantyExpiresDate}
            aria-describedby={describedBy("equipment-edit-warranty", { hasHint: true, hasError: false })}
            onChange={(e) => setField("warrantyExpiresDate", e.target.value)} />
        </Field>

        <Field id="equipment-edit-notes" label="Notes">
          <input id="equipment-edit-notes" className="fo-wizard-control" value={values.notes}
            onChange={(e) => setField("notes", e.target.value)} />
        </Field>

        <FormError role="alert" className="fo-equipment-save-error">{saveError}</FormError>
        <FormStatus>{submitting ? "Saving changes..." : ""}</FormStatus>

        <FormActions>
          <button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Save Changes"}</button>
          <button type="button" onClick={requestClose} disabled={submitting}>Cancel</button>
        </FormActions>
      </form>
    </Modal>
  );
}
