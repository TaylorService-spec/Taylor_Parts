import { useRef, useState } from "react";
import Modal from "../../shared/ui/Modal";
import { Field, FormActions, FormError, FormStatus } from "../../shared/ui/form";
import { describedBy } from "../../shared/ui/form/fieldA11y";
import { technicianSaveErrorMessage } from "../../domain/legacyCreateSaveErrors";

// Issue #214 PR-5 -- the create form that used to sit above the live Technicians
// table, moved into the shared accessible Modal on the System-A form primitives.
// Fields (Name, optional Phone), the required-Name validation meaning, and the
// exact createTechnician(name, phone) payload and write path are PRESERVED from
// the old inline form -- presentation/container change only.
//
// `onCreate({ name, phone })` performs the write and, on success, closes + announces
// + focuses the new row. It THROWS on a blocked/denied write, caught here to keep
// the modal open with safe copy. Every close path is ignored and a second submit
// blocked while the write is in flight.
export default function NewTechnicianModal({ onCreate, onClose }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const nameError = submitAttempted && !name.trim() ? "Enter a technician name." : null;

  // DELIBERATELY a plain function, NOT useCallback -- and this is load-bearing for the
  // test suite, not just close-during-save. A plain declaration gets a fresh identity
  // every render, which makes this modal a CANARY for #293: Modal's mount/focus effect is
  // now [] and reads onClose through a ref (#293/PR #296), so onClose identity no longer
  // matters -- but if that regressed to [onClose], THIS caller's changing identity would
  // tear the focus effect down every render and yank focus mid-type, and
  // verify-modal-typing would catch it. Memoize this and the suite goes immune to exactly
  // the regression it exists to catch. Modal does NOT require useCallback (see #302).
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
    if (!trimmedName) return; // same required meaning as before
    const trimmedPhone = phone.trim();

    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onCreate({ name: trimmedName, phone: trimmedPhone });
    } catch (err) {
      console.error("Technician create failed:", err);
      setSaveError(technicianSaveErrorMessage(err));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal title="New Technician" onClose={requestClose} closeLabel="Close">
      <form className="fo-form fo-create-modal-form" onSubmit={handleSubmit}>
        <Field id="tech-name" label="Name" required error={nameError}>
          <input
            id="tech-name"
            className="fo-wizard-control"
            value={name}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={describedBy("tech-name", { hasError: Boolean(nameError) })}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field id="tech-phone" label="Phone" hint="Optional">
          <input id="tech-phone" className="fo-wizard-control" value={phone}
            aria-describedby={describedBy("tech-phone", { hasHint: true })}
            onChange={(e) => setPhone(e.target.value)} />
        </Field>

        <FormError role="alert" className="fo-technician-save-error">{saveError}</FormError>
        <FormStatus>{submitting ? "Saving…" : ""}</FormStatus>

        <FormActions>
          <button type="submit" disabled={submitting}>{submitting ? "Saving…" : "New Technician"}</button>
          <button type="button" onClick={requestClose} disabled={submitting}>Cancel</button>
        </FormActions>
      </form>
    </Modal>
  );
}
