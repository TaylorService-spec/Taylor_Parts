// COORDINATED OPERATIONS — the PostgreSQL read seam. BUILT, PROVEN, NOT CUT OVER.
//
// ════════════════════ WHAT THIS CLOSES, AND WHAT IT DOES NOT ════════════════════
//
// `fulfillment.coordinatedVisit.read` is governed in PostgreSQL (migration 1761955200000: object_key
// `salesOrder`, action_key `readCoordinatedVisits`, action_kind BUSINESS_ACTION). What it governs is
// NOT: `listCoordinatedOperations` still reads the legacy `fieldops_wos` collection, recorded as
// COORDINATED_VISIT_RUNTIME_CUTOVER_BLOCKER in adminPolicy/migration/credEquivalence.ts.
//
// This file is the PostgreSQL side of that gap: the SAME projection, over
// `eos_ops.work_orders` + `eos_ops.work_order_sales_order_lines` + `eos_commercial.sales_orders`,
// authorized by the SAME governed capability resolved through the canonical PostgreSQL authority.
// It is NOT wired to any callable, transport or client. `listCoordinatedOperations` is unchanged,
// and the blocker stays open until a separate authorized slice switches it.
//
// ════════════════════ NO NEW AUTHORITY, NO NEW TABLE ════════════════════
//
// THE SALES ORDER IS THE COORDINATOR. There is no Dispatch, Visit, Job or WorkOrderGroup record in
// this platform, and the two Administration Objects that pretended otherwise (dispatchSchedule,
// notifications) were RETIRED by that same migration precisely because no such record exists. The
// coordinated visit is a DERIVED grouping of Work Orders that share a `sales_order_id`, computed by
// the pure, framework-independent projection in src/fulfillment/coordinatedVisit.ts. This read hands
// that projection rows; it does not persist a projection and it creates no table.
//
// ════════════════════ THE SHAPE IS THE LEGACY SHAPE, DELIBERATELY ════════════════════
//
// `CoordinatedOperationsPostgresResult` carries exactly the five keys the legacy result carries
// (status, workOrders, salesOrderReferences, skipped, truncated) and each Work Order carries exactly
// the seven the legacy projection carries. This is a PARITY SEAM, not a redesign: the North Star
// page is out of scope here, so nothing is added that the current surface cannot already render.
//
// Four behaviours differ from the legacy read, and each is a stated consequence of the target
// authority rather than a choice about the surface. They are listed in DELIBERATE_PARITY_DIFFERENCES
// below and asserted by test/coordinatedVisitPostgresParity.test.mjs — none of them is normalised
// away in code.
//
// ════════════════════ READ-ONLY, FAIL CLOSED ════════════════════
//
// Capability FIRST and on its own (contextualAuthorization.ts's ordering rule: evaluating record
// context first leaks business facts to a caller with no authority). Then ONE
// `REPEATABLE READ READ ONLY` snapshot, inside which the actor's active principal and active tenant
// membership are re-checked and the canonical capability ROW is re-checked — the same posture the
// Commercial read kernel takes, reproduced here rather than imported because
// test/commercialReadProjections.test.mjs pins that kernel's importers to the Commercial transport
// alone. Nothing in this file writes, and PostgreSQL itself refuses a write in the transaction.
import type { Pool, PoolClient } from "pg";

export type Queryable = Pick<PoolClient, "query">;

/**
 * THE CANONICAL CAPABILITY, as PostgreSQL holds it. Not a name this file chose: every field is
 * checked against `eos_policy.capabilities` inside the read, so a grant that survived while the
 * capability was re-homed, renamed or re-kinded cannot open this read.
 */
export const COORDINATED_VISIT_CAPABILITY = Object.freeze({
  key: "fulfillment.coordinatedVisit.read",
  objectKey: "salesOrder",
  actionKey: "readCoordinatedVisits",
  actionKind: "BUSINESS_ACTION",
} as const);

/**
 * The ACTIVE coordination queue, byte-for-byte the legacy read's list: ten of the eleven governed
 * statuses. CLOSED is the only exclusion (a closed Work Order is archived, not an open coordination
 * obligation) and CANCELLED is deliberately INCLUDED, because coordinatedVisit.ts's BLOCKED_STATUSES
 * treats a cancelled unit as ATTENTION and dropping it here would hide that signal.
 */
