#!/usr/bin/env node
// Generate the Admin policy SEED SNAPSHOT and its COVERAGE LEDGER.
//
// ════════════════════ WHY A GENERATED SNAPSHOT ════════════════════
//
// The canonical object/field model lives in `field-ops-app-vite/src/metadata/definitions/*.js` --
// 29 entities, 394 fields -- and the governable-object union in
// `field-ops-app-vite/src/access/policyObjectRegistry.js`. Both are client-side ESM. `functions/`
// cannot import across the two packages (no shared/monorepo tooling exists in this repo, which is
// the same reason `types/access.ts` is mirrored by hand), and hand-mirroring 394 field definitions
// would create the second field-metadata model this work is explicitly forbidden to create.
//
// So: ONE authority, ONE generated artifact, ONE drift guard. This script reads the definitions and
// writes a JSON snapshot the seed consumes. `adminPolicySeed.test.mjs` regenerates and compares, so
// a definition change that is not re-snapshotted fails rather than silently seeding a stale model.
//
// ════════════════════ THE COVERAGE LEDGER ════════════════════
//
// The snapshot says what IS seeded. The ledger proves nothing was silently left out: every entity
// and every field in the source registry is accounted for as SEEDED or EXCLUDED with a bounded
// reason. `policySeedCoverage.test.mjs` fails if the two disagree, or if a future metadata field
// appears that the ledger does not classify.
//
// Usage:  node scripts/buildAdminPolicySeedSnapshot.mjs [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const SEED_DIR = join(REPO, "functions", "src", "adminPolicy", "seed");
const OUT = join(SEED_DIR, "policySeedSnapshot.json");
const LEDGER = join(SEED_DIR, "policySeedCoverage.json");

const clientModule = (...segments) =>
  new URL(`file://${join(REPO, "field-ops-app-vite", "src", ...segments).replace(/\\/g, "/")}`).href;

const { ENTITY_REGISTRY } = await import(clientModule("metadata", "entityRegistry.js"));
const { GOVERNABLE_OBJECTS, MATRIX_GAP_CAPABILITIES } = await import(
  clientModule("access", "policyObjectRegistry.js")
);

/**
 * The ONLY reasons a source entity or field may be absent from the policy model.
 *
 * Bounded on purpose. A reason that is not on this list cannot be used, so "we had a reason" is not
 * available as an escape -- and today every one of them has a count of ZERO, because every entity
 * and every field is seeded.
 */
const EXCLUSION_REASONS = Object.freeze([
  "TECHNICAL_INTERNAL",
  "DERIVED_DISPLAY_ONLY",
  "LEGACY_RETIRED",
  "ALIAS_DUPLICATE",
  "NON_PERSISTED",
  "NON_GOVERNABLE_SYSTEM_FIELD",
]);

