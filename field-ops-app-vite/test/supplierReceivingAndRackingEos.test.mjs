// WAREHOUSE & RECEIVING OFF FIREBASE (Firebase exit B3, DECISIONS #B3) -- the EOS clients and the proof that no Firebase call remains on the EOS
// path. Run: node --test test/supplierReceivingAndRackingEos.test.mjs
//
//   1. Supplier PO receiving: the four receiving functions on /operations/inventory, with the Firebase client's result shapes, a bounded outcome
//      vocabulary, a stable idempotency key, and a malformed answer that is UNAVAILABLE (never a partially trusted list or receipt).
//   2. Warehouse Racking: the planner's client over /admin/policy, the batch apply with per-item outcomes (partial success, safe retry, an
//      unknown outcome is never a success), and the stated reason.
//   3. The archived legacy notes read.
//   4. THE FAILING-SPY PIN: where an EOS API is declared the sources are chosen at BUILD time, and the EOS modules import nothing from Firebase.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSupplierReceivingClient, SUPPLIER_RECEIVING_OPERATIONS, supplierReceivingOutcomeForFailure } from "../src/services/eosSupplierReceivingClient.js";
import { createEosRackingClient, loadRackingWarehouses } from "../src/services/eosRackingClient.js";
import { applyProposalsBatched, summarizeApply, BATCH_CHUNK } from "../src/services/rackingApply.js";
import { readArchivedNotes, LEGACY_NOTES_OPERATION } from "../src/services/legacyInventoryNotesClient.js";
import { RECEIVING_OUTCOME } from "../src/domain/receivingTransport.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(path.join(here, "../src", rel), "utf8").replace(/\r\n/g, "\n");
const strip = (text) => text.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

/** A server stand-in: answers per operation from `answers` and records every call. */
function server(answers) {
  const calls = [];
  const call = async (operation, input) => {
    calls.push([operation, input]);
    const a = answers[operation];
    const v = typeof a === "function" ? a(input) : a;
    return v?.ok === false ? v : { ok: true, result: v };
  };
  return { call, calls };
}

const PROGRESS = {
  purchaseOrderId: "po-1", supplierId: "sup-1", supplierName: "Acme", externalPoNumber: "PO-9", storedStatus: "SENT", derivedState: "PARTIALLY_RECEIVED", receivable: true, version: 1,
  lines: [{ lineId: "L1", partId: "PART-A", trackingMode: "NONE", orderedQuantity: 10, receivedQuantity: 4, remainingQuantity: 6, state: "PARTIALLY_RECEIVED" }],
};
const RECEIPT = {
  outcome: "applied", receivingId: "rcvc_1", receivingOrderNumber: "RO-2026-000001", sourceKind: "PURCHASE_ORDER", purchaseOrderId: "po-1", receivedAt: "2026-10-18T15:00:00.000Z",
  ledgerEventId: "mov_1", movementIds: ["mov_1"], serializedCustodyIds: [],
  lines: [{ lineId: "L1", partId: "PART-A", orderedQuantity: 10, previouslyReceived: 0, receivedNow: 4, remainingQuantity: 6, state: "PARTIALLY_RECEIVED" }],
  derivedState: "PARTIALLY_RECEIVED", storedStatus: "SENT", version: 1,
};
const REQUEST = {
  source: { type: "PURCHASE_ORDER", purchaseOrderId: "po-1" }, receivingLocation: { type: "WAREHOUSE", locationId: "wh-1" },
  lines: [{ lineId: "L1", partId: "PART-A", receivedQuantity: 4 }], idempotencyKey: "idem-1",
};

// ════════════════════════════ 1. SUPPLIER PO RECEIVING ════════════════════════════

