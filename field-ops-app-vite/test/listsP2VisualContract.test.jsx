// LISTS P2 — THE VISUAL CONTRACT. The gate that should have caught the Owner's visual failure.
//
// GOVERNANCE: docs/north-star/lists/, Owner visual correction 2026-08-27.
//
// ════════════════════ WHY THIS EXISTS ════════════════════
//
// The Owner's visual review failed on surfaces whose structural tests were all green. That is a
// finding about the tests, not only about the pages: `compositionConformance` proved MEMBERSHIP —
// this file imports WorkspaceIdentity, that file does not host WorkspaceShell — and membership is
// not composition. A page can import the right header, declare itself in the right list, pass every
// gate, and still meet the reader as a different product.
//
// The Owner said it exactly: "A page merely importing WorkspaceIdentity, HonestState or an `ns-*`
// class does NOT prove visual conformance."
//
// So this suite tests the ANATOMY and the GRAMMAR rather than the imports:
//
//   * the collection hierarchy is present and in P2's order
//   * no page carries a SECOND page identity beneath its own title
//   * the row grammar is the shared one, not a second table treatment
//   * collection rows state object state as WORDS + TONE, not as pills
//   * the result context sits where P2 puts it — after narrowing, above the rows
//
// ════════════════════ WHAT IT DELIBERATELY DOES NOT DO ════════════════════
//
// No pixel comparison, and no screenshot diffing in jsdom — the Owner ruled that out, and it would
// be false confidence: jsdom applies no stylesheet, so a "measured" height there measures nothing.
// Visual acceptance stays an Owner gate. What is testable here is whether the composition a
// stylesheet would style is the shared one, and that is what these assertions are about.
//
// SAME GRAMMAR IS NOT SAME FEATURES. Nothing below requires a views row, a search box or a filter:
// a family that has no governed views must not grow invented ones, and asserting their presence
// would be a test demanding authority the family does not have.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const read = (rel) => readFileSync(join(SRC, rel), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/**
 * The MIGRATE collection surfaces — the pages the Owner's sweep covers.
 *
 * `owns` marks the file that renders the page identity: Equipment splits its collection across a
 * workspace (identity + tabs) and a register tab (rows + controls), and only one of them has a
 * header to be checked for.
 */
const MIGRATE = [
  { name: "Opportunities", file: "modules/sales/OpportunityList.jsx", owns: "both" },
  { name: "Work Orders", file: "modules/workOrders/WorkOrdersList.jsx", owns: "both" },
  { name: "Job Assignments", file: "modules/jobs/Jobs.jsx", owns: "both" },
  { name: "Accounts", file: "modules/accounts/AccountsList.jsx", owns: "both" },
  { name: "Sales Orders", file: "modules/sales/SalesOrdersList.jsx", owns: "both" },
  { name: "Part Master", file: "modules/inventory/PartMasterList.jsx", owns: "both" },
  { name: "Equipment (workspace)", file: "modules/equipment/EquipmentWorkspace.jsx", owns: "identity" },
  { name: "Equipment (register)", file: "modules/equipment/CustomerEquipment.jsx", owns: "rows" },
  { name: "Suppliers", file: "modules/purchasing/Suppliers.jsx", owns: "both" },
  { name: "Warehouses", file: "modules/inventory/Warehouses.jsx", owns: "both" },
  { name: "Manufacturers", file: "modules/inventory/Manufacturers.jsx", owns: "both" },
  { name: "Users", file: "modules/administration/AdminUsers.jsx", owns: "both" },
  { name: "Trucks", file: "modules/inventory/TruckInventory.jsx", owns: "both" },
  { name: "Purchase Orders", file: "modules/purchasing/PurchaseOrders.jsx", owns: "both" },
  { name: "Transfers", file: "modules/inventory/Transfers.jsx", owns: "both" },
];

// ═════════════════════════════════════════ one page, one identity

describe("no collection carries a second page identity", () => {
  for (const { name, file, owns } of MIGRATE) {
    if (owns === "rows") continue;
    it(`${name} states its name once`, () => {
      const src = read(file);
      expect(src, `${name} must compose the collection header`).toMatch(/<WorkspaceIdentity/);
      // The defect this catches, which every structural gate missed: `ListViewHeader` rendered the
      // object's label AGAIN as an 18px/600 heading directly beneath the 34px serif title, and the
      // saved-view control was a select styled to match it. Two titles for one page — the same
      // doubled-chrome defect GATE 2b records for record pages, arriving on collections through a
      // different door.
      expect(code(src), `${name} must not render a second heading`).not.toMatch(/fo-listview-header/);
      expect(code(src), `${name} must not host WorkspaceShell`).not.toMatch(/WorkspaceShell/);
    });
  }

  it("the shared list header renders NO heading of its own", () => {
    // Asserted at the source of the defect rather than only at each page, so it cannot come back
    // through a sixth consumer nobody thought to add to the list above.
    const header = read("metadata/ListViewHeader.jsx");
    expect(code(header)).not.toMatch(/<h[1-6]/);
    expect(code(header)).not.toMatch(/fo-listview-header/);
    // ...and what it renders instead is the views ROW — exclusive tabs, not a hidden dropdown.
    expect(header).toMatch(/role="radiogroup"/);
    expect(header).toMatch(/ns-collection__views/);
  });
});

