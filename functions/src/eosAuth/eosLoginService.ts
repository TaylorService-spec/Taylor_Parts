// THE EOS LOGIN SERVICE -- how a HUMAN proves they are an EOS subject, and everything that keeps that proof honest:
// password login, TOTP step-up, rotating refresh sessions, one-time enrollment and reset tickets, self-service account
// security, and the security-administration operations Administration drives.
//
// docs/architecture/eos-native-identity.md. The persona issuer (eosSessionIssuer.ts) is untouched and separate.
//
// ════════════════════ WHAT IT DOES NOT DO ════════════════════
//
// It never decides authority. A login ends in an access token naming the account's bound EOS subject -- nothing else --
// and BEFORE minting one, the subject is run through resolvePrincipalContext, the same function every API request
// runs. A Principal that is disabled, has no active membership, or whose Employee is not access-eligible (DQ-007) gets
// no session, for exactly the reason it would get no answer from the API. Roles, capabilities and scopes are not read
// here and not changed here.
//
// ════════════════════ UNIFORM REFUSAL ════════════════════
//
// Unknown identifier, wrong password, locked, disabled, not yet enrolled, not eligible: the caller sees ONE answer,
// LOGIN_REFUSED, after the SAME password work. The reason is in authentication_events, for an administrator.
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { makeTransaction, type PostgresPolicyRepository } from "../adminPolicy/postgresPolicyRepository";
import { runWithRequestScope } from "./requestTenantBinding";
import { capabilityKeysFor } from "../adminPolicy/administrationCapabilityGate";
import { EOS_IDENTITY_PROVIDER, PrincipalContextError, resolvePrincipalContext, resolvePrincipalContextById } from "../adminPolicy/principalContext";
import { actorCapabilities, requireSecurityAdministrationCapability } from "../adminPolicy/administrationCapabilityGate";
import { ADMIN_ROLE_KEY, PROTECTED_OWNER_ROLE_KEY } from "../adminPolicy/administrationAuthority";
import { ACCESS_ELIGIBLE_EMPLOYMENT_STATUSES } from "../adminPolicy/employmentAccessEligibility";
import type { AdminActor } from "../adminPolicy/policyCommands";
import { newTokenId, signEosAccessToken, EOS_TOKEN_MAX_LIFETIME_SECONDS, type EosSigner } from "./eosAccessToken";
import {
  burnPasswordWork, decryptFactorSecret, encryptFactorSecret, factorSubkey, hashPassword, isOpaqueTokenOf, matchTotpStep,
  FactorKeyError, sealedFactorKid,
  newOpaqueToken, newRecoveryCodes, newTotpSecret, normalizeRecoveryCode, opaqueTokenDigest, passwordPolicyRefusal,
  recoveryCodeDigest, totpProvisioningUri, base32Encode, verifyPassword, type FactorKeyring, type ScryptParameters,
  PASSWORD_HASH_PARAMETERS, PASSWORD_MAX_LENGTH,
} from "./credentialCrypto";
import { timingSafeEqual } from "node:crypto";

const SCHEMA = "eos_policy";

/** Every human EOS subject. Never `nonprod-persona.` -- the two issuers can never mint for each other's subjects. */
export const HUMAN_SUBJECT_PREFIX = "user.";
export const newHumanSubject = (): string => `${HUMAN_SUBJECT_PREFIX}${randomBytes(16).toString("hex")}`;
export const isHumanSubject = (subject: string): boolean => /^user\.[0-9a-f]{32}$/.test(subject);

const LOGIN_IDENTIFIER = /^[a-z0-9][a-z0-9._@+-]{2,127}$/;
export function normalizeLoginIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim().toLowerCase();
  return LOGIN_IDENTIFIER.test(s) ? s : null;
}

// ════════════════════ policy ════════════════════

export interface LoginSessionPolicy {
  /** Access token lifetime. Short: the session gate makes revocation immediate anyway; this bounds a stolen token. */
  readonly accessTokenSeconds: number;
  /** A refresh token unused this long expires. */
  readonly idleSeconds: number;
  /** No session outlives this, however often it is refreshed. */
  readonly absoluteSeconds: number;
  readonly enrollmentTicketSeconds: number;
  readonly resetTicketSeconds: number;
  readonly mfaChallengeSeconds: number;
  /** Consecutive failures before the account locks. */
  readonly lockThreshold: number;
  /** First lock; each further failure doubles it, up to lockMaxSeconds. */
  readonly lockBaseSeconds: number;
  readonly lockMaxSeconds: number;
}

/** Defaults pending Owner ruling D-4 (docs/architecture/eos-native-identity.md). */
export const DEFAULT_LOGIN_SESSION_POLICY: LoginSessionPolicy = Object.freeze({
  accessTokenSeconds: 300,
  idleSeconds: 12 * 3600,
  absoluteSeconds: 7 * 24 * 3600,
  enrollmentTicketSeconds: 72 * 3600,
  resetTicketSeconds: 24 * 3600,
  mfaChallengeSeconds: 300,
  lockThreshold: 5,
  lockBaseSeconds: 15 * 60,
  lockMaxSeconds: 24 * 3600,
});

/** A spent refresh token re-presented this soon after its exchange is a sibling tab, not a thief (see refresh()). */
export const REFRESH_REUSE_GRACE_SECONDS = 10;

// ════════════════════ refusals ════════════════════

export type LoginRefusalCode =
  | "LOGIN_REFUSED"
  | "MFA_CHALLENGE_INVALID"
  | "MFA_CODE_REFUSED"
  | "REFRESH_REFUSED"
  | "TICKET_INVALID"
  | "SESSION_INVALID"
  | "MFA_ENROLLMENT_REQUIRED"
  | "MFA_NOT_CONFIGURED"
  | "MFA_KEY_UNAVAILABLE"
  | "REFRESH_SUPERSEDED"
  | "TENANT_SWITCHING_DISABLED"
  | "MFA_ALREADY_ENROLLED"
  | "MFA_NOT_ENROLLED"
  | "MFA_REQUIRED_BY_POLICY"
  | "PASSWORD_REFUSED"
  | "CURRENT_PASSWORD_REFUSED"
  | "PASSWORD_POLICY"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "CONFLICT"
  | "FORBIDDEN"
  | "SELF_ADMINISTRATION"
  | "PROTECTED_TARGET"
  | "REASON_REQUIRED";

const STATUS_BY_REFUSAL: Readonly<Record<LoginRefusalCode, number>> = Object.freeze({
  LOGIN_REFUSED: 401, MFA_CHALLENGE_INVALID: 401, MFA_CODE_REFUSED: 401, REFRESH_REFUSED: 401, TICKET_INVALID: 410,
  SESSION_INVALID: 401, MFA_ENROLLMENT_REQUIRED: 403, MFA_NOT_CONFIGURED: 503, MFA_KEY_UNAVAILABLE: 503, REFRESH_SUPERSEDED: 409, TENANT_SWITCHING_DISABLED: 409, MFA_ALREADY_ENROLLED: 409,
  MFA_NOT_ENROLLED: 409, MFA_REQUIRED_BY_POLICY: 409, PASSWORD_REFUSED: 400, CURRENT_PASSWORD_REFUSED: 401,
  PASSWORD_POLICY: 400, INVALID_INPUT: 400, NOT_FOUND: 404, CONFLICT: 409, FORBIDDEN: 403, SELF_ADMINISTRATION: 403,
  PROTECTED_TARGET: 403, REASON_REQUIRED: 400,
});

/** One refusal. `detail` is a code or a fixed sentence -- never an identifier, a password, a token or a hash. */
export class LoginRefusal extends Error {
  readonly status: number;
  constructor(readonly code: LoginRefusalCode, readonly detail: string | null = null) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "LoginRefusal";
    this.status = STATUS_BY_REFUSAL[code];
  }
}

// ════════════════════ dependencies ════════════════════

export interface ClientFacts {
  /** The User-Agent, truncated. Shown to the account holder in their session list. */
  readonly label: string | null;
  /** The client address, as given by the transport; stored only as a keyed digest. */
  readonly address: string | null;
}

export interface LoginServiceDeps {
  readonly pool: Pool;
  readonly repo: PostgresPolicyRepository;
  readonly signer: EosSigner;
  readonly issuer: string;
  readonly audience: string;
  /** EOS_ENVIRONMENT. The token `env` claim is derived from the signer's kid, which the config pins to nonprod. */
  readonly environment: string;
  readonly factorKeyring: FactorKeyring | null;
  readonly policy?: Partial<LoginSessionPolicy>;
  readonly now?: () => Date;
  /** The issuer label an authenticator app shows. */
  readonly totpIssuerLabel?: string;
  /** TEST ONLY: cheaper scrypt parameters. */
  readonly passwordHashParameters?: ScryptParameters;
  /** Owner ruling D-12 (EOS_AUTH_MULTI_TENANT_SESSIONS). Off: a human login is single-tenant. */
  readonly multiTenantSessions?: boolean;
  /** TEST ONLY: deterministic interleavings for the concurrency proofs. Never set by the server. */
  readonly testHooks?: { readonly beforeTicketTransaction?: () => Promise<void> };
}

export interface IssuedLoginSession {
  readonly tokenType: "Bearer";
  readonly accessToken: string;
  readonly accessTokenExpiresAt: string;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: string;
  readonly sessionId: string;
  /** The ONE tenant this session acts in (D-12). Requests may state it; they may not state another. */
  readonly tenantId: string;
  /** True when the account's policy requires a second factor it does not yet have: only /auth/* self routes work. */
  readonly mfaEnrollmentRequired: boolean;
}

export type LoginResult =
  | { readonly status: "AUTHENTICATED"; readonly session: IssuedLoginSession }
  | { readonly status: "MFA_REQUIRED"; readonly challenge: string; readonly challengeExpiresAt: string; readonly methods: readonly string[] };

type SessionRow = AccountRow & { session_id: string; mfa_verified: boolean; session_tenant_id: string };

interface AccountRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly principal_id: string;
  readonly binding_id: string;
  readonly login_identifier: string;
  readonly status: string;
  readonly password_hash: string | null;
  readonly credential_version: number;
  readonly failed_attempts: number;
  readonly locked_until: Date | null;
  readonly mfa_required: boolean;
  readonly last_login_at: Date | null;
  readonly password_changed_at: Date | null;
  readonly created_at: Date;
  /** principal_identities.external_subject, joined. */
  readonly subject: string;
  /** principal_identities.status, joined. */
  readonly binding_status: string;
}

const ACCOUNT_SELECT = `
  SELECT a.*, pi.external_subject AS subject, pi.status AS binding_status
    FROM ${SCHEMA}.login_accounts a
    JOIN ${SCHEMA}.principal_identities pi ON pi.id = a.binding_id`;

// ════════════════════ the service ════════════════════

export class EosLoginService {
  private readonly policy: LoginSessionPolicy;
  private readonly now: () => Date;
  private readonly hashParameters: ScryptParameters;
  /** Keys the client-address digest. Without a factor key, a per-process key: digests then correlate within a process only. */
  private readonly clientDigestKey: Buffer;

  constructor(private readonly deps: LoginServiceDeps) {
    if (!deps.signer.kid.startsWith("nonprod-")) {
      // The token env is derived from the kid; this tranche issues nonprod tokens only (D-1: production is a ruling).
      throw new Error("the EOS login service signs with a nonprod- key only in this tranche");
    }
    this.policy = Object.freeze({ ...DEFAULT_LOGIN_SESSION_POLICY, ...(deps.policy ?? {}) });
    if (this.policy.accessTokenSeconds <= 0 || this.policy.accessTokenSeconds > EOS_TOKEN_MAX_LIFETIME_SECONDS) {
      throw new Error("accessTokenSeconds must be in (0, 900]");
    }
    this.now = deps.now ?? (() => new Date());
    this.hashParameters = deps.passwordHashParameters ?? PASSWORD_HASH_PARAMETERS;
    // Its own HKDF subkey of the factor root key (credentialCrypto: key separation); never the seal or recovery key.
    this.clientDigestKey = deps.factorKeyring
      ? factorSubkey(deps.factorKeyring, deps.factorKeyring.currentKid, "client")
      : randomBytes(32);
  }

  get mfaConfigured(): boolean {
    return this.deps.factorKeyring !== null;
  }

  // ──────────────────── plumbing ────────────────────

