#!/usr/bin/env node
// Generate the Admin policy SEED SNAPSHOT from the measured client-side definitions.
//
// ════════════════════ WHY A GENERATED SNAPSHOT ════════════════════
//
// The canonical object/field model lives in `field-ops-app-vite/src/metadata/definitions/*.js` --
// 29 entities, 394 fields -- and the Object x CRED mapping in
// `field-ops-app-vite/src/access/objectPermissionMap.js`. Both are client-side ESM. `functions/`
// cannot import across the two packages (no shared/monorepo tooling exists in this repo, which is
// the same reason `types/access.ts` is mirrored by hand), and hand-mirroring 394 field definitions
// would create the second field-metadata model this work is explicitly forbidden to create.
//
// So: ONE authority, ONE generated artifact, ONE drift guard. This script reads the definitions and
// writes a JSON snapshot the seed consumes. `adminPolicySeedDrift.test.mjs` regenerates and compares,
// so a definition change that is not re-snapshotted fails rather than silently seeding a stale model.
//
// Same shape as `scripts/syncAccessContracts.mjs`, which already does this for the access contracts.
//
// Usage:  node scripts/buildAdminPolicySeedSnapshot.mjs [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const OUT = join(REPO, "functions", "src", "adminPolicy", "seed", "policySeedSnapshot.json");

const { ENTITY_REGISTRY } = await import(
  new URL(`file://${join(REPO, "field-ops-app-vite", "src", "metadata", "entityRegistry.js").replace(/\\/g, "/")}`).href
);
const { OBJECT_PERMISSIONS } = await import(
  new URL(`file://${join(REPO, "field-ops-app-vite", "src", "access", "objectPermissionMap.js").replace(/\\/g, "/")}`).href
);

// Business object name in the CRUD matrix -> metadata entity id. The SAME table the Administration
// grid uses, restated here because the grid is a React component functions/ cannot import either.
// A mismatch between the two is caught by the drift test.
const ENTITY_BY_OBJECT = {
  Accounts: "account",
  Contacts: "contact",
  "Customer Locations": "location",
  Opportunities: "opportunity",
  "Sales Orders": "salesOrder",
  "Work Orders": "workOrder",
  "Parts Catalog": "part",
  "Inventory Stock": "inventoryTransaction",
  "Inventory Adjustments": "inventoryAction",
  "Purchase Orders": "purchaseOrder",
  Receiving: "receivingOrder",
  "Transfer Orders": "transferOrder",
  "Equipment / Installed Base": "equipment",
  "Invoices / AR": "invoice",
  Payments: "payment",
  Users: "employee",
};

/**
 * Which objects support DELETE.
 *
 * Measured, not assumed: the CRUD matrix's D column is empty for every object, because nothing in
 * this platform hard-deletes a business record -- records are archived, cancelled, voided or
 * deactivated. So `supportsDelete` is false everywhere, and a D grant is refused rather than stored
 * as a no-op somebody would go on believing they had made.
 */
const supportsDelete = (entry) => (entry.D ?? []).length > 0;

/** A stable key from a business object name: "Invoices / AR" -> "invoicesAr". */
function objectKey(name) {
  const entityId = ENTITY_BY_OBJECT[name];
  if (entityId) return entityId;
  const cleaned = name.replace(/[^a-zA-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  return cleaned
    .map((word, i) => (i === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase()))
    .join("");
}

const objects = OBJECT_PERMISSIONS.map((entry) => {
  const entityId = ENTITY_BY_OBJECT[entry.object];
  const entity = entityId ? ENTITY_REGISTRY.find((e) => e.id === entityId) : null;
  return {
    key: objectKey(entry.object),
    label: entry.object,
    labelPlural: entity?.labelPlural ?? null,
    description: entity?.description ?? null,
    domain: entry.domain,
    supportsDelete: supportsDelete(entry),
    // WHICH CAPABILITIES GOVERN WHICH VERB. This is what makes an unsupported CRED cell refusable:
    // an empty list means no capability governs that verb, so no Role can be granted it.
    capabilitiesByVerb: { C: entry.C ?? [], R: entry.R ?? [], E: entry.E ?? [], D: entry.D ?? [] },
    // A matrix object with no registered EntityDefinition has no field list. Recorded as an empty
    // array rather than omitted, so the seed can tell "no fields" from "not looked at".
    fields: (entity?.fields ?? []).map((f) => ({
      key: f.id,
      label: f.label,
      description: f.description ?? null,
      dataType: f.type,
      required: false,
      allowedValues: f.enumValues ?? [],
      defaultValue: null,
      searchable: Boolean(f.filterable),
      sortable: Boolean(f.sortable),
      reportable: f.reportable !== false,
      // The metadata model has no sensitivity vocabulary; `readCapability` is the adjacent fact it
      // does carry. A field gated by its own capability is at least INTERNAL -- promoting it to
      // CONFIDENTIAL would be inventing a classification nobody recorded.
      sensitivity: f.readCapability ? "INTERNAL" : "NORMAL",
      referenceTo: f.referenceTo ?? null,
    })),
  };
});

const snapshot = {
  // Bumped by hand when the SHAPE changes. The seed refuses a snapshot it does not understand
  // rather than reading unfamiliar fields as absent.
  snapshotVersion: 1,
  generatedFrom: [
    "field-ops-app-vite/src/metadata/entityRegistry.js",
    "field-ops-app-vite/src/access/objectPermissionMap.js",
  ],
  counts: {
    objects: objects.length,
    objectsWithFields: objects.filter((o) => o.fields.length > 0).length,
    fields: objects.reduce((n, o) => n + o.fields.length, 0),
  },
  objects,
};

const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = readFileSync(OUT, "utf8");
  if (current !== serialized) {
    console.error("policySeedSnapshot.json is STALE -- regenerate with node scripts/buildAdminPolicySeedSnapshot.mjs");
    process.exit(1);
  }
  console.log("policySeedSnapshot.json is current");
} else {
  writeFileSync(OUT, serialized);
  console.log(`wrote ${OUT}`);
  console.log(`objects: ${snapshot.counts.objects}, with fields: ${snapshot.counts.objectsWithFields}, fields: ${snapshot.counts.fields}`);
}
