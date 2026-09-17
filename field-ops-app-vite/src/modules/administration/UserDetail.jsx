import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { administrationUsersClient } from "../../access/administrationUsersClient";
import { callPolicyApi } from "../../services/adminPolicyApiClient.js";
import { workforceApiClient } from "../../services/workforceApiClient.js";
import { WORKFORCE_READ_STATE, useWorkforceRead } from "../../hooks/useWorkforceRead.js";
import { WORKFORCE_CAPABILITY_STATE, WORKFORCE_CAPABILITY_SUBJECT, useWorkforceCapabilities } from "../../hooks/useWorkforceCapabilities.js";
import { CREDENTIAL_STATE, usePrincipalCredential } from "../../hooks/usePrincipalCredential.js";
import LoadingState from "../../shared/ui/LoadingState";
import RecordIdentity from "../../shared/ui/RecordIdentity.jsx";
import RuledSection from "../../shared/ui/RuledSection.jsx";
import StructuredFields from "../../shared/ui/StructuredFields.jsx";
import ChangeHistory from "../../shared/ui/ChangeHistory.jsx";
import { Button } from "../../shared/ui/primitives/index.js";
import { normalizeHistoryRows } from "../../domain/changeHistory.js";
import {
  EMPLOYEE_EVENT_LABELS,
  EMPLOYEE_HISTORY_FIELD_LABELS,
  EMPLOYEE_FIELD_LABELS,
  EMPLOYEE_TARGET_TYPE,
} from "../../domain/employeeProfile.js";
import UserAccessActions from "./UserAccessActions.jsx";
import EmployeeEditPanel from "./EmployeeEditPanel.jsx";
import EmployeeJobRoleControl from "./EmployeeJobRoleControl.jsx";
import EmployeeChangeHistorySection from "./EmployeeChangeHistorySection.jsx";
import { EMPLOYEE_JOB_ROLE_WRITE_CAPABILITY } from "../../domain/employeeJobRole.js";
import {
  RUNTIME_DEPENDENCIES,
  WORKFORCE_READS,
  describeLifecycle,
  describeManager,
  describeUserAccessRelationship,
  describeWorkforceFailure,
  recordCompanyName,
  recordDisplayName,
  recordEmploymentFields,
  recordIdentityFields,
  recordNameIsAbsent,
  recordSubtitle,
} from "../../domain/employeeOperatingProfile.js";
import {
  EmployeeLifecycle,
  JobRoleSection,
  ManagedEmployeesSection,
  ManagerFact,
  PrincipalLinkDetails,
  ResponsibilitySection,
  SourceSection,
  UserAccessRelationship,
  WorkforceFailure,
} from "../employees/EmployeeProfileSections.jsx";

