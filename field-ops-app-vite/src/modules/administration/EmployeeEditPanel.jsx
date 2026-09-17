import { useCallback, useMemo, useRef, useState } from "react";
import RuledSection from "../../shared/ui/RuledSection.jsx";
import { Field, FormActions, FormError } from "../../shared/ui/form";
import { Button } from "../../shared/ui/primitives/index.js";
import { useWorkforceEmployeeDirectory, WORKFORCE_READ_STATE } from "../../hooks/useWorkforceEmployeeDirectory.js";
import {
  EMPLOYEE_EDIT_RESULT,
  MANAGER_FIELD_KEY,
  changedProfileFields,
  describeEmployeeEditResult,
  managerChange,
  saveEmployeeEdit,
  seedEditValues,
  validateProfileValues,
} from "../../domain/employeeProfile.js";
import {
  RUNTIME_DEPENDENCIES,
  describeLifecycle,
  describeWorkforceFailure,
  recordCompanyName,
  recordDisplayName,
} from "../../domain/employeeOperatingProfile.js";
import { RuntimeDependency } from "../employees/EmployeeProfileSections.jsx";

// EDIT EMPLOYEE -- the deliberate, governed edit of one Employee's PROFILE and REPORTING RELATIONSHIP, on the
// governed PostgreSQL record (EMP-RT-01 readEmployee), through the governed Workforce commands (EMP-RT-W1B).
//
// ════════════════════ TWO WRITERS, IN A FIXED ORDER, AND NOTHING ELSE ════════════════════
//
// Save sends updateEmployeeProfile with ONLY the changed profile keys (the seventeen PROFILE_FIELDS), then -- only
// if the Manager changed -- establishReportingRelationship (a new manager) or endReportingRelationship (cleared).
// Profile first: if it is refused nothing else is attempted, so a refusal leaves nothing half-written. If the
// profile lands and the manager command does not, the result says exactly that (domain describeEmployeeEditResult)
// and never claims success. Nothing here writes Firestore or calls a Firebase callable: the legacy
// updateEmployeeProfile callable wrote the retired Firestore record and is no longer reachable from this client.
// No tenant, principal or capability is ever sent -- the server resolves all three from the verified caller, and
// its admin.employeeProfile.write check is the authority; the page's capability test only decides what to offer.
//
// ════════════════════ WHAT THIS FORM CANNOT CHANGE, AND SAYS SO ════════════════════
//
// Employment Status and Operating Company are Employee LIFECYCLE facts. The profile command refuses both by name
// and no governed lifecycle writer is served, so they are shown read-only with that dependency (EMP-RT-W2) -- not
// offered as controls that would fail, and not routed to some other writer. Operational Roles are not part of the
// governed Employee record at all. Security Role and User Access live on the record page's User Access section,
// and Job Role has no governed authority: none of the four is a control here, and none is ever collapsed into
// another or into the Employee.
//
// ════════════════════ THE FORM FREEZES ITS DIFF BASIS AT OPEN ════════════════════
//
// The page re-reads the record after every save, and another administrator may write it while this form is
// open. Diffing against a re-read record would silently revert that other person's write on any field this user
// never touched. The seed is frozen with the values, so a difference always means "the user changed it", and a
// save is a field-level merge rather than a last-writer-wins overwrite of everything the form holds. Resubmitting
// the same values converges (the command answers NO_CHANGE), so a save retried after a timeout cannot double-apply.
//
// ════════════════════ MANAGER CANDIDATES: THE GOVERNED DIRECTORY, ONLY ════════════════════
//
// Real Employees from EMP-RT-01 listEmployees (the same governed read the Users directory uses), excluding this
// Employee -- never free text and never the Firestore directory. The directory is paged; Load more reads the next
// page. A directory that cannot be read leaves the Manager unchangeable here and says why, rather than offering a
// list that silently omits people. The command re-validates the chosen id regardless of what this offers.
export default function EmployeeEditPanel({ employee, workforce, onCancel, onSaved }) {
  const [base] = useState(employee);
  const [values, setValues] = useState(() => seedEditValues(employee));
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const directory = useWorkforceEmployeeDirectory({ client: workforce });

  const setField = useCallback((key, value) => {
    setValues((cur) => ({ ...cur, [key]: value }));
    // An error must not outlive the input it describes.
    setErrors((cur) => (cur[key] ? { ...cur, [key]: undefined } : cur));
    setSaveError(null);
  }, []);

  const managerOptions = useMemo(() => {
    const options = new Map();
    for (const item of directory.items) {
      if (!item?.employeeId || item.employeeId === base.employeeId) continue;
      options.set(item.employeeId, { value: item.employeeId, label: recordDisplayName(item) });
    }
    // The CURRENT manager stays selectable even when the loaded page does not include them, so opening the form
    // never silently proposes "no manager".
    const current = base.currentManager;
    if (current?.managerEmployeeId && !options.has(current.managerEmployeeId)) {
      options.set(current.managerEmployeeId, { value: current.managerEmployeeId, label: recordDisplayName(current) });
    }
    return [...options.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [directory.items, base]);

  const directoryReady = directory.status === WORKFORCE_READ_STATE.READY;
  const directoryFailure = directory.status === WORKFORCE_READ_STATE.FAILED ? describeWorkforceFailure(directory.error, "The Employee directory") : null;
  const managerHint = directoryFailure
    ? `${directoryFailure.words} The manager cannot be changed here until it can be read.`
    : directoryReady
      ? "A real Employee from the governed directory. Changing it ends any current reporting relationship; its history is kept."
      : "Reading the Employee directory…";

  async function handleSubmit(event) {
    event.preventDefault();
    if (submittingRef.current) return; // duplicate-submit guard
    setSaveError(null);

    const validation = validateProfileValues(values, base);
    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      return;
    }

    // ONLY WHAT ACTUALLY CHANGED, against the frozen seed. The domain owns both comparisons so a unit test pins the
    // real ones rather than a copy living in this file.
    const changes = changedProfileFields(values, base);
    const manager = managerChange(values, base);

    submittingRef.current = true;
    setSubmitting(true);
    const saved = await saveEmployeeEdit({ workforce, employeeId: base.employeeId, changes, manager });
    submittingRef.current = false;
    setSubmitting(false);

    const described = describeEmployeeEditResult(saved);
    // Nothing written (or nothing confirmed): the form stays open with the person's values and the exact reason.
    if (saved.state === EMPLOYEE_EDIT_RESULT.NOTHING_CHANGED || saved.state === EMPLOYEE_EDIT_RESULT.NOT_SAVED || saved.state === EMPLOYEE_EDIT_RESULT.NOT_CONFIRMED) {
      setSaveError(described.words);
      return;
    }
    // Something was written: the page closes the form and re-reads the authoritative record. No local copy of
    // what was typed is ever rendered as the record.
    onSaved?.(described);
  }

  const text = (key, label, extra = {}) => (
    <Field key={key} id={`employee-edit-${key.replace(".", "-")}`} label={label} error={errors[key]} hint={extra.hint}>
      <input type={extra.type ?? "text"} value={values[key] ?? ""} onChange={(e) => setField(key, e.target.value)} />
    </Field>
  );

  const lifecycle = describeLifecycle(base.employmentStatus);

  return (
    <form className="fo-user-edit" onSubmit={handleSubmit} noValidate data-employee-edit="OPEN">
      <RuledSection title="Edit Employee record" panel>
        <div className="fo-form-grid">
          {text("displayName", "Display Name")}
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

          <Field id="employee-edit-managerEmployeeId" label="Manager" hint={managerHint}>
            <select
              value={values[MANAGER_FIELD_KEY] ?? ""}
              onChange={(e) => setField(MANAGER_FIELD_KEY, e.target.value)}
              disabled={!directoryReady || submitting}
            >
              <option value="">No manager recorded</option>
              {managerOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          {text("hireDate", "Hire Date", { type: "date" })}
          {text("separationDate", "Separation Date", {
            type: "date",
            hint: "Recording a separation date does not change Employment Status or disable this person's EOS account. Those are separate.",
          })}
        </div>
        {directoryReady && directory.hasMore ? (
          <div className="fo-btn-row">
            <Button type="button" variant="secondary" onClick={directory.loadMore} disabled={directory.loadingMore} loading={directory.loadingMore}>
              Load more Employees
            </Button>
          </div>
        ) : null}
        {directoryFailure?.retryable ? (
          <div className="fo-btn-row">
            <Button type="button" variant="secondary" onClick={directory.retry}>
              Retry the Employee directory
            </Button>
          </div>
        ) : null}
      </RuledSection>

      {/* READ-ONLY, WITH ITS AUTHORITY NAMED. Not disabled controls: a disabled select still reads as "you could
          change this with a different permission", which is not the truth -- nobody can, here, yet. */}
      <RuledSection title="Employee lifecycle" meta="Not edited here" panel>
        <dl className="fo-detail-list ns-emp-facts" data-employee-edit-locked="LIFECYCLE">
          <dt>Employment Status</dt>
          <dd>{lifecycle.words}</dd>
          <dt>Operating Company</dt>
          <dd>{recordCompanyName(base) ?? (base.operatingCompanyId ? "Unavailable" : "Not recorded")}</dd>
        </dl>
        <p className="fo-muted ns-emp-note">
          Employment Status and Operating Company are governed by the Employee lifecycle authority, which is not yet
          available, so they are not changed from this form. Operational Roles are not part of the governed Employee
          record, and Security Roles are User Access — neither is edited here.
        </p>
        <RuntimeDependency dependency={RUNTIME_DEPENDENCIES.LIFECYCLE_WRITER} lead="Changing the Employee lifecycle is not available." />
      </RuledSection>

      {saveError ? (
        <FormError id="employee-edit-error" role="alert">
          {saveError}
        </FormError>
      ) : null}

      <FormActions>
        <Button type="submit" variant="primary" disabled={submitting} loading={submitting}>
          Save
        </Button>{" "}
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </FormActions>
    </form>
  );
}
