// OBJECT LIST METADATA AUTHORITY — the boundary, as a build failure.
//
// GOVERNANCE: docs/architecture/ADR-013-object-list-metadata-authority.md.
//
// ============================ WHY A GUARD AND NOT A NOTE ============================
//
// A parallel architecture is not built on purpose. It is built by somebody who did not know the
// canonical one existed — which is exactly how `src/domain/fieldMetadata.js` came to duplicate five
// entity definitions that already had canonical equivalents, and how `/inventory` and
// `/inventory/part-master` ended up as two Parts lists on two list systems.
//
// The retired modules are deleted, so nothing can import them. What this file protects is the
// SECOND-ORDER failure: somebody re-creating the same shape under a different name, or adding a
// thirty-first object definition somewhere other than the canonical registry. Neither breaks a test
// today; both are found in a review six months later, if at all.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(process.cwd(), "src");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(SRC, p).split("\\").join("/");
const files = walk(SRC);

// ─────────────────────────────────────────────────────────────────────────────── retirement

/**
 * The duplicate architecture, by path.
 *
 * Deletion over deprecation, on purpose: a "deprecated but still usable" parallel system is the one
 * the next person finds first, because it is the one that still works.
 */
const RETIRED = [
  "domain/fieldMetadata.js",
  "domain/objectFields.js",
  "domain/purchaseOrderFields.js",
  "domain/partFields.js",
  "domain/listQueryState.js",
  "shared/ui/ListControls.jsx",
];

test("the duplicate object-list metadata architecture is GONE, not deprecated", () => {
  for (const r of RETIRED) {
    assert.equal(existsSync(path.join(SRC, r)), false, `${r} still exists — deletion, not deprecation`);
  }
});

