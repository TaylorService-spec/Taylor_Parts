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

check("the PartsScanner TOOL launches the SAME canonical workflow (two launch points, one workflow)", () => {
  const scanner = read("modules/mobile/PartsScanner.jsx");
  assert.match(scanner, /import ReceiveAgainstPurchaseOrder from "\.\.\/receiving\/ReceiveAgainstPurchaseOrder"/);
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
