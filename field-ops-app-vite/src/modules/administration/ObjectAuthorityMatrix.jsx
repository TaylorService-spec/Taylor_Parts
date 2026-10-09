// OBJECT AUTHORITY MATRIX — Administration → Objects (Administration control plane, DECISIONS #210; redesigned in the UI
// corrections package, 2026-10-08).
//
// One Object at a time: rows are Security Roles (by their human names), columns are the Object's REAL action vocabulary from the
// governed PostgreSQL capability registry (listObjectsWithActions / getObjectActionGrantMatrix) -- Create / Read / Edit / Delete
// only where those ARE the Object's actions, and its domain actions (accept, assign, complete, approve, correct, reconcile,
// record, manage …) and governed field groups as first-class columns. Nothing is forced into CRUD and no column is invented.
//
// INSPECT FIRST, EDIT ON PURPOSE. The matrix opens READ-ONLY: every cell states Granted, Not Granted or Not Available (a platform
// invariant forbids it). "Edit Permissions" is the explicit governed editing interaction: it asks for the reason the audit trail
// records, turns each cell into a per-capability control, and gives each Role a compact Actions menu.
//
// A CELL IS THE SERVER'S STATE. Granted = the Role holds the capability in eos_policy.role_capabilities right now. A per-cell change
// sends grantObjectActionToRole / revokeObjectActionFromRole with the stated reason; the server enforces every rule (system
// invariants, self-administration, Owner exclusions, anti-lockout), writes the row, the audit event and the decision, and the
// matrix RE-READS -- never an optimistic tick.
//
// BULK IS "EVERY LISTED ACTION", NOT "WHOLE OBJECT". The Actions menu's "Grant All Listed Actions…" / "Revoke All Listed
// Actions…" is applyObjectWideRoleAuthority: the server applies THESE listed per-action grants one by one through the same
// governed commands (no wildcard exists, nothing unrestricted is created, and an action added to the Object later is NOT
// included). It always opens a confirmation that names exactly which capabilities will change -- computed from the grants just
// re-read -- and, after the server answers, states each action's outcome. No Firebase, no client-side authority.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../shared/ui/primitives";
import { Field, FormError } from "../../shared/ui/form";
import ConfirmDialog from "../../shared/ui/ConfirmDialog.jsx";
import { adminControlPlaneClient, refusalText } from "../../services/adminControlPlaneClient.js";
import { identifierLabel, titleCase } from "../../shared/display/displayLabels.js";
import { useControlPlaneRead } from "./useControlPlaneRead.js";

const KIND_WORDS = Object.freeze({ CREATE: "Create", READ: "Read", EDIT: "Edit", DELETE: "Delete", BUSINESS_ACTION: "Action", ADMIN_ACTION: "Administration" });

/** The column's SHORT header: the action key in words ("correctOwnership" -> "Correct Ownership"). The full name stays reachable. */
const shortLabel = (a) => titleCase(a.actionKey);

// Column order (approved Administration IA, Phase 4, finding P01): ordinary object access first, in Create / Read / Edit /
// Delete order, then business actions, then administration actions. Stable: actions of one kind keep the server's order.
const KIND_RANK = Object.freeze({ CREATE: 0, READ: 1, EDIT: 2, DELETE: 3, BUSINESS_ACTION: 4, ADMIN_ACTION: 5 });
const rankOf = (kind) => KIND_RANK[kind] ?? 4;
const ACCESS_VERBS = ["CREATE", "READ", "EDIT", "DELETE"];
const bandOf = (kind) => (rankOf(kind) < 4 ? "Object Access" : kind === "ADMIN_ACTION" ? "Administration" : "Business Actions");

/**
 * The rendered column list: every real action (by its index in grid.actions) plus, for each of Create / Read / Edit / Delete
 * the Object has NO action for, an explicit "missing" column (finding P02). A missing column is never a control and never
 * part of a bulk plan -- it states that EOS has no such action for this Object, so there is nothing anyone could be granted.
 */
export function authorityColumns(grid) {
  const present = new Set(grid.actions.map((a) => a.actionKind));
  const real = grid.actions.map((a, index) => ({ type: "real", index, rank: rankOf(a.actionKind), band: bandOf(a.actionKind) }));
  const missing = ACCESS_VERBS.filter((v) => !present.has(v)).map((verb) => ({ type: "missing", verb, rank: rankOf(verb), band: "Object Access" }));
  return [...real, ...missing].sort((x, y) => x.rank - y.rank);
}

