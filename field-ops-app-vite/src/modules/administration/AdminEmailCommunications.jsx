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
// "where does email get set up" should find one answer rather than seven neighbours.
//
// THIS SCREEN NOW OPERATES A REAL CONNECTION. Connect sends the administrator to the provider and brings
// them back HERE with an authorization code, which this screen hands to the server to exchange. The
// browser never sees a token: it carries a one-time code and a state value it cannot forge, and every
// credential lives server-side from that point on.
//
// NO NEW VISUAL SYSTEM. Shell, context band, status pills, honest states, buttons and the existing table
// and form classes -- every one of them already in use elsewhere in Administration.

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

/** What each transport failure means for the person reading it, in one sentence they can act on. */
const FAILURE_EXPLANATIONS = {
  AUTH_EXPIRED: "The provider authorization expired. Reauthorize the connection.",
  AUTH_REVOKED: "The provider no longer accepts the stored authorization. Reauthorize the connection.",
  MAILBOX_NOT_FOUND: "The provider has no such mailbox. Check the address on the mailbox.",
  MAILBOX_ACCESS_DENIED: "The connected account cannot read that mailbox. Grant it access, then retry.",
  PROVIDER_RATE_LIMIT: "The provider asked us to slow down. This retries on its own.",
  PROVIDER_UNAVAILABLE: "The provider could not be reached. This retries on its own.",
  MESSAGE_FETCH_FAILED: "A message could not be fetched. This retries on its own.",
  ATTACHMENT_FETCH_FAILED: "An attachment could not be retrieved. The message itself was taken in.",
  CURSOR_EXPIRED: "The delivery resume point aged out; the next poll re-checks recent mail.",
  CONFIGURATION_INVALID: "This connection is not configured for this environment.",
  DELIVERY_RETRY_EXHAUSTED: "Retries are exhausted. Fix the cause, then retry from here.",
};

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

const formatWhen = (millis) => (millis ? new Date(millis).toLocaleString() : "—");

/** The redirect the provider sends the administrator back to: this very screen, on this deployment. */
export function oauthRedirectUri(location = window.location) {
  return `${location.origin}${location.pathname}`;
}

function Field({ label, children }) {
  return (
    <label className="fo-inbound-field">
      <span className="fo-wizard-field-label">{label}</span>
      {children}
    </label>
  );
}

