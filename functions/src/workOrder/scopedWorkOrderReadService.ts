// Work Orders — the ONE scoped read seam.
//
// ============================ WHY THIS IS NOT A GOVERNED LIST SOURCE ============================
//
// Every entry in governedReadRegistry.ts is a GLOBAL capability check: hold the capability, get the
// rows. Work Orders are not like that and never were. `firestore.rules` admitted two populations by
// two different predicates:
//
//   GLOBAL   isAdminOrDispatcher()
//   SELF     isTechnician() && userData().technicianId == resource.data.assignedTechId
//
// Registering `fieldops_wos` as an ordinary source would have to pick one. Picking global widens the
// read to every technician; picking self narrows it so a dispatcher loses rows. Neither is the
// behaviour being migrated, so this is a dedicated service instead -- the smallest one that can
// replace the existing read family and nothing more.
//
// ============================ WHAT THE CALLER MAY SAY ============================
//
// A registered MODE token, and values for that mode's declared parameters. Never a collection, a
// field, an operator, an orderBy, a raw cursor -- and never a technician id. The assignment
// predicate is not an input; the server derives it from request.auth.uid and forces it in.
//
// ============================ AUTHORIZATION ORDER, AND WHY IT IS THIS ORDER ============================
//
// Global is resolved FIRST, self second. That is load-bearing rather than stylistic: admin holds the
// entire catalogue by derivation (ADMIN_ALL_PERMISSIONS spreads it), so an admin holds
// `workOrder.assigned.read` too. Checking self first would scope an administrator to their own
// technician identity -- which they almost certainly do not have -- and return nothing, with no
// error. Global first means the broader authority wins when a principal genuinely holds both.
import { getFirestore, FieldPath, type Firestore } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";

const WORK_ORDERS = "fieldops_wos";
const USERS = "users";

export const WORK_ORDER_READ_GLOBAL = "workOrder.read";
export const WORK_ORDER_READ_ASSIGNED = "workOrder.assigned.read";

/** The scan ceiling for the aggregate. An unbounded count is a full collection scan server-side. */
export const WORK_ORDER_COUNT_CEILING = 500;

export class InvalidInputError extends Error {}
export class UnauthorizedActorError extends Error {}

export interface ScopedWorkOrderDeps {
  readonly db?: Firestore;
  /** Injected for tests. Production resolves through the trusted effective-access feed. */
  readonly resolveAccess?: (uid: string, ids: readonly string[]) => Promise<Record<string, boolean>>;
}

// ============================ THE QUERY MODES ============================
//
// One entry per shape a MEASURED consumer actually issues. Adding a mode is adding a line here, and
// a mode nothing calls is a query nobody proved has an index -- so the list is exactly the census:
//
//   accountOpen        domain/accountWorkOrders.js  customerId == X AND status IN [...]
//   accountRecent      domain/accountWorkOrders.js  customerId == X, createdAt DESC, bounded
//   accountScheduled   domain/accountWorkOrders.js  customerId == X AND status == SCHEDULED
//   openDemand         hooks/usePartWorkOrderDemand.js  status IN open, createdAt DESC, bounded
//   byEquipment        hooks/useEquipment.js        equipmentId == X
//   search             hooks/useWorkOrderSearch.js  woNumber prefix range, woNumber ASC
//   index              the metadata workOrder list  optional status / customerId, sortable set
//
// `params` names each accepted parameter and the clause the SERVER builds from it. `orderBy` is
// fixed per mode; `allowedSorts` exists only for `index`, which is the one surface offering a
// column-header sort.
interface ModeParam {
  readonly field: string;
  readonly op: FirebaseFirestore.WhereFilterOp | "prefix";
  readonly required?: boolean;
}

interface Mode {
  readonly params: Readonly<Record<string, ModeParam>>;
  readonly orderBy: readonly [string, "asc" | "desc"];
  readonly allowedSorts?: Readonly<Record<string, readonly [string, "asc" | "desc"]>>;
  readonly defaultSort?: string;
  readonly maxPageSize: number;
}

