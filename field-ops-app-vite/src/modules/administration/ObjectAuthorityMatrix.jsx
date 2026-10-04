// OBJECT AUTHORITY MATRIX — Administration → Objects (Administration control plane, DECISIONS #210).
//
// One Object at a time: rows are Security Roles, columns are the Object's REAL action vocabulary from the governed PostgreSQL
// capability registry (listObjectsWithActions / getObjectActionGrantMatrix) -- Create / Read / Edit / Delete where those are the
// Object's actions, and its domain actions (accept, assign, complete, approve, correct, reconcile, record, manage …) and governed
// field groups as first-class columns. Nothing is forced into CRUD and no column is invented.
//
// A CHECKBOX IS THE SERVER'S STATE. Checked = the Role holds the capability in eos_policy.role_capabilities right now. Checking
// or unchecking sends grantObjectActionToRole / revokeObjectActionFromRole with the administrator's stated reason; the server
// enforces every rule (system invariants, self-administration, Owner exclusions, anti-lockout), writes the row, the audit event
// and the decision, and the matrix then RE-READS -- never an optimistic tick. A cell the platform forbids is locked with its
// reason. "Grant all / Revoke all" on a row is whole-object authority, expanded by the server into exactly these per-action
// grants (applyObjectWideRoleAuthority) -- no wildcard exists for the runtime to resolve. No Firebase, no client-side authority.
import { useMemo, useState } from "react";
import { Button } from "../../shared/ui/primitives";
import { Field, FormError } from "../../shared/ui/form";
import { adminControlPlaneClient, refusalText } from "../../services/adminControlPlaneClient.js";
import { useControlPlaneRead } from "./useControlPlaneRead.js";

const KIND_WORDS = Object.freeze({ CREATE: "Create", READ: "Read", EDIT: "Edit", DELETE: "Delete", BUSINESS_ACTION: "Action", ADMIN_ACTION: "Administration" });

export function objectAuthorityGrid(matrix, roles) {
  const actions = Array.isArray(matrix?.actions) ? matrix.actions : [];
  const roleList = (Array.isArray(roles) ? roles : []).map((r) => ({ key: r.key, name: r.name ?? r.key, protected: Boolean(r.protected) }));
  const cell = (roleKey, a) => {
    const c = (a.roles ?? []).find((r) => r.roleKey === roleKey);
    return { held: Boolean(c?.held), source: c?.source ?? null, condition: c?.condition ?? null, locked: c?.source === "SYSTEM_INVARIANT" };
  };
  return {
    actions: actions.map((a) => ({ actionKey: a.actionKey, actionKind: a.actionKind, label: a.displayLabel ?? a.actionKey, capabilityKey: a.capabilityKey,
      kindWords: KIND_WORDS[a.actionKind] ?? a.actionKind, directExceptions: (a.principals ?? []).length })),
    rows: roleList.map((r) => ({ ...r, cells: actions.map((a) => cell(r.key, a)) })),
  };
}

