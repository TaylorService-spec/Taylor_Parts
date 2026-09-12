import { findAdministrationProfile } from "../../metadata/administration/administrationProfileRegistry.js";
import { ADMIN_EDIT_SCOPE, MUTABILITY } from "../../metadata/administration/objectAdministrationProfile.js";

// ADMINISTRATION > OBJECTS -- an object's ADMINISTRATION PROFILE, rendered.
//
// ════════════════════ WHAT THIS ADDS TO THE SCREEN ════════════════════
//
// The expanded object row already answers "which capability backs each verb". It could not answer
// the questions an administrator actually asks next, because nothing on the client held them:
//
//     what IS this object's id, and what must never be used as one?
//     which fields can change after the record exists, and through what?
//     who owns it, and which operating company?
//     what else in the system still claims to be this object?
//     how far has its migration got?
//
// Those answers now exist as validated data (metadata/administration/), so the screen states them.
//
// ════════════════════ READ-ONLY, AND SAYING WHY ════════════════════
//
// Nothing here writes. The profile's own `adminEditing` scope is rendered as the LAST section with
// its stated reason, so "you cannot edit Part records here" arrives as a governed decision a reader
// can evaluate rather than as an absence of buttons. Part is PRESENTATION_ONLY: the object's label
// and description are editable through the existing stored-configuration surface above
// (updateObjectMetadata), and its RECORDS are not editable from Administration at all.
//
// ════════════════════ AN OBJECT WITHOUT A PROFILE ════════════════════
//
// Renders an explicit "not traced yet", never an empty panel. A blank section would make "nobody
// has established this object's authority" look identical to "this object has no rules" -- the same
// two-states-drawn-as-one failure the CRED grid's dash exists to prevent.

const MUTABILITY_LABEL = {
  [MUTABILITY.SET_AT_CREATE]: "Fixed at creation",
  [MUTABILITY.MUTABLE]: "Editable",
  [MUTABILITY.SYSTEM_MANAGED]: "Server-stamped",
  [MUTABILITY.NOT_STORED]: "Not stored here",
};

const EDIT_SCOPE_LABEL = {
  [ADMIN_EDIT_SCOPE.NONE]: "Nothing on this object is editable from Administration.",
  [ADMIN_EDIT_SCOPE.PRESENTATION_ONLY]:
    "Only this object's presentation — its label, plural and description — is editable here. Never its records.",
  [ADMIN_EDIT_SCOPE.GOVERNED_COMMAND]: "Record data, through the governed commands named below and nothing else.",
};

/** `path#symbol`, rendered as the code reference it is. Never a link: the file may not be servable. */
function Citation({ of }) {
  if (!of) return null;
  return (
    <span className="fo-muted">
      {" "}
      <code>{of.path}#{of.symbol}</code>
    </span>
  );
}

