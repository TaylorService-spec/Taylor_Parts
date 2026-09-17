// EMPLOYEE OPERATING PROFILE -- the sections shared by the Administration Employee record
// (/administration/users/:employeeId) and the self view (/my-profile).
//
// Every Employee business fact here comes from the governed PostgreSQL Workforce transport through
// hooks/useWorkforceRead.js. No section reads Firestore, and none falls back to anything: a refused read says
// "not available to you", a failed read says it could not be loaded, and an unserved fact names its dependency.
import { Link } from "react-router-dom";
import RuledSection from "../../shared/ui/RuledSection.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import LoadingState from "../../shared/ui/LoadingState";
import { Button } from "../../shared/ui/primitives/index.js";
import { WORKFORCE_READ_STATE, useEmployeeResponsibility, useWorkforceRead } from "../../hooks/useWorkforceRead.js";
import {
  RECORD_FAMILY_LABEL,
  WORKFORCE_READS,
  describeLifecycle,
  describeRecordItem,
  describeResponsibilities,
  describeUserAccessRelationship,
  describeWorkforceFailure,
  recordDisplayName,
} from "../../domain/employeeOperatingProfile.js";
import { JOB_ROLE_CAPTION, describeEmployeeJobRole } from "../../domain/employeeJobRole.js";

/** One named runtime dependency: the short statement, and the detail behind a disclosure. */
export function RuntimeDependency({ dependency, lead = "Not available yet." }) {
  return (
    <div className="ns-emp-dependency" data-runtime-dependency={dependency.id}>
      <p className="ns-state ns-state--not-enabled ns-emp-dependency__state">
        {lead} <span className="ns-emp-dependency__id">{dependency.id}</span>
      </p>
      <details className="ns-emp-disclosure">
        <summary>What is missing</summary>
        <dl className="ns-emp-disclosure__body">
          <dt>Today</dt>
          <dd>{dependency.today}</dd>
          <dt>Required</dt>
          <dd>{dependency.requiredApi}</dd>
        </dl>
      </details>
    </div>
  );
}

