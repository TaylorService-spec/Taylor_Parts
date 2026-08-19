#!/usr/bin/env node
// Metadata list definitions vs declared Firestore composite indexes.
//
// GOVERNANCE: docs/governance/metadata-architecture-ip-boundary.md §9; the Owner ruling
// on index governance; docs/reviews/gate-a-metadata-foundation.md §5, which named this
// exact gap as something Gate A does NOT settle.
//
// THE GAP THIS CLOSES. listViewDefinition.js's requiredIndexes() derives the composite
// indexes a definition demands, and it has been tested since it was written — but nothing
// called it. A rule that "metadata must not promise filter combinations the backend
// cannot serve" was therefore enforced only for definitions somebody thought to check by
// hand, which is to say it was documentation.
//
// The failure it prevents is specific: a definition declares a filter, CI is green, and
// the query fails in front of a user with a Firestore "index required" error — at read
// time, in production, on a surface nobody touched. The metadata was the thing that
// lied, and the lie was cheap to detect and was not being detected.
//
// REUSES indexKey() FROM scripts/indexDriftGuard.mjs rather than re-deriving it. Key
// normalization has one genuinely subtle rule — Firestore appends __name__ implicitly, so
// a declared index never lists it and a naive comparison reports every index as missing —
// and two implementations of that rule would eventually disagree. The one that already
// exists is also the one the deploy path trusts.
//
// USAGE
//   node scripts/listIndexCoverage.mjs           report
//   node scripts/listIndexCoverage.mjs --check   exit 1 if any demand is undeclared (CI)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { indexKey } from "./indexDriftGuard.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEXES_PATH = path.join(REPO_ROOT, "firestore.indexes.json");

/** Declared composite indexes, as the repository states them. */
export function readDeclaredIndexes(file = INDEXES_PATH) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  return raw.indexes ?? [];
}

/**
 * Compare what list definitions demand against what the repository declares.
 *
 * `demands` is [{ index, listId }] as produced by requiredIndexes(). Returned separately
 * from a boolean so a caller can report WHICH list caused an undeclared demand — "some
 * index is missing" is not actionable, "account.index needs status+updatedAt" is.
 */
export function findUncoveredDemands(demands, declared) {
  const have = new Set((declared ?? []).map(indexKey));
  return (demands ?? []).filter((d) => !have.has(indexKey(d)));
}

/** Human-readable shape of an index, for an error a reader can act on without tooling. */
export function describeIndex(index) {
  const fields = (index.fields ?? [])
    .map((f) => `${f.fieldPath} ${f.order ?? f.arrayConfig ?? "ASC"}`)
    .join(", ");
  return `${index.collectionGroup}: ${fields}`;
}

/**
 * Report coverage.
 *
 * Entities and lists are passed IN rather than imported, because this script lives in
 * scripts/ (Node, repo root) while definitions live in field-ops-app-vite/src/metadata/.
 * A cross-package import here would work today and become a build-tooling question the
 * moment the frontend moves — the same trade the access-contract generator declined.
 */
export function reportCoverage({ demands = [], declared = [] } = {}) {
  const uncovered = findUncoveredDemands(demands, declared);
  return Object.freeze({
    demandCount: demands.length,
    declaredCount: declared.length,
    uncovered: Object.freeze(uncovered),
    covered: demands.length - uncovered.length,
  });
}

