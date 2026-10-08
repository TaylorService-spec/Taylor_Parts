import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatTimestamp } from "../../domain/displayTimestamp";
import { loadDeploymentManifest, classifyVersionStatus } from "../../domain/deploymentVersionInfo";

// The running bundle's build id -- injected at build time by vite.config.js's
// `define` (see src/globals.d.ts). "unknown" is the documented fallback when
// git was unavailable at build time; it is displayed as-is, never masked.
const RUNNING_COMMIT = typeof __APP_COMMIT__ === "string" ? __APP_COMMIT__ : "unknown";

// Issue #226 Row 10 -- Admin Portal foundation. The Overview screen is the
// Administration domain's new landing/hub: a real, built screen (not
// PlaceholderPage) that orients an admin/dispatcher toward the MVP surfaces
// Spec sec16 names, without itself reading or mutating any governed access
// data -- that content lands per-surface in Row 11 (read-only) and Row 12
// (mutation UI, gated inert until Issue #15's Functions are deployed and
// verified). No client-direct permission administration happens here or
// anywhere in this portal (Spec sec16).
const MVP_SURFACES = [
  {
    key: "users",
    path: "users",
    title: "Users",
    description:
      "Manage employee profiles, Job Roles, Work Eligibility, Operational Scope, Security Roles, EOS access and account status. Each employee's Roles & Access tab shows their Effective Access, why they hold it, and a read-only View As.",
  },
  {
    key: "rolesPermissions",
    path: "roles-permissions",
    title: "Roles & Permissions",
    description:
      "Review each Security Role: its holders, the Object actions it holds and its decision history. Configure what a Role may do in Objects; assign Security Roles to people on their Employee record under Users.",
  },
  {
    key: "objects",
    path: "objects",
    title: "Objects",
    description: "What each Security Role may do to each business object: whole-object authority, domain actions and governed field groups.",
  },
  {
    key: "workflows",
    path: "workflows",
    title: "Workflows",
    description: "Business processes, their versions and stages, and which Security Roles may act at each step.",
  },
  {
    key: "dataImport",
    path: "data-import",
    title: "Data Import",
    description: "Load an existing data set into EOS, review what was accepted or refused, and import it.",
  },
  {
    key: "auditLogs",
    path: "audit-logs",
    title: "Audit Logs",
    description:
      "Where to find the governed audit of access changes: each Employee's Access Audit History and each Security Role's Decision history.",
  },
];

export default function AdministrationOverview({ fetchImpl = typeof fetch === "function" ? fetch : undefined }) {
  return (
    <div className="fo-panel">
      <h2>Administration Overview</h2>
      <p className="fo-muted">
        Enterprise Access &amp; Administration surfaces. Read-only content and trusted-command-backed actions
        roll out across these surfaces in later phases -- see each surface for its current status.
      </p>
      <ul>
        {MVP_SURFACES.map((surface) => (
          <li key={surface.key}>
            <Link to={`/administration/${surface.path}`}>{surface.title}</Link>
            <p className="fo-muted">{surface.description}</p>
          </li>
        ))}
      </ul>

      <VersionDeploymentInfo fetchImpl={fetchImpl} />
    </div>
  );
}

// C3/D1/D2 -- "what is this client, and what did the server last publish?"
// The running commit comes from the baked-in `__APP_COMMIT__` global (no
// network call). The deployed manifest is one unauthenticated GET at mount
// against `/version.json` (see vite.config.js emitVersionManifest); its
// absence or failure never breaks this screen -- it renders the honest
// "unavailable" state instead (fail-closed, matching the rest of this portal).
function VersionDeploymentInfo({ fetchImpl }) {
  const [manifestState, setManifestState] = useState({ loading: true, ok: false, manifest: null });

  useEffect(() => {
    let alive = true;
    if (!fetchImpl) {
      setManifestState({ loading: false, ok: false, manifest: null });
      return undefined;
    }
    loadDeploymentManifest(fetchImpl).then((result) => {
      if (!alive) return;
      setManifestState({ loading: false, ok: result.ok, manifest: result.ok ? result.manifest : null });
    });
    return () => {
      alive = false;
    };
  }, [fetchImpl]);

  const manifest = manifestState.manifest;
  const status = manifest ? classifyVersionStatus(RUNNING_COMMIT, manifest.commit) : "unknown";

  return (
    <section className="fo-panel" data-testid="version-deployment-info">
      <h3>Version / deployment info</h3>
      <p className="fo-muted">This client&apos;s loaded build compared with what the server most recently deployed.</p>

      <p>
        Loaded build: <code>{RUNNING_COMMIT}</code>
      </p>

      {manifestState.loading && (
        <p className="fo-muted" role="status">
          Checking deployed version…
        </p>
      )}

      {!manifestState.loading && !manifestState.ok && (
        <p className="fo-muted" role="status" data-testid="version-manifest-unavailable">
          Deployment manifest unavailable.
        </p>
      )}

      {!manifestState.loading && manifestState.ok && manifest && (
        <>
          <p>
            Deployed build: <code>{manifest.commit}</code>
          </p>
          <p className="fo-muted">
            Deployed: {formatTimestamp(manifest.buildTime)} — Environment: {manifest.environmentId ?? "Unknown"} (
            {manifest.environmentRole ?? "unknown role"})
          </p>

          {status === "behind" && (
            <p className="fo-warning" role="alert" data-testid="version-status-behind">
              Your loaded app is behind the deployed version — refresh to get the latest.
            </p>
          )}
          {status === "match" && (
            <p className="fo-muted" data-testid="version-status-match">
              Up to date with the deployed version.
            </p>
          )}
          {status === "unknown" && (
            <p className="fo-muted" role="status" data-testid="version-status-unknown">
              Could not determine whether this client is up to date.
            </p>
          )}
        </>
      )}
    </section>
  );
}