test("the four receiving functions call exactly the four EOS operations, with the Firebase client's result shapes", async () => {
  const s = server({
    listReceivableSupplierPurchaseOrders: { purchaseOrders: [{ purchaseOrderId: "po-1", supplierId: "sup-1", storedStatus: "SENT", lineCount: 1 }] },
    readSupplierPurchaseOrderProgress: PROGRESS,
    listSupplierReceivingLocationOptions: { purchaseOrderId: "po-1", receivable: true, options: [{ value: "wh-2", label: "B (Sampleton)", type: "WAREHOUSE" }, { value: "wh-1", label: "A (Sampleton)", type: "WAREHOUSE" }] },
    receiveSupplierPurchaseOrder: RECEIPT,
  });
  const client = createSupplierReceivingClient({ call: s.call });
  const list = await client.fetchReceivablePurchaseOrders();
  assert.deepEqual([list.status, list.purchaseOrders.length], [RECEIVING_OUTCOME.READY, 1]);
  const progress = await client.fetchPurchaseOrderProgress("po-1");
  assert.equal(progress.status, RECEIVING_OUTCOME.READY);
  assert.deepEqual([progress.progress.purchaseOrderId, progress.progress.version, progress.progress.lines[0].remainingQuantity], ["po-1", 1, 6]);
  const options = await client.fetchReceivingLocationOptions("po-1");
  assert.deepEqual(options.options.map((o) => o.value), ["wh-1", "wh-2"], "the adapter validates and orders the DTO");
  const receive = await client.submitCanonicalReceive(REQUEST);
  assert.equal(receive.status, RECEIVING_OUTCOME.APPLIED);
  assert.deepEqual([receive.receipt.purchaseOrderId, receive.receipt.ledgerEventId, receive.receipt.derivedState, receive.receipt.storedStatus], ["po-1", "mov_1", "PARTIALLY_RECEIVED", "SENT"]);
  assert.deepEqual(s.calls.map(([op]) => op), ["listReceivableSupplierPurchaseOrders", "readSupplierPurchaseOrderProgress", "listSupplierReceivingLocationOptions", "receiveSupplierPurchaseOrder"]);
  assert.deepEqual(Object.values(SUPPLIER_RECEIVING_OPERATIONS).sort(), s.calls.map(([op]) => op).sort(), "exactly the four operations, no other");
  assert.deepEqual(s.calls[0], ["listReceivableSupplierPurchaseOrders", {}]);
  assert.deepEqual(s.calls[1], ["readSupplierPurchaseOrderProgress", { purchaseOrderId: "po-1" }]);
  assert.deepEqual(s.calls[2], ["listSupplierReceivingLocationOptions", { purchaseOrderId: "po-1" }]);
});

test("the idempotency key travels VERBATIM; a replayed receipt is REPLAYED; a retry sends the same payload", async () => {
  const s = server({ receiveSupplierPurchaseOrder: (input) => ({ ...RECEIPT, outcome: input.idempotencyKey === "idem-1" ? "replayed" : "applied" }) });
  const client = createSupplierReceivingClient({ call: s.call });
  const first = await client.submitCanonicalReceive(REQUEST);
  const retry = await client.submitCanonicalReceive(REQUEST);
  assert.deepEqual([first.status, retry.status], [RECEIVING_OUTCOME.REPLAYED, RECEIVING_OUTCOME.REPLAYED]);
  assert.deepEqual(s.calls[0][1], s.calls[1][1]);
  assert.equal(s.calls[0][1].idempotencyKey, "idem-1");
  assert.equal(s.calls[0][1].source.reorderRequestId, undefined, "a canonical source never carries a reorderRequestId");
});

test("a malformed request is refused CLIENT-SIDE without any call; a malformed answer is UNAVAILABLE, never a partially trusted list or receipt", async () => {
  const s = server({
    listReceivableSupplierPurchaseOrders: { purchaseOrders: "nope" },
    readSupplierPurchaseOrderProgress: { ...PROGRESS, lines: [{ lineId: "L1" }] },
    listSupplierReceivingLocationOptions: { options: [{ value: "wh-1" }] },
    receiveSupplierPurchaseOrder: { outcome: "applied" },
  });
  const client = createSupplierReceivingClient({ call: s.call });
  assert.equal((await client.submitCanonicalReceive({ ...REQUEST, idempotencyKey: "" })).status, RECEIVING_OUTCOME.INVALID);
  assert.equal((await client.submitCanonicalReceive({ ...REQUEST, source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: "r", purchaseOrderId: "r" } })).status, RECEIVING_OUTCOME.INVALID);
  assert.equal((await client.fetchReceivingLocationOptions("")).status, RECEIVING_OUTCOME.INVALID);
  assert.equal(s.calls.length, 0, "nothing reached the wire");
  assert.deepEqual((await client.fetchReceivablePurchaseOrders()).purchaseOrders, []);
  assert.equal((await client.fetchReceivablePurchaseOrders()).status, RECEIVING_OUTCOME.UNAVAILABLE);
  assert.equal((await client.fetchPurchaseOrderProgress("po-1")).status, RECEIVING_OUTCOME.UNAVAILABLE);
  assert.equal((await client.fetchReceivingLocationOptions("po-1")).status, RECEIVING_OUTCOME.UNAVAILABLE);
  assert.equal((await client.submitCanonicalReceive(REQUEST)).status, RECEIVING_OUTCOME.UNAVAILABLE);
});

