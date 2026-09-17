import { useRef, useState } from "react";
import { Field, FormActions, FormError } from "../../shared/ui/form";
import { Button } from "../../shared/ui/primitives/index.js";
import LoadingState from "../../shared/ui/LoadingState";
import { WORKFORCE_READ_STATE, useWorkforceRead } from "../../hooks/useWorkforceRead.js";
import { WORKFORCE_READS } from "../../domain/employeeOperatingProfile.js";
import { WORKFORCE_CAPABILITY_STATE, WORKFORCE_CAPABILITY_SUBJECT } from "../../hooks/useWorkforceCapabilities.js";
import {
  EMPLOYEE_JOB_ROLE_WRITE_CAPABILITY,
  JOB_ROLE_ASSIGN_OPERATION,
  JOB_ROLE_ASSIGN_RESULT,
  JOB_ROLE_REASON_MAX,
  assignableJobRoles,
  describeJobRoleAssignResult,
  jobRoleAssignInput,
} from "../../domain/employeeJobRole.js";
import { WorkforceFailure } from "../employees/EmployeeProfileSections.jsx";

// ASSIGN / CHANGE JOB ROLE -- the governed Job Role control on the Administration Employee record (EMP-RT-08).
//
// ════════════════════ A SEPARATE GOVERNED CONTROL ════════════════════
//
// A Job Role is the Employee's BUSINESS FUNCTION only (Owner ruling 2026-09-16). This control lives inside the Job
// Role section and nowhere else: it is not part of Edit Employee's Save (EmployeeEditPanel sends no Job Role), and it
// is not a Security Role action (UserAccessActions never sees it). Changing a Job Role changes no access.
//
// WHO IS OFFERED IT. Only a caller the PostgreSQL Workforce capability read (readMyWorkforceCapabilities, finding #17)
// says holds admin.employeeJobRole.write -- never admin.employeeProfile.write, which is a different authority, and never
// the Firebase effective-access feed. Everyone else sees the page's usual protected button with the reason. While that
// read is loading nothing is offered or refused; if it FAILED the control says the permissions could not be read and
// offers Retry -- it never claims "not granted" or "not configured" from a read that did not answer. That test decides
// only what to OFFER: the command re-checks the capability server-side, and a 403 renders as "not authorized, nothing saved".
//
// ONE COMMAND, THEN A RE-READ. Save sends exactly { employeeId, jobRoleId, reason? } as ONE assignEmployeeJobRole
// call -- no tenant, principal, actor or capability. The choice is a closed list of the ACTIVE catalog roles from
// listJobRoles (an inactive role is never offered). ASSIGNED / CHANGED closes the form, states the outcome and
// re-reads the history; NO_CHANGE says nothing changed; every refusal is stated exactly and nothing is shown as
// saved. Nothing optimistic: the section shows only what its read returns.
//
// ════════════════════ FAIL CLOSED WHEN THE TENANT IS NOT CONFIGURED ════════════════════
//
// An unconfigured tenant is never presented as a business with zero Job Roles. Two configuration facts must exist:
//   * the administrator grant: a caller the Workforce read says administers Employees (admin.employeeProfile.write) but
//     is not granted admin.employeeJobRole.write means the grant reconciliation has not run for this tenant. Both facts
//     come from ONE successful PostgreSQL answer; a failed read is not evidence of either;
//   * an ACTIVE catalog: for a granted caller the catalog is read up front, and zero ACTIVE roles means the launch
//     catalog has not been seeded.
// Either way the control shows JOB_ROLE_NOT_CONFIGURED_WORDS -- no Assign button, no empty dropdown. A caller who
// administers no Employees keeps the ordinary protected button.

const NO_INPUT = Object.freeze({});

export const JOB_ROLE_NOT_CONFIGURED_WORDS = "Job Role administration is not configured for this tenant.";

const NOT_GRANTED_REASON = `The Workforce service did not grant Job Role assignment (${EMPLOYEE_JOB_ROLE_WRITE_CAPABILITY}) for your account.`;