// ═════════════════════════════════════════ one row grammar

describe("every collection renders the SAME row grammar", () => {
  it("the shared grid carries the North Star table treatment", () => {
    // The measured delta behind the Owner's finding: `.fo-table` headers were 14px sentence case
    // with a 1px separator identical to a row's, `.ns-table` headers are 10.5px uppercase with
    // 0.1em tracking over a 2px rule. Same page anatomy, different table — so Work Orders did not
    // look like Opportunity however correct its structure was.
    const grid = read("metadata/MetadataListGrid.jsx");
    expect(grid).toMatch(/className="fo-table fo-table--stack ns-table"/);
    // Numeric columns align right and tabular, header included — a heading left of its own values
    // reads as a mislabelled column.
    expect(grid).toMatch(/ns-num/);
  });

  for (const { name, file, owns } of MIGRATE) {
    if (owns === "identity") continue;
    it(`${name} renders rows through a shared table treatment`, () => {
      const src = code(read(file));
      // Either the shared grid, or the ns-table grammar directly for the hand-rolled tables
      // (Opportunity, Part Master, Job Assignments, Transfers, Purchase Orders). What is NOT
      // acceptable is a bare `fo-table` — the treatment that made these pages look unrelated.
      const sharedGrid = /MetadataListGrid/.test(src);
      // The token anywhere in a className, not a className that STARTS with it — the hand-rolled
      // tables carry `fo-table fo-table--stack ns-table`, keeping the stack modifier and the
      // is-inactive/is-observed states other rules hang off `fo-table` while ns-table wins the
      // typography. A first version of this matched `className="ns-table` and failed every one of
      // them, which is a test asserting a class ORDER rather than a treatment.
      const nsTable = /className="[^"]*\bns-table\b/.test(src);
      // A CARD collection composes its rows as cards, not as a table. Trucks is the only one, and
      // it is named rather than pattern-matched so a second card collection has to be a decision.
      const cardCollection = name === "Trucks";
      expect(
        sharedGrid || nsTable || cardCollection,
        `${name} renders neither the shared grid, ns-table, nor a declared card collection`,
      ).toBe(true);
      if (!sharedGrid && !cardCollection) {
        // A table carrying fo-table and NOT ns-table is the old treatment — the one that made
        // these pages look unrelated to Opportunity.
        // SPACE-DELIMITED TOKENS, not `\b`. A word boundary treats the hyphen in
        // "fo-table-scroll" as the end of "fo-table", so the wrapper div reported itself as a bare
        // table — a check matching a PREFIX where it means a CLASS.
        const bare = [...src.matchAll(/className="([^"]*)"/g)]
          .map((m) => m[1].split(/\s+/))
          .filter((tokens) => tokens.includes("fo-table") && !tokens.includes("ns-table"))
          .map((tokens) => tokens.join(" "));
        expect(bare, `${name} renders a bare fo-table: ${bare.join(" | ")}`).toEqual([]);
      }
    });
  }
});

// ═════════════════════════════════════════ state treatment, collection-scoped

