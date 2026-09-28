// GOVERNED RECORD READ — the server-side replacement for client-direct Firestore list reads (Pass 11 Fix Wave 1).
//
// ════════════════════ WHY ════════════════════
//
// Work Orders, Customers, Warehouses, Transfers, Purchase Orders, Reorder Requests, the Parts catalogue and the
// inventory ledger were read by the client straight from Firestore, gated by Rules helpers over
// `users/{uid}.role` / `employees/{id}.operationalRoles`. Rules cannot ask PostgreSQL, so no Security Role granted
// in Administration could ever open one of those reads. This callable reads the same collections with the Admin SDK
// and authorizes EVERY row through the governed chain:
//
//   Principal (Firebase-verified uid -> eos_policy Principal)
//     -> governed capability (the surface's ONE read capability, from Administration)
//     -> condition (capability_grant_conditions, evaluated per record by authorizeEntitledAction)
//     -> operational scope / work eligibility (PostgreSQL context reader)
//     -> record relationship (for RECORD_ASSIGNMENT: the record's own assignee, below)
//     -> domain prerequisite (the surface is a registered, bounded read)
//
// ════════════════════ A CLOSED SURFACE REGISTRY, NOT A TABLE PROXY ════════════════════
//
// The caller names a SURFACE, never a collection. Each surface binds exactly one collection to exactly one governed
// read capability. There is no way to name a collection this file does not list, and no write of any kind.
//
// ════════════════════ CONDITIONS ARE HONOURED, NEVER WIDENED ════════════════════
//
//   - A caller holding the capability UNCONDITIONALLY (the flat set) reads the bounded query.
//   - A caller holding it ONLY through a conditioned or scoped grant gets exactly the rows the entitled decision
//     admits, one record at a time. Nothing is admitted on a condition this runtime cannot prove: a scoped holding
//     has no business context here and refuses; an unsupported predicate refuses.
//   - Anyone else is refused.
//
// RECORD_ASSIGNMENT on a Work Order asks "is the caller's Employee the record's assignee". The caller's Employee comes
// ONLY from the governed Principal link (eos_policy.employee_principal_links) -- never `users/{uid}.technicianId`,
// never a technician id that happens to equal a uid. The RECORD's assignee is the Employee its assigned technician
// profile explicitly names (`fieldops_technicians/{assignedTechId}.employeeId`). A caller with no linked Employee, or
// a technician profile with no Employee, is NOT_ASSIGNED: technician reads fail closed until the assignment identity
// is resolved, and there is no tenant-wide fallback.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, Timestamp, DocumentReference, GeoPoint, FieldPath } from "firebase-admin/firestore";
import type { Firestore, Query, WhereFilterOp, DocumentData } from "firebase-admin/firestore";
import { authorizeOperationalAction } from "../eosOps/entitledActionAuthority";
import type { ContextualReader, RecordContext } from "../eosOps/contextualAuthorization";
import {
  defaultGovernedAccessResolver,
  isGovernedRuntimeAuthorityActive,
  type GovernedAccessResolver,
} from "./governedRuntimeAuthority";

export interface GovernedReadSurface {
  readonly collection: string;
  readonly capability: string;
  /** The governed record kind a RECORD_ASSIGNMENT condition on this capability refers to, if any. */
  readonly recordKind?: RecordContext["recordKind"];
}

/** THE CLOSED REGISTRY. One collection, one governed read capability, per surface. */
export const GOVERNED_READ_SURFACES: Readonly<Record<string, GovernedReadSurface>> = Object.freeze({
  workOrders: Object.freeze({ collection: "fieldops_wos", capability: "workOrder.record.read", recordKind: "workOrder" }),
  accounts: Object.freeze({ collection: "accounts", capability: "customer.record.read" }),
  warehouses: Object.freeze({ collection: "warehouses", capability: "warehouse.record.read" }),
  transferOrders: Object.freeze({ collection: "transfer_orders", capability: "warehouse.transferOrder.read" }),
  purchaseOrders: Object.freeze({ collection: "reorder_purchase_orders", capability: "reorder.purchaseOrder.read" }),
  reorderRequests: Object.freeze({ collection: "reorder_requests", capability: "reorder.request.read", recordKind: "reorderRequest" }),
  parts: Object.freeze({ collection: "parts", capability: "inventory.catalog.read" }),
  inventoryTransactions: Object.freeze({ collection: "inventory_transactions", capability: "inventory.transaction.read" }),
});