export const ACTIVE_COORDINATION_STATUSES: readonly string[] = Object.freeze([
  "CREATED", "READY_TO_DISPATCH", "SCHEDULED", "DISPATCHED", "ACCEPTED",
  "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS", "COMPLETED", "CANCELLED",
]);

/** Same bound as the legacy read, so a page holds the same number of Work Orders. */
export const DEFAULT_LIMIT = 300;
/** Same cap as the legacy read: how many DISTINCT anchors one page resolves a reference for. */
export const MAX_RESOLVED_SALES_ORDER_REFERENCES = 30;

/**
 * EVERY WAY THIS READ DIFFERS FROM THE LEGACY ONE, WRITTEN DOWN.
 *
 * Reported rather than normalised. A difference that is silently smoothed over is a difference
 * somebody discovers in production; each of these is a consequence of the target authority and is
 * asserted by the parity suite.
 */
export const DELIBERATE_PARITY_DIFFERENCES = Object.freeze([
  Object.freeze({
    id: "TENANT_SCOPED",
    legacy: "the fieldops_wos collection is global; the read has no tenant concept at all",
    postgres: "every row is filtered by the actor's resolved tenant_id",
    why: "eos_ops.work_orders is tenant-scoped by schema. A cross-tenant read is not parity, it is a leak.",
  }),
  Object.freeze({
    id: "ALLOCATED_QTY_UNAVAILABLE",
    legacy: "SalesOrderLineRef.allocatedQty is a number written at Work Order creation",
    postgres: "allocatedQty is null on every line ref",
    // Never 0. In the legacy model 0 means BACKORDERED/UNALLOCATED and seeds qtyPlanned = 0
    // (createServiceForSalesOrder.ts), so emitting 0 for "we cannot know" would assert a business
    // fact. PostgreSQL Commercial carries no allocated quantity: D2 execution is deferred by Owner
    // ruling, which is the same gap serviceFromSalesOrderBoundary.ts refuses on as
    // ALLOCATION_AUTHORITY_UNAVAILABLE.
    why: "PostgreSQL Commercial holds no allocated-quantity authority; 0 would be a fabricated business fact",
  }),
  Object.freeze({
    id: "LINE_REF_IDENTITY_IS_THE_LINE_NUMBER",
    legacy: "SalesOrderLineRef.lineId is the Firestore Sales Order line's own lineId string",
    postgres: "lineId is work_order_sales_order_lines.sales_order_line_id, which the governed writer sets to the commercial line_number as text",
    why: "eos_commercial.sales_order_lines is keyed (tenant_id, sales_order_id, line_number); buildServiceWorkOrderSeed already spells the reference that way",
  }),
  Object.freeze({
    id: "REFERENCE_RESOLUTION_DOES_NOT_FAIL_SOFT",
    legacy: "resolveSalesOrderReferences swallows a failure and returns {} so a label cannot take the page down",
    postgres: "the reference read is a statement in the same snapshot; a failure fails the whole read",
    why: "one database, one transaction — the independent-backend failure the legacy soft-fail exists for cannot occur, and simulating it would mean reporting a half-read page as whole",
  }),
] as const);

// ════════════════════ the projected shape ════════════════════

/**
 * One line of the anchoring Sales Order, as this projection carries it. The same keys the legacy
 * `SalesOrderLineRef` carries, with `allocatedQty` honestly null (see DELIBERATE_PARITY_DIFFERENCES).
 */
export interface CoordinatedSalesOrderLineRef {
  readonly ref: string;
  readonly kind: string;
  readonly orderedQty: number;
  readonly allocatedQty: null;
  readonly lineId: string;
}

/** Mirrors CoordinatedWorkOrderProjection in fulfillment/coordinatedVisitReadService.ts, field for field. */
export interface CoordinatedWorkOrderPostgresProjection {
  readonly id: string;
  readonly woNumber: string | null;
  readonly status: string | null;
  readonly customerId: string | null;
  readonly locationId: string | null;
  readonly salesOrderId: string;
  readonly salesOrderLineRefs: readonly CoordinatedSalesOrderLineRef[];
}

