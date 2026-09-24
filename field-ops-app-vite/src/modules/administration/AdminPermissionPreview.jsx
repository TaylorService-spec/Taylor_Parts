import { useMemo, useState } from "react";
import { usePolicyStore } from "./usePolicyStore.js";
import { Button } from "../../shared/ui/primitives/index.js";

/**
 * Administration > Permission Preview
 *
 * READ-ONLY projection of the governed PostgreSQL authority.
 *
 * The route is already capability-gated by administration.permissionPreview /
 * admin.principalAccess.read. This component does not derive access from role
 * strings, Firebase claims, Firestore documents or frontend catalogs. It asks
 * the trusted Administration API for the tenant's Principals and then for the
 * selected Principal's canonical effective-access projection.
 *
 * Work Eligibility, Operational Scope and record relationships are deliberately
 * not shown here because the server deliberately excludes them from
 * getPrincipalEffectiveAccess. They are subordinate business constraints, not
 * Security Role grants.
 */

function principalLabel(principal) {
  const name = typeof principal?.displayName === "string" ? principal.displayName.trim() : "";
  if (name) return name;
  const id = typeof principal?.id === "string" ? principal.id : "";
  return id ? `Principal ${id.slice(0, 8)}` : "Principal";
}

function statusCopy(state, loadingText) {
  if (state.status === "loading") return loadingText;
  if (state.status === "failed") return state.error?.description ?? "The governed access read failed.";
  if (state.status === "unconfigured") return "The EOS Administration service is not configured in this environment.";
  return null;
}

export default function AdminPermissionPreview() {
  const principals = usePolicyStore("listTenantPrincipals");
  const [principalId, setPrincipalId] = useState(null);
  const access = usePolicyStore(
    "getPrincipalEffectiveAccess",
    principalId ? { principalId } : null,
    { enabled: Boolean(principalId) },
  );

  const selected = useMemo(
    () => (principals.data ?? []).find((p) => p.id === principalId) ?? null,
    [principals.data, principalId],
  );

  const principalState = statusCopy(principals, "Reading Principals…");
  const accessState = principalId ? statusCopy(access, "Reading effective access…") : null;

  return (
    <div className="fo-panel">
      <h2>Permission Preview</h2>
      <p className="fo-muted">
        Read-only effective access from the governed EOS policy store. Select a Principal to see
        the Security Roles and Object actions PostgreSQL says that identity currently holds.
      </p>
      <p className="fo-muted">
        This is a security-grant view only. Work Eligibility, Operational Scope, ownership,
        assignment and record-level preconditions are evaluated separately by their domain authorities.
      </p>

      {principalState ? (
        <p className={principals.status === "failed" ? "fo-warning" : "fo-muted"} role="status">
          {principalState}
        </p>
      ) : (
        <section className="fo-panel--nested" aria-label="Choose a Principal">
          <h3>Principal</h3>
          {(principals.data ?? []).length === 0 ? (
            <p className="fo-muted">This tenant has no Principals to preview.</p>
          ) : (
            <div className="fo-pill-row" role="group" aria-label="Select a Principal">
              {(principals.data ?? []).map((principal) => (
                <Button
                  key={principal.id}
                  variant={principal.id === principalId ? "primary" : "secondary"}
                  onClick={() => setPrincipalId(principal.id === principalId ? null : principal.id)}
                  aria-pressed={principal.id === principalId}
                >
                  {principalLabel(principal)}
                  {principal.status === "active" ? "" : " · disabled"}
                </Button>
              ))}
            </div>
          )}
        </section>
      )}

      {selected && (
        <section className="fo-panel--nested" aria-label="Selected Principal">
          <h3>{principalLabel(selected)}</h3>
          <p className="fo-muted">
            EOS Principal <code>{selected.id}</code> · {selected.status}
          </p>
        </section>
      )}

      {principalId && accessState && (
        <p className={access.status === "failed" ? "fo-warning" : "fo-muted"} role="status">
          {accessState}
        </p>
      )}

      {principalId && access.status === "ready" && (
        <>
          <section className="fo-panel--nested" aria-label="Effective access summary">
            <h3>Effective access</h3>
            <p>
              <strong>{access.data?.effective?.length ?? 0}</strong> capabilities from{" "}
              <strong>{access.data?.roles?.length ?? 0}</strong> active Security Role
              {(access.data?.roles?.length ?? 0) === 1 ? "" : "s"}.
            </p>
            <p className="fo-muted">
              Security Roles: {(access.data?.roles ?? []).length > 0
                ? access.data.roles.join(", ")
                : "none"}
            </p>
            <p className="fo-muted">
              Direct grants: {(access.data?.effective ?? []).filter((row) =>
                row.source === "DIRECT" || row.source === "ROLE_AND_DIRECT").length}
            </p>
          </section>

          <section className="fo-panel--nested" aria-label="Effective capability detail">
            <h3>Object actions</h3>
            {(access.data?.effective ?? []).length === 0 ? (
              <p className="fo-muted">This Principal currently holds no effective capability.</p>
            ) : (
              <table className="fo-table">
                <thead>
                  <tr>
                    <th>Object</th>
                    <th>Action</th>
                    <th>Capability</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {access.data.effective.map((row) => (
                    <tr key={row.capabilityKey}>
                      <td>{row.objectKey}</td>
                      <td>{row.displayLabel || row.actionKey}</td>
                      <td className="fo-muted"><code>{row.capabilityKey}</code></td>
                      <td className="fo-muted">{row.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export { principalLabel };