describe("collection rows state object state as words + tone", () => {
  /**
   * The ROW REGION of a file, which is what the rule is about.
   *
   * COLLECTION-SCOPED means collection ROWS, and a file-wide search cannot tell a row from a
   * dialog. Part Master keeps a StatusPill in its Change Status dialog — a record-shaped surface
   * where one status IS the subject rather than one of many — and a whole-file assertion would have
   * demanded its removal, which the Owner's correction explicitly does not ask for.
   *
   * So the tbody is sliced out and only that is checked. Files with no tbody (card collections)
   * are handled separately below.
   */
  const rowRegion = (src) => {
    const open = src.indexOf("<tbody");
    const close = src.lastIndexOf("</tbody>");
    return open >= 0 && close > open ? src.slice(open, close) : null;
  };

  for (const { name, file, owns } of MIGRATE) {
    if (owns === "identity") continue;
    it(`${name} uses no StatusPill in its rows`, () => {
      // Lists P2 board 2e: words + tone families, never a pill, never colour alone. A pill is a
      // container announcing "this is a status"; down a scan column, eleven of them compete with
      // the identity that says which record you are looking at.
      const src = code(read(file));
      // A page that delegates its rows to the shared grid HAS no tbody of its own, and the grid
      // renders enum values as plain text — so its rows are already words. The check follows the
      // rows to wherever they are composed rather than reporting "no tbody" as a pass.
      // A CARD collection composes its rows as cards. Trucks also contains a tbody -- the truck
      // DETAIL pane's inventory table -- and slicing that would check a record-shaped sub-surface
      // and report it as the collection's rows. Named first, so the wrong tbody is never read.
      if (name === "Trucks") return;
      if (/MetadataListGrid/.test(src)) {
        expect(code(read("metadata/MetadataListGrid.jsx")), "the shared grid must not render pills")
          .not.toMatch(/<StatusPill/);
        return;
      }
      const rows = rowRegion(src);
      if (rows === null) {
        // A card collection composes its row as a card; checked in its own test below.
        expect(name, "only a declared card collection has no tbody").toBe("Trucks");
        return;
      }
      expect(rows, `${name} must not render StatusPill in collection rows`).not.toMatch(/<StatusPill/);
    });
  }

  it("the Truck fleet CARD states its status as words + tone", () => {
    // A card is a recomposed row (P2 board 2c), so the same rule reaches it — but only for OBJECT
    // STATE. The discrepancy figure beside it is a COUNT carrying an attention tone, not a
    // lifecycle state, and it keeps its treatment: collapsing the two would lose the distinction
    // between "what this truck IS" and "what needs looking at".
    // `asText` is StatusPill's own opt-out of the pill container — plain text carrying the tone
    // class AND the tone glyph, so the state is never colour alone. It already existed for the
    // unknown case, which is the tell that the plain treatment was always available and the pill
    // was a choice rather than the only option.
    const card = code(read("modules/inventory/TruckFleetCard.jsx"));
    expect(card).toMatch(/tone: truckFleetStatusTone\(status\), label: status, asText: true/);
  });

  it("the tone vocabulary is the shared one", () => {
    // `ns-row__stage is-<tone>` is what Opportunity ships; a family inventing its own class would
    // be a second tone vocabulary that drifts.
    for (const file of [
      "modules/sales/OpportunityList.jsx",
      "modules/jobs/Jobs.jsx",
      "modules/inventory/PartMasterList.jsx",
    ]) {
      expect(read(file), file).toMatch(/ns-row__stage is-\$\{/);
    }
  });
});

// ═════════════════════════════════════════ result context, where P2 puts it

describe("the result context sits above the rows it describes", () => {
  it("every metadata collection renders it AFTER its narrowing controls", () => {
    // It used to render inside the list header, ABOVE the filter and sort controls — describing a
    // state the reader had not produced yet. Position is the whole assertion.
    for (const file of [
      "modules/accounts/AccountsList.jsx",
      "modules/workOrders/WorkOrdersList.jsx",
      "modules/sales/SalesOrdersList.jsx",
      "modules/inventory/PartMasterList.jsx",
      "modules/equipment/CustomerEquipment.jsx",
    ]) {
      const src = read(file);
      expect(src, `${file} must render the result context`).toMatch(/<CollectionResultContext/);
      const controls = src.indexOf("<ActiveCriteria");
      const result = src.indexOf("<CollectionResultContext");
      expect(result, `${file}: result context must follow the narrowing controls`).toBeGreaterThan(controls);
    }
  });

  it("the hand-composed collections carry the same sentence in the same place", () => {
    for (const file of ["modules/sales/OpportunityList.jsx", "modules/jobs/Jobs.jsx"]) {
      expect(read(file), file).toMatch(/ns-collection__result/);
    }
  });
});

// ═════════════════════════════════════════ same grammar is not same features

describe("no family grew a control it has no authority for", () => {
  it("Job Assignments has NO views row, NO search and NO filter", () => {
    // It has no governed view set, no search read and no declared filter. Inventing Open / My Work
    // to make a screenshot match would be minting a vocabulary to fill a visual gap — the exact
    // thing the correction forbids.
    const src = code(read("modules/jobs/Jobs.jsx"));
    expect(src).not.toMatch(/ns-collection__views/);
    expect(src).not.toMatch(/ns-toolbar/);
    expect(src).not.toMatch(/type="search"/);
  });

  it("no collection gained a route, a callable or a client read in this correction", () => {
    for (const { name, file } of MIGRATE) {
      const src = code(read(file));
      expect(src, `${name} must not call a callable directly`).not.toMatch(/httpsCallable/);
      expect(src, `${name} must not query Firestore directly`).not.toMatch(/\bgetDocs\(|\bonSnapshot\(/);
    }
  });
});
