// EOS Data Import P1 -- Inventory (opening balances).
//
// The entity that imports no record at all. An inventory row asserts a quantity, and quantity
// in EOS is the sum of a movement ledger, so what this contract produces is one opening
// movement -- with openingInventoryBalance.ts, merged earlier, owning what that means.
//
// SEEDED SYNTHETIC DATA ONLY.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  normalizeInventoryRow,
  inventoryContextFindings,
  partIdentityKeyForInventory,
  INVENTORY_REFERENCES,
  INVENTORY_REQUIRED_FIELDS,
  INVENTORY_IMPORT_CONTRACT,
  OPENING_BALANCE_LOCATION_TYPE,
} from "../lib/dataImport/contracts/inventoryImportContract.js";
import { naturalIdentityKey } from "../lib/dataImport/contracts/entityContract.js";
import { buildEntityPreview } from "../lib/dataImport/importPreview.js";
import { detectEntityType } from "../lib/dataImport/importIntake.js";
import { loadExistingOpeningBalances } from "../lib/dataImport/firestoreInventoryImportAdapters.js";

const GOOD = { internalPartNumber: "TST-1001", warehouseName: "Main Warehouse", openingQuantity: "12" };

const CONTEXT = {
  existing: new Set(),
  references: {
    [INVENTORY_REFERENCES.PART]: new Set([partIdentityKeyForInventory("TST-1001")]),
    [INVENTORY_REFERENCES.WAREHOUSE]: new Set([naturalIdentityKey("Main Warehouse")]),
  },
};

const row = (n, values) => ({ sourceRowNumber: n, values });

// --------------------------------------------------------------- quantity

test("a clean row normalizes to a whole-number quantity", () => {
  const { draft, findings } = normalizeInventoryRow(GOOD);
  assert.equal(draft.openingQuantity, 12);
  assert.equal(findings.length, 0);
});

test("thousands separators are accepted -- a spreadsheet's formatting is not a data error", () => {
  assert.equal(normalizeInventoryRow({ ...GOOD, openingQuantity: "1,250" }).draft.openingQuantity, 1250);
});

test("a fraction is REFUSED, never rounded", () => {
  // The ledger counts whole units. Rounding would replace a visible error with an invisible
  // one, and the invisible one is discovered as a count that never reconciles.
  const { draft, findings } = normalizeInventoryRow({ ...GOOD, openingQuantity: "12.5" });
  assert.equal(draft, null);
  assert.ok(findings.some((f) => f.code === "NOT_A_WHOLE_NUMBER"));
});

test("a negative opening balance is refused", () => {
  // A negative starting point is a claim the company began owing stock, which the ledger has
  // no way to represent and no reason to.
  const { draft, findings } = normalizeInventoryRow({ ...GOOD, openingQuantity: "-3" });
  assert.equal(draft, null);
  assert.ok(findings.some((f) => f.code === "NEGATIVE"));
});

test("a non-numeric quantity is refused rather than treated as zero", () => {
  for (const value of ["N/A", "?", "twelve", ""]) {
    const { draft } = normalizeInventoryRow({ ...GOOD, openingQuantity: value });
    assert.equal(draft, null, `${JSON.stringify(value)} must not become a quantity`);
  }
});

test("ZERO is a real statement and imports with a warning, not an error", () => {
  const { draft, findings } = normalizeInventoryRow({ ...GOOD, openingQuantity: "0" });
  // "We stock this part here and have none" is useful and true. The command writes no
  // movement for it, because a movement that moves nothing is not a movement.
  assert.equal(draft.openingQuantity, 0);
  assert.ok(findings.some((f) => f.severity === "WARNING" && f.code === "ZERO_BALANCE"));
  assert.ok(!findings.some((f) => f.severity === "ERROR"));
});

// --------------------------------------------------------------- required fields

test("part, warehouse and quantity are all required", () => {
  assert.deepEqual([...INVENTORY_REQUIRED_FIELDS], ["internalPartNumber", "warehouseName", "openingQuantity"]);
  for (const field of INVENTORY_REQUIRED_FIELDS) {
    assert.equal(normalizeInventoryRow({ ...GOOD, [field]: "" }).draft, null, `${field} must be required`);
  }
});

// --------------------------------------------------------------- references

test("an unknown part is an ERROR -- a count cannot create a catalog record", () => {
  const findings = inventoryContextFindings({ ...GOOD, internalPartNumber: "NOPE-1" }, CONTEXT);
  assert.ok(findings.some((f) => f.code === "PART_NOT_FOUND"));
});

