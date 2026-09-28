// GOVERNED RUNTIME AUTHORITY — the Firebase-hosted runtime asks PostgreSQL Administration who the caller is and what
// the caller may do (Pass 11 Fix Wave 1, 2026-09-27).
//
// ════════════════════ THE DEFECT THIS CLOSES (P11R-06, LEGACY_RUNTIME_NOT_CUT_OVER) ════════════════════
//
// Administration (PostgreSQL `eos_policy`) is the permission control plane. The deployed Firebase callables did not
// ask it: `effectiveAccessFeed.resolveEffectiveAccess` resolved every caller from Firestore `users/{uid}` +
// `roleAssignments` against the code-defined compatibility Roles, and every client-direct Firestore read was gated by
// Rules helpers over `users/{uid}.role`. So a Security Role granted in Administration changed nothing a Sales, Parts,
// Warehouse or Service persona could actually read.
//
// ════════════════════ WHAT THIS MODULE IS ════════════════════
//
// ONE resolution of the calling Principal, by the SAME resolver every EOS transport composes
// (`resolveOperationalContext` over `eos_policy`, conditions from `capability_grant_conditions`, direct exceptions
// from `principal_capabilities`). It adds no permission model: the flat set, the conditionally-held set, the scoped
// holdings and the entitlement provider are exactly what Administration's Effective Access explains.
//
// The caller's identity is the Firebase-verified `request.auth.uid`, presented as the `firebase` external subject --
// the same (identityProvider, externalSubject) pair the Render EOS API resolves from a verified bearer token.
//
// ════════════════════ WHERE IT IS ACTIVE ════════════════════
//
// Only in an environment that DECLARES it, keyed by the runtime's own trusted project identity (GCLOUD_PROJECT) --
// never by a caller, never by an option on a request. Production is refused unconditionally, whatever the list
// says, exactly like `resolveCapabilityOverrides`' production hard-block. Where it is not active, nothing here runs
// and the legacy path is untouched.
//
// FAIL CLOSED. Where it IS active, an unreachable policy database, an unknown Principal, a disabled Principal or an
// ambiguous tenant resolve to `UNAVAILABLE` / `NOT_A_PRINCIPAL`, and every consumer DENIES. There is no fallback to
// Firestore role records: a fallback would be the second permission model this module exists to remove.
import type { Pool, PoolClient } from "pg";
import { getPolicyDatabasePool } from "../adminPolicy/policyDatabase";
import { PostgresPolicyRepository } from "../adminPolicy/postgresPolicyRepository";
import { PrincipalContextError } from "../adminPolicy/principalContext";
import { resolveOperationalContext } from "../eosOps/capabilityAuthority";
import { postgresGrantConditionProvider, type OperationalActor } from "../eosOps/entitledActionAuthority";
import { postgresContextualReader, type ContextualReader } from "../eosOps/contextualAuthorization";

/** The identity provider the Firebase runtime's callers authenticate through. Same value the EOS API uses. */
export const FIREBASE_IDENTITY_PROVIDER = "firebase";

/**
 * Environments whose Firebase runtime takes its authority from PostgreSQL Administration.
 *
 * Mirrors `governedRuntimeAuthority: true` in config/environments.json (a drift test holds the two equal). Only the
 * nonprod platform sandbox, whose EOS API and policy database are the Pass 10 control plane. Certification is frozen
 * (Owner Decision #179) and production is hard-blocked below.
 */
export const GOVERNED_RUNTIME_AUTHORITY_PROJECTS: ReadonlySet<string> = new Set(["eos-platform-sandbox"]);

/** Project ids that are production. Refused even if someone adds one to the list above. */
const PRODUCTION_PROJECTS: ReadonlySet<string> = new Set(["taylor-parts"]);

/** Is governed runtime authority active for this deployed project? Trusted runtime identity only. */
export function isGovernedRuntimeAuthorityActive(
  projectId: string | null | undefined = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? null,
): boolean {
  if (typeof projectId !== "string" || projectId.length === 0) return false;
  if (PRODUCTION_PROJECTS.has(projectId)) return false;
  return GOVERNED_RUNTIME_AUTHORITY_PROJECTS.has(projectId);
}

