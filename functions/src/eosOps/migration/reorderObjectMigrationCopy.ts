// LEGACY REORDER OBJECT: DRY RUN / COPY ONCE / VERIFY.
//
// MIGRATION_ONLY. The classifier beside this file decides WHAT may be copied; this file decides
// nothing and only carries out a plan it builds from one governed snapshot.
//
// It writes eos_ops.reorder_requests rows with provenance = MIGRATED. It activates nothing: no route
// serves them, no client reads them, and Firestore remains Reorder authority until the cutover
// retires it. Producing a plan is not executing one, and executing one is not activation.
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  planReorderObjectMigration, LEGACY_ACTOR_FIELDS,
  type LegacyReorderDocument, type ReorderObjectPlan, type ReorderResolutionView, type UidPrincipal,
} from "./reorderObjectMigration.js";

export const REORDER_OBJECT_COPY_ACTION = "reorder.object.migration.copy";
export const MIGRATED_PROVENANCE = "MIGRATED";
export const FIREBASE_IDENTITY_PROVIDER = "firebase";

/**
 * Gather everything the classifier needs, from ONE snapshot.
 *
 * Three reads that must agree with each other: who the uids are, which warehouses this tenant has
 * and whose company they are, and which Reorders the authority already holds.
 */
async function readResolutionView(
  client: PoolClient, tenantId: string, uids: readonly string[],
): Promise<ReorderResolutionView> {
  const distinct = [...new Set(uids)];
  const byUid = new Map<string, UidPrincipal | null>();
  if (distinct.length > 0) {
    // EXACT external subject, on the firebase provider. No name, no email, no role, no fuzzy match.
    const { rows } = await client.query(
      `SELECT p.external_subject AS uid, p.id AS principal_id, m.tenant_id
         FROM eos_policy.principals p
         LEFT JOIN eos_policy.tenant_memberships m
           ON m.principal_id = p.id AND m.tenant_id = $1 AND m.status = 'active'
        WHERE p.identity_provider = $2 AND p.external_subject = ANY($3::text[]) AND p.status = 'active'`,
      [tenantId, FIREBASE_IDENTITY_PROVIDER, distinct],
    );
    for (const r of rows) {
      byUid.set(r.uid, { principalId: r.principal_id, tenantId: r.tenant_id ?? null });
    }
    for (const uid of distinct) if (!byUid.has(uid)) byUid.set(uid, null);
  }

  const warehouses = await client.query(
    `SELECT id, operating_company_key FROM eos_ops.warehouses WHERE tenant_id = $1`, [tenantId]);
  const existing = await client.query(
    `SELECT id FROM eos_ops.reorder_requests WHERE tenant_id = $1`, [tenantId]);

  return Object.freeze({
    tenantId,
    byUid,
    warehouseCompany: new Map(warehouses.rows.map((r) => [r.id, r.operating_company_key])),
    existingReorderIds: new Set(existing.rows.map((r) => r.id)),
  });
}

const sourceUids = (source: readonly LegacyReorderDocument[]): string[] =>
  source.flatMap((doc) => {
    const data = doc.data as Record<string, unknown> | null;
    if (typeof data !== "object" || data === null) return [];
    return LEGACY_ACTOR_FIELDS
      .map((field) => data[field])
      .filter((v): v is string => typeof v === "string" && v.trim() !== "");
  });

/** Classify without writing. READ ONLY, so it cannot become a copy by accident. */
export async function dryRunReorderObjectMigration(
  pool: Pool, input: { readonly tenantId: string; readonly source: readonly LegacyReorderDocument[] },
): Promise<ReorderObjectPlan> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const view = await readResolutionView(client, input.tenantId, sourceUids(input.source));
    const plan = planReorderObjectMigration(input.source, view);
    await client.query("COMMIT");
    return plan;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export interface ReorderCopyResult {
  readonly plan: ReorderObjectPlan;
  readonly inserted: number;
  readonly applied: boolean;
  readonly refusal: string | null;
}

/**
 * COPY ONCE. All or nothing.
 *
 * A partial copy is the one outcome worth preventing above all others: it would leave some Reorders
 * answered by PostgreSQL and the rest by Firestore, with no way to tell from either side which is
 * which.
 */
