// ADMINISTRATION — the configuration surfaces themselves.
//
// ════════════════════ RETIRED 2026-09-26: THE C/R/E/D GRID AS A CONTROL (lane CP-C) ════════════════════
//
// The Role grid's checkboxes (setObjectPermission) and field selects (set/removeFieldPermissionOverride)
// wrote `role_object_permissions` and field overrides -- tables NO runtime evaluator reads. They were
// false controls and are removed. The stored values remain visible as a collapsed, read-only
// "Legacy matrix — not enforced". Enforced access is administered on the Security Role detail
// (SecurityRoleDetail.jsx) and the Object Security Actions view (ObjectActionSecurity.jsx), through
// the governed control-plane operations the server evaluator reads. The field-fact notes below now
// describe how the LEGACY values are displayed, not an editable control.
//
// ════════════════════ WHAT CHANGED, AND WHY IT HAD TO ════════════════════
//
// These used to be PANELS that appeared *in addition* to a measured, read-only grid: two grids on
// one screen, one editable and one not, both claiming to describe permissions. That is why the page
// still felt uneditable — the first grid you met was the one you could not change.
//
// Now, when a policy store is configured, THIS is the Administration screen. The measured model
// stays available as a clearly-labelled SOURCE REFERENCE, collapsed, because it answers a different
// question ("what does the code do") from the one an administrator came to ask ("what has my tenant
// configured"). One primary control, one reference.
//
// ════════════════════ THE FOUR FACTS A FIELD CELL MUST TELL APART ════════════════════
//
// A checkbox cannot do this, which is why there are none on field rows:
//
//   INHERITED · Allow    no override row; the object says yes
//   INHERITED · Deny     no override row; the object says no
//   ALLOW                an override row saying true
//   DENY                 an override row saying false
//
// "Inherited deny" and "explicit deny" look identical in a checkbox and are different policy facts:
// one follows the object and one survives the object changing. Resetting to Inherit DELETES the
// override row rather than storing a false, so "no opinion" keeps having exactly one spelling.
//
// ════════════════════ UNAVAILABLE MEANS WHAT THE SERVER ENFORCES ════════════════════
//
// Measured, not assumed: the only CRED cell this platform refuses as ungoverned is DELETE on an
// object whose `supportsDelete` is false — `setObjectPermission` raises `"X" does not support
// Delete` and nothing else. So Delete is the verb rendered as unavailable, and C/R/E are not, because
// the object record carries no fact that would make that true. Inventing greyed-out cells for verbs
// the server would happily accept would be a UI opinion dressed as policy.
//
// Ungoverned inherits DOWNWARD: a field of a non-deletable object shows Delete as unavailable too.
//
// ════════════════════ THE DOORWAY IS THE SERVER'S, NOT THIS SCREEN'S ════════════════════
//
// A field Allow never widens an object the role cannot read. This screen SHOWS that — an override
// whose object verb is denied renders as "Allow · blocked by object" — but it does not enforce it,
// and it deliberately does not disable the control. The server refuses the impossible grant whether
// or not a button was greyed out, and a UI that hid the state would leave an administrator unable to
// see why their override does nothing.
import { Fragment, useMemo, useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import { usePolicyStore } from "./usePolicyStore.js";
import { isPolicyApiConfigured } from "../../services/adminPolicyApiClient.js";
// The four-fact logic lives in its own module: it is the part worth proving without a DOM, and
// keeping it here would have made it reachable only through a rendered grid.
import { effectiveFieldAnswer, verbAvailable } from "./fieldPermissionState.js";
import SecurityRoleDetail from "./SecurityRoleDetail.jsx";
import { readAdminQueryParam } from "../../domain/workflowResponsibilityLinks.js";

const VERBS = ["C", "R", "E", "D"];
const VERB_LABEL = { C: "Create", R: "Read", E: "Edit", D: "Delete" };

const FIELD_TYPES = ["STRING", "TEXT", "NUMBER", "BOOLEAN", "DATE", "TIMESTAMP", "ENUM", "ENUM_SET", "REFERENCE", "ADDRESS", "MONEY"];
const SENSITIVITIES = ["NORMAL", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"];
const LIFECYCLES = ["DRAFT", "ACTIVE", "RETIRED"];

// ════════════════════ shared chrome ════════════════════

export function NotConfiguredNotice({ what }) {
  return (
    <section className="fo-panel" aria-label="Policy store not configured">
      <h3>{what} <span className="fo-muted">· not configured</span></h3>
      <p className="fo-warning">
        No EOS policy service is configured for this environment, so this tenant has no stored
        configuration to show or change. Nothing on this screen can be saved — what follows is the
        model measured from the code that runs today, which is a different thing and stays true
        either way.
      </p>
    </section>
  );
}

/** The measured model, demoted: available, collapsed, and named as reference rather than control. */
export function SourceReference({ children }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="fo-panel" aria-label="Source model">
      <h3>
        Source model <span className="fo-muted">· platform reference, not configuration</span>
      </h3>
      <p className="fo-muted">
        What the code does today, measured. Your tenant&rsquo;s configuration is above; this is here
        to compare against and cannot be edited.
      </p>
      <Button variant="secondary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "Hide" : "Show"} the measured model
      </Button>
      {open && <div className="fo-panel--nested">{children}</div>}
    </section>
  );
}

function Refusal({ result }) {
  if (!result || result.ok) return null;
  return <p className="fo-warning" role="alert">{result.description ?? result.message}</p>;
}

// ════════════════════ ROLES & PERMISSIONS ════════════════════

/**
 * The tenant's Security Roles, and for the chosen one its ENFORCED detail (SecurityRoleDetail: holders,
 * Object actions with source and condition, grant/revoke/condition controls, decision history).
 *
 * The C/R/E/D grid this screen used to lead with wrote `role_object_permissions` through
 * setObjectPermission -- a table NO runtime evaluator reads. Ticking Edit changed nothing the server
 * enforces. It is RETIRED as a control: what remains is a collapsed, read-only LEGACY MATRIX, labelled
 * "not enforced", so nothing on this screen implies enforcement it does not have.
 */
export function RolesPermissionsSurface() {
  const roles = usePolicyStore("listRoles");
  const objects = usePolicyStore("listObjects");
  const [roleId, setRoleId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editingRole, setEditingRole] = useState(false);
  // DEEP LINK (?role=<key>, from Employee > Workflow responsibilities): pre-selects a Security Role until one is chosen.
  const [linkedRoleKey] = useState(() => readAdminQueryParam("role"));

  if (!isPolicyApiConfigured()) return null;

  const selected = (roles.data ?? []).find((r) => r.id === roleId)
    ?? (roleId === null && linkedRoleKey ? (roles.data ?? []).find((r) => r.key === linkedRoleKey) ?? null : null);

  return (
    <section className="fo-panel" aria-label="Role permissions">
      <h3>Security Roles <span className="fo-muted">· this tenant&rsquo;s governed policy</span></h3>
      {roles.status === "loading" && <p className="fo-muted">Reading roles…</p>}
      {roles.status === "failed" && <p className="fo-warning">{roles.error?.description}</p>}

      {roles.status === "ready" && (
        <>
          <div className="fo-pill-row" role="group" aria-label="Select a role">
            {roles.data.map((role) => (
              <Button
                key={role.id}
                variant={role.id === selected?.id ? "primary" : "secondary"}
                onClick={() => { setRoleId(role.id === selected?.id ? "" : role.id); setEditingRole(false); }}
                aria-pressed={role.id === selected?.id}
              >
                {role.name}{role.protected ? " · protected" : ""}
              </Button>
            ))}
          </div>

          <Button variant="secondary" onClick={() => setCreating((v) => !v)} aria-expanded={creating}>
            {creating ? "Cancel" : "Create a role"}
          </Button>
          {creating && <CreateRoleForm onDone={() => { setCreating(false); roles.reload(); }} mutate={roles.mutate} />}

          {selected && (
            <>
              <Button variant="secondary" onClick={() => setEditingRole((v) => !v)} aria-expanded={editingRole}>
                {editingRole ? "Cancel" : "Edit role details"}
              </Button>
              {editingRole && (
                <EditRoleForm role={selected} mutate={roles.mutate} onDone={() => setEditingRole(false)} />
              )}
              {/* PRIMARY: the enforced Security Role -- the rows the server evaluator reads. */}
              <SecurityRoleDetail roleKey={selected.key} />
              {/* #210: the legacy unenforced C/R/E/D matrix no longer renders -- it is not what the server enforces. */}
            </>
          )}
          {!selected && <p className="fo-muted">Choose a Security Role to see its holders, its Object actions and its decision history.</p>}
        </>
      )}
    </section>
  );
}

function CreateRoleForm({ onDone, mutate }) {
  const [draft, setDraft] = useState({ key: "", name: "", description: "" });
  const [result, setResult] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    const outcome = await mutate("createRole", {
      key: draft.key, name: draft.name, description: draft.description || null,
    });
    setResult(outcome);
    if (outcome.ok) { setDraft({ key: "", name: "", description: "" }); onDone?.(); }
  };

  return (
    <form className="fo-form" onSubmit={submit} aria-label="Create a role">
      <div className="fo-form-row">
        <label className="fo-form-field">
          <span>Key</span>
          <input
            value={draft.key}
            onChange={(e) => setDraft({ ...draft, key: e.target.value })}
            placeholder="regionalManager"
            required
          />
        </label>
        <label className="fo-form-field">
          <span>Name</span>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Regional Manager"
            required
          />
        </label>
        <label className="fo-form-field">
          <span>Description</span>
          <input
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </label>
      </div>
      <p className="fo-muted">
        The key is permanent. Every stored permission and assignment references it, so it is identity
        rather than a label — the name and description are yours to change afterwards.
      </p>
      <div className="fo-form-actions">
        <Button type="submit" variant="primary">Create role</Button>
      </div>
      <Refusal result={result} />
    </form>
  );
}

