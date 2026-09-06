import { useCallback, useEffect, useMemo, useState } from "react";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ContextBand from "../../shared/ui/ContextBand.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import HonestState, { HONEST_STATE } from "../../shared/ui/HonestState.jsx";
import { Button } from "../../shared/ui/primitives";
import { useAuth } from "../../auth/AuthContext";
import { useGovernedCapabilities } from "../../access/useGovernedCapabilities.js";
import {
  DEFAULT_EMAIL_INTAKE_SOURCE,
  EMAIL_INTAKE_CAPABILITY_REQUEST,
  ADMIN_EMAIL_INTAKE_READ,
  ADMIN_EMAIL_INTAKE_MANAGE,
  SOURCE_STATUS,
} from "../../access/inboundWorkSource.js";

// ADMINISTRATION -> EMAIL & COMMUNICATIONS. One destination in the Administration rail, with the
// information architecture as tabs inside it: Overview, Connections, Mailboxes, Routing Rules, Processing,
// Processing History, Exceptions.
//
// SEVEN TABS, NOT SEVEN RAIL ITEMS, deliberately. Administration already carries fifteen destinations; the
// seven parts of one configuration subject belong together under the subject, and a reader looking for
// "where does email get set up" should find one answer rather than seven neighbours. The rail item is the
// subject; the tabs are its sections.
//
// NO NEW VISUAL SYSTEM. Shell, context band, status pills, honest states, buttons and the existing table
// and form classes -- every one of them already in use elsewhere in Administration.
//
// NOTHING ON THIS SCREEN IS AUTHORITY. Controls render from the trusted effective-access feed; each write
// is re-authorized server-side against administration.emailIntake.manage.

const TABS = [
  ["overview", "Overview"],
  ["connections", "Connections"],
  ["mailboxes", "Mailboxes"],
  ["routing", "Routing Rules"],
  ["processing", "Processing"],
  ["history", "Processing History"],
  ["exceptions", "Exceptions"],
];

const HEALTH_TONE = { HEALTHY: "positive", DEGRADED: "attention", FAILED: "attention", UNKNOWN: "unknown" };
const OAUTH_TONE = { CONNECTED: "positive", PENDING_AUTHORIZATION: "info", NOT_CONNECTED: "unknown", EXPIRED: "attention", REVOKED: "attention" };

const EXCEPTION_STATUSES = ["FAILED", "QUARANTINED", "DUPLICATE"];
const HISTORY_STATUSES = ["ACCEPTED", "DECLINED", "ATTACHED"];

const emptyConnection = {
  connectionName: "",
  provider: "MICROSOFT_365",
  tenantOrWorkspace: "",
  connectedAccount: "",
  inboundEnabled: true,
  outboundEnabled: false,
  credentialSecretName: "",
};

const emptyMailbox = {
  connectionId: "",
  displayName: "",
  emailAddress: "",
  purpose: "SERVICE",
  destination: "SERVICE",
  defaultQueue: "",
  operatingCompanyId: "",
  processingMode: "REVIEW_REQUIRED",
  attachmentPolicy: "PRESERVE_METADATA",
  threadingEnabled: true,
  inboundEnabled: true,
};

function Field({ label, children }) {
  return (
    <label className="fo-inbound-field">
      <span className="fo-wizard-field-label">{label}</span>
      {children}
    </label>
  );
}