  private async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.deps.pool.connect();
    try {
      await client.query("BEGIN");
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* the original error is rethrown */ }
      throw err;
    } finally {
      client.release();
    }
  }

  private clientDigest(client: ClientFacts | null): string | null {
    if (!client?.address) return null;
    return createHmac("sha256", this.clientDigestKey).update(client.address).digest("hex").slice(0, 32);
  }

  private static label(client: ClientFacts | null): string | null {
    const l = client?.label;
    return typeof l === "string" && l.length > 0 ? l.slice(0, 200) : null;
  }

  private async event(
    q: Pick<PoolClient, "query"> | Pool,
    input: { event: string; outcome: "success" | "refused"; reason?: string | null; accountId?: string | null;
      principalId?: string | null; sessionId?: string | null; client?: ClientFacts | null; tenantId?: string | null },
  ): Promise<void> {
    // TENANT ISOLATION of the security record (D-13): the stated tenant, else the session's, else the account's home
    // tenant; NULL only when the attempt names no account at all.
    await q.query(
      `INSERT INTO ${SCHEMA}.authentication_events
         (id, occurred_at, tenant_id, event, outcome, reason_code, account_id, principal_id, session_id, client_digest, client_label)
       VALUES ($1,$2,
         COALESCE($11::text, (SELECT tenant_id FROM ${SCHEMA}.login_sessions WHERE id = $8), (SELECT tenant_id FROM ${SCHEMA}.login_accounts WHERE id = $6)),
         $3,$4,$5,$6,$7,$8,$9,$10)`,
      [randomUUID(), this.now(), input.event, input.outcome, input.reason ?? null, input.accountId ?? null,
        input.principalId ?? null, input.sessionId ?? null, this.clientDigest(input.client ?? null),
        EosLoginService.label(input.client ?? null), input.tenantId ?? null],
    );
  }

  /**
   * The security event for a REVOCATION (logout, session revocation, reuse detection, an administrative act), written
   * best-effort inside a savepoint (second review finding 10): if the event store fails, the revocation still commits.
   * The asymmetry is deliberate -- a GRANT (login, refresh, a code issued) without its record never happens, because those
   * write their event in the same transaction and fail with it; a REMOVAL of access must not be blocked by the log.
   */
  private async eventBestEffort(c: PoolClient, input: Parameters<EosLoginService["event"]>[1]): Promise<void> {
    await c.query("SAVEPOINT eos_event");
    try {
      await this.event(c, input);
      await c.query("RELEASE SAVEPOINT eos_event");
    } catch {
      await c.query("ROLLBACK TO SAVEPOINT eos_event");
      // eslint-disable-next-line no-console -- the class only; never an identifier or token
      console.error("[eosLogin] security event could not be recorded; the revocation stands");
    }
  }

  /** A governed change, in the account's tenant's audit_events, through the policy transaction port. */
  private async audit(client: PoolClient, tenantId: string, actorUid: string, action: string, accountId: string,
    before: unknown, after: unknown, reason: string): Promise<void> {
    await makeTransaction(client, { tenantId, uid: actorUid }).appendAudit({
      action, actorUid, targetKind: "loginAccount", targetId: accountId,
      before: before ?? null, after: after ?? null, occurredAt: this.now().toISOString(), reason,
    } as never);
  }

  private async accountByIdentifier(q: Pick<PoolClient, "query"> | Pool, identifier: string, lock = false): Promise<AccountRow | null> {
    const { rows } = await q.query(`${ACCOUNT_SELECT} WHERE a.login_identifier = $1 AND a.status <> 'retired'${lock ? " FOR UPDATE OF a" : ""}`, [identifier]);
    return (rows[0] as AccountRow | undefined) ?? null;
  }

  private async accountById(q: Pick<PoolClient, "query"> | Pool, id: string, lock = false): Promise<AccountRow | null> {
    const { rows } = await q.query(`${ACCOUNT_SELECT} WHERE a.id = $1${lock ? " FOR UPDATE OF a" : ""}`, [id]);
    return (rows[0] as AccountRow | undefined) ?? null;
  }

  private async liveAccountForPrincipal(q: Pick<PoolClient, "query"> | Pool, principalId: string, lock = false): Promise<AccountRow | null> {
    const { rows } = await q.query(`${ACCOUNT_SELECT} WHERE a.principal_id = $1 AND a.status <> 'retired'${lock ? " FOR UPDATE OF a" : ""}`, [principalId]);
    return (rows[0] as AccountRow | undefined) ?? null;
  }

  /** The SAME resolution every request runs. Throws PrincipalContextError when the subject could not make a request. */
  private get multiTenant(): boolean {
    return this.deps.multiTenantSessions === true;
  }

  /**
   * The SAME resolution every request runs, IN THE TENANT the session will act in -- membership, tenant status and the
   * DQ-007 Employee gate of THAT tenant. Tenant selection can therefore never override Employee eligibility, operating
   * company scope or Work Eligibility: those are resolved per tenant downstream, exactly as for any request.
   *
   * Run in a FRESH request scope: a switch is itself an authenticated request, already bound to the OLD tenant.
   */
  private async requireEligible(account: AccountRow, tenantId: string = account.tenant_id): Promise<void> {
    if (!this.multiTenant && await this.hasForeignMembership(this.deps.pool, account.principal_id, account.tenant_id)) {
      throw new PrincipalContextError("TENANT_NOT_A_MEMBERSHIP", "MULTI_TENANT_PRINCIPAL");
    }
    await runWithRequestScope(() => resolvePrincipalContext(this.deps.repo, {
      identityProvider: EOS_IDENTITY_PROVIDER, externalSubject: account.subject, requestedTenantId: tenantId,
    }));
    // A HUMAN login is for a PERSON in THIS tenant (second review finding 5). DQ-007 reads "no Employee link" as "not an
    // Employee, unaffected" -- right for service Principals, wrong for a human session -- so a human session additionally
    // requires exactly one active Employee link in the tenant it acts in (whose status resolvePrincipalContext checked).
    const fact = await this.deps.repo.getLinkedEmployeeAccessFact(tenantId, account.principal_id);
    if (!fact || ("ambiguous" in fact && fact.ambiguous)) {
      throw new PrincipalContextError("EMPLOYEE_NOT_ACCESS_ELIGIBLE", "a human session requires an Employee link in its tenant");
    }
  }

  /**
   * The tenant a login asks for, server-validated (D-12). Single-tenant mode: the account's home tenant only. Multi-tenant
   * mode: the stated tenant, else the home tenant. Membership and eligibility are then proven by requireEligible.
   */
  private selectTenant(account: AccountRow, requested: unknown): string | null {
    const stated = typeof requested === "string" && requested.trim().length > 0 ? requested.trim() : null;
    if (stated !== null && !/^[A-Za-z0-9._:-]{1,128}$/.test(stated)) return null;
    if (!this.multiTenant) return stated === null || stated === account.tenant_id ? account.tenant_id : null;
    return stated ?? account.tenant_id;
  }

  /**
   * THE LOCKOUT, ATOMIC (security review findings 2, 4).
   *
   * A password or second-factor attempt is RESERVED -- counted as a failure -- in ONE statement before any work is
   * spent, and only while the account is not locked. A burst of concurrent guesses therefore cannot all pass a stale
   * "not locked" read and queue behind the hashing semaphore: the reservation that reaches the threshold sets the lock,
   * and every later reservation is refused without a hash. A success then clears the counter.
   *
   * No escalation: a lock is lockBaseSeconds, and the count restarts when it expires. An attacker can still hold an
   * account locked with lockThreshold guesses per window -- the residual risk recorded as D-4 -- but cannot extend it
   * to a day with one request.
   */
  private static readonly RESERVE_SQL = (schema: string, extraWhere: string) => `
    UPDATE ${schema}.login_accounts SET
      failed_attempts = CASE WHEN locked_until IS NOT NULL AND locked_until <= $2 THEN 1 ELSE failed_attempts + 1 END,
      locked_until = CASE WHEN (CASE WHEN locked_until IS NOT NULL AND locked_until <= $2 THEN 1 ELSE failed_attempts + 1 END) >= $3
                          THEN $4::timestamptz ELSE NULL END,
      updated_at = $2
    WHERE id = $1 ${extraWhere}
    RETURNING failed_attempts`;

  /** Reserve one attempt. false = the account is locked (or not active): spend no work, refuse. */
  private async reserveAttempt(q: Pick<PoolClient, "query"> | Pool, accountId: string): Promise<boolean> {
    const now = this.now();
    const lockUntil = new Date(now.getTime() + this.policy.lockBaseSeconds * 1000);
    const { rows } = await q.query(EosLoginService.RESERVE_SQL(SCHEMA, "AND status = 'active' AND (locked_until IS NULL OR locked_until <= $2)"),
      [accountId, now, this.policy.lockThreshold, lockUntil]);
    return rows.length === 1;
  }

  /** Count one failure on an account already checked unlocked under its row lock (second-factor attempts). */
  private async recordFailure(client: PoolClient, account: AccountRow): Promise<void> {
    const now = this.now();
    await client.query(EosLoginService.RESERVE_SQL(SCHEMA, ""),
      [account.id, now, this.policy.lockThreshold, new Date(now.getTime() + this.policy.lockBaseSeconds * 1000)]);
  }

  private async clearFailures(q: Pick<PoolClient, "query"> | Pool, accountId: string): Promise<void> {
    await q.query(`UPDATE ${SCHEMA}.login_accounts SET failed_attempts = 0, locked_until = NULL, updated_at = $2 WHERE id = $1`, [accountId, this.now()]);
  }

  private isLocked(account: AccountRow): boolean {
    return account.locked_until !== null && account.locked_until.getTime() > this.now().getTime();
  }

  private mint(subject: string, sessionId: string): { token: string; expiresAt: string } {
    const iat = Math.floor(this.now().getTime() / 1000);
    const exp = iat + this.policy.accessTokenSeconds;
    const token = signEosAccessToken(this.deps.signer, {
      iss: this.deps.issuer, aud: this.deps.audience, sub: subject, iat, exp, jti: newTokenId(), env: "nonprod", sid: sessionId,
    });
    return { token, expiresAt: new Date(exp * 1000).toISOString() };
  }

  private async openSession(client: PoolClient, account: AccountRow, mfaVerified: boolean, facts: ClientFacts | null,
    tenantId: string): Promise<IssuedLoginSession> {
    const now = this.now();
    const sessionId = randomBytes(24).toString("base64url");
    const absolute = new Date(now.getTime() + this.policy.absoluteSeconds * 1000);
    const idle = new Date(Math.min(now.getTime() + this.policy.idleSeconds * 1000, absolute.getTime()));
    await client.query(
      `INSERT INTO ${SCHEMA}.login_sessions (id, account_id, principal_id, tenant_id, credential_version, mfa_verified, created_at,
         last_refreshed_at, idle_expires_at, absolute_expires_at, client_label, client_digest)
       VALUES ($1,$2,$3,$11,$4,$5,$6,$6,$7,$8,$9,$10)`,
      [sessionId, account.id, account.principal_id, account.credential_version, mfaVerified, now, idle, absolute,
        EosLoginService.label(facts), this.clientDigest(facts), tenantId],
    );
    const refreshToken = newOpaqueToken("refresh");
    await client.query(
      `INSERT INTO ${SCHEMA}.login_refresh_tokens (token_sha256, session_id, issued_at) VALUES ($1,$2,$3)`,
      [opaqueTokenDigest(refreshToken), sessionId, now],
    );
    const access = this.mint(account.subject, sessionId);
    return Object.freeze({
      tokenType: "Bearer", accessToken: access.token, accessTokenExpiresAt: access.expiresAt, refreshToken,
      refreshTokenExpiresAt: idle.toISOString(), sessionId, tenantId,
      mfaEnrollmentRequired: account.mfa_required && !mfaVerified && !(await this.hasActiveFactor(client, account.id)),
    });
  }

  private async hasActiveFactor(q: Pick<PoolClient, "query"> | Pool, accountId: string): Promise<boolean> {
    const { rows } = await q.query(`SELECT 1 FROM ${SCHEMA}.login_mfa_factors WHERE account_id = $1 AND status = 'active'`, [accountId]);
    return rows.length > 0;
  }

  private async revokeSessions(client: PoolClient, accountId: string, reason: string, exceptSessionId: string | null = null): Promise<number> {
    const { rowCount } = await client.query(
      `UPDATE ${SCHEMA}.login_sessions SET revoked_at = $2, revoke_reason = $3
        WHERE account_id = $1 AND revoked_at IS NULL AND ($4::text IS NULL OR id <> $4)`,
      [accountId, this.now(), reason, exceptSessionId],
    );
    return rowCount ?? 0;
  }

  // ════════════════════ the front door ════════════════════

  async login(input: { identifier: unknown; password: unknown; tenantId?: unknown }, facts: ClientFacts | null): Promise<LoginResult> {
    const identifier = normalizeLoginIdentifier(input.identifier);
    const password = typeof input.password === "string" && input.password.length <= PASSWORD_MAX_LENGTH * 4 ? input.password : null;
    if (!identifier || password === null) {
      await burnPasswordWork("");
      await this.event(this.deps.pool, { event: "login", outcome: "refused", reason: "MALFORMED", client: facts });
      throw new LoginRefusal("LOGIN_REFUSED");
    }
    const account = await this.accountByIdentifier(this.deps.pool, identifier);
    const refuse = async (reason: string, a: AccountRow | null, tenantId: string | null = null) => {
      // In the SELECTED tenant once one is chosen (second review finding 8), else the account's home tenant.
      await this.event(this.deps.pool, { event: "login", outcome: "refused", reason, accountId: a?.id, principalId: a?.principal_id, client: facts, tenantId });
      throw new LoginRefusal("LOGIN_REFUSED");
    };
    if (!account) {
      await burnPasswordWork(password);
      return refuse("UNKNOWN_IDENTIFIER", null);
    }
    if (account.status !== "active" || account.binding_status !== "active" || this.isLocked(account)) {
      await burnPasswordWork(password);
      return refuse(this.isLocked(account) ? "ACCOUNT_LOCKED" : account.binding_status !== "active" ? "BINDING_REVOKED"
        : `ACCOUNT_${account.status.toUpperCase()}`, account);
    }
    // RESERVE before hashing: a locked account is refused here with no evaluation (finding 2).
    if (!(await this.reserveAttempt(this.deps.pool, account.id))) {
      await burnPasswordWork(password);
      return refuse("ACCOUNT_LOCKED", account);
    }
    const check = await verifyPassword(password, account.password_hash);
    if (!check.matches) return refuse("BAD_PASSWORD", account);
    // THE TENANT, server-validated (D-12): chosen only after the password proves the person, so the answer to "which
    // tenants may I enter" is never disclosed to a guesser.
    const tenantId = this.selectTenant(account, input.tenantId);
    if (!tenantId) return refuse("TENANT_NOT_SELECTABLE", account);
    try {
      await this.requireEligible(account, tenantId);
    } catch (err) {
      // N1 (third review): record in the selected tenant ONLY if the person has a membership row there -- otherwise a
      // stated id would inject a foreign Principal into an unrelated tenant's security log, or (a non-existent id) fail
      // the FK and answer 500, an oracle for tenant ids. Then the home tenant records it.
      if (err instanceof PrincipalContextError) {
        const member = await this.deps.repo.getMembership(tenantId, account.principal_id);
        return refuse(`PRINCIPAL_${err.refusal}`, account, member ? tenantId : null);
      }
      throw err;
    }
    const rehash = check.needsRehash ? await hashPassword(password, this.hashParameters) : null;

    const result = await this.tx(async (c): Promise<LoginResult | null> => {
      const a = await this.accountById(c, account.id, true);
      // Re-read under the lock: a concurrent disable, binding revocation or credential change between the read and here
      // wins. (The lock our OWN reservation may have set is cleared below: this attempt was within the allowance.)
      if (!a || a.status !== "active" || a.binding_status !== "active" || a.credential_version !== account.credential_version) {
        await this.event(c, { event: "login", outcome: "refused", reason: "ACCOUNT_CHANGED", accountId: account.id, client: facts, tenantId });
        return null;
      }
      if (rehash) {
        await c.query(`UPDATE ${SCHEMA}.login_accounts SET password_hash = $2, updated_at = $3 WHERE id = $1`, [a.id, rehash, this.now()]);
      }
      if (await this.hasActiveFactor(c, a.id)) {
        // The password step passed; the counter stays reserved until the SECOND factor also passes.
        const challenge = newOpaqueToken("mfaChallenge");
        const now = this.now();
        const expires = new Date(now.getTime() + this.policy.mfaChallengeSeconds * 1000);
        await c.query(
          `INSERT INTO ${SCHEMA}.login_mfa_challenges (id, account_id, token_sha256, credential_version, tenant_id, created_at, expires_at) VALUES ($1,$2,$3,$4,$7,$5,$6)`,
          [randomUUID(), a.id, opaqueTokenDigest(challenge), a.credential_version, now, expires, tenantId],
        );
        await this.event(c, { event: "loginPassword", outcome: "success", reason: "MFA_REQUIRED", accountId: a.id, principalId: a.principal_id, client: facts });
        return { status: "MFA_REQUIRED" as const, challenge, challengeExpiresAt: expires.toISOString(), methods: Object.freeze(["totp", "recoveryCode"]) };
      }
      await c.query(`UPDATE ${SCHEMA}.login_accounts SET failed_attempts = 0, locked_until = NULL, last_login_at = $2, updated_at = $2 WHERE id = $1`, [a.id, this.now()]);
      const session = await this.openSession(c, a, false, facts, tenantId);
      await this.event(c, { event: "login", outcome: "success", accountId: a.id, principalId: a.principal_id, sessionId: session.sessionId, client: facts });
      return { status: "AUTHENTICATED" as const, session };
    });
    // A refusal's event COMMITTED above; the refusal is thrown after (finding 10).
    if (!result) throw new LoginRefusal("LOGIN_REFUSED");
    return result;
  }

  async completeMfaLogin(input: { challenge: unknown; code?: unknown; recoveryCode?: unknown }, facts: ClientFacts | null): Promise<LoginResult> {
    if (!isOpaqueTokenOf("mfaChallenge", input.challenge)) throw new LoginRefusal("MFA_CHALLENGE_INVALID");
    const keyring = this.deps.factorKeyring;
    if (!keyring) throw new LoginRefusal("MFA_NOT_CONFIGURED");
    const digest = opaqueTokenDigest(input.challenge);
    const outcome = await this.tx(async (c) => {
      const { rows } = await c.query(`SELECT * FROM ${SCHEMA}.login_mfa_challenges WHERE token_sha256 = $1 FOR UPDATE`, [digest]);
      const ch = rows[0];
      if (!ch || ch.consumed_at || ch.expires_at.getTime() <= this.now().getTime() || ch.attempts >= 5) {
        await this.event(c, { event: "loginMfa", outcome: "refused", reason: "CHALLENGE_INVALID", accountId: ch?.account_id, client: facts });
        return { refusal: "MFA_CHALLENGE_INVALID" as const };
      }
      const a = await this.accountById(c, ch.account_id, true);
      // A password reset or change since the password step voids the challenge (finding 8).
      if (!a || a.status !== "active" || a.binding_status !== "active" || this.isLocked(a) || a.credential_version !== ch.credential_version) {
        await c.query(`UPDATE ${SCHEMA}.login_mfa_challenges SET consumed_at = $2 WHERE id = $1`, [ch.id, this.now()]);
        await this.event(c, { event: "loginMfa", outcome: "refused", reason: "ACCOUNT_NOT_USABLE", accountId: ch.account_id, client: facts, tenantId: ch.tenant_id });
        return { refusal: "MFA_CHALLENGE_INVALID" as const };
      }
      const method = await this.secondFactorOrKeyRefusal(c, keyring, a, input);
      if (method === "KEY_UNAVAILABLE") {
        await this.event(c, { event: "loginMfa", outcome: "refused", reason: "MFA_KEY_UNAVAILABLE", accountId: a.id, principalId: a.principal_id, client: facts, tenantId: ch.tenant_id });
        return { refusal: "MFA_KEY_UNAVAILABLE" as const };
      }
      if (!method) {
        await c.query(`UPDATE ${SCHEMA}.login_mfa_challenges SET attempts = attempts + 1 WHERE id = $1`, [ch.id]);
        await this.recordFailure(c, a);
        await this.event(c, { event: "loginMfa", outcome: "refused", reason: "CODE_REFUSED", accountId: a.id, principalId: a.principal_id, client: facts, tenantId: ch.tenant_id });
        return { refusal: "MFA_CODE_REFUSED" as const };
      }
      await c.query(`UPDATE ${SCHEMA}.login_mfa_challenges SET consumed_at = $2 WHERE id = $1`, [ch.id, this.now()]);
      return { account: a, method, tenantId: ch.tenant_id as string };
    });
    if ("refusal" in outcome) throw new LoginRefusal(outcome.refusal as LoginRefusalCode);
    // Eligibility is re-checked at the moment of issue, not trusted from the password step.
    try {
      await this.requireEligible(outcome.account, outcome.tenantId);
    } catch (err) {
      if (err instanceof PrincipalContextError) {
        await this.event(this.deps.pool, { event: "loginMfa", outcome: "refused", reason: `PRINCIPAL_${err.refusal}`, accountId: outcome.account.id, client: facts, tenantId: outcome.tenantId });
        throw new LoginRefusal("LOGIN_REFUSED");
      }
      throw err;
    }
    const issued = await this.tx(async (c): Promise<LoginResult | null> => {
      const a = await this.accountById(c, outcome.account.id, true);
      if (!a || a.status !== "active" || a.binding_status !== "active" || a.credential_version !== outcome.account.credential_version) {
        await this.event(c, { event: "loginMfa", outcome: "refused", reason: "ACCOUNT_CHANGED", accountId: outcome.account.id, client: facts, tenantId: outcome.tenantId });
        return null;
      }
      await c.query(`UPDATE ${SCHEMA}.login_accounts SET failed_attempts = 0, locked_until = NULL, last_login_at = $2, updated_at = $2 WHERE id = $1`, [a.id, this.now()]);
      const session = await this.openSession(c, a, true, facts, outcome.tenantId);
      await this.event(c, { event: "login", outcome: "success", reason: outcome.method === "recoveryCode" ? "RECOVERY_CODE" : "TOTP",
        accountId: a.id, principalId: a.principal_id, sessionId: session.sessionId, client: facts });
      return { status: "AUTHENTICATED" as const, session };
    });
    if (!issued) throw new LoginRefusal("LOGIN_REFUSED");
    return issued;
  }

  /**
   * TOTP (replay-proof: the step must exceed the last accepted one) or a single-use recovery code.
   *
   * KEYS FAIL CLOSED. A factor sealed -- or a code peppered -- under a key this service no longer holds is NOT bypassed:
   * the attempt throws FactorKeyError and the caller refuses MFA_KEY_UNAVAILABLE. A TOTP factor that verifies under an
   * older kid is re-sealed under the current one in the same transaction (lazy rotation).
   */
  private async verifySecondFactor(c: PoolClient, keyring: FactorKeyring, a: AccountRow,
    input: { code?: unknown; recoveryCode?: unknown }): Promise<"totp" | "recoveryCode" | null> {
    if (input.code !== undefined && input.code !== null) {
      const { rows } = await c.query(
        `SELECT * FROM ${SCHEMA}.login_mfa_factors WHERE account_id = $1 AND status = 'active' AND kind = 'totp' FOR UPDATE`, [a.id]);
      const f = rows[0];
      if (!f) return null;
      const secret = decryptFactorSecret(keyring, f.secret_sealed, f.id);
      const step = matchTotpStep(secret, input.code, Math.floor(this.now().getTime() / 1000));
      if (step === null || (f.last_used_step !== null && step <= Number(f.last_used_step))) return null;
      const reseal = sealedFactorKid(f.secret_sealed) !== keyring.currentKid ? encryptFactorSecret(keyring, secret, f.id) : null;
      await c.query(`UPDATE ${SCHEMA}.login_mfa_factors SET last_used_step = $2, secret_sealed = COALESCE($3, secret_sealed) WHERE id = $1`,
        [f.id, step, reseal]);
      return "totp";
    }
    const normalized = normalizeRecoveryCode(input.recoveryCode);
    if (!normalized) return null;
    const { rows } = await c.query(
      `SELECT id, key_id, code_digest FROM ${SCHEMA}.login_recovery_codes
        WHERE account_id = $1 AND used_at IS NULL AND superseded_at IS NULL FOR UPDATE`, [a.id]);
    // Digest once per HELD key the live codes were written under, compare in constant time.
    const digestByKid = new Map<string, Buffer>();
    const unheld = new Set<string>();
    for (const kid of new Set(rows.map((r) => r.key_id as string))) {
      if (keyring.keys.has(kid)) digestByKid.set(kid, Buffer.from(recoveryCodeDigest(keyring, kid, a.id, normalized), "hex"));
      else unheld.add(kid);
    }
    let matchId: string | null = null;
    for (const r of rows) {
      const want = digestByKid.get(r.key_id);
      if (want && timingSafeEqual(want, Buffer.from(r.code_digest, "hex")) && matchId === null) matchId = r.id;
    }
    // No held key matched, and some live codes are under a key this service lacks: the answer is unknowable, not "wrong".
    if (!matchId && unheld.size > 0) throw new FactorKeyError("live recovery codes are under a factor key this service does not hold", [...unheld][0]);
    if (!matchId) return null;
    await c.query(`UPDATE ${SCHEMA}.login_recovery_codes SET used_at = $2 WHERE id = $1`, [matchId, this.now()]);
    return "recoveryCode";
  }

  /** Run a second-factor check; a missing key is recorded and refused, never treated as a wrong code or a pass. */
  private async secondFactorOrKeyRefusal(c: PoolClient, keyring: FactorKeyring, a: AccountRow,
    input: { code?: unknown; recoveryCode?: unknown }): Promise<"totp" | "recoveryCode" | null | "KEY_UNAVAILABLE"> {
    try {
      return await this.verifySecondFactor(c, keyring, a, input);
    } catch (err) {
      if (err instanceof FactorKeyError) return "KEY_UNAVAILABLE";
      throw err;
    }
  }

  /**
   * Exchange a refresh token for a new pair -- ONE transaction, holding the token and session row locks from lookup to
   * rotation, so two concurrent exchanges of one token serialise and exactly one rotates.
   *
   * REPLAY. A token presented after it was exchanged is either a sibling request from the same browser (two tabs, one
   * cookie jar, a race of milliseconds) or a stolen copy. Within REFRESH_REUSE_GRACE_SECONDS of the exchange it is
   * answered REFRESH_SUPERSEDED and nothing is revoked -- the browser's cookie already holds the successor, and the
   * client retries once. Outside the window it is theft: the whole session is revoked (REFRESH_TOKEN_REUSE). Either
   * way the presenter receives no token.
   */
  async refresh(input: { refreshToken: unknown }, facts: ClientFacts | null): Promise<IssuedLoginSession> {
    if (!isOpaqueTokenOf("refresh", input.refreshToken)) throw new LoginRefusal("REFRESH_REFUSED");
    const digest = opaqueTokenDigest(input.refreshToken);
    // ELIGIBILITY FIRST, OUTSIDE THE LOCKING TRANSACTION (second review finding 1). It reads through the policy repository
    // on other pool connections; doing that while holding this token's row locks let a burst of refreshes of one cookie
    // pin every pool connection (lock holder waiting for a connection, the rest waiting for the lock). The result is a
    // refusal reason or null; the transaction below re-validates everything else under the locks.
    let eligibilityRefusal: string | null = null;
    {
      const { rows: pre } = await this.deps.pool.query(
        `SELECT s.account_id, s.tenant_id FROM ${SCHEMA}.login_refresh_tokens t JOIN ${SCHEMA}.login_sessions s ON s.id = t.session_id
          WHERE t.token_sha256 = $1 AND t.consumed_at IS NULL AND s.revoked_at IS NULL`, [digest]);
      if (pre[0]) {
        const acct = await this.accountById(this.deps.pool, pre[0].account_id);
        if (acct) {
          try {
            await this.requireEligible(acct, pre[0].tenant_id);
          } catch (err) {
            if (!(err instanceof PrincipalContextError)) throw err;
            eligibilityRefusal = `PRINCIPAL_${err.refusal}`;
          }
        }
      }
    }
    const result = await this.tx(async (c): Promise<IssuedLoginSession | LoginRefusalCode> => {
      const now = this.now();
      const { rows } = await c.query(
        `SELECT t.*, s.account_id, s.tenant_id AS session_tenant_id, s.revoked_at, s.idle_expires_at, s.absolute_expires_at, s.credential_version AS session_cv, s.mfa_verified
           FROM ${SCHEMA}.login_refresh_tokens t JOIN ${SCHEMA}.login_sessions s ON s.id = t.session_id
          WHERE t.token_sha256 = $1 FOR UPDATE OF t, s`, [digest]);
      const t = rows[0];
      const refuse = async (reason: string, revoke: string | null, code: LoginRefusalCode = "REFRESH_REFUSED") => {
        if (revoke && t && !t.revoked_at) {
          await c.query(`UPDATE ${SCHEMA}.login_sessions SET revoked_at = $2, revoke_reason = $3 WHERE id = $1`, [t.session_id, now, revoke]);
        }
        await this.eventBestEffort(c, { event: "refresh", outcome: "refused", reason, accountId: t?.account_id, sessionId: t?.session_id, client: facts });
        return code;
      };
      if (!t) return refuse("UNKNOWN_TOKEN", null);
      if (t.revoked_at) return refuse("SESSION_REVOKED", null);
      if (t.consumed_at) {
        const age = (now.getTime() - t.consumed_at.getTime()) / 1000;
        const presenter = this.clientDigest(facts);
        // A sibling tab is the SAME client. A re-presentation from a DIFFERENT client is theft even inside the window
        // (finding 12); with no digest on either side, the window alone decides.
        const sameClient = !presenter || !t.consumed_client_digest || presenter === t.consumed_client_digest;
        if (age <= REFRESH_REUSE_GRACE_SECONDS && sameClient) return refuse("REFRESH_SUPERSEDED", null, "REFRESH_SUPERSEDED");
        return refuse("REFRESH_TOKEN_REUSE", "REFRESH_TOKEN_REUSE");
      }
      if (t.idle_expires_at.getTime() <= now.getTime() || t.absolute_expires_at.getTime() <= now.getTime()) {
        return refuse("SESSION_EXPIRED", null);
      }
      const a = await this.accountById(c, t.account_id);
      if (!a || a.status !== "active" || a.binding_status !== "active" || a.credential_version !== t.session_cv) {
        return refuse("ACCOUNT_CHANGED", "ACCOUNT_CHANGED");
      }
      // The SAME resolution every request runs, re-checked at every rotation (computed above, outside the locks).
      if (eligibilityRefusal) return refuse(eligibilityRefusal, eligibilityRefusal);
      await c.query(`UPDATE ${SCHEMA}.login_refresh_tokens SET consumed_at = $2, consumed_client_digest = $3 WHERE token_sha256 = $1`,
        [digest, now, this.clientDigest(facts)]);
      const idle = new Date(Math.min(now.getTime() + this.policy.idleSeconds * 1000, t.absolute_expires_at.getTime()));
      await c.query(`UPDATE ${SCHEMA}.login_sessions SET last_refreshed_at = $2, idle_expires_at = $3 WHERE id = $1`, [t.session_id, now, idle]);
      const refreshToken = newOpaqueToken("refresh");
      await c.query(`INSERT INTO ${SCHEMA}.login_refresh_tokens (token_sha256, session_id, issued_at) VALUES ($1,$2,$3)`,
        [opaqueTokenDigest(refreshToken), t.session_id, now]);
      const access = this.mint(a.subject, t.session_id);
      await this.event(c, { event: "refresh", outcome: "success", accountId: a.id, principalId: a.principal_id, sessionId: t.session_id, client: facts });
      return Object.freeze({
        tokenType: "Bearer" as const, accessToken: access.token, accessTokenExpiresAt: access.expiresAt, refreshToken,
        refreshTokenExpiresAt: idle.toISOString(), sessionId: t.session_id, tenantId: t.session_tenant_id,
        mfaEnrollmentRequired: a.mfa_required && !t.mfa_verified && !(await this.hasActiveFactor(c, a.id)),
      });
    });
    // Refusals COMMIT (a reuse revocation must persist), then surface.
    if (typeof result === "string") throw new LoginRefusal(result);
    return result;
  }

  /**
   * Logout by the access token's session (finding 11): when the refresh cookie is not sent (third-party cookie blocking,
   * a SameSite mismatch), the Bearer's `sid` still ends the session server-side.
   */
  async logoutSession(subject: string, sessionId: string | null, facts: ClientFacts | null): Promise<void> {
    if (!sessionId) return;
    await this.tx(async (c) => {
      const { rows } = await c.query(
        `SELECT s.id, s.account_id FROM ${SCHEMA}.login_sessions s JOIN ${SCHEMA}.login_accounts a ON a.id = s.account_id
           JOIN ${SCHEMA}.principal_identities pi ON pi.id = a.binding_id
          WHERE s.id = $1 AND pi.external_subject = $2 AND s.revoked_at IS NULL FOR UPDATE OF s`, [sessionId, subject]);
      if (!rows[0]) return;
      await c.query(`UPDATE ${SCHEMA}.login_sessions SET revoked_at = $2, revoke_reason = 'LOGOUT' WHERE id = $1`, [rows[0].id, this.now()]);
      await this.eventBestEffort(c, { event: "logout", outcome: "success", accountId: rows[0].account_id, sessionId: rows[0].id, client: facts });
    });
  }

  /** Always succeeds from the caller's view: logging out an unknown or dead session is not information. */
  async logout(input: { refreshToken: unknown }, facts: ClientFacts | null): Promise<void> {
    const token = input.refreshToken;
    if (!isOpaqueTokenOf("refresh", token)) return;
    await this.tx(async (c) => {
      const { rows } = await c.query(
        `SELECT s.id, s.account_id FROM ${SCHEMA}.login_refresh_tokens t JOIN ${SCHEMA}.login_sessions s ON s.id = t.session_id
          WHERE t.token_sha256 = $1 AND s.revoked_at IS NULL FOR UPDATE OF s`, [opaqueTokenDigest(token)]);
      if (!rows[0]) return;
      await c.query(`UPDATE ${SCHEMA}.login_sessions SET revoked_at = $2, revoke_reason = 'LOGOUT' WHERE id = $1`, [rows[0].id, this.now()]);
      await this.eventBestEffort(c, { event: "logout", outcome: "success", accountId: rows[0].account_id, sessionId: rows[0].id, client: facts });
    });
  }

  // ════════════════════ tickets: first password, and reset ════════════════════

  async completeEnrollment(input: { ticket: unknown; password: unknown }, facts: ClientFacts | null): Promise<{ loginIdentifier: string }> {
    return this.consumeTicket("enrollment", input, facts);
  }

  async completeReset(input: { ticket: unknown; password: unknown }, facts: ClientFacts | null): Promise<{ loginIdentifier: string }> {
    return this.consumeTicket("reset", input, facts);
  }

  private async consumeTicket(purpose: "enrollment" | "reset", input: { ticket: unknown; password: unknown }, facts: ClientFacts | null) {
    const kind = purpose === "enrollment" ? "enrollment" : "reset";
    if (!isOpaqueTokenOf(kind, input.ticket)) throw new LoginRefusal("TICKET_INVALID");
    const digest = opaqueTokenDigest(input.ticket);
    // Look the ticket up FIRST, so the password policy can consider the identifier -- but hash outside the transaction.
    const { rows: peek } = await this.deps.pool.query(
      `SELECT a.login_identifier, a.id AS account_id, a.tenant_id, a.principal_id, t.id AS ticket_id, t.issued_by,
              t.consumed_at, t.revoked_at, t.expires_at
         FROM ${SCHEMA}.login_tickets t JOIN ${SCHEMA}.login_accounts a ON a.id = t.account_id
        WHERE t.token_sha256 = $1 AND t.purpose = $2`, [digest, purpose]);
    if (!peek[0]) {
      await this.event(this.deps.pool, { event: purpose === "enrollment" ? "enrollmentComplete" : "resetComplete", outcome: "refused", reason: "UNKNOWN_TICKET", client: facts });
      throw new LoginRefusal("TICKET_INVALID");
    }
    // A used, withdrawn or expired code is refused BEFORE any password work (re-review finding 2): the same 410 as every
    // other refusal, but no scrypt for a code that can no longer do anything.
    if (peek[0].consumed_at || peek[0].revoked_at || peek[0].expires_at.getTime() <= this.now().getTime()) {
      await this.event(this.deps.pool, { event: purpose === "enrollment" ? "enrollmentComplete" : "resetComplete", outcome: "refused",
        reason: "TICKET_NOT_OPEN", accountId: peek[0].account_id, client: facts });
      throw new LoginRefusal("TICKET_INVALID");
    }
    // A CODE IS WORTH ITS ISSUER'S AUTHORITY *NOW* (second review finding 2). Between issue and use the person may have
    // gained the Owner or Administrator Role or a membership in another tenant, or the issuer may have lost authority.
    // Re-run exactly the issue-time check against the issuer; if it no longer holds, the code dies unused. Done BEFORE the
    // transaction: it reads through the policy repository, and must not hold a pool connection while doing so.
    //
    // The password is checked and hashed FIRST (independent review F2): scrypt can queue behind the hashing semaphore for
    // seconds, and that must not sit between the authority check and the transaction that relies on it.
    const policy = passwordPolicyRefusal(input.password, peek[0].login_identifier);
    if (policy) throw new LoginRefusal("PASSWORD_POLICY", policy);
    const hash = await hashPassword(input.password as string, this.hashParameters);
    let authoritySnapshot: { issuer: string; target: string };
    {
      const capability = purpose === "enrollment" ? "admin.roleAssignment.write" : "admin.credentialReset.initiate";
      // BOTH people: the issuer's authority is what the code is worth, the target's decides whether that is enough.
      authoritySnapshot = {
        issuer: await this.authorityFingerprint(this.deps.pool, [peek[0].issued_by]),
        target: await this.authorityFingerprint(this.deps.pool, [peek[0].principal_id]),
      };
      const lapsed = await this.targetAdministrable(peek[0].issued_by, peek[0].tenant_id, peek[0].principal_id, capability);
      if (lapsed) {
        await this.tx(async (c) => {
          await c.query(`UPDATE ${SCHEMA}.login_tickets SET revoked_at = $2 WHERE id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`, [peek[0].ticket_id, this.now()]);
          await this.event(c, { event: purpose === "enrollment" ? "enrollmentComplete" : "resetComplete", outcome: "refused",
            reason: "TICKET_ISSUER_AUTHORITY_LAPSED", accountId: peek[0].account_id, principalId: peek[0].principal_id, client: facts });
        });
        throw new LoginRefusal("TICKET_INVALID");
      }
      // TEST ONLY: the window between the issuer re-check and the consuming transaction (residual R-B proof).
      if (this.deps.testHooks?.beforeTicketTransaction) await this.deps.testHooks.beforeTicketTransaction();
    }
    const eventName = purpose === "enrollment" ? "enrollmentComplete" : "resetComplete";

    const outcome = await this.tx(async (c) => {
      // LOCK ORDER account -> ticket (independent review F1): the administrative writers (disable, retire, reissue) lock
      // the account and then its open tickets. Taking the ticket first here deadlocked against them.
      const a = await this.accountById(c, peek[0].account_id, true);
      const { rows } = await c.query(`SELECT * FROM ${SCHEMA}.login_tickets WHERE token_sha256 = $1 AND purpose = $2 FOR UPDATE`, [digest, purpose]);
      const t = rows[0];
      const now = this.now();
      if (!t || t.account_id !== peek[0].account_id || t.consumed_at || t.revoked_at || t.expires_at.getTime() <= now.getTime()) {
        await this.event(c, { event: eventName, outcome: "refused", reason: "TICKET_NOT_OPEN", accountId: t?.account_id, client: facts });
        return null;
      }
      // RESIDUAL R-B (Owner 2026-10-12): the issuer re-check above ran OUTSIDE this transaction. Re-read BOTH people's
      // authority state here, on this connection, holding share locks on it: if a promotion, a lost Role or grant, a
      // membership, Employee or Principal change committed since, the decision above answered different facts -- refuse;
      // the code stays open, a retry re-checks. A change that commits AFTER this read waits on the locks for existing rows; a brand-new row cannot be
      // locked in advance, and that sub-millisecond window is the recorded residual.
      if (a) {
        const changed = (await this.authorityFingerprint(c, [t.issued_by], true)) !== authoritySnapshot.issuer ? "ISSUER_AUTHORITY_CHANGED"
          : (await this.authorityFingerprint(c, [a.principal_id], true)) !== authoritySnapshot.target ? "TARGET_AUTHORITY_CHANGED" : null;
        if (changed) {
          await this.event(c, { event: eventName, outcome: "refused", reason: changed, accountId: t.account_id, client: facts });
          return null;
        }
      }
      const expected = purpose === "enrollment" ? "pending_enrollment" : "active";
      if (!a || a.status !== expected || a.binding_status !== "active") {
        await this.event(c, { event: eventName, outcome: "refused", reason: "ACCOUNT_NOT_ELIGIBLE", accountId: t.account_id, client: facts });
        return null;
      }
      await c.query(`UPDATE ${SCHEMA}.login_tickets SET consumed_at = $2 WHERE id = $1`, [t.id, now]);
      await c.query(
        `UPDATE ${SCHEMA}.login_accounts SET status = 'active', password_hash = $2, password_changed_at = $3,
           credential_version = credential_version + 1, failed_attempts = 0, locked_until = NULL, updated_at = $3 WHERE id = $1`,
        [a.id, hash, now]);
      const revoked = await this.revokeSessions(c, a.id, purpose === "enrollment" ? "ENROLLMENT" : "PASSWORD_RESET");
      await this.audit(c, a.tenant_id, a.principal_id, purpose === "enrollment" ? "completeLoginEnrollment" : "completeLoginReset", a.id,
        { status: a.status }, { status: "active", ticketId: t.id, sessionsRevoked: revoked },
        purpose === "enrollment" ? "the account holder set their first password" : "the account holder reset their password with a reset ticket");
      await this.event(c, { event: eventName, outcome: "success", accountId: a.id, principalId: a.principal_id, client: facts });
      return { loginIdentifier: a.login_identifier };
    });
    if (!outcome) throw new LoginRefusal("TICKET_INVALID");
    return outcome;
  }

  // ════════════════════ the session gate ════════════════════

  /**
   * Is this (subject, session) still good? Run for EVERY human EOS token on EVERY request (the composite verifier) and
   * by the self-service routes. `forApi` additionally refuses a session that owes a second factor.
   */
  async checkSession(subject: string, sessionId: string | null, mode: "api" | "self"): Promise<SessionRow> {
    if (!sessionId) throw new LoginRefusal("SESSION_INVALID");
    const { rows } = await this.deps.pool.query(
      `SELECT a.*, pi.external_subject AS subject, pi.status AS binding_status, s.id AS session_id, s.mfa_verified,
              s.tenant_id AS session_tenant_id,
              EXISTS (SELECT 1 FROM ${SCHEMA}.tenant_memberships m
                       WHERE m.principal_id = a.principal_id AND m.tenant_id = s.tenant_id AND m.status = 'active') AS session_tenant_member,
              -- RESIDUAL R-A (Owner 2026-10-12): an ACTIVE Employee link IN THE SESSION'S TENANT to an access-eligible
              -- Employee, on EVERY request -- unlinking or an ineligible status ends API reach at once, not at token expiry.
              (SELECT count(*) FROM ${SCHEMA}.employee_principal_links l
                 JOIN eos_workforce.employees e ON e.tenant_id = l.tenant_id AND e.id = l.employee_id
                WHERE l.tenant_id = s.tenant_id AND l.principal_id = a.principal_id AND l.status = 'active'
                  AND e.employment_status::text = ANY($2::text[])) AS eligible_employee_links,
              s.revoked_at AS session_revoked_at, s.idle_expires_at, s.absolute_expires_at, s.credential_version AS session_cv,
              EXISTS (SELECT 1 FROM ${SCHEMA}.login_mfa_factors f WHERE f.account_id = a.id AND f.status = 'active') AS has_factor,
              EXISTS (SELECT 1 FROM ${SCHEMA}.tenant_memberships m
                       WHERE m.principal_id = a.principal_id AND m.tenant_id <> a.tenant_id AND m.status = 'active') AS foreign_membership
         FROM ${SCHEMA}.login_sessions s
         JOIN ${SCHEMA}.login_accounts a ON a.id = s.account_id
         JOIN ${SCHEMA}.principal_identities pi ON pi.id = a.binding_id
        WHERE s.id = $1`, [sessionId, ACCESS_ELIGIBLE_EMPLOYMENT_STATUSES]);
    const r = rows[0];
    const now = this.now().getTime();
    if (!r || r.subject !== subject || r.session_revoked_at || r.status !== "active" || r.binding_status !== "active"
      || r.idle_expires_at.getTime() <= now || r.absolute_expires_at.getTime() <= now || r.credential_version !== r.session_cv
      // D-12: the session's OWN tenant membership, on every request -- revoking it ends the session's reach at once.
      || !r.session_tenant_member
      || Number(r.eligible_employee_links) !== 1
      // Single-tenant mode (finding 1): a membership in another tenant appearing mid-session ends it too.
      || (!this.multiTenant && r.foreign_membership)) {
      throw new LoginRefusal("SESSION_INVALID");
    }
    // A session that owes a second factor reaches /auth/* (to enroll one) and nothing else.
    if (mode === "api" && r.mfa_required && !r.mfa_verified) {
      throw new LoginRefusal("MFA_ENROLLMENT_REQUIRED");
    }
    // SELF-SERVICE runs the full resolution too (second review finding 7): a disabled Principal, an ineligible Employee or
    // a suspended tenant cannot use /auth/* (change a password, open a session) within the access token's life. API
    // requests get the same answer from their own resolveOperationalContext downstream.
    if (mode === "self") {
      try {
        await this.requireEligible(r, r.session_tenant_id);
      } catch (err) {
        if (err instanceof PrincipalContextError) throw new LoginRefusal("SESSION_INVALID");
        throw err;
      }
    }
    return r;
  }

  // ════════════════════ tenant: refusals and the explicit switch (Owner ruling D-12) ════════════════════

  /** Last tenantRefused record per session (ms). Bounds the append-only log under a stream of forged headers (finding 9). */
  private readonly tenantRefusalSeen = new Map<string, number>();

  /**
   * Record a request that stated a tenant other than its session's (requestTenantBinding refused it). At most one row per
   * session per minute: every refusal is still REFUSED; only the record of a repeat is coalesced.
   */
  async recordTenantRefusal(session: SessionRow): Promise<void> {
    const t = this.now().getTime();
    const last = this.tenantRefusalSeen.get(session.session_id);
    if (last !== undefined && t - last < 60_000) return;
    if (this.tenantRefusalSeen.size > 10_000) this.tenantRefusalSeen.clear();
    this.tenantRefusalSeen.set(session.session_id, t);
    await this.event(this.deps.pool, { event: "tenantRefused", outcome: "refused", reason: "TENANT_NOT_SESSION_TENANT",
      accountId: session.id, principalId: session.principal_id, sessionId: session.session_id, tenantId: session.session_tenant_id });
  }

  /**
   * Move to another tenant: a NEW session bound to the target, the current one revoked, both in one transaction under the
   * session row lock -- two concurrent switches of one session cannot both succeed. Validated exactly like a login into
   * that tenant (membership, tenant status, the target tenant's Employee gate). Carries the second-factor state: a person
   * who proved a factor does not lose it by switching, and a session that owes one cannot switch (api mode).
   */
  async switchTenant(subject: string, sessionId: string | null, input: { tenantId: unknown }, facts: ClientFacts | null): Promise<IssuedLoginSession> {
    if (!this.multiTenant) throw new LoginRefusal("TENANT_SWITCHING_DISABLED");
    const a = await this.checkSession(subject, sessionId, "api");
    const target = typeof input.tenantId === "string" ? input.tenantId.trim() : "";
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(target)) throw new LoginRefusal("INVALID_INPUT", "tenantId is required");
    if (target === a.session_tenant_id) throw new LoginRefusal("CONFLICT", "ALREADY_IN_TENANT");
    try {
      await this.requireEligible(a, target);
    } catch (err) {
      if (err instanceof PrincipalContextError) {
        await this.event(this.deps.pool, { event: "tenantSwitch", outcome: "refused", reason: `PRINCIPAL_${err.refusal}`,
          accountId: a.id, principalId: a.principal_id, sessionId: a.session_id, tenantId: a.session_tenant_id });
        throw new LoginRefusal("FORBIDDEN", "that tenant is not available to this person");
      }
      throw err;
    }
    const out = await this.tx(async (c): Promise<IssuedLoginSession | null> => {
      // LOCK ORDER account -> session, the order of every writer that takes BOTH (password change, disable, reset, retire
      // take the account row and then update its sessions; using a code takes account -> ticket). The reverse order
      // deadlocked against them (RESIDUAL R-C). refresh, logout and session revocation lock a session WITHOUT the account;
      // that is safe only while they never go on to lock the account -- adding an account lock there must take it FIRST.
      const fresh = await this.accountById(c, a.id, true);
      if (!fresh || fresh.status !== "active" || fresh.credential_version !== a.credential_version) return null;
      const { rows } = await c.query(`SELECT revoked_at, tenant_id FROM ${SCHEMA}.login_sessions WHERE id = $1 FOR UPDATE`, [a.session_id]);
      if (!rows[0] || rows[0].revoked_at || rows[0].tenant_id !== a.session_tenant_id) return null;
      const now = this.now();
      await c.query(`UPDATE ${SCHEMA}.login_sessions SET revoked_at = $2, revoke_reason = 'TENANT_SWITCH' WHERE id = $1`, [a.session_id, now]);
      const session = await this.openSession(c, fresh, a.mfa_verified, facts, target);
      const detail = { fromTenantId: a.session_tenant_id, toTenantId: target, fromSessionId: a.session_id, toSessionId: session.sessionId };
      // Audited in BOTH tenants: the one left and the one entered.
      await this.audit(c, a.session_tenant_id, a.principal_id, "switchLoginTenant", a.id, null, detail, "the account holder switched tenant");
      await this.audit(c, target, a.principal_id, "switchLoginTenant", a.id, null, detail, "the account holder switched tenant");
      await this.event(c, { event: "tenantSwitch", outcome: "success", accountId: a.id, principalId: a.principal_id, sessionId: session.sessionId, tenantId: target, client: facts });
      return session;
    });
    if (!out) throw new LoginRefusal("SESSION_INVALID");
    return out;
  }

  // ════════════════════ self-service (an authenticated human, on their own account) ════════════════════

  async describeSelf(subject: string, sessionId: string | null) {
    const a = await this.checkSession(subject, sessionId, "self");
    const [{ rows: factors }, { rows: codes }, { rows: sessions }] = await Promise.all([
      this.deps.pool.query(`SELECT kind, status, confirmed_at FROM ${SCHEMA}.login_mfa_factors WHERE account_id = $1 AND status = 'active'`, [a.id]),
      this.deps.pool.query(`SELECT count(*)::int n FROM ${SCHEMA}.login_recovery_codes WHERE account_id = $1 AND used_at IS NULL AND superseded_at IS NULL`, [a.id]),
      this.deps.pool.query(
        `SELECT id, created_at, last_refreshed_at, client_label, mfa_verified FROM ${SCHEMA}.login_sessions
          WHERE account_id = $1 AND revoked_at IS NULL AND idle_expires_at > $2 AND absolute_expires_at > $2 ORDER BY created_at DESC`,
        [a.id, this.now()]),
    ]);
    const { rows: tenants } = await this.deps.pool.query(
      `SELECT t.id, t.name FROM ${SCHEMA}.tenant_memberships m JOIN ${SCHEMA}.tenants t ON t.id = m.tenant_id
        WHERE m.principal_id = $1 AND m.status = 'active' AND t.status = 'active' ORDER BY t.name, t.id`, [a.principal_id]);
    return Object.freeze({
      loginIdentifier: a.login_identifier,
      principalId: a.principal_id,
      tenantId: a.session_tenant_id,
      multiTenantSessions: this.multiTenant,
      // The tenants this person may switch to (active memberships of active tenants). Eligibility is proven at switch.
      tenants: this.multiTenant ? tenants.map((t) => ({ tenantId: t.id, name: t.name, current: t.id === a.session_tenant_id })) : [],
      mfaRequired: a.mfa_required,
      mfaConfigured: this.mfaConfigured,
      factors: factors.map((f) => ({ kind: f.kind, confirmedAt: f.confirmed_at.toISOString() })),
      recoveryCodesRemaining: codes[0].n,
      passwordChangedAt: a.password_changed_at ? a.password_changed_at.toISOString() : null,
      sessions: sessions.map((s) => ({
        sessionId: s.id, current: s.id === a.session_id, createdAt: s.created_at.toISOString(),
        lastRefreshedAt: s.last_refreshed_at.toISOString(), client: s.client_label, mfaVerified: s.mfa_verified,
      })),
    });
  }

  /** Change the password. Every session -- this one included -- ends; a fresh one is returned. */
  async changePassword(subject: string, sessionId: string | null, input: { currentPassword: unknown; newPassword: unknown }, facts: ClientFacts | null): Promise<IssuedLoginSession> {
    const a = await this.checkSession(subject, sessionId, "self");
    if (typeof input.currentPassword !== "string" || input.currentPassword.length > PASSWORD_MAX_LENGTH * 4) throw new LoginRefusal("CURRENT_PASSWORD_REFUSED");
    // The same atomic reservation as login: a stolen session cannot guess the current password past the lockout (finding 7).
    if (!(await this.currentPasswordMatches(a, input.currentPassword, "passwordChange", sessionId, facts))) {
      throw new LoginRefusal("CURRENT_PASSWORD_REFUSED");
    }
    const policy = passwordPolicyRefusal(input.newPassword, a.login_identifier);
    if (policy) throw new LoginRefusal("PASSWORD_POLICY", policy);
    if ((await verifyPassword(input.newPassword as string, a.password_hash)).matches) throw new LoginRefusal("PASSWORD_POLICY", "PASSWORD_UNCHANGED");
    const hash = await hashPassword(input.newPassword as string, this.hashParameters);
    return this.tx(async (c) => {
      const locked = await this.accountById(c, a.id, true);
      if (!locked || locked.credential_version !== a.credential_version || locked.status !== "active") throw new LoginRefusal("SESSION_INVALID");
      const now = this.now();
      await c.query(
        `UPDATE ${SCHEMA}.login_accounts SET password_hash = $2, password_changed_at = $3, credential_version = credential_version + 1,
           failed_attempts = 0, locked_until = NULL, updated_at = $3 WHERE id = $1`, [a.id, hash, now]);
      const revoked = await this.revokeSessions(c, a.id, "PASSWORD_CHANGED");
      await this.audit(c, a.tenant_id, a.principal_id, "changeLoginPassword", a.id, null, { sessionsRevoked: revoked }, "the account holder changed their password");
      await this.event(c, { event: "passwordChange", outcome: "success", accountId: a.id, principalId: a.principal_id, sessionId, client: facts });
      const fresh = await this.accountById(c, a.id);
      return this.openSession(c, fresh as AccountRow, a.mfa_verified, facts, a.session_tenant_id);
    });
  }

  async beginTotpEnrollment(subject: string, sessionId: string | null, input: { password?: unknown } = {}, facts: ClientFacts | null = null) {
    const a = await this.checkSession(subject, sessionId, "self");
    const keyring = this.deps.factorKeyring;
    if (!keyring) throw new LoginRefusal("MFA_NOT_CONFIGURED");
    // The CURRENT PASSWORD, as for every factor change (second review finding 6): a stolen five-minute access token must not
    // be able to bind the thief's authenticator (and sign everyone else out).
    if (!(await this.currentPasswordMatches(a, input.password, "mfaEnroll", sessionId, facts))) throw new LoginRefusal("CURRENT_PASSWORD_REFUSED");
    return this.tx(async (c) => {
      const { rows } = await c.query(`SELECT * FROM ${SCHEMA}.login_mfa_factors WHERE account_id = $1 AND status <> 'removed' FOR UPDATE`, [a.id]);
      if (rows.some((f) => f.status === "active")) throw new LoginRefusal("MFA_ALREADY_ENROLLED");
      // An abandoned enrollment is replaced, not stacked.
      for (const f of rows) {
        await c.query(`UPDATE ${SCHEMA}.login_mfa_factors SET status = 'removed', removed_at = $2, removed_by = $3 WHERE id = $1`, [f.id, this.now(), a.principal_id]);
      }
      const factorId = randomUUID();
      const secret = newTotpSecret();
      await c.query(
        `INSERT INTO ${SCHEMA}.login_mfa_factors (id, account_id, kind, status, secret_sealed, created_at) VALUES ($1,$2,'totp','pending',$3,$4)`,
        [factorId, a.id, encryptFactorSecret(keyring, secret, factorId), this.now()]);
      // The secret leaves the server ONCE, here, to be put in an authenticator app.
      return Object.freeze({
        factorId,
        secret: base32Encode(secret),
        otpauthUri: totpProvisioningUri({ issuerLabel: this.deps.totpIssuerLabel ?? "Verenward EOS", accountLabel: a.login_identifier, secret }),
      });
    });
  }

  async confirmTotpEnrollment(subject: string, sessionId: string | null, input: { factorId: unknown; code: unknown }, facts: ClientFacts | null) {
    const a = await this.checkSession(subject, sessionId, "self");
    const keyring = this.deps.factorKeyring;
    if (!keyring) throw new LoginRefusal("MFA_NOT_CONFIGURED");
    if (typeof input.factorId !== "string") throw new LoginRefusal("INVALID_INPUT", "factorId is required");
    return this.tx(async (c) => {
      const { rows } = await c.query(
        `SELECT * FROM ${SCHEMA}.login_mfa_factors WHERE id = $1 AND account_id = $2 AND status = 'pending' FOR UPDATE`, [input.factorId, a.id]);
      const f = rows[0];
      if (!f) throw new LoginRefusal("NOT_FOUND", "no pending factor");
      const step = matchTotpStep(decryptFactorSecret(keyring, f.secret_sealed, f.id), input.code, Math.floor(this.now().getTime() / 1000));
      if (step === null) {
        // Recorded and COMMITTED; the refusal is thrown after the transaction.
        await this.event(c, { event: "mfaEnroll", outcome: "refused", reason: "CODE_REFUSED", accountId: a.id, sessionId, client: facts });
        return null;
      }
      const now = this.now();
      await c.query(`UPDATE ${SCHEMA}.login_mfa_factors SET status = 'active', confirmed_at = $2, last_used_step = $3 WHERE id = $1`, [f.id, now, step]);
      const codes = await this.replaceRecoveryCodes(c, keyring, a.id);
      // This session just proved possession of the factor: it is now a verified session.
      await c.query(`UPDATE ${SCHEMA}.login_sessions SET mfa_verified = TRUE WHERE id = $1`, [a.session_id]);
      // Every OTHER session was password-only; they end.
      const revoked = await this.revokeSessions(c, a.id, "MFA_ENROLLED", a.session_id);
      await this.audit(c, a.tenant_id, a.principal_id, "enrollLoginMfa", a.id, null, { factorId: f.id, kind: "totp", sessionsRevoked: revoked },
        "the account holder enrolled an authenticator");
      await this.event(c, { event: "mfaEnroll", outcome: "success", accountId: a.id, principalId: a.principal_id, sessionId, client: facts });
      return Object.freeze({ recoveryCodes: codes });
    }).then((out) => {
      if (!out) throw new LoginRefusal("MFA_CODE_REFUSED");
      return out;
    });
  }

  private async replaceRecoveryCodes(c: PoolClient, keyring: FactorKeyring, accountId: string): Promise<string[]> {
    const now = this.now();
    await c.query(`UPDATE ${SCHEMA}.login_recovery_codes SET superseded_at = $2 WHERE account_id = $1 AND used_at IS NULL AND superseded_at IS NULL`, [accountId, now]);
    const codes = newRecoveryCodes();
    for (const code of codes) {
      await c.query(`INSERT INTO ${SCHEMA}.login_recovery_codes (id, account_id, key_id, code_digest, created_at) VALUES ($1,$2,$3,$4,$5)`,
        [randomUUID(), accountId, keyring.currentKid, recoveryCodeDigest(keyring, keyring.currentKid, accountId, normalizeRecoveryCode(code) as string), now]);
    }
    return codes;
  }

  /**
   * The holder's current password, checked like a login: an attempt is reserved atomically first (a locked account is
   * refused with no evaluation), the hash runs OUTSIDE any transaction (no pool connection waits on the semaphore), and a
   * success clears the counter. A refusal is recorded.
   */
  private async currentPasswordMatches(a: AccountRow, password: unknown, event: string, sessionId: string | null, facts: ClientFacts | null): Promise<boolean> {
    const pw = typeof password === "string" && password.length <= PASSWORD_MAX_LENGTH * 4 ? password : "";
    if (!(await this.reserveAttempt(this.deps.pool, a.id))) {
      await this.event(this.deps.pool, { event, outcome: "refused", reason: "ACCOUNT_LOCKED", accountId: a.id, sessionId, client: facts });
      return false;
    }
    if (!pw || !(await verifyPassword(pw, a.password_hash)).matches) {
      await this.event(this.deps.pool, { event, outcome: "refused", reason: "CURRENT_PASSWORD", accountId: a.id, sessionId, client: facts });
      return false;
    }
    await this.clearFailures(this.deps.pool, a.id);
    return true;
  }

  /** Step-up for a sensitive self-service act: the second factor, AFTER currentPasswordMatches passed outside the tx. */
  private async requireFactor(c: PoolClient, keyring: FactorKeyring, a: AccountRow, input: { code?: unknown; recoveryCode?: unknown }) {
    const locked = await this.accountById(c, a.id, true);
    if (!locked || this.isLocked(locked)) return "CURRENT_PASSWORD_REFUSED" as const;
    const method = await this.secondFactorOrKeyRefusal(c, keyring, a, input);
    if (method === "KEY_UNAVAILABLE") return "MFA_KEY_UNAVAILABLE" as const;
    if (!method) {
      await this.recordFailure(c, locked);
      return "MFA_CODE_REFUSED" as const;
    }
    return null;
  }

  async removeTotp(subject: string, sessionId: string | null, input: { password: unknown; code?: unknown; recoveryCode?: unknown }, facts: ClientFacts | null) {
    const a = await this.checkSession(subject, sessionId, "self");
    const keyring = this.deps.factorKeyring;
    if (!keyring) throw new LoginRefusal("MFA_NOT_CONFIGURED");
    if (a.mfa_required) throw new LoginRefusal("MFA_REQUIRED_BY_POLICY");
    if (!(await this.hasActiveFactor(this.deps.pool, a.id))) throw new LoginRefusal("MFA_NOT_ENROLLED");
    if (!(await this.currentPasswordMatches(a, input.password, "mfaRemove", sessionId, facts))) throw new LoginRefusal("CURRENT_PASSWORD_REFUSED");
    const refusal = await this.tx(async (c) => {
      if (!(await this.hasActiveFactor(c, a.id))) return "MFA_NOT_ENROLLED" as const;
      const r = await this.requireFactor(c, keyring, a, input);
      if (r) {
        await this.event(c, { event: "mfaRemove", outcome: "refused", reason: r, accountId: a.id, sessionId, client: facts });
        return r;
      }
      const now = this.now();
      await c.query(`UPDATE ${SCHEMA}.login_mfa_factors SET status = 'removed', removed_at = $2, removed_by = $3 WHERE account_id = $1 AND status <> 'removed'`, [a.id, now, a.principal_id]);
      await c.query(`UPDATE ${SCHEMA}.login_recovery_codes SET superseded_at = $2 WHERE account_id = $1 AND used_at IS NULL AND superseded_at IS NULL`, [a.id, now]);
      await this.audit(c, a.tenant_id, a.principal_id, "removeLoginMfa", a.id, { kind: "totp" }, null, "the account holder removed their authenticator");
      await this.event(c, { event: "mfaRemove", outcome: "success", accountId: a.id, principalId: a.principal_id, sessionId, client: facts });
      return null;
    });
    if (refusal) throw new LoginRefusal(refusal);
    return Object.freeze({ removed: true });
  }

  async regenerateRecoveryCodes(subject: string, sessionId: string | null, input: { password: unknown; code?: unknown }, facts: ClientFacts | null) {
    const a = await this.checkSession(subject, sessionId, "self");
    const keyring = this.deps.factorKeyring;
    if (!keyring) throw new LoginRefusal("MFA_NOT_CONFIGURED");
    if (!(await this.hasActiveFactor(this.deps.pool, a.id))) throw new LoginRefusal("MFA_NOT_ENROLLED");
    if (!(await this.currentPasswordMatches(a, input.password, "recoveryCodesRegenerate", sessionId, facts))) throw new LoginRefusal("CURRENT_PASSWORD_REFUSED");
    const out = await this.tx(async (c) => {
      if (!(await this.hasActiveFactor(c, a.id))) return { refusal: "MFA_NOT_ENROLLED" as const };
      // A TOTP code specifically: a recovery code may not mint more recovery codes.
      const r = await this.requireFactor(c, keyring, a, { code: input.code ?? "" });
      if (r) {
        await this.event(c, { event: "recoveryCodesRegenerate", outcome: "refused", reason: r, accountId: a.id, sessionId, client: facts });
        return { refusal: r };
      }
      const codes = await this.replaceRecoveryCodes(c, keyring, a.id);
      await this.audit(c, a.tenant_id, a.principal_id, "regenerateLoginRecoveryCodes", a.id, null, { count: codes.length }, "the account holder regenerated recovery codes");
      await this.event(c, { event: "recoveryCodesRegenerate", outcome: "success", accountId: a.id, principalId: a.principal_id, sessionId, client: facts });
      return { codes };
    });
    if ("refusal" in out) throw new LoginRefusal(out.refusal as LoginRefusalCode);
    return Object.freeze({ recoveryCodes: out.codes });
  }

  async revokeOwnSession(subject: string, sessionId: string | null, input: { sessionId: unknown }, facts: ClientFacts | null) {
    const a = await this.checkSession(subject, sessionId, "self");
    if (typeof input.sessionId !== "string") throw new LoginRefusal("INVALID_INPUT", "sessionId is required");
    return this.tx(async (c) => {
      const { rowCount } = await c.query(
        `UPDATE ${SCHEMA}.login_sessions SET revoked_at = $3, revoke_reason = 'REVOKED_BY_HOLDER' WHERE id = $1 AND account_id = $2 AND revoked_at IS NULL`,
        [input.sessionId, a.id, this.now()]);
      if (rowCount !== 1) throw new LoginRefusal("NOT_FOUND", "no such live session");
      await this.eventBestEffort(c, { event: "sessionRevoke", outcome: "success", accountId: a.id, principalId: a.principal_id, sessionId: input.sessionId as string, client: facts });
      return Object.freeze({ revoked: 1 });
    });
  }

  async revokeOtherSessions(subject: string, sessionId: string | null, facts: ClientFacts | null) {
    const a = await this.checkSession(subject, sessionId, "self");
    return this.tx(async (c) => {
      const revoked = await this.revokeSessions(c, a.id, "REVOKED_BY_HOLDER", a.session_id);
      await this.eventBestEffort(c, { event: "sessionRevokeOthers", outcome: "success", accountId: a.id, principalId: a.principal_id, sessionId, client: facts });
      return Object.freeze({ revoked });
    });
  }

  // ════════════════════ key rotation census ════════════════════

  /**
   * Which factor key ids still protect live material: TOTP factors (pending or active) by the kid in their sealed
   * secret, live recovery codes by their key_id. A kid may be dropped from EOS_AUTH_FACTOR_KEYS only when it counts
   * ZERO here (docs/architecture/eos-native-identity.md, section 4: rotation). Counts only -- no secret, no account.
   */
  async factorKeyCensus(): Promise<{ factors: Record<string, number>; recoveryCodes: Record<string, number>; currentKid: string | null; unheld: string[] }> {
    const { rows: f } = await this.deps.pool.query(
      `SELECT split_part(secret_sealed, '.', 2) AS kid, count(*)::int AS n FROM ${SCHEMA}.login_mfa_factors
        WHERE status <> 'removed' GROUP BY 1 ORDER BY 1`);
    const { rows: r } = await this.deps.pool.query(
      `SELECT key_id AS kid, count(*)::int AS n FROM ${SCHEMA}.login_recovery_codes
        WHERE used_at IS NULL AND superseded_at IS NULL GROUP BY 1 ORDER BY 1`);
    const held = this.deps.factorKeyring ? new Set(this.deps.factorKeyring.keys.keys()) : new Set<string>();
    const kids = new Set([...f.map((x) => x.kid as string), ...r.map((x) => x.kid as string)]);
    return {
      factors: Object.fromEntries(f.map((x) => [x.kid, x.n])),
      recoveryCodes: Object.fromEntries(r.map((x) => [x.kid, x.n])),
      currentKid: this.deps.factorKeyring?.currentKid ?? null,
      unheld: [...kids].filter((k) => !held.has(k)).sort(),
    };
  }

  // ════════════════════ security administration (Administration > Users) ════════════════════

  /** Does `principalId` hold the protected Owner Role in this tenant? */
  /**
   * Does `principalId` hold a PROTECTED administering Role -- the Owner or the designated Administrator -- in ANY tenant?
   * Any tenant, not just the actor's: a credential is one login wherever its Principal is a member.
   */
  private async holdsProtectedAdministeringRole(q: Pick<PoolClient, "query"> | Pool, principalId: string): Promise<boolean> {
    const { rows } = await q.query(
      `SELECT 1 FROM ${SCHEMA}.user_role_assignments a JOIN ${SCHEMA}.roles r ON r.id = a.role_id
        WHERE a.principal_id = $1 AND a.status = 'active' AND r.protected AND r.key IN ($2, $3) LIMIT 1`,
      [principalId, PROTECTED_OWNER_ROLE_KEY, ADMIN_ROLE_KEY]);
    return rows.length > 0;
  }

  /**
   * A HUMAN EOS LOGIN IS SINGLE-TENANT (security review finding 1). A Principal with an active membership in any tenant
   * other than the account's could otherwise sign in through tenant A's login and state `x-eos-tenant: B` -- acting in a
   * tenant whose administrators can neither see nor revoke that login. So such a Principal is refused at provisioning,
   * at login, at every refresh and on every request (the session gate). Multi-tenant people await a ruling (D-12).
   */
  private async hasForeignMembership(q: Pick<PoolClient, "query"> | Pool, principalId: string, tenantId: string): Promise<boolean> {
    const { rows } = await q.query(
      `SELECT 1 FROM ${SCHEMA}.tenant_memberships WHERE principal_id = $1 AND tenant_id <> $2 AND status = 'active' LIMIT 1`,
      [principalId, tenantId]);
    return rows.length > 0;
  }

  /**
   * The gate every credential mutation passes:
   *
   *   CAPABILITY   the operation's governed key (LOGIN_ADMINISTRATION_OPERATIONS): admin.roleAssignment.write to create or
   *                remove a login (it binds an identity, like bindPrincipalEosIdentity); admin.credentialReset.initiate
   *                for credential recovery (DECISIONS #56 D-RESET-PERMISSION); admin.userStatus.write for enable/disable
   *                and session revocation. Existing PostgreSQL keys and grants -- none registered, none granted here.
   *   NOT SELF     an administrator uses their own account security page, never this.
   *   OWNER        an Owner's login is administered only by an Owner.
   *   MEMBER       the target is a member of the actor's tenant.
   */
  private async requireCredentialAdministration(actor: AdminActor, principalId: unknown, reason: unknown,
    capability: LoginAdministrationCapability): Promise<{ principalId: string; reason: string }> {
    if (capability === "admin.roleAssignment.write") {
      await requireSecurityAdministrationCapability(this.deps.repo, actor, "assignRole");
    } else {
      const held = await actorCapabilities(this.deps.repo, actor);
      if (!held.has(capability)) throw new LoginRefusal("FORBIDDEN", `not authorized: "${capability}" is required`);
    }
    if (typeof principalId !== "string" || principalId.trim() === "") throw new LoginRefusal("INVALID_INPUT", "principalId is required");
    const r = typeof reason === "string" ? reason.trim() : "";
    if (r.length === 0) throw new LoginRefusal("REASON_REQUIRED", "a stated reason is required");
    if (r.length > 500) throw new LoginRefusal("INVALID_INPUT", "reason is too long");
    const id = principalId.trim();
    if (id === actor.uid) throw new LoginRefusal("SELF_ADMINISTRATION", "use your own account security settings; an administrator may not administer their own login");
    const membership = await this.deps.repo.getMembership(actor.tenantId, id);
    if (!membership) throw new LoginRefusal("NOT_FOUND", "that principal is not a member of this tenant");
    const refusal = await this.targetAdministrable(actor.uid, actor.tenantId, id, capability);
    if (refusal === "PROTECTED_TARGET") throw new LoginRefusal("PROTECTED_TARGET", "only an Owner may administer the login of an Owner or Administrator");
    if (refusal) throw new LoginRefusal("FORBIDDEN", "TARGET_NOT_ADMINISTRABLE: you are not authorized to administer this person's login");
    return { principalId: id, reason: r };
  }

  /**
   * The authority state of these people as one digest -- the facts principal resolution and the capability check read:
   * the Principal (status), every membership (tenant, status) and its tenant (status), every Role assignment (tenant,
   * Role, status, scope), the capabilities granted to those Roles, every Employee link with its Employee's employment
   * status, and every access version. `lock` takes FOR SHARE on the existing rows, inside a transaction, so a change to
   * any of them waits for the caller to commit.
   */
  private async authorityFingerprint(q: Pick<PoolClient, "query"> | Pool, principalIds: readonly string[], lock = false): Promise<string> {
    const share = lock ? " FOR SHARE" : "";
    const ids = [...principalIds];
    const read = async (sql: string) => (await q.query(sql, [ids])).rows;
    const facts = [
      await read(`SELECT id, status::text FROM ${SCHEMA}.principals WHERE id = ANY($1::text[]) ORDER BY id${share}`),
      await read(`SELECT principal_id, tenant_id, status::text FROM ${SCHEMA}.tenant_memberships WHERE principal_id = ANY($1::text[]) ORDER BY principal_id, tenant_id${share}`),
      await read(`SELECT t.id, t.status::text FROM ${SCHEMA}.tenants t
                   WHERE t.id IN (SELECT tenant_id FROM ${SCHEMA}.tenant_memberships WHERE principal_id = ANY($1::text[])) ORDER BY t.id${share}`),
      await read(`SELECT id, principal_id, tenant_id, role_id, status::text, scope_type, scope_value FROM ${SCHEMA}.user_role_assignments
                   WHERE principal_id = ANY($1::text[]) ORDER BY id${share}`),
      await read(`SELECT rc.id, rc.tenant_id, rc.role_id, rc.capability_id FROM ${SCHEMA}.role_capabilities rc
                   WHERE (rc.tenant_id, rc.role_id) IN (SELECT tenant_id, role_id FROM ${SCHEMA}.user_role_assignments WHERE principal_id = ANY($1::text[]))
                   ORDER BY rc.id${share}`),
      // EMPLOYEE BEFORE LINK (re-review finding 1): the link commands lock employees -> links (lockEmployee, then the
      // link FOR UPDATE). A single `FOR SHARE OF l, e` locks in range-table order, links first -- a cycle with them.
      await read(`SELECT e.tenant_id, e.id, e.employment_status::text AS employment_status FROM eos_workforce.employees e
                   WHERE (e.tenant_id, e.id) IN (SELECT tenant_id, employee_id FROM ${SCHEMA}.employee_principal_links WHERE principal_id = ANY($1::text[]))
                   ORDER BY e.tenant_id, e.id${share}`),
      await read(`SELECT id, principal_id, tenant_id, employee_id, status::text FROM ${SCHEMA}.employee_principal_links
                   WHERE principal_id = ANY($1::text[]) ORDER BY id${share}`),
      await read(`SELECT principal_id, tenant_id, access_version FROM ${SCHEMA}.principal_access_versions WHERE principal_id = ANY($1::text[])
                   ORDER BY principal_id, tenant_id${share}`),
    ];
    return createHash("sha256").update(JSON.stringify(facts)).digest("hex");
  }

  /**
   * The issuer's EFFECTIVE authority in one tenant -- through principal resolution, so membership status, tenant status,
   * the DQ-007 Employee gate and stale-assignment exclusion all apply (second review finding 4). null = no authority.
   */
  private async authorityIn(principalId: string, tenantId: string): Promise<{ keys: ReadonlySet<string>; roleKeys: readonly string[] } | null> {
    try {
      const ctx = await runWithRequestScope(() => resolvePrincipalContextById(this.deps.repo, principalId, tenantId));
      return { keys: await capabilityKeysFor(this.deps.repo, tenantId, ctx.heldRoleKeys, principalId), roleKeys: ctx.heldRoleKeys };
    } catch (err) {
      if (err instanceof PrincipalContextError) return null;
      throw err;
    }
  }

  /**
   * May `issuerUid` (acting in `homeTenantId`) administer `targetId`'s login for `capability`? Asked when a credential act is
   * requested AND again when a setup or reset code is USED (second review finding 2): a code is worth exactly the authority
   * of whoever issued it, now.
   *
   *   EVERY TENANT the target belongs to -- any membership status, so a suspended membership cannot be reactivated into
   *   a login someone else controls (finding 3) -- and every tenant where the target holds a protected Role: the issuer
   *   must hold `capability` there, and be an Owner there wherever the target holds the Owner or Administrator Role
   *   (first review finding 3).
   *
   * Returns null, PROTECTED_TARGET (the home tenant's own Owner rule, visible to its administrators anyway) or
   * TARGET_NOT_ADMINISTRABLE (anything learned from ANOTHER tenant -- never named, finding 11).
   */
  private async targetAdministrable(issuerUid: string, homeTenantId: string, targetId: string,
    capability: string): Promise<null | "PROTECTED_TARGET" | "TARGET_NOT_ADMINISTRABLE"> {
    const { rows } = await this.deps.pool.query(
      `SELECT tenant_id FROM ${SCHEMA}.tenant_memberships WHERE principal_id = $1
       UNION
       SELECT a.tenant_id FROM ${SCHEMA}.user_role_assignments a JOIN ${SCHEMA}.roles r ON r.id = a.role_id
        WHERE a.principal_id = $1 AND a.status = 'active' AND r.protected AND r.key IN ($2, $3)`,
      [targetId, PROTECTED_OWNER_ROLE_KEY, ADMIN_ROLE_KEY]);
    const tenants = [homeTenantId, ...rows.map((x) => x.tenant_id as string).filter((t) => t !== homeTenantId)];
    for (const tenantId of tenants) {
      const home = tenantId === homeTenantId;
      const auth = await this.authorityIn(issuerUid, tenantId);
      if (!auth || !auth.keys.has(capability)) return "TARGET_NOT_ADMINISTRABLE";
      if (await this.holdsProtectedAdministeringRoleIn(targetId, tenantId) && !auth.roleKeys.includes(PROTECTED_OWNER_ROLE_KEY)) {
        return home ? "PROTECTED_TARGET" : "TARGET_NOT_ADMINISTRABLE";
      }
    }
    return null;
  }

  private async holdsProtectedAdministeringRoleIn(principalId: string, tenantId: string): Promise<boolean> {
    const { rows } = await this.deps.pool.query(
      `SELECT 1 FROM ${SCHEMA}.user_role_assignments a JOIN ${SCHEMA}.roles r ON r.id = a.role_id
        WHERE a.tenant_id = $1 AND a.principal_id = $2 AND a.status = 'active' AND r.protected AND r.key IN ($3, $4) LIMIT 1`,
      [tenantId, principalId, PROTECTED_OWNER_ROLE_KEY, ADMIN_ROLE_KEY]);
    return rows.length > 0;
  }

  private async issueTicket(c: PoolClient, accountId: string, purpose: "enrollment" | "reset", issuedBy: string, reason: string) {
    const now = this.now();
    await c.query(`UPDATE ${SCHEMA}.login_tickets SET revoked_at = $3 WHERE account_id = $1 AND purpose = $2 AND consumed_at IS NULL AND revoked_at IS NULL`,
      [accountId, purpose, now]);
    const ticket = newOpaqueToken(purpose === "enrollment" ? "enrollment" : "reset");
    const seconds = purpose === "enrollment" ? this.policy.enrollmentTicketSeconds : this.policy.resetTicketSeconds;
    const expires = new Date(now.getTime() + seconds * 1000);
    const id = randomUUID();
    await c.query(
      `INSERT INTO ${SCHEMA}.login_tickets (id, account_id, purpose, token_sha256, issued_by, issued_at, expires_at, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, accountId, purpose, opaqueTokenDigest(ticket), issuedBy, now, expires, reason]);
    return { ticketId: id, ticket, expiresAt: expires.toISOString() };
  }

  private async requireEmployeeLink(tenantId: string, principalId: string): Promise<void> {
    const fact = await this.deps.repo.getLinkedEmployeeAccessFact(tenantId, principalId);
    if (!fact || ("ambiguous" in fact && fact.ambiguous)) throw new LoginRefusal("CONFLICT", "EMPLOYEE_LINK_REQUIRED: the principal is not linked to exactly one Employee");
  }

  /**
   * DECISIONS #56 (protected final recoverable administrator): an ENABLED EOS login held by an Owner or Administrator
   * is not disabled or removed when it is the tenant's last one. Firebase sign-in still exists during the transition;
   * this keeps the EOS side from reaching zero administrators on its own.
   */
  private async requireNotLastAdministratorLogin(c: PoolClient, tenantId: string, a: AccountRow): Promise<void> {
    if (a.status !== "active") return;
    // Serialise every disable/retire in the tenant (finding 9): two administrators removing each other's logins at once
    // would each see the other still enabled and both commit, leaving zero.
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`eos-login-last-administrator:${tenantId}`]);
    const administering = `SELECT 1 FROM ${SCHEMA}.user_role_assignments ra JOIN ${SCHEMA}.roles r ON r.id = ra.role_id
      WHERE ra.tenant_id = $1 AND ra.principal_id = %P AND ra.status = 'active' AND ra.scope_type = 'global' AND r.key IN ('owner', 'admin') AND r.protected`;
    const { rows: target } = await c.query(administering.replace("%P", "$2"), [tenantId, a.principal_id]);
    if (target.length === 0) return;
    const { rows: others } = await c.query(
      // ANY enabled login -- whichever tenant it is homed in -- whose holder administers THIS tenant (second review
      // finding 13: in multi-tenant mode a login homed elsewhere can be this tenant's administrating login).
      `SELECT 1 FROM ${SCHEMA}.login_accounts la WHERE la.status = 'active' AND la.id <> $2
          AND EXISTS (${administering.replace("%P", "la.principal_id")}) LIMIT 1`, [tenantId, a.id]);
    if (others.length === 0) {
      throw new LoginRefusal("CONFLICT", "LAST_ADMINISTRATOR_LOGIN: this is the last enabled EOS sign-in held by an Owner or Administrator");
    }
  }

  private summary(a: AccountRow, extra: { hasFactor: boolean; liveSessions: number; recoveryCodesRemaining: number }) {
    return Object.freeze({
      accountId: a.id, principalId: a.principal_id, loginIdentifier: a.login_identifier, status: a.status,
      subject: a.subject, mfaRequired: a.mfa_required, mfaEnrolled: extra.hasFactor,
      recoveryCodesRemaining: extra.recoveryCodesRemaining, liveSessions: extra.liveSessions,
      failedAttempts: a.failed_attempts, lockedUntil: a.locked_until && this.isLocked(a) ? a.locked_until.toISOString() : null,
      lastLoginAt: a.last_login_at ? a.last_login_at.toISOString() : null,
      passwordChangedAt: a.password_changed_at ? a.password_changed_at.toISOString() : null,
      createdAt: a.created_at.toISOString(),
    });
  }

  async readLoginAccount(actor: AdminActor, input: Record<string, unknown>) {
    const held = await actorCapabilities(this.deps.repo, actor);
    const required = LOGIN_ADMINISTRATION_OPERATIONS.readLoginAccount.capability;
    if (!held.has(required)) throw new LoginRefusal("FORBIDDEN", `not authorized: "${required}" is required`);
    const principalId = typeof input.principalId === "string" ? input.principalId.trim() : "";
    if (!principalId) throw new LoginRefusal("INVALID_INPUT", "principalId is required");
    if (!(await this.deps.repo.getMembership(actor.tenantId, principalId))) throw new LoginRefusal("NOT_FOUND", "that principal is not a member of this tenant");
    const found = await this.liveAccountForPrincipal(this.deps.pool, principalId);
    // Another tenant's account is not this tenant's to see (tenant isolation); it reads as "has an EOS identity".
    const a = found && found.tenant_id === actor.tenantId ? found : null;
    const binding = await this.deps.repo.getActiveIdentityBinding(principalId, EOS_IDENTITY_PROVIDER);
    if (!a) {
      return Object.freeze({
        account: null,
        // Why provisioning would refuse, said up front: a persona or other EOS identity already holds the one slot.
        // The KIND only: the subject of an identity this tenant does not administer is not this tenant's to read.
        eosIdentity: binding ? { kind: binding.externalSubject.startsWith("nonprod-persona.") ? "persona" : "other" } : null,
        recentEvents: [],
      });
    }
    const [{ rows: f }, { rows: s }, { rows: rc }, { rows: ev }] = await Promise.all([
      this.deps.pool.query(`SELECT 1 FROM ${SCHEMA}.login_mfa_factors WHERE account_id = $1 AND status = 'active'`, [a.id]),
      this.deps.pool.query(`SELECT count(*)::int n FROM ${SCHEMA}.login_sessions WHERE account_id = $1 AND revoked_at IS NULL AND idle_expires_at > $2 AND absolute_expires_at > $2`, [a.id, this.now()]),
      this.deps.pool.query(`SELECT count(*)::int n FROM ${SCHEMA}.login_recovery_codes WHERE account_id = $1 AND used_at IS NULL AND superseded_at IS NULL`, [a.id]),
      this.deps.pool.query(`SELECT occurred_at, event, outcome, reason_code, client_label FROM ${SCHEMA}.authentication_events
                             WHERE account_id = $1 AND tenant_id = $2 ORDER BY occurred_at DESC, id DESC LIMIT 25`, [a.id, actor.tenantId]),
    ]);
    return Object.freeze({
      account: this.summary(a, { hasFactor: f.length > 0, liveSessions: s[0].n, recoveryCodesRemaining: rc[0].n }),
      eosIdentity: { subject: a.subject, kind: "login" },
      recentEvents: ev.map((e) => ({ occurredAt: e.occurred_at.toISOString(), event: e.event, outcome: e.outcome, reason: e.reason_code, client: e.client_label })),
    });
  }

  /**
   * Give an EXISTING Principal a login. Creates its EOS identity binding (subject `user.<hex>`), the account
   * (pending enrollment), and a one-time enrollment ticket returned ONCE to the administrator to hand over.
   * Not an authority change: the Principal id -- and so every Role, scope and Employee link -- is unchanged.
   */
  async provisionLoginAccount(actor: AdminActor, input: Record<string, unknown>) {
    const { principalId, reason } = await this.requireCredentialAdministration(actor, input.principalId, input.reason, "admin.roleAssignment.write");
    const identifier = normalizeLoginIdentifier(input.loginIdentifier);
    if (!identifier) throw new LoginRefusal("INVALID_INPUT", "loginIdentifier must be 3-128 of a-z 0-9 . _ @ + -");
    const mfaRequired = input.mfaRequired === true;
    const principal = await this.deps.repo.getPrincipal(principalId);
    if (!principal || principal.status !== "active") throw new LoginRefusal("CONFLICT", "that principal is not active");
    const membership = await this.deps.repo.getMembership(actor.tenantId, principalId);
    if (!membership || membership.status !== "active") throw new LoginRefusal("CONFLICT", "that principal is not an active member of this tenant");
    // A login is for a PERSON: the Principal must be linked to an Employee (DECISIONS #56: missing Employee linkage is
    // denied). A service or fixture Principal with no Employee gets no password.
    await this.requireEmployeeLink(actor.tenantId, principalId);
    if (!this.multiTenant && await this.hasForeignMembership(this.deps.pool, principalId, actor.tenantId)) {
      throw new LoginRefusal("CONFLICT", "MULTI_TENANT_PRINCIPAL: an EOS login is single-tenant; this principal is a member of another tenant");
    }
    if (await this.liveAccountForPrincipal(this.deps.pool, principalId)) throw new LoginRefusal("CONFLICT", "that principal already has a login account");
    if (await this.deps.repo.getActiveIdentityBinding(principalId, EOS_IDENTITY_PROVIDER)) {
      // A persona Principal already holds its one EOS identity (the persona model is frozen); so does any Principal
      // bound some other way. Provisioning never revokes another identity to make room.
      throw new LoginRefusal("CONFLICT", "that principal already has an active EOS identity");
    }
    if (await this.accountByIdentifier(this.deps.pool, identifier)) throw new LoginRefusal("CONFLICT", "that login identifier is in use");

    return this.tx(async (c) => {
      const policyTx = makeTransaction(c, { tenantId: actor.tenantId, uid: actor.uid });
      const subject = newHumanSubject();
      const binding = await policyTx.createPrincipalIdentityBinding({
        principalId, identityProvider: EOS_IDENTITY_PROVIDER, externalSubject: subject, createdBy: actor.uid,
        reason: `login account: ${reason}`,
      });
      await policyTx.bumpAccessVersion(principalId);
      const accountId = randomUUID();
      const now = this.now();
      try {
        await c.query(
          `INSERT INTO ${SCHEMA}.login_accounts (id, tenant_id, principal_id, binding_id, login_identifier, status, mfa_required, created_by, created_at, updated_at, reason)
           VALUES ($1,$2,$3,$4,$5,'pending_enrollment',$6,$7,$8,$8,$9)`,
          [accountId, actor.tenantId, principalId, binding.id, identifier, mfaRequired, actor.uid, now, reason]);
      } catch (err) {
        if ((err as { code?: string }).code === "23505") throw new LoginRefusal("CONFLICT", "that login identifier or principal already has a login account");
        throw err;
      }
      const ticket = await this.issueTicket(c, accountId, "enrollment", actor.uid, reason);
      await policyTx.appendAudit({
        action: "provisionLoginAccount", actorUid: actor.uid, targetKind: "loginAccount", targetId: accountId, before: null,
        after: { principalId, loginIdentifier: identifier, bindingId: binding.id, subject, mfaRequired, enrollmentTicketId: ticket.ticketId, ticketExpiresAt: ticket.expiresAt },
        occurredAt: now.toISOString(), reason,
      } as never);
      return Object.freeze({
        accountId, principalId, loginIdentifier: identifier, status: "pending_enrollment", subject, mfaRequired,
        // SHOWN ONCE. Not stored, not logged, not in the audit event. Hand it to the account holder out of band.
        enrollmentTicket: ticket.ticket, enrollmentTicketExpiresAt: ticket.expiresAt,
      });
    });
  }

  /** Common shape for the per-account administration acts below. */
  private async administer<T>(actor: AdminActor, input: Record<string, unknown>, action: LoginAdministrationOperation,
    preCheckOrFn: ((principalId: string) => Promise<void>) | ((c: PoolClient, a: AccountRow, reason: string) => Promise<{ before: unknown; after: unknown; result: T }>),
    maybeFn?: (c: PoolClient, a: AccountRow, reason: string) => Promise<{ before: unknown; after: unknown; result: T }>): Promise<T> {
    const preCheck = maybeFn ? (preCheckOrFn as (principalId: string) => Promise<void>) : null;
    const fn = (maybeFn ?? preCheckOrFn) as (c: PoolClient, a: AccountRow, reason: string) => Promise<{ before: unknown; after: unknown; result: T }>;
    const { principalId, reason } = await this.requireCredentialAdministration(actor, input.principalId, input.reason,
      LOGIN_ADMINISTRATION_OPERATIONS[action].capability as LoginAdministrationCapability);
    // Repository reads happen here, never inside the locking transaction below.
    if (preCheck) await preCheck(principalId);
    return this.tx(async (c) => {
      const a = await this.liveAccountForPrincipal(c, principalId, true);
      // TENANT ISOLATION: a login is administered only from the tenant it was provisioned in. A Principal that is ALSO a
      // member of another tenant does not make its credential that tenant's to reset, disable or remove.
      if (!a || a.tenant_id !== actor.tenantId) throw new LoginRefusal("NOT_FOUND", "that principal has no login account in this tenant");
      const { before, after, result } = await fn(c, a, reason);
      // The governed audit row is STRICT (no administrative change without it); the security event is best-effort.
      await this.audit(c, actor.tenantId, actor.uid, action, a.id, before, after, reason);
      await this.eventBestEffort(c, { event: action, outcome: "success", accountId: a.id, principalId: a.principal_id });
      return result;
    });
  }

  async reissueLoginEnrollment(actor: AdminActor, input: Record<string, unknown>) {
    return this.administer(actor, input, "reissueLoginEnrollment", async (c, a, reason) => {
      if (a.status !== "pending_enrollment") throw new LoginRefusal("CONFLICT", "the account has already enrolled; issue a reset instead");
      const t = await this.issueTicket(c, a.id, "enrollment", actor.uid, reason);
      return { before: null, after: { ticketId: t.ticketId, expiresAt: t.expiresAt },
        result: Object.freeze({ enrollmentTicket: t.ticket, enrollmentTicketExpiresAt: t.expiresAt }) };
    });
  }

  /** Admin-assisted recovery: a one-time reset ticket, handed over out of band. Using it ends every session. */
  async issueLoginReset(actor: AdminActor, input: Record<string, unknown>) {
    // The Employee-link check runs AFTER authorization (an unauthorized caller learns nothing about the link) and BEFORE
    // the locking transaction (it reads through the repository; second review finding 1).
    return this.administer(actor, input, "issueLoginReset", (principalId: string) => this.requireEmployeeLink(actor.tenantId, principalId), async (c, a, reason) => {
      if (a.status !== "active") throw new LoginRefusal("CONFLICT", a.status === "pending_enrollment" ? "the account has not enrolled; reissue the enrollment instead" : "the account is disabled; enable it first");
      // DECISIONS #56 D-ROUTINE-REVOKE: issuing a reset revokes NOTHING. Ending sessions on suspected compromise is the
      // separate revokeLoginSessions act, with its own confirmation and audit event. (When the HOLDER uses the code
      // and sets a new password, their sessions end -- as a password change always does.)
      const t = await this.issueTicket(c, a.id, "reset", actor.uid, reason);
      return { before: null, after: { ticketId: t.ticketId, expiresAt: t.expiresAt },
        result: Object.freeze({ resetTicket: t.ticket, resetTicketExpiresAt: t.expiresAt }) };
    });
  }

  async setLoginAccountStatus(actor: AdminActor, input: Record<string, unknown>) {
    const target = input.status;
    if (target !== "active" && target !== "disabled") throw new LoginRefusal("INVALID_INPUT", "status must be 'active' or 'disabled'");
    return this.administer<{ status: string; sessionsRevoked: number }>(actor, input, "setLoginAccountStatus", async (c, a) => {
      if (target === "disabled") {
        await this.requireNotLastAdministratorLogin(c, actor.tenantId, a);
        if (a.status === "disabled") return { before: { status: a.status }, after: { status: a.status }, result: Object.freeze({ status: a.status, sessionsRevoked: 0 }) };
        await c.query(`UPDATE ${SCHEMA}.login_accounts SET status = 'disabled', updated_at = $2 WHERE id = $1`, [a.id, this.now()]);
        await c.query(`UPDATE ${SCHEMA}.login_tickets SET revoked_at = $2 WHERE account_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`, [a.id, this.now()]);
        const revoked = await this.revokeSessions(c, a.id, "ACCOUNT_DISABLED");
        return { before: { status: a.status }, after: { status: "disabled", sessionsRevoked: revoked }, result: Object.freeze({ status: "disabled", sessionsRevoked: revoked }) };
      }
      if (a.status !== "disabled") throw new LoginRefusal("CONFLICT", "only a disabled account can be enabled");
      const next = a.password_hash ? "active" : "pending_enrollment";
      await c.query(`UPDATE ${SCHEMA}.login_accounts SET status = $2, failed_attempts = 0, locked_until = NULL, updated_at = $3 WHERE id = $1`, [a.id, next, this.now()]);
      return { before: { status: a.status }, after: { status: next }, result: Object.freeze({ status: next, sessionsRevoked: 0 }) };
    });
  }

  async unlockLoginAccount(actor: AdminActor, input: Record<string, unknown>) {
    return this.administer(actor, input, "unlockLoginAccount", async (c, a) => {
      await c.query(`UPDATE ${SCHEMA}.login_accounts SET failed_attempts = 0, locked_until = NULL, updated_at = $2 WHERE id = $1`, [a.id, this.now()]);
      return { before: { failedAttempts: a.failed_attempts, lockedUntil: a.locked_until?.toISOString() ?? null }, after: { failedAttempts: 0, lockedUntil: null },
        result: Object.freeze({ unlocked: true }) };
    });
  }

  async revokeLoginSessions(actor: AdminActor, input: Record<string, unknown>) {
    return this.administer(actor, input, "revokeLoginSessions", async (c, a) => {
      const revoked = await this.revokeSessions(c, a.id, "REVOKED_BY_ADMINISTRATOR");
      return { before: null, after: { sessionsRevoked: revoked }, result: Object.freeze({ sessionsRevoked: revoked }) };
    });
  }

  /** A lost authenticator: remove every factor and recovery code, end every session. The holder re-enrolls. */
  async resetLoginMfa(actor: AdminActor, input: Record<string, unknown>) {
    return this.administer(actor, input, "resetLoginMfa", async (c, a) => {
      const now = this.now();
      const { rowCount: factors } = await c.query(
        `UPDATE ${SCHEMA}.login_mfa_factors SET status = 'removed', removed_at = $2, removed_by = $3 WHERE account_id = $1 AND status <> 'removed'`, [a.id, now, actor.uid]);
      await c.query(`UPDATE ${SCHEMA}.login_recovery_codes SET superseded_at = $2 WHERE account_id = $1 AND used_at IS NULL AND superseded_at IS NULL`, [a.id, now]);
      const revoked = await this.revokeSessions(c, a.id, "MFA_RESET_BY_ADMINISTRATOR");
      return { before: null, after: { factorsRemoved: factors ?? 0, sessionsRevoked: revoked }, result: Object.freeze({ factorsRemoved: factors ?? 0, sessionsRevoked: revoked }) };
    });
  }

  async setLoginMfaRequirement(actor: AdminActor, input: Record<string, unknown>) {
    if (typeof input.required !== "boolean") throw new LoginRefusal("INVALID_INPUT", "required must be true or false");
    const required = input.required;
    return this.administer(actor, input, "setLoginMfaRequirement", async (c, a) => {
      await c.query(`UPDATE ${SCHEMA}.login_accounts SET mfa_required = $2, updated_at = $3 WHERE id = $1`, [a.id, required, this.now()]);
      return { before: { mfaRequired: a.mfa_required }, after: { mfaRequired: required }, result: Object.freeze({ mfaRequired: required }) };
    });
  }

  /** End a login for good: the account retires, its sessions and tickets end, and its EOS binding is revoked. */
  async retireLoginAccount(actor: AdminActor, input: Record<string, unknown>) {
    return this.administer(actor, input, "retireLoginAccount", async (c, a, reason) => {
      await this.requireNotLastAdministratorLogin(c, actor.tenantId, a);
      const now = this.now();
      const revoked = await this.revokeSessions(c, a.id, "ACCOUNT_RETIRED");
      await c.query(`UPDATE ${SCHEMA}.login_tickets SET revoked_at = $2 WHERE account_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`, [a.id, now]);
      await c.query(`UPDATE ${SCHEMA}.login_accounts SET status = 'retired', updated_at = $2 WHERE id = $1`, [a.id, now]);
      const policyTx = makeTransaction(c, { tenantId: actor.tenantId, uid: actor.uid });
      await policyTx.revokePrincipalIdentityBinding(a.principal_id, EOS_IDENTITY_PROVIDER, actor.uid, `login account retired: ${reason}`);
      await policyTx.bumpAccessVersion(a.principal_id);
      return { before: { status: a.status, subject: a.subject }, after: { status: "retired", bindingRevoked: true, sessionsRevoked: revoked },
        result: Object.freeze({ status: "retired", sessionsRevoked: revoked }) };
    });
  }
}

// ════════════════════ security-event retention (Owner ruling D-13) ════════════════════
//
// Governed configuration and a READ-ONLY archive plan. Nothing here deletes, alters, moves or exports an event, and no
// job is scheduled. Archival itself is an operator procedure under separate authorization
// (docs/architecture/eos-native-identity.md §8), recorded in the append-only authentication_event_archive_manifests.

export const RETENTION_FLOOR_DAYS = 365;
export const RETENTION_CEILING_DAYS = 3650;

export class EosSecurityEventGovernance {
  constructor(private readonly pool: Pool, private readonly repo: PostgresPolicyRepository, private readonly now: () => Date = () => new Date()) {}

  private async requireRead(actor: AdminActor): Promise<void> {
    const held = await actorCapabilities(this.repo, actor);
    if (!held.has("admin.principalAccess.read")) throw new LoginRefusal("FORBIDDEN", 'not authorized: "admin.principalAccess.read" is required');
  }

  /** THIS tenant's security events, newest first. Never another tenant's; never the account-less (operator) rows. */
  async readAuthenticationEvents(actor: AdminActor, input: Record<string, unknown>) {
    await this.requireRead(actor);
    const limit = Number.isInteger(input.limit) ? Math.min(Math.max(input.limit as number, 1), 200) : 50;
    const principalId = typeof input.principalId === "string" && input.principalId.trim() ? input.principalId.trim() : null;
    const before = typeof input.before === "string" && !Number.isNaN(Date.parse(input.before)) ? new Date(input.before) : null;
    const { rows } = await this.pool.query(
      `SELECT id, occurred_at, event, outcome, reason_code, principal_id, session_id, client_label
         FROM ${SCHEMA}.authentication_events
        WHERE tenant_id = $1 AND ($2::text IS NULL OR principal_id = $2) AND ($3::timestamptz IS NULL OR occurred_at < $3)
        ORDER BY occurred_at DESC, id DESC LIMIT $4`, [actor.tenantId, principalId, before, limit]);
    return Object.freeze({
      events: rows.map((e) => ({ id: e.id, occurredAt: e.occurred_at.toISOString(), event: e.event, outcome: e.outcome,
        reason: e.reason_code, principalId: e.principal_id, sessionId: e.session_id, client: e.client_label })),
    });
  }

  /** The policy in force for this tenant (the newest row), or null: with no policy, NOTHING is ever eligible. */
  private async currentPolicy(tenantId: string | null) {
    const { rows } = await this.pool.query(
      `SELECT * FROM ${SCHEMA}.authentication_event_retention_policies
        WHERE tenant_id IS NOT DISTINCT FROM $1 AND effective_from <= $2 ORDER BY effective_from DESC, id DESC LIMIT 1`, [tenantId, this.now()]);
    return rows[0] ?? null;
  }

  /** A new policy row (history, never an update) + one audit event. admin.securityPolicy.write; bounded 365..3650 days. */
  async setAuthenticationEventRetention(actor: AdminActor, input: Record<string, unknown>) {
    await requireSecurityAdministrationCapability(this.repo, actor, "editSecurityPolicy");
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (!reason) throw new LoginRefusal("REASON_REQUIRED", "a stated reason is required");
    const active = input.activeRetentionDays;
    const archive = input.archiveRetentionDays;
    for (const v of [active, archive]) {
      if (!Number.isInteger(v) || (v as number) < RETENTION_FLOOR_DAYS || (v as number) > RETENTION_CEILING_DAYS) {
        throw new LoginRefusal("INVALID_INPUT", `retention must be a whole number of days between ${RETENTION_FLOOR_DAYS} and ${RETENTION_CEILING_DAYS}`);
      }
    }
    const before = await this.currentPolicy(actor.tenantId);
    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO ${SCHEMA}.authentication_event_retention_policies (id, tenant_id, active_retention_days, archive_retention_days, effective_from, set_by, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, actor.tenantId, active, archive, this.now(), actor.uid, reason]);
      await makeTransaction(client, { tenantId: actor.tenantId, uid: actor.uid }).appendAudit({
        action: "setAuthenticationEventRetention", actorUid: actor.uid, targetKind: "securityEventRetention", targetId: id,
        before: before ? { activeRetentionDays: before.active_retention_days, archiveRetentionDays: before.archive_retention_days } : null,
        after: { activeRetentionDays: active, archiveRetentionDays: archive }, occurredAt: this.now().toISOString(), reason,
      } as never);
      await client.query("COMMIT");
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* the original error is rethrown */ }
      throw err;
    } finally {
      client.release();
    }
    return Object.freeze({ policyId: id, activeRetentionDays: active, archiveRetentionDays: archive });
  }

  /**
   * READ-ONLY. What an archival of THIS tenant's events would cover today: the eligible window (older than the active
   * retention), its row count, and the SHA-256 of the canonical export (NDJSON, ordered by occurred_at, id) -- the digest
   * an operator's export must reproduce and a restore must match. Writes NOTHING.
   */
  async planAuthenticationEventArchive(actor: AdminActor) {
    await this.requireRead(actor);
    const policy = await this.currentPolicy(actor.tenantId);
    if (!policy) return Object.freeze({ policy: null, eligible: null, note: "no retention policy: nothing is eligible for archival" });
    const cutoff = new Date(this.now().getTime() - policy.active_retention_days * 86_400_000);
    const { rows: last } = await this.pool.query(
      `SELECT max(window_end) AS w FROM ${SCHEMA}.authentication_event_archive_manifests WHERE tenant_id = $1`, [actor.tenantId]);
    const windowStart: Date = last[0]?.w ?? new Date(0);
    const { rows } = await this.pool.query(
      `SELECT id, occurred_at, tenant_id, event, outcome, reason_code, account_id, principal_id, session_id, client_digest, client_label
         FROM ${SCHEMA}.authentication_events
        WHERE tenant_id = $1 AND occurred_at >= $2 AND occurred_at < $3 ORDER BY occurred_at, id`, [actor.tenantId, windowStart, cutoff]);
    const hash = createHash("sha256");
    for (const r of rows) hash.update(`${canonicalEventLine(r)}\n`, "utf8");
    return Object.freeze({
      policy: { activeRetentionDays: policy.active_retention_days, archiveRetentionDays: policy.archive_retention_days },
      eligible: { windowStart: windowStart.toISOString(), windowEnd: cutoff.toISOString(), rowCount: rows.length, exportSha256: hash.digest("hex") },
    });
  }
}

/** One event as a canonical NDJSON line: fixed key order, ISO times. The archive format and its digest input. */
export function canonicalEventLine(r: Record<string, unknown>): string {
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null);
  return JSON.stringify({
    id: r.id, occurredAt: iso(r.occurred_at), tenantId: r.tenant_id ?? null, event: r.event, outcome: r.outcome,
    reason: r.reason_code ?? null, accountId: r.account_id ?? null, principalId: r.principal_id ?? null,
    sessionId: r.session_id ?? null, clientDigest: r.client_digest ?? null, clientLabel: r.client_label ?? null,
  });
}

// ════════════════════ the Administration operation table ════════════════════

/** Closed table of login-administration operations, served on /admin/policy (Administration is the control plane). */
/**
 * Each operation's EXISTING governed capability (docs/architecture/eos-native-identity.md, 3(d); D-8 records the mapping
 * for Owner confirmation). No key is registered and no grant is written by this feature.
 */
export const LOGIN_ADMINISTRATION_OPERATIONS = Object.freeze({
  readLoginAccount: { mutation: false, capability: "admin.principalAccess.read" },
  provisionLoginAccount: { mutation: true, capability: "admin.roleAssignment.write" },
  reissueLoginEnrollment: { mutation: true, capability: "admin.roleAssignment.write" },
  retireLoginAccount: { mutation: true, capability: "admin.roleAssignment.write" },
  issueLoginReset: { mutation: true, capability: "admin.credentialReset.initiate" },
  unlockLoginAccount: { mutation: true, capability: "admin.credentialReset.initiate" },
  resetLoginMfa: { mutation: true, capability: "admin.credentialReset.initiate" },
  setLoginAccountStatus: { mutation: true, capability: "admin.userStatus.write" },
  revokeLoginSessions: { mutation: true, capability: "admin.userStatus.write" },
  setLoginMfaRequirement: { mutation: true, capability: "admin.userStatus.write" },
  // D-13: security-event governance (reads restricted to admin + owner; policy changes to admin.securityPolicy.write).
  readAuthenticationEvents: { mutation: false, capability: "admin.principalAccess.read" },
  planAuthenticationEventArchive: { mutation: false, capability: "admin.principalAccess.read" },
  setAuthenticationEventRetention: { mutation: true, capability: "admin.securityPolicy.write" },
} as const);
export type LoginAdministrationCapability = "admin.roleAssignment.write" | "admin.credentialReset.initiate" | "admin.userStatus.write";
export type LoginAdministrationOperation = keyof typeof LOGIN_ADMINISTRATION_OPERATIONS;
export const isLoginAdministrationOperation = (name: unknown): name is LoginAdministrationOperation =>
  typeof name === "string" && Object.prototype.hasOwnProperty.call(LOGIN_ADMINISTRATION_OPERATIONS, name);

export type LoginAdministrationHandler = (operation: LoginAdministrationOperation, actor: AdminActor, input: Record<string, unknown>) => Promise<unknown>;

export function createLoginAdministration(service: EosLoginService, governance: EosSecurityEventGovernance): LoginAdministrationHandler {
  return (operation, actor, input) => {
    switch (operation) {
      case "readLoginAccount": return service.readLoginAccount(actor, input);
      case "provisionLoginAccount": return service.provisionLoginAccount(actor, input);
      case "reissueLoginEnrollment": return service.reissueLoginEnrollment(actor, input);
      case "issueLoginReset": return service.issueLoginReset(actor, input);
      case "setLoginAccountStatus": return service.setLoginAccountStatus(actor, input);
      case "unlockLoginAccount": return service.unlockLoginAccount(actor, input);
      case "revokeLoginSessions": return service.revokeLoginSessions(actor, input);
      case "resetLoginMfa": return service.resetLoginMfa(actor, input);
      case "setLoginMfaRequirement": return service.setLoginMfaRequirement(actor, input);
      case "retireLoginAccount": return service.retireLoginAccount(actor, input);
      case "readAuthenticationEvents": return governance.readAuthenticationEvents(actor, input);
      case "planAuthenticationEventArchive": return governance.planAuthenticationEventArchive(actor);
      case "setAuthenticationEventRetention": return governance.setAuthenticationEventRetention(actor, input);
      default: throw new LoginRefusal("INVALID_INPUT", "unknown login administration operation");
    }
  };
}
