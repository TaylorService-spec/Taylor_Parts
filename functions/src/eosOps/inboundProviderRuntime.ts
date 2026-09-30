// INBOUND WORK -- THE EOS PROVIDER RUNTIME (Controller SERVICE EXPERIENCE COMPLETION, 2026-09-30, increment A).
//
//     M365 / Google provider  ->  EOS (Render)  ->  PostgreSQL Inbound Work  ->  the existing governed review
//
// This replaces the Firebase provider runtime (inboundWork/emailConnectionCommands.ts, emailDeliveryService.ts,
// emailDeliverySchedule.ts, emailTransportCallables.ts, attachmentCustody.ts -- retired): the SAME provider
// adapters (microsoftGraphTransport.ts, gmailTransport.ts), the SAME OAuth state rules
// (providerAuthorizationState.ts), the SAME credential custody (providerCredentialVault.ts: refresh token in Secret
// Manager, access token in process memory only) and the SAME normalizer, now persisting to PostgreSQL and handing
// every message to the governed PostgreSQL intake (inboundWorkIntake.ingestInboundMessage). No Firestore staging,
// no Firebase callable, no bridge, no dual write.
//
// ════════════════════ LEAST AUTHORITY, UNCHANGED ════════════════════
//
//   Microsoft 365: authorization code + PKCE; offline_access, Mail.Read, Mail.Read.Shared -- NEVER Mail.Send,
//                  Mail.ReadWrite or Mail.ReadBasic.All (MICROSOFT_INBOUND_SCOPES).
//   Google:        authorization code + PKCE; gmail.readonly only (GOOGLE_INBOUND_SCOPES).
//   CONSENT IS NOT CONNECTED: completing the OAuth exchange stores the credential and sets oauth_status CONNECTED;
//   connection_status CONNECTED (the configured mailboxes are actually readable) is set only after a read.
//
// ════════════════════ DELIVERY ════════════════════
//
// At-least-once poll, exactly-once intake: the intake id is deterministic per (tenant, mailbox, provider message id)
// and serialized, so a re-listed or retried message converges (DUPLICATE). The cursor advances only over messages
// actually taken in -- a transport failure leaves it where it was. A MALFORMED message is not a transport failure:
// it is retained QUARANTINED (inboundWorkIntake.quarantineMalformedMessage) and the cursor moves past it, so one bad
// message never stalls a mailbox. Failures are classified, counted and retried (inbound_delivery_failures).
//
// ════════════════════ WHO THE POLLER IS ════════════════════
//
// The system delivery actor (INBOUND_DELIVERY_SYSTEM_ACTOR): never a person -- nobody pressed anything -- holding
// ONLY inboundWork.intake.manage. It can take a message in; it cannot read the queue, accept, decline or attach.
import type { Pool, PoolClient } from "pg";
import { randomBytes as nodeRandomBytes, randomUUID } from "node:crypto";
import type { LifecycleActor } from "./workOrderLifecycle";
import type { WorkOrderOp } from "./workOrderOperationTypes";
import {
  INBOUND_INTAKE_MANAGE, INBOUND_WORK_READ, connectionView, failureView, inTransaction, isId, only,
  ingestInboundMessage, quarantineMalformedMessage, refuse, requireCapability, writeAudit,
} from "./inboundWorkIntake";
import { boundedString } from "../inboundWork/inboundWorkModel";
import { isEmailProviderId, normalizeProviderMessage, type EmailProviderId } from "../inboundWork/emailProvider";
import {
  MAX_DELIVERY_ATTEMPTS, ProviderTransportError, dispositionOf, nextRetryDelayMs,
  type DeliveryCursor, type EmailTransportAdapter, type ProviderMessageList, type TransportFailureCode,
} from "../inboundWork/providerTransport";
import {
  OAuthStateError, assertAuthorizationStateUsable, hashAuthorizationState, issueAuthorizationState, type AuthorizationStateRecord,
} from "../inboundWork/providerAuthorizationState";
import {
  createSecretManagerVault, forgetAccessToken, resolveAccessToken, type CredentialReference, type CredentialVault,
} from "../inboundWork/providerCredentialVault";
import { providerClientConfigured, transportFor as envTransportFor } from "../inboundWork/providerTransportFactory";
import { MICROSOFT_INBOUND_SCOPES } from "../inboundWork/microsoftGraphTransport";
import { GOOGLE_INBOUND_SCOPES } from "../inboundWork/gmailTransport";
import {
  AttachmentRefusal, assertStorableAttachment, attachmentCustodyId, safeAttachmentFilename, sha256Of, summarizeCustody,
} from "../inboundWork/attachmentCustodyRules";

/** The system actor delivery runs as. Holds ONLY the intake capability. */
export const INBOUND_DELIVERY_SYSTEM_ACTOR = "system-inbound-delivery";
export const DELIVERY_BATCH_LIMIT = 25;
export const MAX_MAILBOXES_PER_CYCLE = 20;
/** Bytes returned inline by readInboundAttachment. Bigger files need a streaming download (a recorded follow-up). */
export const MAX_INLINE_ATTACHMENT_BYTES = 6 * 1024 * 1024;
/** How many times custody retries one attachment before it stays FAILED for an administrator. */
export const MAX_ATTACHMENT_ATTEMPTS = 5;

// ════════════════════ the runtime seam ════════════════════

/** Everything provider-specific the runtime needs. Composed from the environment; replaced whole by a test. */
export interface InboundProviderRuntime {
  readonly environment: string;
  transportFor(provider: EmailProviderId): EmailTransportAdapter;
  providerConfigured(provider: EmailProviderId): boolean;
  /** Where refresh tokens live. Null: no vault is configured, and no connection can be authorized or polled. */
  readonly vault: CredentialVault | null;
  randomBytes(size: number): Buffer;
}

/**
 * The runtime the EOS API composes: the deployment's OAuth clients from EMAIL_{MICROSOFT,GOOGLE}_CLIENT_{ID,SECRET}
 * and the Secret Manager vault in EOS_CREDENTIAL_VAULT_PROJECT. Nothing is fabricated: an unset value is reported as
 * unconfigured, never defaulted.
 */
export function inboundProviderRuntimeFromEnv(env: NodeJS.ProcessEnv = process.env): InboundProviderRuntime {
  const project = (env.EOS_CREDENTIAL_VAULT_PROJECT ?? "").trim();
  return Object.freeze({
    environment: (env.EOS_ENVIRONMENT ?? "local").trim().toLowerCase(),
    transportFor: (provider: EmailProviderId) => envTransportFor(provider, env),
    providerConfigured: (provider: EmailProviderId) => providerClientConfigured(provider, env),
    vault: /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project) ? createSecretManagerVault(project) : null,
    randomBytes: (size: number) => nodeRandomBytes(size),
  });
}

