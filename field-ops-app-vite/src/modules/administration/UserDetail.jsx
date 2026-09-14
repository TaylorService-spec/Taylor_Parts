import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useEmployeeDirectory } from "../../hooks/useEmployeeDirectory";
import { administrationUsersClient } from "../../access/administrationUsersClient";
import LoadingState from "../../shared/ui/LoadingState";
import FailureState from "../../shared/ui/FailureState";
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
  EOS_ACCESS_STATE_UNAVAILABLE,
  SECURITY_ROLE_MIRROR_CAPTION,
  employeeCompanyName,
  employeeDisplayName,
  employeeNameIsAbsent,
  employeeSubtitle,
  employmentFields,
  employmentStatusTone,
  employmentStatusWords,
  eosAccessState,
  identityFields,
  operationalRoleLabels,
  securityRoleWords,
} from "../../domain/employeeProfile.js";
import UserEditPanel from "./UserEditPanel.jsx";
import UserAccessActions from "./UserAccessActions.jsx";
import {
  RUNTIME_DEPENDENCIES,
  describeUserAccessRelationship,
} from "../../domain/employeeOperatingProfile.js";
import {
  EmployeeLifecycle,
  JobRoleSection,
  ManagedEmployeesSection,
  ResponsibilitySection,
  SourceSection,
  UserAccessRelationship,
} from "../employees/EmployeeProfileSections.jsx";

