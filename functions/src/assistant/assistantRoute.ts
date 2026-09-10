// THE ASSISTANT HTTP ROUTE. `POST /assistant/ask`, mounted into the existing Render `eosApi` server.
//
// ============================ SAME SHAPE AS adminPolicyHttp.ts, ON PURPOSE ============================
//
// A pure `handleAssistantRequest`-shaped function that takes a request-like value and returns a
// response-like value, with identity and every other dependency INJECTED. No socket, no
// `firebase-admin`, no Firestore type appears anywhere in this file -- the same transport discipline
// `adminPolicyHttp.ts` already holds, applied to a second route on the same process.
//
// ============================ THE FULL DEPENDENCY CHAIN, IN ORDER ============================
//
//   1. verify the bearer token             -> a Firebase subject. IDENTITY ONLY.
//   2. resolvePrincipalContext (Postgres)  -> EOS principal id + TENANT. Identity/tenant-boundary
//      context only -- see the note below on what the Postgres policy store may and may not answer.
//   3. resolve OPERATIONAL Role ids via `AssistantOperationalAuthoritySource`, NOT via the Postgres
//      policy Role -- see that file for why the two must stay separate.
//   4. map operational Role ids to capabilities -> EffectiveAuthority (pure, static catalog data;
//      the SAME catalog `assistantAuthorization.ts` has always documented).
//   5. validate the client-supplied context, binding it to the VERIFIED actor/tenant.
//   6. if the surface needs business data and either the reader or the authority source is not
//      configured, refuse EXPLICITLY -- never silently, never by falling through to a narrower
//      answer, and never by substituting the Postgres policy Role for the missing source.
//   7. hand off to the existing, unmodified `handleAssistantRequest` gateway.
//
// ============================ WHAT POSTGRES MAY AND MAY NOT ANSWER HERE ============================
//
// `resolvePrincipalContext` is used ONLY for step 2: which EOS principal this bearer token names, and
// which tenant they belong to. Its OTHER return value -- `heldRoleKeys`, the Roles the Postgres policy
// store has recorded -- is deliberately NEVER read by this file. That store today governs the
// Administration policy subsystem (Objects, Fields, the Administration screens); it does not yet
// govern Work Orders, Inventory, Purchasing or Sales, and using it as a business-authority shortcut
// here would be a second, easier, unreviewed path to the same data `assistantAuthorization.ts`
// already gates. `assistantOperationalAuthoritySource.ts` is the ONLY place business Role ids may
// come from, and it is not yet bound -- see step 6.
import { resolvePrincipalContext, PrincipalContextError } from "../adminPolicy/principalContext";
import type { PolicyReader } from "../adminPolicy/policyRepository";
import type { TokenVerifier, VerifiedIdentity } from "../adminPolicy/adminPolicyHttp";
import { GOVERNED_BUSINESS_ROLES } from "../access/governedBusinessRoles";
import { COMPATIBILITY_ROLES } from "../access/compatibilityRoles";
import { PERMISSION_CATALOG } from "../access/permissionCatalog";
import type { PermissionId } from "../types/access";
import type { EffectiveAuthority, RoleResolver } from "./assistantAuthorization";
import { resolveEffectiveAuthority } from "./assistantAuthorization";
import { validateAssistantContext } from "./assistantContext";
import type { AssistantSurface } from "./assistantContext";
import { handleAssistantRequest } from "./assistantGateway";
import type { AssistantToolRegistry } from "./assistantToolRegistry";
import type { AiProvider } from "./aiProvider";
import type { AssistantOperationalAuthoritySource } from "./assistantOperationalAuthoritySource";

export type { TokenVerifier, VerifiedIdentity };

/** Role id -> permission ids, built once from the two static catalogs. Pure; no I/O. */
const ROLE_PERMISSIONS: ReadonlyMap<string, readonly PermissionId[]> = new Map([
  ...Object.values(GOVERNED_BUSINESS_ROLES).map((r) => [r.id, r.permissions] as const),
  ...Object.values(COMPATIBILITY_ROLES).map((r) => [r.id, r.permissions] as const),
]);

export const assistantRoleResolver: RoleResolver = {
  permissionsForRole(roleId: string): readonly PermissionId[] {
    return ROLE_PERMISSIONS.get(roleId) ?? [];
  },
};

/**
 * The catalog's OWN `active` flag, with no environment activation applied.
 *
 * This is HALF the answer, deliberately exported under a name that says so: a capability the catalog
 * marks `active:false` may still be live in THIS environment through
 * `resolveRuntimeCapabilityOverrides()` (functions/src/access/environmentCapabilityOverrides.ts) --
 * the canonical per-environment activation seam every other runtime consumer in this repo already
 * reads through. Recreating that logic here, or answering from the catalog alone, would let the
 * assistant disagree with the rest of EOS about which capability is live -- `performance.goal.read`
 * is a concrete case: catalog `active:false`, sandbox-activated.
 *
 * The composition root (eosApi/server.ts) is responsible for unioning this with
 * `resolveRuntimeCapabilityOverrides()` and injecting the result as `AssistantHttpDeps.activeCapabilities`
 * -- never this constant alone.
 */
