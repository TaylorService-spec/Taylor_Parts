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
    // Firebase exit B1 (DECISIONS #B1): the Financials pages and reads that moved to the EOS Finance register.
    "modules/financials/FinancialsReceivablesEos.jsx",
    "modules/financials/FinancialsAccountsReceivableEos.jsx",
    "modules/financials/FinancialsSettlementsEos.jsx",
    "modules/financials/FinancialsReceivableDetailEos.jsx",
    "modules/financials/FinancialsSettlementDetailEos.jsx",
    "modules/financials/financialsPages.js",
    "services/eosFinancialsClient.js",
    "domain/financialsEos.js",
    "hooks/useEosFinanceRead.js",
    "hooks/useFinancialsEmployeeDirectory.js", // imports the Firestore hook, not Firebase itself
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

test("only the racking planner and the parity diagnostic import operationsQueries.ts; the planner's Firestore warehouse picker is the non-EOS arm of a build-time choice, and the diagnostic is not mounted under EOS", () => {
  assert.deepEqual(
    importersOf("services/operationsQueries").sort(),
    ["modules/administration/AdminWarehouseRacking.jsx", "modules/inventory/partsShadowParityReaders.js"],
  );
  // The racking planner (Firebase exit B3): its bin capabilities are registered in EOS under their own names, so under EOS it reads and writes
  // eos_ops.bins through the EOS client and the EOS picker; the Firestore picker is the other arm of the build-time choice.
  assert.match(read("modules/administration/AdminWarehouseRacking.jsx"), /const DEFAULT_LOAD_WAREHOUSES = EOS_SESSION_SOURCE \? loadRackingWarehouses : fetchWarehouses;/);
  assert.doesNotMatch(read("access/eosCapabilityAccess.js").replace(/^\s*\/\/.*$/gm, ""), /inventory\.location\.bin/, "no longer a recorded gap");
  // The diagnostic: the route is not mounted under EOS.
  assert.match(read("App.jsx"), /\{!EOS_SESSION_SOURCE && \(\s*<Route path="\/admin\/diagnostics\/inventory-parts-parity"/);
});

test("domain/employees.js is gone; the Firestore employee directory is the Financials screens' and nobody else's", () => {
  assert.ok(!existsSync(path.join(SRC, "domain/employees.js")));
  assert.deepEqual(
    importersOf("hooks/useEmployeeDirectory").sort(),
    [
      // The three Financials screens that still read Firebase-backed facts reach it ONLY through this one chooser (D-247-2, closed by
      // Firebase exit B1, DECISIONS #B1): the Firestore listener is disabled and the governed name read answers where EOS is the source.
      "hooks/useFinancialsEmployeeDirectory.js",
      "modules/inventory/PartDetail.jsx", // only InventoryActionsPanel (the frozen notes); disabled when EOS is the source
    ],
  );
  for (const page of ["FinancialsAccountsReceivable", "FinancialsEmployeePerformance", "FinancialsInvoiceDetail"]) {
    assert.match(read(`modules/financials/${page}.jsx`), /useFinancialsEmployeeDirectory\(/, `${page} names people through the chooser`);
    assert.doesNotMatch(read(`modules/financials/${page}.jsx`), /useEmployeeDirectory\(/, `${page} does not read the Firestore directory directly`);
  }
});

test("the frozen notes stay READABLE under EOS (Firebase exit B3, Owner ruling 8): labelled as ARCHIVED, read-only, from the EOS archive", () => {
  assert.deepEqual(
    importersOf("hooks/useInventoryActions").sort(),
    ["modules/inventory/PartDetail.jsx", "modules/inventoryRole/WarehouseManagerHome.jsx"],
  );
  const detail = read("modules/inventory/PartDetail.jsx");
  // Rendered under BOTH sources; only the title differs, and the label is the one constant.
  assert.match(detail, /<details className="ns-parts-rail__item">\s*<summary>\{EOS_SESSION_SOURCE \? LEGACY_INVENTORY_NOTES_LABEL : "Inventory Action History"\}<\/summary>\s*<InventoryActionsPanel/);
  assert.ok(!/\{!EOS_SESSION_SOURCE && \(\s*<section/.test(detail), "the disclosure must not be hidden under EOS");
  assert.match(read("domain/constants.js"), /LEGACY_INVENTORY_NOTES_LABEL = "Archived legacy notes \(frozen 2026-08-30; not stock movements\)";/);
  // The Firestore employees listen is disabled under EOS; the governed actor read is disabled under Firebase.
  assert.match(detail, /useEmployeeDirectory\(\{ enabled: !EOS_SESSION_SOURCE \}\)/);
  assert.match(detail, /useGovernedEmployeeDirectory\(\{ enabled: EOS_SESSION_SOURCE, actorSubjects:/);
  const warehouse = read("modules/inventoryRole/WarehouseManagerHome.jsx");
  assert.match(warehouse, /EOS_SESSION_SOURCE\s*\?\s*\(\s*<>\s*<PartMovementPanel[^>]*\/>[\s\S]*?<summary>\{LEGACY_INVENTORY_NOTES_LABEL\}<\/summary>\s*<PartActivityPanel[^>]*legacyOnly \/>[\s\S]*?:\s*<PartActivityPanel/);
  // Read-only: the reader hook is the only export and holds no write (also pinned by inventoryActionRetirementContract).
  const hook = read("hooks/useInventoryActions.js").replace(/^\s*\/\/.*$/gm, "");
  // ONE export: the reader, chosen at BUILD time -- the EOS archive where an EOS API is declared, the frozen Firestore collection elsewhere.
  assert.deepEqual([...hook.matchAll(/^export\s+(?:function|const)\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]), ["useInventoryActionsForPart"]);
  assert.match(hook, /export const useInventoryActionsForPart = EOS_SESSION_SOURCE \? useArchivedInventoryActionNotes : useInventoryActionsFromFirestore;/);
  assert.doesNotMatch(hook, /\b(addDoc|setDoc|updateDoc|deleteDoc|writeBatch)\b/);
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