// The definitions registered today. Deliberately explicit rather than glob-discovered:
// a list that nobody added here is invisible to this check, and an explicit empty list
// makes that visible instead of implying coverage nobody verified.
//
// EMPTY IS THE HONEST STATE RIGHT NOW. The contracts exist and the runtimes exist, but no
// ListViewDefinition has been authored for a real surface yet — Customers is the first,
// and it is still queued behind the grid. Reporting "0 demands, 0 uncovered" is true;
// reporting nothing at all would let this script look like it was passing when it was
// merely idle.
export const REGISTERED_LIST_DEMANDS = Object.freeze([
  // account.index (field-ops-app-vite/src/metadata/definitions/account.js).
  //
  // Copied rather than imported, for the cross-package reason above. Regenerate with:
  //   node -e "import('./field-ops-app-vite/src/metadata/definitions/account.js').then(async m => { const lv = await import('./field-ops-app-vite/src/metadata/listViewDefinition.js'); console.log(JSON.stringify(lv.requiredIndexes(m.accountIndexList, m.accountEntity), null, 2)); })"
  Object.freeze({
    collectionGroup: "accounts",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "relationshipTypes", arrayConfig: "CONTAINS"},
      {fieldPath: "updatedAt", order: "DESCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "account.index",
  }),
  Object.freeze({
    collectionGroup: "accounts",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "status", order: "ASCENDING"},
      {fieldPath: "updatedAt", order: "DESCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "account.index",
  }),
  Object.freeze({
    collectionGroup: "accounts",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "status", order: "ASCENDING"},
      {fieldPath: "relationshipTypes", arrayConfig: "CONTAINS"},
      {fieldPath: "updatedAt", order: "DESCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "account.index",
  }),
  // workOrder.index (field-ops-app-vite/src/metadata/definitions/workOrder.js).
  Object.freeze({
    collectionGroup: "fieldops_wos",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "status", order: "ASCENDING"},
      {fieldPath: "createdAt", order: "DESCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "workOrder.index",
  }),
  Object.freeze({
    collectionGroup: "fieldops_wos",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "customerId", order: "ASCENDING"},
      {fieldPath: "createdAt", order: "DESCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "workOrder.index",
  }),
  Object.freeze({
    collectionGroup: "fieldops_wos",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "status", order: "ASCENDING"},
      {fieldPath: "customerId", order: "ASCENDING"},
      {fieldPath: "createdAt", order: "DESCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "workOrder.index",
  }),
  // contact.* and opportunity.* definitions.
  Object.freeze({
    collectionGroup: "contacts",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "accountId", order: "ASCENDING"},
      {fieldPath: "name", order: "ASCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "contact.index",
  }),
  Object.freeze({
    collectionGroup: "opportunities",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "stage", order: "ASCENDING"},
      {fieldPath: "expectedCloseAt", order: "ASCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "opportunity.index",
  }),
  // salesOrder.index (field-ops-app-vite/src/metadata/definitions/salesOrder.js). Sales Order
  // is CALLABLE-read like Opportunity, and the requiredIndexes() derivation does not special-
  // case readVia -- it looks only at entity.collection and the list's declared filters/sort, so
  // an INDEX surface with a declared filter still demands a composite the same way a
  // CLIENT_DIRECT list would.
  //
  // Regenerate with:
  //   node -e "import('./field-ops-app-vite/src/metadata/definitions/salesOrder.js').then(async m => { const lv = await import('./field-ops-app-vite/src/metadata/listViewDefinition.js'); console.log(JSON.stringify(lv.requiredIndexes(m.salesOrderIndexList, m.salesOrderEntity), null, 2)); })"
  Object.freeze({
    collectionGroup: "sales_orders",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "state", order: "ASCENDING"},
      {fieldPath: "salesOrderNumber", order: "DESCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "salesOrder.index",
  }),
  // part.index and equipment.index (leaf definitions, registered by the integration lane).
  Object.freeze({
    collectionGroup: "parts",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "status", order: "ASCENDING"},
      {fieldPath: "internalPartNumber", order: "ASCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "part.index",
  }),
  Object.freeze({
    collectionGroup: "parts",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "stockingClass", order: "ASCENDING"},
      {fieldPath: "internalPartNumber", order: "ASCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "part.index",
  }),
  Object.freeze({
    collectionGroup: "parts",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "status", order: "ASCENDING"},
      {fieldPath: "stockingClass", order: "ASCENDING"},
      {fieldPath: "internalPartNumber", order: "ASCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "part.index",
  }),
  Object.freeze({
    collectionGroup: "equipment",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "accountId", order: "ASCENDING"},
      {fieldPath: "name", order: "ASCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "equipment.index",
  }),
  Object.freeze({
    collectionGroup: "equipment",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "status", order: "ASCENDING"},
      {fieldPath: "name", order: "ASCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "equipment.index",
  }),
  Object.freeze({
    collectionGroup: "equipment",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "accountId", order: "ASCENDING"},
      {fieldPath: "status", order: "ASCENDING"},
      {fieldPath: "name", order: "ASCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "equipment.index",
  }),
  // employee.index (leaf definition, registered by the integration lane).
  Object.freeze({
    collectionGroup: "employees",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "operationalRoles", arrayConfig: "CONTAINS"},
      {fieldPath: "displayName", order: "ASCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "employee.index",
  }),
  Object.freeze({
    collectionGroup: "employees",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "employmentStatus", order: "ASCENDING"},
      {fieldPath: "displayName", order: "ASCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "employee.index",
  }),
  Object.freeze({
    collectionGroup: "employees",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "employmentStatus", order: "ASCENDING"},
      {fieldPath: "operationalRoles", arrayConfig: "CONTAINS"},
      {fieldPath: "displayName", order: "ASCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "employee.index",
  }),
  // location.index (leaf definition, registered by the integration lane).
  Object.freeze({
    collectionGroup: "locations",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "accountId", order: "ASCENDING"},
      {fieldPath: "name", order: "ASCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "location.index",
  }),
  // warehouse.index and supplier.index (leaf definitions, registered by the integration lane).
  Object.freeze({
    collectionGroup: "warehouses",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "status", order: "ASCENDING"},
      {fieldPath: "name", order: "ASCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "warehouse.index",
  }),
  Object.freeze({
    collectionGroup: "suppliers",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "status", order: "ASCENDING"},
      {fieldPath: "name", order: "ASCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "supplier.index",
  }),
  // manufacturer.index (leaf definition, registered by the integration lane).
  Object.freeze({
    collectionGroup: "manufacturers",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "status", order: "ASCENDING"},
      {fieldPath: "name", order: "ASCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "manufacturer.index",
  }),
  // truck.index (leaf definition, registered by the integration lane). equipmentModel.index was
  // REMOVED: equipment_models is D4-governed and D4 defers compound query shapes to D5.
  Object.freeze({
    collectionGroup: "trucks",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "status", order: "ASCENDING"},
      {fieldPath: "displayLabel", order: "ASCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "truck.index",
  }),
  Object.freeze({
    collectionGroup: "trucks",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "homeWarehouseId", order: "ASCENDING"},
      {fieldPath: "displayLabel", order: "ASCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "truck.index",
  }),
  Object.freeze({
    collectionGroup: "trucks",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "status", order: "ASCENDING"},
      {fieldPath: "homeWarehouseId", order: "ASCENDING"},
      {fieldPath: "displayLabel", order: "ASCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "truck.index",
  }),
  // stockLocation.index (leaf definition, registered by the integration lane).
  Object.freeze({
    collectionGroup: "stock_locations",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "warehouseId", order: "ASCENDING"},
      {fieldPath: "binCode", order: "ASCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "stockLocation.index",
  }),
  // mobileLocation.index (leaf definition, registered by the integration lane).
  Object.freeze({
    collectionGroup: "mobile_locations",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "active", order: "ASCENDING"},
      {fieldPath: "displayLabel", order: "ASCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "mobileLocation.index",
  }),
  // transferOrder.index and reorderRequest.index (leaf definitions, registered by the integration lane).
  Object.freeze({
    collectionGroup: "transfer_orders",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "status", order: "ASCENDING"},
      {fieldPath: "createdAt", order: "DESCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "transferOrder.index",
  }),
  Object.freeze({
    collectionGroup: "reorder_requests",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "status", order: "ASCENDING"},
      {fieldPath: "createdAt", order: "DESCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "reorderRequest.index",
  }),
  // salesOrder.index (unscoped INDEX read, registered by the integration lane).
  Object.freeze({
    collectionGroup: "sales_orders",
    queryScope: "COLLECTION",
    fields: Object.freeze([
      {fieldPath: "state", order: "ASCENDING"},
      {fieldPath: "salesOrderNumber", order: "DESCENDING"},
      {fieldPath: "__name__", order: "ASCENDING"},
    ]),
    requiredBy: "salesOrder.index",
  }),
]);

