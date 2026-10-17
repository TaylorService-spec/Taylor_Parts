// FIREBASE EXIT F2-remainder + F4 (DECISIONS #246 / #247) -- what leaves Firebase, and what is deliberately left, pinned.
// Run: node --test test/f2rF4FirebaseExit.test.mjs
//
// The rule behind every assertion: a file that no longer needs Firebase on ANY build must not import it again, and a file that
// still serves production's Firebase path (production has no EOS API) must be reachable ONLY through the build-time seam
// (access/eosSessionSource.js), never through a runtime fallback.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "../src");
const read = (rel) => readFileSync(path.join(SRC, rel), "utf8").replace(/\r\n/g, "\n");
const importSpecifiers = (rel) => [...read(rel).matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
const importsFirebase = (rel) => importSpecifiers(rel).filter((s) => /^firebase(\/|$)/.test(s) || /(^|\/)firebase\/firebase(\.js)?$/.test(s));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|jsx|ts|tsx)$/.test(name)) out.push(path.relative(SRC, full).replace(/\\/g, "/"));
  }
  return out;
}
const ALL = walk(SRC);
const importersOf = (needle) => ALL.filter((f) => importSpecifiers(f).some((s) => s.replace(/\.(js|jsx|ts|tsx)$/, "").endsWith(needle)));

test("the files that moved to EOS import no Firebase at all", () => {
  for (const f of [
    "services/operationsReorderReads.ts",
    "hooks/usePartMovementHistory.js",
    "hooks/useGovernedEmployeeDirectory.js",
    "modules/purchasing/PurchaseOrders.jsx",
    "modules/inventory/PartsList.jsx",
    "modules/operations/Operations.jsx",
    "modules/inventoryRole/WarehouseManagerHome.jsx",
  ]) {
    assert.deepEqual(importsFirebase(f), [], `${f} must not import Firebase (it is on the EOS path)`);
  }
});

test("operationsQueries.ts keeps only the two Firestore reads production still needs -- no transfer_orders, suppliers or purchase_orders", () => {
  const src = read("services/operationsQueries.ts").replace(/^\s*\/\/.*$/gm, "");
  const exported = [...src.matchAll(/^export\s+(?:async\s+)?(?:const|function)\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(exported, ["fetchInventoryTransactions", "fetchWarehouses"]);
  for (const gone of ["transfer_orders", "suppliers", "purchase_orders", "documentId", "orderBy", "limit("]) {
    assert.ok(!src.includes(gone), `operationsQueries.ts must not mention ${gone}`);
  }
  assert.ok(!/onSnapshot\s*\(/.test(src), "stays one-shot");
});

test("only the two Firebase-only screens import operationsQueries.ts, and neither is reachable where EOS is the session source", () => {
  assert.deepEqual(
    importersOf("services/operationsQueries").sort(),
    ["modules/administration/AdminWarehouseRacking.jsx", "modules/inventory/partsShadowParityReaders.js"],
  );
  // The racking planner: its bin capabilities have no EOS key, so nobody holds them under EOS.
  assert.match(read("access/eosCapabilityAccess.js"), /inventory\.location\.bin\.read/);
  // The diagnostic: the route is not mounted under EOS.
  assert.match(read("App.jsx"), /\{!EOS_SESSION_SOURCE && \(\s*<Route path="\/admin\/diagnostics\/inventory-parts-parity"/);
});

test("domain/employees.js is gone; the Firestore employee directory is the Financials screens' and nobody else's", () => {
  assert.ok(!existsSync(path.join(SRC, "domain/employees.js")));
  assert.deepEqual(
    importersOf("hooks/useEmployeeDirectory").sort(),
    [
      "modules/financials/FinancialsAccountsReceivable.jsx",
      "modules/financials/FinancialsEmployeePerformance.jsx",
      "modules/financials/FinancialsInvoiceDetail.jsx",
      "modules/inventory/PartDetail.jsx", // only InventoryActionsPanel (the legacy notes), which is not rendered under EOS
    ],
  );
});

test("the frozen inventory_actions listener is reachable only behind the build-time seam", () => {
  assert.deepEqual(
    importersOf("hooks/useInventoryActions").sort(),
    ["modules/inventory/PartDetail.jsx", "modules/inventoryRole/WarehouseManagerHome.jsx"],
  );
  const detail = read("modules/inventory/PartDetail.jsx");
  assert.match(detail, /\{!EOS_SESSION_SOURCE && \(\s*<section className="ns-band ns-band--reference">\s*<details className="ns-parts-rail__item">\s*<summary>Inventory Action History<\/summary>/);
  const warehouse = read("modules/inventoryRole/WarehouseManagerHome.jsx");
  assert.match(warehouse, /EOS_SESSION_SOURCE\s*\?\s*<PartMovementPanel[^>]*\/>\s*:\s*<PartActivityPanel/);
});

test("the movement history asks the governed read for one Part, bounded, and never falls back", () => {
  const hook = read("hooks/usePartMovementHistory.js");
  assert.match(hook, /fetchMovements = fetchInventoryMovements/);
  assert.match(hook, /fetchMovements\(\{ partIds: \[partId\], limit: PART_MOVEMENT_LIMIT \}/);
  assert.match(hook, /boundedRead\(/);
  assert.ok(!/useInventoryActions|inventory_actions/.test(hook.replace(/^\s*\/\/.*$/gm, "")), "no legacy source in code");
});

test("the governed directory shares an answer per principal and is bounded", () => {
  const hook = read("hooks/useGovernedEmployeeDirectory.js");
  assert.match(hook, /useAuth\(\)\?\.user\?\.uid/);
  assert.match(hook, /`d:\$\{uid\}:\$\{idsKey\}`/);
  assert.match(hook, /boundedRead\(/);
});
