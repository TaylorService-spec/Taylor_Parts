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
  EMPLOYEE_FIELD_LABELS,
  EMPLOYEE_TARGET_TYPE,
  EOS_ACCESS_STATE_UNAVAILABLE,
  SECURITY_ROLE_MIRROR_CAPTION,
  employeeDisplayName,
  employeeNameIsAbsent,
  employeeSubtitle,
  employmentFields,
  employmentStatusTone,
  employmentStatusWords,
  eosAccessLabel,
  eosAccessState,
  identityFields,
  operationalRoleLabels,
  securityRoleWords,
} from "../../domain/employeeProfile.js";
import UserEditPanel from "./UserEditPanel.jsx";
import UserAccessActions from "./UserAccessActions.jsx";

// ADMINISTRATION → USERS → one person. The operational profile of an employee.
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
// Employment Status and EOS Account Status are independent facts and are rendered in separate
// sections that never derive one from the other. Operational Roles and Security Role likewise. The
// account's enabled/disabled bit is Firebase Auth state that no governed read exposes to this
// client, so it is reported as unavailable and the enable/disable actions stay fail-closed with
// that exact reason attached -- not inferred from employment, not guessed.
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
        fieldLabels: EMPLOYEE_FIELD_LABELS,
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
        kicker="User · Employee record"
        // The person's NAME is the reference. A record with no name renders the truthful generic
        // one; the document id is not accepted as a prop and cannot arrive here (DECISIONS #106).
        reference={employeeNameIsAbsent(employee) ? null : name}
        fallbackName={name}
        subtitle={employeeSubtitle(employee)}
        // EMPLOYMENT status, and only employment status, in the header. The account's status is a
        // separate fact with its own section, and putting both in one header line is precisely how
        // the two come to be read as one thing.
        statusWords={employmentStatusWords(employee)}
        statusTone={employmentStatusTone(employee)}
        facts={[
          { key: "access", label: "EOS Access", value: eosAccessLabel(employee) },
          { key: "roles", label: "Operational", value: roles.length > 0 ? roles.join(", ") : null },
          { key: "security", label: "Security Role", value: security },
        ]}
        actions={
          editing ? null : (
            <Button variant="primary" data-user-action="edit" onClick={() => setEditing(true)}>
              Edit User
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

              <RuledSection title="Employment">
                <StructuredFields fields={employmentFields(employee)} label="Employment" />
                {/* MANAGER IS A RELATIONSHIP, so it is rendered as one rather than as a cell of
                    text. The stored value is another employee's document id; what a reader gets is
                    that person's name and a link to their own User Detail. A manager flattened
                    into display text is unfollowable and goes stale the day they are renamed. */}
                <dl className="fo-detail-list">
                  <dt>Manager</dt>
                  <dd data-user-manager={employee.managerEmployeeId ?? ""}>
                    {!employee.managerEmployeeId ? (
                      <span className="fo-muted">Not recorded</span>
                    ) : manager ? (
                      <Link to={`/administration/users/${employee.managerEmployeeId}`}>
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

              <RuledSection title="Operational assignment">
                {/* OPERATIONAL ROLES ARE NOT SECURITY. They mark what an employee is eligible to
                    do operationally -- firestore.rules' isActiveOperationalRole() reads them as an
                    additional CONDITION on a permission, never as a permission. Nothing on this
                    page derives one from the other in either direction. */}
                {roles.length > 0 ? (
                  <ul className="fo-chip-list" data-user-operational-roles>
                    {roles.map((label) => (
                      <li key={label} className="fo-chip">
                        {label}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="fo-muted" data-user-operational-roles>
                    No operational roles recorded.
                  </p>
                )}
                <p className="fo-muted">
                  Operational roles are eligibility for work, not access. They grant no permission
                  on their own.
                </p>
                {/* NO WAREHOUSE / TERRITORY ROWS. assignedWarehouseIds is a real stored array that
                    gates firestore.rules' isAssignedToWarehouse(), but no warehouse EntityDefinition
                    is registered in this program and there is no governed read that turns those ids
                    into warehouse NAMES -- so a row here could only print ids. Territory has no
                    employee-side field at all: coverage is assigned to a territory, not stored on a
                    person (docs/…/commercial coverage). Both are recorded as gaps rather than
                    rendered as raw ids or invented. */}
              </RuledSection>

              <RuledSection title="EOS access & security">
                <dl className="fo-detail-list">
                  <dt>EOS account</dt>
                  <dd data-user-access={access}>{eosAccessLabel(employee)}</dd>
                  <dt>Account status</dt>
                  <dd data-user-account-status="unavailable">
                    <span className="fo-muted">Not available</span>
                  </dd>
                  <dt>Security Role</dt>
                  <dd data-user-security-role={employee.securityRole ?? ""}>
                    {security ?? <span className="fo-muted">Not recorded</span>}
                  </dd>
                </dl>
                <p className="fo-muted">{EOS_ACCESS_STATE_UNAVAILABLE}</p>
                <p className="fo-muted">{SECURITY_ROLE_MIRROR_CAPTION}</p>
                {/* NO LAST SIGN-IN, ACCOUNT CREATED OR LAST ACCESS CHANGE ROWS. All three are
                    Firebase Auth / users-document facts, and this client has no governed read for
                    another user's. Rows showing "Unknown" for facts we have no path to would
                    describe a loading problem rather than the truth, which is that the read does
                    not exist. */}

                <UserAccessActions
                  employee={employee}
                  actorUid={user?.uid ?? ""}
                  hasCapability={hasCapability}
                />
              </RuledSection>
            </>
          )}

          {/* AT THE BOTTOM, always, and the SHARED component -- the same one Customers, Equipment,
              Parts, Work Orders and the Financials records will mount. It renders stored, audited
              events; there is no prop through which this page could hand it a client-computed
              diff, which is the difference between a history and a guess. */}
          <ChangeHistory
            rows={historyRows}
            loading={history.loading}
            unavailable={history.unavailable}
            onRetry={() => setHistoryNonce((n) => n + 1)}
            emptyMessage="No recorded changes for this user yet."
          />
        </div>
      </div>
    </div>
  );
}