export function objectAuthorityGrid(matrix, roles) {
  const actions = (Array.isArray(matrix?.actions) ? matrix.actions : []).slice().sort((x, y) => rankOf(x.actionKind) - rankOf(y.actionKind));
  const roleList = (Array.isArray(roles) ? roles : []).map((r) => ({ key: r.key, name: identifierLabel(r.key, r.name), protected: Boolean(r.protected) }));
  const cell = (roleKey, a) => {
    const c = (a.roles ?? []).find((r) => r.roleKey === roleKey);
    return { held: Boolean(c?.held), source: c?.source ?? null, condition: c?.condition ?? null, locked: c?.source === "SYSTEM_INVARIANT" };
  };
  return {
    actions: actions.map((a) => ({ actionKey: a.actionKey, actionKind: a.actionKind, label: a.displayLabel ?? titleCase(a.actionKey), short: shortLabel(a),
      capabilityKey: a.capabilityKey, kindWords: KIND_WORDS[a.actionKind] ?? titleCase(a.actionKind), directExceptions: (a.principals ?? []).length })),
    rows: roleList.map((r) => ({ ...r, cells: actions.map((a) => cell(r.key, a)) })),
  };
}

/** What a bulk change WOULD do to one Role, from the grants just read: the server still decides each one. */
export function bulkPlan(grid, roleKey, mode) {
  const row = grid.rows.find((r) => r.key === roleKey);
  const plan = { change: [], unchanged: [], unavailable: [] };
  grid.actions.forEach((a, i) => {
    const c = row.cells[i];
    if (c.locked) plan.unavailable.push(a);
    else if (mode === "GRANT" ? !c.held : c.held) plan.change.push(a);
    else plan.unchanged.push(a);
  });
  return plan;
}

const STATE = Object.freeze({
  GRANTED: { words: "Granted", glyph: "✓", className: "fo-objmatrix__state--granted" },
  CONDITIONAL: { words: "Granted (Conditional)", glyph: "◐", className: "fo-objmatrix__state--conditional" },
  NOT_GRANTED: { words: "Not Granted", glyph: "○", className: "fo-objmatrix__state--none" },
  UNAVAILABLE: { words: "Not Available", glyph: "—", className: "fo-objmatrix__state--na" },
});
const stateOf = (c) => (c.locked ? STATE.UNAVAILABLE : c.held ? (c.condition ? STATE.CONDITIONAL : STATE.GRANTED) : STATE.NOT_GRANTED);

