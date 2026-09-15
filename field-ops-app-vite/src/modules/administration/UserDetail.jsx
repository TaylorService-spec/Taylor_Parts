import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { administrationUsersClient } from "../../access/administrationUsersClient";
import { callPolicyApi } from "../../services/adminPolicyApiClient.js";
import { workforceApiClient } from "../../services/workforceApiClient.js";
import { WORKFORCE_READ_STATE, useWorkforceRead } from "../../hooks/useWorkforceRead.js";
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
  RuntimeDependency,
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
// PostgreSQL Workforce transport (POST /workforce/employees, #1913): EMP-RT-01 readEmployee, EMP-RT-02
// readEmployeePrincipalLink, EMP-RT-03 / EMP-RT-04 responsibility reads, EMP-RT-06 listManagedEmployees. The
// Firestore employee directory is not read here at all, and nothing falls back to it: a refused read says
// "not available to you", a failed read says it could not be loaded.
//
// ════════════════════ WHAT REMAINS ON LEGACY CALLABLES, AND WHY ════════════════════
//
//   * Account status, governed Role add/remove and password reset (UserAccessActions): USER ACCESS / security
//     concerns keyed by the Firebase Auth uid -- the CREDENTIAL. The uid is reached along the governed chain
//     Employee -> EMP-RT-02 link -> Principal -> (identity provider, external subject) from the Administration
//     API's listTenantPrincipals. Never from an Employee document.
//   * Change History (listRecordChangeHistory): the legacy audit trail -- pre-cutover profile changes and
//     account/Role events. Labelled as legacy; the governed Employee history read is tail EMP-RT-H1.
//
// ════════════════════ EDITING IS NOT OFFERED ════════════════════
//
// PostgreSQL is the Employee profile authority after the copy-once cutover (#1913, Owner ruling F, no dual write),
// and no governed PostgreSQL profile writer is served. The legacy updateEmployeeProfile callable writes the
// retired Firestore record, which this page no longer reads -- a save would change nothing a reader can see and
// would create drift the cutover verifier refuses. So Edit Employee is shown protected, with that reason
// (tail EMP-RT-W1), rather than wired to a writer whose result the page cannot show.
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

  // ── CHANGE HISTORY (legacy audit trail), read through the trusted callable.
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
    <div className="ns-page fo-user-detail" data-employee-record="READY">
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
          <Button
            variant="protected"
            id="employee-edit"
            data-user-action="edit"
            reason={`Editing is not available: no governed Employee profile writer is served (${RUNTIME_DEPENDENCIES.PROFILE_WRITER.id}).`}
          >
            Edit Employee
          </Button>
        }
      />

      {editRequested ? (
        <div className="ns-emp-edit-unavailable" data-employee-edit="UNAVAILABLE">
          <RuntimeDependency dependency={RUNTIME_DEPENDENCIES.PROFILE_WRITER} lead="Editing this Employee is not available." />
        </div>
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

          <JobRoleSection />

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
                key: "access",
                label: "Account status & Roles",
                source: `The legacy trusted account callables, on the credential of the Principal linked through ${WORKFORCE_READS.PRINCIPAL_LINK.id}.`,
              },
              {
                key: "history",
                label: "Change history",
                source: `The legacy audit trail. A governed Employee history read is not served (${RUNTIME_DEPENDENCIES.EMPLOYEE_HISTORY_READ.id}).`,
              },
            ]}
          />
        </aside>
      </div>

      <ChangeHistory
        rows={historyRows}
        loading={history.loading}
        unavailable={history.unavailable}
        onRetry={() => setHistoryNonce((n) => n + 1)}
        emptyMessage="No recorded changes for this Employee yet."
      />
    </div>
  );
}

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