function EditRoleForm({ role, mutate, onDone }) {
  const [draft, setDraft] = useState({ name: role.name, description: role.description ?? "" });
  const [result, setResult] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    const outcome = await mutate("updateRole", {
      roleId: role.id, name: draft.name, description: draft.description || null,
    });
    setResult(outcome);
    if (outcome.ok) onDone?.();
  };

  return (
    <form className="fo-form" onSubmit={submit} aria-label="Edit role details">
      <div className="fo-form-row">
        <label className="fo-form-field">
          <span>Name</span>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
        </label>
        <label className="fo-form-field">
          <span>Description</span>
          <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </label>
      </div>
      <p className="fo-muted">
        The key <code>{role.key}</code> is identity and cannot change.
      </p>
      <div className="fo-form-actions">
        <Button type="submit" variant="primary">Save role</Button>
      </div>
      <Refusal result={result} />
    </form>
  );
}

/**
 * THE LEGACY C/R/E/D MATRIX -- READ-ONLY, NOT ENFORCED.
 *
 * `role_object_permissions` and the field overrides are stored, and no runtime evaluator reads them
 * (pass-6 finding; pendingAuthorityCorrections.json). Every mutation control that wrote them
 * (setObjectPermission, set/removeFieldPermissionOverride) is REMOVED from this screen: a checkbox
 * that changes nothing the server enforces is a false control. The stored values stay visible,
 * collapsed and labelled, because "what does the legacy table say" is still a question during the
 * retirement -- never "what may this Role do". That answer is the Security Role detail above.
 */
