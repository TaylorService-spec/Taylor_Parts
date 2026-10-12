// MANDATORY GRANT-IMPACT PREVIEW -- THE COMMIT SIDE (PR 4; arch/grant-impact-preview.md §3-§5 as amended by the
// independent review: C3, no HMAC token -- the commit RECOMPUTES the preview under the governance lock and compares
// digests; finding 9, the digests carry no generated id and no clock value).
//
// ════════════════════ THE FLAG ════════════════════
//
//   ADMIN_PREVIEW_MANDATORY   exactly "true" turns it ON; anything else (absent, "false", "1", "yes") is OFF. OFF in every
//                             environment by default; the Owner turns it on.
//
//   OFF, no previewDigest     the nine commands commit EXACTLY as before (dispatch -> the command; nothing here runs).
//   OFF, previewDigest given  the digest IS verified (the commit runs through the engine; STALE_PREVIEW on mismatch).
//                             A client that previewed is asking for THE previewed change; silently committing a different
//                             one would make the preview a lie. Opt-in, so it changes nothing for a client that sends none.
//   ON                        every one of the nine requires previewDigest: absent -> PREVIEW_REQUIRED, malformed ->
//                             PREVIEW_INVALID, moved -> STALE_PREVIEW. Nothing is written and nothing is audited on any of
//                             them.
//
// ════════════════════ THE COMMIT = THE PREVIEW, ENDING IN COMMIT ════════════════════
//
// eosOps/authorityChangeCommit.ts (server-composed over the shared pool; this module never touches `pg`): one REAL
// transaction, the governance lock first, then the SAME simulation as the preview inside a savepoint (state digest,
// before snapshot, the unchanged command, after snapshot, impact digest), ROLLBACK TO SAVEPOINT, compare the recomputed
// preview digest, and only then the command once more for real with its audit rows marked -- COMMIT.
//
// ════════════════════ AUDIT ════════════════════
//
// Append-only, no new table and no new column: every audit row the command writes inside the commit carries
// `after.authorityChange = {mode, previewed, previewDigest, affectedCount, impactDigest}` (HUMAN_PREVIEWED) or
// `{mode: "MACHINE_APPLIED", previewed: false, manifestId, manifestDigest}` (the machine carve-out below).
//
// ════════════════════ THE MACHINE CARVE-OUT (explicit, audited, test-pinned) ════════════════════
//
// In-process runners that call the commands DIRECTLY (never through the Administration transport) are not reachable by
// the flag: they are code-reviewed manifests, run by an operator. Each one wraps its repository in
// `machineAppliedRepository(repo, manifest)`, so every audit row it writes says MACHINE_APPLIED with the manifest's
// digest. The exact set of such callers is pinned (test/authorityPreviewMandatoryCarveOut.test.mjs): a new direct
// caller fails CI until it is reviewed into the list. Previewing them is a follow-up.
import { createHash } from "node:crypto";
import type { AdminActor } from "./policyCommands";
import type { PolicyRepository } from "./policyRepository";
import type { AuthorityChangeOperation } from "./authorityChangePreviewPort";

export const ADMIN_PREVIEW_MANDATORY_ENV = "ADMIN_PREVIEW_MANDATORY";

/** Strict: only the exact string "true" (case-insensitive, trimmed) turns the requirement on. */
export function adminPreviewMandatoryFrom(env: Readonly<Record<string, string | undefined>> | null | undefined): boolean {
  const raw = env?.[ADMIN_PREVIEW_MANDATORY_ENV];
  return typeof raw === "string" && raw.trim().toLowerCase() === "true";
}

/** A preview digest is a lowercase hex SHA-256: anything else is PREVIEW_INVALID before any work. */
export const PREVIEW_DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export type AuthorityPreviewRefusalCode = "PREVIEW_REQUIRED" | "PREVIEW_INVALID" | "STALE_PREVIEW" | "COMMIT_BUSY";

/** A commit refused for its PREVIEW, never for the change itself (the command's own refusals pass through unchanged). */
export class AuthorityPreviewRefusal extends Error {
  constructor(readonly code: AuthorityPreviewRefusalCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "AuthorityPreviewRefusal";
  }
}