function ConnectionsTab({ config, readiness, canManage, actions, busy, notice }) {
  const [draft, setDraft] = useState(emptyConnection);
  const [error, setError] = useState(null);
  const set = (key) => (e) => setDraft({ ...draft, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const providerReady = (provider) =>
    provider === "MICROSOFT_365" ? readiness?.microsoftConfigured : readiness?.googleConfigured;

  return (
    <>
      {readiness && !readiness.transportAvailable && (
        <p className="fo-inline-error" role="alert">
          Connecting a real mailbox is not available in this environment. {readiness.productionRefusal}
        </p>
      )}
      {notice && <p className="fo-muted" role="status">{notice}</p>}

      <table className="fo-sales-pipeline">
        <thead>
          <tr>
            <th>Connection</th>
            <th>Provider</th>
            <th>Account</th>
            <th>Authorization</th>
            <th>Health</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {config.connections.length === 0 ? (
            <tr>
              <td colSpan={6}>No connections configured.</td>
            </tr>
          ) : (
            config.connections.map((c) => (
              <tr key={c.id}>
                <td data-label="Connection">
                  {c.connectionName}
                  {c.providerErrorCode && (
                    <div className="fo-muted">{FAILURE_EXPLANATIONS[c.providerErrorCode] ?? c.providerErrorCode}</div>
                  )}
                </td>
                <td data-label="Provider">
                  {c.provider}
                  {!providerReady(c.provider) && <div className="fo-muted">No OAuth client configured here</div>}
                </td>
                <td data-label="Account">{c.connectedAccount}</td>
                <td data-label="Authorization">
                  <StatusPill tone={OAUTH_TONE[c.oauthStatus] ?? "unknown"} label={c.oauthStatus} asText />
                  <div className="fo-muted">
                    {c.authorizedAt ? `Authorized ${formatWhen(c.authorizedAt)}` : "Never authorized"}
                  </div>
                </td>
                <td data-label="Health">
                  <StatusPill tone={HEALTH_TONE[c.health] ?? "unknown"} label={c.health} asText />
                  <div className="fo-muted">
                    {c.lastMessageReceived ? `Last message ${formatWhen(c.lastMessageReceived)}` : "No mail received yet"}
                  </div>
                </td>
                <td data-label="Actions">
                  <div className="fo-inbound-row-actions">
                    <Button
                      variant="primary"
                      disabled={!canManage || busy || !providerReady(c.provider) || readiness?.transportAvailable === false}
                      onClick={() => actions.connect(c.id)}
                    >
                      {c.oauthStatus === "CONNECTED" ? "Reauthorize" : "Connect"}
                    </Button>
                    <Button variant="secondary" disabled={!canManage || busy} onClick={() => actions.test(c.id)}>
                      Test connection
                    </Button>
                    {c.oauthStatus === "CONNECTED" && (
                      <Button variant="tertiary" className="fo-link-btn" disabled={!canManage || busy} onClick={() => actions.disconnect(c.id)}>
                        Disconnect
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* EOS STORES NO MAILBOX PASSWORD AND NO OAUTH TOKEN. This form collects the provider's identity
          and, optionally, the NAME of an externally-managed secret; the backend refuses any field that
          looks like credential material, so the rule cannot be softened by adding an input here. */}
      <h4 className="fo-inbound-pane__subtitle">Add a connection</h4>
      <p className="fo-muted">
        EOS never stores a mailbox password or an OAuth token. Authorization happens with the provider, and the
        credential it returns is held in the platform&apos;s secret store — this screen only ever shows whether one
        exists.
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
        <Button
          variant="primary"
          disabled={!canManage}
          onClick={async () => {
            setError(null);
            const result = await actions.saveConnection({ config: draft });
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

function MailboxesTab({ config, canManage, actions, busy, notice }) {
  const [draft, setDraft] = useState(emptyMailbox);
  const [error, setError] = useState(null);
  const set = (key) => (e) => setDraft({ ...draft, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  return (
    <>
      <p className="fo-muted">
        A mailbox is operational configuration and is separate from the connection: one Microsoft or Google
        connection commonly exposes several — Service, Warranty, Parts.
      </p>
      {notice && <p className="fo-muted" role="status">{notice}</p>}
      <table className="fo-sales-pipeline">
        <thead>
          <tr>
            <th>Mailbox</th>
            <th>Address</th>
            <th>Purpose</th>
            <th>Readable</th>
            <th>Delivery</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {config.mailboxes.length === 0 ? (
            <tr>
              <td colSpan={6}>No mailboxes configured.</td>
            </tr>
          ) : (
            config.mailboxes.map((m) => (
              <tr key={m.id}>
                <td data-label="Mailbox">{m.displayName}</td>
                <td data-label="Address">{m.emailAddress}</td>
                <td data-label="Purpose">{m.purpose}</td>
                <td data-label="Readable">
                  <StatusPill tone={m.mailboxReadable ? "positive" : "unknown"} label={m.mailboxReadable ? "Readable" : "Unchecked"} asText />
                  {m.mailboxValidationDetail && <div className="fo-muted">{m.mailboxValidationDetail}</div>}
                </td>
                <td data-label="Delivery">
                  {m.deliveryConnected ? "Watching for new mail" : "Not started"}
                  <div className="fo-muted">
                    {m.lastMessageReceivedAt ? `Last message ${formatWhen(m.lastMessageReceivedAt)}` : `Last checked ${formatWhen(m.lastPolledAt)}`}
                  </div>
                </td>
                <td data-label="Actions">
                  <Button variant="secondary" disabled={!canManage || busy} onClick={() => actions.pollNow(m.id)}>
                    Check now
                  </Button>
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
            const result = await actions.saveMailbox({ config: draft });
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

function ProcessingTab({ readiness }) {
  return (
    <>
      <h4 className="fo-inbound-pane__subtitle">Processing provider</h4>
      <p>
        <StatusPill tone="positive" label="EOS Native — in use" asText />
      </p>
      <p className="fo-muted">
        Base EOS reads an inbound message itself: it extracts the warranty or authorization number, external
        reference, model, serial and problem described, and suggests a customer, location and unit from EOS
        records. No add-on is required, and none is installed here.
      </p>
      <p className="fo-muted">
        VDX (Verenward&apos;s ETL / integration product) and customer-selected integration platforms are optional
        enhancements. Where one is licensed and configured it supplies the same information in the same shape, and
        the queue, the review screen and the Work Order that gets created all behave identically. Selecting a
        different provider is an entitlement-gated configuration step and is not available in this build.
      </p>
      <p className="fo-muted">
        Data governance is likewise optional. Accepting a job never edits mastered Customer, Location, Contact or
        Equipment data on the strength of an inbound email; a master-data change is proposed through whichever
        governance product the business uses.
      </p>

      <h4 className="fo-inbound-pane__subtitle">Delivery</h4>
      <p className="fo-muted">
        Connected mailboxes are checked for new mail every five minutes, and attachments are retrieved and held by
        EOS as each message arrives. Nothing is sent, marked, moved or deleted in the provider&apos;s mailbox.
      </p>
      {readiness && (
        <p className="fo-muted">
          This environment: Microsoft 365 client {readiness.microsoftConfigured ? "configured" : "not configured"} ·
          Google Workspace client {readiness.googleConfigured ? "configured" : "not configured"} ·
          provider transport {readiness.transportAvailable ? "available" : "not available here"}.
        </p>
      )}
    </>
  );
}

function ExceptionsTab({ config, canManage, actions, busy }) {
  const failures = config.exceptions ?? [];
  return (
    <>
      <p className="fo-muted">
        Nothing is ever discarded. A message that failed processing, arrived in a mailbox EOS does not know, or was
        delivered twice is retained with the reason — and a provider failure is recorded here with what to do about
        it.
      </p>

      <h4 className="fo-inbound-pane__subtitle">Delivery failures</h4>
      {failures.length === 0 ? (
        <p className="fo-muted">No delivery failures.</p>
      ) : (
        <table className="fo-sales-pipeline">
          <thead>
            <tr>
              <th>What failed</th>
              <th>Mailbox</th>
              <th>Attempts</th>
              <th>Last failure</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {failures.map((f) => (
              <tr key={f.id}>
                <td data-label="What failed">
                  <StatusPill tone={f.exhausted ? "attention" : "info"} label={f.code} asText />
                  <div className="fo-muted">{FAILURE_EXPLANATIONS[f.code] ?? f.detail}</div>
                </td>
                <td data-label="Mailbox">{f.mailboxId}</td>
                <td data-label="Attempts">{f.attempts}</td>
                <td data-label="Last failure">{formatWhen(f.lastFailedAt)}</td>
                <td data-label="Actions">
                  <Button variant="secondary" disabled={!canManage || busy} onClick={() => actions.retry(f.id)}>
                    Retry now
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4 className="fo-inbound-pane__subtitle">Retained messages</h4>
      <RequestsTable
        rows={EXCEPTION_STATUSES.map((s) => [s, config.overview.byStatus?.[s] ?? 0]).filter(([, count]) => count > 0)}
        empty="No quarantined, failed or duplicate messages."
      />
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
  const [readiness, setReadiness] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    const result = await source.getConfiguration();
    setState(result.status === SOURCE_STATUS.READY ? { status: "ready", config: result.payload } : { status: result.status, config: null });
    const ready = await source.getProviderReadiness();
    setReadiness(ready.status === SOURCE_STATUS.READY ? ready.payload : null);
  }, [source]);

  useEffect(() => {
    if (!canRead) {
      setState({ status: SOURCE_STATUS.DENIED, config: null });
      return;
    }
    setState({ status: "loading", config: null });
    load();
  }, [canRead, accessVersion, load, reloadToken]);

  // THE RETURN LEG OF THE OAUTH FLOW. The provider sends the administrator back to this screen with a
  // one-time code and the state EOS issued; both go straight to the server, which validates the state,
  // exchanges the code and takes custody of the credential. The query string is then cleared from the
  // address bar so a refresh, a bookmark or a shared URL cannot replay a code that is already spent.
  useEffect(() => {
    if (!canManage || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const stateValue = params.get("state");
    const connectionId = params.get("connection");
    const clearQuery = () => window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);

    if (params.get("error")) {
      setNotice(`The provider did not complete the authorization (${params.get("error")}).`);
      setTab("connections");
      clearQuery();
      return;
    }
    if (!code || !stateValue || !connectionId) return;

    clearQuery();
    setTab("connections");
    setBusy(true);
    source
      .completeAuthorization({ connectionId, code, state: stateValue, redirectUri: oauthRedirectUri() })
      .then((result) => {
        setNotice(result.ok ? `Connection authorized. ${result.data?.detail ?? ""}`.trim() : `Authorization failed: ${result.message}`);
        setReloadToken((t) => t + 1);
      })
      .finally(() => setBusy(false));
  }, [canManage, source]);

  const config = state.config;
  const contextItems = useMemo(() => {
    if (!config) return [];
    const byStatus = config.overview.byStatus ?? {};
    const count = (...statuses) => statuses.reduce((sum, s) => sum + (byStatus[s] ?? 0), 0);
    const connected = config.connections.filter((c) => c.oauthStatus === "CONNECTED").length;
    return [
      { key: "connections", label: "Connections", value: `${connected}/${config.connections.length} connected` },
      { key: "mailboxes", label: "Mailboxes", value: config.mailboxes.length },
      { key: "inbound", label: "Inbound requests", value: config.overview.total },
      { key: "accepted", label: "Accepted", value: count("ACCEPTED") },
      { key: "review", label: "Needs review", value: count("NEEDS_REVIEW") },
      { key: "failures", label: "Delivery failures", value: (config.exceptions ?? []).length },
    ];
  }, [config]);

  /** Every action follows the same shape: run it, say what happened, reload the real state. */
  const run = useCallback(
    async (label, fn) => {
      setBusy(true);
      setNotice(null);
      const result = await fn();
      setBusy(false);
      setNotice(result.ok ? `${label}: ${result.data?.detail ?? "done"}` : `${label} failed: ${result.message}`);
      if (result.ok) setReloadToken((t) => t + 1);
      return result;
    },
    [],
  );

  const actions = useMemo(
    () => ({
      saveConnection: async (payload) => {
        const result = await source.saveConnection(payload);
        if (result.ok) setReloadToken((t) => t + 1);
        return result;
      },
      saveMailbox: async (payload) => {
        const result = await source.saveMailbox(payload);
        if (result.ok) setReloadToken((t) => t + 1);
        return result;
      },
      connect: async (connectionId) => {
        setBusy(true);
        setNotice(null);
        // The redirect carries the connection id so the return leg knows which connection it is finishing;
        // it is not authority -- the server checks it against the state it issued.
        const redirectUri = oauthRedirectUri();
        const result = await source.startAuthorization({ connectionId, redirectUri });
        setBusy(false);
        if (!result.ok) {
          setNotice(`Could not start authorization: ${result.message}`);
          return result;
        }
        const target = new URL(result.data.authorizationUrl);
        const back = new URL(redirectUri);
        back.searchParams.set("connection", connectionId);
        target.searchParams.set("redirect_uri", back.toString());
        window.location.assign(target.toString());
        return result;
      },
      test: (connectionId) => run("Connection test", () => source.testConnection({ connectionId })),
      disconnect: (connectionId) => run("Disconnect", () => source.disconnect({ connectionId })),
      pollNow: (mailboxId) =>
        run("Check for new mail", async () => {
          const result = await source.pollNow({ mailboxId });
          if (result.ok && result.data) {
            result.data.detail = `${result.data.fetched} fetched, ${result.data.created} new, ${result.data.attachmentsStored} attachment(s) stored`;
          }
          return result;
        }),
      retry: (failureId) => run("Retry", () => source.retryDelivery({ failureId })),
    }),
    [run, source],
  );

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
              {notice && <p className="fo-muted" role="status">{notice}</p>}
              <RequestsTable
                rows={Object.entries(config.overview.byStatus ?? {})}
                empty="No inbound requests have been taken in yet."
              />
              <h4 className="fo-inbound-pane__subtitle">Attachments held</h4>
              <RequestsTable
                rows={Object.entries(config.overview.attachmentCustody ?? {})}
                empty="No message with attachments has arrived yet."
              />
            </>
          )}
          {tab === "connections" && (
            <ConnectionsTab config={config} readiness={readiness} canManage={canManage} actions={actions} busy={busy} notice={notice} />
          )}
          {tab === "mailboxes" && <MailboxesTab config={config} canManage={canManage} actions={actions} busy={busy} notice={notice} />}
          {tab === "routing" && <RoutingTab config={config} />}
          {tab === "processing" && <ProcessingTab readiness={readiness} />}
          {tab === "history" && (
            <RequestsTable rows={statusRows(HISTORY_STATUSES)} empty="No decisions have been recorded yet." />
          )}
          {tab === "exceptions" && <ExceptionsTab config={config} canManage={canManage} actions={actions} busy={busy} />}
          {!canManage && tab !== "overview" && (
            <p className="fo-muted">Changing email configuration is not part of your role.</p>
          )}
        </div>
      )}
    </WorkspaceShell>
  );
}