/** Mirrors CoordinatedOperationsReadResult, key for key. */
export interface CoordinatedOperationsPostgresResult {
  readonly status: "ready";
  readonly workOrders: readonly CoordinatedWorkOrderPostgresProjection[];
  /** salesOrderId -> SO-YYYY-######. An anchor whose reference cannot be resolved is ABSENT, never mapped to its own id. */
  readonly salesOrderReferences: Readonly<Record<string, string>>;
  /** Fetched rows that carried no sales_order_id, i.e. that are not coordinated at all. */
  readonly skipped: number;
  /** True when the active-status Work Order count exceeds `limit`. */
  readonly truncated: boolean;
}

// ════════════════════ refusals ════════════════════

export type CoordinatedVisitReadCategory = "FORBIDDEN" | "INVALID_INPUT" | "FAILED";

export class CoordinatedVisitReadError extends Error {
  constructor(readonly code: string, readonly category: CoordinatedVisitReadCategory, message: string) {
    super(message);
    this.name = "CoordinatedVisitReadError";
  }
}
const fail = (code: string, category: CoordinatedVisitReadCategory, message: string): never => {
  throw new CoordinatedVisitReadError(code, category, message);
};

/** Nothing else crosses the boundary: no SQL, no driver message, no connection detail. */
export function translateCoordinatedVisitReadError(err: unknown): CoordinatedVisitReadError {
  if (err instanceof CoordinatedVisitReadError) return err;
  return new CoordinatedVisitReadError("READ_FAILED", "FAILED", "the coordinated-operations read could not be completed");
}

// ════════════════════ the actor ════════════════════

/**
 * The resolved governed context a trusted boundary hands this read.
 *
 * `capabilities` is what `resolveOperationalContext` (eosOps/capabilityAuthority.ts) produced from
 * eos_policy — the SAME resolver the Operations and Commercial transports use. NOT permissionCatalog,
 * NOT caller.role, NOT operationalRoles, NOT a Firebase uid. `principalId` is an EOS Principal id.
 */
export interface CoordinatedVisitReadActor {
  readonly tenantId: string;
  readonly principalId: string;
  readonly capabilities: ReadonlySet<string>;
}

export interface CoordinatedVisitReadDeps {
  readonly pool: Pool;
}

function requireActor(actor: CoordinatedVisitReadActor): void {
  const isStated = (v: unknown): boolean => typeof v === "string" && v.trim() !== "";
  if (!actor || !isStated(actor.tenantId) || !isStated(actor.principalId)) {
    fail("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant and principal are required");
  }
  if (!(actor.capabilities instanceof Set)) {
    fail("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved capability set is required");
  }
  // CAPABILITY FIRST, ALWAYS, and on its own. A caller without it is told exactly that and nothing
  // else -- no record, no count, no tenant fact.
  if (!actor.capabilities.has(COORDINATED_VISIT_CAPABILITY.key)) {
    fail("CAPABILITY_REQUIRED", "FORBIDDEN", `this read requires ${COORDINATED_VISIT_CAPABILITY.key}`);
  }
}

/**
 * The capability must be the CANONICAL one, not merely a key someone holds a grant for.
 *
 * A grant row survives a re-home; the (object_key, action_key, action_kind) triple is what says the
 * act is still the governed one. BUSINESS_ACTION in particular must stay distinct from the Object's
 * generic READ verb, or holding this would start satisfying `salesOrder.read`.
 */
export async function assertCanonicalCapability(db: Queryable): Promise<void> {
  const { rows } = await db.query(
    `SELECT 1 FROM eos_policy.capabilities
      WHERE key = $1 AND object_key = $2 AND action_key = $3 AND action_kind = $4`,
    [COORDINATED_VISIT_CAPABILITY.key, COORDINATED_VISIT_CAPABILITY.objectKey,
      COORDINATED_VISIT_CAPABILITY.actionKey, COORDINATED_VISIT_CAPABILITY.actionKind],
  );
  if (rows.length === 0) {
    fail("CAPABILITY_NOT_CANONICAL", "FORBIDDEN",
      `${COORDINATED_VISIT_CAPABILITY.key} is not registered as ${COORDINATED_VISIT_CAPABILITY.objectKey}.${COORDINATED_VISIT_CAPABILITY.actionKey} (${COORDINATED_VISIT_CAPABILITY.actionKind})`);
  }
}