export const CATALOG_ACTIVE_CAPABILITIES: ReadonlySet<PermissionId> = new Set(
  PERMISSION_CATALOG.filter((p) => p.active !== false).map((p) => p.id),
);

/** Surfaces whose tools read business data through `AssistantBusinessDataReader`. */
const BUSINESS_DATA_SURFACES: ReadonlySet<AssistantSurface> = new Set(["DASHBOARD"]);

export interface AssistantHttpDeps {
  readonly policyReader: PolicyReader;
  readonly verifyToken: TokenVerifier;
  readonly registry: AssistantToolRegistry;
  readonly provider: AiProvider | null;
  /** True only once a real `AssistantBusinessDataReader` has been bound into the registry's tools. */
  readonly businessDataReaderConfigured: boolean;
  /**
   * The ONLY source of operational Role ids this route may use. `null` means not yet bound -- see
   * `assistantOperationalAuthoritySource.ts`. Never substitute the Postgres policy Role for this.
   */
  readonly operationalAuthoritySource: AssistantOperationalAuthoritySource | null;
  /**
   * The canonical active-capability set for THIS environment -- catalog `active:true` ids UNION
   * `resolveRuntimeCapabilityOverrides()`. Injected rather than computed here so a test can supply an
   * explicit set without depending on `process.env.GCLOUD_PROJECT`/the real environment registry.
   */
  readonly activeCapabilities: ReadonlySet<PermissionId>;
  readonly now?: () => number;
  readonly maxOutputTokens?: number;
}

export interface HttpRequestLike {
  readonly method?: string;
  readonly url?: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body?: string;
}

export interface HttpResponseShape {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

function baseHeaders(origin: string | null): Record<string, string> {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
  };
}

const json = (status: number, body: unknown, origin: string | null): HttpResponseShape => ({
  status,
  headers: baseHeaders(origin),
  body: JSON.stringify(body),
});

const header = (req: HttpRequestLike, name: string) => req.headers?.[name] ?? req.headers?.[name.toLowerCase()];

function singleHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function bearerToken(value: string | string[] | undefined): string | null {
  const raw = singleHeader(value);
  if (!raw) return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match ? match[1].trim() : null;
}

function pathOf(url: string): string {
  const idx = url.indexOf("?");
  return idx >= 0 ? url.slice(0, idx) : url;
}

function parseBody(body: string | undefined): Record<string, unknown> {
  if (!body || body.trim().length === 0) return {};
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
  return parsed as Record<string, unknown>;
}

const PRINCIPAL_REFUSAL_STATUS: Readonly<Record<string, number>> = Object.freeze({
  UNKNOWN_PRINCIPAL: 401,
  PRINCIPAL_DISABLED: 403,
  NO_TENANT_MEMBERSHIP: 403,
  TENANT_NOT_A_MEMBERSHIP: 403,
  AMBIGUOUS_TENANT: 400,
  TENANT_NOT_ACTIVE: 403,
});

