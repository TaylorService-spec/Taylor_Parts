// Workstream 2B — the application has ZERO intentional callers of the retired reorder write paths.
//
// Owner ruling: "After client migration, prove there is no remaining application code path that
// writes directly: reorder_requests create, reorder_purchase_orders create, reorder_request
// Record-PO transition. A grep/static contract test is appropriate here."
//
// The Rules denial is the final barrier. This is the one before it — it catches an intentional
// caller at review time rather than as a permission-denied error in someone's face, and it is what
// stops a future change from quietly reopening a second write authority (R-15).
//
// STATIC. It reads source; it starts no emulator and calls nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src");

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(js|jsx|ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const FILES = sourceFiles(SRC).map((f) => ({ path: relative(SRC, f).replace(/\\/g, "/"), text: readFileSync(f, "utf8") }));

/** Comment-stripped, so a file DESCRIBING the retired path is not mistaken for one using it. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test("no application code creates a reorder_requests document directly", () => {
  // The retired path was reorderRequestsStore.add(...). The store object may still be exported for
  // reads and for the six retained transitions; what must not exist is a CREATE through it.
  const offenders = FILES.filter((f) => /reorderRequestsStore\s*\.\s*add\s*\(/.test(code(f.text)));
  assert.deepEqual(offenders.map((f) => f.path), [], "these still create reorder_requests directly");
});

test("no application code creates a reorder_purchase_orders document directly", () => {
  // A create is a transaction.set / setDoc / addDoc against the purchase-order ref. voidPurchaseOrder
  // legitimately READS that document and writes the separate voids collection, so a bare mention of
  // purchaseOrderRef is not an offence -- writing THROUGH it is.
  const offenders = FILES.filter((f) => {
    const src = code(f.text);
    return /transaction\s*\.\s*set\s*\(\s*purchaseOrderRef/.test(src)
      || /setDoc\s*\(\s*purchaseOrderRef/.test(src)
      || /addDoc\s*\(\s*[^)]*PURCHASE_ORDERS_COLLECTION/.test(src);
  });
  assert.deepEqual(offenders.map((f) => f.path), [], "these still create a reorder purchase order directly");
});

test("no application code performs the Record-PO transition to ORDERED directly", () => {
  // The retired branch wrote status ORDERED together with purchaseOrderId/orderedBy/orderedAt.
  // `orderedBy` is the tell: only that transition ever set it, and only from the client.
  const offenders = FILES.filter((f) => {
    const src = code(f.text);
    return /orderedBy\s*:/.test(src) && /transaction\s*\.\s*(set|update)\s*\(/.test(src);
  });
  assert.deepEqual(offenders.map((f) => f.path), [], "these still perform the ORDERED transition client-side");
});

test("the two migrated commands go through the trusted callable transport", () => {
  const create = FILES.find((f) => f.path === "domain/inventoryReorderRequests.js");
  const po = FILES.find((f) => f.path === "domain/reorderPurchaseOrders.js");
  assert.ok(create && po, "both reorder domain modules must exist");
  assert.match(code(create.text), /submitCreateReorderRequest\s*\(/);
  assert.match(code(po.text), /submitRecordReorderPurchaseOrder\s*\(/);

  // NO FALLBACK: neither may still reach the retired write on a failure path. If a `catch` ever
  // routes back into a direct write, that is two write authorities again, which is the thing the
  // Rules retirement exists to prevent.
  assert.doesNotMatch(code(create.text), /catch[\s\S]{0,200}reorderRequestsStore\s*\.\s*add/);
  assert.doesNotMatch(code(po.text), /catch[\s\S]{0,200}transaction\s*\.\s*set\s*\(\s*purchaseOrderRef/);
});

test("the client NEVER sends operatingCompanyId, on any reorder path", () => {
  // The server refuses a supplied company outright, so sending one would fail the command rather
  // than be ignored. This asserts the browser has no code that could send it at all.
  const transport = FILES.find((f) => f.path === "services/reorderCallableClient.js");
  assert.ok(transport, "the reorder callable transport must exist");
  assert.doesNotMatch(code(transport.text), /operatingCompanyId\s*:/, "the transport must never put a company in a payload");

  for (const path of ["domain/inventoryReorderRequests.js", "domain/reorderPurchaseOrders.js"]) {
    const f = FILES.find((x) => x.path === path);
    assert.doesNotMatch(code(f.text), /operatingCompanyId\s*:/, `${path} must never author a company`);
  }
});

test("warehouseId is a required input the client must pass through, not invent", () => {
  const create = FILES.find((f) => f.path === "domain/inventoryReorderRequests.js");
  const src = code(create.text);
  // Threaded through both the direct creator and the recommendation wrapper.
  assert.match(src, /export function createReorderRequest\(\{[^}]*warehouseId/);
  assert.match(src, /export function requestReorderForRecommendation\(\{[^}]*warehouseId/);
  // And never defaulted. A default would be exactly the "infer the warehouse" the ruling forbids.
  assert.doesNotMatch(src, /warehouseId\s*=\s*["']/, "warehouseId must never carry a default value");
  // The other two shapes the same mistake takes. The literal is the worst of them: a hard-coded
  // id would make every unanswered request quietly one company's.
  assert.doesNotMatch(src, /warehouseId\s*(\|\||\?\?)/, "warehouseId must never have a fallback expression");
  assert.doesNotMatch(src, /["'`]wh-/, "no warehouse id may be written into the reorder domain module");
});

test("no reorder surface invents a warehouse for the user", () => {
  // The selector and everything that mounts it. Owner ruling: no default-to-Taylor, no inference
  // from the part, the signed-in user, the truck or the page, and no reading a company out of the
  // sandbox root config at runtime. Each of those is a value that would have to APPEAR in this
  // code for it to happen, so absence is the assertion that holds.
  const SURFACES = [
    "shared/inventory/ReorderWarehouseSelect.jsx",
    "shared/inventory/RequestReorderControl.jsx",
    "modules/inventory/PartsList.jsx",
    "modules/inventory/PartDetail.jsx",
    "modules/inventoryRole/WarehouseManagerHome.jsx",
  ];
  for (const path of SURFACES) {
    const f = FILES.find((x) => x.path === path);
    assert.ok(f, `${path} must exist`);
    const src = code(f.text);
    assert.doesNotMatch(src, /["'`]wh-/, `${path} must not name a warehouse`);
    assert.doesNotMatch(src, /operatingCompanyId/, `${path} must not mention an operating company`);
    assert.doesNotMatch(src, /["'](taylor|ventana)["']/i, `${path} must not name an operating company`);
    assert.doesNotMatch(src, /operating-company-roots/, `${path} must not read the root config at runtime`);
  }
});

test("the warehouse a request is written for is the one that unlocked the button", () => {
  // RequestReorderControl is the single gate, and it hands its OWN warehouseId back on submit
  // rather than letting each caller re-read page state -- so the gating value and the written
  // value cannot diverge. Both submit paths carry it: READY one-click, and NEEDS_PLANNING manual.
  const control = FILES.find((f) => f.path === "shared/inventory/RequestReorderControl.jsx");
  assert.ok(control, "the shared reorder control must exist");
  const src = code(control.text);
  assert.match(src, /onSubmit\(undefined,\s*warehouseId\)/, "the READY path must return the gating warehouse");
  assert.match(src, /onSubmit\(parsedQty,\s*warehouseId\)/, "the NEEDS_PLANNING path must return the gating warehouse");
  // And neither SUBMIT button may be enabled without one. Two buttons, two gates -- the manual
  // quantity input keeps its own unchanged disabled={submitting}, which is why this counts the
  // gate itself rather than counting every disabled prop in the file.
  assert.equal((src.match(/!hasWarehouse/g) ?? []).length, 2, "both submit buttons must be gated on a warehouse");
});
