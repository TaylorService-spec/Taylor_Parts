"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServiceConfigError = void 0;
exports.eosApiDomainFor = eosApiDomainFor;
exports.readServiceConfig = readServiceConfig;
exports.createFirebaseTokenVerifier = createFirebaseTokenVerifier;
exports.startEosApi = startEosApi;
// The EOS trusted API service — the process that Render runs.
//
// ════════════════════ WHY THIS IS NOT IN src/adminPolicy ════════════════════
//
// Because this file is where Firebase lives. The policy subsystem's Firebase regression guard is a
// STATIC check over `src/adminPolicy`, and it should stay absolute rather than acquire an
// exception: the moment "no Firebase here" needs an allowlist entry, it stops being a rule and
// becomes a habit.
//
// So identity verification is injected into the transport, and the only concrete verifier is
// below. Replacing the identity provider is a change to this file and nothing else.
//
// ════════════════════ WHAT FIREBASE IS ALLOWED TO SAY ════════════════════
//
// One thing: this bearer token belongs to subject X. It is not asked for a role, a tenant, a
// custom claim or a document, and no answer it gave would be read as authority — every
// authorization question is answered from PostgreSQL by the Administration API.
//
// ════════════════════ DEPLOYED: NONPROD ONLY ════════════════════
//
// Render runs this process as `eos-api-nonprod`, which deploys main automatically. It is NONPROD and
// refuses a production environment label (readServiceConfig below). Firebase remains transitional
// authentication only. The required environment is listed in
// docs/architecture/eos-policy-nonprod-activation.md.
const node_http_1 = require("node:http");
const postgresPolicyRepository_1 = require("../adminPolicy/postgresPolicyRepository");
const policyDatabase_1 = require("../adminPolicy/policyDatabase");
const adminPolicyHttp_1 = require("../adminPolicy/adminPolicyHttp");
const eosOpsHttp_1 = require("../eosOps/eosOpsHttp");
const commercialHttp_1 = require("../eosCommercial/commercialHttp");
const workforceHttp_1 = require("../eosWorkforce/workforceHttp");
const crmHttp_1 = require("../eosCrm/crmHttp");
/** Which domain transport answers a request path. Everything not Operations, Commercial, Workforce or CRM is Administration. */
function eosApiDomainFor(url) {
    const path = (url ?? "").split("?")[0];
    if (path.startsWith("/crm/"))
        return "crm";
    if (path.startsWith("/commercial/"))
        return "commercial";
    if (path.startsWith("/workforce/"))
        return "workforce";
    if (path.startsWith("/operations/"))
        return "operations";
    return "administration";
}
class ServiceConfigError extends Error {
}
exports.ServiceConfigError = ServiceConfigError;
/**
 * Read the service configuration.
 *
 * REFUSES TO START AGAINST PRODUCTION. This tranche is explicitly non-production, and the cheapest
 * enforcement is the service declining to run when its own environment label says otherwise --
 * a check that lives in the process rather than in a deployment convention somebody can forget.
 */
function readServiceConfig(env = process.env) {
    const environment = (env.EOS_ENVIRONMENT ?? "local").trim().toLowerCase();
    if (environment === "production" || environment === "prod") {
        throw new ServiceConfigError("EOS_ENVIRONMENT names production; this service is non-production only in this tranche");
    }
    const rawPort = env.EOS_API_PORT ?? env.PORT ?? "8787";
    const port = Number.parseInt(rawPort, 10);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
        throw new ServiceConfigError(`EOS_API_PORT/PORT "${rawPort}" is not a port`);
    }
    const allowedOrigins = (env.EOS_ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((o) => o.trim())
        .filter((o) => o.length > 0);
    // A wildcard would let any page a signed-in administrator visits read this tenant's policy.
    if (allowedOrigins.includes("*")) {
        throw new ServiceConfigError("EOS_ALLOWED_ORIGINS may not contain '*'");
    }
    return {
        port,
        environment,
        allowedOrigins: Object.freeze(allowedOrigins),
        identityProvider: (env.EOS_IDENTITY_PROVIDER ?? "firebase").trim(),
    };
}
/**
 * Verify a Firebase ID token and return only its subject.
 *
 * `firebase-admin` is imported lazily so that merely importing this module -- which the config test
 * does -- neither initializes an app nor requires credentials to be present.
 */
