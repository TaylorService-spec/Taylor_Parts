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

const RESULT_TAG = Object.freeze({
  ALLOWED: "fo-cp-tag fo-cp-tag--allowed",
  CONDITIONAL: "fo-cp-tag fo-cp-tag--conditional",
  SCOPED: "fo-cp-tag fo-cp-tag--conditional",
  DENIED: "fo-cp-tag fo-cp-tag--denied",
});

const list = (items) => (items.length > 0 ? items.join(", ") : "none");

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
          {model.employee ? <span className="fo-muted">{` · ${model.employee.operatingCompanyId ?? "—"} · ${model.employee.employmentStatus ?? "—"}`}</span> : null}</li>
        <li><span className="fo-access-chain__k">Job Role</span> {model.jobRole?.label ?? "none"} <span className="fo-muted">— the job performed; grants nothing</span></li>
        <li><span className="fo-access-chain__k">Security Roles</span> {list(model.securityRoleKeys)}
          {model.scopedAssignments.length > 0 ? <span className="fo-muted">{` · scoped: ${model.scopedAssignments.map((a) => `${a.roleKey} @ ${a.scope}`).join(", ")}`}</span> : null}</li>
        <li><span className="fo-access-chain__k">Effective capabilities</span> {model.capabilities.length} unconditional
          {model.conditionallyHeld.length ? `, ${model.conditionallyHeld.length} conditional` : ""}{model.scopedHeld.length ? `, ${model.scopedHeld.length} scope-qualified` : ""}</li>
        <li><span className="fo-access-chain__k">Operational scope</span> {list(model.operationalScopes.map((s) => `${s.scopeType} ${s.scopeId}`))}
          {model.workEligibility.length ? <span className="fo-muted">{` · eligibility: ${model.workEligibility.join(", ")}`}</span> : null}</li>
        <li><span className="fo-access-chain__k">Record relationships</span> {(() => {
          const conditioned = model.actions.filter((a) => a.result === "CONDITIONAL");
          return conditioned.length === 0 ? "none restrict" : `${conditioned.length} action(s) restricted, e.g. ${conditioned.slice(0, 3).map((a) => `${a.capabilityKey} (${a.reasonCode})`).join(", ")}`;
        })()}</li>
        <li><span className="fo-access-chain__k">Domain preconditions</span> <span className="fo-muted">decided per record by each command (state, scope, operating company) — never granted here</span></li>
      </ol>
      <dl className="fo-detail-list" data-effective-access-context>
        <dt>Security Roles that grant</dt><dd>{list(model.securityRoleKeys)}</dd>
        <dt>Access version</dt><dd>{model.accessVersion ?? "—"}</dd>
        <dt>Work Eligibility</dt><dd>{list(model.workEligibility)}</dd>
        <dt>Operational Scope</dt><dd>{list(model.operationalScopes.map((s) => `${s.scopeType} ${s.scopeId}`))}</dd>
        <dt>Capabilities</dt><dd>{model.capabilities.length}</dd>
        <dt>Surfaces</dt><dd>{list(model.surfaces)}</dd>
      </dl>

      {model.scopedAssignments.length > 0 ? (
        <table className="fo-table" aria-label="Scoped assignments">
          <thead><tr><th>Scoped assignment</th><th>Scope</th><th>Grants within the scope</th><th>Not granted at this scope</th></tr></thead>
          <tbody>
            {model.scopedAssignments.map((a) => (
              <tr key={a.assignmentId ?? `${a.roleKey}-${a.scope}`} data-scoped-assignment={a.roleKey}>
                <td>Security Role <code>{a.roleKey}</code></td>
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
          <thead><tr><th>Excluded assignment</th><th>Reason</th><th>Scope</th></tr></thead>
          <tbody>
            {model.excluded.map((e) => (
              <tr key={e.assignmentId ?? `${e.roleKey}-${e.reason}`} data-excluded-assignment={e.roleKey}>
                <td>Security Role <code>{e.roleKey}</code></td>
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
        <table key={group.objectKey} className="fo-table" aria-label={`Effective access on ${group.objectKey}`}>
          <thead>
            <tr><th>{group.objectKey}</th><th>Result</th><th>Source</th><th>Direct exception</th><th>Surfaces / workflow</th></tr>
          </thead>
          <tbody>
            {group.items.map((row) => (
              <tr key={row.capabilityKey} data-capability={row.capabilityKey} data-result={row.result ?? "NONE"}>
                <td>
                  {row.actionKey ?? row.capabilityKey}{" "}
                  <span className="fo-muted"><code>{row.capabilityKey}</code>{row.actionKind ? ` · ${row.actionKind}` : ""}</span>
                </td>
                <td>
                  <span className={RESULT_TAG[row.result] ?? "fo-cp-tag"}>{row.resultWords}</span>{" "}
                  <span className="fo-muted"><code>{row.reasonCode ?? "—"}</code></span>
                  {row.withheldFromFlatSetKernels ? <div className="fo-muted">Withheld from flat-set kernels (Commercial, CRM): held only through a conditioned grant.</div> : null}
                </td>
                <td>
                  {row.sourceRoles.length === 0 && row.scopedSources.length === 0 ? <span className="fo-muted">No Security Role</span> : null}
                  {row.sourceRoles.map((r) => (
                    <div key={r.roleKey}>
                      {`Security Role ${r.roleKey}`}
                      {r.condition ? <span className="fo-muted">{` · Condition: ${r.condition}`}</span> : null}
                      <span className="fo-muted">{" · Scope: all (global)"}</span>
                    </div>
                  ))}
                  {row.scopedSources.map((r) => (
                    <div key={`${r.roleKey}-${r.scope}`} data-scoped-source={r.scope}>
                      {`Security Role ${r.roleKey}`}
                      {r.condition ? <span className="fo-muted">{` · Condition: ${r.condition}`}</span> : null}
                      {` · Scope: ${r.scope}`}
                      <span className="fo-muted">{` · Inside the scope: ${r.resultWords} (${r.reasonCode ?? "—"})`}</span>
                    </div>
                  ))}
                </td>
                <td>
                  {row.directGrant ? (
                    <div data-direct-grant={row.directGrant.label}>
                      <span className="fo-cp-tag fo-cp-tag--direct">DIRECT EXCEPTION</span>
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
                    <div key={i}>{`Workflow ${w.workflowKey} v${w.version} · ${w.actionKey} via ${w.roleKey}`}</div>
                  )) : null}
                  {row.surfaces.length === 0 && !row.workflowSource?.length ? "—" : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}