/** Handles exactly `POST /assistant/ask`. Every other path/method is left to the caller (404). */
export async function handleAssistantHttpRequest(
  deps: AssistantHttpDeps,
  request: HttpRequestLike,
  allowedOrigins: readonly string[] = [],
): Promise<HttpResponseShape | null> {
  const method = (request.method ?? "GET").toUpperCase();
  const path = pathOf(request.url ?? "/");
  if (path !== "/assistant/ask") return null;

  const origin = (() => {
    const requested = singleHeader(header(request, "origin"));
    return requested && allowedOrigins.includes(requested) ? requested : null;
  })();

  if (method === "OPTIONS") {
    return {
      status: 204,
      headers: {
        ...baseHeaders(origin),
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "authorization, content-type, x-eos-tenant",
        "access-control-max-age": "600",
      },
      body: "",
    };
  }
  if (method !== "POST") {
    return json(405, { ok: false, code: "UNKNOWN_OPERATION", message: "use POST" }, origin);
  }

  let payload: Record<string, unknown>;
  try {
    payload = parseBody(request.body);
  } catch {
    return json(400, { ok: false, code: "INVALID_INPUT", message: "body must be a JSON object" }, origin);
  }

  const bearer = bearerToken(header(request, "authorization"));
  if (!bearer) {
    return json(401, { ok: false, code: "UNAUTHENTICATED", message: "a bearer token is required" }, origin);
  }

  let identity: VerifiedIdentity;
  try {
    identity = await deps.verifyToken(bearer);
  } catch {
    return json(401, { ok: false, code: "UNAUTHENTICATED", message: "the token could not be verified" }, origin);
  }

  let principal;
  try {
    principal = await resolvePrincipalContext(deps.policyReader, {
      identityProvider: identity.identityProvider,
      externalSubject: identity.externalSubject,
      requestedTenantId: singleHeader(header(request, "x-eos-tenant")),
    });
  } catch (err) {
    if (err instanceof PrincipalContextError) {
      return json(
        PRINCIPAL_REFUSAL_STATUS[err.refusal] ?? 403,
        { ok: false, code: err.refusal, message: "this caller could not be authorized" },
        origin,
      );
    }
    throw err;
  }

  const validated = validateAssistantContext(payload.context, {
    actorUid: principal.uid,
    companyId: principal.tenantId,
  });
  if (!validated.ok) {
    return json(400, { ok: false, code: "INVALID_INPUT", failures: validated.failures }, origin);
  }
  const context = validated.context;

  // STEP 6 -- explicit, CONFIGURATION-shaped refusals. Deliberately distinct from "NO_PERMITTED_DATA":
  // that status means the actor was checked and lacks authority; these mean a required plane behind
  // this surface is not wired up at all, which is a fact about the deployment and must never be
  // reported as though it were a fact about the caller -- and must never be papered over by falling
  // back to the Postgres policy Role as a stand-in authority source.
  if (BUSINESS_DATA_SURFACES.has(context.surface) && !deps.businessDataReaderConfigured) {
    return json(
      503,
      {
        ok: false,
        code: "ASSISTANT_DATA_SOURCE_NOT_CONFIGURED",
        message: "The assistant's business data source is not configured in this environment.",
      },
      origin,
    );
  }
  if (BUSINESS_DATA_SURFACES.has(context.surface) && !deps.operationalAuthoritySource) {
    return json(
      503,
      {
        ok: false,
        code: "ASSISTANT_AUTHORITY_SOURCE_NOT_CONFIGURED",
        message:
          "The assistant's operational authority source is not configured in this environment. " +
          "The Postgres policy Role does not govern business data and is never used as a substitute.",
      },
      origin,
    );
  }

  if (!deps.provider) {
    return json(
      503,
      { ok: false, code: "ASSISTANT_PROVIDER_NOT_CONFIGURED", message: "No AI provider is configured in this environment." },
      origin,
    );
  }

  // STEP 3/4 -- operational Role ids from the ONE permitted source, never from `principal.heldRoleKeys`.
  // A surface with no business-data tools (every surface but DASHBOARD, today) needs no operational
  // Role resolution at all; its tools, if any, are authorized on whatever the gateway already checks.
  const operationalRoleIds = deps.operationalAuthoritySource
    ? await deps.operationalAuthoritySource.resolveOperationalRoleIds({
        tenantId: principal.tenantId,
        principalUid: principal.uid,
      })
    : { businessRoleIds: [], functionalRoleIds: [], compatibilityRoleId: null };

  const authority: EffectiveAuthority = resolveEffectiveAuthority(
    {
      uid: principal.uid,
      companyId: principal.tenantId,
      businessRoleIds: operationalRoleIds.businessRoleIds,
      functionalRoleIds: operationalRoleIds.functionalRoleIds,
      compatibilityRoleId: operationalRoleIds.compatibilityRoleId,
    },
    assistantRoleResolver,
    deps.activeCapabilities,
  );

  const correlationId =
    singleHeader(header(request, "x-request-id")) ?? `${principal.tenantId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

  const outcome = await handleAssistantRequest(context, correlationId, {
    registry: deps.registry,
    provider: deps.provider,
    authority,
    now: deps.now ?? Date.now,
    maxOutputTokens: deps.maxOutputTokens,
  });

  return json(200, { ok: true, ...outcome }, origin);
}

/** Adapt the pure handler onto node:http, the same pattern `createAdminPolicyHttpHandler` uses. */
export function createAssistantHttpHandler(deps: AssistantHttpDeps, allowedOrigins: readonly string[] = []) {
  return async function nodeHandler(
    req: { method?: string; url?: string; headers: Record<string, string | string[] | undefined>; on: Function },
    res: { writeHead: Function; end: Function },
  ): Promise<void> {
    const body = await readBody(req);
    let response: HttpResponseShape;
    try {
      const result = await handleAssistantHttpRequest(
        deps,
        { method: req.method, url: req.url, headers: req.headers, body },
        allowedOrigins,
      );
      response = result ?? json(404, { ok: false, code: "UNKNOWN_OPERATION", message: "not found" }, null);
    } catch (err) {
      console.error("[assistantRoute] unhandled", err);
      response = json(500, { ok: false, code: "INTERNAL", message: "the request could not be completed" }, null);
    }
    res.writeHead(response.status, response.headers);
    res.end(response.body);
  };
}

const MAX_BODY_BYTES = 1_000_000;

function readBody(req: { on: Function }): Promise<string> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