test("a governed refusal is a bounded outcome, never a raw message; a thrown transport is UNAVAILABLE", async () => {
  for (const [code, outcome] of [["FORBIDDEN", RECEIVING_OUTCOME.DENIED], ["NOT_FOUND", RECEIVING_OUTCOME.NOT_FOUND], ["INVALID_INPUT", RECEIVING_OUTCOME.INVALID],
    ["CONFLICT", RECEIVING_OUTCOME.CONFLICT], ["PRECONDITION_FAILED", RECEIVING_OUTCOME.CONFLICT], ["UNAUTHENTICATED", RECEIVING_OUTCOME.UNAUTHENTICATED],
    ["NOT_SIGNED_IN", RECEIVING_OUTCOME.UNAUTHENTICATED], ["UNREACHABLE", RECEIVING_OUTCOME.UNAVAILABLE], ["INTERNAL", RECEIVING_OUTCOME.UNAVAILABLE], ["SOMETHING_NEW", RECEIVING_OUTCOME.UNAVAILABLE]]) {
    assert.equal(supplierReceivingOutcomeForFailure({ ok: false, code }), outcome, code);
    const s = server({ receiveSupplierPurchaseOrder: { ok: false, code, message: "secret detail /internal/path" } });
    const r = await createSupplierReceivingClient({ call: s.call }).submitCanonicalReceive(REQUEST);
    assert.deepEqual(Object.keys(r).sort(), ["receipt", "status"]);
    assert.equal(JSON.stringify(r).includes("secret"), false);
  }
  const throwing = createSupplierReceivingClient({ call: async () => { throw new Error("boom"); } });
  assert.equal((await throwing.submitCanonicalReceive(REQUEST)).status, RECEIVING_OUTCOME.UNAVAILABLE);
  assert.equal((await throwing.fetchReceivablePurchaseOrders()).status, RECEIVING_OUTCOME.UNAVAILABLE);
});

// ════════════════════════════ 2. WAREHOUSE RACKING ════════════════════════════

const callApiOf = (answers) => {
  const calls = [];
  const callApi = async (operation, input) => {
    calls.push([operation, input]);
    const a = answers[operation];
    const v = typeof a === "function" ? a(input) : a;
    return v?.ok === false ? v : { ok: true, data: v };
  };
  return { callApi, calls };
};
const row = (aisle, bay, position) => ({ warehouseId: "wh-1", area: "PARTS", aisle, bay, position, idempotencyKey: `binadm:v1:wh-1:PARTS:${aisle}:${bay}:${position}` });

test("the racking client has the planner's method surface over the Administration operations, and states the reason it requires", async () => {
  const s = callApiOf({
    listRackingBins: { items: [{ binId: "bin_1", code: "A01-001" }], truncated: true },
    previewBinCreates: (input) => ({ rows: input.proposals.map((p) => ({ idempotencyKey: p.idempotencyKey, classification: "NEW", code: "A01-001" })) }),
    createBins: { items: [] }, renameRackingBin: { changed: true }, setRackingBinStatus: (input) => ({ changed: true, status: input.status }),
  });
  const client = createEosRackingClient({ callApi: s.callApi });
  assert.equal(client.requiresReason, true);
  assert.deepEqual(await client.listBins({ warehouseId: "wh-1" }), { bins: [{ binId: "bin_1", code: "A01-001" }], truncated: true });
  const preview = await client.previewBinCreates({ proposals: [row("A", 1, 1), row("A", 1, 3)] });
  assert.equal(preview.rows.length, 2);
  // The warehouse is the REQUEST's; the rows carry no warehouseId and no field the server would refuse.
  assert.deepEqual(s.calls[1], ["previewBinCreates", { warehouseId: "wh-1", proposals: [
    { area: "PARTS", aisle: "A", bay: 1, position: 1, idempotencyKey: "binadm:v1:wh-1:PARTS:A:1:1" },
    { area: "PARTS", aisle: "A", bay: 1, position: 3, idempotencyKey: "binadm:v1:wh-1:PARTS:A:1:3" }] }]);
  await client.createBins({ warehouseId: "wh-1", proposals: [row("A", 1, 1)], reason: "initial layout" });
  assert.deepEqual(s.calls[2], ["createBins", { warehouseId: "wh-1", reason: "initial layout", proposals: [{ area: "PARTS", aisle: "A", bay: 1, position: 1, idempotencyKey: "binadm:v1:wh-1:PARTS:A:1:1" }] }]);
  await client.renameBin({ binId: "bin_1", name: "Fast movers", reason: "relabel" });
  await client.deactivateBin({ binId: "bin_1", reason: "retired" });
  await client.reactivateBin({ binId: "bin_1" });
  assert.deepEqual(s.calls.slice(3).map(([op, input]) => [op, input.status ?? null, input.reason ?? null]), [
    ["renameRackingBin", null, "relabel"], ["setRackingBinStatus", "INACTIVE", "retired"], ["setRackingBinStatus", "ACTIVE", null]]);
  assert.deepEqual((await client.previewBinCreates({ proposals: [] })).rows, []);
  assert.equal(s.calls.length, 6, "an empty preview asks nothing");
});