let runtimeOverride: InboundProviderRuntime | null = null;
let composed: InboundProviderRuntime | null = null;
/** TEST SEAM: replace the whole runtime (a fake transport, an in-memory vault). Null restores the environment's. */
export function setInboundProviderRuntimeForTest(runtime: InboundProviderRuntime | null): void {
  runtimeOverride = runtime;
}
export function currentInboundProviderRuntime(): InboundProviderRuntime {
  return runtimeOverride ?? (composed ??= inboundProviderRuntimeFromEnv());
}

function assertTransportAllowed(runtime: InboundProviderRuntime): void {
  if (runtime.environment === "production" || runtime.environment === "prod") {
    refuse("PROVIDER_TRANSPORT_NOT_AVAILABLE", "PRECONDITION_FAILED", "provider transport is not authorized in production");
  }
}
function requireVault(runtime: InboundProviderRuntime): CredentialVault {
  if (!runtime.vault) {
    return refuse("CREDENTIAL_VAULT_UNAVAILABLE", "PRECONDITION_FAILED",
      "no credential vault is configured for this environment (EOS_CREDENTIAL_VAULT_PROJECT); no provider credential can be held");
  }
  return runtime.vault;
}

type Deps = { readonly pool: Pool; readonly now?: () => Date };
const nowOf = (deps: { readonly now?: () => Date }) => (deps.now ?? (() => new Date()))();
const errorCodeOf = (err: unknown, fallback: TransportFailureCode): TransportFailureCode =>
  err instanceof ProviderTransportError ? err.code : fallback;

// ════════════════════ connections ════════════════════

interface ConnectionRow {
  readonly id: string;
  readonly provider: EmailProviderId;
  readonly tenantOrWorkspace: string;
  readonly connectedAccount: string;
  readonly inboundEnabled: boolean;
  readonly oauthStatus: string;
}

async function readConnectionRow(db: Pool | PoolClient, tenantId: string, connectionId: string): Promise<ConnectionRow> {
  const { rows } = await db.query(`SELECT * FROM eos_ops.inbound_provider_connections WHERE tenant_id = $1 AND id = $2`, [tenantId, connectionId]);
  if (rows.length === 0) refuse("CONNECTION_NOT_FOUND", "NOT_FOUND", "that provider connection does not exist");
  const r = rows[0];
  if (!isEmailProviderId(r.provider)) refuse("CONFIGURATION_INVALID", "PRECONDITION_FAILED", "that connection has no valid provider");
  return { id: r.id, provider: r.provider, tenantOrWorkspace: r.tenant_or_workspace ?? "", connectedAccount: r.connected_account ?? "",
    inboundEnabled: r.inbound_enabled === true, oauthStatus: r.oauth_status };
}

const CONNECTION_INPUT = ["connectionId", "connectionName", "provider", "tenantOrWorkspace", "connectedAccount", "inboundEnabled"];

/**
 * Create or change a provider connection's IDENTITY. ADMINISTRATIVE CONFIGURATION (inboundWork.intake.manage). It
 * accepts no credential of any kind -- the closed input list refuses one -- and never changes the OAuth state: a
 * connection becomes CONNECTED only through the authorization flow.
 */
