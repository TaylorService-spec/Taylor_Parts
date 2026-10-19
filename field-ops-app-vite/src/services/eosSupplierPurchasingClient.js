// SUPPLIER PURCHASE ORDER AUTHORING, FROM THE BROWSER (P-1; DECISIONS #P-1; resolves OD-B3-1).
//
//   browser -> THIS -> POST /operations/inventory: createSupplierPurchaseOrder / transitionSupplierPurchaseOrder / listSupplierPurchaseOrders /
//   readSupplierPurchaseOrder / listPurchasableReorderRequests
//   -> verified bearer -> EOS Principal + tenant + the ACTION'S capability (supplier.purchaseOrder.*) + the caller's operating companies (+ the WAREHOUSE
//   scope to create) -> PostgreSQL (functions/src/eosOps/supplierPurchaseOrderAuthoring.ts)
//
// THE CLIENT DECIDES NOTHING. It names no capability and trusts no flag it computed itself: every call re-decides on the server, and the screen offers
// exactly the actions the server's own read states (`allowed`). A GOVERNED refusal (denied / not found / invalid / conflict / precondition) carries the
// command's own sentence; any other failure -- an internal error, an unreachable service -- is a bounded word with NO server text.
//
// The idempotencyKey is the CALLER'S and travels verbatim, so a retry after a lost response (or one replayed from a queue) is answered `replayed` and
// writes nothing. A caller keeps ONE key per submission attempt (newIdempotencyKey) and reuses it until the attempt is answered.

// The transport is imported LAZILY, on the first real call (reorderApiClient.js reaches the Firebase-era token seam); this module stays importable
// and unit-testable without initializing anything.
const callReorderApi = async (...args) => (await import("./reorderApiClient.js")).callReorderApi(...args);

export const SUPPLIER_PO_OPERATIONS = Object.freeze({
  list: "listSupplierPurchaseOrders",
  read: "readSupplierPurchaseOrder",
  purchasable: "listPurchasableReorderRequests",
  create: "createSupplierPurchaseOrder",
  transition: "transitionSupplierPurchaseOrder",
});

export const SUPPLIER_PO_OUTCOME = Object.freeze({
  DENIED: "denied", NOT_FOUND: "not-found", INVALID: "invalid", CONFLICT: "conflict", UNAUTHENTICATED: "unauthenticated", UNAVAILABLE: "unavailable",
});

const OUTCOME_BY_FAILURE = Object.freeze({
  NOT_SIGNED_IN: SUPPLIER_PO_OUTCOME.UNAUTHENTICATED,
  UNAUTHENTICATED: SUPPLIER_PO_OUTCOME.UNAUTHENTICATED,
  FORBIDDEN: SUPPLIER_PO_OUTCOME.DENIED,
  INVALID_INPUT: SUPPLIER_PO_OUTCOME.INVALID,
  NOT_FOUND: SUPPLIER_PO_OUTCOME.NOT_FOUND,
  CONFLICT: SUPPLIER_PO_OUTCOME.CONFLICT,
  PRECONDITION_FAILED: SUPPLIER_PO_OUTCOME.CONFLICT,
});
const GOVERNED = new Set([SUPPLIER_PO_OUTCOME.DENIED, SUPPLIER_PO_OUTCOME.NOT_FOUND, SUPPLIER_PO_OUTCOME.INVALID, SUPPLIER_PO_OUTCOME.CONFLICT]);

/** A failed call -> `{ ok: false, outcome, reason, message? }`. `message` is present ONLY for a governed refusal. Pure; exported for tests. */
export function supplierPoFailure(res) {
  const outcome = Object.prototype.hasOwnProperty.call(OUTCOME_BY_FAILURE, res?.code) ? OUTCOME_BY_FAILURE[res.code] : SUPPLIER_PO_OUTCOME.UNAVAILABLE;
  const governed = GOVERNED.has(outcome) && typeof res?.message === "string" && res.message !== "";
  return Object.freeze({ ok: false, outcome, reason: typeof res?.reason === "string" ? res.reason : null, ...(governed ? { message: res.message } : {}) });
}

