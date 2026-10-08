// EMPLOYEE > EFFECTIVE ACCESS -- the SERVER EVALUATOR's answer, rendered, never re-derived.
//
// Contract: docs/architecture/administration-control-plane-2026-09-26.md section 8, explainEffectiveAccess
// { principalId } -> { securityRoleKeys, accessVersion, assignments.excluded, workEligibility,
// operationalScopes, capabilities, surfaces, actions: [{ objectKey, actionKey, capabilityKey, result,
// reasonCode, sourceRoles, directGrant, withheldFromFlatSetKernels, surfaces, workflowSource }] }.
//
// ONE EVALUATOR. The server resolves the Principal with the runtime's own rules, decides every Object
// action with authorizeOperationalAction over the same PostgreSQL condition provider, and reports why.
// This panel draws the result, reason code, source Security Roles with their conditions, a DIRECT
// EXCEPTION (labelled, with its reason, expiry, condition and whether the server says it is enforced), the
// flat-set withholding, surfaces and workflow source -- and computes none of them. An unknown result
// is shown raw. Excluded assignments (STALE / INACTIVE / SCOPE_UNSUPPORTED) are listed with their reason.
// Lane SC: a SUPPORTED scoped assignment is not an exclusion -- it is listed with what it grants within its scope,
// and each action shows its scope-qualified sources (Security Role, scope, condition, the evaluator's result for a
// record inside that scope).
//
// A missing operation (UNKNOWN_OPERATION) renders UNAVAILABLE; it never falls back to the older
// getPrincipalEffectiveAccess preview, which is not the runtime evaluator (pass-7 G.1).
import { useMemo, useState } from "react";
import { adminControlPlaneClient, refusalText } from "../../services/adminControlPlaneClient.js";
import { useControlPlaneRead } from "./useControlPlaneRead.js";
import { explanationModel, groupByObject } from "./controlPlaneModel.js";
import { identifierLabel, operatingCompanyLabel, statusLabel, titleCase } from "../../shared/display/displayLabels.js";

const RESULT_TAG = Object.freeze({
  ALLOWED: "fo-cp-tag fo-cp-tag--allowed",
  CONDITIONAL: "fo-cp-tag fo-cp-tag--conditional",
  SCOPED: "fo-cp-tag fo-cp-tag--conditional",
  DENIED: "fo-cp-tag fo-cp-tag--denied",
});

const list = (items) => (items.length > 0 ? items.join(", ") : "None");
// Display words for identifiers (UI corrections item A). The raw key stays visible in <code> where it is evidence.
const roleWords = (key) => identifierLabel(key);
const scopeWords = (s) => `${titleCase(s.scopeType)} ${s.label ?? s.scopeId}`;
const PROVENANCE_TAG = Object.freeze({
  ROLE: "fo-cp-tag",
  DIRECT: "fo-cp-tag fo-cp-tag--direct",
  ROLE_AND_DIRECT: "fo-cp-tag fo-cp-tag--direct",
  NONE: "fo-cp-tag",
});