// ════════════════════ the read ════════════════════

const stated = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v : null;

/**
 * The page of active Work Orders, in the legacy read's own order.
 *
 * ORDERING. The legacy query states no `orderBy`, so the collection comes back in document-key
 * order: ascending, by UTF-8 bytes. `COLLATE "C"` is that ordering exactly; the database's own
 * collation is not, and would reorder ids that differ only in case or punctuation.
 *
 * BOUNDING. Filtered by STATUS ONLY, then non-coordinated rows are dropped in code — deliberately
 * NOT `AND sales_order_id IS NOT NULL`. PostgreSQL could filter that server-side where Firestore
 * could not without a composite index, but doing so would change WHICH Work Orders a page of `limit`
 * contains and would make `skipped` permanently 0. That is a page-composition change, and this seam
 * exists to prove parity, not to improve it. Moving the predicate into SQL is a post-cutover step.
 */
export async function readActiveCoordinatedWorkOrdersFromPostgres(
  db: Queryable,
  tenantId: string,
  limit: number = DEFAULT_LIMIT,
): Promise<CoordinatedOperationsPostgresResult> {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > DEFAULT_LIMIT) {
    fail("PAGE_SIZE_INVALID", "INVALID_INPUT", `limit must be a positive integer no greater than ${DEFAULT_LIMIT}`);
  }
  const { rows } = await db.query(
    `SELECT w.id, w.work_order_number, w.status::text AS status,
            w.customer_id, w.location_id, w.sales_order_id
       FROM eos_ops.work_orders w
      WHERE w.tenant_id = $1
        AND w.status::text = ANY($2::text[])
      ORDER BY w.id COLLATE "C" ASC
      LIMIT $3`,
    [tenantId, ACTIVE_COORDINATION_STATUSES as string[], limit + 1],
  );
  const truncated = rows.length > limit;
  const page = rows.slice(0, limit) as Record<string, unknown>[];

  const coordinated: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const r of page) {
    // The legacy rule, kept: a standalone Work Order is not this read's subject matter at all.
    if (stated(r.sales_order_id)) coordinated.push(r);
    else skipped += 1;
  }

  const lineRefs = await readLineRefs(db, tenantId, coordinated.map((r) => String(r.id)));
  const workOrders: CoordinatedWorkOrderPostgresProjection[] = coordinated.map((r) => Object.freeze({
    id: String(r.id),
    woNumber: stated(r.work_order_number),
    status: stated(r.status),
    customerId: stated(r.customer_id),
    locationId: stated(r.location_id),
    salesOrderId: String(r.sales_order_id),
    salesOrderLineRefs: lineRefs.get(`${String(r.id)}\u0000${String(r.sales_order_id)}`) ?? Object.freeze([]),
  }));

  return Object.freeze({
    status: "ready" as const,
    workOrders: Object.freeze(workOrders),
    salesOrderReferences: await resolveSalesOrderReferencesFromPostgres(db, tenantId, workOrders.map((w) => w.salesOrderId)),
    skipped,
    truncated,
  });
}

/**
 * The anchoring Sales Order's lines, per Work Order.
 *
 * `work_order_sales_order_lines` is the governed relationship — a child table, because a
 * relationship with its own cardinality is not a JSON array no key can check. It carries the
 * IDENTITY of each referenced line and nothing else, so `kind`, `ref` and `orderedQty` come from
 * `eos_commercial.sales_order_lines`, joined on the line number the governed writer records.
 *
 * A row is DROPPED when it does not resolve to a commercial line — exactly what the legacy
 * `projectLineRef` does with a ref that carries no `ref`/`kind`: drop the line, keep the document.
 * Rows naming a DIFFERENT Sales Order than the Work Order's own anchor are not part of this visit
 * and are not carried; the join below binds each list to (work order, anchor).
 */
