// ████████████████████████████ TEMPORARY ████████████████████████████
//
// LEGACY REORDER ASSIGNMENT COPY ONCE / VERIFY.
//
// The classification lives in the pure module; this file reads PostgreSQL, performs the one-time copy, and verifies
// it. Copy is the ONLY write, and it refuses far more often than it writes.
//
// ════════════════════ THREE IDENTITIES, KEPT APART ════════════════════
//
//   the business assignee     an Employee id, resolved exactly or not copied at all
//   the historical assignor   a Principal id when it resolves, NULL when it does not -- never invented
//   the migration executor    the Principal running THIS import, recorded as an audit event and nowhere else
//
// The third is the one most easily smuggled into the second. `reorder.assignment.migration.copy` names the executor
// as `actor_uid`, following the convention already set by crm.cutover.copy, catalog.cutover.copy and
// employee.profile.cutover.copy. No column on the assignment row can hold it, so "who ran the import" can never be
// read as "who assigned this Reorder".
//
// ════════════════════ COPY REFUSES RATHER THAN GUESSES ════════════════════
//
// ALL-OR-NOTHING PER RUN. If any source row's CURRENT assignee failed to resolve, the copy refuses the whole run
// rather than migrating the resolvable subset: a half-migrated assignment population is a database where "who is
// assigned" has two answers, which is the state this migration exists to end.
//
// It never overwrites a governed assignment. An ALREADY_GOVERNED row is skipped because the answer is already
// right; a row whose governed assignee DISAGREES with the source is a REMEDIATION_REQUIRED blocker, not a silent
// replacement.
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  planReorderAssignmentMigration, type AssignmentMigrationPlan, type LegacyReorderAssignment,
  type MigrationResolutionView, type UidResolution,
} from "./reorderAssignmentMigration";

export const MIGRATION_COPY_ACTION = "reorder.assignment.migration.copy";
/** Provenance every copied row carries, matching the eos_ops convention. A copy never writes NATIVE. */
export const MIGRATED_PROVENANCE = "MIGRATED";
export const FIREBASE_IDENTITY_PROVIDER = "firebase";

/**
 * Read what PostgreSQL knows about the uids the source names. READ ONLY, in one snapshot.
 *
 * Only the uids actually present in the source are resolved, so the view cannot quietly acquire an answer for a uid
 * nobody asked about.
 */
export async function buildMigrationResolutionView(
  pool: Pool, tenantId: string, uids: readonly string[],
): Promise<MigrationResolutionView> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const view = await readResolutionView(client, tenantId, uids);
    await client.query("COMMIT");
    return view;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The reads themselves, against ANY open client.
 *
 * Separated so the COPY can build its authoritative view INSIDE the transaction that writes. A plan computed in an
 * earlier snapshot is a plan about a database that may already have changed -- and the one change that matters
 * most, someone assigning through the governed command, is exactly the one a copy must not overwrite.
 */
async function readResolutionView(
  client: Pick<PoolClient, "query">, tenantId: string, uids: readonly string[],
): Promise<MigrationResolutionView> {
  {
    const distinct = [...new Set(uids)].filter((u) => typeof u === "string" && u !== "");
    const byUid = new Map<string, UidResolution | null>();
    if (distinct.length > 0) {
      // Principal by (provider, subject) -- never by raw uid equality against some other column.
      const principals = await client.query(
        `SELECT p.id, p.external_subject, m.tenant_id
           FROM eos_policy.principals p
           LEFT JOIN eos_policy.tenant_memberships m ON m.principal_id = p.id AND m.tenant_id = $1
          WHERE p.identity_provider = $2 AND p.external_subject = ANY($3::text[])`,
        [tenantId, FIREBASE_IDENTITY_PROVIDER, distinct],
      );
      const links = await client.query(
        `SELECT principal_id, employee_id FROM eos_policy.employee_principal_links
          WHERE tenant_id = $1 AND status = 'active' AND principal_id = ANY($2::text[])`,
        [tenantId, principals.rows.map((r) => r.id as string)],
      );
      const linksByPrincipal = new Map<string, string[]>();
      for (const l of links.rows) {
        const list = linksByPrincipal.get(l.principal_id as string) ?? [];
        list.push(l.employee_id as string);
        linksByPrincipal.set(l.principal_id as string, list);
      }
      for (const uid of distinct) byUid.set(uid, null);
      for (const p of principals.rows) {
        byUid.set(p.external_subject as string, {
          principalId: p.id as string,
          tenantId: (p.tenant_id as string | null) ?? null,
          activeEmployeeIds: (linksByPrincipal.get(p.id as string) ?? []).sort(),
        });
      }
    }
    const employees = await client.query(`SELECT id FROM eos_workforce.employees WHERE tenant_id = $1`, [tenantId]);
    const current = await client.query(
      `SELECT reorder_request_id, assigned_employee_id FROM eos_ops.reorder_request_assignments
        WHERE tenant_id = $1 AND effective_to IS NULL`, [tenantId],
    );
    return Object.freeze({
      tenantId,
      byUid,
      employees: new Set(employees.rows.map((r) => r.id as string)),
      currentAssignments: new Map(current.rows.map((r) => [r.reorder_request_id as string, r.assigned_employee_id as string])),
    });
  }
}