export default function EmployeeEffectiveAccess({ api = adminControlPlaneClient, principalId }) {
  const read = useControlPlaneRead(principalId ? () => api.explainEffectiveAccess(principalId) : null, `explain:${principalId}`);
  const model = useMemo(() => (read.status === "ready" ? explanationModel(read.data) : null), [read.status, read.data]);
  const [filter, setFilter] = useState("");

  if (!principalId) {
    return <p className="fo-muted" data-effective-access="NO_PRINCIPAL">No governed Principal is linked to this Employee, so there is no access to explain.</p>;
  }
  if (read.status === "loading" || read.status === "idle") return <p className="fo-muted" data-effective-access="LOADING">Asking the server evaluator…</p>;
  if (read.status === "unavailable") {
    return (
      <div data-effective-access="UNAVAILABLE">
        <p className="fo-warning">
          Effective Access is unavailable: this EOS API does not serve the runtime evaluator&rsquo;s
          explanation (explainEffectiveAccess). Nothing is shown rather than an answer computed
          anywhere else.
        </p>
        <p className="fo-muted">{refusalText(read.error)}</p>
      </div>
    );
  }
  if (read.status === "failed") {
    return <p className="fo-warning" role="alert" data-effective-access="FAILED">{refusalText(read.error)}</p>;
  }
  if (!model) {
    return <p className="fo-warning" role="alert" data-effective-access="UNREADABLE">The server returned an Effective Access payload this screen cannot read, so nothing is shown.</p>;
  }

  const restricted = model.actions.filter((a) => a.result === "CONDITIONAL");
  const held = model.actions.filter((a) => a.provenance && a.provenance !== "NONE");
  const provenanceCount = (p) => held.filter((a) => a.provenance === p).length;
  const provenanceUnreported = model.actions.length > 0 && model.actions.every((a) => a.provenance === null);
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? model.actions.filter((r) => `${r.capabilityKey} ${r.objectKey ?? ""} ${r.actionKey ?? ""}`.toLowerCase().includes(needle))
    : model.actions;

  return (
    <div data-effective-access="READY" data-effective-access-rows={model.actions.length}>
      <p className="fo-muted">
        The server evaluator&rsquo;s answer for this Employee&rsquo;s Principal: per Object action, the
        result and its reason, the Security Roles (or direct exception) it comes through, and any condition.
      </p>
      {/* THE RESOLVED CHAIN (#210): Principal -> Employee -> Job Role -> Security Roles -> Capabilities -> Scope -> Record
          relationships -> Domain preconditions. Every link is the SERVER's explanation; the Job Role is shown and labelled as
          granting nothing, so the chain cannot be read as "the job gives the access". */}
      <ol className="fo-access-chain" aria-label="Resolved access chain" data-access-chain>
        <li><span className="fo-access-chain__k">Principal</span> <code>{model.principalId ?? "—"}</code></li>
        <li><span className="fo-access-chain__k">Employee</span> {model.employee?.displayName ?? model.employeeId ?? "not linked"}
          {model.employee ? <span className="fo-muted">{` · ${operatingCompanyLabel(model.employee.operatingCompanyId) || "—"} · ${statusLabel(model.employee.employmentStatus) || "—"}`}</span> : null}</li>
        <li><span className="fo-access-chain__k">Job Role</span> {model.jobRole?.label ?? "None"} <span className="fo-muted">— the job performed; grants nothing</span></li>
        <li><span className="fo-access-chain__k">Security Roles</span> {list(model.securityRoleKeys.map(roleWords))}
          {model.scopedAssignments.length > 0 ? <span className="fo-muted">{` · scoped: ${model.scopedAssignments.map((a) => `${roleWords(a.roleKey)} @ ${a.scope}`).join(", ")}`}</span> : null}</li>
        <li><span className="fo-access-chain__k">Effective capabilities</span> {model.capabilities.length} unconditional
          {model.conditionallyHeld.length ? `, ${model.conditionallyHeld.length} conditional` : ""}{model.scopedHeld.length ? `, ${model.scopedHeld.length} scope-qualified` : ""}</li>
        <li><span className="fo-access-chain__k">Operational Scope</span> {list(model.operationalScopes.map(scopeWords))}
          {model.workEligibility.length ? <span className="fo-muted">{` · eligibility: ${model.workEligibility.join(", ")}`}</span> : null}</li>
        <li><span className="fo-access-chain__k">Record Restrictions</span> {restricted.length === 0 ? "None restrict" : `${restricted.length} action${restricted.length === 1 ? "" : "s"} restricted to particular records — listed below`}</li>
        <li><span className="fo-access-chain__k">Domain Preconditions</span> <span className="fo-muted">decided per record by each command (state, scope, operating company) — never granted here</span></li>
      </ol>
      {/* One context line, not a second list of what the chain above already states (deduplicated, item D). */}
      <p className="fo-muted" data-effective-access-context>
        {`Access version ${model.accessVersion ?? "—"} · ${model.capabilities.length} capabilities · Work Eligibility: ${list(model.workEligibility.map(titleCase))} · Surfaces: ${model.surfaces.length}`}
      </p>
      <div className="fo-cp-provenance" data-provenance-summary>
        <p className="fo-cp-facts__title">Capability Provenance</p>
        <p className="fo-muted">How each held capability reaches this person, as the server evaluator reports it.</p>
        <dl className="fo-detail-list">
          <dt>Through Security Roles</dt><dd data-provenance-count="ROLE">{provenanceCount("ROLE")}</dd>
          <dt>Through a Direct Exception</dt><dd data-provenance-count="DIRECT">{provenanceCount("DIRECT")}</dd>
          <dt>Through Both</dt><dd data-provenance-count="ROLE_AND_DIRECT">{provenanceCount("ROLE_AND_DIRECT")}</dd>
        </dl>
        {provenanceUnreported ? <p className="fo-muted">This server does not report provenance; the Source column below shows each Security Role and direct exception.</p> : null}
      </div>
      {restricted.length > 0 ? (
        <div className="fo-table-scroll">
          <table className="fo-table" aria-label="Record restrictions" data-record-restrictions={restricted.length}>
            <caption className="fo-cp-facts__title">Record Restrictions</caption>
            <thead><tr><th>Object Action</th><th>Restriction</th><th>Source</th></tr></thead>
            <tbody>
              {restricted.map((a) => (
                <tr key={a.capabilityKey} data-restricted-capability={a.capabilityKey}>
                  <td>{`${titleCase(a.objectKey)} · ${titleCase(a.actionKey ?? a.capabilityKey)}`} <span className="fo-muted"><code>{a.capabilityKey}</code></span></td>
                  <td>{a.reasonCode === "RECORD_ASSIGNMENT_REQUIRED" ? "Only records this person is assigned to or owns" : titleCase(a.reasonCode)}
                    {a.sourceRoles.filter((r) => r.condition).map((r) => <div key={r.roleKey} className="fo-muted">{`Condition: ${r.condition}`}</div>)}</td>
                  <td>{a.provenanceWords ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {model.scopedAssignments.length > 0 ? (
        <table className="fo-table" aria-label="Scoped assignments">
          <thead><tr><th>Scoped Assignment</th><th>Scope</th><th>Grants Within the Scope</th><th>Not Granted at This Scope</th></tr></thead>
          <tbody>
            {model.scopedAssignments.map((a) => (
              <tr key={a.assignmentId ?? `${a.roleKey}-${a.scope}`} data-scoped-assignment={a.roleKey}>
                <td>{roleWords(a.roleKey)} <span className="fo-muted"><code>{a.roleKey}</code></span></td>
                <td>{a.scope}</td>
                <td>{list(a.capabilities)}</td>
                <td className="fo-muted">{list(a.inertCapabilities)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <div className="fo-cp-facts" data-employee-facts={model.functionalRoles.length}>
        <p className="fo-cp-facts__title">Employee facts — not a permission source</p>
        <p className="fo-muted">
          Business facts about the linked Employee. No capability, surface or action above comes from them;
          a Functional Role can only narrow a workflow action a Security Role already authorizes.
        </p>
        <dl className="fo-detail-list">
          <dt>Functional Roles</dt>
          <dd>{model.functionalRoles.length === 0 ? "none" : model.functionalRoles.map((f) => (
            <span key={f.functionalRoleId ?? f.key} className="fo-cp-tag" data-functional-role-fact={f.key}>{f.name ? `${f.name} (${f.key})` : f.key}</span>
          ))}</dd>
        </dl>
      </div>

      {model.excluded.length > 0 ? (
        <table className="fo-table" aria-label="Excluded assignments">
          <thead><tr><th>Excluded Assignment</th><th>Reason</th><th>Scope</th></tr></thead>
          <tbody>
            {model.excluded.map((e) => (
              <tr key={e.assignmentId ?? `${e.roleKey}-${e.reason}`} data-excluded-assignment={e.roleKey}>
                <td>{roleWords(e.roleKey)} <span className="fo-muted"><code>{e.roleKey}</code></span></td>
                <td><code>{e.reason}</code> <span className="fo-muted">{e.reasonWords}</span></td>
                <td className="fo-muted">{e.scope ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <label className="fo-form-field">
        <span>Filter</span>
        <input type="search" aria-label="Filter effective access" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </label>
      {model.actions.length === 0 ? <p className="fo-muted">The evaluator reports no Object action.</p> : null}
      {groupByObject(shown).map((group) => (
        // #210: the shared scroll container -- a long capability key or source list must not widen the page (1024px).
        <div key={group.objectKey} className="fo-table-scroll">
        <table className="fo-table" aria-label={`Effective access on ${titleCase(group.objectKey)}`} data-object={group.objectKey}>
          <thead>
            <tr><th>{titleCase(group.objectKey)}</th><th>Result</th><th>Provenance</th><th>Source</th><th>Direct Exception</th><th>Surfaces / Workflow</th></tr>
          </thead>
          <tbody>
            {group.items.map((row) => (
              <tr key={row.capabilityKey} data-capability={row.capabilityKey} data-result={row.result ?? "NONE"}>
                <td>
                  {titleCase(row.actionKey ?? row.capabilityKey)}{" "}
                  <span className="fo-muted"><code>{row.capabilityKey}</code>{row.actionKind ? ` · ${titleCase(row.actionKind)}` : ""}</span>
                </td>
                <td>
                  <span className={RESULT_TAG[row.result] ?? "fo-cp-tag"}>{row.resultWords}</span>{" "}
                  <span className="fo-muted"><code>{row.reasonCode ?? "—"}</code></span>
                  {row.withheldFromFlatSetKernels ? <div className="fo-muted">Withheld from flat-set kernels (Commercial, CRM): held only through a conditioned grant.</div> : null}
                </td>
                <td data-provenance={row.provenance ?? "UNREPORTED"}>
                  {row.provenanceWords ? <span className={PROVENANCE_TAG[row.provenance] ?? "fo-cp-tag"}>{row.provenanceWords}</span> : <span className="fo-muted">—</span>}
                </td>
                <td>
                  {row.sourceRoles.length === 0 && row.scopedSources.length === 0 ? <span className="fo-muted">No Security Role</span> : null}
                  {row.sourceRoles.map((r) => (
                    <div key={r.roleKey}>
                      {roleWords(r.roleKey)}
                      {r.condition ? <span className="fo-muted">{` · Condition: ${r.condition}`}</span> : null}
                      <span className="fo-muted">{" · Scope: All (Global)"}</span>
                    </div>
                  ))}
                  {row.scopedSources.map((r) => (
                    <div key={`${r.roleKey}-${r.scope}`} data-scoped-source={r.scope}>
                      {roleWords(r.roleKey)}
                      {r.condition ? <span className="fo-muted">{` · Condition: ${r.condition}`}</span> : null}
                      {` · Scope: ${r.scope}`}
                      <span className="fo-muted">{` · Inside the scope: ${r.resultWords} (${r.reasonCode ?? "—"})`}</span>
                    </div>
                  ))}
                </td>
                <td>
                  {row.directGrant ? (
                    <div data-direct-grant={row.directGrant.label}>
                      <span className="fo-cp-tag fo-cp-tag--direct">Direct Exception</span>
                      <div className="fo-muted">{`Reason: ${row.directGrant.exceptionReason ?? "none recorded"}`}</div>
                      <div className="fo-muted">{`Expires: ${row.directGrant.expiresAt ?? "never"}`}</div>
                      {row.directGrant.condition ? <div className="fo-muted">{`Condition: ${row.directGrant.condition}`}</div> : null}
                      {row.directGrant.enforced ? <div className="fo-muted">Enforced by every runtime gate.</div> : null}
                      {row.directGrant.notEnforced ? <div className="fo-muted">Not enforced on Role-only runtime paths.</div> : null}
                    </div>
                  ) : <span className="fo-muted">—</span>}
                </td>
                <td className="fo-muted">
                  {row.surfaces.length > 0 ? <div>{`Surfaces: ${row.surfaces.join(", ")}`}</div> : null}
                  {row.workflowSource?.length ? row.workflowSource.map((w, i) => (
                    <div key={i}>{`Workflow ${titleCase(w.workflowKey)} v${w.version} · ${titleCase(w.actionKey)} via ${roleWords(w.roleKey)}`}</div>
                  )) : null}
                  {row.surfaces.length === 0 && !row.workflowSource?.length ? "—" : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      ))}
    </div>
  );
}
