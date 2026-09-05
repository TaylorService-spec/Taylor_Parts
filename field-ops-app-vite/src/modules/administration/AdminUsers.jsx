import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { employeeEntity, employeeIndexList } from "../../metadata/definitions/employee.js";
import { useMetadataList } from "../../hooks/useMetadataList";
import MetadataListGrid from "../../metadata/MetadataListGrid.jsx";
import WorkspaceIdentity from "../../shared/ui/WorkspaceIdentity.jsx";
import { EOS_ACCESS, EOS_ACCESS_LABEL } from "../../domain/employeeProfile.js";
import { securityRoleLabel } from "../../domain/employeeVocabulary.js";

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
// THE CONSOLIDATION IS PRESENTATIONAL. Underneath, nothing collapsed: `employees` is still the
// authoritative workforce identity, `users/{uid}` is still application-access identity,
// operationalRoles are still eligibility markers rather than permissions, and securityRole is
// still a read-only mirror of the legacy role. The page is one; the authorities are not, and
// domain/employeeProfile.js is where that separation is kept honest.
//
// ════════════════════ THIS IS THE EMPLOYEE DIRECTORY, NOT A COPY OF IT ════════════════════
//
// The rows come from `employee.index` (metadata/definitions/employee.js) on the standard list
// runtime -- the same declaration, the same Rules-granted client-direct read, the same
// name-ordered default sort and 50-row page the retired Employees screen used. No second read path
// was added and no employee domain code was deleted; the directory moved under the name Users.
//
// ════════════════════ A ROW CLICK READS. EDIT EDITS. ════════════════════
//
// Clicking a row (or its name) opens User Detail READ-ONLY. Nothing here ever turns a row into an
// editable field: an inline-editable table makes every stray click a candidate write to somebody's
// employment record, and it has nowhere to put the validation, the confirmation and the audit a
// governed change requires. The explicit Edit action opens the SAME edit flow the detail page's
// Edit User button opens, against the SAME trusted command -- one write path, two doors to it.
export default function AdminUsers() {
  const navigate = useNavigate();
  const { presentation, loadMore, retry } = useMetadataList(employeeIndexList, employeeEntity, {
    filters: [],
  });

  // THE EOS ACCOUNT CELL, composed here rather than in the metadata layer.
  //
  // `makeColumn` deliberately accepts no custom renderer -- the definition's own validator rejects
  // one by name -- and names post-processing `presentation.rows[].cells` as what a caller needing
  // custom cell display does instead. This is that. The `userId` column is relabelled "EOS Account"
  // in the definition, and its cell becomes words: the raw uid never reaches a reader, which is
  // the point, because a Firebase uid in a directory column is unreadable and teaches people to
  // recognise internal keys.
  //
  // It says "Account linked" / "No account", NOT "Enabled" / "Disabled". Whether an account is
  // enabled is Firebase Auth state, and no governed read exposes another user's to this client.
  // Deriving it from employment status would render a CONTRACTOR who legitimately holds access as
  // switched off -- the exact conflation this product forbids. The detail page says the same thing
  // at greater length rather than filling the gap with a guess.
  //
  // The COLUMN is headed "EOS Account" for the same reason (Owner ruling, PR #1806): a heading
  // reading Access over a linkage value invites "this person HAS access", which is a stronger claim
  // than "an account exists" and the one no read here can support.
  //
  // SECURITY ROLE IS GIVEN ITS WORDS IN THE SAME PASS. It is a plain STRING field (deliberately --
  // it is a mirror, and declaring enumLabels on it would dress a mirror up as a governed
  // vocabulary), so the runtime renders the stored machine value: a column reading "technician"
  // beside one reading "Active" teaches a reader that some of these are database constants.
  // securityRoleLabel is the ONE label map for it, reused rather than restated here, and an
  // unrecognised value still passes through verbatim rather than becoming a placeholder.
  const withDisplayWords = useMemo(() => {
    if (presentation.state !== "READY") return presentation;
    const accessIndex = presentation.columns.findIndex((c) => c.fieldId === "userId");
    const roleIndex = presentation.columns.findIndex((c) => c.fieldId === "securityRole");
    if (accessIndex < 0 && roleIndex < 0) return presentation;
    return {
      ...presentation,
      rows: presentation.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell, index) => {
          if (index === accessIndex) {
            // cellValue already resolved an absent/blank userId to null, so the presence of a
            // value IS the linkage -- no second interpretation of the stored shape here.
            return { ...cell, value: EOS_ACCESS_LABEL[cell.value ? EOS_ACCESS.LINKED : EOS_ACCESS.NO_ACCOUNT] };
          }
          if (index === roleIndex && cell.value) {
            return { ...cell, value: securityRoleLabel(cell.value) };
          }
          return cell;
        }),
      })),
    };
  }, [presentation]);

  const openDetail = useCallback(
    (employeeId) => navigate(`/administration/users/${employeeId}`),
    [navigate],
  );

  const rowActions = useMemo(
    () => [
      { id: "view", label: "View", onActivate: openDetail },
      // Edit is a different DESTINATION, not a mode toggle on the row: the detail page opens
      // read-only, and `?edit=1` opens it with the editor already up. Both reach the same form and
      // the same trusted command; authorization is resolved there, never by whether this button
      // rendered.
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
      // NO CREATE ACTION. A person enters EOS through the governed operator script
      // (functions/scripts/provisionEmployeeAccess.js), which links a human to application access
      // reciprocally. A disabled "New user" here would describe a permission boundary when the
      // truth is that creating one is an onboarding procedure rather than a screen.
    >
      <p className="fo-muted">
        Employee profiles, operational roles, EOS access and security roles. Security Role mirrors
        the legacy identity role (admin, dispatcher, technician) — not the governed Role a person
        holds. EOS Account shows whether an application account exists for this person; whether that
        account is enabled or disabled is Firebase Auth state that no governed read exposes yet.
      </p>
      {/* THE DIRECTORY IS MEASURED AGAINST ITSELF, NOT THE WINDOW. This wrapper exists only to
          be a containment context: `.fo-users-directory` in index.css asks how much width the
          directory actually has once the application rail has taken its share, and recomposes
          the six columns into the shared labelled-card grammar below 760px of its OWN width.
          The rail is why a 900px window was clipping View and Edit off the right edge while the
          640px phone breakpoint sat unfired -- the numbers are in the CSS comment and in
          scripts/adminUsersResponsiveProbe.mjs. No second Users table: same grid, same cells,
          same data-labels, recomposed. */}
      <div className="fo-users-directory">
        <MetadataListGrid
          presentation={withDisplayWords}
          caption="Users"
          onRowClick={openDetail}
          rowActions={rowActions}
          onLoadMore={loadMore}
          onRetry={retry}
        />
      </div>
    </WorkspaceIdentity>
  );
}