test("a warehouse that is not ACTIVE is not a place a balance may be stated at", () => {
  // The loader only offers ACTIVE warehouses, so an inactive one simply is not in the set.
  // `warehouses.status` is the governed location authority; import does not get a second one.
  const findings = inventoryContextFindings({ ...GOOD, warehouseName: "Retired Warehouse" }, CONTEXT);
  assert.ok(findings.some((f) => f.code === "WAREHOUSE_NOT_FOUND"));
});

test("both missing references are reported together -- they are independent questions", () => {
  // Unlike Equipment, where the location key is scoped by customer and an unknown customer
  // makes the location unanswerable, a part and a warehouse are unrelated. Reporting one and
  // hiding the other would send the operator back for a second round.
  const findings = inventoryContextFindings(
    { internalPartNumber: "NOPE", warehouseName: "NOWHERE", openingQuantity: 1 },
    CONTEXT,
  );
  assert.equal(findings.length, 2);
});

test("with no references loaded, every row fails closed", () => {
  const findings = inventoryContextFindings(GOOD, { existing: new Set() });
  assert.equal(findings.length, 2);
});

// --------------------------------------------------------------- identity

test("identity is the (part, warehouse) PAIR -- one part in two warehouses is two statements", () => {
  const key = (p, w) => INVENTORY_IMPORT_CONTRACT.identityKey({ internalPartNumber: p, warehouseName: w });
  assert.notEqual(key("TST-1", "Main"), key("TST-1", "North"));
  // Part numbers compare with whitespace REMOVED and warehouse names with it COLLAPSED --
  // each field keeps its own contract's rule rather than the pair inventing a third.
  assert.equal(key("TST-1", "Main"), key(" tst-1 ", "  MAIN "));
  assert.equal(key("TST 1", "Main"), key("TST1", "Main"));
});

test("the same part in two warehouses is NOT a duplicate", () => {
  const preview = buildEntityPreview(
    "INVENTORY",
    [
      row(2, { internalPartNumber: "TST-1001", warehouseName: "Main Warehouse", openingQuantity: "5" }),
      row(3, { internalPartNumber: "TST-1001", warehouseName: "North Warehouse", openingQuantity: "7" }),
      // This one IS a duplicate: the same pair stated twice, and the file cannot say which
      // number is right.
      row(4, { internalPartNumber: "tst-1001", warehouseName: "main warehouse", openingQuantity: "9" }),
    ],
    {
      existing: new Set(),
      references: {
        [INVENTORY_REFERENCES.PART]: new Set([partIdentityKeyForInventory("TST-1001")]),
        [INVENTORY_REFERENCES.WAREHOUSE]: new Set([
          naturalIdentityKey("Main Warehouse"),
          naturalIdentityKey("North Warehouse"),
        ]),
      },
    },
  );

  assert.deepEqual(preview.summary, { total: 3, ready: 2, warnings: 0, errors: 1 });
  assert.ok(preview.rows[2].findings.some((f) => f.code === "DUPLICATE_IN_FILE"));
});

// --------------------------------------------------------------- the deliberate gap

test("the existing-balance loader returns NOTHING, on purpose", async () => {
  // The ledger is the single authority on whether a position has already moved, and it
  // answers inside the command's transaction. A preview copy would be a second authority on
  // the same question, and the two would eventually disagree -- with the preview being the
  // one an operator believed. This asserts the gap is deliberate rather than unimplemented.
  assert.equal((await loadExistingOpeningBalances()).size, 0);
});

// --------------------------------------------------------------- detection and scope

test("an inventory header detects as INVENTORY", () => {
  assert.equal(detectEntityType(["PART_NO", "WAREHOUSE", "ON_HAND"]).entityType, "INVENTORY");
});

test("opening balances are stated at a WAREHOUSE, not a bin or a truck", () => {
  // A bin-level opening balance is a different and larger claim (it asserts put-away, not just
  // possession), and a truck's stock is custody rather than an opening position.
  assert.equal(OPENING_BALANCE_LOCATION_TYPE, "WAREHOUSE");
});

test("the contract carries no field that could set a balance directly", () => {
  const offered = INVENTORY_IMPORT_CONTRACT.canonicalFields.map((f) => f.field);
  // Quantity in EOS is the sum of a ledger. A field named onHand, or a status, or a cost
  // would be import asserting something the ledger owns.
  for (const forbidden of ["onHand", "available", "reserved", "unitCost", "status"]) {
    assert.ok(!offered.includes(forbidden), `${forbidden} must not be importable`);
  }
});

// --------------------------------------------------------------- portability

test("the inventory contract stays on the portable side", () => {
  const src = readFileSync(new URL("../src/dataImport/contracts/inventoryImportContract.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  assert.ok(!/from\s+["'][^"']*firebase-admin/.test(src));
  assert.ok(!/\.collection\(/.test(src));
});