// ---------------------------------------------------------------------------
// Registration completeness.
//
// The list above is explicit, which is honest but leaves one hole: a definition
// somebody authors and forgets to register here is INVISIBLE to the coverage check,
// and an invisible definition looks exactly like a covered one. That is the same
// class of failure the coverage gate exists to prevent, one level up.
//
// So the gate also asks the inverse question -- is anything authored but unregistered?
// -- by scanning source text rather than importing across the package boundary. Text
// scanning is the weaker technique and it is chosen deliberately: importing frontend
// modules from scripts/ would work today and become a build-tooling question the moment
// the frontend moves, which is the trade the access-contract generator already declined.
//
// Tests and the contract module itself construct definitions for their own purposes and
// are not surfaces, so they are excluded by path, not by guessing from content.

const FRONTEND_SRC = path.join(REPO_ROOT, "field-ops-app-vite", "src");

/** Paths that construct definitions without being a surface's definition. */
const NOT_A_SURFACE = [
  path.join("metadata", "listViewDefinition.js"),
];

/** Source files that author a ListViewDefinition, repo-relative. */
export function findAuthoredDefinitions(root = FRONTEND_SRC) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(js|jsx|ts|tsx)$/.test(entry.name)) continue;
      if (NOT_A_SURFACE.some((suffix) => full.endsWith(suffix))) continue;
      if (!fs.readFileSync(full, "utf8").includes("makeListViewDefinition(")) continue;
      found.push(path.relative(REPO_ROOT, full).split(path.sep).join("/"));
    }
  };
  walk(root);
  return found.sort();
}

