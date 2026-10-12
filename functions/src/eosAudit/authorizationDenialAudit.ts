// AUTHORIZATION-DENIAL AUDIT -- the shared EOS support for DECISIONS #229.
//
// Owner policy (2026-10-11): security-relevant authorization denials are recorded in a rate-bounded,
// privacy-preserving audit trail -- principal, tenant, operation, required capability, refusal code, timestamp and
// correlation id where available; never a request payload or a credential; and an audit failure never turns a
// denied operation into an allowed one.
//
// ════════════════════ THE ROW ════════════════════
//
// One row in the governed audit log every EOS writer already uses (eos_policy.audit_events). No schema change:
//   action      `<domain>.<operation>.denied`        e.g. catalog.createPart.denied
//   actor_uid   the RESOLVED EOS Principal            (never a Firebase uid, never a caller-stated id)
//   target_kind 'authorization'   target_id  the operation name
//   before      NULL
//   after       { operation, requiredCapability, refusalCode, correlationId }   -- nothing from the request body --
//               stamped with the actor's Administrator provenance through the one helper every direct audit writer
//               uses (DECISIONS #225), so a refused protected Administrator is distinguishable like any other act
//   reason      the refusal code
//
// ════════════════════ RATE BOUND ════════════════════
//
// audit_events is append-only (migration 1762646400000), so a hostile or broken client must not be able to grow it
// without bound. The row id is DETERMINISTIC per (tenant, principal, action, refusal code, minute) and the insert is
// ON CONFLICT DO NOTHING: at most one row per actor per refused operation per refusal per minute. The trigger only
// refuses UPDATE/DELETE, and DO NOTHING performs neither.
//
// ════════════════════ WHAT IS NOT RECORDED, AND WHY ════════════════════
//
//   * an UNRESOLVED identity (no token, an unverifiable token, a principal that is no member of the stated tenant):
//     there is no Principal to attribute the row to, and recording it under the CALLER-STATED tenant would let
//     anyone write into any tenant's audit log. The 401/403 is the whole answer.
//   * a partial answer that is not a refusal (lookupScannedPart's `aliasDenied`): the operation succeeds within the
//     caller's authority; it is not a denial of the operation.
//
// ════════════════════ FAIL-SAFE, AND OFF UNTIL REVIEWED ════════════════════
//
// recordAuthorizationDenial NEVER throws and NEVER changes the caller's answer: it is called AFTER the refusal is
// decided, its result is informational, and a failed insert is logged (without payload) and swallowed.
// AUTHORIZATION_DENIAL_AUDIT.mode ships "OFF". The Owner required that any change to the audit-event contract be
// reviewed before activation; turning this on in an environment is therefore a reviewed code change, not a toggle.
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { withActorAuthority } from "../eosOps/administrationReach.js";

export type DenialAuditMode = "OFF" | "RECORD";

/** The activation switch. "OFF" until the Owner-reviewed activation change (DECISIONS #229). */
export const AUTHORIZATION_DENIAL_AUDIT: Readonly<{ mode: DenialAuditMode }> = Object.freeze({ mode: "OFF" });

export const DENIAL_AUDIT_TARGET_KIND = "authorization";
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;

export interface AuthorizationDenial {
  /** The resolved tenant of the Principal (never the caller-stated one alone). */
  readonly tenantId: string;
  /** The resolved EOS Principal. */
  readonly principalId: string;
  /** The EOS domain, e.g. "catalog". */
  readonly domain: string;
  /** The refused operation, e.g. "createPart". */
  readonly operation: string;
  /** The capability (or capabilities, space-separated) the operation required, when the refusal is about one. */
  readonly requiredCapability: string | null;
  /** The governed refusal code, e.g. CAPABILITY_REQUIRED. */
  readonly refusalCode: string;
  /** A request correlation id, when the caller sent a well-formed one. */
  readonly correlationId?: string | null;
}

export type DenialAuditOutcome = "RECORDED" | "DEDUPLICATED" | "SKIPPED_OFF" | "SKIPPED_UNRESOLVED" | "FAILED";

export interface DenialAuditOptions {
  readonly mode?: DenialAuditMode;
  readonly now?: () => Date;
  /** Logger for a failed insert. Receives no payload. */
  readonly warn?: (message: string) => void;
}

/** A correlation id is recorded only if it is a plain token; anything else is dropped, never echoed. */
export function sanitizeCorrelationId(value: unknown): string | null {
  return typeof value === "string" && CORRELATION_ID_PATTERN.test(value) ? value : null;
}

/** The deterministic row id for one (tenant, principal, action, refusal code, minute) bucket. */
export function denialAuditId(tenantId: string, principalId: string, action: string, refusalCode: string, at: Date): string {
  const minute = Math.floor(at.getTime() / 60_000);
  const digest = createHash("sha256").update([tenantId, principalId, action, refusalCode, String(minute)].join("\u0000")).digest("hex");
  return `audit_denied_${digest.slice(0, 40)}`;
}

/**
 * Record one authorization denial. Never throws; never alters the refusal it describes.
 * Returns what happened, for tests and metrics -- callers must not branch the caller's answer on it.
 */
export async function recordAuthorizationDenial(
  pool: Pick<Pool, "query">,
  denial: AuthorizationDenial,
  options: DenialAuditOptions = {},
): Promise<DenialAuditOutcome> {
  try {
    const mode = options.mode ?? AUTHORIZATION_DENIAL_AUDIT.mode;
    if (mode !== "RECORD") return "SKIPPED_OFF";
    const resolved = [denial?.tenantId, denial?.principalId].every((v) => typeof v === "string" && v.trim() !== "");
    if (!resolved) return "SKIPPED_UNRESOLVED";
    for (const token of [denial.domain, denial.operation, denial.refusalCode]) {
      if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return "SKIPPED_UNRESOLVED";
    }
    const at = (options.now ?? (() => new Date()))();
    const action = `${denial.domain}.${denial.operation}.denied`;
    const id = denialAuditId(denial.tenantId, denial.principalId, action, denial.refusalCode, at);
    const after = {
      operation: denial.operation,
      requiredCapability: typeof denial.requiredCapability === "string" ? denial.requiredCapability : null,
      refusalCode: denial.refusalCode,
      correlationId: sanitizeCorrelationId(denial.correlationId),
    };
    const res = await pool.query(
      `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [id, denial.tenantId, action, denial.principalId, DENIAL_AUDIT_TARGET_KIND, denial.operation,
        JSON.stringify(await withActorAuthority(pool as Pool, denial.tenantId, denial.principalId, after)), at, denial.refusalCode],
    );
    return (res.rowCount ?? 0) > 0 ? "RECORDED" : "DEDUPLICATED";
  } catch {
    // The refusal stands whatever happens here. Say THAT it failed, never WHAT was refused for whom.
    (options.warn ?? ((m: string) => console.warn(m)))("authorization-denial audit: the audit row could not be written");
    return "FAILED";
  }
}
