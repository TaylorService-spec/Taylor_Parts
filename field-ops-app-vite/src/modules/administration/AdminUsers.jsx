import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import MetadataListGrid from "../../metadata/MetadataListGrid.jsx";
import WorkspaceIdentity from "../../shared/ui/WorkspaceIdentity.jsx";
import { workforceApiClient } from "../../services/workforceApiClient.js";
import { useWorkforceEmployeeDirectory } from "../../hooks/useWorkforceEmployeeDirectory.js";
import { employeeDirectoryPresentation } from "../../domain/employeeOperatingProfile.js";
// THE STORED ASSIGNMENTS, beside the employee directory. A PRINCIPAL is the identity EOS
// authorizes and it is not the same record as an employee -- the panel says so rather than
// letting the proximity of the two tables imply they are one thing.
import { UsersPolicyPanel } from "./PolicyStorePanels.jsx";

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
// merged. UsersPolicyPanel below presents the Principal side and is deliberately a separate panel.
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
// WHAT IS NOT SHOWN, BECAUSE THE GOVERNED READ DOES NOT RETURN IT. The projection is employeeId,
// display name, employee number, employment status, operating company and job title. Account status,
// EOS account linkage, the legacy Security Role mirror and any Firebase uid are NOT in it -- and are
// not fetched from somewhere else to fill a column. User Access linkage for one person is on the
// record page (EMP-RT-01 userAccess / EMP-RT-02); Role assignments are the Principal panel below.
//
// ════════════════════ A ROW CLICK READS. EDIT IS A DESTINATION. ════════════════════
//
// Clicking a row (or its name) opens the Employee record READ-ONLY. Nothing here ever turns a row into
// an editable field. The Edit action opens the same record with `?edit=1`, where editing states that it
// is unavailable: PostgreSQL is the Employee profile authority and no governed profile writer is served
// yet (EMP-RT-W1). The destination is kept so the answer is given in one place rather than two.
export default function AdminUsers({ workforce = workforceApiClient }) {
  const navigate = useNavigate();
  const directory = useWorkforceEmployeeDirectory({ client: workforce });

  const presentation = useMemo(
    () =>
      employeeDirectoryPresentation({
        status: directory.status,
        items: directory.items,
        hasMore: directory.hasMore,
        error: directory.error,
      }),
    [directory.status, directory.items, directory.hasMore, directory.error],
  );

  const openDetail = useCallback(
    // The PostgreSQL employeeId the governed read returned -- the same id the record page reads by.
    (employeeId) => navigate(`/administration/users/${employeeId}`),
    [navigate],
  );

  const rowActions = useMemo(
    () => [
      { id: "view", label: "View", onActivate: openDetail },
      {
        id: "edit",
        label: "Edit",
        onActivate: (employeeId) => navigate(`/administration/users/${employeeId}?edit=1`),
      },
    ],
    [navigate, openDetail],
  );

  // THE COUNT EXISTS ONLY WHEN THE CURSOR IS EXHAUSTED -- the rule Suppliers, Warehouses and the
  // retired Employees screen all state at length, and a people directory is where a partial count
  // reads most convincingly as a complete one ("47 users" sounds like a headcount). No aggregate
  // query was added to rescue the partial case: that would be creating a read to make the page
  // look finished.
  const complete = presentation.state === "READY" && !presentation.hasMore;

  return (
    <WorkspaceIdentity
      crumb="Administration → Users"
      title="Users"
      count={complete ? presentation.rows.length : null}
      countLabel={presentation.rows.length === 1 ? "user" : "users"}
      // NOTHING TO SUMMARISE. employmentStatus is a six-value field with no governed aggregate over
      // it, so a workload line here would be a tally of the loaded page presented as a fact about
      // the company. Silence is the honest answer, not an approximation in a smaller font.
      summaryItems={[]}
      // NO CREATE ACTION. A person enters EOS through the governed operator process, not through a
      // screen, and a disabled "New user" here would describe a permission boundary when the truth is
      // that creating one is an onboarding procedure.
    >
      <p className="fo-muted">
        Employee business records from the governed Employee authority: name, Employee ID, employment
        status, job title and operating company. Whether a person can sign in is User Access, not an
        Employee fact — a person&apos;s linkage is on their record, and the Roles a Principal holds are
        in the panel below.
      </p>
      {/* THE DIRECTORY IS MEASURED AGAINST ITSELF, NOT THE WINDOW. This wrapper exists only to
          be a containment context: `.fo-users-directory` in index.css asks how much width the
          directory actually has once the application rail has taken its share, and recomposes
          the columns into the shared labelled-card grammar below 760px of its OWN width.
          The rail is why a 900px window was clipping View and Edit off the right edge while the
          640px phone breakpoint sat unfired -- the numbers are in the CSS comment and in
          scripts/adminUsersResponsiveProbe.mjs. No second Users table: same grid, same cells,
          same data-labels, recomposed. */}
      <div className="fo-users-directory">
        <MetadataListGrid
          presentation={presentation}
          caption="Users"
          onRowClick={openDetail}
          rowActions={rowActions}
          onLoadMore={directory.loadMore}
          onRetry={directory.retry}
        />
      </div>

      <UsersPolicyPanel />
    </WorkspaceIdentity>
  );
}
