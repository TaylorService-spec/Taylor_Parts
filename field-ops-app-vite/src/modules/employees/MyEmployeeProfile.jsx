import { useAuth } from "../../auth/AuthContext";
import { workforceApiClient } from "../../services/workforceApiClient.js";
import { WORKFORCE_READ_STATE, useWorkforceRead } from "../../hooks/useWorkforceRead.js";
import RecordIdentity from "../../shared/ui/RecordIdentity.jsx";
import RuledSection from "../../shared/ui/RuledSection.jsx";
import StructuredFields from "../../shared/ui/StructuredFields.jsx";
import LoadingState from "../../shared/ui/LoadingState";
import { Button } from "../../shared/ui/primitives/index.js";
import { securityRoleLabel } from "../../domain/employeeVocabulary.js";
import {
  MY_PROFILE_STATE,
  WORKFORCE_READS,
  describeLifecycle,
  describeManager,
  describeMyProfileFailure,
  recordCompanyName,
  recordDisplayName,
  recordEmploymentFields,
  recordNameIsAbsent,
  recordSubtitle,
} from "../../domain/employeeOperatingProfile.js";
import {
  EmployeeLifecycle,
  ManagedEmployeesSection,
  ManagerFact,
  ResponsibilitySection,
  SourceSection,
} from "./EmployeeProfileSections.jsx";

// YOUR EMPLOYEE PROFILE -- the self view of the Employee design v4.1 (NS2-EMP-05a, phone frame 1e).
//
// ════════════════════ ONE AUTHORITY: readMyEmployeeProfile (EMP-RT-07) ════════════════════
//
// Who you are as an Employee is resolved by the Workforce service along CREDENTIAL -> PRINCIPAL -> governed
// Employee link -> EMPLOYEE, from your verified sign-in. This page never takes your uid, your session's
// employeeId or any Firestore record and turns it into an Employee, and nothing falls back to them: every
// refusal (not linked, ambiguous, unresolved, not a member) and every outage renders as its own state.
//
// The session is read for exactly two NON-Employee facts: that you are signed in, and your legacy compatibility
// Security Role -- which is access, labelled as such, and never a Job Role.
export default function MyEmployeeProfile({ workforce = workforceApiClient }) {
  const { user, role } = useAuth() ?? {};
  const read = useWorkforceRead(WORKFORCE_READS.MY_PROFILE.operation, undefined, { client: workforce });

  if (read.status === WORKFORCE_READ_STATE.LOADING || read.status === WORKFORCE_READ_STATE.IDLE) {
    return (
      <div className="ns-page fo-my-profile">
        <LoadingState>Loading your profile…</LoadingState>
      </div>
    );
  }

  const failure = read.status === WORKFORCE_READ_STATE.FAILED ? describeMyProfileFailure(read.error) : null;
  const employee = failure ? null : read.data?.employee ?? null;
  const state = failure ? failure.state : MY_PROFILE_STATE.READY;
  const name = employee ? recordDisplayName(employee) : "Your Employee profile";
  const lifecycle = employee ? describeLifecycle(employee.employmentStatus) : null;

  const securityRole = (
    <RuledSection title="User Access">
      <dl className="fo-detail-list ns-emp-facts">
        <dt>Your sign-in</dt>
        <dd data-self-user-access={employee ? "LINKED" : state}>
          {user ? "Signed in to EOS." : <span className="fo-muted">Not signed in.</span>}{" "}
          {employee
            ? `Your EOS Principal is linked to your Employee record through a governed link (${read.data?.principalLink?.linkSource ?? "source not stated"}).`
            : null}
        </dd>
        <dt>Security Role</dt>
        <dd data-self-security-role={role ?? ""}>
          {role ? (
            <>
              <strong>{securityRoleLabel(role)}</strong> <span className="fo-muted">(legacy compatibility role)</span>
            </>
          ) : (
            <span className="fo-muted">No role resolved for your sign-in.</span>
          )}
          <p className="fo-muted ns-emp-note">
            A Security Role is access — what you may do in EOS. It is not your Job Role, and it says nothing about
            the work you own, answer for or perform.
          </p>
        </dd>
      </dl>
    </RuledSection>
  );

  if (!employee) {
    return (
      <div className="ns-page fo-my-profile" data-self-identity={state}>
        <div className="ns-page__utility">
          <span className="ns-page__context">Your Employee profile</span>
        </div>
        <div className="ns-rulepair" />
        <RecordIdentity kicker="Me · Employee" reference={null} fallbackName={name} subtitle="Who EOS says you are" statusWords="No Employee profile available" statusTone="neutral" facts={[]} />
        <div className="ns-record-body">
          <div>
            <RuledSection title="Who EOS says I am">
              <p className="ns-state ns-state--na" data-self-employee={state} role={failure.retryable ? "alert" : undefined}>
                {failure.words}
              </p>
              {failure.retryable ? (
                <Button variant="secondary" onClick={read.reload}>
                  Retry
                </Button>
              ) : null}
            </RuledSection>
            {securityRole}
          </div>
          <aside className="ns-rail" aria-label="Your responsibilities">
            <ResponsibilitySection perspective="self" notApplicable="No Employee profile is available for your sign-in, so there are no Employee responsibilities to show." />
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="ns-page fo-my-profile" data-self-identity={state}>
      <div className="ns-page__utility">
        <span className="ns-page__context">Your Employee profile</span>
      </div>
      <div className="ns-rulepair" />

      <RecordIdentity
        kicker="Me · Employee"
        reference={recordNameIsAbsent(employee) ? null : name}
        fallbackName={name}
        subtitle={recordSubtitle(employee) ?? "Who EOS says you are"}
        statusWords={lifecycle.words}
        statusTone={lifecycle.tone}
        facts={[{ key: "company", label: "Company", value: recordCompanyName(employee) }]}
      />

      <div className="ns-record-body">
        <div>
          <RuledSection title="Who EOS says I am">
            <dl className="fo-detail-list ns-emp-facts">
              <dt>Name</dt>
              <dd>{name}</dd>
              <dt>Employee status</dt>
              <dd>
                <EmployeeLifecycle status={employee.employmentStatus} />
              </dd>
            </dl>
            <StructuredFields fields={recordEmploymentFields(employee)} label="Employment" />
            {/* Plain words, not a link: the Administration record is not every reader's to open. */}
            <ManagerFact manager={describeManager(employee)} linkPeople={false} />
          </RuledSection>

          {securityRole}
        </div>

        <aside className="ns-rail" aria-label="Your responsibilities">
          <ResponsibilitySection perspective="self" employeeId={employee.employeeId} client={workforce} />
          <ManagedEmployeesSection title="People I manage" employeeId={employee.employeeId} client={workforce} linkPeople={false} />
          <SourceSection
            rows={[
              {
                key: "employee",
                label: "Your Employee record",
                source: `The governed PostgreSQL Employee authority, resolved from your sign-in through your governed Employee link (${WORKFORCE_READS.MY_PROFILE.id}).`,
              },
              {
                key: "role",
                label: "Security Role",
                source: "Your sign-in session's legacy compatibility role. Access only — never an Employee fact.",
              },
            ]}
          />
        </aside>
      </div>
    </div>
  );
}