// ADMINISTRATION → USERS → one Employee. The Employee operating profile (Employee design v4.1, NS2-EMP-05a/10).
//
// ════════════════════ EMPLOYEE BUSINESS DATA: THE GOVERNED WORKFORCE TRANSPORT, ONLY ════════════════════
//
// Every Employee business fact on this page -- identity, contact, lifecycle, operating company, job title, dates,
// the current manager, owned records, accountabilities and managed employees -- is read from the governed
// PostgreSQL Workforce transport (services/workforceApiClient.js, #1913): EMP-RT-01 readEmployee, EMP-RT-02
// readEmployeePrincipalLink, EMP-RT-03 / EMP-RT-04 responsibility reads, EMP-RT-06 listManagedEmployees. The
// Firestore employee directory is not read here at all, and nothing falls back to it: a refused read says
// "not available to you", a failed read says it could not be loaded.
//
// Edits go the same way: the profile facts and the reporting relationship are written only by the governed Workforce
// commands (EMP-RT-W1B updateEmployeeProfile, establishReportingRelationship, endReportingRelationship), and the
// page then RE-READS the record from the same transport. See "EDITING" below.
//
// ════════════════════ WHAT REMAINS ON LEGACY CALLABLES, AND WHY ════════════════════
//
//   * Account status, governed Role add/remove and password reset (UserAccessActions): USER ACCESS / security
//     concerns keyed by the Firebase Auth uid -- the CREDENTIAL. The uid is reached along the governed chain
//     Employee -> EMP-RT-02 link -> Principal -> (identity provider, external subject) from the Administration
//     API's listTenantPrincipals. Never from an Employee document.
//   * Legacy Change History (listRecordChangeHistory): the legacy audit trail -- pre-cutover profile changes and
//     account/Role events. Kept visible and labelled as the pre-cutover legacy trail.
//
// ════════════════════ TWO HISTORIES, NEVER MERGED ════════════════════
//
//   * Change History (EMP-RT-H1 listEmployeeChangeHistory): the GOVERNED trail -- every change made through the
//     governed Workforce commands (profile, manager, Employment Status, Operating Company, Job Role), read from the
//     PostgreSQL audit authority. Re-read after a saved edit and after a Job Role assignment.
//   * Legacy Change History (above): what happened before the cutover. Its rows are not copied into, merged with or
//     de-duplicated against the governed trail; each section says which trail it is.
//
// ════════════════════ EDITING: THE GOVERNED WORKFORCE COMMANDS, AND THEN A RE-READ ════════════════════
//
// PostgreSQL is the Employee profile authority after the copy-once cutover (#1913, Owner ruling F, no dual write),
// and the governed PostgreSQL writers are served (EMP-RT-W1A commands on the W1B transport). Edit Employee opens
// EmployeeEditPanel, which sends only the changed profile facts and, separately, the reporting relationship change
// -- never Employment Status, Operating Company, Operational Roles, a Security Role or a Job Role. The legacy
// updateEmployeeProfile Firebase callable (which wrote the retired Firestore record) is not reachable from this
// client any more: the seam no longer exports it.
//
// WHO IS OFFERED IT (Workforce census finding #17). The Workforce offer is decided by readMyWorkforceCapabilities
// (hooks/useWorkforceCapabilities.js): the caller's PostgreSQL capabilities -- the SAME set the Workforce commands
// re-check -- and never by the Firebase effective-access feed, so the offer and the authorization cannot disagree.
// Callers it says hold admin.employeeProfile.write get a working button (and `?edit=1` opens the form); everyone else
// keeps the protected button with that reason. While it is loading nothing is offered and nothing is refused; when it
// fails the page says the permissions could not be read -- never "not granted" and never "not configured". That test
// only decides what to OFFER: the command re-checks the capability server-side, and a 403 renders as "not authorized,
// nothing saved" inside the form -- it is never hidden or turned into success.
//
// JOB ROLE IS NOT EDIT EMPLOYEE. The Job Role section (EMP-RT-08) has its own control, offered only to callers the
// same Workforce read says hold admin.employeeJobRole.write (EmployeeJobRoleControl), and its own re-read after a change.
//
// USER ACCESS IS STILL THE FEED. `hasCapability` (the app-wide Firebase feed) is passed ONLY to the account and Role
// actions (UserAccessActions), whose authorities still live there. It decides nothing about Workforce controls.
//
// NO OPTIMISTIC STATE. After a save that wrote something the form closes, the outcome is stated in words, and
// record.reload() re-reads EMP-RT-01. A refused Save saved nothing and says so; there is no partial save. The page shows
// only what that read returns; the rail sections remount with the record and re-read too.
export default function UserDetail({
  client = administrationUsersClient,
  workforce = workforceApiClient,
  policyCall = callPolicyApi,
  hasCapability,
}) {
  const { employeeId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth() ?? {};
  const [searchParams] = useSearchParams();
  const editRequested = searchParams.get("edit") === "1";

  // THE WORKFORCE OFFER: PostgreSQL, read once per mount (and on Retry). Denied while loading, failed or signed out.
  const workforceCapabilities = useWorkforceCapabilities({ client: workforce, principalKey: user?.uid ?? null });
  const capabilitiesReady = workforceCapabilities.status === WORKFORCE_CAPABILITY_STATE.READY;
  const capabilitiesFailed = workforceCapabilities.status === WORKFORCE_CAPABILITY_STATE.FAILED;
  const canEdit = workforceCapabilities.has(EMPLOYEE_PROFILE_WRITE_CAPABILITY);
  // A SEPARATE authority (Owner ruling EMP-RT-08): admin.employeeProfile.write never offers the Job Role control.
  const canAssignJobRole = workforceCapabilities.has(EMPLOYEE_JOB_ROLE_WRITE_CAPABILITY);
  // `?edit=1` opens the form once the capability is known; Cancel or a save closes it and it stays closed.
  const [editOpen, setEditOpen] = useState(false);
  const [editClosed, setEditClosed] = useState(false);
  const [editNotice, setEditNotice] = useState(null);
  const editing = canEdit && (editOpen || (editRequested && !editClosed));

  const record = useWorkforceRead(WORKFORCE_READS.EMPLOYEE_RECORD.operation, employeeId ? { employeeId } : null, { client: workforce });
  const employee = record.status === WORKFORCE_READ_STATE.READY ? record.data : null;
  const linked = employee?.userAccess === "LINKED";

  // EMP-RT-02 only when EMP-RT-01 says a link exists. The server decides whether this caller may read it.
  const principalLink = useWorkforceRead(
    WORKFORCE_READS.PRINCIPAL_LINK.operation,
    linked ? { employeeId } : null,
    { client: workforce },
  );
  const principalId = principalLink.status === WORKFORCE_READ_STATE.READY ? principalLink.data?.link?.principalId ?? null : null;
  const credential = usePrincipalCredential(principalId, { policyCall });

  // ── GOVERNED CHANGE HISTORY (EMP-RT-H1): bumped after anything on this page writes the Employee.
  const [governedHistoryKey, setGovernedHistoryKey] = useState(0);
  const rereadGovernedHistory = () => setGovernedHistoryKey((n) => n + 1);

  // ── LEGACY CHANGE HISTORY (pre-cutover audit trail), read through the trusted callable.
  const [history, setHistory] = useState({ loading: true, rows: [], unavailable: null });
  const [historyNonce, setHistoryNonce] = useState(0);
  useEffect(() => {
    if (!employeeId) return undefined;
    let alive = true;
    setHistory((s) => ({ ...s, loading: true }));
    client
      .listRecordChangeHistory({ targetType: EMPLOYEE_TARGET_TYPE, targetId: employeeId })
      .then((outcome) => {
        if (!alive) return;
        if (outcome.ok) {
          setHistory({ loading: false, rows: outcome.rows, unavailable: null });
        } else {
          setHistory({
            loading: false,
            rows: [],
            unavailable:
              outcome.result === "DENIED"
                ? "You are not authorized to read this record's change history."
                : "The change history requires the trusted audit read, which is not deployed and verified yet.",
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [client, employeeId, historyNonce]);

  const historyRows = useMemo(
    () =>
      normalizeHistoryRows(history.rows, {
        fieldLabels: { ...EMPLOYEE_FIELD_LABELS, ...EMPLOYEE_HISTORY_FIELD_LABELS },
        eventLabels: EMPLOYEE_EVENT_LABELS,
      }),
    [history.rows],
  );

  const backToUsers = (
    <Button variant="secondary" onClick={() => navigate("/administration/users")}>
      Back to Users
    </Button>
  );

  if (record.status === WORKFORCE_READ_STATE.IDLE || record.status === WORKFORCE_READ_STATE.LOADING) {
    return (
      <div className="ns-page fo-user-detail">
        <LoadingState>Loading Employee…</LoadingState>
      </div>
    );
  }

  // A refusal, a not-found and an outage are three different facts, and none of them is an empty record.
  if (record.status === WORKFORCE_READ_STATE.FAILED) {
    return (
      <div className="ns-page fo-user-detail" data-employee-record="FAILED">
        {/* A save that wrote something is still stated when the re-read after it fails. */}
        {editNotice ? <EditNotice notice={editNotice} /> : null}
        <WorkforceFailure error={record.error} subject="This Employee record" onRetry={record.reload} readId={WORKFORCE_READS.EMPLOYEE_RECORD.id} />
        <div className="fo-btn-row">{backToUsers}</div>
      </div>
    );
  }

  const name = recordDisplayName(employee);
  const lifecycle = describeLifecycle(employee.employmentStatus);
  const manager = describeManager(employee);
  const access = describeUserAccessRelationship(employee.userAccess);
  // The ONLY shape UserAccessActions needs: whom to name, and the credential subject its callables take.
  const accountSubject =
    credential.status === CREDENTIAL_STATE.RESOLVED ? { displayName: name, userId: credential.subject } : null;

  return (
    <div className="ns-page fo-user-detail" data-employee-record="READY" data-workforce-capabilities={workforceCapabilities.status}>
      <div className="ns-page__utility">
        <span className="ns-page__context">
          <Link to="/administration/users">Users</Link>
          {` → ${name}`}
        </span>
      </div>
      <div className="ns-rulepair" />

      <RecordIdentity
        kicker="Employee record"
        reference={recordNameIsAbsent(employee) ? null : name}
        fallbackName={name}
        subtitle={recordSubtitle(employee)}
        statusWords={lifecycle.words}
        statusTone={lifecycle.tone}
        facts={[
          { key: "company", label: "Company", value: recordCompanyName(employee) },
          { key: "access", label: "User Access", value: access.words },
        ]}
        actions={
          // Loading: nothing offered and nothing refused yet. Failed: protected, saying the permissions could not be read.
          !capabilitiesReady && !capabilitiesFailed ? null : canEdit ? (
            editing ? null : (
              <Button
                variant="primary"
                id="employee-edit"
                data-user-action="edit"
                onClick={() => {
                  setEditNotice(null);
                  setEditOpen(true);
                }}
              >
                Edit Employee
              </Button>
            )
          ) : (
            <Button
              variant="protected"
              id="employee-edit"
              data-user-action="edit"
              reason={capabilitiesFailed ? capabilityFailureWords(workforceCapabilities.error) : EDIT_NOT_GRANTED_REASON}
            >
              Edit Employee
            </Button>
          )
        }
      />

      {editRequested && capabilitiesFailed ? (
        <div className="ns-emp-edit-notice" data-employee-edit="CAPABILITIES_UNAVAILABLE">
          <WorkforceFailure error={workforceCapabilities.error} subject={WORKFORCE_CAPABILITY_SUBJECT} onRetry={workforceCapabilities.reload} />
        </div>
      ) : null}

      {editRequested && capabilitiesReady && !canEdit ? (
        <div className="ns-emp-edit-notice" data-employee-edit="NOT_GRANTED">
          <p className="ns-state ns-state--denied">{`Editing this Employee is not available to you. ${EDIT_NOT_GRANTED_REASON}`}</p>
        </div>
      ) : null}

      {editNotice ? <EditNotice notice={editNotice} /> : null}

      {editing ? (
        <EmployeeEditPanel
          employee={employee}
          workforce={workforce}
          onCancel={() => {
            setEditOpen(false);
            setEditClosed(true);
          }}
          onSaved={(described) => {
            setEditOpen(false);
            setEditClosed(true);
            setEditNotice(described);
            // Re-read the authority. Never render what was typed as the record.
            record.reload();
            rereadGovernedHistory();
          }}
        />
      ) : null}

      <div className="ns-record-body">
        <div>
          <RuledSection title="Identity & contact">
            <StructuredFields fields={recordIdentityFields(employee)} label="Identity and contact" />
          </RuledSection>

          <RuledSection title="Employment & business context">
            <dl className="fo-detail-list ns-emp-facts">
              <dt>Employee status</dt>
              <dd>
                <EmployeeLifecycle status={employee.employmentStatus} />
              </dd>
            </dl>
            <StructuredFields fields={recordEmploymentFields(employee)} label="Employment" />
            <ManagerFact manager={manager} />
          </RuledSection>

          {/* JOB ROLE (EMP-RT-08): business function only, its own section and its own governed control --
              not part of Edit Employee's Save and not part of User Access / Security Roles below. */}
          <JobRoleSection
            employeeId={employee.employeeId}
            client={workforce}
            control={({ jobRole, reload }) => (
              <EmployeeJobRoleControl
                employeeId={employee.employeeId}
                workforce={workforce}
                canAssign={canAssignJobRole}
                administersEmployees={canEdit}
                capabilityStatus={workforceCapabilities.status}
                capabilityError={workforceCapabilities.error}
                onRetryCapabilities={workforceCapabilities.reload}
                jobRole={jobRole}
                onReread={() => {
                  reload();
                  rereadGovernedHistory();
                }}
              />
            )}
          />

          {/* USER ACCESS, SEPARATE FROM THE EMPLOYEE: linkage (EMP-RT-01), the governed Principal link
              (EMP-RT-02, server-gated), and the account/Role actions on the credential behind that Principal. */}
          <RuledSection title="User Access" meta="Access to EOS — separate from the Employee record">
            <UserAccessRelationship userAccess={employee.userAccess} />
            {linked ? <PrincipalLinkDetails read={principalLink} /> : null}
            <p className="fo-muted ns-emp-note">
              Security Roles are access. They are not Job Roles and are never used as one.
            </p>
            <AccountActions
              linked={linked}
              principalLink={principalLink}
              credential={credential}
              accountSubject={accountSubject}
              actorUid={user?.uid ?? ""}
              hasCapability={hasCapability}
              client={client}
            />
          </RuledSection>
        </div>

        <aside className="ns-rail" aria-label="Responsibility and source">
          <ResponsibilitySection perspective="admin" employeeId={employee.employeeId} client={workforce} />
          <ManagedEmployeesSection employeeId={employee.employeeId} client={workforce} />
          <SourceSection
            rows={[
              {
                key: "employee",
                label: "Employee record",
                source: `The governed PostgreSQL Employee authority, read through the Workforce service (${WORKFORCE_READS.EMPLOYEE_RECORD.id}).`,
              },
              {
                key: "responsibility",
                label: "Owned records, accountabilities, managed employees",
                source: `Workforce reads ${WORKFORCE_READS.OWNED_RECORDS.id}, ${WORKFORCE_READS.ACCOUNTABILITIES.id} and ${WORKFORCE_READS.MANAGED_EMPLOYEES.id}. Assigned work is not served (${RUNTIME_DEPENDENCIES.ASSIGNED_WORK_READ.id}).`,
              },
              {
                key: "edits",
                label: "Edits",
                source: `The governed Workforce commands: profile facts through updateEmployeeProfile, the manager through establishReportingRelationship / endReportingRelationship. Employment Status and Operating Company are served by the Workforce service (${RUNTIME_DEPENDENCIES.LIFECYCLE_WRITER.id}) but are not editable on this page yet.`,
              },
              {
                key: "jobRole",
                label: "Job Role",
                source: `The governed PostgreSQL Job Role authority (${WORKFORCE_READS.JOB_ROLE_HISTORY.id}), read through listEmployeeJobRoleHistory and changed only through assignEmployeeJobRole under ${EMPLOYEE_JOB_ROLE_WRITE_CAPABILITY}. Business function only: it changes no access.`,
              },
              {
                key: "access",
                label: "Account status & Roles",
                source: `The legacy trusted account callables, on the credential of the Principal linked through ${WORKFORCE_READS.PRINCIPAL_LINK.id}.`,
              },
              {
                key: "history",
                label: "Change history",
                source: `Change History is the governed PostgreSQL Employee audit trail, read through the Workforce service (${WORKFORCE_READS.EMPLOYEE_CHANGE_HISTORY.id}). Legacy Change History is the pre-cutover legacy audit trail, kept for the record.`,
              },
            ]}
          />
        </aside>
      </div>

      <EmployeeChangeHistorySection employeeId={employee.employeeId} workforce={workforce} reloadKey={governedHistoryKey} />

      <ChangeHistory
        title="Legacy Change History"
        meta="Pre-cutover legacy trail — changes recorded before the governed Employee authority"
        sectionId="legacy-change-history"
        loadingMessage="Loading the legacy change history…"
        unavailableTitle="Legacy change history unavailable"
        rows={historyRows}
        loading={history.loading}
        unavailable={history.unavailable}
        onRetry={() => setHistoryNonce((n) => n + 1)}
        emptyMessage="No legacy (pre-cutover) changes were recorded for this Employee."
      />
    </div>
  );
}

/** What the last save did, in the domain's exact words (describeEmployeeEditResult). */
function EditNotice({ notice }) {
  return (
    <div className="ns-emp-edit-notice" data-employee-edit-result={notice.state}>
      <p className={notice.state === "SAVED" ? "ns-state" : "ns-state ns-state--denied"} role="status">
        {notice.words}
      </p>
    </div>
  );
}

const EMPLOYEE_PROFILE_WRITE_CAPABILITY = "admin.employeeProfile.write";

// What this session can actually know when the button is protected: the Workforce capability read answered and did
// not include admin.employeeProfile.write. It does not claim a cause (no Role, no grant reconciliation).
const EDIT_NOT_GRANTED_REASON = "The Workforce service did not grant Employee profile editing (admin.employeeProfile.write) for your account.";

// When the Workforce capability read itself failed: the page's usual honest unavailable wording, never "not granted".
const capabilityFailureWords = (error) => describeWorkforceFailure(error, WORKFORCE_CAPABILITY_SUBJECT).words;

/**
 * The account and Role actions, or the truthful reason they cannot be offered. They exist only for a credential
 * reached through the governed Principal link; with no link there is no account to act on.
 */
function AccountActions({ linked, principalLink, credential, accountSubject, actorUid, hasCapability, client }) {
  if (accountSubject) {
    return <UserAccessActions employee={accountSubject} actorUid={actorUid} hasCapability={hasCapability} statusClient={client} />;
  }
  let words;
  if (!linked) {
    words = "No governed Principal is linked to this Employee, so there is no account to manage.";
  } else if (principalLink.status === WORKFORCE_READ_STATE.FAILED) {
    words = `Account actions are not offered. ${describeWorkforceFailure(principalLink.error, "The Principal link").words}`;
  } else if (principalLink.status === WORKFORCE_READ_STATE.READY && !principalLink.data?.link) {
    words = "No governed Principal is linked to this Employee, so there is no account to manage.";
  } else if (credential.status === CREDENTIAL_STATE.UNRESOLVED) {
    words = "The linked Principal has no sign-in credential these account actions can manage.";
  } else if (credential.status === CREDENTIAL_STATE.FAILED) {
    words = "The linked Principal's credential could not be read from the Administration service, so account actions are not offered.";
  } else {
    return <LoadingState>Reading the linked account…</LoadingState>;
  }
  return (
    <div className="fo-user-actions" data-account-actions="UNAVAILABLE">
      <h3 className="fo-user-actions__title">Administrative actions</h3>
      <p className="fo-muted">{words}</p>
    </div>
  );
}