function createFirebaseTokenVerifier(identityProvider) {
    return async function verify(bearerToken) {
        // A DYNAMIC IMPORT OF A CJS MODULE lands its exports under `.default`, and firebase-admin is
        // CJS. Reaching for `admin.initializeApp` directly gets undefined -- which surfaced here as
        // every token failing to verify with a message that said nothing about the real cause. Both
        // shapes are handled so this does not depend on how the bundler happens to interop.
        const imported = (await import("firebase-admin"));
        const admin = (imported.default ?? imported);
        const app = admin.apps?.length ? admin.app() : admin.initializeApp();
        const decoded = await app.auth().verifyIdToken(bearerToken);
        if (!decoded?.uid)
            throw new Error("token carries no subject");
        // ONLY the uid is taken. Custom claims are deliberately not read: a claim that granted
        // authority would put the authorization model back inside the identity provider.
        return { externalSubject: decoded.uid, identityProvider };
    };
}
/**
 * Start the service.
 *
 * The database is checked BEFORE the socket opens. A service that accepts traffic and then fails
 * every request with "relation does not exist" is indistinguishable, to whatever is routing to it,
 * from one that is working.
 */
async function startEosApi(options = {}) {
    const config = options.config ?? readServiceConfig();
    const pool = (0, policyDatabase_1.getPolicyDatabasePool)();
    await (0, policyDatabase_1.requirePolicyDatabaseReady)(pool);
    const repo = new postgresPolicyRepository_1.PostgresPolicyRepository(pool);
    // ONE verifier for every domain transport: Firebase says only "this token belongs to subject X".
    const verifyToken = options.verifyToken ?? createFirebaseTokenVerifier(config.identityProvider);
    const handler = (0, adminPolicyHttp_1.createAdminPolicyHttpHandler)({
        repo,
        verifyToken,
        allowedOrigins: config.allowedOrigins,
        health: async () => {
            const health = await (0, policyDatabase_1.checkPolicyDatabaseHealth)(pool);
            return {
                environment: config.environment,
                reachable: health.reachable,
                migrated: health.migrated,
                latencyMs: health.latencyMs,
                migrations: health.appliedMigrations.length,
            };
        },
    });
    // A SECOND, domain-separated handler for the Operations transport (Cycle Count's operational
    // capability read, and future bounded operational commands) -- never merged into the
    // Administration operation list. Same repository, same pool: "one database connection", not a
    // second connection or a second service.
    const operationsHandler = (0, eosOpsHttp_1.createOperationsHttpHandler)({
        reader: repo,
        pool,
        verifyToken,
        allowedOrigins: config.allowedOrigins,
    });
    // A THIRD domain-separated handler: the governed PostgreSQL Commercial transport (wave C4). Same repository, same
    // pool, same verifier. No catalog authority is composed, so product-reference commands stay refused.
    const commercialHandler = (0, commercialHttp_1.createCommercialHttpHandler)({
        reader: repo,
        pool,
        verifyToken,
        allowedOrigins: config.allowedOrigins,
    });
    // A FOURTH domain-separated handler: the governed PostgreSQL Employee (Workforce) reads. Same repository, same pool,
    // same verifier. Reads only.
    const workforceHandler = (0, workforceHttp_1.createWorkforceHttpHandler)({
        reader: repo,
        pool,
        verifyToken,
        allowedOrigins: config.allowedOrigins,
    });
    // A FIFTH domain-separated handler: the governed PostgreSQL CRM transport (Account, Contact, customer site). Same
    // repository, same pool, same verifier, same origins. Every operation refuses until the committed CRM writer authority
    // (crm/crmWriterState.ts) is PostgreSQL ACTIVE -- composing the route does not activate PostgreSQL CRM.
    const crmHandler = (0, crmHttp_1.createCrmHttpHandler)({
        reader: repo,
        pool,
        verifyToken,
        allowedOrigins: config.allowedOrigins,
    });
    const server = (0, node_http_1.createServer)((req, res) => {
        const domain = eosApiDomainFor(req.url);
        if (domain === "crm") {
            void crmHandler(req, res);
            return;
        }
        if (domain === "commercial") {
            void commercialHandler(req, res);
            return;
        }
        if (domain === "workforce") {
            void workforceHandler(req, res);
            return;
        }
        if (domain === "operations") {
            void operationsHandler(req, res);
            return;
        }
        void handler(req, res);
    });
    await new Promise((resolve) => server.listen(config.port, resolve));
    return {
        port: config.port,
        async close() {
            // ORDERLY: stop accepting, then let in-flight requests finish, then release the pool. Ending
            // the pool first would fail the requests that are still running.
            await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
            await (0, policyDatabase_1.closePolicyDatabasePool)();
        },
    };
}
//# sourceMappingURL=server.js.map