const OPERATORS: Readonly<Record<string, WhereFilterOp>> = Object.freeze({
  EQUALS: "==", NOT_EQUALS: "!=", IN: "in", GREATER_THAN: ">", GREATER_OR_EQUAL: ">=",
  LESS_THAN: "<", LESS_OR_EQUAL: "<=", ARRAY_CONTAINS: "array-contains", ARRAY_CONTAINS_ANY: "array-contains-any",
});
const FIELD_ID = /^(__name__|[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*)$/;
export const MAX_GOVERNED_READ_LIMIT = 500;
const MAX_FILTERS = 10;

export interface GovernedReadInput {
  readonly surface: string;
  readonly filters?: readonly { fieldId: string; operator: string; value: unknown }[];
  readonly sort?: readonly { fieldId: string; direction?: string }[];
  readonly limit: number;
  /** The id of the last row of the previous page. Resumed server-side; never a client-built cursor. */
  readonly afterId?: string | null;
}

export interface GovernedReadResult {
  readonly surface: string;
  /** Document id and stored data kept SEPARATE, exactly as a direct Firestore read keeps them. */
  readonly rows: readonly { readonly id: string; readonly data: Record<string, unknown> }[];
  readonly truncated: boolean;
  /** How the rows were admitted: every row of the query (FLAT) or per record through a condition (CONDITIONED). */
  readonly admission: "FLAT" | "CONDITIONED";
  /** Rows the query returned that the condition did not admit. Always 0 for FLAT. */
  readonly withheld: number;
}

export class GovernedReadRefusal extends Error {
  constructor(readonly code: "invalid-argument" | "permission-denied" | "failed-precondition" | "unavailable", message: string) {
    super(message);
  }
}

/** Validate and normalize the request. Everything a client sends is checked here; nothing reaches a query raw. */
export function parseGovernedReadInput(data: unknown): GovernedReadInput {
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d.surface !== "string" || !Object.prototype.hasOwnProperty.call(GOVERNED_READ_SURFACES, d.surface)) {
    throw new GovernedReadRefusal("invalid-argument", "surface must name a governed read surface");
  }
  const limit = d.limit;
  if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > MAX_GOVERNED_READ_LIMIT) {
    throw new GovernedReadRefusal("invalid-argument", `limit must be an integer 1..${MAX_GOVERNED_READ_LIMIT}`);
  }
  const filters = Array.isArray(d.filters) ? d.filters : [];
  if (filters.length > MAX_FILTERS) throw new GovernedReadRefusal("invalid-argument", "too many filters");
  for (const f of filters as { fieldId?: unknown; operator?: unknown }[]) {
    if (typeof f?.fieldId !== "string" || !FIELD_ID.test(f.fieldId)) throw new GovernedReadRefusal("invalid-argument", "bad filter field");
    if (typeof f.operator !== "string" || !OPERATORS[f.operator]) throw new GovernedReadRefusal("invalid-argument", "bad filter operator");
  }
  const sort = Array.isArray(d.sort) ? d.sort : [];
  if (sort.length > 3) throw new GovernedReadRefusal("invalid-argument", "too many sort clauses");
  for (const s of sort as { fieldId?: unknown; direction?: unknown }[]) {
    if (typeof s?.fieldId !== "string" || !FIELD_ID.test(s.fieldId)) throw new GovernedReadRefusal("invalid-argument", "bad sort field");
    if (s.direction !== undefined && s.direction !== "ASC" && s.direction !== "DESC") throw new GovernedReadRefusal("invalid-argument", "bad sort direction");
  }
  const afterId = d.afterId;
  if (afterId !== undefined && afterId !== null && (typeof afterId !== "string" || afterId.length === 0 || afterId.includes("/"))) {
    throw new GovernedReadRefusal("invalid-argument", "bad cursor");
  }
  return Object.freeze({
    surface: d.surface,
    filters: filters as GovernedReadInput["filters"],
    sort: sort as GovernedReadInput["sort"],
    limit: limit as number,
    afterId: (afterId as string | null | undefined) ?? null,
  });
}

/** Callable-safe values: Timestamps become a tagged ISO string the client rehydrates; references become paths. */
export function toWire(value: unknown): unknown {
  if (value instanceof Timestamp) return { __timestamp: value.toDate().toISOString() };
  if (value instanceof DocumentReference) return { __ref: value.path };
  if (value instanceof GeoPoint) return { latitude: value.latitude, longitude: value.longitude };
  if (Array.isArray(value)) return value.map(toWire);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toWire(v);
    return out;
  }
  return value;
}

export interface GovernedReadDeps {
  readonly db: Firestore;
  readonly governed: GovernedAccessResolver;
  /** Derived from the runtime's project identity in production; injected only by tests. */
  readonly active: boolean;
}

/**
 * The record-relationship half of RECORD_ASSIGNMENT for Firestore-held records. Everything else (Employee link,
 * Work Eligibility, Operational Scope) is the PostgreSQL reader, unchanged.
 */
