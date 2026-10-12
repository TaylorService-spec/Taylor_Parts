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
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { makeTransaction, type PostgresPolicyRepository } from "../adminPolicy/postgresPolicyRepository";
import { EOS_IDENTITY_PROVIDER, PrincipalContextError, resolvePrincipalContext } from "../adminPolicy/principalContext";
import { actorCapabilities, requireSecurityAdministrationCapability } from "../adminPolicy/administrationCapabilityGate";
import { PROTECTED_OWNER_ROLE_KEY } from "../adminPolicy/administrationAuthority";
import type { AdminActor } from "../adminPolicy/policyCommands";
import { newTokenId, signEosAccessToken, EOS_TOKEN_MAX_LIFETIME_SECONDS, type EosSigner } from "./eosAccessToken";
import {
  burnPasswordWork, decryptFactorSecret, encryptFactorSecret, hashPassword, isOpaqueTokenOf, matchTotpStep,
  newOpaqueToken, newRecoveryCodes, newTotpSecret, normalizeRecoveryCode, opaqueTokenDigest, passwordPolicyRefusal,
  recoveryCodeDigest, totpProvisioningUri, base32Encode, verifyPassword, type FactorKeyring, type ScryptParameters,
  PASSWORD_HASH_PARAMETERS, PASSWORD_MAX_LENGTH,
} from "./credentialCrypto";

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
  SESSION_INVALID: 401, MFA_ENROLLMENT_REQUIRED: 403, MFA_NOT_CONFIGURED: 503, MFA_ALREADY_ENROLLED: 409,
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
}

export interface IssuedLoginSession {
  readonly tokenType: "Bearer";
  readonly accessToken: string;
  readonly accessTokenExpiresAt: string;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: string;
  readonly sessionId: string;
  /** True when the account's policy requires a second factor it does not yet have: only /auth/* self routes work. */
  readonly mfaEnrollmentRequired: boolean;
}