/** DRY RUN: the plan and nothing else. Writes nothing, and says so in the result. */
export async function dryRunReorderAssignmentMigration(
  pool: Pool, input: { readonly tenantId: string; readonly source: readonly LegacyReorderAssignment[] },
): Promise<AssignmentMigrationPlan> {
  const uids = input.source.flatMap((r) => [r.assignedToUserId, r.assignedBy].filter((v): v is string => typeof v === "string"));
  return planReorderAssignmentMigration(input.source, await buildMigrationResolutionView(pool, input.tenantId, uids));
}

export interface CopyResult {
  readonly plan: AssignmentMigrationPlan;
  readonly inserted: number;
  readonly applied: boolean;
  /** Present when the copy refused. The plan is still returned, so the refusal is actionable. */
  readonly refusal: string | null;
}

/**
 * COPY ONCE. One transaction: re-plan inside it, refuse if anything blocks, insert the migratable rows, audit the
 * EXECUTOR, commit.
 *
 * The plan is recomputed INSIDE the transaction rather than trusting one computed earlier: between a dry run and a
 * copy someone may have assigned a Reorder through the governed command, and copying against a stale view is how a
 * governed assignment gets silently replaced.
 */
export async function copyReorderAssignmentsOnce(
  pool: Pool,
  input: {
    readonly tenantId: string;
    readonly source: readonly LegacyReorderAssignment[];
    /** The Principal running the import. Recorded as the EXECUTOR, never as a historical assignor. */
    readonly performedByPrincipalId: string;
    readonly now?: () => Date;
  },
): Promise<CopyResult> {
  const uids = input.source.flatMap((r) => [r.assignedToUserId, r.assignedBy].filter((v): v is string => typeof v === "string"));
  const client: PoolClient = await pool.connect();
  try {
    // ONE CONSISTENT SNAPSHOT. `readResolutionView` issues four SELECTs -- Principals and membership, Employee
    // links, Employees, current assignments -- and under READ COMMITTED each could observe a different committed
    // state, so the "plan" would describe a database that never existed at any instant. A COPY ONCE decides what to
    // write from one governed snapshot, which is also what the DRY RUN already uses.
    //
    // This is a READ-consistency choice, not a write guard: the partial unique index and the explicit FOR UPDATE
    // refusal below remain the protection against a concurrent assignment.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");

    // THE AUTHORITATIVE PLAN, BUILT HERE. Not carried in from an earlier snapshot: between a dry run and a copy
    // someone may have assigned through the governed command, and planning against a stale view is exactly how a
    // governed assignment gets silently replaced. The rows this transaction writes are decided by what this
    // transaction can see.
    const plan = planReorderAssignmentMigration(input.source, await readResolutionView(client, input.tenantId, uids));

    // THE EXECUTOR IS VALIDATED, NOT TRUSTED. It becomes audit provenance answering "who ran this import", so a
    // string nobody can account for must not become that answer. Checked in THIS transaction, against the same
    // active-Principal-and-membership rule every governed command applies.
    const executorId = input.performedByPrincipalId;
    const executorShaped = typeof executorId === "string" && executorId !== "" && executorId.trim() === executorId;
    const executor = executorShaped
      ? await client.query(
        `SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
          WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`,
        [input.tenantId, executorId])
      : { rows: [] as unknown[] };
    if (executor.rows.length === 0) {
      await client.query("ROLLBACK");
      return Object.freeze({
        plan, inserted: 0, applied: false,
        refusal: "the migration executor is not an active Principal with an active membership in this tenant",
      });
    }

    if (plan.blockedReorderIds.length > 0) {
      await client.query("ROLLBACK");
      return Object.freeze({
        plan, inserted: 0, applied: false,
        refusal: `${plan.blockedReorderIds.length} source assignment(s) did not resolve to an exact Employee; `
          + "resolve them before copying -- a partial copy would leave two answers to 'who is assigned'",
      });
    }
    if (plan.copyable.length === 0) {
      await client.query("ROLLBACK");
      return Object.freeze({ plan, inserted: 0, applied: false, refusal: "nothing to copy" });
    }

    const at = input.now?.() ?? new Date();
    let inserted = 0;
    for (const row of plan.copyable) {
      // Locked as well as planned: the plan proves nothing was governed when it was read, and the lock keeps that
      // true until commit. The partial unique index would refuse a race anyway; refusing here says why.
      const existing = await client.query(
        `SELECT 1 FROM eos_ops.reorder_request_assignments
          WHERE tenant_id = $1 AND reorder_request_id = $2 AND effective_to IS NULL FOR UPDATE`,
        [input.tenantId, row.reorderRequestId],
      );
      if (existing.rows.length > 0) {
        await client.query("ROLLBACK");
        return Object.freeze({
          plan, inserted: 0, applied: false,
          refusal: `${row.reorderRequestId} gained a governed assignment during the copy; re-run the dry run`,
        });
      }
      await client.query(
        `INSERT INTO eos_ops.reorder_request_assignments
           (id, tenant_id, reorder_request_id, assigned_employee_id, effective_from, provenance, assigned_by_principal_id, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [`rra_${randomUUID()}`, input.tenantId, row.reorderRequestId, row.assignedEmployeeId, at,
          MIGRATED_PROVENANCE, row.assignedByPrincipalId, "legacy assignedToUserId migration"],
      );
      inserted += 1;
    }
    // THE EXECUTOR, recorded here and nowhere else.
    await client.query(
      `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
       VALUES ($1, $2, $3, $4, 'reorder_assignment_migration', $2, NULL, $5::jsonb, $6, $7)`,
      [`audit_${randomUUID()}`, input.tenantId, MIGRATION_COPY_ACTION, input.performedByPrincipalId,
        JSON.stringify({ inserted, sourceRows: plan.sourceRows, unresolvedAssignors: plan.assignorCounts.UNRESOLVED_PROVENANCE }),
        at, "legacy Reorder assignment copy once"],
    );
    await client.query("COMMIT");
    return Object.freeze({ plan, inserted, applied: true, refusal: null });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export interface VerifyFinding {
  readonly reorderRequestId: string;
  readonly problem: string;
}

export interface VerifyResult {
  readonly checked: number;
  readonly findings: readonly VerifyFinding[];
  /**
   * Columns in the assignment authority whose NAME could hold a uid. A STRUCTURAL violation -- the schema has none,
   * and a migration that added one would be caught here rather than by guessing at values.
   */
  readonly uidShapedColumns: readonly string[];
  /** Rows honestly recording an unknown historical assignor. Expected, and never a failure. */
  readonly unresolvedProvenance: number;
  readonly passed: boolean;
}

/**
 * VERIFY the copy against the source. READ ONLY.
 *
 * Proves what the ruling requires: exactly one current governed assignment per accepted source row, naming the
 * expected Employee of the right tenant; no duplicates; truthful provenance; a historical actor that is either an
 * exact Principal or NULL under MIGRATED; and no Firebase uid anywhere in the governed assignment state.
 */
export async function verifyReorderAssignmentMigration(
  pool: Pool, input: { readonly tenantId: string; readonly source: readonly LegacyReorderAssignment[] },
): Promise<VerifyResult> {
  const plan = await dryRunReorderAssignmentMigration(pool, input);
  const findings: VerifyFinding[] = [];
  const expected = plan.rows.filter((r) => r.assignedEmployeeId !== null);

  const { rows } = await pool.query(
    `SELECT reorder_request_id, assigned_employee_id, provenance, assigned_by_principal_id, count(*) OVER (PARTITION BY reorder_request_id) AS current_count
       FROM eos_ops.reorder_request_assignments
      WHERE tenant_id = $1 AND effective_to IS NULL`, [input.tenantId],
  );
  const byRequest = new Map(rows.map((r) => [r.reorder_request_id as string, r]));

  for (const row of expected) {
    const governed = byRequest.get(row.reorderRequestId);
    if (!governed) { findings.push({ reorderRequestId: row.reorderRequestId, problem: "no current governed assignment" }); continue; }
    if (Number(governed.current_count) !== 1) {
      findings.push({ reorderRequestId: row.reorderRequestId, problem: `${governed.current_count} current assignments` });
    }
    if (governed.assigned_employee_id !== row.assignedEmployeeId) {
      findings.push({ reorderRequestId: row.reorderRequestId, problem: "assigned Employee does not match the source resolution" });
    }
    // Provenance must be truthful: a copied row says MIGRATED, and an unresolved assignor is NULL rather than
    // anything invented. A resolved one must be the Principal the source actually named.
    if (row.disposition === "EXACT_EMPLOYEE_ASSIGNMENT") {
      if (governed.provenance !== MIGRATED_PROVENANCE) {
        findings.push({ reorderRequestId: row.reorderRequestId, problem: `copied row claims provenance ${governed.provenance}` });
      }
      if ((governed.assigned_by_principal_id ?? null) !== row.assignedByPrincipalId) {
        findings.push({ reorderRequestId: row.reorderRequestId, problem: "historical assignor does not match the source resolution" });
      }
    }
  }
  for (const id of plan.blockedReorderIds) {
    if (byRequest.has(id)) findings.push({ reorderRequestId: id, problem: "a BLOCKED source row was copied anyway" });
  }

  // NO UID CAN BE STORED -- proved STRUCTURALLY, not by comparing opaque strings.
  //
  // An earlier version flagged a violation when a governed id happened to equal some Firebase external_subject.
  // That is not identity reasoning: two opaque namespaces may contain the same characters without one being the
  // other, and a governed Principal id "abc" is not a uid merely because some unrelated Principal's subject is
  // also "abc". Authority and type decide meaning, so the proofs are about the schema and its foreign keys.
  const columns = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'eos_ops' AND table_name = 'reorder_request_assignments'`,
  );
  const uidShapedColumn = columns.rows.map((r) => r.column_name as string)
    .filter((c) => /uid|external_subject|user_id/.test(c));
  if (uidShapedColumn.length > 0) {
    findings.push({ reorderRequestId: "", problem: `the assignment authority grew a uid-shaped column: ${uidShapedColumn.join(", ")}` });
  }
  // Every assignee resolves through the governed Employee foreign key, and every non-null actor through the
  // same-tenant membership foreign key. A uid could not satisfy either -- which is what makes it unstorable.
  const unresolved = await pool.query(
    `SELECT a.reorder_request_id,
            (e.id IS NULL) AS assignee_unresolved,
            (a.assigned_by_principal_id IS NOT NULL AND m.principal_id IS NULL) AS actor_unresolved,
            (a.provenance = 'MIGRATED' AND a.assigned_by_principal_id IS NULL) AS unresolved_provenance
       FROM eos_ops.reorder_request_assignments a
       LEFT JOIN eos_workforce.employees e ON e.tenant_id = a.tenant_id AND e.id = a.assigned_employee_id
       LEFT JOIN eos_policy.tenant_memberships m ON m.tenant_id = a.tenant_id AND m.principal_id = a.assigned_by_principal_id
      WHERE a.tenant_id = $1 AND a.effective_to IS NULL`,
    [input.tenantId],
  );
  for (const r of unresolved.rows) {
    if (r.assignee_unresolved) {
      findings.push({ reorderRequestId: r.reorder_request_id as string, problem: "the assignee does not resolve to a governed Employee" });
    }
    if (r.actor_unresolved) {
      findings.push({ reorderRequestId: r.reorder_request_id as string, problem: "the historical actor does not resolve to a same-tenant Principal" });
    }
  }
  const unresolvedProvenance = unresolved.rows.filter((r) => r.unresolved_provenance).length;

  return Object.freeze({
    checked: expected.length,
    findings: Object.freeze(findings),
    uidShapedColumns: Object.freeze(uidShapedColumn),
    unresolvedProvenance,
    passed: findings.length === 0 && plan.blockedReorderIds.length === 0,
  });
}