test("a refusal throws with the server's code -- never an empty rack; the picker lists the server's warehouses", async () => {
  const denied = createEosRackingClient({ callApi: async () => ({ ok: false, code: "FORBIDDEN", message: "no" }) });
  await assert.rejects(denied.listBins({ warehouseId: "wh-1" }), (e) => e.code === "FORBIDDEN");
  await assert.rejects(denied.previewBinCreates({ proposals: [row("A", 1, 1)] }), (e) => e.code === "FORBIDDEN");
  const s = callApiOf({ listRackingWarehouses: { items: [{ warehouseId: "wh-1", name: "Phoenix", siteLabel: "AZ", status: "ACTIVE", binCount: 3 }] } });
  assert.deepEqual(await loadRackingWarehouses({ callApi: s.callApi }), [{ id: "wh-1", name: "Phoenix", siteLabel: "AZ", status: "ACTIVE" }]);
  await assert.rejects(loadRackingWarehouses({ callApi: async () => ({ ok: false, code: "NOT_CONFIGURED", message: "x" }) }), (e) => e.code === "NOT_CONFIGURED");
});

const rows = (n) => Array.from({ length: n }, (_, i) => ({ request: row("A", 1, i * 2 + 1) }));

test("PARTIAL SUCCESS: the batch apply maps every item to its own outcome, in order, and nothing is an aggregate success", async () => {
  const items = [
    { index: 0, outcome: "CREATED", classification: "NEW", code: "A01-001", binId: "bin_a" },
    { index: 1, outcome: "UNCHANGED", classification: "ALREADY_EXISTS", code: "A01-003", binId: "bin_b" },
    { index: 2, outcome: "REFUSED", classification: "POSITION_TAKEN", reason: "position_taken_by_another_bin", code: "A01-005", binId: null },
  ];
  const results = await applyProposalsBatched({ rows: rows(3), warehouseId: "wh-1", reason: "layout", createBins: async () => ({ items }) });
  assert.deepEqual(results.map((r) => [r.outcome, r.code, r.error === null]), [["created", "A01-001", true], ["unchanged", "A01-003", true], ["failed", "A01-005", false]]);
  assert.match(results[2].error, /rack position already belongs to another bin/);
  assert.deepEqual(summarizeApply(results), { created: 1, unchanged: 1, failed: 1 });
});