export type LoginResult =
  | { readonly status: "AUTHENTICATED"; readonly session: IssuedLoginSession }
  | { readonly status: "MFA_REQUIRED"; readonly challenge: string; readonly challengeExpiresAt: string; readonly methods: readonly string[] };

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
    this.clientDigestKey = deps.factorKeyring
      ? createHmac("sha256", deps.factorKeyring.keys.get(deps.factorKeyring.currentKid) as Buffer).update("eos-client-digest").digest()
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
      principalId?: string | null; sessionId?: string | null; client?: ClientFacts | null },
  ): Promise<void> {
    await q.query(
      `INSERT INTO ${SCHEMA}.authentication_events
         (id, occurred_at, event, outcome, reason_code, account_id, principal_id, session_id, client_digest, client_label)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [randomUUID(), this.now(), input.event, input.outcome, input.reason ?? null, input.accountId ?? null,
        input.principalId ?? null, input.sessionId ?? null, this.clientDigest(input.client ?? null),
        EosLoginService.label(input.client ?? null)],
    );
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
  private async requireEligible(account: AccountRow): Promise<void> {
    await resolvePrincipalContext(this.deps.repo, {
      identityProvider: EOS_IDENTITY_PROVIDER, externalSubject: account.subject, requestedTenantId: account.tenant_id,
    });
  }

  private lockUntilFor(failedAttempts: number): Date | null {
    const p = this.policy;
    if (failedAttempts < p.lockThreshold) return null;
    const seconds = Math.min(p.lockBaseSeconds * 2 ** Math.min(failedAttempts - p.lockThreshold, 20), p.lockMaxSeconds);
    return new Date(this.now().getTime() + seconds * 1000);
  }

  private async recordFailure(client: PoolClient, account: AccountRow): Promise<void> {
    const failed = account.failed_attempts + 1;
    await client.query(
      `UPDATE ${SCHEMA}.login_accounts SET failed_attempts = $2, locked_until = COALESCE($3, locked_until), updated_at = $4 WHERE id = $1`,
      [account.id, failed, this.lockUntilFor(failed), this.now()],
    );
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

  private async openSession(client: PoolClient, account: AccountRow, mfaVerified: boolean, facts: ClientFacts | null): Promise<IssuedLoginSession> {
    const now = this.now();
    const sessionId = randomBytes(24).toString("base64url");
    const absolute = new Date(now.getTime() + this.policy.absoluteSeconds * 1000);
    const idle = new Date(Math.min(now.getTime() + this.policy.idleSeconds * 1000, absolute.getTime()));
    await client.query(
      `INSERT INTO ${SCHEMA}.login_sessions (id, account_id, principal_id, credential_version, mfa_verified, created_at,
         last_refreshed_at, idle_expires_at, absolute_expires_at, client_label, client_digest)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10)`,
      [sessionId, account.id, account.principal_id, account.credential_version, mfaVerified, now, idle, absolute,
        EosLoginService.label(facts), this.clientDigest(facts)],
    );
    const refreshToken = newOpaqueToken("refresh");
    await client.query(
      `INSERT INTO ${SCHEMA}.login_refresh_tokens (token_sha256, session_id, issued_at) VALUES ($1,$2,$3)`,
      [opaqueTokenDigest(refreshToken), sessionId, now],
    );
    const access = this.mint(account.subject, sessionId);
    return Object.freeze({
      tokenType: "Bearer", accessToken: access.token, accessTokenExpiresAt: access.expiresAt, refreshToken,
      refreshTokenExpiresAt: idle.toISOString(), sessionId,
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

  async login(input: { identifier: unknown; password: unknown }, facts: ClientFacts | null): Promise<LoginResult> {
    const identifier = normalizeLoginIdentifier(input.identifier);
    const password = typeof input.password === "string" && input.password.length <= PASSWORD_MAX_LENGTH * 4 ? input.password : null;
    if (!identifier || password === null) {
      await burnPasswordWork("");
      await this.event(this.deps.pool, { event: "login", outcome: "refused", reason: "MALFORMED", client: facts });
      throw new LoginRefusal("LOGIN_REFUSED");
    }
    const account = await this.accountByIdentifier(this.deps.pool, identifier);
    const refuse = async (reason: string, a: AccountRow | null) => {
      await this.event(this.deps.pool, { event: "login", outcome: "refused", reason, accountId: a?.id, principalId: a?.principal_id, client: facts });
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
    const check = await verifyPassword(password, account.password_hash);
    if (!check.matches) {
      await this.tx(async (c) => {
        const locked = await this.accountById(c, account.id, true);
        if (locked) await this.recordFailure(c, locked);
      });
      return refuse("BAD_PASSWORD", account);
    }
    try {
      await this.requireEligible(account);
    } catch (err) {
      if (err instanceof PrincipalContextError) return refuse(`PRINCIPAL_${err.refusal}`, account);
      throw err;
    }
    const rehash = check.needsRehash ? await hashPassword(password, this.hashParameters) : null;

    return this.tx(async (c) => {
      const a = await this.accountById(c, account.id, true);
      // Re-read under the lock: a concurrent admin disable between the read and here wins.
      if (!a || a.status !== "active" || a.credential_version !== account.credential_version) {
        await this.event(c, { event: "login", outcome: "refused", reason: "ACCOUNT_CHANGED", accountId: account.id, client: facts });
        throw new LoginRefusal("LOGIN_REFUSED");
      }
      if (rehash) {
        await c.query(`UPDATE ${SCHEMA}.login_accounts SET password_hash = $2, updated_at = $3 WHERE id = $1`, [a.id, rehash, this.now()]);
      }
      if (await this.hasActiveFactor(c, a.id)) {
        const challenge = newOpaqueToken("mfaChallenge");
        const now = this.now();
        const expires = new Date(now.getTime() + this.policy.mfaChallengeSeconds * 1000);
        await c.query(
          `INSERT INTO ${SCHEMA}.login_mfa_challenges (id, account_id, token_sha256, created_at, expires_at) VALUES ($1,$2,$3,$4,$5)`,
          [randomUUID(), a.id, opaqueTokenDigest(challenge), now, expires],
        );
        await this.event(c, { event: "loginPassword", outcome: "success", reason: "MFA_REQUIRED", accountId: a.id, principalId: a.principal_id, client: facts });
        return { status: "MFA_REQUIRED" as const, challenge, challengeExpiresAt: expires.toISOString(), methods: Object.freeze(["totp", "recoveryCode"]) };
      }
      await c.query(`UPDATE ${SCHEMA}.login_accounts SET failed_attempts = 0, locked_until = NULL, last_login_at = $2, updated_at = $2 WHERE id = $1`, [a.id, this.now()]);
      const session = await this.openSession(c, a, false, facts);
      await this.event(c, { event: "login", outcome: "success", accountId: a.id, principalId: a.principal_id, sessionId: session.sessionId, client: facts });
      return { status: "AUTHENTICATED" as const, session };
    });
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
      if (!a || a.status !== "active" || a.binding_status !== "active" || this.isLocked(a)) {
        await c.query(`UPDATE ${SCHEMA}.login_mfa_challenges SET consumed_at = $2 WHERE id = $1`, [ch.id, this.now()]);
        await this.event(c, { event: "loginMfa", outcome: "refused", reason: "ACCOUNT_NOT_USABLE", accountId: ch.account_id, client: facts });
        return { refusal: "MFA_CHALLENGE_INVALID" as const };
      }
      const method = await this.verifySecondFactor(c, keyring, a, input);
      if (!method) {
        await c.query(`UPDATE ${SCHEMA}.login_mfa_challenges SET attempts = attempts + 1 WHERE id = $1`, [ch.id]);
        await this.recordFailure(c, a);
        await this.event(c, { event: "loginMfa", outcome: "refused", reason: "CODE_REFUSED", accountId: a.id, principalId: a.principal_id, client: facts });
        return { refusal: "MFA_CODE_REFUSED" as const };
      }
      await c.query(`UPDATE ${SCHEMA}.login_mfa_challenges SET consumed_at = $2 WHERE id = $1`, [ch.id, this.now()]);
      return { account: a, method };
    });
    if ("refusal" in outcome) throw new LoginRefusal(outcome.refusal as LoginRefusalCode);
    // Eligibility is re-checked at the moment of issue, not trusted from the password step.
    try {
      await this.requireEligible(outcome.account);
    } catch (err) {
      if (err instanceof PrincipalContextError) {
        await this.event(this.deps.pool, { event: "loginMfa", outcome: "refused", reason: `PRINCIPAL_${err.refusal}`, accountId: outcome.account.id, client: facts });
        throw new LoginRefusal("LOGIN_REFUSED");
      }
      throw err;
    }
    return this.tx(async (c) => {
      const a = await this.accountById(c, outcome.account.id, true);
      if (!a || a.status !== "active" || a.credential_version !== outcome.account.credential_version) throw new LoginRefusal("LOGIN_REFUSED");
      await c.query(`UPDATE ${SCHEMA}.login_accounts SET failed_attempts = 0, locked_until = NULL, last_login_at = $2, updated_at = $2 WHERE id = $1`, [a.id, this.now()]);
      const session = await this.openSession(c, a, true, facts);
      await this.event(c, { event: "login", outcome: "success", reason: outcome.method === "recoveryCode" ? "RECOVERY_CODE" : "TOTP",
        accountId: a.id, principalId: a.principal_id, sessionId: session.sessionId, client: facts });
      return { status: "AUTHENTICATED" as const, session };
    });
  }

  /** TOTP (replay-proof: the step must exceed the last accepted one) or a single-use recovery code. */
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
      await c.query(`UPDATE ${SCHEMA}.login_mfa_factors SET last_used_step = $2 WHERE id = $1`, [f.id, step]);
      return "totp";
    }
    const normalized = normalizeRecoveryCode(input.recoveryCode);
    if (!normalized) return null;
    const { rowCount } = await c.query(
      `UPDATE ${SCHEMA}.login_recovery_codes SET used_at = $3
        WHERE account_id = $1 AND code_digest = $2 AND used_at IS NULL AND superseded_at IS NULL`,
      [a.id, recoveryCodeDigest(keyring, a.id, normalized), this.now()],
    );
    return rowCount === 1 ? "recoveryCode" : null;
  }

  /** Exchange a refresh token for a new pair. A token presented twice revokes its whole session (theft signal). */
  async refresh(input: { refreshToken: unknown }, facts: ClientFacts | null): Promise<IssuedLoginSession> {
    if (!isOpaqueTokenOf("refresh", input.refreshToken)) throw new LoginRefusal("REFRESH_REFUSED");
    const digest = opaqueTokenDigest(input.refreshToken);
    const result = await this.tx(async (c) => {
      const { rows } = await c.query(
        `SELECT t.*, s.account_id, s.revoked_at, s.idle_expires_at, s.absolute_expires_at, s.credential_version AS session_cv, s.mfa_verified
           FROM ${SCHEMA}.login_refresh_tokens t JOIN ${SCHEMA}.login_sessions s ON s.id = t.session_id
          WHERE t.token_sha256 = $1 FOR UPDATE OF t, s`, [digest]);
      const t = rows[0];
      const now = this.now();
      if (!t) {
        await this.event(c, { event: "refresh", outcome: "refused", reason: "UNKNOWN_TOKEN", client: facts });
        return null;
      }
      if (t.revoked_at) {
        await this.event(c, { event: "refresh", outcome: "refused", reason: "SESSION_REVOKED", accountId: t.account_id, sessionId: t.session_id, client: facts });
        return null;
      }
      if (t.consumed_at) {
        await c.query(`UPDATE ${SCHEMA}.login_sessions SET revoked_at = $2, revoke_reason = 'REFRESH_TOKEN_REUSE' WHERE id = $1`, [t.session_id, now]);
        await this.event(c, { event: "refresh", outcome: "refused", reason: "REFRESH_TOKEN_REUSE", accountId: t.account_id, sessionId: t.session_id, client: facts });
        return null;
      }
      if (t.idle_expires_at.getTime() <= now.getTime() || t.absolute_expires_at.getTime() <= now.getTime()) {
        await this.event(c, { event: "refresh", outcome: "refused", reason: "SESSION_EXPIRED", accountId: t.account_id, sessionId: t.session_id, client: facts });
        return null;
      }
      const a = await this.accountById(c, t.account_id);
      if (!a || a.status !== "active" || a.binding_status !== "active" || a.credential_version !== t.session_cv) {
        await c.query(`UPDATE ${SCHEMA}.login_sessions SET revoked_at = $2, revoke_reason = 'ACCOUNT_CHANGED' WHERE id = $1`, [t.session_id, now]);
        await this.event(c, { event: "refresh", outcome: "refused", reason: "ACCOUNT_CHANGED", accountId: t.account_id, sessionId: t.session_id, client: facts });
        return null;
      }
      return { t, a };
    });
    if (!result) throw new LoginRefusal("REFRESH_REFUSED");
    try {
      await this.requireEligible(result.a);
    } catch (err) {
      if (!(err instanceof PrincipalContextError)) throw err;
      await this.tx(async (c) => {
        await c.query(`UPDATE ${SCHEMA}.login_sessions SET revoked_at = $2, revoke_reason = $3 WHERE id = $1 AND revoked_at IS NULL`,
          [result.t.session_id, this.now(), `PRINCIPAL_${err.refusal}`]);
        await this.event(c, { event: "refresh", outcome: "refused", reason: `PRINCIPAL_${err.refusal}`, accountId: result.a.id, sessionId: result.t.session_id, client: facts });
      });
      throw new LoginRefusal("REFRESH_REFUSED");
    }
    return this.tx(async (c) => {
      const now = this.now();
      // Consume under the row lock: of two concurrent exchanges of one token exactly one succeeds.
      const { rowCount } = await c.query(
        `UPDATE ${SCHEMA}.login_refresh_tokens SET consumed_at = $2 WHERE token_sha256 = $1 AND consumed_at IS NULL`, [digest, now]);
      if (rowCount !== 1) throw new LoginRefusal("REFRESH_REFUSED");
      const { rows } = await c.query(`SELECT * FROM ${SCHEMA}.login_sessions WHERE id = $1 FOR UPDATE`, [result.t.session_id]);
      const s = rows[0];
      if (!s || s.revoked_at) throw new LoginRefusal("REFRESH_REFUSED");
      const idle = new Date(Math.min(now.getTime() + this.policy.idleSeconds * 1000, s.absolute_expires_at.getTime()));
      await c.query(`UPDATE ${SCHEMA}.login_sessions SET last_refreshed_at = $2, idle_expires_at = $3 WHERE id = $1`, [s.id, now, idle]);
      const refreshToken = newOpaqueToken("refresh");
      await c.query(`INSERT INTO ${SCHEMA}.login_refresh_tokens (token_sha256, session_id, issued_at) VALUES ($1,$2,$3)`,
        [opaqueTokenDigest(refreshToken), s.id, now]);
      const access = this.mint(result.a.subject, s.id);
      await this.event(c, { event: "refresh", outcome: "success", accountId: result.a.id, principalId: result.a.principal_id, sessionId: s.id, client: facts });
      return Object.freeze({
        tokenType: "Bearer" as const, accessToken: access.token, accessTokenExpiresAt: access.expiresAt, refreshToken,
        refreshTokenExpiresAt: idle.toISOString(), sessionId: s.id,
        mfaEnrollmentRequired: result.a.mfa_required && !s.mfa_verified && !(await this.hasActiveFactor(c, result.a.id)),
      });
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
      await this.event(c, { event: "logout", outcome: "success", accountId: rows[0].account_id, sessionId: rows[0].id, client: facts });
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
      `SELECT a.login_identifier FROM ${SCHEMA}.login_tickets t JOIN ${SCHEMA}.login_accounts a ON a.id = t.account_id
        WHERE t.token_sha256 = $1 AND t.purpose = $2`, [digest, purpose]);
    if (!peek[0]) {
      await this.event(this.deps.pool, { event: purpose === "enrollment" ? "enrollmentComplete" : "resetComplete", outcome: "refused", reason: "UNKNOWN_TICKET", client: facts });
      throw new LoginRefusal("TICKET_INVALID");
    }
    const policy = passwordPolicyRefusal(input.password, peek[0].login_identifier);
    if (policy) throw new LoginRefusal("PASSWORD_POLICY", policy);
    const hash = await hashPassword(input.password as string, this.hashParameters);
    const eventName = purpose === "enrollment" ? "enrollmentComplete" : "resetComplete";

    const outcome = await this.tx(async (c) => {
      const { rows } = await c.query(`SELECT * FROM ${SCHEMA}.login_tickets WHERE token_sha256 = $1 AND purpose = $2 FOR UPDATE`, [digest, purpose]);
      const t = rows[0];
      const now = this.now();
      if (!t || t.consumed_at || t.revoked_at || t.expires_at.getTime() <= now.getTime()) {
        await this.event(c, { event: eventName, outcome: "refused", reason: "TICKET_NOT_OPEN", accountId: t?.account_id, client: facts });
        return null;
      }
      const a = await this.accountById(c, t.account_id, true);
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
  async checkSession(subject: string, sessionId: string | null, mode: "api" | "self"): Promise<AccountRow & { session_id: string; mfa_verified: boolean }> {
    if (!sessionId) throw new LoginRefusal("SESSION_INVALID");
    const { rows } = await this.deps.pool.query(
      `SELECT a.*, pi.external_subject AS subject, pi.status AS binding_status, s.id AS session_id, s.mfa_verified,
              s.revoked_at AS session_revoked_at, s.idle_expires_at, s.absolute_expires_at, s.credential_version AS session_cv,
              EXISTS (SELECT 1 FROM ${SCHEMA}.login_mfa_factors f WHERE f.account_id = a.id AND f.status = 'active') AS has_factor
         FROM ${SCHEMA}.login_sessions s
         JOIN ${SCHEMA}.login_accounts a ON a.id = s.account_id
         JOIN ${SCHEMA}.principal_identities pi ON pi.id = a.binding_id
        WHERE s.id = $1`, [sessionId]);
    const r = rows[0];
    const now = this.now().getTime();
    if (!r || r.subject !== subject || r.session_revoked_at || r.status !== "active" || r.binding_status !== "active"
      || r.idle_expires_at.getTime() <= now || r.absolute_expires_at.getTime() <= now || r.credential_version !== r.session_cv) {
      throw new LoginRefusal("SESSION_INVALID");
    }
    // A session that owes a second factor reaches /auth/* (to enroll one) and nothing else.
    if (mode === "api" && r.mfa_required && !r.mfa_verified) {
      throw new LoginRefusal("MFA_ENROLLMENT_REQUIRED");
    }
    return r;
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
    return Object.freeze({
      loginIdentifier: a.login_identifier,
      principalId: a.principal_id,
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
    const check = await verifyPassword(input.currentPassword, a.password_hash);
    if (!check.matches) {
      await this.tx(async (c) => {
        const locked = await this.accountById(c, a.id, true);
        if (locked) await this.recordFailure(c, locked);
        await this.event(c, { event: "passwordChange", outcome: "refused", reason: "CURRENT_PASSWORD", accountId: a.id, sessionId, client: facts });
      });
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
      return this.openSession(c, fresh as AccountRow, a.mfa_verified, facts);
    });
  }

  async beginTotpEnrollment(subject: string, sessionId: string | null) {
    const a = await this.checkSession(subject, sessionId, "self");
    const keyring = this.deps.factorKeyring;
    if (!keyring) throw new LoginRefusal("MFA_NOT_CONFIGURED");
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
      await c.query(`INSERT INTO ${SCHEMA}.login_recovery_codes (id, account_id, code_digest, created_at) VALUES ($1,$2,$3,$4)`,
        [randomUUID(), accountId, recoveryCodeDigest(keyring, accountId, normalizeRecoveryCode(code) as string), now]);
    }
    return codes;
  }

  /** Step-up for a sensitive self-service act: the password AND a current second factor. */
  private async requirePasswordAndFactor(c: PoolClient, keyring: FactorKeyring, a: AccountRow, input: { password: unknown; code?: unknown; recoveryCode?: unknown }) {
    if (typeof input.password !== "string" || !(await verifyPassword(input.password, a.password_hash)).matches) {
      const locked = await this.accountById(c, a.id, true);
      if (locked) await this.recordFailure(c, locked);
      return "CURRENT_PASSWORD_REFUSED" as const;
    }
    if (!(await this.verifySecondFactor(c, keyring, a, input))) return "MFA_CODE_REFUSED" as const;
    return null;
  }

  async removeTotp(subject: string, sessionId: string | null, input: { password: unknown; code?: unknown; recoveryCode?: unknown }, facts: ClientFacts | null) {
    const a = await this.checkSession(subject, sessionId, "self");
    const keyring = this.deps.factorKeyring;
    if (!keyring) throw new LoginRefusal("MFA_NOT_CONFIGURED");
    if (a.mfa_required) throw new LoginRefusal("MFA_REQUIRED_BY_POLICY");
    const refusal = await this.tx(async (c) => {
      if (!(await this.hasActiveFactor(c, a.id))) return "MFA_NOT_ENROLLED" as const;
      const r = await this.requirePasswordAndFactor(c, keyring, a, input);
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
    const out = await this.tx(async (c) => {
      if (!(await this.hasActiveFactor(c, a.id))) return { refusal: "MFA_NOT_ENROLLED" as const };
      // A TOTP code specifically: a recovery code may not mint more recovery codes.
      const r = await this.requirePasswordAndFactor(c, keyring, a, { password: input.password, code: input.code ?? "" });
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
      await this.event(c, { event: "sessionRevoke", outcome: "success", accountId: a.id, principalId: a.principal_id, sessionId: input.sessionId as string, client: facts });
      return Object.freeze({ revoked: 1 });
    });
  }

  async revokeOtherSessions(subject: string, sessionId: string | null, facts: ClientFacts | null) {
    const a = await this.checkSession(subject, sessionId, "self");
    return this.tx(async (c) => {
      const revoked = await this.revokeSessions(c, a.id, "REVOKED_BY_HOLDER", a.session_id);
      await this.event(c, { event: "sessionRevokeOthers", outcome: "success", accountId: a.id, principalId: a.principal_id, sessionId, client: facts });
      return Object.freeze({ revoked });
    });
  }

  // ════════════════════ security administration (Administration > Users) ════════════════════

  /** Does `principalId` hold the protected Owner Role in this tenant? */
  private async holdsProtectedOwner(q: Pick<PoolClient, "query"> | Pool, tenantId: string, principalId: string): Promise<boolean> {
    const { rows } = await q.query(
      `SELECT 1 FROM ${SCHEMA}.user_role_assignments a JOIN ${SCHEMA}.roles r ON r.id = a.role_id
        WHERE a.tenant_id = $1 AND a.principal_id = $2 AND a.status = 'active' AND r.key = $3 AND r.protected`,
      [tenantId, principalId, PROTECTED_OWNER_ROLE_KEY]);
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
    if (await this.holdsProtectedOwner(this.deps.pool, actor.tenantId, id) && !actor.heldRoleKeys.includes(PROTECTED_OWNER_ROLE_KEY)) {
      throw new LoginRefusal("PROTECTED_TARGET", "only an Owner may administer an Owner's login");
    }
    return { principalId: id, reason: r };
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
    const administering = `SELECT 1 FROM ${SCHEMA}.user_role_assignments ra JOIN ${SCHEMA}.roles r ON r.id = ra.role_id
      WHERE ra.tenant_id = $1 AND ra.principal_id = %P AND ra.status = 'active' AND ra.scope_type = 'global' AND r.key IN ('owner', 'admin') AND r.protected`;
    const { rows: target } = await c.query(administering.replace("%P", "$2"), [tenantId, a.principal_id]);
    if (target.length === 0) return;
    const { rows: others } = await c.query(
      `SELECT 1 FROM ${SCHEMA}.login_accounts la WHERE la.tenant_id = $1 AND la.status = 'active' AND la.id <> $2
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
    const a = await this.liveAccountForPrincipal(this.deps.pool, principalId);
    const binding = await this.deps.repo.getActiveIdentityBinding(principalId, EOS_IDENTITY_PROVIDER);
    if (!a) {
      return Object.freeze({
        account: null,
        // Why provisioning would refuse, said up front: a persona or other EOS identity already holds the one slot.
        eosIdentity: binding ? { subject: binding.externalSubject, kind: binding.externalSubject.startsWith("nonprod-persona.") ? "persona" : "other" } : null,
        recentEvents: [],
      });
    }
    const [{ rows: f }, { rows: s }, { rows: rc }, { rows: ev }] = await Promise.all([
      this.deps.pool.query(`SELECT 1 FROM ${SCHEMA}.login_mfa_factors WHERE account_id = $1 AND status = 'active'`, [a.id]),
      this.deps.pool.query(`SELECT count(*)::int n FROM ${SCHEMA}.login_sessions WHERE account_id = $1 AND revoked_at IS NULL AND idle_expires_at > $2 AND absolute_expires_at > $2`, [a.id, this.now()]),
      this.deps.pool.query(`SELECT count(*)::int n FROM ${SCHEMA}.login_recovery_codes WHERE account_id = $1 AND used_at IS NULL AND superseded_at IS NULL`, [a.id]),
      this.deps.pool.query(`SELECT occurred_at, event, outcome, reason_code, client_label FROM ${SCHEMA}.authentication_events
                             WHERE account_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT 25`, [a.id]),
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
    fn: (c: PoolClient, a: AccountRow, reason: string) => Promise<{ before: unknown; after: unknown; result: T }>): Promise<T> {
    const { principalId, reason } = await this.requireCredentialAdministration(actor, input.principalId, input.reason,
      LOGIN_ADMINISTRATION_OPERATIONS[action].capability as LoginAdministrationCapability);
    return this.tx(async (c) => {
      const a = await this.liveAccountForPrincipal(c, principalId, true);
      if (!a) throw new LoginRefusal("NOT_FOUND", "that principal has no login account");
      const { before, after, result } = await fn(c, a, reason);
      await this.audit(c, actor.tenantId, actor.uid, action, a.id, before, after, reason);
      await this.event(c, { event: action, outcome: "success", accountId: a.id, principalId: a.principal_id });
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
    return this.administer(actor, input, "issueLoginReset", async (c, a, reason) => {
      if (a.status !== "active") throw new LoginRefusal("CONFLICT", a.status === "pending_enrollment" ? "the account has not enrolled; reissue the enrollment instead" : "the account is disabled; enable it first");
      await this.requireEmployeeLink(actor.tenantId, a.principal_id);
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
} as const);
export type LoginAdministrationCapability = "admin.roleAssignment.write" | "admin.credentialReset.initiate" | "admin.userStatus.write";
export type LoginAdministrationOperation = keyof typeof LOGIN_ADMINISTRATION_OPERATIONS;
export const isLoginAdministrationOperation = (name: unknown): name is LoginAdministrationOperation =>
  typeof name === "string" && Object.prototype.hasOwnProperty.call(LOGIN_ADMINISTRATION_OPERATIONS, name);

export type LoginAdministrationHandler = (operation: LoginAdministrationOperation, actor: AdminActor, input: Record<string, unknown>) => Promise<unknown>;

export function createLoginAdministration(service: EosLoginService): LoginAdministrationHandler {
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
      default: throw new LoginRefusal("INVALID_INPUT", "unknown login administration operation");
    }
  };
}