function LegacyRoleMatrix({ role, objects }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="fo-panel" aria-label="Legacy matrix — not enforced">
      <h4>Legacy matrix — not enforced <span className="fo-muted">· read-only</span></h4>
      <p className="fo-muted">
        The stored Create / Read / Edit / Delete matrix. No runtime evaluator reads it, so it grants
        and denies nothing and cannot be edited here. Enforced access is the Security Role above.
      </p>
      <Button variant="secondary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "Hide" : "Show"} the legacy matrix
      </Button>
      {open && <LegacyRoleGrid role={role} objects={objects} />}
    </section>
  );
}

function LegacyRoleGrid({ role, objects }) {
  const policy = usePolicyStore("readRolePolicy", { roleId: role.id });
  const [openObjectKey, setOpenObjectKey] = useState(null);

  const credByObjectId = useMemo(() => {
    const map = new Map();
    for (const p of policy.data?.objectPermissions ?? []) map.set(p.objectId, p.cred);
    return map;
  }, [policy.data]);

  const overridesByFieldId = useMemo(() => {
    const map = new Map();
    for (const o of policy.data?.fieldOverrides ?? []) map.set(o.fieldId, o.override);
    return map;
  }, [policy.data]);

  if (policy.status !== "ready") {
    return <p className="fo-muted">{policy.status === "failed" ? policy.error?.description : "Reading the legacy matrix…"}</p>;
  }

  return (
    <table className="fo-table" aria-label={`Legacy matrix for ${role.name}`}>
      <thead>
        <tr>
          <th>Object / field</th>
          {VERBS.map((v) => <th key={v}>{VERB_LABEL[v]}</th>)}
        </tr>
      </thead>
      <tbody>
        {objects.map((object) => {
          const cred = credByObjectId.get(object.id) ?? null;
          const open = object.key === openObjectKey;
          return (
            <RoleObjectRows
              key={object.id}
              object={object}
              cred={cred}
              open={open}
              onToggleOpen={() => setOpenObjectKey(open ? null : object.key)}
              overridesByFieldId={overridesByFieldId}
            />
          );
        })}
      </tbody>
    </table>
  );
}