export function withFirestoreAssignment(
  base: ContextualReader,
  db: Firestore,
  surface: GovernedReadSurface,
  rowsById: ReadonlyMap<string, DocumentData>,
): ContextualReader {
  const technicianEmployee = new Map<string, Promise<string | null>>();
  const employeeOfTechnician = (techId: string) => {
    let pending = technicianEmployee.get(techId);
    if (!pending) {
      pending = db.collection("fieldops_technicians").doc(techId).get().then((snap) => {
        const employeeId = snap.exists ? snap.get("employeeId") : null;
        return typeof employeeId === "string" && employeeId.length > 0 ? employeeId : null;
      });
      technicianEmployee.set(techId, pending);
    }
    return pending;
  };
  return {
    linkedEmployeeId: (tenantId, principalId) => base.linkedEmployeeId(tenantId, principalId),
    hasWorkEligibility: (tenantId, employeeId, code) => base.hasWorkEligibility(tenantId, employeeId, code),
    hasOperationalScope: (tenantId, employeeId, scopeType, scopeId) =>
      base.hasOperationalScope(tenantId, employeeId, scopeType, scopeId),
    async isAssignedEmployee(_tenantId, recordKind, recordId, employeeId) {
      // Only the surface's own record kind, and only a row this request actually read.
      if (!surface.recordKind || recordKind !== surface.recordKind || recordKind !== "workOrder") return false;
      const row = rowsById.get(recordId);
      const techId = row?.assignedTechId;
      if (typeof techId !== "string" || techId.length === 0 || techId.includes("/")) return false;
      const assignee = await employeeOfTechnician(techId);
      return assignee !== null && assignee === employeeId;
    },
  };
}

/** The whole read, independent of the callable wrapper. */
export async function readGovernedRecords(
  deps: GovernedReadDeps,
  firebaseUid: string,
  input: GovernedReadInput,
): Promise<GovernedReadResult> {
  if (!deps.active) {
    throw new GovernedReadRefusal("failed-precondition", "governed record reads are not active in this environment");
  }
  const surface = GOVERNED_READ_SURFACES[input.surface];
  const access = await deps.governed(firebaseUid);
  if (access.status === "UNAVAILABLE") throw new GovernedReadRefusal("unavailable", "access could not be resolved");
  if (access.status !== "RESOLVED") throw new GovernedReadRefusal("permission-denied", "not an EOS principal");

  const { actor } = access;
  const flat = actor.capabilities.has(surface.capability);
  const conditioned = !flat && (
    (actor.conditionallyHeld?.has(surface.capability) ?? false)
    || (actor.scopedHeld ?? []).some((h) => h.capabilityKey === surface.capability));
  if (!flat && !conditioned) {
    throw new GovernedReadRefusal("permission-denied", "You are not authorized to read these records.");
  }

  let query: Query = deps.db.collection(surface.collection);
  const fieldOf = (fieldId: string) => (fieldId === "__name__" ? FieldPath.documentId() : fieldId);
  for (const f of input.filters ?? []) query = query.where(fieldOf(f.fieldId), OPERATORS[f.operator], f.value);
  for (const s of input.sort ?? []) query = query.orderBy(fieldOf(s.fieldId), s.direction === "DESC" ? "desc" : "asc");
  if (input.afterId) {
    const cursor = await deps.db.collection(surface.collection).doc(input.afterId).get();
    if (!cursor.exists) throw new GovernedReadRefusal("invalid-argument", "cursor record not found");
    query = query.startAfter(cursor);
  }
  const snap = await query.limit(input.limit + 1).get();
  const truncated = snap.docs.length > input.limit;
  const docs = snap.docs.slice(0, input.limit);

  if (flat) {
    return Object.freeze({
      surface: input.surface,
      rows: docs.map((d) => ({ id: d.id, data: toWire(d.data()) as Record<string, unknown> })),
      truncated,
      admission: "FLAT" as const,
      withheld: 0,
    });
  }

  // CONDITIONED: each record through the entitled decision. A refusal of any kind withholds the row.
  const rowsById = new Map(docs.map((d) => [d.id, d.data()]));
  const reader = withFirestoreAssignment(access.reader, deps.db, surface, rowsById);
  const admitted: { id: string; data: Record<string, unknown> }[] = [];
  let withheld = 0;
  for (const d of docs) {
    const decision = await authorizeOperationalAction(reader, actor, { capabilityKey: surface.capability, recordId: d.id });
    if (decision.allowed) admitted.push({ id: d.id, data: toWire(d.data()) as Record<string, unknown> });
    else withheld += 1;
  }
  return Object.freeze({ surface: input.surface, rows: admitted, truncated, admission: "CONDITIONED" as const, withheld });
}

export const readGovernedRecordsCallable = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  try {
    const input = parseGovernedReadInput(request.data);
    return await readGovernedRecords(
      { db: getFirestore(), governed: defaultGovernedAccessResolver(), active: isGovernedRuntimeAuthorityActive() },
      request.auth.uid,
      input,
    );
  } catch (err) {
    if (err instanceof GovernedReadRefusal) throw new HttpsError(err.code, err.message);
    console.error("[readGovernedRecords] read failed", (err as Error)?.name ?? "Error");
    throw new HttpsError("internal", "The read is temporarily unavailable.");
  }
});
