// Purchasing > Receipts -- architectural-invariant source-scan (house check()/passed convention).
// Encodes the capability-model decision so it can't regress: Receipts is a REUSE-ONLY LAUNCH POINT
// into the canonical purchase-order projection (RECEIVED subset), NOT a separate receive capability.
// It must: reuse buildPurchaseOrdersView + the PO read stack; read NO receiving_orders (backend-only);
// introduce NO receive path (no receiveInventoryStock / receiving transport); and be routed. Plain
// Node; no Firebase/network.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("receiptsLaunchPoint.test.mjs");

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const receipts = read("modules/purchasing/Receipts.jsx");
const app = read("App.jsx");

check("Receipts REUSES the canonical PO projection + read stack (single source of truth)", () => {
  assert.match(receipts, /import \{ buildPurchaseOrdersView.*\} from "\.\.\/\.\.\/domain\/purchaseOrdersView"/);
  assert.match(receipts, /useReorderRequestsByStatuses/);
  assert.match(receipts, /usePurchaseOrdersByIds/);
  // it must not re-implement the projection
  assert.ok(!/buildPurchaseOrderRow|toTransferRef/.test(receipts), "no re-implemented row mapping");
});

check("Receipts is scoped to the RECEIVED subset only", () => {
  assert.match(receipts, /REORDER_REQUEST_STATUS\.RECEIVED/);
  // it does not query ORDERED/VOIDED here (that's the full Purchase Orders workspace)
  assert.ok(!/REORDER_REQUEST_STATUS\.ORDERED|REORDER_REQUEST_STATUS\.VOIDED/.test(receipts), "RECEIVED-only");
});

check("Receipts reads NO backend-only receiving_orders and adds NO receive path", () => {
  // no receiving_orders COLLECTION read (a code reference would be a quoted collection string /
  // a *_COLLECTION constant); the doc comment may still name it in prose to explain the boundary.
  assert.ok(!/["']receiving_orders["']|RECEIVING_ORDERS_COLLECTION/.test(receipts), "no receiving_orders collection read");
  // no IMPORT of the receiving client/transport and no INVOCATION of the callables (a prose comment
  // may still name receiveInventoryStock to explain what this surface deliberately does NOT do).
  assert.ok(!/from "[^"]*receivingCallableClient"|from "[^"]*receivingTransport"/.test(receipts), "no receiving client/transport import");
  assert.ok(!/submitReceiveInventoryStock\(|fetchReceivingLocationOptions\(|httpsCallable\(/.test(receipts), "no receive/callable invocation");
  assert.ok(!/onSnapshot\(|getDocs\(|\bcollection\(/.test(receipts), "no direct Firebase / write path");
});

check("Receipts is honest about the governed receipt ledger being elsewhere (backend-only)", () => {
  // it links to the canonical Receiving capability and states governed receipts aren't listed here
  assert.match(receipts, /\/inventory\/receiving/);
  assert.match(receipts, /governed stock receipts/i);
});

check("App.jsx routes Purchasing > Receipts to the launch point", () => {
  assert.match(app, /import Receipts from "\.\/modules\/purchasing\/Receipts"/);
  assert.match(app, /domain\.key === "purchasing" && item\.key === "receipts"/);
  assert.match(app, /return <Receipts \/>/);
});

console.log(`\n${passed} passed, 0 failed`);
