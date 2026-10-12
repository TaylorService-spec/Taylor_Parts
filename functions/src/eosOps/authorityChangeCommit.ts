// THE MANDATORY-PREVIEW COMMIT (PR 4). "The preview, ending in COMMIT" (arch/grant-impact-preview.md §3.2, review C3).
//
// ONE real transaction on ONE checked-out connection:
//
//   BEGIN READ COMMITTED, lock_timeout (default 10s: a commit WAITS for a running preview or commit, it is not refused
//   at once), the tenant governance lock FIRST -- so every read the command makes, including the owner checks that today
//   run before the command's own transaction (design F-1), happens under the lock.
//   PASS 1 (the preview, inside SAVEPOINT): policy-state digest, every member's before snapshot, the UNCHANGED command
//          through the same single-connection shim the preview uses, every member's after snapshot -- then
//          evaluateAuthorityChange, THE SAME rule the preview uses for outcome, impact and every digest (one function:
//          the two can never disagree, e.g. about rows-affected or a new report dimension). ROLLBACK TO SAVEPOINT.
//          A command refusal ends here with the command's OWN error (same code, same message).
//   COMPARE the recomputed previewDigest with the one presented: different -> ROLLBACK, STALE_PREVIEW. Every part is
//          recomputed under the lock; nothing a counts-only caller cannot see is trusted from the request.
//   PASS 2 (the commit): the command once more, its audit rows marked {HUMAN_PREVIEWED, previewDigest, affectedCount},
//          the after snapshot again -- its evaluated impact must equal pass 1's (else ROLLBACK, STALE_PREVIEW) -- COMMIT.
//
// THE BUDGET is the preview's own mechanism (previewBudget + PreviewSimulation: a clock read before every statement,
// statement_timeout lowered inside the last window), so no statement -- and no hold of the governance lock -- outlives
// the deadline. Exceeded -> ROLLBACK (exempt from the budget), COMMIT_BUSY. Default total = 2 x DEFAULT_PREVIEW_BUDGET_MS:
// a commit does twice a preview's work (the command twice, three tenant snapshots instead of two).
//
// No eos_policy.preview marker is set: this transaction is MEANT to commit, so the never-commit fence is not armed.
// The shim's statement guard still applies (no NOTIFY, sequences, session locks, ...).
import type { Pool, PoolClient } from "pg";
import { PostgresPolicyRepository } from "../adminPolicy/postgresPolicyRepository";
import type { PolicyRepository } from "../adminPolicy/policyRepository";
import {
  AuthorityPreviewRefusal,
  withAuthorityChangeAudit,
  type AuthorityChangeCommitRequest,
  type AuthorityChangeCommitter,
} from "../adminPolicy/authorityChangeCommitPort";
import type { PolicyQueryable } from "./capabilityAuthority";
import {
  BUSY_SQLSTATES,
  DEFAULT_PREVIEW_BUDGET_MS,
  DEFAULT_PREVIEW_STATEMENT_TIMEOUT_MS,
  PreviewBudgetExceeded,
  PreviewSimulation,
  evaluateAuthorityChange,
  policyStateDigest,
  previewBudget,
  readDeferrableConstraints,
  snapshotTenantAuthority,
  type PreviewStatement,
  type SimulatedRun,
} from "./authorityChangePreview";
import type { ObjectFieldGroups } from "./governedFieldGroups";

/** The commit's TOTAL budget: twice the preview's (see the header). */
export const DEFAULT_COMMIT_BUDGET_MS = 2 * DEFAULT_PREVIEW_BUDGET_MS;

export interface AuthorityChangeCommitOptions {
  readonly pool: Pick<Pool, "connect">;
  /** The SAME governed field-group definitions the preview is composed with (else every digest differs). */
  readonly fieldGroups?: readonly ObjectFieldGroups[];
  readonly lockTimeoutMs?: number;
  /** Per-statement cap (default: the preview's). */
  readonly statementTimeoutMs?: number;
  /** TOTAL time a commit may hold the governance lock, BEGIN to COMMIT (default DEFAULT_COMMIT_BUDGET_MS). */
  readonly totalBudgetMs?: number;
  /** Test seam: the clock the budget reads (a clock READ, never a timer). */
  readonly now?: () => number;
  /** Test seam: the statement log of each commit. */
  readonly onStatements?: (log: readonly PreviewStatement[]) => void;
  /** Test seam: runs between pass 1's compare and pass 2 (never composed by the server). */
  readonly betweenPasses?: () => Promise<void>;
}

const positiveInt = (value: number | undefined, fallback: number): number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;