/**
 * Source files whose definitions are accounted for in REGISTERED_LIST_DEMANDS.
 *
 * Kept as a separate list from the demands themselves so that registering a definition
 * is a deliberate act with a name attached, rather than a side effect of adding a row.
 */
export const REGISTERED_DEFINITION_SOURCES = Object.freeze([
  "field-ops-app-vite/src/metadata/definitions/account.js",
  "field-ops-app-vite/src/metadata/definitions/workOrder.js",
  "field-ops-app-vite/src/metadata/definitions/contact.js",
  "field-ops-app-vite/src/metadata/definitions/opportunity.js",
  "field-ops-app-vite/src/metadata/definitions/part.js",
  "field-ops-app-vite/src/metadata/definitions/equipment.js",
  "field-ops-app-vite/src/metadata/definitions/employee.js",
  "field-ops-app-vite/src/metadata/definitions/purchaseOrder.js",
  "field-ops-app-vite/src/metadata/definitions/location.js",
  "field-ops-app-vite/src/metadata/definitions/warehouse.js",
  "field-ops-app-vite/src/metadata/definitions/supplier.js",
  "field-ops-app-vite/src/metadata/definitions/truck.js",
  "field-ops-app-vite/src/metadata/definitions/equipmentModel.js",
  "field-ops-app-vite/src/metadata/definitions/invoice.js",
  "field-ops-app-vite/src/metadata/definitions/payment.js",
  "field-ops-app-vite/src/metadata/definitions/stockLocation.js",
  "field-ops-app-vite/src/metadata/definitions/mobileLocation.js",
  "field-ops-app-vite/src/metadata/definitions/salesTerritory.js",
  "field-ops-app-vite/src/metadata/definitions/transferOrder.js",
  "field-ops-app-vite/src/metadata/definitions/reorderRequest.js",
  "field-ops-app-vite/src/metadata/definitions/receivingOrder.js",
  "field-ops-app-vite/src/metadata/definitions/inventoryTransaction.js",
  "field-ops-app-vite/src/metadata/definitions/supplierCatalogItem.js",
  "field-ops-app-vite/src/metadata/definitions/partAlias.js",
  "field-ops-app-vite/src/metadata/definitions/inventoryAction.js",
  "field-ops-app-vite/src/metadata/definitions/purchaseOrderVoid.js",
  "field-ops-app-vite/src/metadata/definitions/manufacturer.js",
  "field-ops-app-vite/src/metadata/definitions/salesOrder.js",
]);

export function findUnregisteredDefinitions(authored, registered = REGISTERED_DEFINITION_SOURCES) {
  const known = new Set(registered);
  return authored.filter((file) => !known.has(file));
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const check = process.argv.includes("--check");
  const declared = readDeclaredIndexes();
  const report = reportCoverage({ demands: REGISTERED_LIST_DEMANDS, declared });

  const unregistered = findUnregisteredDefinitions(findAuthoredDefinitions());
  if (unregistered.length) {
    console.error(`List definitions authored but not registered with this check (${unregistered.length}):`);
    for (const file of unregistered) console.error(`  - ${file}`);
    console.error("\nAdd each to REGISTERED_DEFINITION_SOURCES and its demands to REGISTERED_LIST_DEMANDS.");
    console.error("An unregistered definition is invisible here, which looks identical to a covered one.");
    if (check) process.exit(1);
  }

  if (report.uncovered.length) {
    console.error(`Undeclared composite indexes required by list definitions (${report.uncovered.length}):`);
    for (const d of report.uncovered) {
      console.error(`  - required by ${d.requiredBy ?? "(unknown list)"}`);
      console.error(`      ${describeIndex(d)}`);
    }
    console.error("\nAdd them to firestore.indexes.json, or narrow the list definition's declared filters.");
    console.error("A declared filter is a promise the query layer has to keep.");
    if (check) process.exit(1);
  } else if (report.demandCount === 0) {
    console.log(
      `No list definitions are registered yet (${report.declaredCount} composite indexes declared). ` +
        "Nothing to check — this is idle, not passing."
    );
  } else {
    console.log(`All ${report.demandCount} list index demand(s) are declared (${report.declaredCount} indexes total).`);
  }
}