export async function saveInboundConnection(deps: Deps, actor: LifecycleActor, input: Record<string, unknown>) {
  requireCapability(actor, INBOUND_INTAKE_MANAGE);
  only(input, CONNECTION_INPUT);
  const name = boundedString(input.connectionName, 120);
  if (!name) refuse("CONNECTION_NAME_REQUIRED", "INVALID_INPUT", "connectionName is required");
  if (!isEmailProviderId(input.provider)) refuse("PROVIDER_INVALID", "INVALID_INPUT", "provider must be MICROSOFT_365 or GOOGLE_WORKSPACE");
  const tenantOrWorkspace = boundedString(input.tenantOrWorkspace, 255);
  const connectedAccount = boundedString(input.connectedAccount, 255);
  if (input.inboundEnabled !== undefined && typeof input.inboundEnabled !== "boolean") refuse("FIELD_INVALID", "INVALID_INPUT", "inboundEnabled is a boolean");
  const now = nowOf(deps);
  return inTransaction(deps.pool, async (c) => {
    // A NEW connection's id is EOS's, globally unique -- it names the credential's vault entry, which must never be shared.
    const existingId = input.connectionId === undefined || input.connectionId === null || input.connectionId === "" ? null : input.connectionId;
    if (existingId !== null) {
      if (!isId(existingId)) refuse("CONNECTION_ID_INVALID", "INVALID_INPUT", "connectionId names an existing connection");
      const before = await c.query(`SELECT * FROM eos_ops.inbound_provider_connections WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [actor.tenantId, existingId]);
      if (before.rows.length === 0) refuse("CONNECTION_NOT_FOUND", "NOT_FOUND", "that provider connection does not exist");
      if (before.rows[0].provider !== input.provider && before.rows[0].oauth_status === "CONNECTED") {
        refuse("CONNECTION_PROVIDER_LOCKED", "PRECONDITION_FAILED", "disconnect a connection before changing its provider");
      }
      const { rows } = await c.query(
        `UPDATE eos_ops.inbound_provider_connections SET connection_name = $3, provider = $4, tenant_or_workspace = $5, connected_account = $6,
                inbound_enabled = COALESCE($7, inbound_enabled), updated_by_principal_id = $8, updated_at = $9, version = version + 1
          WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [actor.tenantId, existingId, name, input.provider, tenantOrWorkspace, connectedAccount, input.inboundEnabled ?? null, actor.principalId, now]);
      await writeAudit(c, actor, "inboundWork.connection.save", "inboundProviderConnection", existingId as string,
        connectionView(before.rows[0]), connectionView(rows[0]), null, now);
      return connectionView(rows[0]);
    }
    const id = `conn_${randomUUID().replace(/-/g, "")}`;
    const { rows } = await c.query(
      `INSERT INTO eos_ops.inbound_provider_connections
         (tenant_id, id, connection_name, provider, tenant_or_workspace, connected_account, inbound_enabled, updated_by_principal_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
      [actor.tenantId, id, name, input.provider, tenantOrWorkspace, connectedAccount, input.inboundEnabled ?? true, actor.principalId, now]);
    await writeAudit(c, actor, "inboundWork.connection.save", "inboundProviderConnection", id, null, connectionView(rows[0]), null, now);
    return connectionView(rows[0]);
  });
}

/** What this runtime can honestly offer. Never a secret value -- only whether one is configured. */
export function readInboundProviderReadiness(actor: LifecycleActor) {
  requireCapability(actor, INBOUND_INTAKE_MANAGE);
  const runtime = currentInboundProviderRuntime();
  const production = runtime.environment === "production" || runtime.environment === "prod";
  return Object.freeze({
    runtime: "EOS_POSTGRESQL",
    environment: runtime.environment,
    transportAvailable: !production && runtime.vault !== null,
    productionRefusal: production ? "Provider transport is not authorized in production." : null,
    credentialVaultConfigured: runtime.vault !== null,
    microsoftConfigured: runtime.providerConfigured("MICROSOFT_365"),
    googleConfigured: runtime.providerConfigured("GOOGLE_WORKSPACE"),
    scopes: { MICROSOFT_365: [...MICROSOFT_INBOUND_SCOPES], GOOGLE_WORKSPACE: [...GOOGLE_INBOUND_SCOPES] },
  });
}

/** Step one: mint and store the state (by its hash), and hand back the provider URL. The connection only awaits. */
export async function startInboundConnectionAuthorization(deps: Deps, actor: LifecycleActor, input: Record<string, unknown>) {
  requireCapability(actor, INBOUND_INTAKE_MANAGE);
  only(input, ["connectionId", "redirectUri"]);
  const runtime = currentInboundProviderRuntime();
  assertTransportAllowed(runtime);
  requireVault(runtime);
  if (!isId(input.connectionId)) refuse("CONNECTION_ID_REQUIRED", "INVALID_INPUT", "connectionId is required");
  const now = nowOf(deps);
  const connection = await readConnectionRow(deps.pool, actor.tenantId, input.connectionId as string);
  if (!runtime.providerConfigured(connection.provider)) {
    refuse("PROVIDER_CLIENT_NOT_CONFIGURED", "PRECONDITION_FAILED", `no ${connection.provider} OAuth client is configured for this environment`);
  }
  let issued;
  try {
    issued = issueAuthorizationState(
      { connectionId: connection.id, provider: connection.provider, redirectUri: boundedString(input.redirectUri, 500), initiatedByUid: actor.principalId },
      { now: now.getTime(), randomBytes: runtime.randomBytes });
  } catch (err) {
    return refuse((err as OAuthStateError).code ?? "STATE_MALFORMED", "INVALID_INPUT", (err as Error).message);
  }
  await inTransaction(deps.pool, async (c) => {
    await c.query(
      `INSERT INTO eos_ops.inbound_oauth_states (state_key, tenant_id, connection_id, provider, redirect_uri, initiated_by_principal_id,
                                                 code_verifier, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [issued.stateKey, actor.tenantId, connection.id, connection.provider, issued.record.redirectUri, actor.principalId,
        issued.record.codeVerifier, now, new Date(issued.record.expiresAt)]);
    await c.query(
      `UPDATE eos_ops.inbound_provider_connections SET oauth_status = CASE WHEN oauth_status = 'CONNECTED' THEN oauth_status ELSE 'PENDING_AUTHORIZATION' END,
              authorization_started_at = $3, updated_by_principal_id = $4, updated_at = $3, version = version + 1
        WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, connection.id, now, actor.principalId]);
    await writeAudit(c, actor, "inboundWork.connection.authorizationStarted", "inboundProviderConnection", connection.id, null,
      { provider: connection.provider }, null, now);
  });
  return Object.freeze({
    authorizationUrl: runtime.transportFor(connection.provider).buildAuthorizationUrl({
      tenantOrWorkspace: connection.tenantOrWorkspace, connectedAccount: connection.connectedAccount,
      redirectUri: issued.record.redirectUri, state: issued.state, codeChallenge: issued.codeChallenge,
    }),
    state: issued.state,
    expiresAt: issued.record.expiresAt,
  });
}

/**
 * Step two: consume the state (single use, in a transaction), exchange the code, take custody of the refresh token,
 * then PROVE the configured mailboxes are readable. Only that last step sets connection_status CONNECTED.
 */
export async function completeInboundConnectionAuthorization(deps: Deps, actor: LifecycleActor, input: Record<string, unknown>) {
  requireCapability(actor, INBOUND_INTAKE_MANAGE);
  only(input, ["connectionId", "state", "code", "redirectUri"]);
  const runtime = currentInboundProviderRuntime();
  assertTransportAllowed(runtime);
  const vault = requireVault(runtime);
  if (!isId(input.connectionId)) refuse("CONNECTION_ID_REQUIRED", "INVALID_INPUT", "connectionId is required");
  const code = boundedString(input.code, 4000);
  if (!code) refuse("AUTHORIZATION_CODE_REQUIRED", "INVALID_INPUT", "an authorization code is required");
  const redirectUri = boundedString(input.redirectUri, 500);
  const stateKey = hashAuthorizationState(boundedString(input.state, 500));
  const now = nowOf(deps);
  const connection = await readConnectionRow(deps.pool, actor.tenantId, input.connectionId as string);

  // CONSUME-THEN-EXCHANGE: two simultaneous callbacks cannot both pass; the loser gets STATE_ALREADY_USED.
  let stateRecord: AuthorizationStateRecord;
  try {
    stateRecord = await inTransaction(deps.pool, async (c) => {
      const { rows } = await c.query(`SELECT * FROM eos_ops.inbound_oauth_states WHERE state_key = $1 AND tenant_id = $2 FOR UPDATE`,
        [stateKey, actor.tenantId]);
      const r = rows[0];
      const record: AuthorizationStateRecord | null = r ? {
        connectionId: r.connection_id, provider: r.provider, redirectUri: r.redirect_uri, initiatedByUid: r.initiated_by_principal_id,
        codeVerifier: r.code_verifier, createdAt: new Date(r.created_at).getTime(), expiresAt: new Date(r.expires_at).getTime(),
        consumedAt: r.consumed_at ? new Date(r.consumed_at).getTime() : null,
      } : null;
      const usable = assertAuthorizationStateUsable(record, {
        connectionId: connection.id, provider: connection.provider, redirectUri, actorUid: actor.principalId, now: now.getTime(),
      });
      await c.query(`UPDATE eos_ops.inbound_oauth_states SET consumed_at = $2 WHERE state_key = $1`, [stateKey, now]);
      return usable;
    });
  } catch (err) {
    if (err instanceof OAuthStateError) {
      await inTransaction(deps.pool, (c) => writeAudit(c, actor, "inboundWork.connection.authorizationRefused", "inboundProviderConnection",
        connection.id, null, { refusal: err.code }, err.code, now));
      return refuse(err.code, "FORBIDDEN", err.message);
    }
    throw err;
  }

  const adapter = runtime.transportFor(connection.provider);
  let reference: CredentialReference;
  let scope = "";
  try {
    const tokens = await adapter.exchangeAuthorizationCode({
      code, codeVerifier: stateRecord.codeVerifier, redirectUri, tenantOrWorkspace: connection.tenantOrWorkspace,
    });
    if (!tokens.refreshToken) {
      throw new ProviderTransportError("CONFIGURATION_INVALID", "The provider returned no refresh token. Reauthorize and accept the offline access prompt.");
    }
    scope = tokens.scope;
    reference = await vault.put(connection.id, tokens.refreshToken);
    forgetAccessToken(connection.id);
  } catch (err) {
    const failure = errorCodeOf(err, "CONFIGURATION_INVALID");
    await inTransaction(deps.pool, async (c) => {
      await c.query(
        `UPDATE eos_ops.inbound_provider_connections SET oauth_status = 'NOT_CONNECTED', connection_status = 'NOT_CONNECTED', health = 'FAILED',
                last_provider_error_at = $3, provider_error_code = $4, updated_at = $3, version = version + 1
          WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, connection.id, now, failure]);
      await writeAudit(c, actor, "inboundWork.connection.authorizationFailed", "inboundProviderConnection", connection.id, null,
        { failure }, failure, now);
    });
    return refuse(failure, "PRECONDITION_FAILED", err instanceof Error ? boundedString(err.message, 300) : "the authorization could not be completed");
  }

  // CONSENT RECORDED: the credential reference is stored, oauth_status CONNECTED. Readability is still unproven.
  await inTransaction(deps.pool, async (c) => {
    await c.query(
      `UPDATE eos_ops.inbound_provider_connections SET oauth_status = 'CONNECTED', connection_status = 'NOT_CONNECTED',
              credential_secret_name = $3, credential_version = $4, granted_scopes = $5, authorized_at = $6, authorized_by_principal_id = $7,
              last_token_refresh_at = $6, provider_error_code = NULL, disconnected_at = NULL, updated_by_principal_id = $7, updated_at = $6,
              version = version + 1
        WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, connection.id, reference.secretName, reference.version, boundedString(scope, 500) || null, now, actor.principalId]);
    await writeAudit(c, actor, "inboundWork.connection.authorized", "inboundProviderConnection", connection.id, null,
      { provider: connection.provider, grantedScopes: boundedString(scope, 500) || null }, null, now);
  });
  const validation = await validateConnectionMailboxes(deps, actor, connection, runtime);
  return Object.freeze({ connectionId: connection.id, oauthStatus: "CONNECTED", ...validation });
}

/** Read every configured mailbox with the granted authority; record each result; set the connection's health. */
async function validateConnectionMailboxes(deps: Deps, actor: LifecycleActor, connection: ConnectionRow, runtime: InboundProviderRuntime) {
  const now = nowOf(deps);
  const vault = requireVault(runtime);
  const adapter = runtime.transportFor(connection.provider);
  const { rows: mailboxes } = await deps.pool.query(
    `SELECT id, email_address FROM eos_ops.inbound_mailboxes WHERE tenant_id = $1 AND connection_id = $2 ORDER BY id LIMIT 25`,
    [actor.tenantId, connection.id]);
  let health: "HEALTHY" | "DEGRADED" | "FAILED" | "UNKNOWN";
  let connectionStatus: "CONNECTED" | "FAILED" | "NOT_CONNECTED";
  let detail: string;
  let failed = 0;
  let errorCode: string | null = null;
  try {
    const accessToken = await resolveAccessToken(vault, adapter, { connectionId: connection.id, tenantOrWorkspace: connection.tenantOrWorkspace },
      { now: () => now.getTime(), onRefreshed: refreshRecorder(deps.pool, actor.tenantId, connection.id) });
    const details: string[] = [];
    for (const m of mailboxes) {
      const result = await adapter.validateMailboxAccess({ accessToken, mailboxAddress: boundedString(m.email_address, 255) });
      if (!result.ok) failed += 1;
      details.push(result.detail);
      await deps.pool.query(
        `UPDATE eos_ops.inbound_mailboxes SET mailbox_validated_at = $3, mailbox_readable = $4, mailbox_validation_detail = $5
          WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, m.id, now, result.ok, boundedString(result.detail, 300)]);
    }
    if (mailboxes.length === 0) {
      health = "UNKNOWN"; connectionStatus = "NOT_CONNECTED";
      detail = "Authorized. No mailbox is configured on this connection yet, so readability is unproven.";
    } else {
      health = failed === 0 ? "HEALTHY" : "FAILED"; connectionStatus = failed === 0 ? "CONNECTED" : "FAILED";
      detail = details.slice(0, 3).join(" ");
      if (failed) errorCode = "MAILBOX_ACCESS_DENIED";
    }
  } catch (err) {
    health = "FAILED"; connectionStatus = "FAILED";
    errorCode = errorCodeOf(err, "PROVIDER_UNAVAILABLE");
    detail = errorCode === "AUTH_REVOKED"
      ? "The stored authorization is no longer accepted by the provider. Reauthorize this connection."
      : "The provider could not be reached.";
  }
  await inTransaction(deps.pool, async (c) => {
    await c.query(
      `UPDATE eos_ops.inbound_provider_connections SET health = $3, connection_status = $4, last_health_check_at = $5,
              oauth_status = CASE WHEN $6::text = 'AUTH_REVOKED' THEN 'REVOKED' ELSE oauth_status END,
              provider_error_code = $6, last_provider_error_at = CASE WHEN $6::text IS NULL THEN last_provider_error_at ELSE $5 END,
              updated_at = $5, version = version + 1
        WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, connection.id, health, connectionStatus, now, errorCode]);
    await writeAudit(c, actor, "inboundWork.connection.healthChecked", "inboundProviderConnection", connection.id, null,
      { health, connectionStatus, mailboxesChecked: mailboxes.length, unreadable: failed }, errorCode, now);
  });
  return { health, connectionStatus, detail: boundedString(detail, 500), mailboxesValidated: mailboxes.length };
}

/** TEST CONNECTION: reads, and nothing else -- no message is taken in, nothing is sent, nothing provider-side changes. */
export async function testInboundConnection(deps: Deps, actor: LifecycleActor, input: Record<string, unknown>) {
  requireCapability(actor, INBOUND_INTAKE_MANAGE);
  only(input, ["connectionId"]);
  const runtime = currentInboundProviderRuntime();
  assertTransportAllowed(runtime);
  if (!isId(input.connectionId)) refuse("CONNECTION_ID_REQUIRED", "INVALID_INPUT", "connectionId is required");
  const connection = await readConnectionRow(deps.pool, actor.tenantId, input.connectionId as string);
  if (connection.oauthStatus !== "CONNECTED") {
    refuse("CONNECTION_NOT_AUTHORIZED", "PRECONDITION_FAILED", "this connection holds no authorization; connect it first");
  }
  return validateConnectionMailboxes(deps, actor, connection, runtime);
}

/** DISCONNECT: the credential is DESTROYED, not unreferenced. Intake it already produced is untouched. */
export async function disconnectInboundConnection(deps: Deps, actor: LifecycleActor, input: Record<string, unknown>) {
  requireCapability(actor, INBOUND_INTAKE_MANAGE);
  only(input, ["connectionId"]);
  const runtime = currentInboundProviderRuntime();
  if (!isId(input.connectionId)) refuse("CONNECTION_ID_REQUIRED", "INVALID_INPUT", "connectionId is required");
  const connection = await readConnectionRow(deps.pool, actor.tenantId, input.connectionId as string);
  const now = nowOf(deps);
  if (runtime.vault) await runtime.vault.destroy(connection.id);
  forgetAccessToken(connection.id);
  return inTransaction(deps.pool, async (c) => {
    const { rows } = await c.query(
      `UPDATE eos_ops.inbound_provider_connections SET oauth_status = 'REVOKED', connection_status = 'NOT_CONNECTED', health = 'UNKNOWN',
              inbound_enabled = false, credential_secret_name = NULL, credential_version = NULL, granted_scopes = NULL, disconnected_at = $3,
              updated_by_principal_id = $4, updated_at = $3, version = version + 1
        WHERE tenant_id = $1 AND id = $2 RETURNING *`, [actor.tenantId, connection.id, now, actor.principalId]);
    await writeAudit(c, actor, "inboundWork.connection.disconnected", "inboundProviderConnection", connection.id, null,
      { oauthStatus: "REVOKED", credentialDestroyed: runtime.vault !== null }, null, now);
    return connectionView(rows[0]);
  });
}

/** After a refresh: record the rotated credential reference (or just the refresh time). */
function refreshRecorder(pool: Pool, tenantId: string, connectionId: string) {
  return async (rotated: CredentialReference | null, at: number) => {
    await pool.query(
      `UPDATE eos_ops.inbound_provider_connections SET last_token_refresh_at = $3,
              credential_secret_name = COALESCE($4, credential_secret_name), credential_version = COALESCE($5, credential_version)
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, connectionId, new Date(at), rotated?.secretName ?? null, rotated?.version ?? null]);
  };
}

