import { useMemo, useState } from "react";
import { GOVERNED_BUSINESS_ROLES } from "../../access/governedBusinessRoles.ts";
import { COMPATIBILITY_ROLES } from "../../access/compatibilityRoles.ts";
import { PERMISSION_CATALOG } from "../../access/permissionCatalog.ts";
import { OBJECT_PERMISSIONS, VERBS, VERB_LABEL, cellState, cellCapabilities } from "../../access/objectPermissionMap.js";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import { Button } from "../../shared/ui/primitives/index.js";

// ADMINISTRATION > OBJECTS -- the Role x Object x CRED grid.
//
// The model this screen renders (Owner, 2026-08-20):
//
//     Employee  ->  Role  ->  object permissions (C / R / E / D)
//
// One axis. An employee holds a Role, the Role's name matches the CRUD matrix, and the
// Role's authority is these checkboxes. CRED and CRUD are the same four verbs -- the
// business says Edit, the permission catalog's action is `update`.
//
// IT RENDERS THE REAL GRANTS, NOT A MOCK. Every tick is read from the live access
// contracts (governedBusinessRoles / compatibilityRoles / permissionCatalog), so this
// screen is the answer to "what can this role actually do", not a picture of what someone
// intended. That is the whole point: the CRUD matrix could not be reconciled against the
// system, which is how admin came to hold 50 of 110 capabilities with nobody noticing.
//
// THREE CELL STATES, NOT TWO. Ticked = granted, blank = not granted -- as specified. But a
// third state exists and must not be drawn as a blank box: some object/verb pairs have NO
// capability in the catalog at all (Marketing Initiatives, Commissions, Technician Time,
// and every Delete but one). Rendering "nobody can ever hold this" as an unticked checkbox
// would invite an admin to go request access that cannot be granted to any role in the
// system. Those cells render as an explicit dash.
//
// READ-ONLY, HONESTLY. The boxes do not write. Role definitions live in code today, and no
// governed command exists to change a Role's permission set -- the trusted writers grant
// ROLES TO PEOPLE, not permissions to roles. Making these inputs live would either write
// nothing or write outside the governed path. They are disabled with the reason stated on
// screen, the same posture as Roles & Permissions.
const ALL_ROLES = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };

const ACTIVE_IDS = new Set(PERMISSION_CATALOG.filter((p) => p.active !== false).map((p) => p.id));

// Roles named in the Owner's CRUD matrix, in its own order. Kept as a stated list rather
// than derived from the code, so a role the business has defined but the system has not
// shows up as MISSING instead of silently vanishing from the screen.
const MATRIX_ROLES = [
  { label: "Owner", id: "owner" },
  { label: "Admin", id: "admin" },
  { label: "General Manager", id: "generalManager" },
  { label: "Sales Manager", id: "salesManager" },
  { label: "Salesperson", id: "salesperson" },
  { label: "Marketing Manager", id: "marketingManager" },
  { label: "Service Manager", id: "fieldManager" },
  { label: "Dispatcher", id: "dispatcher" },
  { label: "Technician", id: "technician" },
  { label: "Warehouse Manager", id: "warehouseManager" },
  { label: "Warehouse Associate", id: "warehouseAssociate" },
  { label: "Purchasing Manager", id: "purchasingManager" },
  { label: "Controller", id: "controller" },
  { label: "Accounting Manager", id: "accountingManager" },
  { label: "Support Staff", id: "supportStaff" },
  { label: "Shop Manager", id: "shopManager" },
];

function Cell({ state }) {
  if (state === "noCapability") {
    return (
      <span className="fo-muted" title="No capability exists for this verb — it cannot be granted to any role">
        —
      </span>
    );
  }
  return (
    <input
      type="checkbox"
      checked={state === "granted"}
      readOnly
      disabled
      aria-label={state === "granted" ? "Granted" : "Not granted"}
    />
  );
}

export default function AdminObjects() {
  const [roleKey, setRoleKey] = useState("admin");
  const selected = MATRIX_ROLES.find((r) => r.id === roleKey) ?? MATRIX_ROLES[1];
  const role = selected.id ? ALL_ROLES[selected.id] : null;

  const summary = useMemo(() => {
    if (!role) return null;
    let granted = 0;
    let inert = 0;
    for (const entry of OBJECT_PERMISSIONS) {
      for (const v of VERBS) {
        if (cellState(role, entry, v) !== "granted") continue;
        granted += 1;
        // A granted capability registered active:false still denies for everyone. Counting
        // these separately keeps the grid from reading as more authority than it confers.
        const ids = cellCapabilities(role, entry, v).filter((c) => c.held);
        if (ids.length > 0 && ids.every((c) => !ACTIVE_IDS.has(c.id))) inert += 1;
      }
    }
    return { granted, inert };
  }, [role]);

  const picker = (
    <div className="fo-chip-row" role="group" aria-label="Select a role">
      {MATRIX_ROLES.map((r) => (
        <Button
          key={r.label}
          variant={r.id === roleKey ? "primary" : "secondary"}
          onClick={() => r.id && setRoleKey(r.id)}
          disabled={!r.id}
          title={r.id ? undefined : "This role is named in the CRUD matrix but does not exist in the system yet"}
        >
          {r.label}
          {r.id ? "" : " (not defined)"}
        </Button>
      ))}
    </div>
  );

  return (
    <WorkspaceShell title="Objects" context={picker}>
      <p className="fo-muted">
        An employee holds a Role; the Role's authority is the grid below. C = Create, R = Read,
        E = Edit, D = Delete. A tick is a granted capability, a blank box is not granted, and a
        dash means no capability exists for that verb — it cannot be granted to anyone.
      </p>

      {!role && (
        <p className="fo-warning">
          <strong>{selected.label}</strong> is named in the CRUD matrix but has no Role in the
          system, so it holds nothing and cannot be assigned to an employee.
        </p>
      )}

      {role && summary && (
        <p className="fo-muted">
          {selected.label} holds {summary.granted} of {OBJECT_PERMISSIONS.length * VERBS.length} cells
          {summary.inert > 0 ? ` — ${summary.inert} of them registered inactive, so they deny in every environment regardless of the grant.` : "."}
        </p>
      )}

      {role && (
        <table className="fo-table">
          <thead>
            <tr>
              <th scope="col">Object</th>
              <th scope="col">Domain</th>
              {VERBS.map((v) => (
                <th key={v} scope="col" title={VERB_LABEL[v]}>{v}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {OBJECT_PERMISSIONS.map((entry) => (
              <tr key={entry.object}>
                <td>
                  {entry.object}
                  {entry.rulesOnly && (
                    <span className="fo-muted" title={`Governed by firestore.rules on ${entry.rulesOnly}, outside the capability model`}>
                      {" "}(rules-governed)
                    </span>
                  )}
                </td>
                <td className="fo-muted">{entry.domain}</td>
                {VERBS.map((v) => (
                  <td key={v}>
                    <Cell state={cellState(role, entry, v)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* The write path is stated, not hidden behind a control that would do nothing. */}
      <p className="fo-warning">
        These boxes are read-only. Role definitions live in code today, and the trusted
        commands grant <em>roles to people</em>, not permissions to roles — so there is no
        governed path to change a tick from this screen yet. Editing becomes available when
        Role definitions move to administered data.
      </p>
    </WorkspaceShell>
  );
}