function ConnectionsTab({ config, canManage, onSave }) {
  const [draft, setDraft] = useState(emptyConnection);
  const [error, setError] = useState(null);
  const set = (key) => (e) => setDraft({ ...draft, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  return (
    <>
      <table className="fo-sales-pipeline">
        <thead>
          <tr>
            <th>Connection</th>
            <th>Provider</th>
            <th>Account</th>
            <th>Authorization</th>
            <th>Health</th>
          </tr>
        </thead>
        <tbody>
          {config.connections.length === 0 ? (
            <tr>
              <td colSpan={5}>No connections configured.</td>
            </tr>
          ) : (
            config.connections.map((c) => (
              <tr key={c.id}>
                <td data-label="Connection">{c.connectionName}</td>
                <td data-label="Provider">{c.provider}</td>
                <td data-label="Account">{c.connectedAccount}</td>
                <td data-label="Authorization">
                  <StatusPill tone={OAUTH_TONE[c.oauthStatus] ?? "unknown"} label={c.oauthStatus} asText />
                </td>
                <td data-label="Health">
                  <StatusPill tone={HEALTH_TONE[c.health] ?? "unknown"} label={c.health} asText />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* EOS STORES NO MAILBOX PASSWORD AND NO OAUTH TOKEN. This form collects the provider's identity
          and the NAME of an externally-managed secret; the backend refuses any field that looks like
          credential material, so the rule cannot be softened by adding an input here. */}
      <h4 className="fo-inbound-pane__subtitle">Add a connection</h4>
      <p className="fo-muted">
        EOS never stores a mailbox password or an OAuth token. Authorization is completed with the provider and
        the resulting credential is held as an externally-managed secret, named here.
      </p>
      {error && <p className="fo-inline-error" role="alert">{error}</p>}
      <div className="fo-inbound-form">
        <Field label="Connection name">
          <input className="fo-wizard-control" value={draft.connectionName} onChange={set("connectionName")} />
        </Field>
        <Field label="Provider">
          <select className="fo-wizard-control" value={draft.provider} onChange={set("provider")}>
            <option value="MICROSOFT_365">Microsoft 365 / Outlook</option>
            <option value="GOOGLE_WORKSPACE">Google Workspace / Gmail</option>
          </select>
        </Field>
        <Field label={draft.provider === "MICROSOFT_365" ? "Tenant id" : "Workspace domain"}>
          <input className="fo-wizard-control" value={draft.tenantOrWorkspace} onChange={set("tenantOrWorkspace")} />
        </Field>
        <Field label="Connected account">
          <input className="fo-wizard-control" value={draft.connectedAccount} onChange={set("connectedAccount")} />
        </Field>
        <Field label="Credential secret name (optional)">
          <input className="fo-wizard-control" value={draft.credentialSecretName} onChange={set("credentialSecretName")} />
        </Field>
        <Button
          variant="primary"
          disabled={!canManage}
          onClick={async () => {
            setError(null);
            const result = await onSave({ config: draft });
            if (!result.ok) setError(result.message);
            else setDraft(emptyConnection);
          }}
        >
          Save connection
        </Button>
      </div>
    </>
  );
}

function MailboxesTab({ config, canManage, onSave }) {
  const [draft, setDraft] = useState(emptyMailbox);
  const [error, setError] = useState(null);
  const set = (key) => (e) => setDraft({ ...draft, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  return (
    <>
      <p className="fo-muted">
        A mailbox is operational configuration and is separate from the connection: one Microsoft or Google
        connection commonly exposes several mailboxes — Service, Warranty, Parts.
      </p>
      <table className="fo-sales-pipeline">
        <thead>
          <tr>
            <th>Mailbox</th>
            <th>Address</th>
            <th>Purpose</th>
            <th>Queue</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {config.mailboxes.length === 0 ? (
            <tr>
              <td colSpan={5}>No mailboxes configured.</td>
            </tr>
          ) : (
            config.mailboxes.map((m) => (
              <tr key={m.id}>
                <td data-label="Mailbox">{m.displayName}</td>
                <td data-label="Address">{m.emailAddress}</td>
                <td data-label="Purpose">{m.purpose}</td>
                <td data-label="Queue">{m.defaultQueue ?? "—"}</td>
                <td data-label="Status">
                  <StatusPill tone={m.status === "ACTIVE" ? "positive" : "unknown"} label={m.status} asText />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <h4 className="fo-inbound-pane__subtitle">Add a mailbox</h4>
      {error && <p className="fo-inline-error" role="alert">{error}</p>}
      <div className="fo-inbound-form">
        <Field label="Connection">
          <select className="fo-wizard-control" value={draft.connectionId} onChange={set("connectionId")}>
            <option value="">Select a connection…</option>
            {config.connections.map((c) => (
              <option key={c.id} value={c.id}>{c.connectionName}</option>
            ))}
          </select>
        </Field>
        <Field label="Display name">
          <input className="fo-wizard-control" value={draft.displayName} onChange={set("displayName")} />
        </Field>
        <Field label="Email address">
          <input className="fo-wizard-control" value={draft.emailAddress} onChange={set("emailAddress")} />
        </Field>
        <Field label="Purpose">
          <select className="fo-wizard-control" value={draft.purpose} onChange={set("purpose")}>
            {["SERVICE", "WARRANTY", "PARTS", "OTHER"].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </Field>
        <Field label="Default queue (optional)">
          <input className="fo-wizard-control" value={draft.defaultQueue} onChange={set("defaultQueue")} />
        </Field>
        <Field label="Operating company (optional)">
          <input className="fo-wizard-control" value={draft.operatingCompanyId} onChange={set("operatingCompanyId")} />
        </Field>
        <Button
          variant="primary"
          disabled={!canManage}
          onClick={async () => {
            setError(null);
            const result = await onSave({ config: draft });
            if (!result.ok) setError(result.message);
            else setDraft(emptyMailbox);
          }}
        >
          Save mailbox
        </Button>
      </div>
    </>
  );
}

function RoutingTab({ config }) {
  return (
    <>
      <p className="fo-muted">
        Rules are evaluated in order and the first match wins. A message no rule matches is still taken in —
        classified as Service and flagged for review, never silently classified as something it might not be.
      </p>
      <table className="fo-sales-pipeline">
        <thead>
          <tr>
            <th>Order</th>
            <th>Rule</th>
            <th>When</th>
            <th>Then</th>
            <th>Enabled</th>
          </tr>
        </thead>
        <tbody>
          {config.rules.length === 0 ? (
            <tr>
              <td colSpan={5}>No routing rules configured.</td>
            </tr>
          ) : (
            [...config.rules]
              .sort((a, b) => a.order - b.order)
              .map((r) => (
                <tr key={r.id}>
                  <td data-label="Order">{r.order}</td>
                  <td data-label="Rule">{r.name}</td>
                  <td data-label="When">{JSON.stringify(r.when)}</td>
                  <td data-label="Then">{JSON.stringify(r.then)}</td>
                  <td data-label="Enabled">{r.enabled ? "Yes" : "No"}</td>
                </tr>
              ))
          )}
        </tbody>
      </table>
    </>
  );
}

function ProcessingTab() {
  return (
    <>
      <h4 className="fo-inbound-pane__subtitle">Processing provider</h4>
      <p>
        <StatusPill tone="positive" label="EOS Native — in use" asText />
      </p>
      <p className="fo-muted">
        Base EOS reads an inbound message itself: it extracts the warranty or authorization number, external
        reference, model, serial and problem description, and suggests a customer, location and unit from EOS
        records. No add-on is required, and none is installed here.
      </p>
      <p className="fo-muted">
        VDX (Verenward&apos;s ETL / integration product) and customer-selected integration platforms are optional
        enhancements. Where one is licensed and configured it supplies the same provider-neutral processing
        result EOS Native produces, and the Inbound Work queue, the review screen and Work Order creation behave
        identically. Selecting a different provider is an entitlement-gated configuration step and is not
        available in this build.
      </p>
      <p className="fo-muted">
        Data governance is likewise optional. Accepting a job never edits mastered Customer, Location, Contact or
        Equipment data on the strength of an inbound email; a master-data change is proposed through whichever
        governance product the business uses.
      </p>
    </>
  );
}

function RequestsTable({ rows, empty }) {
  if (rows.length === 0) return <p className="fo-muted">{empty}</p>;
  return (
    <table className="fo-sales-pipeline">
      <thead>
        <tr>
          <th>Status</th>
          <th>Count</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([status, count]) => (
          <tr key={status}>
            <td data-label="Status">{status}</td>
            <td data-label="Count">{count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AdminEmailCommunications({
  source = DEFAULT_EMAIL_INTAKE_SOURCE,
  capabilityRequest = EMAIL_INTAKE_CAPABILITY_REQUEST,
} = {}) {
  const { user } = useAuth();
  const { hasCapability, accessVersion } = useGovernedCapabilities(user, capabilityRequest);
  const canRead = hasCapability(ADMIN_EMAIL_INTAKE_READ);
  const canManage = hasCapability(ADMIN_EMAIL_INTAKE_MANAGE);
  const [tab, setTab] = useState("overview");
  const [state, setState] = useState({ status: "loading", config: null });
  const [reloadToken, setReloadToken] = useState(0);

  const load = useCallback(async () => {
    const result = await source.getConfiguration();
    setState(result.status === SOURCE_STATUS.READY ? { status: "ready", config: result.payload } : { status: result.status, config: null });
  }, [source]);

  useEffect(() => {
    if (!canRead) {
      setState({ status: SOURCE_STATUS.DENIED, config: null });
      return;
    }
    setState({ status: "loading", config: null });
    load();
  }, [canRead, accessVersion, load, reloadToken]);

  const config = state.config;
  const contextItems = useMemo(() => {
    if (!config) return [];
    const byStatus = config.overview.byStatus ?? {};
    const count = (...statuses) => statuses.reduce((sum, s) => sum + (byStatus[s] ?? 0), 0);
    return [
      { key: "connections", label: "Connections", value: config.connections.length },
      { key: "mailboxes", label: "Mailboxes", value: config.mailboxes.length },
      { key: "inbound", label: "Inbound requests", value: config.overview.total },
      { key: "accepted", label: "Accepted", value: count("ACCEPTED") },
      { key: "review", label: "Needs review", value: count("NEEDS_REVIEW") },
      { key: "exceptions", label: "Exceptions", value: count(...EXCEPTION_STATUSES) },
    ];
  }, [config]);

  const save = (fn) => async (payload) => {
    const result = await fn(payload);
    if (result.ok) setReloadToken((t) => t + 1);
    return result;
  };

  const statusRows = (statuses) =>
    statuses.map((s) => [s, config?.overview.byStatus?.[s] ?? 0]).filter(([, count]) => count > 0);

  return (
    <WorkspaceShell
      title="Email & Communications"
      density="compact"
      context={config ? <ContextBand items={contextItems} /> : null}
    >
      <div className="fo-filter-bar" role="tablist" aria-label="Email and communications sections">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`fo-filter-btn ${tab === key ? "is-active" : ""}`.trim()}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {state.status === "loading" && <HonestState state={HONEST_STATE.LOADING} subject="email configuration" />}
      {state.status === SOURCE_STATUS.DENIED && <HonestState state={HONEST_STATE.DENIED} subject="Email & Communications" />}
      {state.status === SOURCE_STATUS.UNAVAILABLE && (
        <HonestState state={HONEST_STATE.UNAVAILABLE} subject="Email configuration" onRetry={() => setReloadToken((t) => t + 1)} />
      )}

      {state.status === "ready" && config && (
        <div className="fo-inbound-admin">
          {tab === "overview" && (
            <>
              <p className="fo-muted">
                Every number here is counted from the intake records in this environment. Nothing on this page is
                seeded, sampled or estimated — an environment with no inbound mail shows zeroes.
              </p>
              <RequestsTable
                rows={Object.entries(config.overview.byStatus ?? {})}
                empty="No inbound requests have been taken in yet."
              />
            </>
          )}
          {tab === "connections" && <ConnectionsTab config={config} canManage={canManage} onSave={save(source.saveConnection)} />}
          {tab === "mailboxes" && <MailboxesTab config={config} canManage={canManage} onSave={save(source.saveMailbox)} />}
          {tab === "routing" && <RoutingTab config={config} />}
          {tab === "processing" && <ProcessingTab />}
          {tab === "history" && (
            <RequestsTable rows={statusRows(HISTORY_STATUSES)} empty="No decisions have been recorded yet." />
          )}
          {tab === "exceptions" && (
            <>
              <p className="fo-muted">
                Nothing is ever discarded. A message that failed processing, arrived in a mailbox EOS does not know,
                or was delivered twice is retained with the reason.
              </p>
              <RequestsTable rows={statusRows(EXCEPTION_STATUSES)} empty="No exceptions." />
            </>
          )}
          {!canManage && tab !== "overview" && (
            <p className="fo-muted">Changing email configuration is not part of your role.</p>
          )}
        </div>
      )}
    </WorkspaceShell>
  );
}
