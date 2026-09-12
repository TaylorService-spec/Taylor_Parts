// EOS Data Import -- IDENTIFIER AUTHORITY AT THE IMPORT BOUNDARY.
//
// An import boundary may REJECT, but it may not INVENT. These tests pin the three places
// where this boundary was doing the second thing, and the one place where five copies of a
// normalizer gave duplicate detection five chances to mean different things.
//
//   1. A warehouse DISPLAY NAME becomes the `warehouseId` written into the movement ledger.
//      Two ACTIVE warehouses with that name used to resolve to nothing and be reported as
//      "no such warehouse" -- an untrue sentence pointing at the wrong correction.
//   2. The fallback part lookup was `.limit(2)` followed by `.docs[0]`: with two Parts on one
//      Internal Part Number it PICKED, and an opening balance landed on a coin flip.
//   3. The part identity handed to the ledger was `data.partId ?? doc.id` -- a second
//      authority on a fact the binding ruling says is the document id.
//
// NO FIRESTORE AND NO EMULATOR. The adapters take a `Firestore` and are exercised against a
// hand-built double, which is what lets these run in `node --test` with no infrastructure.
// (The repo's emulator suites cannot be used here: port 8080 holds an unrelated service and
// the Admin SDK retries forever rather than failing.)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  compactIdentityKey,
  naturalIdentityKey,
} from "../lib/dataImport/contracts/entityContract.js";
import { partIdentityKey, buildEntityPreview } from "../lib/dataImport/importPreview.js";
import { PART_IMPORT_CONTRACT, derivePartId } from "../lib/dataImport/contracts/partImportContract.js";
import { EQUIPMENT_IMPORT_CONTRACT } from "../lib/dataImport/contracts/equipmentImportContract.js";
import {
  INVENTORY_REFERENCES,
  OPENING_BALANCE_LOCATION_TYPE,
  inventoryContextFindings,
  partIdentityKeyForInventory,
} from "../lib/dataImport/contracts/inventoryImportContract.js";
import {
  loadInventoryReferences,
  firestoreOpeningBalanceWriter,
} from "../lib/dataImport/firestoreInventoryImportAdapters.js";
import { isCanonicalPartId } from "../lib/eosOps/migration/partIdContract.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "src", "dataImport");

// ---------------------------------------------------------------------------
// A Firestore double: enough surface for these adapters, and nothing more.
// ---------------------------------------------------------------------------

function snapshot(docs) {
  return { docs, size: docs.length, empty: docs.length === 0 };
}
function docOf(id, data) {
  return { id, exists: true, data: () => data };
}

function fakeDb(collections) {
  const query = (name, filters, limit) => ({
    where: (field, _op, value) => query(name, [...filters, [field, value]], limit),
    select: () => query(name, filters, limit),
    limit: (n) => query(name, filters, n),
    async get() {
      let docs = (collections[name] ?? []).filter((d) =>
        filters.every(([field, value]) => d.data()[field] === value),
      );
      if (limit !== undefined) docs = docs.slice(0, limit);
      return snapshot(docs);
    },
  });

  const db = {
    collection(name) {
      return {
        ...query(name, [], undefined),
        doc: (id) => ({
          async get() {
            const found = (collections[name] ?? []).find((d) => d.id === id);
            return found ?? { id, exists: false, data: () => undefined };
          },
        }),
      };
    },
    async runTransaction(cb) {
      return cb({ get: (q) => q.get(), set: () => {}, create: () => {}, update: () => {} });
    },
  };
  return db;
}

const ACTIVE = (name) => ({ name, status: "ACTIVE" });

// ---------------------------------------------------------------------------
// ONE FOLD, NOT FIVE
// ---------------------------------------------------------------------------