// ADMINISTRATION → USERS → one person. The operational profile of an employee.
//
// ════════════════════ EMPLOYEE DESIGN v4.1 -- THE OPERATING PROFILE ════════════════════
//
// Composed to the Employee v4.1 profile (NS2-EMP-05a) and User Access linkage (NS2-EMP-10) frames:
// Employee status with its meaning, operating company and business context, Job Role stated as NOT
// YET GOVERNED beside operational eligibility, User Access in its own section (linkage, Principal,
// Security Role as access, account and Role actions), and a rail holding Record Owner, Accountable
// Person and Assigned Person as three separate axes, the managed-employee context and the source of
// each part. Facts with no governed read are stated as unavailable with a named runtime dependency
// (domain/employeeOperatingProfile.js). No data path was added: the page reads exactly what it read
// before -- the directory subscription, the trusted principal-access read and the audit read.
//
// ════════════════════ READ-ONLY BY DEFAULT, DELIBERATELY ════════════════════
//
// The page opens as a record to READ. Editing is an act a person chooses -- the Edit User button,
// or arriving with ?edit=1 from the directory's Edit action -- and it opens a form with its own
// Save and Cancel. Nothing here becomes editable because a row was clicked, because a governed
// change to somebody's employment record should never be one stray click away from happening.
//
// ════════════════════ ONE SUBSCRIPTION, FOUR JOBS ════════════════════
//
// useEmployeeDirectory is the existing admin/dispatcher directory read, and it answers all four
// questions this page has at once: the record itself, the MANAGER's record (so the manager renders
// as a name and a link rather than a stored id), the manager PICKER's candidates while editing,
// and the actor names the Change History needs. Three separate document reads plus a candidate
// query would be the alternative, over the same Rules grant, for the same data. It is a
// collection-scale read of a collection whose scale is a company's headcount -- if that ever stops
// being true, the upgrade is a single-document read plus a manager lookup, and nothing else on
// this page changes.
//
// ════════════════════ WHAT THIS PAGE IS NOT ALLOWED TO CLAIM ════════════════════
//
// Employment Status and EOS Account Status are independent facts, rendered in separate sections
// that never derive one from the other. Operational Roles, the legacy compatibility role, and the
// governed Roles are three more such facts, and no two of them are derived from each other either.
//
// ACCOUNT STATUS IS NOW READ, NOT DECLARED UNAVAILABLE. It used to be a hard-coded "Not available"
// here, honestly, because Firebase Auth's disabled bit had no governed read. readPrincipalAccessState
// provides one, so the value and the action that changes it live together in UserAccessActions and
// this page no longer carries a second row for the same fact -- two rows for one fact eventually
// disagree, and the stale one is always the one with no read behind it.
//
// THE LEGACY MIRROR IS LABELLED AS LEGACY (Owner ruling 2026-09-06 §2). employees.securityRole is
// not this person's governed access and is never presented as it, never merged into the governed
// Role list, and never called their Security Role.
export default function UserDetail({ client = administrationUsersClient, hasCapability }) {
  const { employeeId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const { byEmployeeId, loading, error } = useEmployeeDirectory();
  const employee = byEmployeeId.get(employeeId) ?? null;
  const manager = employee?.managerEmployeeId ? byEmployeeId.get(employee.managerEmployeeId) ?? null : null;

  const editing = searchParams.get("edit") === "1";
  const setEditing = useCallback(
    (open) => {
      setSearchParams(
        (params) => {
          const next = new URLSearchParams(params);
          if (open) next.set("edit", "1");
          else next.delete("edit");
          return next;
        },
        // The editor is a mode of THIS page, not a place in the history stack: Back from an open
        // editor should leave the record, not silently close the form and look like nothing
        // happened.
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // ── CHANGE HISTORY. Authoritative events for THIS record, read through the trusted callable.
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
          // An unreadable trail is stated as unreadable. Rendering it as an empty history would
          // claim nothing has ever happened to this person's record, which is a claim we have no
          // basis for -- and the most likely truth is the opposite.
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
        // The Employee profile fields, plus governedRole -- the key the trusted read attaches to
        // a Role add/remove so it renders with the Role itself in Previous/New.
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

  if (loading) {
    return (
      <div className="fo-panel">
        <LoadingState>Loading user…</LoadingState>
      </div>
    );
  }

  // A read FAILURE and a NOT-FOUND are different facts and stay distinguishable: one means we
  // could not look, the other means we looked and this person is not there. Reporting a denied
  // read as "not found" tells an administrator the record does not exist when it may simply not be
  // theirs to see.
  if (error) {
    return (
      <div className="fo-panel">
        <FailureState message="This user directory could not be loaded." action={backToUsers} />
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="fo-panel">
        <FailureState message="This user could not be found." action={backToUsers} />
      </div>
    );
  }

  const name = employeeDisplayName(employee);
  const access = eosAccessState(employee);
  const roles = operationalRoleLabels(employee);
  const security = securityRoleWords(employee);

  return (
    <div className="ns-page fo-user-detail">
      <div className="ns-page__utility">
        <span className="ns-page__context">
          <Link to="/administration/users">Users</Link>
          {` → ${name}`}
        </span>
      </div>
      <div className="ns-rulepair" />

      <RecordIdentity
        kicker="Employee record"
        // The person's NAME is the reference. A record with no name renders the truthful generic
        // one; the document id is not accepted as a prop and cannot arrive here (DECISIONS #106).
        reference={employeeNameIsAbsent(employee) ? null : name}
        fallbackName={name}
        subtitle={employeeSubtitle(employee)}
        // EMPLOYEE status, and only Employee status, in the header. User Access is a separate fact
        // with its own section, and putting both in one header line is precisely how the two come
        // to be read as one thing.
        statusWords={employmentStatusWords(employee)}
        statusTone={employmentStatusTone(employee)}
        facts={[
          { key: "company", label: "Company", value: employeeCompanyName(employee) },
          // "User Access", worded as linkage -- the value is whether an account is linked, and a
          // label reading Access-granted over it would claim more than the record can prove.
          { key: "access", label: "User Access", value: describeUserAccessRelationship(employee).words },
        ]}
        actions={
          editing ? null : (
            // EDITS THE EMPLOYEE BUSINESS RECORD ONLY. Account status and Security Roles are User
            // Access, managed in their own section below -- never through this form.
            <Button variant="primary" data-user-action="edit" onClick={() => setEditing(true)}>
              Edit Employee
            </Button>
          )
        }
      />

      <div className="ns-record-body">
        <div>
          {editing ? (
            <UserEditPanel
              employee={employee}
              // The manager picker's candidates: the same already-loaded directory, so choosing a
              // manager is a selection from real employees rather than a typed name that may match
              // nobody. The command re-validates existence server-side regardless.
              candidates={byEmployeeId}
              client={client}
              actorUid={user?.uid ?? ""}
              onClose={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                // The record arrives through the live directory subscription, so there is nothing
                // to refresh by hand -- but the HISTORY is a one-shot callable read, and a save
                // that produced events nobody can see would look like a save that did nothing.
                setHistoryNonce((n) => n + 1);
              }}
            />
          ) : (
            <>
              <RuledSection title="Identity & contact">
                <StructuredFields fields={identityFields(employee)} label="Identity and contact" />
              </RuledSection>

              <RuledSection title="Employment & business context">
                {/* THE LIFECYCLE IN WORDS AND MEANING. Six governed statuses, each its own sentence:
                    Inactive is not Terminated, On Leave is not a former Employee, and a former
                    Employee's record stays fully readable. */}
                <dl className="fo-detail-list ns-emp-facts">
                  <dt>Employee status</dt>
                  <dd>
                    <EmployeeLifecycle status={employee.employmentStatus} />
                  </dd>
                </dl>
                <StructuredFields
                  fields={employmentFields(employee).filter((f) => f.label !== "Employment Status")}
                  label="Employment"
                />
                {/* MANAGER IS A RELATIONSHIP, so it is rendered as one rather than as a cell of
                    text. The stored value is another employee's document id; what a reader gets is
                    that person's name and a link to their own record. A manager flattened into
                    display text is unfollowable and goes stale the day they are renamed. It is a
                    RECORDED manager, not a governed reporting relation -- see Managed employees. */}
                <dl className="fo-detail-list">
                  <dt>Recorded manager</dt>
                  <dd data-user-manager={employee.managerEmployeeId ?? ""}>
                    {!employee.managerEmployeeId ? (
                      <span className="fo-muted">Not recorded</span>
                    ) : manager ? (
                      <Link className="ns-emp-link" to={`/administration/users/${employee.managerEmployeeId}`}>
                        {employeeDisplayName(manager)}
                      </Link>
                    ) : (
                      // A recorded manager whose record did not resolve is UNAVAILABLE, never the
                      // raw id and never "no manager": the record says something we could not
                      // resolve, which is a different fact from saying nothing.
                      <span className="fo-muted">Unavailable</span>
                    )}
                  </dd>
                </dl>
              </RuledSection>

              {/* JOB ROLE IS NOT GOVERNED, AND OPERATIONAL ELIGIBILITY IS NOT A JOB ROLE. The
                  eligibility markers are shown for what they are -- firestore.rules'
                  isActiveOperationalRole() reads them as an additional CONDITION on a permission,
                  never as a permission -- and nothing derives a Job Role from them, from the
                  Security Role, or from the job title. */}
              <JobRoleSection operationalRoles={roles} />

              {/* USER ACCESS, SEPARATE FROM THE EMPLOYEE. Linkage, the Principal (stated as not yet
                  readable), the Security Role as an access concept, and the account/Role actions --
                  none of which the Edit Employee form can touch. */}
              <RuledSection title="User Access" meta="Access to EOS — separate from the Employee record">
                <UserAccessRelationship employee={employee} />
                <dl className="fo-detail-list ns-emp-facts">
                  {/* LEGACY, AND LABELLED AS LEGACY (Owner ruling 2026-09-06 §2). This row is not
                      the person's governed access and must never be read as it -- governed Roles
                      are rendered by UserAccessActions below, from the trusted read. The two are
                      never merged into one list: they are different systems, and a combined list
                      would imply a single authority that does not exist. */}
                  <dt>Legacy compatibility role</dt>
                  <dd data-user-security-role={employee.securityRole ?? ""}>
                    {security ?? <span className="fo-muted">Not recorded</span>}
                    <p className="fo-muted ns-emp-note">{SECURITY_ROLE_MIRROR_CAPTION}</p>
                    <p className="fo-muted ns-emp-note">
                      Security Roles are access. They are not Job Roles and are never used as one.
                    </p>
                  </dd>
                </dl>
                <p className="fo-muted" data-user-access={access}>{EOS_ACCESS_STATE_UNAVAILABLE}</p>

                {/* The SAME seam this page already uses for the profile write and the history
                    read, threaded through rather than left to the component's own default import.
                    One page, one client: a surface whose sections reach for different instances of
                    the same seam cannot be exercised as a whole. */}
                <UserAccessActions
                  employee={employee}
                  actorUid={user?.uid ?? ""}
                  hasCapability={hasCapability}
                  statusClient={client}
                />
              </RuledSection>
            </>
          )}

        </div>

        {/* RESPONSIBILITY, MANAGER CONTEXT AND SOURCE -- the rail. Record Owner, Accountable Person
            and Assigned Person are three separate entries with three separate dependencies; none is
            readable for a person today, and each says so rather than rendering a zero. */}
        <aside className="ns-rail" aria-label="Responsibility and source">
          <ResponsibilitySection perspective="admin" />
          <ManagedEmployeesSection />
          <SourceSection
            rows={[
              {
                key: "employee",
                label: "Employee record",
                source: `The Administration employee directory read this page has always used — not yet the canonical PostgreSQL Employee authority (${RUNTIME_DEPENDENCIES.EMPLOYEE_RECORD_READ.id}).`,
              },
              {
                key: "access",
                label: "Account status & governed Roles",
                source: "The existing trusted principal-access read and role commands, shown under User Access.",
              },
              {
                key: "history",
                label: "Change history",
                source: "The existing trusted audit read for this Employee record.",
              },
            ]}
          />
        </aside>
      </div>

      {/* AT THE BOTTOM, always -- below the record body, so it is last at every width, including the
          phone where the rail stacks under the main column. The SHARED component, the same one
          Customers, Equipment, Parts, Work Orders and the Financials records mount. It renders
          stored, audited events; there is no prop through which this page could hand it a
          client-computed diff, which is the difference between a history and a guess. */}
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
