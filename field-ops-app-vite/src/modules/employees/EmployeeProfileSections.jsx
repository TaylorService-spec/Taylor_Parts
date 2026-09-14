// EMPLOYEE OPERATING PROFILE -- the sections shared by the Administration Employee record
// (/administration/users/:employeeId) and the self view (/my-profile).
//
// Presentation only. Every decision -- what a lifecycle status means, whether User Access is linked,
// why Job Role is not governed, which axis a responsibility belongs to, which backend read is missing
// -- is made by domain/employeeOperatingProfile.js and rendered here in the North Star record grammar
// (RuledSection, fo-detail-list, StatusPill, ns-state). No section in this file reads data.
//
// UNAVAILABLE IS NOT EMPTY. A responsibility axis with no governed read renders the words "not
// available" and the named dependency; it never renders a zero, a blank card or a "coming soon".
import RuledSection from "../../shared/ui/RuledSection.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import {
  describeJobRole,
  describeLifecycle,
  describeManagedEmployees,
  describeResponsibilities,
  describeUserAccessRelationship,
} from "../../domain/employeeOperatingProfile.js";

/**
 * One named runtime dependency: the short statement, and the detail behind a disclosure so the page
 * stays readable while the missing API stays one tap away.
 */
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
 * Job Role, and operational eligibility beside it -- two rows, never one.
 *
 * `operationalRoles` is the list of already-labelled eligibility markers. It is shown for what it is
 * and is deliberately NOT an input to the Job Role row.
 */
export function JobRoleSection({ operationalRoles = [] }) {
  const jobRole = describeJobRole();
  return (
    <RuledSection title="Job Role & operational eligibility">
      <dl className="fo-detail-list ns-emp-facts">
        <dt>Job Role</dt>
        <dd data-employee-job-role={jobRole.state}>
          <strong>{jobRole.words}</strong>
          <p className="fo-muted ns-emp-note">{jobRole.explanation}</p>
          <RuntimeDependency dependency={jobRole.dependency} lead="No governed Job Role authority." />
        </dd>
        <dt>Operational eligibility</dt>
        <dd data-employee-operational-eligibility>
          {operationalRoles.length > 0 ? (
            <ul className="fo-chip-list" aria-label="Operational eligibility">
              {operationalRoles.map((label) => (
                <li key={label} className="fo-chip">
                  {label}
                </li>
              ))}
            </ul>
          ) : (
            <span className="fo-muted">None recorded.</span>
          )}
          <p className="fo-muted ns-emp-note">
            Eligibility markers say what work a person may be considered for. They are not Job Roles
            and grant no access.
          </p>
        </dd>
      </dl>
    </RuledSection>
  );
}

/**
 * The responsibility summary: Record Owner, Accountable Person, Assigned Person -- three separate
 * entries, each with its own label, question, reason and dependency.
 */
export function ResponsibilitySection({ perspective = "admin", notApplicable = null }) {
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
                <RuntimeDependency dependency={axis.dependency} />
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

/** The User Access relationship: linked or not, and the Principal stated as unavailable, not guessed. */
export function UserAccessRelationship({ employee }) {
  const relationship = describeUserAccessRelationship(employee);
  return (
    <div className="ns-emp-access" data-user-access-link={relationship.state}>
      <dl className="fo-detail-list ns-emp-facts">
        <dt>User Access</dt>
        <dd>
          <StatusPill tone={relationship.state === "LINKED" ? "positive" : "neutral"}>{relationship.words}</StatusPill>
          <p className="fo-muted ns-emp-note">{relationship.explanation}</p>
        </dd>
        <dt>Principal</dt>
        <dd data-employee-principal="UNAVAILABLE">
          <RuntimeDependency dependency={relationship.principal.dependency} lead="The governed Principal link is not readable here yet." />
        </dd>
      </dl>
    </div>
  );
}

/** Managed-employee context: stated as unavailable because no governed reporting relation exists. */
export function ManagedEmployeesSection({ title = "Managed employees" }) {
  const managed = describeManagedEmployees();
  return (
    <RuledSection title={title}>
      <p className="fo-muted ns-emp-note">{managed.explanation}</p>
      <RuntimeDependency dependency={managed.dependency} />
    </RuledSection>
  );
}

/**
 * Source & authority -- where each part of this page comes from, in words. `rows` is
 * [{ key, label, source }]; a row's source is a sentence, never a system name alone.
 */
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
