import { employeeEntity, employeeIndexList } from "../../metadata/definitions/employee.js";
import { useMetadataList } from "../../hooks/useMetadataList";
import MetadataListGrid from "../../metadata/MetadataListGrid.jsx";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";

// ADMINISTRATION > EMPLOYEES -- the governed employee directory.
//
// WHAT THIS REPLACES, AND WHY. This nav item used to render Technicians.jsx, which reads
// `fieldops_technicians` -- a different collection, whose `status` is available/on_job/
// off_shift. That is dispatch state, not employment. The two drifted into parallel
// identities for the same people: in sandbox, employee `sbx-tech` and technician
// `tech-sbx-01` are one human, recorded twice, each missing what the other has (the
// employee record has no name; the technician record has no employment or role).
//
// The divergence was recorded and deliberately left in place, because deciding which
// collection "Employees" means is a product decision rather than a rendering one. The
// Owner made it (2026-08-20): "technician is a role". So the directory is `employees`, and
// being a technician is something an employee IS, not a separate roster they live on.
//
// NOTHING NEW WAS BUILT HERE. employee.index already existed in metadata with its columns,
// filters, name-ordered default sort, pageSize and an "Active" saved view. It had simply
// never been mounted -- the same gap salesOrder.index had. This mounts the declaration on
// the standard list runtime; it does not add a second employee list beside it.
//
// TWO HONEST LIMITS, both visible on screen rather than papered over:
//
//   1. `securityRole` is a denormalized mirror of users/{uid}.role -- the LEGACY field,
//      which only holds admin/dispatcher/technician. It is NOT the governed Role, and it
//      is not the fifteen roles the CRUD matrix names. An employee showing "dispatcher"
//      here may hold salesManager in the governed model. Reconciling those is the role
//      cutover, not this screen.
//
//   2. There is no boolean `active` field on the employee record yet. The Owner asked for
//      an active checkbox; what exists today is `employmentStatus`, a six-value field
//      (ACTIVE / ON_LEAVE / INACTIVE / TERMINATED / RETIRED / CONTRACTOR). Rendering a
//      checkbox derived from it would collapse two different questions -- whether someone
//      is employed, and whether their access is switched on -- and would silently answer
//      "no access" for a CONTRACTOR who should have it. The status is shown as itself
//      until the boolean exists and is wired to the `employmentActive` condition.
export default function EmployeesList() {
  const { presentation, loadMore, retry } = useMetadataList(employeeIndexList, employeeEntity, {
    filters: [],
  });

  return (
    <WorkspaceShell title="Employees">
      <p className="fo-muted">
        The governed employee directory. Security Role shown here mirrors the legacy identity
        role (admin, dispatcher, technician) — not the governed Role an employee holds.
      </p>
      {/* No onRowClick: no employee record page exists yet, and a row that looks clickable
          and goes nowhere is worse than one that does not invite the click. */}
      <MetadataListGrid
        presentation={presentation}
        caption="Employees"
        onLoadMore={loadMore}
        onRetry={retry}
      />
    </WorkspaceShell>
  );
}