/** A Workforce failure, in words, with Retry only when retrying can help. */
export function WorkforceFailure({ error, subject, onRetry = null, readId = null }) {
  const failure = describeWorkforceFailure(error, subject);
  return (
    <div className="ns-emp-failure" data-workforce-failure={failure.kind} data-workforce-read={readId ?? ""}>
      <p className={failure.kind === "UNAVAILABLE" ? "ns-state" : "ns-state ns-state--denied"} role={failure.kind === "UNAVAILABLE" ? "alert" : undefined}>
        {failure.words}
      </p>
      {failure.retryable && onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/** The Employee status: the word in a pill (never colour alone), plus what the status means. */
export function EmployeeLifecycle({ status }) {
  const lifecycle = describeLifecycle(status);
  return (
    <div className="ns-emp-lifecycle" data-employee-lifecycle={lifecycle.value ?? ""} data-lifecycle-standing={lifecycle.standing}>
      <StatusPill tone={lifecycle.tone}>{lifecycle.words}</StatusPill>
      <span className="ns-emp-lifecycle__meaning">{lifecycle.meaning}</span>
    </div>
  );
}

/**
 * Job Role (EMP-RT-08) -- the Employee's BUSINESS FUNCTION: the current Job Role and its history, from the governed
 * PostgreSQL read listEmployeeJobRoleHistory, and nothing else. It is its own section, apart from User Access /
 * Security Roles, employment facts, the manager and responsibility, because it confers none of them.
 *
 * `control` (optional) is a render function the Administration record passes to offer the governed Job Role
 * control; it receives { jobRole, reload } -- `jobRole` is null until the read is READY -- so a change is followed by
 * a RE-READ of this section, never by rendering what was chosen. The self view passes none.
 */
export function JobRoleSection({ employeeId, client, control = null, subject = "This Employee's Job Role" }) {
  const read = useWorkforceRead(WORKFORCE_READS.JOB_ROLE_HISTORY.operation, employeeId ? { employeeId } : null, { client });
  let body;
  let jobRole = null;
  if (read.status === WORKFORCE_READ_STATE.IDLE || read.status === WORKFORCE_READ_STATE.LOADING) {
    body = <LoadingState>Reading the Job Role…</LoadingState>;
  } else if (read.status === WORKFORCE_READ_STATE.FAILED) {
    body = (
      <div data-employee-job-role={describeWorkforceFailure(read.error).kind}>
        <WorkforceFailure error={read.error} subject={subject} onRetry={read.reload} readId={WORKFORCE_READS.JOB_ROLE_HISTORY.id} />
      </div>
    );
  } else {
    jobRole = describeEmployeeJobRole(read.data);
    body = (
      <>
        <dl className="fo-detail-list ns-emp-facts">
          <dt>Current Job Role</dt>
          <dd data-employee-job-role={jobRole.state} data-job-role-id={jobRole.current?.jobRoleId ?? ""}>
            {jobRole.current ? (
              <>
                <strong>{jobRole.words}</strong>
                {jobRole.current.inactive ? (
                  <>
                    {" "}
                    <StatusPill tone="neutral">Inactive Job Role</StatusPill>
                  </>
                ) : null}
                {jobRole.current.from ? <span className="fo-muted">{` · since ${jobRole.current.from}`}</span> : null}
                {jobRole.inactiveNote ? <p className="fo-muted ns-emp-note">{jobRole.inactiveNote}</p> : null}
              </>
            ) : (
              <>
                <strong>{jobRole.words}</strong>
                <p className="fo-muted ns-emp-note">{jobRole.noneNote}</p>
              </>
            )}
          </dd>
          <dt>Job Role history</dt>
          <dd data-job-role-history={jobRole.history.length}>
            {jobRole.history.length === 0 ? (
              <span className="fo-muted">No Job Role has been recorded for this Employee.</span>
            ) : (
              <>
                <ol className="ns-emp-records" aria-label="Job Role history, newest first">
                  {jobRole.history.map((h) => (
                    <li key={h.key} className="ns-emp-record" data-job-role-assignment={h.current ? "CURRENT" : "ENDED"}>
                      <span className="ns-emp-record__title">
                        {h.name}
                        {h.inactive ? " (inactive)" : ""}
                      </span>
                      <span className="ns-emp-record__state">{h.period}</span>
                      {h.reason ? <span className="ns-emp-record__state">{`Reason: ${h.reason}`}</span> : null}
                    </li>
                  ))}
                </ol>
                {jobRole.truncated ? <p className="fo-muted ns-emp-note">Older Job Role history exists than is shown here.</p> : null}
              </>
            )}
          </dd>
        </dl>
      </>
    );
  }
  return (
    <RuledSection title="Job Role" meta="Business function — does not change access">
      <div data-job-role-section="">
        <p className="fo-muted ns-emp-note">{JOB_ROLE_CAPTION}</p>
        {body}
        {control ? control({ jobRole, reload: read.reload }) : null}
      </div>
    </RuledSection>
  );
}

/** A person reference to another Employee: a link on the Administration record, plain words on the self view. */
function PersonReference({ employeeId, name, linkPeople }) {
  return linkPeople ? (
    <Link className="ns-emp-link" to={`/administration/users/${employeeId}`}>
      {name}
    </Link>
  ) : (
    <span>{name}</span>
  );
}

/** The governed current reporting relationship (from the Employee read), or the truthful absence of one. */
export function ManagerFact({ manager, linkPeople = true }) {
  return (
    <dl className="fo-detail-list ns-emp-facts">
      <dt>Manager</dt>
      <dd data-employee-manager={manager ? manager.managerEmployeeId : ""}>
        {manager ? (
          <>
            <PersonReference employeeId={manager.managerEmployeeId} name={manager.name} linkPeople={linkPeople} />
            {manager.since ? <span className="fo-muted">{` · reporting since ${manager.since}`}</span> : null}
          </>
        ) : (
          <span className="fo-muted">No current reporting relationship recorded.</span>
        )}
      </dd>
    </dl>
  );
}

function AxisFamilies({ axis, employeeId, client }) {
  const state = useEmployeeResponsibility(axis.read.operation, employeeId, axis.families, { client });
  if (state.status !== WORKFORCE_READ_STATE.READY) {
    return <LoadingState>{`Reading ${axis.heading.toLowerCase()}…`}</LoadingState>;
  }
  return (
    <ul className="ns-emp-families" data-responsibility-read={axis.read.id}>
      {state.families.map((f) => (
        <li key={f.family} className="ns-emp-family" data-record-family={f.family} data-family-state={f.status === WORKFORCE_READ_STATE.READY ? (f.items.length ? "RECORDS" : "NONE") : describeWorkforceFailure(f.error).kind}>
          <p className="ns-emp-family__label">{RECORD_FAMILY_LABEL[f.family] ?? f.family}</p>
          {f.status !== WORKFORCE_READ_STATE.READY ? (
            <p className="ns-state ns-state--na ns-emp-family__state">{describeWorkforceFailure(f.error, RECORD_FAMILY_LABEL[f.family] ?? "This family").words}</p>
          ) : f.items.length === 0 ? (
            <p className="ns-state ns-state--na ns-emp-family__state">None.</p>
          ) : (
            <>
              <ul className="ns-emp-records">
                {f.items.map((item) => {
                  const d = describeRecordItem(item);
                  return (
                    <li key={item.recordId} className="ns-emp-record">
                      <span className="ns-emp-record__title">{d.title}</span>
                      {d.state ? <span className="ns-emp-record__state">{d.state}</span> : null}
                    </li>
                  );
                })}
              </ul>
              {f.truncated ? <p className="fo-muted ns-emp-note">More records exist than are shown here.</p> : null}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Record Owner (EMP-RT-03), Accountable Person (EMP-RT-04), Assigned Person (EMP-RT-05, not served) -- three
 * separate entries, each with its own read or dependency.
 */
export function ResponsibilitySection({ perspective = "admin", employeeId = null, client, notApplicable = null }) {
  const axes = describeResponsibilities(perspective);
  return (
    <RuledSection title="Responsibility" meta="Three separate relationships">
      {notApplicable ? (
        <p className="ns-state ns-state--na" data-responsibility-state="NOT_APPLICABLE">
          {notApplicable}
        </p>
      ) : (
        <ul className="ns-emp-axes" aria-label="Responsibility relationships">
          {axes.map((axis) => {
            const headingId = `ns-emp-axis-${perspective}-${axis.axis.toLowerCase()}`;
            return (
              <li key={axis.axis} className="ns-emp-axis" data-responsibility-axis={axis.axis} aria-labelledby={headingId}>
                <p className="ns-emp-axis__label">{axis.label}</p>
                <h3 className="ns-emp-axis__heading" id={headingId}>
                  {axis.heading}
                </h3>
                <p className="ns-emp-axis__question">{axis.question}</p>
                {axis.available ? (
                  <AxisFamilies axis={axis} employeeId={employeeId} client={client} />
                ) : (
                  <RuntimeDependency dependency={axis.dependency} />
                )}
                <details className="ns-emp-disclosure">
                  <summary>{perspective === "self" ? "Why is this in front of me?" : "Why would a record be here?"}</summary>
                  <p className="ns-emp-disclosure__body">{axis.why}</p>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </RuledSection>
  );
}

/** The User Access relationship from EMP-RT-01's userAccess -- linkage only, no ids. */
export function UserAccessRelationship({ userAccess }) {
  const relationship = describeUserAccessRelationship(userAccess);
  return (
    <div className="ns-emp-access" data-user-access-link={relationship.state}>
      <dl className="fo-detail-list ns-emp-facts">
        <dt>User Access</dt>
        <dd>
          <StatusPill tone={relationship.state === "LINKED" ? "positive" : "neutral"}>{relationship.words}</StatusPill>
          <p className="fo-muted ns-emp-note">{relationship.explanation}</p>
        </dd>
      </dl>
    </div>
  );
}

/**
 * The governed Employee ↔ Principal link (EMP-RT-02). The server decides who may read it
 * (admin.principalAccess.read); a refusal renders "not available to you". The page owns the read (`read` is a
 * useWorkforceRead result) because the same link also reaches the credential for account actions.
 */
export function PrincipalLinkDetails({ read }) {
  if (read.status === WORKFORCE_READ_STATE.IDLE) return null;
  if (read.status === WORKFORCE_READ_STATE.LOADING) return <LoadingState>Reading the Principal link…</LoadingState>;
  if (read.status === WORKFORCE_READ_STATE.FAILED) {
    return (
      <dl className="fo-detail-list ns-emp-facts">
        <dt>Principal</dt>
        <dd data-employee-principal={describeWorkforceFailure(read.error).kind}>
          <WorkforceFailure error={read.error} subject="The Principal link" onRetry={read.reload} readId={WORKFORCE_READS.PRINCIPAL_LINK.id} />
        </dd>
      </dl>
    );
  }
  const link = read.data?.link ?? null;
  return (
    <dl className="fo-detail-list ns-emp-facts">
      <dt>Principal</dt>
      <dd data-employee-principal={link ? "LINKED" : "NONE"}>
        {link ? (
          <>
            <strong>{link.principalDisplayName || "Unnamed Principal"}</strong>
            <p className="fo-muted ns-emp-note">
              {`Principal ${link.principalStatus}; tenant membership ${link.membershipStatus}. Linked ${String(link.linkedAt).slice(0, 10)} through ${link.linkSource}.`}
            </p>
          </>
        ) : (
          <span className="fo-muted">No governed Principal is linked to this Employee.</span>
        )}
      </dd>
    </dl>
  );
}

/** Employees whose current manager is this Employee (EMP-RT-06, the governed reporting relationship). */
export function ManagedEmployeesSection({ employeeId, client, title = "Managed employees", linkPeople = true }) {
  const read = useWorkforceRead(WORKFORCE_READS.MANAGED_EMPLOYEES.operation, employeeId ? { managerEmployeeId: employeeId } : null, { client });
  let body;
  if (read.status === WORKFORCE_READ_STATE.IDLE || read.status === WORKFORCE_READ_STATE.LOADING) {
    body = <LoadingState>Reading reporting relationships…</LoadingState>;
  } else if (read.status === WORKFORCE_READ_STATE.FAILED) {
    body = <WorkforceFailure error={read.error} subject="Managed employees" onRetry={read.reload} readId={WORKFORCE_READS.MANAGED_EMPLOYEES.id} />;
  } else {
    const items = read.data?.items ?? [];
    body =
      items.length === 0 ? (
        <p className="ns-state ns-state--na" data-managed-employees="NONE">
          No Employees currently report to this person.
        </p>
      ) : (
        <>
          <ul className="ns-emp-records" data-managed-employees={items.length}>
            {items.map((item) => (
              <li key={item.employeeId} className="ns-emp-record">
                <span className="ns-emp-record__title">
                  <PersonReference employeeId={item.employeeId} name={recordDisplayName(item)} linkPeople={linkPeople} />
                </span>
                <span className="ns-emp-record__state">{describeLifecycle(item.employmentStatus).words}</span>
              </li>
            ))}
          </ul>
          {read.data?.truncated ? <p className="fo-muted ns-emp-note">More Employees report to this person than are shown here.</p> : null}
        </>
      );
  }
  return (
    <RuledSection title={title} meta="Governed reporting relationship">
      {body}
    </RuledSection>
  );
}

/** Source & authority -- where each part of this page comes from, in words. */
export function SourceSection({ rows }) {
  return (
    <RuledSection title="Source & authority">
      <dl className="fo-detail-list ns-emp-facts ns-emp-sources">
        {rows.map((row) => (
          <div key={row.key} className="ns-emp-sources__row" data-profile-source={row.key}>
            <dt>{row.label}</dt>
            <dd>{row.source}</dd>
          </div>
        ))}
      </dl>
    </RuledSection>
  );
}
