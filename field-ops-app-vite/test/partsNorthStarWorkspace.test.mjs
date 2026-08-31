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
  // THE CATALOGUE SEARCH'S placeholder, not whichever placeholder appears first in the file.
  //
  // This read `/placeholder="([^"]+)"/` -- the first one anywhere in the source -- and passed only
  // because the catalogue search happened to be the first input declared. P1v2 moved the Work and
  // Flow groups into a rail whose JSX is now built ABOVE the return, so the first placeholder in
  // the file became the reorder-history lookup's "Reorder Request document ID", and this test
  // started asserting a claim about the wrong control. Anchored on the search input itself, which
  // is what the assertion was always about.
  const placeholder = LIST_SRC.match(/type="search"[\s\S]{0,600}?placeholder="([^"]+)"/)?.[1] ?? "";
  assert.ok(placeholder.length > 0, "the catalogue search input's placeholder was not found");
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

test("the catalogue table states Frame 1a's grammar — P1v2 SUPERSEDES ND-30's column list", () => {
  // WHAT THIS REPLACES, TWICE OVER, and why neither step is a weakening.
  //
  // (1) The earliest form pinned an Inventory Health column, on the reasoning that ND-25 removed a
  //     QUANTITY and that a qualitative signal should not be swept away with it. ND-30 then named
  //     the table's grammar explicitly and Inventory Health was not in it. The signal was not lost
  //     from the page -- the Inventory Operational Queue ranks parts by exactly that urgency, from
  //     the same analytics. It left this TABLE, not this workspace.
  //
  // (2) ND-30's list included MANUFACTURER. The Parts P1v2 composition, approved by the Owner on
  //     2026-08-31 with seven authority corrections, drops that column and folds the manufacturer
  //     into the Part cell -- ruling 6/W7. As its own column it read "Not recorded" on 25 of 25
  //     rows and spent 194px doing it: governed, real, and not earning its width today.
  //
  //     THE FACT IS STILL ASSERTED, one line down, in the cell it moved to. A test that stopped
  //     asserting something without saying why is how a ruling gets lost, so this says why and then
  //     keeps asserting it.
  for (const heading of ["Part", "Category", "Control", "Status", "Attention"]) {
    assert.ok(LIST_SRC.includes(`<th>${heading}</th>`), `Frame 1a column missing: ${heading}`);
  }
  assert.ok(
    !LIST_SRC.includes("<th>Manufacturer</th>"),
    "P1v2 folds the manufacturer into the Part cell; it must not have its own column again"
  );
  assert.ok(
    /row\.manufacturer \? ` · \$\{row\.manufacturer\}` : null/.test(LIST_SRC),
    "the manufacturer must still render in the Part cell -- dropping the column may not drop the fact"
  );
  // And the quantity ruling still holds over the new grammar.
  for (const heading of ["Warehouse Available", "On Hand", "On hand", "Available"]) {
    assert.ok(!LIST_SRC.includes(`<th>${heading}</th>`), `${heading} is a quantity column`);
  }
});
