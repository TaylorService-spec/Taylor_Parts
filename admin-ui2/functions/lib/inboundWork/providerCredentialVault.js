"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.credentialSecretName = credentialSecretName;
exports.createSecretManagerVault = createSecretManagerVault;
exports.createInMemoryVault = createInMemoryVault;
exports.forgetAccessToken = forgetAccessToken;
exports.__rememberAccessTokenForTest = __rememberAccessTokenForTest;
exports.resolveAccessToken = resolveAccessToken;
// Email Connections -- CREDENTIAL CUSTODY.
//
// THE RULE PR #1811 SET, KEPT: a connection record contains no secret. It never did, and this file is what
// makes that survive real OAuth. The connection (eos_ops.inbound_provider_connections, EOS / PostgreSQL --
// Controller SERVICE EXPERIENCE COMPLETION, 2026-09-30) holds only the NAME of where the credential lives, a
// version number, and timestamps -- values a leaked read of the whole table cannot be used with. This module
// imports no Firebase and no database: the caller records the refreshed reference through `onRefreshed`.
//
// WHERE THE REFRESH TOKEN ACTUALLY LIVES: Google Secret Manager, one secret per connection, accessed by
// the EOS API's service identity and by nothing else. That is the platform's own mechanism for
// exactly this, it is encrypted at rest and audited by the platform, and it means this repository writes
// no cryptography of its own -- no key material, no cipher selection, no IV handling, no rotation scheme
// invented here. A homemade vault is the one thing worse than the plaintext it replaces, because it looks
// solved.
//
// THE ACCESS TOKEN IS NEVER PERSISTED, ANYWHERE. It lives in this process's memory for its own short
// lifetime and is re-minted from the refresh token when needed. There is no field for it, so no future
// change can quietly start storing one.
//
// NO SECRET VALUE IS EVER LOGGED, RETURNED TO A CLIENT, OR PUT IN AN ERROR MESSAGE. Every failure below
// names the connection and the operation, never the material.
const providerTransport_1 = require("./providerTransport");
/** Secret ids are constrained to [A-Za-z0-9_-]; a connection id that is not is refused rather than mangled. */
function credentialSecretName(projectId, connectionId) {
    const id = String(connectionId ?? "");
    if (!/^[A-Za-z0-9_-]{1,180}$/.test(id)) {
        throw new providerTransport_1.ProviderTransportError("CONFIGURATION_INVALID", "That connection id cannot be used as a credential name.");
    }
    return `projects/${projectId}/secrets/eos-email-connection-${id}`;
}
/**
 * The Secret Manager vault. The client library is imported LAZILY so that neither the offline test suite
 * nor any function that does not touch credentials pays for it at load time -- and so this module can be
 * imported by tests that supply their own vault.
 */
function createSecretManagerVault(projectId) {
    const client = async () => {
        const { SecretManagerServiceClient } = await import("@google-cloud/secret-manager");
        return new SecretManagerServiceClient();
    };
    return {
        async put(connectionId, refreshToken) {
            if (!refreshToken)
                throw new providerTransport_1.ProviderTransportError("CONFIGURATION_INVALID", "No credential was returned by the provider.");
            const name = credentialSecretName(projectId, connectionId);
            const api = await client();
            try {
                await api.getSecret({ name });
            }
            catch {
                // First authorization for this connection: create the secret, then add the version below. A
                // separate create keeps rotation and creation on the same path afterwards.
                await api.createSecret({
                    parent: `projects/${projectId}`,
                    secretId: name.split("/").pop(),
                    secret: { replication: { automatic: {} } },
                });
            }
            const [version] = await api.addSecretVersion({ parent: name, payload: { data: Buffer.from(refreshToken, "utf8") } });
            return { secretName: name, version: String(version?.name ?? "").split("/").pop() || "latest" };
        },
        async get(connectionId) {
            const name = credentialSecretName(projectId, connectionId);
            try {
                const api = await client();
                const [accessed] = await api.accessSecretVersion({ name: `${name}/versions/latest` });
                const data = accessed?.payload?.data;
                return data ? Buffer.from(data).toString("utf8") : null;
            }
            catch {
                // NOT_FOUND and PERMISSION_DENIED are both "this connection has no usable credential here", and
                // the caller's next step is the same either way. The underlying error is deliberately not
                // propagated: it can carry resource names and request context into logs.
                return null;
            }
        },
        async destroy(connectionId) {
            const name = credentialSecretName(projectId, connectionId);
            const api = await client();
            try {
                await api.deleteSecret({ name });
            }
            catch {
                // Already gone is the desired end state. Disconnecting must not fail because the credential was
                // removed by a previous attempt or by an administrator in the cloud console.
            }
        },
    };
}
/** A vault for tests and for any environment with no Secret Manager: in memory, and honest about it. */
function createInMemoryVault(seed = {}) {
    const store = new Map(Object.entries(seed));
    return {
        store,
        async put(connectionId, refreshToken) {
            store.set(connectionId, refreshToken);
            return { secretName: `memory://${connectionId}`, version: String(store.size) };
        },
        async get(connectionId) {
            return store.get(connectionId) ?? null;
        },
        async destroy(connectionId) {
            store.delete(connectionId);
        },
    };
}
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The access-token cache. Process memory, keyed by connection, cleared on revocation. A cold instance
// simply refreshes again -- correctness never depends on the cache, only latency and request count.
const accessTokens = new Map();
function forgetAccessToken(connectionId) {
    accessTokens.delete(connectionId);
}
function __rememberAccessTokenForTest(connectionId, accessToken, expiresAt) {
    accessTokens.set(connectionId, { accessToken, expiresAt });
}
/**
 * The one way any caller gets an access token.
 *
 * Cache, else refresh; and when the provider rotates the refresh token, the new one is stored BEFORE the
 * access token is handed out -- so a rotation that we then failed to persist cannot leave the vault
 * holding a credential the provider has already invalidated.
 */
async function resolveAccessToken(vault, adapter, connection, deps = {}) {
    const now = (deps.now ?? Date.now)();
    const cached = accessTokens.get(connection.connectionId);
    if (cached && cached.expiresAt > now)
        return cached.accessToken;
    const refreshToken = await vault.get(connection.connectionId);
    if (!refreshToken) {
        throw new providerTransport_1.ProviderTransportError("AUTH_REVOKED", "This connection has no stored authorization. Reauthorize it.");
    }
    let tokens;
    try {
        tokens = await adapter.refreshAccessToken({ refreshToken, tenantOrWorkspace: connection.tenantOrWorkspace });
    }
    catch (err) {
        // A refresh the provider REFUSES means the grant is gone: an administrator must reauthorize, and no
        // amount of retrying changes that. A refresh that could not be ATTEMPTED is a transient outage.
        if (err instanceof providerTransport_1.ProviderTransportError && (err.code === "AUTH_EXPIRED" || err.code === "AUTH_REVOKED" || err.code === "CONFIGURATION_INVALID")) {
            throw new providerTransport_1.ProviderTransportError("AUTH_REVOKED", "The provider rejected this connection's stored authorization. Reauthorize it.");
        }
        throw err;
    }
    const rotated = tokens.refreshToken && tokens.refreshToken !== refreshToken ? await vault.put(connection.connectionId, tokens.refreshToken) : null;
    await deps.onRefreshed?.(rotated, now);
    accessTokens.set(connection.connectionId, { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt });
    return tokens.accessToken;
}
//# sourceMappingURL=providerCredentialVault.js.map