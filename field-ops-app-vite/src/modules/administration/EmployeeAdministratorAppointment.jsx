// EMPLOYEE > ROLES & ACCESS > ADMINISTRATOR -- appoint or remove the designated protected Administrator (DECISIONS #223).
//
// ONE CHECKBOX, ONE ROLE, ONE SCOPE. The designated Administrator is the Role whose key is `admin` AND which the server
// marks `protected` in the listRoles read -- never matched by display name. Checked means the linked Principal holds an
// ACTIVE, GLOBAL assignment of exactly that Role, as the server's listPrincipalRoleAssignments read states it.
//
//   appoint  assignRole { principalId, roleId, reason }   -- GLOBAL ONLY: no scope is ever sent from here
//   remove   revokeRole { assignmentId, reason }          -- that exact active global assignment
//
// THE SERVER DECIDES EVERYTHING. Global scope only, no self-appointment or self-removal (SELF_ADMINISTRATION), never the
// last Administrator (WOULD_REMOVE_LAST_ADMINISTRATION_PATH / "last active administering assignment"), never an Owner
// holder (PROTECTED_ROLE_CONFLICT), a stated reason, and who may act at all (the Owner through
// admin.administratorRole.assign, or a protected Administrator). This control only withholds what it already knows the
// server would refuse, or cannot act on -- yourself, no linked Principal, reads loading or failed -- and says why in
// words. WHO MAY ACT is never decided here: there is no client capability gate (and no Firebase feed is consulted --
// Firebase is retirement-only). Anyone who can see this page sees the box; a FORBIDDEN / PRIVILEGE_ESCALATION refusal
// is shown with its sentence and the server's code and message, and the box is re-read, not flipped.
//
// NEVER OPTIMISTIC. The box is drawn from the server read; after EVERY attempt (accepted or refused) the parent's read
// is re-run and the box shows what came back.
//
// The protected Owner Role is never shown or touched here: Owner membership is not ordinary administration.
import { useState } from "react";
import ConfirmDialog from "../../shared/ui/ConfirmDialog.jsx";
import { refusalText } from "../../services/adminControlPlaneClient.js";
import {
  activeGlobalAdministratorAssignment,
  administratorRefusalSentence,
  designatedAdministratorRole,
} from "./administratorAppointmentModel.js";

/** Why the checkbox cannot be used, in words, or null when it can. Order: what is most fundamental first. */
function disabledReason({ principalId, rolesRead, rowsRead, adminRole, viewerIsSelf }) {
  if (!principalId) return "No governed Principal is linked to this Employee, so there is no one to appoint.";
  if (rolesRead === "loading" || rowsRead === "loading") return "Reading the Administrator appointment from the server…";
  if (rolesRead !== "ready" || rowsRead !== "ready") return "The Administrator appointment could not be read from the server, so it cannot be changed here.";
  if (!adminRole) return "The server's Role list names no protected Administrator Role (key admin), so there is nothing to appoint.";
  if (viewerIsSelf === null) return "Confirming whose account this is…";
  if (viewerIsSelf === true) return "This is your own account. No one may appoint or remove themself as Administrator.";
  return null;
}

/**
 * @param props.principalId     the linked Principal, or null
 * @param props.roles           the server's listRoles answer (array) or null
 * @param props.rows            the server's listPrincipalRoleAssignments rows or null
 * @param props.rolesStatus     "loading" | "ready" | other (failed/unavailable)
 * @param props.rowsStatus      same, for the assignments read
 * @param props.reload          re-runs the assignments read (after every attempt)
 * @param props.viewerIsSelf    true / false, or null while it is not yet known
 */
export default function EmployeeAdministratorAppointment({
  api, principalId, roles, rows, rolesStatus, rowsStatus, reload, employeeName = "this Employee", viewerIsSelf,
}) {
  const [pending, setPending] = useState(null); // "appoint" | "remove" | null
  const [result, setResult] = useState(null);

  const adminRole = designatedAdministratorRole(roles);
  const held = activeGlobalAdministratorAssignment(rows, adminRole);
  const blocked = disabledReason({ principalId, rolesRead: rolesStatus, rowsRead: rowsStatus, adminRole, viewerIsSelf });
  const checked = Boolean(held);

  const confirm = async (reason) => {
    const outcome = pending === "appoint"
      ? await api.assignRole({ principalId, roleId: adminRole.id, reason })
      : await api.revokeRole({ assignmentId: held.id, reason });
    setResult(outcome ?? { ok: false, code: "INTERNAL", message: "the request could not be completed" });
    setPending(null);
    // ALWAYS re-read: the box shows the server's answer, never what was asked for.
    reload?.();
  };

  const sentence = administratorRefusalSentence(result);
  return (
    <div className="fo-cp-form" data-administrator-appointment={checked ? "HELD" : "NOT_HELD"}>
      <label className="fo-check">
        <input
          type="checkbox"
          checked={checked}
          disabled={blocked !== null}
          aria-describedby="administrator-appointment-help"
          onChange={() => { setResult(null); setPending(checked ? "remove" : "appoint"); }}
        />
        {" "}Administrator
      </label>
      <p className="fo-muted" id="administrator-appointment-help">
        Full system administration. Not a job assignment, and it grants no Work Eligibility.
      </p>
      {blocked ? <p className="fo-muted" data-administrator-appointment-disabled>{blocked}</p> : null}
      {result?.ok ? (
        <p className="fo-muted" role="status">Saved by the server; re-reading.</p>
      ) : result ? (
        <p className="fo-warning" role="alert" data-administrator-refusal={result.code}>
          {sentence} <span data-control-plane-refusal={result.code}>{refusalText(result)}</span>
        </p>
      ) : null}
      {pending ? (
        <ConfirmDialog
          title={pending === "appoint" ? `Appoint ${employeeName} as Administrator?` : `Remove ${employeeName} as Administrator?`}
          destructive={pending === "remove"}
          consequence={pending === "appoint"
            ? `${employeeName} will hold full system administration across the whole tenant. This is not a job assignment and grants no Work Eligibility.`
            : `${employeeName} will no longer hold full system administration. The server refuses this if it would leave no Administrator.`}
          confirmLabel={pending === "appoint" ? "Appoint Administrator" : "Remove Administrator"}
          cancelLabel="Cancel"
          requireReason
          reasonLabel="Reason (Recorded in the Audit Trail)"
          onConfirm={confirm}
          onClose={() => setPending(null)}
        />
      ) : null}
    </div>
  );
}
