// THE ADAPTER from the governed EOS Work Order read shapes (functions/src/eosOps/workOrderQueries.ts:
// WorkOrderSummary / WorkOrderDetail, ISO-8601 timestamps) to the legacy client WorkOrder shape the
// screens already read (types/workOrder.ts). PURE: no React, no Firebase, no I/O -- node-importable and
// unit-tested directly (test/workOrderApiClient.test.jsx).
//
// ════════════════════ IDENTITY: assignedTechId / scheduledTechId ARE EMPLOYEE IDS NOW ════════════════════
//
// The governed authority has ONE open assignment per Work Order, and its assignee is an EOS EMPLOYEE
// (eos_workforce.employees.id) -- NOT a fieldops_technicians document id. Both legacy fields are filled
// from `assigneeEmployeeId` so existing lane/bucket code keeps working, and every roster the screens
// compare them against must therefore be the governed technician roster (listWorkOrderTechnicians), whose
// ids are Employee ids too. A fieldops_technicians id will never equal either field.
//
// ════════════════════ TIMESTAMPS ════════════════════
//
// Existing domain code calls .toMillis() / .toDate() / reads .seconds on Work Order timestamps (they
// were Firestore Timestamps). eosInstant() gives an ISO string exactly that surface -- nothing is
// fabricated: a null/absent/unparseable instant stays undefined, never "now" and never the epoch.

const EOS_INSTANT = Symbol.for("eos.workOrder.instant");

/** A Timestamp-compatible, immutable instant; undefined for anything that is not a real instant. */
export function eosInstant(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const ms = typeof value === "number" ? value : new Date(value).getTime();
  if (!Number.isFinite(ms)) return undefined;
  const seconds = Math.floor(ms / 1000);
  const nanoseconds = (ms - seconds * 1000) * 1e6;
  return Object.freeze({
    [EOS_INSTANT]: true,
    seconds,
    nanoseconds,
    toMillis: () => ms,
    toDate: () => new Date(ms),
    toISOString: () => new Date(ms).toISOString(),
    toJSON: () => new Date(ms).toISOString(),
    // Ordering comparisons (<, >) behave like millis.
    valueOf: () => ms,
    isEqual: (other) => !!other && typeof other.toMillis === "function" && other.toMillis() === ms,
  });
}

export const isEosInstant = (v) => !!v && typeof v === "object" && v[EOS_INSTANT] === true;

const orUndefined = (v) => (v === null || v === undefined ? undefined : v);

/**
 * One governed Work Order (summary OR detail) -> the legacy WorkOrder shape. Returns null for anything
 * that is not a Work Order (no id), so a malformed row is dropped rather than rendered half-empty.
 */