export const WORK_ORDER_MODES: Readonly<Record<string, Mode>> = Object.freeze({
  accountOpen: Object.freeze({
    params: Object.freeze({
      accountId: Object.freeze({ field: "customerId", op: "==" as const, required: true }),
      statuses: Object.freeze({ field: "status", op: "in" as const, required: true }),
    }),
    orderBy: Object.freeze(["createdAt", "desc"] as const),
    maxPageSize: 200,
  }),
  accountRecent: Object.freeze({
    params: Object.freeze({
      accountId: Object.freeze({ field: "customerId", op: "==" as const, required: true }),
    }),
    orderBy: Object.freeze(["createdAt", "desc"] as const),
    maxPageSize: 200,
  }),
  accountScheduled: Object.freeze({
    params: Object.freeze({
      accountId: Object.freeze({ field: "customerId", op: "==" as const, required: true }),
      // The status is FIXED by the mode, not supplied: this mode means "scheduled work for this
      // account". A caller that could choose the status would have `accountOpen` with extra steps.
    }),
    orderBy: Object.freeze(["createdAt", "desc"] as const),
    maxPageSize: 200,
  }),
  openDemand: Object.freeze({
    params: Object.freeze({
      statuses: Object.freeze({ field: "status", op: "in" as const, required: true }),
    }),
    orderBy: Object.freeze(["createdAt", "desc"] as const),
    maxPageSize: 500,
  }),
  byEquipment: Object.freeze({
    params: Object.freeze({
      equipmentId: Object.freeze({ field: "equipmentId", op: "==" as const, required: true }),
    }),
    orderBy: Object.freeze(["createdAt", "desc"] as const),
    maxPageSize: 200,
  }),
  search: Object.freeze({
    params: Object.freeze({
      // The server builds BOTH bounds of the range. The caller holds one term, never two
      // open-ended comparison operators.
      term: Object.freeze({ field: "woNumber", op: "prefix" as const, required: true }),
    }),
    orderBy: Object.freeze(["woNumber", "asc"] as const),
    maxPageSize: 200,
  }),
  index: Object.freeze({
    params: Object.freeze({
      status: Object.freeze({ field: "status", op: "==" as const }),
      statusIn: Object.freeze({ field: "status", op: "in" as const }),
      customerId: Object.freeze({ field: "customerId", op: "==" as const }),
    }),
    orderBy: Object.freeze(["createdAt", "desc"] as const),
    allowedSorts: Object.freeze({
      woNumberAsc: Object.freeze(["woNumber", "asc"] as const),
      woNumberDesc: Object.freeze(["woNumber", "desc"] as const),
      statusAsc: Object.freeze(["status", "asc"] as const),
      statusDesc: Object.freeze(["status", "desc"] as const),
      createdAtAsc: Object.freeze(["createdAt", "asc"] as const),
      createdAtDesc: Object.freeze(["createdAt", "desc"] as const),
      scheduledStartAsc: Object.freeze(["scheduledStart", "asc"] as const),
      scheduledStartDesc: Object.freeze(["scheduledStart", "desc"] as const),
    }),
    defaultSort: "createdAtDesc",
    maxPageSize: 200,
  }),
});

const ACCOUNT_SCHEDULED_STATUS = "SCHEDULED";

export type WorkOrderScope =
  | { readonly kind: "GLOBAL" }
  | { readonly kind: "ASSIGNED"; readonly technicianId: string };

