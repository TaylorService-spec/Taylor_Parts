import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatTimestamp } from "../../domain/displayTimestamp";
import { loadDeploymentManifest, classifyVersionStatus } from "../../domain/deploymentVersionInfo";
import { PageHeader, SectionHeader, InfoTip } from "../../shared/ui/primitives";

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
//
// Compact UX Standard (docs/design/compact-ux-standard.md): each surface is one
// row -- its name, a one-line `summary`, and the full `description` in an
// InfoTip -- instead of a stack of paragraphs. The descriptions are unchanged;
// they moved from the page body into the tip.
const MVP_SURFACES = [
  {
    key: "users",
    path: "users",
    title: "Users",
    summary: "Employee profiles, roles and access",
    description:
      "Manage employee profiles, Job Roles, Work Eligibility, Operational Scope, Security Roles, EOS access and account status. Each employee's Roles & Access tab shows their Effective Access, why they hold it, and a read-only View As.",
  },
  {
    key: "rolesPermissions",
    path: "roles-permissions",
    title: "Roles & Permissions",
    summary: "Security Roles, holders and decision history",
    description:
      "Review each Security Role: its holders, the Object actions it holds and its decision history. Configure what a Role may do in Objects; assign Security Roles to people on their Employee record under Users.",
  },
  {
    key: "objects",
    path: "objects",
    title: "Objects",
    summary: "What each Security Role may do to each object",
    description: "What each Security Role may do to each business object: whole-object authority, domain actions and governed field groups.",
  },
  {
    key: "workflows",
    path: "workflows",
    title: "Workflows",
    summary: "Business processes, stages and who may act",
    description: "Business processes, their versions and stages, and which Security Roles may act at each step.",
  },
  {
    key: "dataImport",
    path: "data-import",
    title: "Data Import",
    summary: "Load, review and import a data set",
    description: "Load an existing data set into EOS, review what was accepted or refused, and import it.",
  },
  {
    key: "auditLogs",
    path: "audit-logs",
    title: "Audit Logs",
    summary: "Where to find access-change history",
    description:
      "Where to find the governed audit of access changes: each Employee's Access Audit History and each Security Role's Decision History.",
  },
];

export default function AdministrationOverview({ fetchImpl = typeof fetch === "function" ? fetch : undefined }) {
  return (
    <div className="fo-panel">
      <PageHeader
        title="Administration Overview"
        description="Access, roles, workflows, data and audit."
        help="Enterprise Access & Administration surfaces. Read-only content and trusted-command-backed actions roll out across these surfaces in later phases -- see each surface for its current status."
      />
      <ul className="fo-compact-list" aria-label="Administration areas">
        {MVP_SURFACES.map((surface) => (
          <li key={surface.key} className="fo-compact-list__row">
            <Link className="fo-compact-list__name" to={`/administration/${surface.path}`}>{surface.title}</Link>
            <span className="fo-compact-list__summary">{surface.summary}</span>
            <InfoTip label={`About ${surface.title}`}>{surface.description}</InfoTip>
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
//
// Compact UX Standard: the facts are a label/value list rather than sentences.
// Every state line (checking, unavailable, behind, up to date, unknown) still
// renders in the page -- the "behind" warning is never moved into a tip.
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
    <section className="fo-admin-version" data-testid="version-deployment-info">
      <SectionHeader
        level={3}
        title={
          <>
            Version{" "}
            <InfoTip label="About version information">
              This client&apos;s loaded build compared with what the server most recently deployed.
            </InfoTip>
          </>
        }
      />

      <dl className="fo-facts">
        <dt>Loaded build</dt>
        <dd><code>{RUNNING_COMMIT}</code></dd>
        {manifestState.ok && manifest && (
          <>
            <dt>Deployed build</dt>
            <dd><code>{manifest.commit}</code></dd>
            <dt>Deployed</dt>
            <dd>{formatTimestamp(manifest.buildTime)}</dd>
            <dt>Environment</dt>
            <dd>
              {manifest.environmentId ?? "Unknown"} ({manifest.environmentRole ?? "unknown role"})
            </dd>
          </>
        )}
      </dl>

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