test("the compact identity fold has exactly ONE definition in the whole import boundary", () => {
  // A STRUCTURAL guard, not a behavioural one. Five byte-identical copies of
  // `.trim().toUpperCase().replace(/\s+/g, "")` agreed perfectly right up until the first
  // one was corrected; what stops a sixth is that adding one makes this fail.
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) files.push(full);
    }
  };
  walk(SRC);

  const FOLD = /toUpperCase\(\)\s*\.replace\(\/\\s\+\/g,\s*""\)/;
  const holders = files.filter((f) => FOLD.test(readFileSync(f, "utf8"))).map((f) => path.relative(SRC, f));
  assert.deepEqual(holders, [path.join("contracts", "entityContract.ts")]);

  // And it is the pair of folds that lives there: a key is either collapsed or compacted, and
  // a contract picks one deliberately rather than spelling one out.
  const entityContract = readFileSync(path.join(SRC, "contracts", "entityContract.ts"), "utf8");
  assert.match(entityContract, /export function compactIdentityKey/);
  assert.match(entityContract, /export function naturalIdentityKey/);
});

test("every caller of the compact fold now agrees, by construction", () => {
  for (const raw of ["TST 1001", "tst1001", "  TST  1001  ", "AB 12345", "ab12345"]) {
    const canonical = compactIdentityKey(raw);
    assert.equal(partIdentityKey(raw), canonical);
    assert.equal(partIdentityKeyForInventory(raw), canonical);
    assert.equal(PART_IMPORT_CONTRACT.identityKey({ internalPartNumber: raw }), canonical);
    assert.equal(EQUIPMENT_IMPORT_CONTRACT.identityKey({ serialNumber: raw }), canonical);
  }
});

test("compact REMOVES whitespace and natural COLLAPSES it -- the two are deliberately different", () => {
  // A part number is one token typed with a stray space; a customer name is words. Folding
  // them the same way would make "ACME WEST" and "ACMEWEST" one customer.
  assert.equal(compactIdentityKey("TST 1001"), "TST1001");
  assert.equal(naturalIdentityKey("Acme  West"), "ACME WEST");
  assert.equal(compactIdentityKey(undefined), "");
  assert.equal(compactIdentityKey(null), "");
});

test("derivePartId asks the part-id contract what canonical means rather than restating it", () => {
  const src = readFileSync(path.join(SRC, "contracts", "partImportContract.ts"), "utf8");
  // The declaration, not the word: the comment that replaced it names what was removed.
  assert.ok(!/^\s*const PART_ID_ALLOWED/m.test(src), "the duplicated ID pattern must be gone");
  assert.ok(!/\[A-Za-z0-9_-\]\{1,64\}/.test(src), "the partId character class must not be restated here");
  assert.match(src, /isCanonicalPartId/);

  // And every id it derives is one the contract accepts -- including from an IPN whose
  // alphabet is wider than a partId's, which is the branch that appends a digest.
  for (const ipn of ["TST-1001", "tst-1001", "A/B", "A-B", "  weird  name  ", "ß"]) {
    assert.ok(isCanonicalPartId(derivePartId(ipn)), `derivePartId(${JSON.stringify(ipn)}) must be canonical`);
  }
  // Lossy sanitization still cannot collide: "A/B" and "A-B" are different Parts.
  assert.notEqual(derivePartId("A/B"), derivePartId("A-B"));
});

// ---------------------------------------------------------------------------
// AMBIGUITY IS NOT ABSENCE -- IN PREVIEW
// ---------------------------------------------------------------------------

const GOOD_ROW = { internalPartNumber: "TST-1001", warehouseName: "Main Warehouse", openingQuantity: 12 };

function contextWith(warehouse, ambiguous = []) {
  return {
    existing: new Set(),
    references: {
      [INVENTORY_REFERENCES.PART]: new Set([partIdentityKeyForInventory("TST-1001")]),
      [INVENTORY_REFERENCES.WAREHOUSE]: new Set(warehouse.map(naturalIdentityKey)),
      [INVENTORY_REFERENCES.WAREHOUSE_AMBIGUOUS]: new Set(ambiguous.map(naturalIdentityKey)),
    },
  };
}

test("a warehouse name held by two ACTIVE warehouses is AMBIGUOUS, not missing", () => {
  const findings = inventoryContextFindings(GOOD_ROW, contextWith([], ["Main Warehouse"]));
  const codes = findings.map((f) => f.code);
  assert.deepEqual(codes, ["WAREHOUSE_NAME_AMBIGUOUS"]);
  // The old behaviour told the operator to create a warehouse that already exists twice.
  assert.ok(!codes.includes("WAREHOUSE_NOT_FOUND"));
  assert.match(findings[0].message, /Rename the warehouses/);
});

