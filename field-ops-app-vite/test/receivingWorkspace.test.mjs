// Inventory > Receiving workspace -- architectural-invariant tests (source scan, house
// check()/passed convention). These encode the platform principle the capability was built to:
// Receiving is a first-class WORKSPACE, the PartsScanner is a launch-point TOOL, and both use the
// ONE canonical governed receive workflow -- a single source of truth, no alternate receiving
// implementation, no governance bypass. Plain Node; no Firebase/network.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("receivingWorkspace.test.mjs");

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

check("SINGLE SOURCE OF TRUTH: exactly one ReceiveAgainstPurchaseOrder.jsx under src/modules", () => {
  const hits = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "ReceiveAgainstPurchaseOrder.jsx") hits.push(p);
    }
  })(path.join(SRC, "modules"));
  assert.equal(hits.length, 1, `expected one canonical workflow file, found ${hits.length}`);
  assert.ok(hits[0].includes(path.join("modules", "receiving")), "workflow lives in the capability home modules/receiving/");
});

check("the Receiving WORKSPACE composes the canonical workflow (no alternate implementation)", () => {
  const ws = read("modules/inventory/Receiving.jsx");
  assert.match(ws, /import ReceiveAgainstPurchaseOrder from "\.\.\/receiving\/ReceiveAgainstPurchaseOrder"/);
  // it must not re-implement the receive itself
  assert.ok(!/submitReceiveInventoryStock|buildReceiveRequestInput|httpsCallable/.test(ws), "workspace does not re-implement receive");
});

// F2 -- the scanner no longer launches receiving. A scan is a CONTEXTUAL ENTRY
// POINT, and deeper work routes to the surface that owns it: Receiving is a
// first-class workspace at /inventory/receiving, asserted below, importing the
// same canonical ReceiveAgainstPurchaseOrder workflow. The capability is not
// lost -- it stopped being reachable from a barcode, which is the point of
// separating identity resolution from action authority.
//
// The invariant that mattered survives: there is still exactly ONE canonical
// receive workflow, and the workspace uses it.
check("Receiving remains the single canonical workflow's owning surface", () => {
  const workspace = read("modules/inventory/Receiving.jsx");
  assert.match(workspace, /import ReceiveAgainstPurchaseOrder from "\.\.\/receiving\/ReceiveAgainstPurchaseOrder"/);
});

check("F2: the scanner does NOT re-create a second receive launch point", () => {
  const scanner = read("modules/mobile/PartsScanner.jsx");
  assert.doesNotMatch(scanner, /ReceiveAgainstPurchaseOrder/, "a scan must not launch the receive workflow");
  // And it must not have grown a literal action menu again.
  for (const legacy of ["Load my truck", "Cycle count", "Add to purchase order"]) {
    assert.ok(!scanner.includes(legacy), `legacy scanner action "${legacy}" resurfaced`);
  }
});

check("App.jsx routes Inventory > Receiving to the workspace", () => {
  const app = read("App.jsx");
  assert.match(app, /import Receiving from "\.\/modules\/inventory\/Receiving"/);
  assert.match(app, /domain\.key === "inventory" && item\.key === "receiving"/);
  assert.match(app, /return <Receiving \/>/);
});

check("GOVERNANCE: neither the workspace nor the canonical workflow bypasses the readiness-gated client", () => {
  for (const rel of ["modules/inventory/Receiving.jsx", "modules/receiving/ReceiveAgainstPurchaseOrder.jsx"]) {
    const src = read(rel);
    assert.ok(!/httpsCallable/.test(src), `${rel} makes no direct callable`);
    assert.ok(!/RECEIVING_TRANSPORT_READY/.test(src), `${rel} does not read/override the readiness constant`);
    assert.ok(!/from "firebase\/functions"/.test(src), `${rel} does not import firebase functions directly`);
  }
  // the workflow reaches the callables ONLY through the readiness-gated client
  const wf = read("modules/receiving/ReceiveAgainstPurchaseOrder.jsx");
  assert.match(wf, /from "\.\.\/\.\.\/services\/receivingCallableClient"/);
});

console.log(`\n${passed} passed, 0 failed`);
