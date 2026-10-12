// THE REQUEST-SCOPED SESSION-TENANT BINDING (Owner ruling D-12, 2026-10-12).
//
//   "One Principal may belong to multiple tenants, but each authenticated session belongs to exactly one tenant."
//
// A human EOS login session is bound to ONE tenant, recorded server-side on login_sessions.tenant_id. The token carries
// no tenant (tenant is authority-adjacent; AUTHORITY_BEARING_CLAIMS refuses it). Instead, while the human session gate
// runs for a request, it BINDS that request to the session's tenant here, and resolvePrincipalContext -- the ONE
// function every transport (Administration, Operations, Commercial, CRM, Workforce, Catalog) resolves its caller through --
// enforces it:
//
//   no x-eos-tenant      -> the session's tenant
//   x-eos-tenant = same  -> the session's tenant
//   x-eos-tenant = other -> REFUSED (TENANT_NOT_A_MEMBERSHIP / TENANT_NOT_SESSION_TENANT), recorded as an access refusal
//
// A header can therefore never move a session into another tenant, whatever memberships the Principal holds. Changing
// tenant is an explicit /auth/session/switch-tenant that issues a NEW session.
//
// FAIL CLOSED. The binding lives in an AsyncLocalStorage store the EOS API opens per request (eosApi/server.ts). A
// human token verified outside such a store cannot be bound, and the composite verifier refuses it.
//
// Persona and Firebase identities are never bound: their resolution is exactly what it was.
import { AsyncLocalStorage } from "node:async_hooks";

export interface SessionTenantBinding {
  readonly identityProvider: string;
  readonly externalSubject: string;
  readonly tenantId: string;
  /** Records a refused tenant statement (authentication_events). Awaited; its own failure never un-refuses. */
  readonly onRefusal?: (requestedTenantId: string) => Promise<void>;
}

interface RequestScope {
  binding: SessionTenantBinding | null;
}

const scope = new AsyncLocalStorage<RequestScope>();

/** Run one request inside its own scope. Every EOS API request is (server.ts). */
export function runWithRequestScope<T>(fn: () => T): T {
  return scope.run({ binding: null }, fn);
}

/** Bind this request to a session tenant. false = no request scope: the caller must refuse the token. */
export function bindSessionTenant(binding: SessionTenantBinding): boolean {
  const store = scope.getStore();
  if (!store) return false;
  store.binding = Object.freeze({ ...binding });
  return true;
}

/** The binding for THIS identity in THIS request, or null. */
export function sessionTenantBindingFor(identityProvider: string, externalSubject: string): SessionTenantBinding | null {
  const b = scope.getStore()?.binding ?? null;
  return b && b.identityProvider === identityProvider && b.externalSubject === externalSubject ? b : null;
}