test("a warehouse name nobody uses is still, correctly, NOT_FOUND", () => {
  const findings = inventoryContextFindings(GOOD_ROW, contextWith(["North Warehouse"]));
  assert.deepEqual(findings.map((f) => f.code), ["WAREHOUSE_NOT_FOUND"]);
});

test("an unambiguous warehouse produces no finding at all", () => {
  assert.deepEqual(inventoryContextFindings(GOOD_ROW, contextWith(["Main Warehouse"])), []);
});

// ---------------------------------------------------------------------------
// PREVIEW AND WRITER READ THE SAME FACT FROM THE SAME PASS
// ---------------------------------------------------------------------------

test("the reference loader COUNTS warehouse names, so an ambiguous one is never offered as resolvable", async () => {
  const db = fakeDb({
    parts: [docOf("TST-1001", { internalPartNumber: "TST-1001" })],
    warehouses: [
      docOf("wh_a", ACTIVE("Main Warehouse")),
      docOf("wh_b", ACTIVE("MAIN  warehouse")), // same folded name, different document
      docOf("wh_c", ACTIVE("North Warehouse")),
    ],
  });

  const refs = await loadInventoryReferences(db);
  const resolvable = refs[INVENTORY_REFERENCES.WAREHOUSE];
  const ambiguous = refs[INVENTORY_REFERENCES.WAREHOUSE_AMBIGUOUS];

  assert.ok(ambiguous.has(naturalIdentityKey("Main Warehouse")));
  // THE POINT: it is not in BOTH. A Set that merely deduplicated the name would have reported
  // it as present exactly once, and preview would have called the row READY.
  assert.ok(!resolvable.has(naturalIdentityKey("Main Warehouse")));
  assert.ok(resolvable.has(naturalIdentityKey("North Warehouse")));
});

test("a row naming an ambiguous warehouse previews as ERROR, not READY", async () => {
  const db = fakeDb({
    parts: [docOf("TST-1001", { internalPartNumber: "TST-1001" })],
    warehouses: [docOf("wh_a", ACTIVE("Main Warehouse")), docOf("wh_b", ACTIVE("Main Warehouse"))],
  });
  const references = await loadInventoryReferences(db);

  const preview = buildEntityPreview(
    "INVENTORY",
    [{ sourceRowNumber: 2, values: { internalPartNumber: "TST-1001", warehouseName: "Main Warehouse", openingQuantity: "12" } }],
    { existing: new Set(), references },
  );

  assert.equal(preview.summary.errors, 1);
  assert.equal(preview.summary.ready, 0);
  assert.equal(preview.rows[0].classification, "ERROR");
  assert.ok(preview.rows[0].findings.some((f) => f.code === "WAREHOUSE_NAME_AMBIGUOUS"));
  // An ERROR row carries no draft, so nothing downstream can execute it.
  assert.equal(preview.rows[0].draft, null);
});

// ---------------------------------------------------------------------------
// THE WRITER: NAMED REFUSALS INSTEAD OF A GUESS
// ---------------------------------------------------------------------------

const writerFor = (collections) =>
  firestoreOpeningBalanceWriter("admin-1", fakeDb(collections), "IMP-TEST");

test("the writer refuses an ambiguous warehouse BY NAME instead of reporting it missing", async () => {
  const writer = writerFor({
    parts: [docOf("TST-1001", { internalPartNumber: "TST-1001", controlType: "STANDARD" })],
    warehouses: [docOf("wh_a", ACTIVE("Main Warehouse")), docOf("wh_b", ACTIVE("Main Warehouse"))],
  });

  const outcome = await writer.write(GOOD_ROW, "dataImport-IMP-TEST-2");
  assert.equal(outcome.kind, "failed");
  assert.equal(outcome.code, "WAREHOUSE_NAME_AMBIGUOUS");
  assert.match(outcome.message, /2 ACTIVE warehouses are named "Main Warehouse"/);
});