/**
 * Resolve WHAT THIS PRINCIPAL MAY SEE, before any business data is touched.
 *
 * Returns the scope or throws. Never returns a "maybe" a caller could ignore.
 *
 * THE TECHNICIAN IDENTITY IS RESOLVED HERE, SERVER-SIDE, from request.auth.uid. The browser does
 * not send it and could not: nothing in any input shape accepts one.
 *
 * TRANSITIONAL PLUMBING, recorded as such: the uid -> technician mapping still lives on
 * `users/{uid}.technicianId`, the same field the retired Rules predicate read. It is encapsulated
 * HERE so no client ever touches it, and so the day EOS carries the linkage natively this function
 * is the only thing that changes. It is not authority -- the CAPABILITY is; this only answers
 * "which technician is this principal" once that capability has already been established.
 */
export async function resolveWorkOrderScope(
  actorUid: string,
  deps: ScopedWorkOrderDeps = {},
): Promise<WorkOrderScope> {
  if (typeof actorUid !== "string" || !actorUid) throw new InvalidInputError("actorUid is required");
  const db = deps.db ?? getFirestore();

  const resolve =
    deps.resolveAccess ??
    (async (uid: string, ids: readonly string[]) => {
      const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [...ids] });
      return decisions as Record<string, boolean>;
    });

  let decisions: Record<string, boolean>;
  try {
    decisions = await resolve(actorUid, [WORK_ORDER_READ_GLOBAL, WORK_ORDER_READ_ASSIGNED]);
  } catch (err) {
    // FAIL-CLOSED. A resolver that throws is a denial, never an allow -- a capability check whose
    // error path lets the read through is worse than no check, because it looks like one.
    console.error("[workOrder] capability resolution failed", err);
    throw new UnauthorizedActorError("authorization could not be resolved");
  }

  // GLOBAL FIRST -- see the header. Admin derives the whole catalogue and therefore holds the
  // assigned capability too; resolving self first would scope an administrator to a technician
  // identity they do not have and silently return nothing.
  if (decisions[WORK_ORDER_READ_GLOBAL] === true) return { kind: "GLOBAL" };

  if (decisions[WORK_ORDER_READ_ASSIGNED] === true) {
    const snap = await db.collection(USERS).doc(actorUid).get();
    const technicianId = snap.exists ? (snap.data()?.technicianId as string | undefined) : undefined;
    // A principal holding the assigned capability with NO technician linkage sees nothing, and is
    // told so. Falling back to an unscoped read here would be the entire defect this seam prevents.
    if (typeof technicianId !== "string" || technicianId === "") {
      throw new UnauthorizedActorError("no technician identity is linked to this principal");
    }
    return { kind: "ASSIGNED", technicianId };
  }

  throw new UnauthorizedActorError("actor may not read work orders");
}

interface Clause {
  readonly field: string | FirebaseFirestore.FieldPath;
  readonly op: FirebaseFirestore.WhereFilterOp;
  readonly value: unknown;
}

/** Turn a mode's declared parameters plus the caller's values into clauses the registry chose. */
function resolveClauses(modeId: string, mode: Mode, supplied: Record<string, unknown>): Clause[] {
  for (const name of Object.keys(supplied)) {
    if (!mode.params[name]) {
      const allowed = Object.keys(mode.params).join(", ") || "none";
      throw new InvalidInputError(`"${name}" is not a parameter of mode "${modeId}" (allowed: ${allowed})`);
    }
  }
  const out: Clause[] = [];
  for (const [name, spec] of Object.entries(mode.params)) {
    const value = supplied[name];
    if (value === undefined || value === null) {
      if (spec.required) throw new InvalidInputError(`"${name}" is required by mode "${modeId}"`);
      continue;
    }
    if (spec.op === "in") {
      if (!Array.isArray(value) || value.length === 0 || value.length > 30) {
        throw new InvalidInputError(`"${name}" needs an array of 1..30 values`);
      }
      out.push({ field: spec.field, op: "in", value });
      continue;
    }
    if (spec.op === "prefix") {
      if (typeof value !== "string" || value === "") {
        throw new InvalidInputError(`"${name}" needs a non-empty string`);
      }
      // \uf8ff is the standard high sentinel. Written as an ESCAPE, never the literal character:
      // the literal is invisible in most editors and was lost once in this repository, silently
      // collapsing a starts-with range to exact equality.
      out.push({ field: spec.field, op: ">=", value });
      out.push({ field: spec.field, op: "<=", value: `${value}\uf8ff` });
      continue;
    }
    out.push({ field: spec.field, op: spec.op as FirebaseFirestore.WhereFilterOp, value });
  }
  if (modeId === "accountScheduled") {
    out.push({ field: "status", op: "==", value: ACCOUNT_SCHEDULED_STATUS });
  }
  return out;
}