const objects = GOVERNABLE_OBJECTS.map((object) => ({
  key: object.key,
  label: object.label,
  labelPlural: object.labelPlural,
  description: object.description,
  domain: object.domain,
  source: object.source,
  supportsDelete: object.supportsDelete,
  // WHICH CAPABILITIES GOVERN WHICH VERB. This is what makes an unsupported CRED cell refusable
  // (Owner ruling D-2): an empty list means no capability governs that verb, so no Role can be
  // granted it -- which is a different fact from "this Role was not granted it".
  capabilitiesByVerb: object.capabilitiesByVerb,
  fields: object.fields.map((f) => ({
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
}));

const snapshot = {
  // Bumped by hand when the SHAPE changes. The seed refuses a snapshot it does not understand
  // rather than reading unfamiliar fields as absent.
  snapshotVersion: 2,
  generatedFrom: [
    "field-ops-app-vite/src/metadata/entityRegistry.js",
    "field-ops-app-vite/src/access/policyObjectRegistry.js",
  ],
  counts: {
    objects: objects.length,
    objectsWithFields: objects.filter((o) => o.fields.length > 0).length,
    fields: objects.reduce((n, o) => n + o.fields.length, 0),
  },
  objects,
};

// ════════════════════ the ledger ════════════════════

const objectByEntityId = new Map(
  GOVERNABLE_OBJECTS.filter((o) => o.entityId).map((o) => [o.entityId, o]),
);

const entityLedger = ENTITY_REGISTRY.map((entity) => {
  const object = objectByEntityId.get(entity.id) ?? null;
  const seededFields = new Set((object?.fields ?? []).map((f) => f.id));
  return {
    entityId: entity.id,
    label: entity.label,
    declaredFields: entity.fields.length,
    status: object ? "SEEDED" : "EXCLUDED",
    // Absent today. Kept in the shape so an exclusion can never be recorded without one.
    exclusionReason: object ? null : "UNCLASSIFIED",
    objectKey: object?.key ?? null,
    objectSource: object?.source ?? null,
    fields: entity.fields.map((f) => ({
      key: f.id,
      label: f.label,
      dataType: f.type,
      status: seededFields.has(f.id) ? "SEEDED" : "EXCLUDED",
      exclusionReason: seededFields.has(f.id) ? null : "UNCLASSIFIED",
    })),
  };
});

const seededEntities = entityLedger.filter((e) => e.status === "SEEDED");
const excludedEntities = entityLedger.filter((e) => e.status === "EXCLUDED");
const allFields = entityLedger.flatMap((e) => e.fields);
const excludedFields = allFields.filter((f) => f.status === "EXCLUDED");

const byReason = Object.fromEntries(EXCLUSION_REASONS.map((r) => [r, 0]));
for (const f of excludedFields) if (f.exclusionReason in byReason) byReason[f.exclusionReason] += 1;

const ledger = {
  ledgerVersion: 1,
  generatedFrom: snapshot.generatedFrom,
  allowedExclusionReasons: EXCLUSION_REASONS,
  source: {
    entities: ENTITY_REGISTRY.length,
    fields: ENTITY_REGISTRY.reduce((n, e) => n + e.fields.length, 0),
  },
  seeded: {
    objects: objects.length,
    // Objects that exist only because the CRUD matrix names them: real governable objects with no
    // EntityDefinition, so no field list. Counted separately so "objects" and "entities" are never
    // conflated.
    objectsWithoutAnEntity: objects.filter((o) => o.source === "MATRIX_ONLY").length,
    entities: seededEntities.length,
    fields: allFields.filter((f) => f.status === "SEEDED").length,
  },
  excluded: {
    entities: excludedEntities.length,
    fields: excludedFields.length,
    fieldsByReason: byReason,
  },
  // The capability gaps this registry fills, and the ones deliberately left open. Recorded here so
  // the reasoning travels with the numbers rather than living only in a source comment.
  capabilityGapsFilled: Object.keys(MATRIX_GAP_CAPABILITIES).sort(),
  entities: entityLedger,
};

const serializedSnapshot = `${JSON.stringify(snapshot, null, 2)}\n`;
const serializedLedger = `${JSON.stringify(ledger, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const stale = [];
  if (readFileSync(OUT, "utf8") !== serializedSnapshot) stale.push("policySeedSnapshot.json");
  if (readFileSync(LEDGER, "utf8") !== serializedLedger) stale.push("policySeedCoverage.json");
  if (stale.length > 0) {
    console.error(`STALE: ${stale.join(", ")} -- regenerate with node scripts/buildAdminPolicySeedSnapshot.mjs`);
    process.exit(1);
  }
  console.log("policySeedSnapshot.json and policySeedCoverage.json are current");
} else {
  writeFileSync(OUT, serializedSnapshot);
  writeFileSync(LEDGER, serializedLedger);
  console.log(`wrote ${OUT}`);
  console.log(`wrote ${LEDGER}`);
  console.log(
    `source ${ledger.source.entities} entities / ${ledger.source.fields} fields  ->  ` +
    `seeded ${ledger.seeded.objects} objects (${ledger.seeded.entities} entity-backed, ` +
    `${ledger.seeded.objectsWithoutAnEntity} matrix-only) / ${ledger.seeded.fields} fields  ->  ` +
    `excluded ${ledger.excluded.entities} entities / ${ledger.excluded.fields} fields`,
  );
}
