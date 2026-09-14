import { useAuth } from "../../auth/AuthContext";
import RecordIdentity from "../../shared/ui/RecordIdentity.jsx";
import RuledSection from "../../shared/ui/RuledSection.jsx";
import LoadingState from "../../shared/ui/LoadingState";
import { operationalRoleLabel, securityRoleLabel } from "../../domain/employeeVocabulary.js";
import { RUNTIME_DEPENDENCIES, SELF_IDENTITY, describeSelf } from "../../domain/employeeOperatingProfile.js";
import {
  EmployeeLifecycle,
  JobRoleSection,
  ManagedEmployeesSection,
  ResponsibilitySection,
  RuntimeDependency,
  SourceSection,
} from "./EmployeeProfileSections.jsx";

// YOUR EMPLOYEE PROFILE -- the self view of the Employee design v4.1 (NS2-EMP-05a, phone frame 1e).
//
// ════════════════════ WHAT IT READS: NOTHING NEW ════════════════════
//
// The page renders the session AuthContext already resolved at sign-in -- your Employee link, name,
// Employee status, operational eligibility and legacy compatibility role. It adds no Firestore read,
// no callable and no subscription. Every fact the design asks for that the session does not carry
// (operating company, the governed Principal link, what you own, are accountable for and are
// assigned) is stated as unavailable with the governed backend read that would supply it.
//
// ════════════════════ WHAT IT WILL NOT SAY ════════════════════
//
// It never calls the Security Role a Job Role, never derives a Job Role from anything, and never
// merges Record Owner, Accountable Person and Assigned Person into one list. A sign-in with no linked
// Employee is a real state and is said plainly: EOS knows you as User Access, not as an Employee.
export default function MyEmployeeProfile() {
  const auth = useAuth() ?? {};
  const { user, loading } = auth;

  if (loading) {
    return (
      <div className="ns-page fo-my-profile">
        <LoadingState>Loading your profile…</LoadingState>
      </div>
    );
  }

  const self = describeSelf(auth);
  const linked = self.identity === SELF_IDENTITY.LINKED;
  const eligibility = self.operationalRoles.map(operationalRoleLabel);
  const name = self.name ?? (linked ? "Your Employee record" : "No Employee record linked");
  // A link whose Employee record did not resolve at sign-in is its own state -- not "status not
  // recorded", which would claim we read a record that carries none.
  const unresolved = linked && !self.recordResolved;
  const statusWords = !linked
    ? "No Employee record linked"
    : unresolved
      ? "Employee record did not resolve"
      : self.lifecycle.words;

  return (
    <div className="ns-page fo-my-profile" data-self-identity={self.identity}>
      <div className="ns-page__utility">
        <span className="ns-page__context">Your Employee profile</span>
      </div>
      <div className="ns-rulepair" />

      <RecordIdentity
        kicker="Me · Employee"
        reference={self.name}
        fallbackName={name}
        subtitle="Who EOS says you are"
        statusWords={statusWords}
        statusTone={linked && !unresolved ? self.lifecycle.tone : "neutral"}
        facts={[]}
      />

      <div className="ns-record-body">
        <div>
          <RuledSection title="Who EOS says I am">
            {linked ? (
              <dl className="fo-detail-list ns-emp-facts">
                <dt>Name</dt>
                <dd>{self.name ?? <span className="fo-muted">Not available — your Employee record did not resolve at sign-in.</span>}</dd>
                <dt>Employee status</dt>
                <dd>
                  {unresolved ? (
                    <span className="fo-muted">Not available — your Employee record did not resolve at sign-in.</span>
                  ) : (
                    <EmployeeLifecycle status={auth.employmentStatus} />
                  )}
                </dd>
                <dt>Operating company</dt>
                <dd data-self-operating-company="UNAVAILABLE">
                  <RuntimeDependency
                    dependency={RUNTIME_DEPENDENCIES.SELF_EMPLOYEE_READ}
                    lead="Not part of your session yet."
                  />
                </dd>
              </dl>
            ) : (
              <p className="ns-state ns-state--na" data-self-employee="NOT_LINKED">
                Your sign-in is not linked to an Employee record. EOS knows you as User Access only — an
                application account — not as an Employee. An administrator links a person to an Employee
                record; nothing here changes that.
              </p>
            )}
          </RuledSection>

          {linked ? <JobRoleSection operationalRoles={eligibility} /> : null}

          <RuledSection title="User Access">
            <dl className="fo-detail-list ns-emp-facts">
              <dt>Your sign-in</dt>
              <dd data-self-user-access={self.identity}>
                {user ? "Signed in to EOS." : <span className="fo-muted">Not signed in.</span>}{" "}
                {linked
                  ? "Your application account is linked to your Employee record."
                  : "Your application account is not linked to an Employee record."}
              </dd>
              <dt>Security Role</dt>
              <dd data-self-security-role={self.securityRole ?? ""}>
                {self.securityRole ? (
                  <>
                    <strong>{securityRoleLabel(self.securityRole)}</strong>{" "}
                    <span className="fo-muted">(legacy compatibility role)</span>
                  </>
                ) : (
                  <span className="fo-muted">No role resolved for your sign-in.</span>
                )}
                <p className="fo-muted ns-emp-note">
                  A Security Role is access — what you may do in EOS. It is not your Job Role, and it
                  says nothing about the work you own, answer for or perform.
                </p>
              </dd>
              <dt>Principal</dt>
              <dd data-self-principal="UNAVAILABLE">
                <RuntimeDependency
                  dependency={RUNTIME_DEPENDENCIES.EMPLOYEE_PRINCIPAL_LINK_READ}
                  lead="The governed Principal link is not readable here yet."
                />
              </dd>
            </dl>
          </RuledSection>
        </div>

        <aside className="ns-rail" aria-label="Your responsibilities">
          <ResponsibilitySection
            perspective="self"
            notApplicable={
              linked
                ? null
                : "No Employee record is linked to your sign-in, so there are no Employee responsibilities to show."
            }
          />
          {linked ? <ManagedEmployeesSection title="People I manage" /> : null}
          <SourceSection
            rows={[
              {
                key: "session",
                label: "Name, status, eligibility, role",
                source: "Your sign-in session, resolved when you signed in. This page adds no read of its own.",
              },
              {
                key: "employee",
                label: "Employee authority",
                source: `The canonical Employee record is not served to this page yet (${RUNTIME_DEPENDENCIES.SELF_EMPLOYEE_READ.id}).`,
              },
            ]}
          />
        </aside>
      </div>
    </div>
  );
}