export function createAuthorityChangeCommit(options: AuthorityChangeCommitOptions): AuthorityChangeCommitter {
  const fieldGroups = Object.freeze([...(options.fieldGroups ?? [])]);
  const lockTimeoutMs = positiveInt(options.lockTimeoutMs, 10_000);
  const statementTimeoutMs = positiveInt(options.statementTimeoutMs, DEFAULT_PREVIEW_STATEMENT_TIMEOUT_MS);
  const totalBudgetMs = positiveInt(options.totalBudgetMs, DEFAULT_COMMIT_BUDGET_MS);
  const now = options.now ?? (() => Date.now());

  return async function commitAuthorityChange(request: AuthorityChangeCommitRequest): Promise<unknown> {
    const tenantId = request.actor.tenantId;
    const client: PoolClient = await options.pool.connect();
    let destroy: Error | undefined;
    const onClientError = (err: Error) => { destroy ??= err; };
    client.on("error", onClientError);
    const simulation = new PreviewSimulation(client, previewBudget(totalBudgetMs, Math.min(statementTimeoutMs, totalBudgetMs), now));
    let open = false;
    let committed = false;
    try {
      await simulation.engine("BEGIN ISOLATION LEVEL READ COMMITTED");
      open = true;
      await simulation.engine(`SET LOCAL lock_timeout = '${lockTimeoutMs}ms'`);
      await simulation.engine(`SET LOCAL statement_timeout = '${Math.min(statementTimeoutMs, totalBudgetMs)}ms'`);
      await simulation.engine(`SELECT pg_advisory_xact_lock(hashtextextended('admin-governance|' || $1, 0))`, [tenantId]);
      simulation.armCommitPoint(await readDeferrableConstraints((text, values) => simulation.engine(text, values)));
      const q: PolicyQueryable = { query: ((text: string, values?: unknown[]) => simulation.engine(text, values ?? [])) as unknown as PolicyQueryable["query"] };
      const sim = simulation.pool as unknown as Pick<Pool, "query" | "connect">;
      const reader: PolicyQueryable = sim;
      const repo = new PostgresPolicyRepository(sim);

      const run = async (r: PolicyRepository): Promise<SimulatedRun> => {
        const writesBefore = simulation.committedWrites;
        try {
          const result = await request.run(r);
          return { threw: false, error: null, result, writes: simulation.committedWrites - writesBefore };
        } catch (error) {
          return { threw: true, error, result: null, writes: 0 };
        }
      };
      const guard = () => {
        if (simulation.violation) throw simulation.violation;
        if (simulation.busy) throw new AuthorityPreviewRefusal("COMMIT_BUSY", `the authority state is busy (${simulation.busy}); nothing was committed; try again`);
      };
      const evaluate = (stateDigest: string, before: Parameters<typeof evaluateAuthorityChange>[0]["before"],
        after: Parameters<typeof evaluateAuthorityChange>[0]["after"], ran: SimulatedRun) => evaluateAuthorityChange({
        tenantId, actorPrincipalId: request.actor.uid, operation: request.operation, input: request.input,
        policyStateDigest: stateDigest, before, after, run: ran,
      });

      // ════════ PASS 1: the preview, recomputed under the lock ════════
      await simulation.engine("SAVEPOINT commit_preview");
      const stateDigest = await policyStateDigest(q, tenantId);
      const before = await snapshotTenantAuthority(reader, repo, tenantId, fieldGroups);
      const first = await run(repo);
      guard();
      // The change itself is refused: the command's own error, unchanged. Nothing was written.
      if (first.threw) throw first.error;
      const afterFirst = await snapshotTenantAuthority(reader, repo, tenantId, fieldGroups);
      guard();
      const evaluation = evaluate(stateDigest, before, afterFirst, first);
      await simulation.engine("ROLLBACK TO SAVEPOINT commit_preview");
      if (evaluation.digests.previewDigest !== request.previewDigest) {
        throw new AuthorityPreviewRefusal("STALE_PREVIEW",
          "the authority state, the change or its impact has moved since this preview (or the preview was for another change, actor or tenant); preview the change again");
      }
      await options.betweenPasses?.();

      // ════════ PASS 2: the commit, audited as previewed ════════
      const marked = withAuthorityChangeAudit(repo, Object.freeze({
        mode: "HUMAN_PREVIEWED", previewed: true, previewDigest: request.previewDigest,
        affectedCount: evaluation.affected.length, impactDigest: evaluation.digests.impactDigest,
      }));
      const second = await run(marked);
      guard();
      if (second.threw) throw second.error;
      const afterSecond = await snapshotTenantAuthority(reader, repo, tenantId, fieldGroups);
      guard();
      if (evaluate(stateDigest, before, afterSecond, second).digests.impactDigest !== evaluation.digests.impactDigest) {
        throw new AuthorityPreviewRefusal("STALE_PREVIEW", "the change did not reproduce its previewed impact; nothing was committed; preview the change again");
      }
      simulation.close();
      await simulation.engine("COMMIT");
      committed = true;
      return second.result;
    } catch (err) {
      if (err instanceof PreviewBudgetExceeded) {
        throw new AuthorityPreviewRefusal("COMMIT_BUSY", `the commit exceeded its ${totalBudgetMs}ms budget; nothing was committed; try again`);
      }
      const code = (err as { code?: unknown })?.code;
      if (typeof code === "string" && BUSY_SQLSTATES[code]) {
        throw new AuthorityPreviewRefusal("COMMIT_BUSY", "the authority state is busy; nothing was committed; try again");
      }
      throw err;
    } finally {
      simulation.close();
      try {
        if (open && !committed) await simulation.engine("ROLLBACK", [], true);
      } catch (rollbackErr) {
        destroy ??= rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr));
      } finally {
        options.onStatements?.(Object.freeze([...simulation.log]));
        client.removeListener("error", onClientError);
        client.release(destroy);
      }
    }
  };
}