export default function ObjectAdministrationPanel({ entityId }) {
  const profile = entityId ? findAdministrationProfile(entityId) : null;

  if (!profile) {
    return (
      <section className="fo-panel--nested" aria-label="Object administration">
        <h4>Administration profile</h4>
        <p className="fo-muted">
          Not traced yet. This object has no administration profile, so its identity rule, field
          mutability, ownership and migration status are not stated anywhere the platform can read —
          which is different from having none.
        </p>
      </section>
    );
  }

  const { identityRule, ownership, readModel, fieldPolicies, commands, representations, migration, adminEditing } =
    profile;
  const commandsByField = new Map();
  for (const command of commands) {
    for (const fieldId of command.mutates) {
      commandsByField.set(fieldId, [...(commandsByField.get(fieldId) ?? []), command.label]);
    }
  }

  return (
    <section className="fo-panel--nested" aria-label="Object administration">
      <h4>Administration profile</h4>
      {profile.description && <p className="fo-muted">{profile.description}</p>}

      <h5>Identity</h5>
      <p>
        The id is <code>{identityRule.idField}</code>
        {identityRule.documentIdIsIdentity && " — and it IS the stored document id, refused at read if they disagree"}.
        Canonical form is decided in one place:
        <Citation of={identityRule.canonicalValidator} />
      </p>
      {identityRule.description && <p className="fo-muted">{identityRule.description}</p>}
      <p className="fo-muted">Never substituted for it:</p>
      <ul className="fo-role-caps">
        {identityRule.neverSubstituted.map((what) => (
          <li key={what}>{what}</li>
        ))}
      </ul>

      <h5>Ownership and operating company</h5>
      <p>
        <strong>{ownership.ownerClass}</strong> · {ownership.companyScope} ·{" "}
        {ownership.companyField ? (
          <>owning company on <code>{ownership.companyField}</code></>
        ) : (
          <span className="fo-muted">no owning company field</span>
        )}
        <Citation of={ownership.authority} />
      </p>
      {ownership.description && <p className="fo-muted">{ownership.description}</p>}
      {ownership.prohibitedInference.length > 0 && (
        <>
          <p className="fo-muted">Never inferred from:</p>
          <ul className="fo-role-caps">
            {ownership.prohibitedInference.map((what) => (
              <li key={what}>{what}</li>
            ))}
          </ul>
        </>
      )}

      <h5>How it is read</h5>
      <p>
        {readModel.path}
        {readModel.collection ? <> · <code>{readModel.collection}</code></> : null} · gated by{" "}
        {readModel.gateIsCapability ? <code>{readModel.gate}</code> : readModel.gate}
        {/* A role gate and a capability gate are different mechanisms, and an administrator reading
            a capability id that does not exist would go looking for it in the catalog. */}
        {!readModel.gateIsCapability && (
          <span className="fo-muted"> (a role gate, not a capability — no capability governs this read)</span>
        )}
      </p>
      {readModel.description && <p className="fo-muted">{readModel.description}</p>}

      <h5>Fields ({fieldPolicies.length})</h5>
      <div className="fo-table-scroll">
        <table className="fo-table">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">After creation</th>
              <th scope="col">Changed by</th>
              <th scope="col">Rule</th>
            </tr>
          </thead>
          <tbody>
            {fieldPolicies.map((policy) => (
              <tr key={policy.fieldId}>
                <td>
                  <code>{policy.fieldId}</code>
                  {policy.requiredAtCreate && <span className="fo-muted"> · required</span>}
                </td>
                <td>{MUTABILITY_LABEL[policy.mutability] ?? policy.mutability}</td>
                <td className="fo-muted">
                  {commandsByField.get(policy.fieldId)?.join(", ") ?? (policy.heldBy ? policy.heldBy : "—")}
                </td>
                <td className="fo-muted">
                  {policy.reason}
                  <Citation of={policy.enforcedBy} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h5>Governed commands ({commands.length})</h5>
      <ul className="fo-role-caps">
        {commands.map((command) => (
          <li key={command.id}>
            <strong>{command.label}</strong> <span className="fo-muted">({command.phase})</span> — requires{" "}
            <code>{command.capability}</code>, audits <code>{command.auditAction}</code>
            {command.versionChecked ? ", version-checked" : ""}
            {command.idempotent ? ", idempotent" : ""}
            <Citation of={command.implementation} />
            {command.description && <div className="fo-muted">{command.description}</div>}
          </li>
        ))}
      </ul>

      {representations.length > 0 && (
        <>
          <h5>Representations ({representations.length})</h5>
          <ul className="fo-role-caps">
            {representations.map((rep) => (
              <li key={rep.id}>
                <strong>{rep.label}</strong> <span className="fo-muted">· {rep.disposition}</span>
                <Citation of={rep.location} />
                {rep.description && <div className="fo-muted">{rep.description}</div>}
                {rep.blockedBy && <div className="fo-muted">Blocked by: {rep.blockedBy}</div>}
              </li>
            ))}
          </ul>
        </>
      )}

      <h5>Migration</h5>
      <p>
        <strong>{migration.readiness}</strong>
        {migration.targetAuthority ? <> — target: {migration.targetAuthority}</> : null}
        <Citation of={migration.evaluator} />
      </p>
      {migration.description && <p className="fo-muted">{migration.description}</p>}
      {migration.blockedBy.length > 0 && (
        <ul className="fo-role-caps">
          {migration.blockedBy.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      )}

      <h5>What you can change here</h5>
      <p className="fo-warning">{EDIT_SCOPE_LABEL[adminEditing.scope] ?? adminEditing.scope}</p>
      <p className="fo-muted">{adminEditing.reason}</p>
    </section>
  );
}