/** One key per submission attempt. Random where the platform has it; the caller reuses it until the attempt is answered. */
export const newIdempotencyKey = (prefix = "spo") =>
  `${prefix}-${typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

async function callOp(operation, input, call) {
  try {
    return await call(operation, input);
  } catch {
    return { ok: false, code: "UNREACHABLE" };
  }
}

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** @param {{ call?: typeof callReorderApi }} [deps] injectable transport (tests) */
export function createSupplierPurchasingClient({ call = callReorderApi } = {}) {
  return Object.freeze({
    /** The supplier purchase orders of the caller's companies. `statuses` narrows (DRAFT / APPROVED / SENT / RECEIVED / CANCELLED). */
    async listOrders({ statuses } = {}) {
      const res = await callOp(SUPPLIER_PO_OPERATIONS.list, statuses ? { statuses } : {}, call);
      if (!res.ok) return supplierPoFailure(res);
      // A malformed answer is UNAVAILABLE, never a partially trusted list. An empty list is a legitimate answer.
      return Array.isArray(res.result?.purchaseOrders) ? Object.freeze({ ok: true, purchaseOrders: res.result.purchaseOrders })
        : Object.freeze({ ok: false, outcome: SUPPLIER_PO_OUTCOME.UNAVAILABLE, reason: null });
    },

    /** One order with its lines and the actions THIS caller may take on it now. */
    async readOrder(purchaseOrderId) {
      if (typeof purchaseOrderId !== "string" || purchaseOrderId.trim() === "") return Object.freeze({ ok: false, outcome: SUPPLIER_PO_OUTCOME.INVALID, reason: null });
      const res = await callOp(SUPPLIER_PO_OPERATIONS.read, { purchaseOrderId }, call);
      if (!res.ok) return supplierPoFailure(res);
      const r = res.result;
      return isObject(r) && typeof r.purchaseOrderId === "string" && Array.isArray(r.lines) && isObject(r.allowed)
        ? Object.freeze({ ok: true, order: r }) : Object.freeze({ ok: false, outcome: SUPPLIER_PO_OUTCOME.UNAVAILABLE, reason: null });
    },

    /** The buyer's picker: their own orderable requests, the active suppliers, and (given a supplier) default prices from the terms they may read. */
    async listPurchasable({ supplierId } = {}) {
      const res = await callOp(SUPPLIER_PO_OPERATIONS.purchasable, supplierId ? { supplierId } : {}, call);
      if (!res.ok) return supplierPoFailure(res);
      return Array.isArray(res.result?.requests) && Array.isArray(res.result?.suppliers)
        ? Object.freeze({ ok: true, requests: res.result.requests, suppliers: res.result.suppliers })
        : Object.freeze({ ok: false, outcome: SUPPLIER_PO_OUTCOME.UNAVAILABLE, reason: null });
    },

    /**
     * Raise a DRAFT order. `lines`: [{ reorderRequestId, orderedQuantity?, unitPriceMinor?, currency? }]. Malformed input is refused HERE without a call.
     * The company is the warehouse's and the Part is the request's: neither is sent.
     */
    async createOrder({ supplierId, receivingWarehouseId, lines, idempotencyKey }) {
      if (typeof supplierId !== "string" || supplierId === "" || typeof receivingWarehouseId !== "string" || receivingWarehouseId === ""
        || !Array.isArray(lines) || lines.length === 0 || typeof idempotencyKey !== "string" || idempotencyKey === "") {
        return Object.freeze({ ok: false, outcome: SUPPLIER_PO_OUTCOME.INVALID, reason: null });
      }
      const res = await callOp(SUPPLIER_PO_OPERATIONS.create, { supplierId, receivingWarehouseId, lines, idempotencyKey }, call);
      if (!res.ok) return supplierPoFailure(res);
      return isObject(res.result) && typeof res.result.purchaseOrderId === "string" && typeof res.result.externalPoNumber === "string"
        ? Object.freeze({ ok: true, order: res.result, replayed: res.result.outcome === "replayed" })
        : Object.freeze({ ok: false, outcome: SUPPLIER_PO_OUTCOME.UNAVAILABLE, reason: null });
    },

    /** Approve, send or cancel (`action`: APPROVE | SEND | CANCEL). `expectedVersion` is the version the caller READ. A cancellation states its `reason`. */
    async transitionOrder({ purchaseOrderId, action, expectedVersion, reason, idempotencyKey }) {
      if (typeof purchaseOrderId !== "string" || purchaseOrderId === "" || !["APPROVE", "SEND", "CANCEL"].includes(action)
        || !Number.isSafeInteger(expectedVersion) || typeof idempotencyKey !== "string" || idempotencyKey === ""
        || (action === "CANCEL" && !(typeof reason === "string" && reason.trim() !== ""))) {
        return Object.freeze({ ok: false, outcome: SUPPLIER_PO_OUTCOME.INVALID, reason: null });
      }
      const input = { purchaseOrderId, action, expectedVersion, idempotencyKey, ...(action === "CANCEL" ? { reason: reason.trim() } : {}) };
      const res = await callOp(SUPPLIER_PO_OPERATIONS.transition, input, call);
      if (!res.ok) return supplierPoFailure(res);
      return isObject(res.result) && typeof res.result.status === "string" && Number.isSafeInteger(res.result.version)
        ? Object.freeze({ ok: true, result: res.result, replayed: res.result.outcome === "replayed" })
        : Object.freeze({ ok: false, outcome: SUPPLIER_PO_OUTCOME.UNAVAILABLE, reason: null });
    },
  });
}

export const supplierPurchasingClient = createSupplierPurchasingClient();
