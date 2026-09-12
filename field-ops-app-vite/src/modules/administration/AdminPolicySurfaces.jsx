// ADMINISTRATION — the configuration surfaces themselves.
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
import { Fragment, useCallback, useMemo, useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import { usePolicyStore } from "./usePolicyStore.js";
import { isPolicyApiConfigured } from "../../services/adminPolicyApiClient.js";
// The four-fact logic lives in its own module: it is the part worth proving without a DOM, and
// keeping it here would have made it reachable only through a rendered grid.
import {
  ALLOW,
  DENY,
  INHERIT,
  effectiveFieldAnswer,
  fieldVerbState,
  nextOverride,
  verbAvailable,
} from "./fieldPermissionState.js";

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
 * The stored CRED for one Role: every Object, expandable into every Field.
 *
 * Fields load PER EXPANDED OBJECT. 36 objects and 389 fields is small, but fetching every field of
 * every object to render a collapsed row would be a request storm for data nobody is looking at.
 */
export function RolesPermissionsSurface() {
  const roles = usePolicyStore("listRoles");
  const objects = usePolicyStore("listObjects");
  const [roleId, setRoleId] = useState(null);
  const [creating, setCreating] = useState(false);

  if (!isPolicyApiConfigured()) return null;

  const selected = (roles.data ?? []).find((r) => r.id === roleId) ?? null;

  return (
    <section className="fo-panel" aria-label="Role permissions">
      <h3>Roles &amp; permissions <span className="fo-muted">· this tenant&rsquo;s stored policy</span></h3>
      {roles.status === "loading" && <p className="fo-muted">Reading roles…</p>}
      {roles.status === "failed" && <p className="fo-warning">{roles.error?.description}</p>}

      {roles.status === "ready" && (
        <>
          <div className="fo-pill-row" role="group" aria-label="Select a role">
            {roles.data.map((role) => (
              <Button
                key={role.id}
                variant={role.id === roleId ? "primary" : "secondary"}
                onClick={() => setRoleId(role.id === roleId ? null : role.id)}
                aria-pressed={role.id === roleId}
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
            <RoleGrid
              role={selected}
              objects={objects.data ?? []}
              onRoleChanged={roles.reload}
            />
          )}
          {!selected && <p className="fo-muted">Choose a role to configure what it may do.</p>}
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

function RoleGrid({ role, objects, onRoleChanged }) {
  const policy = usePolicyStore("readRolePolicy", { roleId: role.id });
  const [openObjectKey, setOpenObjectKey] = useState(null);
  const [result, setResult] = useState(null);
  const [editingRole, setEditingRole] = useState(false);

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

  const toggleObjectVerb = useCallback(async (object, verb, current) => {
    const cred = { C: false, R: false, E: false, D: false, ...(credByObjectId.get(object.id) ?? {}) };
    setResult(await policy.mutate("setObjectPermission", {
      roleId: role.id, objectKey: object.key, cred: { ...cred, [verb]: !current },
    }));
  }, [credByObjectId, policy, role.id]);

  if (policy.status !== "ready") {
    return <p className="fo-muted">{policy.status === "failed" ? policy.error?.description : "Reading the stored policy…"}</p>;
  }

  return (
    <div className="fo-panel--nested">
      <h4>{role.name} <span className="fo-muted">· <code>{role.key}</code></span></h4>
      <Button variant="secondary" onClick={() => setEditingRole((v) => !v)} aria-expanded={editingRole}>
        {editingRole ? "Cancel" : "Edit role details"}
      </Button>
      {editingRole && (
        <EditRoleForm
          role={role}
          mutate={policy.mutate}
          onDone={() => { setEditingRole(false); onRoleChanged?.(); }}
        />
      )}

      <Refusal result={result} />
      <p className="fo-muted">
        A field with no override inherits its object&rsquo;s answer. Setting a field back to Inherit
        removes the stored override entirely.
      </p>

      <table className="fo-table">
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
                onToggleVerb={toggleObjectVerb}
                overridesByFieldId={overridesByFieldId}
                roleId={role.id}
                mutate={policy.mutate}
                onResult={setResult}
              />
            );
          })}
        </tbody>
      </table>
    </div>
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

/** One object row, plus its field rows when expanded. Returns a fragment of <tr>s. */
function RoleObjectRows({ object, cred, open, onToggleOpen, onToggleVerb, overridesByFieldId, roleId, mutate, onResult }) {
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
        {VERBS.map((verb) => {
          const available = verbAvailable(object, verb);
          const granted = cred?.[verb] === true;
          return (
            <td key={verb}>
              {available ? (
                <input
                  type="checkbox"
                  checked={granted}
                  onChange={() => onToggleVerb(object, verb, granted)}
                  aria-label={`${VERB_LABEL[verb]} on ${object.label}`}
                />
              ) : (
                <span className="fo-muted" title="No capability governs this verb — it cannot be granted to anyone">
                  —
                </span>
              )}
            </td>
          );
        })}
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
          roleId={roleId}
          mutate={mutate}
          onResult={onResult}
        />
      ))}
    </>
  );
}

function RoleFieldRow({ object, cred, field, override, roleId, mutate, onResult }) {
  /**
   * ONE VERB CHANGES; THE OTHERS SURVIVE.
   *
   * `setFieldPermissionOverride` replaces the whole override, so sending only the verb being
   * changed would silently drop every other explicit verb on that field. The current override is
   * read, the one verb is modified, and the result is sent whole. An empty result means "no
   * opinion", which is `removeFieldPermissionOverride` — not an override of all-false.
   */
  const setVerb = async (verb, next) => {
    const { override: updated, remove } = nextOverride(override, verb, next);
    onResult(await mutate(
      remove ? "removeFieldPermissionOverride" : "setFieldPermissionOverride",
      remove
        ? { roleId, fieldId: field.id }
        : { roleId, fieldId: field.id, override: updated },
    ));
  };

  return (
    <tr className="fo-row-nested">
      <td className="fo-nested-label">
        ↳ {field.label} <span className="fo-muted"><code>{field.key}</code> · {field.dataType}</span>
      </td>
      {VERBS.map((verb) => {
        // UNGOVERNED INHERITS DOWNWARD: a field of an object whose Delete nothing governs has no
        // grantable Delete either.
        if (!verbAvailable(object, verb)) {
          return (
            <td key={verb}>
              <span className="fo-muted" title="No capability governs this verb">—</span>
            </td>
          );
        }
        const state = fieldVerbState(override, verb);
        const objectGranted = cred?.[verb] === true;
        return (
          <td key={verb}>
            <label className="fo-form-field">
              <span className="fo-muted">{effectiveFieldAnswer(override, verb, objectGranted)}</span>
              <select
                value={state}
                onChange={(e) => setVerb(verb, e.target.value)}
                aria-label={`${VERB_LABEL[verb]} on field ${field.label} of ${object.label}`}
              >
                <option value={INHERIT}>Inherit</option>
                <option value={ALLOW}>Allow</option>
                <option value={DENY}>Deny</option>
              </select>
            </label>
          </td>
        );
      })}
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
