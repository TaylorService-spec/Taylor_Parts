import { useCallback, useRef, useState } from "react";
import RuledSection from "../../shared/ui/RuledSection.jsx";
import { Field, FormActions, FormError } from "../../shared/ui/form";
import { Button } from "../../shared/ui/primitives/index.js";
import {
  EMPLOYMENT_STATUS_OPTIONS,
  OPERATING_COMPANY_OPTIONS,
  OPERATIONAL_ROLE_OPTIONS,
  SECURITY_ROLE_MIRROR_CAPTION,
  changedProfileFields,
  employeeDisplayName,
  newTrustedIdempotencyKey,
  securityRoleWords,
  seedEditValues,
  validateProfileValues,
} from "../../domain/employeeProfile.js";

// EDIT USER -- the deliberate, governed edit of one person's profile and employment record.
//
// ════════════════════ ONE WRITE PATH ════════════════════
//
// Everything this form can change goes through ONE trusted command (updateEmployeeProfile), which
// re-authorizes server-side and writes one Audit Event per changed field. Nothing here writes
// Firestore: `employees` is client-write-denied by Rules and stays that way.
//
// The three things this form CANNOT change are the point of it. Security Role is displayed as
// read-only context and has no control at all -- it is a mirror of the governed Role, and offering
// a control over a mirror would let somebody believe they had changed what a person can do. EOS
// account status has its own confirmed action in the Access & Security section, owned by
// setUserStatus. The Employee-User linkage is written only by the reciprocal provisioning path.
// The command rejects all three by name, so the boundary is enforced rather than merely observed
// by this file.
//
// ════════════════════ THE INDEPENDENCE RULES, STRUCTURALLY ════════════════════
//
// Changing Employment Status here sends employmentStatus and nothing else. Changing Operational
// Roles sends operationalRoles and nothing else. There is no code path in this component that
// writes a second field because a first one changed -- the payload is a diff of what the user
// touched, so a derived change is not something a reviewer has to look for. It cannot be
// expressed.
//
// ════════════════════ THE FORM FREEZES ITS DIFF BASIS AT OPEN ════════════════════
//
// `employee` arrives from a LIVE directory subscription, so its identity changes whenever anyone
// writes this record -- including another administrator, while this form sits open. Diffing the
// seeded values against the LIVE record would silently revert that other person's write on any
// field this user never touched. The seed is frozen with the values, so a difference always means
// "the user changed it", and a save is a field-level merge rather than a last-writer-wins
// overwrite of everything the form happens to be holding.
export default function UserEditPanel({ employee, candidates, client, onClose, onSaved }) {
  const [base] = useState(employee);
  const [values, setValues] = useState(() => seedEditValues(employee));
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  // A fresh key per INTENT, reused on retry, so a save resubmitted after a timeout cannot apply
  // twice. The command's idempotency is deterministic on this key.
  const idempotencyRef = useRef(null);
  if (idempotencyRef.current === null) idempotencyRef.current = newTrustedIdempotencyKey();

  const setField = useCallback((key, value) => {
    setValues((cur) => ({ ...cur, [key]: value }));
    // An error must not outlive the input it describes.
    setErrors((cur) => (cur[key] ? { ...cur, [key]: undefined } : cur));
    setSaveError(null);
  }, []);

  const toggleRole = useCallback((role) => {
    setValues((cur) => {
      const current = Array.isArray(cur.operationalRoles) ? cur.operationalRoles : [];
      const next = current.includes(role) ? current.filter((r) => r !== role) : [...current, role];
      return { ...cur, operationalRoles: next };
    });
    setErrors((cur) => (cur.operationalRoles ? { ...cur, operationalRoles: undefined } : cur));
  }, []);

  // Manager candidates: real employees, from the directory already loaded by the record page. A
  // free-text manager name is what makes a reporting line unfollowable and, eventually, wrong; the
  // command re-validates that the chosen id is an existing employee regardless of what this offers.
  const managerOptions = [...candidates.entries()]
    .filter(([id]) => id !== employee.id)
    .map(([id, record]) => ({ value: id, label: employeeDisplayName(record) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  async function handleSubmit(event) {
    event.preventDefault();
    if (submittingRef.current) return; // duplicate-submit guard
    setSaveError(null);

    const validation = validateProfileValues(values);
    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      return;
    }

    // ONLY WHAT ACTUALLY CHANGED, against the frozen seed. The domain owns this comparison so a
    // unit test pins the real one rather than a copy living in this file.
    const changes = changedProfileFields(values, base);
    if (Object.keys(changes).length === 0) {
      // Not sent. A save that changes nothing is not a request, and the command would refuse an
      // empty change set anyway -- saying so here costs no round trip.
      setSaveError("Nothing was changed.");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    const outcome = await client.updateEmployeeProfile({
      employeeId: employee.id,
      changes,
      idempotencyKey: idempotencyRef.current,
    });
    submittingRef.current = false;
    setSubmitting(false);

    if (outcome.ok) {
      onSaved?.(outcome);
      return;
    }
    setSaveError(
      outcome.result === "DENIED"
        ? "You are not authorized to edit this user. Nothing was saved."
        : outcome.result === "INVALID" && outcome.message
          ? outcome.message
          : outcome.result === "NOT_FOUND"
            ? "This user record could not be found. Nothing was saved."
            : "The user profile service is not available. Nothing was saved.",
    );
  }

  const text = (key, label, extra = {}) => (
    <Field key={key} id={`user-${key.replace(".", "-")}`} label={label} error={errors[key]} {...extra}>
      <input
        type={extra.type ?? "text"}
        value={values[key] ?? ""}
        onChange={(e) => setField(key, e.target.value)}
      />
    </Field>
  );

  return (
    <form className="fo-user-edit" onSubmit={handleSubmit} noValidate>
      <RuledSection title="Edit user" panel>
        <div className="fo-form-grid">
          {text("displayName", "Display Name", { required: true })}
          {text("preferredName", "Preferred Name")}
          {text("firstName", "First Name")}
          {text("middleName", "Middle Name")}
          {text("lastName", "Last Name")}
          {text("employeeNumber", "Employee ID", {
            hint: "Taylor's own employee number. Separate from the internal record id, and blank where none has been assigned.",
          })}
          {text("workEmail", "Work Email", { type: "email" })}
          {text("workPhone", "Work Phone", { type: "tel" })}
          {text("mobilePhone", "Mobile Phone", { type: "tel" })}
          {text("address.street", "Street")}
          {text("address.unit", "Unit / Suite")}
          {text("address.city", "City")}
          {text("address.state", "State")}
          {text("address.postalCode", "ZIP")}
        </div>
      </RuledSection>

      <RuledSection title="Employment" panel>
        <div className="fo-form-grid">
          {text("jobTitle", "Job Title", {
            hint: "Descriptive. A job title grants no permission and sets no role.",
          })}

          <Field id="user-managerEmployeeId" label="Manager" error={errors.managerEmployeeId}>
            <select
              value={values.managerEmployeeId ?? ""}
              onChange={(e) => setField("managerEmployeeId", e.target.value)}
            >
              <option value="">No manager recorded</option>
              {managerOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          <Field id="user-operatingCompanyId" label="Operating Company" error={errors.operatingCompanyId}>
            <select
              value={values.operatingCompanyId ?? ""}
              onChange={(e) => setField("operatingCompanyId", e.target.value)}
            >
              <option value="">Not recorded</option>
              {OPERATING_COMPANY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          {text("hireDate", "Hire Date", { type: "date" })}
          {text("separationDate", "Separation Date", {
            type: "date",
            hint: "Recording a separation date does not disable this person's EOS account. That is a separate, confirmed action.",
          })}

          {/* SINGLE-SELECT, from the canonical six-value vocabulary. Never free text: an
              employment status the eligibility queries cannot classify is a record that quietly
              drops out of every assignment picker. */}
          <Field id="user-employmentStatus" label="Employment Status" required error={errors.employmentStatus}>
            <select
              value={values.employmentStatus ?? ""}
              onChange={(e) => setField("employmentStatus", e.target.value)}
            >
              {EMPLOYMENT_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </RuledSection>

      <RuledSection title="Operational assignment" panel>
        {/* MULTI-SELECT over the canonical operational-role vocabulary -- checkboxes rather than a
            multiple <select>, which is close to unusable on a phone and famously easy to clear by
            accident. A fieldset/legend so the group is announced as one question. */}
        <fieldset className="fo-checkbox-group">
          <legend>Operational Roles</legend>
          {OPERATIONAL_ROLE_OPTIONS.map((o) => (
            <label key={o.value} className="fo-checkbox">
              <input
                type="checkbox"
                checked={(values.operationalRoles ?? []).includes(o.value)}
                onChange={() => toggleRole(o.value)}
              />
              <span>{o.label}</span>
            </label>
          ))}
          {errors.operationalRoles ? <FormError id="user-operationalRoles-error">{errors.operationalRoles}</FormError> : null}
        </fieldset>
        <p className="fo-muted">
          Operational roles are eligibility for work. Changing them does not change this
          person&apos;s Security Role, and never has.
        </p>
      </RuledSection>

      <RuledSection title="Security" panel>
        {/* READ-ONLY, AND NOT A DISABLED CONTROL. A greyed-out <select> would say "you may not
            change this here"; the truth is that changing this value here would change nothing at
            all, because the field is a mirror. So it is rendered as the fact it is. */}
        <dl className="fo-detail-list">
          <dt>Security Role</dt>
          <dd>{securityRoleWords(base) ?? <span className="fo-muted">Not recorded</span>}</dd>
        </dl>
        <p className="fo-muted">
          {SECURITY_ROLE_MIRROR_CAPTION} It is changed through the governed Role assignment
          commands, on Roles &amp; Permissions — never by editing this profile.
        </p>
      </RuledSection>

      {saveError ? <FormError id="user-edit-error">{saveError}</FormError> : null}

      <FormActions>
        <Button type="submit" variant="primary" disabled={submitting} loading={submitting}>
          Save
        </Button>{" "}
        <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
      </FormActions>
    </form>
  );
}