export default function EmployeeJobRoleControl({
  employeeId,
  workforce,
  canAssign,
  administersEmployees = false,
  // The Workforce capability read's state. Defaults to LOADING, so a caller that does not say offers nothing.
  capabilityStatus = WORKFORCE_CAPABILITY_STATE.LOADING,
  capabilityError = null,
  onRetryCapabilities = null,
  jobRole,
  onReread,
}) {
  const capabilitiesReady = capabilityStatus === WORKFORCE_CAPABILITY_STATE.READY;
  const offered = capabilitiesReady && canAssign === true;
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  // The catalog is read for a granted caller up front, so an unseeded tenant is stated before anything is offered.
  const catalog = useWorkforceRead(WORKFORCE_READS.JOB_ROLE_CATALOG.operation, offered ? NO_INPUT : null, { client: workforce });
  const options = catalog.status === WORKFORCE_READ_STATE.READY ? assignableJobRoles(catalog.data) : [];

  const label = jobRole?.current ? "Change Job Role" : "Assign Job Role";

  const notConfigured = (why) => (
    <div className="ns-emp-edit-notice" data-job-role-control="NOT_CONFIGURED" data-job-role-not-configured={why}>
      <p className="ns-state ns-state--na" role="status">{JOB_ROLE_NOT_CONFIGURED_WORDS}</p>
      <p className="fo-muted ns-emp-note">
        {why === "GRANT"
          ? `Administrator Security Roles have not been granted ${EMPLOYEE_JOB_ROLE_WRITE_CAPABILITY}.`
          : "The company's Job Role catalog has no active Job Role."}
      </p>
    </div>
  );

  if (capabilityStatus === WORKFORCE_CAPABILITY_STATE.FAILED) {
    return (
      <div className="ns-emp-edit-notice" data-job-role-control="CAPABILITIES_UNAVAILABLE">
        <WorkforceFailure error={capabilityError} subject={WORKFORCE_CAPABILITY_SUBJECT} onRetry={onRetryCapabilities} />
      </div>
    );
  }
  if (!capabilitiesReady) {
    return (
      <div data-job-role-control="CHECKING">
        <LoadingState>Checking your Job Role permissions…</LoadingState>
      </div>
    );
  }

  if (!offered && administersEmployees === true) return notConfigured("GRANT");
  if (offered && catalog.status === WORKFORCE_READ_STATE.READY && options.length === 0) return notConfigured("CATALOG");

  if (!offered) {
    return (
      <div className="fo-btn-row" data-job-role-control="NOT_GRANTED">
        <Button variant="protected" id="employee-job-role-assign" reason={NOT_GRANTED_REASON}>
          {label}
        </Button>
      </div>
    );
  }

  const noticeBlock = notice ? (
    <div className="ns-emp-edit-notice" data-job-role-result={notice.state}>
      <p className={notice.state === JOB_ROLE_ASSIGN_RESULT.NOT_CONFIRMED ? "ns-state ns-state--denied" : "ns-state"} role="status">
        {notice.words}
      </p>
    </div>
  ) : null;

  if (!open) {
    return (
      <div data-job-role-control="CLOSED">
        {noticeBlock}
        {jobRole ? (
          <div className="fo-btn-row">
            <Button
              variant="secondary"
              id="employee-job-role-assign"
              onClick={() => {
                setNotice(null);
                setError(null);
                setChoice("");
                setReason("");
                setOpen(true);
              }}
            >
              {label}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submittingRef.current || !choice) return;
    setError(null);
    submittingRef.current = true;
    setSubmitting(true);
    const chosenLabel = options.find((o) => o.value === choice)?.label;
    let outcome;
    try {
      outcome = await workforce.call(JOB_ROLE_ASSIGN_OPERATION, jobRoleAssignInput({ employeeId, jobRoleId: choice, reason }));
    } catch {
      outcome = { ok: false, code: "INTERNAL" };
    }
    submittingRef.current = false;
    setSubmitting(false);
    const described = describeJobRoleAssignResult(outcome, chosenLabel);
    if (described.state === JOB_ROLE_ASSIGN_RESULT.NOT_SAVED) {
      // The form stays open with the person's choice and the exact reason.
      setError(described.words);
      if (described.reread) onReread?.();
      return;
    }
    setOpen(false);
    setNotice(described);
    if (described.reread) onReread?.();
  }

  let chooser;
  if (catalog.status === WORKFORCE_READ_STATE.IDLE || catalog.status === WORKFORCE_READ_STATE.LOADING) {
    chooser = <LoadingState>Reading the Job Role catalog…</LoadingState>;
  } else if (catalog.status === WORKFORCE_READ_STATE.FAILED) {
    chooser = <WorkforceFailure error={catalog.error} subject="The Job Role catalog" onRetry={catalog.reload} readId={WORKFORCE_READS.JOB_ROLE_CATALOG.id} />;
  } else {
    chooser = (
      <>
        <Field id="employee-job-role-choice" label="Job Role" hint="Active Job Roles from this company's catalog. Inactive Job Roles cannot be assigned.">
          <select value={choice} onChange={(e) => { setChoice(e.target.value); setError(null); }} disabled={submitting}>
            <option value="">Choose a Job Role</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="employee-job-role-reason" label="Reason (optional)" hint="Kept with this Job Role in the history.">
          <input type="text" value={reason} maxLength={JOB_ROLE_REASON_MAX} onChange={(e) => setReason(e.target.value)} disabled={submitting} />
        </Field>
      </>
    );
  }

  return (
    <form className="fo-user-edit" onSubmit={handleSubmit} noValidate data-job-role-control="OPEN">
      {chooser}
      {error ? (
        <FormError id="employee-job-role-error" role="alert">
          {error}
        </FormError>
      ) : null}
      <FormActions>
        <Button type="submit" variant="primary" disabled={submitting || !choice || options.length === 0} loading={submitting}>
          Save Job Role
        </Button>{" "}
        <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={submitting}>
          Cancel
        </Button>
      </FormActions>
    </form>
  );
}
