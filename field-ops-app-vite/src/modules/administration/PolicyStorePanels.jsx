// The live Administration surfaces — Objects, Roles & Permissions, Users, Workflows.
//
// ════════════════════ WHY THESE ARE PANELS AND NOT REWRITES ════════════════════
//
// The four Administration screens render the MEASURED model: the capability catalogue, the CRUD
// matrix, the workflow definitions read from the code that runs today. That is what they are for,
// and it stays true whether or not a policy database exists.
//
// These panels are what appears IN ADDITION when one does. They read the tenant's stored
// configuration through the trusted API and let an administrator change it. Two things are being
// shown, they are different things, and merging them into one grid would make it impossible to tell
// "this is what the code does" from "this is what your tenant has configured" — which is exactly
// the confusion this whole workstream exists to end.
//
// ════════════════════ NOT CONFIGURED IS SAID OUT LOUD ════════════════════
//
// No EOS API is deployed anywhere today. Every panel therefore renders its own honest state rather
// than an empty table: an empty table would read as "your tenant has no Roles", which is a lie about
// the tenant rather than a statement about the connection.
//
// ════════════════════ NOTHING IS SHOWN UNTIL IT IS STORED ════════════════════
//
// Every mutation goes through `usePolicyStore`'s `mutate`, which re-reads. There is no optimistic
// update anywhere in this file. If the server refused, the screen shows the refusal and the old
// value — never the value the administrator typed.
import { useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import { usePolicyStore } from "./usePolicyStore.js";

const VERBS = ["C", "R", "E", "D"];
const VERB_LABEL = { C: "Create", R: "Read", E: "Edit", D: "Delete" };

/** The wrapper every panel shares, so "not configured", "loading" and "failed" read identically. */
function PolicyPanel({ title, state, children, note }) {
  return (
    <section className="fo-panel" aria-label={title}>
      <h3>{title} <span className="fo-muted">· policy store</span></h3>
      {note && <p className="fo-muted">{note}</p>}
      {state.status === "unconfigured" && (
        <p className="fo-warning">
          No EOS policy service is configured for this environment, so this tenant has no stored
          configuration to show or change. Everything above is measured from the code that runs
          today, which is a different thing and stays true either way.
        </p>
      )}
      {state.status === "loading" && <p className="fo-muted">Reading the policy store…</p>}
      {state.status === "failed" && (
        <p className="fo-warning">{state.error?.description ?? "The policy store could not be read."}</p>
      )}
      {state.status === "ready" && children}
    </section>
  );
}

/** A refusal, shown where the administrator was working rather than as a toast that scrolls away. */
function Refusal({ result }) {
  if (!result || result.ok) return null;
  return <p className="fo-warning" role="alert">{result.description ?? result.message}</p>;
}

// ════════════════════ OBJECTS ════════════════════

/**
 * The tenant's stored Objects and Fields, and the one thing an administrator may add: a custom
 * Field.
 *
 * SYSTEM FIELDS CANNOT BE RE-KEYED OR RETYPED, and that is not enforced by disabling an input — the
 * API has no operation that expresses it. A key is identity, and a type is what every stored value
 * already is; changing either is a data migration wearing an edit's clothes.
 */
export function ObjectsPolicyPanel() {
  const objects = usePolicyStore("listObjects");
  const [openKey, setOpenKey] = useState(null);

  return (
    <PolicyPanel
      title="Stored objects"
      state={objects}
      note="What this tenant actually has, read from the EOS policy store rather than from the code."
    >
      <p className="fo-muted">{(objects.data ?? []).length} objects · tenant {objects.tenantId}</p>
      <div className="fo-pill-row">
        {(objects.data ?? []).map((object) => (
          <Button
            key={object.id}
            variant={object.key === openKey ? "primary" : "secondary"}
            onClick={() => setOpenKey(object.key === openKey ? null : object.key)}
            aria-pressed={object.key === openKey}
          >
            {object.label}
          </Button>
        ))}
      </div>
      {openKey && <ObjectFields objectKey={openKey} onChanged={objects.reload} />}
    </PolicyPanel>
  );
}

function ObjectFields({ objectKey, onChanged }) {
  const view = usePolicyStore("readObjectWithFields", { objectKey });
  const [draft, setDraft] = useState({ key: "", label: "", dataType: "STRING" });
  const [result, setResult] = useState(null);

  if (view.status !== "ready") {
    return <p className="fo-muted">{view.status === "failed" ? view.error?.description : "Reading fields…"}</p>;
  }

  const submit = async (event) => {
    event.preventDefault();
    const outcome = await view.mutate("createCustomField", {
      objectKey,
      key: draft.key,
      label: draft.label,
      dataType: draft.dataType,
    });
    setResult(outcome);
    // CLEARED ONLY ON SUCCESS. Clearing on a refusal would throw away what the administrator typed
    // at exactly the moment they need to correct it.
    if (outcome.ok) {
      setDraft({ key: "", label: "", dataType: "STRING" });
      onChanged?.();
    }
  };

  return (
    <div className="fo-panel--nested">
      <h4>{view.data.object.label} <span className="fo-muted">· {view.data.fields.length} fields</span></h4>
      <table className="fo-table">
        <thead>
          <tr><th>Field</th><th>Key</th><th>Type</th><th>Origin</th></tr>
        </thead>
        <tbody>
          {view.data.fields.map((field) => (
            <tr key={field.id}>
              <td>{field.label}</td>
              <td><code>{field.key}</code></td>
              <td className="fo-muted">{field.dataType}</td>
              <td className="fo-muted">
                {field.origin}
                {field.origin === "SYSTEM" && <span className="fo-muted"> · key and type are fixed</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form onSubmit={submit} aria-label="Create a custom field">
        <h4>Add a custom field</h4>
        <label>
          Key
          <input
            value={draft.key}
            onChange={(e) => setDraft({ ...draft, key: e.target.value })}
            placeholder="loyaltyTier"
            required
          />
        </label>
        <label>
          Label
          <input
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="Loyalty Tier"
            required
          />
        </label>
        <label>
          Type
          <select value={draft.dataType} onChange={(e) => setDraft({ ...draft, dataType: e.target.value })}>
            {["STRING", "NUMBER", "BOOLEAN", "DATE", "ENUM", "REFERENCE"].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="primary">Create field</Button>
      </form>
      <Refusal result={result} />
      {result?.ok && <p className="fo-muted">Created. The table above was re-read from the store.</p>}
    </div>
  );
}

// ════════════════════ ROLES & PERMISSIONS ════════════════════

/**
 * The stored CRED matrix for one Role, and the cells an administrator may change.
 *
 * FIVE CELL STATES, and they are five different facts:
 *
 *   granted / denied            the Role's own Object CRED
 *   inherited                   a Field with no override of its own
 *   overridden                  a Field that states its own answer
 *   unavailable / ungoverned    no capability governs the verb, so nothing can be granted
 *
 * The doorway invariant is the server's, not this screen's: a Field grant never opens an Object the
 * Role cannot read, and the server refuses the combination rather than this hiding the checkbox.
 */
export function RolesPolicyPanel() {
  const roles = usePolicyStore("listRoles");
  const [roleId, setRoleId] = useState(null);

  return (
    <PolicyPanel
      title="Stored role policy"
      state={roles}
      note="The tenant's configured CRED. Changing a cell writes to PostgreSQL and re-reads it."
    >
      <div className="fo-pill-row">
        {(roles.data ?? []).map((role) => (
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
      {roleId && <RoleCredGrid roleId={roleId} />}
    </PolicyPanel>
  );
}

function RoleCredGrid({ roleId }) {
  const policy = usePolicyStore("readRolePolicy", { roleId });
  const objects = usePolicyStore("listObjects");
  const [result, setResult] = useState(null);

  if (policy.status !== "ready" || objects.status !== "ready") {
    return <p className="fo-muted">Reading the stored policy…</p>;
  }

  const credByObjectId = new Map(policy.data.objectPermissions.map((p) => [p.objectId, p.cred]));

  const toggle = async (object, verb, current) => {
    const cred = { C: false, R: false, E: false, D: false, ...(credByObjectId.get(object.id) ?? {}) };
    const outcome = await policy.mutate("setObjectPermission", {
      roleId,
      objectKey: object.key,
      cred: { ...cred, [verb]: !current },
    });
    setResult(outcome);
  };

  return (
    <div className="fo-panel--nested">
      <h4>{policy.data.role.name} <span className="fo-muted">· <code>{policy.data.role.key}</code></span></h4>
      <Refusal result={result} />
      <table className="fo-table">
        <thead>
          <tr>
            <th>Object</th>
            {VERBS.map((v) => <th key={v}>{VERB_LABEL[v]}</th>)}
          </tr>
        </thead>
        <tbody>
          {objects.data.map((object) => {
            const cred = credByObjectId.get(object.id) ?? null;
            return (
              <tr key={object.id}>
                <td>{object.label}</td>
                {VERBS.map((verb) => {
                  // Delete on an object that supports none is UNAVAILABLE, not merely unchecked --
                  // no capability governs it, so it can be granted to nobody. A checkbox here would
                  // be an affordance for a grant the engine could never honour.
                  const unavailable = verb === "D" && !object.supportsDelete;
                  const granted = cred?.[verb] === true;
                  return (
                    <td key={verb}>
                      {unavailable ? (
                        <span className="fo-muted" title="No capability governs this verb">—</span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={granted}
                          onChange={() => toggle(object, verb, granted)}
                          aria-label={`${VERB_LABEL[verb]} on ${object.label}`}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="fo-muted">
        {policy.data.fieldOverrides.length} field override
        {policy.data.fieldOverrides.length === 1 ? "" : "s"} stored. A field with no override
        INHERITS its object&rsquo;s answer — removing an override leaves no row, rather than storing
        a false.
      </p>
    </div>
  );
}

// ════════════════════ USERS ════════════════════

/**
 * A principal's stored Role assignments.
 *
 * ADDITIVE, and there is NO PRIMARY ROLE. Somebody may hold three Roles at once and their authority
 * is the union; removal is by the EXACT assignment, because the same Role may legitimately be held
 * twice at two scopes and revoking "their salesperson role" would silently remove both.
 */
export function UsersPolicyPanel({ principalId: fixedPrincipalId = null }) {
  const principals = usePolicyStore("listTenantPrincipals");
  const [chosen, setChosen] = useState(null);
  const principalId = fixedPrincipalId ?? chosen;

  // The picker is part of the panel rather than the screen, because the identity a policy
  // assignment is about is the EOS PRINCIPAL -- not the employee record the Users directory lists.
  // They are different things, and a screen that conflated them would assign Roles to the wrong one.
  const picker = principals.status === "ready" ? (
    <div className="fo-pill-row" role="group" aria-label="Select a principal">
      {(principals.data ?? []).map((principal) => (
        <Button
          key={principal.id}
          variant={principal.id === principalId ? "primary" : "secondary"}
          onClick={() => setChosen(principal.id === chosen ? null : principal.id)}
          aria-pressed={principal.id === principalId}
        >
          {principal.displayName || principal.externalSubject}
          {principal.status === "active" ? "" : " · disabled"}
        </Button>
      ))}
    </div>
  ) : null;

  return <UsersPolicyPanelBody principalId={principalId} picker={picker} principals={principals} />;
}

function UsersPolicyPanelBody({ principalId, picker, principals }) {
  const assignments = usePolicyStore("listPrincipalRoleAssignments", principalId ? { principalId } : null, {
    enabled: Boolean(principalId),
  });
  const roles = usePolicyStore("listRoles");
  const [roleId, setRoleId] = useState("");
  const [result, setResult] = useState(null);

  if (!principalId) {
    return (
      <PolicyPanel title="Stored role assignments" state={principals}>
        <p className="fo-muted">
          Choose a principal to see the Roles the policy store holds for them. A PRINCIPAL is the
          identity EOS authorizes; it is not the same record as the employee directory above.
        </p>
        {picker}
      </PolicyPanel>
    );
  }

  const add = async (event) => {
    event.preventDefault();
    const outcome = await assignments.mutate("assignRole", { principalId, roleId });
    setResult(outcome);
    if (outcome.ok) setRoleId("");
  };

  const remove = async (assignmentId) => {
    setResult(await assignments.mutate("revokeRole", { assignmentId }));
  };

  return (
    <PolicyPanel
      title="Stored role assignments"
      state={assignments}
      note="Assignments are additive — there is no primary Role — and removal names one exact assignment."
    >
      {picker}
      <p className="fo-muted">Access version {assignments.data?.accessVersion ?? 0}</p>
      <Refusal result={result} />
      <table className="fo-table">
        <thead><tr><th>Role</th><th>Scope</th><th>Status</th><th /></tr></thead>
        <tbody>
          {(assignments.data?.assignments ?? []).map((a) => (
            <tr key={a.id}>
              <td>{a.roleKey ?? a.roleId}</td>
              <td className="fo-muted">{a.scopeType}{a.scopeValue ? ` · ${a.scopeValue}` : ""}</td>
              <td className="fo-muted">{a.status}</td>
              <td>
                {a.status === "active" && (
                  <Button variant="secondary" onClick={() => remove(a.id)}>
                    Remove
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form onSubmit={add} aria-label="Add a role">
        <label>
          Add role
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)} required>
            <option value="">Choose a role…</option>
            {(roles.data ?? []).map((role) => (
              <option key={role.id} value={role.id}>{role.name}</option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="primary" disabled={!roleId}>Add role</Button>
      </form>
    </PolicyPanel>
  );
}

// ════════════════════ WORKFLOWS ════════════════════

/**
 * The tenant's stored workflow definitions.
 *
 * DRAFTS STAY DRAFTS. Editing one here changes a definition; it does not reroute any business
 * execution, and publishing does not either — routing records through these definitions is a later,
 * separately authorized step. The screen says so rather than letting an administrator infer it.
 */
export function WorkflowsPolicyPanel() {
  const workflows = usePolicyStore("listWorkflows");
  const [versionId, setVersionId] = useState(null);

  return (
    <PolicyPanel
      title="Stored workflow definitions"
      state={workflows}
      note="Versions stored for this tenant. Editing a draft changes the definition and reroutes nothing."
    >
      <table className="fo-table">
        <thead><tr><th>Workflow</th><th>Governs</th><th>Versions</th></tr></thead>
        <tbody>
          {(workflows.data ?? []).map(({ workflow, versions }) => (
            <tr key={workflow.id}>
              <td>{workflow.name}</td>
              <td className="fo-muted"><code>{workflow.objectKey}</code></td>
              <td>
                <div className="fo-pill-row">
                  {versions.map((version) => (
                    <Button
                      key={version.id}
                      variant={version.id === versionId ? "primary" : "secondary"}
                      onClick={() => setVersionId(version.id === versionId ? null : version.id)}
                      aria-pressed={version.id === versionId}
                    >
                      v{version.version} · {version.status}
                    </Button>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {versionId && <WorkflowVersionDetail versionId={versionId} />}
    </PolicyPanel>
  );
}

function WorkflowVersionDetail({ versionId }) {
  const view = usePolicyStore("readWorkflowVersion", { versionId });
  if (view.status !== "ready") return <p className="fo-muted">Reading the version…</p>;

  const { version, steps, actions } = view.data;
  return (
    <div className="fo-panel--nested">
      <h4>
        {view.data.workflow.name} v{version.version}{" "}
        <span className="fo-muted">· {version.status}</span>
      </h4>
      {version.status === "PUBLISHED" && (
        <p className="fo-muted">
          Published versions are immutable. Changing this workflow means creating a new version.
        </p>
      )}
      <p className="fo-muted">{steps.length} states · {actions.length} actions</p>
      <table className="fo-table">
        <thead><tr><th>Action</th><th>From</th><th>To</th><th>Who may perform it</th></tr></thead>
        <tbody>
          {actions.map((action) => (
            <tr key={action.key}>
              <td>{action.label}</td>
              <td className="fo-muted">{action.from}</td>
              <td className="fo-muted">{action.to}</td>
              <td className="fo-muted">
                {action.roleKeys.length > 0 ? action.roleKeys.join(", ") : "no Role bound"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fo-muted">
        A Role bound to an action may perform it. That is WORKFLOW authority and it grants no access
        to the record&rsquo;s data — and no CRED grant anywhere buys the action.
      </p>
    </div>
  );
}