test("nothing imports a retired module", () => {
  const offenders = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const r of RETIRED) {
      const bare = r.replace(/\.(jsx?|tsx?)$/, "");
      const leaf = bare.split("/").pop();
      // Matches `from ".../partFields.js"` and `from ".../partFields"` alike.
      if (new RegExp(`from\\s+["'][^"']*/${leaf}(\\.jsx?)?["']`).test(src)) {
        offenders.push(`${rel(f)} -> ${r}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `retired modules must have no importers:\n  ${offenders.join("\n  ")}`);
});

// ─────────────────────────────────────────────────────────────────────────────── one authority

test("entity definitions live ONLY under src/metadata/definitions", () => {
  // The shape of a definition, not its name: `makeEntityDefinition(` is the constructor, and a copy
  // of this architecture elsewhere would have to call something like it.
  const offenders = files
    .filter((f) => !rel(f).startsWith("metadata/"))
    .filter((f) => /makeEntityDefinition\s*\(/.test(readFileSync(f, "utf8")))
    .map(rel);
  assert.deepEqual(
    offenders, [],
    `an EntityDefinition outside src/metadata/definitions is a second object model:\n  ${offenders.join("\n  ")}`,
  );
});

test("list view definitions live ONLY under src/metadata", () => {
  const offenders = files
    .filter((f) => !rel(f).startsWith("metadata/"))
    .filter((f) => /makeListViewDefinition\s*\(/.test(readFileSync(f, "utf8")))
    .map(rel);
  assert.deepEqual(offenders, [], `a ListViewDefinition outside src/metadata:\n  ${offenders.join("\n  ")}`);
});

test("there is ONE filter UI and ONE sort UI", () => {
  // A second "+ Add Filter" is how two filter systems end up on one screen — which is what mounting
  // the pilot's controls on an already-metadata-driven Account list would have done.
  const offenders = files
    .filter((f) => rel(f) !== "metadata/MetadataListControls.jsx")
    .filter((f) => /\+ Add Filter/.test(readFileSync(f, "utf8")))
    .map(rel);
  assert.deepEqual(offenders, [], `a second filter builder:\n  ${offenders.join("\n  ")}`);
});

test("there is ONE URL-state layer for list criteria", () => {
  const offenders = files
    .filter((f) => rel(f) !== "metadata/listUrlState.js")
    .filter((f) => {
      const src = readFileSync(f, "utf8");
      // A module that both writes and reads list criteria to a query string is a second URL layer.
      return /export function toSearchParams/.test(src) && /export function fromSearchParams/.test(src);
    })
    .map(rel);
  assert.deepEqual(offenders, [], `a second list-criteria URL layer:\n  ${offenders.join("\n  ")}`);
});

// ─────────────────────────────────────────────────────────────────────────────── query honesty

test("no screen builds Firestore query constraints for a list of its own", () => {
  // §18: a list query is the runtime's to shape. A component assembling where()/orderBy()/limit()
  // itself is making a promise no index coverage check ever saw. Services translate a DESCRIPTOR;
  // modules must not translate criteria.
  const offenders = files
    .filter((f) => rel(f).startsWith("modules/"))
    .filter((f) => {
      const src = readFileSync(f, "utf8");
      return /from\s+["']firebase\/firestore["']/.test(src) && /\borderBy\s*\(/.test(src) && /\blimit\s*\(/.test(src);
    })
    .map(rel);
  assert.deepEqual(
    offenders, [],
    `a module building its own bounded query:\n  ${offenders.join("\n  ")}`,
  );
});

// ──────────────────────────────────────────────────────── which registry names the objects
//
// ADR-013 settled which system owns object and FIELD definitions. It did not settle the question
// underneath that one — WHICH LIST SAYS AN OBJECT EXISTS — because when it was written only one
// list plausibly claimed to.
//
// Two do. `metadata/entityRegistry.js` holds 28 entities and is what `access/policyObjectRegistry.js`
// unions with the CRUD matrix to answer "which objects can policy govern?". `domain/reporting/
// reportCatalog.js` holds 12 objects with a collection, a read capability and per-field operators —
// the same three concepts — and `metadata/entityDefinition.js`'s own PROVENANCE header cites it as
// the prior art the entity model generalises. That citation is honest and it is also the overlap.
//
// THE RULING: ENTITY_REGISTRY is authoritative for object identity. The report catalog is a
// capability-scoped reporting PROJECTION over a subset — inert, ships no read path, and mints
// `report.<id>.*` capability strings that are not in permissionCatalog.ts. It is not a second
// registry and must not become one.
//
// WHY A GUARD. The drift already happened and took three weeks to notice. definitions/purchaseOrder.js
// declined to declare its parent edge because there was "no registered `reorderRequest`
// EntityDefinition anywhere in this program", citing the report catalog's inert object of that name
// as the only one — while definitions/reorderRequest.js, registered a week later, declared that very
// edge and test/metadataProcurementDefinitions.test.mjs asserted it closed the gap. Nothing failed,
// because nothing compared the two lists. These four tests are that comparison.

import { ENTITY_REGISTRY } from "../src/metadata/entityRegistry.js";
import { REPORT_OBJECTS } from "../src/domain/reporting/reportCatalog.js";

const DEFINITIONS_DIR = path.join(SRC, "metadata", "definitions");
const definitionFiles = readdirSync(DEFINITIONS_DIR).filter((f) => f.endsWith(".js"));

/**
 * Report-catalog objects with NO EntityDefinition, and why. A CLOSED LEDGER, not an exemption.
 *
 * Each of these is a real reporting object over a real collection that the shipped object model has
 * never declared. That is a recorded state, not a licence: adding a FOURTH means the report catalog
 * is where an object first appeared, which is the failure this section exists to stop. The fix is to
 * declare the EntityDefinition, not to add a line here.
 */
const ENTITY_DEFINITION_ABSENT = Object.freeze({
  job: "fieldops_jobs — reporting wave 2, fieldsPopulated:false. No EntityDefinition; no list, page or record surface reads it through the metadata runtime.",
  technician: "fieldops_technicians — superseded in the object model by the Owner's 2026-08-20 ruling that technician is a ROLE on Employee, not a family. employeeEntity is the registered object.",
  serviceHistory: "derived, collection:null — synthesized from fieldops_wos. An EntityDefinition requires a collection, so a derived reporting object cannot have one by construction.",
});

/**
 * The ONE label divergence between the two lists, and why it is the entity registry that is wrong.
 *
 * A CLOSED LEDGER. A second entry means the two lists have started describing the same collection
 * differently again, which is the thing being guarded.
 */
const KNOWN_LABEL_DIVERGENCE = Object.freeze({
  purchaseOrder:
    "Both bind `reorder_purchase_orders`. The report catalog deliberately relabelled it 'Reorder Purchase Order' because calling it 'Purchase Order' 'made a reporting result claim a source it never read' — `purchase_orders` is a different authority. purchaseOrderEntity still carries the rejected label, and Administration -> Objects renders it. Correcting it is a Purchasing-domain call (PURCHASE_ORDER_MONEY_LIVES_ON_A_DIFFERENT_COLLECTION), not a list-metadata one; recorded here so it is visible rather than inherited.",
});

test("ENTITY_REGISTRY is where an object first appears — the report catalog may not name a new one", () => {
  const entityCollections = new Set(ENTITY_REGISTRY.map((e) => e.collection));
  const unknown = REPORT_OBJECTS
    .filter((o) => !entityCollections.has(o.collection))
    .map((o) => o.objectId)
    .filter((id) => !(id in ENTITY_DEFINITION_ABSENT));
  assert.deepEqual(
    unknown, [],
    "a report-catalog object with no EntityDefinition on its collection means the reporting projection " +
    `is acting as the object registry: ${unknown.join(", ")}. Declare the EntityDefinition.`,
  );
});

test("the absent-entity ledger is closed — every entry is still absent, and none is stale", () => {
  // The mirror of the test above, and the half that catches the drift that actually happened: an
  // entry whose entity HAS since been declared is a stale claim, exactly like the one in
  // purchaseOrder.js's header. Delete the line when the definition lands.
  const stale = Object.keys(ENTITY_DEFINITION_ABSENT).filter((id) =>
    REPORT_OBJECTS.some((o) => o.objectId === id && ENTITY_REGISTRY.some((e) => e.collection === o.collection)),
  );
  assert.deepEqual(stale, [], `an EntityDefinition now exists for: ${stale.join(", ")} — remove the ledger entry`);
  for (const [id, reason] of Object.entries(ENTITY_DEFINITION_ABSENT)) {
    assert.ok(REPORT_OBJECTS.some((o) => o.objectId === id), `${id} is no longer in the report catalog`);
    assert.ok(reason.length > 40, `${id} records a finding, not a shrug`);
  }
});

test("where both lists name one collection, they agree on the label", () => {
  const divergences = [];
  for (const reportObject of REPORT_OBJECTS) {
    if (reportObject.collection === null) continue;
    for (const entity of ENTITY_REGISTRY.filter((e) => e.collection === reportObject.collection)) {
      if (entity.label === reportObject.label) continue;
      if (reportObject.objectId in KNOWN_LABEL_DIVERGENCE) continue;
      divergences.push(`${reportObject.collection}: entity "${entity.label}" vs report "${reportObject.label}"`);
    }
  }
  assert.deepEqual(
    divergences, [],
    `two lists describing one collection differently is how a surface comes to claim a source it never read:\n  ${divergences.join("\n  ")}`,
  );
});

test("no definition claims a REGISTERED entity is unregistered", () => {
  // The staleness class, generalised. A definition that declines to declare an edge because the
  // target "has no registered X EntityDefinition" is making a claim about the registry, and the
  // registry can change under it. This is the comparison nobody was running.
  //
  // A QUOTED claim is exempt, and the leading quote character is the whole discriminator. A file
  // recording what ANOTHER file used to assert is writing attributed history, which is how the
  // correction stays legible — reorderRequest.js:119 quotes exactly this sentence in order to say it
  // is no longer true. An unquoted one is a live assertion, which is the thing that goes stale.
  const registered = new Set(ENTITY_REGISTRY.map((e) => e.id));
  const offenders = [];
  for (const file of definitionFiles) {
    const source = readFileSync(path.join(DEFINITIONS_DIR, file), "utf8");
    for (const match of source.matchAll(/(?<!["'])no registered `(\w+)`\s*(?:EntityDefinition|entity)\b/g)) {
      if (registered.has(match[1])) offenders.push(`${file}: claims \`${match[1]}\` is unregistered — it is in ENTITY_REGISTRY`);
    }
  }
  assert.deepEqual(offenders, [], `a stale registration claim:\n  ${offenders.join("\n  ")}`);
});

test("the object model does not DEPEND on the reporting projection", () => {
  // entityDefinition.js cites the report catalog as provenance, in prose. Prose is the right place
  // for it. An import would make the reporting projection a build-time input to the object model and
  // the overlap structural rather than historical.
  const offenders = files
    .filter((f) => rel(f).startsWith("metadata/"))
    .filter((f) => /from\s+["'][^"']*reporting\/reportCatalog(\.js)?["']/.test(readFileSync(f, "utf8")))
    .map(rel);
  assert.deepEqual(offenders, [], `src/metadata must not import the reporting catalog:\n  ${offenders.join("\n  ")}`);
});