// ════════════════════ delivery failures ════════════════════

async function recordDeliveryFailure(
  pool: Pool, actor: LifecycleActor,
  input: { connectionId: string; mailboxId: string; subjectId: string; code: TransportFailureCode | "CREDENTIAL_VAULT_UNAVAILABLE";
    detail: string; retryAfterSeconds?: number | null; now: Date },
): Promise<{ id: string; attempts: number; exhausted: boolean }> {
  const id = `${input.mailboxId}__${input.subjectId}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 400);
  const disposition = input.code === "CREDENTIAL_VAULT_UNAVAILABLE" ? "REQUIRES_ADMIN_ACTION" : dispositionOf(input.code);
  return inTransaction(pool, async (c) => {
    const prev = await c.query(`SELECT attempts FROM eos_ops.inbound_delivery_failures WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, id]);
    const attempts = (prev.rows.length && prev.rows[0].attempts ? Number(prev.rows[0].attempts) : 0) + 1;
    const exhausted = disposition !== "REQUIRES_ADMIN_ACTION" && attempts >= MAX_DELIVERY_ATTEMPTS;
    const next = exhausted ? null : new Date(input.now.getTime() + nextRetryDelayMs(attempts, input.retryAfterSeconds ?? null));
    // A resolved failure that recurs is a NEW episode: attempts restart from the stored count only while it is open.
    await c.query(
      `INSERT INTO eos_ops.inbound_delivery_failures
         (tenant_id, id, connection_id, mailbox_id, subject_id, code, detail, disposition, attempts, exhausted, status, next_attempt_at,
          first_failed_at, last_failed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
       ON CONFLICT (tenant_id, id) DO UPDATE SET code = EXCLUDED.code, detail = EXCLUDED.detail, disposition = EXCLUDED.disposition,
         attempts = EXCLUDED.attempts, exhausted = EXCLUDED.exhausted, status = EXCLUDED.status, next_attempt_at = EXCLUDED.next_attempt_at,
         last_failed_at = EXCLUDED.last_failed_at, resolved_at = NULL,
         first_failed_at = CASE WHEN inbound_delivery_failures.status = 'RESOLVED' THEN EXCLUDED.first_failed_at ELSE inbound_delivery_failures.first_failed_at END`,
      [actor.tenantId, id, input.connectionId, input.mailboxId, input.subjectId, input.code, boundedString(input.detail, 300),
        exhausted ? "REQUIRES_ADMIN_ACTION" : disposition, attempts, exhausted, exhausted ? "DELIVERY_RETRY_EXHAUSTED" : "OPEN", next, input.now]);
    await writeAudit(c, actor, "inboundWork.delivery.failed", "inboundMailbox", input.mailboxId, null,
      { code: input.code, attempts, exhausted, subjectId: input.subjectId }, input.code, input.now);
    return { id, attempts, exhausted };
  });
}

