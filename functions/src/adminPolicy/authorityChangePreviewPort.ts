// THE GRANT-IMPACT PREVIEW PORT (PR 3, arch/grant-impact-preview.md + independent-review findings 9-12, C3).
//
// ADVISORY AND READ-ONLY. `previewAuthorityChange` answers "what would this Administration change do to everybody's
// effective authority?" by running the UNCHANGED command on one PostgreSQL transaction that is ALWAYS rolled back
// (eosOps/authorityChangePreview.ts, server-composed over the shared pool -- this module never touches `pg`). Nothing in
// this PR consumes the result: every one of the nine commands still commits exactly as before, with or without a
// preview. PR 4 makes the preview mandatory and re-derives these digests under the governance lock at commit time; there
// is no token (review C3 / finding 19), only digests the commit recomputes.
//
// THE GATE (review finding 10). The actor must be authorized to PERFORM the change: the command's own capability gate
// (admin.securityPolicy.write, or admin.roleAssignment.write for assignRole / revokeRole) is decided BEFORE any
// simulation, so a principal who could not commit the change learns nothing about it. Per-principal DETAIL additionally
// requires admin.principalAccess.read (the getPrincipalEffectiveAccess authority); without it the preview answers with
// counts only. Protected Owners and Administrators are reported as DELTAS only, never as full snapshots.
import type { AdminActor } from "./policyCommands";
import type { PolicyRepository } from "./policyRepository";

/** The nine authority-changing commands the preview simulates. Closed; anything else is refused by name. */
export const AUTHORITY_CHANGE_OPERATIONS = Object.freeze([
  "grantObjectActionToRole",
  "revokeObjectActionFromRole",
  "applyObjectWideRoleAuthority",
  "setGrantCondition",
  "retireGrantCondition",
  "grantObjectActionToPrincipal",
  "revokeObjectActionFromPrincipal",
  "assignRole",
  "revokeRole",
] as const);

export type AuthorityChangeOperation = (typeof AUTHORITY_CHANGE_OPERATIONS)[number];

export const isAuthorityChangeOperation = (name: unknown): name is AuthorityChangeOperation =>
  typeof name === "string" && (AUTHORITY_CHANGE_OPERATIONS as readonly string[]).includes(name);

/** The command gate each operation is decided by -- the same `requireSecurityAdministrationCapability` action. */
export const AUTHORITY_CHANGE_GATE: Readonly<Record<AuthorityChangeOperation, "editSecurityPolicy" | "assignRole">> = Object.freeze({
  grantObjectActionToRole: "editSecurityPolicy",
  revokeObjectActionFromRole: "editSecurityPolicy",
  applyObjectWideRoleAuthority: "editSecurityPolicy",
  setGrantCondition: "editSecurityPolicy",
  retireGrantCondition: "editSecurityPolicy",
  grantObjectActionToPrincipal: "editSecurityPolicy",
  revokeObjectActionFromPrincipal: "editSecurityPolicy",
  assignRole: "assignRole",
  revokeRole: "assignRole",
});

/** Whose holdings the change is ABOUT -- used only to count unaffected holders. Never an authority input. */
export type AuthorityChangeSubject =
  | { readonly kind: "ROLE_KEY"; readonly roleKey: string }
  | { readonly kind: "ROLE_ID"; readonly roleId: string; readonly principalId: string }
  | { readonly kind: "PRINCIPAL"; readonly principalId: string }
  | { readonly kind: "ASSIGNMENT"; readonly assignmentId: string };

export interface AuthorityChangeSimulationRequest {
  readonly actor: AdminActor;
  readonly operation: AuthorityChangeOperation;
  /** The change exactly as the caller stated it (digested; never re-read for authority). */
  readonly input: Readonly<Record<string, unknown>>;
  readonly subject: AuthorityChangeSubject | null;
  /** True only when the actor also holds admin.principalAccess.read. */
  readonly detail: boolean;
  /** Runs the UNCHANGED command against the repository it is given (the simulation's). */
  run(repo: PolicyRepository): Promise<unknown>;
}

export type AuthorityChangeOutcome = "WOULD_APPLY" | "NO_OP" | "WOULD_REFUSE";

export interface AuthorityChangeSimulationResult {
  readonly outcome: AuthorityChangeOutcome | "PREVIEW_BUSY";
  /** The error the command threw (WOULD_REFUSE only). The API turns it into the same code/message a commit returns. */
  readonly error: unknown;
  readonly busy: { readonly reason: "LOCK_TIMEOUT" | "STATEMENT_TIMEOUT" | "BUDGET" | "CONCURRENCY" | "POOL" | "UNSTABLE" } | null;
  readonly report: Readonly<Record<string, unknown>>;
}

/** The server-composed simulator (eosOps/authorityChangePreview.ts). Absent, the read refuses. */
export type AuthorityChangeSimulator = (request: AuthorityChangeSimulationRequest) => Promise<AuthorityChangeSimulationResult>;