export default function ObjectAuthorityMatrix({ api = adminControlPlaneClient, initialObjectKey = null }) {
  const inventory = useControlPlaneRead(() => api.listObjectsWithActions(), "inventory");
  const objects = Array.isArray(inventory.data) ? inventory.data.filter((o) => (o.actions ?? []).length > 0) : [];
  const [objectKey, setObjectKey] = useState(initialObjectKey);
  const chosen = objectKey ?? objects[0]?.key ?? null;
  const matrix = useControlPlaneRead(chosen ? () => api.getObjectActionGrantMatrix(chosen) : null, `objmatrix:${chosen}`);
  const roles = useControlPlaneRead(() => api.listRoles(), "roles");
  const grid = useMemo(() => (matrix.data && roles.data ? objectAuthorityGrid(matrix.data, roles.data) : null), [matrix.data, roles.data]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [onlyHolders, setOnlyHolders] = useState(false);

  const needReason = () => { if (reason.trim().length < 4) { setOutcome({ error: "State the reason for this change first — it is recorded in the audit trail." }); return true; } return false; };
  const toggle = async (roleKey, action, held) => {
    if (needReason()) return;
    setBusy(`${roleKey}:${action.actionKey}`);
    const req = { objectKey: chosen, actionKey: action.actionKey, roleKey, reason: reason.trim() };
    const res = held ? await api.revokeObjectActionFromRole(req) : await api.grantObjectActionToRole(req);
    setBusy(null);
    setOutcome(res.ok ? { ok: `${held ? "Revoked" : "Granted"} ${action.label} ${held ? "from" : "to"} ${roleKey}.` } : { error: refusalText(res) });
    matrix.reload();
  };
  const objectWide = async (roleKey, mode) => {
    if (needReason()) return;
    setBusy(`${roleKey}:*`);
    const res = await api.applyObjectWideRoleAuthority({ objectKey: chosen, roleKey, mode, reason: reason.trim() });
    setBusy(null);
    if (!res.ok) setOutcome({ error: refusalText(res) });
    else {
      const counts = res.data.actions.reduce((m, a) => ({ ...m, [a.outcome]: (m[a.outcome] ?? 0) + 1 }), {});
      const refused = res.data.actions.filter((a) => a.outcome === "REFUSED").map((a) => `${a.actionKey}: ${a.refusal}`);
      setOutcome({ ok: `${mode === "GRANT" ? "Whole-object grant" : "Whole-object revoke"} for ${roleKey}: ${Object.entries(counts).map(([k, v]) => `${v} ${k.toLowerCase().replace("_", " ")}`).join(", ")}.`, refused });
    }
    matrix.reload();
  };

  const shownRows = grid ? (onlyHolders ? grid.rows.filter((r) => r.cells.some((c) => c.held)) : grid.rows) : [];
  return (
    <section className="fo-objmatrix" aria-label="Object authority">
      <h3>Object authority <span className="fo-muted">· the governed PostgreSQL grants the server enforces</span></h3>
      <p className="fo-muted">Each checkbox is a Security Role holding one of this Object&rsquo;s actions right now. Change it here and the server
        records it, audits your reason and enforces it on the next request. Job Roles are not shown: a job grants nothing.</p>
      {inventory.status === "failed" && <FormError>{refusalText(inventory.error)}</FormError>}
      <div className="fo-roster__filters">
        <Field id="objmatrix-object" label="Object">
          <select className="fo-input" value={chosen ?? ""} onChange={(e) => { setObjectKey(e.target.value); setOutcome(null); }}>
            {objects.map((o) => <option key={o.key} value={o.key}>{o.label ?? o.key} ({o.actions.length})</option>)}
          </select>
        </Field>
        <Field id="objmatrix-reason" label="Reason for changes (recorded in the audit trail)">
          <input className="fo-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Service Managers approve parts reorders" />
        </Field>
        <label className="fo-check"><input type="checkbox" checked={onlyHolders} onChange={(e) => setOnlyHolders(e.target.checked)} /> Only Roles holding an action</label>
      </div>
      {outcome?.error && <FormError>{outcome.error}</FormError>}
      {outcome?.ok && <p className="fo-success" role="status">{outcome.ok}</p>}
      {outcome?.refused?.length > 0 && <ul className="fo-warning">{outcome.refused.map((r) => <li key={r}>{r}</li>)}</ul>}
      {matrix.status === "failed" && <FormError>{refusalText(matrix.error)}</FormError>}
      {grid && (
        <div className="fo-table-scroll">
          <table className="fo-table fo-objmatrix__table" aria-label={`${matrix.data.label ?? chosen} authority by Security Role`}>
            <thead>
              <tr>
                <th scope="col">Security Role</th>
                {grid.actions.map((a) => (
                  <th scope="col" key={a.actionKey} title={a.capabilityKey}>
                    <span>{a.label}</span><span className="fo-muted fo-objmatrix__kind">{a.kindWords}</span>
                  </th>
                ))}
                <th scope="col">Whole object</th>
              </tr>
            </thead>
            <tbody>
              {shownRows.map((r) => (
                <tr key={r.key} data-role={r.key}>
                  <th scope="row">{r.name}<span className="fo-muted"> · {r.key}</span></th>
                  {r.cells.map((c, i) => {
                    const a = grid.actions[i];
                    return (
                      <td key={a.actionKey} data-cell={`${r.key}:${a.actionKey}`} data-held={c.held ? "true" : "false"}>
                        <input type="checkbox" checked={c.held} disabled={c.locked || busy !== null}
                          aria-label={`${r.name} — ${a.label} (${a.capabilityKey})`}
                          title={c.locked ? "Forbidden by a platform invariant — no Role of this kind may hold it" : c.condition ? `Conditioned: ${JSON.stringify(c.condition.condition ?? c.condition)}` : c.source ?? ""}
                          onChange={() => toggle(r.key, a, c.held)} />
                        {c.condition ? <span className="fo-muted" title="Held under a condition"> ◐</span> : null}
                      </td>
                    );
                  })}
                  <td>
                    <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => objectWide(r.key, "GRANT")}>Grant all</Button>{" "}
                    <Button size="sm" variant="secondary" disabled={busy !== null || !r.cells.some((c) => c.held)} onClick={() => objectWide(r.key, "REVOKE")}>Revoke all</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {grid && grid.actions.some((a) => a.directExceptions > 0) && (
        <p className="fo-muted">Some actions are also held by individual people as direct exceptions — see the action details below or the person&rsquo;s record.</p>
      )}
    </section>
  );
}