// ════════════════════ attachment custody (bytes -> PostgreSQL) ════════════════════

interface CustodyResult { stored: number; failed: number; skipped: number; custody: string }

/**
 * Fetch and store every PENDING attachment on one intake. IDEMPOTENT: the custody id is deterministic and the
 * insert converges, so a retry fetches only what is missing. Network I/O runs OUTSIDE any transaction; the
 * outcome is merged back under a short row lock. A failure never loses the intake -- it reads PARTIAL / FAILED.
 */
async function custodyAttachments(
  pool: Pool, actor: LifecycleActor, requestId: string,
  io: { adapter: EmailTransportAdapter; accessToken: string; mailboxAddress: string; now: Date },
): Promise<CustodyResult> {
  const { rows } = await pool.query(`SELECT attachment_refs FROM eos_ops.inbound_work_requests WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, requestId]);
  if (rows.length === 0) return { stored: 0, failed: 0, skipped: 0, custody: "NONE" };
  const refs = (rows[0].attachment_refs as Record<string, unknown>[]) ?? [];
  const outcomes = new Map<string, Record<string, unknown>>();
  let stored = 0, failed = 0, skipped = 0;
  for (const ref of refs) {
    const key = `${String(ref.sourceMessageId)}|${String(ref.providerAttachmentId)}`;
    const attempts = Number(ref.attempts ?? 0);
    if (ref.custody !== "PENDING" && !(ref.custody === "FAILED" && attempts < MAX_ATTACHMENT_ATTEMPTS && ref.failureCode !== "TOO_LARGE")) { skipped += 1; continue; }
    try {
      const fetched = await io.adapter.fetchAttachment({
        accessToken: io.accessToken, mailboxAddress: io.mailboxAddress,
        messageId: String(ref.sourceMessageId), attachmentId: String(ref.providerAttachmentId),
      });
      assertStorableAttachment(fetched.bytes, typeof ref.size === "number" ? ref.size : 0);
      const attachmentId = attachmentCustodyId(requestId, String(ref.sourceMessageId), String(ref.providerAttachmentId));
      const hash = sha256Of(fetched.bytes);
      await pool.query(
        `INSERT INTO eos_ops.inbound_work_attachments
           (tenant_id, id, request_id, source_message_id, provider_attachment_id, filename, declared_mime_type, size_bytes, content_sha256,
            content, stored_by_principal_id, stored_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (tenant_id, id) DO NOTHING`,
        [actor.tenantId, attachmentId, requestId, String(ref.sourceMessageId), String(ref.providerAttachmentId),
          safeAttachmentFilename(ref.filename), boundedString(ref.mimeType, 120) || "application/octet-stream", fetched.bytes.length, hash,
          fetched.bytes, actor.principalId, io.now]);
      outcomes.set(key, { custody: "STORED", attachmentId, contentHash: hash, size: fetched.bytes.length, storedAt: io.now.getTime(),
        failureCode: null, attempts: attempts + 1 });
      stored += 1;
    } catch (err) {
      const code = err instanceof AttachmentRefusal ? err.code : errorCodeOf(err, "ATTACHMENT_FETCH_FAILED");
      outcomes.set(key, { custody: "FAILED", failureCode: code, attempts: attempts + 1 });
      failed += 1;
    }
  }
  if (outcomes.size === 0) return { stored, failed, skipped, custody: summarizeCustody(refs as never) };
  return inTransaction(pool, async (c) => {
    const cur = await c.query(`SELECT attachment_refs FROM eos_ops.inbound_work_requests WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, requestId]);
    const merged = ((cur.rows[0].attachment_refs as Record<string, unknown>[]) ?? []).map((ref) => {
      const o = outcomes.get(`${String(ref.sourceMessageId)}|${String(ref.providerAttachmentId)}`);
      return o && ref.custody !== "STORED" ? { ...ref, ...o } : ref;
    });
    const custody = summarizeCustody(merged as never);
    await c.query(`UPDATE eos_ops.inbound_work_requests SET attachment_refs = $3::jsonb, attachment_custody = $4, updated_at = $5, version = version + 1
                    WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, requestId, JSON.stringify(merged), custody, io.now]);
    await writeAudit(c, actor, "inboundWork.attachment.custody", "inboundWorkRequest", requestId, null,
      { custody, stored, failed, skipped }, null, io.now);
    return { stored, failed, skipped, custody };
  });
}

// ════════════════════ one mailbox, once ════════════════════

export interface DeliveryResult {
  mailboxId: string;
  fetched: number;
  created: number;
  duplicates: number;
  threadMatched: number;
  quarantined: number;
  attachmentsStored: number;
  attachmentsFailed: number;
  failures: number;
  truncated: boolean;
  transportFailure: string | null;
  skipped: string | null;
}

/** The actor delivery writes as: the system delivery actor, holding ONLY the intake capability, in one tenant. */
export function deliveryActor(tenantId: string): LifecycleActor {
  return Object.freeze({ tenantId, principalId: INBOUND_DELIVERY_SYSTEM_ACTOR, capabilities: new Set([INBOUND_INTAKE_MANAGE]) });
}

/**
 * Poll ONE mailbox once: credential, list, fetch, take in, custody, cursor. The cursor advances only over messages
 * that were taken in (a malformed one is taken in QUARANTINED); a transport failure leaves it where it was.
 */
export async function pollMailboxOnce(
  pool: Pool, runtime: InboundProviderRuntime, tenantId: string, mailboxId: string,
  opts: { now?: () => Date; limit?: number } = {},
): Promise<DeliveryResult> {
  const now = (opts.now ?? (() => new Date()))();
  const actor = deliveryActor(tenantId);
  const result: DeliveryResult = { mailboxId, fetched: 0, created: 0, duplicates: 0, threadMatched: 0, quarantined: 0,
    attachmentsStored: 0, attachmentsFailed: 0, failures: 0, truncated: false, transportFailure: null, skipped: null };
  assertTransportAllowed(runtime);
  const { rows } = await pool.query(
    `SELECT m.*, c.provider, c.tenant_or_workspace, c.oauth_status, c.inbound_enabled AS connection_inbound_enabled
       FROM eos_ops.inbound_mailboxes m
       LEFT JOIN eos_ops.inbound_provider_connections c ON c.tenant_id = m.tenant_id AND c.id = m.connection_id
      WHERE m.tenant_id = $1 AND m.id = $2`, [tenantId, mailboxId]);
  if (rows.length === 0) { result.skipped = "MAILBOX_NOT_FOUND"; return result; }
  const m = rows[0];
  if (m.status !== "ACTIVE" || m.inbound_enabled !== true) { result.skipped = "MAILBOX_DISABLED"; return result; }
  if (!m.connection_id) { result.skipped = "NO_CONNECTION"; return result; }
  if (m.oauth_status !== "CONNECTED" || m.connection_inbound_enabled !== true || !isEmailProviderId(m.provider)) {
    result.skipped = "CONNECTION_NOT_CONNECTED"; return result;
  }
  const provider = m.provider as EmailProviderId;
  const adapter = runtime.transportFor(provider);
  const mailboxAddress = boundedString(m.email_address, 255);
  const connectionId = String(m.connection_id);

  if (!runtime.vault) {
    result.transportFailure = "CREDENTIAL_VAULT_UNAVAILABLE";
    await recordDeliveryFailure(pool, actor, { connectionId, mailboxId, subjectId: "credential", code: "CREDENTIAL_VAULT_UNAVAILABLE",
      detail: "No credential vault is configured for this environment.", now });
    return result;
  }
  let accessToken: string;
  try {
    accessToken = await resolveAccessToken(runtime.vault, adapter, { connectionId, tenantOrWorkspace: m.tenant_or_workspace ?? "" },
      { now: () => now.getTime(), onRefreshed: refreshRecorder(pool, tenantId, connectionId) });
  } catch (err) {
    const code = errorCodeOf(err, "CONFIGURATION_INVALID");
    result.transportFailure = code;
    await recordDeliveryFailure(pool, actor, { connectionId, mailboxId, subjectId: "credential", code,
      detail: err instanceof Error ? err.message : "The connection credential could not be used.", now });
    await pool.query(
      `UPDATE eos_ops.inbound_provider_connections SET health = 'FAILED', connection_status = 'FAILED', last_provider_error_at = $3,
              provider_error_code = $4, oauth_status = CASE WHEN $4 = 'AUTH_REVOKED' THEN 'REVOKED' WHEN $4 = 'AUTH_EXPIRED' THEN 'EXPIRED' ELSE oauth_status END
        WHERE tenant_id = $1 AND id = $2`, [tenantId, connectionId, now, code]);
    return result;
  }

  const limit = Math.max(1, Math.min(opts.limit ?? DELIVERY_BATCH_LIMIT, 100));
  const startingCursor: DeliveryCursor = (m.delivery_cursor as DeliveryCursor | null) ?? { value: null };
  const failList = async (err: unknown): Promise<DeliveryResult> => {
    const code = errorCodeOf(err, "PROVIDER_UNAVAILABLE");
    result.transportFailure = code;
    await recordDeliveryFailure(pool, actor, { connectionId, mailboxId, subjectId: "list", code,
      detail: err instanceof Error ? err.message : "The mailbox could not be listed.",
      retryAfterSeconds: err instanceof ProviderTransportError ? err.retryAfterSeconds : null, now });
    await pool.query(`UPDATE eos_ops.inbound_provider_connections SET health = $3, last_provider_error_at = $4, provider_error_code = $5
                        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, connectionId, dispositionOf(code) === "REQUIRES_ADMIN_ACTION" ? "FAILED" : "DEGRADED", now, code]);
    await pool.query(`UPDATE eos_ops.inbound_mailboxes SET last_polled_at = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, mailboxId, now]);
    return result;
  };

  let listed: ProviderMessageList;
  try {
    listed = await adapter.listNewMessageIds({ accessToken, mailboxAddress, cursor: startingCursor, limit });
  } catch (err) {
    if (!(err instanceof ProviderTransportError) || err.code !== "CURSOR_EXPIRED") return failList(err);
    // RECOVERY, not failure: re-list a bounded window and let intake's duplicate protection absorb the overlap.
    try {
      listed = await adapter.listNewMessageIds({ accessToken, mailboxAddress, cursor: { value: startingCursor.value, expired: true }, limit });
    } catch (recoveryError) {
      return failList(recoveryError);
    }
  }

  let nextCursor: DeliveryCursor = listed.cursor;
  let lastReceived = 0;
  result.truncated = listed.truncated;
  for (const messageId of listed.messageIds) {
    let raw: unknown;
    try {
      raw = await adapter.fetchMessage({ accessToken, mailboxAddress, messageId });
    } catch (err) {
      result.failures += 1;
      await recordDeliveryFailure(pool, actor, { connectionId, mailboxId, subjectId: `message_${messageId}`, code: errorCodeOf(err, "MESSAGE_FETCH_FAILED"),
        detail: err instanceof Error ? err.message : "The message could not be fetched.",
        retryAfterSeconds: err instanceof ProviderTransportError ? err.retryAfterSeconds : null, now });
      // The cursor does NOT advance past a message this poll could not fetch.
      nextCursor = startingCursor;
      break;
    }
    let outcome;
    try {
      const message = normalizeProviderMessage(provider, raw, { connectionId, mailboxId });
      outcome = await ingestInboundMessage({ pool, now: () => now }, actor, { message });
      if (message.receivedAt > lastReceived) lastReceived = message.receivedAt;
    } catch (err) {
      if ((err as Error)?.name !== "EmailProviderError" && (err as Error)?.name !== "InboundWorkValidationError" && (err as { code?: string })?.code !== "MESSAGE_INVALID") throw err;
      // MALFORMED: retained QUARANTINED under its provider id; the cursor moves on.
      outcome = await quarantineMalformedMessage({ pool, now: () => now }, actor, {
        provider, mailboxId, connectionId, providerMessageId: messageId,
        reason: boundedString((err as Error).message, 300) || "the provider message could not be read", raw,
      });
    }
    result.fetched += 1;
    if (outcome.outcome === "CREATED" || outcome.outcome === "AMBIGUOUS" || outcome.outcome === "FAILED") result.created += 1;
    if (outcome.outcome === "DUPLICATE") result.duplicates += 1;
    if (outcome.outcome === "THREAD_MATCH") result.threadMatched += 1;
    if (outcome.outcome === "QUARANTINED") result.quarantined += 1;
    if (m.attachment_policy === "STORE") {
      const custody = await custodyAttachments(pool, actor, outcome.requestId, { adapter, accessToken, mailboxAddress, now });
      result.attachmentsStored += custody.stored;
      result.attachmentsFailed += custody.failed;
      if (custody.failed > 0) {
        await recordDeliveryFailure(pool, actor, { connectionId, mailboxId, subjectId: `attachments_${outcome.requestId}`, code: "ATTACHMENT_FETCH_FAILED",
          detail: `${custody.failed} attachment(s) on this message could not be retrieved.`, now });
      }
    }
  }

  await pool.query(
    `UPDATE eos_ops.inbound_mailboxes SET delivery_cursor = $3::jsonb, last_polled_at = $4,
            last_successful_delivery_at = CASE WHEN $5 THEN $4 ELSE last_successful_delivery_at END,
            last_message_received_at = COALESCE($6, last_message_received_at)
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, mailboxId, JSON.stringify(nextCursor), now, result.fetched > 0, lastReceived > 0 ? new Date(lastReceived) : null]);
  if (result.failures === 0) {
    await pool.query(`UPDATE eos_ops.inbound_delivery_failures SET status = 'RESOLVED', resolved_at = $3
                       WHERE tenant_id = $1 AND mailbox_id = $2 AND status = 'OPEN' AND subject_id NOT LIKE 'attachments\\_%'`, [tenantId, mailboxId, now]);
    await pool.query(
      `UPDATE eos_ops.inbound_provider_connections SET health = 'HEALTHY', connection_status = 'CONNECTED', last_successful_sync_at = $3,
              last_message_received_at = COALESCE($4, last_message_received_at), provider_error_code = NULL
        WHERE tenant_id = $1 AND id = $2`, [tenantId, connectionId, now, lastReceived > 0 ? new Date(lastReceived) : null]);
  }
  return result;
}

