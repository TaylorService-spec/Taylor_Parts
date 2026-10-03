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
import { createServer } from "node:http";
import { PostgresPolicyRepository } from "../adminPolicy/postgresPolicyRepository";
import {
  checkPolicyDatabaseHealth,
  closePolicyDatabasePool,
  getPolicyDatabasePool,
  requirePolicyDatabaseReady,
} from "../adminPolicy/policyDatabase";
import { createAdminPolicyHttpHandler } from "../adminPolicy/adminPolicyHttp";
import type { TokenVerifier, VerifiedIdentity } from "../adminPolicy/adminPolicyHttp";
import { createOperationsHttpHandler } from "../eosOps/eosOpsHttp";
import { explainEffectiveAccess } from "../eosOps/effectiveAccessExplanation";
import { createMobileLocationScopeBindingAdministration } from "../eosOps/mobileLocationScopeBindingAdministration";
import { createWarehouseBinAdministration, isWarehouseAdminOperation } from "../eosOps/warehouseBinAdministration";
import { createTruckRegistryAdministration, isTruckRegistryAdminOperation } from "../eosOps/truckRegistryAdministration";
import { createFinanceConfigurationAdministration, isFinanceConfigurationOperation } from "../eosFinance/financeConfigurationAdministration";
import { createSystemConfigurationAdministration, isSystemConfigurationOperation } from "../eosOps/systemConfigurationAdministration";
import { createSalesDiscountAuthorityAdministration, isSalesDiscountAuthorityOperation } from "../salesAuthority/salesDiscountAuthority";
import { createCommercialHttpHandler } from "../eosCommercial/commercialHttp";
import { createWorkforceHttpHandler } from "../eosWorkforce/workforceHttp";
import { createCrmHttpHandler } from "../eosCrm/crmHttp";
import { createCatalogHttpHandler, CATALOG_ROUTE } from "../catalogMaster/catalogHttp";
import { createPostgresCatalogReferenceAuthority } from "../catalogAuthority/postgresCatalogReferenceAuthority";
// EOS-issued authentication (docs/architecture/eos-identity-session-foundation.md). ADDITIVE: with none of
// its environment set, the composite verifier below is the Firebase verifier and the auth route is a 404.
import { EOS_AUTH_DISABLED, readEosAuthConfig, type EosAuthRuntime } from "../eosAuth/eosAuthConfig";
import { EosAuthConfigError } from "../eosAuth/eosAccessToken";
import { createCompositeTokenVerifier, createEosAuthHttpHandler } from "../eosAuth/eosAuthHttp";
import { createSelfSchedulingHttpHandler } from "../eosOps/selfSchedulingHttp";
import { SELF_SCHEDULING_ROUTE } from "../eosOps/selfScheduling";
import { startInboundPollingIfEnabled } from "../eosOps/inboundProviderRuntime";

/** Which domain transport answers a request path. Everything not Catalog, Operations, Commercial, Workforce or CRM is Administration. */
export function eosApiDomainFor(url: string | undefined): "auth" | "catalog" | "crm" | "commercial" | "operations" | "workforce" | "selfScheduling" | "administration" {
  const path = (url ?? "").split("?")[0];
  // THE ONE UNAUTHENTICATED ROUTE: customer self-scheduling, authorized by the scheduling token in the body alone.
  if (path === SELF_SCHEDULING_ROUTE || path === `${SELF_SCHEDULING_ROUTE}/`) return "selfScheduling";
  // EOS session issuance. Only the nonprod persona route exists, and only when configured; otherwise 404.
  if (path.startsWith("/auth/")) return "auth";
  if (path.startsWith("/crm/")) return "crm";
  if (path.startsWith("/commercial/")) return "commercial";
  if (path.startsWith("/workforce/")) return "workforce";
  // CATALOG IS CHECKED BEFORE OPERATIONS, and that order is the whole of it: `/operations/catalog`
  // begins with `/operations/`, so the broader test would swallow it and the Operations handler
  // would answer UNKNOWN_OPERATION for every Catalog call -- a mounted route that is unreachable,
  // which reads exactly like "the Catalog API does not work".
  if (path === CATALOG_ROUTE || path.startsWith(`${CATALOG_ROUTE}/`)) return "catalog";
  if (path.startsWith("/operations/")) return "operations";
  return "administration";
}

/**
 * The environment this service reads. Every one is injected; none is committed.
 *
 *   DATABASE_URL              the policy database. Required.
 *   EOS_ENVIRONMENT           a label -- "local", "nonprod". REFUSED if it says production.
 *   EOS_API_PORT              listen port. Render supplies PORT; both are read.
 *   EOS_ALLOWED_ORIGINS       comma-separated browser origins. No wildcard.
 *   EOS_IDENTITY_PROVIDER     defaults to "firebase". May NOT be "eos": a Firebase uid must never be
 *                             looked up as an EOS subject.
 *   EOS_AUTH_*, EOS_PERSONA_ISSUER_CREDENTIAL_SHA256   EOS-issued authentication; see eosAuth/eosAuthConfig.ts.
 *   FIREBASE_AUTH_EMULATOR_HOST  present only for local development; see below.
 */