function resolveMode(modeId: unknown): { id: string; mode: Mode } {
  if (typeof modeId !== "string" || !Object.prototype.hasOwnProperty.call(WORK_ORDER_MODES, modeId)) {
    throw new InvalidInputError(`"${String(modeId)}" is not a work order query mode`);
  }
  return { id: modeId, mode: WORK_ORDER_MODES[modeId] };
}

function resolveSort(mode: Mode, sortKey?: string): readonly [string, "asc" | "desc"] {
  if (!sortKey) {
    if (mode.allowedSorts && mode.defaultSort) return mode.allowedSorts[mode.defaultSort];
    return mode.orderBy;
  }
  if (!mode.allowedSorts) throw new InvalidInputError("this mode does not offer a choice of sort");
  if (!Object.prototype.hasOwnProperty.call(mode.allowedSorts, sortKey)) {
    throw new InvalidInputError(`"${sortKey}" is not an offered sort (allowed: ${Object.keys(mode.allowedSorts).join(", ")})`);
  }
  return mode.allowedSorts[sortKey];
}

/**
 * Apply the scope. THE ONE PLACE the assignment predicate is added.
 *
 * A technician's query is INTERSECTED with their own assignment, never replaced by it and never
 * widened out of it: "work orders for equipment X" becomes "work orders for equipment X that are
 * also assigned to me", which is exactly what the retired Rules produced. Turning it into "all work
 * orders for equipment X" would widen a technician's view, and turning it into "all work assigned
 * to me" would answer a different question.
 */
function applyScope(query: FirebaseFirestore.Query, scope: WorkOrderScope): FirebaseFirestore.Query {
  if (scope.kind === "GLOBAL") return query;
  return query.where("assignedTechId", "==", scope.technicianId);
}

function buildQuery(
  db: Firestore,
  clauses: readonly Clause[],
  scope: WorkOrderScope,
): FirebaseFirestore.Query {
  let q = db.collection(WORK_ORDERS) as FirebaseFirestore.Query;
  for (const c of clauses) q = q.where(c.field, c.op, c.value);
  return applyScope(q, scope);
}

export interface ReadScopedWorkOrdersInput {
  readonly actorUid: string;
  readonly mode: string;
  readonly params?: Record<string, unknown>;
  readonly sortKey?: string;
  readonly pageSize?: number;
}

export interface ScopedWorkOrderPage {
  readonly items: readonly Record<string, unknown>[];
  readonly hasMore: boolean;
  readonly scope: "GLOBAL" | "ASSIGNED";
}