/**
 * ONE DELIVERY CYCLE across every tenant's connected, enabled mailboxes -- what the EOS poller (the Render job
 * scripts/pollInboundMailboxes.mjs, or the opt-in in-process schedule) runs. A cluster-wide advisory lock makes two
 * overlapping cycles impossible: the second one returns having done nothing.
 */
export async function runInboundDeliveryCycle(
  pool: Pool, runtime: InboundProviderRuntime = currentInboundProviderRuntime(), opts: { now?: () => Date; limit?: number } = {},
): Promise<{ ran: boolean; results: DeliveryResult[] }> {
  assertTransportAllowed(runtime);
  const client = await pool.connect();
  try {
    const { rows: lock } = await client.query(`SELECT pg_try_advisory_lock(hashtextextended('eos-inbound-delivery-cycle', 0)) AS got`);
    if (lock[0].got !== true) return { ran: false, results: [] };
    try {
      const { rows } = await client.query(
        `SELECT m.tenant_id, m.id FROM eos_ops.inbound_mailboxes m
           JOIN eos_ops.inbound_provider_connections c ON c.tenant_id = m.tenant_id AND c.id = m.connection_id
          WHERE m.status = 'ACTIVE' AND m.inbound_enabled AND c.oauth_status = 'CONNECTED' AND c.inbound_enabled
          ORDER BY m.last_polled_at NULLS FIRST, m.tenant_id, m.id LIMIT ${MAX_MAILBOXES_PER_CYCLE}`);
      const results: DeliveryResult[] = [];
      for (const r of rows) {
        try {
          results.push(await pollMailboxOnce(pool, runtime, r.tenant_id, r.id, opts));
        } catch (err) {
          // One mailbox's unexpected failure must not stop the others.
          // eslint-disable-next-line no-console -- operator log; never a token or a provider body
          console.error(`[inboundDelivery] mailbox ${r.id} failed:`, err instanceof Error ? err.name : "error");
        }
      }
      return { ran: true, results };
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtextextended('eos-inbound-delivery-cycle', 0))`);
    }
  } finally {
    client.release();
  }
}

/**
 * THE OPT-IN IN-PROCESS SCHEDULE. Off unless EOS_INBOUND_POLLING=enabled (an operator act, per environment); the
 * interval is EOS_INBOUND_POLL_INTERVAL_SECONDS (60..3600, default 300 -- a service business's tolerance for "a warranty
 * email arrived", not a technical constant). Never runs in production. Returns the timer, or null when off.
 */
export function startInboundPollingIfEnabled(pool: Pool, env: NodeJS.ProcessEnv = process.env): ReturnType<typeof setInterval> | null {
  if ((env.EOS_INBOUND_POLLING ?? "").trim().toLowerCase() !== "enabled") return null;
  const environment = (env.EOS_ENVIRONMENT ?? "local").trim().toLowerCase();
  if (environment === "production" || environment === "prod") return null;
  const seconds = Number(env.EOS_INBOUND_POLL_INTERVAL_SECONDS ?? 300);
  const interval = Number.isFinite(seconds) ? Math.min(Math.max(Math.round(seconds), 60), 3600) : 300;
  const timer = setInterval(() => {
    runInboundDeliveryCycle(pool).catch((err) => {
      // eslint-disable-next-line no-console -- operator log; never a token or a provider body
      console.error("[inboundDelivery] cycle failed:", err instanceof Error ? err.name : "error");
    });
  }, interval * 1000);
  timer.unref?.();
  return timer;
}

// ════════════════════ the operations ════════════════════

/** CHECK FOR NEW MAIL NOW, for one mailbox, by an intake administrator. Writes as the system delivery actor. */
export async function pollInboundMailboxNow(deps: Deps, actor: LifecycleActor, input: Record<string, unknown>) {
  requireCapability(actor, INBOUND_INTAKE_MANAGE);
  only(input, ["mailboxId"]);
  if (!isId(input.mailboxId)) refuse("MAILBOX_ID_REQUIRED", "INVALID_INPUT", "mailboxId is required");
  const runtime = currentInboundProviderRuntime();
  const result = await pollMailboxOnce(deps.pool, runtime, actor.tenantId, input.mailboxId as string, { now: deps.now });
  if (result.skipped === "MAILBOX_NOT_FOUND") refuse("MAILBOX_NOT_FOUND", "NOT_FOUND", "that mailbox does not exist");
  await inTransaction(deps.pool, (c) => writeAudit(c, actor, "inboundWork.delivery.pollRequested", "inboundMailbox", input.mailboxId as string,
    null, result, null, nowOf(deps)));
  return result;
}

/** RETRY one recorded failure: the SAME poll, with the cached access token dropped first. */
export async function retryInboundDelivery(deps: Deps, actor: LifecycleActor, input: Record<string, unknown>) {
  requireCapability(actor, INBOUND_INTAKE_MANAGE);
  only(input, ["failureId"]);
  if (!isId(input.failureId)) refuse("FAILURE_ID_REQUIRED", "INVALID_INPUT", "failureId is required");
  const { rows } = await deps.pool.query(`SELECT * FROM eos_ops.inbound_delivery_failures WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, input.failureId]);
  if (rows.length === 0) refuse("FAILURE_NOT_FOUND", "NOT_FOUND", "that delivery failure does not exist");
  forgetAccessToken(rows[0].connection_id);
  const result = await pollMailboxOnce(deps.pool, currentInboundProviderRuntime(), actor.tenantId, rows[0].mailbox_id, { now: deps.now });
  if (result.transportFailure === null && result.failures === 0) {
    await deps.pool.query(`UPDATE eos_ops.inbound_delivery_failures SET status = 'RESOLVED', resolved_at = $3 WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, input.failureId, nowOf(deps)]);
  }
  const after = await deps.pool.query(`SELECT * FROM eos_ops.inbound_delivery_failures WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, input.failureId]);
  return { result, failure: after.rows.length ? failureView(after.rows[0]) : null };
}

