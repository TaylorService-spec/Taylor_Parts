import { useRef, useState } from "react";
import Modal from "../../shared/ui/Modal";
import { Field, FormActions, FormError, FormStatus } from "../../shared/ui/form";
import { describedBy } from "../../shared/ui/form/fieldA11y";
import { contactSaveErrorMessage } from "../../domain/accountChildSaveErrors";

// Issue #214 PR-2 -- Contact creation moved out of the inline form that used to
// sit below the live Contacts list and into the shared Modal, on the System-A
// form primitives (Field / FormActions / FormError / FormStatus). The account is
// FIXED by the surrounding Account Detail route (shown, never user-selectable or
// CSV-mappable). Fields, payload, validation, permissions, the client-direct
// write path (domain/contacts.js createContact), and the default isPrimary=false
// behavior are all preserved from the old inline form -- this is a
// presentation/container change only.
//
// `onCreate(payload)` performs the write and, on success, closes this modal +
// announces + moves focus to the new row (in AccountDetail). It THROWS on a
// blocked/denied write, which this component catches to keep the modal open with
// safe categorized copy -- nothing is persisted on failure. While the write is in
// flight, every close path (Escape / backdrop / close button / Cancel) is ignored
// and a second submit is blocked.
export default function ContactCreateModal({ accountName, onCreate, onClose }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const nameError = submitAttempted && !name.trim() ? "Enter a contact name." : null;

  // Every close path routes here; ignored while a save is in flight.
  function requestClose() {
    if (submittingRef.current) return;
    onClose();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submittingRef.current) return; // block duplicate submit
    setSubmitAttempted(true);
    setSaveError(null);
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const payload = {
      name: trimmedName,
      phone: phone.trim() || null,
      email: email.trim() || null,
      isPrimary,
    };
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onCreate(payload); // parent writes + on success closes/announces/focuses
    } catch (err) {
      // Keep the modal open; show safe copy only (never a raw Firebase detail).
      console.error("Contact create failed:", err);
      setSaveError(contactSaveErrorMessage(err));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Add Contact" onClose={requestClose} closeLabel="Close">
      <form className="fo-form fo-create-modal-form" onSubmit={handleSubmit}>
        <p className="fo-muted">
          Adding to: <strong>{accountName}</strong> (the customer is fixed and cannot be changed here).
        </p>

        <Field id="contact-name" label="Name" required error={nameError}>
          <input
            id="contact-name"
            className="fo-wizard-control"
            value={name}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={describedBy("contact-name", { hasError: Boolean(nameError) })}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field id="contact-phone" label="Phone">
          <input id="contact-phone" className="fo-wizard-control" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>

        <Field id="contact-email" label="Email">
          <input id="contact-email" className="fo-wizard-control" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>

        <div className="fo-form-field">
          <label className="fo-checkbox-label">
            <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
            Primary Contact
          </label>
        </div>

        <FormError role="alert" className="fo-contact-save-error">{saveError}</FormError>
        <FormStatus>{submitting ? "Saving contact..." : ""}</FormStatus>

        <FormActions>
          <button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Add Contact"}</button>
          <button type="button" onClick={requestClose} disabled={submitting}>Cancel</button>
        </FormActions>
      </form>
    </Modal>
  );
}