export async function readScopedWorkOrders(
  input: ReadScopedWorkOrdersInput,
  deps: ScopedWorkOrderDeps = {},
): Promise<ScopedWorkOrderPage> {
  const db = deps.db ?? getFirestore();
  const { id, mode } = resolveMode(input.mode);

  // AUTHORIZATION BEFORE DATA. resolveWorkOrderScope reads only `users/{uid}` (and only when the
  // principal holds the assigned capability); an unauthorized actor throws here, having touched
  // fieldops_wos zero times.
  const scope = await resolveWorkOrderScope(input.actorUid, deps);

  const clauses = resolveClauses(id, mode, (input.params ?? {}) as Record<string, unknown>);
  let pageSize = 50;
  if (input.pageSize !== undefined) {
    if (!Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > mode.maxPageSize) {
      throw new InvalidInputError(`pageSize must be an integer between 1 and ${mode.maxPageSize}`);
    }
    pageSize = input.pageSize;
  }
  const [orderField, orderDir] = resolveSort(mode, input.sortKey);

  let q = buildQuery(db, clauses, scope).orderBy(orderField, orderDir);
  // The document-id tiebreak, matching the direction of the clause before it so the query stays on
  // the index Firestore maintains for free.
  q = q.orderBy(FieldPath.documentId(), orderDir);

  // One MORE than the page: `hasMore` is OBSERVED, never inferred from a full page.
  const snap = await q.limit(pageSize + 1).get();
  const docs = snap.docs.slice(0, pageSize);
  return {
    items: docs.map((d) => ({ ...d.data(), id: d.id })),
    hasMore: snap.docs.length > pageSize,
    scope: scope.kind,
  };
}

export interface CountScopedWorkOrdersInput {
  readonly actorUid: string;
  readonly mode: string;
  readonly params?: Record<string, unknown>;
}

/**
 * The aggregate, through the SAME authority and the SAME scope resolver as the read.
 *
 * Not a second authorization path -- deliberately. A count that answered where the read would refuse
 * discloses the size of a set the caller may not see, and a count scoped differently from the list
 * above it would put a number over a table that disagrees with it.
 */
export async function countScopedWorkOrders(
  input: CountScopedWorkOrdersInput,
  deps: ScopedWorkOrderDeps = {},
): Promise<{ count: number; atLeast: boolean; scope: "GLOBAL" | "ASSIGNED" }> {
  const db = deps.db ?? getFirestore();
  const { id, mode } = resolveMode(input.mode);
  const scope = await resolveWorkOrderScope(input.actorUid, deps);
  const clauses = resolveClauses(id, mode, (input.params ?? {}) as Record<string, unknown>);

  const snap = await buildQuery(db, clauses, scope).limit(WORK_ORDER_COUNT_CEILING).count().get();
  const count = snap.data().count;
  return { count, atLeast: count >= WORK_ORDER_COUNT_CEILING, scope: scope.kind };
}

/**
 * One Work Order by id.
 *
 * KNOWING AN ID DOES NOT BYPASS SCOPE. A technician gets the record only when its `assignedTechId`
 * equals their server-resolved technician identity; the check is made against the STORED document,
 * after reading it, because that is the only place the assignment is recorded.
 *
 * A scope failure is DENIED, not "not found". The client contract this replaces distinguished the
 * two -- `loadErrorMessage` renders a permission message distinct from an absence, and Rules
 * produced a permission-denied for an unassigned technician. Collapsing them into "not found" would
 * be more convenient and would change what a user is told.
 */
export async function readScopedWorkOrderById(
  input: { actorUid: string; workOrderId: string },
  deps: ScopedWorkOrderDeps = {},
): Promise<{ workOrder: Record<string, unknown> | null; scope: "GLOBAL" | "ASSIGNED" }> {
  const db = deps.db ?? getFirestore();
  if (typeof input?.workOrderId !== "string" || !input.workOrderId) {
    throw new InvalidInputError("workOrderId is required");
  }
  const scope = await resolveWorkOrderScope(input.actorUid, deps);

  const snap = await db.collection(WORK_ORDERS).doc(input.workOrderId).get();
  // A CONFIRMED ABSENCE, for either scope. Reported as null with no error, which is distinct from
  // the refusal below.
  if (!snap.exists) return { workOrder: null, scope: scope.kind };

  const data = snap.data() as Record<string, unknown>;
  if (scope.kind === "ASSIGNED" && data.assignedTechId !== scope.technicianId) {
    throw new UnauthorizedActorError("this work order is not assigned to you");
  }
  return { workOrder: { ...data, id: snap.id }, scope: scope.kind };
}