/**
 * READ ONE CUSTODIED ATTACHMENT, through the request it belongs to (inboundWork.request.read -- no separate
 * attachment permission a person could hold without being able to open the record). Returned as base64 with its
 * DECLARED type as data; a browser offers it as an opaque download, never renders it.
 */
export async function readInboundAttachment(deps: Deps, actor: LifecycleActor, input: Record<string, unknown>) {
  requireCapability(actor, INBOUND_WORK_READ);
  only(input, ["requestId", "attachmentId"]);
  if (!isId(input.requestId) || !isId(input.attachmentId)) refuse("ATTACHMENT_ID_REQUIRED", "INVALID_INPUT", "requestId and attachmentId are required");
  const { rows } = await deps.pool.query(
    `SELECT id, filename, declared_mime_type, size_bytes, content_sha256, content FROM eos_ops.inbound_work_attachments
      WHERE tenant_id = $1 AND request_id = $2 AND id = $3`, [actor.tenantId, input.requestId, input.attachmentId]);
  if (rows.length === 0) refuse("ATTACHMENT_NOT_FOUND", "NOT_FOUND", "that attachment is not held for this request");
  const a = rows[0];
  if (Number(a.size_bytes) > MAX_INLINE_ATTACHMENT_BYTES) {
    refuse("ATTACHMENT_TOO_LARGE_FOR_INLINE", "PRECONDITION_FAILED", "this attachment is larger than an inline download allows");
  }
  return Object.freeze({
    attachmentId: a.id, filename: a.filename, declaredMimeType: a.declared_mime_type, servedAs: "application/octet-stream",
    size: Number(a.size_bytes), contentSha256: a.content_sha256, contentBase64: Buffer.from(a.content).toString("base64"),
  });
}