async function readLineRefs(
  db: Queryable,
  tenantId: string,
  workOrderIds: readonly string[],
): Promise<Map<string, readonly CoordinatedSalesOrderLineRef[]>> {
  const out = new Map<string, CoordinatedSalesOrderLineRef[]>();
  if (workOrderIds.length === 0) return out;
  const { rows } = await db.query(
    `SELECT l.work_order_id, l.sales_order_id, l.sales_order_line_id,
            c.kind::text AS kind, c.ref, c.ordered_qty
       FROM eos_ops.work_order_sales_order_lines l
       JOIN eos_ops.work_orders w
         ON w.tenant_id = l.tenant_id AND w.id = l.work_order_id
        AND w.sales_order_id = l.sales_order_id
       LEFT JOIN eos_commercial.sales_order_lines c
         ON c.tenant_id = l.tenant_id AND c.sales_order_id = l.sales_order_id
        AND c.line_number::text = l.sales_order_line_id
      WHERE l.tenant_id = $1 AND l.work_order_id = ANY($2::text[])
      ORDER BY l.work_order_id COLLATE "C", l.sales_order_id COLLATE "C", l.sales_order_line_id COLLATE "C"`,
    [tenantId, workOrderIds as string[]],
  );
  for (const raw of rows as Record<string, unknown>[]) {
    const ref = stated(raw.ref);
    const kind = stated(raw.kind);
    if (!ref || !kind) continue; // unresolvable line identity -- dropped, never fabricated
    const key = `${String(raw.work_order_id)}\u0000${String(raw.sales_order_id)}`;
    const list = out.get(key) ?? [];
    list.push(Object.freeze({
      ref,
      kind,
      orderedQty: Number(raw.ordered_qty),
      allocatedQty: null,
      lineId: String(raw.sales_order_line_id),
    }));
    out.set(key, list);
  }
  for (const [k, v] of out) out.set(k, Object.freeze(v) as CoordinatedSalesOrderLineRef[]);
  return out;
}

/**
 * SO-YYYY-###### per DISTINCT anchoring Sales Order, capped.
 *
 * DISTINCT because one coordinated visit is many Work Orders against ONE order. ABSENT, not null,
 * when it cannot be resolved: a missing entry is what makes the surface render its truthful fallback
 * instead of printing a routing key.
 */
export async function resolveSalesOrderReferencesFromPostgres(
  db: Queryable,
  tenantId: string,
  salesOrderIds: readonly string[],
): Promise<Readonly<Record<string, string>>> {
  const distinct = [...new Set((salesOrderIds ?? []).filter((v) => stated(v) !== null))]
    .slice(0, MAX_RESOLVED_SALES_ORDER_REFERENCES);
  if (distinct.length === 0) return Object.freeze({});
  const { rows } = await db.query(
    `SELECT id, sales_order_number FROM eos_commercial.sales_orders
      WHERE tenant_id = $1 AND id = ANY($2::text[])`,
    [tenantId, distinct],
  );
  const out: Record<string, string> = {};
  for (const r of rows as Record<string, unknown>[]) {
    const reference = stated(r.sales_order_number);
    if (reference) out[String(r.id)] = reference;
  }
  return Object.freeze(out);
}

/**
 * THE GOVERNED ENTRY POINT. Capability -> snapshot -> active principal + active membership ->
 * canonical capability row -> the read. Refusals before `connect` touch no database.
 *
 * Takes NO caller payload, exactly as `listCoordinatedOperations` takes none: the caller's authorized
 * scope resolves entirely server-side and there is nothing here for a client to parameterise.
 */
export async function readCoordinatedOperations(
  deps: CoordinatedVisitReadDeps,
  actor: CoordinatedVisitReadActor,
): Promise<CoordinatedOperationsPostgresResult> {
  let client: PoolClient | undefined;
  try {
    requireActor(actor);
    client = await deps.pool.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const member = await client.query(
      `SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
        WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`,
      [actor.tenantId, actor.principalId],
    );
    if (member.rows.length === 0) {
      fail("ACTOR_NOT_TENANT_MEMBER", "FORBIDDEN", "the principal is not an active member of this tenant");
    }
    await assertCanonicalCapability(client);
    const result = await readActiveCoordinatedWorkOrdersFromPostgres(client, actor.tenantId);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    throw translateCoordinatedVisitReadError(err);
  } finally {
    client?.release();
  }
}
