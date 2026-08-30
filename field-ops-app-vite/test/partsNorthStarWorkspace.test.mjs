// Parts North Star P1 — the workspace's two rules, made falsifiable.
//
// ND-25 (Owner, 2026-08-30), Option (b): "if no governed list-scale quantity projection exists, omit
// the quantity column in P1. Do not create client-side N-part balance derivation or a second
// inventory authority merely to satisfy the design."
//
// ND-26 made the search a defect. The workspace now labels each row with internalPartNumber, and the
// search provider matched only sku + name + category — so a person could read a Part Number off the
// row in front of them, type it, and be told no such part exists. That is the one search a warehouse
// actually performs, and it is asserted here rather than left to a render test that would not think
// to try it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { SEARCH_PROVIDERS } from "../src/shared/search/searchProviders.js";

const LIST_SRC = fs.readFileSync(path.resolve("src/modules/inventory/PartsList.jsx"), "utf8");

// A composed catalog row, as buildPartsCatalogRows produces it: the document key and the Part Number
// are different strings, which is the only way a test can tell which one the search matched.
const ROW = {
  sku: "TST-9001",
  internalPartNumber: "C712-COMP",
  name: "Compressor Assembly",
  description: "Compressor Assembly, Taylor C712",
  category: "Refrigeration",
  status: "ACTIVE",
  identityState: "CANONICAL_MATCH",
};

function search(q, rows = [ROW]) {
  return SEARCH_PROVIDERS.parts.search(q, { parts: rows });
}

// ── ND-26: the search finds what the row displays ───────────────────────────────────────────────

test("searching the Part Number finds the part", () => {
  const hits = search("C712-COMP");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, "TST-9001");
});

test("a result is LABELLED with the Part Number, and still ROUTES on the document key", () => {
  const [hit] = search("C712-COMP");
  assert.ok(hit.secondaryText.includes("C712-COMP"));
  assert.ok(!hit.secondaryText.includes("TST-9001"), "the document id is not what a person reads");
  // partId remains the immutable routing key — only what a person reads changed.
  assert.equal(hit.route, "/inventory/TST-9001");
});

test("a row with no canonical document says so rather than borrowing the key as its number", () => {
  const [hit] = search("Compressor", [{ ...ROW, internalPartNumber: null }]);
  assert.ok(hit.secondaryText.startsWith("No Part Number"));
  assert.ok(!hit.secondaryText.includes("TST-9001"));
});

test("the description is searchable, because the composed row already carries it", () => {
  assert.equal(search("Taylor C712").length, 1);
});

test("the document id still finds the part — a link or a log is a legitimate way in", () => {
  assert.equal(search("TST-9001").length, 1);
});

test("the placeholder claims only what the provider actually matches", () => {
  // A placeholder is a claim about what typing will do. Barcodes and aliases need the identifier
  // read, which is registered active:false and granted to nobody, so naming them would be a promise
  // the search cannot keep.
  const placeholder = LIST_SRC.match(/placeholder="([^"]+)"/)?.[1] ?? "";
  assert.ok(/part number/i.test(placeholder));
  assert.ok(!/barcode/i.test(placeholder), "barcode search is not available and must not be claimed");
  assert.ok(!/alias/i.test(placeholder), "alias search is not available and must not be claimed");

  const searchable = ["C712-COMP", "Compressor Assembly", "Taylor C712", "Refrigeration"];
  for (const term of searchable) assert.equal(search(term).length, 1, `"${term}" should match`);
  // ...and a barcode-shaped value that appears in no carried field matches nothing, which is what
  // makes the omission from the placeholder honest rather than merely cautious.
  assert.equal(search("0 12345 67890 5").length, 0);
});

// ── ND-25: the quantity column is gone, and cannot come back unnoticed ──────────────────────────

test("the catalog table declares no quantity column", () => {
  for (const heading of ["Warehouse Available", "On Hand", "On hand", "Available"]) {
    assert.ok(
      !LIST_SRC.includes(`<th>${heading}</th>`),
      `"${heading}" is a quantity column heading; ND-25 omits it in P1`
    );
  }
});

test("no cell reads a stock figure out of the health projection", () => {
  // The ledger-derived figure is still COMPUTED — Inventory Health needs it — but the workspace no
  // longer renders it. Reaching into `health.stock` from a cell is how it would come back.
  assert.ok(
    !/data-label="Warehouse Available"/.test(LIST_SRC),
    "the availability cell must not be restored"
  );
  assert.ok(
    !/health\.stock\.availableStock/.test(LIST_SRC),
    "no cell may render the client-derived stock figure"
  );
});

test("Inventory Health survives — a qualitative signal is not a quantity", () => {
  // Deliberately asserted, so a future tidy-up cannot read ND-25 as removing the whole column pair.
  // Health says whether a part needs attention, never how many there are.
  assert.ok(LIST_SRC.includes("<th>Inventory Health</th>"));
});

test("the panel's own sentence no longer promises a stock position it does not show", () => {
  assert.ok(/No stock quantity is shown here/.test(LIST_SRC));
  assert.ok(
    !/Stock position and reorder status are derived/.test(LIST_SRC),
    "the old standfirst described a column that no longer exists"
  );
});