/** One legacy object row, plus its field rows when expanded. READ-ONLY: no checkbox, no select. */
function RoleObjectRows({ object, cred, open, onToggleOpen, overridesByFieldId }) {
  const detail = usePolicyStore("readObjectWithFields", open ? { objectKey: object.key } : null, { enabled: open });

  return (
    <>
      <tr>
        <td>
          <Button variant="secondary" onClick={onToggleOpen} aria-expanded={open}>
            {open ? "▾" : "▸"} {object.label}
          </Button>
          <span className="fo-muted"> <code>{object.key}</code></span>
        </td>
        {VERBS.map((verb) => (
          <td key={verb} className="fo-muted">
            {!verbAvailable(object, verb) ? "—" : cred?.[verb] === true ? "Stored: yes" : "Stored: no"}
          </td>
        ))}
      </tr>

      {open && detail.status !== "ready" && (
        <tr>
          <td colSpan={VERBS.length + 1} className="fo-muted">
            {detail.status === "failed" ? detail.error?.description : "Reading fields…"}
          </td>
        </tr>
      )}

      {open && detail.status === "ready" && detail.data.fields.map((field) => (
        <RoleFieldRow
          key={field.id}
          object={object}
          cred={cred}
          field={field}
          override={overridesByFieldId.get(field.id) ?? null}
        />
      ))}
    </>
  );
}

/** A legacy field row: the stored override in words. UNGOVERNED INHERITS DOWNWARD, as before. */
function RoleFieldRow({ object, cred, field, override }) {
  return (
    <tr className="fo-row-nested">
      <td className="fo-nested-label">
        ↳ {field.label} <span className="fo-muted"><code>{field.key}</code> · {field.dataType}</span>
      </td>
      {VERBS.map((verb) => (
        <td key={verb} className="fo-muted">
          {verbAvailable(object, verb) ? effectiveFieldAnswer(override, verb, cred?.[verb] === true) : "—"}
        </td>
      ))}
    </tr>
  );
}

// ════════════════════ OBJECTS ════════════════════