test("two Parts on one Internal Part Number are refused, never picked", async () => {
  // Neither Part sits at the derived id, so the fallback query runs -- the one that was
  // `.limit(2)` then `.docs[0]`, i.e. whichever Firestore happened to return first.
  const writer = writerFor({
    parts: [
      docOf("legacy_a", { internalPartNumber: "TST-1001", controlType: "STANDARD" }),
      docOf("legacy_b", { internalPartNumber: "TST-1001", controlType: "STANDARD" }),
    ],
    warehouses: [docOf("wh_a", ACTIVE("Main Warehouse"))],
  });

  const outcome = await writer.write(GOOD_ROW, "dataImport-IMP-TEST-2");
  assert.equal(outcome.kind, "failed");
  assert.equal(outcome.code, "PART_NUMBER_AMBIGUOUS");
});

test("a stored partId that contradicts its own document id is refused, not preferred", async () => {
  // `data.partId ?? doc.id` used to hand the FIELD to the ledger. A movement keyed on it
  // joins to no Part, and the mistake only surfaces as a reconciliation that will not balance.
  const writer = writerFor({
    parts: [docOf("TST-1001", { internalPartNumber: "TST-1001", controlType: "STANDARD", partId: "SOMETHING-ELSE" })],
    warehouses: [docOf("wh_a", ACTIVE("Main Warehouse"))],
  });

  const outcome = await writer.write(GOOD_ROW, "dataImport-IMP-TEST-2");
  assert.equal(outcome.kind, "failed");
  assert.equal(outcome.code, "PART_ID_CONFLICT");
  assert.match(outcome.message, /Part identity is the document id/);
});

test("a Part whose document id is not a canonical Part.partId never reaches the ledger", async () => {
  const writer = writerFor({
    parts: [docOf("not a part id!", { internalPartNumber: "TST-1001", controlType: "STANDARD" })],
    warehouses: [docOf("wh_a", ACTIVE("Main Warehouse"))],
  });

  const outcome = await writer.write(GOOD_ROW, "dataImport-IMP-TEST-2");
  assert.equal(outcome.kind, "failed");
  assert.equal(outcome.code, "PART_ID_NOT_CANONICAL");
});

test("a genuinely missing warehouse is still NOT_FOUND, and a missing Part still PART_NOT_FOUND", async () => {
  const noWarehouse = await writerFor({
    parts: [docOf("TST-1001", { internalPartNumber: "TST-1001", controlType: "STANDARD" })],
    warehouses: [docOf("wh_c", ACTIVE("North Warehouse"))],
  }).write(GOOD_ROW, "k-1");
  assert.equal(noWarehouse.code, "WAREHOUSE_NOT_FOUND");

  const noPart = await writerFor({
    parts: [],
    warehouses: [docOf("wh_a", ACTIVE("Main Warehouse"))],
  }).write(GOOD_ROW, "k-2");
  assert.equal(noPart.code, "PART_NOT_FOUND");
});

// ---------------------------------------------------------------------------
// WHAT ACTUALLY REACHES THE LEDGER
// ---------------------------------------------------------------------------

test("the identity that reaches the ledger is the parts DOCUMENT ID, at the typed WAREHOUSE pair", async () => {
  // A zero opening quantity is the cheapest complete path: the command reads ledger state at
  // (partId, location) -- which is where we observe the identity it was given -- and then
  // authors no movement, because a movement that moves nothing is not a movement.
  const seen = [];
  const db = fakeDb({
    parts: [docOf("TST-1001", { internalPartNumber: "TST-1001", controlType: "STANDARD", partId: "TST-1001" })],
    warehouses: [docOf("wh_a", ACTIVE("Main Warehouse"))],
  });
  const inner = db.collection.bind(db);
  db.collection = (name) => {
    const c = inner(name);
    const where = c.where.bind(c);
    c.where = (field, op, value) => {
      seen.push([name, field, value]);
      return where(field, op, value);
    };
    return c;
  };

  const outcome = await firestoreOpeningBalanceWriter("admin-1", db, "IMP-TEST").write(
    { ...GOOD_ROW, openingQuantity: 0 },
    "dataImport-IMP-TEST-2",
  );
  assert.equal(outcome.kind, "replayed"); // zero balance: correctly a no-op

  const ledgerRead = seen.find(([, field]) => field === "partId");
  assert.ok(ledgerRead, "the command must have read the ledger by part identity");
  assert.equal(ledgerRead[2], "TST-1001");
  assert.equal(OPENING_BALANCE_LOCATION_TYPE, "WAREHOUSE"); // the TYPE half is a constant, never derived from the file
});
