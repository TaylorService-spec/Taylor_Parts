// ADMINISTRATION > OBJECTS > OBJECT SECURITY ACTIONS -- the ENFORCED grant surface, per Object.
//
// Contract: docs/architecture/administration-control-plane-2026-09-26.md section 8.
//
// ════════════════════ WHAT AN ADMINISTRATOR SEES ════════════════════
//
//   choose an Object -> its REAL capability vocabulary (getObjectActionGrantMatrix -- Dispatch,
//   Record Consumption, Accept..., not a generic Create/Read/Edit/Delete grid) -> for each action:
//     * every Security Role cell the server reports: held or not, SOURCE (System default / Admin
//       granted / Admin revoked / System invariant), and the grant's CONDITION
//     * every direct Principal grant, labelled DIRECT EXCEPTION -- honoured only on the Workforce
//       path, not by the main operational gates
//     * Grant / Revoke / Set condition / Retire condition per Role, each with a required reason
//     * Grant to another Security Role
//
// The runtime reads these same PostgreSQL rows on every request (role_capabilities +
// capability_grant_conditions). Nothing here is display-only configuration.
//
// ════════════════════ WHAT THIS SCREEN DOES NOT DO ════════════════════
//
// It does not decide who may administer: the server's admin.securityPolicy.write gate does, and its
// FORBIDDEN is shown verbatim. It does not decide what a Role can do: the server's evaluator does.
import { useMemo, useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import { adminControlPlaneClient, refusalText } from "../../services/adminControlPlaneClient.js";
import { ObjectSecurityActionList } from "./ObjectSecurityActionList.jsx";
import { useControlPlaneRead } from "./useControlPlaneRead.js";
import { ConditionFields, GrantCellControls, GrantCellFacts, Outcome, ReasonField } from "./GrantControls.jsx";
import { buildCondition, conditionKindsFor, matrixActionRows, statedReason } from "./controlPlaneModel.js";

export function ReadState({ read, what }) {
  if (read.status === "loading") return <p className="fo-muted">{`Reading ${what}…`}</p>;
  if (read.status === "unavailable") {
    return <p className="fo-warning" data-read-state="unavailable">{`${what} is not served by this EOS API yet (${refusalText(read.error)}).`}</p>;
  }
  if (read.status === "failed") return <p className="fo-warning" role="alert" data-read-state="failed">{refusalText(read.error)}</p>;
  return null;
}

export default function ObjectActionSecurityPanel({ api = adminControlPlaneClient, initialObjectKey = null }) {
  const [objectKey, setObjectKey] = useState(initialObjectKey);
  const inventory = useControlPlaneRead(() => api.listObjectsWithActions(), "inventory");
  const objects = Array.isArray(inventory.data) ? inventory.data : [];

  return (
    <section className="fo-panel" aria-label="Object security actions">
      <h3>Object security actions <span className="fo-muted">· enforced by the server evaluator</span></h3>
      <p className="fo-muted">
        Each Object&rsquo;s own actions, and which Security Roles hold each one. A grant, revoke or
        condition here is written to the governed policy store, audited with your reason, and read by
        the runtime on the next request.
      </p>
      <ReadState read={inventory} what="the Object inventory" />
      {inventory.status === "ready" ? (
        <label className="fo-form-field">
          <span>Object</span>
          <select aria-label="Object" value={objectKey ?? ""} onChange={(e) => setObjectKey(e.target.value || null)}>
            <option value="">Choose an Object…</option>
            {objects.map((o) => (
              <option key={o.key} value={o.key}>
                {`${o.label ?? o.key} (${Array.isArray(o.actions) ? o.actions.length : 0} actions)`}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {objectKey ? <ObjectActionMatrix api={api} objectKey={objectKey} /> : null}
    </section>
  );
}

/** One Object's action x grantee matrix, with the controls. Exported for a direct component proof. */
export function ObjectActionMatrix({ api = adminControlPlaneClient, objectKey }) {
  const matrix = useControlPlaneRead(() => api.getObjectActionGrantMatrix(objectKey), `matrix:${objectKey}`);
  const roles = useControlPlaneRead(() => api.listRoles(), "roles");
  const rows = useMemo(() => (matrix.data ? matrixActionRows(matrix.data) : null), [matrix.data]);
  const kinds = conditionKindsFor(matrix.data?.supportedConditionKinds);

  if (!matrix.data) return <ReadState read={matrix} what="this Object's actions" />;
  if (!rows) {
    return <p className="fo-warning" role="alert">The server returned an Object security payload this screen cannot read, so nothing is shown.</p>;
  }

  return (
    <div className="fo-cp-section" data-object-matrix={objectKey}>
      <h4>{matrix.data.label ?? objectKey} <span className="fo-muted">· <code>{objectKey}</code></span></h4>
      {matrix.status === "loading" ? <p className="fo-muted" role="status">Re-reading from the server…</p> : null}
      <ObjectSecurityActionList
        actions={rows}
        emptyMessage="No capability governs an action on this Object yet."
        renderDetail={(action) => (
          <ActionGrantees
            api={api}
            objectKey={objectKey}
            action={action}
            kinds={kinds}
            roles={Array.isArray(roles.data) ? roles.data : []}
            onChanged={matrix.reload}
          />
        )}
      />
    </div>
  );
}

function ActionGrantees({ api, objectKey, action, kinds, roles, onChanged }) {
  const shown = new Set(action.roles.map((r) => r.roleKey));
  const others = roles.filter((r) => !shown.has(r.key));
  return (
    <>
      <table className="fo-table" aria-label={`Grantees of ${action.displayLabel ?? action.actionKey}`}>
        <thead><tr><th>Grantee</th><th>State</th><th>Administer</th></tr></thead>
        <tbody>
          {action.roles.map((cell) => (
            <tr key={cell.roleKey} data-role-cell={cell.roleKey}>
              <td>Security Role <code>{cell.roleKey}</code></td>
              <td><GrantCellFacts cell={cell} /></td>
              <td>
                <GrantCellControls
                  api={api}
                  objectKey={objectKey}
                  actionKey={action.actionKey}
                  roleKey={cell.roleKey}
                  cell={cell}
                  kinds={kinds}
                  onChanged={onChanged}
                />
              </td>
            </tr>
          ))}
          {action.principals.map((p) => (
            <tr key={p.principalId} data-direct-exception={p.principalId}>
              <td>Principal <code>{p.principalId}</code></td>
              <td>
                <span className="fo-cp-tag fo-cp-tag--direct">DIRECT EXCEPTION</span>{" "}
                <span className="fo-muted">Honoured only on the Workforce path; the main operational gates resolve from Roles.</span>
              </td>
              <td className="fo-muted">Administered on the Principal, not here.</td>
            </tr>
          ))}
          {action.roles.length + action.principals.length === 0 ? (
            <tr><td colSpan={3} className="fo-muted">No Security Role or Principal holds, or has a decision on, this action.</td></tr>
          ) : null}
        </tbody>
      </table>
      <GrantToRoleForm api={api} objectKey={objectKey} actionKey={action.actionKey} roles={others} kinds={kinds} onChanged={onChanged} />
    </>
  );
}

/** Grant this action to a Security Role the matrix lists no cell for. */
export function GrantToRoleForm({ api, objectKey, actionKey, roles, kinds, onChanged }) {
  const [open, setOpen] = useState(false);
  const [roleKey, setRoleKey] = useState("");
  const [reason, setReason] = useState("");
  const [condition, setCondition] = useState({ kind: "" });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const built = condition.kind ? buildCondition(condition.kind, condition) : null;
  const ready = Boolean(roleKey) && Boolean(statedReason(reason)) && (!condition.kind || Boolean(built));

  const submit = async (event) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    const outcome = await api.grantObjectActionToRole({
      objectKey, actionKey, roleKey, reason: statedReason(reason), ...(built ? { condition: built } : {}),
    });
    setBusy(false);
    setResult(outcome);
    if (outcome?.ok) { setOpen(false); setRoleKey(""); setReason(""); setCondition({ kind: "" }); onChanged?.(); }
  };

  if (roles.length === 0) return null;
  return (
    <div>
      <Button type="button" variant="secondary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "Cancel" : "Grant to another Security Role"}
      </Button>
      {open ? (
        <form className="fo-cp-form" onSubmit={submit} aria-label={`Grant ${actionKey} to a Security Role`}>
          <label className="fo-form-field">
            <span>Security Role</span>
            <select aria-label="Security Role" value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
              <option value="">Choose a Security Role…</option>
              {roles.map((r) => <option key={r.key} value={r.key}>{r.name ?? r.key}</option>)}
            </select>
          </label>
          <ConditionFields value={condition} onChange={setCondition} kinds={kinds} allowNone idPrefix={`new-${actionKey}`} />
          <ReasonField value={reason} onChange={setReason} />
          <Button type="submit" variant="primary" disabled={!ready || busy}>Confirm grant</Button>
        </form>
      ) : null}
      <Outcome result={result} success="Granted by the server; re-reading." />
    </div>
  );
}
