import { Link } from "react-router-dom";
import WorkspaceIdentity from "../../shared/ui/WorkspaceIdentity.jsx";
import { workforceApiClient } from "../../services/workforceApiClient.js";
// Administration control plane (#210): the directory IS the workforce roster -- Job Role, Security Roles, scopes and
// assignment per Employee, filterable -- one governed read, one table (the earlier name/number-only directory is retired).
import WorkforceRoster from "./WorkforceRoster.jsx";
// THE STORED ASSIGNMENTS, beside the employee directory. A PRINCIPAL is the identity EOS
// authorizes and it is not the same record as an employee -- the panel says so rather than
// letting the proximity of the two tables imply they are one thing.
// EMP-RT-08: Employees with no Job Role, counted by the governed read so an administrator can assign them explicitly.
import JobRoleRemediation from "./JobRoleRemediation.jsx";

// ADMINISTRATION → USERS -- the one people-management destination.
//
// ════════════════════ WHAT WAS CONSOLIDATED, AND WHAT WAS NOT ════════════════════
//
// Administration used to carry TWO people destinations. "Employees" rendered the governed employee
// directory. "Users" rendered a governance status page with two permanently-disabled buttons and a
// password-reset surface that had no particular user to point at. Neither was a place an
// administrator could go to find a person and then see or change anything about them.
//
// They are now ONE destination, and EmployeesList.jsx is deleted rather than left running beside
// this -- two directories over one collection is how they drift into disagreeing about the same
// people. The retired Employees URLs redirect here (App.jsx).
//
// THE CONSOLIDATION IS PRESENTATIONAL. Underneath, nothing collapsed: the Employee is the workforce
// business record, the PRINCIPAL is the identity EOS authorizes, and the two are linked rather than
// merged. A person's Security Roles are administered on their Employee record (Security Roles section),
// the one interactive assignment surface (Pass 10 F2); Permission Preview shows every Principal's access.
//
// ════════════════════ THE DIRECTORY IS THE GOVERNED PostgreSQL READ ════════════════════
//
// Rows come from EMP-RT-01 `listEmployees` over the governed PostgreSQL Employee authority
// (browser: services/workforceApiClient.js → POST /workforce/employees → functions/src/eosWorkforce/
// reads/employeeDirectoryReads.ts). It is keyset-paginated by Employee id and bounded by the server's
// own page size; Load More asks for the next cursor and appends.
//
// IT USED TO BE THE FIRESTORE `employee.index` METADATA LIST, and that was the defect: the record page
// had already moved to PostgreSQL, so a Firestore directory id handed to /administration/users/:id
// produced a live 404 for any Employee whose two ids disagreed. One authority, one id space: the row
// key here IS the PostgreSQL employeeId the record page reads.
//
// The metadata definition `employee.index` is left in place -- other surfaces and suites reference it
// -- but this page no longer reads through it and holds no Firestore dependency of any kind. There is
// no fallback: a refusal renders "not available to you" and an outage renders a retryable failure,
// neither of them as an empty directory.
//
// EMPLOYEES WITHOUT A JOB ROLE. Above the directory, JobRoleRemediation states the EMP-RT-08 count of Employees with
// no current Job Role (listEmployeesWithoutJobRole) and lists them, each linking to their record, where the Job Role
// section offers the governed control. It is a separate read: Job Role is still not a directory column.
//
// WHAT IS NOT SHOWN, BECAUSE THE GOVERNED READ DOES NOT RETURN IT. The projection is employeeId,
// display name, employee number, employment status, operating company and job title. Account status,
// EOS account linkage, the legacy Security Role mirror and any Firebase uid are NOT in it -- and are
// not fetched from somewhere else to fill a column. User Access linkage for one person is on the
// record page (EMP-RT-01 userAccess / EMP-RT-02); Role assignments are the Principal panel below.
//
// ════════════════════ A ROW CLICK READS. EDIT IS A DESTINATION. ════════════════════
//
// Clicking a row (or its name) opens the Employee record READ-ONLY. Nothing here ever turns a row into
// an editable field. The Edit action opens the same record with `?edit=1`, and the RECORD PAGE decides:
// for a caller holding admin.employeeProfile.write it opens the governed editor (the Workforce profile and
// reporting-relationship commands, EMP-RT-W1); for anyone else it says editing is not available to them.
// The destination is kept so that answer, and the server's own refusal, are given in one place, not two.
export default function AdminUsers({ workforce = workforceApiClient }) {
  return (
    <WorkspaceIdentity
      crumb="Administration → Users"
      title="Users"
      // The roster states its own count from the governed read (and the counts per Job Role / Security Role).
      count={null}
      summaryItems={[]}
      // NO CREATE ACTION. A person enters EOS through the governed operator process, not through a screen.
    >
      <p className="fo-muted">
        The workforce from the governed Employee and Security authorities: each person&apos;s Job Role (the job they do),
        Security Roles (the authority they hold, with its scope), status, operating company and operational scope. Open a
        person to see their Effective Access — what EOS resolves for them, and why — or to preview their workspace.
      </p>
      {/* EMPLOYEES WITHOUT A JOB ROLE (EMP-RT-08). Its own governed read and count. Silent when the count is 0. */}
      <JobRoleRemediation workforce={workforce} />
      <p className="fo-muted">
        <Link to="/administration/users/functional-roles">Functional Roles</Link> — the catalog of business
        responsibilities an Employee may hold. They grant nothing.
      </p>
      <div className="fo-users-directory">
        <WorkforceRoster workforce={workforce} />
      </div>
    </WorkspaceIdentity>
  );
}
