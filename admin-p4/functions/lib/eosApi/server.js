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
const effectiveAccessExplanation_1 = require("../eosOps/effectiveAccessExplanation");
const mobileLocationScopeBindingAdministration_1 = require("../eosOps/mobileLocationScopeBindingAdministration");
const warehouseBinAdministration_1 = require("../eosOps/warehouseBinAdministration");
const truckRegistryAdministration_1 = require("../eosOps/truckRegistryAdministration");
const financeConfigurationAdministration_1 = require("../eosFinance/financeConfigurationAdministration");
const systemConfigurationAdministration_1 = require("../eosOps/systemConfigurationAdministration");
const salesDiscountAuthority_1 = require("../salesAuthority/salesDiscountAuthority");
const commercialHttp_1 = require("../eosCommercial/commercialHttp");
const workforceHttp_1 = require("../eosWorkforce/workforceHttp");
const crmHttp_1 = require("../eosCrm/crmHttp");
const catalogHttp_1 = require("../catalogMaster/catalogHttp");
const postgresCatalogReferenceAuthority_1 = require("../catalogAuthority/postgresCatalogReferenceAuthority");
// EOS-issued authentication (docs/architecture/eos-identity-session-foundation.md). ADDITIVE: with none of
// its environment set, the composite verifier below is the Firebase verifier and the auth route is a 404.
const eosAuthConfig_1 = require("../eosAuth/eosAuthConfig");
const eosAccessToken_1 = require("../eosAuth/eosAccessToken");
const eosAuthHttp_1 = require("../eosAuth/eosAuthHttp");
const selfSchedulingHttp_1 = require("../eosOps/selfSchedulingHttp");
const selfScheduling_1 = require("../eosOps/selfScheduling");
const inboundProviderRuntime_1 = require("../eosOps/inboundProviderRuntime");
/** Which domain transport answers a request path. Everything not Catalog, Operations, Commercial, Workforce or CRM is Administration. */
function eosApiDomainFor(url) {
    const path = (url ?? "").split("?")[0];
    // THE ONE UNAUTHENTICATED ROUTE: customer self-scheduling, authorized by the scheduling token in the body alone.
    if (path === selfScheduling_1.SELF_SCHEDULING_ROUTE || path === `${selfScheduling_1.SELF_SCHEDULING_ROUTE}/`)
        return "selfScheduling";
    // EOS session issuance. Only the nonprod persona route exists, and only when configured; otherwise 404.
    if (path.startsWith("/auth/"))
        return "auth";
    if (path.startsWith("/crm/"))
        return "crm";
    if (path.startsWith("/commercial/"))
        return "commercial";
    if (path.startsWith("/workforce/"))
        return "workforce";
    // CATALOG IS CHECKED BEFORE OPERATIONS, and that order is the whole of it: `/operations/catalog`
    // begins with `/operations/`, so the broader test would swallow it and the Operations handler
    // would answer UNKNOWN_OPERATION for every Catalog call -- a mounted route that is unreachable,
    // which reads exactly like "the Catalog API does not work".
    if (path === catalogHttp_1.CATALOG_ROUTE || path.startsWith(`${catalogHttp_1.CATALOG_ROUTE}/`))
        return "catalog";
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
    // The Firebase verifier stamps THIS provider on the uid it returns. Stamping "eos" would let a Firebase
    // uid be resolved through an EOS identity binding -- one provider's subject answering as another's.
    if ((env.EOS_IDENTITY_PROVIDER ?? "").trim() === "eos") {
        throw new ServiceConfigError("EOS_IDENTITY_PROVIDER may not be 'eos'; EOS identities come only from the EOS verifier");
    }
    let eosAuth;
    try {
        eosAuth = (0, eosAuthConfig_1.readEosAuthConfig)(env, environment);
    }
    catch (err) {
        // The message names the variable, never its value.
        if (err instanceof eosAccessToken_1.EosAuthConfigError)
            throw new ServiceConfigError(err.message);
        throw err;
    }
    return {
        port,
        environment,
        allowedOrigins: Object.freeze(allowedOrigins),
        identityProvider: (env.EOS_IDENTITY_PROVIDER ?? "firebase").trim(),
        eosAuth,
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
    // ONE verifier for every domain transport. It says only "this token belongs to (provider, subject)":
    // an EOS-issued token -> ("eos", sub); anything else -> Firebase, unchanged -> ("firebase", uid).
    const eosAuth = config.eosAuth ?? eosAuthConfig_1.EOS_AUTH_DISABLED;
    const verifyToken = options.verifyToken ?? (0, eosAuthHttp_1.createCompositeTokenVerifier)({
        eos: eosAuth,
        firebase: options.firebaseVerifyToken ?? createFirebaseTokenVerifier(config.identityProvider),
    });
    // The EOS session route. A 404 unless nonprod AND the persona issuer is fully configured.
    const authHandler = (0, eosAuthHttp_1.createEosAuthHttpHandler)({ repo, auth: eosAuth, environment: config.environment });
    const handler = (0, adminPolicyHttp_1.createAdminPolicyHttpHandler)({
        repo,
        // The runtime evaluator, over the one shared pool, for the explainEffectiveAccess read.
        explainEffectiveAccess: (tenantId, principalId) => (0, effectiveAccessExplanation_1.explainEffectiveAccess)(repo, pool, { tenantId, principalId }),
        // DQ-029: the Administration configuration operations (truck location -> warehouse scope), over the same pool.
        // Gated in executeAdminOperation on inventory.location.scopeBinding.manage before this is ever reached.
        // DQ-E: Warehouse and Bin master administration (warehouse.record.manage), routed by operation name.
        // OD-T7: truck / MOBILE-location registry administration (inventory.truckRegistry.manage).
        // #203: finance configuration -- accounting destinations, payment terms (finance.configuration.manage).
        // #204: System Configuration -- company settings by registry (admin.systemConfiguration.manage); Employee Sales
        // Authority -- each Sales user's maximum customer discount (sales.discountAuthority.manage).
        configuration: (() => {
            const bindings = (0, mobileLocationScopeBindingAdministration_1.createMobileLocationScopeBindingAdministration)(pool);
            const warehouses = (0, warehouseBinAdministration_1.createWarehouseBinAdministration)(pool);
            const trucks = (0, truckRegistryAdministration_1.createTruckRegistryAdministration)(pool);
            const finance = (0, financeConfigurationAdministration_1.createFinanceConfigurationAdministration)(pool);
            const system = (0, systemConfigurationAdministration_1.createSystemConfigurationAdministration)(pool);
            const discounts = (0, salesDiscountAuthority_1.createSalesDiscountAuthorityAdministration)(pool);
            return (operation, actor, input, reason) => ((0, warehouseBinAdministration_1.isWarehouseAdminOperation)(operation) ? warehouses
                : (0, truckRegistryAdministration_1.isTruckRegistryAdminOperation)(operation) ? trucks : (0, financeConfigurationAdministration_1.isFinanceConfigurationOperation)(operation) ? finance
                    : (0, systemConfigurationAdministration_1.isSystemConfigurationOperation)(operation) ? system : (0, salesDiscountAuthority_1.isSalesDiscountAuthorityOperation)(operation) ? discounts : bindings)(operation, actor, input, reason);
        })(),
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
    // THE GOVERNED POSTGRESQL CATALOG AUTHORITY, composed ONCE and shared.
    //
    // Commercial's commands already ask it whether a PART or EQUIPMENT_MODEL line reference exists,
    // INSIDE their own PostgreSQL transaction. Until now nothing was composed, so every
    // product-reference command failed closed with CATALOG_AUTHORITY_UNAVAILABLE -- correctly, because
    // no authority existed to answer. One now does, so the refusal goes.
    //
    // It is passed as a REPOSITORY, not as an HTTP client. Commercial must not call
    // `/operations/catalog` over the network: that would validate a reference in one transaction and
    // commit the agreement in another, with nothing making the two agree, and it would turn one
    // Render handler into a client of another.
    const catalogReferenceAuthority = (0, postgresCatalogReferenceAuthority_1.createPostgresCatalogReferenceAuthority)();
    // A THIRD domain-separated handler: the governed PostgreSQL Commercial transport (wave C4). Same repository, same
    // pool, same verifier -- and now the shared catalog authority, so product-reference commands resolve.
    const commercialHandler = (0, commercialHttp_1.createCommercialHttpHandler)({
        reader: repo,
        pool,
        verifyToken,
        allowedOrigins: config.allowedOrigins,
        catalog: catalogReferenceAuthority,
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
    // A SIXTH domain-separated handler: the governed PostgreSQL Catalog transport (Part Master, Part
    // identity, Equipment Model). Same repository, same pool, same verifier, same origins. Mounting a
    // route does not activate anything: every operation still checks the governed capability, and the
    // Firestore Catalog writers remain the committed authority until the cutover moves them.
    const catalogHandler = (0, catalogHttp_1.createCatalogHttpHandler)({
        reader: repo,
        pool,
        verifyToken,
        allowedOrigins: config.allowedOrigins,
    });
    // A SEVENTH handler, and the only unauthenticated one: customer self-scheduling (selfScheduling.ts). The token in the
    // body authorizes two operations on one Work Order; the booking runs under the issuing Principal's re-resolved authority.
    const selfSchedulingHandler = (0, selfSchedulingHttp_1.createSelfSchedulingHttpHandler)({ pool, reader: repo, allowedOrigins: config.allowedOrigins });
    // THE EOS INBOUND MAIL POLLER (opt-in). Off unless EOS_INBOUND_POLLING=enabled; each tick runs one delivery cycle, and
    // a cluster-wide advisory lock makes overlapping cycles (two instances, a slow tick) a no-op. The same cycle is the
    // Render job scripts/pollInboundMailboxes.mjs.
    const poller = (0, inboundProviderRuntime_1.startInboundPollingIfEnabled)(pool);
    const server = (0, node_http_1.createServer)((req, res) => {
        const domain = eosApiDomainFor(req.url);
        if (domain === "selfScheduling") {
            void selfSchedulingHandler(req, res);
            return;
        }
        if (domain === "auth") {
            void authHandler(req, res);
            return;
        }
        if (domain === "catalog") {
            void catalogHandler(req, res);
            return;
        }
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
    const address = server.address();
    const boundPort = address && typeof address === "object" ? address.port : config.port;
    return {
        port: boundPort,
        async close() {
            // ORDERLY: stop accepting, then let in-flight requests finish, then release the pool. Ending
            // the pool first would fail the requests that are still running.
            if (poller)
                clearInterval(poller);
            await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
            await (0, policyDatabase_1.closePolicyDatabasePool)();
        },
    };
}
//# sourceMappingURL=server.js.map