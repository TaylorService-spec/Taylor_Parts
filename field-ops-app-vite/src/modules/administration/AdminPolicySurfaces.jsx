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
import { Search as SearchIcon } from "lucide-react";
import { Button } from "../../shared/ui/primitives/index.js";
import { usePolicyStore } from "./usePolicyStore.js";
import { isPolicyApiConfigured } from "../../services/adminPolicyApiClient.js";
// The four-fact logic lives in its own module: it is the part worth proving without a DOM, and
// keeping it here would have made it reachable only through a rendered grid.
import { effectiveFieldAnswer, verbAvailable } from "./fieldPermissionState.js";
import SecurityRoleDetail from "./SecurityRoleDetail.jsx";
import AdminDisclosure from "./AdminDisclosure.jsx";
import { readAdminQueryParam } from "../../domain/workflowResponsibilityLinks.js";
import { identifierLabel, titleCase } from "../../shared/display/displayLabels.js";
import { useTableSort } from "../../shared/ui/sorting/useTableSort.js";
import SortableHeader from "../../shared/ui/sorting/SortableHeader.jsx";

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
        {open ? "Hide" : "Show"} the Measured Model
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
  // The edit form belongs to ONE Role: it is open only while THAT Role is the one shown, so a search or filter that
  // changes the shown Role closes it rather than leaving another Role's values in a form that would save to this one.
  const [editingRoleId, setEditingRoleId] = useState(null);
  // DEEP LINK (?role=<key>, from Employee > Workflow responsibilities): pre-selects a Security Role until one is chosen.
  const [linkedRoleKey] = useState(() => readAdminQueryParam("role"));
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");

  if (!isPolicyApiConfigured()) return null;

  // WHICH ROLE IS SHOWN (ADMIN-UI-007, with the Owner's deep-link safeguard). Only Roles the server's listRoles
  // returned are candidates, so nothing here widens what this administrator may see.
  //   - An explicit choice wins while it still matches the search and filter.
  //   - A ?role= link selects that Role; if the link names a Role that is not in the list, the detail says so and
  //     NOTHING else is substituted for it until the administrator chooses.
  //   - Otherwise the first matching Role is shown, so the detail panel is never empty while a Role matches.
  const all = roles.data ?? [];
  const needle = query.trim().toLowerCase();
  const shown = all
    .filter((r) => kind === "all" || (kind === "protected" ? r.protected : !r.protected))
    .filter((r) => !needle || `${identifierLabel(r.key, r.name)} ${r.description ?? ""}`.toLowerCase().includes(needle));
  const linked = roleId === null && linkedRoleKey ? all.find((r) => r.key === linkedRoleKey) ?? null : null;
  const linkUnavailable = roles.status === "ready" && roleId === null && Boolean(linkedRoleKey) && !linked;
  const preferred = roleId !== null ? all.find((r) => r.id === roleId) ?? null : linked;
  const selected = linkUnavailable ? null
    : (preferred && shown.some((r) => r.id === preferred.id) ? preferred : shown[0] ?? null);
  const editingRole = selected !== null && editingRoleId === selected.id;

  return (
    <section className="fo-panel" aria-label="Role permissions">
      <h3>Security Roles <span className="fo-muted">· this tenant&rsquo;s governed policy</span></h3>
      {roles.status === "loading" && <p className="fo-muted">Reading roles…</p>}
      {roles.status === "failed" && <p className="fo-warning">{roles.error?.description}</p>}

      {roles.status === "ready" && (() => {
        // MASTER-DETAIL (approved IA, Phase 3; ADMIN-UI-005/006): a full-width search with an icon, a compact
        // segmented filter and a compact selectable list beside the selected Role. Same listRoles read.
        const choose = (role) => { setRoleId(role.id); setEditingRoleId(null); };
        return (
          <>
            {/* The three ideas this screen keeps apart. Only the Security Role grants anything here. */}
            <p className="fo-muted">
              A <strong>Security Role</strong> is what someone may do. A <strong>Job Role</strong> is what their job is;
              it shapes their pages and grants nothing. A <strong>permission</strong> is one action EOS enforces, such
              as Dispatch Work Order.
            </p>
            <div className="fo-master-detail">
              <div className="fo-admin-listpanel">
                <label className="fo-admin-search">
                  <span className="fo-sr-only">Search Security Roles</span>
                  <SearchIcon className="fo-admin-search__icon" aria-hidden="true" size={16} />
                  <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search roles by name or description" />
                </label>
                <div className="fo-admin-listpanel__bar">
                  <div className="fo-admin-segmented" role="group" aria-label="Role type">
                    {[["all", "All"], ["protected", "Protected"], ["other", "Not protected"]].map(([id, label]) => (
                      <button key={id} type="button" className="fo-admin-segmented__option" aria-pressed={kind === id} onClick={() => setKind(id)}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="fo-admin-count" aria-live="polite">{shown.length} of {all.length}</span>
                </div>
                <div role="group" aria-label="Select a role">
                  <ul className="fo-admin-selectlist">
                    {shown.map((role) => (
                      <li key={role.id}>
                        <button type="button" className="fo-admin-selectlist__option" aria-pressed={role.id === selected?.id}
                          aria-current={role.id === selected?.id ? "true" : undefined} onClick={() => choose(role)}>
                          <span className="fo-admin-selectlist__name">{identifierLabel(role.key, role.name)}</span>
                          {role.protected ? <span className="fo-admin-badge">Protected</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                {shown.length === 0 && <p className="fo-muted">No Security Role matches {needle ? <>&ldquo;{query}&rdquo;</> : "this filter"}.</p>}
                <Button variant="secondary" onClick={() => setCreating((v) => !v)} aria-expanded={creating}>
                  {creating ? "Cancel" : "Create a Role"}
                </Button>
                {creating && <CreateRoleForm onDone={() => { setCreating(false); roles.reload(); }} mutate={roles.mutate} />}
              </div>

              <div>
                {selected && (
                  <>
                    <Button variant="secondary" onClick={() => setEditingRoleId(editingRole ? null : selected.id)} aria-expanded={editingRole}>
                      {editingRole ? "Cancel" : "Edit Role Details"}
                    </Button>
                    {editingRole && (
                      // key: the draft is seeded from THIS Role and can never be carried to another.
                      <EditRoleForm key={selected.id} role={selected} mutate={roles.mutate} onDone={() => setEditingRoleId(null)} />
                    )}
                    {/* PRIMARY: the enforced Security Role -- the rows the server evaluator reads. */}
                    <SecurityRoleDetail key={selected.key} roleKey={selected.key} />
                    {/* #210: the legacy unenforced C/R/E/D matrix no longer renders -- it is not what the server enforces. */}
                  </>
                )}
                {linkUnavailable && (
                  <div className="fo-admin-notice" role="status" data-role-link-unavailable={linkedRoleKey}>
                    <strong>The linked Security Role isn&rsquo;t available.</strong> It may not exist, or it isn&rsquo;t
                    one you can view. Choose a Security Role from the list.
                  </div>
                )}
                {!selected && !linkUnavailable && (
                  <p className="fo-muted">No Security Role matches the search or filter, so there is nothing to show.</p>
                )}
              </div>
            </div>
          </>
        );
      })()}
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
        <Button type="submit" variant="primary">Create Role</Button>
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
        <Button type="submit" variant="primary">Save Role</Button>
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
            {open ? "▾" : "▸"} {object.label ?? titleCase(object.key)}
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

const OBJECT_COLUMNS = Object.freeze({
  object: { value: (o) => o.label ?? titleCase(o.key) },
  key: { value: (o) => o.key },
  origin: { value: (o) => titleCase(o.origin) },
  deletable: { value: (o) => (o.supportsDelete ? "Yes" : "No") },
});

// The object catalog (approved Administration IA, Phase 2): searchable by business name, with keys
// and other technical identifiers behind "Show technical details" rather than leading every row.
export function ObjectsSurface() {
  const objects = usePolicyStore("listObjects");
  const [openKey, setOpenKey] = useState(null);
  const [query, setQuery] = useState("");
  const [technical, setTechnical] = useState(false);
  const { sort, toggle, sorted } = useTableSort({ rows: objects.status === "ready" ? objects.data : null, columns: OBJECT_COLUMNS });
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? sorted.filter((o) => `${o.label ?? ""} ${o.labelPlural ?? ""} ${o.description ?? ""} ${o.key}`.toLowerCase().includes(needle))
    : sorted;

  if (!isPolicyApiConfigured()) return null;

  return (
    <section className="fo-panel" aria-label="Objects">
      <h3>Object catalog <span className="fo-muted">· the business records EOS keeps</span></h3>
      {objects.status === "loading" && <p className="fo-muted">Reading objects…</p>}
      {objects.status === "failed" && <p className="fo-warning">{objects.error?.description}</p>}

      {objects.status === "ready" && (
        <>
          <div className="fo-form-row">
            <label className="fo-form-field">
              <span>Search Objects</span>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Accounts, work order, inventory…" />
            </label>
            <label className="fo-form-field">
              <span>Show Technical Details</span>
              <input type="checkbox" checked={technical} onChange={(e) => setTechnical(e.target.checked)} />
            </label>
          </div>
          <p className="fo-muted">
            {visible.length} of {sorted.length} objects. Select one to see its fields and add a custom field.
          </p>
          <div className="fo-table-scroll"><table className="fo-table">
            <thead>
              <tr>
                <SortableHeader columnKey="object" label="Object" sort={sort} onSort={toggle} />
                {technical && <SortableHeader columnKey="key" label="Key" sort={sort} onSort={toggle} />}
                <SortableHeader columnKey="origin" label="Origin" sort={sort} onSort={toggle} />
                <SortableHeader columnKey="deletable" label="Records Can Be Deleted" sort={sort} onSort={toggle} />
              </tr>
            </thead>
            <tbody>
              {visible.map((object) => (
                <ObjectRows
                  key={object.id}
                  object={object}
                  objects={objects.data}
                  technical={technical}
                  open={object.key === openKey}
                  onToggleOpen={() => setOpenKey(object.key === openKey ? null : object.key)}
                  onChanged={objects.reload}
                />
              ))}
            </tbody>
          </table></div>
          {visible.length === 0 && (
            <p className="fo-muted">
              No object matches &ldquo;{query}&rdquo;. Objects come from the governed catalog; new objects
              can&rsquo;t be created here.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function ObjectRows({ object, objects, technical, open, onToggleOpen, onChanged }) {
  const detail = usePolicyStore("readObjectWithFields", open ? { objectKey: object.key } : null, { enabled: open });
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState(null);

  return (
    <>
      <tr>
        <td>
          {/* ADMIN-UI-002: a full-width disclosure row, not an outlined button. */}
          <AdminDisclosure open={open} onToggle={onToggleOpen}>{object.label}</AdminDisclosure>
        </td>
        {technical && <td className="fo-muted"><code>{object.key}</code></td>}
        <td className="fo-muted">{titleCase(object.origin)}</td>
        <td className="fo-muted">{object.supportsDelete ? "Yes" : "No"}</td>
      </tr>

      {open && (
        <tr className="fo-row-nested">
          <td colSpan={technical ? 4 : 3}>
            {object.description && <p className="fo-muted">{object.description}</p>}
            <div className="fo-panel--nested">
              <Button variant="secondary" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
                {editing ? "Cancel" : "Edit Object Details"}
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
                    technical={technical}
                    objects={objects}
                  />
                  <CreateFieldForm objectKey={object.key} objects={objects} mutate={detail.mutate} onResult={setResult} />
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
          <span>Plural Label</span>
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
        <Button type="submit" variant="primary">Save Object</Button>
      </div>
      <Refusal result={result} />
    </form>
  );
}

const FIELD_COLUMNS = Object.freeze({
  field: { value: (f) => f.label },
  key: { value: (f) => f.key },
  type: { value: (f) => titleCase(f.dataType) },
  origin: { value: (f) => titleCase(f.origin) },
  required: { value: (f) => (f.required ? "Yes" : "No") },
  sensitivity: { value: (f) => titleCase(f.sensitivity) },
  lifecycle: { value: (f) => titleCase(f.lifecycle) },
});

function FieldTable({ fields, mutate, onResult, technical = false, objects = [] }) {
  // A Reference field names its target by the target's business label; the key only with technical details on.
  const targetLabel = (key) => objects.find((o) => o.key === key)?.label ?? titleCase(key);
  const [editingId, setEditingId] = useState(null);
  const { sort, toggle, sorted } = useTableSort({ rows: fields, columns: FIELD_COLUMNS });
  const header = (key, label) => <SortableHeader columnKey={key} label={label} sort={sort} onSort={toggle} />;
  return (
    <>
      <div className="fo-table-scroll"><table className="fo-table">
        <thead>
          <tr>
            {header("field", "Field")}{technical && header("key", "Key")}{header("type", "Type")}{header("origin", "Origin")}{header("required", "Required")}
            {header("sensitivity", "Sensitivity")}{header("lifecycle", "Status")}<th />
          </tr>
        </thead>
        <tbody>
          {sorted.map((field) => (
            // THE KEY BELONGS ON THE FRAGMENT. With it on the inner <tr> instead, React reconciles
            // this list positionally and the conditional edit row below never renders -- which is
            // exactly what the browser found: an Edit button that appeared to do nothing.
            <Fragment key={field.id}>
              <tr>
                <td>{field.label}</td>
                {technical && <td className="fo-muted"><code>{field.key}</code></td>}
                <td className="fo-muted">
                  {titleCase(field.dataType)}
                  {field.referenceTo ? <span className="fo-muted"> → {technical ? field.referenceTo : targetLabel(field.referenceTo)}</span> : null}
                  {(field.allowedValues ?? []).length > 0
                    ? <span className="fo-muted"> ({field.allowedValues.join(", ")})</span>
                    : null}
                </td>
                <td className="fo-muted">{titleCase(field.origin)}</td>
                <td className="fo-muted">{field.required ? "Yes" : "No"}</td>
                <td className="fo-muted">{titleCase(field.sensitivity)}</td>
                <td className="fo-muted">{titleCase(field.lifecycle)}</td>
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
                    <span className="fo-muted" title="Defined by EOS: its name and settings can't be changed here">System field</span>
                  )}
                </td>
              </tr>
              {editingId === field.id && (
                <tr className="fo-row-nested">
                  <td colSpan={technical ? 8 : 7}>
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
      </table></div>
      <p className="fo-muted">
        A system field&rsquo;s definition is fixed — who may act on its object is configured in
        Permissions. Custom fields are yours to edit.
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
            {SENSITIVITIES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
        </label>
        <label className="fo-form-field">
          <span>Lifecycle</span>
          <select value={draft.lifecycle} onChange={(e) => setDraft({ ...draft, lifecycle: e.target.value })}>
            {LIFECYCLES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
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
        <Button type="submit" variant="primary">Save Field</Button>
      </div>
    </form>
  );
}

// A suggested field key from its business label ("Service Contract" -> "serviceContract"). Only a
// suggestion: the server validates the key, and the administrator can change it before saving.
export function suggestFieldKey(label) {
  const words = String(label ?? "").trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length === 0) return "";
  const camel = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join("");
  return /^[0-9]/.test(camel) ? `field${camel}` : camel;
}

function CreateFieldForm({ objectKey, objects = [], mutate, onResult }) {
  const [draft, setDraft] = useState({
    key: "", label: "", description: "", dataType: "STRING",
    required: false, searchable: false, sortable: false, reportable: false,
    sensitivity: "NORMAL", allowedValues: "", referenceTo: "",
  });
  // The key follows the label until the administrator edits the key themselves.
  const [keyEdited, setKeyEdited] = useState(false);
  const [created, setCreated] = useState(null);
  const referenceTargets = [...objects].sort((a, b) => (a.label ?? a.key).localeCompare(b.label ?? b.key));

  const needsAllowedValues = draft.dataType === "ENUM" || draft.dataType === "ENUM_SET";
  const needsReference = draft.dataType === "REFERENCE";

  const submit = async (event) => {
    event.preventDefault();
    setCreated(null); // a previous success must not sit beside a new refusal
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
      setCreated(draft.label);
      setKeyEdited(false);
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
      <h4>Add a Custom Field</h4>
      {created && (
        <p className="fo-muted" role="status">
          <strong>{created}</strong> was created as a <strong>Draft</strong> custom field. It follows this
          object&rsquo;s access. It does not store values or appear on a record page yet; both need
          separately approved capabilities.
        </p>
      )}
      <div className="fo-form-row">
        <label className="fo-form-field">
          <span>Label</span>
          <input
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value, key: keyEdited ? draft.key : suggestFieldKey(e.target.value) })}
            placeholder="Loyalty Tier"
            required
          />
        </label>
        <label className="fo-form-field">
          <span>Key</span>
          <input
            value={draft.key}
            onChange={(e) => { setKeyEdited(true); setDraft({ ...draft, key: e.target.value }); }}
            placeholder="loyaltyTier"
            required
          />
        </label>
        <label className="fo-form-field">
          <span>Type</span>
          <select value={draft.dataType} onChange={(e) => setDraft({ ...draft, dataType: e.target.value })}>
            {FIELD_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
          </select>
        </label>
        <label className="fo-form-field">
          <span>Sensitivity</span>
          <select value={draft.sensitivity} onChange={(e) => setDraft({ ...draft, sensitivity: e.target.value })}>
            {SENSITIVITIES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
        </label>
      </div>

      {/* CONDITIONAL, and required rather than optional: an ENUM with no values and a REFERENCE with
          no target are refused by the server, so offering them as optional would be inviting a
          round trip to be told what the form already knew. */}
      {needsAllowedValues && (
        <div className="fo-form-row">
          <label className="fo-form-field">
            <span>Allowed Values (Comma Separated)</span>
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
          {/* Chosen by business name from the catalog this screen already read (O04). The server still
              validates the target; free text is kept only if the catalog could not be read. */}
          {referenceTargets.length > 0 ? (
            <label className="fo-form-field">
              <span>Links To</span>
              <select value={draft.referenceTo} onChange={(e) => setDraft({ ...draft, referenceTo: e.target.value })} required>
                <option value="">Choose an object…</option>
                {referenceTargets.map((o) => <option key={o.key} value={o.key}>{o.label ?? titleCase(o.key)}</option>)}
              </select>
            </label>
          ) : (
            <label className="fo-form-field">
              <span>References Object Key</span>
              <input
                value={draft.referenceTo}
                onChange={(e) => setDraft({ ...draft, referenceTo: e.target.value })}
                placeholder="account"
                required
              />
            </label>
          )}
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
        <Button type="submit" variant="primary">Create Field</Button>
      </div>
    </form>
  );
}