export interface ServiceConfig {
  readonly port: number;
  readonly environment: string;
  readonly allowedOrigins: readonly string[];
  readonly identityProvider: string;
  /** EOS-issued authentication. Absent = disabled (Firebase-only, exactly as before). */
  readonly eosAuth?: EosAuthRuntime;
}

export class ServiceConfigError extends Error {}

/**
 * Read the service configuration.
 *
 * REFUSES TO START AGAINST PRODUCTION. This tranche is explicitly non-production, and the cheapest
 * enforcement is the service declining to run when its own environment label says otherwise --
 * a check that lives in the process rather than in a deployment convention somebody can forget.
 */
export function readServiceConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const environment = (env.EOS_ENVIRONMENT ?? "local").trim().toLowerCase();
  if (environment === "production" || environment === "prod") {
    throw new ServiceConfigError(
      "EOS_ENVIRONMENT names production; this service is non-production only in this tranche",
    );
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

  let eosAuth: EosAuthRuntime;
  try {
    eosAuth = readEosAuthConfig(env, environment);
  } catch (err) {
    // The message names the variable, never its value.
    if (err instanceof EosAuthConfigError) throw new ServiceConfigError(err.message);
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
export function createFirebaseTokenVerifier(identityProvider: string): TokenVerifier {
  return async function verify(bearerToken: string): Promise<VerifiedIdentity> {
    // A DYNAMIC IMPORT OF A CJS MODULE lands its exports under `.default`, and firebase-admin is
    // CJS. Reaching for `admin.initializeApp` directly gets undefined -- which surfaced here as
    // every token failing to verify with a message that said nothing about the real cause. Both
    // shapes are handled so this does not depend on how the bundler happens to interop.
    const imported = (await import("firebase-admin")) as unknown as Record<string, unknown>;
    const admin = ((imported.default ?? imported) as typeof import("firebase-admin"));
    const app = admin.apps?.length ? admin.app() : admin.initializeApp();
    const decoded = await app.auth().verifyIdToken(bearerToken);
    if (!decoded?.uid) throw new Error("token carries no subject");
    // ONLY the uid is taken. Custom claims are deliberately not read: a claim that granted
    // authority would put the authorization model back inside the identity provider.
    return { externalSubject: decoded.uid, identityProvider };
  };
}

export interface StartedService {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Start the service.
 *
 * The database is checked BEFORE the socket opens. A service that accepts traffic and then fails
 * every request with "relation does not exist" is indistinguishable, to whatever is routing to it,
 * from one that is working.
 */
export async function startEosApi(
  options: {
    readonly config?: ServiceConfig;
    /** Replaces the WHOLE verifier (existing tests). */
    readonly verifyToken?: TokenVerifier;
    /** Replaces only the Firebase half of the composite verifier (tests: a fake Firebase, no network). */
    readonly firebaseVerifyToken?: TokenVerifier;
  } = {},
): Promise<StartedService> {
  const config = options.config ?? readServiceConfig();
  const pool = getPolicyDatabasePool();
  await requirePolicyDatabaseReady(pool);

  const repo = new PostgresPolicyRepository(pool);
  // ONE verifier for every domain transport. It says only "this token belongs to (provider, subject)":
  // an EOS-issued token -> ("eos", sub); anything else -> Firebase, unchanged -> ("firebase", uid).
  const eosAuth = config.eosAuth ?? EOS_AUTH_DISABLED;
  const verifyToken = options.verifyToken ?? createCompositeTokenVerifier({
    eos: eosAuth,
    firebase: options.firebaseVerifyToken ?? createFirebaseTokenVerifier(config.identityProvider),
  });
  // The EOS session route. A 404 unless nonprod AND the persona issuer is fully configured.
  const authHandler = createEosAuthHttpHandler({ repo, auth: eosAuth, environment: config.environment });
  const handler = createAdminPolicyHttpHandler({
    repo,
    // The runtime evaluator, over the one shared pool, for the explainEffectiveAccess read.
    explainEffectiveAccess: (tenantId, principalId) => explainEffectiveAccess(repo, pool, { tenantId, principalId }),
    // DQ-029: the Administration configuration operations (truck location -> warehouse scope), over the same pool.
    // Gated in executeAdminOperation on inventory.location.scopeBinding.manage before this is ever reached.
    // DQ-E: Warehouse and Bin master administration (warehouse.record.manage), routed by operation name.
    // OD-T7: truck / MOBILE-location registry administration (inventory.truckRegistry.manage).
    // #203: finance configuration -- accounting destinations, payment terms (finance.configuration.manage).
    // #204: System Configuration -- company settings by registry (admin.systemConfiguration.manage); Employee Sales
    // Authority -- each Sales user's maximum customer discount (sales.discountAuthority.manage).
    configuration: (() => {
      const bindings = createMobileLocationScopeBindingAdministration(pool);
      const warehouses = createWarehouseBinAdministration(pool);
      const trucks = createTruckRegistryAdministration(pool);
      const finance = createFinanceConfigurationAdministration(pool);
      const system = createSystemConfigurationAdministration(pool);
      const discounts = createSalesDiscountAuthorityAdministration(pool);
      return (operation, actor, input, reason) => (isWarehouseAdminOperation(operation) ? warehouses
        : isTruckRegistryAdminOperation(operation) ? trucks : isFinanceConfigurationOperation(operation) ? finance
          : isSystemConfigurationOperation(operation) ? system : isSalesDiscountAuthorityOperation(operation) ? discounts : bindings)(operation, actor, input, reason);
    })(),
    verifyToken,
    allowedOrigins: config.allowedOrigins,
    health: async () => {
      const health = await checkPolicyDatabaseHealth(pool);
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
  const operationsHandler = createOperationsHttpHandler({
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
  const catalogReferenceAuthority = createPostgresCatalogReferenceAuthority();

  // A THIRD domain-separated handler: the governed PostgreSQL Commercial transport (wave C4). Same repository, same
  // pool, same verifier -- and now the shared catalog authority, so product-reference commands resolve.
  const commercialHandler = createCommercialHttpHandler({
    reader: repo,
    pool,
    verifyToken,
    allowedOrigins: config.allowedOrigins,
    catalog: catalogReferenceAuthority,
  });

  // A FOURTH domain-separated handler: the governed PostgreSQL Employee (Workforce) reads. Same repository, same pool,
  // same verifier. Reads only.
  const workforceHandler = createWorkforceHttpHandler({
    reader: repo,
    pool,
    verifyToken,
    allowedOrigins: config.allowedOrigins,
  });

  // A FIFTH domain-separated handler: the governed PostgreSQL CRM transport (Account, Contact, customer site). Same
  // repository, same pool, same verifier, same origins. Every operation refuses until the committed CRM writer authority
  // (crm/crmWriterState.ts) is PostgreSQL ACTIVE -- composing the route does not activate PostgreSQL CRM.
  const crmHandler = createCrmHttpHandler({
    reader: repo,
    pool,
    verifyToken,
    allowedOrigins: config.allowedOrigins,
  });

  // A SIXTH domain-separated handler: the governed PostgreSQL Catalog transport (Part Master, Part
  // identity, Equipment Model). Same repository, same pool, same verifier, same origins. Mounting a
  // route does not activate anything: every operation still checks the governed capability, and the
  // Firestore Catalog writers remain the committed authority until the cutover moves them.
  const catalogHandler = createCatalogHttpHandler({
    reader: repo,
    pool,
    verifyToken,
    allowedOrigins: config.allowedOrigins,
  });

  // A SEVENTH handler, and the only unauthenticated one: customer self-scheduling (selfScheduling.ts). The token in the
  // body authorizes two operations on one Work Order; the booking runs under the issuing Principal's re-resolved authority.
  const selfSchedulingHandler = createSelfSchedulingHttpHandler({ pool, reader: repo, allowedOrigins: config.allowedOrigins });

  // THE EOS INBOUND MAIL POLLER (opt-in). Off unless EOS_INBOUND_POLLING=enabled; each tick runs one delivery cycle, and
  // a cluster-wide advisory lock makes overlapping cycles (two instances, a slow tick) a no-op. The same cycle is the
  // Render job scripts/pollInboundMailboxes.mjs.
  const poller = startInboundPollingIfEnabled(pool);

  const server = createServer((req, res) => {
    const domain = eosApiDomainFor(req.url);
    if (domain === "selfScheduling") {
      void selfSchedulingHandler(req as never, res as never);
      return;
    }
    if (domain === "auth") {
      void authHandler(req, res);
      return;
    }
    if (domain === "catalog") {
      void catalogHandler(req as never, res as never);
      return;
    }
    if (domain === "crm") {
      void crmHandler(req as never, res as never);
      return;
    }
    if (domain === "commercial") {
      void commercialHandler(req as never, res as never);
      return;
    }
    if (domain === "workforce") {
      void workforceHandler(req as never, res as never);
      return;
    }
    if (domain === "operations") {
      void operationsHandler(req as never, res as never);
      return;
    }
    void handler(req as never, res as never);
  });

  await new Promise<void>((resolve) => server.listen(config.port, resolve));
  const address = server.address();
  const boundPort = address && typeof address === "object" ? address.port : config.port;

  return {
    port: boundPort,
    async close() {
      // ORDERLY: stop accepting, then let in-flight requests finish, then release the pool. Ending
      // the pool first would fail the requests that are still running.
      if (poller) clearInterval(poller);
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await closePolicyDatabasePool();
    },
  };
}