/** The /operations/inbound-work entries this module contributes. */
export const INBOUND_PROVIDER_OPERATIONS: Readonly<Record<string, WorkOrderOp>> = Object.freeze({
  saveInboundConnection: (deps, caller, input) => saveInboundConnection(deps, caller.actor, input),
  readInboundProviderReadiness: async (_deps, caller, input) => (only(input, []), readInboundProviderReadiness(caller.actor)),
  startInboundConnectionAuthorization: (deps, caller, input) => startInboundConnectionAuthorization(deps, caller.actor, input),
  completeInboundConnectionAuthorization: (deps, caller, input) => completeInboundConnectionAuthorization(deps, caller.actor, input),
  testInboundConnection: (deps, caller, input) => testInboundConnection(deps, caller.actor, input),
  disconnectInboundConnection: (deps, caller, input) => disconnectInboundConnection(deps, caller.actor, input),
  pollInboundMailboxNow: (deps, caller, input) => pollInboundMailboxNow(deps, caller.actor, input),
  retryInboundDelivery: (deps, caller, input) => retryInboundDelivery(deps, caller.actor, input),
  readInboundAttachment: (deps, caller, input) => readInboundAttachment(deps, caller.actor, input),
});
export const INBOUND_PROVIDER_READ_OPERATIONS: readonly string[] = Object.freeze(["readInboundProviderReadiness", "readInboundAttachment"]);