export type GovernedCallerAccess =
  | {
      readonly status: "RESOLVED";
      readonly tenantId: string;
      readonly principalId: string;
      /** Every capability key Administration governs (the `eos_policy.capabilities` catalog). */
      readonly governedKeys: ReadonlySet<string>;
      /** The actor every entitled decision takes: flat set, conditioned set, scoped holdings, entitlements. */
      readonly actor: OperationalActor;
      /** PostgreSQL context reader (Employee link, Work Eligibility, Operational Scope, PG record assignment). */
      readonly reader: ContextualReader;
    }
  | { readonly status: "NOT_A_PRINCIPAL"; readonly refusal: string }
  | { readonly status: "UNAVAILABLE"; readonly detail: string };

/** Resolve the calling Firebase subject's governed access. Injectable so tests never need a live database. */
export type GovernedAccessResolver = (firebaseUid: string) => Promise<GovernedCallerAccess>;

/** Build the resolver over one pool. Exported for the PostgreSQL-backed tests. */
export function postgresGovernedAccessResolver(pool: Pool): GovernedAccessResolver {
  const repo = new PostgresPolicyRepository(pool);
  return async (firebaseUid) => {
    if (typeof firebaseUid !== "string" || firebaseUid.length === 0) {
      return Object.freeze({ status: "NOT_A_PRINCIPAL" as const, refusal: "NO_SUBJECT" });
    }
    try {
      const [ctx, catalog] = await Promise.all([
        resolveOperationalContext(repo, pool, {
          identityProvider: FIREBASE_IDENTITY_PROVIDER,
          externalSubject: firebaseUid,
          requestedTenantId: null,
        }, postgresGrantConditionProvider(pool)),
        repo.listCapabilities(),
      ]);
      const actor: OperationalActor = Object.freeze({
        tenantId: ctx.principalContext.tenantId,
        principalId: ctx.principalContext.uid,
        capabilities: ctx.capabilities,
        conditionallyHeld: ctx.conditionallyHeld,
        scopedHeld: ctx.scopedHeld,
        entitlements: ctx.entitlements,
      });
      return Object.freeze({
        status: "RESOLVED" as const,
        tenantId: ctx.principalContext.tenantId,
        principalId: ctx.principalContext.uid,
        governedKeys: new Set(catalog.map((c) => c.key)),
        actor,
        reader: postgresContextualReader(pool as unknown as Pick<PoolClient, "query">),
      });
    } catch (err) {
      if (err instanceof PrincipalContextError) {
        return Object.freeze({ status: "NOT_A_PRINCIPAL" as const, refusal: err.refusal });
      }
      // Never the connection string: the policy database module already redacts, and this logs only a class name.
      // eslint-disable-next-line no-console
      console.error("[governedRuntimeAuthority] governed access unavailable:", (err as Error)?.name ?? "Error");
      return Object.freeze({ status: "UNAVAILABLE" as const, detail: "governed access could not be resolved" });
    }
  };
}

let defaultResolver: GovernedAccessResolver | null = null;
let testResolver: GovernedAccessResolver | null = null;

/**
 * TEST-ONLY dependency injection for suites that exercise a callable end to end (the Firestore-emulator suites) and
 * therefore cannot pass `options.governed`. It replaces WHERE governed access is read from -- never WHETHER governed
 * authority applies (still the runtime project identity) and never how a decision is taken. Production code never
 * calls it; `null` restores the PostgreSQL resolver.
 */
export function __setGovernedAccessResolverForTest(resolver: GovernedAccessResolver | null): void {
  testResolver = resolver;
}

/** The production resolver: the shared policy-database pool (DATABASE_URL), composed lazily on first use. */
export function defaultGovernedAccessResolver(): GovernedAccessResolver {
  if (testResolver) return testResolver;
  if (defaultResolver) return defaultResolver;
  return async (uid) => {
    try {
      defaultResolver ??= postgresGovernedAccessResolver(getPolicyDatabasePool());
    } catch {
      // No DATABASE_URL in this runtime: governed authority is declared but not composable. Deny, never fall back.
      // eslint-disable-next-line no-console
      console.error("[governedRuntimeAuthority] policy database is not configured for this runtime");
      return Object.freeze({ status: "UNAVAILABLE" as const, detail: "policy database is not configured" });
    }
    return defaultResolver(uid);
  };
}