export function adaptWorkOrder(source) {
  if (!source || typeof source !== "object" || typeof source.workOrderId !== "string" || source.workOrderId === "") {
    return null;
  }
  const s = source;
  const t = s.timestamps && typeof s.timestamps === "object" ? s.timestamps : {};
  const assignee = orUndefined(s.assigneeEmployeeId);
  const wo = {
    id: s.workOrderId,
    workOrderId: s.workOrderId,
    woNumber: s.workOrderNumber ?? s.workOrderId,
    status: s.status,
    priority: s.priority,
    severity: orUndefined(s.severity),
    type: s.workOrderType,
    customerId: s.customerId,
    customerName: orUndefined(s.customerName),
    locationId: s.locationId,
    locationName: orUndefined(s.locationName),
    equipmentId: orUndefined(s.equipmentId),
    salesOrderId: orUndefined(s.salesOrderId),
    operatingCompanyKey: orUndefined(s.operatingCompanyKey),
    provenance: orUndefined(s.provenance),
    // EMPLOYEE ids (see the header). Both legacy fields carry the ONE governed assignee.
    assigneeEmployeeId: assignee,
    assignedTechId: assignee,
    scheduledTechId: assignee,
    assigneeDisplayName: orUndefined(s.assigneeDisplayName),
    scheduledStart: eosInstant(s.scheduledStart),
    scheduledEnd: eosInstant(s.scheduledEnd),
    complaint: orUndefined(s.complaint),
    createdAt: eosInstant(s.createdAt),
    updatedAt: eosInstant(s.updatedAt),
    // Lifecycle timestamps exist on the DETAIL read only; a summary leaves them undefined (unknown),
    // never guessed from updatedAt.
    dispatchedAt: eosInstant(t.dispatchedAt),
    acceptedAt: eosInstant(t.acceptedAt),
    enRouteAt: eosInstant(t.enRouteAt),
    arrivedAt: eosInstant(t.arrivedAt),
    workStartedAt: eosInstant(t.workStartedAt),
    completedAt: eosInstant(t.completedAt),
    closedAt: eosInstant(t.closedAt),
    diagnosis: orUndefined(s.diagnosis),
    resolution: orUndefined(s.resolution),
    estimatedDurationMinutes: typeof s.estimatedDurationMinutes === "number" ? s.estimatedDurationMinutes : undefined,
  };
  if (s.location && typeof s.location === "object") wo.siteLocation = s.location;
  if (s.equipment && typeof s.equipment === "object") wo.equipment = s.equipment;
  const execution = s.execution && typeof s.execution === "object" ? s.execution : null;
  if (execution) {
    wo.inventorySnapshot = (Array.isArray(execution.parts) ? execution.parts : [])
      .filter((p) => p && typeof p.partId === "string")
      // `sku` carries the canonical partId: the governed execution record keys usage by Part, and the
      // execution-capture surfaces send their deltas back keyed by this same value.
      .map((p) => ({ sku: p.partId, partId: p.partId, qtyPlanned: Number(p.qtyPlanned ?? 0), qtyUsed: Number(p.qtyUsed ?? 0) }));
    wo.executionLog = (Array.isArray(execution.notes) ? execution.notes : [])
      .filter((n) => n && typeof n.note === "string")
      .map((n) => ({ note: n.note, at: eosInstant(n.recordedAt), byPrincipalId: n.recordedByPrincipalId ?? null }));
  }
  if (Array.isArray(s.transitions)) wo.transitions = s.transitions;
  if (Array.isArray(s.assignmentHistory)) wo.assignmentHistory = s.assignmentHistory;
  for (const k of Object.keys(wo)) if (wo[k] === undefined) delete wo[k];
  return wo;
}

/** A list of governed summaries -> legacy Work Orders, malformed rows dropped. */
export function adaptWorkOrders(items) {
  return (Array.isArray(items) ? items : []).map(adaptWorkOrder).filter(Boolean);
}

/**
 * One governed technician (listWorkOrderTechnicians item, an EmployeeDirectoryItem) -> the technician
 * shape the scheduling / dispatch surfaces read. `id` IS the Employee id, so it lines up with
 * assignedTechId / scheduledTechId above. There is no field-status on a governed Employee, so `status`
 * is left absent (unknown) rather than invented.
 */
export function adaptWorkOrderTechnician(item) {
  if (!item || typeof item !== "object" || typeof item.employeeId !== "string" || item.employeeId === "") return null;
  const name = item.displayName || [item.firstName, item.lastName].filter(Boolean).join(" ") || item.employeeNumber || item.employeeId;
  return {
    id: item.employeeId,
    employeeId: item.employeeId,
    name,
    displayName: item.displayName ?? null,
    employeeNumber: item.employeeNumber ?? null,
    employmentStatus: item.employmentStatus ?? null,
    operatingCompanyId: item.operatingCompanyId ?? null,
    jobTitle: item.jobTitle ?? null,
  };
}

export function adaptWorkOrderTechnicians(items) {
  return (Array.isArray(items) ? items : []).map(adaptWorkOrderTechnician).filter(Boolean);
}

/**
 * The assignee names the governed Work Order rows ALREADY carry (assigneeEmployeeId + assigneeDisplayName),
 * as a technician directory keyed by Employee id. Lets a surface that holds Work Orders name their
 * assignees without a second read -- and without needing a scheduling capability to list the roster.
 */
export function techniciansFromWorkOrders(workOrders) {
  const byId = new Map();
  for (const wo of Array.isArray(workOrders) ? workOrders : []) {
    const id = wo?.assigneeEmployeeId;
    if (typeof id === "string" && id !== "" && !byId.has(id) && typeof wo.assigneeDisplayName === "string" && wo.assigneeDisplayName) {
      byId.set(id, { id, employeeId: id, name: wo.assigneeDisplayName, displayName: wo.assigneeDisplayName });
    }
  }
  return [...byId.values()];
}

/** Roster rows first (they carry more), then any Work-Order-derived names the roster lacks. */
export function mergeTechnicianDirectories(...lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const t of Array.isArray(list) ? list : []) {
      if (t && typeof t.id === "string" && !byId.has(t.id)) byId.set(t.id, t);
    }
  }
  return [...byId.values()];
}