/** A compact per-Role Actions menu (WAI-ARIA menu button). */
function RoleActionsMenu({ role, disabled, canRevoke, onChoose }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState(null);
  const id = useId();
  const buttonRef = useRef(null);
  const itemsRef = useRef([]);
  useEffect(() => { if (open) itemsRef.current[0]?.focus(); }, [open]);
  // The menu is placed in the VIEWPORT (position: fixed) so the matrix's scroll region never clips it.
  const toggleOpen = () => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) setPlace({ top: Math.min(r.bottom + 2, window.innerHeight - 96), left: Math.max(8, r.right - 232) });
    setOpen((v) => !v);
  };
  const close = (refocus = true) => { setOpen(false); if (refocus) buttonRef.current?.focus(); };
  const items = [
    { key: "GRANT", label: "Grant All Listed Actions…", disabled: false },
    { key: "REVOKE", label: "Revoke All Listed Actions…", disabled: !canRevoke },
  ];
  const onKeyDown = (e, i) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); itemsRef.current[(i + 1) % items.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); itemsRef.current[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === "Tab") close(false);
  };
  return (
    <div className="fo-objmatrix__menu">
      <button ref={buttonRef} type="button" className="fo-objmatrix__menubutton" aria-haspopup="menu" aria-expanded={open} aria-controls={`${id}-menu`}
        aria-label={`Actions for ${role.name}`} disabled={disabled} onClick={toggleOpen}
        onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); if (!open) toggleOpen(); } }}>
        Actions <span aria-hidden="true">▾</span>
      </button>
      {open && typeof document !== "undefined" ? createPortal((
        <ul id={`${id}-menu`} role="menu" aria-label={`Actions for ${role.name}`} className="fo-objmatrix__menulist" style={place ? { top: place.top, left: place.left } : undefined} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
          {items.map((item, i) => (
            <li key={item.key} role="none">
              <button type="button" role="menuitem" ref={(el) => { itemsRef.current[i] = el; }} disabled={item.disabled}
                onKeyDown={(e) => onKeyDown(e, i)} onClick={() => { setOpen(false); onChoose(item.key); }}>
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ), document.body) : null}
    </div>
  );
}

export default function ObjectAuthorityMatrix({ api = adminControlPlaneClient, initialObjectKey = null }) {
  const inventory = useControlPlaneRead(() => api.listObjectsWithActions(), "inventory");
  const objects = Array.isArray(inventory.data) ? inventory.data.filter((o) => (o.actions ?? []).length > 0) : [];
  const [objectKey, setObjectKey] = useState(initialObjectKey);
  const chosen = objectKey ?? objects[0]?.key ?? null;
  const matrix = useControlPlaneRead(chosen ? () => api.getObjectActionGrantMatrix(chosen) : null, `objmatrix:${chosen}`);
  const roles = useControlPlaneRead(() => api.listRoles(), "roles");
  const grid = useMemo(() => (matrix.data && roles.data ? objectAuthorityGrid(matrix.data, roles.data) : null), [matrix.data, roles.data]);
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [onlyHolders, setOnlyHolders] = useState(false);
  const [bulk, setBulk] = useState(null); // { role, mode, plan }
  const objectLabel = matrix.data?.label ?? objects.find((o) => o.key === chosen)?.label ?? titleCase(chosen ?? "");

  const needReason = () => { if (reason.trim().length < 4) { setOutcome({ error: "State the reason for this change first — it is recorded in the audit trail." }); return true; } return false; };
  const toggle = async (role, action, held) => {
    if (needReason()) return;
    setBusy(`${role.key}:${action.actionKey}`);
    const req = { objectKey: chosen, actionKey: action.actionKey, roleKey: role.key, reason: reason.trim() };
    const res = held ? await api.revokeObjectActionFromRole(req) : await api.grantObjectActionToRole(req);
    setBusy(null);
    setOutcome(res.ok ? { ok: `${held ? "Revoked" : "Granted"} ${action.label} ${held ? "from" : "to"} ${role.name}.` } : { error: refusalText(res) });
    matrix.reload();
  };
  const openBulk = (role, mode) => { setOutcome(null); setBulk({ role, mode, plan: bulkPlan(grid, role.key, mode) }); };
  const applyBulk = async (bulkReason) => {
    const { role, mode } = bulk;
    setBusy(`${role.key}:*`);
    const res = await api.applyObjectWideRoleAuthority({ objectKey: chosen, roleKey: role.key, mode, reason: bulkReason });
    setBusy(null);
    setBulk(null);
    if (!res.ok) setOutcome({ error: refusalText(res) });
    else {
      const counts = res.data.actions.reduce((m, a) => ({ ...m, [a.outcome]: (m[a.outcome] ?? 0) + 1 }), {});
      const refused = res.data.actions.filter((a) => a.outcome === "REFUSED").map((a) => `${titleCase(a.actionKey)}: ${a.refusal}`);
      setOutcome({ ok: `${mode === "GRANT" ? "Granted listed actions" : "Revoked listed actions"} for ${role.name}: ${Object.entries(counts).map(([k, v]) => `${v} ${titleCase(k).toLowerCase()}`).join(", ")}.`, refused });
    }
    matrix.reload();
  };

  const shownRows = grid ? (onlyHolders ? grid.rows.filter((r) => r.cells.some((c) => c.held)) : grid.rows) : [];
  const columns = grid ? authorityColumns(grid) : [];
  const bands = columns.reduce((acc, col) => {
    const last = acc[acc.length - 1];
    if (last && last.label === col.band) last.span += 1;
    else acc.push({ key: `${col.band}-${acc.length}`, label: col.band, span: 1 });
    return acc;
  }, []);
  return (
    <section className="fo-objmatrix" aria-label="Object authority" data-objmatrix-mode={editing ? "EDIT" : "READ"}>
      <div className="fo-objmatrix__head">
        <div>
          <h3>Permissions by Security Role</h3>
          <p className="fo-muted">What each Security Role may do to this Object, from the grants the server enforces. Job Roles are not shown: a job grants nothing.</p>
        </div>
        {editing ? (
          <Button variant="secondary" onClick={() => { setEditing(false); setOutcome(null); }}>Done Editing</Button>
        ) : (
          <Button variant="primary" onClick={() => setEditing(true)} disabled={!grid}>Edit Permissions</Button>
        )}
      </div>
      {inventory.status === "failed" && <FormError>{refusalText(inventory.error)}</FormError>}
      <div className="fo-objmatrix__controls">
        <Field id="objmatrix-object" label="Object">
          <select className="fo-input" value={chosen ?? ""} onChange={(e) => { setObjectKey(e.target.value); setOutcome(null); }}>
            {objects.map((o) => <option key={o.key} value={o.key}>{o.label ?? titleCase(o.key)} ({o.actions.length})</option>)}
          </select>
        </Field>
        {editing ? (
          <Field id="objmatrix-reason" label="Reason for Changes (Recorded in the Audit Trail)">
            <input className="fo-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Service Managers approve parts reorders" />
          </Field>
        ) : null}
        <label className="fo-check"><input type="checkbox" checked={onlyHolders} onChange={(e) => setOnlyHolders(e.target.checked)} /> Only Roles Holding an Action</label>
      </div>
      <ul className="fo-objmatrix__legend" aria-label="Legend">
        {[STATE.GRANTED, STATE.CONDITIONAL, STATE.NOT_GRANTED, STATE.UNAVAILABLE].map((s) => (
          <li key={s.words}><span className={`fo-objmatrix__state ${s.className}`} aria-hidden="true">{s.glyph}</span> {s.words}</li>
        ))}
      </ul>
      {outcome?.error && <FormError>{outcome.error}</FormError>}
      {outcome?.ok && <p className="fo-success" role="status">{outcome.ok}</p>}
      {outcome?.refused?.length > 0 && <ul className="fo-warning">{outcome.refused.map((r) => <li key={r}>{r}</li>)}</ul>}
      {matrix.status === "failed" && <FormError>{refusalText(matrix.error)}</FormError>}
      {grid && (
        <div className="fo-objmatrix__scroll" role="region" aria-label={`${objectLabel} permissions — scroll horizontally for more actions`} tabIndex={0}>
          <table className="fo-objmatrix__table" aria-label={`${objectLabel} authority by Security Role`}>
            <thead>
              {/* Bands (finding P01): ordinary object access, then business and administration actions, named once. */}
              <tr className="fo-objmatrix__bands">
                <td />
                {bands.map((b) => <th scope="colgroup" key={b.key} colSpan={b.span}>{b.label}</th>)}
                {editing ? <td /> : null}
              </tr>
              <tr>
                <th scope="col" className="fo-objmatrix__rolehead">Security Role</th>
                {columns.map((col) => {
                  if (col.type === "missing") {
                    const words = KIND_WORDS[col.verb];
                    return (
                      <th scope="col" key={`missing-${col.verb}`} data-action-missing={col.verb} title={`${words} — not available: EOS has no ${words} action for ${objectLabel}`}>
                        <span className="fo-objmatrix__colname">{words}</span>
                        <span className="fo-objmatrix__kind">Not Available</span>
                      </th>
                    );
                  }
                  const a = grid.actions[col.index];
                  return (
                    <th scope="col" key={a.actionKey} title={`${a.label} — ${a.kindWords} (${a.capabilityKey})`} data-action={a.actionKey}>
                      <span className="fo-objmatrix__colname">{a.short}</span>
                      {a.kindWords !== a.short ? <span className="fo-objmatrix__kind">{a.kindWords}</span> : null}
                      <span className="fo-sr-only">{`: ${a.label}`}</span>
                    </th>
                  );
                })}
                {editing ? <th scope="col" className="fo-objmatrix__actionshead"><span className="fo-sr-only">Role actions</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {shownRows.map((r) => (
                <tr key={r.key} data-role={r.key}>
                  <th scope="row" className="fo-objmatrix__role">{r.name}{r.protected ? <span className="fo-objmatrix__protected"> · Protected</span> : null}</th>
                  {columns.map((col) => {
                    if (col.type === "missing") {
                      const words = KIND_WORDS[col.verb];
                      return (
                        <td key={`missing-${col.verb}`} data-cell={`${r.key}:missing-${col.verb}`} data-state="NO_ACTION">
                          <span className={`fo-objmatrix__state ${STATE.UNAVAILABLE.className}`} role="img"
                            aria-label={`${r.name} — ${words}: Not Available, ${objectLabel} has no ${words} action`}
                            title={`Not available: EOS has no ${words} action for ${objectLabel}, so it cannot be granted to anyone`}>
                            {STATE.UNAVAILABLE.glyph}
                          </span>
                        </td>
                      );
                    }
                    const i = col.index;
                    const c = r.cells[i];
                    const a = grid.actions[i];
                    const s = stateOf(c);
                    const name = `${r.name} — ${a.label} (${a.capabilityKey})`;
                    return (
                      <td key={a.actionKey} data-cell={`${r.key}:${a.actionKey}`} data-held={c.held ? "true" : "false"} data-state={c.locked ? "UNAVAILABLE" : c.held ? "GRANTED" : "NOT_GRANTED"}>
                        {editing && !c.locked ? (
                          <input type="checkbox" className="fo-objmatrix__check" checked={c.held} disabled={busy !== null}
                            aria-label={name} title={c.condition ? `Conditioned: ${JSON.stringify(c.condition.condition ?? c.condition)}` : c.source ?? ""}
                            onChange={() => toggle(r, a, c.held)} />
                        ) : (
                          <span className={`fo-objmatrix__state ${s.className}`} role="img" aria-label={`${name}: ${s.words}`}
                            title={c.locked ? "Not available: a platform invariant forbids any Role of this kind from holding it" : s.words}>
                            {s.glyph}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  {editing ? (
                    <td className="fo-objmatrix__actions">
                      <RoleActionsMenu role={r} disabled={busy !== null} canRevoke={r.cells.some((c) => c.held && !c.locked)} onChoose={(mode) => openBulk(r, mode)} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {grid ? (
        <details className="fo-objmatrix__columns">
          <summary>{`Column Names and Capabilities (${grid.actions.length})`}</summary>
          <dl className="fo-objmatrix__coldefs">
            {grid.actions.map((a) => (
              <div key={a.actionKey} className="fo-objmatrix__coldef">
                <dt>{a.short}</dt>
                <dd>{a.label} · {a.kindWords} · <code>{a.capabilityKey}</code>{a.directExceptions > 0 ? ` · also held by ${a.directExceptions} person${a.directExceptions === 1 ? "" : "s"} as a direct exception` : ""}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
      {bulk ? (
        <ConfirmDialog
          title={`${bulk.mode === "GRANT" ? "Grant" : "Revoke"} All Listed Actions — ${bulk.role.name}`}
          destructive={bulk.mode === "REVOKE"}
          consequence={bulk.plan.change.length === 0
            ? `Nothing would change: ${bulk.role.name} already ${bulk.mode === "GRANT" ? "holds every grantable listed action" : "holds none of the listed actions"} on ${objectLabel}.`
            : `${bulk.mode === "GRANT" ? "Grant" : "Revoke"} these ${bulk.plan.change.length} ${objectLabel} capabilit${bulk.plan.change.length === 1 ? "y" : "ies"} ${bulk.mode === "GRANT" ? "to" : "from"} ${bulk.role.name}:`}
          extraNote={(
            <span data-bulk-plan={bulk.mode}>
              <span className="fo-objmatrix__plan">
                {bulk.plan.change.map((a) => <span key={a.actionKey} className="fo-cp-tag" data-plan-change={a.capabilityKey}>{`${a.label} (${a.capabilityKey})`}</span>)}
              </span>
              {bulk.plan.unchanged.length ? <span className="fo-objmatrix__plan-note">{`Unchanged: ${bulk.plan.unchanged.map((a) => a.label).join(", ")}.`}</span> : null}
              {bulk.plan.unavailable.length ? <span className="fo-objmatrix__plan-note">{`Not available (platform invariant): ${bulk.plan.unavailable.map((a) => a.label).join(", ")}.`}</span> : null}
              <span className="fo-objmatrix__plan-note">This applies only the actions listed above, one by one, through the governed commands. It is not unrestricted authority: actions added to this Object later are not included, and the server may refuse any single change.</span>
            </span>
          )}
          confirmLabel={bulk.mode === "GRANT" ? `Grant ${bulk.plan.change.length}` : `Revoke ${bulk.plan.change.length}`}
          cancelLabel="Cancel"
          requireReason
          reasonLabel="Reason (Recorded in the Audit Trail)"
          onConfirm={async (bulkReason) => { if (bulk.plan.change.length === 0) { setBulk(null); return; } await applyBulk(bulkReason); }}
          onClose={() => setBulk(null)}
        />
      ) : null}
    </section>
  );
}