export async function copyReorderObjectsOnce(
  pool: Pool,
  input: {
    readonly tenantId: string;
    readonly source: readonly LegacyReorderDocument[];
    /** The Principal running the import. Recorded as the EXECUTOR, and as nothing else. */
    readonly performedByPrincipalId: string;
    readonly now?: () => Date;
  },
): Promise<ReorderCopyResult> {
  const client: PoolClient = await pool.connect();
  try {
    // ONE CONSISTENT SNAPSHOT, for the same reason the assignment copy takes one: three reads that
    // under READ COMMITTED could each see a different committed state would describe a database that
    // never existed at any instant.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");

    // THE AUTHORITATIVE PLAN, BUILT HERE -- not carried in from a dry run taken against a database
    // that may since have gained the very rows this copy is about to insert.
    const view = await readResolutionView(client, input.tenantId, sourceUids(input.source));
    const plan = planReorderObjectMigration(input.source, view);

    // THE EXECUTOR IS VALIDATED, NOT TRUSTED. It answers "who ran this import" in the audit record
    // and nothing else: it is never a requester, never a reviewer, never an assignor.
    const executorId = input.performedByPrincipalId;
    const shaped = typeof executorId === "string" && executorId !== "" && executorId.trim() === executorId;
    const executor = shaped
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

    const refused = plan.rows.filter((r) => r.disposition === "REFUSED");
    if (refused.length > 0) {
      await client.query("ROLLBACK");
      return Object.freeze({
        plan, inserted: 0, applied: false,
        refusal: `${refused.length} source Reorder(s) were refused; resolve them before copying -- a partial `
          + "copy would leave some Reorders answered by PostgreSQL and the rest by Firestore",
      });
    }
    if (plan.copyable.length === 0) {
      await client.query("ROLLBACK");
      return Object.freeze({ plan, inserted: 0, applied: false, refusal: "nothing to copy" });
    }

    const at = input.now?.() ?? new Date();
    let inserted = 0;
    for (const planned of plan.copyable) {
      const row = planned.row;
      if (row === null) continue;
      // The plan proved the id was absent when the snapshot was taken; the primary key keeps that
      // true through commit. Inserting rather than upserting is deliberate -- a copy never overwrites
      // a governed record.
      await client.query(
        `INSERT INTO eos_ops.reorder_requests
           (id, tenant_id, operating_company_key, part_id, warehouse_id, status,
            requested_quantity, recommended_quantity, work_order_id, reorder_request_number,
            requested_by, updated_by, provenance, created_at,
            recommendation_status, urgency, quantity_source,
            review_decision, review_notes, reviewed_at, reviewed_by_principal_id,
            purchasing_started_at, purchasing_started_by_principal_id, purchasing_notes,
            vendor_contacted, expected_availability_date,
            last_purchasing_update_at, last_purchasing_update_by_principal_id,
            cancelled_at, cancelled_by_principal_id, cancellation_reason,
            received_at, received_by_principal_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                 $11, $12, $13, $14,
                 $15, $16, $17,
                 $18, $19, $20, $21,
                 $22, $23, $24,
                 $25, $26,
                 $27, $28,
                 $29, $30, $31,
                 $32, $33)`,
        [
          row.id, input.tenantId, row.operatingCompanyKey, row.partId, row.warehouseId, row.status,
          row.requestedQuantity, row.recommendedQuantity, row.workOrderId, row.reorderRequestNumber,
          // THE REQUESTER: the resolved Principal, or NULL. Never the uid, never the executor, and
          // never a generic migration Principal standing in for a person nobody can identify.
          row.actors.requestedBy,
          // updated_by records WHO LAST TOUCHED THE ROW, and for a migrated record that is the
          // import. This is the executor's one legitimate appearance on the row itself.
          input.performedByPrincipalId,
          MIGRATED_PROVENANCE, row.createdAt,
          row.recommendationStatus, row.urgency, row.quantitySource,
          row.reviewDecision, row.reviewNotes, row.reviewedAt, row.actors.reviewedBy,
          row.purchasingStartedAt, row.actors.purchasingStartedBy, row.purchasingNotes,
          row.vendorContacted, row.expectedAvailabilityDate,
          row.lastPurchasingUpdateAt, row.actors.lastPurchasingUpdateBy,
          row.cancelledAt, row.actors.cancelledBy, row.cancellationReason,
          row.receivedAt, row.actors.receivedBy,
        ],
      );
      inserted += 1;
    }

    await client.query(
      `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
       VALUES ($1, $2, $3, $4, 'reorder_object_migration', $2, NULL, $5::jsonb, $6, $7)`,
      [`audit_${randomUUID()}`, input.tenantId, REORDER_OBJECT_COPY_ACTION, input.performedByPrincipalId,
        JSON.stringify({ inserted, sourceRows: plan.sourceRows, unresolvedActors: plan.unresolvedActors }),
        at, "legacy Reorder object copy once"],
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

export interface ReorderVerifyFinding {
  readonly code: string;
  readonly detail: string;
  readonly count: number;
}

export interface ReorderVerifyResult {
  readonly checked: number;
  readonly findings: readonly ReorderVerifyFinding[];
  /** Columns anywhere in eos_ops.reorder_requests that could hold an external subject. */
  readonly uidShapedColumns: readonly string[];
  readonly unresolvedActors: number;
  readonly passed: boolean;
}

/**
 * VERIFY: structural proofs, never string comparison.
 *
 * An id is not a uid because its characters coincide with one, and a migrated Reorder is not corrupt
 * because an Employee id happens to spell the same as somebody's external subject. So nothing here
 * compares stored values to legacy uid strings. What is proved instead is that every identity column
 * RESOLVES through the authority that owns it, and that no column exists which could hold a uid.
 */
export async function verifyReorderObjectMigration(
  pool: Pool, tenantId: string,
): Promise<ReorderVerifyResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const findings: ReorderVerifyFinding[] = [];

    const checked = Number((await client.query(
      `SELECT count(*)::int AS n FROM eos_ops.reorder_requests WHERE tenant_id = $1 AND provenance = $2`,
      [tenantId, MIGRATED_PROVENANCE])).rows[0].n);

    // No column in this table is capable of holding an external subject: there is no uid column to
    // leak into. A structural fact about the schema, not a scan of values.
    const uidShaped = (await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'eos_ops' AND table_name = 'reorder_requests'
          AND (column_name LIKE '%uid%' OR column_name LIKE '%external_subject%'
               OR column_name LIKE '%user_id%')`)).rows.map((r) => r.column_name as string);
    if (uidShaped.length > 0) {
      findings.push({ code: "UID_SHAPED_COLUMN", count: uidShaped.length,
        detail: `columns capable of holding an external subject: ${uidShaped.join(", ")}` });
    }

    // Every non-null actor on a migrated row resolves to an ACTIVE membership of this tenant. The
    // foreign keys prove membership; this proves the membership is still active.
    for (const column of ["reviewed_by_principal_id", "purchasing_started_by_principal_id",
      "last_purchasing_update_by_principal_id", "cancelled_by_principal_id", "received_by_principal_id"]) {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM eos_ops.reorder_requests r
          WHERE r.tenant_id = $1 AND r.provenance = $2 AND r.${column} IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM eos_policy.tenant_memberships m
                             WHERE m.tenant_id = r.tenant_id AND m.principal_id = r.${column} AND m.status = 'active')`,
        [tenantId, MIGRATED_PROVENANCE]);
      if (rows[0].n > 0) {
        findings.push({ code: "ACTOR_NOT_ACTIVE_MEMBER", count: Number(rows[0].n),
          detail: `${column} names a Principal with no active membership in this tenant` });
      }
    }

    // requested_by carries no foreign key (its native writer passes an operator token, not a
    // Principal), so the migrated half is proved here explicitly instead.
    const requester = (await client.query(
      `SELECT count(*)::int AS n FROM eos_ops.reorder_requests r
        WHERE r.tenant_id = $1 AND r.provenance = $2 AND r.requested_by IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM eos_policy.principals p WHERE p.id = r.requested_by)`,
      [tenantId, MIGRATED_PROVENANCE])).rows[0].n;
    if (requester > 0) {
      findings.push({ code: "REQUESTER_NOT_A_PRINCIPAL", count: Number(requester),
        detail: "a migrated Reorder's requested_by does not name a Principal" });
    }

    const unresolvedActors = Number((await client.query(
      `SELECT count(*)::int AS n FROM eos_ops.reorder_requests
        WHERE tenant_id = $1 AND provenance = $2 AND requested_by IS NULL`,
      [tenantId, MIGRATED_PROVENANCE])).rows[0].n);

    // A migrated Reorder must still satisfy the lifecycle rules the schema states.
    const terminal = (await client.query(
      `SELECT count(*)::int AS n FROM eos_ops.reorder_requests
        WHERE tenant_id = $1 AND ((status = 'CANCELLED' AND cancelled_at IS NULL)
                               OR (status = 'RECEIVED' AND received_at IS NULL))`,
      [tenantId])).rows[0].n;
    if (terminal > 0) {
      findings.push({ code: "TERMINAL_WITHOUT_MOMENT", count: Number(terminal),
        detail: "a terminal Reorder does not state when it reached that state" });
    }

    await client.query("COMMIT");
    return Object.freeze({
      checked, findings: Object.freeze(findings), uidShapedColumns: Object.freeze(uidShaped),
      unresolvedActors, passed: findings.length === 0,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