test("an item the server did not answer for, a malformed answer and a request that did not finish are UNKNOWN outcomes (failed rows), never success", async () => {
  const partial = await applyProposalsBatched({ rows: rows(2), warehouseId: "wh-1", reason: "r", createBins: async () => ({ items: [{ index: 0, outcome: "CREATED", code: "A01-001" }] }) });
  assert.deepEqual(partial.map((r) => r.outcome), ["created", "failed"]);
  assert.match(partial[1].error, /outcome is unknown/);
  const malformed = await applyProposalsBatched({ rows: rows(2), warehouseId: "wh-1", reason: "r", createBins: async () => ({ nope: true }) });
  assert.deepEqual(malformed.map((r) => r.outcome), ["failed", "failed"]);
  const dropped = await applyProposalsBatched({ rows: rows(2), warehouseId: "wh-1", reason: "r", createBins: async () => { throw Object.assign(new Error("net"), { code: "UNREACHABLE" }); } });
  assert.deepEqual(dropped.map((r) => r.outcome), ["failed", "failed"]);
  assert.match(dropped[0].error, /did not finish, so each bin's outcome is unknown/);
  const refused = await applyProposalsBatched({ rows: rows(1), warehouseId: "wh-1", reason: "", createBins: async () => { throw Object.assign(new Error("a reason is required"), { code: "INVALID_INPUT" }); } });
  assert.equal(refused[0].error, "a reason is required", "a refusal of the whole request names itself");
});

test("a large apply is chunked to the server's bound and each chunk is its own request; an earlier chunk's failure does not stop the later ones", async () => {
  const sizes = [];
  const total = BATCH_CHUNK * 2 + 10;
  const results = await applyProposalsBatched({
    rows: rows(total), warehouseId: "wh-1", reason: "r",
    createBins: async ({ proposals }) => {
      sizes.push(proposals.length);
      if (sizes.length === 1) throw new Error("first chunk dropped");
      return { items: proposals.map((_, index) => ({ index, outcome: "CREATED", code: "X" })) };
    },
  });
  assert.deepEqual(sizes, [250, 250, 10]);
  assert.equal(results.length, total);
  assert.deepEqual(summarizeApply(results), { created: 260, unchanged: 0, failed: 250 });
});

// ════════════════════════════ 3. THE ARCHIVED NOTES ════════════════════════════

test("archived notes read through one governed operation, in the shape the panels read, and say whether the archive is loaded", async () => {
  const s = server({ listLegacyInventoryActionNotes: { partId: "P", archiveLoaded: false, items: [] } });
  assert.deepEqual(await readArchivedNotes("P", { call: s.call }), { rows: [], archiveLoaded: false });
  assert.deepEqual(s.calls[0], [LEGACY_NOTES_OPERATION, { partId: "P" }]);
  const loaded = server({ listLegacyInventoryActionNotes: { archiveLoaded: true, items: [{ id: "n1", transactionType: "ADJUST_STOCK", quantityDelta: -2, reason: null, createdBy: "fb-uid", createdAt: 1000 }] } });
  const out = await readArchivedNotes("P", { call: loaded.call });
  assert.deepEqual(out.rows, [{ id: "n1", transactionType: "ADJUST_STOCK", quantityDelta: -2, reason: undefined, createdBy: "fb-uid", createdAt: 1000 }]);
  assert.equal(out.archiveLoaded, true);
  await assert.rejects(readArchivedNotes("P", { call: async () => ({ ok: false, code: "FORBIDDEN", message: "x" }) }), (e) => e.code === "FORBIDDEN");
  await assert.rejects(readArchivedNotes("P", { call: async () => ({ ok: true, result: { items: "x" } }) }), (e) => e.code === "MALFORMED");
});

// ════════════════════════════ 4. NO FIREBASE CALL REMAINS ON THE EOS PATH ════════════════════════════

test("the EOS modules import nothing from Firebase", () => {
  for (const file of ["services/eosSupplierReceivingClient.js", "services/eosRackingClient.js", "services/legacyInventoryNotesClient.js", "services/rackingApply.js"]) {
    assert.doesNotMatch(strip(src(file)), /firebase|httpsCallable|onSnapshot|getFirestore/, file);
  }
});

test("each Firebase-calling file chooses its source ONCE at build time by the F1 flag -- no runtime fallback in either direction", () => {
  const receiving = src("services/receivingCallableClient.js");
  assert.match(receiving, /from "\.\.\/access\/eosSessionSource\.js"/);
  for (const [name, firebase] of [["fetchReceivingLocationOptions", "firebaseFetchReceivingLocationOptions"], ["fetchReceivablePurchaseOrders", "firebaseFetchReceivablePurchaseOrders"],
    ["fetchPurchaseOrderProgress", "firebaseFetchPurchaseOrderProgress"], ["submitCanonicalReceive", "firebaseSubmitCanonicalReceive"]]) {
    assert.match(receiving, new RegExp(`export const ${name} = EOS_SESSION_SOURCE \\? supplierReceivingClient\\.${name} : ${firebase};`), `${name} is a compile-time ternary`);
    assert.doesNotMatch(receiving, new RegExp(`export (async )?function ${name}\\b`), `${name} has no other definition`);
  }
  // The Firebase transport is reachable only through the non-EOS arm: it is not exported and nothing in the EOS arm calls it.
  assert.doesNotMatch(strip(receiving), /export (async )?function firebase/);
  assert.doesNotMatch(strip(src("services/eosSupplierReceivingClient.js")), /receivingCallableClient/);

  const racking = src("modules/administration/AdminWarehouseRacking.jsx");
  assert.match(racking, /const DEFAULT_CLIENT = EOS_SESSION_SOURCE \? eosRackingClient : binCommandClient;/);
  assert.match(racking, /const DEFAULT_LOAD_WAREHOUSES = EOS_SESSION_SOURCE \? loadRackingWarehouses : fetchWarehouses;/);
  assert.match(racking, /client = DEFAULT_CLIENT, loadWarehouses = DEFAULT_LOAD_WAREHOUSES/);
  assert.match(racking, /typeof client\.createBins === "function"/);

  const hook = src("hooks/useInventoryActions.js");
  assert.match(hook, /export const useInventoryActionsForPart = EOS_SESSION_SOURCE \? useArchivedInventoryActionNotes : useInventoryActionsFromFirestore;/);
  const archived = hook.slice(hook.indexOf("function useArchivedInventoryActionNotes"), hook.indexOf("export const useInventoryActionsForPart"));
  assert.doesNotMatch(archived, /onSnapshot|collection\(|query\(|\bdb\b/, "the archive hook never touches Firestore");

  assert.match(src("modules/receiving/MultiScanReceiving.jsx"), /api\.fetchReceivingLocationOptions\(purchaseOrderId\)/, "the destinations are the order's");
});

test("the transport mirrors name every new operation, so a typo fails here rather than as a 404", () => {
  // (Read from the source: both clients initialize Firebase at import and cannot be imported outside a browser.)
  const names = (file, exportName) => {
    const text = src(file);
    const start = text.indexOf(`export const ${exportName}`);
    return [...text.slice(start, text.indexOf("]);", start)).matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]);
  };
  const admin = names("services/adminPolicyApiClient.js", "ADMIN_CONFIGURATION_OPERATIONS");
  for (const op of ["listRackingWarehouses", "listRackingBins", "previewBinCreates", "createBins", "renameRackingBin", "setRackingBinStatus"]) {
    assert.ok(admin.includes(op), op);
  }
  const reads = names("services/reorderApiClient.js", "REORDER_READ_OPERATIONS");
  for (const op of ["listReceivableSupplierPurchaseOrders", "readSupplierPurchaseOrderProgress", "listSupplierReceivingLocationOptions", "listLegacyInventoryActionNotes"]) {
    assert.ok(reads.includes(op), op);
  }
  assert.ok(names("services/reorderApiClient.js", "REORDER_COMMAND_OPERATIONS").includes("receiveSupplierPurchaseOrder"));
  // And the client names no capability to decide on: the gate is the server's.
  assert.doesNotMatch(strip(src("services/eosRackingClient.js")), /inventory\.location\.bin\./);
});

test("the nav: Warehouse Racking is a governed destination (inventory.racking), no longer a declared gap", async () => {
  const nav = await import("../src/navigation/navConfig.js");
  assert.deepEqual(nav.NAV_SURFACE_ACCESS["administration/warehouseRacking"], ["inventory.racking"]);
  assert.equal(Object.prototype.hasOwnProperty.call(nav.NAV_SURFACE_GAPS, "administration/warehouseRacking"), false);
  assert.ok(nav.NAV_CUTOVER_PLACEHOLDER_DESTINATIONS.includes("administration/warehouseRacking"));
  const ctx = await import("../src/access/experienceContext.js");
  assert.ok(ctx.EXPERIENCE_SURFACE_KEYS.includes("inventory.racking"));
  const access = await import("../src/access/eosCapabilityAccess.js");
  for (const id of ["inventory.location.bin.read", "inventory.location.bin.manage"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(access.FIREBASE_IDS_WITHOUT_EOS_TWIN, id), false, `${id} is registered in EOS under its own name`);
    assert.equal(access.eosKeyForFirebaseId(id), id);
  }
});