export function ObjectsSurface() {
  const objects = usePolicyStore("listObjects");
  const [openKey, setOpenKey] = useState(null);

  if (!isPolicyApiConfigured()) return null;

  return (
    <section className="fo-panel" aria-label="Objects">
      <h3>Objects <span className="fo-muted">· this tenant&rsquo;s stored configuration</span></h3>
      {objects.status === "loading" && <p className="fo-muted">Reading objects…</p>}
      {objects.status === "failed" && <p className="fo-warning">{objects.error?.description}</p>}

      {objects.status === "ready" && (
        <table className="fo-table">
          <thead>
            <tr><th>Object</th><th>Key</th><th>Origin</th><th>Deletable</th></tr>
          </thead>
          <tbody>
            {objects.data.map((object) => (
              <ObjectRows
                key={object.id}
                object={object}
                open={object.key === openKey}
                onToggleOpen={() => setOpenKey(object.key === openKey ? null : object.key)}
                onChanged={objects.reload}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ObjectRows({ object, open, onToggleOpen, onChanged }) {
  const detail = usePolicyStore("readObjectWithFields", open ? { objectKey: object.key } : null, { enabled: open });
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState(null);

  return (
    <>
      <tr>
        <td>
          <Button variant="secondary" onClick={onToggleOpen} aria-expanded={open}>
            {open ? "▾" : "▸"} {object.label}
          </Button>
        </td>
        <td className="fo-muted"><code>{object.key}</code></td>
        <td className="fo-muted">{object.origin}</td>
        <td className="fo-muted">{object.supportsDelete ? "yes" : "no"}</td>
      </tr>

      {open && (
        <tr className="fo-row-nested">
          <td colSpan={4}>
            <div className="fo-panel--nested">
              <Button variant="secondary" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
                {editing ? "Cancel" : "Edit object details"}
              </Button>
              {editing && (
                <EditObjectForm
                  object={object}
                  mutate={detail.mutate}
                  onDone={() => { setEditing(false); onChanged?.(); }}
                />
              )}
              <Refusal result={result} />
              {detail.status !== "ready" ? (
                <p className="fo-muted">
                  {detail.status === "failed" ? detail.error?.description : "Reading fields…"}
                </p>
              ) : (
                <>
                  <FieldTable
                    fields={detail.data.fields}
                    mutate={detail.mutate}
                    onResult={setResult}
                  />
                  <CreateFieldForm objectKey={object.key} mutate={detail.mutate} onResult={setResult} />
                </>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function EditObjectForm({ object, mutate, onDone }) {
  const [draft, setDraft] = useState({
    label: object.label,
    labelPlural: object.labelPlural ?? "",
    description: object.description ?? "",
  });
  const [result, setResult] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    const outcome = await mutate("updateObjectMetadata", {
      objectKey: object.key,
      label: draft.label,
      labelPlural: draft.labelPlural || null,
      description: draft.description || null,
    });
    setResult(outcome);
    if (outcome.ok) onDone?.();
  };

  return (
    <form className="fo-form" onSubmit={submit} aria-label="Edit object details">
      <div className="fo-form-row">
        <label className="fo-form-field">
          <span>Label</span>
          <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} required />
        </label>
        <label className="fo-form-field">
          <span>Plural label</span>
          <input value={draft.labelPlural} onChange={(e) => setDraft({ ...draft, labelPlural: e.target.value })} />
        </label>
        <label className="fo-form-field">
          <span>Description</span>
          <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </label>
      </div>
      <p className="fo-muted">
        What the object is CALLED is yours. Its key <code>{object.key}</code>, its origin and whether
        it supports Delete are not: the key is identity, and the other two are what the engine can
        enforce rather than preferences.
      </p>
      <div className="fo-form-actions">
        <Button type="submit" variant="primary">Save object</Button>
      </div>
      <Refusal result={result} />
    </form>
  );
}

function FieldTable({ fields, mutate, onResult }) {
  const [editingId, setEditingId] = useState(null);
  return (
    <>
      <table className="fo-table">
        <thead>
          <tr>
            <th>Field</th><th>Key</th><th>Type</th><th>Origin</th><th>Required</th>
            <th>Sensitivity</th><th>Lifecycle</th><th />
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            // THE KEY BELONGS ON THE FRAGMENT. With it on the inner <tr> instead, React reconciles
            // this list positionally and the conditional edit row below never renders -- which is
            // exactly what the browser found: an Edit button that appeared to do nothing.
            <Fragment key={field.id}>
              <tr>
                <td>{field.label}</td>
                <td className="fo-muted"><code>{field.key}</code></td>
                <td className="fo-muted">
                  {field.dataType}
                  {field.referenceTo ? <span className="fo-muted"> → {field.referenceTo}</span> : null}
                  {(field.allowedValues ?? []).length > 0
                    ? <span className="fo-muted"> ({field.allowedValues.join(", ")})</span>
                    : null}
                </td>
                <td className="fo-muted">{field.origin}</td>
                <td className="fo-muted">{field.required ? "yes" : "no"}</td>
                <td className="fo-muted">{field.sensitivity}</td>
                <td className="fo-muted">{field.lifecycle}</td>
                <td>
                  {/* SYSTEM fields get no edit affordance, and that is not the enforcement --
                      the server refuses a SYSTEM definition mutation whether or not a button
                      existed. This just stops offering an action that would be refused. */}
                  {field.origin === "CUSTOM" ? (
                    <Button
                      variant="secondary"
                      onClick={() => setEditingId(editingId === field.id ? null : field.id)}
                      aria-expanded={editingId === field.id}
                    >
                      Edit
                    </Button>
                  ) : (
                    <span className="fo-muted" title="A system field's definition is protected">protected</span>
                  )}
                </td>
              </tr>
              {editingId === field.id && (
                <tr className="fo-row-nested">
                  <td colSpan={8}>
                    <EditFieldForm
                      field={field}
                      mutate={mutate}
                      onResult={onResult}
                      onDone={() => setEditingId(null)}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      <p className="fo-muted">
        A system field&rsquo;s definition is fixed — its POLICY is still fully configurable from
        Roles &amp; Permissions. Custom fields are yours to edit.
      </p>
    </>
  );
}

function EditFieldForm({ field, mutate, onResult, onDone }) {
  const [draft, setDraft] = useState({
    label: field.label,
    description: field.description ?? "",
    required: field.required === true,
    searchable: field.searchable === true,
    sortable: field.sortable === true,
    reportable: field.reportable === true,
    sensitivity: field.sensitivity,
    lifecycle: field.lifecycle,
  });

  const submit = async (event) => {
    event.preventDefault();
    const outcome = await mutate("updateCustomFieldMetadata", {
      fieldId: field.id,
      label: draft.label,
      description: draft.description || null,
      required: draft.required,
      searchable: draft.searchable,
      sortable: draft.sortable,
      reportable: draft.reportable,
      sensitivity: draft.sensitivity,
      lifecycle: draft.lifecycle,
    });
    onResult(outcome);
    if (outcome.ok) onDone?.();
  };

  const check = (name, label) => (
    <label className="fo-form-field">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={draft[name]}
        onChange={(e) => setDraft({ ...draft, [name]: e.target.checked })}
        aria-label={`${label} on ${field.label}`}
      />
    </label>
  );

  return (
    <form className="fo-form" onSubmit={submit} aria-label={`Edit field ${field.label}`}>
      <div className="fo-form-row">
        <label className="fo-form-field">
          <span>Label</span>
          <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} required />
        </label>
        <label className="fo-form-field">
          <span>Description</span>
          <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </label>
        <label className="fo-form-field">
          <span>Sensitivity</span>
          <select value={draft.sensitivity} onChange={(e) => setDraft({ ...draft, sensitivity: e.target.value })}>
            {SENSITIVITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="fo-form-field">
          <span>Lifecycle</span>
          <select value={draft.lifecycle} onChange={(e) => setDraft({ ...draft, lifecycle: e.target.value })}>
            {LIFECYCLES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <div className="fo-form-row">
        {check("required", "Required")}
        {check("searchable", "Searchable")}
        {check("sortable", "Sortable")}
        {check("reportable", "Reportable")}
      </div>
      <p className="fo-muted">
        The key <code>{field.key}</code> and the type <code>{field.dataType}</code> are not editable.
        Changing either is a data migration wearing an edit&rsquo;s clothes — every stored value is
        already that type, under that name.
      </p>
      <div className="fo-form-actions">
        <Button type="submit" variant="primary">Save field</Button>
      </div>
    </form>
  );
}

function CreateFieldForm({ objectKey, mutate, onResult }) {
  const [draft, setDraft] = useState({
    key: "", label: "", description: "", dataType: "STRING",
    required: false, searchable: false, sortable: false, reportable: false,
    sensitivity: "NORMAL", allowedValues: "", referenceTo: "",
  });

  const needsAllowedValues = draft.dataType === "ENUM" || draft.dataType === "ENUM_SET";
  const needsReference = draft.dataType === "REFERENCE";

  const submit = async (event) => {
    event.preventDefault();
    const outcome = await mutate("createCustomField", {
      objectKey,
      key: draft.key,
      label: draft.label,
      description: draft.description || null,
      dataType: draft.dataType,
      required: draft.required,
      searchable: draft.searchable,
      sortable: draft.sortable,
      reportable: draft.reportable,
      sensitivity: draft.sensitivity,
      ...(needsAllowedValues
        ? { allowedValues: draft.allowedValues.split(",").map((v) => v.trim()).filter(Boolean) }
        : {}),
      ...(needsReference ? { referenceTo: draft.referenceTo } : {}),
    });
    onResult(outcome);
    if (outcome.ok) {
      setDraft({
        key: "", label: "", description: "", dataType: "STRING",
        required: false, searchable: false, sortable: false, reportable: false,
        sensitivity: "NORMAL", allowedValues: "", referenceTo: "",
      });
    }
  };

  const check = (name, label) => (
    <label className="fo-form-field">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={draft[name]}
        onChange={(e) => setDraft({ ...draft, [name]: e.target.checked })}
        aria-label={`${label} on the new field`}
      />
    </label>
  );

  return (
    <form className="fo-form" onSubmit={submit} aria-label="Create a custom field">
      <h4>Add a custom field</h4>
      <div className="fo-form-row">
        <label className="fo-form-field">
          <span>Key</span>
          <input value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} placeholder="loyaltyTier" required />
        </label>
        <label className="fo-form-field">
          <span>Label</span>
          <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Loyalty Tier" required />
        </label>
        <label className="fo-form-field">
          <span>Type</span>
          <select value={draft.dataType} onChange={(e) => setDraft({ ...draft, dataType: e.target.value })}>
            {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="fo-form-field">
          <span>Sensitivity</span>
          <select value={draft.sensitivity} onChange={(e) => setDraft({ ...draft, sensitivity: e.target.value })}>
            {SENSITIVITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

      {/* CONDITIONAL, and required rather than optional: an ENUM with no values and a REFERENCE with
          no target are refused by the server, so offering them as optional would be inviting a
          round trip to be told what the form already knew. */}
      {needsAllowedValues && (
        <div className="fo-form-row">
          <label className="fo-form-field">
            <span>Allowed values (comma separated)</span>
            <input
              value={draft.allowedValues}
              onChange={(e) => setDraft({ ...draft, allowedValues: e.target.value })}
              placeholder="GOLD, SILVER, BRONZE"
              required
            />
          </label>
        </div>
      )}
      {needsReference && (
        <div className="fo-form-row">
          <label className="fo-form-field">
            <span>References object key</span>
            <input
              value={draft.referenceTo}
              onChange={(e) => setDraft({ ...draft, referenceTo: e.target.value })}
              placeholder="account"
              required
            />
          </label>
        </div>
      )}

      <div className="fo-form-row">
        {check("required", "Required")}
        {check("searchable", "Searchable")}
        {check("sortable", "Sortable")}
        {check("reportable", "Reportable")}
      </div>
      <label className="fo-form-field">
        <span>Description</span>
        <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      </label>
      <div className="fo-form-actions">
        <Button type="submit" variant="primary">Create field</Button>
      </div>
    </form>
  );
}