export interface HumanPreviewedMark {
  readonly mode: "HUMAN_PREVIEWED";
  readonly previewed: true;
  readonly previewDigest: string;
  readonly affectedCount: number;
  readonly impactDigest: string;
}

export interface MachineAppliedMark {
  readonly mode: "MACHINE_APPLIED";
  readonly previewed: false;
  readonly manifestId: string;
  readonly manifestDigest: string;
}

export type AuthorityChangeAuditMark = HumanPreviewedMark | MachineAppliedMark;

/** The stored `after`: the command's own record, plus the mark. Never overwrites a key the command wrote. */
export function afterWithAuthorityChange(after: unknown, mark: AuthorityChangeAuditMark): unknown {
  if (after === null || typeof after !== "object" || Array.isArray(after)) return after;
  if ("authorityChange" in (after as Record<string, unknown>)) return after;
  return { ...(after as Record<string, unknown>), authorityChange: mark };
}

/**
 * The same repository, except that every audit row written inside one of its transactions carries `mark`. Reads,
 * writes and the transaction boundaries are untouched (a Proxy forwards everything else to the real object).
 */
export function withAuthorityChangeAudit<R extends PolicyRepository>(repo: R, mark: AuthorityChangeAuditMark): R {
  const frozen = Object.freeze({ ...mark });
  const wrapTx = <T extends object>(tx: T): T => new Proxy(tx, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (prop === "appendAudit" && typeof value === "function") {
        return (input: { after?: unknown } & Record<string, unknown>) =>
          (value as (i: unknown) => Promise<string>).call(target, { ...input, after: afterWithAuthorityChange(input.after, frozen) });
      }
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  return new Proxy(repo, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (prop === "transact" && typeof value === "function") {
        return (actor: unknown, fn: (tx: object) => Promise<unknown>) =>
          (value as (a: unknown, f: (tx: object) => Promise<unknown>) => Promise<unknown>).call(target, actor, (tx: object) => fn(wrapTx(tx)));
      }
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

// ════════════════════ the machine carve-out ════════════════════

export interface MachineAuthorityManifest {
  /** A stable name for the code-reviewed manifest (e.g. "workOrderLifecycleGrantActivation"). */
  readonly manifestId: string;
  /** The ruling the manifest implements. */
  readonly ruling: string;
  /** The manifest's changes, as data (digested). */
  readonly changes: unknown;
}

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
};

/** sha256 of the manifest's canonical JSON: the same manifest always has the same digest. */
export function machineManifestDigest(manifest: MachineAuthorityManifest): string {
  return createHash("sha256").update(canonical({ manifestId: manifest.manifestId, ruling: manifest.ruling, changes: manifest.changes })).digest("hex");
}

/** The carve-out: the repository a direct, code-reviewed runner hands the commands. Audits MACHINE_APPLIED. */
export function machineAppliedRepository<R extends PolicyRepository>(repo: R, manifest: MachineAuthorityManifest): R {
  if (!manifest || typeof manifest.manifestId !== "string" || manifest.manifestId.trim() === "") {
    throw new Error("a machine-applied authority change needs a named, code-reviewed manifest");
  }
  return withAuthorityChangeAudit(repo, Object.freeze({
    mode: "MACHINE_APPLIED", previewed: false, manifestId: manifest.manifestId, manifestDigest: machineManifestDigest(manifest),
  }));
}

// ════════════════════ the committer port ════════════════════

export interface AuthorityChangeCommitRequest {
  readonly actor: AdminActor;
  readonly operation: AuthorityChangeOperation;
  /** The change exactly as stated, WITHOUT previewDigest -- what the preview digested. */
  readonly input: Readonly<Record<string, unknown>>;
  /** Already shape-checked (PREVIEW_DIGEST_PATTERN). */
  readonly previewDigest: string;
  /** Runs the UNCHANGED command against the repository it is given. */
  run(repo: PolicyRepository): Promise<unknown>;
}

/** The server-composed committer (eosOps/authorityChangeCommit.ts). Returns the command's own result. */
export type AuthorityChangeCommitter = (request: AuthorityChangeCommitRequest) => Promise<unknown>;
